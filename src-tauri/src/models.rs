//! paw-cdot: the tracker models, fetched on the user's say-so (Settings > Models, the first-start screen). One of the two
//! network connections the app makes (the other is update.rs), both only when the user asks.
//!
//! The manifest (src/features/models/manifest.json, or a newer one fetched from the models server) lists every file with
//! its size and SHA-256; the front end hands the files it wants here. A file is fetched to `<file>.part` (an interrupted
//! one resumes with an HTTP Range request), hashed from the disk, and renamed into place only when its size and SHA-256
//! match; a mismatch deletes the `.part`. Nothing is ever unpacked or run: plain files only. Paths from a manifest are
//! checked like a pack's entries (pack::safe_name: no `..`, no drive, no absolute path), so nothing lands outside the
//! models folder. URLs: https to ALLOWED_HOST only (dl.openvalence.org; plain http only to 127.0.0.1 / localhost, for the
//! tests), the file's URL must stay under the base URL, and redirects are not followed (a public bucket behind its own domain does not
//! redirect; one that did would have to be named as the base itself).
//!
//! The models folder: settings.json `models.dir` when it is an absolute path, else `<app folder>\trackers` (where the
//! shared build and a checkout already keep `.cache` and `.models`: an existing install needs no download and no move).
//! The sidecar is started with it as PAWTRACK_MODELS. Remove deletes only the files the manifest names (and their
//! `.part`), never a folder and never anything else in a folder the user chose (paw-bfi4's lesson).
//! Import (a file the user already has, e.g. taggerine, which nobody hosts) MOVES it into place: a rename, or across
//! drives a copy that is hashed again before the source is deleted.

use crate::error::{At, Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::ipc::Channel;

/// Overrides the models server for testing (and wins over the setting).
pub const URL_ENV: &str = "PAWSCRIPT_MODELS_URL";
/// The manifest's name under the base URL.
pub const MANIFEST: &str = "manifest.json";
const MANIFEST_MAX: u64 = 4 << 20;

static SETTINGS: OnceLock<PathBuf> = OnceLock::new();

/// Where settings.json is (from the app's setup): the sidecar reads `models.dir` from it at every start.
pub fn remember_settings(p: PathBuf) {
  let _ = SETTINGS.set(p);
}

/// `<app folder>\trackers`: the portable layout's place, and a checkout's.
pub fn default_folder() -> PathBuf {
  crate::sidecar::root().join("trackers")
}

/// The models folder the sidecar is started with: settings.json `models.dir` when absolute, else the default.
pub fn folder() -> PathBuf {
  setting("models.dir").map(PathBuf::from).filter(|d| d.is_absolute()).unwrap_or_else(default_folder)
}

/// A string setting from settings.json (trimmed), None when unset or not a string.
pub fn setting(key: &str) -> Option<String> {
  let set = SETTINGS.get().and_then(|p| fs::read(p).ok()).and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok());
  set?.get(key)?.as_str().map(|s| s.trim().to_string())
}

/// A manifest path under `dir`, or refused (an absolute path, a drive, `..`, a reserved name).
pub fn target(dir: &Path, rel: &str) -> Result<PathBuf> {
  let p = crate::pack::safe_name(rel).map_err(|_| Error::new("unsafe_path", format!("{rel:?}: not a plain path inside the models folder, refused")))?;
  Ok(dir.join(p))
}

fn part_of(p: &Path) -> PathBuf {
  let mut s = p.as_os_str().to_owned();
  s.push(".part");
  PathBuf::from(s)
}

fn loopback(u: &reqwest::Url) -> bool {
  matches!(u.host_str(), Some("127.0.0.1") | Some("localhost") | Some("[::1]"))
}

/// The one host models and the runtime come from (OpenValence's R2 bucket behind its own domain; the front end's
/// MODELS_BASE_URL). The setting and PAWSCRIPT_MODELS_URL may change the folder under it, not the host; the loopback is
/// allowed too, for the tests and dev/models-window-check.mjs.
pub const ALLOWED_HOST: &str = "dl.openvalence.org";

