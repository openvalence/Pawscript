// The finishing stack (paw-j6e, src/lib/finish.js): base -> Autorange (a live pass) -> live effects = what plays and
// exports; nothing is baked. Flatten is the one write of the final into the points (undoable, what plays does not
// change). The app half runs through vite's SSR transform.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { finalScript, layersOf, fxCtxOf } from '../src/lib/finish.js';
import { rangePlan, rangePass } from '../src/lib/autorange.js';
import { applyFx } from '../src/lib/fx.js';
import { appDocFrom, projectDoc } from '../src/app/project-logic.js';
import { serialize, parse } from '../src/lib/io/project.js';

const strokes = (t0, t1, half = 400, lo = 20, hi = 80) => { const s = []; let k = 0; for (let t = t0; t < t1; t += half) s.push({ at: t, pos: k++ % 2 ? hi : lo }); return s; };
const sc = (a, b, tags, extra = {}) => ({ start_ms: a, end_ms: b, tags, ...extra });
const PEN = ['anal', 'penetration'];
const scenes = [sc(0, 20000, PEN), sc(20000, 40000, PEN), sc(40000, 60000, PEN)];
const base = strokes(0, 60000);
const spurt = { id: 's1', kind: 'spurt', t0: 50000, t1: 50000 };
const doc = (o = {}) => ({ axes: { stroke: base }, scenes, fx: [], finish: null, ...o });

test('no layer: the final IS the points (same array); other axes never have layers', () => {
  const d = doc({ axes: { stroke: base, roll: strokes(0, 1000) } });
  assert.equal(finalScript(d), base);
  assert.equal(finalScript(d, 'roll'), d.axes.roll);
  assert.deepEqual(layersOf(d), { autorange: false, effects: 0 });
});

test('order: base -> autorange -> effects; memoised on the inputs, recomputed when one changes', () => {
  const d = doc({ fx: [spurt], finish: { autorange: true } });
  const plan = rangePlan(scenes, base, { fx: [spurt] }), want = applyFx(rangePass(base, plan), [spurt]);
  const out = finalScript(d);
  assert.deepEqual(out, want);
  assert.equal(finalScript(d), out, 'same inputs: the same array');
  assert.notEqual(finalScript({ ...d, finish: { autorange: false } }), out);
  assert.deepEqual(finalScript({ ...d, finish: { autorange: false } }), applyFx(base, [spurt]), 'off: the effects on the raw points');
  // an edited point re-evaluates (the pass is never stale)
  const moved = base.map((p) => (p.at === 10000 ? { ...p, pos: 50 } : p));
  assert.notDeepEqual(finalScript({ ...d, axes: { stroke: moved } }), out);
});

test('modifiers in the pass: an Orgasm modifier is the orgasm band where it is (mods.js withMods), muted too; the curve only when live', () => {
  const PEN3 = [sc(0, 20000, PEN), sc(20000, 40000, PEN), sc(40000, 60000, PEN)];
  const org = { id: 'o', kind: 'orgasm', t0: 40000, t1: 60000, params: {}, muted: true };
  const off = finalScript({ axes: { stroke: base }, scenes: PEN3, fx: [], finish: { autorange: true } });
  const on = finalScript({ axes: { stroke: base }, scenes: PEN3, fx: [org], finish: { autorange: true } });
  const deepest = (s) => Math.min(...s.filter((p) => p.at >= 41000 && p.at < 59000).map((p) => p.pos));
  assert.ok(deepest(on) < deepest(off), 'the orgasm band goes deeper over the modifier');
  assert.deepEqual(on.filter((p) => p.at < 39000), off.filter((p) => p.at < 39000), 'nothing changes before it');
  const live = finalScript({ axes: { stroke: base }, scenes: PEN3, fx: [{ ...org, muted: false }], finish: { autorange: false } });
  assert.notDeepEqual(live, base, 'live: its curve acts on the points');
  assert.equal(finalScript({ axes: { stroke: base }, scenes: PEN3, fx: [org], finish: { autorange: false } }), base, 'muted, pass off: the points');
});

test('save / load round trip: modifiers are the `modifiers` block (format 3) and come back as they were; scenes never carry them', () => {
  const mods = [{ id: 'k', kind: 'knotting', t0: 30000, t1: 34000, params: { mode: 'single' } }, { id: 'o', kind: 'orgasm', t0: 41000, t1: 59000, params: {}, muted: true }, spurt];
  const d = { media: null, axes: { stroke: base }, chapters: [], bookmarks: [], loops: [], plan: [], ghosts: [], scenes: [sc(0, 60000, PEN)], fx: mods, finish: { autorange: false } };
  const text = serialize(projectDoc(d)), raw = JSON.parse(text);
  assert.equal(raw.version, 3);
  assert.deepEqual(raw.modifiers, mods);
  assert.equal(raw.fx, undefined);
  const back = appDocFrom(parse(text).doc ?? parse(text));
  assert.deepEqual(back.fx, mods);
  assert.equal(back.project.converted, undefined, 'a format-3 project is not converted');
  const again = JSON.parse(serialize(projectDoc({ ...d, ...back })));
  assert.deepEqual([again.modifiers, again.scenes], [raw.modifiers, raw.scenes], 'saves back the same');
});

