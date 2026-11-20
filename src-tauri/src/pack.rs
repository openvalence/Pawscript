//! .pawpack (paw-2k9s): one file that carries a project to a friend: the video byte for byte, its funscripts, the
//! .pawproj and the .pawruns, as a plain ZIP64 archive of STORED entries (no compression: video does not compress,
//! and stored entries stay fast and seekable), the manifest `pawpack.json` first. Any zip tool unpacks it.
//!
//! Written in one streaming pass into a temp file beside the destination (cancel or failure leaves nothing): each
//! entry's CRC-32 and SHA-256 are computed while it is copied, its local header is patched in place afterwards, and
//! the manifest (written first with zeroed hashes of the same length) is rewritten with the real ones at the end.
//! Read back: the central directory, the manifest (a newer major format is refused), then every file the manifest
//! lists is copied out under a checked name and its SHA-256 compared. Format: src/app/PACK.md.

use crate::error::{At, Error, Result};
use crate::ffmpeg::Job;
use crate::files::{hex, path_str};
use crate::media::Event;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

pub const MANIFEST: &str = "pawpack.json";
pub const FORMAT: &str = "pawpack";
/// The newest major format this build reads (a minor bump only adds keys).
pub const MAJOR: u64 = 1;
const CHUNK: usize = 1 << 20;
const DOS_DATE: u16 = 0x0021; // 1980-01-01, time 00:00: the manifest carries the real date
const MAX_TEXT: u64 = 64 << 20; // a manifest / central directory larger than this is not ours

/// One file to pack: a file on disk (`path`) or text (`text`). `role`: video | script | project | runs (the manifest's).
#[derive(Debug, Clone, serde::Deserialize)]
pub struct Entry {
  pub name: String,
  #[serde(default)]
  pub role: Option<String>,
  #[serde(default)]
  pub path: Option<PathBuf>,
  #[serde(default)]
  pub text: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct Packed {
  pub path: String,
  pub size: u64,
}

/// An entry name that is safe to create under the unpack folder: relative, '/'-separated, no '..', no drive or
/// device name, nothing Windows cannot hold. -> the relative path.
pub fn safe_name(name: &str) -> Result<PathBuf> {
  let bad = |why: &str| Err(Error::new("unsafe_name", format!("{name:?}: {why}, the pack is refused")));
  if name.is_empty() || name.len() > 400 {
    return bad("empty or too long");
  }
  if name.starts_with('/') || name.contains('\\') || name.contains(':') {
    return bad("an absolute path or a drive");
  }
  if name.chars().any(|c| c.is_control() || "<>\"|?*".contains(c)) {
    return bad("a character a file name cannot hold");
  }
  let mut p = PathBuf::new();
  for part in name.split('/') {
    if part.is_empty() || part == "." || part == ".." {
      return bad("a path that leaves its folder");
    }
    let stem = part.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    // paw-sr01: CONIN$ / CONOUT$, and COM / LPT with a superscript digit, are devices too
    let digit = |c: Option<char>| c.is_some_and(|c| c.is_ascii_digit() || "\u{b9}\u{b2}\u{b3}".contains(c));
    let device = ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].contains(&stem.as_str())
      || (stem.chars().count() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && digit(stem.chars().nth(3)));
    if device || part.ends_with('.') || part.ends_with(' ') {
      return bad("a name Windows reserves");
    }
    p.push(part);
  }
  Ok(p)
}

/// The manifest's format check: ours, and a major version this build reads.
pub fn check_manifest(m: &Value) -> Result<()> {
  if m.get("format").and_then(Value::as_str) != Some(FORMAT) {
    return Err(Error::new("not_a_pack", "this file is not a Pawscript pack (no pawpack manifest)"));
  }
  let v = m.get("version").and_then(Value::as_str).unwrap_or("");
  let major = v.split('.').next().and_then(|s| s.parse::<u64>().ok()).ok_or_else(|| Error::new("not_a_pack", format!("pack version {v:?} is not a version")))?;
  if major > MAJOR {
    return Err(Error::new("too_new", format!("made by a newer Pawscript (pack format {v}), update Pawscript to open it")));
  }
  Ok(())
}

/// Whole-word, case-insensitive: `word` (this computer's name) in `text`.
fn names(text: &str, word: &str) -> bool {
  if word.len() < 3 {
    return false;
  }
  let (t, w) = (text.to_lowercase(), word.to_lowercase());
  let part = |c: char| c.is_alphanumeric() || c == '-' || c == '_';
  t.match_indices(&w).any(|(i, _)| !t[..i].chars().next_back().is_some_and(part) && !t[i + w.len()..].chars().next().is_some_and(part))
}

fn host() -> String {
  std::env::var(if cfg!(windows) { "COMPUTERNAME" } else { "HOSTNAME" }).unwrap_or_default()
}

// ---------------------------------------------------------------- zip records

fn local_header(name: &str, crc: u32, size: u64) -> Vec<u8> {
  let mut h = Vec::with_capacity(50 + name.len());
  h.extend(0x0403_4b50u32.to_le_bytes());
  h.extend(45u16.to_le_bytes()); // version needed: ZIP64
  h.extend(0x0800u16.to_le_bytes()); // names are UTF-8
  h.extend(0u16.to_le_bytes()); // stored
  h.extend(0u16.to_le_bytes());
  h.extend(DOS_DATE.to_le_bytes());
  h.extend(crc.to_le_bytes());
  h.extend(u32::MAX.to_le_bytes()); // sizes: in the ZIP64 extra
  h.extend(u32::MAX.to_le_bytes());
  h.extend((name.len() as u16).to_le_bytes());
  h.extend(20u16.to_le_bytes());
  h.extend(name.as_bytes());
  h.extend(1u16.to_le_bytes());
  h.extend(16u16.to_le_bytes());
  h.extend(size.to_le_bytes());
  h.extend(size.to_le_bytes());
  h
}

struct Written {
  name: String,
  crc: u32,
  size: u64,
  off: u64,
}

