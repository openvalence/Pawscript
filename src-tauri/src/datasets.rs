//! Seeder datasets (paw-855t): a dataset is a named set of still-image labels with its own head, score and shuffle order, in
//! `<app data>/seeder/datasets/<id>/{labels, order, head.pt, head.json, score.json}`; the registry is `<seeder>/datasets.json`
//! (written by the app's JS, `{active, datasets: [{id, name, projects, archived?}]}`). Thumbnails and feature caches stay shared
//! in `<seeder>/{thumbs, feats*}` (per picture, not per dataset). This file: the one-time move of the old flat layout into
//! dataset "v1" and the creation of the new default dataset "v2", run at start-up. Nothing is ever deleted.
use std::fs;
use std::path::Path;

/// What the old layout kept per dataset (moved into datasets/v1).
const MOVE: [&str; 5] = ["labels", "order", "head.pt", "head.json", "score.json"];
pub const ERROR_FILE: &str = "migration-error.txt";

fn io(what: &str, e: std::io::Error) -> String {
  format!("{what}: {e}")
}

fn write_registry(seed: &Path, v1: bool) -> Result<(), String> {
  let now = crate::files::now_ms();
  let mut list = Vec::new();
  if v1 {
    list.push(serde_json::json!({"id": "v1", "name": "v1", "projects": true, "created": now}));
  }
  list.push(serde_json::json!({"id": "v2", "name": "v2", "projects": false, "created": now}));
  let reg = serde_json::json!({"version": 1, "active": "v2", "datasets": list});
  let tmp = seed.join("datasets.json.tmp");
  fs::write(&tmp, serde_json::to_vec_pretty(&reg).unwrap()).map_err(|e| io("write the registry", e))?;
  fs::rename(&tmp, seed.join("datasets.json")).map_err(|e| io("write the registry", e))
}

/// Move the old flat layout into dataset v1 and make v2 the active new one. Idempotent: once `datasets.json` exists nothing is done.
/// All or nothing: if any item cannot be moved (or its place is taken) the ones already moved go back and the registry is not written
/// (the app then keeps working on the old layout, says so, and the next start tries again). -> Ok(true) when it moved something.
pub fn migrate(seed: &Path) -> Result<bool, String> {
  if seed.join("datasets.json").exists() || !seed.exists() {
    return Ok(false);
  }
  let old: Vec<&str> = MOVE.iter().copied().filter(|n| seed.join(n).exists()).collect();
  if old.is_empty() {
    write_registry(seed, false)?;
    return Ok(false);
  }
  let v1 = seed.join("datasets").join("v1");
  let made = !v1.exists();
  fs::create_dir_all(&v1).map_err(|e| io("create datasets/v1", e))?;
  let mut moved: Vec<&str> = Vec::new();
  let undo = |moved: &[&str]| {
    for n in moved.iter().rev() {
      let _ = fs::rename(v1.join(n), seed.join(n));
    }
    if made {
      let _ = fs::remove_dir(&v1);
      let _ = fs::remove_dir(seed.join("datasets"));
    }
  };
  for n in &old {
    let to = v1.join(n);
    let r = if to.exists() { Err(format!("{} is already there", to.display())) } else { fs::rename(seed.join(n), &to).map_err(|e| io(&format!("move {n}"), e)) };
    if let Err(e) = r {
      undo(&moved);
      return Err(e);
    }
    moved.push(n);
  }
  if let Err(e) = write_registry(seed, true) {
    undo(&moved);
    return Err(e);
  }
  Ok(true)
}

