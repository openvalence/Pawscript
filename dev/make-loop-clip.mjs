// dev/make-loop-clip.mjs -- paw-kxz4: an index clip with a real loop, for dev/loops-grid-check.mjs. Every picture is ONLY its id:
// 16 x 2 cells over the whole 640 x 360 frame (col 0 white, col 15 black, cols 1..14 = bits 13..0 of the id, the second row the
// inverse), so equal ids are equal pictures (the repeats detector finds them) and any screenshot of the video reads the id back.
// Picture ids: frame N < A shows N; A <= N < A + L x P shows A + (N - A) mod L (the loop: L pictures, P passes); later frames
// show 2000 + N. pts: --pts '<setpts expr>' (default N / fps; an owner clip's structure: '(N+2+gte(N,40))/(30*TB)':
// first frame 66.7 ms in, frame 40 dropped). Audio from 0, so the container starts at 0.
//   node dev/make-loop-clip.mjs <out> [--fps 30] [--secs 20] [--loop 200:24:3] [--pts expr] [--redraw F:A] [--webm | --mpeg4 (an mp4 the webview
//   cannot play: the app makes a proxy)]
import { spawnSync } from 'node:child_process';
const argv = process.argv.slice(2), opt = (k, d) => (argv.includes('--' + k) ? argv[argv.indexOf('--' + k) + 1] : d);
const out = argv[0], fps = opt('fps', '30'), secs = opt('secs', '20'), [A, L, P] = opt('loop', '200:24:3').split(':').map(Number), webm = argv.includes('--webm');
if (!out) { console.error('usage: node dev/make-loop-clip.mjs <out> [--fps 30] [--secs 20] [--loop A:L:P] [--pts expr] [--webm]'); process.exit(2); }
// paw-llaa: --segs 'A:L:F:B;...' instead: from frame A, F frames of an L-picture loop showing pictures B + (N - A) mod L (F need
// not be a whole number of passes); frames in no segment show 2000 + N. Several loops back to back, one footage used again later.
const segs = opt('segs', '').split(';').filter(Boolean).map((s) => s.split(':').map(Number));
const id = segs.length ? segs.reduceRight((e, [a, l, f, b]) => `if(between(N,${a},${a + f - 1}),${b}+mod(N-${a},${l}),${e})`, '2000+N')
  : `if(lt(N,${A}),N,if(lt(N,${A + L * P}),${A}+mod(N-${A},${L}),2000+N))`;
// paw-j3to: --redraw F:A: from frame F on a quarter of the cells (columns 1, 5, 9, 13) A grey brighter: the same pictures redrawn,
// close to them but never an exact repeat (the repeats detector allows 4 grey)
const [rdF, rdA] = opt('redraw', '').split(':').map(Number), rd = rdA > 0 ? `+if(gte(N,${rdF})*eq(mod(X,4),1),${rdA},0)` : '';
const bits = `geq=lum='min(255,if(eq(X,0),255*(1-Y),if(eq(X,15),255*Y,255*abs(Y-mod(floor((${id})/pow(2,14-X)),2))))${rd})'`;
const pts = opt('pts', `N/((${fps})*TB)`), gop = String(Math.round(2 * fps.split('/').reduce((a, b) => a / b)));
const enc = webm ? ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1M', '-g', gop, '-c:a', 'libopus', '-f', 'webm']
  : [...(argv.includes('--mpeg4') ? ['-c:v', 'mpeg4', '-q:v', '2'] : ['-c:v', 'libx264', '-preset', 'veryfast']), '-pix_fmt', 'yuv420p', '-bf', '0', '-g', gop, '-c:a', 'aac', '-f', 'mp4'];
const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-threads', '4',
  '-f', 'lavfi', '-i', `color=c=gray:s=16x2:r=${fps}:d=${secs},format=gray,${bits},scale=640:360:flags=neighbor,format=yuv420p,setpts='${pts}'`,
  '-f', 'lavfi', '-i', `sine=f=440:d=${secs}`,
  '-map', '0:v', '-map', '1:a', '-fps_mode', 'passthrough', '-copyts', '-threads', '4', ...enc, out], { stdio: 'inherit', windowsHide: true });
process.exit(r.status ?? 1);