fn central(e: &Written) -> Vec<u8> {
  let mut h = Vec::with_capacity(80 + e.name.len());
  h.extend(0x0201_4b50u32.to_le_bytes());
  h.extend(45u16.to_le_bytes()); // made by: 4.5, MS-DOS attributes
  h.extend(45u16.to_le_bytes());
  h.extend(0x0800u16.to_le_bytes());
  h.extend(0u16.to_le_bytes());
  h.extend(0u16.to_le_bytes());
  h.extend(DOS_DATE.to_le_bytes());
  h.extend(e.crc.to_le_bytes());
  h.extend(u32::MAX.to_le_bytes());
  h.extend(u32::MAX.to_le_bytes());
  h.extend((e.name.len() as u16).to_le_bytes());
  h.extend(28u16.to_le_bytes());
  h.extend(0u16.to_le_bytes()); // comment
  h.extend(0u16.to_le_bytes()); // disk
  h.extend(0u16.to_le_bytes()); // internal attributes
  h.extend(0u32.to_le_bytes()); // external attributes
  h.extend(u32::MAX.to_le_bytes()); // offset: in the ZIP64 extra
  h.extend(e.name.as_bytes());
  h.extend(1u16.to_le_bytes());
  h.extend(24u16.to_le_bytes());
  h.extend(e.size.to_le_bytes());
  h.extend(e.size.to_le_bytes());
  h.extend(e.off.to_le_bytes());
  h
}

fn end_records(n: u64, cd_off: u64, cd_size: u64) -> Vec<u8> {
  let z64 = cd_off + cd_size;
  let mut h = Vec::with_capacity(98);
  h.extend(0x0606_4b50u32.to_le_bytes());
  h.extend(44u64.to_le_bytes());
  h.extend(45u16.to_le_bytes());
  h.extend(45u16.to_le_bytes());
  h.extend(0u32.to_le_bytes());
  h.extend(0u32.to_le_bytes());
  h.extend(n.to_le_bytes());
  h.extend(n.to_le_bytes());
  h.extend(cd_size.to_le_bytes());
  h.extend(cd_off.to_le_bytes());
  h.extend(0x0706_4b50u32.to_le_bytes()); // ZIP64 locator
  h.extend(0u32.to_le_bytes());
  h.extend(z64.to_le_bytes());
  h.extend(1u32.to_le_bytes());
  let small = |v: u64, max: u64| v.min(max);
  h.extend(0x0605_4b50u32.to_le_bytes());
  h.extend(0u16.to_le_bytes());
  h.extend(0u16.to_le_bytes());
  h.extend((small(n, 0xFFFF) as u16).to_le_bytes());
  h.extend((small(n, 0xFFFF) as u16).to_le_bytes());
  h.extend((small(cd_size, 0xFFFF_FFFF) as u32).to_le_bytes());
  h.extend((small(cd_off, 0xFFFF_FFFF) as u32).to_le_bytes());
  h.extend(0u16.to_le_bytes());
  h
}

/// Progress over `total` bytes, at most ~10 events a second.
struct Meter<'a> {
  emit: &'a dyn Fn(Event),
  stage: &'static str,
  total: u64,
  done: u64,
  last: Option<Instant>,
}
impl Meter<'_> {
  fn add(&mut self, n: u64) {
    self.done += n;
    if self.last.is_none_or(|t| t.elapsed().as_millis() >= 100) {
      self.last = Some(Instant::now());
      (self.emit)(Event::Progress { stage: self.stage, fraction: self.done as f64 / self.total.max(1) as f64 });
    }
  }
}

/// Copies exactly `len` bytes from `r` to `w` (cancel checked between reads) -> (crc32, sha256 hex).
fn copy(job: &Job, r: &mut impl Read, w: &mut impl Write, len: u64, meter: &mut Meter, at: &Path) -> Result<(u32, String)> {
  let (mut crc, mut sha, mut buf, mut left) = (crc32fast::Hasher::new(), Sha256::new(), vec![0u8; CHUNK], len);
  while left > 0 {
    job.check()?;
    let n = r.read(&mut buf[..CHUNK.min(left as usize)]).at(at)?;
    if n == 0 {
      return Err(Error::new("changed", format!("{}: shorter than when packing began (changed meanwhile)", at.display())));
    }
    crc.update(&buf[..n]);
    sha.update(&buf[..n]);
    w.write_all(&buf[..n]).at(at)?;
    left -= n as u64;
    meter.add(n as u64);
  }
  Ok((crc.finalize(), hex(&sha.finalize())))
}

// ---------------------------------------------------------------- write

