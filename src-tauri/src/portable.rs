//! The shared build's one-time setup (paw-i7s). The folder friends copy holds Pawscript.exe, runtime.zip (python\,
//! ffmpeg.exe, ffprobe.exe) and code.zip (trackers\pawtrack, ...), each with `<name>.stamp` at its root, plus the
//! model files already at trackers\.cache / trackers\.models. On start the exe unpacks every zip whose stamp differs
//! from the one recorded in `.setup\<name>.stamp` into its own folder, which gives the layout sidecar::root() and
//! ffmpeg.rs expect; the sidecar waits for it (wait_ready).
//!
//! A zip is unpacked IN PLACE (paw-5g5t): its recorded stamp is removed first, the items it holds are removed from the
//! folder (inside `trackers\` child by child, so the models stay), tar.exe writes the files straight to where they
//! belong, and the stamp is written last. Nothing large is renamed: renaming a freshly written 26,000-file directory
//! fails with "Access is denied" whenever a sync client or an antivirus still holds one of its files (a friend's
//! OneDrive Desktop). An interrupted or failed unpack leaves no stamp and is redone from clean targets on the next
//! start. Deleting and unpacking retry for up to a minute and a half on access-denied / sharing violations.
//!
//! Nothing is unpacked inside a cloud-synced folder (OneDrive, Dropbox, Google Drive, iCloud: it would upload ~15 GB and
//! lock files while the app runs), on a network drive, or into a folder it cannot write: Refused, saying what to do. No
//! zip beside the exe (a dev build, the owner's own app): Ready at once, nothing touched.
//!
//! paw-mkcd: only what a Pawscript unpack made is ever removed. Before removing anything, an unpack records the items it
//! owns in `.setup\<name>.owns`; an item already there that no `.owns` lists (and no earlier unpack's stamp vouches for)
//! is someone's own `python\` / `ffmpeg.exe` (the build extracted into a folder that had them): Refused, nothing touched.
//! Also refused up front: too little free space for the unpack, and a folder path so long that the deepest runtime file
//! would pass Windows' MAX_PATH.
//!
//! paw-7yed: a file over GitHub's 2 GiB per-file cap (runtime.zip, the TAPNext++ checkpoints) comes cut into parts
//! beside the exe (`runtime.zip.001`, `runtime.zip.002`, `tapnextpp_ckpt.pt.001`, ...), listed in `parts.txt`
//! (dev/share/build-nas.ps1). Before anything else the first start joins each one IN PLACE: part 1 is renamed to
//! `<file>.joining` where the file belongs, every later part is appended and then deleted (the drive needs room for one
//! part, not a second copy), the result is checked against the list's size and sha256, then renamed to the file. An
//! interrupted join carries on from the `.joining` file's length. A missing or short part: Refused before anything is
//! touched. After that the unpack is unchanged; a folder without `parts.txt` (one whole runtime.zip) is as before.
//!
//! paw-6s20: every refusal (synced / network folder, someone's own items, a path too long for the `.joining` file or the
//! deepest file a zip in parts holds, too little room) is decided before a part is renamed, appended or deleted: a zip
//! still in parts is listed from its parts (pack::list_in reads its central directory where the bytes are now).
//! paw-xm2c: parts.txt lines may carry a sixth field, every part's sha256 (comma-separated): each part is checked before
//! it is renamed or appended and only then deleted, so a damaged part costs only that part (the message names it); a
//! `.joining` file left by an older download is checked part by part and dropped from its first bad part. paw-366o: names
//! are checked like a pack's (no `..`, drive or absolute path), the numbers with checked arithmetic, and a panic in the
//! setup thread becomes a setup error (wait_ready returns). paw-d62c: a split zip whose stamp is recorded and whose parts
//! are gone is done, and runtime.zip itself is deleted once unpacked and stamped (2.3 GB; an update ships a new one,
//! detected by its stamp), so deleting it by hand never makes a later start refuse.

use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

/// The zips, in unpack order. runtime-rocm (paw-vdb3.3) holds python-rocm\ beside the CUDA runtime's python\ and the same
/// ffmpeg.exe / ffprobe.exe: either runtime or both may be unpacked.
pub const ZIPS: [&str; 3] = ["runtime", "runtime-rocm", "code"];
const SETUP_DIR: &str = ".setup";
pub const COPY_FIRST: &str = "Copy this folder to your own drive first";
pub const MOVE_IT: &str = r"Move the Pawscript folder somewhere else on this PC, for example C:\Pawscript, then start it again.";
/// How long a locked file is waited for (a sync client or an antivirus scanning freshly written files).
const RETRY_FOR: Duration = Duration::from_secs(90);
pub const OWN_FOLDER: &str = r"Put Pawscript in its own empty folder, for example C:\Pawscript, and start it from there.";
pub const CLOSER_TO_ROOT: &str = r"Move the folder closer to the drive root, e.g. C:\Pawscript, then start it again.";
/// What the runtime takes once unpacked (python\ with torch, ffmpeg): about 5 GB; the most any zip is assumed to need.
const RUNTIME_BYTES: u64 = 5_000_000_000;
/// Windows' MAX_PATH less the terminating NUL: the longest full path tar.exe / python can be relied on to use.
const MAX_PATH_CHARS: usize = 259;

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum State {
  Ready,
  /// `what`: "checking" | a zip name
  Unpacking { what: String },
  Refused { message: String },
  Failed { message: String },
}

static STATE: Mutex<State> = Mutex::new(State::Ready);
static CHANGED: Condvar = Condvar::new();

fn set(s: State) {
  *STATE.lock().unwrap_or_else(|e| e.into_inner()) = s;
  CHANGED.notify_all();
}

/// Starts the setup when a zip lies beside the exe (from the app's setup hook, before the window loads anything).
pub fn start() {
  let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) else { return };
  if !ZIPS.iter().any(|z| zip_path(&dir, z).is_file()) && !dir.join(PARTS).is_file() {
    return;
  }
  set(State::Unpacking { what: "checking".into() });
  std::thread::spawn(move || set(guarded(|| prepare(&dir, &|what: &str| set(State::Unpacking { what: what.into() })))));
}

/// paw-366o: a panic in the setup is a setup error on the screen (and for wait_ready), never an endless "Unpacking".
fn guarded(f: impl FnOnce() -> State) -> State {
  std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).unwrap_or_else(|p| {
    let why = p.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| p.downcast_ref::<String>().cloned()).unwrap_or_default();
    State::Failed { message: failed(&format!("the setup stopped: {why}")) }
  })
}

/// Blocks while the setup runs; Err(message) when it was refused or failed.
pub fn wait_ready() -> Result<(), String> {
  let mut g = STATE.lock().unwrap_or_else(|e| e.into_inner());
  while matches!(*g, State::Unpacking { .. }) {
    g = CHANGED.wait(g).unwrap_or_else(|e| e.into_inner());
  }
  match &*g {
    State::Refused { message } | State::Failed { message } => Err(message.clone()),
    _ => Ok(()),
  }
}

/// The front end's setup screen polls this (src/app/setup-screen.js).
#[tauri::command]
pub fn portable_status() -> State {
  STATE.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// paw-cdot: the runtime as the first-start screen sees it (src/features/models): a release may ship without runtime.zip,
/// which the app then downloads beside the exe (models.rs) and unpacks here, with everything above unchanged.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Runtime {
  /// the shared build (code.zip beside the exe); a dev build never needs a runtime downloaded
  pub portable: bool,
  /// the exe's folder: where runtime.zip goes
  pub dir: String,
  pub runtimes: Vec<RuntimeFacts>,
}

/// One runtime (`runtime` = CUDA, `runtime-rocm` = AMD) as the disk has it.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFacts {
  pub id: &'static str,
  /// the recorded stamp of the unpacked runtime ("runtime 2026-11-18 python3.12.12 ..."), None: none unpacked
  pub installed: Option<String>,
  pub python: bool,
  /// <id>.zip (or its first part) beside the exe: the setup unpacks that, nothing to download
  pub zip: bool,
}

#[tauri::command]
pub fn runtime_status() -> Runtime {
  let dir = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)).unwrap_or_default();
  Runtime {
    portable: zip_path(&dir, "code").is_file(),
    dir: crate::files::path_str(&dir),
    runtimes: [crate::gpu::CUDA, crate::gpu::ROCM]
      .map(|id| RuntimeFacts {
        id,
        installed: installed_stamp(&dir, id).map(|s| s.trim().to_string()),
        python: dir.join(crate::gpu::folder_of(id)).join("python.exe").is_file(),
        zip: zip_path(&dir, id).is_file() || dir.join(format!("{id}.zip.001")).is_file(),
      })
      .into(),
  }
}

/// Settings > Models, Remove on a runtime that is not the chosen one: its folder, stamp and ownership record (the shared
/// ffmpeg.exe stays). Refused while the sidecar holds it (the retry gives up with the OS's words).
#[tauri::command]
pub fn runtime_remove(id: String) -> Result<(), String> {
  if !crate::gpu::is_runtime(&id) {
    return Err(format!("{id}: not a runtime"));
  }
  let dir = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)).unwrap_or_default();
  let setup = dir.join(SETUP_DIR);
  remove(&setup.join(format!("{id}.stamp")), RETRY_FOR)?;
  remove(&dir.join(crate::gpu::folder_of(&id)), RETRY_FOR)?;
  remove(&owns_path(&dir, &id), RETRY_FOR)
}

/// runtime.zip was just downloaded beside the exe: the same one-time setup as at a start (the setup screen polls
/// portable_status and reloads the page when it is ready).
#[tauri::command]
pub fn runtime_unpack() {
  start();
}

fn zip_path(dir: &Path, name: &str) -> PathBuf {
  dir.join(format!("{name}.zip"))
}

