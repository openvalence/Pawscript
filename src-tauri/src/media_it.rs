//! Integration tests: real ffmpeg on small synthetic clips made here. Skipped
//! (with a note) when ffmpeg is not installed.

use crate::cache::{Cache, LIMIT};
use crate::ffmpeg::{self, args, Job, Tool};
use crate::media::{self, Event, ImageFormat};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

fn have_ffmpeg() -> bool {
  let t = ffmpeg::tools();
  let ok = t.ffmpeg.is_some() && t.ffprobe.is_some();
  if !ok {
    eprintln!("SKIP: ffmpeg/ffprobe not found");
  }
  ok
}

fn ff(a: &[&str]) {
  ffmpeg::output(&Job::default(), Tool::Ffmpeg, &args(a.iter().copied())).unwrap();
}

/// 3 s, 10 fps, 64x48; frame N has luma ≈ N*8 (so a frame's index can be read
/// back); optional 440 Hz sine at 1/8 amplitude. mpeg4 + aac: built into every ffmpeg.
fn clip(dir: &Path, name: &str, audio: bool) -> PathBuf {
  let out = dir.join(name);
  let o = out.to_string_lossy().into_owned();
  let mut a = vec!["-v", "error", "-f", "lavfi", "-i", "color=c=black:s=64x48:r=10:d=3,format=gray,geq=lum='N*8',format=yuv420p"];
  if audio {
    a.extend(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=3"]);
  }
  a.extend(["-c:v", "mpeg4", "-q:v", "1", "-g", "5"]);
  if audio {
    a.extend(["-c:a", "aac", "-shortest"]);
  }
  a.extend(["-y", &o]);
  ff(&a);
  out
}

/// Mean luma of an encoded image, via ffmpeg (no image decoder in the crate).
fn luma(img: &[u8], dir: &Path) -> f64 {
  let f = dir.join("probe-img.bin");
  std::fs::write(&f, img).unwrap();
  let raw = ffmpeg::output(&Job::default(), Tool::Ffmpeg, &args(["-v", "error", "-i", f.to_str().unwrap(), "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"])).unwrap();
  raw.iter().map(|b| *b as f64).sum::<f64>() / raw.len() as f64
}

fn events() -> (Arc<Mutex<Vec<Event>>>, impl Fn(Event) + Sync) {
  let v = Arc::new(Mutex::new(Vec::new()));
  let w = v.clone();
  (v, move |e| w.lock().unwrap().push(e))
}

#[test]
fn probe_waveform_frames_thumbnails() {
  if !have_ffmpeg() {
    return;
  }
  let t = tempfile::tempdir().unwrap();
  let cache = Cache { root: t.path().join("cache"), limit: LIMIT };
  let job = Job::default();
  let v = clip(t.path(), "clip 夏.mp4", true);

  let p = media::probe(&cache, &job, &v).unwrap();
  let vi = p.video.as_ref().unwrap();
  assert!((p.duration_ms - 3000.0).abs() < 150.0, "{}", p.duration_ms);
  assert_eq!((vi.width, vi.height, vi.rotation), (64, 48, 0));
  assert!((vi.fps - 10.0).abs() < 0.01 && !vi.is_vfr);
  assert_eq!(vi.frame_count, 30);
  assert!(p.has_audio && !p.webview_playable); // mpeg4 part 2 is not webview-playable
  assert_eq!(media::probe(&cache, &job, &v).unwrap(), p); // cached

  // Waveform: sine at 1/8 full scale -> peak ≈ 4096, rms ≈ 2896.
  let (ev, emit) = events();
  let bytes = media::waveform(&cache, &job, &v, 1.0, &emit).unwrap(); // 1 ms: 3000 buckets -> 3 levels
  assert_eq!(&bytes[0..4], b"PWPK");
  let levels = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
  let total = u64::from_le_bytes(bytes[16..24].try_into().unwrap());
  assert!((total as i64 - 24000).abs() < 1200, "total samples {total}");
  let base_count = u32::from_le_bytes(bytes[28..32].try_into().unwrap()) as usize;
  assert_eq!(base_count as u64, total.div_ceil(8));
  assert_eq!(levels, 3);
  let top_off = 24 + levels * 8 + (0..levels - 1).map(|l| u32::from_le_bytes(bytes[28 + l * 8..32 + l * 8].try_into().unwrap()) as usize * 6).sum::<usize>();
  let top: Vec<i16> = bytes[top_off..].chunks(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect();
  let max = top.chunks(3).map(|b| b[1]).max().unwrap() as f64;
  assert!((max - 4096.0).abs() < 500.0, "peak {max}");
  let rms = top.chunks(3).map(|b| b[2]).max().unwrap() as f64;
  assert!((rms - 2896.0).abs() < 400.0, "rms {rms}");
  assert!(matches!(ev.lock().unwrap().last(), Some(Event::Progress { fraction, .. }) if *fraction == 1.0));
  assert_eq!(media::waveform(&cache, &job, &v, 1.0, &|_| {}).unwrap(), bytes); // cached

  // Frames: the frame shown at t is floor(t / 100 ms).
  for (t_ms, want) in [(0.0, 0), (100.0, 1), (150.0, 1), (199.0, 1), (200.0, 2), (2950.0, 29)] {
    let png = media::extract_frame(&cache, &job, &v, t_ms, ImageFormat::Png, None).unwrap();
    assert_eq!(&png[..4], b"\x89PNG");
    let n = (luma(&png, t.path()) / 8.0).round() as i64;
    assert_eq!(n, want, "frame at {t_ms} ms");
  }
  let jpg = media::extract_frame(&cache, &job, &v, 1000.0, ImageFormat::Jpeg, Some(32)).unwrap();
  assert_eq!(&jpg[..2], b"\xFF\xD8");
  assert_eq!(media::extract_frame(&cache, &job, &v, 60_000.0, ImageFormat::Png, None).unwrap_err().code, "no_frame");

  // Thumbnails: 120 frames -> coarse level (20, 1 sheet) + full level (2 sheets), streamed in order.
  let (ev, emit) = events();
  let s = media::thumbnails(&cache, &job, &v, Some(48), Some(120), &emit).unwrap();
  assert_eq!(s.levels.len(), 2);
  assert_eq!((s.levels[0].sheets.len(), s.levels[1].sheets.len()), (1, 2));
  let sheets: Vec<(usize, usize)> = ev.lock().unwrap().iter().filter_map(|e| if let Event::Sheet { level, index, .. } = e { Some((*level, *index)) } else { None }).collect();
  assert_eq!(sheets, vec![(0, 0), (1, 0), (1, 1)]);
  let sheet = std::fs::read(&s.levels[1].sheets[0]).unwrap();
  assert_eq!(&sheet[..2], b"\xFF\xD8");
  // No stray per-frame files remain in the entry.
  let dir = Path::new(&s.levels[1].sheets[0]).parent().unwrap();
  assert!(std::fs::read_dir(dir).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().starts_with('f')));
  let again = media::thumbnails(&cache, &job, &v, Some(48), Some(120), &|_| {}).unwrap();
  assert_eq!(again, s);
  // Sheet geometry: 10 columns of 64x48 tiles, 10 rows.
  let probe = ffmpeg::output(&job, Tool::Ffprobe, &args(["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", &s.levels[1].sheets[0]])).unwrap();
  assert_eq!(String::from_utf8_lossy(&probe).trim(), format!("{},{}", s.columns * s.tile_w, s.rows * s.tile_h));
}

#[test]
fn no_audio_cancel_and_missing_file() {
  if !have_ffmpeg() {
    return;
  }
  let t = tempfile::tempdir().unwrap();
  let cache = Cache { root: t.path().join("cache"), limit: LIMIT };
  let v = clip(t.path(), "silent.mp4", false);
  let job = Job::default();
  assert_eq!(media::waveform(&cache, &job, &v, 8.0, &|_| {}).unwrap_err().code, "no_audio");
  assert_eq!(media::probe(&cache, &job, &t.path().join("nope.mp4")).unwrap_err().code, "not_found");
  let junk = t.path().join("junk.mp4");
  std::fs::write(&junk, b"not a video at all").unwrap();
  assert_eq!(media::probe(&cache, &job, &junk).unwrap_err().code, "ffmpeg_failed");

  // Cancel mid-strip: rejects with `cancelled` and leaves no partial cache entry.
  let job = Arc::new(Job::default());
  let j2 = job.clone();
  let canceller = std::thread::spawn(move || {
    std::thread::sleep(std::time::Duration::from_millis(300));
    j2.cancel();
  });
  let r = media::thumbnails(&cache, &job, &v, Some(40), Some(2000), &|_| {});
  canceller.join().unwrap();
  assert_eq!(r.unwrap_err().code, "cancelled");
  let left: Vec<_> = std::fs::read_dir(&cache.root).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name().into_string().unwrap()).filter(|n| n.starts_with("thumbs")).collect();
  assert!(left.is_empty(), "{left:?}");
}

