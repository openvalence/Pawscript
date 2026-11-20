// dev/groups-layer-look.mjs -- paw-noy2: a part on another part, in YOUR test instance (CDP_* env; the fake sidecar answers `segment` with a
// deliberately RAGGED mask: a wavy fringe, a hole, a speck, a far island). On a GENERATED picture (an orange part) it hand-paints a "penis"
// group, turns grow on, Ctrl+dabs on top of it (a "knot"): one smooth blob over the parent, the parent untouched; Alt+click cycles
// the two; the saved label holds both shapes in full.
//   node dev/groups-layer-look.mjs <folder with the 1080p image> <out dir>
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
  await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 30000 });
  await ev(() => { const G = app.labelling.G; for (let k = G.groups.length - 1; k >= 0; k--) G.remove(k); app.settings.set('tracking.groups.snap', false); app.settings.set('tracking.groups.grow', false); app.settings.set('tracking.groups.brush', 0.05); app.settings.set('tracking.groups.compact', true); app.settings.set('tracking.groups.corner', 'tr'); });
  await wait(500);
  const rect = () => ev(() => { const r = document.querySelector('[data-testid="label-stage"]').getBoundingClientRect(), b = app.labelling.player.bmp; return { x: r.x, y: r.y, w: r.width, h: r.height, iw: b?.width, ih: b?.height }; });
  const at = async (px, py) => { const r = await rect(), s = Math.min(r.w / r.iw, r.h / r.ih), ox = r.x + (r.w - r.iw * s) / 2, oy = r.y + (r.h - r.ih * s) / 2; return [ox + px * s, oy + py * s]; };
  // the penis: a hand-painted band across the orange part
  const [a0, a1] = [await at(450, 620), await at(1000, 620)];
  await page.mouse.move(...a0); await page.mouse.down(); await page.mouse.move(...a1, { steps: 10 }); await page.mouse.up(); await wait(300);
  await ev(() => app.labelling.G.assign(0, { who: 'c1', part: 'penis', side: null })); await wait(200);
  const snapshot = () => ev(() => app.labelling.G.groups.map((g) => { const a = app.labelling.G.maskFor(g).a; let n = 0; for (let i = 0; i < a.length; i++) if (a[i] >= 0.5) n++; return { name: g.name, px: n }; }));
  const before = await snapshot();
  const penisMask = await ev(() => Array.from(app.labelling.G.maskFor(app.labelling.G.groups[0]).a).join(','));
  await page.keyboard.press('e'); await wait(200);
  ok(await ev(() => app.labelling.G.grow), 'grow is on');
  // Ctrl+dab on top of the penis: a new group painted over it
  const d = await at(700, 620);
  await page.keyboard.down('Control'); await page.mouse.move(...d); await page.mouse.down(); await page.mouse.up(); await page.keyboard.up('Control');
  await page.waitForFunction(() => app.labelling.G.groups.length === 2 && !app.labelling.G.growBusy, null, { timeout: 15000 }); await wait(300);
  await ev(() => { const G = app.labelling.G; G.assign(1, { who: 'c1', part: 'knot', side: null }); G.pick(1); }); await wait(300);
  const after = await snapshot();
  console.log('groups', JSON.stringify(before), '->', JSON.stringify(after));
  const mk = await ev(() => { const G = app.labelling.G, m = G.maskFor(G.groups[1]), p = G.maskFor(G.groups[0]); const w = m.w, h = m.h; let over = 0, comps = 0; const seen = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) if (m.a[i] >= 0.5 && p.a[i] >= 0.5) over++; for (let s = 0; s < w * h; s++) { if (m.a[s] < 0.5 || seen[s]) continue; comps++; const st = [s]; seen[s] = 1; while (st.length) { const i = st.pop(), x = i % w, y = (i / w) | 0; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && !seen[j] && m.a[j] >= 0.5) { seen[j] = 1; st.push(j); } } } let holes = 0; return { over, comps }; });
  ok(after.length === 2 && after[1].name === 'c1_knot', 'a knot group on top of the penis');
  ok(mk.comps === 1, `the knot is ONE piece (SAM's mask had a far island, a speck and a hole): ${mk.comps}`);
  ok(mk.over > 0.6 * after[1].px, `the knot sits over the penis, not clipped away from it: ${mk.over} of ${after[1].px} px overlap (the rest is beyond the band)`);
  ok((await ev(() => Array.from(app.labelling.G.maskFor(app.labelling.G.groups[0]).a).join(','))) === penisMask, 'the penis is exactly as it was');
  await ev(() => app.labelling.G.pick(-1)); await wait(200);
  await page.screenshot({ path: `${out}/layer-1-knot-on-penis.png` });
  await ev(() => app.labelling.G.pick(1)); await wait(300);
  await page.screenshot({ path: `${out}/layer-2-knot-active.png` });
  // Alt+click cycles: the topmost, then the one beneath
  const names = [];
  for (let i = 0; i < 3; i++) { await page.keyboard.down('Alt'); await page.mouse.move(...d); await page.mouse.down(); await page.mouse.up(); await page.keyboard.up('Alt'); await wait(200); names.push(await ev(() => app.labelling.G.activeGroup?.name)); }
  ok(new Set(names).size === 2, `Alt+click cycles the two groups under the pointer: ${names.join(' > ')}`);
  await page.screenshot({ path: `${out}/layer-3-penis-active.png` });
  // the saved label: leave, read the store
  await ev(() => app.labelling.leave()); await wait(800);
  const saved = await ev(async () => { const d = await app.labelling.labelsDir(); const files = (await app.backend.listDir(d)).filter((e) => e.name.endsWith('.json')); let best = null; for (const f of files) { const j = JSON.parse(await app.backend.readText(f.path)); if (j.groups?.length === 2) best = j; } if (!best) return null; return best.groups.map((g) => { let n = 0, tot = 0; for (let k = 0; k < g.mask.rle.length; k += 2) { tot += g.mask.rle[k + 1]; if (g.mask.rle[k] >= 8) n += g.mask.rle[k + 1]; } return { name: g.name, px: n, tot }; }); });
  console.log('saved label', JSON.stringify(saved));
  ok(saved && saved.length === 2 && Math.abs(saved[0].px - after[0].px) <= 2 && Math.abs(saved[1].px - after[1].px) <= 2, 'the saved label holds both shapes in full (the parent is not cut by the child)');
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