/// The start-up call: migrate, and leave `migration-error.txt` beside the old files when it could not (removed again on success).
pub fn run(seed: &Path) {
  match migrate(seed) {
    Ok(_) => {
      let _ = fs::remove_file(seed.join(ERROR_FILE));
    }
    Err(e) => {
      let _ = fs::write(seed.join(ERROR_FILE), format!("The old seeder labels could not be moved into dataset v1: {e}. They are where they were."));
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn old_layout(seed: &Path) {
    fs::create_dir_all(seed.join("labels")).unwrap();
    fs::create_dir_all(seed.join("order")).unwrap();
    fs::create_dir_all(seed.join("thumbs")).unwrap();
    fs::create_dir_all(seed.join("feats")).unwrap();
    fs::write(seed.join("labels/iaaaaaaaaaaaaaa.json"), b"{\"key\":\"a\"}").unwrap();
    fs::write(seed.join("labels/ibbbbbbbbbbbbbb.json"), b"{\"key\":\"b\"}").unwrap();
    fs::write(seed.join("order/f.json"), b"{\"seed\":1}").unwrap();
    fs::write(seed.join("head.pt"), [1u8, 2, 3, 0, 255]).unwrap();
    fs::write(seed.join("head.json"), b"{\"frames\":2}").unwrap();
    fs::write(seed.join("score.json"), b"{\"latest\":null}").unwrap();
    fs::write(seed.join("thumbs/t.jpg"), b"t").unwrap();
    fs::write(seed.join("feats/f.npz"), b"f").unwrap();
  }

  #[test]
  fn old_layout_becomes_v1_losslessly_and_v2_is_the_new_default() {
    let t = tempfile::tempdir().unwrap();
    let seed = t.path().join("seeder");
    old_layout(&seed);
    assert!(migrate(&seed).unwrap());
    let v1 = seed.join("datasets/v1");
    assert_eq!(fs::read(v1.join("head.pt")).unwrap(), vec![1u8, 2, 3, 0, 255]);
    assert_eq!(fs::read(v1.join("labels/iaaaaaaaaaaaaaa.json")).unwrap(), b"{\"key\":\"a\"}");
    assert_eq!(fs::read_dir(v1.join("labels")).unwrap().count(), 2);
    assert_eq!(fs::read(v1.join("order/f.json")).unwrap(), b"{\"seed\":1}");
    assert!(v1.join("head.json").exists() && v1.join("score.json").exists());
    for gone in ["labels", "order", "head.pt", "head.json", "score.json"] {
      assert!(!seed.join(gone).exists(), "{gone} moved, not copied");
    }
    assert!(seed.join("thumbs/t.jpg").exists() && seed.join("feats/f.npz").exists(), "thumbnails and feature caches stay shared");
    assert!(seed.join("datasets/v2").is_dir() || !seed.join("datasets/v2").exists());
    let reg: serde_json::Value = serde_json::from_slice(&fs::read(seed.join("datasets.json")).unwrap()).unwrap();
    assert_eq!(reg["active"], "v2");
    assert_eq!(reg["datasets"][0]["id"], "v1");
    assert_eq!(reg["datasets"][0]["projects"], true, "v1 keeps learning from projects");
    assert_eq!(reg["datasets"][1]["id"], "v2");
    assert_eq!(reg["datasets"][1]["projects"], false);
  }

  #[test]
  fn idempotent() {
    let t = tempfile::tempdir().unwrap();
    let seed = t.path().join("seeder");
    old_layout(&seed);
    assert!(migrate(&seed).unwrap());
    let before = fs::read(seed.join("datasets.json")).unwrap();
    fs::write(seed.join("datasets/v1/labels/inew00000000000.json"), b"{}").unwrap(); // work done in v1 since
    assert!(!migrate(&seed).unwrap());
    assert_eq!(fs::read(seed.join("datasets.json")).unwrap(), before);
    assert_eq!(fs::read_dir(seed.join("datasets/v1/labels")).unwrap().count(), 3);
    fs::write(seed.join("head.pt"), b"stray").unwrap(); // a stray old-style file after the registry exists is left alone
    assert!(!migrate(&seed).unwrap());
    assert!(seed.join("head.pt").exists());
  }

  #[test]
  fn fresh_install_gets_only_v2() {
    let t = tempfile::tempdir().unwrap();
    let seed = t.path().join("seeder");
    fs::create_dir_all(seed.join("thumbs")).unwrap();
    assert!(!migrate(&seed).unwrap());
    let reg: serde_json::Value = serde_json::from_slice(&fs::read(seed.join("datasets.json")).unwrap()).unwrap();
    assert_eq!(reg["datasets"].as_array().unwrap().len(), 1);
    assert_eq!(reg["active"], "v2");
    assert!(!migrate(&t.path().join("none")).unwrap(), "no seeder folder yet: nothing to do, nothing created");
    assert!(!t.path().join("none").exists());
  }

  #[test]
  fn a_failure_leaves_the_old_files_where_they_were_and_says_so() {
    let t = tempfile::tempdir().unwrap();
    let seed = t.path().join("seeder");
    old_layout(&seed);
    fs::create_dir_all(seed.join("datasets/v1")).unwrap();
    fs::write(seed.join("datasets/v1/score.json"), b"in the way").unwrap(); // the last item's place is taken
    run(&seed);
    for kept in ["labels", "order", "head.pt", "head.json", "score.json"] {
      assert!(seed.join(kept).exists(), "{kept} is still in the old place");
    }
    assert_eq!(fs::read(seed.join("head.pt")).unwrap(), vec![1u8, 2, 3, 0, 255]);
    assert!(!seed.join("datasets/v1/head.pt").exists() && !seed.join("datasets/v1/labels").exists(), "the ones already moved went back");
    assert!(!seed.join("datasets.json").exists(), "no registry: the app knows it did not happen");
    assert!(fs::read_to_string(seed.join(ERROR_FILE)).unwrap().contains("already there"));
    fs::remove_file(seed.join("datasets/v1/score.json")).unwrap(); // fixed: the next start does it and clears the note
    run(&seed);
    assert!(seed.join("datasets/v1/labels").exists() && !seed.join(ERROR_FILE).exists());
  }
}