#[test]
fn proxy_keeps_timing() {
  if !have_ffmpeg() {
    return;
  }
  let enc = ffmpeg::output(&Job::default(), Tool::Ffmpeg, &args(["-hide_banner", "-encoders"])).unwrap();
  if !String::from_utf8_lossy(&enc).contains("libx264") {
    eprintln!("SKIP: ffmpeg has no libx264");
    return;
  }
  let t = tempfile::tempdir().unwrap();
  let cache = Cache { root: t.path().join("cache"), limit: LIMIT };
  let job = Job::default();
  let v = clip(t.path(), "src.mp4", true);
  let (ev, emit) = events();
  let out = media::proxy(&cache, &job, &v, Some(240), &emit).unwrap();
  let p = media::probe(&cache, &job, Path::new(&out)).unwrap();
  let vi = p.video.unwrap();
  assert_eq!(vi.codec, "h264");
  assert_eq!(vi.frame_count, 30);
  assert!(p.webview_playable);
  assert!(matches!(ev.lock().unwrap().last(), Some(Event::Progress { fraction, .. }) if *fraction == 1.0));
  // The same frame comes out at the same time in source and proxy.
  let a = luma(&media::extract_frame(&cache, &job, &v, 1234.0, ImageFormat::Png, None).unwrap(), t.path());
  let b = luma(&media::extract_frame(&cache, &job, Path::new(&out), 1234.0, ImageFormat::Png, None).unwrap(), t.path());
  assert!((a - b).abs() < 4.0, "{a} vs {b}");
}

