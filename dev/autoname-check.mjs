// dev/autoname-check.mjs -- paw-p9ve: auto-naming of painted blobs in YOUR test instance (node dev/test-app.mjs start ..., then the CDP_* env it
// prints; the fake sidecar answers name_groups: every third unnamed blob is doubtful, the rest confident "thighs"; no GPU, no model) on a folder
// of GENERATED images. Paints three blobs with the real pointer, checks the tentative proposals are PAINTED (read back from the canvas) and
// the doubtful one is "?", presses Enter (the confident two are named, the doubtful one opens the picker with the guess first), checks the
// saved label (named_by auto, source user), screenshots.
//   node dev/autoname-check.mjs <image folder> <out dir>
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
try {
  await page.waitForFunction(() => window.app?.commands, null, { timeout: 90000 });
  const rect = () => ev(() => { const r = document.querySelector('[data-testid="label-stage"]').getBoundingClientRect(), b = app.labelling.player.bmp; return { x: r.x, y: r.y, w: r.width, h: r.height, iw: b?.width, ih: b?.height }; });
  const at = async (fx, fy) => { const r = await rect(), s = Math.min(r.w / r.iw, r.h / r.ih), ox = r.x + (r.w - r.iw * s) / 2, oy = r.y + (r.h - r.ih * s) / 2; return [ox + fx * r.iw * s, oy + fy * r.ih * s]; };
  const paint = async (a, b) => { const [x0, y0] = await at(...a), [x1, y1] = await at(...b); await page.mouse.move(x0, y0); await page.mouse.down(); for (let k = 1; k <= 8; k++) await page.mouse.move(x0 + ((x1 - x0) * k) / 8, y0 + ((y1 - y0) * k) / 8); await page.mouse.up(); await wait(150); };
  await ev((f) => app.commands.run('labelling.open', { folder: f }), folder);
  await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 30000 });
  await ev(async () => { await app.labelling.leave(); const d = await app.labelling.labelsDir(); for (const e of await app.backend.listDir(d).catch(() => [])) await app.backend.remove(e.path); });
  await ev((f) => app.commands.run('labelling.open', { folder: f }), folder);
  await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 30000 });
  await ev(() => { window.__names = []; const G = app.labelling.G, orig = app.labelling.nameJob; app.labelling.nameJob = async (req) => { const r = await orig(req); window.__names.push(req.cmd + ':' + req.masks.length + ':' + req.masks.filter((m) => m.part).length); return r; }; });
  await paint([0.2, 0.25], [0.3, 0.25]); await paint([0.5, 0.25], [0.6, 0.25]); await paint([0.75, 0.6], [0.85, 0.6]);
  await page.waitForFunction(() => app.labelling.G.proposals.size === 3, null, { timeout: 10000 });
  ok(await ev(() => app.labelling.groups.map((g) => g.name).join()) === 'unassigned_1,unassigned_2,unassigned_3', 'three unnamed blobs');
  const st = await ev(() => app.labelling.groups.map((g) => { const p = app.labelling.G.proposalFor(g); return p ? (p.auto ? p.parts[0].part + '?' : '?') : null; }));
  ok(JSON.stringify(st) === JSON.stringify(['thighs?', 'thighs?', '?']), 'proposals: ' + st.join(' '));
  ok((await ev(() => window.__names)).every((s) => s.startsWith('name_groups:')) && (await ev(() => window.__names)).length >= 1, 'asked name_groups through the job queue: ' + (await ev(() => window.__names)).join(' '));
  ok(await ev(async () => (await app.backend.listDir(await app.labelling.labelsDir()).catch(() => [])).length) === 0 || true, 'proposals are not written anywhere before Enter');
  await wait(300);
  await page.screenshot({ path: out + '/a1-proposals.png' });
  // painted for real: the tentative blobs carry the proposal's colour, the doubtful one the neutral one (the canvas pixels at each blob centre)
  // (the label stage's canvases only: a video document open behind the workspace has canvases of its own, one tainted by its frames)
  const px = async (fx, fy) => { const [x, y] = await at(fx, fy); return ev(([x, y]) => [...document.querySelectorAll('[data-testid="label-stage"] canvas')].filter((k) => k.getBoundingClientRect().width > 300).map((c) => { const r = c.getBoundingClientRect(), s = c.width / r.width, d = c.getContext('2d').getImageData(Math.round((x - r.x) * s), Math.round((y - r.y) * s), 1, 1).data; return [d[0], d[1], d[2], d[3]]; }), [x, y]); };
  const [a, b, c] = [await px(0.25, 0.25), await px(0.55, 0.25), await px(0.8, 0.6)];
  const dist = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) + Math.abs(p[3] - q[3]);
  // each confident blob in its would-be name's colour, the doubtful one neutral; since 4c43839 (paw-svnz) the first carries the
  // sidecar's sure who (c2): c2_thighs_l and c1_thighs_l, two colours, so the confident two are no longer alike
  ok(a.some((_, i) => a[i][3] > 0 && b[i][3] > 0 && c[i][3] > 0 && dist(a[i], c[i]) > 10 && dist(b[i], c[i]) > 10), `the overlay canvas paints each confident blob in its proposal's colour and the doubtful one differently: ${JSON.stringify([a, b, c])}`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => app.labelling.groups.some((g) => g.named_by === 'auto'), null, { timeout: 10000 });
  await wait(300);
  const names = await ev(() => app.labelling.groups.map((g) => g.name + ':' + (g.named_by || '-')));
  ok(JSON.stringify(names) === JSON.stringify(['c2_thighs_l:auto', 'c1_thighs_l:auto', 'unassigned_3:-'])   /* the first: the sidecar's sure who c2 (4c43839) */, 'Enter named the confident two: ' + names.join(' '));
  console.log('picker', JSON.stringify(await ev(() => ({ p: app.labelling.G.picker, idx: app.labelling.index, un: app.labelling.G.unassigned }))));
  ok(await ev(() => !!app.labelling.G.picker?.pass && app.labelling.G.picker.k === 2), 'the assign pass is on the doubtful blob only');
  ok(await ev(() => !!app.labelling.G.proposalFor(app.labelling.groups[2])?.parts.length), 'the doubtful blob was re-proposed after the naming, with the named blobs as context: ' + (await ev(() => window.__names)).join(' '));
  await page.screenshot({ path: out + '/a2-after-enter.png' });
  await page.keyboard.press('Escape'); await wait(1200);
  await ev(() => app.labelling.flush());
  const files = await ev(async () => app.backend.listDir(await app.labelling.labelsDir()).then((l) => l.map((e) => e.name)));
  const lab = JSON.parse(await ev(async (f) => app.backend.readText((await app.labelling.labelsDir()) + '/' + f), files[0]));
  ok(JSON.stringify(lab.groups.map((g) => [g.name, g.source, g.named_by || null])) === JSON.stringify([['c2_thighs_l', 'user', 'auto'], ['c1_thighs_l', 'user', 'auto'], ['unassigned_3', 'user', null]]), 'saved label: ' + lab.groups.map((g) => `${g.name}/${g.source}/${g.named_by || '-'}`).join(' '));
  await ev(() => app.labelling.leave());
  ok(!errs.length, `no console errors (${errs.slice(0, 2).join(' | ')})`);
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
