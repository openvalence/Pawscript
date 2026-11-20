//! Safe file IO. Every write the app makes goes through `write_atomic`: a temp
//! file in the target's own directory, fsync, rename over the target. A crash or
//! full disk leaves either the old file or the new one, never a truncated one.
//!
//! `write_with_backup` adds the funscript safety net (outline §11): content the
//! app did not write itself is copied to `<name>.bak` before the first overwrite,
//! and the app's own previous versions roll into the backups folder in the app
//! data dir (keep last N).

use crate::error::{At, Error, Result};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Reading a "text" file larger than this is almost certainly a wrong pick (a video).
const MAX_TEXT: u64 = 256 << 20;

pub fn now_ms() -> i64 {
  SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

pub fn hex(bytes: &[u8]) -> String {
  bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn sha256_hex(bytes: &[u8]) -> String {
  hex(&Sha256::digest(bytes))
}

pub fn mtime_ms(meta: &fs::Metadata) -> Option<i64> {
  meta.modified().ok()?.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as i64)
}

/// Paths cross the IPC boundary as strings; a non-UTF-8 name cannot round-trip.
pub fn path_str(p: &Path) -> String {
  p.to_string_lossy().into_owned()
}

/// A stable key for "the same file": absolute, symlinks resolved when it exists,
/// case-folded where the file system usually ignores case. A file that does not
/// exist yet is keyed by its canonical folder: canonicalize turns a mapped network
/// drive (`W:\x`) or a UNC path into `\\?\UNC\server\share\x`, so keying the absent
/// file by its plain absolute path gave another key before the first write than
/// after it (every second save then made a needless `.bak`).
pub fn path_key(p: &Path) -> String {
  let abs = fs::canonicalize(p)
    .or_else(|e| match (p.parent(), p.file_name()) {
      (Some(d), Some(n)) if !d.as_os_str().is_empty() => fs::canonicalize(d).map(|d| d.join(n)),
      _ => Err(e),
    })
    .unwrap_or_else(|_| std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf()));
  let mut s = path_str(&abs);
  if let Some(rest) = s.strip_prefix(r"\\?\") {
    s = rest.to_string();
  }
  if cfg!(any(windows, target_os = "macos")) {
    s = s.to_lowercase();
  }
  s
}

/// Pawscript's own files: a scripter keeps them next to the video, so they are
/// writable everywhere (the project, its runs, the scripts, and their `.bak` copies).
const OWN_EXT: &[&str] = &["funscript", "pawproj", "pawruns", "bak"];

/// Refuses `path` when its folder lies under one of `roots` (folders Pawscript
/// never writes into or deletes from). Reads stay open. Pawscript's own files
/// (`OWN_EXT`) are allowed everywhere: they belong next to the video.
/// The read-only roots: the setting `files.readOnlyRoots` (an array of folders) when present, else the folders in
/// PAWSCRIPT_READ_ONLY_ROOTS (separated by ';'), else none, plus the checkout's Reference folder always (an empty
/// setting clears the others, never that one).
/// No user folder is compiled in (paw-59g1): a machine that keeps a library read-only says so in that setting or variable.
pub fn read_only_roots_from(settings: Option<&serde_json::Value>, env: Option<&str>, checkout: &Path) -> Vec<PathBuf> {
  let mut v: Vec<PathBuf> = match settings.and_then(|v| v.get("files.readOnlyRoots")).and_then(serde_json::Value::as_array) {
    Some(a) => a.iter().filter_map(serde_json::Value::as_str).map(PathBuf::from).collect(),
    None => env.unwrap_or("").split(';').map(str::trim).filter(|s| !s.is_empty()).map(PathBuf::from).collect(),
  };
  v.push(checkout.join("Reference"));
  v
}
pub fn check_writable(path: &Path, roots: &[PathBuf]) -> Result<()> {
  if path.extension().and_then(|e| e.to_str()).is_some_and(|e| OWN_EXT.iter().any(|o| e.eq_ignore_ascii_case(o))) {
    return Ok(());
  }
  let dir = path_key(path.parent().unwrap_or(path));
  let sep = std::path::MAIN_SEPARATOR;
  for root in roots {
    let r = path_key(root);
    let r = r.trim_end_matches(sep);
    if dir == r || dir.starts_with(&format!("{r}{sep}")) {
      return Err(Error::new("protected", format!("{}: {} is read-only for Pawscript (setting files.readOnlyRoots)", path.display(), root.display())));
    }
  }
  Ok(())
}

// ---------------------------------------------------------------- read / stat

#[derive(Debug, serde::Serialize)]
pub struct TextFile {
  pub text: String,
  /// SHA-256 of the bytes on disk: pass back as `expected_sha256` to detect
  /// an outside change before overwriting.
  pub sha256: String,
  pub size: u64,
  pub mtime_ms: Option<i64>,
}

pub fn read_text(path: &Path) -> Result<TextFile> {
  let meta = fs::metadata(path).at(path)?;
  if meta.is_dir() {
    return Err(Error::invalid(format!("{}: is a folder", path.display())));
  }
  if meta.len() > MAX_TEXT {
    return Err(Error::new("too_large", format!("{}: {} MB is too large for a text file", path.display(), meta.len() >> 20)));
  }
  let bytes = fs::read(path).at(path)?;
  let sha256 = sha256_hex(&bytes);
  // A UTF-8 BOM (some Windows tools write one) would break JSON.parse.
  let body = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
  let text = String::from_utf8(body.to_vec()).map_err(|_| Error::new("not_utf8", format!("{}: not UTF-8 text", path.display())))?;
  Ok(TextFile { text, sha256, size: bytes.len() as u64, mtime_ms: mtime_ms(&meta) })
}

/// A binary file larger than this is not one of ours (the biggest, a `.pawruns`, is a few MB per run).
const MAX_BYTES: u64 = 1 << 30;

