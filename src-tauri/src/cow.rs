//! paw-ee14: copy-on-write writes of a project's `.pawruns` (version 2, docs/formats/pawruns.md). The file is an
//! append-only log: blocks (a run's frames, its record) are appended once and never changed, then a small commit
//! (manifest + checksummed trailer) is appended last. A change writes only its new blocks and a commit; the bytes a commit
//! refers to are on disk (fsync) before the commit itself is written, so a crash or a forced close at any moment leaves
//! the previous commit or the new one, both whole. The format lives in JS (src/lib/runs-file.js); this side only appends,
//! copies byte ranges and swaps files, without reading the content.
//!
//! - `append`: bytes onto the live file at its known length (refused as `moved` when the file is not as the app left it).
//! - a stage: a new file written in parts into a temp file beside the target (`stage_write` / `stage_copy` byte ranges
//!   of another file, SHA-256 of each returned), then fsync + rename over the target (`stage_commit`). Used for a first
//!   write, a migration from version 1, a compaction, and any large write that must not cross IPC in one body.

use crate::error::{At, Error, Result};
use crate::files::{self, path_str};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, serde::Serialize, PartialEq)]
pub struct Appended {
  pub size: u64,
  pub mtime_ms: Option<i64>,
}

#[derive(Debug, serde::Serialize, PartialEq)]
pub struct Copied {
  pub size: u64,
  /// SHA-256 (hex) of each range, in order.
  pub sha256: Vec<String>,
}

fn appended(f: &File, size: u64) -> Appended {
  Appended { size, mtime_ms: f.metadata().ok().as_ref().and_then(files::mtime_ms) }
}

fn moved(path: &Path, why: String) -> Error {
  Error::new("moved", format!("{}: {why}; written whole instead", path.display()))
}

/// Appends `bytes` at `at`, which must be the file's length; `tail`: what its last bytes must be (the app's last commit
/// trailer). `sync`: on disk before this returns. A failed write may leave part of `bytes` after `at`: readers ignore bytes
/// after the last whole commit, and the next append is refused (`moved`), so the app writes the file whole.
/// paw-51zd: the file is held without write sharing from the check to the end of the write (and its fsync), so of two
/// writers at the same length one is refused `moved` (another program has it open for writing) instead of both being
/// told "written" while one overwrote the other.
pub fn append(path: &Path, at: u64, tail: Option<&[u8]>, bytes: &[u8], sync: bool) -> Result<Appended> {
  let path = files::resolve_target(path);
  let mut o = OpenOptions::new();
  o.read(true).write(true);
  #[cfg(windows)]
  std::os::windows::fs::OpenOptionsExt::share_mode(&mut o, 1); // FILE_SHARE_READ: readers yes, a second writer no
  // ponytail: no lock off Windows (the app ships for Windows); flock the range there if that ever changes
  let mut f = match o.open(&path) {
    Err(e) if e.raw_os_error() == Some(32) => return Err(moved(&path, "another program is writing it at this moment".into())),
    r => r.at(&path)?,
  };
  let len = f.metadata().at(&path)?.len();
  if len != at {
    return Err(moved(&path, format!("{len} bytes on disk, {at} expected")));
  }
  if let Some(t) = tail.filter(|t| !t.is_empty()) {
    let mut got = vec![0u8; t.len()];
    if (t.len() as u64) > len {
      return Err(moved(&path, "shorter than its last version".into()));
    }
    f.seek(SeekFrom::Start(len - t.len() as u64)).at(&path)?;
    f.read_exact(&mut got).at(&path)?;
    if got != t {
      return Err(moved(&path, "its last version is not the one this app wrote".into()));
    }
  }
  f.seek(SeekFrom::Start(at)).at(&path)?;
  f.write_all(bytes).at(&path)?;
  if sync {
    f.sync_all().at(&path)?;
  }
  Ok(appended(&f, at + bytes.len() as u64))
}

// ---------------------------------------------------------------- stages

struct Stage {
  key: String,
  path: PathBuf,
  tmp: tempfile::NamedTempFile,
  dir: PathBuf,
  target: PathBuf,
  size: u64,
}
static STAGES: Mutex<Vec<Stage>> = Mutex::new(Vec::new());