/// paw-ef73.15: an AVI with B-frames (ffmpeg reads its first frame one frame late) makes a proxy whose frame N is at
/// N x frame length from 0, like the app's clock and the scrubber: the luma-coded frame N (lum = 8N) shows mid-frame N.
#[test]
fn proxy_of_a_late_starting_avi_starts_at_frame_zero() {
  if !have_ffmpeg() {
    return;
  }
  let enc = ffmpeg::output(&Job::default(), Tool::Ffmpeg, &args(["-hide_banner", "-encoders"])).unwrap();
  if !String::from_utf8_lossy(&enc).contains("libx264") {
    eprintln!("SKIP: ffmpeg has no libx264");
    return;
  }
  let t = tempfile::tempdir().unwrap();
  let cache = Cache { root: t.path().join("cache"), limit: LIMIT };
  let job = Job::default();
  let v = t.path().join("late.avi");
  let o = v.to_string_lossy().into_owned();
  ff(&["-v", "error", "-f", "lavfi", "-i", "color=c=black:s=64x48:r=10:d=3,format=gray,geq=lum='N*8',format=yuv420p", "-c:v", "mpeg4", "-q:v", "1", "-bf", "2", "-f", "avi", "-y", &o]);
  let out = media::proxy(&cache, &job, &v, Some(240), &|_: Event| {}).unwrap();
  let p = media::probe(&cache, &job, Path::new(&out)).unwrap();
  assert!(p.start_ms.abs() < 0.5, "proxy starts at {} ms", p.start_ms);
  for k in [0u32, 5, 12, 25] {
    let l = luma(&media::extract_frame(&cache, &job, Path::new(&out), k as f64 * 100.0 + 50.0, ImageFormat::Png, None).unwrap(), t.path());
    assert!((l - 8.0 * k as f64).abs() < 4.0, "frame {k}: luma {l}");
  }
}

