//! Media cache: one folder per result under `<app cache>/media-cache/`, named
//! `<kind>-<24 hex>` where the hex is a hash of the source's path key, size,
//! mtime and the request parameters, so an edited or replaced video never
//! serves stale data. A folder is complete once its `done` file exists; the
//! `done` file's mtime is the last-use stamp for LRU eviction. Total size is
//! capped (`limit()`: default `LIMIT`, set from the front end's `media.cacheGb` through `media_cache_limit`);
//! the oldest entries go first. paw-mh1a: never an entry of a file the app has open (`set_open`: the video and its
//! proxy; known by the keys made this session, `Cache::key`), and every eviction is noted (`take_evicted`) for the
//! front end's usage log.

use crate::error::{At, Error, Result};
use crate::files::{path_key, path_str, sha256_hex};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

pub const LIMIT: u64 = 2 << 30; // 2 GiB

static LIMIT_NOW: AtomicU64 = AtomicU64::new(LIMIT);
/// The cache size limit in force (bytes).
pub fn limit() -> u64 {
  LIMIT_NOW.load(Ordering::Relaxed)
}
/// Sets it, clamped to 512 MiB ..= 512 GiB; returns the value kept.
pub fn set_limit(bytes: u64) -> u64 {
  let b = bytes.clamp(512 << 20, 512 << 30);
  LIMIT_NOW.store(b, Ordering::Relaxed);
  b
}

/// Entry folders being written right now (claimed by `begin`).
static BUILDING: LazyLock<Mutex<HashSet<PathBuf>>> = LazyLock::new(Default::default);
/// paw-mh1a: the source (path key) of every entry key made this session, the files open in the app (path keys), and the
/// evictions not yet handed to the front end.
static KEY_SRC: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(Default::default);
static OPEN: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);
static EVICTED: LazyLock<Mutex<Vec<Evicted>>> = LazyLock::new(Default::default);

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
  m.lock().unwrap_or_else(|e| e.into_inner())
}
/// The files the app has open now (replaces the previous set): their entries are never evicted.
pub fn set_open(paths: &[PathBuf]) {
  *lock(&OPEN) = paths.iter().map(|p| path_key(p)).collect();
}
/// The evictions since the last call (oldest first).
pub fn take_evicted() -> Vec<Evicted> {
  std::mem::take(&mut *lock(&EVICTED))
}

/// One entry evicted: its kind (the key's prefix: scrub, proxy, thumbs, ...), size and how long since it was last used.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Evicted {
  pub kind: String,
  pub bytes: u64,
  pub age_s: u64,
}

pub struct Cache {
  pub root: PathBuf,
  pub limit: u64,
}

/// paw-zkvc: one entry made from a file: its kind (scrub, proxy, remux, thumbs, peaks, frametimes, probe, ...) and size.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Item {
  pub kind: String,
  pub bytes: u64,
}

#[derive(Debug, Default, serde::Serialize)]
pub struct Removed {
  pub freed: Vec<Item>,
  pub kept: Vec<Item>,
}

/// The keys the usual requests for `src` make (media.rs: probe, frame times, remux, scrub, proxy). One metadata read and
/// one path key per source (~1,020 keys: on a network share each read is a round trip), and not noted as made.
fn known_keys(src: &Path) -> Vec<String> {
  let Ok(id) = source_id(src) else { return Vec::new() };
  let mut want: Vec<(&str, String)> = vec![("probe", "v2".into()), ("remux", "v1".into()), ("remux", "v1 h264".into()), ("scrub", "v1".into())];
  want.extend(crate::media::scrub_heights(u32::MAX).into_iter().map(|h| ("scrub", format!("v1 h={h}"))));
  want.extend((144..=2160).step_by(2).map(|h| ("proxy", format!("v2 h={h}"))));
  want.extend((0..8).map(|s| ("frametimes", format!("v1 s={s}"))));
  want.into_iter().map(|(k, p)| key_of(&id, k, &p)).collect()
}

/// What a key is made from besides the request: the source's path key, size and mtime.
fn source_id(input: &Path) -> Result<(String, u64, u128)> {
  let m = fs::metadata(input).at(input)?;
  let mtime = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos());
  Ok((path_key(input), m.len(), mtime))
}
fn key_of((src, len, mtime): &(String, u64, u128), kind: &str, params: &str) -> String {
  let h = sha256_hex(format!("{src}\n{len}\n{mtime}\n{params}").as_bytes());
  format!("{kind}-{}", &h[..24])
}

#[derive(Debug, serde::Serialize)]
pub struct CacheInfo {
  pub path: String,
  pub bytes: u64,
  pub entries: usize,
  pub limit: u64,
}