/// The base URL, checked: https on ALLOWED_HOST (or http / https on the loopback), ending in `/`.
pub fn base_url(base: &str) -> Result<reqwest::Url> {
  let b = reqwest::Url::parse(base.trim()).map_err(|e| Error::invalid(format!("models address {base:?}: {e}")))?;
  let ok = (b.scheme() == "https" && b.host_str() == Some(ALLOWED_HOST) && b.port().is_none()) || (matches!(b.scheme(), "http" | "https") && loopback(&b));
  if !ok {
    return Err(Error::invalid(format!("models address {base:?}: only https://{ALLOWED_HOST}/ is allowed")));
  }
  if !b.path().ends_with('/') || b.query().is_some() {
    return Err(Error::invalid(format!("models address {base:?}: must end in / (a folder)")));
  }
  Ok(b)
}

/// A file's URL: `rel` joined to the base, refused when it leaves the base (another host, scheme or folder).
pub fn file_url(base: &str, rel: &str) -> Result<reqwest::Url> {
  let b = base_url(base)?;
  let u = b.join(rel).map_err(|e| Error::invalid(format!("{rel:?}: {e}")))?;
  if u.scheme() != b.scheme() || u.host_str() != b.host_str() || u.port_or_known_default() != b.port_or_known_default() || !u.path().starts_with(b.path()) {
    return Err(Error::new("unsafe_path", format!("{rel:?} is not under the models address, refused")));
  }
  Ok(u)
}

fn client() -> Result<reqwest::Client> {
  // the updater installs the same provider when it runs first; whichever comes first wins, the other is a no-op
  let _ = rustls::crypto::ring::default_provider().install_default();
  reqwest::Client::builder()
    .redirect(reqwest::redirect::Policy::none())
    .connect_timeout(Duration::from_secs(20))
    .read_timeout(Duration::from_secs(60))
    .user_agent(concat!("Pawscript/", env!("CARGO_PKG_VERSION")))
    .build()
    .map_err(|e| Error::new("internal", format!("HTTP client: {e}")))
}

/// A reqwest error in words a user can act on: no connection is "offline".
fn net(e: reqwest::Error, url: &reqwest::Url) -> Error {
  let host = url.host_str().unwrap_or("");
  if e.is_connect() || e.is_timeout() {
    Error::new("offline", format!("No connection to {host}: check the network, then try again ({e})"))
  } else {
    Error::new("network", format!("{host}: {e}"))
  }
}

fn status_error(s: reqwest::StatusCode, url: &reqwest::Url) -> Error {
  let what = if s.is_redirection() { " (a redirect: set the models address to where it points)" } else { "" };
  Error::new("http", format!("{url} answered {s}{what}"))
}

/// One file wanted from the server.
#[derive(Debug, Clone, Deserialize)]
pub struct Want {
  pub path: String,
  pub url: String,
  pub bytes: u64,
  pub sha256: String,
}

/// Progress of a download (all files together) or a verify.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
  pub file: String,
  pub done: u64,
  pub total: u64,
}

/// SHA-256 (hex) and length of a file.
fn sha_file(p: &Path, cancel: &AtomicBool, mut on: impl FnMut(u64)) -> Result<(u64, String)> {
  let mut f = fs::File::open(p).at(p)?;
  let mut sha = <sha2::Sha256 as sha2::Digest>::new();
  let (mut buf, mut n) = (vec![0u8; 1 << 20], 0u64);
  loop {
    if cancel.load(Ordering::SeqCst) {
      return Err(Error::cancelled());
    }
    let k = f.read(&mut buf).at(p)?;
    if k == 0 {
      break;
    }
    sha2::Digest::update(&mut sha, &buf[..k]);
    n += k as u64;
    on(k as u64);
  }
  Ok((n, crate::files::hex(&sha2::Digest::finalize(sha))))
}

/// Bytes free for this user on the drive that holds `dir` (or its nearest existing parent).
pub fn free_near(dir: &Path) -> Option<u64> {
  dir.ancestors().find(|a| a.is_dir()).and_then(crate::portable::free_bytes)
}

/// `fut`, or Err(cancelled) as soon as `cancel` is set (looked at every 100 ms): a server that accepts the connection and
/// then says nothing (up to the 60 s read timeout) can still be cancelled.
async fn or_cancel<T>(cancel: &AtomicBool, fut: impl std::future::Future<Output = T>) -> Result<T> {
  let watch = async {
    while !cancel.load(Ordering::SeqCst) {
      let _ = tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_millis(100))).await;
    }
  };
  match futures::future::select(Box::pin(fut), Box::pin(watch)).await {
    futures::future::Either::Left((v, _)) => Ok(v),
    futures::future::Either::Right(_) => Err(Error::cancelled()),
  }
}

