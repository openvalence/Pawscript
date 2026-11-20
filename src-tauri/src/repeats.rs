//! Repeated frames (paw-6dno): pictures that occur more than once in a video, exactly (to codec noise), with no
//! transform. Animation reuses drawings (loops), so one picture can come back many times.
//!
//! One ffmpeg pass decodes every frame to 160 px grey (`WIDTH` x a height rounded to whole `TILE`s). Per frame:
//!  - near-uniform (grey std < `MIN_STD`: black, white, a flat colour) frames are skipped and end the current run;
//!  - a frame equal to the first frame of the current run (held frames: animation on twos) extends the run, so a run of
//!    held frames is ONE occurrence;
//!  - otherwise it starts a new occurrence, matched against every earlier distinct picture (a "rep"): candidates by
//!    their 5 px tile means (the thumbnail; its quadrant means index them), each verified on the full 160 px frame.
//! Equal = the worst 5x5 tile's mean |difference| <= `EXACT`: the worst tile, not the mean, so a different stroke
//! phase over the same background never matches. The tile means are a lossless prefilter: |mean of a diff| <= mean of
//! |diff|, so a pair that verifies always passes the thumbnail and quadrant tests.
//! A bucket is a rep with two or more occurrences; buckets are numbered in order of their first occurrence (stable for a
//! given file and `EXACT`). Rep frames are kept in a scratch file in the cache entry while building, not in memory.
//! The same decode feeds transitions.rs (fades and dissolves, paw-ef73.3): `Repeats.transitions`.

use crate::cache::Cache;
use crate::error::{At, Error, Result};
use crate::ffmpeg::{self, args, input_arg, Job, Tool};
use crate::files::write_atomic;
use crate::media::{self, Event, Throttle};
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::Path;