/// The raw bytes of a file the app wrote (`.pawruns`); refuses folders and anything over 1 GiB.
pub fn read_bytes(path: &Path) -> Result<Vec<u8>> {
  let meta = fs::metadata(path).at(path)?;
  if meta.is_dir() {
    return Err(Error::invalid(format!("{}: is a folder", path.display())));
  }
  if meta.len() > MAX_BYTES {
    return Err(Error::new("too_large", format!("{}: {} MB is too large", path.display(), meta.len() >> 20)));
  }
  fs::read(path).at(path)
}

/// `%XX` escapes (encodeURIComponent) -> the UTF-8 string; None on a bad escape or invalid UTF-8.
/// Used for a path sent in an IPC header (headers carry ASCII only).
pub fn percent_decode(s: &str) -> Option<String> {
  let b = s.as_bytes();
  let mut out = Vec::with_capacity(b.len());
  let mut i = 0;
  while i < b.len() {
    if b[i] == b'%' {
      let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
      out.push(u8::from_str_radix(hex, 16).ok()?);
      i += 3;
    } else {
      out.push(b[i]);
      i += 1;
    }
  }
  String::from_utf8(out).ok()
}

#[derive(Debug, serde::Serialize)]
pub struct Stat {
  pub exists: bool,
  pub is_file: bool,
  pub is_dir: bool,
  pub size: u64,
  pub mtime_ms: Option<i64>,
  pub readonly: bool,
}

pub fn stat(path: &Path) -> Result<Stat> {
  match fs::metadata(path) {
    Ok(m) => Ok(Stat { exists: true, is_file: m.is_file(), is_dir: m.is_dir(), size: m.len(), mtime_ms: mtime_ms(&m), readonly: m.permissions().readonly() }),
    Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Stat { exists: false, is_file: false, is_dir: false, size: 0, mtime_ms: None, readonly: false }),
    Err(e) => Err(Error::io(e, path)),
  }
}

#[derive(Debug, serde::Serialize, PartialEq)]
pub struct Entry {
  pub name: String,
  pub path: String,
  pub is_dir: bool,
  pub size: u64,
  pub mtime_ms: Option<i64>,
}

/// Does `name` belong to `stem` with extension `ext`? `stem + ext` or
/// `stem + "." + anything + ext` (so `video.roll.funscript` matches stem `video`,
/// ext `.funscript`). Case-insensitive, Unicode-aware.
pub fn matches_stem(name: &str, stem: Option<&str>, ext: Option<&str>) -> bool {
  let n = name.to_lowercase();
  let ext = ext.map(|e| e.to_lowercase());
  if let Some(e) = &ext {
    if !n.ends_with(e.as_str()) || n.len() == e.len() {
      return false;
    }
  }
  match stem.map(|s| s.to_lowercase()) {
    None => true,
    Some(s) => {
      let body = &n[..n.len() - ext.as_ref().map_or(0, |e| e.len())];
      body == s || body.starts_with(&format!("{s}."))
    }
  }
}

/// Lists a folder (not recursive), optionally only names matching stem/ext;
/// sorted by name. Entries whose names are not valid UTF-8 are skipped.
pub fn list_dir(dir: &Path, stem: Option<&str>, ext: Option<&str>) -> Result<Vec<Entry>> {
  let mut out = Vec::new();
  for e in fs::read_dir(dir).at(dir)? {
    let e = e.at(dir)?;
    let Ok(name) = e.file_name().into_string() else { continue };
    if !matches_stem(&name, stem, ext) {
      continue;
    }
    let Ok(m) = e.metadata() else { continue };
    out.push(Entry { path: path_str(&e.path()), name, is_dir: m.is_dir(), size: m.len(), mtime_ms: mtime_ms(&m) });
  }
  out.sort_by(|a, b| a.name.cmp(&b.name));
  Ok(out)
}

/// Lists a folder in batches: `emit` gets up to 250 entries (files only, name ending in one of `exts`, lower-case with the
/// dot; empty = all) at a time, at least every 150 ms, so a slow share shows its first names at once. Unsorted (the
/// share's own order). -> the count.
pub fn list_dir_each(dir: &Path, exts: &[String], emit: &mut dyn FnMut(Vec<Entry>)) -> Result<usize> {
  let (mut batch, mut total, mut last) = (Vec::new(), 0, std::time::Instant::now());
  for e in fs::read_dir(dir).at(dir)? {
    let e = e.at(dir)?;
    let Ok(name) = e.file_name().into_string() else { continue };
    if !exts.is_empty() {
      let l = name.to_lowercase();
      if !exts.iter().any(|x| l.ends_with(x.as_str())) {
        continue;
      }
    }
    let Ok(m) = e.metadata() else { continue };
    if m.is_dir() {
      continue;
    }
    batch.push(Entry { path: path_str(&e.path()), name, is_dir: false, size: m.len(), mtime_ms: mtime_ms(&m) });
    total += 1;
    if batch.len() >= 250 || last.elapsed() >= Duration::from_millis(150) {
      emit(std::mem::take(&mut batch));
      last = std::time::Instant::now();
    }
  }
  if !batch.is_empty() {
    emit(batch);
  }
  Ok(total)
}

/// Creates a folder and its parents (the app's own state folders: the seeder's image labels). An existing folder is fine.
pub fn make_dir(path: &Path) -> Result<()> {
  fs::create_dir_all(path).at(path)
}

/// Deletes one file. Folders are refused: nothing in the editor needs a
/// recursive delete of a user path.
pub fn remove_file(path: &Path) -> Result<()> {
  let m = fs::symlink_metadata(path).at(path)?;
  if m.is_dir() {
    return Err(Error::invalid(format!("{}: is a folder; only files can be removed", path.display())));
  }
  fs::remove_file(path).at(path)
}

