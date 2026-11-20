// Thin wrappers over the Tauri commands in src-tauri/API.md (one function per command).
// Errors: invoke rejects with a plain `{code, message}` object; wrappers let it propagate unchanged.
// Long jobs return `{ promise, cancel() }`; cancelling rejects `promise` with code 'cancelled'.
import { invoke, Channel } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { parsePeaks } from './media-data.js';

/** Run a job command with progress/sheet routing; returns {promise, cancel}. */
function job(cmd, args, { onProgress, onSheet } = {}, map) {
  const id = crypto.randomUUID();
  const onEvent = new Channel();
  onEvent.onmessage = (ev) => {
    if (ev.kind === 'progress') onProgress?.(ev.fraction, ev.stage);
    else if (ev.kind === 'sheet') onSheet?.(ev);
  };
  const p = invoke(cmd, { ...args, job: id, onEvent });
  return { promise: map ? p.then(map) : p, cancel: () => invoke('job_cancel', { job: id }) };
}

// Safe file IO
export const readText = (path) => invoke('read_text', { path }); // {text, sha256, size, mtime_ms}
export const writeTextAtomic = (path, text) => invoke('write_text_atomic', { path, text });
export const writeWithBackup = (path, text, { keep, expectedSha256 } = {}) => invoke('write_with_backup', { path, text, keep, expectedSha256 }); // expectedSha256:null forces overwrite
export const readBytes = (path) => invoke('read_bytes', { path }); // ArrayBuffer
/** bytes: Uint8Array, sent as the raw request body; the path rides in a header (percent-encoded). -> Written */
export const writeBytesAtomic = (path, bytes) => invoke('write_bytes_atomic', bytes, { headers: { path: encodeURIComponent(path) } });
// paw-ee14: the copy-on-write .pawruns (src-tauri/src/cow.rs); bodies of at most a few MB each
const hdr = (o) => ({ headers: Object.fromEntries(Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => [k, encodeURIComponent(String(v))])) });
/** bytes appended to the live file at `at` (its length); tail: hex of its expected last bytes; sync: fsync. -> {size, mtime_ms} */
export const runsAppend = (path, at, bytes, { tail, sync } = {}) => invoke('runs_append', bytes, hdr({ path, at, tail, sync: sync ? 1 : null }));
/** bytes appended to the stage (a temp file beside path) -> its size */
export const runsStageWrite = (path, stage, bytes) => invoke('runs_stage_write', bytes, hdr({ path, stage }));
/** ranges [[offset, length]] of src appended to the stage -> {size, sha256: [hex]} */
export const runsStageCopy = (path, stage, src, ranges) => invoke('runs_stage_copy', { path, stage, src, ranges });
/** the stage renamed over path (backup: the old file to the rolling backups first) -> {size, mtime_ms} */
export const runsStageCommit = (path, stage, { backup = false } = {}) => invoke('runs_stage_commit', { path, stage, backup });
export const runsStageDrop = (path, stage) => invoke('runs_stage_drop', { path, stage });
export const listBackups = (path) => invoke('list_backups', { path });
export const fileStat = (path) => invoke('file_stat', { path });
export const listDir = (dir, { stem, ext } = {}) => invoke('list_dir', { dir, stem, ext });
/** Files of a folder with these extensions (['.jpg', ...]) in batches: onBatch(entries[]) as they arrive; resolves with the count. */
// invoke can settle before the last channel messages are delivered: resolve when as many names have arrived as the command counted
export const listDirStream = (dir, exts, onBatch) => new Promise((res, rej) => {
  let got = 0, total = -1;
  const ch = new Channel();
  ch.onmessage = (b) => { got += b.length; onBatch(b); if (total >= 0 && got >= total) res(total); };
  invoke('list_dir_stream', { dir, exts, onEvent: ch }).then((n) => { total = n; if (got >= n) res(n); }, rej);
});
/** A small JPEG (long side max, default 160) of a still image at dest; kept when it exists. */
export const imageThumbnail = (path, dest, max) => invoke('image_thumbnail', { path, dest, max });
export const makeDir = (path) => invoke('make_dir', { path });
export const removeFile = (path) => invoke('remove_file', { path });
export const revealPath = (path) => invoke('reveal_path', { path });
export const openPath = (path) => invoke('open_path', { path }); // 'refused' for programs/scripts

