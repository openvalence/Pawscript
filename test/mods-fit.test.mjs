// paw-r9nh (owner: "the fit and the timing on them is a lil dodgy and they feel finnicky", "less than dynamic"): the
// audit's numbers as assertions (dev/audit-mods.mjs prints them). Generated strokes, edges mid-stroke (not on turns).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValid, posAt } from '../src/lib/core/script.js';
import { applyFx, baseTurns, singleThrob, strength, envFlat, fxParams, ENV_PRESETS } from '../src/lib/fx.js';
import { finalScript } from '../src/lib/finish.js';
import { frameStartOf } from '../src/lib/lane.js';

function tracked() {   // as fx.test: 0..20 s half-strokes ~500 ms, 20..40 s ~180 ms; bottoms ~5, tops ~90
  const out = []; let t = 0, top = false, k = 0;
  while (t <= 40000) { out.push({ at: Math.round(t), pos: top ? 88 + (k % 3) : 4 + (k % 2) }); t += t < 20000 ? 500 + (k % 4) * 10 : 180 + (k % 3) * 5; top = !top; k++; }
  return out;
}
const BASE = Object.freeze(tracked().map(Object.freeze));
const speed = (s, a, b) => { let m = 0; for (let i = 1; i < s.length; i++) if (s[i].at >= a && s[i - 1].at <= b) m = Math.max(m, (Math.abs(s[i].pos - s[i - 1].pos) * 1000) / (s[i].at - s[i - 1].at)); return m; };
const gap = (out, t) => Math.abs(posAt(out, t) - posAt(BASE, t));
const SLOW = [3250, 13250], FAST = [22090, 32000];
const FRAME = 1000 / 30;

// the edges' own ease, without the limiter (paw-xu4v: under a cap the limiter also slows FAST's own 470 pos/s strokes)
const FREE = { maxSpeed: 0 };
test('knotting cycles and Reshape ease in from the trace: no step at a mid-stroke edge (was 23 pos / +396 pos/s, 15 pos)', () => {
  for (const [t0, t1] of [SLOW, FAST]) {
    const k = applyFx(BASE, [{ id: 'k', kind: 'knotting', t0, t1 }], FREE);
    assert.ok(isValid(k));
    assert.ok(gap(k, t0) <= 1 && gap(k, t1) <= 1, `knot gaps ${gap(k, t0)} / ${gap(k, t1)}`);
    assert.ok(speed(k, t0 - 150, t0 + 150) - speed(BASE, t0 - 150, t0 + 150) <= 100, 'no jerk at the edge');
    const s = applyFx(BASE, [{ id: 's', kind: 'shape', t0, t1, params: { lo: 20, hi: 70 } }], FREE);
    assert.ok(isValid(s) && gap(s, t0) <= 1 && gap(s, t1) <= 1, `reshape gaps ${gap(s, t0)} / ${gap(s, t1)}`);
    // the turns stay the base's (time): every tracked turn well inside has a turn of the result on it
    const turns = baseTurns(s, t0, t1).map((x) => x.at);
    for (const x of baseTurns(BASE, t0 + 800, t1 - 800)) assert.ok(turns.includes(x.at), `turn ${x.at} kept`);
  }
  // inside, past the ease, the knot cycles are exactly what they were (levels on the tracked turns)
  const at = new Map(applyFx(BASE, [{ id: 'k', kind: 'knotting', t0: 4000, t1: 16000 }]).map((a) => [a.at, a.pos]));
  for (const x of baseTurns(BASE, 5000, 15000)) assert.equal(at.get(x.at), x.kind === 'top' ? 80 : 0);
});

test('idle / insertion / pull-out start from the trace AT their edge (was its last turn: 29..80 pos off) and an idle on fast strokes holds (was a 10 s ramp)', () => {
  for (const [kind, params] of [['idle', {}], ['knotting', { mode: 'none', to: 0 }], ['knotting', { mode: 'none', to: 100 }]]) for (const [t0, t1] of [SLOW, FAST]) {
    const out = applyFx(BASE, [{ id: 'e', kind, t0, t1, params }], FREE);
    assert.ok(isValid(out));
    assert.ok(gap(out, t0) <= 1, `${kind} ${t0}: ${gap(out, t0)}`);
    assert.ok(out.some((a) => a.at === t0), `${kind}: its first point is on the edge`);
  }
  const idle = applyFx(BASE, [{ id: 'i', kind: 'idle', t0: FAST[0], t1: FAST[1] }]).filter((a) => a.at >= FAST[0] && a.at <= FAST[1] - 300);
  assert.ok(Math.max(...idle.map((a) => a.pos)) - Math.min(...idle.map((a) => a.pos)) <= 1, 'held');
});

