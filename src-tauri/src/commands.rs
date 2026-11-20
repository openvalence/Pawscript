//! The Tauri commands (documented one by one in API.md). Thin: resolve the app's
//! folders, run the work off the main thread, map results. Logic lives in the
//! modules, where it is unit tested.

use crate::cache::{self, Cache, CacheInfo};
use crate::error::{blocking, Error, Result};
use crate::ffmpeg::{self, start_job, Tools};
use crate::files::{self, BackupPlaces, Backup, Entry, SaveResult, Stat, TextFile, Written};
use crate::ident::{self, Fingerprint};
use crate::media::{self, Event, ImageFormat, Probe, Strip};
use crate::pack;
use crate::store::{self, Candidate, Loaded, Recent, Snapshot};
use serde_json::Value;
use std::path::PathBuf;
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Manager};

/// Every place the app writes (privacy rule: all listed in API.md).
#[derive(Debug, serde::Serialize)]
pub struct Places {
  pub config_dir: PathBuf,
  pub data_dir: PathBuf,
  pub cache_dir: PathBuf,
  pub settings: PathBuf,
  pub recent: PathBuf,
  pub window_state: PathBuf,
  pub autosave: PathBuf,
  pub backups: PathBuf,
  pub written_log: PathBuf,
  pub media_cache: PathBuf,
}

pub fn places(app: &AppHandle) -> Result<Places> {
  let p = app.path();
  let err = |e: tauri::Error| Error::new("internal", format!("app folder unavailable: {e}"));
  let config_dir = p.app_config_dir().map_err(err)?;
  let data_dir = p.app_local_data_dir().map_err(err)?;
  let cache_dir = p.app_cache_dir().map_err(err)?;
  Ok(Places {
    settings: config_dir.join("settings.json"),
    recent: config_dir.join("recent.json"),
    window_state: config_dir.join(crate::WINDOW_STATE_FILE),
    autosave: data_dir.join("autosave"),
    backups: data_dir.join("backups"),
    written_log: data_dir.join("written.json"),
    media_cache: media_cache_dir(&config_dir.join("settings.json"), &cache_dir),
    config_dir,
    data_dir,
    cache_dir,
  })
}

/// paw-tprc: the media cache folder: settings.json `media.cacheDir` when it is an absolute folder that exists or can be
/// made, else `<app cache>/media-cache`. Read at every use, so a change applies to the next cache entry; what the old
/// folder holds stays there (Clear cache before moving it to get the room back).
fn media_cache_dir(settings: &std::path::Path, cache_dir: &std::path::Path) -> PathBuf {
  let set = std::fs::read(settings).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok());
  set.as_ref()
    .and_then(|v| v.get("media.cacheDir")?.as_str().map(|s| PathBuf::from(s.trim())))
    .filter(|d| d.is_absolute() && std::fs::create_dir_all(d).is_ok())
    .unwrap_or_else(|| cache_dir.join("media-cache"))
}

fn cache(app: &AppHandle) -> Result<Cache> {
  Ok(Cache { root: places(app)?.media_cache, limit: cache::limit() })
}

fn emitter(ch: Channel<Event>) -> impl Fn(Event) + Sync {
  move |e| {
    let _ = ch.send(e);
  }
}

// ---------------------------------------------------------------- files

/// Folders never written into or deleted from (files::read_only_roots_from): settings.json "files.readOnlyRoots",
/// else PAWSCRIPT_READ_ONLY_ROOTS, plus the checkout's Reference folder always.
fn read_only_roots(app: &AppHandle) -> Vec<PathBuf> {
  let set = places(app).ok().and_then(|p| std::fs::read(p.settings).ok()).and_then(|b| serde_json::from_slice::<Value>(&b).ok());
  files::read_only_roots_from(set.as_ref(), std::env::var("PAWSCRIPT_READ_ONLY_ROOTS").ok().as_deref(), &crate::sidecar::root())
}

