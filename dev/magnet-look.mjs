// dev/magnet-look.mjs -- paw-m2cg: the magnet's strength and its cost in YOUR test instance, on a GENERATED 1920 x 1080 picture
// (an orange cartoon part with a dark outline, a shading ring and a crossing line; a blue one beside it). In the labelling
// workspace: the wheel and a drag on the magnet button set the strength (setting tracking.groups.snapStrength); the same rough
// blob painted at strength 0 / 50 / 100 (screenshots, polygon area); ms per snap update as the app measures it.
//   node dev/magnet-look.mjs <folder with the image> <out dir>
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync } from 'node:fs';
const [folder, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms = 300) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
try {
  await page.waitForFunction(() => window.app?.commands, null, { timeout: 60000 });
  await ev((f) => app.commands.run('labelling.open', { folder: f }), folder);
  await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 20000 });
  await ev(() => { const G = app.labelling.G; for (let k = G.groups.length - 1; k >= 0; k--) G.remove(k); app.settings.set('tracking.groups.snap', true); app.settings.set('tracking.groups.brush', 0.05); app.settings.set('tracking.groups.compact', false); app.settings.set('tracking.groups.corner', 'br'); });
  await wait(700);
  const rect = () => ev(() => { const r = document.querySelector('[data-testid="label-stage"]').getBoundingClientRect(), b = app.labelling.player.bmp; return { x: r.x, y: r.y, w: r.width, h: r.height, iw: b?.width, ih: b?.height }; });
  const at = async (px, py) => { const r = await rect(), s = Math.min(r.w / r.iw, r.h / r.ih), ox = r.x + (r.w - r.iw * s) / 2, oy = r.y + (r.h - r.ih * s) / 2; return [ox + px * s, oy + py * s]; };
  // the strength by hand
  await ev(() => app.settings.set('tracking.groups.snapStrength', 50));
  const mag = page.locator('[data-testid="groups-snap-wrap"]');
  const bb = await mag.boundingBox();
  await page.mouse.move(bb.x + 10, bb.y + 10);
  await page.mouse.wheel(0, -100); await wait(200);
  const s1 = await ev(() => app.labelling.G.snapStrength);
  ok(s1 === 55, `wheel up on the magnet: 50 -> ${s1}`);
  await page.mouse.move(bb.x + 10, bb.y + 14); await page.mouse.down(); await page.mouse.move(bb.x + 10, bb.y - 40, { steps: 6 }); await page.mouse.up(); await wait(200);
  const s2 = await ev(() => app.labelling.G.snapStrength);
  ok(s2 > 80 && (await ev(() => app.labelling.G.snap)) === true, `a drag up on it: ${s1} -> ${s2}, the magnet stays on`);
  await page.keyboard.press(';'); await wait(100);
  ok((await ev(() => app.labelling.G.snapStrength)) === s2 - 10, 'the ; key steps it down 10');
  await page.locator('[data-testid="groups-snap"]').click(); await wait(150);
  ok((await ev(() => app.labelling.G.snap)) === false, 'a click toggles it off'); await page.locator('[data-testid="groups-snap"]').click(); await wait(150);
  // the same rough blob over the orange part at three strengths: a raster of strokes ~ 10 % outside the part's edge on the right
  const stats = [];
  for (const st of [0, 50, 100]) {
    await ev((v) => app.settings.set('tracking.groups.snapStrength', v), st);
    await ev(() => { const G = app.labelling.G; for (let k = G.groups.length - 1; k >= 0; k--) G.remove(k); });
    await wait(300);
    const rows = [350, 420, 490, 560, 630, 700, 760];
    const first = await at(420, rows[0]);
    await page.mouse.move(...first); await page.mouse.down();
    let flip = false;
    for (const y of rows) { const xs = flip ? [1090, 420] : [420, 1090]; flip = !flip; for (let k = 0; k <= 10; k++) { const [x, yy] = await at(xs[0] + ((xs[1] - xs[0]) * k) / 10, y); await page.mouse.move(x, yy); } }
    await page.mouse.up(); await wait(400);
    await page.screenshot({ path: `${out}/strength-${st}.png` });
    const r = await ev(() => { const G = app.labelling.G, g = G.groups[0], poly = g?.poly || []; let a = 0; poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }); return { n: poly.length, area: Math.abs(a / 2), notes: [G.lastSnap] }; });
    stats.push({ st, ...r });
    console.log(`strength ${st}: polygon ${r.n} vertices, area ${r.area.toFixed(4)}; snap note ${JSON.stringify(r.notes[0] || null)}`);
  }
  ok(stats[0].area > 0, 'painted at each strength');
  await ev(() => app.labelling.leave());
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
