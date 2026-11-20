// dev/proxy-frames-probe.mjs -- paw-nydn: does a proxy (src-tauri/src/media.rs proxy_args, copied below) keep every frame of its source
// at the time the app's clock puts it? Makes small clips whose frames carry their own index as 10 bars (bit i = bar i, white = 1):
// CFR 30, NTSC 30000/1001 with B-frames, VFR (30 then 20 fps, timescale 1/1000), a first frame 66 ms in (MP4), MPEG-TS starting
// at 1.4 s, an AVI with B-frames; proxies each at 480 and 240; then compares, frame by frame, the app's frame table of the source
// (packet pts - container start, media.rs frame_times) shifted to start at 0 (player.svelte.js #proxyStart = -times[0]) with the
// proxy's own table, and the index painted in each.
//   node dev/proxy-frames-probe.mjs <scratch dir> [more clips, e.g. dev/assets/vfr.mp4 (make-clips.sh)]   exits 1 on any mismatch
// Below-normal priority, ffmpeg -threads 4. ponytail: the proxy args are copied from media.rs proxy_args; keep them in step.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import os from 'node:os';

const dir = process.argv[2];
if (!dir) { console.error('usage: node dev/proxy-frames-probe.mjs <scratch dir>'); process.exit(2); }
mkdirSync(dir, { recursive: true });
try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* children inherit it */ }
const run = (exe, args) => {
  const r = spawnSync(exe, args, { windowsHide: true, maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`${exe} ${args.join(' ')}\n${r.stderr}`);
  return r.stdout;
};
const ff = (a) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
const W = 320, H = 240, N = 90;
const bars = `color=c=black:s=${W}x${H}:r=30:d=${N / 30},format=gray,geq=lum='255*mod(floor(N/pow(2\\,floor(X*10/W)))\\,2)',format=yuv420p`;
const tone = ['-f', 'lavfi', '-i', `sine=f=440:d=${N / 30}`];
const x264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-threads', '4'];

const clips = {
  'cfr30.mp4': () => [...['-f', 'lavfi', '-i', bars], ...tone, ...x264, '-bf', '0', '-c:a', 'aac', '-shortest'],
  'ntsc-bframes.mp4': () => [...['-f', 'lavfi', '-i', bars.replace('r=30', 'r=30000/1001')], ...tone, ...x264, '-bf', '3', '-c:a', 'aac', '-shortest'],
  'vfr.mp4': () => [...['-f', 'lavfi', '-i', bars], ...tone, '-vf', "settb=1/1000,setpts='if(lt(N,45),N*1000/30,1500+(N-45)*50)/1000/TB'", '-fps_mode', 'passthrough', ...x264, '-bf', '2', '-video_track_timescale', '1000', '-c:a', 'aac'],
  'late66.mp4': () => [...['-f', 'lavfi', '-i', bars], ...tone, '-vf', 'setpts=PTS+0.066/TB', '-fps_mode', 'passthrough', ...x264, '-c:a', 'aac', '-shortest'],
  'late.ts': () => [...['-f', 'lavfi', '-i', bars], ...tone, ...x264, '-c:a', 'aac', '-shortest', '-f', 'mpegts'],
  'bframes.avi': () => ['-f', 'lavfi', '-i', bars, '-c:v', 'mpeg4', '-q:v', '2', '-bf', '2', '-threads', '4', '-f', 'avi'],
};

// media.rs proxy_args (paw-ef73.15), -threads 4 added for this probe
const proxyArgs = (src, h, out) => ['-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-vf', `scale=-2:'min(${h},trunc(ih/2)*2)',setpts=PTS-STARTPTS`,
  '-fps_mode', 'passthrough', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-g', '30', '-bf', '0', '-threads', '4',
  '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', out];

/** Every decoded frame's time (best effort timestamp) minus the container start, the timeline the app counts on; and the size
 *  of the app's own frame table (media.rs frame_times: packet pts, not discarded, deduped), which can differ (see `app`). */
function table(f) {
  const start = +String(run('ffprobe', ['-v', 'error', '-show_entries', 'format=start_time', '-of', 'csv=p=0', f])).trim() || 0;
  const col = (what) => String(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', what, '-of', 'csv=p=0', f])).split(/\r?\n/).map((l) => l.trim().split(',')).filter((r) => r[0]);
  const t = col('frame=best_effort_timestamp_time').map(([p]) => +p * 1000 - start * 1000);
  const pk = col('packet=pts_time,flags').filter(([p, fl = '']) => p !== 'N/A' && !fl.includes('D')).map(([p]) => +p);
  return { start: start * 1000, times: t, app: new Set(pk).size };
}
/** The index painted in each decoded frame, in presentation order. */
function indices(f) {
  const raw = run('ffmpeg', ['-v', 'error', '-i', f, '-map', '0:v:0', '-fps_mode', 'passthrough', '-vf', `scale=${W}:${H},crop=${W}:2:0:${H / 2}`, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1']);
  const out = [];
  for (let o = 0; o + W * 2 <= raw.length; o += W * 2) { let n = 0; for (let i = 0; i < 10; i++) if (raw[o + Math.floor((i + 0.5) * W / 10)] > 128) n |= 1 << i; out.push(n); }
  return out;
}

/** dev/assets/make-clips.sh clips: a 12-bit code as 20 px squares at the top of a 640 x 360 picture (LSB left). */
function squares(f) {
  const raw = run('ffmpeg', ['-v', 'error', '-i', f, '-map', '0:v:0', '-fps_mode', 'passthrough', '-vf', 'scale=640:360,crop=640:1:0:18', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1']);
  const out = [];
  for (let o = 0; o + 640 <= raw.length; o += 640) { let n = 0; for (let b = 0; b < 12; b++) if (raw[o + 22 + b * 25] > 128) n |= 1 << b; out.push(n); }
  return out;
}
/** Where the sound starts against the first picture (ms): a proxy re-times only the video (setpts), so this can change. */
function avStart(f, first) {
  const a = String(run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=start_time', '-of', 'csv=p=0', f])).trim();
  const start = +String(run('ffprobe', ['-v', 'error', '-show_entries', 'format=start_time', '-of', 'csv=p=0', f])).trim() || 0;
  return a && a !== 'N/A' ? +a * 1000 - start * 1000 - first : null;
}

// the generated clips, then any clip named after the scratch dir (dev/assets/make-clips.sh ones: read by their squares)
const list = [...Object.entries(clips).map(([name, args]) => ({ name, src: join(dir, name), args, read: indices })),
  ...process.argv.slice(3).map((src) => ({ name: basename(src), src, read: squares }))];
const fmt = (x) => (x == null ? 'no sound' : x.toFixed(1) + ' ms');
let bad = 0;
for (const { name, src, args, read } of list) {
  if (args) ff([...args(), src]);
  const s = table(src), si = read(src);
  for (const h of [480, 240]) {
    const px = join(dir, `${name}.proxy${h}.mp4`);
    const t0 = performance.now();
    ff(proxyArgs(src, h, px));
    const secs = (performance.now() - t0) / 1000;
    const p = table(px), pi = read(px);
    const want = s.times.map((x) => x - s.times[0]);
    let worst = 0, off = 0, idx = 0, untimed = 0;
    for (let k = 0; k < Math.min(want.length, p.times.length); k++) {
      const d = Math.abs(p.times[k] - want[k]);
      if (Number.isNaN(d)) { untimed++; if (pi[k] !== si[k]) idx++; continue; }   // a source frame with no timestamp (AVI B-frames)
      worst = Math.max(worst, d);
      // a frame is "off" when the proxy's frame k sits nearer another source frame than frame k
      if (d > 0.5 * Math.min(want[k + 1] - want[k] || Infinity, k ? want[k] - want[k - 1] : Infinity)) off++;
      if (pi[k] !== si[k]) idx++;
    }
    const ok = p.times.length === s.times.length && pi.length === si.length && !off && !idx;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} -> ${h}p (${secs.toFixed(1)} s): frames ${s.times.length} / proxy ${p.times.length} (app frame table: source ${s.app}, proxy ${p.app}); source start ${s.start.toFixed(1)} ms, first frame ${s.times[0].toFixed(1)} ms; `
      + `worst time difference ${worst.toFixed(3)} ms, frames nearer a neighbour ${off}${untimed ? `, source frames with no timestamp ${untimed}` : ''}; painted index differs ${idx} (decoded ${si.length} / ${pi.length}); proxy first ${pi.slice(0, 3)} last ${pi.slice(-2)}; sound vs first picture: source ${fmt(avStart(src, s.times[0]))}, proxy ${fmt(avStart(px, p.times[0]))}`);
  }
}
process.exit(bad ? 1 : 0);
