// dev/sr6view-check.mjs -- paw-jyde.2, the six-axis preview, in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env
// it prints), on a generated clip (8 s or more). Every page exception and console error fails it. Asserts on what is PAINTED:
//  1. the playback bar's "Six-axis view" button: on -> the box (canvas painted), off -> gone;
//  2. the view buttons 3/4, you, facing, side, feet; per axis, in the view where it shows (you = the wearer's own eye: sway + goes
//     LEFT (their left), twist turns counter-clockwise, surge / stroke up the picture; facing: sway / roll / twist mirrored; side:
//     stroke / surge / pitch; feet: sway / roll): the drawn opening / stripe / side moves the expected way on screen when that axis
//     goes 50 -> 100, and the view's pixels change; the up-side stripe faces the camera in you / facing (painted in the twist
//     colour, more than from the feet); the wearer's left side on the picture's left in "you", on its right in "facing";
//  3. the six gauges: painted in the lanes' axis colours where the value says (bar fill / arc), dim = no data;
//  4. hover a gauge: that axis drawn in its colour in the view (pixels of its colour appear); click: solo (the stroke held at
//     centre: the opening moves), click again: released; lanes untouched;
//  5. drag the box (moves, stored), the top-right grip (resizes, bottom-left kept), the button's double-click (default place);
//  6. Space plays / pauses with the pointer over the box and after clicking its buttons (focus never goes into it);
//  7. Track tab: a fake-sidecar run (one character, rear + dancing) -> the preview follows its axes, live in the script
//     (paw-x7w7: label "script", no "unapplied"; sway off centre, the sway gauge marked measured, "vs frame"); Refine tab -> "script".
// Screenshots (default size, smallest size, each view, hover, solo) into <out dir>.
//   node dev/sr6view-check.mjs <clip.mp4> <out dir>
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
const [clip, out] = process.argv.slice(2);
if (!clip || !out) { console.error('usage: node dev/sr6view-check.mjs <clip.mp4> <out dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
const flat = (v) => [{ at: 0, pos: v }, { at: 60000, pos: v }];
const IDS = ['stroke', 'surge', 'sway', 'twist', 'roll', 'pitch'];
const setAxes = (o) => ev((o) => { app.doc.axes = { ...app.doc.axes, ...o }; }, o);
/** what the canvas says it painted + the box rect */
const st = () => ev(() => {
  const r = document.querySelector('[data-testid="sr6"]'), c = r?.querySelector('canvas');
  if (!c) return null;
  const P = (s) => s.split(',').map(Number), b = r.getBoundingClientRect();
  return { ...c.dataset, open: P(c.dataset.open), mid: P(c.dataset.mid), mark: P(c.dataset.mark), side: P(c.dataset.side), vals: P(c.dataset.vals), box: { x: b.x, y: b.y, w: b.width, h: b.height } };
});
/** canvas pixels: count of pixels near colour col (in css px rect r) and a cheap hash */
const pix = (r, col, tol = 40) => ev(([r, col, tol]) => {
  const c = document.querySelector('[data-testid="sr6"] canvas'), k = c.width / c.getBoundingClientRect().width;
  const d = c.getContext('2d').getImageData(Math.round(r.x * k), Math.round(r.y * k), Math.max(1, Math.round(r.w * k)), Math.max(1, Math.round(r.h * k))).data;
  let n = 0, any = 0, h = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 0) any++; h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3]) | 0; if (col && d[i + 3] > 200 && Math.abs(d[i] - col[0]) <= tol && Math.abs(d[i + 1] - col[1]) <= tol && Math.abs(d[i + 2] - col[2]) <= tol) n++; }
  return { n, any, h };
}, [r, col, tol]);
const colours = () => ev((ids) => { const c = document.querySelector('[data-testid="sr6"] canvas'), cs = getComputedStyle(c); const hex = (h) => { const m = /#([0-9a-f]{6})/i.exec(h); if (m) { const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; } const r = /rgba?\(([^)]+)\)/.exec(h); return r ? r[1].split(',').map(Number).slice(0, 3) : null; }; const ser = { stroke: 'sky', surge: 'green', sway: 'yellow', twist: 'violet', roll: 'orange', pitch: 'blue' }; return Object.fromEntries(ids.map((id) => [id, hex(cs.getPropertyValue('--series-' + ser[id]).trim())])); }, IDS);
const layoutOf = () => ev(() => { const r = document.querySelector('[data-testid="sr6"]').getBoundingClientRect(); const g = Object.fromEntries([...document.querySelectorAll('[data-testid^="sr6-g-"]')].map((e) => { const b = e.getBoundingClientRect(); return [e.dataset.axis, { x: b.x - r.x, y: b.y - r.y, w: b.width, h: b.height }]; })); const v = document.querySelector('[data-testid="sr6"] .body').getBoundingClientRect(); return { g, view: { x: v.x - r.x, y: v.y - r.y, w: v.width, h: v.height } }; });
const view = async (id) => { await page.locator(`[data-testid="sr6-view-${id}"]`).click(); await wait(250); };
const settle = () => wait(350);

try {
  await page.reload(); await page.waitForFunction(() => window.app?.project && window.__pawDev?.trackingFor, null, { timeout: 60000 });
  for (const f of ['.pawproj', '.pawruns']) { const p = clip.replace(/\.[^.]+$/, f); if (existsSync(p)) rmSync(p); }
  const op = ev((c) => app.project.openVideo(c, { force: true }), resolve(clip));
  for (let k = 0; k < 8; k++) { await wait(500); await answer(); }
  await op.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready && app.player.vw > 0, null, { timeout: 60000 });
  await ev(() => { app.setMode('refine'); app.player.pause(); app.player.setUi({ sr6: false }); app.settings.set('video.sr6view', null); });
  await setAxes(Object.fromEntries(IDS.map((id) => [id, flat(50)])));
  await ev(() => app.player.seek(2000)); await settle();

  // 1. toggle
  ok(await ev(() => !document.querySelector('[data-testid="sr6"]')), 'off by default: no box');
  await page.locator('button[aria-label="Six-axis view"]').click(); await wait(600);
  let s = await st();
  ok(!!s && s.box.w > 150 && s.box.h > 200, `button: the box is on (${JSON.stringify(s?.box)})`);
  const L = await layoutOf(), COL = await colours();
  const all = await pix({ x: 0, y: 0, w: s.box.w, h: s.box.h });
  ok(all.any > 3000, `the canvas paints (${all.any} px)`);
  ok(Object.values(COL).every((c) => c?.length === 3), `axis colours read: ${JSON.stringify(COL)}`);
  await page.locator('[data-testid="sr6"]').screenshot({ path: join(out, 'sr6-default-iso.png') });

  // 2. the views, and each axis moves the painted receiver in the view where it shows
  ok(await ev(() => [...document.querySelectorAll('[data-testid^="sr6-view-"]')].map((b) => b.dataset.testid.slice(9)).join(',')) === 'iso,you,facing,side,feet', 'view buttons: 3/4, you, facing, side, feet');
  const cases = [
    ['you', 'sway', (a, b) => b.open[0] < a.open[0] - 4, 'opening goes LEFT (+ = the wearer\'s left, as they see it)'],
    ['you', 'twist', (a, b) => b.side[1] > a.side[1] + 4 && b.side[0] > a.side[0] + 2, 'counter-clockwise as the wearer sees it (their left side swings down)'],
    ['you', 'surge', (a, b) => b.open[1] < a.open[1] - 4, 'opening goes up the picture (toward their up)'],
    ['you', 'stroke', (a, b) => b.open[1] < a.open[1] - 4, 'opening goes up the picture (out, along the shaft)'],
    ['you', 'roll', (a, b) => b.mark[0] < a.mark[0] - 3, 'the top tips left (to their left)'],
    ['facing', 'sway', (a, b) => b.open[0] > a.open[0] + 4, 'opening goes RIGHT (mirrored: facing the wearer)'],
    ['facing', 'roll', (a, b) => b.mark[0] > a.mark[0] + 3, 'the top tips RIGHT (mirrored sense)'],
    ['facing', 'twist', (a, b) => b.side[1] > a.side[1] + 4 && b.side[0] < a.side[0] - 2, 'turns the other way round (mirrored)'],
    ['side', 'stroke', (a, b) => b.open[1] < a.open[1] - 8, 'opening goes up'],
    ['side', 'surge', (a, b) => b.open[0] > a.open[0] + 4, 'opening goes right (toward their up)'],
    ['side', 'pitch', (a, b) => b.mark[0] < a.mark[0] - 4, 'the top tips left (toward their down)'],
    ['feet', 'sway', (a, b) => b.open[0] > a.open[0] + 4, 'opening goes right (their left, facing them)'],
    ['feet', 'roll', (a, b) => b.mark[0] > a.mark[0] + 4, 'the top tips right (their left)'],
  ];
  for (const [v, id, test, words] of cases) {
    await view(v);
    await setAxes({ [id]: flat(50) }); await settle();
    const a = await st(), pa = await pix(L.view);
    await setAxes({ [id]: flat(100) }); await settle();
    const b = await st(), pb = await pix(L.view);
    ok(b.view === v && test(a, b) && pa.h !== pb.h, `${v} view, ${id} 50 -> 100: ${words} (open ${a.open} -> ${b.open}, mark ${a.mark} -> ${b.mark}, side ${a.side} -> ${b.side}; pixels ${pa.h !== pb.h ? 'changed' : 'SAME'})`);
    await setAxes({ [id]: flat(50) });
  }
  // the up-side stripe / nub faces the camera in you / facing (more twist-coloured pixels than from the feet, where it is behind);
  // the wearer's left side (local +x) on the picture's left in "you", on its right in "facing"
  await view('feet'); await settle(); const twF = await pix(L.view, COL.twist, 40), stF = await st();
  await view('you'); await settle(); const twY = await pix(L.view, COL.twist, 40), yy = await st();
  await page.mouse.move(5, 5); await settle(); await page.locator('[data-testid="sr6"]').screenshot({ path: join(out, 'sr6-default-you.png') });
  await view('facing'); await settle(); const twA = await pix(L.view, COL.twist, 40), ff = await st();
  await page.mouse.move(5, 5); await settle(); await page.locator('[data-testid="sr6"]').screenshot({ path: join(out, 'sr6-default-facing.png') });
  ok(yy.stripe === 'near' && ff.stripe === 'near' && stF.stripe === 'far' && twY.n > 40 && twA.n > 40, `the up-side stripe faces the camera (drawn solid) in you / facing, behind from the feet (${yy.stripe} / ${ff.stripe} / ${stF.stripe}; twist-coloured px you ${twY.n}, facing ${twA.n}, feet ${twF.n})`);
  ok(yy.side[0] < yy.mid[0] - 10 && ff.side[0] > ff.mid[0] + 10, `the wearer's left side: picture left in "you" (${yy.side} vs ${yy.mid}), picture right in "facing" (${ff.side} vs ${ff.mid})`);
  // along the camera: sway seen from the side moves only in depth
  await view('side'); await setAxes({ sway: flat(50) }); await settle(); const h0 = await st(); await setAxes({ sway: flat(100) }); await settle(); const h1 = await st();
  ok(Math.abs(h1.open[0] - h0.open[0]) < 3, `side view: sway moves the opening only in depth (${h0.open} -> ${h1.open})`);
  await setAxes({ sway: flat(50) });
  // an older remembered view name stays valid
  await ev(() => app.settings.set('video.sr6view', { view: 'rear' })); await settle();
  ok((await st()).view === 'feet', 'an old saved "rear" opens as "feet" (the same camera)');
  await ev(() => app.settings.set('video.sr6view', null)); await settle();
  // 3. gauges in the axis colours where the values say; dim = no data
  await view('iso');
  await setAxes({ stroke: flat(100), surge: flat(100), sway: flat(0), twist: flat(100), roll: flat(0), pitch: flat(100) }); await settle();
  for (const id of IDS) {
    const g = L.g[id], val = { stroke: 100, surge: 100, sway: 0, twist: 100, roll: 0, pitch: 100 }[id];
    // bar: the fill between centre (stroke: the deep end) and the value, at 3/4 of the way; arc: the half-way angle on the arc
    let r;
    if (['twist', 'roll', 'pitch'].includes(id)) {
      const cx = g.x + g.w / 2, cy = g.y + g.h - 2, R = Math.max(8, Math.min(g.w / 2 - 10, g.h - 17)), a = -Math.PI / 2 + (val > 50 ? 1 : -1) * 35 * Math.PI / 180;
      r = { x: cx + R * Math.cos(a) - 3, y: cy + R * Math.sin(a) - 3, w: 6, h: 6 };
    } else {
      const x0 = g.x + 5, x1 = g.x + g.w - 5, from = id === 'stroke' ? x0 : (x0 + x1) / 2, to = x0 + (x1 - x0) * val / 100;
      r = { x: from + (to - from) * 0.6 - 3, y: g.y + 23 - 2, w: 6, h: 4 };
    }
    const p = await pix(r, COL[id], 45), name = await pix({ x: g.x + 2, y: g.y + 2, w: 34, h: 12 }, COL[id], 45);
    ok(p.n > 2 && name.n > 2, `gauge ${id} painted in its colour at its value ${val} (${p.n} px at the fill, ${name.n} px in the name)`);
  }
  ok((await st()).vals.join(',') === '100,100,0,100,0,100', 'the values read back');
  await page.locator('[data-testid="sr6"]').screenshot({ path: join(out, 'sr6-default-values.png') });
  await setAxes({ roll: [] }); await settle();
  ok(await ev(() => document.querySelector('[data-testid="sr6-g-roll"]').dataset.has === '0'), 'roll with no points: its gauge says no data');
  const dimRoll = await pix({ x: L.g.roll.x + 2, y: L.g.roll.y + 2, w: 30, h: 12 }, COL.roll, 25);
  await setAxes({ roll: flat(0) }); await settle();
  const fullRoll = await pix({ x: L.g.roll.x + 2, y: L.g.roll.y + 2, w: 30, h: 12 }, COL.roll, 25);
  ok(dimRoll.n < fullRoll.n, `the dim name has fewer full-colour pixels (${dimRoll.n} vs ${fullRoll.n})`);

  // 4. hover and solo
  await setAxes(Object.fromEntries(IDS.map((id) => [id, flat(50)])));
  await setAxes({ stroke: flat(100), roll: flat(100) }); await view('feet'); await settle();
  const before = await pix(L.view, COL.roll, 40);
  await page.locator('[data-testid="sr6-g-roll"]').hover(); await wait(500);
  s = await st(); const hov = await pix(L.view, COL.roll, 40);
  ok(s.hl === 'roll' && hov.n > before.n + 30, `hover roll: highlighted in the view (${before.n} -> ${hov.n} roll-coloured px)`);
  const tip = await ev(() => [...document.querySelectorAll('[role=tooltip], .tooltip, .kit-tooltip')].map((e) => e.textContent).join(' | '));
  ok(/Roll: the receiver tilting to your left or right/.test(tip) && /lane/.test(tip), `its kit tooltip: ${tip.slice(0, 160)}`);
  ok(await ev(() => !document.querySelector('[data-testid="sr6"] [title]')), 'no native title anywhere in the box');
  await page.locator('[data-testid="sr6"]').screenshot({ path: join(out, 'sr6-hover-roll.png') });
  const unsolo = await st();
  await page.locator('[data-testid="sr6-g-roll"]').click(); await wait(400);
  const so = await st();
  ok(so.solo === 'roll' && so.open[1] > unsolo.open[1] + 8, `click roll: solo (the stroke held at centre: opening ${unsolo.open} -> ${so.open})`);
  await page.mouse.move(5, 5); await wait(300);
  await page.locator('[data-testid="sr6"]').screenshot({ path: join(out, 'sr6-solo-roll.png') });
  await page.locator('[data-testid="sr6-g-roll"]').click(); await wait(400);
  ok((await st()).solo === '' && (await ev(() => app.doc.axes.roll.length === 2 && app.doc.axes.stroke[0].pos === 100)), 'click again: released; the lanes untouched');

  // 5. resize, drag, reset
  await page.mouse.move(5, 5); await view('iso');
  s = await st();
  const g = await page.locator('[data-testid="sr6-resize"]').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down(); await page.mouse.move(g.x + 60, g.y - 10, { steps: 6 }); await page.mouse.up(); await wait(400);
  const r = await st();
  ok(r.box.w > s.box.w + 40 && Math.abs(r.box.x - s.box.x) < 2 && Math.abs(r.box.y + r.box.h - s.box.y - s.box.h) < 2, `resize from the top-right grip: wider (${s.box.w} -> ${r.box.w}), bottom-left kept`);
  await page.locator('[data-testid="sr6"]').screenshot({ path: join(out, 'sr6-large.png') });
  const bx = r.box.x + r.box.w / 2, by = r.box.y + 30 + r.box.w * 0.4;
  await page.mouse.move(bx, by); await page.mouse.down(); await page.mouse.move(bx + 120, by - 30, { steps: 6 }); await page.mouse.up(); await wait(400);
  const m = await st(), stored = await ev(() => app.settings.get('video.sr6view', null));
  ok(Math.abs(m.box.x - r.box.x - 120) < 3 && Math.abs(m.box.y - r.box.y + 30) < 3 && stored?.fx > 0, `drag: moved (+120, -30) -> ${JSON.stringify(m.box)}, stored ${JSON.stringify(stored)}`);
  // the smallest size: screenshots for legibility
  const g2 = await page.locator('[data-testid="sr6-resize"]').boundingBox();
  await page.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2); await page.mouse.down(); await page.mouse.move(g2.x - 600, g2.y + 600, { steps: 6 }); await page.mouse.up(); await wait(400);
  const sm = await st();
  ok(sm.box.w <= 177, `resize down: the smallest box (${sm.box.w} px)`);
  await setAxes({ stroke: flat(80), surge: flat(70), sway: flat(30), twist: flat(75), roll: flat(35), pitch: flat(65) }); await settle();
  for (const v of ['iso', 'you', 'facing', 'side', 'feet']) { await view(v); await page.mouse.move(5, 5); await settle(); await page.locator('[data-testid="sr6"]').screenshot({ path: join(out, `sr6-small-${v}.png`) }); }
  await page.locator('button[aria-label="Six-axis view"]').dblclick(); await wait(600);
  const d = await st();
  ok(d && Math.abs(d.box.x - s.box.x) < 2 && Math.abs(d.box.w - s.box.w) < 2 && d.view === 'iso' && (await ev(() => app.settings.get('video.sr6view', null))) == null, `double-click the button: back to the default place and view (${JSON.stringify(d?.box)})`);
  for (const v of ['side', 'feet']) { await view(v); await page.mouse.move(5, 5); await settle(); await page.locator('[data-testid="sr6"]').screenshot({ path: join(out, `sr6-default-${v}.png`) }); }
  await view('iso');

  // 6. Space with the pointer over the box, after clicking its buttons
  await page.locator('[data-testid="sr6-k"]').click(); await wait(200);
  ok((await st()).k === '3' && (await ev(() => !document.activeElement?.closest?.('[data-testid="sr6"]'))), 'exaggerate x3; focus not in the box');
  await setAxes({ stroke: Array.from({ length: 81 }, (_, i) => ({ at: i * 250, pos: i % 2 ? 100 : 0 })), sway: Array.from({ length: 41 }, (_, i) => ({ at: i * 500, pos: i % 2 ? 80 : 20 })), roll: Array.from({ length: 41 }, (_, i) => ({ at: i * 500 + 125, pos: i % 2 ? 30 : 70 })) });
  await page.locator('[data-testid="sr6"] .body').hover();
  await page.keyboard.press('Space'); await wait(500);
  const playing = await ev(() => app.player.playing);
  const sp1 = await st(); await wait(130); const sp2 = await st();
  await page.locator('[data-testid="sr6"]').screenshot({ path: join(out, 'sr6-playing.png') });
  await page.keyboard.press('Space'); await wait(400);
  ok(playing && !(await ev(() => app.player.playing)), `Space with the pointer over the box: plays, then pauses`);
  ok(sp1.vals[0] !== sp2.vals[0], `while playing the drawing follows the playhead (stroke ${sp1.vals[0]} -> ${sp2.vals[0]})`);
  await page.locator('[data-testid="sr6-k"]').click(); await page.locator('[data-testid="sr6-k"]').click(); await wait(200);

  // 1b. off
  await page.locator('button[aria-label="Six-axis view"]').click(); await wait(400);
  ok(await ev(() => !app.player.ui.sr6 && !document.querySelector('[data-testid="sr6"]')), 'button: box off');

  // 7. Track tab: follow the unapplied axes ghosts of a fake-sidecar run
  const SQ = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const grp = (who, part, box) => ({ name: `${who}_${part}`, who, part, poly: SQ(...box), pinned: true, t_ms: 500, source: 'user' });
  await setAxes(Object.fromEntries(['surge', 'sway', 'twist', 'roll', 'pitch'].map((id) => [id, []])));
  await ev((g) => { app.setMode('track'); app.transact('shot', () => { app.doc.scenes = [{ start_ms: 0, end_ms: 8000, tags: ['rear', 'dancing'], groups: g }]; }); }, [grp('c1', 'hips', [0.4, 0.5, 0.15, 0.15]), grp('c1', 'torso', [0.42, 0.2, 0.11, 0.2])]);
  await wait(800);
  for (let k = 0; k < 3 && !(await ev(() => window.__pawDev.trackingFor(app).runs.length)); k++) {   // the first track right after the tab switch can come back empty
    await ev(async () => { const tr = window.__pawDev.trackingFor(app); await tr.list(); tr.selectTracker('fake.groups'); app.doc.range = { t0: 0, t1: 8000 }; app.player.seek(3000); await tr.track(); });
    await page.waitForFunction(() => !window.__pawDev.trackingFor(app).busy, null, { timeout: 90000 }); await wait(500);
  }
  await ev(() => { const tr = window.__pawDev.trackingFor(app); tr.select(tr.runs.at(-1).id); app.doc.range = null; app.player.pause(); app.player.setUi({ sr6: true }); }); await wait(700);
  const tv = [];
  for (const t of [2000, 2650, 3300]) { await ev((t) => app.player.seek(t), t); await settle(); tv.push(await st()); }
  const src = await ev(() => document.querySelector('[data-testid="sr6-src"]')?.textContent.trim());
  const q = await ev(() => document.querySelector('[data-testid="sr6-g-sway"]')?.dataset.q);
  // paw-x7w7 (2e31f7a): no Accept, the run's axes play live in the script: nothing is "unapplied" any more
  ok(tv[0].src === 'script' && !/unapplied/.test(src), `Track tab: previewing the run's axes, live in the script (label "${src}")`);
  ok(tv.some((x) => Math.abs(x.vals[2] - 50) > 1) && new Set(tv.map((x) => x.vals[2])).size > 1, `follows the run's sway ghost: ${tv.map((x) => x.vals[2]).join(' / ')}`);
  ok(q === 'measured' || q === 'guessed', `the sway gauge carries the measurement mark (${q})`);
  ok(await ev(() => !!document.querySelector('[data-testid="sr6-vs-frame"]')), 'a solo reading shows "vs frame"');
  await page.locator('[data-testid="sr6"]').screenshot({ path: join(out, 'sr6-track-unapplied.png') });
  await ev(() => app.setMode('refine')); await wait(500);
  ok((await st()).src === 'script' && (await ev(() => document.querySelector('[data-testid="sr6-src"]')?.textContent.trim())) === 'script', 'Refine tab: previewing the script');
  await page.screenshot({ path: join(out, 'sr6-window.png') });
  await ev(() => app.player.setUi({ sr6: false }));
} catch (e) { fails++; console.log('FAIL', e.message); }
await browser.close().catch(() => {});
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