// App state
export const appPaths = () => invoke('app_paths');
export const settingsGet = () => invoke('settings_get'); // {value, warning}
export const settingsSet = (value) => invoke('settings_set', { value });
export const recentList = () => invoke('recent_list');
export const recentAdd = (path) => invoke('recent_add', { path });
export const recentRemove = (path) => invoke('recent_remove', { path }); // no path = clear
export const autosaveWrite = ({ projectPath, session, title, content, keep }) => invoke('autosave_write', { projectPath, session, title, content, keep });
export const autosaveList = () => invoke('autosave_list');
export const autosaveClear = (id) => invoke('autosave_clear', { id });

// Media
export const mediaTools = () => invoke('media_tools');
export const mediaProbe = (path) => invoke('media_probe', { path });
/** -> Promise<number[]>: every video frame's presentation time (ms, ascending, file start = 0). Cached.
 *  A plain Array (callers use Array.isArray); the wire format is a little-endian Float64 buffer. */
export const frameTimes = (path, { onProgress } = {}) => frameTimesJob(path, { onProgress }).promise;
/** Same, cancellable: -> {promise, cancel}. */
export const frameTimesJob = (path, { onProgress } = {}) => job('media_frame_times', { path }, { onProgress }, (buf) => Array.from(new Float64Array(buf)));
export const mediaCacheInfo = () => invoke('media_cache_info');
export const mediaCacheClear = () => invoke('media_cache_clear');
/** Cache size limit in bytes (clamped to 512 MiB..512 GiB; evicts down to it now) -> {path, bytes, entries, limit}. */
export const mediaCacheLimit = (bytes) => invoke('media_cache_limit', { bytes: Math.round(bytes) });
/** paw-mh1a: the files open now (video, proxy): their cache entries are never evicted. */
export const mediaCacheOpen = (paths) => invoke('media_cache_open', { paths });
/** paw-mh1a: -> [{kind, bytes, age_s}] evicted since the last call. */
export const mediaCacheEvicted = () => invoke('media_cache_evicted');
/** -> {promise: Promise<parsePeaks result>, cancel} */
export const waveformPeaks = (path, { resolutionMs, onProgress } = {}) => job('waveform_peaks', { path, resolutionMs }, { onProgress }, parsePeaks);
/** -> {promise: Promise<{frames, exact, buckets: [[{f0, f1, t_ms}]]}>, cancel}: frames that repeat exactly elsewhere (cached). */
export const frameRepeats = (path, { onProgress } = {}) => job('media_repeats', { path }, { onProgress });
/** -> {promise: Promise<Strip>, cancel}; onSheet gets {kind:'sheet', level, index, path}. */
export const thumbnailStrip = (path, { height, count, onProgress, onSheet } = {}) => job('thumbnail_strip', { path, height, count }, { onProgress, onSheet });
/** -> {promise: Promise<mp4 path>, cancel} */
export const transcodePreview = (path, { height, onProgress } = {}) => job('transcode_preview', { path, height }, { onProgress });
/** -> {promise: Promise<mp4 path>, cancel}: the video as an MP4 the WebCodecs frame reader reads (stream copy, or H.264
 *  for a codec MP4 or WebCodecs cannot take; h264: transcode even so). paw-b88b: older shells ignore h264. */
export const remuxMp4 = (path, { h264 = false, onProgress } = {}) => job('remux_mp4', { path, h264 }, { onProgress });
/** -> {promise: Promise<mp4 path>, cancel}: all-intra copy (every frame a keyframe) for hover scrub; rejects
 *  'too_large' when it alone would exceed the cache limit. Instant when cached. */
export const scrubCache = (path, { onProgress } = {}) => job('scrub_cache', { path }, { onProgress });
export const extractFrame = (path, timeMs, { format, maxWidth } = {}) => invoke('extract_frame', { path, timeMs, format, maxWidth }); // ArrayBuffer
export const saveFrame = (path, timeMs, dest, { maxWidth } = {}) => invoke('save_frame', { path, timeMs, dest, maxWidth });

/** paw-zkvc: the media-cache entries made from these files (a video, its proxies) -> [{kind, bytes}], biggest first. */
export const mediaCacheOf = (paths) => invoke('media_cache_of', { paths });
/** paw-zkvc: removes them -> {freed: [{kind, bytes}], kept: [...] (in use)}. */
export const mediaCacheRemoveOf = (paths) => invoke('media_cache_remove_of', { paths });
/** paw-zkvc: a file to the Recycle Bin (fixed drive), else moved into <data_dir>/backups/removed -> 'recycle-bin' | its new path. */
export const removeRecoverably = (path) => invoke('remove_recoverably', { path });