#[tauri::command]
pub async fn read_text(path: PathBuf) -> Result<TextFile> {
  blocking(move || files::read_text(&path)).await
}

#[tauri::command]
pub async fn write_text_atomic(app: AppHandle, path: PathBuf, text: String) -> Result<Written> {
  let _w = crate::app::Writing::new(&app); // paw-hzz3: a write in flight holds a close
  let ro = read_only_roots(&app);
  blocking(move || {
    files::check_writable(&path, &ro)?;
    files::write_atomic(&path, text.as_bytes())
  })
  .await
}

/// Raw bytes out (an ArrayBuffer in JS), like `extract_frame`.
#[tauri::command]
pub async fn read_bytes(path: PathBuf) -> Result<Response> {
  blocking(move || files::read_bytes(&path).map(Response::new)).await
}

/// Raw bytes in: the request body is the file content (invoke with a Uint8Array), header `path` the target,
/// percent-encoded (encodeURIComponent: headers are ASCII). Atomic; read-only roots apply (Pawscript's own file types excepted).
#[tauri::command]
pub async fn write_bytes_atomic(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<Written> {
  let _w = crate::app::Writing::new(&app); // paw-hzz3: a write in flight holds a close
  let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
    return Err(Error::invalid("write_bytes_atomic: send the content as the raw body (a Uint8Array)"));
  };
  let path = request.headers().get("path").and_then(|v| v.to_str().ok()).and_then(files::percent_decode).filter(|p| !p.is_empty());
  let path = PathBuf::from(path.ok_or_else(|| Error::invalid("write_bytes_atomic: missing or malformed `path` header"))?);
  let bytes = bytes.clone();
  let ro = read_only_roots(&app);
  blocking(move || {
    files::check_writable(&path, &ro)?;
    files::write_atomic(&path, &bytes)
  })
  .await
}

// ---------------------------------------------------------------- copy-on-write .pawruns (paw-ee14, cow.rs)

/// A raw-body command's body and its percent-encoded header `k`.
fn raw<'a>(request: &'a tauri::ipc::Request<'_>, cmd: &str) -> Result<&'a [u8]> {
  match request.body() {
    tauri::ipc::InvokeBody::Raw(b) => Ok(b),
    _ => Err(Error::invalid(format!("{cmd}: send the bytes as the raw body (a Uint8Array)"))),
  }
}
fn header(request: &tauri::ipc::Request<'_>, k: &str) -> Option<String> {
  request.headers().get(k).and_then(|v| v.to_str().ok()).and_then(files::percent_decode).filter(|s| !s.is_empty())
}
fn hex_bytes(s: &str) -> Option<Vec<u8>> {
  (s.len() % 2 == 0).then(|| (0..s.len()).step_by(2).map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok()).collect::<Option<Vec<u8>>>()).flatten()
}