/// Every zip whose stamp is new, unpacked; `progress` names the zip being unpacked.
pub fn prepare(dir: &Path, progress: &dyn Fn(&str)) -> State {
  let (joins, room) = match pending_joins(dir) {
    Ok(j) => j,
    Err(message) => return State::Refused { message },
  };
  if !joins.is_empty() {
    if let Some(message) = place_refusal(dir).or_else(|| join_refusal(dir, &joins, room)) {
      return State::Refused { message };
    }
    progress("checking");
    for s in &joins {
      if let Err(st) = join(dir, s) {
        return st;
      }
    }
  }
  let mut todo = Vec::new();
  for z in ZIPS {
    let zip = zip_path(dir, z);
    if !zip.is_file() {
      continue;
    }
    match zip_stamp(&zip, z) {
      Ok(want) if needs_unpack(&want, installed_stamp(dir, z).as_deref()) => todo.push((z, zip, want)),
      Ok(_) => drop_unpacked(z, &zip), // set up by an earlier start (before runtime.zip was deleted after its unpack)
      Err(e) => return State::Failed { message: failed(&e) },
    }
  }
  if todo.is_empty() {
    return State::Ready;
  }
  if let Some(message) = place_refusal(dir) {
    return State::Refused { message };
  }
  // paw-mkcd: someone's own files in the way, a path too long, too little room: refused before anything is touched
  let mut plans = Vec::new();
  let mut need = 0u64;
  for (z, zip, want) in todo {
    let listing = match list(&zip) {
      Ok(l) => l,
      Err(e) => return State::Failed { message: failed(&format!("unpacking {z}.zip: {e}")) },
    };
    let items = targets(&listing, z);
    if let Some(message) = foreign_refusal(&foreign(dir, z, &items)) {
      return State::Refused { message };
    }
    if let Some(message) = path_refusal(path_chars(dir), longest_entry(&listing)) {
      return State::Refused { message };
    }
    need += unpack_need(dir, fs::metadata(&zip).map_or(0, |m| m.len()), &items);
    plans.push((z, zip, want, items));
  }
  if let Some(message) = free_bytes(dir).and_then(|free| space_refusal(need, free)) {
    return State::Refused { message };
  }
  clear_old_tmp(dir);
  for (z, zip, want, items) in plans {
    progress(z);
    if let Err(e) = unpack(dir, &zip, z, &want, &items) {
      return State::Failed { message: failed(&format!("unpacking {z}.zip: {e}")) };
    }
    drop_unpacked(z, &zip);
  }
  State::Ready
}

/// paw-d62c (paw-mn92): runtime.zip is not read again once unpacked and stamped (an update ships a new one, told apart by
/// its stamp): deleted, best effort, to give back its 2.3 GB. code.zip (small) stays.
fn drop_unpacked(name: &str, zip: &Path) {
  if name.starts_with("runtime") {
    let _ = remove(zip, Duration::from_secs(10));
  }
}

/// The room an unpack of a `zip_bytes` zip holding `items` needs: what it adds over what it replaces (removed first).
/// ponytail: an estimate (4x the zip, at most the runtime's ~5 GB), not the listing's exact sizes; tar -tv's columns
/// would give those if a drive ever fills up mid-unpack anyway
fn unpack_need(dir: &Path, zip_bytes: u64, items: &[String]) -> u64 {
  zip_bytes.saturating_mul(4).min(RUNTIME_BYTES).saturating_sub(items.iter().map(|t| dir_size(&dir.join(t))).sum())
}

/// paw-6s20: why the joins (and the unpack of a zip still in parts) cannot go ahead here, or None, decided before a part
/// is touched: someone's own items where the zip unpacks, a path too long for a `.joining` file or for the deepest file a
/// zip holds, too little room. Room: the largest part a join appends or what the unpack adds, whichever is more (a join
/// deletes each part once appended, so its room is free again before the unpack starts).
fn join_refusal(dir: &Path, joins: &[Split], room: u64) -> Option<String> {
  let mut need = room;
  for s in joins {
    let mut longest = format!("{}.joining", s.file).encode_utf16().count();
    if let Some(z) = ZIPS.into_iter().find(|z| s.file == format!("{z}.zip")) {
      // ponytail: a zip this reader cannot list (not one tar.exe made) is checked after its join, like a whole zip
      if let Ok(listing) = split_listing(dir, s) {
        let items = targets(&listing, z);
        if let Some(m) = foreign_refusal(&foreign(dir, z, &items)) {
          return Some(m);
        }
        longest = longest.max(longest_entry(&listing));
        need = need.max(unpack_need(dir, s.bytes, &items));
      }
    }
    if let Some(m) = path_refusal(path_chars(dir), longest) {
      return Some(m);
    }
  }
  free_bytes(dir).and_then(|free| space_refusal(need, free))
}

/// Why nothing may be written in `dir` (a synced or network folder, or one it cannot write), or None.
fn place_refusal(dir: &Path) -> Option<String> {
  let env: Vec<(&str, Option<String>)> = SYNC_VARS.iter().map(|k| (*k, std::env::var(k).ok())).collect();
  let (synced, network) = (synced_by(&dir.to_string_lossy(), &env), is_network(dir));
  // the write probe only where unpacking is allowed at all: nothing is written into a synced or network folder
  let write_error = if synced.is_none() && !network { writable(dir).err().map(|e| e.to_string()) } else { None };
  refusal(synced, network, write_error)
}

/// The list of split files, beside the exe.
pub const PARTS: &str = "parts.txt";

/// The most parts one file may come in (names end in three digits).
const MAX_PARTS: u64 = 999;

/// One line of `parts.txt`: `<file, relative to the folder> <bytes> <sha256> <part bytes> <part count> [<part sha256>,...]`.
#[derive(Clone, Debug, PartialEq)]
pub struct Split {
  pub file: String,
  pub bytes: u64,
  pub sha256: String,
  pub part_bytes: u64,
  pub count: u64,
  /// paw-xm2c: every part's sha256 (empty: a parts.txt of an older build, sizes only until the whole file is checked)
  pub part_sha256: Vec<String>,
}

pub fn parse_parts(text: &str) -> Result<Vec<Split>, String> {
  let hex64 = |h: &str| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit());
  let mut out = Vec::new();
  for line in text.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')) {
    let f: Vec<&str> = line.split_whitespace().collect();
    let n = |i: usize| f.get(i).and_then(|v| v.parse::<u64>().ok());
    let file = f[0].replace('\\', "/");
    let part_sha256: Vec<String> = f.get(5).map_or_else(Vec::new, |h| h.split(',').map(str::to_lowercase).collect());
    // paw-366o: a name that stays in the folder, numbers that cannot overflow
    let ok = match (n(1), n(3), n(4)) {
      (Some(bytes), Some(part_bytes), Some(count)) => {
        (5..=6).contains(&f.len())
          && (1..=MAX_PARTS).contains(&count)
          && part_bytes > 0
          && (count - 1).checked_mul(part_bytes).is_some_and(|b| bytes > b)
          && count.checked_mul(part_bytes).is_some_and(|b| bytes <= b)
          && hex64(f[2])
          && (f.len() == 5 || (part_sha256.len() as u64 == count && part_sha256.iter().all(|h| hex64(h))))
          && crate::pack::safe_name(&file).is_ok()
      }
      _ => false,
    };
    if !ok {
      return Err(format!("{PARTS} is damaged (line \"{line}\"): copy it from the download again"));
    }
    out.push(Split { file, bytes: n(1).unwrap_or(0), sha256: f[2].to_lowercase(), part_bytes: n(3).unwrap_or(0), count: n(4).unwrap_or(0), part_sha256 });
  }
  Ok(out)
}

impl Split {
  fn name(&self) -> &str {
    self.file.rsplit('/').next().unwrap_or(&self.file)
  }
  fn part_name(&self, k: u64) -> String {
    format!("{}.{k:03}", self.name())
  }
  /// Part `k` (1-based), beside the exe.
  fn part(&self, dir: &Path, k: u64) -> PathBuf {
    dir.join(self.part_name(k))
  }
  fn part_len(&self, k: u64) -> u64 {
    if k < self.count { self.part_bytes } else { self.bytes - (self.count - 1) * self.part_bytes }
  }
  fn joining(&self, dir: &Path) -> PathBuf {
    dir.join(format!("{}.joining", self.file))
  }
  /// How many parts the `.joining` file holds, as a prefix: parts 1..=j, each whole and none of them beside the exe
  /// again (a part there is used instead, and the `.joining` file cut back before it). Not one when it is longer than
  /// the file (left by another download).
  fn in_joining(&self, dir: &Path) -> u64 {
    let len = file_len(&self.joining(dir)).unwrap_or(0);
    if len > self.bytes {
      return 0;
    }
    (1..=self.count).take_while(|&k| (k - 1) * self.part_bytes + self.part_len(k) <= len && !self.part(dir, k).is_file()).count() as u64
  }
  /// The words for parts that must be downloaded again.
  fn again(&self, ks: impl Iterator<Item = u64>) -> String {
    let names: Vec<String> = ks.map(|k| self.part_name(k)).collect();
    match names.len() {
      1 => format!("{} is missing, incomplete or damaged: download it again, put it beside Pawscript.exe, and start Pawscript again.", names[0]),
      _ => format!("{} are missing, incomplete or damaged: download them again, put them beside Pawscript.exe, and start Pawscript again.", names.join(", ")),
    }
  }
}

fn file_len(p: &Path) -> Option<u64> {
  fs::metadata(p).ok().filter(|m| m.is_file()).map(|m| m.len())
}

