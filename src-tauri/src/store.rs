//! App-owned persistent state: the settings blob, the recent-files list and
//! autosave snapshots. All writes are atomic (files::write_atomic). Locations
//! are resolved in commands.rs and listed in API.md.

use crate::error::{At, Error, Result};
use crate::files::{self, mtime_ms, now_ms, path_key, path_str, sha256_hex, write_atomic};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static LOCK: Mutex<()> = Mutex::new(());

fn ensure_parent(p: &Path) -> Result<()> {
  match p.parent() {
    Some(d) => fs::create_dir_all(d).at(d),
    None => Ok(()),
  }
}

/// Moves an unreadable file aside (`name.corrupt-<ms>`) so it is kept for
/// inspection but no longer blocks startup. Returns the new path.
fn set_aside(p: &Path) -> Option<PathBuf> {
  let aside = p.with_file_name(format!("{}.corrupt-{}", p.file_name()?.to_string_lossy(), now_ms()));
  fs::rename(p, &aside).ok().map(|_| aside)
}

// ---------------------------------------------------------------- settings

#[derive(Debug, serde::Serialize)]
pub struct Loaded {
  /// The stored JSON, or null when there is none yet.
  pub value: Value,
  /// Set when the file was unreadable and was moved aside (show it to the user).
  pub warning: Option<String>,
}

pub fn load_json(p: &Path) -> Result<Loaded> {
  let bytes = match fs::read(p) {
    Ok(b) => b,
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Loaded { value: Value::Null, warning: None }),
    Err(e) => return Err(Error::io(e, p)),
  };
  match serde_json::from_slice(&bytes) {
    Ok(value) => Ok(Loaded { value, warning: None }),
    Err(e) => {
      let aside = set_aside(p).map(|a| path_str(&a)).unwrap_or_default();
      Ok(Loaded { value: Value::Null, warning: Some(format!("{} was unreadable ({e}); kept as {aside}; starting fresh", p.display())) })
    }
  }
}

pub fn save_json(p: &Path, value: &Value) -> Result<()> {
  ensure_parent(p)?;
  let body = serde_json::to_vec_pretty(value).map_err(|e| Error::invalid(e.to_string()))?;
  write_atomic(p, &body).map(|_| ())
}

// ---------------------------------------------------------------- recent files

const RECENT_CAP: usize = 30;

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Recent {
  pub path: String,
  pub name: String,
  /// "project" | "script" | "media" | "other", from the extension.
  pub kind: String,
  pub opened_ms: i64,
  /// Filled in when listing; not stored.
  #[serde(default, skip_deserializing)]
  pub exists: bool,
}

pub fn kind_of(path: &Path) -> &'static str {
  let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
  match ext.as_str() {
    "pawproj" => "project",
    "funscript" => "script",
    "mp4" | "m4v" | "mov" | "mkv" | "webm" | "avi" | "wmv" | "flv" | "mpg" | "mpeg" | "ts" | "m2ts" | "ogv" | "3gp" | "mp3" | "m4a" | "wav" | "flac"
    | "ogg" | "opus" | "aac" => "media",
    _ => "other",
  }
}