/// Raw body appended to the live file at header `at` (its current length); `tail`: hex of what its last bytes must be;
/// `sync: 1`: on disk before this returns. Refused as `moved` when the file is not as the app left it.
#[tauri::command]
pub async fn runs_append(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<crate::cow::Appended> {
  let _w = crate::app::Writing::new(&app); // paw-hzz3: a write in flight holds a close
  let bytes = raw(&request, "runs_append")?.to_vec();
  let path = PathBuf::from(header(&request, "path").ok_or_else(|| Error::invalid("runs_append: missing `path` header"))?);
  let at = header(&request, "at").and_then(|s| s.parse::<u64>().ok()).ok_or_else(|| Error::invalid("runs_append: missing `at` header"))?;
  let tail = match header(&request, "tail") {
    Some(h) => Some(hex_bytes(&h).ok_or_else(|| Error::invalid("runs_append: malformed `tail` header"))?),
    None => None,
  };
  let sync = header(&request, "sync").as_deref() == Some("1");
  let ro = read_only_roots(&app);
  blocking(move || {
    files::check_writable(&path, &ro)?;
    crate::cow::append(&path, at, tail.as_deref(), &bytes, sync)
  })
  .await
}

/// Raw body appended to the stage `stage` (header) of `path` (begun by its first part). -> the stage's size.
#[tauri::command]
pub async fn runs_stage_write(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<u64> {
  let _w = crate::app::Writing::new(&app); // paw-hzz3: a write in flight holds a close
  let bytes = raw(&request, "runs_stage_write")?.to_vec();
  let path = PathBuf::from(header(&request, "path").ok_or_else(|| Error::invalid("runs_stage_write: missing `path` header"))?);
  let stage = header(&request, "stage").unwrap_or_default();
  let ro = read_only_roots(&app);
  blocking(move || {
    files::check_writable(&path, &ro)?;
    crate::cow::stage_write(&path, &stage, &bytes)
  })
  .await
}

/// Byte ranges [offset, length] of `src` appended to the stage, streamed. -> {size, sha256: [hex per range]}
#[tauri::command]
pub async fn runs_stage_copy(app: AppHandle, path: PathBuf, stage: String, src: PathBuf, ranges: Vec<(u64, u64)>) -> Result<crate::cow::Copied> {
  let _w = crate::app::Writing::new(&app); // paw-hzz3: a write in flight holds a close
  let ro = read_only_roots(&app);
  blocking(move || {
    files::check_writable(&path, &ro)?;
    crate::cow::stage_copy(&path, &stage, &src, &ranges)
  })
  .await
}

/// The stage fsynced and renamed over `path`; backup: the file it replaces first copied to the rolling backups (keep 2).
#[tauri::command]
pub async fn runs_stage_commit(app: AppHandle, path: PathBuf, stage: String, backup: Option<bool>) -> Result<crate::cow::Appended> {
  let _w = crate::app::Writing::new(&app); // paw-hzz3: a write in flight holds a close
  let root = places(&app)?.backups;
  let ro = read_only_roots(&app);
  blocking(move || {
    files::check_writable(&path, &ro)?;
    crate::cow::stage_commit(&path, &stage, backup.unwrap_or(false).then_some((root.as_path(), 2)))
  })
  .await
}

#[tauri::command]
pub async fn runs_stage_drop(path: PathBuf, stage: String) -> Result<()> {
  blocking(move || {
    crate::cow::stage_drop(&path, &stage);
    Ok(())
  })
  .await
}

#[tauri::command]
pub async fn write_with_backup(app: AppHandle, path: PathBuf, text: String, keep: Option<usize>, expected_sha256: Option<String>) -> Result<SaveResult> {
  let _w = crate::app::Writing::new(&app); // paw-hzz3: a write in flight holds a close
  let p = places(&app)?;
  let bp = BackupPlaces { log: p.written_log, root: p.backups };
  let ro = read_only_roots(&app);
  blocking(move || files::check_writable(&path, &ro).and_then(|_| files::write_with_backup(&bp, &path, text.as_bytes(), keep.unwrap_or(10).clamp(1, 100), expected_sha256.as_deref()))).await
}

#[tauri::command]
pub async fn list_backups(app: AppHandle, path: PathBuf) -> Result<Vec<Backup>> {
  let root = places(&app)?.backups;
  blocking(move || files::list_backups(&root, &path)).await
}

#[tauri::command]
pub async fn file_stat(path: PathBuf) -> Result<Stat> {
  blocking(move || files::stat(&path)).await
}

#[tauri::command]
pub async fn list_dir(dir: PathBuf, stem: Option<String>, ext: Option<String>) -> Result<Vec<Entry>> {
  blocking(move || files::list_dir(&dir, stem.as_deref(), ext.as_deref())).await
}

/// Lists a folder's files with an extension in `exts` in batches on `on_event` (Vec<Entry>), off the UI thread; resolves with the count.
#[tauri::command]
pub async fn list_dir_stream(dir: PathBuf, exts: Vec<String>, on_event: Channel<Vec<Entry>>) -> Result<usize> {
  blocking(move || {
    files::list_dir_each(&dir, &exts, &mut |b| {
      let _ = on_event.send(b);
    })
  })
  .await
}

/// A small JPEG of a still image at `dest` (long side <= max, default 160; kept when it exists): the labelling strip's tile.
#[tauri::command]
pub async fn image_thumbnail(app: AppHandle, path: PathBuf, dest: PathBuf, max: Option<u32>) -> Result<()> {
  let ro = read_only_roots(&app);
  blocking(move || {
    files::check_writable(&dest, &ro)?;
    let g = start_job(None)?;
    media::image_thumb(&g.job, &path, &dest, max.unwrap_or(160))
  })
  .await
}

/// Creates a folder (and its parents); read-only roots apply.
#[tauri::command]
pub async fn make_dir(app: AppHandle, path: PathBuf) -> Result<()> {
  let ro = read_only_roots(&app);
  blocking(move || files::check_writable(&path, &ro).and_then(|_| files::make_dir(&path))).await
}

#[tauri::command]
pub async fn remove_file(app: AppHandle, path: PathBuf) -> Result<()> {
  let ro = read_only_roots(&app);
  blocking(move || files::check_writable(&path, &ro).and_then(|_| files::remove_file(&path))).await
}

#[tauri::command]
pub async fn reveal_path(path: PathBuf) -> Result<()> {
  blocking(move || {
    if !path.exists() {
      return Err(Error::new("not_found", format!("{}: does not exist", path.display())));
    }
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| Error::new("io", format!("{}: {e}", path.display())))
  })
  .await
}

#[tauri::command]
pub async fn open_path(path: PathBuf) -> Result<()> {
  blocking(move || {
    if path.is_file() && files::is_executable(&path) {
      return Err(Error::new("refused", format!("{}: programs and scripts are not opened from Pawscript", path.display())));
    }
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| Error::new("io", format!("{}: {e}", path.display())))
  })
  .await
}