/// Writes `entries` as a .pawpack at `dest` (replaced if it exists). `manifest`: the front end's manifest object; its
/// `files` is filled here ({name, role, size, sha256} per entry, in order). Refuses a text entry (or the manifest) that
/// names this computer (privacy: the front end has already made every path relative).
pub fn write(job: &Job, dest: &Path, manifest: &Value, entries: &[Entry], emit: &dyn Fn(Event)) -> Result<Packed> {
  if !manifest.is_object() {
    return Err(Error::invalid("pack manifest: expected an object"));
  }
  let mut seen = std::collections::HashSet::from([MANIFEST.to_string()]);
  let mut sizes = Vec::with_capacity(entries.len());
  for e in entries {
    safe_name(&e.name)?;
    if !seen.insert(e.name.to_lowercase()) {
      return Err(Error::invalid(format!("{}: in the pack twice (or named like the manifest)", e.name)));
    }
    sizes.push(match (&e.path, &e.text) {
      (Some(p), None) => fs::metadata(p).at(p)?.len(),
      (None, Some(t)) => t.len() as u64,
      _ => return Err(Error::invalid(format!("{}: give either a path or a text", e.name))),
    });
  }
  let host = host();
  let files = |shas: &[String]| -> Value {
    Value::Array(entries.iter().zip(&sizes).zip(shas).map(|((e, s), h)| json!({ "name": e.name, "role": e.role, "size": s, "sha256": h })).collect())
  };
  let man = |shas: &[String]| -> Result<Vec<u8>> {
    let mut m = manifest.clone();
    m["files"] = files(shas);
    serde_json::to_vec_pretty(&m).map_err(|e| Error::new("internal", e.to_string()))
  };
  let first = man(&vec!["0".repeat(64); entries.len()])?;
  for (name, text) in std::iter::once((MANIFEST, std::str::from_utf8(&first).unwrap_or(""))).chain(entries.iter().filter_map(|e| Some((e.name.as_str(), e.text.as_deref()?)))) {
    if names(text, &host) {
      return Err(Error::new("private", format!("{name} names this computer ({host}): not packed")));
    }
  }

  let dir = match dest.parent() {
    Some(d) if !d.as_os_str().is_empty() => d.to_path_buf(),
    _ => PathBuf::from("."),
  };
  let fname = dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
  let mut tmp = tempfile::Builder::new().prefix(&format!(".{fname}.")).suffix(".tmp").tempfile_in(&dir).at(&dir)?;
  let f = tmp.as_file_mut();
  let mut meter = Meter { emit, stage: "pack", total: sizes.iter().sum::<u64>() + first.len() as u64, done: 0, last: None };
  let mut out: Vec<Written> = Vec::with_capacity(entries.len() + 1);
  let mut shas = Vec::with_capacity(entries.len());

  // the manifest first, with zeroed hashes of the same length (rewritten at the end)
  let mut pos = 0u64;
  let head = local_header(MANIFEST, crc32fast::hash(&first), first.len() as u64);
  f.write_all(&head).at(dest)?;
  let man_data = head.len() as u64;
  f.write_all(&first).at(dest)?;
  out.push(Written { name: MANIFEST.into(), crc: 0, size: first.len() as u64, off: pos });
  pos = man_data + first.len() as u64;

  for (e, &size) in entries.iter().zip(&sizes) {
    let head = local_header(&e.name, 0, size);
    f.write_all(&head).at(dest)?;
    let (crc, sha) = match (&e.path, &e.text) {
      (Some(p), _) => {
        let mut src = File::open(p).at(p)?;
        let r = copy(job, &mut src, f, size, &mut meter, p)?;
        if src.read(&mut [0u8; 1]).at(p)? != 0 {
          return Err(Error::new("changed", format!("{}: grew while packing (changed meanwhile)", p.display())));
        }
        r
      }
      (_, Some(t)) => copy(job, &mut t.as_bytes(), f, size, &mut meter, dest)?,
      _ => unreachable!(),
    };
    // the real CRC into the local header, then back to the end
    f.seek(SeekFrom::Start(pos + 14)).at(dest)?;
    f.write_all(&crc.to_le_bytes()).at(dest)?;
    let end = pos + head.len() as u64 + size;
    f.seek(SeekFrom::Start(end)).at(dest)?;
    out.push(Written { name: e.name.clone(), crc, size, off: pos });
    shas.push(sha);
    pos = end;
  }

  let last = man(&shas)?;
  if last.len() != first.len() {
    return Err(Error::new("internal", "pack manifest changed length"));
  }
  out[0].crc = crc32fast::hash(&last);
  f.seek(SeekFrom::Start(14)).at(dest)?;
  f.write_all(&out[0].crc.to_le_bytes()).at(dest)?;
  f.seek(SeekFrom::Start(man_data)).at(dest)?;
  f.write_all(&last).at(dest)?;
  f.seek(SeekFrom::Start(pos)).at(dest)?;

  let cd: Vec<u8> = out.iter().flat_map(central).collect();
  f.write_all(&cd).at(dest)?;
  f.write_all(&end_records(out.len() as u64, pos, cd.len() as u64)).at(dest)?;
  f.sync_all().at(dest)?;
  job.check()?;
  let size = f.metadata().at(dest)?.len();
  tmp.persist(dest).map_err(|e| Error::io(e.error, dest))?;
  emit(Event::Progress { stage: "pack", fraction: 1.0 });
  Ok(Packed { path: path_str(dest), size })
}

// ---------------------------------------------------------------- read

/// One entry of an archive: where its data starts and how it is stored.
#[derive(Debug, Clone)]
pub struct Item {
  pub name: String,
  pub method: u16,
  pub crc: u32,
  pub size: u64,
  pub data: u64,
  /// The local header's offset and the stored (compressed) size: the bytes [off, data + csize) are this entry's.
  pub off: u64,
  pub csize: u64,
}

fn u16_at(b: &[u8], i: usize) -> u16 {
  u16::from_le_bytes([b[i], b[i + 1]])
}
fn u32_at(b: &[u8], i: usize) -> u32 {
  u32::from_le_bytes(b[i..i + 4].try_into().unwrap())
}
fn u64_at(b: &[u8], i: usize) -> u64 {
  u64::from_le_bytes(b[i..i + 8].try_into().unwrap())
}

fn read_at<R: Read + Seek>(f: &mut R, at: u64, len: usize, path: &Path) -> Result<Vec<u8>> {
  let mut b = vec![0u8; len];
  f.seek(SeekFrom::Start(at)).at(path)?;
  f.read_exact(&mut b).at(path)?;
  Ok(b)
}

/// The archive's entries (central directory; ZIP64 or not).
pub fn list(f: &mut File, path: &Path) -> Result<Vec<Item>> {
  let len = f.metadata().at(path)?.len();
  list_in(f, len, path)
}