/// Fetches `files` into `dir` (see the top of this file). `cancel`: checked between chunks (a cancelled file keeps its
/// `.part` for the next try). `on`: (file, bytes done over all files, total).
pub async fn download(base: &str, dir: &Path, files: &[Want], cancel: &AtomicBool, mut on: impl FnMut(&str, u64, u64)) -> Result<()> {
  let plan: Vec<(PathBuf, reqwest::Url)> = files.iter().map(|f| Ok((target(dir, &f.path)?, file_url(base, &f.url)?))).collect::<Result<_>>()?;
  for f in files {
    if f.sha256.len() != 64 || !f.sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
      return Err(Error::invalid(format!("{}: the manifest has no SHA-256 for it", f.path)));
    }
  }
  let total: u64 = files.iter().map(|f| f.bytes).sum();
  // what is still to come must fit (a .part already there counts as fetched)
  let left: u64 = plan.iter().zip(files).map(|((p, _), f)| f.bytes.saturating_sub(fs::metadata(part_of(p)).map_or(0, |m| m.len()))).sum();
  if let Some(free) = free_near(dir).filter(|&free| free < left) {
    let gb = |b: u64| b as f64 / 1e9;
    return Err(Error::new("disk_full", format!("The models need {:.1} GB more and the drive of {} has {:.1} GB free: free up room or choose another folder", gb(left), dir.display(), gb(free))));
  }
  let http = client()?;
  let mut done = 0u64;
  for ((dest, url), f) in plan.iter().zip(files) {
    let part = part_of(dest);
    if let Some(parent) = dest.parent() {
      fs::create_dir_all(parent).at(parent)?;
    }
    let mut have = fs::metadata(&part).map_or(0, |m| m.len());
    if have > f.bytes {
      fs::remove_file(&part).at(&part)?;
      have = 0;
    }
    if have < f.bytes {
      let mut req = http.get(url.clone());
      if have > 0 {
        req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
      }
      let mut resp = or_cancel(cancel, req.send()).await?.map_err(|e| net(e, url))?;
      let s = resp.status();
      let mut out = if s == reqwest::StatusCode::PARTIAL_CONTENT && have > 0 {
        fs::OpenOptions::new().append(true).open(&part).at(&part)?
      } else if s.is_success() {
        have = 0; // the server sent the whole file (no Range support): start again
        fs::File::create(&part).at(&part)?
      } else {
        return Err(status_error(s, url));
      };
      on(&f.path, done + have, total);
      loop {
        if cancel.load(Ordering::SeqCst) {
          out.flush().at(&part)?;
          return Err(Error::cancelled());
        }
        let next = match or_cancel(cancel, resp.chunk()).await {
          Ok(r) => r,
          Err(e) => {
            out.flush().at(&part)?;
            return Err(e);
          }
        };
        let Some(chunk) = next.map_err(|e| net(e, url))? else { break };
        if have + chunk.len() as u64 > f.bytes {
          drop(out);
          let _ = fs::remove_file(&part);
          return Err(Error::new("hash_mismatch", format!("{}: the server sent more than the manifest's {} bytes; the file was not kept", f.path, f.bytes)));
        }
        out.write_all(&chunk).at(&part)?;
        have += chunk.len() as u64;
        on(&f.path, done + have, total);
      }
      out.sync_all().at(&part)?;
    }
    // the whole file from the disk: a resumed one too
    let (p2, never) = (part.clone(), AtomicBool::new(false));
    let (len, sha) = tauri::async_runtime::spawn_blocking(move || sha_file(&p2, &never, |_| {})).await.map_err(|e| Error::new("internal", e.to_string()))??;
    if len != f.bytes || sha != f.sha256.to_ascii_lowercase() {
      let _ = fs::remove_file(&part);
      return Err(Error::new("hash_mismatch", format!("{} did not check out ({len} bytes, SHA-256 {sha}; the manifest says {} bytes, {}): it was deleted, Download again", f.path, f.bytes, f.sha256)));
    }
    fs::rename(&part, dest).at(dest)?;
    done += f.bytes;
    on(&f.path, done, total);
  }
  Ok(())
}