/// The installed zip a split file is (`runtime.zip` -> "runtime"), when its stamp is recorded.
fn installed_zip(dir: &Path, s: &Split) -> bool {
  ZIPS.iter().any(|z| s.file == format!("{z}.zip") && installed_stamp(dir, z).is_some())
}

/// The split files still to join, and the room the joins need (the largest part appended); Err: the words for a part
/// that is missing or short (nothing touched). A file with no part and no `.joining` left is done when its size is right,
/// or (paw-d62c) when it is a zip whose stamp is recorded: unpacked, and maybe deleted since.
pub fn pending_joins(dir: &Path) -> Result<(Vec<Split>, u64), String> {
  let text = match fs::read_to_string(dir.join(PARTS)) {
    Ok(t) => t,
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok((Vec::new(), 0)),
    Err(e) => return Err(failed(&format!("could not read {PARTS}: {e}"))),
  };
  let (mut todo, mut room, mut bad) = (Vec::new(), 0u64, Vec::new());
  for s in parse_parts(&text)? {
    let any_part = (1..=s.count).any(|k| s.part(dir, k).is_file());
    if !s.joining(dir).is_file() && !any_part && (file_len(&dir.join(&s.file)) == Some(s.bytes) || installed_zip(dir, &s)) {
      continue; // joined on an earlier start
    }
    let j = s.in_joining(dir);
    for k in j + 1..=s.count {
      if file_len(&s.part(dir, k)) != Some(s.part_len(k)) {
        bad.push(s.part_name(k));
      } else if k > 1 {
        room = room.max(s.part_len(k));
      }
    }
    todo.push(s);
  }
  match bad.len() {
    0 => Ok((todo, room)),
    1 => Err(format!("{} is missing or incomplete: download it again, put it beside Pawscript.exe, and start Pawscript again.", bad[0])),
    _ => Err(format!("{} are missing or incomplete: download them again, put them beside Pawscript.exe, and start Pawscript again.", bad.join(", "))),
  }
}

/// sha256 (hex) of the next `len` bytes of `r`.
fn sha_of(r: &mut impl Read, len: u64) -> std::io::Result<String> {
  let mut sha = <sha2::Sha256 as sha2::Digest>::new();
  let n = std::io::copy(&mut r.take(len), &mut sha)?;
  if n != len {
    return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "shorter than parts.txt says"));
  }
  Ok(crate::files::hex(&sha2::Digest::finalize(sha)))
}

/// Joins one split file in place (see the top of this file); Err: the State to show. paw-xm2c: with per-part hashes,
/// every part is checked before it is renamed or appended and deleted only after; the `.joining` file is only ever cut
/// back to its last good part, so a damaged part costs only that part.
pub fn join(dir: &Path, s: &Split) -> Result<(), State> {
  let io = |what: &str, p: &Path, e: std::io::Error| State::Failed { message: failed(&format!("joining {}: {what} {}: {e}", s.name(), p.display())) };
  let refuse = |ks: std::ops::RangeInclusive<u64>| State::Refused { message: s.again(ks) };
  let checked = !s.part_sha256.is_empty();
  let (work, target) = (s.joining(dir), dir.join(&s.file));
  let start = |k: u64| (k - 1) * s.part_bytes;
  let mut j = s.in_joining(dir);
  let resumed = j > 0;
  if j == 0 {
    // nothing usable joined yet (or a .joining file of another download): begin from part 1
    let first = s.part(dir, 1);
    if checked && sha_of(&mut fs::File::open(&first).map_err(|e| io("could not read", &first, e))?, s.part_len(1)).ok().as_deref() != Some(&s.part_sha256[0]) {
      return Err(refuse(1..=1));
    }
    remove(&work, RETRY_FOR).map_err(|e| State::Failed { message: failed(&e) })?;
    if let Some(parent) = work.parent() {
      fs::create_dir_all(parent).map_err(|e| io("could not create", parent, e))?;
    }
    retry(RETRY_FOR, || fs::rename(&first, &work)).map_err(|e| io("could not move", &first, e))?;
    j = 1;
  }
  let mut f = retry(RETRY_FOR, || fs::OpenOptions::new().read(true).write(true).open(&work)).map_err(|e| io("could not open", &work, e))?;
  // what an earlier start (or an older download) left is checked part by part; from the first bad part it is dropped
  if checked && resumed {
    f.seek(SeekFrom::Start(0)).map_err(|e| io("could not read", &work, e))?;
    if let Some(bad) = (1..=j).find(|&k| sha_of(&mut f, s.part_len(k)).ok().as_deref() != Some(&s.part_sha256[k as usize - 1])) {
      f.set_len(start(bad)).and_then(|_| f.sync_all()).map_err(|e| io("could not cut back", &work, e))?;
      drop(f);
      if bad == 1 {
        let _ = remove(&work, RETRY_FOR);
      }
      return Err(refuse(bad..=j));
    }
  }
  let mut buf = vec![0u8; 1 << 20];
  for k in j + 1..=s.count {
    let p = s.part(dir, k);
    // a cut-off earlier append is dropped and redone; the part is hashed on its way in and deleted only when it checks out
    let mut append = || -> std::io::Result<String> {
      f.set_len(start(k))?;
      f.seek(SeekFrom::End(0))?;
      let (mut src, mut sha) = (fs::File::open(&p)?, <sha2::Sha256 as sha2::Digest>::new());
      loop {
        let n = src.read(&mut buf)?;
        if n == 0 {
          break;
        }
        sha2::Digest::update(&mut sha, &buf[..n]);
        f.write_all(&buf[..n])?;
      }
      f.sync_all()?;
      Ok(crate::files::hex(&sha2::Digest::finalize(sha)))
    };
    let got = append().map_err(|e| io("could not append", &p, e))?;
    if checked && got != s.part_sha256[k as usize - 1] {
      f.set_len(start(k)).and_then(|_| f.sync_all()).map_err(|e| io("could not cut back", &work, e))?;
      return Err(refuse(k..=k));
    }
    remove(&p, RETRY_FOR).map_err(|e| State::Failed { message: failed(&e) })?;
  }
  // the whole file, once more from the disk: its size and sha256 (with per-part hashes, also where a write went wrong)
  f.seek(SeekFrom::Start(0)).map_err(|e| io("could not read", &work, e))?;
  let (mut whole, mut bad) = (<sha2::Sha256 as sha2::Digest>::new(), None);
  for k in 1..=s.count {
    let (mut part, mut left) = (<sha2::Sha256 as sha2::Digest>::new(), s.part_len(k));
    while left > 0 {
      let n = f.read(&mut buf[..left.min(1 << 20) as usize]).map_err(|e| io("could not read", &work, e))?;
      if n == 0 {
        break;
      }
      sha2::Digest::update(&mut whole, &buf[..n]);
      sha2::Digest::update(&mut part, &buf[..n]);
      left -= n as u64;
    }
    let ok = left == 0 && (!checked || crate::files::hex(&sha2::Digest::finalize(part)) == s.part_sha256[k as usize - 1]);
    if !ok && bad.is_none() {
      bad = Some(k);
    }
  }
  let len = f.seek(SeekFrom::End(0)).map_err(|e| io("could not read", &work, e))?;
  if len != s.bytes || bad.is_some() || crate::files::hex(&sha2::Digest::finalize(whole)) != s.sha256 {
    let from = if checked { bad.unwrap_or(1) } else { 1 };
    if checked {
      // the good parts stay joined; only those from the first bad one must come again
      f.set_len(start(from)).and_then(|_| f.sync_all()).map_err(|e| io("could not cut back", &work, e))?;
    } // without per-part hashes the bad part is not known: the .joining file stays whole, a part downloaded again replaces its range
    drop(f);
    if checked && from == 1 {
      let _ = remove(&work, RETRY_FOR);
    }
    let parts = (from..=s.count).map(|k| s.part_name(k)).collect::<Vec<_>>().join(", ");
    return Err(State::Refused { message: format!("{} did not check out after joining its parts (one was damaged in the download): download {parts} again, put them beside Pawscript.exe, and start Pawscript again.", s.name()) });
  }
  drop(f);
  remove(&target, RETRY_FOR).map_err(|e| State::Failed { message: failed(&e) })?;
  retry(RETRY_FOR, || fs::rename(&work, &target)).map_err(|e| io("could not rename", &work, e))?;
  for k in 1..=s.count {
    let _ = remove(&s.part(dir, k), RETRY_FOR); // a part downloaded again after an interruption: no longer needed
  }
  Ok(())
}

/// A split file read as one from where its bytes are now (paw-6s20): the `.joining` file's whole parts, then the parts
/// beside the exe. (file, where its bytes start in the joined file, how many)
struct Joined {
  segs: Vec<(fs::File, u64, u64)>,
  pos: u64,
  len: u64,
}

impl Joined {
  fn open(dir: &Path, s: &Split) -> std::io::Result<Joined> {
    let j = s.in_joining(dir);
    let mut segs = Vec::new();
    if j > 0 {
      segs.push((fs::File::open(s.joining(dir))?, 0, (j - 1) * s.part_bytes + s.part_len(j)));
    }
    for k in j + 1..=s.count {
      segs.push((fs::File::open(s.part(dir, k))?, (k - 1) * s.part_bytes, s.part_len(k)));
    }
    Ok(Joined { segs, pos: 0, len: s.bytes })
  }
}

impl Read for Joined {
  fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
    let pos = self.pos;
    let Some((f, at, n)) = self.segs.iter_mut().find(|(_, at, n)| pos >= *at && pos < at + n) else { return Ok(0) };
    f.seek(SeekFrom::Start(pos - *at))?;
    let want = buf.len().min((*at + *n - pos) as usize);
    let got = f.read(&mut buf[..want])?;
    self.pos += got as u64;
    Ok(got)
  }
}