/// `list` over any seekable reader of `len` bytes (portable.rs reads a zip still in parts). paw-ijyn / paw-sr01: every
/// entry's local header must carry the central directory's name, and no two entries may share bytes (one stored entry
/// listed under many names would unpack many copies from a small pack).
pub fn list_in<R: Read + Seek>(f: &mut R, len: u64, path: &Path) -> Result<Vec<Item>> {
  let corrupt = |why: &str| Error::new("corrupt", format!("{}: not a readable pack ({why})", path.display()));
  let tail = len.min(22 + 65535 + 20);
  let t = read_at(f, len - tail, tail as usize, path)?;
  let at = (0..t.len().saturating_sub(21)).rev().find(|&i| u32_at(&t, i) == 0x0605_4b50).ok_or_else(|| corrupt("no end of central directory"))?;
  let (mut n, mut cd_size, mut cd_off) = (u16_at(&t, at + 10) as u64, u32_at(&t, at + 12) as u64, u32_at(&t, at + 16) as u64);
  if at >= 20 && u32_at(&t, at - 20) == 0x0706_4b50 {
    let z = u64_at(&t, at - 20 + 8);
    if z.checked_add(56).is_none_or(|e| e > len) {
      return Err(corrupt("ZIP64 record out of range"));
    }
    let r = read_at(f, z, 56, path)?;
    if u32_at(&r, 0) != 0x0606_4b50 {
      return Err(corrupt("bad ZIP64 record"));
    }
    (n, cd_size, cd_off) = (u64_at(&r, 32), u64_at(&r, 40), u64_at(&r, 48));
  }
  if cd_size > MAX_TEXT || cd_off.checked_add(cd_size).is_none_or(|e| e > len) {
    return Err(corrupt("central directory out of range"));
  }
  let cd = read_at(f, cd_off, cd_size as usize, path)?;
  let mut items = Vec::new();
  let mut i = 0usize;
  for _ in 0..n {
    if i + 46 > cd.len() || u32_at(&cd, i) != 0x0201_4b50 {
      return Err(corrupt("bad central directory entry"));
    }
    let (method, crc) = (u16_at(&cd, i + 10), u32_at(&cd, i + 16));
    let (mut csize, mut size) = (u32_at(&cd, i + 20) as u64, u32_at(&cd, i + 24) as u64);
    let (nl, xl, cl) = (u16_at(&cd, i + 28) as usize, u16_at(&cd, i + 30) as usize, u16_at(&cd, i + 32) as usize);
    let mut off = u32_at(&cd, i + 42) as u64;
    if i + 46 + nl + xl + cl > cd.len() {
      return Err(corrupt("central directory entry out of range"));
    }
    let name = String::from_utf8(cd[i + 46..i + 46 + nl].to_vec()).map_err(|_| corrupt("a name that is not UTF-8"))?;
    let (mut x, xe) = (i + 46 + nl, i + 46 + nl + xl);
    while x + 4 <= xe {
      let (id, sz) = (u16_at(&cd, x), u16_at(&cd, x + 2) as usize);
      if id == 1 {
        let mut k = x + 4;
        let mut take = |v: &mut u64| {
          if *v == 0xFFFF_FFFF && k + 8 <= x + 4 + sz && k + 8 <= xe {
            *v = u64_at(&cd, k);
            k += 8;
          }
        };
        take(&mut size);
        take(&mut csize);
        take(&mut off);
      }
      x += 4 + sz;
    }
    if off.checked_add(30).is_none_or(|e| e > len) {
      return Err(corrupt("entry out of range"));
    }
    let lh = read_at(f, off, 30, path)?;
    if u32_at(&lh, 0) != 0x0403_4b50 {
      return Err(corrupt("bad local header"));
    }
    let lnl = u16_at(&lh, 26) as u64;
    if lnl as usize != nl || off + 30 + lnl > len || read_at(f, off + 30, nl, path)? != cd[i + 46..i + 46 + nl] {
      return Err(corrupt("a local header names another file than the directory"));
    }
    let data = off + 30 + lnl + u16_at(&lh, 28) as u64;
    if method == 0 && csize != size {
      return Err(corrupt("stored entry with two sizes"));
    }
    if data.checked_add(csize).is_none_or(|e| e > cd_off) {
      return Err(corrupt("entry data out of range"));
    }
    items.push(Item { name, method, crc, size, data, off, csize });
    i += 46 + nl + xl + cl;
  }
  let mut by_off: Vec<&Item> = items.iter().collect();
  by_off.sort_by_key(|it| it.off);
  if by_off.windows(2).any(|w| w[0].data + w[0].csize > w[1].off) {
    return Err(corrupt("two entries share their bytes"));
  }
  Ok(items)
}

/// The pack's manifest (checked: ours, a major version this build reads, CRC intact).
pub fn manifest(path: &Path) -> Result<Value> {
  let mut f = File::open(path).at(path)?;
  let items = list(&mut f, path)?;
  read_manifest(&mut f, &items, path)
}

fn read_manifest(f: &mut File, items: &[Item], path: &Path) -> Result<Value> {
  let it = items.iter().find(|i| i.name == MANIFEST).ok_or_else(|| Error::new("not_a_pack", format!("{}: not a Pawscript pack (no {MANIFEST})", path.display())))?;
  if it.method != 0 || it.size > MAX_TEXT {
    return Err(Error::new("not_a_pack", format!("{}: its manifest is compressed or too large", path.display())));
  }
  let b = read_at(f, it.data, it.size as usize, path)?;
  if crc32fast::hash(&b) != it.crc {
    return Err(Error::new("corrupt", format!("{}: the manifest is damaged", path.display())));
  }
  let m: Value = serde_json::from_slice(&b).map_err(|e| Error::new("corrupt", format!("{}: the manifest is not JSON ({e})", path.display())))?;
  check_manifest(&m)?;
  Ok(m)
}