fn dir_size(dir: &Path) -> u64 {
  fs::read_dir(dir).into_iter().flatten().filter_map(|e| e.ok()?.metadata().ok()).map(|m| m.len()).sum()
}

/// paw-bfi4: a folder named as `key_of` names entries (`<kind>-<24 hex>`). The cache folder can be one the user picked
/// (`media.cacheDir`), so nothing else in it is ever listed, counted or deleted.
fn is_entry_name(name: &str) -> bool {
  name.split_once('-').is_some_and(|(kind, h)| {
    !kind.is_empty() && kind.bytes().all(|b| b.is_ascii_lowercase()) && h.len() == 24 && h.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
  })
}

/// paw-bfi4: deletes an entry folder unless a build claims it, deciding and deleting under BUILDING's lock, so a racing
/// `begin` either claimed it first (kept) or makes its folder afresh after the delete. `done`: the entry must still have
/// its `done` file, which goes first (a folder Windows only half deletes is a leftover, never a hit); else it must have
/// none (a leftover of an interrupted build; one that finished since it was listed is kept). Ok(false): kept.
fn remove_entry(dir: &Path, done: bool) -> std::io::Result<bool> {
  let building = lock(&BUILDING);
  let stamp = dir.join("done");
  if building.contains(dir) || stamp.is_file() != done {
    return Ok(false);
  }
  if done {
    fs::remove_file(&stamp)?;
  }
  fs::remove_dir_all(dir).map(|_| true)
}

fn touch(p: &Path) {
  if let Ok(f) = File::options().write(true).open(p) {
    let _ = f.set_modified(SystemTime::now());
  }
}

impl Cache {
  pub fn key(input: &Path, kind: &str, params: &str) -> Result<String> {
    let id = source_id(input)?;
    let key = key_of(&id, kind, params);
    lock(&KEY_SRC).insert(key.clone(), id.0);
    Ok(key)
  }

  /// The finished entry folder for `key`, marking it used.
  pub fn get(&self, key: &str) -> Option<PathBuf> {
    let dir = self.root.join(key);
    let done = dir.join("done");
    done.is_file().then(|| {
      touch(&done);
      dir
    })
  }