/// VFR: the luma-coded 10 fps clip with frames 10..19 dropped (timestamps kept:
/// a 1 s gap) and B-frames (packets arrive out of presentation order).
#[test]
fn vfr_frame_times_and_exact_frames() {
  if !have_ffmpeg() {
    return;
  }
  let t = tempfile::tempdir().unwrap();
  let cache = Cache { root: t.path().join("cache"), limit: LIMIT };
  let job = Job::default();
  let out = t.path().join("vfr 夏.mp4");
  let o = out.to_string_lossy().into_owned();
  ff(&[
    "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=64x48:r=10:d=3,format=gray,geq=lum='N*8',format=yuv420p,select='not(between(n,10,19))'",
    "-fps_mode", "passthrough", "-c:v", "mpeg4", "-q:v", "1", "-bf", "2", "-y", &o,
  ]);
  let p = media::probe(&cache, &job, &out).unwrap();
  let v = p.video.unwrap();
  assert!(v.is_vfr, "avg {} fps", v.fps);
  assert_eq!(v.frame_count, 20);

  let (ev, emit) = events();
  let times = media::frame_times(&cache, &job, &out, &emit).unwrap();
  let want: Vec<f64> = (0..10).map(|i| i as f64 * 100.0).chain((20..30).map(|i| i as f64 * 100.0)).collect();
  assert_eq!(times.len(), want.len(), "{times:?}");
  for (a, b) in times.iter().zip(&want) {
    assert!((a - b).abs() < 0.5, "{times:?}");
  }
  assert!(matches!(ev.lock().unwrap().last(), Some(Event::Progress { fraction, .. }) if *fraction == 1.0));
  assert_eq!(media::frame_times(&cache, &job, &out, &|_| {}).unwrap(), times); // cached

  // extract_frame across the gap: the player still shows frame 9 until 2000 ms.
  for (t_ms, want) in [(0.0, 0), (950.0, 9), (1500.0, 9), (1999.0, 9), (2000.0, 20), (2150.0, 21)] {
    let png = media::extract_frame(&cache, &job, &out, t_ms, ImageFormat::Png, None).unwrap();
    assert_eq!((luma(&png, t.path()) / 8.0).round() as i64, want, "frame at {t_ms} ms");
  }
}

#[test]
fn scrub_cache_all_intra_same_times_and_limit() {
  if !have_ffmpeg() {
    return;
  }
  let enc = ffmpeg::output(&Job::default(), Tool::Ffmpeg, &args(["-hide_banner", "-encoders"])).unwrap();
  if !String::from_utf8_lossy(&enc).contains("libx264") {
    eprintln!("SKIP: ffmpeg has no libx264");
    return;
  }
  let t = tempfile::tempdir().unwrap();
  let cache = Cache { root: t.path().join("cache"), limit: LIMIT };
  let job = Job::default();
  let v = clip(t.path(), "src.mp4", true);
  let (ev, emit) = events();
  let out = media::scrub_cache(&cache, &job, &v, &emit).unwrap();
  assert!(matches!(ev.lock().unwrap().last(), Some(Event::Progress { fraction, .. }) if *fraction == 1.0));
  let flags = ffmpeg::output(&job, Tool::Ffprobe, &args(["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=flags", "-of", "csv=p=0", &out])).unwrap();
  let flags = String::from_utf8_lossy(&flags);
  assert_eq!(flags.lines().count(), 30);
  assert!(flags.lines().all(|f| f.starts_with('K')), "{flags}");
  let p = media::probe(&cache, &job, Path::new(&out)).unwrap();
  assert!(!p.has_audio && p.video.as_ref().unwrap().codec == "h264");
  assert_eq!(media::frame_times(&cache, &job, Path::new(&out), &|_| {}).unwrap(), media::frame_times(&cache, &job, &v, &|_| {}).unwrap());
  assert_eq!(media::scrub_cache(&cache, &job, &v, &|_| {}).unwrap(), out); // cached
  // a limit the copy alone exceeds: too_large, nothing kept
  let small = Cache { root: t.path().join("small"), limit: 1000 };
  assert_eq!(media::scrub_cache(&small, &job, &v, &|_| {}).unwrap_err().code, "too_large");
  assert!(std::fs::read_dir(&small.root).unwrap().filter_map(|e| e.ok()).all(|e| !e.file_name().to_string_lossy().starts_with("scrub-")));
}

