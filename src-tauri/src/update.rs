//! paw-cdot: Help > Check for updates (and Settings > Updates): tauri-plugin-updater against the GitHub release's
//! latest.json, only when the user runs it (or turned on "Check for updates at start"). The other network connection
//! besides models.rs; it sends nothing but the request (GitHub sees the address and the user agent).
//!
//! Signed: the plugin checks the download against the public key in tauri.conf.json (plugins.updater.pubkey) before
//! anything is written. A build whose key is still the placeholder says "updates are not configured in this build" and
//! fetches nothing (docs/BUILDING.md: how the owner makes the key and signs a release).
//!
//! Two kinds of build:
//! - The shared (portable) build: a folder with Pawscript.exe, code.zip, python\ ... (no installer). Its release entry
//!   is `windows-x86_64-portable`: a small zip of Pawscript.exe + code.zip. Applied in place: the zip is listed first
//!   (only those two names, nothing else is accepted), unpacked into `.setup\update\`, the running exe renamed to
//!   `.setup\Pawscript.old.exe` (Windows allows renaming a running exe, not overwriting it) and the new one put where it
//!   was, code.zip replaced; any failure puts the old exe back. The next start unpacks the new code.zip (portable.rs, its
//!   stamp changed) and deletes the old exe. The runtime (Python, PyTorch, ffmpeg) is not in the update: the new exe's
//!   manifest names the runtime it needs, and its first-start screen downloads that one only when it differs from the
//!   unpacked one (src/features/models).
//! - An installer (NSIS) build: the plugin's own path; the installer runs when the user restarts.
//!
//! Restart: asked first by the front end, which writes every open project (writing.svelte.js closeApp); refused here while
//! a shell write is still in flight.

use crate::error::{At, Error, Result};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

/// The marker in a public key that was never set (tauri.conf.json).
pub const PLACEHOLDER: &str = "PLACEHOLDER";
/// latest.json's platform key for the shared build.
pub const PORTABLE_TARGET: &str = "windows-x86_64-portable";
/// The only names a portable update zip may hold.
pub const UPDATE_FILES: [&str; 2] = ["Pawscript.exe", "code.zip"];
const OLD_EXE: &str = "Pawscript.old.exe";

/// What a check found, and what has been fetched since.
#[derive(Default)]
pub struct Pending {
  update: Mutex<Option<tauri_plugin_updater::Update>>,
  /// an installer build's verified installer, run on restart
  installer: Mutex<Option<Vec<u8>>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
  pub configured: bool,
  pub current: String,
  pub version: Option<String>,
  pub notes: Option<String>,
  pub date: Option<String>,
  pub portable: bool,
}

/// The shared build's folder: the exe's, when code.zip lies beside it.
pub fn portable_dir() -> Option<PathBuf> {
  std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)).filter(|d| d.join("code.zip").is_file())
}

/// The public key in tauri.conf.json is a real one (not the placeholder, not empty).
pub fn key_configured(pubkey: Option<&str>) -> bool {
  pubkey.is_some_and(|k| !k.trim().is_empty() && !k.contains(PLACEHOLDER))
}

fn configured(app: &AppHandle) -> bool {
  key_configured(app.config().plugins.0.get("updater").and_then(|v| v.get("pubkey")).and_then(|v| v.as_str()))
}

fn plugin_error(e: tauri_plugin_updater::Error) -> Error {
  match e {
    tauri_plugin_updater::Error::Reqwest(r) if r.is_connect() || r.is_timeout() => Error::new("offline", format!("No connection to GitHub: check the network, then try again ({r})")),
    e => Error::new("update", e.to_string()),
  }
}

#[tauri::command]
pub async fn update_check(app: AppHandle, pending: tauri::State<'_, Pending>) -> Result<Found> {
  let mut found = Found { configured: configured(&app), current: app.package_info().version.to_string(), version: None, notes: None, date: None, portable: portable_dir().is_some() };
  if !found.configured {
    return Ok(found);
  }
  let mut b = app.updater_builder();
  if found.portable {
    b = b.target(PORTABLE_TARGET);
  }
  let up = b.build().map_err(plugin_error)?.check().await.map_err(plugin_error)?;
  if let Some(u) = &up {
    found.version = Some(u.version.clone());
    found.notes = u.body.clone();
    found.date = u.date.map(|d| d.to_string());
  }
  *pending.update.lock().unwrap_or_else(|e| e.into_inner()) = up;
  Ok(found)
}

