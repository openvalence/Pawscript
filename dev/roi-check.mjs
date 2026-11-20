// dev/roi-check.mjs -- paw-x8we "track dick size": Track ROI = one painted part, in YOUR test instance (node dev/test-app.mjs
// start ...; the fake sidecar), on the groups-hide clip (dev/groups-hide-check.mjs --make <clip>: 1280 x 720, 4 s, one shot, an
// orange and a green box on blue). Real pointer strokes paint; real keys press Ctrl+T; asserted on the store, the toasts, the menu and
// what the canvases paint:
//  1. nothing painted: Ctrl+T says to paint the part and offers Groups (no run, nothing drawn on the video by a click or a drag);
//  2. the part painted on frame A, undo takes it away (no seed mark), redo brings it back (the mark);
//  3. Ctrl+T: ONE run, SAM (the panel's tracker is the grid's / takes no box), over the shot, its box = the painting's bounds +
//     10 %, its frame A; the seed mark on the timeline; Ctrl+T again replaces it;
//  4. a second part on frame B: Ctrl+T asks with a menu at the pointer: the last pick first and outlined on the video, ArrowDown
//     outlines the other; Esc cancels (no run); again, ArrowDown, Enter tracks that one;
//  5. the Groups tool open on a part: Ctrl+T tracks it, no menu;
//  6. an old-shape box run (a drawn box, made as before: trackRange with a box) is saved, the project reopened: it loads with its box
//     and its points; no part painted and it selected: Ctrl+T re-tracks it with its stored box.
//   node dev/roi-check.mjs <clip.mp4> <out dir>      (screenshots <out>/roi-*.png)
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';