/// What is on the disk for one manifest path.
#[derive(Debug, Serialize)]
pub struct Fact {
  pub path: String,
  pub exists: bool,
  pub bytes: u64,
  /// bytes of an unfinished download (`<file>.part`)
  pub part: u64,
}

pub fn scan(dir: &Path, paths: &[String]) -> Result<Vec<Fact>> {
  paths
    .iter()
    .map(|rel| {
      let p = target(dir, rel)?;
      let m = fs::metadata(&p).ok().filter(|m| m.is_file());
      Ok(Fact { path: rel.clone(), exists: m.is_some(), bytes: m.map_or(0, |m| m.len()), part: fs::metadata(part_of(&p)).map_or(0, |m| m.len()) })
    })
    .collect()
}

/// Deletes the named files (and their `.part`), nothing else. -> how many files were deleted.
pub fn remove(dir: &Path, paths: &[String]) -> Result<usize> {
  let mut n = 0;
  for rel in paths {
    let p = target(dir, rel)?;
    for q in [part_of(&p), p] {
      if fs::symlink_metadata(&q).is_ok_and(|m| m.is_file()) {
        fs::remove_file(&q).at(&q)?;
        n += 1;
      }
    }
  }
  Ok(n)
}

/// One file the user brings (Import / a drop): `src` goes to the manifest's `path`.
#[derive(Debug, Clone, Deserialize)]
pub struct Bring {
  pub src: PathBuf,
  pub path: String,
  pub bytes: Option<u64>,
  pub sha256: Option<String>,
  /// a hosted model: the file must be the tested one (as a download must); else a different version is taken, and said
  pub strict: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Brought {
  pub path: String,
  pub sha256: String,
  /// the size and SHA-256 are the ones the manifest pins (or it pins none)
  pub tested: bool,
}

/// Moves each file into place (see the top of this file). Checked first: its name is the manifest's, and (strict) its
/// size and SHA-256. Across drives: copied to `<dest>.part`, the copy hashed, renamed, and only then the source deleted.
pub fn import(dir: &Path, items: &[Bring], cancel: &AtomicBool, mut on: impl FnMut(&str, u64, u64)) -> Result<Vec<Brought>> {
  let total: u64 = items.iter().map(|b| fs::metadata(&b.src).map_or(0, |m| m.len())).sum();
  let (mut done, mut out) = (0u64, Vec::new());
  for b in items {
    let dest = target(dir, &b.path)?;
    let want = dest.file_name().map(|n| n.to_string_lossy().to_lowercase());
    if b.src.file_name().map(|n| n.to_string_lossy().to_lowercase()) != want {
      return Err(Error::invalid(format!("{}: expected a file named {}", b.src.display(), want.unwrap_or_default())));
    }
    if !b.src.is_file() {
      return Err(Error::new("not_found", format!("{}: not a file", b.src.display())));
    }
    let (len, sha) = sha_file(&b.src, cancel, |k| {
      done += k;
      on(&b.path, done, total)
    })?;
    let tested = b.bytes.is_none_or(|n| n == len) && b.sha256.as_deref().is_none_or(|h| h.eq_ignore_ascii_case(&sha));
    if b.strict && !tested {
      return Err(Error::new("hash_mismatch", format!("{} is not the tested file ({len} bytes, SHA-256 {sha}): nothing was moved", b.src.display())));
    }
    if let Some(parent) = dest.parent() {
      fs::create_dir_all(parent).at(parent)?;
    }
    if fs::rename(&b.src, &dest).is_err() {
      // another drive (or a locked source): copy, check the copy, then let the source go
      let part = part_of(&dest);
      fs::copy(&b.src, &part).at(&part)?;
      let (n2, sha2) = sha_file(&part, cancel, |_| {})?;
      if n2 != len || sha2 != sha {
        let _ = fs::remove_file(&part);
        return Err(Error::new("io", format!("{}: the copy did not match the source; the source was kept", b.src.display())));
      }
      fs::rename(&part, &dest).at(&dest)?;
      fs::remove_file(&b.src).at(&b.src)?;
    }
    out.push(Brought { path: b.path.clone(), sha256: sha, tested });
  }
  Ok(out)
}

/// The SHA-256 of each named file that exists (Verify). -> {path: sha256}
pub fn verify(dir: &Path, paths: &[String], cancel: &AtomicBool, mut on: impl FnMut(&str, u64, u64)) -> Result<HashMap<String, String>> {
  let found: Vec<(String, PathBuf)> = paths.iter().map(|r| Ok((r.clone(), target(dir, r)?))).collect::<Result<Vec<_>>>()?.into_iter().filter(|(_, p)| p.is_file()).collect();
  let total: u64 = found.iter().map(|(_, p)| fs::metadata(p).map_or(0, |m| m.len())).sum();
  let (mut done, mut out) = (0u64, HashMap::new());
  for (rel, p) in found {
    let (_, sha) = sha_file(&p, cancel, |k| {
      done += k;
      on(&rel, done, total)
    })?;
    out.insert(rel, sha);
  }
  Ok(out)
}

// ---------------------------------------------------------------- commands

static JOBS: Mutex<Option<HashMap<String, Arc<AtomicBool>>>> = Mutex::new(None);

/// A cancel flag for job `id`, dropped from the table when the guard goes.
struct Job(String, Arc<AtomicBool>);
impl Job {
  fn new(id: &str) -> Job {
    let flag = Arc::new(AtomicBool::new(false));
    JOBS.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashMap::new).insert(id.to_string(), flag.clone());
    Job(id.to_string(), flag)
  }
}
impl Drop for Job {
  fn drop(&mut self) {
    if let Some(m) = JOBS.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
      m.remove(&self.0);
    }
  }
}