/// paw-zkvc: removes one file so it can be got back. On a local fixed drive it goes to the Recycle Bin (Windows); anywhere
/// else (a network or removable drive has no Recycle Bin, and Windows would delete it for good) it is moved into
/// `aside` as `<ms>-<name>`. -> "recycle-bin" | the path it was moved to.
pub fn remove_recoverably(path: &Path, aside: &Path) -> Result<String> {
  let m = fs::symlink_metadata(path).at(path)?;
  if !m.is_file() {
    return Err(Error::invalid(format!("{}: only a file can be removed", path.display())));
  }
  #[cfg(windows)]
  if recycle(path)? {
    return Ok("recycle-bin".into());
  }
  fs::create_dir_all(aside).at(aside)?;
  let ms = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis());
  let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
  let dest = aside.join(format!("{ms}-{name}"));
  if fs::rename(path, &dest).is_err() {
    // another volume: copy, then remove the original only once the copy is whole
    fs::copy(path, &dest).at(&dest)?;
    if fs::metadata(&dest).at(&dest)?.len() != m.len() {
      let _ = fs::remove_file(&dest);
      return Err(Error::new("io", format!("{}: the copy aside came out short; nothing was removed", path.display())));
    }
    fs::remove_file(path).at(path)?;
  }
  Ok(path_str(&dest))
}

/// To the Recycle Bin when `path` is on a fixed local drive. -> false when there is no Recycle Bin to use.
#[cfg(windows)]
fn recycle(path: &Path) -> Result<bool> {
  use std::os::windows::ffi::OsStrExt;
  use windows_sys::Win32::Storage::FileSystem::GetDriveTypeW;
  use windows_sys::Win32::UI::Shell::{SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FO_DELETE, SHFILEOPSTRUCTW};
  let abs = std::path::absolute(path).at(path)?;
  let wide = |p: &Path| p.as_os_str().encode_wide().chain([0, 0]).collect::<Vec<u16>>();
  let root = abs.ancestors().last().unwrap_or(&abs).to_path_buf();
  const DRIVE_FIXED: u32 = 3;
  // SAFETY: a NUL-terminated wide string that outlives the call
  if unsafe { GetDriveTypeW(wide(&root).as_ptr()) } != DRIVE_FIXED {
    return Ok(false);
  }
  let from = wide(&abs); // double NUL-terminated: a list of one
  // SAFETY: an all-zero SHFILEOPSTRUCTW is valid (no window, no title, no mappings); pFrom lives through the call
  let mut op: SHFILEOPSTRUCTW = unsafe { std::mem::zeroed() };
  op.wFunc = FO_DELETE;
  op.pFrom = from.as_ptr();
  op.fFlags = (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT) as _;
  let r = unsafe { SHFileOperationW(&mut op) };
  if r != 0 || op.fAnyOperationsAborted != 0 || abs.exists() {
    return Err(Error::new("io", format!("{}: could not be moved to the Recycle Bin (code {r}), nothing was removed", path.display())));
  }
  Ok(true)
}

/// Extensions `open_default` refuses: opening them would run code.
const EXECUTABLE: &[&str] = &[
  "exe", "com", "bat", "cmd", "msi", "msp", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "scr", "pif", "cpl", "lnk", "url", "reg", "hta",
  "jar", "sh", "bash", "zsh", "command", "app", "appimage", "run", "py", "pyw", "pl", "rb", "desktop", "scf", "msc", "dll", "sys", "inf",
];

pub fn is_executable(path: &Path) -> bool {
  path.extension().and_then(|e| e.to_str()).is_some_and(|e| EXECUTABLE.contains(&e.to_lowercase().as_str()))
}

// ---------------------------------------------------------------- atomic write

#[derive(Debug, serde::Serialize, PartialEq)]
pub struct Written {
  pub path: String,
  pub sha256: String,
  pub size: u64,
  pub mtime_ms: Option<i64>,
}

/// Writes through a symlink to its target (renaming over a link would replace the link).
pub(crate) fn resolve_target(path: &Path) -> PathBuf {
  match fs::symlink_metadata(path) {
    Ok(m) if m.file_type().is_symlink() => fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf()),
    _ => path.to_path_buf(),
  }
}

/// A temp file in `path`'s folder, plus the folder and the target as
/// canonical paths: on Windows those are `\?\` verbatim paths, which the
/// rename (MoveFileExW inside tempfile) needs for paths over 260 characters.
pub(crate) fn temp_beside(path: &Path) -> Result<(tempfile::NamedTempFile, PathBuf, PathBuf)> {
  let name = path.file_name().ok_or_else(|| Error::invalid(format!("{}: no file name", path.display())))?;
  let dir = match path.parent() {
    Some(d) if !d.as_os_str().is_empty() => d.to_path_buf(),
    _ => PathBuf::from("."),
  };
  let dir = match fs::canonicalize(&dir) {
    Ok(d) if d.is_dir() => d,
    _ => return Err(Error::new("not_found", format!("{}: folder does not exist", dir.display()))),
  };
  let tmp = tempfile::Builder::new()
    .prefix(&format!(".{}.", name.to_string_lossy()))
    .suffix(".tmp")
    .tempfile_in(&dir)
    .at(&dir)?;
  let target = dir.join(name);
  Ok((tmp, dir, target))
}

#[cfg(unix)]
fn sync_dir(dir: &Path) {
  // Makes the rename itself durable. Best effort: some file systems refuse.
  if let Ok(d) = File::open(dir) {
    let _ = d.sync_all();
  }
}
#[cfg(not(unix))]
fn sync_dir(_: &Path) {}

/// Windows: antivirus and indexers open new files for a moment, which makes the
/// replace fail with access denied / sharing violation. Retry briefly.
fn transient(e: &io::Error) -> bool {
  cfg!(windows) && (e.kind() == io::ErrorKind::PermissionDenied || matches!(e.raw_os_error(), Some(5 | 32 | 33)))
}

