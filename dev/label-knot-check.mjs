// dev/label-knot-check.mjs -- paw-k393: the knot brush on the image painter, in YOUR test instance (node dev/test-app.mjs start ..., then
// the CDP_* env it prints) on a folder of GENERATED images (two or more png). Real pointer and key input: paint a penis label, the knot
// button is on the bar, K turns the knot brush on, a knot stroke inside the penis -> no new group, the section inside the penis, drawn
// darker; the label file has the section on the penis; next image, back: the section is there again.
//   node dev/label-knot-check.mjs <image folder>
import { connectTestApp } from './cdp-connect.mjs';

const [folder] = process.argv.slice(2);
if (!folder) { console.error('usage: node dev/label-knot-check.mjs <image folder>'); process.exit(2); }
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms = 300) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const rect = () => ev(() => { const r = document.querySelector('[data-testid="label-stage"]').getBoundingClientRect(), b = app.labelling.player.bmp; return { x: r.x, y: r.y, w: r.width, h: r.height, iw: b?.width, ih: b?.height }; });
const at = async (fx, fy) => { const r = await rect(), s = Math.min(r.w / r.iw, r.h / r.ih), ox = r.x + (r.w - r.iw * s) / 2, oy = r.y + (r.h - r.ih * s) / 2; return [ox + fx * r.iw * s, oy + fy * r.ih * s]; };
const paint = async (a, b) => { const [x0, y0] = await at(...a), [x1, y1] = await at(...b); await page.mouse.move(x0, y0); await page.mouse.down(); for (let k = 1; k <= 12; k++) { await page.mouse.move(x0 + ((x1 - x0) * k) / 12, y0 + ((y1 - y0) * k) / 12); await wait(12); } await page.mouse.up(); await wait(300); const [ox, oy] = await at(0.02, 0.02); await page.mouse.move(ox, oy); await wait(250); };
/** The overlay's painted luminance at image point (fx, fy) (the topmost canvas over the stage that is not the picture). */
const lum = (fx, fy) => at(fx, fy).then(([X, Y]) => ev(([X, Y]) => {
  const cv = [...document.querySelectorAll('[data-testid="label-stage"] canvas')].find((c) => c.classList.contains('ov'));
  if (!cv) return null;
  const r = cv.getBoundingClientRect(), k = cv.width / r.width, d = cv.getContext('2d').getImageData(Math.round((X - r.left) * k), Math.round((Y - r.top) * k), 1, 1).data;
  return { a: d[3], lum: Math.round(0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]) };
}, [X, Y]));
const sec = (fx, fy) => ev(([fx, fy]) => { const G = app.labelling.G, g = G.groups[0], k = g && G.knotFor(g); return k ? k.a[Math.floor(fy * k.h) * k.w + Math.floor(fx * k.w)] : -1; }, [fx, fy]);
try {
  await page.waitForFunction(() => window.app?.commands, null, { timeout: 60000 });
  // a clean slate: open once, delete the test instance's labels, open again
  await ev((f) => app.commands.run('labelling.open', { folder: f }), folder);
  await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 30000 });
  await ev(async () => { await app.labelling.leave(); const d = await app.labelling.labelsDir(); for (const e of await app.backend.listDir(d).catch(() => [])) await app.backend.remove(e.path); });
  await ev((f) => app.commands.run('labelling.open', { folder: f }), folder);
  await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 30000 });
  await ev(() => { app.settings.set('tracking.groups.grow', false); app.settings.set('tracking.groups.snap', false); app.settings.set('tracking.groups.circle', false); });
  const idx0 = await ev(() => app.labelling.index);
  ok(await page.locator('[data-testid="groups-knot"]').isVisible(), 'the knot brush button is on the image painter\'s bar');
  // a penis label: arm the part, a real stroke across the picture
  await ev(() => app.labelling.G.pickPart('penis'));
  await paint([0.3, 0.5], [0.65, 0.5]);
  ok((await ev(() => app.labelling.groups.map((g) => g.name).join())) === 'c1_penis', 'a penis label painted: ' + await ev(() => app.labelling.groups.map((g) => g.name).join()));
  const before = await lum(0.36, 0.5);
  await page.keyboard.press('k'); await wait(200);
  ok(await ev(() => app.labelling.G.knotBrush), 'K: the knot brush is on');
  ok((await page.locator('[data-testid="groups-knot"]').getAttribute('aria-pressed')) === 'true', 'the button shows it');
  ok((await ev(() => app.labelling.index)) === idx0, 'K did not skip the image (Skip is L now)');
  await paint([0.33, 0.5], [0.4, 0.5]);
  const names = await ev(() => app.labelling.groups.map((g) => g.name).join());
  ok(names === 'c1_penis', 'no new group: ' + names);
  ok((await sec(0.37, 0.5)) >= 0.5 && (await sec(0.58, 0.5)) < 0.5, 'the section is where the knot brush went, not elsewhere');
  ok(await ev(() => { const G = app.labelling.G, g = G.groups[0], k = G.knotFor(g), m = G.maskFor(g); for (let i = 0; i < k.a.length; i++) if (k.a[i] > 0 && m.a[i] < 0.5) return false; return true; }), 'never outside the penis');
  const after = await lum(0.36, 0.5);
  ok(before && after && after.a > 0 && after.lum < before.lum, `drawn darker (luminance ${before?.lum} -> ${after?.lum})`);
  // saved: the label file carries the section on the penis
  await ev(() => app.labelling.flush());
  const file = await ev(async () => { const ws = app.labelling, d = await ws.labelsDir(); return JSON.parse(await app.backend.readText(d + '\\' + ws.current.key + '.json')); });
  ok(file.groups.length === 1 && file.groups[0].name === 'c1_penis' && file.groups[0].knot?.rle?.length > 0, 'the label file: one penis group with its knot section');
  // reload: another image, then back
  await page.keyboard.press('ArrowRight'); await page.waitForFunction((i) => app.labelling.ready && app.labelling.index !== i, idx0, { timeout: 15000 });
  ok((await ev(() => app.labelling.groups.length)) === 0, 'the next image starts empty');
  await page.keyboard.press('ArrowLeft'); await page.waitForFunction((i) => app.labelling.ready && app.labelling.index === i, idx0, { timeout: 15000 });
  await wait(400);
  ok((await ev(() => app.labelling.groups.map((g) => g.name).join())) === 'c1_penis' && (await sec(0.37, 0.5)) >= 0.5 && (await sec(0.58, 0.5)) < 0.5, 'back on the image: the penis label and its knot section are there');
  const again = await lum(0.36, 0.5);
  ok(again && again.lum < before.lum, `still drawn darker after the reload (luminance ${again?.lum})`);
  // Shift erases the knot, the penis stays
  await page.keyboard.down('Shift'); await paint([0.33, 0.5], [0.4, 0.5]); await page.keyboard.up('Shift');
  ok((await sec(0.37, 0.5)) < 0.5 && (await ev(() => { const G = app.labelling.G, m = G.maskFor(G.groups[0]); return m.a[Math.floor(0.5 * m.h) * m.w + Math.floor(0.37 * m.w)]; })) >= 0.5, 'Shift erased the knot, the penis untouched');
  await page.keyboard.press('k'); await wait(150);
  ok(!(await ev(() => app.labelling.G.knotBrush)), 'K again: back to the brush');
  await ev(() => app.labelling.leave());
} catch (e) { fails++; console.log('FAIL [threw]', e?.message || e); }
console.log(fails ? `${fails} FAILED` : 'all ok');
await browser.close().catch(() => {});
process.exit(fails ? 1 : 0);