fn reporter(ch: Channel<Progress>) -> impl FnMut(&str, u64, u64) {
  let mut last = std::time::Instant::now() - Duration::from_secs(1);
  move |file: &str, done: u64, total: u64| {
    if done == total || last.elapsed() >= Duration::from_millis(150) {
      last = std::time::Instant::now();
      let _ = ch.send(Progress { file: file.to_string(), done, total });
    }
  }
}

fn dir_arg(dir: &str) -> Result<PathBuf> {
  let d = PathBuf::from(dir.trim());
  if !d.is_absolute() {
    return Err(Error::invalid(format!("models folder {dir:?}: not an absolute path")));
  }
  Ok(d)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
  pub default_dir: String,
  /// PAWSCRIPT_MODELS_URL, when set
  pub env_url: Option<String>,
  pub exists: bool,
  pub free: Option<u64>,
  /// the fake sidecar runs (PAWTRACK_CMD): nothing needs models
  pub fake: bool,
}

#[tauri::command]
pub fn models_info(dir: Option<String>) -> Info {
  let default = default_folder();
  let d = dir.filter(|s| !s.trim().is_empty()).map(PathBuf::from).unwrap_or_else(|| default.clone());
  Info {
    default_dir: crate::files::path_str(&default),
    env_url: std::env::var(URL_ENV).ok().filter(|s| !s.trim().is_empty()),
    exists: d.is_dir(),
    free: free_near(&d),
    fake: std::env::var("PAWTRACK_CMD").is_ok_and(|s| !s.trim().is_empty()),
  }
}

#[tauri::command]
pub async fn models_scan(dir: String, paths: Vec<String>) -> Result<Vec<Fact>> {
  let d = dir_arg(&dir)?;
  crate::error::blocking(move || scan(&d, &paths)).await
}

/// The manifest on the server (`<base>manifest.json`) as text; the front end parses and checks it.
#[tauri::command]
pub async fn models_manifest(base: String) -> Result<String> {
  let url = file_url(&base, MANIFEST)?;
  let resp = client()?.get(url.clone()).send().await.map_err(|e| net(e, &url))?;
  if !resp.status().is_success() {
    return Err(status_error(resp.status(), &url));
  }
  if resp.content_length().is_some_and(|n| n > MANIFEST_MAX) {
    return Err(Error::invalid(format!("{url}: too large for a manifest")));
  }
  let b = resp.bytes().await.map_err(|e| net(e, &url))?;
  String::from_utf8(b.to_vec()).map_err(|_| Error::invalid(format!("{url}: not text")))
}

#[tauri::command]
pub async fn models_download(id: String, base: String, dir: String, files: Vec<Want>, on_event: Channel<Progress>) -> Result<()> {
  let d = dir_arg(&dir)?;
  let job = Job::new(&id);
  download(&base, &d, &files, &job.1, reporter(on_event)).await
}