/// The core: `fill` writes the content into the temp file; any error from it, the
/// fsync or the rename leaves the target untouched and removes the temp file.
pub fn write_atomic_with(path: &Path, fill: impl FnOnce(&mut File) -> io::Result<()>) -> Result<()> {
  let path = resolve_target(path);
  if path.is_dir() {
    return Err(Error::invalid(format!("{}: is a folder", path.display())));
  }
  let (mut tmp, dir, target) = temp_beside(&path)?;
  fill(tmp.as_file_mut()).at(&path)?;
  persist(tmp, &dir, &target, &path)
}

/// fsync a filled temp file and rename it onto `target` (retried on Windows' transient refusals); an error removes it.
pub(crate) fn persist(mut tmp: tempfile::NamedTempFile, dir: &Path, target: &Path, path: &Path) -> Result<()> {
  tmp.as_file().sync_all().at(path)?;
  #[cfg(unix)]
  {
    // tempfile creates 0600; keep the target's mode, or the usual 0644 for a new file.
    use std::os::unix::fs::PermissionsExt;
    let mode = fs::metadata(path).map(|m| m.permissions().mode()).unwrap_or(0o644);
    let _ = tmp.as_file().set_permissions(fs::Permissions::from_mode(mode));
  }
  let mut attempt = 0;
  loop {
    match tmp.persist(target) {
      Ok(_) => break,
      Err(e) if attempt < 10 && transient(&e.error) => {
        attempt += 1;
        tmp = e.file;
        std::thread::sleep(Duration::from_millis(30 * attempt));
      }
      Err(e) => return Err(Error::io(e.error, path)), // e.file drops: temp removed
    }
  }
  sync_dir(dir);
  Ok(())
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<Written> {
  write_atomic_with(path, |f| f.write_all(bytes))?;
  let meta = fs::metadata(path).ok();
  Ok(Written { path: path_str(path), sha256: sha256_hex(bytes), size: bytes.len() as u64, mtime_ms: meta.as_ref().and_then(mtime_ms) })
}

/// Creates `path` with `bytes` only if nothing exists there (atomic: no window
/// where a half-written file is visible, and never replaces an existing file).
pub fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
  let (mut tmp, dir, target) = temp_beside(path)?;
  tmp.write_all(bytes).at(path)?;
  tmp.as_file().sync_all().at(path)?;
  tmp.persist_noclobber(&target).map_err(|e| Error::io(e.error, path))?;
  sync_dir(&dir);
  Ok(())
}

// ---------------------------------------------------------------- backups

/// path key -> sha256 of the content the app last wrote there. Lives in
/// `<app local data>/written.json`; bounded to the most recent entries.
#[derive(Default, serde::Serialize, serde::Deserialize)]
struct WrittenLog {
  files: HashMap<String, (String, i64)>,
}
const LOG_CAP: usize = 2000;

/// Serialises read-modify-write of the log and backup creation across commands.
static BACKUP_LOCK: Mutex<()> = Mutex::new(());

impl WrittenLog {
  fn load(p: &Path) -> Self {
    fs::read(p).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
  }
  fn save(mut self, p: &Path) -> Result<()> {
    if self.files.len() > LOG_CAP {
      let mut v: Vec<_> = self.files.into_iter().collect();
      v.sort_by_key(|(_, (_, at))| std::cmp::Reverse(*at));
      v.truncate(LOG_CAP);
      self.files = v.into_iter().collect();
    }
    if let Some(d) = p.parent() {
      fs::create_dir_all(d).at(d)?;
    }
    write_atomic(p, &serde_json::to_vec(&self).unwrap_or_default()).map(|_| ())
  }
}

/// Where the app keeps its state for backups: the log file and the rolling folder.
pub struct BackupPlaces {
  pub log: PathBuf,
  pub root: PathBuf,
}

#[derive(Debug, serde::Serialize, PartialEq)]
pub struct SaveResult {
  #[serde(flatten)]
  pub written: Written,
  /// Set when the content on disk was not written by the app and was copied
  /// aside before the overwrite (`name.bak`, or `name.2.bak`... when an older
  /// `.bak` with different content already exists).
  pub first_backup: Option<String>,
  /// Set when the app's own previous version went to the rolling backups.
  pub rolling_backup: Option<String>,
  /// The file already held exactly this content: nothing was written.
  pub unchanged: bool,
}

/// `video.funscript` -> `video.funscript.bak`, then `video.funscript.2.bak`, ...
pub fn bak_name(name: &str, n: u32) -> String {
  if n <= 1 {
    format!("{name}.bak")
  } else {
    format!("{name}.{n}.bak")
  }
}

/// Copies `current` (the bytes now at `path`) to the first free `.bak` name, or
/// returns the existing `.bak` that already holds exactly those bytes.
fn first_backup(path: &Path, current: &[u8]) -> Result<PathBuf> {
  let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
  let dir = path.parent().unwrap_or(Path::new("."));
  for n in 1..=999 {
    let cand = dir.join(bak_name(&name, n));
    match fs::read(&cand) {
      Ok(old) if old == current => return Ok(cand),
      Ok(_) => continue,
      Err(e) if e.kind() == io::ErrorKind::NotFound => match write_new(&cand, current) {
        Ok(()) => return Ok(cand),
        Err(e) if e.code == "exists" => continue, // raced with another writer
        Err(e) => return Err(e),
      },
      Err(e) => return Err(Error::io(e, &cand)),
    }
  }
  Err(Error::new("io", format!("{}: too many .bak files", path.display())))
}

/// The rolling folder for one target: `<root>/<16 hex of path key>/`.
pub fn rolling_dir(root: &Path, path: &Path) -> PathBuf {
  root.join(&sha256_hex(path_key(path).as_bytes())[..16])
}