#[derive(Debug, Clone, Serialize)]
pub struct Got {
  pub done: u64,
  pub total: Option<u64>,
}

/// Downloads the update found by the last check (the plugin verifies its signature), and for the shared build applies it
/// in place. Afterwards a restart runs the new version.
#[tauri::command]
pub async fn update_download(pending: tauri::State<'_, Pending>, on_event: Channel<Got>) -> Result<()> {
  if cfg!(debug_assertions) {
    return Err(Error::new("refused", "A development build is not updated: build it again from the source"));
  }
  let up = pending.update.lock().unwrap_or_else(|e| e.into_inner()).clone().ok_or_else(|| Error::invalid("Check for updates first"))?;
  let mut done = 0u64;
  let bytes = up
    .download(
      |n, total| {
        done += n as u64;
        let _ = on_event.send(Got { done, total });
      },
      || {},
    )
    .await
    .map_err(plugin_error)?;
  match portable_dir() {
    Some(dir) => {
      let exe = std::env::current_exe().map_err(|e| Error::new("internal", e.to_string()))?;
      crate::error::blocking(move || apply_portable(&dir, &exe, &bytes)).await
    }
    None => {
      *pending.installer.lock().unwrap_or_else(|e| e.into_inner()) = Some(bytes);
      Ok(())
    }
  }
}