pub const WIDTH: usize = 160;
pub const TILE: usize = 5;
/// Worst 5 px tile's mean |difference| (grey levels at 160 px) two frames may have and still be one picture: the one
/// tunable. Calibrated on 22 of the owner's videos (2026-11-11) against the native-resolution frames (worst 32 px tile) of every
/// bucket's first two occurrences (1773 pairs found with 10 px tiles <= 3, which let through 3 with a small local
/// difference, 1-3 px at 160 px, native > 20): 5 px tiles <= 4 keep 1620, none with a native difference > 15 (5 at
/// 10-15, codec noise in low-bitrate files), and drop 9 clean repeats (native <= 6); <= 3 drops 25, <= 2 (the probe
/// paw-x85h's rule: precision 0.98 / recall 0.88 against a 640 px check) 72, mostly real repeats of low-bitrate 2D loops
/// (codec noise along the line art). Held frames next to each other measure < 0.5; a different stroke phase 6 and up.
pub const EXACT: f32 = 4.0;
/// Grey standard deviation below which a frame is near-uniform and never matched.
pub const MIN_STD: f32 = 6.0;
/// Decoder threads (the pass runs beside playback and tracking).
const THREADS: &str = "4";

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Occurrence {
  /// First and last frame (inclusive) of the run of held frames showing the picture.
  pub f0: usize,
  pub f1: usize,
  /// Presentation time of `f0`, ms (file start = 0).
  pub t_ms: f64,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Repeats {
  /// Frames decoded.
  pub frames: usize,
  pub exact: f32,
  /// Bucket id = index; each bucket's occurrences in frame order (>= 2).
  pub buckets: Vec<Vec<Occurrence>>,
  /// Fades and dissolves (transitions.rs), worked out in the same decode.
  #[serde(default)]
  pub transitions: Vec<crate::transitions::Transition>,
}

/// Height of the analysis frame for a display size: WIDTH wide, aspect kept, rounded to whole tiles.
pub fn height_for(display_w: u32, display_h: u32) -> usize {
  let aspect = if display_w > 0 && display_h > 0 { display_h as f64 / display_w as f64 } else { 9.0 / 16.0 };
  (((WIDTH as f64 * aspect) / TILE as f64).round() as usize).clamp(1, 128) * TILE
}

pub struct Detector<S> {
  h: usize,
  store: S,
  /// Tile means of every rep (its frame is in `store` at rep index x frame size).
  reps: Vec<Vec<f32>>,
  /// Quadrant means / EXACT (floored) -> reps.
  index: HashMap<[i32; 4], Vec<usize>>,
  /// The current run: its first frame and its occurrence.
  run: Option<(Vec<u8>, usize)>,
  /// (first frame, last frame, rep) per occurrence, in frame order.
  occ: Vec<(usize, usize, usize)>,
  n: usize,
  buf: Vec<u8>,
}

impl<S: Read + Write + Seek> Detector<S> {
  pub fn new(h: usize, store: S) -> Self {
    Detector { h, store, reps: Vec::new(), index: HashMap::new(), run: None, occ: Vec::new(), n: 0, buf: vec![0; WIDTH * h] }
  }

  pub fn frame_len(&self) -> usize {
    WIDTH * self.h
  }

  fn tiles(&self, f: &[u8]) -> Vec<f32> {
    let (tx, ty) = (WIDTH / TILE, self.h / TILE);
    let mut t = vec![0f32; tx * ty];
    for y in 0..self.h {
      for x in 0..WIDTH {
        t[(y / TILE) * tx + x / TILE] += f[y * WIDTH + x] as f32;
      }
    }
    t.iter_mut().for_each(|v| *v /= (TILE * TILE) as f32);
    t
  }

  /// The worst tile's mean |a - b|.
  fn worst(&self, a: &[u8], b: &[u8]) -> f32 {
    let tx = WIDTH / TILE;
    let mut t = vec![0u32; tx * (self.h / TILE)];
    for y in 0..self.h {
      for x in 0..WIDTH {
        let i = y * WIDTH + x;
        t[(y / TILE) * tx + x / TILE] += a[i].abs_diff(b[i]) as u32;
      }
    }
    t.into_iter().max().unwrap_or(0) as f32 / (TILE * TILE) as f32
  }

  fn quadrants(&self, t: &[f32]) -> [i32; 4] {
    let (tx, ty) = (WIDTH / TILE, self.h / TILE);
    let mut q = [0f32; 4];
    let mut c = [0f32; 4];
    for y in 0..ty {
      for x in 0..tx {
        let k = (2 * y / ty.max(1)).min(1) * 2 + (2 * x / tx).min(1);
        q[k] += t[y * tx + x];
        c[k] += 1.0;
      }
    }
    std::array::from_fn(|k| if c[k] > 0.0 { (q[k] / c[k] / EXACT).floor() as i32 } else { 0 })
  }

  /// Feeds the next frame (WIDTH x h grey bytes).
  pub fn push(&mut self, f: &[u8]) -> io::Result<()> {
    let i = self.n;
    self.n += 1;
    let mean = f.iter().map(|&v| v as f64).sum::<f64>() / f.len() as f64;
    let var = f.iter().map(|&v| (v as f64 - mean).powi(2)).sum::<f64>() / f.len() as f64;
    if (var.sqrt() as f32) < MIN_STD {
      self.run = None;
      return Ok(());
    }
    if let Some((first, k)) = &self.run {
      if self.worst(f, first) <= EXACT {
        self.occ[*k].1 = i;
        return Ok(());
      }
    }
    let t = self.tiles(f);
    let key = self.quadrants(&t);
    let mut best: Option<(f32, usize)> = None;
    let len = self.frame_len();
    for d in 0..81 {
      let k: [i32; 4] = std::array::from_fn(|j| key[j] + (d / 3usize.pow(j as u32)) as i32 % 3 - 1);
      let Some(list) = self.index.get(&k) else { continue };
      for &r in list.clone().iter() {
        if self.reps[r].iter().zip(&t).any(|(a, b)| (a - b).abs() > EXACT) {
          continue;
        }
        self.store.seek(SeekFrom::Start((r * len) as u64))?;
        self.store.read_exact(&mut self.buf)?;
        let w = self.worst(f, &self.buf);
        if w <= EXACT && best.is_none_or(|(b, _)| w < b) {
          best = Some((w, r));
        }
      }
    }
    let r = match best {
      Some((_, r)) => r,
      None => {
        let r = self.reps.len();
        self.store.seek(SeekFrom::Start((r * len) as u64))?;
        self.store.write_all(f)?;
        self.reps.push(t);
        self.index.entry(key).or_default().push(r);
        r
      }
    };
    self.occ.push((i, i, r));
    self.run = Some((f.to_vec(), self.occ.len() - 1));
    Ok(())
  }

  /// -> the buckets; `time(frame)` gives an occurrence's t_ms.
  pub fn finish(self, time: impl Fn(usize) -> f64) -> Repeats {
    let mut count = vec![0usize; self.reps.len()];
    self.occ.iter().for_each(|o| count[o.2] += 1);
    let mut id: Vec<Option<usize>> = vec![None; self.reps.len()];
    let mut buckets: Vec<Vec<Occurrence>> = Vec::new();
    for &(f0, f1, r) in &self.occ {
      if count[r] < 2 {
        continue;
      }
      let b = *id[r].get_or_insert_with(|| {
        buckets.push(Vec::new());
        buckets.len() - 1
      });
      buckets[b].push(Occurrence { f0, f1, t_ms: time(f0) });
    }
    Repeats { frames: self.n, exact: EXACT, buckets, transitions: Vec::new() }
  }
}

pub fn args_for(path: &Path, h: usize) -> Vec<OsString> {
  let vf = format!("scale={WIDTH}:{h}:flags=area,format=gray");
  [
    args(["-nostdin", "-v", "error", "-protocol_whitelist", "file", "-threads", THREADS, "-i"]),
    vec![input_arg(path)],
    args(["-map", "0:v:0", "-fps_mode", "passthrough", "-filter_threads", "1", "-vf", vf.as_str(), "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"]),
  ]
  .concat()
}

/// The whole video's repeated frames, cached per file (`repeats.json`).
pub fn repeats(cache: &Cache, job: &Job, path: &Path, emit: &(dyn Fn(Event) + Sync)) -> Result<Repeats> {
  use crate::transitions as tr;
  let key = Cache::key(
    path,
    "repeats",
    &format!("v3 w={WIDTH} tile={TILE} exact={EXACT} std={MIN_STD} tr=1 frac={} black={}/{}", tr::FRAC, tr::BLACK_M, tr::BLACK_S),
  )?;
  if let Some(dir) = cache.get(&key) {
    if let Some(r) = fs::read(dir.join("repeats.json")).ok().and_then(|b| serde_json::from_slice::<Repeats>(&b).ok()) {
      return Ok(r);
    }
  }
  let p = media::probe(cache, job, path)?;
  let Some(v) = &p.video else {
    return Err(Error::new("no_video", format!("{}: no video stream", path.display())));
  };
  let h = height_for(v.display_width, v.display_height);
  let building = cache.begin(&key)?;
  let tmp = building.dir.join("frames.tmp");
  let file = fs::File::options().read(true).write(true).create(true).truncate(true).open(&tmp).at(&tmp)?;
  let mut det = Detector::new(h, file);
  let mut scan = tr::Scan::new(WIDTH, h);
  let len = det.frame_len();
  let expect = v.frame_count.max(1) as f64;
  let mut pending: Vec<u8> = Vec::with_capacity(len * 2);
  let mut th = Throttle::new();
  ffmpeg::run(
    job,
    Tool::Ffmpeg,
    &args_for(path, h),
    |chunk| {
      pending.extend_from_slice(chunk);
      let whole = pending.len() / len * len;
      for f in pending[..whole].chunks_exact(len) {
        det.push(f).at(&tmp)?;
        scan.push(f);
      }
      pending.drain(..whole);
      th.emit(emit, "repeats", det.n as f64 / expect);
      job.check()
    },
    |_| {},
  )?;
  if det.n == 0 {
    return Err(Error::new("no_frame", format!("{}: no frame could be decoded", path.display())));
  }
  // the player's timeline: the real frame table (VFR too) when it lines up with the decoded frames, else n x frame_ms
  let times = media::frame_times(cache, job, path, &|_| {}).ok().filter(|t| t.len() == det.n);
  let frame_ms = v.frame_ms;
  let time = |f: usize| times.as_ref().map_or((f as f64 * frame_ms * 1000.0).round() / 1000.0, |t| t[f]);
  let mut r = det.finish(&time);
  r.transitions = scan.finish(frame_ms, &time);
  let _ = fs::remove_file(&tmp);
  write_atomic(&building.dir.join("repeats.json"), &serde_json::to_vec(&r).unwrap_or_default())?;
  building.finish()?;
  th.emit(emit, "repeats", 1.0);
  Ok(r)
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::Cursor;

  const H: usize = 90;

  /// A textured background with a bright square (the "stroke") at x, plus deterministic +-1 codec-like noise.
  fn frame(x: usize, seed: u32) -> Vec<u8> {
    let mut s = seed.wrapping_mul(2654435761).wrapping_add(1);
    (0..WIDTH * H)
      .map(|i| {
        let (px, py) = (i % WIDTH, i / WIDTH);
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        let bg = 60 + ((px * 7 + py * 13) % 50) as i32 + (s % 3) as i32 - 1;
        (if (x..x + 20).contains(&px) && (30..60).contains(&py) { 220 } else { bg }) as u8
      })
      .collect()
  }

  fn run(frames: &[Vec<u8>]) -> Repeats {
    let mut d = Detector::new(H, Cursor::new(Vec::new()));
    for f in frames {
      d.push(f).unwrap();
    }
    d.finish(|f| f as f64 * 40.0)
  }

  #[test]
  fn held_frames_are_one_occurrence_and_a_bucket_needs_two() {
    // A A A B A A C: A occurs twice (frames 0-2 and 4-5), B and C once
    let fs = [frame(10, 1), frame(10, 2), frame(10, 3), frame(60, 4), frame(10, 5), frame(10, 6), frame(110, 7)];
    let r = run(&fs);
    assert_eq!(r.frames, 7);
    assert_eq!(r.buckets.len(), 1);
    let o: Vec<(usize, usize)> = r.buckets[0].iter().map(|o| (o.f0, o.f1)).collect();
    assert_eq!(o, vec![(0, 2), (4, 5)]);
    assert_eq!(r.buckets[0][1].t_ms, 160.0);
  }

  #[test]
  fn a_different_phase_over_the_same_background_is_no_match() {
    // the square moved 2 px: the background (most of the frame) agrees, the mean differs little, one tile does not
    let (a, b) = (frame(40, 1), frame(42, 2));
    let mean = a.iter().zip(&b).map(|(x, y)| x.abs_diff(*y) as f32).sum::<f32>() / a.len() as f32;
    assert!(mean < EXACT, "mean {mean} would pass a mean test");
    let r = run(&[a.clone(), frame(100, 3), b, frame(100, 4), frame(40, 5)]);
    // only the picture with the square at 40 (frames 0 and 4) and the one at 100 (1 and 3) repeat
    assert_eq!(r.buckets.len(), 2);
    assert_eq!(r.buckets[0].iter().map(|o| o.f0).collect::<Vec<_>>(), vec![0, 4]);
    assert_eq!(r.buckets[1].iter().map(|o| o.f0).collect::<Vec<_>>(), vec![1, 3]);
  }

  #[test]
  fn uniform_frames_are_skipped_and_end_a_run() {
    let black = vec![3u8; WIDTH * H];
    let grey = vec![128u8; WIDTH * H];
    // black frames repeat but never count; A black A: two occurrences of A (black splits the run)
    let r = run(&[black.clone(), frame(10, 1), black.clone(), frame(10, 2), grey.clone(), grey, black]);
    assert_eq!(r.buckets.len(), 1);
    assert_eq!(r.buckets[0].iter().map(|o| (o.f0, o.f1)).collect::<Vec<_>>(), vec![(1, 1), (3, 3)]);
  }

  #[test]
  fn bucket_ids_are_stable_in_order_of_first_occurrence() {
    let seq = |k: u32| vec![frame(100, k), frame(10, k + 1), frame(60, k + 2), frame(10, k + 3), frame(100, k + 4), frame(60, k + 5)];
    let (a, b) = (run(&seq(0)), run(&seq(50)));
    assert_eq!(a, b);
    assert_eq!(a.buckets.iter().map(|o| o[0].f0).collect::<Vec<_>>(), vec![0, 1, 2]);
  }

  #[test]
  fn height_keeps_aspect_in_whole_tiles() {
    assert_eq!(height_for(1920, 1080), 90);
    assert_eq!(height_for(1080, 1080), 160);
    assert_eq!(height_for(0, 0), 90);
    assert_eq!(height_for(1080, 1920), 285);
  }
}