/// Saves `current` as `<ms>-<name>` in the target's rolling folder and keeps the newest `keep`.
fn rolling_backup(root: &Path, path: &Path, current: &[u8], keep: usize) -> Result<PathBuf> {
  let dir = rolling_dir(root, path);
  fs::create_dir_all(&dir).at(&dir)?;
  let origin = dir.join("source.txt");
  if !origin.exists() {
    write_atomic(&origin, path_str(path).as_bytes())?;
  }
  let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
  let mut ms = now_ms();
  let mut file = dir.join(format!("{ms:013}-{name}"));
  while file.exists() {
    ms += 1;
    file = dir.join(format!("{ms:013}-{name}"));
  }
  write_atomic(&file, current)?;
  prune(&dir, keep.max(1))?;
  Ok(file)
}

fn snapshots(dir: &Path) -> Result<Vec<PathBuf>> {
  let mut v: Vec<PathBuf> = fs::read_dir(dir)
    .at(dir)?
    .filter_map(|e| e.ok().map(|e| e.path()))
    .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.len() > 14 && n.as_bytes()[..13].iter().all(u8::is_ascii_digit)))
    .collect();
  v.sort();
  Ok(v)
}

/// Deletes the oldest timestamp-named files in `dir` beyond `keep`.
pub fn prune(dir: &Path, keep: usize) -> Result<()> {
  let v = snapshots(dir)?;
  for old in v.iter().take(v.len().saturating_sub(keep)) {
    fs::remove_file(old).at(old)?;
  }
  Ok(())
}

pub fn write_with_backup(places: &BackupPlaces, path: &Path, bytes: &[u8], keep: usize, expected_sha256: Option<&str>) -> Result<SaveResult> {
  let _guard = BACKUP_LOCK.lock().unwrap_or_else(|e| e.into_inner());
  let target = resolve_target(path);
  let current = match fs::read(&target) {
    Ok(b) => Some(b),
    Err(e) if e.kind() == io::ErrorKind::NotFound => None,
    Err(e) => return Err(Error::io(e, &target)),
  };
  let new_sha = sha256_hex(bytes);
  let mut log = WrittenLog::load(&places.log);
  let key = path_key(&target);
  let (mut first, mut rolling) = (None, None);
  if let Some(cur) = &current {
    let cur_sha = sha256_hex(cur);
    if let Some(exp) = expected_sha256 {
      if !exp.eq_ignore_ascii_case(&cur_sha) {
        return Err(Error::new("conflict", format!("{}: changed on disk since it was opened", target.display())));
      }
    }
    if cur_sha == new_sha {
      log.files.insert(key, (new_sha.clone(), now_ms()));
      let _ = log.save(&places.log);
      let meta = fs::metadata(&target).ok();
      let written = Written { path: path_str(path), sha256: new_sha, size: bytes.len() as u64, mtime_ms: meta.as_ref().and_then(mtime_ms) };
      return Ok(SaveResult { written, first_backup: None, rolling_backup: None, unchanged: true });
    }
    let ours = log.files.get(&key).is_some_and(|(sha, _)| *sha == cur_sha);
    if ours {
      rolling = Some(path_str(&rolling_backup(&places.root, &target, cur, keep)?));
    } else {
      first = Some(path_str(&first_backup(&target, cur)?));
    }
  }
  let mut written = write_atomic(&target, bytes)?;
  written.path = path_str(path);
  log.files.insert(key, (new_sha, now_ms()));
  // A lost log entry only means one extra .bak next time: safe direction, so not fatal.
  let _ = log.save(&places.log);
  Ok(SaveResult { written, first_backup: first, rolling_backup: rolling, unchanged: false })
}

/// paw-goia: files the app itself just created by other means (a pack's unpack) count as its own writes, so the first
/// write_with_backup over one rolls instead of leaving a `.bak` beside it. `files`: (path, sha256 of what was written).
pub fn note_written(log: &Path, files: &[(PathBuf, String)]) -> Result<()> {
  let _guard = BACKUP_LOCK.lock().unwrap_or_else(|e| e.into_inner());
  let mut l = WrittenLog::load(log);
  for (p, sha) in files {
    l.files.insert(path_key(&resolve_target(p)), (sha.to_ascii_lowercase(), now_ms()));
  }
  l.save(log)
}

#[derive(Debug, serde::Serialize)]
pub struct Backup {
  pub path: String,
  /// "rolling" (app's own earlier versions) or "first" (`.bak` beside the file).
  pub kind: &'static str,
  pub saved_ms: Option<i64>,
  pub size: u64,
}

/// Every backup of `path`, newest first: rolling ones, then `.bak` siblings.
pub fn list_backups(root: &Path, path: &Path) -> Result<Vec<Backup>> {
  let mut out = Vec::new();
  let dir = rolling_dir(root, path);
  if dir.is_dir() {
    for p in snapshots(&dir)?.into_iter().rev() {
      let ms = p.file_name().and_then(|n| n.to_str()).and_then(|n| n[..13].parse().ok());
      let size = fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
      out.push(Backup { path: path_str(&p), kind: "rolling", saved_ms: ms, size });
    }
  }
  if let (Some(dir), Some(name)) = (path.parent(), path.file_name().and_then(|n| n.to_str())) {
    let dir = if dir.as_os_str().is_empty() { Path::new(".") } else { dir };
    if let Ok(entries) = list_dir(dir, Some(name), Some(".bak")) {
      for e in entries.into_iter().filter(|e| !e.is_dir) {
        out.push(Backup { path: e.path, kind: "first", saved_ms: e.mtime_ms, size: e.size });
      }
    }
  }
  Ok(out)
}

#[cfg(test)]
mod tests {
  use super::*;