#[tauri::command]
pub async fn models_import(id: String, dir: String, items: Vec<Bring>, on_event: Channel<Progress>) -> Result<Vec<Brought>> {
  let d = dir_arg(&dir)?;
  crate::error::blocking(move || {
    let job = Job::new(&id);
    import(&d, &items, &job.1, reporter(on_event))
  })
  .await
}

#[tauri::command]
pub async fn models_verify(id: String, dir: String, paths: Vec<String>, on_event: Channel<Progress>) -> Result<HashMap<String, String>> {
  let d = dir_arg(&dir)?;
  crate::error::blocking(move || {
    let job = Job::new(&id);
    verify(&d, &paths, &job.1, reporter(on_event))
  })
  .await
}

#[tauri::command]
pub fn models_cancel(id: String) -> bool {
  JOBS.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|m| m.get(&id)).map(|f| f.store(true, Ordering::SeqCst)).is_some()
}

#[tauri::command]
pub async fn models_remove(dir: String, paths: Vec<String>) -> Result<usize> {
  let d = dir_arg(&dir)?;
  crate::error::blocking(move || remove(&d, &paths)).await
}

/// Files came, went or the folder changed: an idle tracker goes, so the next run starts with what is there now.
#[tauri::command]
pub fn models_changed(running: tauri::State<'_, crate::sidecar::Running>) {
  running.drop_idle_serve();
}

