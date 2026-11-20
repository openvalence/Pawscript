//! Transitions (paw-ef73.3): fades to / from black and dissolves, each the span from the last clean frame before it to
//! the first clean frame after it (clean = fully outside the transition), with its full-black frames. Worked out in the
//! repeated-frames pass (repeats.rs: the same 160 px grey decode, so the video is decoded once) from numbers kept per
//! frame: grey mean and standard deviation, the grey correlation with the previous frame, a 16 x 12 grid of block means.
//!
//! Measure (one ramp walker for both kinds):
//!  - fade: the frame's mean grey level. A fade pivots on a run of dark frames (mean < DARK_M, std < DARK_S, the
//!    sidecar's blank test: pawtrack/scenes.py BLANK_DARK / BLANK_STD). Walking out of the run, the level has to rise
//!    monotonically (a step back <= TOL), frame to frame on the same picture (correlation >= SAME, unless a frame is too
//!    dim for correlation to mean anything), by >= RISE over >= MIN_RAMP frames, no single step more than half of it (that
//!    is a hard cut into the dark, not a fade).
//!  - dissolve: the pawtrack/scenes.py test on the grid: a stretch whose ends differ by a cut-sized jump while every
//!    step is small, the frames at 1/4, 1/2, 3/4 blends of the ends (correlation of x - A with C - A >= BLEND_CORR, the
//!    weight rising, 0.25..0.75 at the middle). The signal walked is the blend weight w (projection of x - A on C - A),
//!    out from the frame where it passes 0.5.
//!  - where a ramp ends: the first frame after which the signal still rises by less than FRAC x the ramp's steepest
//!    step, looking 1 and 2 frames ahead (a fade drawn on twos still rises). That frame is the clean one.
//! Known failures: a fade to white or to a colour (only black is looked for); a fade into a scene that is itself dark
//! (mean < ~20: no rise to see); a dissolve that changes hue only (grey frames); a fade drawn on threes or slower (its flat
//! steps end the ramp early); the eased tail of a fade can leave the last clean frame 1-2 frames inside a < 0.5 % change.

pub const DARK_M: f32 = 16.0;
pub const DARK_S: f32 = 10.0;
/// A full-black frame: what the owner sees as black.
pub const BLACK_M: f32 = 4.0;
pub const BLACK_S: f32 = 3.0;
/// A fade's least level change (grey levels; scenes.py FADE_DROP) and frames.
pub const RISE: f32 = 20.0;
pub const MIN_RAMP: usize = 3;
pub const TOL: f32 = 1.5;
pub const SAME: f32 = 0.2;
/// The ramp ends where it rises by less than this share of its steepest step. Calibrated on the owner's four videos
/// (2026-11-12): 0.1 left eased ends 2-4 frames early (a 0.4 % change still to come); 0.05 lands on the plateau.
pub const FRAC: f32 = 0.05;
pub const MAX_RAMP_MS: f64 = 5000.0;
pub const GW: usize = 16;
pub const GH: usize = 12;
const JUMP: f32 = 15.0;
const CUT_RATIO: f32 = 3.0;
const PRE: f32 = 2.0;
const BLEND_CORR: f32 = 0.8;
const LAGS_MS: [f64; 5] = [300.0, 500.0, 800.0, 1200.0, 2000.0];
const DISSOLVE_WALK_MS: f64 = 2000.0;

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Transition {
  /// "fade-out" | "fade-in" | "through-black" | "dissolve"
  pub kind: String,
  /// Last clean frame before (-1: the video starts inside it) and first clean frame after (= frames: it ends the video).
  pub f0: i64,
  pub f1: i64,
  /// ms (file start = 0): the last clean frame before (None: the video starts inside), the transition's first frame, its
  /// darkest frame (a fade: the middle black frame, else the darkest; a dissolve: where the blend passes half), the first
  /// clean frame after (None: the video ends inside).
  pub t0: Option<f64>,
  pub ts: f64,
  pub tm: f64,
  pub t1: Option<f64>,
  /// The full-black frames as [b0, b1) ms: the first one's start, the end of the last one. None: no frame is black.
  pub b0: Option<f64>,
  pub b1: Option<f64>,
}

/// Per-frame numbers, fed frame by frame during the decode.
pub struct Scan {
  w: usize,
  h: usize,
  m: Vec<f32>,
  s: Vec<f32>,
  corr: Vec<f32>,
  /// GW x GH block means per frame, rounded. ponytail: kept for the whole video (192 B a frame, ~40 MB for 2 h at
  /// 30 fps); a ring of the last few seconds if long files matter.
  grid: Vec<u8>,
  prev: Vec<u8>,
}