  /// paw-zkvc: where there is no Recycle Bin (here: the same folder reached as a network path) the file is moved aside
  /// whole, never deleted; a folder is refused. (The Recycle Bin branch is exercised end to end, not here: it would
  /// litter the machine's bin on every run.)
  #[test]
  fn removed_recoverably_aside() {
    let t = tempfile::tempdir().unwrap();
    let f = t.path().join("p.pawruns");
    fs::write(&f, b"PAWRUNS1 runs").unwrap();
    #[allow(unused_mut, unused_assignments)]
    let mut target = f.clone();
    #[cfg(windows)]
    {
      let s = path_str(&f);
      match s.strip_prefix(r"C:\").or_else(|| s.strip_prefix(r"c:\")).map(|r| PathBuf::from(format!(r"\\localhost\C$\{r}"))) {
        Some(unc) if unc.is_file() => target = unc,
        _ => return, // no admin share here: only the Recycle Bin branch would run
      }
    }
    let aside = t.path().join("aside");
    let got = remove_recoverably(&target, &aside).unwrap();
    assert!(!f.exists());
    assert!(got.ends_with("-p.pawruns"), "{got}");
    assert_eq!(fs::read(&got).unwrap(), b"PAWRUNS1 runs");
    assert_eq!(remove_recoverably(&aside, &aside).unwrap_err().code, "invalid_input");
  }

  #[test]
  fn path_key_is_the_same_before_and_after_the_file_exists() {
    let t = tempfile::tempdir().unwrap();
    let mut dirs = vec![t.path().to_path_buf()];
    // a UNC path (what a mapped network drive like W: canonicalizes to), when the admin share is reachable
    #[cfg(windows)]
    {
      let s = path_str(t.path());
      if let Some(rest) = s.strip_prefix(r"C:\").or_else(|| s.strip_prefix(r"c:\")) {
        let unc = PathBuf::from(format!(r"\\localhost\C$\{rest}"));
        if unc.is_dir() {
          dirs.push(unc);
        }
      }
    }
    for (i, d) in dirs.iter().enumerate() {
      let p = d.join(format!("new{i}.pawproj"));
      let before = path_key(&p);
      fs::write(&p, b"x").unwrap();
      assert_eq!(before, path_key(&p), "{}", p.display());
    }
  }

  #[test]
  fn read_only_roots_come_from_the_setting_or_the_variable_never_a_built_in_folder() {
    let co = Path::new("co");
    let set = serde_json::json!({"files.readOnlyRoots": ["X:\\Lib"]});
    assert_eq!(read_only_roots_from(Some(&set), Some("Y:\\A"), co), vec![PathBuf::from("X:\\Lib"), co.join("Reference")]); // the setting wins
    // an empty setting clears the others, never the checkout's Reference folder
    assert_eq!(read_only_roots_from(Some(&serde_json::json!({"files.readOnlyRoots": []})), None, co), vec![co.join("Reference")]);
    assert_eq!(read_only_roots_from(Some(&serde_json::json!({"other": 1})), Some(" Y:\\A ; ;Z:\\B"), co),
      vec![PathBuf::from("Y:\\A"), PathBuf::from("Z:\\B"), co.join("Reference")]);
    assert_eq!(read_only_roots_from(None, None, co), vec![co.join("Reference")]); // unset: nothing of anyone's
    assert_eq!(read_only_roots_from(None, Some(""), co), vec![co.join("Reference")]);
  }
  #[test]
  fn read_only_roots_refuse_writes_inside_only() {
    let t = tempfile::tempdir().unwrap();
    let root = t.path().join("Videos");
    fs::create_dir_all(root.join("sub")).unwrap();
    fs::create_dir_all(t.path().join("Videos2")).unwrap();
    let roots = [root.clone()];
    assert_eq!(check_writable(&root.join("sub").join("b.png"), &roots).unwrap_err().code, "protected");
    assert_eq!(check_writable(&root.join("a.mp4"), &roots).unwrap_err().code, "protected");
    // the project and its companions live next to the video too (owner, paw-xeb)
    for f in ["a.pawproj", "A.PAWPROJ", "a.pawruns", "a.pawruns.1700000000000.bak", "a.funscript.bak"] {
      assert!(check_writable(&root.join(f), &roots).is_ok(), "{f}");
    }
    assert!(check_writable(&root.join("a.funscript"), &roots).is_ok()); // the export next to a protected video is the point
    assert!(check_writable(&root.join("sub").join("B.FUNSCRIPT"), &roots).is_ok());
    assert!(check_writable(&t.path().join("Videos2").join("a.funscript"), &roots).is_ok());
    assert!(check_writable(&t.path().join("a.funscript"), &roots).is_ok());
  }