// ---------------------------------------------------------------- app state

#[tauri::command]
pub fn app_paths(app: AppHandle) -> Result<Places> {
  places(&app)
}

#[tauri::command]
pub async fn settings_get(app: AppHandle) -> Result<Loaded> {
  let p = places(&app)?.settings;
  blocking(move || store::load_json(&p)).await
}

#[tauri::command]
pub async fn settings_set(app: AppHandle, value: Value) -> Result<()> {
  let p = places(&app)?.settings;
  blocking(move || store::save_json(&p, &value)).await
}

#[tauri::command]
pub async fn recent_list(app: AppHandle) -> Result<Vec<Recent>> {
  let p = places(&app)?.recent;
  blocking(move || Ok(store::recent_list(&p))).await
}

#[tauri::command]
pub async fn recent_add(app: AppHandle, path: PathBuf) -> Result<Vec<Recent>> {
  let p = places(&app)?.recent;
  blocking(move || store::recent_add(&p, &path)).await
}

#[tauri::command]
pub async fn recent_remove(app: AppHandle, path: Option<PathBuf>) -> Result<Vec<Recent>> {
  let p = places(&app)?.recent;
  blocking(move || store::recent_remove(&p, path.as_deref())).await
}

#[tauri::command]
pub async fn autosave_write(app: AppHandle, project_path: Option<PathBuf>, session: String, title: Option<String>, content: String, keep: Option<usize>) -> Result<Snapshot> {
  let _w = crate::app::Writing::new(&app); // paw-hzz3: a write in flight holds a close
  let root = places(&app)?.autosave;
  blocking(move || store::autosave_write(&root, project_path.as_deref(), &session, title.as_deref().unwrap_or(""), &content, keep.unwrap_or(10).clamp(1, 100))).await
}

#[tauri::command]
pub async fn autosave_list(app: AppHandle) -> Result<Vec<Candidate>> {
  let root = places(&app)?.autosave;
  blocking(move || Ok(store::autosave_list(&root))).await
}

