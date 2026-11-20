// dev/make-index-clip.mjs -- paw-bf4o: a clip whose every frame carries its own index, for dev/scrub-linear-check.mjs. The owner's
// structure: VP9 in WebM NAMED .mp4 (time base 1/1000, so pts 0, 22, 44, 67 ... at 45 fps), 1600 x 1400, GOP 455, opus audio. The
// top 200 px are 16 x 2 cells: col 0 white, col 15 black, cols 1..14 = bits 13..0 of the frame index, the second row the inverse.
//   node dev/make-index-clip.mjs <out.mp4> [seconds = 104] [fps = 45] [band y = 0]
// paw-3fal: band y 600 puts the cells in the middle of the picture (rows at 650 / 750 of 1400), clear of the filmstrip's labels.
import { spawnSync } from 'node:child_process';
const [out, secs = '104', fps = '45', bandY = '0'] = process.argv.slice(2);
if (!out) { console.error('usage: node dev/make-index-clip.mjs <out.mp4> [seconds] [fps] [band y]'); process.exit(2); }
const bits = "geq=lum='if(eq(X,0),255*(1-Y),if(eq(X,15),255*Y,255*abs(Y-mod(floor(N/pow(2,14-X)),2))))'";
const y = Math.max(0, Math.min(1200, Math.round(+bandY / 2) * 2)), stack = y ? `[1:v]split[s1][s2];[s1]crop=1600:${y}:0:0,format=yuv420p[t0];[s2]crop=1600:${1200 - y}:0:${y},format=yuv420p[t1];[t0][b][t1]vstack=3[v]` : '[1:v]format=yuv420p[t];[b][t]vstack[v]';
const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-threads', '4',
  '-f', 'lavfi', '-i', `color=c=gray:s=16x2:r=${fps}:d=${secs},format=gray,${bits}`,
  '-f', 'lavfi', '-i', `testsrc2=s=1600x1200:r=${fps}:d=${secs}`,
  '-f', 'lavfi', '-i', `sine=f=440:d=${secs}`,
  '-filter_complex', `[0:v]scale=1600:200:flags=neighbor,format=yuv420p[b];${stack}`,
  '-map', '[v]', '-map', '2:a', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-threads', '4', '-b:v', '3M',
  '-g', '455', '-keyint_min', '455', '-c:a', 'libopus', '-b:a', '64k', '-f', 'webm', out], { stdio: 'inherit', windowsHide: true });
process.exit(r.status ?? 1);