test('the final plays the modifiers under the machine\'s speed limit (a spurt swung at 435 pos/s under 150: the default cap)', () => {
  const doc = { axes: { stroke: [{ at: 0, pos: 50 }, { at: 40000, pos: 50 }] }, scenes: [], finish: null,
    fx: [{ id: 's', kind: 'spurt', t0: 25000, t1: 25000, params: { amount: 40 } }, { id: 't', kind: 'throbbing', t0: 5000, t1: 9000, params: { amount: 30 } }] };
  const fin = finalScript(doc, 'stroke', { maxSpeed: 150 });
  assert.ok(speed(fin, 0, 40000) <= 150, String(speed(fin, 0, 40000)));
  // paw-xu4v: the one limiter keeps the times and gives way in size: the spurt's deepest swing stays on its frame
  const ring = fin.filter((a) => a.at >= 24900 && a.at <= 25300);
  assert.equal(Math.min(...ring.map((a) => a.pos)), fin.find((a) => a.at === 25000).pos, 'the deepest swing on its frame');
  assert.ok(fin.find((a) => a.at === 25000).pos < 50);
});

test('a single throb keeps its dip on the frame under a cap (a big one used to vanish); throb dips and a knot pop land on frames with a grid', () => {
  const flat = [{ at: 0, pos: 100 }, { at: 30000, pos: 100 }], s = singleThrob(2000, { amount: 30 });
  const out = applyFx(flat, [{ id: 'th', kind: 'throbbing', ...s }], { maxSpeed: 300 }), deep = Math.min(...out.map((a) => a.pos));
  assert.ok(deep < 100 && out.find((a) => a.pos === deep).at === 2000, 'the dip, smaller under the cap, still on its frame');
  const beats = applyFx(flat, [{ id: 'b', kind: 'throbbing', t0: 1000, t1: 9000 }], { grid: FRAME }).filter((a) => a.pos === 90).map((a) => a.at);
  assert.ok(beats.length >= 10 && beats.every((t) => frameStartOf(t, FRAME) === t), JSON.stringify(beats));
  const slow = [{ at: 0, pos: 90 }, { at: 1000, pos: 20 }, { at: 2000, pos: 85 }, { at: 3000, pos: 60 }, { at: 9000, pos: 55 }];
  const knot = applyFx(slow, [{ id: 'k', kind: 'knotting', t0: 3000, t1: 8000, params: { mode: 'single', popAt: 0.777 } }], { grid: FRAME });
  const pop = knot.find((a) => a.pos === 20).at;   // the knot depth (press 20): the pop starts there
  assert.equal(frameStartOf(pop, FRAME), pop);
});

test('tracked spurts land on the start of their frame, as a hand-placed one', async () => {
  const { resolveTracked } = await import('../src/features/timeline/mods-tracked.js');
  const t = [], v = [];   // as mods-tracked.test's pulses: a balls scale that contracts every 900 ms, sampled every 33 ms (off the 30 fps frames)
  for (let x = 0; x < 10000; x += 33) { const p = x % 900; t.push(x); v.push(1 - 0.2 * Math.exp(-(((p - 60) / 40) ** 2)) + 0.004 * Math.sin(x * 0.37)); }
  const r = resolveTracked([{ id: 'o', kind: 'orgasm', t0: 2000, t1: 6000, params: {} }], () => ({ channels: { sem_balls_scale: { t, v } } }), [], () => [], (x) => frameStartOf(x, FRAME));
  const sp = r.list.filter((e) => e.kind === 'spurt');
  assert.ok(sp.length >= 3 && sp.every((e) => frameStartOf(e.t0, FRAME) === e.t0 && e.t1 === e.t0), JSON.stringify(sp.map((e) => e.t0)));
});

