// dev/limbs-check.mjs -- paw-5r1 in YOUR test instance (node dev/test-app.mjs start ..., then the CDP_* env it prints) on GENERATED images
// in the labelling workspace (the Groups tool and its picker): the figure offers shoulder / forearm / shin on both sides and says "their L /
// their R"; a blob assigned by CLICKING the figure's forearm on the viewer's right is the character's L forearm (name, dock text, colour); a
// second blob is proposed as the R forearm (the fake sidecar proposes the named limb's part) and its context line says why; F flips it, F again
// back; Enter names it c1_forearm_r; leaving and opening the folder again keeps both.
//   node dev/limbs-check.mjs <image folder> <out dir>
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync } from 'node:fs';
import { groupColor } from '../src/features/tracking/colors.js';

const [folder, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms = 300) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
try {
  await page.waitForFunction(() => window.app?.commands, null, { timeout: 120000 });
  const rect = () => ev(() => { const r = document.querySelector('[data-testid="label-stage"]').getBoundingClientRect(), b = app.labelling.player.bmp; return { x: r.x, y: r.y, w: r.width, h: r.height, iw: b?.width, ih: b?.height }; });
  const at = async (fx, fy) => { const r = await rect(), s = Math.min(r.w / r.iw, r.h / r.ih), ox = r.x + (r.w - r.iw * s) / 2, oy = r.y + (r.h - r.ih * s) / 2; return [ox + fx * r.iw * s, oy + fy * r.ih * s]; };
  const paint = async (a, b) => { const [x0, y0] = await at(...a), [x1, y1] = await at(...b); await page.mouse.move(x0, y0); await page.mouse.down(); for (let k = 1; k <= 8; k++) await page.mouse.move(x0 + ((x1 - x0) * k) / 8, y0 + ((y1 - y0) * k) / 8); await page.mouse.up(); await wait(200); };
  const hover = async (f) => { const [x, y] = await at(...f); await page.mouse.move(x - 6, y - 3); await page.mouse.move(x, y); await wait(150); };
  const names = () => ev(() => app.labelling.groups.map((g) => g.name).join(' '));
  const open = async () => {
    await ev((f) => app.commands.run('labelling.open', { folder: f }), folder);
    await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 30000 });
  };
  await open();
  await ev(async () => { await app.labelling.leave(); const d = await app.labelling.labelsDir(); for (const e of await app.backend.listDir(d).catch(() => [])) await app.backend.remove(e.path); });
  await open();
  // blob 1 (on the picture's LEFT), then the picker on it: the forearm drawn on the figure's right = the character's L
  await paint([0.25, 0.4], [0.32, 0.4]);
  await hover([0.28, 0.4]); await page.keyboard.press('a');
  await page.waitForSelector('[data-testid="groups-picker"]', { timeout: 5000 });
  await wait(300);
  const fig = await ev(() => {
    const q = (p, s) => { const g = document.querySelector(`[data-testid="body-figure"] g[data-drop-part="${p}"][data-drop-side="${s}"]`); if (!g) return null; const r = g.querySelector('.hit').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, letter: g.querySelector('text:not(.nm)')?.textContent }; };
    const svg = document.querySelector('[data-testid="body-figure"] svg').getBoundingClientRect();
    return { svg: { x: svg.x, w: svg.width }, parts: Object.fromEntries(['shoulder', 'forearm', 'hand', 'thighs', 'shin', 'paws'].flatMap((p) => ['l', 'r'].map((s) => [p + s, q(p, s)]))), caps: [...document.querySelectorAll('[data-testid="body-figure"] .cap')].map((t) => [t.textContent, t.getBoundingClientRect().x]) };
  });
  ok(['shoulder', 'forearm', 'shin'].every((p) => fig.parts[p + 'l'] && fig.parts[p + 'r']), 'the figure has shoulder, forearm and shin targets on both sides');
  const mid = fig.svg.x + fig.svg.w / 2;
  ok(Object.entries(fig.parts).every(([k, r]) => r && (k.endsWith('l') ? r.x > mid - 1 : r.x + r.w < mid + 1) && r.letter === k.slice(-1).toUpperCase()), 'their L targets on the viewer\'s right, R on the left, each lettered with its own side');
  ok(fig.caps.length === 2 && fig.caps.find((c) => c[0] === 'their L')[1] > fig.caps.find((c) => c[0] === 'their R')[1], 'the captions say "their R" (left) and "their L" (right)');
  const fa = fig.parts.forearml;
  await page.mouse.move(fa.x + fa.w / 2, fa.y + fa.h / 2); await wait(200);
  const pk = await ev(() => { const r = document.querySelector('[data-testid="groups-picker"]').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  await page.screenshot({ path: out + '/l1-picker-forearm-l.png', clip: { x: Math.max(0, pk.x - 6), y: Math.max(0, pk.y - 6), width: pk.width + 12, height: pk.height + 12 } });
  await page.mouse.click(fa.x + fa.w / 2, fa.y + fa.h / 2); await wait(400);
  ok(await names() === 'c1_forearm_l', 'a click on the forearm drawn on the figure\'s right (their L) names it c1_forearm_l: ' + await names());
  // 6543984 (paw-i5qx): the groups' names are in the bar's list popover, not on the dock itself
  if (!(await page.locator('[data-testid="groups-list"]').count())) { await page.click('[data-testid="groups-list-open"]'); await wait(300); }
  const g0 = await ev(() => { const g = app.labelling.groups[0]; return { side: g.side, part: g.part, dock: document.querySelector('[data-testid="groups-list"]')?.innerText || '' }; });
  ok(g0.side === 'l' && g0.part === 'forearm', 'stored side l, part forearm');
  ok(/L forearm/.test(g0.dock), 'the dock reads "L forearm"');
  ok(await ev(() => app.labelling.G.groups.length) === 1, 'one group');
  const col = await ev(() => { const el = [...document.querySelectorAll('[data-testid="groups-list"] *')].find((e) => e.children.length === 0 && /L forearm/.test(e.textContent)); const row = el?.closest('[style*="--c"]') || el?.parentElement; return row ? getComputedStyle(row).getPropertyValue('--c').trim() : ''; });
  ok(!col || col.toLowerCase() === groupColor('c1_forearm_l').toLowerCase(), `its colour is the L forearm's (${col || 'no --c on the row'} vs ${groupColor('c1_forearm_l')})`);
  if (await page.locator('[data-testid="groups-list"]').count()) { await page.click('[data-testid="groups-list-open"]'); await wait(300); }   // the list closed again before painting on
  // blob 2 (on the picture's RIGHT): proposed as the R forearm, the context line says so
  await paint([0.7, 0.6], [0.78, 0.6]);
  await page.waitForFunction(() => app.labelling.G.proposals.size === 1, null, { timeout: 10000 });
  const p2 = await ev(() => { const G = app.labelling.G, g = G.groups[1]; return { part: G.proposalFor(g)?.parts[0]?.part, side: G.proposedSide(g) }; });
  ok(p2.part === 'forearm' && p2.side?.side === 'r' && p2.side.how === 'pair', 'the second forearm is proposed as R (the other limb): ' + JSON.stringify(p2));
  await hover([0.74, 0.6]);
  const ctx = await ev(() => document.querySelector('[data-testid="groups-context"]')?.textContent || '');
  ok(/character’s own L \/ R \(R: the other side is painted\)/.test(ctx), 'the context line says R and why: ' + ctx);
  await page.screenshot({ path: out + '/l2-second-proposed-r.png' });
  await page.keyboard.press('f'); await wait(200);
  ok(await ev(() => app.labelling.G.proposedSide(app.labelling.groups[1])?.side) === 'l', 'F flips the proposal to L');
  await page.keyboard.press('f'); await wait(200);
  ok(await ev(() => app.labelling.G.proposedSide(app.labelling.groups[1])?.side) === 'r', 'F again: R');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => app.labelling.groups.every((g) => !g.name.startsWith('unassigned')), null, { timeout: 10000 });
  await wait(300);
  await ev(() => app.labelling.show(0)); await wait(500);   // Enter may also have finished the picture (the next one is shown)
  ok(await names() === 'c1_forearm_l c1_forearm_r', 'Enter names it c1_forearm_r: ' + await names());
  await page.screenshot({ path: out + '/l3-both-named.png' });
  // save / reopen
  await ev(() => app.labelling.leave());
  await open();
  await ev(() => app.labelling.show(0)); await wait(500);
  const back = await ev(() => app.labelling.groups.map((g) => [g.name, g.side]));
  ok(JSON.stringify(back) === JSON.stringify([['c1_forearm_l', 'l'], ['c1_forearm_r', 'r']]), 'reopened: both kept with their sides: ' + JSON.stringify(back));
  await ev(() => app.labelling.leave());
  ok(!errs.length, `no console errors (${errs.slice(0, 2).join(' | ')})`);
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