impl Scan {
  pub fn new(w: usize, h: usize) -> Self {
    Scan { w, h, m: Vec::new(), s: Vec::new(), corr: Vec::new(), grid: Vec::new(), prev: Vec::new() }
  }

  pub fn push(&mut self, f: &[u8]) {
    let n = f.len() as f64;
    let mean = f.iter().map(|&v| v as f64).sum::<f64>() / n;
    let sd = (f.iter().map(|&v| (v as f64 - mean).powi(2)).sum::<f64>() / n).sqrt();
    let corr = match (self.m.last(), self.s.last()) {
      (Some(&pm), Some(&ps)) if ps as f64 * sd > 1e-6 => {
        f.iter().zip(&self.prev).map(|(&a, &b)| (a as f64 - mean) * (b as f64 - pm as f64)).sum::<f64>() / (n * sd * ps as f64)
      }
      _ => 1.0,
    };
    for by in 0..GH {
      for bx in 0..GW {
        let (x0, x1, y0, y1) = (bx * self.w / GW, (bx + 1) * self.w / GW, by * self.h / GH, (by + 1) * self.h / GH);
        let (mut sum, mut c) = (0u32, 0u32);
        for y in y0..y1 {
          for x in x0..x1 {
            sum += f[y * self.w + x] as u32;
            c += 1;
          }
        }
        self.grid.push(if c > 0 { ((sum + c / 2) / c) as u8 } else { 0 });
      }
    }
    self.m.push(mean as f32);
    self.s.push(sd as f32);
    self.corr.push(corr as f32);
    self.prev.clear();
    self.prev.extend_from_slice(f);
  }

  fn g(&self, i: usize) -> &[u8] {
    &self.grid[i * GW * GH..(i + 1) * GW * GH]
  }

  /// -> the transitions in time order. time(frame) = its presentation time (ms); frame_ms = the frame duration.
  pub fn finish(&self, frame_ms: f64, time: impl Fn(usize) -> f64) -> Vec<Transition> {
    let n = self.m.len();
    if n == 0 {
      return Vec::new();
    }
    let fm = if frame_ms > 0.0 { frame_ms } else { 1000.0 / 30.0 };
    let at = |f: i64| if (f as usize) < n { time(f as usize) } else { time(n - 1) + fm * (f as usize - n + 1) as f64 };
    let frames = |ms: f64| (ms / fm).round().max(1.0) as usize;
    let (m, s) = (&self.m, &self.s);
    let dark = |i: usize| m[i] < DARK_M && s[i] < DARK_S;
    let black = |i: usize| m[i] < BLACK_M && s[i] < BLACK_S;
    let same = |a: usize, b: usize| s[a].min(s[b]) < 2.0 * DARK_S || self.corr[a.max(b)] >= SAME;
    let level = |i: usize| m[i];
    let fade = |r: &Ramp| r.rise >= RISE && r.frames >= MIN_RAMP && r.max_step <= 0.5 * r.rise;
    let mut out: Vec<(&str, i64, i64, usize, Option<(usize, usize)>)> = Vec::new(); // kind, f0, f1, darkest, black
    let mut j = 0;
    while j < n {
      if !dark(j) {
        j += 1;
        continue;
      }
      let mut e = j;
      while e < n && dark(e) {
        e += 1;
      }
      let l = (j > 0).then(|| walk(&level, j, true, n, frames(MAX_RAMP_MS), &same)).filter(fade);
      let r = (e < n).then(|| walk(&level, e - 1, false, n, frames(MAX_RAMP_MS), &same)).filter(fade);
      if l.is_some() || r.is_some() {
        let b = (j..e).find(|&i| black(i)).map(|b0| (b0, (j..e).rev().find(|&i| black(i)).unwrap_or(b0)));
        let darkest = b.map_or_else(|| (j..e).min_by(|&a, &c| m[a].total_cmp(&m[c])).unwrap_or(j), |(b0, b1)| (b0 + b1) / 2);
        let kind = match (&l, &r) {
          (Some(_), Some(_)) => "through-black",
          (Some(_), None) => "fade-out",
          _ => "fade-in",
        };
        out.push((kind, l.map_or(j as i64 - 1, |w| w.clean as i64), r.map_or(e as i64, |w| w.clean as i64), darkest, b));
      }
      j = e;
    }
    // dissolves, outside every fade and dark frame
    let mut busy: Vec<bool> = (0..n).map(dark).collect();
    for &(_, f0, f1, _, _) in &out {
      for b in busy.iter_mut().take((f1 as usize + 1).min(n)).skip(f0.max(0) as usize) {
        *b = true;
      }
    }
    for (a, mid, c) in self.dissolves(&busy, fm) {
      out.push(("dissolve", a as i64, c as i64, mid, None));
    }
    out.sort_by_key(|x| x.1);
    out
      .into_iter()
      .map(|(kind, f0, f1, dk, b)| Transition {
        kind: kind.into(),
        f0,
        f1,
        t0: (f0 >= 0).then(|| at(f0)),
        ts: at(f0 + 1),
        tm: at(dk as i64),
        t1: ((f1 as usize) < n).then(|| at(f1)),
        b0: b.map(|(b0, _)| at(b0 as i64)),
        b1: b.map(|(_, b1)| at(b1 as i64 + 1)),
      })
      .collect()
  }