test('an older project (format 2): its effects and modifier spans become modifiers once; the scenes lose the spans and the insertion tag', () => {
  const v2 = { format: 'pawproj', version: 2, axes: { stroke: [] }, scenes: [
    { start_ms: 0, end_ms: 10000, tags: ['anal', 'insertion'] },
    { start_ms: 10000, end_ms: 30000, tags: ['anal', 'penetration', '-orgasm', { id: 'orgasm', t0: 20000, t1: 25000 }, { id: 'knotting', t0: 11000, t1: 15000 }, { id: 'throbbing', t0: 26000, t1: 28000 }] }],
    fx: [{ id: 'k1', kind: 'knotting', t0: 11000, t1: 15000, params: { mode: 'single' } }, { id: 's1', kind: 'spurt', t0: 21000, t1: 21000 }, { id: 't1', kind: 'throb', t0: 27000, t1: 27000 }] };
  const d = appDocFrom(parse(JSON.stringify(v2)).doc ?? parse(JSON.stringify(v2)));
  const by = (k) => d.fx.filter((e) => e.kind === k);
  assert.deepEqual(by('knotting').map((e) => [e.id, e.t0, e.t1]), [['k1', 11000, 15000]], 'a span with its tied effect IS that modifier (one, not two)');
  assert.deepEqual(by('orgasm').map((e) => [e.t0, e.t1, !!e.muted]), [[20000, 25000, true]], 'a span with no effect: a muted modifier (it plays as before)');
  assert.deepEqual(by('insertion').map((e) => [e.t0, e.t1, !!e.muted]), [[0, 10000, false]], 'the insertion tag: an Insertion modifier over its span');
  assert.equal(by('spurt').length, 1);
  assert.ok(by('throbbing').some((e) => e.t1 > e.t0 && e.t1 - e.t0 < 1000), 'a throb one-shot: a throbbing range one beat long');
  assert.ok(by('throbbing').some((e) => e.t0 === 26000 && e.muted), 'the throbbing span: a muted modifier');
  const tags = d.scenes.flatMap((s) => s.tags || []);
  assert.ok(!tags.some((t) => typeof t === 'object' || t === 'insertion'), JSON.stringify(tags));
  assert.ok(!tags.includes('-orgasm'), "the detection's removal goes: the detection is a suggestion now, never a tag (paw-8b4h)");
  assert.match(d.project.converted, /older version/);
});

// ---- the app half: Accept writes the base only, the toggle and Flatten are single undo steps ----
const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, R, T;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  R = await server.ssrLoadModule('/src/features/timeline/commands-range.js');
  T = await server.ssrLoadModule('/src/features/timeline/state.svelte.js');
});
after(() => server?.close());
const mkApp = (d = {}) => {
  const app = M.createMockApp({ doc: { axes: { stroke: base }, scenes, fx: [spurt], ...d }, keys: false });
  app.toast = () => {};
  T.bindApp(app);
  return app;
};

test('Autorange on / off: one undo step each, the final follows, off = the effects on the raw points', () => {
  const app = mkApp(), F = () => app.finishEnv && finalScript(app.doc, 'stroke', app.finishEnv());
  const raw = F();
  assert.deepEqual(raw, applyFx(base, [spurt], fxCtxOf(app.finishEnv())), 'the modifiers under the app\'s speed limit and frames (paw-r9nh)');
  assert.equal(R.setAutorange(app, true), true);
  assert.equal(app.doc.finish.autorange, true);
  assert.ok(app.doc.finish.policy, 'the policy it started with is kept in the project');
  assert.notDeepEqual(F(), raw);
  assert.equal(app.doc.axes.stroke, base, 'the points are untouched');
  app.undo();
  assert.ok(!app.doc.finish?.autorange);
  assert.deepEqual(F(), raw);
});

test('a band drag edits scene data only (the pass follows); steering a band turns the pass on', () => {
  const app = mkApp();
  const g = app.begin('drag');
  R.writeSceneRange(app, 0, { lo: 50, hi: 60 });
  g.commit();
  assert.equal(app.doc.finish.autorange, true);
  assert.deepEqual(app.doc.scenes[0].range, { lo: 50, hi: 60, lo1: 50, hi1: 60 });
  assert.equal(app.doc.axes.stroke, base);
  const out = finalScript(app.doc, 'stroke', app.finishEnv()).filter((p) => p.at > 500 && p.at < 19000);
  assert.ok(out.every((p) => p.pos >= 50 && p.pos <= 60), 'S1 inside its band');
});

