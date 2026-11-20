// dev/groups-assign-look.mjs -- paw-m2cg: how the ACTIVE group reads in the labelling workspace of YOUR test instance
// (node dev/test-app.mjs start ..., then the CDP_* env it prints) on a GENERATED picture of 12 flat cartoon blobs (4 x 3, dark
// outlines, inner shading lines) on white or on dark. Paints a rough blob over each (snap off), selects one, opens the picker on
// it (A), hovers a part (its colour previews on the group), screenshots each state, zooms in so the group is off stage (the
// edge arrow), and checks the paw-r0wp rule (A off the groups' frame does nothing but nudge).
//   node dev/groups-assign-look.mjs <folder with ONE image> <out dir> <tag>
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync } from 'node:fs';

const [folder, out, tag = 'look'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms = 300) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
try {
  await page.waitForFunction(() => window.app?.commands, null, { timeout: 60000 });
  await ev((f) => app.commands.run('labelling.open', { folder: f }), folder);
  await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 20000 });
  await ev(async () => { const g = app.labelling.G.groups; for (let k = g.length - 1; k >= 0; k--) app.labelling.G.remove(k); });
  await ev(() => { app.settings.set('tracking.groups.snap', false); app.settings.set('tracking.groups.askAfter', false); app.settings.set('tracking.groups.brush', 0.06); app.settings.set('tracking.groups.compact', true); app.settings.set('tracking.groups.corner', 'tr'); });
  await wait(500);
  const rect = () => ev(() => { const r = document.querySelector('[data-testid="label-stage"]').getBoundingClientRect(), b = app.labelling.player.bmp; return { x: r.x, y: r.y, w: r.width, h: r.height, iw: b?.width, ih: b?.height }; });
  const at = async (fx, fy) => { const r = await rect(), s = Math.min(r.w / r.iw, r.h / r.ih), ox = r.x + (r.w - r.iw * s) / 2, oy = r.y + (r.h - r.ih * s) / 2; return [ox + fx * r.iw * s, oy + fy * r.ih * s]; };
  const stroke = async (a, b) => { const [x0, y0] = await at(...a), [x1, y1] = await at(...b); await page.mouse.move(x0, y0); await page.mouse.down(); for (let k = 1; k <= 6; k++) await page.mouse.move(x0 + ((x1 - x0) * k) / 6, y0 + ((y1 - y0) * k) / 6); await page.mouse.up(); await wait(120); };
  const names = () => ev(() => app.labelling.G.groups.map((g) => g.name));
  const shot = (n) => page.screenshot({ path: `${out}/${tag}-${n}.png` });
  // a dozen blobs: a short stroke through the middle of each cell (the brush is ~ the blob's size)
  await page.keyboard.press('1');
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) await stroke([(c + 0.43) / 4, (r + 0.5) / 3], [(c + 0.57) / 4, (r + 0.5) / 3]);
  const n0 = (await names()).length;
  ok(n0 === 12, `12 groups painted (${n0})`);
  // assign two so the rest are '? n' and the names differ
  await ev(() => { const G = app.labelling.G; G.assign(0, { who: 'c1', part: 'head', side: null }); G.assign(1, { who: 'c1', part: 'torso', side: null }); });
  await wait(300);
  // 1. just selected (active = 5): two-tone, thicker, a label, no veil
  await ev(() => { app.labelling.G.pick(5); }); await wait(400);
  await shot('1-selected');
  // 2. the picker on it (A with the pointer over it): veil, marching dashes, "assigning: pick a part"
  const [px, py] = await at((1 + 0.5) / 4, (1 + 0.5) / 3);
  await page.mouse.move(px, py); await wait(150); await page.keyboard.press('a'); await wait(500);
  const k = await ev(() => app.labelling.G.picker?.k);
  ok(k === 5, `A opened the picker on the group under the pointer (k=${k})`);
  await shot('2-assigning');
  // 3. a part hovered in the picker: its colour on the group, the label names it
  await page.locator('.gpick button', { hasText: /^knot$/ }).first().hover().catch(() => {});
  await wait(500);
  const hov = await ev(() => app.labelling.G.pickHover);
  ok(!!hov, `hovering a part in the picker previews it (${hov})`);
  await shot('3-preview');
  // timing: a frame of the veil drawing
  await page.keyboard.press('Escape'); await wait(300);
  ok(!(await ev(() => app.labelling.G.picker)), 'Esc closes the picker');
  // 4. zoomed in so the group is off stage: the edge arrow
  await ev(() => { const p = app.labelling.player; p.view = { ...p.view, mode: 'custom', zoom: 4, panX: 1200, panY: 700 }; });
  await wait(400);
  await ev(() => app.labelling.G.pick(10)); await wait(400);
  await shot('4-offstage');
  await ev(() => { const p = app.labelling.player; p.view = { ...p.view, mode: 'fit' }; }); await wait(300);
  await ev(() => app.labelling.leave());
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