  /// -> (last clean frame before, the frame the blend passes half, first clean frame after) per dissolve.
  fn dissolves(&self, busy: &[bool], fm: f64) -> Vec<(usize, usize, usize)> {
    let n = busy.len();
    let diff = |a: &[u8], b: &[u8]| a.iter().zip(b).map(|(&x, &y)| x.abs_diff(y) as f32).sum::<f32>() / a.len() as f32;
    let step: Vec<f32> = (0..n).map(|i| if i == 0 { 0.0 } else { diff(self.g(i), self.g(i - 1)) }).collect();
    let mut regions: Vec<(usize, usize)> = Vec::new();
    for c in 0..n {
      if busy[c] {
        continue;
      }
      for lag in LAGS_MS.iter().map(|&ms| (ms / fm).round() as usize) {
        if lag < 4 || c < lag || busy[c - lag..c].iter().any(|&b| b) {
          continue; // a fade or a dark frame in the stretch: not a blend of two pictures
        }
        let a = c - lag;
        let (st, jump) = (step[a + 1..=c].iter().cloned().fold(0.0, f32::max), diff(self.g(c), self.g(a)));
        if jump < JUMP || jump < CUT_RATIO * (st + 1.0) {
          continue;
        }
        if a >= lag && jump < PRE * (diff(self.g(a), self.g(a - lag)) + 1.0) {
          continue; // the same span just before changes as much: motion, not a change of picture
        }
        let ws: Vec<(f32, f32)> = [0.25, 0.5, 0.75].iter().map(|q| blend(self.g(a), self.g(a + (lag as f64 * q).round() as usize), self.g(c))).collect();
        if ws.iter().any(|w| w.1 < BLEND_CORR) || !(0.0 < ws[0].0 && ws[0].0 < ws[1].0 && ws[1].0 < ws[2].0 && ws[2].0 < 1.0) || !(0.25..=0.75).contains(&ws[1].0) {
          continue;
        }
        match regions.last_mut() {
          Some(r) if a <= r.1 => *r = (r.0.min(a), c),
          _ => regions.push((a, c)),
        }
      }
    }
    let reach = (DISSOLVE_WALK_MS / fm).round() as usize;
    let mut out: Vec<(usize, usize, usize)> = Vec::new();
    for (a, c) in regions {
      let w = |j: usize| blend(self.g(a), self.g(j), self.g(c)).0;
      let Some(mid) = (a..=c).find(|&j| w(j) >= 0.5) else { continue };
      let l = walk(&|j| -w(j), mid, true, n, reach, &|_, _| true);
      let r = walk(&w, mid, false, n, reach, &|_, _| true);
      if r.clean < l.clean + 5 || out.last().is_some_and(|o| l.clean < o.2) {
        continue;
      }
      out.push((l.clean, mid, r.clean));
    }
    out
  }
}

/// -> (weight, correlation) of x - a along c - a.
fn blend(a: &[u8], x: &[u8], c: &[u8]) -> (f32, f32) {
  let (mut vv, mut ww, mut vw) = (0f32, 0f32, 0f32);
  for k in 0..a.len() {
    let (v, w) = (c[k] as f32 - a[k] as f32, x[k] as f32 - a[k] as f32);
    vv += v * v;
    ww += w * w;
    vw += v * w;
  }
  if vv < 1e-6 || ww < 1e-6 {
    return (0.0, 0.0);
  }
  (vw / vv, vw / (vv * ww).sqrt())
}