fn load_recent(p: &Path) -> Vec<Recent> {
  fs::read(p).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save_recent(p: &Path, list: &[Recent]) -> Result<()> {
  save_json(p, &serde_json::to_value(list).unwrap_or(Value::Null))
}

pub fn recent_list(p: &Path) -> Vec<Recent> {
  let mut v = load_recent(p);
  for r in &mut v {
    r.exists = Path::new(&r.path).exists();
  }
  v
}

/// Moves `path` to the top (newest first), dropping duplicates of the same file.
pub fn recent_add(p: &Path, path: &Path) -> Result<Vec<Recent>> {
  let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
  let abs = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
  let key = path_key(&abs);
  let mut v = load_recent(p);
  v.retain(|r| path_key(Path::new(&r.path)) != key);
  let name = abs.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
  v.insert(0, Recent { path: path_str(&abs), name, kind: kind_of(&abs).into(), opened_ms: now_ms(), exists: true });
  v.truncate(RECENT_CAP);
  save_recent(p, &v)?;
  Ok(recent_list(p))
}

pub fn recent_remove(p: &Path, path: Option<&Path>) -> Result<Vec<Recent>> {
  let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
  let mut v = load_recent(p);
  match path {
    Some(path) => {
      let key = path_key(path);
      v.retain(|r| path_key(Path::new(&r.path)) != key);
    }
    None => v.clear(),
  }
  save_recent(p, &v)?;
  Ok(recent_list(p))
}

// ---------------------------------------------------------------- autosave

/// One autosave folder per document: `p-<16 hex of the project path>` for a saved
/// project, `u-<session id>` for unsaved work. Holds `meta.json` and up to `keep`
/// snapshots named `<unix ms, 13 digits>.pawproj`.
pub fn autosave_id(project: Option<&Path>, session: &str) -> Result<String> {
  match project {
    Some(p) => Ok(format!("p-{}", &sha256_hex(path_key(p).as_bytes())[..16])),
    None if valid_session(session) => Ok(format!("u-{session}")),
    None => Err(Error::invalid("session must be 1-64 characters of A-Z a-z 0-9 _ -")),
  }
}

fn valid_session(s: &str) -> bool {
  (1..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn valid_id(id: &str) -> bool {
  (id.starts_with("p-") || id.starts_with("u-")) && valid_session(&id[2..])
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Default)]
struct Meta {
  project_path: Option<String>,
  session: String,
  title: String,
  updated_ms: i64,
}

#[derive(Debug, serde::Serialize, PartialEq)]
pub struct Snapshot {
  pub id: String,
  pub path: String,
  pub saved_ms: i64,
  pub size: u64,
}

pub fn autosave_write(root: &Path, project: Option<&Path>, session: &str, title: &str, content: &str, keep: usize) -> Result<Snapshot> {
  let id = autosave_id(project, session)?;
  let dir = root.join(&id);
  fs::create_dir_all(&dir).at(&dir)?;
  let mut ms = now_ms();
  // Strictly increasing names even for two writes in one millisecond.
  if let Some(last) = newest(&dir) {
    ms = ms.max(last + 1);
  }
  let path = dir.join(format!("{ms:013}.pawproj"));
  let w = write_atomic(&path, content.as_bytes())?;
  let meta = Meta { project_path: project.map(path_str), session: session.into(), title: title.into(), updated_ms: ms };
  write_atomic(&dir.join("meta.json"), &serde_json::to_vec_pretty(&meta).unwrap_or_default())?;
  files::prune(&dir, keep.max(1))?;
  Ok(Snapshot { id, path: path_str(&path), saved_ms: ms, size: w.size })
}

fn snapshot_list(dir: &Path) -> Vec<(i64, PathBuf)> {
  let mut v: Vec<(i64, PathBuf)> = fs::read_dir(dir)
    .into_iter()
    .flatten()
    .filter_map(|e| e.ok())
    .filter_map(|e| {
      let n = e.file_name().into_string().ok()?;
      let ms = n.strip_suffix(".pawproj")?.parse().ok()?;
      Some((ms, e.path()))
    })
    .collect();
  v.sort_by_key(|(ms, _)| std::cmp::Reverse(*ms));
  v
}

fn newest(dir: &Path) -> Option<i64> {
  snapshot_list(dir).first().map(|(ms, _)| *ms)
}

#[derive(Debug, serde::Serialize)]
pub struct Candidate {
  pub id: String,
  pub project_path: Option<String>,
  pub session: String,
  pub title: String,
  pub updated_ms: i64,
  /// Newest first.
  pub snapshots: Vec<Snapshot>,
  /// The project file's mtime, when there is a project and it still exists.
  pub project_mtime_ms: Option<i64>,
  /// True when the newest snapshot is newer than the saved project (or there is
  /// no saved project): the snapshot may hold work that was never saved.
  pub unsaved_work: bool,
}

/// Every autosave folder that holds at least one snapshot, newest first.
pub fn autosave_list(root: &Path) -> Vec<Candidate> {
  let mut out = Vec::new();
  for e in fs::read_dir(root).into_iter().flatten().filter_map(|e| e.ok()) {
    let Ok(id) = e.file_name().into_string() else { continue };
    if !valid_id(&id) {
      continue;
    }
    let dir = e.path();
    let snaps = snapshot_list(&dir);
    if snaps.is_empty() {
      continue;
    }
    let meta: Meta = fs::read(dir.join("meta.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    let project_mtime_ms = meta.project_path.as_ref().and_then(|p| fs::metadata(p).ok()).and_then(|m| mtime_ms(&m));
    let newest_ms = snaps[0].0;
    let snapshots = snaps
      .into_iter()
      .map(|(ms, p)| Snapshot { id: id.clone(), size: fs::metadata(&p).map(|m| m.len()).unwrap_or(0), path: path_str(&p), saved_ms: ms })
      .collect();
    out.push(Candidate {
      unsaved_work: project_mtime_ms.is_none_or(|m| newest_ms > m),
      id,
      project_path: meta.project_path,
      session: meta.session,
      title: meta.title,
      updated_ms: newest_ms,
      snapshots,
      project_mtime_ms,
    });
  }
  out.sort_by_key(|c| std::cmp::Reverse(c.updated_ms));
  out
}

pub fn autosave_clear(root: &Path, id: &str) -> Result<()> {
  if !valid_id(id) {
    return Err(Error::invalid(format!("not an autosave id: {id}")));
  }
  let dir = root.join(id);
  match fs::remove_dir_all(&dir) {
    Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(Error::io(e, &dir)),
    _ => Ok(()),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn settings_roundtrip_and_corrupt_file_is_kept() {
    let t = tempfile::tempdir().unwrap();
    let p = t.path().join("cfg/settings.json");
    assert_eq!(load_json(&p).unwrap().value, Value::Null);
    save_json(&p, &serde_json::json!({"theme": "dark", "n": 3})).unwrap();
    assert_eq!(load_json(&p).unwrap().value["n"], 3);
    fs::write(&p, b"{not json").unwrap();
    let l = load_json(&p).unwrap();
    assert_eq!(l.value, Value::Null);
    assert!(l.warning.is_some());
    let kept: Vec<_> = fs::read_dir(t.path().join("cfg")).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
    assert_eq!(kept.len(), 1);
    assert!(kept[0].starts_with("settings.json.corrupt-"));
  }

  #[test]
  fn recent_dedupes_and_caps() {
    let t = tempfile::tempdir().unwrap();
    let p = t.path().join("recent.json");
    let a = t.path().join("a.pawproj");
    fs::write(&a, b"").unwrap();
    for i in 0..40 {
      recent_add(&p, &t.path().join(format!("v{i}.mp4"))).unwrap();
    }
    recent_add(&p, &a).unwrap();
    let v = recent_add(&p, &a).unwrap();
    assert_eq!(v.len(), RECENT_CAP);
    assert_eq!(v[0].name, "a.pawproj");
    assert_eq!(v[0].kind, "project");
    assert!(v[0].exists && !v[1].exists);
    assert_eq!(v.iter().filter(|r| r.name == "a.pawproj").count(), 1);
    assert_eq!(recent_remove(&p, Some(&a)).unwrap().len(), RECENT_CAP - 1);
    assert!(recent_remove(&p, None).unwrap().is_empty());
  }

  #[test]
  fn autosave_rotates_lists_and_clears() {
    let t = tempfile::tempdir().unwrap();
    let root = t.path().join("autosave");
    for i in 0..15 {
      autosave_write(&root, None, "sess-1", "Untitled", &format!("{{\"v\":{i}}}"), 10).unwrap();
    }
    let proj = t.path().join("p.pawproj");
    fs::write(&proj, b"{}").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    let s = autosave_write(&root, Some(&proj), "sess-2", "p", "{}", 10).unwrap();
    assert!(s.id.starts_with("p-"));
    let list = autosave_list(&root);
    assert_eq!(list.len(), 2);
    let u = list.iter().find(|c| c.id == "u-sess-1").unwrap();
    assert_eq!(u.snapshots.len(), 10);
    assert_eq!(fs::read_to_string(&u.snapshots[0].path).unwrap(), "{\"v\":14}");
    assert!(u.unsaved_work);
    let p = list.iter().find(|c| c.id == s.id).unwrap();
    assert_eq!(p.project_path.as_deref(), Some(path_str(&proj).as_str()));
    assert!(p.unsaved_work); // snapshot written after the project file
    autosave_clear(&root, "u-sess-1").unwrap();
    assert_eq!(autosave_list(&root).len(), 1);
    assert_eq!(autosave_clear(&root, "../etc").unwrap_err().code, "invalid_input");
    assert_eq!(autosave_write(&root, None, "a/b", "", "", 1).unwrap_err().code, "invalid_input");
  }

  #[test]
  fn autosave_pruning_keeps_the_runs_file_and_clear_removes_it() {
    let t = tempfile::tempdir().unwrap();
    let root = t.path().join("autosave");
    let s = autosave_write(&root, None, "sess-r", "", "{}", 2).unwrap();
    let runs = root.join(&s.id).join("runs.pawruns"); // the tracking store's autosaved runs (fixed name, not a snapshot)
    fs::write(&runs, [1u8, 2, 3]).unwrap();
    for _ in 0..5 {
      autosave_write(&root, None, "sess-r", "", "{}", 2).unwrap();
    }
    assert_eq!(fs::read(&runs).unwrap(), [1, 2, 3]);
    assert_eq!(autosave_list(&root)[0].snapshots.len(), 2);
    autosave_clear(&root, &s.id).unwrap();
    assert!(!runs.exists());
  }
}