/// Unpacks every file the manifest lists into `dir` (created; an existing file is never replaced), checking each
/// file's SHA-256 and size against the manifest. -> the files written, each with its SHA-256. On any failure or cancel,
/// every file written so far is removed again.
pub fn unpack(job: &Job, pack: &Path, dir: &Path, emit: &dyn Fn(Event), writable: &dyn Fn(&Path) -> Result<()>) -> Result<Vec<(PathBuf, String)>> {
  let mut f = File::open(pack).at(pack)?;
  let items = list(&mut f, pack)?;
  let m = read_manifest(&mut f, &items, pack)?;
  let list = m.get("files").and_then(Value::as_array).ok_or_else(|| Error::new("corrupt", format!("{}: the manifest lists no files", pack.display())))?;
  let mut todo = Vec::with_capacity(list.len());
  for v in list {
    let name = v.get("name").and_then(Value::as_str).unwrap_or("");
    let rel = safe_name(name)?;
    let sha = v.get("sha256").and_then(Value::as_str).unwrap_or("").to_ascii_lowercase();
    let it = items.iter().find(|i| i.name == name).ok_or_else(|| Error::new("corrupt", format!("{name}: listed in the manifest but not in the pack")))?;
    if it.method != 0 {
      return Err(Error::new("compressed", format!("{name}: compressed in this pack; unpack it with a zip tool")));
    }
    if v.get("size").and_then(Value::as_u64) != Some(it.size) || sha.len() != 64 {
      return Err(Error::new("corrupt", format!("{name}: its size or hash in the manifest does not match the pack")));
    }
    todo.push((name.to_string(), dir.join(rel), it.clone(), sha));
  }
  // paw-ijyn: what the manifest declares must fit on the drive before anything is written
  let total: u64 = todo.iter().map(|t| t.2.size).sum();
  if let Some(free) = dir.ancestors().find(|a| a.is_dir()).and_then(crate::portable::free_bytes) {
    if total > free {
      return Err(Error::new("no_space", format!("{}: unpacking needs {:.1} GB and the drive has {:.1} GB free", pack.display(), total as f64 / 1e9, free as f64 / 1e9)));
    }
  }
  let mut meter = Meter { emit, stage: "unpack", total, done: 0, last: None };
  let mut written: Vec<(PathBuf, String)> = Vec::new();
  let mut run = || -> Result<()> {
    for (name, target, it, sha) in &todo {
      writable(target)?;
      let parent = target.parent().unwrap_or(dir);
      fs::create_dir_all(parent).at(parent)?;
      if target.exists() {
        return Err(Error::new("exists", format!("{}: already there; nothing is replaced", target.display())));
      }
      let mut tmp = tempfile::Builder::new().prefix(".unpack.").suffix(".tmp").tempfile_in(parent).at(parent)?;
      f.seek(SeekFrom::Start(it.data)).at(pack)?;
      let (_, got) = copy(job, &mut (&mut f).take(it.size), tmp.as_file_mut(), it.size, &mut meter, pack)?;
      if &got != sha {
        return Err(Error::new("corrupt", format!("{name}: its contents do not match the pack's manifest (damaged or changed)")));
      }
      tmp.as_file().sync_all().at(target)?;
      tmp.persist_noclobber(target).map_err(|e| Error::io(e.error, target))?;
      written.push((target.clone(), sha.clone()));
    }
    Ok(())
  };
  match run() {
    Ok(()) => {
      emit(Event::Progress { stage: "unpack", fraction: 1.0 });
      Ok(written)
    }
    Err(e) => {
      for (p, _) in &written {
        let _ = fs::remove_file(p);
      }
      Err(e)
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn gen(p: &Path, len: usize, seed: u8) {
    fs::write(p, (0..len).map(|i| (i as u8).wrapping_mul(31).wrapping_add(seed)).collect::<Vec<_>>()).unwrap();
  }
  fn man() -> Value {
    json!({ "format": FORMAT, "version": "1.0", "created": "2026-11-18T00:00:00Z" })
  }
  fn entries(dir: &Path) -> Vec<Entry> {
    gen(&dir.join("clip.mp4"), 3 * CHUNK + 123, 7);
    vec![
      Entry { name: "clip.mp4".into(), role: Some("video".into()), path: Some(dir.join("clip.mp4")), text: None },
      Entry { name: "clip.funscript".into(), role: Some("script".into()), path: None, text: Some("{\"actions\":[]}".into()) },
      Entry { name: "clip.pawproj".into(), role: Some("project".into()), path: None, text: Some("{\"format\":\"pawproj\"} ü".into()) },
    ]
  }

  #[test]
  fn names_are_checked() {
    for ok in ["clip.mp4", "a b/c.funscript", "夏.pawproj"] {
      assert!(safe_name(ok).is_ok(), "{ok}");
    }
    for bad in ["", "../x", "a/../../x", "/etc/x", "C:/x", "C:x", "a\\b", "a//b", "./x", "con.txt", "COM1", "x.", "x ", "a?b"] {
      assert_eq!(safe_name(bad).unwrap_err().code, "unsafe_name", "{bad}");
    }
  }

  #[test]
  fn manifest_versions() {
    assert!(check_manifest(&man()).is_ok());
    assert!(check_manifest(&json!({ "format": FORMAT, "version": "1.7" })).is_ok());
    assert_eq!(check_manifest(&json!({ "format": FORMAT, "version": "2.0" })).unwrap_err().code, "too_new");
    assert_eq!(check_manifest(&json!({ "format": "zip", "version": "1.0" })).unwrap_err().code, "not_a_pack");
    assert_eq!(check_manifest(&json!({ "format": FORMAT, "version": 1 })).unwrap_err().code, "not_a_pack");
  }

  #[test]
  fn host_word() {
    assert!(names("made on DESKTOP-AB12 today", "desktop-ab12"));
    assert!(!names("made on DESKTOP-AB123 today", "desktop-ab12"));
    assert!(!names("anything", "ab"));
  }

  #[test]
  fn round_trip_manifest_first_and_hashes() {
    let t = tempfile::tempdir().unwrap();
    let es = entries(t.path());
    let dest = t.path().join("out.pawpack");
    let job = Job::default();
    let ev = std::sync::Mutex::new(Vec::new());
    let p = write(&job, &dest, &man(), &es, &|e| ev.lock().unwrap().push(e)).unwrap();
    assert_eq!(p.size, fs::metadata(&dest).unwrap().len());
    // manifest is the first entry, at offset 0
    let mut f = File::open(&dest).unwrap();
    let items = list(&mut f, &dest).unwrap();
    assert_eq!(items.iter().map(|i| i.name.as_str()).collect::<Vec<_>>(), [MANIFEST, "clip.mp4", "clip.funscript", "clip.pawproj"]);
    assert_eq!(&fs::read(&dest).unwrap()[30..30 + MANIFEST.len()], MANIFEST.as_bytes());
    let m = manifest(&dest).unwrap();
    let files = m["files"].as_array().unwrap();
    assert_eq!(files[0]["sha256"], crate::files::sha256_hex(&fs::read(t.path().join("clip.mp4")).unwrap()));
    assert_eq!(files[0]["size"], 3 * CHUNK as u64 + 123);
    assert_eq!(files[0]["role"], "video");
    assert_eq!(m["created"], "2026-11-18T00:00:00Z");
    // every entry's CRC is right (the manifest's was patched after its hashes were filled in)
    for it in &items {
      let b = read_at(&mut f, it.data, it.size as usize, &dest).unwrap();
      assert_eq!(crc32fast::hash(&b), it.crc, "{}", it.name);
    }
    let out = t.path().join("un");
    let got = unpack(&job, &dest, &out, &|_| {}, &|_| Ok(())).unwrap();
    assert_eq!(got.len(), 3);
    assert!(got.iter().all(|(p, sha)| crate::files::sha256_hex(&fs::read(p).unwrap()) == *sha)); // paw-goia: noted as the app's own
    assert_eq!(fs::read(out.join("clip.mp4")).unwrap(), fs::read(t.path().join("clip.mp4")).unwrap());
    assert_eq!(fs::read_to_string(out.join("clip.pawproj")).unwrap(), "{\"format\":\"pawproj\"} ü");
    assert!(!out.join(MANIFEST).exists());
    // never replaces what is there
    assert_eq!(unpack(&job, &dest, &out, &|_| {}, &|_| Ok(())).unwrap_err().code, "exists");
    assert!(matches!(ev.lock().unwrap().last(), Some(Event::Progress { fraction, .. }) if *fraction == 1.0));
  }

  #[test]
  fn damaged_data_is_refused_and_nothing_stays() {
    let t = tempfile::tempdir().unwrap();
    let dest = t.path().join("out.pawpack");
    write(&Job::default(), &dest, &man(), &entries(t.path()), &|_| {}).unwrap();
    let mut f = File::open(&dest).unwrap();
    let it = list(&mut f, &dest).unwrap().into_iter().find(|i| i.name == "clip.funscript").unwrap();
    drop(f);
    let mut b = fs::read(&dest).unwrap();
    b[it.data as usize + 3] ^= 0x20;
    fs::write(&dest, &b).unwrap();
    let out = t.path().join("un");
    let e = unpack(&Job::default(), &dest, &out, &|_| {}, &|_| Ok(())).unwrap_err();
    assert_eq!(e.code, "corrupt");
    assert!(e.message.contains("clip.funscript"), "{e:?}");
    assert_eq!(fs::read_dir(&out).unwrap().count(), 0, "the video unpacked before it was removed again");
  }

  #[test]
  fn traversal_in_a_pack_is_refused() {
    let t = tempfile::tempdir().unwrap();
    let dest = t.path().join("evil.pawpack");
    write(&Job::default(), &dest, &man(), &entries(t.path()), &|_| {}).unwrap();
    // rename "clip.funscript" to "../x.funscript" (same length) in the manifest's file list: refused before anything is written
    let mut b2 = fs::read(&dest).unwrap();
    let mut f = File::open(&dest).unwrap();
    let it = list(&mut f, &dest).unwrap()[0].clone();
    let (m0, m1) = (it.data as usize, (it.data + it.size) as usize);
    let (from, to) = (b"\"clip.funscript\"", b"\"../x.funscript\"");
    let at = b2[m0..m1].windows(from.len()).position(|w| w == from).unwrap() + m0;
    b2[at..at + to.len()].copy_from_slice(to);
    // keep the manifest's CRC right so only the name check can refuse it
    let crc = crc32fast::hash(&b2[m0..m1]);
    b2[14..18].copy_from_slice(&crc.to_le_bytes());
    let cd = b2.windows(4).rposition(|w| w == 0x0201_4b50u32.to_le_bytes()).unwrap();
    let first_cd = b2.windows(4).position(|w| w == 0x0201_4b50u32.to_le_bytes()).unwrap();
    assert!(first_cd <= cd);
    b2[first_cd + 16..first_cd + 20].copy_from_slice(&crc.to_le_bytes());
    drop(f);
    fs::write(&dest, &b2).unwrap();
    let out = t.path().join("un");
    assert_eq!(unpack(&Job::default(), &dest, &out, &|_| {}, &|_| Ok(())).unwrap_err().code, "unsafe_name");
    assert!(!out.exists());
    assert!(!t.path().join("x.funscript").exists());
    // and a newer major format: a plain refusal
    let mut m = man();
    m["version"] = json!("2.0");
    let d2 = t.path().join("new.pawpack");
    write(&Job::default(), &d2, &m, &entries(t.path()), &|_| {}).unwrap();
    let e = manifest(&d2).unwrap_err();
    assert_eq!(e.code, "too_new");
    assert!(e.message.contains("update Pawscript"));
  }

  #[test]
  fn cancel_and_failure_leave_no_file() {
    let t = tempfile::tempdir().unwrap();
    let es = entries(t.path());
    let dest = t.path().join("out.pawpack");
    let job = Job::default();
    job.cancel();
    assert_eq!(write(&job, &dest, &man(), &es, &|_| {}).unwrap_err().code, "cancelled");
    let left = || fs::read_dir(t.path()).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.contains("pawpack")).collect::<Vec<_>>();
    assert!(left().is_empty(), "{:?}", left());
    // cancelled half way through the video (a meter that cancels on its first progress)
    let job = Job::default();
    let e = write(&job, &dest, &man(), &es, &|_| job.cancel()).unwrap_err();
    assert_eq!(e.code, "cancelled");
    assert!(left().is_empty(), "{:?}", left());
    // a machine-name leak is refused before anything is written
    let mut es2 = entries(t.path());
    let h = host();
    if h.len() >= 3 {
      es2[1].text = Some(format!("{{\"note\":\"made on {h}\"}}"));
      assert_eq!(write(&Job::default(), &dest, &man(), &es2, &|_| {}).unwrap_err().code, "private");
      assert!(left().is_empty());
    }
    // an unpack cancelled half way removes what it wrote
    write(&Job::default(), &dest, &man(), &es, &|_| {}).unwrap();
    let out = t.path().join("un");
    let job = Job::default();
    assert_eq!(unpack(&job, &dest, &out, &|_| job.cancel(), &|_| Ok(())).unwrap_err().code, "cancelled");
    assert_eq!(fs::read_dir(&out).unwrap().count(), 0);
  }

  /// ZIP64 for real: a generated video over 4 GiB, packed, listed, unpacked and compared. Heavy (about 14 GB of disk
  /// traffic): `PAWPACK_BIG_DIR=<scratch folder> cargo test -- --ignored zip64`; everything is deleted afterwards.
  #[test]
  #[ignore]
  fn zip64_over_4_gib() {
    let base = std::env::var("PAWPACK_BIG_DIR").map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir());
    let t = tempfile::tempdir_in(base).unwrap();
    let big = t.path().join("big.mp4");
    let len: u64 = (4 << 30) + 12345;
    {
      // generated, not zeros: a byte pattern that changes with the offset, so a misplaced copy cannot hash the same
      let mut f = std::io::BufWriter::with_capacity(CHUNK, File::create(&big).unwrap());
      let block: Vec<u8> = (0..CHUNK).map(|i| (i as u8).wrapping_mul(13)).collect();
      let mut left = len;
      let mut k = 0u64;
      while left > 0 {
        let n = (CHUNK as u64).min(left) as usize;
        let mut b = block[..n].to_vec();
        b[..8.min(n)].copy_from_slice(&k.to_le_bytes()[..8.min(n)]);
        f.write_all(&b).unwrap();
        left -= n as u64;
        k += 1;
      }
    }
    let job = Job::default();
    let want = crate::ident::sha256_file(&job, &big, &|_| {}).unwrap();
    let es = vec![
      Entry { name: "big.mp4".into(), role: Some("video".into()), path: Some(big.clone()), text: None },
      Entry { name: "big.funscript".into(), role: Some("script".into()), path: None, text: Some("{}".into()) },
    ];
    let dest = t.path().join("big.pawpack");
    write(&job, &dest, &man(), &es, &|_| {}).unwrap();
    fs::remove_file(&big).unwrap();
    let mut f = File::open(&dest).unwrap();
    let items = list(&mut f, &dest).unwrap();
    assert_eq!(items[1].size, len);
    assert!(items[2].data > u32::MAX as u64, "the entry after the video must sit past 4 GiB");
    drop(f);
    let out = t.path().join("un");
    unpack(&job, &dest, &out, &|_| {}, &|_| Ok(())).unwrap();
    assert_eq!(crate::ident::sha256_file(&job, &out.join("big.mp4"), &|_| {}).unwrap(), want);
    assert_eq!(fs::read_to_string(out.join("big.funscript")).unwrap(), "{}");
  }
}