test('Flatten (everything): the final into the points, layers cleared, what plays unchanged; one undo step', () => {
  const app = mkApp({ finish: { autorange: true } });
  const want = finalScript(app.doc, 'stroke', app.finishEnv());
  const n = app.history.entries.length;
  assert.ok(R.flatten(app, null) > 0);
  assert.equal(app.history.entries.length, n + 1);
  assert.deepEqual(app.doc.axes.stroke, want);
  assert.equal(app.doc.finish.autorange, false);
  assert.ok(app.doc.fx.every((e) => e.baked));
  assert.deepEqual(finalScript(app.doc, 'stroke', app.finishEnv()), want, 'plays the same');
  app.undo();
  assert.equal(app.doc.axes.stroke, base);
  assert.equal(app.doc.finish.autorange, true);
});

test('Flatten a range: snapped to whole scenes, that stretch left as it is, the rest still live', () => {
  const app = mkApp({ fx: [], finish: { autorange: true } });
  const want = finalScript(app.doc, 'stroke', app.finishEnv());
  R.flatten(app, { t0: 25000, t1: 30000 });
  assert.deepEqual(app.doc.finish.bands.map((b) => [b.t0, b.t1, !!b.off]), [[20000, 39999, true]], 'paw-2ud: a hand piece the pass leaves alone');
  assert.equal(app.doc.finish.autorange, true);
  const now = finalScript(app.doc, 'stroke', app.finishEnv());
  // exact except the neighbour's first EASE_MS: it no longer eases toward a map inside the flattened stretch (known, paw-gsj)
  const edge = (p) => (p.at > 19600 && p.at < 20400) || (p.at >= 40000 && p.at < 40400);
  assert.deepEqual(now.filter((p) => !edge(p)), want.filter((p) => !edge(p)), 'what plays is unchanged');
  assert.deepEqual(app.doc.axes.stroke.filter((p) => p.at < 20000), base.filter((p) => p.at < 20000), 'S1 points untouched (still ranged live)');
});

test('paw-2ud in the app: split at the playhead, merge back, reset; each one undo step; orphans dropped with an undo toast', () => {
  const app = mkApp({ fx: [], finish: { autorange: true } }), n0 = app.history.entries.length;
  assert.ok(R.splitBand(app, 10000));
  assert.deepEqual(app.doc.finish.bands.map((b) => [b.t0, b.t1]), [[0, 9999], [10000, 19999]]);
  assert.equal(app.history.entries.length, n0 + 1);
  const env = R.envOf(app), p = env.pieces.find((q) => q.t0 === 0);
  assert.ok(R.mergeBand(app, p, 't1'));
  assert.equal(R.envOf(app).pieces.filter((q) => q.t1 <= 20000).length, 1);
  assert.equal(app.history.entries.length, n0 + 2);
  R.resetBand(app, 'all');
  assert.deepEqual(app.doc.finish.bands, []);
  // a hand piece in a scene that goes away
  R.splitBand(app, 50000);
  const toasts = []; app.toast = (m, k, o) => toasts.push({ m, o });
  app.transact('delete scene', () => { app.doc.scenes = app.doc.scenes.slice(0, 2); });
  assert.equal(R.dropOrphans(app), 2);
  assert.deepEqual(app.doc.finish.bands, []);
  assert.match(toasts[0].m, /2 hand-made/);
  toasts[0].o.action.run();
  assert.equal(app.doc.finish.bands.length, 2, 'the toast undoes the drop');
});

test('paw-2lp7.4: an old fill on an off-screen shot is the bridge now (not a fill); paw-x7w7: it plays live, and Flatten writes it with what plays', async () => {
  const TS = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
  const gapped = base.filter((p) => p.at < 20000 || p.at >= 26000);
  const app = mkApp({ axes: { stroke: gapped }, scenes: [sc(0, 20000, PEN), sc(20000, 26000, ['offscreen'], { fill: 'both' }), sc(26000, 60000, PEN)], fx: [], finish: { autorange: true } });
  const tr = TS.trackingFor(app);
  app.tracking = tr;
  assert.equal(app.doc.scenes[1].fill, undefined, 'the old fill is read as what it was for: the off-screen bridge');
  assert.deepEqual(tr.fillsOn('stroke'), []);
  const b = tr.bridges.find((x) => x.t0 === 20000);
  assert.ok(b?.script.length >= 8 && b.mode === 'carry', 'the bridge waits, carried from both sides');
  const S = await server.ssrLoadModule('/src/lib/script-of.js'), F = await server.ssrLoadModule('/src/lib/finish.js');
  assert.ok(S.scriptOf(app, 'stroke').filter((p) => p.at > 20000 && p.at < 26000).length >= 8, 'the bridge is in the script (live)');
  const plays = F.finalOf(app);
  R.flatten(app, null);
  assert.ok(app.doc.axes.stroke.filter((p) => p.at > 20000 && p.at < 26000).length >= 8, 'Flatten writes what plays: the live bridge is baked with it');
  assert.deepEqual(app.doc.axes.stroke, plays, 'what plays does not change');
});