/// The verified update zip, applied to the shared build's folder (see the top of this file). Any failure leaves the
/// folder as it was.
pub fn apply_portable(dir: &Path, exe: &Path, zip: &[u8]) -> Result<()> {
  let setup = dir.join(".setup");
  let stage = setup.join("update");
  crate::portable::remove(&stage, std::time::Duration::from_secs(10)).map_err(|m| Error::new("io", m))?;
  fs::create_dir_all(&stage).at(&stage)?;
  let file = stage.join("update.zip");
  fs::write(&file, zip).at(&file)?;
  let tar = |args: &[&std::ffi::OsStr]| -> Result<String> {
    let mut c = std::process::Command::new(tar_exe());
    #[cfg(windows)]
    {
      use std::os::windows::process::CommandExt;
      c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = c.args(args).output().map_err(|e| Error::new("io", format!("tar.exe: {e}")))?;
    if !out.status.success() {
      return Err(Error::new("update", format!("the update could not be read: {}", String::from_utf8_lossy(&out.stderr).trim())));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
  };
  let os = std::ffi::OsStr::new;
  let listing = tar(&[os("-tf"), file.as_os_str()])?;
  let names: Vec<&str> = listing.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
  if let Some(bad) = names.iter().find(|n| !UPDATE_FILES.contains(n)) {
    return Err(Error::new("update", format!("the update holds {bad:?}, which an update may not: nothing was changed")));
  }
  if !names.contains(&"Pawscript.exe") {
    return Err(Error::new("update", "the update holds no Pawscript.exe: nothing was changed"));
  }
  tar(&[os("-xf"), file.as_os_str(), os("-C"), stage.as_os_str()])?;

  // the swap: the running exe aside, the new one in its place; back again on any failure
  let old = setup.join(OLD_EXE);
  let _ = fs::remove_file(&old);
  fs::rename(exe, &old).at(exe)?;
  if let Err(e) = fs::rename(stage.join("Pawscript.exe"), exe) {
    let _ = fs::rename(&old, exe);
    return Err(Error::io(e, exe));
  }
  if stage.join("code.zip").is_file() {
    if let Err(e) = fs::rename(stage.join("code.zip"), dir.join("code.zip")) {
      let _ = fs::rename(exe, stage.join("Pawscript.exe"));
      let _ = fs::rename(&old, exe);
      return Err(Error::io(e, &dir.join("code.zip")));
    }
  }
  let _ = crate::portable::remove(&stage, std::time::Duration::from_secs(10));
  Ok(())
}

/// Windows' own tar.exe (bsdtar: reads and writes zips), as portable.rs uses it.
fn tar_exe() -> PathBuf {
  std::env::var_os("SystemRoot").map(|r| PathBuf::from(r).join("System32").join("tar.exe")).filter(|p| p.is_file()).unwrap_or_else(|| "tar".into())
}

/// At start: the exe an earlier update set aside (it ran then; nothing runs it now).
pub fn clean_after_update() {
  if let Some(dir) = portable_dir() {
    let _ = fs::remove_file(dir.join(".setup").join(OLD_EXE));
  }
}

/// Restarts into the new version (an installer build: runs the verified installer, which closes the app). The front end
/// has asked and written every project; a shell write still in flight refuses.
#[tauri::command]
pub fn update_restart(app: AppHandle, pending: tauri::State<'_, Pending>, guard: tauri::State<'_, crate::app::CloseGuard>) -> Result<()> {
  if guard.4.load(std::sync::atomic::Ordering::SeqCst) > 0 {
    return Err(Error::new("busy", "A project is still being written: try again in a moment"));
  }
  guard.0.store(false, std::sync::atomic::Ordering::SeqCst); // the close guard would hold the restart's close
  let installer = pending.installer.lock().unwrap_or_else(|e| e.into_inner()).take();
  if let Some(bytes) = installer {
    let up = pending.update.lock().unwrap_or_else(|e| e.into_inner()).clone().ok_or_else(|| Error::invalid("Check for updates first"))?;
    app.state::<crate::sidecar::Running>().shutdown();
    up.install(bytes).map_err(plugin_error)?;
  }
  app.state::<crate::sidecar::Running>().shutdown();
  app.restart()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn the_placeholder_key_is_not_a_key() {
    assert!(!key_configured(None));
    assert!(!key_configured(Some("  ")));
    assert!(!key_configured(Some("PAWSCRIPT-UPDATER-PUBKEY-PLACEHOLDER: run `npm run tauri signer generate` (docs/BUILDING.md)")));
    assert!(key_configured(Some("dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6")));
  }

  /// A zip made the way build-nas.ps1 makes the update (tar.exe --format zip) from `files` (name, bytes).
  fn zip_of(dir: &Path, files: &[(&str, &[u8])]) -> Vec<u8> {
    let src = dir.join("zip-src");
    fs::create_dir_all(&src).unwrap();
    for (n, b) in files {
      fs::write(src.join(n), b).unwrap();
    }
    let out = dir.join("u.zip");
    let names: Vec<&str> = files.iter().map(|(n, _)| *n).collect();
    let ok = std::process::Command::new(tar_exe()).arg("--format").arg("zip").arg("-cf").arg(&out).arg("-C").arg(&src).args(&names).status().unwrap().success();
    assert!(ok, "tar could not make the zip");
    fs::remove_dir_all(&src).unwrap();
    fs::read(out).unwrap()
  }

  fn folder() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let t = tempfile::tempdir().unwrap();
    let dir = t.path().join("Pawscript");
    fs::create_dir_all(dir.join(".setup")).unwrap();
    let exe = dir.join("Pawscript.exe");
    fs::write(&exe, b"old exe").unwrap();
    fs::write(dir.join("code.zip"), b"old code").unwrap();
    (t, dir, exe)
  }

  #[test]
  fn a_portable_update_swaps_the_exe_and_code_zip() {
    let (t, dir, exe) = folder();
    let zip = zip_of(t.path(), &[("Pawscript.exe", b"new exe"), ("code.zip", b"new code")]);
    apply_portable(&dir, &exe, &zip).unwrap();
    assert_eq!(fs::read(&exe).unwrap(), b"new exe");
    assert_eq!(fs::read(dir.join("code.zip")).unwrap(), b"new code");
    assert_eq!(fs::read(dir.join(".setup").join(OLD_EXE)).unwrap(), b"old exe");
    assert!(!dir.join(".setup").join("update").exists());
  }

  #[test]
  fn an_update_with_other_files_changes_nothing() {
    let (t, dir, exe) = folder();
    let evil = zip_of(t.path(), &[("Pawscript.exe", b"new exe"), ("python.dll", b"x")]);
    assert_eq!(apply_portable(&dir, &exe, &evil).unwrap_err().code, "update");
    let no_exe = zip_of(t.path(), &[("code.zip", b"no exe")]);
    assert_eq!(apply_portable(&dir, &exe, &no_exe).unwrap_err().code, "update");
    assert_eq!(fs::read(&exe).unwrap(), b"old exe");
    assert_eq!(fs::read(dir.join("code.zip")).unwrap(), b"old code");
  }
}
