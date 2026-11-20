// dev/stroker-check.mjs -- paw-un2p / paw-ttky: the Machine panel's Stroker mode in 3D, the owner's way, in YOUR test
// instance (node dev/test-app.mjs start ...; the CDP_* env it prints), or with a URL in headless Edge on a dev server.
//   node dev/stroker-check.mjs <clip.mp4 | shell.html URL> <out dir>
// A generated clip and a known script (1 s strokes, 0 <-> 100): click Stroker (3D by default), drag the tip handle (its
// projected screen point, along its projected direction), pick the open-ended short sleeve, drag the rail markers to the
// base (pos 0 at 0, pos 100 at 2 cm) and to the tip (5 .. 12.5 cm): the totals are the 2D view's (the model did not
// move) and the glans total rises; orbit to an angle and drag again; the named Quickshot pushed past the hilt (its glans
// leaves through the open end) and the closed Pilot pressed onto the tip (end contact) show in the totals line.
// The anatomy pass (paw-n2ms): the clear sleeve and its case, the pad handle on the mound, the classic pressed into the
// mound past the hilt (the dent, the root shown, "past hilt" in the totals).
// paw-iaai: upright by default; the realistic style; the soft sleeve (a ridge flattening as the glans passes, a closed
// end ballooning); a slider dragged updates the view before it is let go.
// paw-45rb: the realistic style's penis is the CC0 mesh (stroker-realistic-mesh-front / -side / -quarter).
// Screenshots stroker-up-clean / -up-realistic / -up-realistic-quickshot / -squish-1 / -squish-2 / -anat-press
// (+ stroker-3d-angle, stroker-edit); frame times playing in Machine vs Stroker 3D (both styles)
// (dev/perf/probe.mjs); no console errors.
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { install, mark, read } from './perf/probe.mjs';

const [target, OUT] = process.argv.slice(2);
if (!target || !OUT) { console.error('usage: node dev/stroker-check.mjs <clip.mp4 | shell.html URL> <out dir>'); process.exit(2); }
const harness = /^https?:/.test(target);
let browser, page;
if (harness) { browser = await chromium.launch({ channel: 'msedge', headless: true }); page = await browser.newPage({ viewport: { width: 1700, height: 1000 } }); await page.goto(target + '?mode=refine'); }
else ({ browser, page } = await (await import('./cdp-connect.mjs')).connectTestApp());
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource|Failed to fetch dynamically imported module/.test(m.text()) && !(harness && /Not allowed to load local resource|video\.scrubCache|posBar|sr6/.test(m.text()))) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });

const V = () => ev(() => window.__strokerView && JSON.parse(JSON.stringify(window.__strokerView)));
const canvasBox = () => ev(() => { const r = document.querySelector('.sk .stage canvas:not(.gl)').getBoundingClientRect(); return { x: r.x, y: r.y }; });
const handle = async (key) => (await V()).handles.find((x) => x[0] === key);
/** Drag a model handle by dx, dy px (a few steps, as a hand does). */
async function dragBy(key, dx, dy) {
  const h = await handle(key), b = await canvasBox(), x0 = b.x + h[1], y0 = b.y + h[2];
  await page.mouse.move(x0, y0); await wait(60); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(x0 + (dx * i) / 8, y0 + (dy * i) / 8); await wait(25); }
  await page.mouse.up(); await wait(300);
}
/** Drag a handle by mm along its own on-screen direction (px per mm from the view), corrected once. */
async function dragMmBy(key, mm) { const h = await handle(key); await dragBy(key, mm * h[3], mm * h[4]); }
async function railTo(key, z) {
  for (let k = 0; k < 2; k++) { const v = await V(), cur = key === 'down' ? v.rig.downMm : v.rig.upMm; if (Math.abs(cur - z) < 1) return; await dragMmBy(key, z - cur); }
}
const settled = async () => { await wait(400); await page.waitForFunction(() => window.__strokerView?.all?.strokes > 0, null, { timeout: 20000 }).catch(() => {}); await wait(700); return V(); };
const pct = (x) => `${(x * 100).toFixed(1)} %`;
const glans = (t) => t.share[0] + (t.share[3] || 0);   // the glans with its corona band
const shot = async (name) => { await page.mouse.move(2, 2); await wait(250); await page.locator('.sk').first().screenshot({ path: `${OUT}/${name}.png` }); };   // (no tooltip in the picture)
const pickSleeve = async (name) => { await page.locator('.sk .bar [role="combobox"]').click(); await wait(300); await page.getByRole('option', { name, exact: true }).click(); await wait(700); };

