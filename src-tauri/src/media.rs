//! Media helpers over ffmpeg: probe, waveform peak pyramid, thumbnail sprite
//! sheets, single frames, a webview-playable proxy. Results that cost more than a
//! moment are cached (cache.rs). Nothing is ever written next to the user's video.

use crate::cache::Cache;
use crate::error::{At, Error, Result};
use crate::ffmpeg::{self, args, input_arg, Job, Tool};
use crate::files::{path_str, write_atomic};
use serde_json::Value;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// Streamed to the caller's Channel while a job runs.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Event {
  /// `fraction` 0..1 of the current operation.
  Progress { stage: &'static str, fraction: f64 },
  /// A thumbnail sheet is ready (thumbnail_strip only).
  Sheet { level: usize, index: usize, path: String },
}

/// At most ~10 progress events a second (always the last one).
pub(crate) struct Throttle {
  at: Option<Instant>,
}
impl Throttle {
  pub(crate) fn new() -> Self {
    Throttle { at: None }
  }
  pub(crate) fn emit(&mut self, emit: &(dyn Fn(Event) + Sync), stage: &'static str, fraction: f64) {
    let f = fraction.clamp(0.0, 1.0);
    if f >= 1.0 || self.at.is_none_or(|t| t.elapsed() >= Duration::from_millis(100)) {
      self.at = Some(Instant::now());
      emit(Event::Progress { stage, fraction: f });
    }
  }
}

