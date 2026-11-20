// dev/groups-snap-look.mjs -- paw-2kdm: the Groups brush's live edge snap in YOUR test instance (node dev/test-app.mjs
// start ...; the CDP_* env it prints), on a clip of flat shapes (ffmpeg drawbox: an orange square 300..600 x 200..500, a
// red bar, a green box on blue, 1280 x 720). Paints a rough blob over the square with synthetic pointer strokes, snap off
// then on, screenshots both (mid-stroke and after), reads the stored outline back and reports how far inside the square's
// edge it lies, plus the usage note's ms per update.
//   node dev/groups-snap-look.mjs <clip.mp4> <out dir>
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync } from 'node:fs';
const [clip, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser: b, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
await ev(async (p) => { app.dialog?.resolve('discard'); await app.project.openVideo(p, { force: true }); }, clip);
await page.waitForFunction(() => app.doc.media && (app.player.error || (app.player.ready && app.player.vw > 0)), null, { timeout: 60000 });
await ev(() => { app.setMode('track'); app.doc.scenes = [{ start_ms: 0, end_ms: 4000 }]; app.player.pause(); app.player.seek(1000, { exact: true }); });
await wait(1500);
if (!(await ev(() => !!document.querySelector('[data-testid="groups-tools"]')))) await ev(() => app.commands.run('tracking.groups')); await wait(300); await ev(() => app.settings.set('tracking.groups.corner', 'br')); await wait(500);
console.log('tool on:', await ev(() => !!document.querySelector('[data-testid="groups-tools"]')));
const box = await ev(() => { const r = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const at = (nx, ny) => [box.x + nx * box.w, box.y + ny * box.h];
const SQ = { x0: 300 / 1280, x1: 600 / 1280, y0: 200 / 720, y1: 500 / 720 };
const groups = () => ev(() => app.doc.scenes.flatMap((s) => s.groups || []).map((g) => ({ name: g.name, poly: g.poly })));
// a rough scrubbed blob: a spiral wider than the square on the right, tight on the left
async function scrub(shotTag) {
  const pts = [], X = (v) => v / 1280, Y = (v) => v / 720;   // a zigzag raster whose painted edge (path + brush ~29 px) lies ~5 px outside the square on every side
  for (let r = 0, y = 223; y <= 477; y += 36, r++) { const xs = r % 2 ? [577, 323] : [323, 577]; for (let k = 0; k <= 8; k++) pts.push([X(xs[0] + (xs[1] - xs[0]) * k / 8), Y(y)]); }
  await page.mouse.move(...at(...pts[0])); await page.mouse.down();
  for (let k = 1; k < pts.length; k++) { await page.mouse.move(...at(...pts[k])); if (k === 40) { await wait(80); await page.screenshot({ path: `${out}/${shotTag}-mid.png`, clip: { x: box.x, y: box.y, width: box.w, height: box.h } }); } }
  await page.mouse.up(); await wait(300);
  await page.screenshot({ path: `${out}/${shotTag}.png`, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
}
// signed distance of a polygon vertex inside the square (px of the 1280 x 720 frame; > 0 inside)
const inside = (p) => Math.min(p[0] - SQ.x0, SQ.x1 - p[0]) * 1280 < Math.min(p[1] - SQ.y0, SQ.y1 - p[1]) * 720 ? Math.min(p[0] - SQ.x0, SQ.x1 - p[0]) * 1280 : Math.min(p[1] - SQ.y0, SQ.y1 - p[1]) * 720;
const stats = (poly) => { const d = poly.map(inside); return { n: poly.length, minIn: +Math.min(...d).toFixed(1), maxIn: +Math.max(...d).toFixed(1), meanIn: +(d.reduce((s, v) => s + v, 0) / d.length).toFixed(1) }; };
for (const snap of [false, true]) {
  await ev((s) => app.settings.set('tracking.groups.snap', s), snap);
  await ev(() => { app.usage.log.length = 0; });
  await scrub(snap ? 'snap-on' : 'snap-off');
  const g = await groups();
  console.log(snap ? 'SNAP ON ' : 'SNAP OFF', JSON.stringify(g.map((q) => ({ name: q.name, ...stats(q.poly) }))));
  console.log((await ev(() => app.usage.log.filter((e) => e.kind === 'tracking:groupsSnap').map((e) => e.detail))).join('\n') || '(no snap note)');
  await ev(() => app.undo()); await wait(300);
}
await b.close();