// ---------------------------------------------------------------- review (2026-11-18): adversarial packs
#[cfg(test)]
mod review {
  use super::*;

  fn lh(name: &str, crc: u32, size: u32) -> Vec<u8> {
    let mut h = Vec::new();
    h.extend(0x0403_4b50u32.to_le_bytes());
    h.extend(20u16.to_le_bytes());
    h.extend(0x0800u16.to_le_bytes());
    h.extend(0u16.to_le_bytes());
    h.extend(0u16.to_le_bytes());
    h.extend(DOS_DATE.to_le_bytes());
    h.extend(crc.to_le_bytes());
    h.extend(size.to_le_bytes());
    h.extend(size.to_le_bytes());
    h.extend((name.len() as u16).to_le_bytes());
    h.extend(0u16.to_le_bytes());
    h.extend(name.as_bytes());
    h
  }
  fn cdh(name: &str, crc: u32, size: u32, off: u32) -> Vec<u8> {
    let mut h = Vec::new();
    h.extend(0x0201_4b50u32.to_le_bytes());
    h.extend(20u16.to_le_bytes());
    h.extend(20u16.to_le_bytes());
    h.extend(0x0800u16.to_le_bytes());
    h.extend(0u16.to_le_bytes());
    h.extend(0u16.to_le_bytes());
    h.extend(DOS_DATE.to_le_bytes());
    h.extend(crc.to_le_bytes());
    h.extend(size.to_le_bytes());
    h.extend(size.to_le_bytes());
    h.extend((name.len() as u16).to_le_bytes());
    h.extend([0u8; 8]); // extra, comment, disk, internal attributes
    h.extend(0u32.to_le_bytes());
    h.extend(off.to_le_bytes());
    h.extend(name.as_bytes());
    h
  }
  fn eocd(n: u16, cd_size: u32, cd_off: u32) -> Vec<u8> {
    let mut h = Vec::new();
    h.extend(0x0605_4b50u32.to_le_bytes());
    h.extend([0u8; 4]);
    h.extend(n.to_le_bytes());
    h.extend(n.to_le_bytes());
    h.extend(cd_size.to_le_bytes());
    h.extend(cd_off.to_le_bytes());
    h.extend(0u16.to_le_bytes());
    h
  }
  /// A stored zip: `files` written once each; `cd`: (central name, index into `files` whose local header it points at).
  fn build(files: &[(&str, Vec<u8>)], cd: &[(&str, usize)]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut at = Vec::new();
    for (n, d) in files {
      at.push(out.len() as u32);
      out.extend(lh(n, crc32fast::hash(d), d.len() as u32));
      out.extend(d);
    }
    let cd_off = out.len() as u32;
    let mut c = Vec::new();
    for (n, i) in cd {
      let d = &files[*i].1;
      c.extend(cdh(n, crc32fast::hash(d), d.len() as u32, at[*i]));
    }
    out.extend(&c);
    out.extend(eocd(cd.len() as u16, c.len() as u32, cd_off));
    out
  }
  fn manifest_for(names: &[&str], data: &[u8]) -> Vec<u8> {
    let sha = crate::files::sha256_hex(data);
    let files: Vec<Value> = names.iter().map(|n| json!({"name": n, "role": "script", "size": data.len(), "sha256": sha})).collect();
    serde_json::to_vec(&json!({"format": FORMAT, "version": "1.0", "files": files})).unwrap()
  }