  /// Claims `key` and gives an empty folder to build the entry in place (so
  /// progressive results already have their final paths). Dropping the
  /// `Building` without `finish` removes the folder.
  pub fn begin(&self, key: &str) -> Result<Building<'_>> {
    let dir = self.root.join(key);
    if !BUILDING.lock().unwrap_or_else(|e| e.into_inner()).insert(dir.clone()) {
      return Err(Error::new("busy", format!("{key} is already being generated")));
    }
    let b = Building { cache: self, dir: dir.clone(), finished: false };
    if dir.exists() {
      fs::remove_dir_all(&dir).at(&dir)?;
    }
    fs::create_dir_all(&dir).at(&dir)?;
    Ok(b)
  }

  fn entries(&self) -> Vec<(PathBuf, Option<SystemTime>, u64)> {
    fs::read_dir(&self.root)
      .into_iter()
      .flatten()
      .filter_map(|e| e.ok())
      .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()) && is_entry_name(&e.file_name().to_string_lossy()))
      .map(|e| {
        let dir = e.path();
        let used = fs::metadata(dir.join("done")).and_then(|m| m.modified()).ok();
        let size = dir_size(&dir);
        (dir, used, size)
      })
      .collect()
  }

  /// Deletes leftovers of interrupted builds, then least-recently-used entries
  /// until the total fits the limit. `keep`, and the entries of the files open in
  /// the app (`set_open`), are never evicted.
  pub fn evict(&self, keep: Option<&Path>) -> Result<()> {
    let (open, srcs) = (lock(&OPEN).clone(), lock(&KEY_SRC).clone());
    let in_use = |dir: &Path| dir.file_name().and_then(|n| srcs.get(&*n.to_string_lossy())).is_some_and(|s| open.contains(s));
    let mut done = Vec::new();
    for (dir, used, size) in self.entries() {
      match used {
        Some(t) => done.push((t, dir, size)),
        None => {
          let _ = remove_entry(&dir, false);
        }
      }
    }
    let mut total: u64 = done.iter().map(|(_, _, s)| s).sum();
    done.sort_by_key(|(t, _, _)| *t);
    for (t, dir, size) in done {
      if total <= self.limit {
        break;
      }
      if Some(dir.as_path()) == keep || in_use(&dir) {
        continue;
      }
      if matches!(remove_entry(&dir, true), Ok(true)) {
        total -= size;
        let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let age_s = SystemTime::now().duration_since(t).map_or(0, |d| d.as_secs());
        lock(&EVICTED).push(Evicted { kind: name.split('-').next().unwrap_or("").to_string(), bytes: size, age_s });
      }
    }
    Ok(())
  }

  pub fn info(&self) -> CacheInfo {
    let e = self.entries();
    CacheInfo { path: path_str(&self.root), bytes: e.iter().map(|x| x.2).sum(), entries: e.len(), limit: self.limit }
  }

  /// paw-zkvc: the finished entries made from `srcs` (a video, its proxies): every key made from them this session
  /// (`KEY_SRC`) and the keys their usual requests make (probe, frame times, remux, scrub at every ladder height,
  /// proxies at every height). ponytail: waveform / filmstrip / repeats keys depend on view parameters, so an old one is
  /// found only once this session made its key (opening the video makes them); widen `known_keys` if that ever misses.
  pub fn entries_of(&self, srcs: &[PathBuf]) -> Vec<(PathBuf, Item)> {
    let keys: HashSet<String> = srcs.iter().flat_map(|p| known_keys(p)).collect();
    let want: HashSet<String> = srcs.iter().map(|p| path_key(p)).collect();
    let (made, building) = (lock(&KEY_SRC).clone(), BUILDING.lock().unwrap_or_else(|e| e.into_inner()).clone());
    let mut out: Vec<(PathBuf, Item)> = self
      .entries()
      .into_iter()
      .filter(|(dir, used, _)| used.is_some() && !building.contains(dir))
      .filter_map(|(dir, _, bytes)| {
        let name = dir.file_name()?.to_string_lossy().into_owned();
        let ours = keys.contains(&name) || made.get(&name).is_some_and(|s| want.contains(s));
        ours.then(|| (dir, Item { kind: name.split('-').next().unwrap_or("").to_string(), bytes }))
      })
      .collect();
    out.sort_by(|a, b| b.1.bytes.cmp(&a.1.bytes));
    out
  }

  /// paw-zkvc: removes `entries_of(srcs)`; an entry that cannot go (a file still open) is kept and said so.
  pub fn remove_of(&self, srcs: &[PathBuf]) -> Removed {
    let mut r = Removed::default();
    for (dir, it) in self.entries_of(srcs) {
      if matches!(remove_entry(&dir, true), Ok(true)) {
        r.freed.push(it);
      } else {
        r.kept.push(it);
      }
    }
    r
  }

  /// Removes every entry not being built right now.
  pub fn clear(&self) -> Result<CacheInfo> {
    for (dir, used, _) in self.entries() {
      remove_entry(&dir, used.is_some()).at(&dir)?;
    }
    Ok(self.info())
  }
}

pub struct Building<'a> {
  cache: &'a Cache,
  pub dir: PathBuf,
  finished: bool,
}

impl Building<'_> {
  pub fn finish(mut self) -> Result<PathBuf> {
    File::create(self.dir.join("done")).at(&self.dir)?;
    self.finished = true;
    BUILDING.lock().unwrap_or_else(|e| e.into_inner()).remove(&self.dir);
    let _ = self.cache.evict(Some(&self.dir));
    Ok(self.dir.clone())
  }
}