#[tauri::command]
pub async fn autosave_clear(app: AppHandle, id: String) -> Result<()> {
  let root = places(&app)?.autosave;
  blocking(move || store::autosave_clear(&root, &id)).await
}

// ---------------------------------------------------------------- media

#[tauri::command]
pub async fn media_tools() -> Result<Tools> {
  blocking(|| Ok(ffmpeg::tools())).await
}

#[tauri::command]
pub async fn media_probe(app: AppHandle, path: PathBuf, job: Option<String>) -> Result<Probe> {
  let c = cache(&app)?;
  blocking(move || {
    let g = start_job(job)?;
    media::probe(&c, &g.job, &path)
  })
  .await
}

#[tauri::command]
pub async fn media_frame_times(app: AppHandle, path: PathBuf, job: Option<String>, on_event: Channel<Event>) -> Result<Response> {
  let c = cache(&app)?;
  blocking(move || {
    let g = start_job(job)?;
    let times = media::frame_times(&c, &g.job, &path, &emitter(on_event))?;
    Ok(Response::new(times.iter().flat_map(|t| t.to_le_bytes()).collect::<Vec<u8>>()))
  })
  .await
}

#[tauri::command]
pub async fn waveform_peaks(app: AppHandle, path: PathBuf, resolution_ms: Option<f64>, job: Option<String>, on_event: Channel<Event>) -> Result<Response> {
  let c = cache(&app)?;
  blocking(move || {
    let g = start_job(job)?;
    media::waveform(&c, &g.job, &path, resolution_ms.unwrap_or(8.0), &emitter(on_event)).map(Response::new)
  })
  .await
}

#[tauri::command]
pub async fn media_repeats(app: AppHandle, path: PathBuf, job: Option<String>, on_event: Channel<Event>) -> Result<crate::repeats::Repeats> {
  let c = cache(&app)?;
  blocking(move || {
    let g = start_job(job)?;
    crate::repeats::repeats(&c, &g.job, &path, &emitter(on_event))
  })
  .await
}

#[tauri::command]
pub async fn thumbnail_strip(app: AppHandle, path: PathBuf, height: Option<u32>, count: Option<usize>, job: Option<String>, on_event: Channel<Event>) -> Result<Strip> {
  let c = cache(&app)?;
  blocking(move || {
    let g = start_job(job)?;
    media::thumbnails(&c, &g.job, &path, height, count, &emitter(on_event))
  })
  .await
}

#[tauri::command]
pub async fn extract_frame(app: AppHandle, path: PathBuf, time_ms: f64, format: Option<ImageFormat>, max_width: Option<u32>, job: Option<String>) -> Result<Response> {
  let c = cache(&app)?;
  blocking(move || {
    let g = start_job(job)?;
    media::extract_frame(&c, &g.job, &path, time_ms, format.unwrap_or(ImageFormat::Png), max_width).map(Response::new)
  })
  .await
}

#[tauri::command]
pub async fn save_frame(app: AppHandle, path: PathBuf, time_ms: f64, dest: PathBuf, max_width: Option<u32>, job: Option<String>) -> Result<Written> {
  let c = cache(&app)?;
  let ro = read_only_roots(&app);
  blocking(move || {
    files::check_writable(&dest, &ro)?;
    let format = ImageFormat::from_path(&dest).ok_or_else(|| Error::invalid(format!("{}: use a .png, .jpg or .jpeg name", dest.display())))?;
    let g = start_job(job)?;
    let bytes = media::extract_frame(&c, &g.job, &path, time_ms, format, max_width)?;
    files::write_atomic(&dest, &bytes)
  })
  .await
}