  /// Overlapping entries: 40 central-directory names all point at ONE stored entry. The pack is ~1 MB; unpacking it
  /// writes 40 MB (40 000 names would write 40 GB from the same 1 MB pack: a disk-filling bomb). Expected: refused.
  #[test]
  fn overlapping_entries_are_refused() {
    let t = tempfile::tempdir().unwrap();
    let data: Vec<u8> = (0..(1u32 << 20)).map(|i| (i * 31 % 251) as u8).collect();
    let names: Vec<String> = (0..40).map(|i| format!("c{i}.bin")).collect();
    let nr: Vec<&str> = names.iter().map(String::as_str).collect();
    let man = manifest_for(&nr, &data);
    let mut cd = vec![(MANIFEST, 0usize)];
    cd.extend(nr.iter().map(|n| (*n, 1usize)));
    let z = build(&[(MANIFEST, man), ("c0.bin", data.clone())], &cd);
    let p = t.path().join("bomb.pawpack");
    fs::write(&p, &z).unwrap();
    let out = t.path().join("un");
    let r = unpack(&Job::default(), &p, &out, &|_| {}, &|_| Ok(()));
    let written: u64 = fs::read_dir(&out).map(|d| d.flatten().map(|e| e.metadata().unwrap().len()).sum()).unwrap_or(0);
    assert!(r.is_err(), "unpacked {} files, {written} bytes from a {} byte pack", r.as_ref().map(|v| v.len()).unwrap_or(0), z.len());
  }