  fn places(t: &Path) -> BackupPlaces {
    BackupPlaces { log: t.join("state/written.json"), root: t.join("state/backups") }
  }
  fn names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
    v.sort();
    v
  }

  #[test]
  fn atomic_write_replaces_and_leaves_no_temp() {
    let t = tempfile::tempdir().unwrap();
    let p = t.path().join("a.funscript");
    write_atomic(&p, b"one").unwrap();
    let w = write_atomic(&p, b"two").unwrap();
    assert_eq!(fs::read(&p).unwrap(), b"two");
    assert_eq!(w.sha256, sha256_hex(b"two"));
    assert_eq!(names(t.path()), vec!["a.funscript"]);
  }

  #[test]
  fn failed_fill_keeps_old_content_and_cleans_temp() {
    let t = tempfile::tempdir().unwrap();
    let p = t.path().join("a.funscript");
    fs::write(&p, b"original").unwrap();
    let r = write_atomic_with(&p, |f| {
      f.write_all(b"half")?;
      Err(io::Error::other("disk full (simulated)"))
    });
    assert!(r.is_err());
    assert_eq!(fs::read(&p).unwrap(), b"original");
    assert_eq!(names(t.path()), vec!["a.funscript"]);
  }

  #[test]
  fn failed_rename_cleans_temp() {
    let t = tempfile::tempdir().unwrap();
    let p = t.path().join("dir");
    fs::create_dir(&p).unwrap();
    assert_eq!(write_atomic(&p, b"x").unwrap_err().code, "invalid_input");
    assert_eq!(write_atomic(&t.path().join("missing/a.txt"), b"x").unwrap_err().code, "not_found");
    assert_eq!(names(t.path()), vec!["dir"]);
  }

  #[test]
  fn make_dir_makes_parents_and_is_idempotent() {
    let t = tempfile::tempdir().unwrap();
    let p = t.path().join("seeder").join("labels");
    make_dir(&p).unwrap();
    make_dir(&p).unwrap();
    assert!(p.is_dir());
    write_atomic(&p.join("k.json"), b"{}").unwrap();
    assert_eq!(names(&p), vec!["k.json"]);
    assert!(make_dir(&p.join("k.json")).is_err()); // a file in the way
  }

  #[test]
  fn write_new_never_clobbers() {
    let t = tempfile::tempdir().unwrap();
    let p = t.path().join("x.bak");
    write_new(&p, b"1").unwrap();
    assert_eq!(write_new(&p, b"2").unwrap_err().code, "exists");
    assert_eq!(fs::read(&p).unwrap(), b"1");
    assert_eq!(names(t.path()), vec!["x.bak"]);
  }

  #[test]
  fn foreign_file_gets_bak_then_ours_rolls() {
    let t = tempfile::tempdir().unwrap();
    let pl = places(t.path());
    let p = t.path().join("video.funscript");
    fs::write(&p, b"theirs").unwrap();

    let r = write_with_backup(&pl, &p, b"v1", 3, None).unwrap();
    let bak = t.path().join("video.funscript.bak");
    assert_eq!(r.first_backup.as_deref(), Some(path_str(&bak).as_str()));
    assert_eq!(fs::read(&bak).unwrap(), b"theirs");
    assert!(r.rolling_backup.is_none());

    // Our own content now: further saves roll, the .bak is untouched.
    for v in [b"v2", b"v3", b"v4", b"v5"] {
      let r = write_with_backup(&pl, &p, v, 3, None).unwrap();
      assert!(r.first_backup.is_none());
      assert!(r.rolling_backup.is_some());
    }
    assert_eq!(fs::read(&p).unwrap(), b"v5");
    assert_eq!(fs::read(&bak).unwrap(), b"theirs");
    let list = list_backups(&pl.root, &p).unwrap();
    let rolling: Vec<_> = list.iter().filter(|b| b.kind == "rolling").map(|b| fs::read(&b.path).unwrap()).collect();
    assert_eq!(rolling, vec![b"v4".to_vec(), b"v3".to_vec(), b"v2".to_vec()]); // newest first, keep 3
    assert_eq!(list.iter().filter(|b| b.kind == "first").count(), 1);
  }

  #[test]
  fn outside_edit_after_our_save_gets_a_new_bak_not_an_overwrite() {
    let t = tempfile::tempdir().unwrap();
    let pl = places(t.path());
    let p = t.path().join("v.funscript");
    fs::write(&p, b"theirs-1").unwrap();
    write_with_backup(&pl, &p, b"ours-1", 10, None).unwrap();
    fs::write(&p, b"theirs-2").unwrap(); // another tool edits it
    let r = write_with_backup(&pl, &p, b"ours-2", 10, None).unwrap();
    assert_eq!(r.first_backup.as_deref(), Some(path_str(&t.path().join("v.funscript.2.bak")).as_str()));
    assert_eq!(fs::read(t.path().join("v.funscript.bak")).unwrap(), b"theirs-1");
    assert_eq!(fs::read(t.path().join("v.funscript.2.bak")).unwrap(), b"theirs-2");
  }

  #[test]
  fn existing_identical_bak_is_reused() {
    let t = tempfile::tempdir().unwrap();
    let pl = places(t.path());
    let p = t.path().join("v.funscript");
    fs::write(&p, b"theirs").unwrap();
    fs::write(t.path().join("v.funscript.bak"), b"theirs").unwrap();
    let r = write_with_backup(&pl, &p, b"ours", 10, None).unwrap();
    assert!(r.first_backup.unwrap().ends_with("v.funscript.bak"));
    assert!(!t.path().join("v.funscript.2.bak").exists());
  }

  #[test]
  fn conflict_and_unchanged() {
    let t = tempfile::tempdir().unwrap();
    let pl = places(t.path());
    let p = t.path().join("v.funscript");
    fs::write(&p, b"disk").unwrap();
    let e = write_with_backup(&pl, &p, b"new", 10, Some(&sha256_hex(b"what I loaded"))).unwrap_err();
    assert_eq!(e.code, "conflict");
    assert_eq!(fs::read(&p).unwrap(), b"disk");
    let r = write_with_backup(&pl, &p, b"new", 10, Some(&sha256_hex(b"disk"))).unwrap();
    assert!(r.first_backup.is_some());
    let r = write_with_backup(&pl, &p, b"new", 10, None).unwrap();
    assert!(r.unchanged);
  }

  /// paw-goia: a file the app noted as its own (an unpacked pack) rolls on its first write, no `.bak`; once it is changed
  /// outside, the next write keeps a `.bak` again.
  #[test]
  fn noted_file_rolls_and_an_outside_change_still_gets_a_bak() {
    let t = tempfile::tempdir().unwrap();
    let pl = places(t.path());
    let p = t.path().join("clip.pawproj");
    fs::write(&p, b"unpacked").unwrap();
    note_written(&pl.log, &[(p.clone(), sha256_hex(b"unpacked").to_uppercase())]).unwrap();
    let r = write_with_backup(&pl, &p, b"ours-1", 10, Some(&sha256_hex(b"unpacked"))).unwrap();
    assert!(r.first_backup.is_none() && r.rolling_backup.is_some(), "{r:?}");
    assert_eq!(names(t.path()), vec!["clip.pawproj", "state"]);
    fs::write(&p, b"theirs").unwrap();
    let r = write_with_backup(&pl, &p, b"ours-2", 10, None).unwrap();
    assert!(r.first_backup.unwrap().ends_with("clip.pawproj.bak"));
  }

  #[test]
  fn new_file_needs_no_backup() {
    let t = tempfile::tempdir().unwrap();
    let pl = places(t.path());
    let p = t.path().join("fresh.funscript");
    let r = write_with_backup(&pl, &p, b"x", 10, None).unwrap();
    assert!(r.first_backup.is_none() && r.rolling_backup.is_none() && !r.unchanged);
  }

  #[test]
  fn stem_matching() {
    let m = |n, s, e| matches_stem(n, s, e);
    assert!(m("video.funscript", Some("video"), Some(".funscript")));
    assert!(m("Video.ROLL.funscript", Some("video"), Some(".funscript")));
    assert!(!m("video2.funscript", Some("video"), Some(".funscript")));
    assert!(!m("video.mp4", Some("video"), Some(".funscript")));
    assert!(m("My.Clip.twist.funscript", Some("My.Clip"), Some(".funscript")));
    assert!(m("ÉTÉ 夏.pitch.funscript", Some("été 夏"), Some(".funscript")));
    assert!(m("video.mp4", Some("video"), None));
    assert!(!m(".funscript", None, Some(".funscript")));
    assert!(m("anything.funscript", None, Some(".funscript")));
  }

  #[test]
  fn list_dir_each_batches_and_filters() {
    let t = tempfile::tempdir().unwrap();
    for i in 0..600 {
      fs::write(t.path().join(format!("p{i}.JPG")), b"x").unwrap();
    }
    fs::write(t.path().join("n.txt"), b"x").unwrap();
    fs::create_dir(t.path().join("d.jpg")).unwrap();
    let mut sizes = Vec::new();
    let n = list_dir_each(t.path(), &[".jpg".to_string()], &mut |b| sizes.push(b.len())).unwrap();
    assert_eq!(n, 600);
    assert!(sizes.len() >= 3 && sizes.iter().all(|s| *s <= 250), "{sizes:?}");
  }

  #[test]
  fn list_dir_finds_unicode_siblings() {
    let t = tempfile::tempdir().unwrap();
    for n in ["夏 clip.mp4", "夏 clip.funscript", "夏 clip.roll.funscript", "夏 clip2.funscript", "other.funscript"] {
      fs::write(t.path().join(n), b"").unwrap();
    }
    let got: Vec<_> = list_dir(t.path(), Some("夏 clip"), Some(".funscript")).unwrap().into_iter().map(|e| e.name).collect();
    assert_eq!(got, vec!["夏 clip.funscript", "夏 clip.roll.funscript"]);
  }

  #[test]
  fn long_paths_work() {
    let t = tempfile::tempdir().unwrap();
    let mut dir = t.path().to_path_buf();
    for i in 0..6 {
      dir = dir.join(format!("{i}-{}", "長い名前".repeat(12)));
    }
    fs::create_dir_all(&dir).unwrap();
    let p = dir.join("video.funscript");
    assert!(path_str(&p).len() > 300);
    let pl = places(t.path());
    write_with_backup(&pl, &p, b"a", 10, None).unwrap();
    write_with_backup(&pl, &p, b"b", 10, None).unwrap();
    assert_eq!(read_text(&p).unwrap().text, "b");
    assert_eq!(list_dir(&dir, Some("video"), Some(".funscript")).unwrap().len(), 1);
    assert_eq!(list_backups(&pl.root, &p).unwrap().len(), 1);
  }

  #[test]
  fn read_text_strips_bom_and_rejects_binary() {
    let t = tempfile::tempdir().unwrap();
    let p = t.path().join("a.json");
    fs::write(&p, b"\xEF\xBB\xBF{}").unwrap();
    let r = read_text(&p).unwrap();
    assert_eq!(r.text, "{}");
    assert_eq!(r.sha256, sha256_hex(b"\xEF\xBB\xBF{}"));
    fs::write(&p, [0xff, 0xfe, 0x00]).unwrap();
    assert_eq!(read_text(&p).unwrap_err().code, "not_utf8");
    assert_eq!(read_text(&t.path().join("nope")).unwrap_err().code, "not_found");
  }

  #[test]
  fn bytes_read_back_and_pawruns_follow_the_project() {
    let t = tempfile::tempdir().unwrap();
    let p = t.path().join("a.pawruns");
    let bytes: Vec<u8> = (0..=255u8).cycle().take(70_000).collect();
    write_atomic(&p, &bytes).unwrap();
    assert_eq!(read_bytes(&p).unwrap(), bytes);
    assert_eq!(read_bytes(t.path()).unwrap_err().code, "invalid_input");
    assert_eq!(read_bytes(&t.path().join("nope")).unwrap_err().code, "not_found");
    // a runs file goes where its project goes: beside the video, read-only root or not
    let root = t.path().join("Videos");
    assert!(check_writable(&root.join("a.pawruns"), &[root.clone()]).is_ok());
    assert!(check_writable(&p, &[root]).is_ok());
  }

  #[test]
  fn percent_decode_round_trips_encode_uri_component() {
    assert_eq!(percent_decode("C%3A%5CV%C3%ADdeos%5Cclip%20(1).pawruns").as_deref(), Some(r"C:\Vídeos\clip (1).pawruns"));
    assert_eq!(percent_decode("plain").as_deref(), Some("plain"));
    assert_eq!(percent_decode("bad%zz"), None);
    assert_eq!(percent_decode("cut%4"), None);
    assert_eq!(percent_decode("%ff"), None); // not UTF-8
  }

  #[test]
  fn remove_refuses_folders_and_executables_are_flagged() {
    let t = tempfile::tempdir().unwrap();
    assert_eq!(remove_file(t.path()).unwrap_err().code, "invalid_input");
    assert!(is_executable(Path::new("x.EXE")) && is_executable(Path::new("a.lnk")));
    assert!(!is_executable(Path::new("x.mp4")) && !is_executable(Path::new("folder")));
  }
}
