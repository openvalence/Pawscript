// dev/mods-e2e.mjs -- paw-r9nh: the Modifiers row in the real Tauri window (dev/test-app.mjs start ...; CDP_* env set).
//   node dev/mods-e2e.mjs <generated clip.mp4> <screenshot dir>
// Seeds a known stroke (half-strokes ~500 ms, 10 / 90), adds each kind (by its key where it has one), drags / resizes /
// duplicates / double-clicks / nudges on the row, draws a strength envelope in Refine, and checks the composed script
// (lib/finish.js finalScript on the app's own doc, here in node) for continuous edges, turns on their frames and the
// spurt on its exact frame.
import { connectTestApp } from './cdp-connect.mjs';
import { finalScript } from '../src/lib/finish.js';
import { baseTurns } from '../src/lib/fx.js';
import { posAt } from '../src/lib/core/script.js';
import { frameStartOf, frameAt, frameTime } from '../src/lib/lane.js';

const [clip, out = '.'] = process.argv.slice(2);
const { browser: b, page } = await connectTestApp();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms), shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, info); };

async function answer(ms = 5000) {   // whatever the open asks: the first choice ('Recover' -> dismissed)
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const d = await ev(() => app.dialog && { title: app.dialog.title, choices: app.dialog.choices.map((c) => c.id) });
    if (d) { await ev((id) => app.dialog.resolve(id), d.choices[/Recover/.test(d.title) ? 1 : 0]); await wait(300); }
    else if (await ev(() => !app.project.busy && !!app.doc.media)) break;
    else await wait(100);
  }
}
// ---- open, seed a known stroke ----
await ev(() => app.project.close({ force: true }));
await answer(1500);
const opening = ev((p) => app.project.openVideo(p), clip);
await answer(); await opening; await wait(800);
const BASE = []; { let t = 0, k = 0; while (t <= 30000) { BASE.push({ at: Math.round(t), pos: k % 2 ? 88 + (k % 3) : 6 + (k % 2) }); t += 500 + (k % 4) * 10; k++; } }
await ev((pts) => { app.edit('Seed stroke', 'stroke', pts); app.doc.fx = []; app.doc.range = null; app.setMode('refine'); app.setView({ start: 0, span: 30000 }); }, BASE);
await wait(500);
const FR = await ev(() => app.player.frameMs);
const TURNS = baseTurns(BASE, 0, 30000).map((x) => x.at);
const docNow = () => ev(() => ({ stroke: app.doc.axes.stroke, fx: app.doc.fx, scenes: app.doc.scenes, finish: app.doc.finish, maxSpeed: +app.settings.get('lanes.speedMax', 400) || 400 }));
const composed = async () => { const d = await docNow(); return { d, fin: finalScript({ axes: { stroke: d.stroke }, fx: d.fx, scenes: d.scenes, finish: d.finish }, 'stroke', { maxSpeed: d.maxSpeed, grid: FR }) }; };
const speed = (s, a, c) => { let m = 0; for (let i = 1; i < s.length; i++) if (s[i].at >= a && s[i - 1].at <= c) m = Math.max(m, (Math.abs(s[i].pos - s[i - 1].pos) * 1000) / (s[i].at - s[i - 1].at)); return m; };
const fxOf = async (kind) => (await docNow()).fx.filter((e) => e.kind === kind);
const neutral = async () => { await page.mouse.click(8, 8); await wait(100); };   // the page has the keys (not a text field)
const seek = async (t) => { await ev((x) => app.player.seek(x, { exact: true }), t); await wait(250); };