#[tauri::command]
pub async fn transcode_preview(app: AppHandle, path: PathBuf, height: Option<u32>, job: Option<String>, on_event: Channel<Event>) -> Result<String> {
  let c = cache(&app)?;
  blocking(move || {
    let g = start_job(job)?;
    media::proxy(&c, &g.job, &path, height, &emitter(on_event))
  })
  .await
}

#[tauri::command]
pub async fn remux_mp4(app: AppHandle, path: PathBuf, h264: Option<bool>, job: Option<String>, on_event: Channel<Event>) -> Result<String> {
  let c = cache(&app)?;
  blocking(move || {
    let g = start_job(job)?;
    media::remux(&c, &g.job, &path, h264.unwrap_or(false), &emitter(on_event))
  })
  .await
}

#[tauri::command]
pub async fn scrub_cache(app: AppHandle, path: PathBuf, job: Option<String>, on_event: Channel<Event>) -> Result<String> {
  let c = cache(&app)?;
  blocking(move || {
    let g = start_job(job)?;
    media::scrub_cache(&c, &g.job, &path, &emitter(on_event))
  })
  .await
}

#[tauri::command]
pub fn job_cancel(job: String) -> bool {
  ffmpeg::cancel(&job)
}

#[tauri::command]
pub async fn media_cache_info(app: AppHandle) -> Result<CacheInfo> {
  let c = cache(&app)?;
  blocking(move || Ok(c.info())).await
}

/// paw-mh1a: the files the app has open now (the video and its proxy): their cache entries are never evicted.
#[tauri::command]
pub fn media_cache_open(paths: Vec<PathBuf>) {
  cache::set_open(&paths);
}

/// paw-mh1a: the entries evicted since the last call ({kind, bytes, age_s}), for the usage log.
#[tauri::command]
pub fn media_cache_evicted() -> Vec<cache::Evicted> {
  cache::take_evicted()
}

/// Sets the cache limit (bytes, clamped to 512 MiB..512 GiB) and evicts down to it at once.
#[tauri::command]
pub async fn media_cache_limit(app: AppHandle, bytes: u64) -> Result<CacheInfo> {
  cache::set_limit(bytes);
  let c = cache(&app)?;
  blocking(move || c.evict(None).map(|_| c.info())).await
}

#[tauri::command]
pub async fn media_cache_clear(app: AppHandle) -> Result<CacheInfo> {
  let c = cache(&app)?;
  blocking(move || c.clear()).await
}

/// paw-zkvc: the media-cache entries made from these files (a video and its proxies), biggest first: [{kind, bytes}].
#[tauri::command]
pub async fn media_cache_of(app: AppHandle, paths: Vec<PathBuf>) -> Result<Vec<cache::Item>> {
  let c = cache(&app)?;
  blocking(move || Ok(c.entries_of(&paths).into_iter().map(|(_, i)| i).collect())).await
}

/// paw-zkvc: removes them -> {freed: [{kind, bytes}], kept: [...] (still open, kept)}.
#[tauri::command]
pub async fn media_cache_remove_of(app: AppHandle, paths: Vec<PathBuf>) -> Result<cache::Removed> {
  let c = cache(&app)?;
  blocking(move || Ok(c.remove_of(&paths))).await
}

/// paw-zkvc: a file to the Recycle Bin (fixed local drive), else moved into <data_dir>/backups/removed. -> "recycle-bin" | the new path.
#[tauri::command]
pub async fn remove_recoverably(app: AppHandle, path: PathBuf) -> Result<String> {
  let aside = places(&app)?.backups.join("removed");
  let ro = read_only_roots(&app);
  blocking(move || files::check_writable(&path, &ro).and_then(|_| files::remove_recoverably(&path, &aside))).await
}

// ---------------------------------------------------------------- pack (paw-2k9s)

