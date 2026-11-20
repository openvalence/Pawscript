// dev/part-depth-check.mjs -- paw-4c48.19: the SAM depth measurement on any painted part, in YOUR test instance (node
// dev/test-app.mjs start ...; the CDP_* env it prints), on a generated clip (any 8 s video). One shot with c2_forearm_r and c1_anus
// painted (no penis); T with the fake sidecar's fake.groups (test/fake-pawtrack.mjs: a group sent with `depth` gets the shaft
// pass's channels under its own name, record role 'part', strokes 1.2 s). It asserts, on what is painted / read:
//  1. nothing turned on: the run has no depth part; the source menu has no "Forearm R"; the depth chip only fusion | pick | pair
//     | shaft; the source chip as it was;
//  2. the Groups tool (Tab): the forearm's row has the depth glyph (off, its kit tip says it applies on the next Track); clicking it
//     sets the group's depth flag (remembered on the group), one undo step;
//  3. track again: the run measures the forearm (role part); the source chip did not change by itself; the menu lists "Forearm R"
//     (enabled); picking it: the shot plays 'part:c2_forearm_r', the chip reads "forearm R N %", the points follow its strokes;
//  4. the shaft data band (turned on) shows the forearm's readings; the position bar's rail is the forearm's (railFor: part), the
//     overlay's shaft is the forearm's;
//  5. paw-3atc: a shot flipped with F, then the part picked (its flip cleared: derive.unflip), then an Adjust edit (setDerive axis):
//     the cleared flip stays cleared;
//  6. with the shot back on Fused, the depth chip offers "forearm R" and picking it seats the fusion on it.
// Every page exception and console error fails it.
//   node dev/part-depth-check.mjs <clip.mp4> <out dir>
import { existsSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';
import { runCtl } from './run-bar.mjs';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node dev/part-depth-check.mjs <clip.mp4> <out dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const clip = join(resolve(out), `partdepth-${Date.now()}.mp4`);
copyFileSync(src, clip);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
const SQ = (x, y, w = 0.12, h = 0.12) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const chip = () => page.locator('button.chip.src');
const menuItem = (name) => page.locator('[role="menu"] [role="menuitemradio"]').filter({ hasText: new RegExp(`^\\s*${name}(\\s*$| — )`) });
const closeMenu = async () => { await page.keyboard.press('Escape'); await wait(250); };
const tipOf = async (loc) => {
  for (let n = 0; n < 3; n++) {
    const b = await loc.boundingBox();
    if (n) { await page.mouse.move(b.x + b.width / 2, b.y - 3 * b.height, { steps: 3 }); await wait(400); }
    for (let k = 0; k < 6; k++) { await page.mouse.move(b.x + 4 + k, b.y + b.height / 2); await wait(80); }
    await wait(1500);
    const t = await ev(() => { const t = document.querySelector('.k-tip'); return t?.matches(':popover-open') ? t.textContent : ''; });
    if (t) return t;
  }
  return '';
};
const track = () => ev(async () => { const tr = window.__pawDev.trackingFor(app); await tr.list(); tr.selectTracker('fake.groups'); app.doc.range = { t0: 0, t1: 8000 }; app.player.seek(500); for (let k = 0; k < 75 && !tr.canTrack; k++) await new Promise((r) => setTimeout(r, 200)); await tr.track(); });
const lastRun = () => ev(() => {   // (lib/shaft.js partNames / shaftNames, inlined: the built page exposes no module)
  const tr = window.__pawDev.trackingFor(app), r = tr.runs.at(-1);
  tr.select(r.id);
  const rec = r.scenes?.[0]?.shaft || null, measured = Object.keys(r.channels || {}).filter((k) => /^sem_[a-z0-9_]+_in$/.test(k) && r.channels[k.slice(0, -3) + '_in_conf']).map((k) => k.slice(4, -3));
  const part = (n) => (r.scenes || []).some((s) => s?.shaft?.[n]?.role === 'part');
  return { id: r.id, parts: measured.filter(part), shafts: measured.filter((n) => !part(n)), rec };
});

try {
  await page.reload();
  await page.waitForFunction(() => window.app?.project && window.__pawDev?.trackingFor, null, { timeout: 60000 });
  for (const f of ['.pawproj', '.pawruns']) { const p = clip.replace(/\.[^.]+$/, f); if (existsSync(p)) rmSync(p); }
  const p = ev((c) => app.project.openVideo(c, { force: true }), resolve(clip));
  for (let k = 0; k < 40 && !(await ev(() => !!(app.doc.media && app.player.ready))); k++) { await wait(500); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
  await ev((g) => {
    app.devicePreview.toggle(false);
    app.player.setUi({ posBar: true });
    app.setMode('track'); app.player.pause();
    app.transact('shot', () => { app.doc.scenes = [{ start_ms: 0, end_ms: 8000, tags: ['penetration'], groups: g }]; });
    app.settings.set('video.posbar.shaft:' + app.doc.media.path, { on: true, labels: false });
  }, [{ name: 'c2_forearm_r', who: 'c2', part: 'forearm', side: 'r', poly: SQ(0.3, 0.45), pinned: true, t_ms: 500, source: 'user' },
      { name: 'c1_anus', who: 'c1', part: 'anus', poly: SQ(0.6, 0.45), pinned: true, t_ms: 500, source: 'user' }]);

  // ---- 1. nothing turned on ----
  await track();
  await page.waitForFunction(() => !window.__pawDev.trackingFor(app).busy, null, { timeout: 90000 });
  const r0 = await lastRun();
  ok(!r0.parts.length && !r0.shafts.length, `nothing turned on: no depth part, no shaft in the run (parts ${JSON.stringify(r0.parts)})`);
  await ev(() => { window.TR = window.__pawDev.trackingFor(app); app.player.seek(1500, { exact: true }); }); await wait(600);
  const chip0 = (await chip().textContent()).trim();
  await chip().click(); await wait(400);
  ok(await menuItem('Forearm R').count() === 0, `the source menu has no "Forearm R" (chip "${chip0}")`);
  await closeMenu();

  // ---- 2. the Groups tool's depth glyph ----
  await ev(() => app.player.seek(500, { exact: true })); await wait(300);
  await page.keyboard.press('Tab'); await wait(800);
  // the slim Groups bar (paw-i5qx) lists the groups only when its list is opened
  if (!(await page.locator('[data-testid="groups-list"]').count())) { await page.click('[data-testid="groups-list-open"]').catch(() => {}); await wait(400); }
  const glyph =page.locator('[data-testid="groups-depth"][aria-label*="orearm"]');
  ok(await glyph.count() === 1, `the Groups tool shows the forearm's depth glyph (glyphs in all: ${await page.locator('[data-testid="groups-depth"]').count()})`);
  const tip = await tipOf(glyph.first());
  // (the tip's wording since 6543984, paw-i5qx)
  ok(/measure its depth with SAM/i.test(tip) && /next Track/i.test(tip), `its tip: "${tip.slice(0, 140)}"`);
  ok((await glyph.first().getAttribute('aria-pressed')) === 'false', 'off by default');
  await glyph.first().click(); await wait(400);
  const flag = await ev(() => app.doc.scenes[0].groups.find((g) => g.name === 'c2_forearm_r')?.depth);
  ok(flag === true && (await glyph.first().getAttribute('aria-pressed')) === 'true', `clicked: the group's depth flag is ${flag}`);
  await page.keyboard.press('Tab'); await wait(600);

  // ---- 3. track again: the forearm measured, offered, picked ----
  await track();
  await page.waitForFunction(() => !window.__pawDev.trackingFor(app).busy, null, { timeout: 90000 });
  const r1 = await lastRun();
  ok(r1.parts.join() === 'c2_forearm_r' && r1.rec?.c2_forearm_r?.role === 'part', `the run measures ${JSON.stringify(r1.parts)} (role ${r1.rec?.c2_forearm_r?.role}, receiver ${JSON.stringify(r1.rec?.c2_forearm_r?.receiver)})`);
  await ev(() => app.player.seek(1500, { exact: true })); await wait(800);
  await runCtl(page);   // paw-k8pe: the run's row is the lane toolbar's (its tail in a … popover)
  const chip1 = (await chip().textContent()).trim();
  ok(!/forearm/i.test(chip1), `the source chip did not move to it by itself ("${chip1}")`);
  await chip().click(); await wait(400);
  const item = menuItem('Forearm R');
  ok(await item.count() === 1 && (await item.getAttribute('aria-disabled')) !== 'true', 'the source menu lists "Forearm R", enabled');
  await item.click(); await wait(1200);
  const st = await ev(() => { const r = TR.selected, i = TR.sceneOf(r); return { src: TR.shotSource(r, i), ch: r.sceneChannels?.[0], info: r.partSrc?.c2_forearm_r?.[0], pts: Array.from(r.points0?.pos || []) }; });
  await runCtl(page); const chip2 = (await chip().textContent()).trim();
  ok(st.src === 'part:c2_forearm_r' && st.ch === 'part:c2_forearm_r', `picked: the shot plays ${st.src} (channel ${st.ch})`);
  ok(/forearm R \d+ %/.test(chip2), `the chip reads "${chip2}"`);
  const lo = Math.min(...st.pts), hi = Math.max(...st.pts);
  ok(st.pts.length >= 8 && hi - lo > 40, `the points follow its strokes: ${st.pts.length} points, ${lo.toFixed(0)} .. ${hi.toFixed(0)}`);

  // ---- 4. the data band, the rail, the overlay ----
  await ev(() => app.settings.set('tracking.shaftData', true)); await wait(800);
  const band = await ev(() => { const R = TR.shaftReadings(TR.selected, 0); return { part: R.part, reading: R.reading, el: !!document.querySelector('[data-testid="shaft-data"]') }; });
  ok(band.el && band.part === 'c2_forearm_r' && !!band.reading, `the shaft data band shows the forearm (${JSON.stringify(band)})`);
  const rail = await ev(async () => { app.player.seek(1500, { exact: true }); await new Promise((r) => setTimeout(r, 400)); const R = TR.railFor(1500), cv = document.querySelector('canvas.pbar'); return { part: R.part, name: R.ctx?.name, mode: cv?.dataset.mode, ov: TR.shaftAt(1500)?.name }; });
  ok(rail.part === 'c2_forearm_r' && rail.name === 'c2_forearm_r' && /^shaft/.test(rail.mode || '') && rail.ov === 'c2_forearm_r', `the rail and the overlay are the forearm's: ${JSON.stringify(rail)}`);

  // ---- 5. paw-3atc: the cleared flip survives an Adjust edit ----
  await ev(() => TR.setSource('fused')); await wait(500);
  await ev(() => { app.player.seek(1500, { exact: true }); TR.flipAtPlayhead(); }); await wait(700);
  await ev(() => TR.setSource('part:c2_forearm_r')); await wait(700);
  const u1 = await ev(() => TR.shotDerive(0)?.unflip);
  await ev(() => TR.setDerive(0, { axis: { mode: 'horizontal' } })); await wait(700);
  const u2 = await ev(() => ({ unflip: TR.shotDerive(0)?.unflip, src: TR.shotDerive(0)?.source, axis: TR.shotDerive(0)?.axis?.mode }));
  ok(u1 === true && u2.unflip === true && u2.src === 'part:c2_forearm_r' && u2.axis === 'horizontal', `picking it cleared the flip (unflip ${u1}); after an Adjust edit still cleared (${JSON.stringify(u2)})`);

  // ---- 6. the depth chip on Fused ----
  await ev(() => TR.setSource('fused')); await wait(900);
  const dbtn = page.locator('[data-testid="fuse-depth-part:c2_forearm_r"]');
  await runCtl(page);
  const nB = await dbtn.count(), dTxt = nB ? (await dbtn.textContent()).trim() : '';
  ok(nB === 1 && dTxt === 'forearm R' && !(await dbtn.isDisabled()), `the depth chip offers "${dTxt}" (enabled)`);
  if (nB) { await dbtn.click(); await wait(900); }
  const dep = await ev(() => { const s = app.doc.scenes[0], d = (s.derives && s.derives[TR.selected.id]) || s.derive || null; return { now: d?.fuse?.depth, info: TR.selected.channels.fused?.depth?.[0] || null }; });
  ok(dep.now === 'part:c2_forearm_r' && !!dep.info && dep.info.from === 'part:c2_forearm_r', `the fusion's depth from it: ${JSON.stringify(dep)}`);
} catch (e) {
  fails++;
  console.log('FAIL', e.stack || e);
}
console.log(fails ? `${fails} FAIL` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