// ---- add by key ----
await neutral(); await seek(1510); await page.keyboard.press('u'); await wait(250);
let [sp] = await fxOf('spurt'), c = await composed();
check('U: one spurt on the exact frame', !!sp && sp.t0 === frameStartOf(1510, FR), JSON.stringify(sp));
check('the composed script swings deeper ON that frame', sp && Math.round(posAt(c.fin, sp.t0)) === Math.max(0, Math.round(posAt(BASE, sp.t0)) - 25), `${posAt(c.fin, sp?.t0)} vs trace ${posAt(BASE, sp?.t0)}`);
await seek(2510); await page.keyboard.press('Shift+U'); await wait(250);
const [th] = await fxOf('throbbing'); c = await composed();
const dip = th && th.t0 + 40;
check('Shift+U: a single throb, its dip on the frame', !!th && dip === frameStartOf(2510, FR) && Math.round(posAt(c.fin, dip)) === Math.round(posAt(BASE, dip)) - 10, JSON.stringify(th));
await seek(4100); await page.keyboard.press('Alt+Shift+O'); await wait(300);
let [org] = await fxOf('orgasm');
check('Alt+Shift+O (no scenes): 4 s from the playhead, the end on a stroke turn, the start not after the playhead', !!org && TURNS.includes(org.t1) && org.t0 <= frameStartOf(4100, FR) + 1, JSON.stringify(org));
await seek(9000); await page.keyboard.press('Alt+Shift+N'); await wait(300);
let [knot] = await fxOf('knotting'); c = await composed();
check('Alt+Shift+N over ~7 strokes: auto (a knot on each), not a One knot (paw-35pp)', !!knot && !knot.params?.mode, JSON.stringify(knot));
await ev((id) => app.transact('one knot', () => { app.doc.fx = app.doc.fx.map((e) => (e.id === id ? { ...e, params: { mode: 'single' } } : e)); }), knot.id); c = await composed();
const pop = c.fin.find((a) => a.at > knot.t0 && a.at < knot.t1 && a.pos === 15)?.at;
check('its pop lands on a frame start', pop != null && frameStartOf(pop, FR) === pop, String(pop));
// the rest through their commands over spans with MID-STROKE edges
const add = (id, t0, t1) => ev(([i, a, z]) => app.commands.run(i, { t0: a, t1: z }), [id, t0, t1]);
await add('timeline.mod.toggle.idle', 14130, 15870); await add('timeline.mod.toggle.insertion', 16130, 17870); await add('timeline.mod.add.shape', 18130, 21870);
await ev(() => app.transact('shape depth', () => { app.doc.fx = app.doc.fx.map((e) => (e.kind === 'shape' ? { ...e, params: { lo: 20, hi: 70 } } : e)); }));
await ev(() => { app.doc.range = { t0: 22130, t1: 29870 }; }); await neutral(); await page.keyboard.press('Alt+Shift+N'); await wait(300);
c = await composed();
{ const k = c.d.fx.find((e) => e.kind === 'knotting' && e.t0 > 20000);
  check('a knotting over many strokes (7.7 s, 8 s or less) stays auto: a knot on each stroke, not one push (paw-35pp)', !!k && !k.params?.mode, JSON.stringify(k)); }
const kinds = ['idle', 'insertion', 'shape', 'knotting'];
for (const k of kinds) {
  const m = c.d.fx.filter((e) => e.kind === k).sort((a, b) => b.t0 - a.t0)[0], g0 = Math.abs(posAt(c.fin, m.t0) - posAt(BASE, m.t0));
  const g1 = k === 'shape' || k === 'knotting' ? Math.abs(posAt(c.fin, m.t1) - posAt(BASE, m.t1)) : 0;
  check(`${k} ${m.t0}-${m.t1}: continuous at its edges (gap <= 1 pos)`, g0 <= 1 && g1 <= 1, `t0 gap ${g0.toFixed(1)} t1 gap ${g1.toFixed(1)}; jerk ${Math.round(speed(c.fin, m.t0 - 150, m.t0 + 150) - speed(BASE, m.t0 - 150, m.t0 + 150))} pos/s`);
}
{ const m = c.d.fx.find((e) => e.kind === 'shape'), T = baseTurns(c.fin, m.t0, m.t1).map((x) => x.at), miss = baseTurns(BASE, m.t0 + 800, m.t1 - 800).filter((x) => !T.includes(x.at));
  check('Reshape keeps every tracked turn on its time', !miss.length, JSON.stringify(miss.slice(0, 3))); }
await shot('m1-added');