/// A 1 s testsrc drawing played 3 times, each frame held 2 frames (animation on twos), with black between the loops:
/// every drawing is one bucket of 3 occurrences, each a 2-frame run; black is never a repeat.
#[test]
fn repeats_on_a_looped_clip() {
  if !have_ffmpeg() {
    return;
  }
  let t = tempfile::tempdir().unwrap();
  let cache = Cache { root: t.path().join("cache"), limit: LIMIT };
  let job = Job::default();
  let v = t.path().join("loop.mp4");
  let o = v.to_string_lossy().into_owned();
  // 5 drawings x 2 = 10 frames, then 4 black frames; looped 3 times = 42 frames at 10 fps
  let src = "testsrc=s=320x180:r=5:d=1,fps=10,format=yuv420p[a];color=c=black:s=320x180:r=10:d=0.4,format=yuv420p[b];[a][b]concat=n=2:v=1,loop=loop=2:size=14";
  ff(&["-v", "error", "-f", "lavfi", "-i", src, "-c:v", "mpeg4", "-q:v", "2", "-y", &o]);
  let (ev, emit) = events();
  let r = crate::repeats::repeats(&cache, &job, &v, &emit).unwrap();
  assert!(matches!(ev.lock().unwrap().last(), Some(Event::Progress { fraction, .. }) if *fraction == 1.0));
  assert_eq!(r.frames, 42);
  assert_eq!(r.buckets.len(), 5, "{r:?}");
  for (k, b) in r.buckets.iter().enumerate() {
    let runs: Vec<(usize, usize)> = b.iter().map(|o| (o.f0, o.f1)).collect();
    assert_eq!(runs, (0..3).map(|i| (i * 14 + 2 * k, i * 14 + 2 * k + 1)).collect::<Vec<_>>());
    assert!((b[1].t_ms - (14 + 2 * k) as f64 * 100.0).abs() < 1.0, "{}", b[1].t_ms);
  }
  assert_eq!(crate::repeats::repeats(&cache, &job, &v, &|_| {}).unwrap(), r); // cached
}

/// paw-ef73.3: a fade in from black, a dissolve (xfade), a dip through black (a fade out, then a fade in) and a fade out
/// to the end, at 25 fps; each found frame-accurately (+-1 frame: the codec rounds the steps).
#[test]
fn transitions_on_a_generated_clip() {
  if !have_ffmpeg() {
    return;
  }
  let t = tempfile::tempdir().unwrap();
  let cache = Cache { root: t.path().join("cache"), limit: LIMIT };
  let v = t.path().join("fades.mp4");
  let o = v.to_string_lossy().into_owned();
  // a: testsrc 3 s faded in over 0-0.8 s (clean from frame 20); b: testsrc2 3 s faded out over its last 0.5 s; a->b
  // dissolve at 2.0 s for 0.6 s (frames 50-64; b starts at 50): ab = 125 frames, b's fade out from frame 113 (112 the
  // last clean one); c: rgbtestsrc 3 s faded in over 0.5 s (its frame 0 black = 125, clean from 138) and out from 2.2 s
  // (180 the last clean one). 200 frames.
  let src = "testsrc=s=320x180:r=25:d=3,format=yuv420p,fade=t=in:st=0:d=0.8[a];\
             testsrc2=s=320x180:r=25:d=3,format=yuv420p,fade=t=out:st=2.5:d=0.5[b];[a][b]xfade=transition=fade:duration=0.6:offset=2[ab];\
             rgbtestsrc=s=320x180:r=25:d=3,format=yuv420p,fade=t=in:st=0:d=0.5,fade=t=out:st=2.2:d=0.8[c];[ab][c]concat=n=2:v=1";
  ff(&["-v", "error", "-f", "lavfi", "-i", src, "-c:v", "mpeg4", "-q:v", "2", "-y", &o]);
  let r = crate::repeats::repeats(&cache, &Job::default(), &v, &|_| {}).unwrap();
  assert_eq!(r.frames, 200);
  let got: Vec<(&str, i64, i64)> = r.transitions.iter().map(|x| (x.kind.as_str(), x.f0, x.f1)).collect();
  let near = |a: i64, b: i64| (a - b).abs() <= 1;
  let want = [("fade-in", -1, 20), ("dissolve", 49, 65), ("through-black", 112, 138), ("fade-out", 180, 200)];
  assert_eq!(got.len(), want.len(), "{got:?}");
  for (g, w) in got.iter().zip(want) {
    assert!(g.0 == w.0 && near(g.1, w.1) && near(g.2, w.2), "{got:?} vs {want:?}");
  }
  let tb = &r.transitions[2];
  assert!(tb.b0.is_some() && tb.tm > tb.ts && tb.tm < tb.t1.unwrap(), "{tb:?}");
  assert_eq!(r.transitions[3].t1, None);
}