const [clip, out] = process.argv.slice(2);
if (!clip || !out) { console.error('usage: node dev/roi-check.mjs <clip.mp4> <out dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const proj = clip.replace(/\.[^.]+$/, '.pawproj');
for (const f of [proj, clip.replace(/\.[^.]+$/, '.pawruns')]) if (existsSync(f)) rmSync(f);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /changed outside/.test(t) ? 'project' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
const open = async (project) => {
  const p = project ? ev((f) => app.project.openProject(f, { force: true }), project) : ev((c) => app.project.openVideo(c, { force: true }), clip);
  for (let k = 0; k < 8; k++) { await wait(500); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
};
const A = 1000, B = 2500;
const seek = async (t) => { await ev((t) => { app.player.pause(); app.player.seek(t, { exact: true }); }, t); await page.waitForFunction((t) => Math.abs(app.player.timeMs - t) < 20 && !app.player.el?.seeking, t, { timeout: 15000 }); await wait(400); };
const toolOn = async () => { await ev(() => { if (!window.__pawDev.groupsFor(app).on) app.commands.run('tracking.groups'); }); await page.waitForFunction(() => !!document.querySelector('[data-testid="groups-tools"]'), null, { timeout: 10000 }); await wait(300); };
const toolOff = async () => { await ev(() => { if (window.__pawDev.groupsFor(app).on) app.commands.run('tracking.groups'); }); await page.waitForFunction(() => !window.__pawDev.groupsFor(app).on, null, { timeout: 10000 }); await wait(300); };
const vbox = () => ev(() => { const r = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const at = (b, x, y) => [b.x + x * b.w, b.y + y * b.h];
const stroke = async (nx, ny) => {
  const b = await vbox();
  await page.mouse.move(...at(b, nx, ny)); await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(...at(b, nx + 0.006 * k, ny + 0.004 * k));
  await page.mouse.up(); await wait(500);
};
const runs = () => ev(() => __pawDev.trackingFor(app).runs.filter((r) => !r.tag).map((r) => ({ id: r.id, n: r.n, tracker: r.tracker?.id ?? r.tracker, name: r.name, roi: r.roi, range: r.range, samples: r.samples?.t?.length ?? 0 })));
const idle = () => page.waitForFunction(() => !window.__pawDev.trackingFor(app).busy, null, { timeout: 60000 }).then(() => wait(800));
// every toast the app says from now on (quiet ones too: they may never be painted)
const listen = () => ev(() => { if (app.__said) return; app.__said = []; const t = app.toast.bind(app); app.toast = (m, ...r) => { app.__said.push(String(m)); return t(m, ...r); }; });
const toasts = async () => { await listen(); return ev(() => app.__said.join(' | ')); };
const menuRows = () => ev(() => [...document.querySelectorAll('[role=menu] [role^=menuitem]')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
const ctrlT = async () => { await ev(() => document.activeElement?.blur?.()); await page.keyboard.press('Control+t'); await wait(500); };
// the Shots strip's seed tab at t (as dev/seedmarks-check.mjs)
const markAt = (t) => ev((t) => {
  const c = document.querySelector('[data-tl-lane="scenes"] canvas'), d = c.width / c.clientWidth;
  const probe = document.createElement('canvas').getContext('2d'); probe.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--intent').trim(); probe.fillRect(0, 0, 1, 1);
  const want = probe.getImageData(0, 0, 1, 1).data, ctx = c.getContext('2d'), v = app.view, w = c.clientWidth, h = c.clientHeight, x = ((t - v.start) / v.span) * w;
  return [x - 1, x, x + 1].some((X) => { const p = ctx.getImageData(Math.round(X * d), Math.floor((h - 7) * d), 1, 1).data; return Math.abs(p[0] - want[0]) + Math.abs(p[1] - want[1]) + Math.abs(p[2] - want[2]) < 40; });
}, t);
// the overlay canvas at a normalised video point: [r, g, b, a]
const px = (nx, ny) => ev(([nx, ny]) => {
  const cv = document.querySelector('[data-testid="video-stage"] canvas.ov'), r = cv.getBoundingClientRect(), k = cv.width / r.width, v = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect();
  return [...cv.getContext('2d').getImageData(Math.round((v.x - r.x + nx * v.width) * k), Math.round((v.y - r.y + ny * v.height) * k), 1, 1).data];
}, [nx, ny]);

try {
  await page.waitForFunction(() => window.app && window.__pawDev?.groupsFor, null, { timeout: 30000 });
  await open();
  const D = await ev(() => app.durationMs);
  await ev((D) => {
    app.setMode('track'); app.player.pause();
    app.doc.scenes = [{ start_ms: 0, end_ms: D }];
    for (const [k, v] of [['tracking.groups.snap', false], ['tracking.groups.circle', false], ['tracking.groups.grow', false], ['tracking.groups.askAfter', false], ['tracking.groups.brush', 0.05], ['tracking.scenes', 'document']]) app.settings.set(k, v);
    const tr = window.__pawDev.trackingFor(app);
    tr.runs = []; app.doc.ghosts = (app.doc.ghosts || []).filter((g) => g.source?.kind !== 'tracker');
    tr.selectTracker('fake.none');   // the panel's tracker takes no box (as the grid's after T): Track ROI takes SAM
    app.doc.range = null;
    app.setView({ start: 0, span: D });
  }, D);
  await page.waitForFunction(() => window.__pawDev.trackingFor(app).listed && window.__pawDev.trackingFor(app).trackerId === 'fake.none', null, { timeout: 30000 });

  // ---- 1. nothing painted ----
  await seek(A); await listen();
  const b0 = await vbox();
  await page.mouse.move(...at(b0, 0.3, 0.3)); await page.mouse.down(); await page.mouse.move(...at(b0, 0.5, 0.6), { steps: 6 }); await page.mouse.up();
  await page.mouse.click(...at(b0, 0.7, 0.7)); await wait(300);
  ok((await ev(() => __pawDev.trackingFor(app).roi)) === null, 'a drag and a click on the video in the Track tab make no ROI');
  ok(await ev(() => app.commands.enabled('track.run')), `Track ROI is enabled with nothing painted (it says what to do): ${await ev(() => app.commands.whyNot('track.run'))}`);
  await ctrlT();
  let tt = await toasts();
  ok(/tracks a painted part: paint it with Groups/.test(tt) && (await runs()).length === 0, `Ctrl+T, nothing painted: "${tt.slice(0, 160)}", no run`);
  const offer = page.getByRole('button', { name: 'Open Groups' });
  ok(await offer.count() > 0, 'the toast offers Open Groups');
  if (await offer.count()) { await offer.first().click(); await wait(400); }
  ok(await ev(() => window.__pawDev.groupsFor(app).on), 'Open Groups opens the tool');
  await shot('roi-1-nothing-painted');

  // ---- 2. paint the part on A; undo / redo ----
  await toolOn();
  await ev(() => { const g = window.__pawDev.groupsFor(app); g.setWho('c2'); g.pickPart('penis'); });
  await stroke(0.3, 0.45);
  await toolOff();
  const parts = () => ev(() => __pawDev.trackingFor(app).paintedParts().map((p) => p.name));
  ok(JSON.stringify(await parts()) === '["c2_penis"]', `one part painted: ${JSON.stringify(await parts())}`);
  await wait(300);
  ok(await markAt(A), 'its seed mark is painted on the Shots strip');
  await ev(() => app.commands.run('edit.undo')); await wait(500);
  ok((await parts()).length === 0 && !(await markAt(A)), `undo takes the part away, and its mark (${JSON.stringify(await parts())})`);
  await ev(() => app.commands.run('edit.redo')); await wait(500);
  ok((await parts()).length === 1 && (await markAt(A)), 'redo brings it back, and its mark');

  // ---- 3. Ctrl+T: one run of that part ----
  await seek(2000);
  await ctrlT(); await idle();
  let R = await runs();
  const poly = await ev(() => __pawDev.trackingFor(app).paintedParts()[0].group.poly);
  const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]), bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
  const r1 = R[0];
  ok(R.length === 1 && r1.tracker === 'sam2_mask', `Ctrl+T: one run, SAM (${JSON.stringify(R.map((r) => [r.tracker, r.name]))})`);
  ok(r1 && r1.range.start === 0 && Math.abs(r1.range.end - D) < 40, `over the shot (${JSON.stringify(r1?.range)})`);
  ok(r1 && r1.roi?.kind === 'box' && Math.abs(r1.roi.t_ms - A) < 40 && Math.abs(r1.roi.x - (Math.min(...xs) - 0.1 * bw)) < 0.002 && Math.abs(r1.roi.w - 1.2 * bw) < 0.002 && Math.abs(r1.roi.h - 1.2 * bh) < 0.002,
    `its box = the painting's bounds + 10 %, its frame A (${JSON.stringify(r1?.roi)})`);
  ok(/Penis/i.test(r1?.name || ''), `named for the part: "${r1?.name}"`);
  ok(await ev(() => __pawDev.trackingFor(app).selectedId) === r1?.id, 'selected');
  ok(await markAt(A), 'the seed mark stays on A');
  await shot('roi-3-one-part-tracked');
  await ctrlT(); await idle();
  R = await runs();
  ok(R.length === 1 && R[0].id !== r1.id && R[0].tracker === 'sam2_mask', `Ctrl+T again replaces it (${JSON.stringify(R.map((r) => r.id))}, was ${r1?.id})`);

  // ---- 4. two parts: the menu asks ----
  await seek(B); await toolOn();
  await ev(() => { const g = window.__pawDev.groupsFor(app); g.disarm?.(); g.active = -1; g.setWho('c1'); g.pickPart('anus'); });
  await stroke(0.64, 0.36);
  await toolOff();
  ok(JSON.stringify((await parts()).sort()) === '["c1_anus","c2_penis"]', `two parts painted: ${JSON.stringify(await parts())}`);
  const b1 = await vbox();
  await page.mouse.move(...at(b1, 0.8, 0.8)); await wait(200);
  const before = (await runs()).length;
  const anusC = await ev(() => { const p = __pawDev.trackingFor(app).paintedParts().find((x) => x.name === 'c1_anus').group.poly; return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length]; });
  const plain = await px(...anusC);
  await ctrlT();
  let rows = await menuRows();
  ok(rows.length === 3 && /Top.*Penis/i.test(rows[0]) && /Bottom.*Anus/i.test(rows[1]) && /Every painted part/.test(rows[2]), `Ctrl+T asks which: ${JSON.stringify(rows)}`);
  ok(await ev(() => __pawDev.trackingFor(app).partHover) === 'c2_penis', 'the last pick is the first row, outlined');
  await shot('roi-4-pick-menu');
  await page.keyboard.press('ArrowDown'); await wait(300);
  ok(await ev(() => __pawDev.trackingFor(app).partHover) === 'c1_anus', 'ArrowDown: the other part outlined');
  const lit = await px(...anusC);
  ok(lit.some((v, i) => Math.abs(v - plain[i]) > 30), `... painted on the video over it (${plain} -> ${lit})`);
  await shot('roi-4-pick-menu-anus');
  await page.keyboard.press('Escape'); await wait(400);
  ok((await menuRows()).length === 0 && (await runs()).length === before && (await ev(() => __pawDev.trackingFor(app).partHover)) === null, 'Esc: the menu closes, nothing tracked, no outline');
  await ctrlT();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await idle();
  R = await runs();
  ok(R.some((r) => /Anus/i.test(r.name || '') && r.tracker === 'sam2_mask' && Math.abs(r.roi.t_ms - B) < 40), `Enter tracked the anus (${JSON.stringify(R.map((r) => r.name))})`);
  ok(await ev(() => __pawDev.trackingFor(app).lastPart.get(0)) === 'c1_anus', 'remembered as the shot\'s last pick');

  // ---- 5. the Groups tool open on a part: no question ----
  await seek(A); await toolOn();
  await ev(() => { const g = window.__pawDev.groupsFor(app); g.pick(g.groups.findIndex((x) => x.name === 'c2_penis')); });
  const n5 = (await runs()).map((r) => r.id);
  await ctrlT();
  ok((await menuRows()).length === 0, 'the tool open on the penis: no menu');
  await idle();
  R = await runs();
  ok(R.some((r) => !n5.includes(r.id) && /Penis/i.test(r.name || '')), `... it is tracked (${JSON.stringify(R.map((r) => r.name))})`);
  await toolOff();

  // ---- 6. an old-shape box run loads and re-tracks with its stored box ----
  const old = await ev(async (D) => {
    const tr = __pawDev.trackingFor(app);
    const r = await tr.trackRange({ tracker: 'fake.box', range: { t0: 0, t1: D }, roi: { kind: 'box', x: 0.2, y: 0.3, w: 0.25, h: 0.3, t_ms: 500 }, params: {}, scenes: 'document' });
    return r.run ? { id: r.run.id, roi: r.run.roi, n: r.run.samples.t.length, pts: app.doc.ghosts.find((g) => g.id === r.run.id)?.script.length } : { error: r.error };
  }, D);
  ok(old.id && old.roi?.kind === 'box', `an old-shape box run made (${JSON.stringify(old)})`);
  const sp = ev(() => app.project.save());
  for (let k = 0; k < 6; k++) { await wait(400); await answer(); }
  await Promise.race([sp.catch((e) => console.log('save:', e?.message)), wait(20000)]);
  await page.waitForFunction(() => !window.__pawDev.trackingFor(app).runsDirty, null, { timeout: 20000 }).catch(() => {});
  ok(existsSync(proj), 'saved');
  await ev(() => app.project.close()); await wait(800);
  await open(proj); await wait(800);
  await page.waitForFunction((id) => window.__pawDev.trackingFor(app).runs.some((r) => r.id === id), old.id, { timeout: 20000 }).catch(() => {});
  const back = await ev((id) => { const r = __pawDev.trackingFor(app).runs.find((x) => x.id === id); return r && { roi: r.roi, n: r.samples.t.length, pts: app.doc.ghosts.find((g) => g.id === id)?.script.length, tracker: r.tracker?.id ?? r.tracker }; }, old.id);
  ok(back && JSON.stringify(back.roi) === JSON.stringify(old.roi) && back.n === old.n && back.pts === old.pts, `reopened: the box run loads with its box and its points (${JSON.stringify(back)})`);
  await ev((id) => { app.setMode('track'); app.transact('test: no parts', () => { app.doc.scenes = app.doc.scenes.map((s) => ({ ...s, groups: [] })); }); const tr = __pawDev.trackingFor(app); tr.select(id); app.doc.range = null; }, old.id);
  await page.waitForFunction(() => window.__pawDev.trackingFor(app).listed, null, { timeout: 30000 });
  const ids6 = (await runs()).map((r) => r.id);
  await listen(); await seek(2000); await ctrlT(); await idle();
  tt = await toasts();
  R = await runs();
  const re = R.find((r) => !ids6.includes(r.id));
  ok(re && re.tracker === 'fake.box' && re.roi?.x === 0.2 && re.roi?.w === 0.25 && /stored box/.test(tt), `no part painted, the box run selected: Ctrl+T re-tracks it with its stored box (${JSON.stringify(re?.roi)}; "${tt.slice(0, 120)}")`);
  await shot('roi-6-old-box-run');
} catch (e) {
  fails++; console.log('FAIL', e?.stack || e);
} finally {
  await browser.close().catch(() => {});
  console.log(fails ? `${fails} FAILED` : 'all ok');
  process.exit(fails ? 1 : 0);
}

async function shot(tag) { await page.screenshot({ path: `${out}/${tag}.png` }).catch(() => {}); }