try {
  await page.waitForFunction(() => window.app?.project || window.app?.load, null, { timeout: 60000 });
  await wait(1500);
  if (!harness) { const p = ev((c) => app.project.openVideo(c, { force: true }), resolve(target)); await wait(1500); await ev(() => { const d = app.dialog; if (d) d.resolve(d.choices?.[0]?.id ?? null); }); await p; await wait(1500); }
  await ev(() => {
    const s = []; for (let k = 0; k < 40; k++) s.push({ at: 200 + k * 1000, pos: 100 }, { at: 700 + k * 1000, pos: 0 });
    if (app.edit && app.doc.media) app.edit('Stroker check script', 'stroke', s); else app.load({ axes: { stroke: s }, activeAxis: 'stroke' });
    app.setMode?.('refine');
    for (const k of ['stroker.body', 'stroker.rig', 'stroker.sleeve', 'stroker.sleeves', 'stroker.weights', 'stroker.cam', 'stroker.cut2d']) app.settings.set(k, null);
    app.settings.set('machine.mode', 'machine');
    app.showPanel('machine.view'); app.layout.size('right', 600); app.layout.size?.('timeline', 160);
    app.player.pause(); app.player.seek(12450);
  });
  await wait(2500);
  ok(await ev(() => !!document.querySelector('.mc .bar')), 'the Machine panel is up, in Machine mode');
  await install(page);
  const play = async () => { await ev(() => { app.player.seek(5000); app.player.play(); }); await wait(800); await mark(page); await wait(6000); const r = await read(page); const cost = await ev(() => window.__strokerView?.cost); await ev(() => app.player.pause()); return { ...r, cost }; };
  const perfMachine = await play();
  // 1. Stroker, in 3D
  await page.locator('.mc .bar').getByText('Stroker', { exact: true }).click();
  await wait(1200);
  const v3 = await V();
  ok(v3?.mode3d === true && (await ev(() => !!document.querySelector('.sk .stage canvas.gl') && app.settings.get('machine.mode') === 'stroker')), 'click Stroker: the 3D stage, remembered (machine.mode)');
  const perfStroker = await play();
  await ev(() => app.player.seek(12450)); await wait(700);
  // 2. the size: drag the tip 15 mm along its own direction
  const v0 = await V();
  await dragMmBy('tip', 15);
  const v1 = await V(), stored = await ev(() => app.settings.get('stroker.body'));
  ok(v1.body.lengthMm > v0.body.lengthMm + 8 && stored?.lengthMm === v1.body.lengthMm, `drag the tip in 3D: length ${v0.body.lengthMm} -> ${v1.body.lengthMm} mm, stored in settings`);
  ok(await ev(() => !(app.usage?.log || []).some((e) => /stroker\.body/.test(e.detail || ''))), 'the size is not in the usage log');
  for (let k = 0; k < 3 && (await V()).body.lengthMm !== 140; k++) await dragMmBy('tip', 140 - (await V()).body.lengthMm);
  console.log(`     length back to ${(await V()).body.lengthMm} mm`);
  // 3. the open-ended short sleeve; the base, then the tip (the same windows as the 2D check: the same totals)
  await pickSleeve('Open-ended short sleeve');
  ok((await V()).sleeve === 'open-short', 'picked the open-ended short sleeve');
  await railTo('up', 20); await railTo('down', 0);
  const base = await settled();
  console.log(`     base: rig ${JSON.stringify(base.rig)} glans+corona share ${pct(glans(base.all))}, sums ${base.all.sum.map((x) => x.toFixed(2)).join(' / ')}`);
  await railTo('up', 125); await railTo('down', 50);
  const tip = await settled();
  console.log(`     tip:  rig ${JSON.stringify(tip.rig)} glans+corona share ${pct(glans(tip.all))}, sums ${tip.all.sum.map((x) => x.toFixed(2)).join(' / ')}`);

  ok(Math.abs(base.rig.upMm - 20) <= 2 && Math.abs(tip.rig.downMm - 50) <= 2 && Math.abs(tip.rig.upMm - 125) <= 2, 'the markers landed where dragged (projected, along the rail)');
  ok(tip.all.sum[0] > 5 * Math.max(base.all.sum[0], 1e-3) && glans(tip.all) > 0.5 && glans(base.all) < 0.15, `glans total rises from the base to the tip (${base.all.sum[0].toFixed(2)} -> ${tip.all.sum[0].toFixed(2)}; glans+corona share ${pct(glans(base.all))} -> ${pct(glans(tip.all))})`);
  // (the model's numbers before / after the 3D rework: test/machine-stroker.test.mjs "the model numbers did not move")
  // 4. orbit to another angle (drag on empty space) and drag a marker there
  const b = await canvasBox();
  await page.mouse.move(b.x + 60, b.y + 60); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(b.x + 60 + i * 9, b.y + 60 + i * 5); await wait(20); }
  await page.mouse.up(); await wait(400);
  const ang = await V();
  ok(ang.cam && (Math.abs(ang.cam.az - tip.cam.az) > 10 || Math.abs(ang.cam.el - tip.cam.el) > 5), `orbit: az ${tip.cam.az.toFixed(0)} -> ${ang.cam.az.toFixed(0)}, el ${tip.cam.el.toFixed(0)} -> ${ang.cam.el.toFixed(0)}`);
  await railTo('up', 110);
  ok(Math.abs((await V()).rig.upMm - 110) <= 2, `a marker dragged at this angle lands (${(await V()).rig.upMm} mm)`);
  await shot('stroker-3d-angle');
  ok(await ev(() => app.settings.get('stroker.camUp')?.az != null), 'the camera is remembered per orientation (stroker.camUp)');
  // 5. past the hilt: the named Quickshot pushed 2 cm past it (its glans out of the open end at pos 0)
  await pickSleeve('Fleshlight Quickshot');
  await railTo('down', -20); await railTo('up', 40);
  const past = await settled();
  console.log(`     quickshot past hilt: rig ${JSON.stringify(past.rig)} ${past.view && JSON.stringify(past.all.share.map((x) => +x.toFixed(3)))} pastFrac ${past.all.pastFrac.toFixed(2)}`);
  ok(past.rig.downMm < -15 && past.all.pastFrac > 0.05, 'a marker past the hilt: past-hilt time in the totals');
  ok(/past hilt \d+ %/.test(await ev(() => document.querySelector('.sk .ro').innerText)), 'the totals line says "past hilt"');
  await ev(() => app.player.seek(700)); await wait(700);
  await shot('stroker-3d-past');
  // 5a. the Quickshot as picked (its own short window over the upper shaft and the glans): 3/4 and tip-on
  await pickSleeve('Ring stroker'); await pickSleeve('Fleshlight Quickshot');   // (a fresh pick: it was picked above)
  const qw = await V();
  ok(qw.rig.downMm > 40 && qw.rig.upMm - qw.rig.downMm < 80, `picking the Quickshot sets its window (${qw.rig.downMm} .. ${qw.rig.upMm} mm)`);
  ok((await V()).orient === 'up', 'upright by default');
  await ev(() => app.player.seek(12450)); await wait(900);
  await shot('stroker-up-clean');
  // the realistic style (the Look section's switch), on the Quickshot with its case, then a caseless long sleeve
  await page.locator('.sk').getByRole('button', { name: 'Look', exact: true }).click(); await wait(300);
  await page.locator('.sk').getByRole('radio', { name: 'Realistic', exact: true }).click(); await wait(900);
  ok((await V()).style === 'realistic', 'the Look section: Realistic');
  await shot('stroker-up-realistic-quickshot');
  // the soft sleeve on the Quickshot: the glans passing a ridge (a ridge flattened over it, springing back behind)
  await ev(() => app.player.seek(12620)); await wait(900);
  await shot('stroker-squish-1');
  await pickSleeve('Closed sleeve (long)');
  await ev(() => app.player.seek(12450)); await wait(900);
  await shot('stroker-up-realistic');
  // paw-45rb: the realistic style draws the CC0 mesh (the contact from its own profile): Front, Side, 3/4
  await page.waitForFunction(() => window.__strokerView?.mesh === true, null, { timeout: 10000 }).catch(() => {});
  ok((await V()).mesh === true, 'realistic: the penis mesh is loaded and drawn');
  for (const [k, label] of [['front', 'Front'], ['side', 'Side'], ['quarter', '3/4']]) { await page.locator('.sk .views').getByText(label, { exact: true }).click(); await wait(900); await shot(`stroker-realistic-mesh-${k}`); }
  // a closed end ballooning: the short closed sleeve pressed onto the tip at pos 0
  await pickSleeve('Closed sleeve (short)'); await railTo('down', 0); await railTo('up', 60);
  await ev(() => app.player.seek(12700)); await wait(900);
  const bal = await V();
  ok(harness || bal.endMm > 2, `the closed end pressed in ${bal.endMm?.toFixed(1)} mm (ballooning)`);
  await shot('stroker-squish-2');
  // a slider dragged: the view follows before the release (softness, in the Sleeve section)
  await page.locator('.sk').getByRole('button', { name: 'Sleeve', exact: true }).click(); await wait(300);
  const th = page.locator('.sk [role="slider"][aria-label="Softness"]').first(), tb = await th.boundingBox();
  const soft0 = (await V()).soft, f0 = (await V()).frames;
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2); await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(tb.x + tb.width / 2 + i * 12, tb.y + tb.height / 2); await wait(60); }
  const mid = await V();
  await page.mouse.up(); await wait(400);
  const after = await V();
  ok(Math.abs(mid.soft - soft0) > 0.04 && mid.frames > f0, `the softness slider updates the view while dragged (${soft0} -> ${mid.soft?.toFixed(2)} before the release, ${mid.frames - f0} frames)`);
  ok(Math.abs(after.soft - mid.soft) < 0.06 && (await ev(() => app.settings.get('stroker.sleeves')?.['closed-short']?.soft)) != null, 'and is stored on release');
  await page.locator('.sk').getByRole('button', { name: 'Sleeve', exact: true }).click(); await wait(200);
  await page.locator('.sk').getByRole('radio', { name: 'Clean', exact: true }).click(); await wait(500);
  await page.locator('.sk').getByRole('button', { name: 'Look', exact: true }).click(); await wait(200);
  await pickSleeve('Fleshlight Quickshot');
  // 5b. the pad: drag its handle on the mound 10 mm into the body (stored with the size, in settings only)
  const pad0 = (await V()).body.padMm;
  await dragMmBy('pad', 10);
  const pad1 = (await V()).body.padMm;
  ok(pad1 >= pad0 + 7 && (await ev(() => app.settings.get('stroker.body')?.padMm)) === pad1, `drag the pad handle: ${pad0} -> ${pad1} mm`);
  await dragMmBy('pad', pad0 - pad1);
  // 5c. the classic pressed into the mound past the hilt: the case dents it, the root shows, the totals say so
  await pickSleeve('Fleshlight (standard)');
  await railTo('down', -25); await railTo('up', 60);
  const press = await settled();
  await ev(() => app.player.seek(12700)); await wait(900);
  const pv = await V();
  ok(pv.padMm > 5 && pv.exposed > 145 && press.all.pastFrac > 0.05, `pressed: pad ${pv.padMm?.toFixed(1)} mm in, ${pv.exposed?.toFixed(1)} mm of shaft showing, past hilt ${pct(press.all.pastFrac)}`);
  await shot('stroker-anat-press');
  // the case toggle (the "..." menu)
  await page.locator('.sk .bar').getByRole('button', { name: /Import a sleeve/ }).click(); await wait(300);
  await page.getByRole('menuitemcheckbox', { name: 'Case' }).click(); await wait(500);
  ok((await ev(() => app.settings.get('stroker.case'))) === false, 'the Case toggle (off)');
  await ev(() => app.settings.set('stroker.case', null));
  // 6. a closed end pressed by the tip: the 130 mm closed sleeve down to the base of a 140 mm penis
  await pickSleeve('Closed sleeve (short)');
  await railTo('down', 0); await railTo('up', 60);
  const end = await settled();
  ok(end.all.endFrac > 0.05 && /end contact \d+ %/.test(await ev(() => document.querySelector('.sk .ro').innerText)), `a closed end pressed by the tip: end contact ${pct(end.all.endFrac)} of the time`);
  // the flat cutaway preset still works
  await page.locator('.sk .views').getByText('Cutaway', { exact: true }).click(); await wait(600);
  ok((await V()).mode3d === false, 'the Cutaway preset: the flat drawing');
  await page.locator('.sk .views').getByText('3/4', { exact: true }).click(); await wait(800);
  ok((await V()).mode3d === true, 'a 3D preset: back to 3D');
  for (const t of ['Sleeve', 'Sensitivity']) await page.locator('.sk').getByRole('button', { name: t, exact: true }).click().catch(() => {});
  await wait(500); await shot('stroker-edit');
  const f = (r) => `${r.fps} fps, p95 ${r.p95} ms, dropped ${r.dropped}, long tasks ${r.long} (${r.longMs} ms)${r.cost != null ? `, Stroker frame work ${r.cost.toFixed(2)} ms` : ''}`;
  console.log('     perf Machine: ' + f(perfMachine));
  console.log('     perf Stroker 3D: ' + f(perfStroker));
} catch (e) { fails++; console.log('FAIL', e?.stack || e); }
finally { if (harness) await browser.close(); else await browser.close().catch(() => {}); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