test('strength: one envelope per modifier; flat is the modifier as before, a build starts on the trace and ends in full, follow breathes with the strokes', () => {
  const p = fxParams({ kind: 'orgasm' });
  assert.ok(envFlat(p) && strength(0.5, p) === 1);
  const b = { ...p, ...ENV_PRESETS.build };
  assert.deepEqual([strength(0, b), strength(0.4, b) > 0.3 && strength(0.4, b) < 0.7, strength(0.9, b)], [0, true, 1]);
  const sw = { ...p, ...ENV_PRESETS.swell };
  assert.deepEqual([strength(0, sw), strength(0.5, sw), strength(1, sw)], [0, 1, 0]);
  const e = { id: 'o', kind: 'orgasm', t0: 10000, t1: 30000 }, full = applyFx(BASE, [e]);
  assert.deepEqual(applyFx(BASE, [{ ...e, params: { ...ENV_PRESETS.flat } }]), full, 'flat = as before');
  const built = applyFx(BASE, [{ ...e, params: ENV_PRESETS.build }]);
  assert.ok(isValid(built));
  const dev = (s, a, b2) => Math.max(...BASE.filter((x) => x.at > a && x.at < b2).map((x) => Math.abs(posAt(s, x.at) - x.pos)));
  assert.ok(dev(built, 10000, 12000) < 0.5 * dev(full, 10000, 12000) || dev(full, 10000, 12000) < 2, 'little at the start');
  assert.ok(Math.abs(dev(built, 27000, 29000) - dev(full, 27000, 29000)) <= 1, 'in full at the end');
  // follow: a throb on strokes of two sizes is deeper where the strokes are bigger
  const mixed = []; for (let t = 0, k = 0; t <= 20000; t += 500, k++) mixed.push({ at: t, pos: t < 10000 ? (k % 2 ? 60 : 40) : (k % 2 ? 95 : 5) });
  const th = { id: 't', kind: 'throbbing', t0: 1000, t1: 19000, params: { follow: 1, amount: 20 } }, o = applyFx(mixed, [th]), plain = applyFx(mixed, [{ ...th, params: { amount: 20 } }]);
  const depth = (s, a, b2) => Math.max(...s.filter((x) => x.at > a && x.at < b2).map((x) => Math.abs(x.pos - posAt(mixed, x.at))));
  assert.ok(depth(o, 2000, 9000) < 0.5 * depth(plain, 2000, 9000), `small strokes: ${depth(o, 2000, 9000)} vs ${depth(plain, 2000, 9000)}`);
  assert.ok(depth(o, 11000, 18000) >= 0.9 * depth(plain, 11000, 18000), 'big strokes: full');
});