impl Seek for Joined {
  fn seek(&mut self, to: SeekFrom) -> std::io::Result<u64> {
    let p = match to {
      SeekFrom::Start(p) => Some(p),
      SeekFrom::End(d) => self.len.checked_add_signed(d),
      SeekFrom::Current(d) => self.pos.checked_add_signed(d),
    };
    self.pos = p.ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "seek before the start"))?;
    Ok(self.pos)
  }
}

/// The listing (names, one a line, as `tar -tf`) of a zip still in parts, from its central directory.
fn split_listing(dir: &Path, s: &Split) -> Result<String, String> {
  let mut r = Joined::open(dir, s).map_err(|e| e.to_string())?;
  let items = crate::pack::list_in(&mut r, s.bytes, &dir.join(&s.file)).map_err(|e| e.message)?;
  Ok(items.iter().map(|i| i.name.as_str()).collect::<Vec<_>>().join("\n"))
}

fn owns_path(dir: &Path, name: &str) -> PathBuf {
  dir.join(SETUP_DIR).join(format!("{name}.owns"))
}

/// The items of `items` already in `dir` that no Pawscript unpack made: not listed in `.setup\<name>.owns`. A folder set
/// up before `.owns` existed (a recorded stamp, no `.owns`) is trusted as it is.
pub fn foreign(dir: &Path, name: &str, items: &[String]) -> Vec<String> {
  let owns = match fs::read_to_string(owns_path(dir, name)) {
    Ok(s) => s,
    Err(_) if installed_stamp(dir, name).is_some() => return Vec::new(),
    Err(_) => String::new(),
  };
  // paw-vdb3.3: the other runtime's zip carries the same ffmpeg.exe: what a sibling zip made is not someone's own either
  let siblings: Vec<String> = ZIPS.iter().filter(|z| **z != name).filter_map(|z| fs::read_to_string(owns_path(dir, z)).ok()).collect();
  let owned: std::collections::HashSet<&str> = owns.lines().chain(siblings.iter().flat_map(|s| s.lines())).map(str::trim).collect();
  items.iter().filter(|t| !owned.contains(t.as_str()) && fs::symlink_metadata(dir.join(t)).is_ok()).cloned().collect()
}

pub fn foreign_refusal(found: &[String]) -> Option<String> {
  (!found.is_empty()).then(|| {
    let names = found.iter().map(|t| t.replace('/', "\\")).collect::<Vec<_>>().join(", ");
    format!("This folder already has {names}, which Pawscript did not put there and would have to replace. Nothing was changed. {OWN_FOLDER}")
  })
}