/// Dev measurement, not a check: PAWSCRIPT_REPEATS_VIDEOS="a.mp4;b.mp4" cargo test --lib repeats_measure -- --ignored --nocapture
#[test]
#[ignore]
fn repeats_measure() {
  let t = tempfile::tempdir().unwrap();
  let cache = Cache { root: t.path().join("cache"), limit: LIMIT };
  for v in std::env::var("PAWSCRIPT_REPEATS_VIDEOS").unwrap_or_default().split(';').filter(|s| !s.is_empty()) {
    let job = Job::default();
    let p = media::probe(&cache, &job, Path::new(v)).unwrap();
    let t0 = std::time::Instant::now();
    let r = crate::repeats::repeats(&cache, &job, Path::new(v), &|_| {}).unwrap();
    let s = t0.elapsed().as_secs_f64();
    let occ: usize = r.buckets.iter().map(|b| b.len()).sum();
    let frames: usize = r.buckets.iter().flatten().map(|o| o.f1 - o.f0 + 1).sum();
    let ex = r.buckets.iter().max_by_key(|b| b.len()).map(|b| b.iter().take(3).map(|o| o.f0).collect::<Vec<_>>());
    println!("REPEATS {} | {:.1} s video | {} frames | {} buckets | {} ticks | {} frames in buckets | {:.2} s = {:.2} s/min | biggest {:?}",
      Path::new(v).file_name().unwrap().to_string_lossy(), p.duration_ms / 1000.0, r.frames, r.buckets.len(), occ, frames, s, s / (p.duration_ms / 60000.0), ex);
    for x in &r.transitions {
      println!("TRANSITION {} f0={} f1={} ts={:.0} tm={:.0} t1={:?} black={:?}..{:?}", x.kind, x.f0, x.f1, x.ts, x.tm, x.t1, x.b0, x.b1);
    }
  }
}
/// Every frame's mean luma in presentation order (one grey pixel a frame, every frame as the file has it).
fn lumas(v: &str) -> Vec<f64> {
  let raw = ffmpeg::output(&Job::default(), Tool::Ffmpeg, &args(["-v", "error", "-i", v, "-vf", "scale=1:1:flags=area", "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"])).unwrap();
  raw.iter().map(|b| *b as f64).collect()
}

/// paw-b88b: the frame reader's MP4 of any video: VP8 (CFR, VFR, a first frame 1.5 s in), Theora and MPEG-2 are
/// transcoded to H.264, VP9 and H.264 stream-copied, 10-bit H.264 transcoded when asked (`h264`); frame N of the MP4 is
/// frame N of the source at the same time from the first frame (the luma-coded clip: frame N has luma 8N).
#[test]
fn remux_reads_any_codec_with_the_same_frames() {
  if !have_ffmpeg() {
    return;
  }
  let enc = String::from_utf8_lossy(&ffmpeg::output(&Job::default(), Tool::Ffmpeg, &args(["-hide_banner", "-encoders"])).unwrap()).into_owned();
  let t = tempfile::tempdir().unwrap();
  let cache = Cache { root: t.path().join("cache"), limit: LIMIT };
  let job = Job::default();
  let lum = "color=c=black:s=64x48:r=10:d=3,format=gray,geq=lum='N*8',format=yuv420p";
  // (file, extra filter, encoder args, transcode asked, codec of the MP4)
  let cases: [(&str, &str, &[&str], bool, &str); 8] = [
    ("cfr.webm", "", &["-c:v", "libvpx", "-b:v", "1M"], false, "h264"),
    ("vfr.webm", ",select='not(between(n,10,19))'", &["-c:v", "libvpx", "-b:v", "1M"], false, "h264"),
    ("late.webm", ",setpts=PTS+15", &["-c:v", "libvpx", "-b:v", "1M"], false, "h264"),
    ("theora.ogv", "", &["-c:v", "libtheora", "-q:v", "8"], false, "h264"),
    ("mpeg2.ts", "", &["-c:v", "mpeg2video", "-q:v", "2"], false, "h264"),
    ("vp9.webm", "", &["-c:v", "libvpx-vp9", "-b:v", "1M"], false, "vp9"),
    ("h264.mkv", "", &["-c:v", "libx264", "-crf", "10"], false, "h264"),
    ("h264-10.mkv", "", &["-c:v", "libx264", "-crf", "10", "-pix_fmt", "yuv420p10le"], true, "h264"),
  ];
  for (name, vf, codec, h264, want) in cases {
    let lib = codec[1];
    if lib.starts_with("lib") && !enc.contains(lib) {
      eprintln!("SKIP {name}: ffmpeg has no {lib}");
      continue;
    }
    let v = t.path().join(name);
    let o = v.to_string_lossy().into_owned();
    let src = format!("{lum}{vf}");
    ff(&[&["-v", "error", "-f", "lavfi", "-i", src.as_str(), "-fps_mode", "passthrough"][..], codec, &["-y", o.as_str()]].concat());
    let (ev, emit) = events();
    let out = media::remux(&cache, &job, &v, h264, &emit).unwrap_or_else(|e| panic!("{name}: {e:?}"));
    assert!(matches!(ev.lock().unwrap().last(), Some(Event::Progress { fraction, .. }) if *fraction == 1.0), "{name}");
    let p = media::probe(&cache, &job, Path::new(&out)).unwrap();
    let pv = p.video.as_ref().unwrap();
    assert_eq!(pv.codec, want, "{name}");
    if want == "h264" {
      assert_eq!(pv.pix_fmt.as_deref(), Some("yuv420p"), "{name}");
    }
    let from0 = |x: Vec<f64>| x.iter().map(|t| t - x[0]).collect::<Vec<f64>>();
    let (a, b) = (from0(media::frame_times(&cache, &job, &v, &|_| {}).unwrap()), from0(media::frame_times(&cache, &job, Path::new(&out), &|_| {}).unwrap()));
    assert_eq!(a.len(), b.len(), "{name}: frame count");
    assert!(a.iter().zip(&b).all(|(x, y)| (x - y).abs() < 0.5), "{name}: times {a:?} vs {b:?}");
    let (la, lb) = (lumas(&o), lumas(&out));
    assert_eq!(la.len(), lb.len(), "{name}: decoded frames");
    assert!(la.iter().zip(&lb).all(|(x, y)| (x - y).abs() < 4.0), "{name}: lumas {la:?} vs {lb:?}");
    assert_eq!(media::remux(&cache, &job, &v, h264, &|_| {}).unwrap(), out, "{name}: cached");
  }
  // a copy that WebCodecs cannot decode, asked again as H.264: its own entry beside the copy
  let v = t.path().join("h264-10.mkv");
  if v.is_file() {
    let copy = media::remux(&cache, &job, &v, false, &|_| {}).unwrap();
    assert_eq!(media::probe(&cache, &job, Path::new(&copy)).unwrap().video.unwrap().pix_fmt.as_deref(), Some("yuv420p10le"));
    assert_ne!(copy, media::remux(&cache, &job, &v, true, &|_| {}).unwrap());
  }
}