  /// The local header's name differs from the central directory's: a zip tool extracts one name, Pawscript another.
  #[test]
  fn local_name_must_match_central_name() {
    let t = tempfile::tempdir().unwrap();
    let data = b"{\"actions\":[]}".to_vec();
    let man = manifest_for(&["a.funscript"], &data);
    let z = build(&[(MANIFEST, man), ("../../evil.funscript", data)], &[(MANIFEST, 0), ("a.funscript", 1)]);
    let p = t.path().join("m.pawpack");
    fs::write(&p, &z).unwrap();
    let mut f = File::open(&p).unwrap();
    assert!(list(&mut f, &p).is_err(), "a local header named ../../evil.funscript was accepted under the central name a.funscript");
  }

  /// Declared sizes beyond the file, every truncation, a central directory past the end, a ZIP64 locator past the end,
  /// and a ZIP64 record claiming u64::MAX entries: all refused, never a panic or a huge allocation.
  #[test]
  fn lying_sizes_and_offsets_are_refused_without_panic() {
    let t = tempfile::tempdir().unwrap();
    let data = b"hello".to_vec();
    let man = manifest_for(&["a.funscript"], &data);
    let good = build(&[(MANIFEST, man.clone()), ("a.funscript", data.clone())], &[(MANIFEST, 0), ("a.funscript", 1)]);
    let p = t.path().join("x.pawpack");
    let try_list = |b: &[u8]| {
      fs::write(&p, b).unwrap();
      let mut f = File::open(&p).unwrap();
      std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| list(&mut f, &p).map(|v| v.len())))
    };
    assert_eq!(try_list(&good).unwrap().unwrap(), 2);
    let mut b = good.clone();
    let cd = b.windows(4).rposition(|w| w == 0x0201_4b50u32.to_le_bytes()).unwrap();
    b[cd + 20..cd + 28].copy_from_slice(&[0xF0, 0xFF, 0xFF, 0xFF, 0xF0, 0xFF, 0xFF, 0xFF]);
    assert!(try_list(&b).unwrap().is_err());
    for cut in 0..good.len() {
      assert!(try_list(&good[..cut]).is_ok(), "panic listing a pack cut at {cut}");
    }
    let mut b = good.clone();
    let n = b.len();
    b[n - 6..n - 2].copy_from_slice(&u32::MAX.to_le_bytes());
    assert!(try_list(&b).unwrap().is_err());
    let mut b = good.clone();
    let e = b.len() - 22;
    let mut loc = Vec::new();
    loc.extend(0x0706_4b50u32.to_le_bytes());
    loc.extend(0u32.to_le_bytes());
    loc.extend(u64::MAX.to_le_bytes());
    loc.extend(1u32.to_le_bytes());
    b.splice(e..e, loc);
    assert!(try_list(&b).unwrap().is_err());
    let mut b = good.clone();
    let e = b.len() - 22;
    let cd_off = u32::from_le_bytes(b[e + 16..e + 20].try_into().unwrap()) as u64;
    let cd_size = u32::from_le_bytes(b[e + 12..e + 16].try_into().unwrap()) as u64;
    let mut rec = Vec::new();
    rec.extend(0x0606_4b50u32.to_le_bytes());
    rec.extend(44u64.to_le_bytes());
    rec.extend([45u8, 0, 45, 0]);
    rec.extend([0u8; 8]);
    rec.extend(u64::MAX.to_le_bytes());
    rec.extend(u64::MAX.to_le_bytes());
    rec.extend(cd_size.to_le_bytes());
    rec.extend(cd_off.to_le_bytes());
    rec.extend(0x0706_4b50u32.to_le_bytes());
    rec.extend(0u32.to_le_bytes());
    rec.extend((e as u64).to_le_bytes());
    rec.extend(1u32.to_le_bytes());
    b.splice(e..e, rec);
    assert!(try_list(&b).unwrap().is_err());
  }

  /// Duplicate names (exact and by case) in the manifest: refused, nothing left.
  #[test]
  fn duplicate_names_leave_nothing() {
    let t = tempfile::tempdir().unwrap();
    let data = b"{}".to_vec();
    for names in [["a.funscript", "a.funscript"], ["a.funscript", "A.FUNSCRIPT"]] {
      let man = manifest_for(&names, &data);
      let z = build(&[(MANIFEST, man), (names[0], data.clone()), (names[1], data.clone())], &[(MANIFEST, 0), (names[0], 1), (names[1], 2)]);
      let p = t.path().join("d.pawpack");
      fs::write(&p, &z).unwrap();
      let out = t.path().join(format!("un-{}", names[1]));
      assert!(unpack(&Job::default(), &p, &out, &|_| {}, &|_| Ok(())).is_err());
      assert_eq!(fs::read_dir(&out).map(|d| d.count()).unwrap_or(0), 0);
    }
  }

  /// Device names Windows reserves that safe_name misses (CONIN$ / CONOUT$, superscript-digit COM / LPT).
  #[test]
  fn more_reserved_names() {
    for bad in ["CONIN$", "conout$.txt", "COM\u{b9}", "LPT\u{b2}.log"] {
      assert!(safe_name(bad).is_err(), "{bad:?} accepted");
    }
  }
}
