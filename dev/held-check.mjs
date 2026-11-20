// dev/held-check.mjs -- paw-rnv1 in the REAL window (your test instance: node dev/test-app.mjs start ...; CDP_* env). A
// synthetic two-character run whose parts are drawn on twos / threes (the Bottom on twos, the Top mixed), linked to 'fused'.
// It asserts what is painted:
//   1. Runs: the run carries a "twos / threes" badge whose kit tooltip names the characters and their drawings;
//   2. Adjust: a "Drawings" row with the chip pressed ("twos / threes: retimed"), no native title, its kit tooltip in words;
//   3. a click turns it off in ONE undo step (the shot's derive.held = false), the chip reads "as tracked", the lane trace
//      changes, the run's stored tracks are untouched; Ctrl+Z brings it back;
//   4. a run on ones has no badge and no Drawings row.
//   SHOT_DIR=<dir> node dev/held-check.mjs
import { connectTestApp } from './cdp-connect.mjs';

const shots = process.env.SHOT_DIR || null, FPS = 30, N = 360, END = Math.round((N * 1000) / FPS);
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const gauss = (r) => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());
function sched(kind, seed) {
  if (kind === '1') return Array.from({ length: N }, (_, i) => i);
  const r = rng(5 + seed), out = new Array(N);
  for (let i = 0; i < N;) { const s = kind === 'm' ? (r() < 0.5 ? 2 : 3) : +kind; for (let k = i; k < Math.min(N, i + s); k++) out[k] = i; i += s; }
  return out;
}
const stroke = (i) => Math.sin((2 * Math.PI * 1.2 * i) / FPS);
function chans(k1, k2) {
  const r = rng(3), d = { c1: sched(k1, 0), c2: sched(k2, 1) }, out = {};
  const parts = { c1_hips: (k) => [0.4, 0.55 - 0.02 * stroke(k)], c1_torso: (k) => [0.3, 0.45 - 0.008 * stroke(k)], c2_hips: (k) => [0.5, 0.5 + 0.03 * stroke(k)], c2_torso: (k) => [0.6, 0.35 + 0.01 * stroke(k)] };
  for (const [name, f] of Object.entries(parts)) {
    const dd = d[name.slice(0, 2)], xs = [], ys = [];
    for (let i = 0; i < N; i++) { const t = Math.round((i * 1000) / FPS), [x, y] = f(dd[i]); xs.push([t, x + 0.0004 * gauss(r)]); ys.push([t, y + 0.0004 * gauss(r)]); }
    out[`sem_${name}_x`] = xs; out[`sem_${name}_y`] = ys;
  }
  out.who_pair_proj = out.sem_c2_hips_y.map(([t, y], i) => [t, y - out.sem_c1_hips_y[i][1]]);
  return out;
}