// Pack (paw-2k9s): .pawpack, src-tauri/src/pack.rs
/** entries: [{name, role, path} | {name, role, text}] -> {promise: Promise<{path, size}>, cancel}; cancel leaves no file. */
export const packWrite = (dest, manifest, entries, { onProgress } = {}) => job('pack_write', { dest, manifest, entries }, { onProgress });
/** -> the pack's manifest (refused: not a pack, a newer major format). */
export const packManifest = (path) => invoke('pack_manifest', { path });
/** -> {promise: Promise<written paths>, cancel}: every listed file into dir, checksums checked, nothing replaced or left on failure. */
export const packUnpack = (path, dir, { onProgress } = {}) => job('pack_unpack', { path, dir }, { onProgress });

// File identity
export const fileFingerprint = (path) => invoke('file_fingerprint', { path }); // {size, fingerprint}
/** -> {promise: Promise<hex>, cancel} */
export const fileSha256 = (path, { onProgress } = {}) => job('file_sha256', { path }, { onProgress });
export const relinkSearch = (dir, fingerprint, { maxDepth } = {}) => invoke('relink_search', { dir, fingerprint, maxDepth });

// App plumbing
export const launchPaths = () => invoke('launch_paths');
export const closeGuard = (armed) => invoke('close_guard', { armed });
export const windowCloseNow = () => invoke('window_close_now');
/** paw-ee14: still writing (a held close waits on) / the close cancelled (the next one is held again) */
export const closeHeartbeat = () => invoke('close_heartbeat');
export const closeCancel = () => invoke('close_cancel');
/** paw-frhy: {windows, gpus, runtime} for the bug report (no paths). */
export const systemInfo = () => invoke('system_info');
export const onOpenPaths = (cb) => listen('pawscript://open-paths', (e) => cb(e.payload)); // Promise<unlisten>
export const onCloseRequested = (cb) => listen('pawscript://close-requested', () => cb());

// paw-cdot: the models, the runtime and updates (src-tauri/src/models.rs, update.rs, portable.rs): the only network
// access, each run by the user. Long ones take an id (cancel: modelsCancel(id)) and report {file, done, total}.
const progressed = (onProgress) => { const ch = new Channel(); ch.onmessage = (p) => onProgress?.(p); return ch; };
export const modelsInfo = (dir) => invoke('models_info', { dir }); // {defaultDir, envUrl, exists, free, fake}
export const modelsScan = (dir, paths) => invoke('models_scan', { dir, paths }); // [{path, exists, bytes, part}]
export const modelsManifest = (base) => invoke('models_manifest', { base }); // the server's manifest.json text
/** files: [{path, url, bytes, sha256}] into dir (resumes, checks each file's SHA-256 before it is kept) */
export const modelsDownload = (id, base, dir, files, onProgress) => invoke('models_download', { id, base, dir, files, onEvent: progressed(onProgress) });
/** items: [{src, path, bytes, sha256, strict}] moved into dir -> [{path, sha256, tested}] */
export const modelsImport = (id, dir, items, onProgress) => invoke('models_import', { id, dir, items, onEvent: progressed(onProgress) });
export const modelsVerify = (id, dir, paths, onProgress) => invoke('models_verify', { id, dir, paths, onEvent: progressed(onProgress) }); // {path: sha256}
export const modelsCancel = (id) => invoke('models_cancel', { id });
export const modelsRemove = (dir, paths) => invoke('models_remove', { dir, paths }); // -> files deleted
export const modelsChanged = () => invoke('models_changed');
export const openUrl = (url) => invoke('open_url', { url });
export const runtimeStatus = () => invoke('runtime_status'); // {portable, dir, runtimes: [{id, installed, python, zip}]}
export const runtimeUnpack = () => invoke('runtime_unpack');
export const portableStatus = () => invoke('portable_status'); // {state: ready | unpacking | refused | failed, what?, message?}
export const runtimeRemove = (id) => invoke('runtime_remove', { id }); // a runtime's folder (python\ or python-rocm\)
export const gpuProbe = () => invoke('gpu_probe'); // {adapters: [{vendor, name, vram, software}], runtime, name, vram}
export const updateCheck = () => invoke('update_check'); // {configured, current, version, notes, date, portable}
export const updateDownload = (onProgress) => invoke('update_download', { onEvent: progressed(onProgress) }); // {done, total}
export const updateRestart = () => invoke('update_restart');