#[derive(Debug, Clone, Copy)]
struct Ramp {
  clean: usize,
  rise: f32,
  frames: usize,
  max_step: f32,
}

/// A ramp walked from `start` (back: toward earlier frames) while x rises outward (see the module doc).
fn walk(x: &dyn Fn(usize) -> f32, start: usize, back: bool, n: usize, max: usize, same: &dyn Fn(usize, usize) -> bool) -> Ramp {
  let next = |j: usize, k: usize| if back { j.checked_sub(k) } else { Some(j + k).filter(|&v| v < n) };
  let (mut j, mut peak, mut frames, mut max_step) = (start, 0f32, 0usize, 0f32);
  while let Some(k) = next(j, 1) {
    if frames >= max || !same(j, k) {
      break;
    }
    let r1 = x(k) - x(j);
    let rate = next(j, 2).map_or(r1, |k2| r1.max((x(k2) - x(j)) / 2.0));
    peak = peak.max(rate);
    if rate <= 0.0 || rate < FRAC * peak || r1 < -TOL {
      break;
    }
    max_step = max_step.max(r1);
    frames += 1;
    j = k;
  }
  Ramp { clean: j, rise: x(j) - x(start), frames, max_step }
}

#[cfg(test)]
mod tests {
  use super::*;

  const W: usize = 160;
  const H: usize = 90;

  /// A textured picture (two looks, `alt`: a ramp across or down, as a real picture has big shapes the grid sees) with a
  /// bright square at x (the motion), scaled by `a` (a fade: 0 = black).
  fn pic(x: usize, alt: bool, a: f32) -> Vec<f32> {
    (0..W * H)
      .map(|i| {
        let (px, py) = (i % W, i / W);
        let tex = ((px * 7 + py * 13) % 20) as f32;
        let bg = tex + if alt { 40.0 + (150 * py / H) as f32 } else { 40.0 + (150 * px / W) as f32 };
        (if (x..x + 20).contains(&px) && (30..60).contains(&py) { 230.0 } else { bg }) * a
      })
      .collect()
  }
  fn q(v: &[f32]) -> Vec<u8> {
    v.iter().map(|&x| x.round().clamp(0.0, 255.0) as u8).collect()
  }
  fn mix(a: &[f32], b: &[f32], w: f32) -> Vec<f32> {
    a.iter().zip(b).map(|(x, y)| x * (1.0 - w) + y * w).collect()
  }
  fn run(frames: &[Vec<u8>]) -> Vec<Transition> {
    let mut s = Scan::new(W, H);
    frames.iter().for_each(|f| s.push(f));
    s.finish(40.0, |f| f as f64 * 40.0)
  }
  /// x moves 2 px a frame: a scene in motion, as the fades and dissolves the owner's videos have.
  fn scene(range: std::ops::Range<usize>, alt: bool) -> Vec<Vec<u8>> {
    range.map(|i| q(&pic(10 + (i * 2) % 120, alt, 1.0))).collect()
  }

  #[test]
  fn fade_out_then_cut_in_marks_its_black_frames() {
    // 0-9 clean, 10-19 linear fade (frame 10 = 90 %), 20-24 black, 25-34 the next scene (a hard cut out of the black)
    let mut f = scene(0..10, false);
    f.extend((10..20).map(|i| q(&pic(10 + i * 2, false, 1.0 - (i - 9) as f32 / 10.0))));
    f.extend((20..25).map(|_| vec![0u8; W * H]));
    f.extend(scene(25..35, true));
    let t = run(&f);
    assert_eq!(t.len(), 1, "{t:?}");
    let x = &t[0];
    assert_eq!((x.kind.as_str(), x.f0, x.f1), ("fade-out", 9, 25));
    assert_eq!((x.t0, x.ts, x.t1), (Some(360.0), 400.0, Some(1000.0)));
    assert_eq!((x.b0, x.b1), (Some(19.0 * 40.0), Some(1000.0))); // frame 19 is the fade's 0 % frame: black too
    assert_eq!(x.tm, 21.0 * 40.0);
  }