const { browser, page } = await connectTestApp();
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('[pageerror]', String(e.message).slice(0, 300)); });
const shot = async (name, loc) => { if (shots) await (loc || page).screenshot({ path: `${shots}/${name}.png` }); };
const load = (ch) => page.evaluate(({ ch, END }) => {
  const D = window.__pawDev, tr = D.trackingFor(app);
  window.TR = tr;
  tr.runs = []; app.doc.ghosts = []; tr.select('');
  app.setMode('track');
  app.doc.media = { ...app.doc.media, width: 1920, height: 1080, hash: { algo: 'q1', value: 'heldcheck0001' } };
  app.doc.project = { ...(app.doc.project || {}), path: 'C:\\pawtest\\held-check.pawproj' };
  app.doc.scenes = [{ start_ms: 0, end_ms: END, tags: ['penetration'] }];
  const T = ch.who_pair_proj.map(([t]) => t);
  const run = D.makeRun({ n: 1, tracker: { id: 'tapnext_points', name: 'TAPNext++' }, params: { axis: 'auto' }, range: { start: 0, end: END }, roi: null,
    result: { samples: T.map((t) => [t, 0.5]), points: [{ at: 100, pos: 0 }, { at: END - 100, pos: 100 }], scenes: [{ start_ms: 0, end_ms: END, sign: 1 }], channels: ch, notes: [] },
    frames: D.newFrames(), runs: [] });
  tr.runs = [run];
  app.doc.ghosts = [tr.ghostOf(run)];
  tr.select(run.id);
  window.RID = run.id;
  app.setView({ start: 0, span: END });
  tr.linkScene(0, run.id, 'fused');
  app.player.seek(END / 2);
}, { ch, END });
const lane = () => page.evaluate(() => { const r = TR.runs[0]; return r.lane ? Array.from(r.lane.v.slice(0, 120)) : null; });
const stored = () => page.evaluate(() => Array.from(TR.runs[0].channels.sem_c2_hips_y.v.slice(0, 120)));
// 145370e (paw-p8o2): the shot's Adjust strip (its Drawings row) lives only in the band under the stroke lane: unfold it (its ▾)
const openBand = async () => {
  await page.waitForSelector('[data-testid="inspector-more"]:not([disabled])', { timeout: 15000 });
  await page.evaluate(() => { if (!document.querySelector('[data-testid="derive-strip"]')) document.querySelector('[data-testid="inspector-more"]')?.click(); });
  await page.waitForSelector('[data-testid="derive-strip"]', { timeout: 10000 });
};
try {
  await page.reload();
  await page.waitForFunction(() => window.app?.doc && window.__pawDev, null, { timeout: 30000 });
  await load(chans('2', 'm'));
  await openBand();
  const row = page.locator('[data-testid="held-row"]'), chip = page.locator('[data-testid="held-chip"]'), badge = page.locator('[data-testid="held-badge"]');
  await row.waitFor({ timeout: 15000 });
  await row.scrollIntoViewIfNeeded();
  const box = await chip.boundingBox();
  ok(box && box.width > 40 && box.height > 10, `the Drawings chip is painted (${box && Math.round(box.width)}x${box && Math.round(box.height)} px)`);
  ok((await chip.innerText()).trim() === 'twos / threes: retimed' && (await chip.getAttribute('aria-pressed')) === 'true', `the chip reads "${(await chip.innerText()).trim()}", pressed`);
  ok((await chip.getAttribute('title')) == null, 'no native title on the chip');
  await chip.hover(); await page.waitForFunction(() => document.querySelector('.k-tip')?.matches(':popover-open'), null, { timeout: 8000 }).catch(() => {});   // the tip shows 500 ms after the hover, later while the page computes
  const tip = await page.evaluate(() => [...document.querySelectorAll('[role=tooltip]')].map((e) => e.textContent).join(' | '));
  ok(/Bottom on twos: \d+ drawings in \d+ frames/.test(tip) && /Top on twos \/ threes/.test(tip), `its kit tooltip: ${tip.slice(0, 160)}`);
  await page.mouse.move(5, 5); await page.waitForTimeout(800);
  ok(await badge.count() === 1 && /twos \/ threes/i.test(await badge.innerText()), `the run's badge: "${(await badge.innerText().catch(() => '')).trim()}"`);
  await badge.scrollIntoViewIfNeeded(); await badge.hover();
  await page.waitForFunction(() => [...document.querySelectorAll('[role=tooltip]')].some((e) => /found from the painted parts/.test(e.textContent)), null, { timeout: 4000 }).catch(() => {});
  const btip = await page.evaluate(() => [...document.querySelectorAll('[role=tooltip]')].map((e) => e.textContent).join(' | '));
  ok(/found from the painted parts/.test(btip) && /Bottom on twos/.test(btip), `the badge's kit tooltip: ${btip.slice(0, 160)}`);
  await page.mouse.move(5, 5);
  await shot('held-row', row);
  const on = await lane(), s0 = await stored(), n0 = await page.evaluate(() => app._history.entries.length);
  await chip.click(); await page.waitForTimeout(800);
  const n1 = await page.evaluate(() => app._history.entries.length), d = await page.evaluate(() => { const s = app.doc.scenes[0]; return (s.derives && s.derives[RID]) || s.derive || null; });
  ok(n1 === n0 + 1 && d?.held === false, `off in one undo step: derive ${JSON.stringify(d)}`);
  ok((await chip.innerText()).trim() === 'twos / threes: as tracked' && (await chip.getAttribute('aria-pressed')) === 'false', `the chip reads "${(await chip.innerText()).trim()}"`);
  const off = await lane();
  const diff = on && off ? on.reduce((a, x, i) => a + (x === x && off[i] === off[i] ? Math.abs(x - off[i]) : 0), 0) : 0;
  ok(diff > 0.3, `the lane trace changes (sum |delta| over 4 s ${diff.toFixed(2)})`);
  ok(JSON.stringify(await stored()) === JSON.stringify(s0), 'the run keeps its tracks as tracked');
  await shot('held-off', row);
  await page.evaluate(() => app.undo ? app.undo() : app.commands.run('edit.undo')); await page.waitForTimeout(800);
  ok((await chip.innerText()).trim() === 'twos / threes: retimed', 'undo brings it back');
  await load(chans('1', '1'));
  await openBand();   // the strip shown, so "no Drawings row" is about the run, not a folded band
  await page.waitForTimeout(1500);
  ok(await page.locator('[data-testid="held-row"]').count() === 0 && await page.locator('[data-testid="held-badge"]').count() === 0, 'a run on ones: no badge, no Drawings row');
} catch (e) { fails++; console.log('FAIL', e.message); }
console.log(fails ? `${fails} failed` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
