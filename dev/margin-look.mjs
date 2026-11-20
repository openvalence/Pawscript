// dev/margin-look.mjs -- paw-s63m: the paint margin in YOUR test instance (node dev/test-app.mjs start ..., the CDP_* env it prints) on a
// GENERATED 1920 x 1080 picture (python dev/margin-gen.py <out.png>: a large soft orange blob and a small magenta one, dark outlines).
// In the labelling workspace: the control beside the magnet (scroll, drag, the : and " keys), the live preview (a dashed line on the
// selected group while it changes; the painted mask never changes), then each part painted with the magnet and with circle to fill
// at the default and at 100 %: screenshots and the measured inset (px at 1080p) from the true edge.
//   node dev/margin-look.mjs <folder with the image> <out dir>
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync } from 'node:fs';

const [folder, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms = 300) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
// the picture's two parts (the same functions as margin-gen.py): centre, radius, phase (1920 x 1080 px)
const PARTS = { large: { cx: 700, cy: 520, R: 330, k: 0, brush: 0.05 }, small: { cx: 1450, cy: 700, R: 62, k: 1.3, brush: 0.02 } };
const edge = (p, th) => p.R * (1 + 0.07 * Math.cos(3 * th + p.k) + 0.04 * Math.sin(2 * th + 2 * p.k));
const truth = (p) => { const n = 720, pts = Array.from({ length: n }, (_, i) => { const th = (2 * Math.PI * i) / n, r = edge(p, th); return [p.cx + r * Math.cos(th), p.cy + r * Math.sin(th)]; }); let a = 0, per = 0; pts.forEach((q, i) => { const o = pts[(i + 1) % n]; a += q[0] * o[1] - o[0] * q[1]; per += Math.hypot(o[0] - q[0], o[1] - q[1]); }); return { area: Math.abs(a / 2), per }; };
try {
  await page.waitForFunction(() => window.app?.commands, null, { timeout: 120000 });
  await ev((f) => app.commands.run('labelling.open', { folder: f }), folder);
  await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 30000 });
  await ev(() => app.labelling.show(0));
  await page.waitForFunction(() => app.labelling.ready && app.labelling.index === 0, null, { timeout: 10000 });
  const clear = () => ev(() => { const G = app.labelling.G; while (G.groups.length) G.remove(0); });
  await ev(() => { const s = app.settings; s.set('tracking.groups.snap', true); s.set('tracking.groups.circle', false); s.set('tracking.groups.compact', false); s.set('tracking.groups.margin', 15); });
  await clear(); await wait(500);
  const rect = () => ev(() => { const r = document.querySelector('[data-testid="label-stage"]').getBoundingClientRect(), b = app.labelling.player.bmp; return { x: r.x, y: r.y, w: r.width, h: r.height, iw: b.width, ih: b.height }; });
  const at = async (px, py) => { const r = await rect(), s = Math.min(r.w / r.iw, r.h / r.ih), ox = r.x + (r.w - r.iw * s) / 2, oy = r.y + (r.h - r.ih * s) / 2; return [ox + px * s, oy + py * s]; };
  const stroke = async (pts) => { const P = []; for (const q of pts) P.push(await at(...q)); await page.mouse.move(...P[0]); await page.mouse.down(); for (let k = 1; k < P.length; k++) await page.mouse.move(...P[k]); await page.mouse.up(); await wait(450); };
  const margin = () => ev(() => app.labelling.G.margin);
  // ---- the control: scroll, drag, keys
  const ctl = page.locator('[data-testid="groups-margin"]');
  ok(await ctl.count() === 1 && (await ctl.innerText()).includes('15'), `the control sits beside the magnet and shows the default: "${(await ctl.innerText()).replace(/\s+/g, ' ')}"`);
  const bb = await ctl.boundingBox(), mb = await page.locator('[data-testid="groups-snap-wrap"]').boundingBox();
  ok(Math.abs(bb.y - mb.y) < 14 && bb.x > mb.x - 120 && bb.x < mb.x + 120, `beside the magnet (${Math.round(bb.x)},${Math.round(bb.y)} vs ${Math.round(mb.x)},${Math.round(mb.y)})`);
  await page.mouse.move(bb.x + 8, bb.y + 8); await page.mouse.wheel(0, -100); await wait(150);
  ok((await margin()) === 20, `wheel up: 15 -> ${await margin()}`);
  await page.mouse.wheel(0, 100); await wait(150);
  ok((await margin()) === 15, `wheel down: back to ${await margin()}`);
  await page.mouse.move(bb.x + 8, bb.y + 12); await page.mouse.down(); await page.mouse.move(bb.x + 8, bb.y - 50, { steps: 6 }); await page.mouse.up(); await wait(150);
  const m2 = await margin();
  ok(m2 > 40, `a drag up on it: 15 -> ${m2}`);
  await page.keyboard.press('Shift+Semicolon'); await wait(100);
  ok((await margin()) === m2 - 5, `: steps it down 5 (${m2} -> ${await margin()})`);
  await page.keyboard.press('Shift+Quote'); await wait(100);
  ok((await margin()) === m2, `" steps it up 5 (back to ${await margin()})`);
  await ev(() => app.settings.set('tracking.groups.margin', 15));
  // ---- the live preview: paint the large part, select it, change the margin: a dashed line, the painted mask untouched
  const L = PARTS.large;
  await ev((b) => app.settings.set('tracking.groups.brush', b), L.brush);
  await page.keyboard.press('1'); await page.locator('[data-testid="groups-parts"] button', { hasText: /^hips$/ }).click();
  const rows = []; for (let y = L.cy - L.R * 0.88; y <= L.cy + L.R * 0.88; y += 50) rows.push(y);
  const pts = []; let flip = false;
  for (const y of rows) { const half = Math.sqrt(Math.max(0, (L.R * 0.88) ** 2 - (y - L.cy) ** 2)); const xs = flip ? [L.cx + half, L.cx - half] : [L.cx - half, L.cx + half]; flip = !flip; for (let k = 0; k <= 8; k++) pts.push([xs[0] + ((xs[1] - xs[0]) * k) / 8, y]); }
  await stroke(pts);
  const sum = () => ev(() => { const G = app.labelling.G, m = G.maskFor(G.groups[G.active]); let s = 0; for (let i = 0; i < m.a.length; i++) s += m.a[i] * (1 + (i % 7)); return +s.toFixed(4); });
  const before = await sum();
  const bb2 = await ctl.boundingBox();
  await page.mouse.move(bb2.x + 8, bb2.y + 8); await page.mouse.wheel(0, -100); await wait(300);
  const prev = await ev(() => !!app.labelling.G.marginPreview());
  ok(prev, 'while the margin changes the selected group has a preview outline');
  await page.screenshot({ path: `${out}/preview.png` });
  ok((await sum()) === before, 'and the painted mask is unchanged by it');
  await wait(2800);
  ok(!(await ev(() => !!app.labelling.G.marginPreview())), 'the preview goes away after a moment');
  await ev(() => app.settings.set('tracking.groups.margin', 15));
  // ---- each part, each aid, default and 100 %
  const results = [];
  for (const [name, p] of Object.entries(PARTS)) {
    const T = truth(p);
    for (const aid of ['magnet', 'circle']) for (const mg of [0, 15, 100]) {
      await ev(([m, b, c]) => { const s = app.settings; s.set('tracking.groups.margin', m); s.set('tracking.groups.brush', b); s.set('tracking.groups.circle', c); s.set('tracking.groups.snap', true); }, [mg, p.brush, aid === 'circle']);
      await clear(); await wait(250);
      await page.keyboard.press('1');
      await page.locator('[data-testid="groups-parts"] button', { hasText: /^hips$/ }).click();
      if (aid === 'circle') {
        const loop = Array.from({ length: 61 }, (_, k) => { const th = -1.2 + (2 * Math.PI * 0.97 * k) / 60, r = p.R * (name === 'small' ? 0.93 : 0.9) * (1 + 0.02 * Math.sin(5 * th)); return [p.cx + r * Math.cos(th), p.cy + r * Math.sin(th)]; });
        await stroke(loop);
      } else if (name === 'large') await stroke(pts);
      else { const ring = []; for (const f of [0.15, 0.4, 0.68]) for (let k = 0; k <= 16; k++) { const th = (2 * Math.PI * k) / 16; ring.push([p.cx + p.R * f * Math.cos(th), p.cy + p.R * f * Math.sin(th)]); } await stroke(ring); }   // concentric rings: the painted edge ends a brush radius past the last, close to the part's edge
      const r = await ev(() => { const G = app.labelling.G, g = G.groups[0], m = g ? G.maskFor(g) : null; let a = 0; if (m) for (let i = 0; i < m.a.length; i++) a += m.a[i]; return { n: G.groups.length, a, poly: g?.poly?.length || 0, k: m ? 1920 / m.w : 6, fill: G.lastFill ? `${G.lastFill.mode}, grew ${G.lastFill.grew}, shrank ${G.lastFill.shrank}` : '' }; });
      const area = r.a * r.k * r.k, inset = (T.area - area) / T.per;   // px at 1080p: the mean distance of the painted edge inside the true edge
      const share = area / T.area;
      results.push({ name, aid, mg, inset, share, poly: r.poly });
      console.log(`${name} / ${aid} / margin ${mg}: painted ${(100 * share).toFixed(1)} % of the part, mean inset ${inset.toFixed(1)} px at 1080p, polygon ${r.poly} vertices${aid === 'circle' ? ` (fill: ${r.fill})` : ''}`);
      if (mg !== 0) {
        const k = name === 'small' ? 2.2 : 1.15, bx = await at(p.cx - p.R * k, p.cy - p.R * k), ex = await at(p.cx + p.R * k, p.cy + p.R * k);
        await page.screenshot({ path: `${out}/${name}-${aid}-${mg}.png`, clip: { x: Math.max(0, bx[0]), y: Math.max(0, bx[1]), width: Math.min(ex[0] - bx[0], 900), height: Math.min(ex[1] - bx[1], 900) } });
      }
    }
  }
  const get = (n, a, m) => results.find((q) => q.name === n && q.aid === a && q.mg === m);
  for (const n of ['large', 'small']) for (const a of ['magnet', 'circle']) {
    const [r0, r15, r100] = [0, 15, 100].map((m) => get(n, a, m));
    ok(r0.share >= r15.share - 0.005 && r15.share > r100.share, `${n} / ${a}: more margin, less of the part: ${[r0, r15, r100].map((q) => (100 * q.share).toFixed(1) + ' %').join(' > ')}`);
    ok(r15.share >= 0.9 * r0.share && r15.inset - r0.inset < 4, `${n} / ${a}: the default takes only ${(r15.inset - r0.inset).toFixed(1)} px at 1080p off the edge it would paint at 0 % (${(100 * r15.share).toFixed(1)} % of the part vs ${(100 * r0.share).toFixed(1)} %)`);
    ok(r15.poly >= 12, `${n} / ${a}: ${r15.poly} polygon vertices at the default (smooth)`);
  }
  await ev(() => { app.settings.set('tracking.groups.circle', false); app.settings.set('tracking.groups.margin', 15); return app.labelling.leave(); });
  ok(!errs.length, `no console errors (${errs.slice(0, 3).join(' | ')})`);
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