impl Drop for Building<'_> {
  fn drop(&mut self) {
    if !self.finished {
      let _ = fs::remove_dir_all(&self.dir);
      BUILDING.lock().unwrap_or_else(|e| e.into_inner()).remove(&self.dir);
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::time::Duration;

  fn entry(c: &Cache, key: &str, bytes: usize, age_s: u64) -> PathBuf {
    let b = c.begin(key).unwrap();
    fs::write(b.dir.join("data"), vec![0u8; bytes]).unwrap();
    let dir = b.finish().unwrap();
    File::options().write(true).open(dir.join("done")).unwrap().set_modified(SystemTime::now() - Duration::from_secs(age_s)).unwrap();
    dir
  }
  /// An entry name (`<kind>-<24 hex>`) for a test key.
  fn k(s: &str) -> String {
    key_of(&(s.into(), 0, 0), "test", "")
  }

  #[test]
  fn key_changes_with_content_and_params() {
    let t = tempfile::tempdir().unwrap();
    let v = t.path().join("v.mp4");
    fs::write(&v, b"abc").unwrap();
    let k1 = Cache::key(&v, "peaks", "r=8").unwrap();
    assert_eq!(k1, Cache::key(&v, "peaks", "r=8").unwrap());
    assert_ne!(k1, Cache::key(&v, "peaks", "r=4").unwrap());
    assert!(k1.starts_with("peaks-") && k1.len() == 6 + 24);
    fs::write(&v, b"abcd").unwrap(); // size (and mtime) change
    assert_ne!(k1, Cache::key(&v, "peaks", "r=8").unwrap());
    assert_eq!(Cache::key(&t.path().join("nope"), "peaks", "").unwrap_err().code, "not_found");
  }

  #[test]
  fn lru_eviction_keeps_recent_and_protected() {
    let t = tempfile::tempdir().unwrap();
    let c = Cache { root: t.path().to_path_buf(), limit: 2500 };
    let a = entry(&c, &k("a"), 1000, 300);
    let b = entry(&c, &k("b"), 1000, 200);
    assert!(c.get(&k("a")).is_some()); // a is now the most recent
    let d = entry(&c, &k("d"), 1000, 0); // total 3000 > 2500: b (oldest use) goes
    c.evict(Some(&d)).unwrap();
    assert!(a.exists() && !b.exists() && d.exists());
    assert!(c.get(&k("b")).is_none());
  }

  /// paw-mh1a: least recently USED first; the open video's entries (keys made from it) stay even when they are the
  /// oldest; each eviction is noted with its kind, size and age.
  #[test]
  fn eviction_spares_open_files_and_notes_what_goes() {
    let t = tempfile::tempdir().unwrap();
    let (v, w) = (t.path().join("open.mp4"), t.path().join("other.mp4"));
    fs::write(&v, b"v").unwrap();
    fs::write(&w, b"w").unwrap();
    let c = Cache { root: t.path().join("c"), limit: 2500 };
    let (ko, kp, kw) = (Cache::key(&v, "scrub", "v1").unwrap(), Cache::key(&v, "proxy", "h=480").unwrap(), Cache::key(&w, "thumbs", "").unwrap());
    set_open(&[v.clone()]);
    take_evicted();
    let o = entry(&c, &ko, 1000, 900); // the oldest, but its video is open
    let p = entry(&c, &kp, 1000, 800);
    let x = entry(&c, &kw, 1000, 700); // the least recently used of the rest
    let n = entry(&c, &key_of(&("new".into(), 0, 0), "probe", ""), 1000, 0);
    c.evict(Some(&n)).unwrap();
    assert!(o.exists() && p.exists() && !x.exists() && n.exists());
    let mine = |e: Vec<Evicted>| e.into_iter().filter(|e| ["scrub", "proxy", "thumbs", "probe"].contains(&e.kind.as_str())).collect::<Vec<_>>();   // other tests evict in parallel
    let e = mine(take_evicted());
    assert_eq!(e.len(), 1, "{e:?}");
    assert!(e[0].kind == "thumbs" && e[0].bytes == 1000 && (690..=710).contains(&e[0].age_s), "{e:?}");
    set_open(&[]);
    c.evict(Some(&n)).unwrap(); // closed: now the oldest goes, until the rest fits
    assert!(!o.exists() && p.exists() && n.exists());
    assert_eq!(mine(take_evicted()).iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(), ["scrub"]);
  }

  /// paw-zkvc: Clean project lists and removes the entries of its video (made this session, or a usual key of an older
  /// session) and its proxy, never another video's, never one being built.
  #[test]
  fn entries_of_a_video_only() {
    let t = tempfile::tempdir().unwrap();
    let (v, px, w) = (t.path().join("mine.mp4"), t.path().join("mine-proxy.mp4"), t.path().join("other.mp4"));
    for p in [&v, &px, &w] {
      fs::write(p, p.to_string_lossy().as_bytes()).unwrap();
    }
    let c = Cache { root: t.path().join("c"), limit: LIMIT };
    let a = entry(&c, &Cache::key(&v, "peaks", "v1 rate=1000 spb=8").unwrap(), 300, 10); // made this session
    let b = entry(&c, &Cache::key(&v, "proxy", "v2 h=480").unwrap(), 2000, 10); // a usual key
    lock(&KEY_SRC).remove(b.file_name().unwrap().to_str().unwrap()); // as if made in an earlier session
    let s = entry(&c, &Cache::key(&px, "scrub", "v1").unwrap(), 1000, 10); // the proxy's own scrub cache
    let o = entry(&c, &Cache::key(&w, "proxy", "v2 h=480").unwrap(), 500, 10); // another video's
    let busy = c.begin(&Cache::key(&v, "scrub", "v1").unwrap()).unwrap(); // being built: not listed, not touched
    let got = c.entries_of(&[v.clone(), px.clone()]);
    assert_eq!(got.iter().map(|(_, i)| (i.kind.as_str(), i.bytes)).collect::<Vec<_>>(), [("proxy", 2000), ("scrub", 1000), ("peaks", 300)]);
    let r = c.remove_of(&[v.clone(), px.clone()]);
    assert_eq!(r.freed.iter().map(|i| i.bytes).sum::<u64>(), 3300);
    assert!(r.kept.is_empty());
    assert!(!a.exists() && !b.exists() && !s.exists() && o.exists() && busy.dir.exists());
    assert!(c.entries_of(&[v]).is_empty());
  }

  #[test]
  fn unfinished_build_is_removed_and_keys_are_exclusive() {
    let t = tempfile::tempdir().unwrap();
    let c = Cache { root: t.path().to_path_buf(), limit: LIMIT };
    let b = c.begin(&k("x")).unwrap();
    assert_eq!(c.begin(&k("x")).err().unwrap().code, "busy");
    fs::write(b.dir.join("partial"), b"..").unwrap();
    assert!(c.get(&k("x")).is_none());
    let dir = b.dir.clone();
    drop(b);
    assert!(!dir.exists());
    let stale = t.path().join(k("stale"));
    fs::create_dir_all(&stale).unwrap(); // crash leftover: no done file
    c.evict(None).unwrap();
    assert!(!stale.exists());
    entry(&c, &k("y"), 10, 0);
    assert_eq!(c.info().entries, 1);
    assert_eq!(c.clear().unwrap().entries, 0);
  }

  /// paw-bfi4: the cache folder can be any folder the user picks (`media.cacheDir`): evicting and Clear cache never
  /// touch what is not a cache entry, finished or not.
  #[test]
  fn a_picked_folder_keeps_everything_but_entries() {
    let t = tempfile::tempdir().unwrap();
    let c = Cache { root: t.path().to_path_buf(), limit: 512 << 20 };
    let mine = ["Photos", "notes-2024", "scrub-not-hex-at-all-000000", "Proxy-0123456789abcdef01234567"].map(|n| t.path().join(n));
    for d in &mine {
      fs::create_dir_all(d).unwrap();
      fs::write(d.join("keep.txt"), b"mine").unwrap();
    }
    fs::create_dir_all(t.path().join("Done")).unwrap();
    File::create(t.path().join("Done").join("done")).unwrap(); // even with a `done` file
    fs::write(t.path().join("loose.txt"), b"mine").unwrap();
    let e = entry(&c, &k("e"), 10, 0);
    assert_eq!(c.info().entries, 1);
    c.evict(None).unwrap();
    assert_eq!(c.clear().unwrap().entries, 0);
    assert!(!e.exists());
    assert!(mine.iter().all(|d| d.join("keep.txt").is_file()) && t.path().join("Done/done").is_file() && t.path().join("loose.txt").is_file());
  }

  /// paw-bfi4: an entry another job is building is never deleted by an eviction that runs at the same time (each
  /// `finish` evicts). Before: evict copied the building set once, then deleted every listed folder without a `done`
  /// file, so a `begin` between the copy and the listing lost its folder mid-build (ffmpeg: "No such file or directory").
  #[test]
  fn eviction_never_deletes_an_entry_being_built() {
    use std::sync::atomic::AtomicBool;
    let t = tempfile::tempdir().unwrap();
    let c = Cache { root: t.path().to_path_buf(), limit: 512 << 30 };
    for i in 0..300 {
      entry(&c, &k(&format!("old{i}")), 10, 0); // a full cache: each listing takes a while
    }
    let stop = AtomicBool::new(false);
    std::thread::scope(|s| {
      s.spawn(|| {
        while !stop.load(Ordering::Relaxed) {
          c.evict(None).unwrap();
        }
      });
      let builders: Vec<_> = (0..4)
        .map(|w| {
          let c = &c;
          s.spawn(move || -> std::result::Result<(), String> {
            for i in 0..150 {
              let b = c.begin(&k(&format!("new{w}-{i}"))).map_err(|e| format!("build {w}-{i}: {e:?}"))?;
              for part in 0..4 {
                fs::write(b.dir.join(format!("part{part}")), b"..").map_err(|e| format!("build {w}-{i} lost its folder: {e}"))?;
                std::thread::yield_now();
              }
              let dir = b.finish().map_err(|e| format!("build {w}-{i}: {e:?}"))?;
              if !dir.join("done").is_file() {
                return Err(format!("build {w}-{i}: finished entry deleted"));
              }
            }
            Ok(())
          })
        })
        .collect();
      let got: Vec<_> = builders.into_iter().map(|h| h.join().unwrap_or_else(|_| Err("a builder panicked".into()))).collect();
      stop.store(true, Ordering::Relaxed);
      assert!(got.iter().all(|r| r.is_ok()), "{got:?}");
    });
  }
}