/// The folder's path length in UTF-16 units (what MAX_PATH counts), without a `\\?\` prefix.
fn path_chars(dir: &Path) -> usize {
  dir.to_string_lossy().trim_start_matches(r"\\?\").encode_utf16().count()
}

/// The longest entry name in a zip listing (UTF-16 units).
pub fn longest_entry(listing: &str) -> usize {
  listing.lines().map(|l| l.trim().trim_end_matches(['/', '\\']).encode_utf16().count()).max().unwrap_or(0)
}

/// Refused when `<folder>\<longest entry>` would pass MAX_PATH.
pub fn path_refusal(dir_chars: usize, longest: usize) -> Option<String> {
  (dir_chars + 1 + longest > MAX_PATH_CHARS).then(|| {
    let over = dir_chars + 1 + longest - MAX_PATH_CHARS;
    format!("This folder's path is too long for what Pawscript unpacks: Windows allows {MAX_PATH_CHARS} characters for a file's whole path, and the deepest file would need {over} more. {CLOSER_TO_ROOT}")
  })
}

const GB: f64 = 1e9;
/// Refused when the drive has less than `need` bytes free; says how much is missing (rounded up).
pub fn space_refusal(need: u64, free: u64) -> Option<String> {
  (free < need).then(|| {
    let up = |b: u64| (b as f64 / GB * 10.0).ceil() / 10.0;
    format!(
      "Setting up needs about {:.1} GB free on this drive and only {:.1} GB is free: free up {:.1} GB more, or move the Pawscript folder to a drive with more room, then start it again.",
      up(need),
      (free as f64 / GB * 10.0).floor() / 10.0,
      up(need - free)
    )
  })
}

/// Bytes free for this user on the drive holding `dir` (None: not known, then nothing is refused for it).
pub fn free_bytes(dir: &Path) -> Option<u64> {
  #[cfg(windows)]
  {
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = dir.as_os_str().encode_wide().chain([0]).collect();
    let mut avail = 0u64;
    // SAFETY: a NUL-terminated wide string that outlives the call; the other out-pointers may be null
    let ok = unsafe { windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(wide.as_ptr(), &mut avail, std::ptr::null_mut(), std::ptr::null_mut()) };
    return (ok != 0).then_some(avail);
  }
  #[allow(unreachable_code)]
  None
}

/// Bytes under `p` (a file or a folder; links not followed; absent: 0).
fn dir_size(p: &Path) -> u64 {
  match fs::symlink_metadata(p) {
    Ok(m) if m.is_dir() => fs::read_dir(p).map_or(0, |rd| rd.flatten().map(|e| dir_size(&e.path())).sum()),
    Ok(m) => m.len(),
    Err(_) => 0,
  }
}

/// The failure text: what to do first, the raw error last (for diagnosis).
pub fn failed(detail: &str) -> String {
  format!(
    "Setting up could not finish. Close Pawscript and start it again: it carries on by itself. If it fails again, move \
     the Pawscript folder out of OneDrive / Dropbox / other synced folders (for example to C:\\Pawscript), and check that \
     an antivirus or Windows Security's \"Controlled folder access\" is not blocking Pawscript.exe. Details: {detail}"
  )
}

/// A zip is unpacked when its stamp differs from the recorded one (or none is recorded: never set up, or interrupted).
pub fn needs_unpack(want: &str, installed: Option<&str>) -> bool {
  installed.map(str::trim) != Some(want.trim())
}

/// Why not to unpack here, or None. `synced`: the sync service the folder is inside; `write_error`: the first write failed.
pub fn refusal(synced: Option<&str>, network: bool, write_error: Option<String>) -> Option<String> {
  if let Some(s) = synced {
    Some(format!("This folder is inside {s}, which would upload it (about 15 GB once set up) and lock its files while Pawscript runs. {MOVE_IT}"))
  } else if network {
    Some(format!("{COPY_FIRST}: this folder is on a network drive, and Pawscript unpacks its runtime (about 5 GB) and loads its models from where it is."))
  } else {
    write_error.map(|e| {
      format!(
        "Pawscript cannot write in this folder, and it unpacks its runtime (about 5 GB) next to the exe the first time. {MOVE_IT} \
         If that fails too: Windows Security's \"Controlled folder access\" (ransomware protection) or an antivirus may be \
         blocking Pawscript.exe; allow it there, or use a folder outside Desktop / Documents. Details: {e}"
      )
    })
  }
}

/// The environment variables the OneDrive client sets to its folders.
pub const SYNC_VARS: [&str; 3] = ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"];

/// The cloud-sync service whose folder holds `dir`, or None: under a OneDrive variable's folder, or a path component
/// named OneDrive*, Dropbox, Google Drive / My Drive, iCloudDrive / iCloud Drive.
pub fn synced_by(dir: &str, env: &[(&str, Option<String>)]) -> Option<&'static str> {
  let d = dir.trim_start_matches(r"\\?\").replace('/', "\\").to_lowercase();
  for (_, v) in env {
    if let Some(root) = v.as_deref().map(|r| r.trim_end_matches(['\\', '/']).replace('/', "\\").to_lowercase()).filter(|r| !r.is_empty()) {
      if d == root || d.starts_with(&format!("{root}\\")) {
        return Some("OneDrive");
      }
    }
  }
  for c in d.split('\\') {
    match c {
      c if c.starts_with("onedrive") => return Some("OneDrive"),
      "dropbox" => return Some("Dropbox"),
      "google drive" | "my drive" | "googledrive" => return Some("Google Drive"),
      "iclouddrive" | "icloud drive" => return Some("iCloud Drive"),
      _ => {}
    }
  }
  None
}

/// `\\server\share\...` and `\\?\UNC\...` (not `\\?\C:\...`).
pub fn is_unc(p: &str) -> bool {
  p.starts_with(r"\\?\UNC\") || (p.starts_with(r"\\") && !p.starts_with(r"\\?\") && !p.starts_with(r"\\.\"))
}

fn is_network(dir: &Path) -> bool {
  let s = dir.to_string_lossy();
  if is_unc(&s) {
    return true;
  }
  #[cfg(windows)]
  {
    use std::os::windows::ffi::OsStrExt;
    let root: Vec<u16> = std::ffi::OsStr::new(&format!("{}\\", s.trim_start_matches(r"\\?\").get(..2).unwrap_or(""))).encode_wide().chain([0]).collect();
    // DRIVE_REMOTE = 4: a mapped network drive
    return unsafe { windows_sys::Win32::Storage::FileSystem::GetDriveTypeW(root.as_ptr()) } == 4;
  }
  #[allow(unreachable_code)]
  false
}

fn writable(dir: &Path) -> std::io::Result<()> {
  let probe = dir.join(SETUP_DIR).join(".write-test");
  fs::create_dir_all(dir.join(SETUP_DIR))?;
  fs::write(&probe, b"x")?;
  let _ = fs::remove_file(&probe);
  Ok(())
}

/// paw-frhy: the recorded stamps beside the exe ("runtime 2026-11-17", ...), for the bug report; none in a dev build.
pub fn stamps() -> Vec<String> {
  let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) else { return Vec::new() };
  ZIPS.iter().filter_map(|z| installed_stamp(&dir, z)).map(|s| s.trim().to_string()).collect()
}

fn installed_stamp(dir: &Path, name: &str) -> Option<String> {
  fs::read_to_string(dir.join(SETUP_DIR).join(format!("{name}.stamp"))).ok()
}

/// Access denied, sharing / lock violation: someone (a sync client, an antivirus) holds the file for a moment.
fn transient(e: &std::io::Error) -> bool {
  matches!(e.raw_os_error(), Some(5) | Some(32) | Some(33)) || e.kind() == std::io::ErrorKind::PermissionDenied
}

/// `f` until it succeeds, retrying transient errors with a growing pause for up to `limit`.
fn retry<T>(limit: Duration, mut f: impl FnMut() -> std::io::Result<T>) -> std::io::Result<T> {
  let (t0, mut pause) = (Instant::now(), Duration::from_millis(200));
  loop {
    match f() {
      Err(e) if transient(&e) && t0.elapsed() < limit => {
        std::thread::sleep(pause);
        pause = (pause * 2).min(Duration::from_secs(5));
      }
      r => return r,
    }
  }
}

/// Removes a file or a whole folder (absent: fine), waiting out locks.
pub fn remove(p: &Path, limit: Duration) -> Result<(), String> {
  retry(limit, || match fs::symlink_metadata(p) {
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
    Ok(m) if m.is_dir() => fs::remove_dir_all(p),
    Ok(_) => fs::remove_file(p),
    Err(e) => Err(e),
  })
  .map_err(|e| format!("could not remove {}: {e}", p.display()))
}

/// What a zip replaces, from its listing (`tar -tf`): its top-level items, and inside `trackers/` its children (the
/// models there stay); never the stamp.
pub fn targets(listing: &str, name: &str) -> Vec<String> {
  let stamp = format!("{name}.stamp");
  let mut out: Vec<String> = Vec::new();
  for line in listing.lines().map(|l| l.trim().replace('\\', "/")) {
    let parts: Vec<&str> = line.split('/').filter(|p| !p.is_empty()).collect();
    let t = match parts.as_slice() {
      [] => continue,
      [one] if *one == stamp => continue,
      ["trackers"] => continue,
      ["trackers", child, ..] => format!("trackers/{child}"),
      [first, ..] => first.to_string(),
    };
    if !out.contains(&t) {
      out.push(t);
    }
  }
  out
}

/// Leftovers of the first version, which unpacked into `.setup\<name>.tmp` (best effort: they only take space).
fn clear_old_tmp(dir: &Path) {
  for z in ZIPS {
    let _ = remove(&dir.join(SETUP_DIR).join(format!("{z}.tmp")), Duration::from_secs(10));
  }
}

fn tar() -> Command {
  let exe = std::env::var_os("SystemRoot").map(|r| PathBuf::from(r).join("System32").join("tar.exe")).filter(|p| p.is_file());
  let mut c = Command::new(exe.unwrap_or_else(|| "tar".into()));
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
  }
  c
}

/// The `<name>.stamp` text inside the zip, read without unpacking the rest.
pub fn zip_stamp(zip: &Path, name: &str) -> Result<String, String> {
  let out = tar().arg("-xOf").arg(zip).arg(format!("{name}.stamp")).output().map_err(|e| format!("tar.exe: {e}"))?;
  let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
  if !out.status.success() || s.is_empty() {
    return Err(format!("{} has no {name}.stamp: it is not a Pawscript {name}.zip (or it is damaged)", zip.display()));
  }
  Ok(s)
}

/// The zip's listing (`tar -tf`).
fn list(zip: &Path) -> Result<String, String> {
  let out = tar().arg("-tf").arg(zip).output().map_err(|e| format!("tar.exe: {e}"))?;
  if !out.status.success() {
    return Err(format!("tar.exe could not read {}", zip.display()));
  }
  Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Unpacks `zip` in place: records that it owns `items` (`targets` of its listing), forgets its stamp, removes what it
/// replaces, lets tar.exe write the files where they belong (up to three tries, cleaning the targets each time), then
/// records the stamp.
pub fn unpack(dir: &Path, zip: &Path, name: &str, stamp: &str, items: &[String]) -> Result<(), String> {
  let setup = dir.join(SETUP_DIR);
  fs::create_dir_all(&setup).map_err(|e| format!("could not create {}: {e}", setup.display()))?;
  // before anything is removed: these are ours from now on (an interrupted unpack is redone over them, paw-mkcd)
  let owns = owns_path(dir, name);
  let mut owned: Vec<String> = fs::read_to_string(&owns).unwrap_or_default().lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
  owned.extend(items.iter().filter(|t| !owned.contains(t)).cloned().collect::<Vec<_>>());
  fs::write(&owns, owned.join("\n")).map_err(|e| format!("could not write {}: {e}", owns.display()))?;
  let recorded = setup.join(format!("{name}.stamp"));
  remove(&recorded, RETRY_FOR)?; // from here until the end, an interruption means "redo"
  let mut last = String::new();
  for attempt in 0..3 {
    if attempt > 0 {
      std::thread::sleep(Duration::from_secs(5));
    }
    for t in items {
      remove(&dir.join(t), RETRY_FOR)?;
    }
    let out = tar().arg("-xf").arg(zip).arg("-C").arg(dir).arg("--exclude").arg(format!("{name}.stamp")).output().map_err(|e| format!("tar.exe: {e}"))?;
    if out.status.success() {
      let part = setup.join(format!("{name}.stamp.part"));
      fs::write(&part, stamp).map_err(|e| format!("could not write {}: {e}", part.display()))?;
      return retry(RETRY_FOR, || fs::rename(&part, &recorded)).map_err(|e| format!("could not write {}: {e}", recorded.display()));
    }
    last = String::from_utf8_lossy(&out.stderr).lines().take(3).collect::<Vec<_>>().join(" / ");
  }
  Err(format!("tar.exe could not unpack {}: {last}", zip.display()))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn stamps_decide_what_is_unpacked() {
    assert!(needs_unpack("runtime 2026-11-17", None)); // never set up, or interrupted before the stamp
    assert!(needs_unpack("runtime 2026-11-18", Some("runtime 2026-11-17"))); // a newer zip dropped in
    assert!(!needs_unpack("runtime 2026-11-17", Some("runtime 2026-11-17\r\n")));
  }

  #[test]
  fn synced_network_and_unwritable_folders_are_refused_with_what_to_do() {
    assert!(refusal(Some("OneDrive"), false, None).unwrap().contains(MOVE_IT));
    assert!(refusal(None, true, None).unwrap().starts_with(COPY_FIRST));
    let w = refusal(None, false, Some("Access is denied. (os error 5)".into())).unwrap();
    assert!(w.contains(MOVE_IT) && w.contains("Controlled folder access") && w.ends_with("(os error 5)"));
    assert_eq!(refusal(None, false, None), None);
    assert!(is_unc(r"\\nas\share\Pawscript") && is_unc(r"\\?\UNC\nas\share\Pawscript"));
    assert!(!is_unc(r"C:\Users\x\Pawscript") && !is_unc(r"\\?\C:\Pawscript") && !is_unc(r"\\.\pipe\x"));
  }

  #[test]
  fn cloud_synced_folders_are_recognised() {
    let od = [("OneDrive", Some(r"C:\Users\f\OneDrive - Contoso".to_string())), ("OneDriveConsumer", None)];
    assert_eq!(synced_by(r"C:\Users\f\OneDrive - Contoso\Desktop\Pawscript", &od), Some("OneDrive"));
    assert_eq!(synced_by(r"\\?\c:\users\F\onedrive - contoso\Pawscript", &od), Some("OneDrive"));
    let moved = [("OneDrive", Some(r"D:\Sync\Cloud".to_string()))]; // a OneDrive folder moved and renamed: only the variable knows
    assert_eq!(synced_by(r"D:\Sync\Cloud\Pawscript", &moved), Some("OneDrive"));
    assert_eq!(synced_by(r"D:\Sync\CloudOther\Pawscript", &moved), None);
    assert_eq!(synced_by(r"C:\Users\f\OneDrive\Desktop\Pawscript", &[]), Some("OneDrive"));
    assert_eq!(synced_by(r"C:\Users\f\Dropbox\Pawscript", &[]), Some("Dropbox"));
    assert_eq!(synced_by(r"G:\My Drive\Pawscript", &[]), Some("Google Drive"));
    assert_eq!(synced_by(r"C:\Users\f\iCloudDrive\Pawscript", &[]), Some("iCloud Drive"));
    assert_eq!(synced_by(r"C:\Users\f\Desktop\Pawscript", &od), None);
    assert_eq!(synced_by(r"C:\Pawscript", &[("OneDrive", Some(String::new()))]), None);
  }

  #[test]
  fn a_zip_replaces_its_items_and_trackers_children_only() {
    let runtime = "python/\npython/python.exe\npython/Lib/os.py\nffmpeg.exe\nffprobe.exe\nruntime.stamp\n";
    assert_eq!(targets(runtime, "runtime"), ["python", "ffmpeg.exe", "ffprobe.exe"]);
    let code = "trackers/\ntrackers/pawtrack/\ntrackers/pawtrack/cli.py\ntrackers/sitecustomize.py\ncode.stamp\n";
    assert_eq!(targets(code, "code"), ["trackers/pawtrack", "trackers/sitecustomize.py"]);
  }

  /// paw-mkcd: the checks made before anything is touched, as the words a friend reads.
  #[test]
  fn foreign_items_long_paths_and_a_full_drive_are_refused_up_front() {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    let items: Vec<String> = ["python", "ffmpeg.exe", "ffprobe.exe"].map(String::from).into();
    assert!(foreign(d, "runtime", &items).is_empty()); // an empty folder
    fs::create_dir_all(d.join("python")).unwrap();
    fs::write(d.join("ffmpeg.exe"), "theirs").unwrap();
    assert_eq!(foreign(d, "runtime", &items), ["python", "ffmpeg.exe"]); // someone's own
    let m = foreign_refusal(&foreign(d, "runtime", &items)).unwrap();
    assert!(m.contains(r"python, ffmpeg.exe") && m.contains("Nothing was changed") && m.ends_with(OWN_FOLDER), "{m}");
    assert_eq!(foreign_refusal(&[]), None);
    fs::create_dir_all(d.join(SETUP_DIR)).unwrap();
    fs::write(d.join(SETUP_DIR).join("runtime.stamp"), "r0").unwrap(); // set up before .owns existed: trusted
    assert!(foreign(d, "runtime", &items).is_empty());
    fs::write(owns_path(d, "runtime"), "python\nffprobe.exe").unwrap(); // .owns is the word once it exists
    assert_eq!(foreign(d, "runtime", &items), ["ffmpeg.exe"]);
    // paw-vdb3.3: the ROCm zip carries the same ffmpeg.exe; the CUDA runtime made it, so it is not someone's own
    let rocm: Vec<String> = ["python-rocm", "ffmpeg.exe"].map(String::from).into();
    fs::write(owns_path(d, "runtime"), "python
ffmpeg.exe").unwrap();
    assert!(foreign(d, "runtime-rocm", &rocm).is_empty());
    fs::write(owns_path(d, "runtime"), "python").unwrap();
    assert_eq!(foreign(d, "runtime-rocm", &rocm), ["ffmpeg.exe"]);

    let listing = "python/\npython/Lib/site-packages/torch/include/a.h\nffmpeg.exe\n";
    assert_eq!(longest_entry(listing), "python/Lib/site-packages/torch/include/a.h".len());
    assert_eq!(path_refusal(100, 144), None); // the README's ~100 chars
    assert_eq!(path_refusal(114, 144), None); // 114 + 1 + 144 = 259: the last that fits
    let p = path_refusal(115, 144).unwrap();
    assert!(p.contains("1 more") && p.ends_with(CLOSER_TO_ROOT), "{p}");
    assert_eq!(path_chars(Path::new(r"\\?\C:\Pawscript")), r"C:\Pawscript".len());

    assert_eq!(space_refusal(5_000_000_000, 5_000_000_000), None);
    let s = space_refusal(5_000_000_000, 2_340_000_000).unwrap();
    assert!(s.contains("about 5.0 GB") && s.contains("only 2.3 GB is free") && s.contains("free up 2.7 GB more"), "{s}");
  }

  #[cfg(windows)]
  #[test]
  fn a_locked_file_is_waited_for_not_failed_on() {
    use std::os::windows::fs::OpenOptionsExt;
    let t = tempfile::tempdir().unwrap();
    let d = t.path().join("python");
    fs::create_dir_all(d.join("Lib")).unwrap();
    fs::write(d.join("Lib").join("os.py"), "x").unwrap();
    let held = fs::OpenOptions::new().read(true).share_mode(0).open(d.join("Lib").join("os.py")).unwrap(); // no sharing at all
    let releaser = std::thread::spawn(move || { std::thread::sleep(Duration::from_millis(1500)); drop(held); });
    let t0 = Instant::now();
    remove(&d, Duration::from_secs(20)).unwrap();
    assert!(t0.elapsed() >= Duration::from_millis(1000) && !d.exists());
    releaser.join().unwrap();
    // still locked when the wait is over: an error that names the path
    fs::create_dir_all(&d).unwrap();
    fs::write(d.join("x"), "x").unwrap();
    let _held = fs::OpenOptions::new().read(true).share_mode(0).open(d.join("x")).unwrap();
    assert!(remove(&d, Duration::from_millis(500)).unwrap_err().contains("python"));
  }

  #[cfg(windows)]
  fn zip(dir: &Path, name: &str, stamp: &str, files: &[(&str, &str)]) -> PathBuf {
    let src = dir.join(format!("src-{name}-{stamp}"));
    let stamp_file = format!("{name}.stamp");
    for (rel, text) in files.iter().copied().chain([(stamp_file.as_str(), stamp)]) {
      let p = src.join(rel);
      fs::create_dir_all(p.parent().unwrap()).unwrap();
      fs::write(p, text).unwrap();
    }
    let z = dir.join(format!("{name}.zip"));
    let _ = fs::remove_file(&z);
    let names: Vec<String> = fs::read_dir(&src).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    assert!(tar().arg("--format").arg("zip").arg("-c").arg("-f").arg(&z).arg("-C").arg(&src).args(&names).status().unwrap().success());
    fs::remove_dir_all(&src).unwrap();
    z
  }

  #[cfg(windows)]
  #[test]
  fn unpacks_once_recovers_from_an_interruption_and_takes_a_newer_zip() {
    let t = tempfile::tempdir().unwrap();
    let d = t.path().join("Pawscript");
    fs::create_dir_all(d.join("trackers").join(".cache").join("sam2")).unwrap();
    fs::write(d.join("trackers").join(".cache").join("sam2").join("w.pt"), "weights").unwrap();
    zip(&d, "runtime", "r1", &[("python/python.exe", "py1"), ("python/Lib/os.py", "os"), ("ffmpeg.exe", "ff1")]);
    zip(&d, "code", "c1", &[("trackers/pawtrack/cli.py", "v1"), ("trackers/pawtrack/old.py", "gone later")]);
    let seen = std::cell::RefCell::new(Vec::new());
    let progress = |w: &str| seen.borrow_mut().push(w.to_string());

    assert_eq!(prepare(&d, &progress), State::Ready);
    assert_eq!(*seen.borrow(), ["runtime", "code"]);
    assert_eq!(fs::read_to_string(d.join("python/python.exe")).unwrap(), "py1");
    assert_eq!(fs::read_to_string(d.join("trackers/pawtrack/cli.py")).unwrap(), "v1");
    assert_eq!(fs::read_to_string(d.join("trackers/.cache/sam2/w.pt")).unwrap(), "weights"); // models untouched
    assert!(!d.join("runtime.stamp").exists() && !d.join("code.stamp").exists());
    // paw-d62c: runtime.zip is not needed once unpacked and stamped (2.3 GB back); code.zip stays
    assert!(!d.join("runtime.zip").exists() && d.join("code.zip").exists());

    seen.borrow_mut().clear(); // second start: nothing to do
    assert_eq!(prepare(&d, &progress), State::Ready);
    assert!(seen.borrow().is_empty());
    // a runtime.zip of the installed stamp (left by a build before it was deleted after its unpack): deleted, not unpacked
    zip(&d, "runtime", "r1", &[("python/python.exe", "py1"), ("python/Lib/os.py", "os"), ("ffmpeg.exe", "ff1")]);
    assert_eq!(prepare(&d, &progress), State::Ready);
    assert!(seen.borrow().is_empty() && !d.join("runtime.zip").exists());

    // a failed first attempt of the old design (a half-filled .setup\runtime.tmp, no python) and a half-unpacked
    // runtime of this one (no stamp, a stray file): both are cleaned and redone
    zip(&d, "runtime", "r1", &[("python/python.exe", "py1"), ("python/Lib/os.py", "os"), ("ffmpeg.exe", "ff1")]);
    fs::remove_file(d.join(".setup/runtime.stamp")).unwrap();
    fs::remove_dir_all(d.join("python")).unwrap();
    fs::create_dir_all(d.join(".setup/runtime.tmp/python")).unwrap();
    fs::write(d.join(".setup/runtime.tmp/python/half.py"), "x").unwrap();
    fs::create_dir_all(d.join("python/Lib")).unwrap();
    fs::write(d.join("python/Lib/stray.py"), "half").unwrap();
    assert_eq!(prepare(&d, &progress), State::Ready);
    assert_eq!(*seen.borrow(), ["runtime"]);
    assert_eq!(fs::read_to_string(d.join("python/Lib/os.py")).unwrap(), "os");
    assert!(!d.join("python/Lib/stray.py").exists() && !d.join(".setup/runtime.tmp").exists());

    // a newer code.zip replaces the code (a removed module disappears), the runtime stays
    seen.borrow_mut().clear();
    zip(&d, "code", "c2", &[("trackers/pawtrack/cli.py", "v2")]);
    assert_eq!(prepare(&d, &progress), State::Ready);
    assert_eq!(*seen.borrow(), ["code"]);
    assert_eq!(fs::read_to_string(d.join("trackers/pawtrack/cli.py")).unwrap(), "v2");
    assert!(!d.join("trackers/pawtrack/old.py").exists());
    assert_eq!(fs::read_to_string(d.join(".setup/code.stamp")).unwrap(), "c2");
    assert_eq!(fs::read_to_string(d.join("python/python.exe")).unwrap(), "py1");

    // a zip without its stamp is an error that says what to do first and keeps the detail
    let bad = t.path().join("bad");
    fs::create_dir_all(&bad).unwrap();
    let z = zip(&bad, "runtime", "x", &[("python/python.exe", "p")]);
    let other = bad.join("other");
    fs::create_dir_all(&other).unwrap();
    fs::rename(&z, other.join("code.zip")).unwrap();
    assert!(matches!(prepare(&other, &progress), State::Failed { message } if message.starts_with("Setting up could not finish. Close Pawscript and start it again") && message.contains("code.stamp")));
  }

  /// paw-7yed: a file in parts beside the exe is joined where it belongs and checked, and the parts are gone; an
  /// interruption carries on; a missing, short or damaged part is refused with its name.
  #[test]
  fn split_files_are_joined_in_place_checked_and_resumed() {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    let data: Vec<u8> = (0..2500u32).map(|i| (i * 7 % 251) as u8).collect();
    let sum = crate::files::hex(&<sha2::Sha256 as sha2::Digest>::digest(&data));
    let cut = || {
      for (i, c) in data.chunks(1000).enumerate() {
        fs::write(d.join(format!("w.pt.{:03}", i + 1)), c).unwrap();
      }
    };
    fs::write(d.join(PARTS), format!("# file bytes sha256 part-bytes count\ntrackers/.cache/m/w.pt 2500 {sum} 1000 3\n")).unwrap();
    assert!(pending_joins(d).unwrap_err().starts_with("w.pt.001, w.pt.002, w.pt.003 are missing or incomplete: download them again"));
    cut();
    fs::write(d.join("w.pt.002"), &data[1000..1500]).unwrap(); // cut off in the download
    assert_eq!(pending_joins(d).unwrap_err(), "w.pt.002 is missing or incomplete: download it again, put it beside Pawscript.exe, and start Pawscript again.");
    cut();
    let (todo, room) = pending_joins(d).unwrap();
    assert_eq!((todo.len(), room), (1, 1000));
    // interrupted: part 1 moved, part 2 half appended and still there
    let work = d.join("trackers/.cache/m/w.pt.joining");
    fs::create_dir_all(work.parent().unwrap()).unwrap();
    fs::rename(d.join("w.pt.001"), &work).unwrap();
    fs::OpenOptions::new().append(true).open(&work).unwrap().write_all(&data[1000..1400]).unwrap();
    let (todo, _) = pending_joins(d).unwrap();
    join(d, &todo[0]).unwrap();
    assert_eq!(fs::read(d.join("trackers/.cache/m/w.pt")).unwrap(), data);
    assert!(!d.join("w.pt.002").exists() && !d.join("w.pt.003").exists() && !work.exists());
    assert_eq!(pending_joins(d).unwrap(), (Vec::new(), 0)); // joined: later starts touch nothing
    // a damaged part: refused, the file in place untouched
    cut();
    fs::write(d.join("w.pt.003"), vec![0u8; 500]).unwrap();
    let (todo, _) = pending_joins(d).unwrap();
    assert!(matches!(join(d, &todo[0]), Err(State::Refused { message }) if message.starts_with("w.pt did not check out") && message.contains("w.pt.001, w.pt.002, w.pt.003")));
    assert_eq!(fs::read(d.join("trackers/.cache/m/w.pt")).unwrap(), data);
    assert!(parse_parts("runtime.zip 10 ab 4").is_err() && parse_parts("runtime.zip 10 ab 4 2").is_err()); // 10 bytes are not 2 parts of 4
  }

  #[cfg(windows)]
  #[test]
  fn a_runtime_in_parts_is_joined_then_unpacked() {
    let t = tempfile::tempdir().unwrap();
    let d = t.path().join("Pawscript");
    fs::create_dir_all(&d).unwrap();
    let z = zip(&d, "runtime", "r1", &[("python/python.exe", "py1"), ("ffmpeg.exe", "ff1")]);
    let data = fs::read(&z).unwrap();
    fs::remove_file(&z).unwrap();
    let pb = data.len().div_ceil(2);
    for (i, c) in data.chunks(pb).enumerate() {
      fs::write(d.join(format!("runtime.zip.{:03}", i + 1)), c).unwrap();
    }
    let sum = crate::files::hex(&<sha2::Sha256 as sha2::Digest>::digest(&data));
    fs::write(d.join(PARTS), format!("runtime.zip {} {sum} {pb} 2\n", data.len())).unwrap();
    let seen = std::cell::RefCell::new(Vec::new());
    let progress = |w: &str| seen.borrow_mut().push(w.to_string());
    fs::rename(d.join("runtime.zip.002"), t.path().join("later")).unwrap();
    assert!(matches!(prepare(&d, &progress), State::Refused { message } if message.starts_with("runtime.zip.002 is missing or incomplete")));
    assert!(seen.borrow().is_empty() && d.join("runtime.zip.001").exists()); // nothing touched
    fs::rename(t.path().join("later"), d.join("runtime.zip.002")).unwrap();
    assert_eq!(prepare(&d, &progress), State::Ready);
    assert_eq!(*seen.borrow(), ["checking", "runtime"]);
    assert_eq!(fs::read_to_string(d.join("python/python.exe")).unwrap(), "py1");
    assert!(!d.join("runtime.zip").exists(), "the joined runtime.zip is deleted once unpacked and stamped");
    assert!(!d.join("runtime.zip.001").exists() && !d.join("runtime.zip.002").exists());
    seen.borrow_mut().clear(); // second start: nothing to do (parts.txt still there, its zip installed)
    assert_eq!(prepare(&d, &progress), State::Ready);
    assert!(seen.borrow().is_empty());
  }

  /// paw-mkcd: the build extracted into a folder that already has someone's own python\ and ffmpeg.exe: refused, and
  /// not one of their files is touched (before, every item the zip holds was removed first).
  #[cfg(windows)]
  #[test]
  fn someone_elses_python_and_ffmpeg_are_never_removed() {
    let t = tempfile::tempdir().unwrap();
    let d = t.path().join("Downloads");
    fs::create_dir_all(d.join("python")).unwrap();
    fs::write(d.join("python").join("mine.py"), "theirs").unwrap();
    fs::write(d.join("ffmpeg.exe"), "their ffmpeg").unwrap();
    zip(&d, "runtime", "r1", &[("python/python.exe", "py1"), ("ffmpeg.exe", "ff1")]);
    let st = prepare(&d, &|_: &str| {});
    assert!(matches!(&st, State::Refused { message } if message.contains("python") && message.contains("ffmpeg.exe") && message.ends_with(OWN_FOLDER)), "{st:?}");
    assert_eq!(fs::read_to_string(d.join("python").join("mine.py")).unwrap(), "theirs");
    assert_eq!(fs::read_to_string(d.join("ffmpeg.exe")).unwrap(), "their ffmpeg");
    assert!(!d.join("python").join("python.exe").exists());
    // moved out of the way: it sets up, and its own interrupted unpack later is redone over its own files
    fs::rename(d.join("python"), t.path().join("their-python")).unwrap();
    fs::remove_file(d.join("ffmpeg.exe")).unwrap();
    assert_eq!(prepare(&d, &|_: &str| {}), State::Ready);
    fs::remove_file(d.join(".setup").join("runtime.stamp")).unwrap();
    fs::write(d.join("python").join("python.exe"), "half").unwrap();
    zip(&d, "runtime", "r1", &[("python/python.exe", "py1"), ("ffmpeg.exe", "ff1")]); // deleted after the first unpack
    assert_eq!(prepare(&d, &|_: &str| {}), State::Ready);
    assert_eq!(fs::read_to_string(d.join("python").join("python.exe")).unwrap(), "py1");
  }

  fn sha(b: &[u8]) -> String {
    crate::files::hex(&<sha2::Sha256 as sha2::Digest>::digest(b))
  }

  /// `data` cut into parts of `pb` beside the exe as `<name>.001`, ...; -> the parts.txt line with per-part hashes.
  fn cut(d: &Path, file: &str, data: &[u8], pb: usize) -> String {
    let name = file.rsplit('/').next().unwrap();
    let mut hashes = Vec::new();
    for (i, c) in data.chunks(pb).enumerate() {
      fs::write(d.join(format!("{name}.{:03}", i + 1)), c).unwrap();
      hashes.push(sha(c));
    }
    format!("{file} {} {} {pb} {} {}\n", data.len(), sha(data), hashes.len(), hashes.join(","))
  }

  /// paw-xm2c: with per-part hashes a damaged part is refused by name before it is appended; the good parts stay joined,
  /// the bad file stays for the friend to replace, and the join then carries on from there.
  #[test]
  fn a_damaged_part_is_named_and_only_it_must_come_again() {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    let data: Vec<u8> = (0..2500u32).map(|i| (i * 7 % 251) as u8).collect();
    fs::write(d.join(PARTS), cut(d, "trackers/.cache/m/w.pt", &data, 1000)).unwrap();
    fs::write(d.join("w.pt.003"), vec![0u8; 500]).unwrap(); // damaged in the download, right size
    let (todo, _) = pending_joins(d).unwrap();
    let st = join(d, &todo[0]);
    assert!(matches!(&st, Err(State::Refused { message }) if message.starts_with("w.pt.003 is missing, incomplete or damaged: download it again")), "{st:?}");
    let work = d.join("trackers/.cache/m/w.pt.joining");
    assert_eq!(fs::read(&work).unwrap(), data[..2000], "parts 1 and 2 stay joined");
    assert!(!d.join("w.pt.001").exists() && !d.join("w.pt.002").exists() && d.join("w.pt.003").exists());
    // the friend downloads part 3 again: only it is appended
    fs::write(d.join("w.pt.003"), &data[2000..]).unwrap();
    let (todo, room) = pending_joins(d).unwrap();
    assert_eq!(room, 500);
    join(d, &todo[0]).unwrap();
    assert_eq!(fs::read(d.join("trackers/.cache/m/w.pt")).unwrap(), data);
    assert!(!work.exists() && !d.join("w.pt.003").exists());
    // a damaged part 1 is refused before it is even moved
    fs::remove_file(d.join("trackers/.cache/m/w.pt")).unwrap();
    cut(d, "trackers/.cache/m/w.pt", &data, 1000);
    fs::write(d.join("w.pt.001"), vec![1u8; 1000]).unwrap();
    let (todo, _) = pending_joins(d).unwrap();
    assert!(matches!(join(d, &todo[0]), Err(State::Refused { message }) if message.starts_with("w.pt.001 is missing")));
    assert!(d.join("w.pt.001").exists() && !work.exists());
  }

  /// paw-xm2c: a .joining file left by an earlier, different download: dropped when the new download's part 1 is there,
  /// and checked part by part (and cut back to its last good part) when it is not.
  #[test]
  fn a_joining_file_of_another_download_is_not_reused() {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    let data: Vec<u8> = (0..2500u32).map(|i| (i * 13 % 241) as u8).collect();
    let work = d.join("w.pt.joining");
    fs::write(&work, vec![9u8; 1500]).unwrap(); // the older download's part 1 and half of part 2
    fs::write(d.join(PARTS), cut(d, "w.pt", &data, 1000)).unwrap();
    let (todo, _) = pending_joins(d).unwrap();
    join(d, &todo[0]).unwrap();
    assert_eq!(fs::read(d.join("w.pt")).unwrap(), data);
    // no part 1 this time: the stale .joining claims parts 1 and 2; part 1 does not check out: named, nothing appended
    fs::remove_file(d.join("w.pt")).unwrap();
    cut(d, "w.pt", &data, 1000);
    fs::remove_file(d.join("w.pt.001")).unwrap();
    fs::remove_file(d.join("w.pt.002")).unwrap();
    let mut stale = data[..2000].to_vec();
    stale[10] ^= 1;
    fs::write(&work, &stale).unwrap();
    let (todo, _) = pending_joins(d).unwrap();
    let st = join(d, &todo[0]);
    assert!(matches!(&st, Err(State::Refused { message }) if message.starts_with("w.pt.001, w.pt.002 are missing, incomplete or damaged")), "{st:?}");
    assert!(!work.exists() && d.join("w.pt.003").exists());
  }

  /// paw-6s20: someone's own python\ is refused before a part of runtime.zip is touched (the listing is read from the
  /// parts); a 6-field parts.txt with a wrong number of hashes is damaged.
  #[cfg(windows)]
  #[test]
  fn foreign_items_are_refused_before_the_parts_are_joined() {
    let t = tempfile::tempdir().unwrap();
    let d = t.path().join("Pawscript");
    fs::create_dir_all(d.join("python")).unwrap();
    fs::write(d.join("python").join("mine.py"), "theirs").unwrap();
    let z = zip(&d, "runtime", "r1", &[("python/python.exe", "py1"), ("ffmpeg.exe", "ff1")]);
    let data = fs::read(&z).unwrap();
    fs::remove_file(&z).unwrap();
    fs::write(d.join(PARTS), cut(&d, "runtime.zip", &data, data.len().div_ceil(3))).unwrap();
    let seen = std::cell::RefCell::new(Vec::new());
    let st = prepare(&d, &|w: &str| seen.borrow_mut().push(w.to_string()));
    assert!(matches!(&st, State::Refused { message } if message.contains("python") && message.ends_with(OWN_FOLDER)), "{st:?}");
    assert!(seen.borrow().is_empty() && (1..=3).all(|k| d.join(format!("runtime.zip.{k:03}")).exists()));
    assert_eq!(longest_entry(&split_listing(&d, &parse_parts(&fs::read_to_string(d.join(PARTS)).unwrap()).unwrap()[0]).unwrap()), "python/python.exe".len());
    // moved out of the way: joined (with per-part checks) and unpacked
    fs::rename(d.join("python"), t.path().join("their-python")).unwrap();
    assert_eq!(prepare(&d, &|_: &str| {}), State::Ready);
    assert_eq!(fs::read_to_string(d.join("python/python.exe")).unwrap(), "py1");
    let h = "a".repeat(64);
    assert!(parse_parts(&format!("w.pt 10 {h} 4 3 {h},{h}")).is_err() && parse_parts(&format!("w.pt 10 {h} 4 3 {h},{h},{h}")).is_ok());
  }

  /// paw-366o: a panic in the setup thread is a setup error that says what to do, not an endless "Unpacking".
  #[test]
  fn a_panic_in_the_setup_is_a_setup_error() {
    let st = guarded(|| panic!("boom"));
    assert!(matches!(&st, State::Failed { message } if message.starts_with("Setting up could not finish") && message.contains("boom")), "{st:?}");
    assert_eq!(guarded(|| State::Ready), State::Ready);
  }
}

// ---------------------------------------------------------------- review (2026-11-18): first-start order and the joiner
#[cfg(test)]
mod review {
  use super::*;

  fn sha(b: &[u8]) -> String {
    crate::files::hex(&<sha2::Sha256 as sha2::Digest>::digest(b))
  }

  /// QA on a second PC: the path-length refusal must come BEFORE the join (which renames part 1 and deletes the other
  /// parts). Here the folder is long enough that the runtime's deepest entry passes MAX_PATH: prepare must refuse with
  /// the parts still where the friend put them.
  #[cfg(windows)]
  #[test]
  fn path_length_is_refused_before_the_parts_are_joined() {
    let t = tempfile::tempdir().unwrap();
    // the zip, made in a short folder (tar.exe cannot read past MAX_PATH)
    let zdir = t.path().join("z");
    let deep = format!("python/Lib/site-packages/{}/m.py", "p".repeat(60));
    let src = zdir.join("src");
    fs::create_dir_all(src.join(Path::new(&deep).parent().unwrap())).unwrap();
    fs::write(src.join(&deep), "x").unwrap();
    fs::write(src.join("runtime.stamp"), "r1").unwrap();
    let z = zdir.join("runtime.zip");
    assert!(tar().arg("--format").arg("zip").arg("-c").arg("-f").arg(&z).arg("-C").arg(&src).args(["python", "runtime.stamp"]).status().unwrap().success());
    let data = fs::read(&z).unwrap();
    // the Pawscript folder: long, but every file the join touches still fits MAX_PATH
    let d = t.path().join("P".repeat(259 - path_chars(t.path()) - 1 - 40));
    fs::create_dir_all(&d).unwrap();
    assert!(path_chars(&d) + 1 + deep.len() > MAX_PATH_CHARS && path_chars(&d) + 20 < MAX_PATH_CHARS);
    let pb = data.len().div_ceil(2);
    for (i, c) in data.chunks(pb).enumerate() {
      fs::write(d.join(format!("runtime.zip.{:03}", i + 1)), c).unwrap();
    }
    fs::write(d.join(PARTS), format!("runtime.zip {} {} {pb} 2\n", data.len(), sha(&data))).unwrap();
    let st = prepare(&d, &|_: &str| {});
    assert!(matches!(&st, State::Refused { message } if message.contains("too long")), "{st:?}");
    assert!(d.join("runtime.zip.001").exists() && d.join("runtime.zip.002").exists(), "refused for the path only after joining (and deleting) the parts");
  }

  /// A friend set up once, then deleted the 3 GB runtime.zip beside the exe (it is unpacked, after all). With parts.txt
  /// still there, every later start is refused: "runtime.zip.001, runtime.zip.002 are missing: download them again".
  #[test]
  fn deleting_the_joined_zip_after_setup_does_not_brick_the_start() {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    fs::write(d.join(PARTS), format!("runtime.zip 2500 {} 1000 3\n", sha(b"whatever"))).unwrap();
    fs::create_dir_all(d.join(SETUP_DIR)).unwrap();
    fs::write(d.join(SETUP_DIR).join("runtime.stamp"), "r1").unwrap();
    fs::create_dir_all(d.join("python")).unwrap();
    fs::write(d.join("python").join("python.exe"), "py").unwrap();
    let st = prepare(d, &|_: &str| {});
    assert_eq!(st, State::Ready, "an installed runtime with no zip left is refused");
  }

  /// One damaged part (the last) costs a re-download of every part: parts 1..n-1 are consumed (renamed / deleted) before
  /// the whole file's sha256 is checked, and the .joining file is deleted on a mismatch. Expected: the good parts (or the
  /// joined prefix) survive so only the bad part must be fetched again (e.g. a per-part sha256 in parts.txt, checked
  /// before a part is appended and deleted).
  #[test]
  fn a_damaged_part_costs_only_that_part() {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    let data: Vec<u8> = (0..2500u32).map(|i| (i * 7 % 251) as u8).collect();
    fs::write(d.join(PARTS), format!("w.pt 2500 {} 1000 3\n", sha(&data))).unwrap();
    for (i, c) in data.chunks(1000).enumerate() {
      fs::write(d.join(format!("w.pt.{:03}", i + 1)), c).unwrap();
    }
    fs::write(d.join("w.pt.003"), vec![0u8; 500]).unwrap(); // damaged in the download, right size
    let (todo, _) = pending_joins(d).unwrap();
    let r = join(d, &todo[0]);
    assert!(r.is_err());
    let left: u64 = ["w.pt.001", "w.pt.002", "w.pt.joining"].iter().filter_map(|n| file_len(&d.join(n))).sum();
    assert!(left >= 2000, "the two good parts are gone ({left} bytes of them left): the friend must download all three again");
  }

  /// parts.txt is read as given: a name with `..` or a drive is joined, renamed into and removed (remove() deletes a folder
  /// recursively) outside the Pawscript folder; huge counts overflow.
  #[test]
  fn parts_txt_names_and_numbers_are_checked() {
    assert!(parse_parts(&format!("../outside.bin 1 {} 1 1", "0".repeat(64))).is_err(), "`..` accepted");
    assert!(parse_parts(&format!("C:/Windows/x.bin 1 {} 1 1", "0".repeat(64))).is_err(), "a drive accepted");
    let r = std::panic::catch_unwind(|| parse_parts(&format!("x 1 {} 2 9223372036854775809", "0".repeat(64))));
    assert!(matches!(r, Ok(Err(_))), "count 2^63+1: {r:?} (overflow: a panic in debug; in release it wraps, is accepted, and pending_joins loops 2^63 times)");
  }
}