// ---------------------------------------------------------------- probe

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Video {
  /// ffprobe stream index (the video stream used; cover art is skipped).
  pub stream_index: u32,
  pub codec: String,
  pub profile: Option<String>,
  pub pix_fmt: Option<String>,
  /// Coded size.
  pub width: u32,
  pub height: u32,
  /// Size as shown: sample aspect ratio and rotation applied.
  pub display_width: u32,
  pub display_height: u32,
  /// Clockwise degrees a player rotates the picture by: 0, 90, 180 or 270.
  pub rotation: u32,
  /// Nominal frame rate (average when known) and the same as an exact fraction.
  pub fps: f64,
  pub fps_rational: Rational,
  pub frame_ms: f64,
  /// Hint: average and base frame rates disagree by more than 1 %.
  pub is_vfr: bool,
  pub frame_count: u64,
  /// False when the container has no frame count and it was estimated from duration × fps.
  pub frame_count_exact: bool,
  pub duration_ms: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Rational {
  pub num: u32,
  pub den: u32,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Audio {
  pub codec: String,
  pub sample_rate: u32,
  pub channels: u32,
  pub duration_ms: f64,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Probe {
  pub path: String,
  /// ffprobe's format_name, e.g. "mov,mp4,m4a,3gp,3g2,mj2".
  pub container: String,
  pub size: u64,
  pub duration_ms: f64,
  pub start_ms: f64,
  pub bit_rate: Option<u64>,
  pub video: Option<Video>,
  pub audio: Option<Audio>,
  pub has_audio: bool,
  /// Hint: codecs and container a Chromium webview plays without a proxy.
  pub webview_playable: bool,
}

fn num(v: &Value) -> Option<f64> {
  match v {
    Value::Number(n) => n.as_f64(),
    Value::String(s) => s.trim().parse().ok(),
    _ => None,
  }
  .filter(|x: &f64| x.is_finite())
}

/// "30000/1001" (or "16:9" after the caller swaps the colon) -> (value, fraction).
fn rational(s: Option<&str>) -> Option<(f64, Rational)> {
  let s = s?;
  let (a, b) = s.split_once('/').unwrap_or((s, "1"));
  let (num, den): (u32, u32) = (a.trim().parse().ok()?, b.trim().parse().ok()?);
  (num > 0 && den > 0).then(|| (num as f64 / den as f64, Rational { num, den }))
}

/// "00:10:00.000000000" (Matroska DURATION tag) -> seconds.
fn hms(s: &str) -> Option<f64> {
  let mut t = 0.0;
  for part in s.split(':') {
    t = t * 60.0 + part.trim().parse::<f64>().ok()?;
  }
  Some(t)
}

fn stream_duration_s(s: &Value) -> Option<f64> {
  num(&s["duration"]).or_else(|| s["tags"]["DURATION"].as_str().and_then(hms)).filter(|d| *d > 0.0)
}

fn rotation_cw(s: &Value) -> u32 {
  // Display matrix rotation is counter-clockwise degrees; the legacy `rotate` tag is clockwise.
  let ccw = s["side_data_list"].as_array().and_then(|l| l.iter().find_map(|d| num(&d["rotation"])));
  let cw = match ccw {
    Some(r) => -r,
    None => s["tags"]["rotate"].as_str().and_then(|r| r.parse().ok()).unwrap_or(0.0),
  };
  (((cw / 90.0).round() as i64 * 90).rem_euclid(360)) as u32
}

pub fn parse_probe(path: &Path, j: &Value) -> Result<Probe> {
  let streams = j["streams"].as_array().cloned().unwrap_or_default();
  let format = &j["format"];
  let fmt_dur = num(&format["duration"]).filter(|d| *d > 0.0);
  let vs = streams.iter().find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"].as_i64() != Some(1));
  let a = streams.iter().find(|s| s["codec_type"] == "audio");
  if vs.is_none() && a.is_none() {
    return Err(Error::new("no_media", format!("{}: no audio or video stream", path.display())));
  }
  let duration_s = fmt_dur.or_else(|| streams.iter().filter_map(stream_duration_s).reduce(f64::max)).unwrap_or(0.0);
  let video = vs.map(|s| {
    let width = s["width"].as_u64().unwrap_or(0) as u32;
    let height = s["height"].as_u64().unwrap_or(0) as u32;
    let avg = rational(s["avg_frame_rate"].as_str());
    let base = rational(s["r_frame_rate"].as_str());
    let (fps, fps_rational) = avg.or(base).unwrap_or((0.0, Rational { num: 0, den: 1 }));
    let is_vfr = matches!((&avg, &base), (Some((a, _)), Some((b, _))) if (a - b).abs() / b > 0.01);
    let vdur = stream_duration_s(s).unwrap_or(duration_s);
    let nb = s["nb_frames"].as_str().and_then(|n| n.parse::<u64>().ok()).filter(|n| *n > 0);
    let sar = rational(s["sample_aspect_ratio"].as_str().map(|x| x.replace(':', "/")).as_deref()).map_or(1.0, |r| r.0);
    let rotation = rotation_cw(s);
    let (dw, dh) = (((width as f64) * sar).round() as u32, height);
    let (display_width, display_height) = if rotation % 180 == 90 { (dh, dw) } else { (dw, dh) };
    Video {
      stream_index: s["index"].as_u64().unwrap_or(0) as u32,
      codec: s["codec_name"].as_str().unwrap_or("").into(),
      profile: s["profile"].as_str().map(String::from),
      pix_fmt: s["pix_fmt"].as_str().map(String::from),
      width,
      height,
      display_width,
      display_height,
      rotation,
      fps,
      fps_rational,
      frame_ms: if fps > 0.0 { 1000.0 / fps } else { 0.0 },
      is_vfr,
      frame_count: nb.unwrap_or((vdur * fps).round() as u64),
      frame_count_exact: nb.is_some(),
      duration_ms: vdur * 1000.0,
    }
  });
  let audio = a.map(|s| Audio {
    codec: s["codec_name"].as_str().unwrap_or("").into(),
    sample_rate: num(&s["sample_rate"]).unwrap_or(0.0) as u32,
    channels: s["channels"].as_u64().unwrap_or(0) as u32,
    duration_ms: stream_duration_s(s).unwrap_or(duration_s) * 1000.0,
  });
  let container = format["format_name"].as_str().unwrap_or("").to_string();
  let webview_playable = playable(&container, video.as_ref().map(|v| v.codec.as_str()), audio.as_ref().map(|a| a.codec.as_str()));
  Ok(Probe {
    path: path_str(path),
    size: num(&format["size"]).unwrap_or(0.0) as u64,
    duration_ms: duration_s * 1000.0,
    start_ms: num(&format["start_time"]).unwrap_or(0.0) * 1000.0,
    bit_rate: num(&format["bit_rate"]).map(|b| b as u64),
    has_audio: audio.is_some(),
    container,
    video,
    audio,
    webview_playable,
  })
}

fn playable(container: &str, video: Option<&str>, audio: Option<&str>) -> bool {
  let mp4 = container.contains("mp4") || container.contains("mov");
  let webm = container.contains("webm") || container.contains("matroska");
  let v_ok = match video {
    None => true,
    Some("h264") => mp4,
    Some("vp8" | "vp9" | "av1") => mp4 || webm,
    _ => false,
  };
  let a_ok = match audio {
    None => true,
    Some("aac" | "mp3") => mp4,
    Some("opus" | "vorbis" | "flac") => mp4 || webm,
    _ => false,
  };
  (mp4 || webm) && v_ok && a_ok
}

fn probe_uncached(job: &Job, path: &Path) -> Result<Probe> {
  let out = ffmpeg::output(
    job,
    Tool::Ffprobe,
    &[args(["-v", "error", "-protocol_whitelist", "file", "-print_format", "json", "-show_format", "-show_streams"]), vec![input_arg(path)]].concat(),
  )?;
  let j: Value = serde_json::from_slice(&out).map_err(|e| Error::new("ffmpeg_failed", format!("unreadable ffprobe output: {e}")))?;
  parse_probe(path, &j)
}

pub fn probe(cache: &Cache, job: &Job, path: &Path) -> Result<Probe> {
  let key = Cache::key(path, "probe", "v2")?;
  if let Some(dir) = cache.get(&key) {
    if let Some(p) = fs::read(dir.join("probe.json")).ok().and_then(|b| serde_json::from_slice::<Probe>(&b).ok()) {
      return Ok(Probe { path: path_str(path), ..p });
    }
  }
  let p = probe_uncached(job, path)?;
  // Two probes of one file at once: the second simply does not cache.
  if let Ok(b) = cache.begin(&key) {
    write_atomic(&b.dir.join("probe.json"), &serde_json::to_vec(&p).unwrap_or_default())?;
    b.finish()?;
  }
  Ok(p)
}

// ---------------------------------------------------------------- frame times

pub fn frame_times_args(path: &Path, stream_index: u32) -> Vec<OsString> {
  let st = stream_index.to_string();
  [
    args(["-v", "error", "-protocol_whitelist", "file", "-select_streams", st.as_str(), "-show_entries", "packet=pts_time,flags", "-of", "csv=p=0"]),
    vec![input_arg(path)],
  ]
  .concat()
}

/// One `pts_time,flags` csv line -> pts in ms; None for N/A or a discard-flagged
/// packet (edit-list priming, never shown).
pub fn packet_ms(line: &str) -> Option<f64> {
  let mut f = line.trim().split(',');
  let pts: f64 = f.next()?.trim().parse().ok()?;
  if f.next().is_some_and(|flags| flags.contains('D')) {
    return None;
  }
  pts.is_finite().then_some(pts * 1000.0)
}

/// Presentation order (packets come in decode order), duplicates removed, shifted
/// so the file's start time is 0 (the timeline extract_frame and the player use).
pub fn finish_times(mut t: Vec<f64>, start_ms: f64) -> Vec<f64> {
  t.sort_by(f64::total_cmp);
  t.dedup_by(|a, b| (*a - *b).abs() < 1e-6);
  t.iter().map(|x| ((x - start_ms) * 1e6).round() / 1e6).collect()
}

/// Every video frame's presentation time in ms, ascending (a packet scan: no decoding).
pub fn frame_times(cache: &Cache, job: &Job, path: &Path, emit: &(dyn Fn(Event) + Sync)) -> Result<Vec<f64>> {
  let p = probe(cache, job, path)?;
  let Some(v) = &p.video else {
    return Err(Error::new("no_video", format!("{}: no video stream", path.display())));
  };
  let key = Cache::key(path, "frametimes", &format!("v1 s={}", v.stream_index))?;
  if let Some(dir) = cache.get(&key) {
    if let Ok(b) = fs::read(dir.join("times.f64")) {
      return Ok(b.chunks_exact(8).map(|c| f64::from_le_bytes(c.try_into().unwrap())).collect());
    }
  }
  let dur = p.duration_ms.max(1.0);
  let mut times = Vec::with_capacity(v.frame_count as usize + 16);
  let mut pending: Vec<u8> = Vec::new();
  let mut th = Throttle::new();
  ffmpeg::run(
    job,
    Tool::Ffprobe,
    &frame_times_args(path, v.stream_index),
    |chunk| {
      pending.extend_from_slice(chunk);
      let end = pending.iter().rposition(|b| *b == b'\n').map_or(0, |i| i + 1);
      for line in String::from_utf8_lossy(&pending[..end]).lines() {
        if let Some(ms) = packet_ms(line) {
          times.push(ms);
        }
      }
      pending.drain(..end);
      if let Some(last) = times.last() {
        th.emit(emit, "frame_times", (last - p.start_ms) / dur);
      }
      Ok(())
    },
    |_| {},
  )?;
  if let Some(ms) = packet_ms(&String::from_utf8_lossy(&pending)) {
    times.push(ms);
  }
  let times = finish_times(times, p.start_ms);
  if times.is_empty() {
    return Err(Error::new("no_frame", format!("{}: the video stream has no frames", path.display())));
  }
  if let Ok(b) = cache.begin(&key) {
    let bytes: Vec<u8> = times.iter().flat_map(|t| t.to_le_bytes()).collect();
    write_atomic(&b.dir.join("times.f64"), &bytes)?;
    b.finish()?;
  }
  th.emit(emit, "frame_times", 1.0);
  Ok(times)
}

/// Seek point that makes ffmpeg return the frame shown at `time_ms`, from the
/// real frame table: midway between that frame and the one before it.
pub fn table_seek_ms(times: &[f64], time_ms: f64) -> f64 {
  let i = times.partition_point(|t| *t <= time_ms + 1e-6);
  match i {
    0 | 1 => 0.0,
    _ => (times[i - 2] + times[i - 1]) / 2.0,
  }
}

// ---------------------------------------------------------------- waveform peaks

/// Audio is decoded to mono at this rate for peaks: enough for an envelope.
pub const PEAK_RATE: u32 = 8000;

/// One resolution: `data` holds (min, max, rms) i16 triples, one per bucket of
/// `spb` samples (the last bucket may be shorter).
#[derive(Debug, Clone, PartialEq)]
pub struct Level {
  pub spb: u32,
  pub data: Vec<i16>,
}

impl Level {
  pub fn buckets(&self) -> usize {
    self.data.len() / 3
  }
}

pub struct Accum {
  spb: u32,
  n: u32,
  min: i16,
  max: i16,
  sq: f64,
  total: u64,
  data: Vec<i16>,
}

fn rms_i16(sq: f64, n: f64) -> i16 {
  if n <= 0.0 {
    0
  } else {
    (sq / n).sqrt().round().min(32767.0) as i16
  }
}

impl Accum {
  pub fn new(spb: u32) -> Self {
    Accum { spb: spb.max(1), n: 0, min: i16::MAX, max: i16::MIN, sq: 0.0, total: 0, data: Vec::new() }
  }
  pub fn push(&mut self, s: i16) {
    self.min = self.min.min(s);
    self.max = self.max.max(s);
    self.sq += (s as f64) * (s as f64);
    self.n += 1;
    self.total += 1;
    if self.n == self.spb {
      self.flush();
    }
  }
  fn flush(&mut self) {
    if self.n > 0 {
      self.data.extend([self.min, self.max, rms_i16(self.sq, self.n as f64)]);
      (self.n, self.min, self.max, self.sq) = (0, i16::MAX, i16::MIN, 0.0);
    }
  }
  pub fn total(&self) -> u64 {
    self.total
  }
  pub fn finish(mut self) -> (Level, u64) {
    self.flush();
    (Level { spb: self.spb, data: self.data }, self.total)
  }
}

/// Samples in bucket `i` of a level with `spb` samples per bucket.
fn bucket_len(i: usize, spb: u32, total: u64) -> f64 {
  total.saturating_sub(i as u64 * spb as u64).min(spb as u64) as f64
}

/// Halves the resolution repeatedly (min of mins, max of maxes, RMS weighted by
/// sample count) until a level has at most `top` buckets. Level 0 is `base`.
pub fn pyramid(base: Level, total: u64, top: usize) -> Vec<Level> {
  let mut levels = vec![base];
  loop {
    let prev = levels.last().unwrap();
    if prev.buckets() <= top.max(1) {
      return levels;
    }
    let mut data = Vec::with_capacity(prev.data.len() / 2 + 3);
    for (pair_i, pair) in prev.data.chunks(6).enumerate() {
      let i = pair_i * 2;
      let (mut mn, mut mx, mut sq, mut n) = (i16::MAX, i16::MIN, 0.0, 0.0);
      for (k, b) in pair.chunks(3).enumerate() {
        let len = bucket_len(i + k, prev.spb, total);
        mn = mn.min(b[0]);
        mx = mx.max(b[1]);
        sq += (b[2] as f64).powi(2) * len;
        n += len;
      }
      data.extend([mn, mx, rms_i16(sq, n)]);
    }
    levels.push(Level { spb: prev.spb * 2, data });
  }
}

/// The binary layout documented in API.md ("PWPK", little-endian).
pub fn encode_peaks(rate: u32, total: u64, levels: &[Level]) -> Vec<u8> {
  let mut b = Vec::with_capacity(24 + levels.len() * 8 + levels.iter().map(|l| l.data.len() * 2).sum::<usize>());
  b.extend_from_slice(b"PWPK");
  b.extend_from_slice(&1u32.to_le_bytes());
  b.extend_from_slice(&rate.to_le_bytes());
  b.extend_from_slice(&(levels.len() as u32).to_le_bytes());
  b.extend_from_slice(&total.to_le_bytes());
  for l in levels {
    b.extend_from_slice(&l.spb.to_le_bytes());
    b.extend_from_slice(&(l.buckets() as u32).to_le_bytes());
  }
  for l in levels {
    for v in &l.data {
      b.extend_from_slice(&v.to_le_bytes());
    }
  }
  b
}

/// Samples per base bucket for a requested base resolution in ms.
pub fn spb_for(resolution_ms: f64) -> u32 {
  let ms = if resolution_ms.is_finite() { resolution_ms.clamp(0.5, 10_000.0) } else { 8.0 };
  ((ms * PEAK_RATE as f64 / 1000.0).round() as u32).max(4)
}

pub fn waveform_args(path: &Path) -> Vec<OsString> {
  let rate = PEAK_RATE.to_string();
  [
    args(["-nostdin", "-v", "error", "-protocol_whitelist", "file", "-i"]),
    vec![input_arg(path)],
    args(["-map", "0:a:0", "-ac", "1", "-ar", rate.as_str(), "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"]),
  ]
  .concat()
}

pub fn waveform(cache: &Cache, job: &Job, path: &Path, resolution_ms: f64, emit: &(dyn Fn(Event) + Sync)) -> Result<Vec<u8>> {
  let spb = spb_for(resolution_ms);
  let key = Cache::key(path, "peaks", &format!("v1 rate={PEAK_RATE} spb={spb}"))?;
  if let Some(dir) = cache.get(&key) {
    if let Ok(b) = fs::read(dir.join("peaks.bin")) {
      return Ok(b);
    }
  }
  let p = probe(cache, job, path)?;
  let Some(audio) = &p.audio else {
    return Err(Error::new("no_audio", format!("{}: no audio stream", path.display())));
  };
  let expect = (audio.duration_ms / 1000.0 * PEAK_RATE as f64).max(1.0);
  let building = cache.begin(&key)?;
  let mut acc = Accum::new(spb);
  let mut carry: Option<u8> = None;
  let mut th = Throttle::new();
  ffmpeg::run(
    job,
    Tool::Ffmpeg,
    &waveform_args(path),
    |chunk| {
      let mut bytes = chunk;
      if let Some(lo) = carry.take() {
        acc.push(i16::from_le_bytes([lo, bytes[0]]));
        bytes = &bytes[1..];
      }
      let mut pairs = bytes.chunks_exact(2);
      for s in &mut pairs {
        acc.push(i16::from_le_bytes([s[0], s[1]]));
      }
      carry = pairs.remainder().first().copied();
      th.emit(emit, "waveform", acc.total() as f64 / expect);
      Ok(())
    },
    |_| {},
  )?;
  let (base, total) = acc.finish();
  let bytes = encode_peaks(PEAK_RATE, total, &pyramid(base, total, 1024));
  write_atomic(&building.dir.join("peaks.bin"), &bytes)?;
  building.finish()?;
  th.emit(emit, "waveform", 1.0);
  Ok(bytes)
}

// ---------------------------------------------------------------- thumbnails

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct StripLevel {
  pub count: usize,
  /// Media time of each frame, ms. Frame `i` sits in sheet `i / (columns*rows)`,
  /// cell `i % (columns*rows)` in row-major order.
  pub times_ms: Vec<f64>,
  /// JPEG sprite sheets (absolute paths in the cache; load with convertFileSrc).
  pub sheets: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Strip {
  pub tile_w: u32,
  pub tile_h: u32,
  pub columns: u32,
  pub rows: u32,
  /// Level 0 is a quick coarse pass; the last level is the full set. One level
  /// when the full set is small.
  pub levels: Vec<StripLevel>,
}

pub const COARSE: usize = 20;
const SHEET_MAX_PX: u32 = 4096;

fn even(x: f64) -> u32 {
  ((x / 2.0).round() as u32 * 2).max(2)
}

/// Sizes and times for a strip. `height` default 90 px; `count` default one
/// frame per second, 10..300.
pub fn plan_strip(duration_ms: f64, display_w: u32, display_h: u32, height: Option<u32>, count: Option<usize>) -> Strip {
  let tile_h = even(height.unwrap_or(90).clamp(32, 720) as f64);
  let aspect = if display_w > 0 && display_h > 0 { display_w as f64 / display_h as f64 } else { 16.0 / 9.0 };
  let tile_w = even((tile_h as f64 * aspect).clamp(16.0, 1280.0));
  let columns = (SHEET_MAX_PX / tile_w).clamp(1, 10);
  let n = count.unwrap_or((duration_ms / 1000.0).round() as usize).clamp(if count.is_some() { 1 } else { 10 }, if count.is_some() { 5000 } else { 300 });
  // No taller than the full set needs: a 10-frame strip is one row, not a 10x10 sheet.
  let rows = (SHEET_MAX_PX / tile_h).clamp(1, 10).min(n.div_ceil(columns as usize) as u32);
  let times = |n: usize| (0..n).map(|i| ((i as f64 + 0.5) * duration_ms / n as f64 * 1000.0).round() / 1000.0).collect::<Vec<_>>();
  let mut levels = Vec::new();
  if n > COARSE * 2 {
    levels.push(StripLevel { count: COARSE, times_ms: times(COARSE), sheets: vec![] });
  }
  levels.push(StripLevel { count: n, times_ms: times(n), sheets: vec![] });
  Strip { tile_w, tile_h, columns, rows, levels }
}

impl Strip {
  pub fn per_sheet(&self) -> usize {
    (self.columns * self.rows) as usize
  }
  /// (sheet index, x, y) of frame `i` (the front end's copy is src-tauri/js/media-data.js).
  #[cfg(test)]
  pub fn cell(&self, i: usize) -> (usize, u32, u32) {
    let k = i % self.per_sheet();
    (i / self.per_sheet(), (k as u32 % self.columns) * self.tile_w, (k as u32 / self.columns) * self.tile_h)
  }
}

fn secs(ms: f64) -> String {
  format!("{:.6}", (ms / 1000.0).max(0.0))
}

pub fn frame_args(path: &Path, time_ms: f64, w: u32, h: u32, out: &Path) -> Vec<OsString> {
  let vf = format!("scale={w}:{h}:flags=bilinear,setsar=1");
  let ss = secs(time_ms);
  [
    args(["-nostdin", "-v", "error", "-protocol_whitelist", "file", "-threads", "2", "-ss", ss.as_str(), "-i"]),
    vec![input_arg(path)],
    args(["-map", "0:v:0", "-frames:v", "1", "-vf", vf.as_str(), "-q:v", "4", "-y"]),
    vec![out.into()],
  ]
  .concat()
}

/// `%` would be read as part of the image2 sequence pattern.
fn pattern(dir: &Path, level: usize) -> OsString {
  let d = path_str(dir).replace('%', "%%");
  format!("{d}{}f{level}-%05d.jpg", std::path::MAIN_SEPARATOR).into()
}

fn frame_file(dir: &Path, level: usize, i: usize) -> PathBuf {
  dir.join(format!("f{level}-{i:05}.jpg"))
}

pub fn sheet_args(dir: &Path, level: usize, first: usize, columns: u32, rows: u32, out: &Path) -> Vec<OsString> {
  let tile = format!("tile={columns}x{rows}");
  let start = first.to_string();
  [
    args(["-nostdin", "-v", "error", "-f", "image2", "-start_number", start.as_str(), "-i"]),
    vec![pattern(dir, level)],
    args(["-frames:v", "1", "-vf", tile.as_str(), "-q:v", "4", "-y"]),
    vec![out.into()],
  ]
  .concat()
}

fn black_frame(job: &Job, w: u32, h: u32, out: &Path) -> Result<()> {
  let src = format!("color=c=black:s={w}x{h}");
  ffmpeg::output(job, Tool::Ffmpeg, &[args(["-nostdin", "-v", "error", "-f", "lavfi", "-i", src.as_str(), "-frames:v", "1", "-y"]), vec![out.into()]].concat())
    .map(|_| ())
}

/// Composes one sheet from its frame files (filling any frame ffmpeg could not
/// decode with its neighbour, or black), then deletes the frame files.
fn compose_sheet(job: &Job, strip: &Strip, level: usize, sheet: usize, dir: &Path) -> Result<PathBuf> {
  let per = strip.per_sheet();
  let n = strip.levels[level].count;
  let (first, last) = (sheet * per, ((sheet + 1) * per).min(n));
  for i in first..last {
    let f = frame_file(dir, level, i);
    if !f.exists() {
      match (first..i).rev().map(|j| frame_file(dir, level, j)).find(|p| p.exists()) {
        Some(prev) => drop(fs::copy(&prev, &f).at(&f)?),
        None => black_frame(job, strip.tile_w, strip.tile_h, &f)?,
      }
    }
  }
  let out = dir.join(format!("L{level}-S{sheet:03}.jpg"));
  ffmpeg::output(job, Tool::Ffmpeg, &sheet_args(dir, level, first, strip.columns, strip.rows, &out))?;
  for i in first..last {
    let _ = fs::remove_file(frame_file(dir, level, i));
  }
  if !out.is_file() {
    return Err(Error::new("ffmpeg_failed", "ffmpeg wrote no thumbnail sheet"));
  }
  Ok(out)
}

/// Parallel per-frame ffmpeg processes, 2 decode threads each. Measured on a
/// 10-min 1080p H.264 clip (8 s GOP, 32 threads): 8x1 = 62 ms/frame, 16x2 = 43;
/// past that the seek-and-decode-from-keyframe cost is the floor.
pub fn workers() -> usize {
  std::thread::available_parallelism().map_or(4, |n| n.get()).div_ceil(2).clamp(2, 16)
}

/// Extracts one level's frames on a worker pool, composing each sheet as soon as
/// all its frames exist, in order. `done` counts frames across levels for progress.
#[allow(clippy::too_many_arguments)]
fn extract_level(job: &Job, path: &Path, strip: &mut Strip, level: usize, dir: &Path, done: &AtomicUsize, total: usize, emit: &(dyn Fn(Event) + Sync)) -> Result<()> {
  let n = strip.levels[level].count;
  let per = strip.per_sheet();
  let sheets = n.div_ceil(per);
  let next = AtomicUsize::new(0);
  let abort = AtomicBool::new(false);
  let ok_frames = AtomicUsize::new(0);
  let (tw, th_px) = (strip.tile_w, strip.tile_h);
  let times = strip.levels[level].times_ms.clone();
  let (tx, rx) = mpsc::channel::<Result<usize>>();
  let mut th = Throttle::new();
  let mut out: Vec<String> = Vec::new();
  let soft_err: std::sync::Mutex<Option<Error>> = Default::default();
  let no_frame = || {
    let why = soft_err.lock().unwrap_or_else(|p| p.into_inner()).take().map(|e| e.message).unwrap_or_default();
    Error::new("ffmpeg_failed", format!("{}: no frame could be decoded ({why})", path.display()))
  };
  let result = std::thread::scope(|s| {
    for _ in 0..workers() {
      let tx = tx.clone();
      let (next, abort, ok_frames, times, soft_err) = (&next, &abort, &ok_frames, &times, &soft_err);
      s.spawn(move || loop {
        let i = next.fetch_add(1, Ordering::SeqCst);
        if i >= n || abort.load(Ordering::SeqCst) || job.is_cancelled() {
          break;
        }
        match ffmpeg::output(job, Tool::Ffmpeg, &frame_args(path, times[i], tw, th_px, &frame_file(dir, level, i))) {
          Ok(_) => drop(ok_frames.fetch_add(1, Ordering::SeqCst)),
          // One undecodable spot must not fail the strip: the gap is filled at compose time.
          Err(e) if e.code == "ffmpeg_failed" => *soft_err.lock().unwrap_or_else(|p| p.into_inner()) = Some(e),
          Err(e) => {
            abort.store(true, Ordering::SeqCst);
            let _ = tx.send(Err(e));
            break;
          }
        }
        if tx.send(Ok(i)).is_err() {
          break;
        }
      });
    }
    drop(tx);
    let mut have = vec![0usize; sheets];
    let mut next_sheet = 0;
    for msg in rx {
      let i = match msg {
        Ok(i) => i,
        Err(e) => {
          abort.store(true, Ordering::SeqCst);
          return Err(e);
        }
      };
      have[i / per] += 1;
      let d = done.fetch_add(1, Ordering::SeqCst) + 1;
      th.emit(emit, "thumbnails", d as f64 / total as f64);
      while next_sheet < sheets && have[next_sheet] == ((next_sheet + 1) * per).min(n) - next_sheet * per {
        if ok_frames.load(Ordering::SeqCst) == 0 && next_sheet == 0 {
          // Every frame of the first sheet failed: the file is not decodable, do not paint it black.
          abort.store(true, Ordering::SeqCst);
          return Err(no_frame());
        }
        match compose_sheet(job, strip, level, next_sheet, dir) {
          Ok(p) => {
            let p = path_str(&p);
            emit(Event::Sheet { level, index: next_sheet, path: p.clone() });
            out.push(p);
          }
          Err(e) => {
            abort.store(true, Ordering::SeqCst);
            return Err(e);
          }
        }
        next_sheet += 1;
      }
    }
    Ok(())
  });
  job.check()?;
  result?;
  if out.len() != sheets {
    return Err(no_frame());
  }
  strip.levels[level].sheets = out;
  Ok(())
}

pub fn thumbnails(cache: &Cache, job: &Job, path: &Path, height: Option<u32>, count: Option<usize>, emit: &(dyn Fn(Event) + Sync)) -> Result<Strip> {
  let p = probe(cache, job, path)?;
  let Some(v) = &p.video else {
    return Err(Error::new("no_video", format!("{}: no video stream", path.display())));
  };
  let duration = if v.duration_ms > 0.0 { v.duration_ms } else { p.duration_ms };
  let mut strip = plan_strip(duration, v.display_width, v.display_height, height, count);
  let key = Cache::key(path, "thumbs", &format!("v1 {}x{} n={}", strip.tile_w, strip.tile_h, strip.levels.last().map_or(0, |l| l.count)))?;
  if let Some(dir) = cache.get(&key) {
    if let Some(s) = fs::read(dir.join("strip.json")).ok().and_then(|b| serde_json::from_slice::<Strip>(&b).ok()) {
      if s.levels.iter().flat_map(|l| &l.sheets).all(|p| Path::new(p).is_file()) {
        return Ok(s);
      }
    }
  }
  let building = cache.begin(&key)?;
  let total: usize = strip.levels.iter().map(|l| l.count).sum();
  let done = AtomicUsize::new(0);
  for level in 0..strip.levels.len() {
    extract_level(job, path, &mut strip, level, &building.dir, &done, total, emit)?;
  }
  write_atomic(&building.dir.join("strip.json"), &serde_json::to_vec(&strip).unwrap_or_default())?;
  building.finish()?;
  Ok(strip)
}

// ---------------------------------------------------------------- single frames

#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageFormat {
  Png,
  Jpeg,
}

impl ImageFormat {
  pub fn from_path(p: &Path) -> Option<Self> {
    match p.extension()?.to_str()?.to_lowercase().as_str() {
      "png" => Some(ImageFormat::Png),
      "jpg" | "jpeg" => Some(ImageFormat::Jpeg),
      _ => None,
    }
  }
}

/// Seek target so ffmpeg returns the frame a player shows at `time_ms`: ffmpeg
/// gives the first frame at or after the seek point, a player shows the last
/// frame at or before the current time.
pub fn display_seek_ms(time_ms: f64, frame_ms: f64) -> f64 {
  if frame_ms > 0.0 {
    (time_ms - frame_ms + 0.1).max(0.0)
  } else {
    time_ms.max(0.0)
  }
}

/// Input seek this far before the target, then decode-and-discard the rest: an
/// input seek alone can land on an open-GOP keyframe whose leading B-frames
/// (shown before it) cannot be decoded, returning a later frame.
pub const PRE_SEEK_MS: f64 = 2000.0;

pub fn extract_args(path: &Path, seek_ms: f64, format: ImageFormat, max_width: Option<u32>) -> Vec<OsString> {
  let pre = (seek_ms - PRE_SEEK_MS).max(0.0);
  let (ss_in, ss_out) = (secs(pre), secs(seek_ms.max(0.0) - pre));
  let mut a = [
    args(["-nostdin", "-v", "error", "-protocol_whitelist", "file", "-ss", ss_in.as_str(), "-i"]),
    vec![input_arg(path)],
    args(["-ss", ss_out.as_str(), "-map", "0:v:0", "-frames:v", "1"]),
  ]
  .concat();
  if let Some(w) = max_width {
    a.extend(args(["-vf".to_string(), format!("scale='min({w},iw)':-2")]));
  }
  a.extend(match format {
    ImageFormat::Png => args(["-c:v", "png"]),
    ImageFormat::Jpeg => args(["-c:v", "mjpeg", "-q:v", "2"]),
  });
  a.extend(args(["-f", "image2pipe", "pipe:1"]));
  a
}

pub fn extract_frame(cache: &Cache, job: &Job, path: &Path, time_ms: f64, format: ImageFormat, max_width: Option<u32>) -> Result<Vec<u8>> {
  let p = probe(cache, job, path)?;
  let Some(v) = &p.video else {
    return Err(Error::new("no_video", format!("{}: no video stream", path.display())));
  };
  // VFR: the average frame length says nothing about where frames are; use the real table (cached).
  let seek = if v.is_vfr { table_seek_ms(&frame_times(cache, job, path, &|_| {})?, time_ms) } else { display_seek_ms(time_ms, v.frame_ms) };
  let bytes = ffmpeg::output(job, Tool::Ffmpeg, &extract_args(path, seek, format, max_width))?;
  if bytes.is_empty() {
    return Err(Error::new("no_frame", format!("{}: no frame at {time_ms} ms", path.display())));
  }
  Ok(bytes)
}

/// A small JPEG of a still image (long side <= max) at `dest`, made once (an existing file is kept). ffmpeg does the
/// decode: the webview never decodes the full-size picture for a thumbnail.
pub fn image_thumb(job: &Job, src: &Path, dest: &Path, max: u32) -> Result<()> {
  if dest.is_file() {
    return Ok(());
  }
  let max = max.clamp(32, 1024);
  let vf = format!("scale=w='if(gt(iw,ih),min({max},iw),-2)':h='if(gt(iw,ih),-2,min({max},ih))'");
  let a = [
    args(["-nostdin", "-v", "error", "-protocol_whitelist", "file", "-i"]),
    vec![input_arg(src)],
    args(["-frames:v", "1", "-vf", vf.as_str(), "-c:v", "mjpeg", "-q:v", "5", "-f", "image2pipe", "pipe:1"]),
  ]
  .concat();
  let bytes = ffmpeg::output(job, Tool::Ffmpeg, &a)?;
  if bytes.is_empty() {
    return Err(Error::new("no_frame", format!("{}: no picture", src.display())));
  }
  if let Some(d) = dest.parent() {
    fs::create_dir_all(d).at(d)?;
  }
  write_atomic(dest, &bytes).map(|_| ())
}

// ---------------------------------------------------------------- proxy

/// paw-mh1a: threads a proxy transcode may use (decoder, filters and x264 each): half the logical cores, 2 ..= 8, so it runs
/// beside playback, tracking and the owner's other work (x264 at proxy sizes gains little past 8). Uncapped it took them all.
pub fn proxy_threads() -> usize {
  std::thread::available_parallelism().map_or(4, |n| n.get() / 2).clamp(2, 8)
}

pub fn proxy_args(path: &Path, height: u32, out: &Path) -> Vec<OsString> {
  let t = proxy_threads().to_string();
  // paw-ef73.15: the first frame at 0 (setpts) and no B-frames. A source whose first video timestamp is not 0 (an AVI
  // with B-frames reads one frame late in ffmpeg) made a proxy the <video> shows one frame late, while the app's clock
  // and the scrubber (frames from 0) did not: a scrub showed frame N, the real seek when it stopped N - 1.
  let vf = format!("scale=-2:'min({height},trunc(ih/2)*2)',setpts=PTS-STARTPTS");
  [
    args(["-nostdin", "-v", "error", "-progress", "pipe:2", "-nostats", "-filter_threads", t.as_str(), "-protocol_whitelist", "file", "-threads", t.as_str(), "-i"]),
    vec![input_arg(path)],
    args([
      "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn", "-vf", vf.as_str(),
      // Keep every source timestamp: the script's timing must match the proxy exactly.
      "-fps_mode", "passthrough", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-g", "30", "-bf", "0", "-threads", t.as_str(), "-c:a", "aac", "-b:a", "128k",
      "-ac", "2", "-movflags", "+faststart", "-y",
    ]),
    vec![out.into()],
  ]
  .concat()
}

pub fn proxy(cache: &Cache, job: &Job, path: &Path, height: Option<u32>, emit: &(dyn Fn(Event) + Sync)) -> Result<String> {
  let height = even(height.unwrap_or(720).clamp(144, 2160) as f64);
  let key = Cache::key(path, "proxy", &format!("v2 h={height}"))?;   // v2 (paw-ef73.15): proxies made before start at 0, no B-frames
  if let Some(dir) = cache.get(&key) {
    let f = dir.join("proxy.mp4");
    if f.is_file() {
      return Ok(path_str(&f));
    }
  }
  let p = probe(cache, job, path)?;
  if p.video.is_none() {
    return Err(Error::new("no_video", format!("{}: no video stream", path.display())));
  }
  let building = cache.begin(&key)?;
  let out = building.dir.join("proxy.mp4");
  job.below_normal();   // paw-mh1a: a background transcode: below-normal priority on Windows
  let dur = (p.duration_ms / 1000.0).max(0.001);
  let th = std::sync::Mutex::new(Throttle::new());
  ffmpeg::run(job, Tool::Ffmpeg, &proxy_args(path, height, &out), |_| Ok(()), |t| th.lock().unwrap().emit(emit, "proxy", t / dur))?;
  let dir = building.finish()?;
  th.lock().unwrap().emit(emit, "proxy", 1.0);
  Ok(path_str(&dir.join("proxy.mp4")))
}

// ---------------------------------------------------------------- remux (the webview's frame reader)

/// paw-b88b: codecs (ffprobe `codec_name`) that ffmpeg's MP4 muxer holds AND the webview's WebCodecs decodes: these are
/// stream-copied. Anything else (VP8, Theora, MPEG-2, MPEG-4 part 2, ProRes, DNxHD, MJPEG, ...) is transcoded to H.264.
pub fn remux_copies(codec: &str) -> bool {
  matches!(codec, "h264" | "hevc" | "vp9" | "av1")
}

/// Stream copy of the first video track into an MP4 (no re-encode), for the webview's WebCodecs scrubber.
pub fn remux_args(path: &Path, out: &Path) -> Vec<OsString> {
  [
    args(["-nostdin", "-v", "error", "-progress", "pipe:2", "-nostats", "-protocol_whitelist", "file", "-i"]),
    vec![input_arg(path)],
    args(["-map", "0:v:0", "-an", "-sn", "-dn", "-c", "copy", "-movflags", "+faststart", "-y"]),
    vec![out.into()],
  ]
  .concat()
}

/// paw-b88b: the first video track as H.264 the frame reader decodes: every frame at its source time (`-fps_mode
/// passthrough`, no setpts: the reader counts from the first frame, as with a copy), 8-bit 4:2:0, at most 2160 lines,
/// 1 s keyframes, no B-frames, x264 veryfast CRF 18. Threads capped like the proxy (`proxy_threads`).
pub fn remux_h264_args(path: &Path, out: &Path) -> Vec<OsString> {
  let t = proxy_threads().to_string();
  [
    args(["-nostdin", "-v", "error", "-progress", "pipe:2", "-nostats", "-filter_threads", t.as_str(), "-protocol_whitelist", "file", "-threads", t.as_str(), "-i"]),
    vec![input_arg(path)],
    args([
      "-map", "0:v:0", "-an", "-sn", "-dn", "-vf", "scale=-2:'min(2160,trunc(ih/2)*2)'", "-fps_mode", "passthrough",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-g", "30", "-bf", "0", "-threads", t.as_str(), "-movflags", "+faststart", "-y",
    ]),
    vec![out.into()],
  ]
  .concat()
}

/// An MP4 of the first video track the webview's frame reader can read (path in the cache). A codec MP4 holds and WebCodecs
/// decodes (`remux_copies`) is stream-copied (key `remux v1`); any other codec, a copy ffmpeg refuses, or `h264` (the front end
/// found the copy undecodable: 10-bit H.264, HEVC without a system decoder) is transcoded (`remux v1 h264`: below-normal
/// priority, cancellable). Same frames and times either way.
pub fn remux(cache: &Cache, job: &Job, path: &Path, h264: bool, emit: &(dyn Fn(Event) + Sync)) -> Result<String> {
  let p = probe(cache, job, path)?;
  let Some(v) = &p.video else {
    return Err(Error::new("no_video", format!("{}: no video stream", path.display())));
  };
  if !h264 && remux_copies(&v.codec) {
    match remux_with(cache, job, path, p.duration_ms, false, emit) {
      Err(e) if e.code == "ffmpeg_failed" => {} // a stream MP4 refuses after all (odd tags): transcoded below
      r => return r,
    }
  }
  remux_with(cache, job, path, p.duration_ms, true, emit)
}

fn remux_with(cache: &Cache, job: &Job, path: &Path, duration_ms: f64, h264: bool, emit: &(dyn Fn(Event) + Sync)) -> Result<String> {
  let key = Cache::key(path, "remux", if h264 { "v1 h264" } else { "v1" })?;
  if let Some(dir) = cache.get(&key) {
    let f = dir.join("remux.mp4");
    if f.is_file() {
      return Ok(path_str(&f));
    }
  }
  let building = cache.begin(&key)?;
  let out = building.dir.join("remux.mp4");
  let a = if h264 {
    job.below_normal(); // a background transcode, as the proxy
    remux_h264_args(path, &out)
  } else {
    remux_args(path, &out)
  };
  let dur = (duration_ms / 1000.0).max(0.001);
  let th = std::sync::Mutex::new(Throttle::new());
  ffmpeg::run(job, Tool::Ffmpeg, &a, |_| Ok(()), |t| th.lock().unwrap().emit(emit, "remux", t / dur))?;
  let dir = building.finish()?;
  th.lock().unwrap().emit(emit, "remux", 1.0);
  Ok(path_str(&dir.join("remux.mp4")))
}

// ---------------------------------------------------------------- scrub cache (all-intra copy)

/// All-intra H.264 copy of the first video track (every frame a keyframe, so a hover-scrub jump decodes one
/// frame): source timestamps (`-fps_mode passthrough`), source size capped at 2160 lines, no audio. 4:2:0
/// 8-bit always (10-bit / 4:2:2 sources are converted: Chromium's software H.264 decoder takes nothing else;
/// colour tags are carried over, HDR is not tone-mapped). x264 CRF 18 fastdecode (`-g 1`), or NVENC constant
/// QP 19 (`-g 0` is ffmpeg's NVENC intra-only: the driver refuses `-g 1 -bf 0`).
pub fn scrub_args(path: &Path, out: &Path, nvenc: bool, height: u32) -> Vec<OsString> {
  let vf = format!("scale=-2:'min({height},trunc(ih/2)*2)'");
  let enc: &[&str] = if nvenc {
    &["-c:v", "h264_nvenc", "-preset", "p4", "-tune", "hq", "-rc", "constqp", "-qp", "19"]
  } else {
    &["-c:v", "libx264", "-preset", "faster", "-crf", "18", "-tune", "fastdecode"]
  };
  [
    args(["-nostdin", "-v", "error", "-progress", "pipe:2", "-nostats", "-protocol_whitelist", "file", "-i"]),
    vec![input_arg(path)],
    args(["-map", "0:v:0", "-an", "-sn", "-dn", "-vf", vf.as_str(), "-fps_mode", "passthrough"]),
    args(enc.iter().copied()),
    args(["-g", if nvenc { "0" } else { "1" }, "-bf", "0", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y"]),
    vec![out.into()],
  ]
  .concat()
}

/// Encoders to try, in order (false = libx264, true = h264_nvenc), from `ffmpeg -encoders` (asked once). x264
/// first: on a 32-thread desktop it was faster than NVENC and its files 2.5x smaller (README, Scrub cache).
/// Listed is not working (full builds list NVENC on any machine): a failure falls through to the next.
fn scrub_encoders() -> &'static [bool] {
  static L: std::sync::OnceLock<Vec<bool>> = std::sync::OnceLock::new();
  L.get_or_init(|| {
    let o = ffmpeg::output(&Job::default(), Tool::Ffmpeg, &args(["-hide_banner", "-encoders"])).unwrap_or_default();
    let o = String::from_utf8_lossy(&o);
    [("libx264", false), ("h264_nvenc", true)].into_iter().filter(|(n, _)| o.contains(n)).map(|(_, nv)| nv).collect()
  })
}

/// paw-mh1a: the heights a scrub cache steps down to when the full-size copy alone would pass the cache limit.
pub fn scrub_heights(src_h: u32) -> Vec<u32> {
  [1080, 720, 540, 360, 240, 144].into_iter().filter(|&h| h < src_h.min(2160)).collect()
}
/// The tallest of `heights` (tallest first) whose copy, scaled from `est_full` bytes at `src_h` by pixel count, fits in 80 %
/// of `limit`; else the smallest; None when there is nothing to step down to.
pub fn scrub_fit(est_full: f64, src_h: u32, limit: u64, heights: &[u32]) -> Option<u32> {
  let f = |h: u32| est_full * (h as f64 / src_h.max(1) as f64).powi(2);
  heights.iter().copied().find(|&h| f(h) <= 0.8 * limit as f64).or(heights.last().copied())
}
/// The next height after a copy encoded at `h` (None: the full copy, at most 2160 lines) of a `src_h`-line source headed
/// for `est` bytes passed the limit. paw-b4tt: `est` was measured at the height just encoded, so it is scaled from there.
pub fn scrub_next(est: f64, h: Option<u32>, src_h: u32, limit: u64) -> Option<u32> {
  let encoded = h.unwrap_or(src_h.min(2160));
  let below: Vec<u32> = scrub_heights(src_h).into_iter().filter(|&x| x < encoded).collect();
  scrub_fit(est, encoded, limit, &below)
}
fn scrub_name(h: Option<u32>) -> String {
  h.map_or("scrub.mp4".into(), |h| format!("scrub-{h}.mp4"))
}

/// The cached all-intra copy (path of `scrub.mp4`, or `scrub-<height>.mp4` for a smaller one). paw-mh1a: when the full
/// size alone would pass the cache limit, the copy is made smaller (`scrub_heights`, sized from how fast the full one grew)
/// instead of refused, so the open video always has one; the front end reads the height from the name. Errors:
/// `too_large` only when even 144 lines would not fit, `no_video`, `ffmpeg_failed`, `cancelled`.
pub fn scrub_cache(cache: &Cache, job: &Job, path: &Path, emit: &(dyn Fn(Event) + Sync)) -> Result<String> {
  let key_of = |h: Option<u32>| Cache::key(path, "scrub", &h.map_or("v1".into(), |h| format!("v1 h={h}")));
  let hit = |h: Option<u32>| -> Result<Option<String>> {
    let f = cache.get(&key_of(h)?).map(|d| d.join(scrub_name(h)));
    Ok(f.filter(|f| f.is_file()).map(|f| path_str(&f)))
  };
  if let Some(f) = hit(None)? {
    return Ok(f);
  }
  let p = probe(cache, job, path)?;
  let Some(v) = &p.video else {
    return Err(Error::new("no_video", format!("{}: no video stream", path.display())));
  };
  let ladder = scrub_heights(v.height);
  for &h in &ladder {
    if let Some(f) = hit(Some(h))? {
      return Ok(f); // made smaller before: it stays that size
    }
  }
  let dur = (p.duration_ms / 1000.0).max(0.001);
  let mut h: Option<u32> = None;
  loop {
    let building = cache.begin(&key_of(h)?)?;
    let out = building.dir.join(scrub_name(h));
    let over = AtomicBool::new(false);
    let reached = std::sync::Mutex::new(0.0f64); // the fraction done when it passed the limit
    let size = || fs::metadata(&out).map_or(0, |m| m.len());
    let encode = |nvenc: bool| {
      let th = std::sync::Mutex::new(Throttle::new());
      ffmpeg::run(job, Tool::Ffmpeg, &scrub_args(path, &out, nvenc, h.unwrap_or(2160)), |_| Ok(()), |t| {
        th.lock().unwrap().emit(emit, "scrub", t / dur);
        if size() > cache.limit && !over.swap(true, Ordering::SeqCst) {
          *reached.lock().unwrap() = (t / dur).clamp(0.01, 1.0);
          job.stop_children(); // never let it fill the disk past the limit (the job goes on: a smaller copy)
        }
      })
    };
    let mut r = Err(Error::new("ffmpeg_failed", "this ffmpeg has neither libx264 nor h264_nvenc"));
    for &nvenc in scrub_encoders() {
      r = encode(nvenc); // NVENC fails fast without an NVIDIA GPU / driver, or over 4096 px wide
      if over.load(Ordering::SeqCst) || !r.as_ref().is_err_and(|e| e.code == "ffmpeg_failed") {
        break;
      }
    }
    job.check()?;
    if over.load(Ordering::SeqCst) || size() > cache.limit {
      let done = if over.load(Ordering::SeqCst) { (*reached.lock().unwrap()).max(0.01) } else { 1.0 }; // stopped part-way, or it finished too big
      let est = size().max(cache.limit) as f64 / done;
      drop(building); // the folder goes
      match scrub_next(est, h, v.height, cache.limit) {
        Some(next) => {
          h = Some(next);
          continue;
        }
        None => {
          return Err(Error::new(
            "too_large",
            format!("{}: even the smallest scrub cache would exceed the cache limit ({:.1} GB)", path.display(), cache.limit as f64 / (1u64 << 30) as f64),
          ))
        }
      }
    }
    r?;
    let dir = building.finish()?;
    emit(Event::Progress { stage: "scrub", fraction: 1.0 });
    return Ok(path_str(&dir.join(scrub_name(h))));
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  /// paw-mh1a: the steps below the source, and the step a too-big copy lands on.
  #[test]
  fn scrub_cache_steps_down_to_fit() {
    assert_eq!(scrub_heights(2160), [1080, 720, 540, 360, 240, 144]);
    assert_eq!(scrub_heights(1080), [720, 540, 360, 240, 144]);
    assert_eq!(scrub_heights(4320), [1080, 720, 540, 360, 240, 144]); // the full copy is 2160 at most
    assert_eq!(scrub_heights(360), [240, 144]);
    assert!(scrub_heights(144).is_empty());
    let gib = 1u64 << 30;
    // a 1080p copy heading for 6 GiB under a 2 GiB limit: 720 is ~2.7 GiB, 540 ~1.5 GiB (<= 80 % of 2 GiB)
    assert_eq!(scrub_fit(6.0 * gib as f64, 1080, 2 * gib, &scrub_heights(1080)), Some(540));
    assert_eq!(scrub_fit(2.2 * gib as f64, 1080, 2 * gib, &scrub_heights(1080)), Some(720));
    assert_eq!(scrub_fit(1e15, 1080, 2 * gib, &scrub_heights(1080)), Some(144)); // nothing fits: the smallest
    assert_eq!(scrub_fit(1e15, 144, 2 * gib, &scrub_heights(144)), None);
    assert_eq!((scrub_name(None), scrub_name(Some(720))), ("scrub.mp4".to_string(), "scrub-720.mp4".to_string()));
    // paw-b4tt: a 4320-line source's full copy is encoded at 2160; heading for 8 GiB there, 1080 would be 2 GiB (too big)
    // and 720 fits (scaled from 4320 instead, 1080 looked like 0.5 GiB: one more over-limit encode)
    assert_eq!(scrub_next(8.0 * gib as f64, None, 4320, 2 * gib), Some(720));
    // a 720 copy that still headed for 3 GiB: 540 would be 1.7 GiB, 360 fits (not 540, scaled from the source)
    assert_eq!(scrub_next(3.0 * gib as f64, Some(720), 4320, 2 * gib), Some(360));
    assert_eq!(scrub_next(6.0 * gib as f64, None, 1080, 2 * gib), Some(540)); // a source under 2160: as before
    assert_eq!(scrub_next(1e15, Some(144), 1080, 2 * gib), None);
  }

  #[test]
  fn scrub_args_are_all_intra_both_encoders() {
    let s = |nvenc| scrub_args(Path::new("x.mkv"), Path::new("o.mp4"), nvenc, 2160).iter().map(|s| s.to_string_lossy().into_owned()).collect::<Vec<String>>();
    for (a, nvenc) in [(s(true), true), (s(false), false)] {
      let has = |w: [&str; 2]| a.windows(2).any(|x| x == w);
      assert!(has(["-g", if nvenc { "0" } else { "1" }]) && has(["-bf", "0"]) && has(["-pix_fmt", "yuv420p"]) && has(["-fps_mode", "passthrough"]));
      assert!(has(["-map", "0:v:0"]) && a.contains(&"-an".to_string()) && has(["-movflags", "+faststart"]) && a.last().unwrap() == "o.mp4");
      assert!(a.contains(&"scale=-2:'min(2160,trunc(ih/2)*2)'".to_string()));
      assert!(scrub_args(Path::new("x.mkv"), Path::new("o.mp4"), nvenc, 720).iter().any(|x| x == "scale=-2:'min(720,trunc(ih/2)*2)'"));
      if nvenc {
        assert!(has(["-c:v", "h264_nvenc"]) && has(["-rc", "constqp"]) && has(["-qp", "19"]) && !a.contains(&"libx264".to_string()));
      } else {
        assert!(has(["-c:v", "libx264"]) && has(["-crf", "18"]) && has(["-tune", "fastdecode"]) && !a.contains(&"h264_nvenc".to_string()));
      }
    }
  }

  #[test]
  fn probe_parsing_mp4_rotated_vfr() {
    let j = json!({
      "streams": [
        {"codec_type": "video", "codec_name": "h264", "profile": "High", "pix_fmt": "yuv420p", "width": 1920, "height": 1080,
         "avg_frame_rate": "30000/1001", "r_frame_rate": "60/1", "nb_frames": "17982", "duration": "600.0",
         "side_data_list": [{"side_data_type": "Display Matrix", "rotation": -90}]},
        {"codec_type": "audio", "codec_name": "aac", "sample_rate": "48000", "channels": 2, "duration": "600.02"}
      ],
      "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "600.020000", "size": "123456", "start_time": "0.000000", "bit_rate": "5000000"}
    });
    let p = parse_probe(Path::new("v.mp4"), &j).unwrap();
    let v = p.video.unwrap();
    assert_eq!((v.rotation, v.display_width, v.display_height), (90, 1080, 1920));
    assert!((v.fps - 29.97).abs() < 0.01 && v.is_vfr);
    assert_eq!((v.frame_count, v.frame_count_exact), (17982, true));
    assert!((p.duration_ms - 600020.0).abs() < 1e-6);
    assert!(p.has_audio && p.webview_playable);
    assert_eq!(p.audio.unwrap().sample_rate, 48000);
  }

  #[test]
  fn probe_parsing_mkv_estimates_frames_and_skips_cover_art() {
    let j = json!({
      "streams": [
        {"codec_type": "video", "codec_name": "mjpeg", "width": 300, "height": 300, "disposition": {"attached_pic": 1}},
        {"codec_type": "video", "codec_name": "hevc", "width": 720, "height": 480, "sample_aspect_ratio": "32:27",
         "avg_frame_rate": "25/1", "r_frame_rate": "25/1", "tags": {"DURATION": "00:01:00.000000000", "rotate": "180"}}
      ],
      "format": {"format_name": "matroska,webm", "duration": "60.0"}
    });
    let p = parse_probe(Path::new("v.mkv"), &j).unwrap();
    let v = p.video.unwrap();
    assert_eq!(v.codec, "hevc");
    assert_eq!((v.frame_count, v.frame_count_exact, v.is_vfr), (1500, false, false));
    assert_eq!((v.display_width, v.display_height, v.rotation), (853, 480, 180));
    assert!(!p.has_audio && !p.webview_playable);
    assert_eq!(parse_probe(Path::new("x"), &json!({"streams": [], "format": {}})).unwrap_err().code, "no_media");
  }

  #[test]
  fn peaks_buckets_and_pyramid() {
    let mut a = Accum::new(4);
    let samples: Vec<i16> = vec![1, -2, 3, -4, 100, -100, 0, 0, 7, 7];
    samples.iter().for_each(|s| a.push(*s));
    let (base, total) = a.finish();
    assert_eq!(total, 10);
    assert_eq!(base.buckets(), 3); // 4 + 4 + 2
    assert_eq!(&base.data[0..2], &[-4, 3]);
    assert_eq!(base.data[2], ((1.0f64 + 4.0 + 9.0 + 16.0) / 4.0).sqrt().round() as i16);
    assert_eq!(&base.data[6..9], &[7, 7, 7]);
    let lv = pyramid(base.clone(), total, 1);
    assert_eq!(lv.iter().map(|l| (l.spb, l.buckets())).collect::<Vec<_>>(), vec![(4, 3), (8, 2), (16, 1)]);
    let top = &lv[2].data;
    assert_eq!(&top[0..2], &[-100, 100]);
    // RMS of all ten samples, from bucket RMS weighted by length (rounding of the i16 parts aside).
    let exact = (samples.iter().map(|s| (*s as f64).powi(2)).sum::<f64>() / 10.0).sqrt();
    assert!((top[2] as f64 - exact).abs() <= 1.0, "{} vs {exact}", top[2]);
  }

  #[test]
  fn peaks_encoding_layout() {
    let lv = vec![Level { spb: 8, data: vec![-1, 2, 1, -3, 4, 2] }, Level { spb: 16, data: vec![-3, 4, 2] }];
    let b = encode_peaks(8000, 15, &lv);
    assert_eq!(&b[0..4], b"PWPK");
    assert_eq!(u32::from_le_bytes(b[4..8].try_into().unwrap()), 1);
    assert_eq!(u32::from_le_bytes(b[8..12].try_into().unwrap()), 8000);
    assert_eq!(u32::from_le_bytes(b[12..16].try_into().unwrap()), 2);
    assert_eq!(u64::from_le_bytes(b[16..24].try_into().unwrap()), 15);
    assert_eq!(u32::from_le_bytes(b[24..28].try_into().unwrap()), 8);
    assert_eq!(u32::from_le_bytes(b[28..32].try_into().unwrap()), 2);
    assert_eq!(b.len(), 24 + 16 + 9 * 2);
    assert_eq!(i16::from_le_bytes(b[40..42].try_into().unwrap()), -1);
    assert_eq!(spb_for(8.0), 64);
    assert_eq!(spb_for(f64::NAN), 64);
    assert_eq!(spb_for(0.0), 4);
  }

  #[test]
  fn strip_layout() {
    let s = plan_strip(600_000.0, 1920, 1080, None, None);
    assert_eq!((s.tile_w, s.tile_h, s.columns, s.rows), (160, 90, 10, 10));
    assert_eq!(s.levels.len(), 2);
    assert_eq!((s.levels[0].count, s.levels[1].count), (COARSE, 300));
    assert_eq!(s.levels[1].times_ms[0], 1000.0);
    assert_eq!(*s.levels[1].times_ms.last().unwrap(), 599_000.0);
    assert_eq!(s.cell(0), (0, 0, 0));
    assert_eq!(s.cell(11), (0, 160, 90));
    assert_eq!(s.cell(105), (1, 800, 0));
    let short = plan_strip(5_000.0, 1080, 1920, Some(91), None);
    assert_eq!((short.tile_w, short.tile_h), (52, 92)); // portrait, even sizes
    assert_eq!(short.levels.len(), 1);
    assert_eq!(short.levels[0].count, 10);
    assert_eq!((short.columns, short.rows), (10, 1));
    let big = plan_strip(10_000.0, 1920, 1080, Some(720), Some(4));
    assert_eq!((big.tile_w, big.columns, big.rows), (1280, 3, 2)); // under 4096 px, 2 rows hold 4
    assert_eq!(big.levels[0].count, 4);
  }

  #[test]
  fn argument_construction() {
    let a: Vec<String> = frame_args(Path::new("/v/a b.mp4"), 1500.0, 160, 90, Path::new("/c/f.jpg")).iter().map(|s| s.to_string_lossy().into_owned()).collect();
    let ss = a.iter().position(|x| x == "-ss").unwrap();
    let i = a.iter().position(|x| x == "-i").unwrap();
    assert!(ss < i, "input seek (accurate, fast) must come before -i");
    assert_eq!(a[ss + 1], "1.500000");
    assert!(a[i + 1].starts_with("file:") && a[i + 1].ends_with("a b.mp4"));
    assert!(a.contains(&"scale=160:90:flags=bilinear,setsar=1".to_string()));
    let w: Vec<String> = waveform_args(Path::new("x.mp4")).iter().map(|s| s.to_string_lossy().into_owned()).collect();
    assert!(w.windows(2).any(|p| p == ["-ar", "8000"]) && w.windows(2).any(|p| p == ["-f", "s16le"]) && w.last().unwrap() == "pipe:1");
    assert!(w.windows(2).any(|p| p == ["-protocol_whitelist", "file"]));
    let s: Vec<String> = sheet_args(Path::new("/c/100%"), 1, 200, 10, 10, Path::new("/c/s.jpg")).iter().map(|s| s.to_string_lossy().into_owned()).collect();
    assert!(s.contains(&"200".to_string()) && s.contains(&"tile=10x10".to_string()));
    assert!(s.iter().any(|x| x.contains("100%%") && x.ends_with("f1-%05d.jpg")));
    let e: Vec<String> = extract_args(Path::new("x.mp4"), 0.0, ImageFormat::Jpeg, Some(640)).iter().map(|s| s.to_string_lossy().into_owned()).collect();
    assert!(e.contains(&"scale='min(640,iw)':-2".to_string()) && e.contains(&"mjpeg".to_string()));
    let e: Vec<String> = extract_args(Path::new("x.mp4"), 5500.0, ImageFormat::Png, None).iter().map(|s| s.to_string_lossy().into_owned()).collect();
    let ss: Vec<&String> = e.iter().enumerate().filter(|(_, x)| *x == "-ss").map(|(i, _)| &e[i + 1]).collect();
    assert_eq!(ss, vec!["3.500000", "2.000000"]); // input seek 2 s early, then exact decode-and-discard
    let p: Vec<String> = proxy_args(Path::new("x.mkv"), 720, Path::new("o.mp4")).iter().map(|s| s.to_string_lossy().into_owned()).collect();
    assert!(p.windows(2).any(|w| w == ["-fps_mode", "passthrough"]) && p.contains(&"0:a:0?".to_string()));
    assert!(p.windows(2).any(|w| w == ["-bf", "0"]) && p.iter().any(|x| x.ends_with(",setpts=PTS-STARTPTS")), "proxy: frame 0 at 0, no B-frames");
    // paw-mh1a: decoder, filters and x264 capped to proxy_threads() (half the cores, 2..=8), decoder threads before the input
    let t = proxy_threads();
    assert!((2..=8).contains(&t));
    let at = |k: &str| p.iter().enumerate().filter(|(_, x)| *x == k).map(|(i, _)| (i, p[i + 1].clone())).collect::<Vec<_>>();
    let (th, ft, input) = (at("-threads"), at("-filter_threads"), p.iter().position(|x| x == "-i").unwrap());
    assert_eq!(th.len(), 2, "decoder and encoder threads");
    assert!(th[0].0 < input && th[1].0 > input && th.iter().chain(&ft).all(|(_, v)| *v == t.to_string()), "{p:?}");
    assert!(ft.len() == 1 && ft[0].0 < input);
    let r: Vec<String> = remux_args(Path::new("x.webm"), Path::new("o.mp4")).iter().map(|s| s.to_string_lossy().into_owned()).collect();
    assert!(r.windows(2).any(|w| w == ["-c", "copy"]) && r.windows(2).any(|w| w == ["-movflags", "+faststart"]) && r.last().unwrap() == "o.mp4");
    // paw-b88b: copied only when MP4 holds it and WebCodecs decodes it; else H.264 at the source's times, capped like the proxy
    for c in ["h264", "hevc", "vp9", "av1"] {
      assert!(remux_copies(c), "{c}");
    }
    for c in ["vp8", "theora", "mpeg2video", "mpeg4", "prores", "dnxhd", "mjpeg", "wmv3", "msmpeg4v3", ""] {
      assert!(!remux_copies(c), "{c}");
    }
    let h: Vec<String> = remux_h264_args(Path::new("x.webm"), Path::new("o.mp4")).iter().map(|s| s.to_string_lossy().into_owned()).collect();
    let has = |w: [&str; 2]| h.windows(2).any(|x| x == w);
    assert!(has(["-c:v", "libx264"]) && has(["-fps_mode", "passthrough"]) && has(["-pix_fmt", "yuv420p"]) && has(["-bf", "0"]) && has(["-map", "0:v:0"]), "{h:?}");
    assert!(!h.iter().any(|x| x.contains("setpts")) && h.contains(&"-an".to_string()) && h.last().unwrap() == "o.mp4", "source times kept, no audio");
    let (th, input) = (h.iter().enumerate().filter(|(_, x)| *x == "-threads").map(|(i, _)| (i, h[i + 1].clone())).collect::<Vec<_>>(), h.iter().position(|x| x == "-i").unwrap());
    assert!(th.len() == 2 && th[0].0 < input && th.iter().all(|(_, v)| *v == t.to_string()) && has(["-filter_threads", t.to_string().as_str()]), "{h:?}");
  }

  #[test]
  fn frame_time_parsing() {
    assert_eq!(packet_ms("1.033333,K__"), Some(1033.333));
    assert_eq!(packet_ms("0.000000,__D"), None); // discarded (edit-list priming)
    assert_eq!(packet_ms("N/A,K__"), None);
    assert_eq!(packet_ms("2.5"), Some(2500.0));
    // decode order with B-frames -> presentation order; a duplicate dropped; start shifted to 0
    assert_eq!(finish_times(vec![1100.0, 1300.0, 1200.0, 1200.0, 1400.0], 1100.0), vec![0.0, 100.0, 200.0, 300.0]);
    let t = [0.0, 100.0, 200.0, 1000.0, 1100.0];
    assert_eq!(table_seek_ms(&t, 0.0), 0.0);
    assert_eq!(table_seek_ms(&t, 150.0), 50.0); // shows frame 1 (100): seek between 0 and 100
    assert_eq!(table_seek_ms(&t, 999.0), 150.0); // gap: still frame 2 (200)
    assert_eq!(table_seek_ms(&t, 1000.0), 600.0); // exactly on frame 3
    let a: Vec<String> = frame_times_args(Path::new("v.mkv"), 2).iter().map(|s| s.to_string_lossy().into_owned()).collect();
    assert!(a.windows(2).any(|w| w == ["-select_streams", "2"]) && a.contains(&"packet=pts_time,flags".to_string()));
  }

  #[test]
  fn display_seek() {
    let f = 1000.0 / 30.0;
    assert_eq!(display_seek_ms(0.0, f), 0.0);
    // exactly on frame 3 (100 ms) -> seek just after frame 2 -> ffmpeg returns frame 3
    let s = display_seek_ms(100.0, f);
    assert!(s > 2.0 * f && s <= 100.0);
    // between frames 3 and 4 -> still frame 3
    let s = display_seek_ms(120.0, f);
    assert!(s > 2.0 * f && s <= 100.0);
  }
}