  #[test]
  fn fade_in_at_the_start_of_the_video() {
    // black 0-3, fade in 4-15 (12 frames, eased: smoothstep), clean from 16
    let mut f: Vec<Vec<u8>> = (0..4).map(|_| vec![0u8; W * H]).collect();
    f.extend((4..16).map(|i| {
      let u = (i - 3) as f32 / 13.0;
      q(&pic(10 + i * 2, false, u * u * (3.0 - 2.0 * u)))
    }));
    f.extend(scene(16..30, false));
    let t = run(&f);
    assert_eq!(t.len(), 1, "{t:?}");
    let x = &t[0];
    assert_eq!(x.kind, "fade-in");
    assert_eq!(x.f0, -1);
    assert_eq!(x.t0, None);
    assert_eq!(x.ts, 0.0);
    assert!((15..=16).contains(&x.f1), "first clean frame {}", x.f1);
    assert_eq!(x.b0, Some(0.0));
  }

  #[test]
  fn fade_through_black_and_fade_out_at_the_end() {
    // A 0-9, down 10-17, black 18-19, up 20-27, B 28-39, down 40-47, black to the end (48-49)
    let mut f = scene(0..10, false);
    f.extend((10..18).map(|i| q(&pic(10 + i * 2, false, 1.0 - (i - 9) as f32 / 9.0))));
    f.extend((18..20).map(|_| vec![0u8; W * H]));
    f.extend((20..28).map(|i| q(&pic(10 + i * 2, true, (i - 19) as f32 / 9.0))));
    f.extend(scene(28..40, true));
    f.extend((40..48).map(|i| q(&pic(10 + i * 2, true, 1.0 - (i - 39) as f32 / 9.0))));
    f.extend((48..50).map(|_| vec![0u8; W * H]));
    let t = run(&f);
    let got: Vec<(&str, i64, i64)> = t.iter().map(|x| (x.kind.as_str(), x.f0, x.f1)).collect();
    assert_eq!(got, vec![("through-black", 9, 28), ("fade-out", 39, 50)], "{t:?}");
    assert_eq!(t[1].t1, None);
    assert_eq!(t[0].tm, 18.0 * 40.0); // the middle black frame (18, 19 -> 18)
  }

  #[test]
  fn a_dissolve_between_two_pictures() {
    // A 0-19, blend 20-31 (12 frames), B 32-51; both in motion
    let mut f = scene(0..20, false);
    f.extend((20..32).map(|i| q(&mix(&pic(10 + i * 2, false, 1.0), &pic(10 + i * 2, true, 1.0), (i - 19) as f32 / 13.0))));
    f.extend(scene(32..52, true));
    let t = run(&f);
    assert_eq!(t.len(), 1, "{t:?}");
    let x = &t[0];
    assert_eq!(x.kind, "dissolve");
    assert!((18..=19).contains(&x.f0) && (32..=33).contains(&x.f1), "{x:?}");
    assert_eq!((x.b0, x.b1), (None, None));
    assert!((25.0 * 40.0..=26.0 * 40.0).contains(&x.tm), "{x:?}");
  }

  #[test]
  fn a_dark_static_scene_and_flashes_are_no_transition() {
    // a dark night scene (mean ~10, std ~6) cut hard between two bright ones; a white flash frame; a black frame
    let dark = |i: usize| q(&pic(10 + i * 2, false, 0.09));
    let mut f = scene(0..10, false);
    f.extend((10..40).map(dark));
    f.extend(scene(40..50, true));
    f.push(vec![250u8; W * H]); // a white flash
    f.extend(scene(51..60, true));
    f.push(vec![0u8; W * H]); // a single black frame
    f.extend(scene(61..70, true));
    let mut s = Scan::new(W, H);
    f.iter().for_each(|x| s.push(x));
    assert!(s.m[20] < DARK_M && s.s[20] < DARK_S, "the night scene counts as dark: {} {}", s.m[20], s.s[20]);
    assert_eq!(s.finish(40.0, |f| f as f64 * 40.0), vec![]);
  }

  #[test]
  fn a_slow_fade_into_a_scene_does_not_end_at_its_first_steps() {
    // held frames: the fade is drawn on twos (every other frame repeats the level)
    let mut f: Vec<Vec<u8>> = (0..3).map(|_| vec![0u8; W * H]).collect();
    f.extend((3..23).map(|i| q(&pic(10, false, ((i - 2) / 2) as f32 / 10.0))));
    f.extend(scene(23..33, false));
    let t = run(&f);
    assert_eq!(t.len(), 1, "{t:?}");
    assert!((21..=23).contains(&t[0].f1), "{:?}", t[0]);
  }
}