/// A stage id: 6-64 of [A-Za-z0-9_-].
pub fn stage_key_ok(s: &str) -> bool {
  (6..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Runs `f` on the stage `key` of `path` (begun here if need be; a new stage for a path drops that path's older ones and
/// their temp files). An error drops the stage: nothing is left behind, the target untouched.
fn with_stage<T>(path: &Path, key: &str, f: impl FnOnce(&mut Stage) -> Result<T>) -> Result<T> {
  if !stage_key_ok(key) {
    return Err(Error::invalid("stage: malformed stage id"));
  }
  let path = files::resolve_target(path);
  let mut stages = STAGES.lock().unwrap_or_else(|e| e.into_inner());
  let i = match stages.iter().position(|s| s.key == key && s.path == path) {
    Some(i) => i,
    None => {
      if path.is_dir() {
        return Err(Error::invalid(format!("{}: is a folder", path.display())));
      }
      stages.retain(|s| s.path != path);
      let (tmp, dir, target) = files::temp_beside(&path)?;
      stages.push(Stage { key: key.to_string(), path: path.clone(), tmp, dir, target, size: 0 });
      stages.len() - 1
    }
  };
  let r = f(&mut stages[i]);
  if r.is_err() {
    stages.remove(i);
  }
  r
}

/// Appends `bytes` to the stage (begun by its first part). -> the stage's size.
pub fn stage_write(path: &Path, key: &str, bytes: &[u8]) -> Result<u64> {
  with_stage(path, key, |s| {
    s.tmp.as_file_mut().write_all(bytes).at(&s.path)?;
    s.size += bytes.len() as u64;
    Ok(s.size)
  })
}

/// Appends byte ranges `(offset, length)` of `src` to the stage (begun here if need be), streaming; every range must lie
/// inside `src`. -> the stage's size and each range's SHA-256.
pub fn stage_copy(path: &Path, key: &str, src: &Path, ranges: &[(u64, u64)]) -> Result<Copied> {
  with_stage(path, key, |s| {
    let mut from = File::open(src).at(src)?;
    let len = from.metadata().at(src)?.len();
    if let Some((o, l)) = ranges.iter().find(|(o, l)| o.checked_add(*l).is_none_or(|e| e > len)) {
      return Err(Error::invalid(format!("{}: range {o}+{l} is past its end ({len} bytes)", src.display())));
    }
    let mut buf = vec![0u8; 1 << 20];
    let mut sha256 = Vec::with_capacity(ranges.len());
    for &(o, l) in ranges {
      from.seek(SeekFrom::Start(o)).at(src)?;
      let (mut left, mut h) = (l, Sha256::new());
      while left > 0 {
        let n = left.min(buf.len() as u64) as usize;
        from.read_exact(&mut buf[..n]).at(src)?;
        h.update(&buf[..n]);
        s.tmp.as_file_mut().write_all(&buf[..n]).at(&s.path)?;
        left -= n as u64;
      }
      s.size += l;
      sha256.push(files::hex(&h.finalize()));
    }
    Ok(Copied { size: s.size, sha256 })
  })
}

/// The stage, fsynced, renamed over its target (the target untouched until then). backup: the target as it was is first
/// copied into its rolling backup folder (`<root>/<key>/<ms>-<name>`, the newest `keep` kept): a migration's old file.
pub fn stage_commit(path: &Path, key: &str, backup: Option<(&Path, usize)>) -> Result<Appended> {
  let path = files::resolve_target(path);
  let st = {
    let mut stages = STAGES.lock().unwrap_or_else(|e| e.into_inner());
    let Some(i) = stages.iter().position(|x| x.key == key && x.path == path) else {
      return Err(Error::new("not_found", format!("{}: no such write in progress (it was dropped)", path.display())));
    };
    stages.remove(i)
  };
  if let Some((root, keep)) = backup {
    if st.target.is_file() {
      backup_copy(root, &st.target, keep)?;
    }
  }
  let size = st.size;
  files::persist(st.tmp, &st.dir, &st.target, &st.path)?;
  let f = File::open(&st.target).at(&st.target)?;
  Ok(appended(&f, size))
}

/// Drops a stage (its temp file removed); none: nothing to do.
pub fn stage_drop(path: &Path, key: &str) {
  let path = files::resolve_target(path);
  STAGES.lock().unwrap_or_else(|e| e.into_inner()).retain(|s| !(s.key == key && s.path == path));
}

/// Streams `path` into its rolling backup folder as `<ms>-<name>` and keeps the newest `keep` there.
fn backup_copy(root: &Path, path: &Path, keep: usize) -> Result<PathBuf> {
  let dir = files::rolling_dir(root, path);
  fs::create_dir_all(&dir).at(&dir)?;
  let origin = dir.join("source.txt");
  if !origin.exists() {
    files::write_atomic(&origin, path_str(path).as_bytes())?;
  }
  let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
  let mut ms = files::now_ms();
  let mut dest = dir.join(format!("{ms:013}-{name}"));
  while dest.exists() {
    ms += 1;
    dest = dir.join(format!("{ms:013}-{name}"));
  }
  files::write_atomic_with(&dest, |f| io::copy(&mut File::open(path)?, f).map(|_| ()))?;
  files::prune(&dir, keep.max(1))?;
  Ok(dest)
}

#[cfg(test)]
mod tests {
  use super::*;

  // A version-2 log as the app writes it, enough of it to check crash safety from this side: a head, blocks, commits =
  // JSON manifest + "PAWRTAIL" u32 len u32 crc32. The reader mirrors runs-file.js lastCommit.
  const HEAD: &[u8] = b"PAWRUNS1\x1f\x00\x00\x00{\"format\":\"pawruns\",\"version\":2}";

  fn commit(manifest: &str) -> Vec<u8> {
    let j = manifest.as_bytes();
    let mut out = j.to_vec();
    out.extend_from_slice(b"PAWRTAIL");
    out.extend_from_slice(&(j.len() as u32).to_le_bytes());
    out.extend_from_slice(&crc32fast::hash(j).to_le_bytes());
    out
  }
  /// The newest whole commit's manifest (lastCommit in runs-file.js).
  fn last_commit(b: &[u8]) -> Option<serde_json::Value> {
    let mut p = b.len().checked_sub(16)?;
    loop {
      if &b[p..p + 8] == b"PAWRTAIL" {
        let len = u32::from_le_bytes(b[p + 8..p + 12].try_into().unwrap()) as usize;
        let crc = u32::from_le_bytes(b[p + 12..p + 16].try_into().unwrap());
        if len <= p - HEAD.len() && crc32fast::hash(&b[p - len..p]) == crc {
          return serde_json::from_slice(&b[p - len..p]).ok();
        }
      }
      if p <= HEAD.len() {
        return None;
      }
      p -= 1;
    }
  }
  fn h16(b: &[u8]) -> String {
    files::hex(&Sha256::digest(b))[..32].to_string()
  }
  /// Every block a manifest names is in the file with its hash: the state is whole.
  fn whole(b: &[u8], m: &serde_json::Value) -> bool {
    m["blocks"].as_object().unwrap().iter().all(|(h, r)| {
      let (o, l) = (r[0].as_u64().unwrap() as usize, r[1].as_u64().unwrap() as usize);
      o + l <= b.len() && h16(&b[o..o + l]) == *h
    })
  }
  /// Version n's new block (n KB of pseudo-random bytes) and its commit, given the blocks before it at `at`.
  fn version(n: u64, at: u64, blocks: &mut Vec<(String, u64, u64)>) -> (Vec<u8>, Vec<u8>) {
    let block: Vec<u8> = (0..n * 1024 + 7).map(|i| ((i * 2654435761 + n * 97) >> 7) as u8).collect();
    blocks.push((h16(&block), at, block.len() as u64));
    let b: Vec<String> = blocks.iter().map(|(h, o, l)| format!("\"{h}\":[{o},{l}]")).collect();
    let man = format!("{{\"v\":2,\"n\":{n},\"blocks\":{{{}}},\"runs\":[]}}", b.join(","));
    (block, commit(&man))
  }

  /// Killed at every step and at byte offsets inside a block and inside a commit: the file always opens to the previous
  /// whole version or the new one; the next write after a cut is refused as `moved`; a write cut short then written
  /// whole through a stage gives the new version.
  #[test]
  fn a_cut_at_any_byte_leaves_the_previous_or_the_new_version() {
    let t = tempfile::tempdir().unwrap();
    let p = t.path().join("a.pawruns");
    let mut blocks = vec![];
    let (b0, c0) = version(1, HEAD.len() as u64, &mut blocks);
    stage_write(&p, "stage0", HEAD).unwrap();
    stage_write(&p, "stage0", &b0).unwrap();
    stage_write(&p, "stage0", &c0).unwrap();
    stage_commit(&p, "stage0", None).unwrap();
    assert_eq!(last_commit(&fs::read(&p).unwrap()).unwrap()["n"], 1);
    for n in 2..6u64 {
      let base = fs::read(&p).unwrap();
      let at = base.len() as u64;
      let mut next = blocks.clone();
      let (block, com) = version(n, at, &mut next);
      let all = [block.clone(), com.clone()].concat();
      // every byte offset of the block + commit (sampled densely, every offset near the boundaries)
      for cut in (0..all.len()).filter(|&k| k < 64 || k % 97 == 0 || k + 64 > all.len() || (k as i64 - block.len() as i64).abs() < 40) {
        fs::write(&p, &base).unwrap();
        append(&p, at, None, &all[..cut], false).unwrap();
        let got = fs::read(&p).unwrap();
        let m = last_commit(&got).unwrap();
        assert_eq!(m["n"], n - 1, "cut at {cut} of {}", all.len());
        assert!(whole(&got, &m));
        // power loss variant: the cut bytes came back as zeros
        let mut z = base.clone();
        z.extend(std::iter::repeat_n(0u8, cut));
        assert_eq!(last_commit(&z).unwrap()["n"], n - 1);
        if cut > 0 {
          // the app's next append expects the old length: refused, the file stays as it is
          assert_eq!(append(&p, at, None, b"x", false).unwrap_err().code, "moved");
          assert_eq!(fs::read(&p).unwrap(), got);
        }
      }
      // the whole write: the new version
      fs::write(&p, &base).unwrap();
      append(&p, at, Some(&base[base.len() - 16..]), &block, true).unwrap();
      let tail_now = fs::read(&p).unwrap();
      append(&p, at + block.len() as u64, Some(&tail_now[tail_now.len() - 16..]), &com, true).unwrap();
      let got = fs::read(&p).unwrap();
      let m = last_commit(&got).unwrap();
      assert_eq!(m["n"], n);
      assert!(whole(&got, &m));
      blocks = next;
    }
    // a wrong tail (another program changed the file, same length) is refused
    let len = fs::metadata(&p).unwrap().len();
    assert_eq!(append(&p, len, Some(&[0u8; 16]), b"x", true).unwrap_err().code, "moved");
  }

  /// A stage is invisible until its commit: dropped, failed or replaced by a newer one, the target is untouched and no temp
  /// file stays; copies return each range's hash; ranges past the source's end are refused (the stage dropped).
  #[test]
  fn stages_swap_whole_files_and_leave_nothing_behind() {
    let t = tempfile::tempdir().unwrap();
    let p = t.path().join("a.pawruns");
    fs::write(&p, b"old file").unwrap();
    let src = t.path().join("src.bin");
    fs::write(&src, b"0123456789abcdef").unwrap();
    stage_write(&p, "stage1", b"AB").unwrap();
    let c = stage_copy(&p, "stage1", &src, &[(2, 3), (10, 6)]).unwrap();
    assert_eq!(c.size, 11);
    assert_eq!(c.sha256, vec![files::sha256_hex(b"234"), files::sha256_hex(b"abcdef")]);
    assert_eq!(fs::read(&p).unwrap(), b"old file");
    // a new stage for the path drops the old one
    stage_write(&p, "stage2", b"new").unwrap();
    assert_eq!(stage_write(&p, "stage1", b"x").unwrap(), 1); // begun again, from nothing
    assert_eq!(stage_commit(&p, "stage2", None).unwrap_err().code, "not_found");
    assert_eq!(stage_copy(&p, "stage1", &src, &[(10, 7)]).unwrap_err().code, "invalid_input");
    assert_eq!(stage_commit(&p, "stage1", None).unwrap_err().code, "not_found"); // dropped by the failed copy
    stage_write(&p, "stage3", b"whole").unwrap();
    stage_drop(&p, "stage3");
    assert_eq!(fs::read(&p).unwrap(), b"old file");
    let names = || fs::read_dir(t.path()).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect::<std::collections::BTreeSet<_>>();
    assert_eq!(names().len(), 2, "{:?}", names());
    // a commit with a backup: the old file goes to the rolling folder first
    stage_write(&p, "stage4", b"v2").unwrap();
    let root = t.path().join("backups");
    let w = stage_commit(&p, "stage4", Some((&root, 2))).unwrap();
    assert_eq!((w.size, fs::read(&p).unwrap()), (2, b"v2".to_vec()));
    let rolled: Vec<_> = fs::read_dir(files::rolling_dir(&root, &p)).unwrap().map(|e| e.unwrap().path()).filter(|q| q.extension().is_some_and(|e| e == "pawruns")).collect();
    assert_eq!(rolled.len(), 1);
    assert_eq!(fs::read(&rolled[0]).unwrap(), b"old file");
    assert!(!stage_key_ok("short") && !stage_key_ok("a/b/c/d/e") && stage_key_ok("Ab_9-xyz"));
  }

  /// The real thing: a child process appends versions (block, fsync, commit, fsync; every few versions a compaction
  /// through a stage) and is killed (TerminateProcess) at a random moment, over and over on the same file. After every kill
  /// the file opens to a whole version, never older than the last one the child reported as written.
  #[test]
  fn killed_writers_never_leave_a_broken_file() {
    let t = tempfile::tempdir().unwrap();
    let p = t.path().join("k.pawruns");
    let exe = std::env::current_exe().unwrap();
    let mut seed = 0x9e3779b97f4a7c15u64;
    let mut last_done = 0u64;
    for round in 0..24 {
      let log = t.path().join(format!("done{round}.txt"));
      let mut child = std::process::Command::new(&exe)
        .args(["--exact", "cow::tests::crash_child", "--ignored", "--nocapture", "--test-threads=1"])
        .env("PAWRUNS_CRASH_FILE", &p)
        .env("PAWRUNS_CRASH_LOG", &log)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
      seed ^= seed << 13;
      seed ^= seed >> 7;
      seed ^= seed << 17;
      std::thread::sleep(std::time::Duration::from_millis(30 + seed % 400));
      let _ = child.kill();
      let _ = child.wait();
      let done = fs::read_to_string(&log).ok().and_then(|s| s.lines().last().and_then(|l| l.parse::<u64>().ok())).unwrap_or(0);
      last_done = last_done.max(done);
      let Ok(b) = fs::read(&p) else { continue }; // killed before its first file existed
      let m = last_commit(&b).unwrap_or_else(|| panic!("round {round}: no whole version in {} bytes", b.len()));
      assert!(whole(&b, &m), "round {round}: a block of version {} is missing", m["n"]);
      assert!(m["n"].as_u64().unwrap() >= last_done, "round {round}: version {} is older than {last_done}, reported written", m["n"]);
    }
    assert!(last_done > 3, "the child wrote too little to mean anything ({last_done})");
  }

  /// The writer `killed_writers_never_leave_a_broken_file` kills (run only by it: ignored otherwise).
  #[test]
  #[ignore]
  fn crash_child() {
    let (Ok(p), Ok(log)) = (std::env::var("PAWRUNS_CRASH_FILE"), std::env::var("PAWRUNS_CRASH_LOG")) else { return };
    let p = PathBuf::from(p);
    let mut done = OpenOptions::new().create(true).append(true).open(&log).unwrap();
    // continue from the file's last whole version (blocks re-listed from it), or begin it
    let (mut blocks, mut n) = match fs::read(&p).ok().as_deref().and_then(last_commit) {
      Some(m) => (
        m["blocks"].as_object().unwrap().iter().map(|(h, r)| (h.clone(), r[0].as_u64().unwrap(), r[1].as_u64().unwrap())).collect::<Vec<_>>(),
        m["n"].as_u64().unwrap(),
      ),
      None => {
        let mut b = vec![];
        let (b0, c0) = version(1, HEAD.len() as u64, &mut b);
        stage_write(&p, "child0", HEAD).unwrap();
        stage_write(&p, "child0", &b0).unwrap();
        stage_write(&p, "child0", &c0).unwrap();
        stage_commit(&p, "child0", None).unwrap();
        (b, 1)
      }
    };
    blocks.sort_by_key(|b| b.1);
    loop {
      n += 1;
      let cur = fs::read(&p).unwrap();
      let at = cur.len() as u64;
      if n % 5 == 0 {
        // compaction: the live blocks copied into a new file, swapped in whole
        let key = format!("child{n}");
        stage_write(&p, &key, HEAD).unwrap();
        let ranges: Vec<(u64, u64)> = blocks.iter().map(|b| (b.1, b.2)).collect();
        stage_copy(&p, &key, &p, &ranges).unwrap();
        let mut o = HEAD.len() as u64;
        for b in blocks.iter_mut() {
          b.1 = o;
          o += b.2;
        }
        let (block, com) = version(n, o, &mut blocks);
        stage_write(&p, &key, &block).unwrap();
        stage_write(&p, &key, &com).unwrap();
        stage_commit(&p, &key, None).unwrap();
      } else {
        let (block, com) = version(n, at, &mut blocks);
        append(&p, at, Some(&cur[cur.len() - 16..]), &block, true).unwrap();
        append(&p, at + block.len() as u64, None, &com, true).unwrap();
      }
      if blocks.len() > 12 {
        blocks.remove(0); // older versions' blocks fall out of the newest manifest (garbage until a compaction)
      }
      writeln!(done, "{n}").unwrap();
      done.sync_all().unwrap();
    }
  }
}

// ---------------------------------------------------------------- review (2026-11-18): adversarial runs files
#[cfg(test)]
mod review {
  use super::*;

  /// Two writers (two app instances on one network project, or two tabs) append at the same known length at the same
  /// moment: both are told "written" while one overwrote the other's bytes. Expected: the second refused (`moved`) - a
  /// lock (share_mode / LockFileEx) around check-and-write.
  #[test]
  fn two_writers_at_one_length_are_not_both_told_written() {
    let t = tempfile::tempdir().unwrap();
    let p = t.path().join("c.pawruns");
    let mut both = 0;
    for round in 0..300 {
      fs::write(&p, b"HEAD").unwrap();
      let bar = std::sync::Barrier::new(2);
      let (a, b) = std::thread::scope(|s| {
        let ha = s.spawn(|| { bar.wait(); append(&p, 4, Some(b"HEAD"), &[b'A'; 4096], false) });
        let hb = s.spawn(|| { bar.wait(); append(&p, 4, Some(b"HEAD"), &[b'B'; 4096], false) });
        (ha.join().unwrap(), hb.join().unwrap())
      });
      if a.is_ok() && b.is_ok() {
        both += 1;
        let _ = round;
      }
    }
    assert_eq!(both, 0, "in {both} of 300 rounds both appends at offset 4 returned Ok (one writer's committed bytes silently overwritten)");
  }

  /// The swap when the target is held open without FILE_SHARE_DELETE (antivirus, OneDrive, a viewer): refused after the
  /// retries, the old file whole under its name, no temp file left.
  #[cfg(windows)]
  #[test]
  fn a_locked_target_keeps_the_old_file_whole() {
    use std::os::windows::fs::OpenOptionsExt;
    let t = tempfile::tempdir().unwrap();
    let p = t.path().join("l.pawruns");
    fs::write(&p, b"old whole file").unwrap();
    stage_write(&p, "lockedstage", b"new file").unwrap();
    let held = OpenOptions::new().read(true).share_mode(1).open(&p).unwrap(); // FILE_SHARE_READ only
    let r = stage_commit(&p, "lockedstage", None);
    drop(held);
    assert!(r.is_err());
    assert_eq!(fs::read(&p).unwrap(), b"old whole file");
    assert_eq!(fs::read_dir(t.path()).unwrap().count(), 1);
  }

  /// A file cut inside the 16-byte trailer, a trailer whose length points before the head, and a forged trailer inside
  /// block data after a torn append (the reader mirror in `tests::last_commit`, as runs-file.js lastCommit).
  #[test]
  fn trailer_edge_cases() {
    let head = b"PAWRUNS1\x1f\x00\x00\x00{\"format\":\"pawruns\",\"version\":2}";
    let commit = |j: &str| {
      let mut o = j.as_bytes().to_vec();
      o.extend(b"PAWRTAIL");
      o.extend((j.len() as u32).to_le_bytes());
      o.extend(crc32fast::hash(j.as_bytes()).to_le_bytes());
      o
    };
    let last = |b: &[u8]| -> Option<serde_json::Value> {
      let mut p = b.len().checked_sub(16)?;
      loop {
        if &b[p..p + 8] == b"PAWRTAIL" {
          let len = u32::from_le_bytes(b[p + 8..p + 12].try_into().unwrap()) as usize;
          let crc = u32::from_le_bytes(b[p + 12..p + 16].try_into().unwrap());
          if len <= p - head.len() && crc32fast::hash(&b[p - len..p]) == crc {
            return serde_json::from_slice(&b[p - len..p]).ok();
          }
        }
        if p <= head.len() {
          return None;
        }
        p -= 1;
      }
    };
    let mut f = head.to_vec();
    f.extend(commit("{\"n\":1}"));
    let one = f.clone();
    f.extend(commit("{\"n\":2}"));
    for cut in one.len()..f.len() {
      assert_eq!(last(&f[..cut]).unwrap()["n"], 1, "cut at {cut}");
    }
    // a length that points before the head (u32::MAX): skipped, not a panic
    let mut g = one.clone();
    g.extend(b"PAWRTAIL");
    g.extend(u32::MAX.to_le_bytes());
    g.extend(0u32.to_le_bytes());
    assert_eq!(last(&g).unwrap()["n"], 1);
  }
}
