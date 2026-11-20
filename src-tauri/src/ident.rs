//! File identity for relinking moved videos. The quick fingerprint reads at most
//! 3 MiB however large the file is: size + SHA-256 of the head, middle and tail
//! MiB. Full SHA-256 is a separate, cancellable job.

use crate::error::{At, Error, Result};
use crate::ffmpeg::Job;
use crate::files::{hex, path_str};
use crate::media::Event;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::Instant;

const CHUNK: u64 = 1 << 20;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Fingerprint {
  pub size: u64,
  /// `q1-<size>-<32 hex>`: compare as an opaque string.
  pub fingerprint: String,
}

pub fn quick(path: &Path) -> Result<Fingerprint> {
  let mut f = File::open(path).at(path)?;
  let size = f.metadata().at(path)?.len();
  let mut h = Sha256::new();
  h.update(b"pawfp1");
  h.update(size.to_le_bytes());
  let mut buf = vec![0u8; CHUNK as usize];
  let offsets: Vec<u64> = if size <= 3 * CHUNK { vec![] } else { vec![0, size / 2 - CHUNK / 2, size - CHUNK] };
  if offsets.is_empty() {
    let mut all = Vec::with_capacity(size as usize);
    f.read_to_end(&mut all).at(path)?;
    h.update(&all);
  } else {
    for off in offsets {
      f.seek(SeekFrom::Start(off)).at(path)?;
      f.read_exact(&mut buf).at(path)?;
      h.update(&buf);
    }
  }
  Ok(Fingerprint { size, fingerprint: format!("q1-{size}-{}", &hex(&h.finalize())[..32]) })
}

/// Full SHA-256 (lowercase hex), checking for cancel between 1 MiB reads.
pub fn sha256_file(job: &Job, path: &Path, emit: &dyn Fn(Event)) -> Result<String> {
  let mut f = File::open(path).at(path)?;
  let size = f.metadata().at(path)?.len().max(1);
  let mut h = Sha256::new();
  let mut buf = vec![0u8; CHUNK as usize];
  let (mut done, mut last) = (0u64, Instant::now());
  loop {
    job.check()?;
    let n = f.read(&mut buf).at(path)?;
    if n == 0 {
      break;
    }
    h.update(&buf[..n]);
    done += n as u64;
    if last.elapsed().as_millis() >= 100 {
      last = Instant::now();
      emit(Event::Progress { stage: "sha256", fraction: done as f64 / size as f64 });
    }
  }
  emit(Event::Progress { stage: "sha256", fraction: 1.0 });
  Ok(hex(&h.finalize()))
}

fn size_of(fp: &str) -> Option<u64> {
  fp.strip_prefix("q1-")?.split('-').next()?.parse().ok()
}

/// Files under `dir` (up to `max_depth` folders down) whose quick fingerprint
/// equals `fp`. Only same-size files are read. Visits at most 200 000 entries.
pub fn relink_search(dir: &Path, fp: &str, max_depth: usize) -> Result<Vec<String>> {
  let size = size_of(fp).ok_or_else(|| Error::invalid(format!("not a fingerprint: {fp}")))?;
  if !dir.is_dir() {
    return Err(Error::new("not_found", format!("{}: folder does not exist", dir.display())));
  }
  let mut found = Vec::new();
  let mut stack = vec![(dir.to_path_buf(), 0usize)];
  let mut visited = 0usize;
  while let Some((d, depth)) = stack.pop() {
    let Ok(rd) = fs::read_dir(&d) else { continue };
    for e in rd.filter_map(|e| e.ok()) {
      visited += 1;
      if visited > 200_000 {
        return Ok(found);
      }
      let Ok(t) = e.file_type() else { continue };
      if t.is_dir() {
        if depth < max_depth {
          stack.push((e.path(), depth + 1));
        }
      } else if t.is_file() && e.metadata().is_ok_and(|m| m.len() == size) && quick(&e.path()).is_ok_and(|q| q.fingerprint == fp) {
        found.push(path_str(&e.path()));
      }
    }
  }
  found.sort();
  Ok(found)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn file(dir: &Path, name: &str, len: usize, seed: u8) -> std::path::PathBuf {
    let p = dir.join(name);
    fs::write(&p, (0..len).map(|i| (i as u8).wrapping_mul(31).wrapping_add(seed)).collect::<Vec<_>>()).unwrap();
    p
  }

  #[test]
  fn stable_and_sensitive() {
    let t = tempfile::tempdir().unwrap();
    let small = file(t.path(), "s.bin", 1000, 1);
    let a = quick(&small).unwrap();
    assert_eq!(a, quick(&small).unwrap());
    assert!(a.fingerprint.starts_with("q1-1000-") && a.fingerprint.len() == "q1-1000-".len() + 32);
    let big = file(t.path(), "b.bin", 5 * CHUNK as usize, 2);
    let b = quick(&big).unwrap();
    // Moving/renaming keeps the fingerprint.
    let moved = t.path().join("moved.bin");
    fs::rename(&big, &moved).unwrap();
    assert_eq!(quick(&moved).unwrap(), b);
    // A change in a sampled chunk changes it.
    let mut bytes = fs::read(&moved).unwrap();
    bytes[(5 * CHUNK / 2) as usize] ^= 0xff;
    fs::write(&moved, &bytes).unwrap();
    assert_ne!(quick(&moved).unwrap(), b);
    // Pinned value: the algorithm must never change silently (saved projects hold these).
    let pinned = file(t.path(), "p.bin", 10, 0);
    // (computed independently: sha256(b"pawfp1" + le64(10) + bytes)[..32])
    assert_eq!(quick(&pinned).unwrap().fingerprint, "q1-10-118f70f4e373a03f0f7e8dbd4df47a3f");
  }

  #[test]
  fn sha256_matches_and_cancels() {
    let t = tempfile::tempdir().unwrap();
    let p = file(t.path(), "x.bin", 3 * CHUNK as usize + 7, 3);
    let job = Job::default();
    let h = sha256_file(&job, &p, &|_| {}).unwrap();
    assert_eq!(h, crate::files::sha256_hex(&fs::read(&p).unwrap()));
    job.cancel();
    assert_eq!(sha256_file(&job, &p, &|_| {}).unwrap_err().code, "cancelled");
  }

  #[test]
  fn relink_finds_moved_copy() {
    let t = tempfile::tempdir().unwrap();
    let orig = file(t.path(), "orig.mp4", 4 * CHUNK as usize, 9);
    let fp = quick(&orig).unwrap().fingerprint;
    let deep = t.path().join("a/b");
    fs::create_dir_all(&deep).unwrap();
    fs::copy(&orig, deep.join("renamed 夏.mp4")).unwrap();
    file(&deep, "same-size-other.mp4", 4 * CHUNK as usize, 10);
    let hits = relink_search(t.path(), &fp, 3).unwrap();
    assert_eq!(hits.len(), 2);
    assert_eq!(relink_search(t.path(), &fp, 0).unwrap().len(), 1);
    assert_eq!(relink_search(t.path(), "junk", 3).unwrap_err().code, "invalid_input");
  }
}