/// Writes a .pawpack at `dest` (pack.rs): streamed, cancellable (job_cancel), progress on `on_event`. -> {path, size}
#[tauri::command]
pub async fn pack_write(app: AppHandle, dest: PathBuf, manifest: Value, entries: Vec<pack::Entry>, job: Option<String>, on_event: Channel<Event>) -> Result<pack::Packed> {
  let _w = crate::app::Writing::new(&app); // paw-hzz3: a write in flight holds a close
  let ro = read_only_roots(&app);
  blocking(move || {
    files::check_writable(&dest, &ro)?;
    let g = start_job(job)?;
    pack::write(&g.job, &dest, &manifest, &entries, &emitter(on_event))
  })
  .await
}

/// A .pawpack's manifest (checked: a Pawscript pack of a format this build reads).
#[tauri::command]
pub async fn pack_manifest(path: PathBuf) -> Result<Value> {
  blocking(move || pack::manifest(&path)).await
}

/// Unpacks a .pawpack into `dir` (hashes checked, nothing replaced, nothing left on failure). -> the files written,
/// each noted as the app's own (paw-goia: the first save over one keeps no `.bak`).
#[tauri::command]
pub async fn pack_unpack(app: AppHandle, path: PathBuf, dir: PathBuf, job: Option<String>, on_event: Channel<Event>) -> Result<Vec<String>> {
  let _w = crate::app::Writing::new(&app); // paw-hzz3: a write in flight holds a close
  let ro = read_only_roots(&app);
  let log = places(&app)?.written_log;
  blocking(move || {
    let g = start_job(job)?;
    let got = pack::unpack(&g.job, &path, &dir, &emitter(on_event), &|p| files::check_writable(p, &ro))?;
    let _ = files::note_written(&log, &got); // lost: only a .bak at the first save, as before
    Ok(got.iter().map(|(p, _)| files::path_str(p)).collect())
  })
  .await
}

// ---------------------------------------------------------------- identity

#[tauri::command]
pub async fn file_fingerprint(path: PathBuf) -> Result<Fingerprint> {
  blocking(move || ident::quick(&path)).await
}

#[tauri::command]
pub async fn file_sha256(path: PathBuf, job: Option<String>, on_event: Channel<Event>) -> Result<String> {
  blocking(move || {
    let g = start_job(job)?;
    ident::sha256_file(&g.job, &path, &emitter(on_event))
  })
  .await
}

#[tauri::command]
pub async fn relink_search(dir: PathBuf, fingerprint: String, max_depth: Option<usize>) -> Result<Vec<String>> {
  blocking(move || ident::relink_search(&dir, &fingerprint, max_depth.unwrap_or(3).min(8))).await
}

#[cfg(test)]
mod tests {
  use super::*;

  /// paw-tprc: the setting moves the media cache only to an absolute folder it can make; anything else keeps the default.
  #[test]
  fn media_cache_dir_from_the_setting_else_the_default() {
    let t = tempfile::tempdir().unwrap();
    let (set, def) = (t.path().join("settings.json"), t.path().join("cache"));
    assert_eq!(media_cache_dir(&set, &def), def.join("media-cache")); // no settings file
    let mine = t.path().join("big drive").join("pawcache");
    for (v, want) in [
      (serde_json::json!({"media.cacheDir": format!(" {} ", mine.display())}), mine.clone()),
      (serde_json::json!({"media.cacheDir": ""}), def.join("media-cache")),
      (serde_json::json!({"media.cacheDir": "relative"}), def.join("media-cache")),
      (serde_json::json!({"media.cacheDir": 3}), def.join("media-cache")),
      (serde_json::json!({"media.cacheGb": 2}), def.join("media-cache")),
    ] {
      std::fs::write(&set, v.to_string()).unwrap();
      assert_eq!(media_cache_dir(&set, &def), want, "{v}");
    }
    assert!(mine.is_dir());
    std::fs::write(t.path().join("a file"), "x").unwrap(); // not a folder: the default
    std::fs::write(&set, serde_json::json!({"media.cacheDir": t.path().join("a file")}).to_string()).unwrap();
    assert_eq!(media_cache_dir(&set, &def), def.join("media-cache"));
  }
}