/// A licence or download page in the user's browser (https only).
#[tauri::command]
pub fn open_url(url: String) -> Result<()> {
  let u = reqwest::Url::parse(&url).map_err(|e| Error::invalid(format!("{url}: {e}")))?;
  if u.scheme() != "https" {
    return Err(Error::new("refused", format!("{url}: only https links are opened")));
  }
  tauri_plugin_opener::open_url(u.as_str(), None::<&str>).map_err(|e| Error::new("io", format!("{url}: {e}")))
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::BufRead;
  use std::net::TcpListener;

  /// A one-file HTTP/1.1 server on 127.0.0.1 (random port) that honours `Range: bytes=N-`; returns its base URL and the
  /// Range headers it saw.
  fn serve(body: Vec<u8>, ranges: bool) -> (String, Arc<Mutex<Vec<String>>>) {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://127.0.0.1:{}/m/", l.local_addr().unwrap().port());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let s2 = seen.clone();
    std::thread::spawn(move || {
      for c in l.incoming().flatten() {
        let mut r = std::io::BufReader::new(c.try_clone().unwrap());
        let (mut line, mut from) = (String::new(), 0usize);
        let mut first = String::new();
        r.read_line(&mut first).unwrap();
        loop {
          line.clear();
          if r.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
            break;
          }
          if let Some(v) = line.to_ascii_lowercase().strip_prefix("range: bytes=") {
            s2.lock().unwrap().push(v.trim().to_string());
            from = v.trim().trim_end_matches('-').parse().unwrap_or(0);
          }
        }
        let mut c = c;
        let path_ok = first.starts_with("GET /m/");
        let (status, part) = if !path_ok { ("404 Not Found", &body[..0]) } else if ranges && from > 0 { ("206 Partial Content", &body[from..]) } else { ("200 OK", &body[..]) };
        let _ = write!(c, "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", part.len());
        for ch in part.chunks(64 << 10) {
          if c.write_all(ch).is_err() {
            break;
          }
        }
      }
    });
    (base, seen)
  }

  fn data(n: usize) -> Vec<u8> {
    (0..n).map(|i| (i * 31 % 251) as u8).collect()
  }
  fn want(body: &[u8]) -> Want {
    Want { path: ".cache/sam2/x.pt".into(), url: "sam2/x.pt".into(), bytes: body.len() as u64, sha256: crate::files::sha256_hex(body) }
  }
  fn run<T>(f: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(f)
  }

  #[test]
  fn a_download_lands_checked_and_a_part_resumes_with_a_range_request() {
    let body = data(300_000);
    let (base, seen) = serve(body.clone(), true);
    let t = tempfile::tempdir().unwrap();
    let w = want(&body);
    run(download(&base, t.path(), &[w.clone()], &AtomicBool::new(false), |_, _, _| {})).unwrap();
    let dest = t.path().join(".cache").join("sam2").join("x.pt");
    assert_eq!(fs::read(&dest).unwrap(), body);
    assert!(!part_of(&dest).exists());
    assert!(seen.lock().unwrap().is_empty(), "a fresh download asks for the whole file");
    // an interrupted one: the .part holds the first 100,000 bytes
    fs::remove_file(&dest).unwrap();
    fs::write(part_of(&dest), &body[..100_000]).unwrap();
    let mut last = 0;
    run(download(&base, t.path(), &[w], &AtomicBool::new(false), |_, d, _| last = d)).unwrap();
    assert_eq!(fs::read(&dest).unwrap(), body);
    assert_eq!(seen.lock().unwrap().as_slice(), ["100000-"]);
    assert_eq!(last, body.len() as u64);
  }

  #[test]
  fn a_server_without_range_support_starts_the_file_again() {
    let body = data(200_000);
    let (base, _) = serve(body.clone(), false);
    let t = tempfile::tempdir().unwrap();
    let dest = t.path().join(".cache").join("sam2").join("x.pt");
    fs::create_dir_all(dest.parent().unwrap()).unwrap();
    fs::write(part_of(&dest), b"stale bytes").unwrap();
    run(download(&base, t.path(), &[want(&body)], &AtomicBool::new(false), |_, _, _| {})).unwrap();
    assert_eq!(fs::read(&dest).unwrap(), body);
  }

  #[test]
  fn a_hash_mismatch_keeps_nothing() {
    let body = data(150_000);
    let (base, _) = serve(body.clone(), true);
    let t = tempfile::tempdir().unwrap();
    let mut w = want(&body);
    w.sha256 = "0".repeat(64);
    let e = run(download(&base, t.path(), &[w], &AtomicBool::new(false), |_, _, _| {})).unwrap_err();
    assert_eq!(e.code, "hash_mismatch", "{e}");
    let dest = t.path().join(".cache").join("sam2").join("x.pt");
    assert!(!dest.exists() && !part_of(&dest).exists());
  }

  #[test]
  fn a_cancel_stops_between_chunks_and_keeps_the_part() {
    let body = data(4_000_000);
    let (base, _) = serve(body.clone(), true);
    let t = tempfile::tempdir().unwrap();
    let cancel = AtomicBool::new(false);
    let e = run(download(&base, t.path(), &[want(&body)], &cancel, |_, d, _| {
      if d > 0 {
        cancel.store(true, Ordering::SeqCst)
      }
    }))
    .unwrap_err();
    assert_eq!(e.code, "cancelled");
    let dest = t.path().join(".cache").join("sam2").join("x.pt");
    let kept = fs::metadata(part_of(&dest)).unwrap().len();
    assert!(!dest.exists() && kept > 0 && kept < body.len() as u64, "kept {kept}");
  }

  #[test]
  fn a_server_that_never_answers_can_be_cancelled() {
    // accepts the connection, reads nothing, answers nothing (the read timeout is 60 s)
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://127.0.0.1:{}/m/", l.local_addr().unwrap().port());
    std::thread::spawn(move || {
      let held: Vec<_> = l.incoming().flatten().collect();
      drop(held);
    });
    let t = tempfile::tempdir().unwrap();
    let cancel = Arc::new(AtomicBool::new(false));
    let c2 = cancel.clone();
    std::thread::spawn(move || {
      std::thread::sleep(Duration::from_millis(300));
      c2.store(true, Ordering::SeqCst);
    });
    let t0 = std::time::Instant::now();
    let e = run(download(&base, t.path(), &[want(b"abc")], &cancel, |_, _, _| {})).unwrap_err();
    assert_eq!(e.code, "cancelled", "{e}");
    assert!(t0.elapsed() < Duration::from_secs(5), "cancelled only after {:?}", t0.elapsed());
  }

  #[test]
  fn no_server_is_offline_and_a_404_is_an_http_error() {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://127.0.0.1:{}/m/", l.local_addr().unwrap().port());
    drop(l); // nobody listens there now
    let t = tempfile::tempdir().unwrap();
    let e = run(download(&base, t.path(), &[want(b"abc")], &AtomicBool::new(false), |_, _, _| {})).unwrap_err();
    assert_eq!(e.code, "offline", "{e}");
    let (base, _) = serve(b"abc".to_vec(), true);
    let e = run(download(&base.replace("/m/", "/other/"), t.path(), &[want(b"abc")], &AtomicBool::new(false), |_, _, _| {})).unwrap_err();
    assert_eq!(e.code, "http", "{e}");
  }

  #[test]
  fn paths_and_urls_that_leave_their_place_are_refused() {
    let d = Path::new(r"C:\models");
    assert!(target(d, ".cache/sam2/sam2.1_hiera_tiny.pt").unwrap().ends_with("sam2.1_hiera_tiny.pt"));
    for bad in ["../x.pt", ".cache/../../x.pt", "/etc/x", r"C:\Windows\x.dll", "C:/x", r"a\..\b", "", "a//b", "con/x"] {
      assert_eq!(target(d, bad).unwrap_err().code, "unsafe_path", "{bad}");
    }
    let base = "https://dl.openvalence.org/pawscript/v1/";
    assert!(file_url(base, "sam2/x.pt").unwrap().as_str().ends_with("/pawscript/v1/sam2/x.pt"));
    for bad in ["../x", "https://evil.example/pawscript/v1/x", "//evil.example/x", "/x", "https://dl.openvalence.org/other/x"] {
      assert!(file_url(base, bad).is_err(), "{bad}");
    }
    assert!(base_url("http://dl.openvalence.org/pawscript/v1/").is_err(), "plain http to the real host");
    assert!(base_url("https://models.example/v1/").is_err(), "another host");
    assert!(base_url("https://dl.openvalence.org.evil.example/v1/").is_err(), "a look-alike host");
    assert!(base_url("https://dl.openvalence.org:8443/v1/").is_err(), "another port");
    assert!(base_url("https://dl.openvalence.org/pawscript/v1").is_err(), "not a folder");
    assert!(base_url("https://dl.openvalence.org/mirror/").is_ok(), "another folder on the host");
    assert!(base_url("http://127.0.0.1:8080/v1/").is_ok());
    let t = tempfile::tempdir().unwrap();
    assert!(run(download(base, t.path(), &[Want { path: "../escape.pt".into(), url: "x".into(), bytes: 1, sha256: "0".repeat(64) }], &AtomicBool::new(false), |_, _, _| {})).is_err());
    assert!(!t.path().parent().unwrap().join("escape.pt").exists());
  }

  #[test]
  fn remove_deletes_only_the_named_files() {
    let t = tempfile::tempdir().unwrap();
    let sam = t.path().join(".cache").join("sam2");
    fs::create_dir_all(&sam).unwrap();
    fs::write(sam.join("a.pt"), b"a").unwrap();
    fs::write(sam.join("a.pt.part"), b"a").unwrap();
    fs::write(sam.join("mine.txt"), b"the user's own").unwrap();
    assert_eq!(remove(t.path(), &[".cache/sam2/a.pt".into(), ".cache/sam2/missing.pt".into()]).unwrap(), 2);
    assert!(sam.join("mine.txt").exists() && sam.is_dir());
    assert!(remove(t.path(), &["../outside".into()]).is_err());
  }

  #[test]
  fn import_moves_a_checked_file_and_refuses_a_wrong_hosted_one() {
    let t = tempfile::tempdir().unwrap();
    let (src_dir, dir) = (t.path().join("Downloads"), t.path().join("models"));
    fs::create_dir_all(&src_dir).unwrap();
    let src = src_dir.join("tagger_vocab.json");
    fs::write(&src, b"{\"v\":1}").unwrap();
    let never = AtomicBool::new(false);
    // a hosted model must be the tested file: refused, the source stays
    let strict = Bring { src: src.clone(), path: ".cache/taggerine/tagger_vocab.json".into(), bytes: Some(7), sha256: Some("0".repeat(64)), strict: true };
    assert_eq!(import(&dir, &[strict.clone()], &never, |_, _, _| {}).unwrap_err().code, "hash_mismatch");
    assert!(src.exists());
    // a wrong name is refused
    let named = Bring { path: ".cache/taggerine/tagger_proto.safetensors".into(), ..strict.clone() };
    assert_eq!(import(&dir, &[named], &never, |_, _, _| {}).unwrap_err().code, "invalid_input");
    // a manual one in another version: moved, and said
    let got = import(&dir, &[Bring { strict: false, ..strict }], &never, |_, _, _| {}).unwrap();
    assert!(!got[0].tested && !src.exists());
    assert_eq!(fs::read(dir.join(".cache").join("taggerine").join("tagger_vocab.json")).unwrap(), b"{\"v\":1}");
  }
}