// ---- the row: resize onto a turn, Shift free, move, Alt+drag copy, double-click, Ctrl+arrows ----
const lane = async () => ev(() => { const r = document.querySelector('[data-tl-lane="fx"]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, v: { ...app.view } }; });
const X = (L, t) => L.x + ((t - L.v.start) / L.v.span) * L.w;
const drag = async (x0, y, x1, mods = []) => {
  for (const k of mods) await page.keyboard.down(k);
  await page.mouse.move(x0, y); await page.mouse.down(); await page.mouse.move((x0 + x1) / 2, y, { steps: 4 }); await page.mouse.move(x1, y, { steps: 6 }); await page.mouse.up();
  for (const k of mods) await page.keyboard.up(k);
  await wait(250);
};
await ev(() => { app.setMode('track'); app.setView({ start: 6500, span: 6000 }); }); await wait(300);   // the edge in the left half (the row's suggestion buttons sit at its right end)
let L = await lane(); [org] = await fxOf('orgasm');
const rowY = async (id) => ev((i) => { const fx = app.doc.fx, ends = [], row = new Map(); for (const e of [...fx].sort((a, b) => a.t0 - b.t0)) { let k = ends.findIndex((t) => t <= e.t0); if (k < 0) k = ends.push(0) - 1; ends[k] = e.t1; row.set(e.id, k); } return { row: row.get(i), rows: Math.max(1, ends.length) }; }, id);
let ry = await rowY(org.id), y = L.y + ((ry.row + 0.5) / ry.rows) * L.h;
const target = TURNS.find((t) => t > org.t1 + 300);   // before the knotting at 9 s: no overlap, one row
await drag(X(L, org.t1), y, X(L, target + 18));
let [org2] = await fxOf('orgasm');
check('drag an edge 18 ms past a turn: it lands ON the turn', org2.t1 === target, `${org2.t1} vs turn ${target}`);
ry = await rowY(org.id); y = L.y + ((ry.row + 0.5) / ry.rows) * L.h;
await drag(X(L, org2.t1), y, X(L, target + 18), ['Shift']);
[org2] = await fxOf('orgasm');
check('Shift: free (on a frame, off the turn)', org2.t1 !== target && frameStartOf(org2.t1, FR) === org2.t1, String(org2.t1));
const n0 = (await docNow()).fx.length; ry = await rowY(org.id); y = L.y + ((ry.row + 0.5) / ry.rows) * L.h;
await drag(X(L, org2.t1 - 500), y, X(L, org2.t1 + 100), ['Alt']);   // inside the view (it starts at 6.5 s)
const after = await docNow(), copies = after.fx.filter((e) => e.kind === 'orgasm');
check('Alt+drag: a copy, the original stays', after.fx.length === n0 + 1 && copies.some((e) => e.t0 === org2.t0 && e.t1 === org2.t1), JSON.stringify(copies.map((e) => [e.t0, e.t1])));
const u0 = await ev(() => app.history.undoLabel);
check('one gesture, one undo step', u0 === 'Duplicate modifier', String(u0));
await page.keyboard.press('Control+z'); await wait(200);
// double-click on an insertion: re-fitted to the half-stroke around the click, turn to turn
await ev(() => app.setView({ start: 15000, span: 4000 })); await wait(300); L = await lane();
let [ins] = await fxOf('insertion'); ry = await rowY(ins.id); y = L.y + ((ry.row + 0.5) / ry.rows) * L.h;
await page.mouse.dblclick(X(L, 16900), y); await wait(300);
[ins] = await fxOf('insertion');
check('double-click an insertion: its span = the half-stroke around the click, turn to turn', TURNS.includes(ins.t0) && TURNS.includes(ins.t1) && ins.t0 <= 16900 && ins.t1 > 16900, JSON.stringify([ins.t0, ins.t1]));
// Ctrl+arrows nudge the selected modifier a frame; three presses = one undo step
await page.mouse.click(X(L, (ins.t0 + ins.t1) / 2), y); await wait(200);
const ti = ins.t0;
for (let k = 0; k < 3; k++) { await page.keyboard.press('Control+ArrowRight'); await wait(120); }
[ins] = await fxOf('insertion');
const ul = await ev(() => app.history.undoLabel);
check('Ctrl+→ x3 on the focused row: three frames on (the first onto the frame grid)', ins.t0 === frameTime(frameAt(ti, FR) + 3, FR), `${ti} -> ${ins.t0}`);
await page.keyboard.press('Control+z'); await wait(200);
[ins] = await fxOf('insertion');
check('... one undo step brings it back', ins.t0 === ti && ul === 'Nudge modifier', `${ins.t0} (${ul})`);

// ---- dynamic: the strength envelope in Refine (click the orgasm: its popover; drag "build" right) ----
await ev(() => { app.setMode('refine'); app.setView({ start: 3000, span: 6000 }); }); await wait(300); L = await lane();
[org] = await fxOf('orgasm'); ry = await rowY(org.id); y = L.y + ((ry.row + 0.5) / ry.rows) * L.h;
await page.mouse.click(X(L, (org.t0 + org.t1) / 2), y); await wait(500);
const hb = await ev(() => { const h = document.querySelector('.fx-pop [data-key="envIn"]'); if (!h) return null; const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
check('Refine: the popover shows the strength curve', !!hb);
if (hb) { await page.mouse.move(hb.x, hb.y); await page.mouse.down(); await page.mouse.move(hb.x + 100, hb.y, { steps: 8 }); await page.mouse.move(hb.x + 200, hb.y, { steps: 8 }); await page.mouse.up(); await wait(400); }
await shot('m2-envelope');
[org] = await fxOf('orgasm'); c = await composed();
check('drag "build": the orgasm builds up (envIn > 0) in one undo step', org.params?.envIn > 0, `envIn ${org.params?.envIn}; undo ${await ev(() => app.history.undoLabel)}`);
await page.keyboard.press('Escape'); await wait(200);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
await b.close().catch(() => {});
process.exit(results.every(Boolean) ? 0 : 1);