/// paw-mh1a: a scrub cache whose full size alone would pass the cache limit is made smaller instead of refused (named
/// `scrub-<height>.mp4`, every frame kept), and found again without a rebuild.
#[test]
fn scrub_cache_too_big_for_the_limit_is_made_smaller() {
  if !have_ffmpeg() {
    return;
  }
  let t = tempfile::tempdir().unwrap();
  let job = Job::default();
  let v = t.path().join("noisy.mp4");
  let o = v.to_string_lossy().into_owned();
  ff(&["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x480:r=25:d=4,noise=alls=40:allf=t", "-c:v", "mpeg4", "-q:v", "2", "-y", &o]);
  let big = Cache { root: t.path().join("a"), limit: LIMIT };
  let full = media::scrub_cache(&big, &job, &v, &|_: Event| {}).unwrap();
  assert!(full.ends_with("scrub.mp4"), "{full}");
  let bytes = std::fs::metadata(&full).unwrap().len();
  let small = Cache { root: t.path().join("b"), limit: bytes / 2 };
  let out = media::scrub_cache(&small, &job, &v, &|_: Event| {}).unwrap();
  let h: u32 = out.rsplit("scrub-").next().unwrap().trim_end_matches(".mp4").parse().unwrap_or_else(|_| panic!("{out}"));
  assert!(h < 480 && std::fs::metadata(&out).unwrap().len() <= bytes / 2, "{out}: {} of {bytes}", std::fs::metadata(&out).unwrap().len());
  let (pf, ps) = (media::probe(&big, &job, Path::new(&full)).unwrap(), media::probe(&small, &job, Path::new(&out)).unwrap());
  assert_eq!(ps.video.as_ref().unwrap().height, h);
  assert_eq!(ps.video.unwrap().frame_count, pf.video.unwrap().frame_count, "every frame kept");
  assert_eq!(media::scrub_cache(&small, &job, &v, &|_: Event| {}).unwrap(), out, "found again, not rebuilt");
}