test('the row: edges land on turns, a big hit size, default spans per kind, keys land on turns, Ctrl+arrows nudge', async () => {
  const { turnSnaps, defaultSpan, onTurns, FX_EDGE_PX, envModel } = await import('../src/features/timeline/fx-edit.js');
  const { snapTime } = await import('../src/features/timeline/intervals.js');
  const { toggleMod } = await import('../src/features/timeline/mods.js');
  // a drag released 40 ms off a turn (inside the 7 px snap at 100 px/s) lands ON it; before it landed 40 ms off (frames only)
  const turn = baseTurns(BASE, 5000, 6000)[0].at, tol = 70;
  assert.equal(snapTime(turn + 40, turnSnaps(BASE, 0, 40000), tol, FRAME).t, turn);
  // an edge / a spurt takes the pointer 9 px away (it was 6 / 7; interact.js needs the app: the row's source passes it)
  const { readFileSync } = await import('node:fs');
  const lane = readFileSync(new URL('../src/features/timeline/FxLane.svelte', import.meta.url), 'utf8');
  assert.equal(FX_EDGE_PX, 9);
  assert.match(lane, /hitInterval\([^;]*FX_EDGE_PX\)/); assert.match(lane, /bd = FX_EDGE_PX/);
  // double-click: an insertion = the half-stroke around t (turn to turn); an orgasm = the shot; no cuts: edges on turns
  const ins = defaultSpan('knotting', 5100, { script: BASE, cuts: [], push: true }), T = baseTurns(BASE, 4000, 7000).map((x) => x.at);
  assert.ok(T.includes(ins.t0) && T.includes(ins.t1) && ins.t0 <= 5100 && ins.t1 > 5100, JSON.stringify(ins));
  assert.deepEqual(defaultSpan('orgasm', 5100, { script: BASE, cuts: [3000, 9000], dur: 40000 }), { t0: 3000, t1: 9000 });
  const free = defaultSpan('orgasm', 25000, { script: BASE, cuts: [], dur: 40000 }), FT = baseTurns(BASE, 0, 40000).map((x) => x.at);
  assert.ok(FT.includes(free.t0) && FT.includes(free.t1), JSON.stringify(free));
  assert.equal(defaultSpan('spurt', 100, {}), null);
  assert.deepEqual(onTurns({ t0: 100, t1: 900 }, [], 400), { t0: 100, t1: 900 }, 'no turns: as it was');
  // a key at the playhead with no scenes: 4 s from t, the end on a turn, the start never after t
  const r = toggleMod([], 'orgasm', { t: 5100, id: 'm', turns: baseTurns(BASE, 4000, 11000) });
  assert.ok(r.mod.t0 <= 5100 && FT.includes(r.mod.t1), JSON.stringify(r.mod));
  assert.equal(toggleMod(r.list, 'orgasm', { t: 5100, id: 'n', turns: [] }).did, 'remove', 'the key again at t takes it off');
  // paw-35pp: a knotting 8 s or less is a One knot only where it holds fewer than 3 strokes (else a knot on each);
  // paw-afoe: the mode is stored when it is made, an edge drag never flips it
  const { makeMod } = await import('../src/features/timeline/mods.js');
  const { dragFx } = await import('../src/features/timeline/fx-edit.js');
  const { knotMode } = await import('../src/lib/fx.js');
  assert.deepEqual(makeMod('k', 'knotting', 22000, 29800, null, BASE).params, { mode: 'cycles' }, 'over ~10 fast strokes: cycles');
  assert.deepEqual(makeMod('k', 'knotting', 22000, 29800).params, { mode: 'single' }, 'no stroke known, 8 s or less: one knot');
  assert.deepEqual(makeMod('k', 'knotting', 3600, 4500, null, BASE).params, { mode: 'single' }, 'one turn inside: one knot');
  assert.deepEqual(makeMod('k', 'knotting', 3000, 30000).params, {}, 'past 8 s with nothing tracked yet: auto');
  const one = [makeMod('k', 'knotting', 3600, 4500, null, BASE)];
  for (const [part, t] of [['t1', 12000], ['t0', 0]]) {
    const L = dragFx(one, 'k', part, { t, stroke: BASE }), e = L[0];
    assert.ok(baseTurns(BASE, e.t0, e.t1).length >= 6, 'dragged over many strokes');
    assert.equal(knotMode(fxParams(e), BASE, e.t0, e.t1), 'single', `${part} drag: still one knot`);
  }
  // one stored without a mode (an older project) keeps the mode it had before the drag
  const old = [{ id: 'o', kind: 'knotting', t0: 3600, t1: 4500, params: {} }], dragged = dragFx(old, 'o', 't1', { t: 12000, stroke: BASE })[0];
  assert.equal(dragged.params.mode, 'single'); assert.equal(knotMode(fxParams(dragged), BASE, dragged.t0, dragged.t1), 'single');
  // the strength editor: every handle reads back its value
  const { snapTo } = await import('../src/ui/kit/curve.js');
  for (const params of [{}, { envIn: 0.3, envFrom: 0.2, envOut: 0.4, envTo: 0.1, envPeak: 0.8, follow: 0.5 }]) {
    const m = envModel(fxParams({ kind: 'orgasm', params }));
    for (const h of m.handles) assert.ok(Math.abs(snapTo(h.toValue(h.x, h.y), h) - h.value) <= (h.step || 1) + 1e-9, `${h.key}: ${h.toValue(h.x, h.y)} vs ${h.value}`);
  }
  // the nudge goes through the key map (commands-fx imports vite-only modules: read its source)
  const src = readFileSync(new URL('../src/features/timeline/commands-fx.js', import.meta.url), 'utf8');
  assert.match(src, /id: `timeline\.fx\.nudge\$\{d\}`.*keys: \[`Ctrl\+Arrow\$\{d\}`\]/);
});
