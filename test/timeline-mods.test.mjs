// Modifiers (paw-ef73.20, owner: "two places you can mark knotting, two places you can mark orgasm, they need to be
// one"): ONE object per event in doc.fx (src/features/timeline/mods.js, lib/fx.js), marked in any tab, shaped in Refine;
// the scene-level consumers read them through withMods; one menu list of kinds everywhere (fxmenu.js modItems); the
// app commands (commands-mods / commands-fx) through vite's SSR transform.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { modsOf, spansOf, modAt, toggleMod, toggleModOver, modHints, spurtHint, withMods, sceneSpans, makeMod, MODS, DEFAULT_MS, modLabel } from '../src/features/timeline/mods.js';
import { normScenes, stripMods, toSaved } from '../src/features/timeline/shots.js';
import { tagSpans, sceneTags, skipReason, tagSpansIn, withStructure } from '../src/features/timeline/acts.js';
import { FX_KINDS, EVENT_KINDS, REFINE_KINDS, REFINE_WHY } from '../src/lib/fx.js';
import { innerOf, dragFx } from '../src/features/timeline/fx-edit.js';
import { modItems } from '../src/features/timeline/fxmenu.js';

const S = (a, b, o = {}) => ({ start_ms: a, end_ms: b, ...o });
const A = ['anal', 'penetration'];
// two scenes: scene 1 = shots 0-2 (0-30 s), scene 2 = shots 3-4 (30-50 s)
const L = () => normScenes([S(0, 10000, { tags: A }), S(10000, 20000, { join: true, tags: A }), S(20000, 30000, { join: true, tags: A }), S(30000, 40000, { tags: ['oral'] }), S(40000, 50000, { join: true, tags: ['oral'] })]);
const M = (id, kind, t0, t1, o = {}) => ({ id, kind, t0, t1, params: {}, ...o });

test('kinds: the six event kinds in picker order, the rest only in Refine; one name each', () => {
  assert.deepEqual(MODS, ['orgasm', 'knotting', 'throbbing', 'idle', 'insertion', 'pullout']);
  assert.deepEqual(EVENT_KINDS, MODS);
  assert.deepEqual(REFINE_KINDS, ['spurt', 'shape', 'climax']);
  assert.deepEqual(MODS.map(modLabel), ['Orgasm', 'Knotting', 'Throbbing', 'Idle', 'Insertion', 'Pull-out']);
  for (const k of Object.keys(FX_KINDS)) assert.ok(FX_KINDS[k].tip?.length > 10, `${k} has a tip`);
});

test('toggle: a range is exact (again: off), the playhead starts one DEFAULT_MS long, over cuts and scenes (or removes the one under it)', () => {
  const sc = L();
  let r = toggleMod([], 'orgasm', { range: { t0: 21000, t1: 29000 }, scenes: sc, id: 'o1' });
  assert.deepEqual([r.did, r.mod.t0, r.mod.t1], ['add', 21000, 29000]);
  assert.equal(toggleMod(r.list, 'orgasm', { range: { t0: 21000, t1: 29000 }, scenes: sc }).did, 'remove');
  r = toggleMod([], 'knotting', { t: 28000, scenes: sc, id: 'k1' });
  assert.deepEqual([r.mod.t0, r.mod.t1, r.mod.params.mode], [28000, 32000, 'single'], 'over the scene boundary (no wall); 8 s or less: one knot');
  assert.equal(toggleMod(r.list, 'knotting', { t: 31000, scenes: sc }).did, 'remove', 'the one under the playhead goes');
  // scene edits never touch modifiers: they are not in the scenes
  assert.ok(sc.every((s) => !(s.tags || []).some((e) => typeof e === 'object')));
  assert.equal(toggleMod([], 'shape', { t: 1000, scenes: sc }), null, 'a Refine kind is not toggled from the chips / keys');
  assert.deepEqual([makeMod('x', 'knotting', 0, 9000).params, DEFAULT_MS], [{}, 4000], 'a long knotting: cycles (auto)');
});

test('free on the timeline: a modifier crosses shots and scenes; spansOf merges, modAt finds the latest under t', () => {
  const fx = [M('a', 'orgasm', 25000, 35000), M('b', 'orgasm', 34000, 36000), M('s', 'spurt', 26000, 26000), M('k', 'knotting', 1000, 2000)];
  assert.deepEqual(spansOf(fx, 'orgasm'), [[25000, 36000]]);
  assert.equal(modAt(fx, 34500, 'orgasm').id, 'b');
  assert.equal(modAt(fx, 26000).id, 'a', 'a spurt is a point, never "under" t');
  assert.deepEqual(modsOf(fx, null, true).map((e) => e.id), ['a', 'b', 'k']);
});

test('the consumers read the modifiers through withMods: the sidecar climax / idle labels, a whole idle shot, Autorange\'s overlays; never stored', () => {
  const sc = L(), fx = [M('o', 'orgasm', 21000, 29000), M('i', 'idle', 30000, 40000), M('j', 'idle', 42000, 44000, { muted: true })];
  const p = withMods(sc, fx);
  assert.equal(withMods(sc, fx), p, 'cached per (list, fx)');
  const lab = (st) => tagSpans(p).filter((x) => x.state === st).map((x) => [x.start_ms, x.end_ms]);
  assert.deepEqual(lab('climax'), [[21000, 29000]]);
  assert.deepEqual(lab('idle'), [[30000, 40000], [42000, 44000]], 'a muted modifier is still the mark: the consumers see it');
  assert.equal(skipReason(p[3]), 'idle: nothing to track, generated', 'over a whole shot the shot is idle');
  assert.equal(skipReason(p[4]), '');
  assert.deepEqual(tagSpansIn({ ...p[0], end_ms: 30000 }, 'orgasm'), [{ t0: 21000, t1: 29000 }]);
  assert.deepEqual(sceneSpans(p, 'idle'), [[30000, 40000], [42000, 44000]]);
  assert.deepEqual(sceneSpans(p, 'orgasm'), [[21000, 29000]]);
  // a projected list written back loses them: scenes never carry modifiers
  assert.deepEqual(stripMods(p).map((s) => s.tags), sc.map((s) => s.tags));
  assert.deepEqual(toSaved(p), toSaved(sc));
  assert.equal(stripMods(sc), sc);
  assert.ok(!sceneTags(sc[2]).includes('orgasm'));
});

test('paw-8b4h: the tagger\'s detected orgasm is no span and no tag, only a suggestion over its scene (modHints) until one of the kind is there', () => {
  const det = [S(0, 10000, { tags: A, describe: { tags: [{ tag: 'cumshot', score: 0.9 }] } }), S(10000, 20000, { tags: A })];
  assert.deepEqual(sceneSpans(det, 'orgasm'), []);
  assert.deepEqual(tagSpans(det), [], 'no climax label from a detection');
  assert.ok(!sceneTags(det[0]).includes('orgasm'));
  assert.deepEqual(modHints(det, []), [{ kind: 'orgasm', t0: 0, t1: 10000 }]);
  assert.deepEqual(modHints(det, [M('o', 'orgasm', 4000, 6000)]), [], 'a trimmed one there: no suggestion');
  assert.deepEqual(modHints(det, [M('o', 'orgasm', 12000, 16000)]), [{ kind: 'orgasm', t0: 0, t1: 10000 }], 'one in another scene does not count');
  assert.deepEqual(sceneSpans(withMods(det, [M('o', 'orgasm', 4000, 6000)]), 'orgasm'), [[4000, 6000]]);
});

test('paw-8b4h the derived structure reads the modifiers: an act-less shot with an Orgasm modifier is busy (not "after"), as the orgasm tag made it', () => {
  const quiet = { summary: { acts: [], positions: [], views: [], count: 'duo', species: ['wolf'] } };
  const l = [S(0, 10000, { tags: A }), S(10000, 20000, { describe: quiet })];
  assert.deepEqual(withStructure(l).map((s) => s.structure ?? null), [null, 'after']);
  const by = withMods(l, [M('o', 'orgasm', 12000, 18000)]), r = withStructure(l, by);
  assert.deepEqual(r.map((s) => s.structure ?? null), [null, null]);
  assert.equal(withStructure(l, by), r, 'cached per (list, by)');
  assert.ok(!(r[1].tags || []).length, 'the stored list keeps no modifier');
});

test('paw-8b4h toggleModOver: one per span; again (each spans exactly its span): off; one overlapping is picked, never replaced or doubled', () => {
  let n = 0; const id = () => `n${++n}`;
  const s1 = { t0: 0, t1: 30000 }, s2 = { t0: 30000, t1: 50000 };
  let r = toggleModOver([], 'orgasm', [s1], id);
  assert.deepEqual([r.did, r.ids, r.list.map((e) => [e.kind, e.t0, e.t1])], ['add', ['n1'], [['orgasm', 0, 30000]]]);
  assert.deepEqual(toggleModOver(r.list, 'orgasm', [s1], id), { list: [], did: 'remove', ids: [] }, 'again: off');
  const trimmed = [M('t', 'orgasm', 5000, 8000)];
  r = toggleModOver(trimmed, 'orgasm', [s1], id);
  assert.deepEqual([r.did, r.ids], ['pick', ['t']]); assert.equal(r.list, trimmed, 'nothing changes');
  const wide = [M('w', 'orgasm', 0, 40000)];
  assert.equal(toggleModOver(wide, 'orgasm', [s1], id).did, 'pick', 'an edited (wider) one is picked, not removed');
  r = toggleModOver(trimmed, 'orgasm', [s1, s2], id);
  assert.deepEqual([r.did, r.ids, r.list.map((e) => [e.id, e.t0, e.t1])], ['add', ['t', 'n2'], [['t', 5000, 8000], ['n2', 30000, 50000]]], 'several scenes: one each, the trimmed one kept and picked');
  const both = toggleModOver([], 'knotting', [s1, s2], id).list;
  assert.deepEqual(toggleModOver(both, 'knotting', [s1, s2], id).list, [], 'both made by it: both off');
  assert.equal(toggleModOver([], 'shape', [s1], id), null, 'a Refine kind is no scene control');
  assert.deepEqual(toggleModOver([M('k', 'knotting', 0, 30000)], 'orgasm', [s1], id).did, 'add', 'another kind does not count');
});

test('inner events: an orgasm\'s spurts move with it; other kinds have none', () => {
  const fx = [M('o', 'orgasm', 1000, 3000), M('s1', 'spurt', 1500, 1500), M('s2', 'spurt', 5000, 5000), M('k', 'knotting', 1000, 3000)];
  assert.deepEqual(innerOf(fx, fx[0]).map((e) => e.id), ['s1']);
  assert.deepEqual(innerOf(fx, fx[3]), []);
  const m = dragFx(fx, 'o', 'body', { dt: 1000 });
  assert.deepEqual(m.filter((e) => e.kind !== 'knotting').map((e) => [e.id, e.t0]), [['o', 2000], ['s1', 2500], ['s2', 5000]]);
  assert.equal(dragFx(fx, 'o', 't1', { t: 4000 }).find((e) => e.id === 's1').t0, 1500, 'a resize leaves the spurts');
});

test('a spurt outside every orgasm: the hint grows the nearest one in its scene, or offers a new one', () => {
  const sc = L(), fx = [M('o', 'orgasm', 21000, 24000)];
  assert.equal(spurtHint(fx, sc, 22000), null);
  assert.deepEqual(spurtHint(fx, sc, 27000), { grow: fx[0], t0: 21000, t1: 27500 });
  assert.deepEqual(spurtHint([], sc, 35000), { grow: null, t0: 33000, t1: 37000 });
});

test('one list of kinds in every menu: the event kinds enabled, the Refine kinds greyed outside Refine with the reason', () => {
  const picked = [], scenes = modItems('scenes', (k) => picked.push(k)), refine = modItems('refine', () => {});
  const rows = (items) => items.filter((x) => !x.separator);
  assert.deepEqual(rows(scenes).map((x) => x.label), ['Orgasm', 'Knotting', 'Throbbing', 'Idle', 'Insertion', 'Pull-out', 'Spurt', 'Reshape', 'Climax run-in']);
  assert.deepEqual(rows(scenes).filter((x) => x.disabled).map((x) => x.label), ['Spurt', 'Reshape', 'Climax run-in']);
  assert.ok(rows(scenes).filter((x) => x.disabled).every((x) => x.tip.includes(REFINE_WHY)));
  assert.ok(rows(refine).every((x) => !x.disabled));
  rows(scenes)[1].run();
  assert.deepEqual(picked, ['knotting']);
  assert.ok(!rows(modItems('refine', () => {}, { points: false })).some((x) => x.label === 'Spurt'), 'a range cannot become a point');
});

// ---- the app: one set of commands, edits on doc.fx ----
const root = fileURLToPath(new URL('..', import.meta.url));
let server, MA, CM, CF, T, ST;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  MA = await server.ssrLoadModule('/dev/mock-app.js');
  CM = await server.ssrLoadModule('/src/features/timeline/commands-mods.js');
  CF = await server.ssrLoadModule('/src/features/timeline/commands-fx.js');
  ST = await server.ssrLoadModule('/src/features/timeline/state.svelte.js');
});
after(() => server?.close());
const mkApp = (fx = [], mode = 'scenes') => {
  const app = MA.createMockApp({ doc: { axes: { stroke: [] }, scenes: L(), fx }, commands: [...CM.default, ...CF.default], keys: false });
  app.toast = () => {}; app.mode = mode;
  ST.bindApp(app);
  return app;
};

test('Shift+O twice marks an orgasm in and out (one undo step); the chip toggle over the range; Alt+Shift+O / N are the toggles', () => {
  const app = mkApp();
  app.player.seek(12000); CM.markModCmd(app, 'orgasm');
  app.player.seek(16000); CM.markModCmd(app, 'orgasm');
  assert.deepEqual(app.doc.fx.map((e) => [e.kind, e.t0, e.t1]), [['orgasm', 12000, 16000]]);
  assert.equal(ST.tl.fx, app.doc.fx[0].id, 'the new one is selected');
  app.undo();
  assert.deepEqual(app.doc.fx, []);
  app.doc.range = { t0: 41000, t1: 45000 };
  app.commands.run('timeline.mod.toggle.pullout');
  assert.deepEqual(app.doc.fx.map((e) => [e.kind, e.t0, e.t1]), [['pullout', 41000, 45000]]);
  const keys = (id) => app.commands.keysFor(id);
  assert.deepEqual([keys('timeline.mod.mark.orgasm'), keys('timeline.mod.mark.knotting'), keys('timeline.mod.toggle.orgasm'), keys('timeline.mod.toggle.knotting')], [['Shift+O'], ['Shift+K'], ['Alt+Shift+O'], ['Alt+Shift+N']]);
});

test('paw-8b4h the scene controls: the scene at the playhead, each selected scene, an owner\'s I / O range; one undo step, selected; again: off; a trimmed one is picked', async () => {
  const QB = await server.ssrLoadModule('/src/features/timeline/quickbar.js');
  const app = mkApp();
  app.doc.media = { durationMs: 50000 };
  const fx = () => app.doc.fx.map((e) => [e.kind, e.t0, e.t1]);
  app.player.seek(12000);
  app.commands.run('timeline.mod.toggle.orgasm');
  assert.deepEqual(fx(), [['orgasm', 0, 30000]], 'the whole scene at the playhead (its three shots)');
  assert.equal(ST.tl.fx, app.doc.fx[0].id, 'selected, to trim at once');
  assert.ok(app.doc.scenes.every((s) => !(s.tags || []).some((t) => (t?.id ?? t) === 'orgasm')), 'no scene tag');
  const span = QB.currentSpan(ST.scenesOf(app), ST.selOf(), app.doc.range, 12000, 50000);
  assert.equal(QB.chipTexts(ST.scenesOf(app), span).scene.text, 'Scene 1 · anal penetration', 'the label stays the action');
  app.undo();
  assert.deepEqual(app.doc.fx, [], 'one undo step');
  app.commands.run('timeline.mod.toggle.orgasm');
  app.commands.run('timeline.mod.toggle.orgasm');
  assert.deepEqual(app.doc.fx, [], 'again: off');
  // a trimmed one over the scene is selected, not doubled
  app.doc.fx = [M('t', 'orgasm', 5000, 8000)];
  ST.tl.fx = null;
  app.commands.run('timeline.mod.toggle.orgasm');
  assert.deepEqual(fx(), [['orgasm', 5000, 8000]]); assert.equal(ST.tl.fx, 't');
  // several selected scenes (the range follows the selection): one each, one undo step, all selected
  app.doc.fx = [];
  ST.setSel({ active: 0, shots: [2, 3] }); app.doc.range = { t0: 20000, t1: 40000 };
  app.commands.run('timeline.mod.toggle.knotting');
  assert.deepEqual(fx(), [['knotting', 0, 30000], ['knotting', 30000, 50000]]);
  assert.deepEqual(ST.tl.fxSel, app.doc.fx.map((e) => e.id));
  app.undo();
  assert.deepEqual(app.doc.fx, []);
  // an I / O range the owner set (not the selection's hull): the range
  app.doc.range = { t0: 25000, t1: 35000 };
  app.commands.run('timeline.mod.toggle.orgasm');
  assert.deepEqual(fx(), [['orgasm', 25000, 35000]]);
  // the Modifiers row's own pick at a time ({t, here}) stays from that time
  ST.setSel({ active: -1, shots: [] }); app.doc.range = null; app.doc.fx = [];
  CM.toggleModCmd(app, 'throbbing', { t: 1000, here: true });
  assert.deepEqual(fx(), [['throbbing', 1000, 5000]]);
});

test('one entry per act: adding an event kind where one is acts on it; Reshape only in Refine; delete takes an orgasm\'s spurts; a single throb is a throbbing range', () => {
  const app = mkApp([M('o', 'orgasm', 20000, 25000), M('s', 'spurt', 21000, 21000)]);
  app.player.seek(22000);
  CF.addModifier(app, 'orgasm');
  assert.equal(app.doc.fx.length, 2, 'the orgasm at the playhead is picked, not a second one');
  assert.equal(ST.tl.fx, 'o');
  assert.equal(app.commands.enabled('timeline.mod.add.shape'), false, 'Reshape outside Refine: greyed');
  app.mode = 'refine';
  assert.equal(app.commands.enabled('timeline.mod.add.shape'), true);
  app.mode = 'scenes';
  app.commands.run('timeline.fx.remove', { id: 'o' });
  assert.deepEqual(app.doc.fx, [], 'the orgasm went with its spurt');
  app.player.seek(5000); CF.throbAtPlayhead(app);
  const t = app.doc.fx[0];
  assert.deepEqual([t.kind, t.t0, t.t1 - t.t0 < 400], ['throbbing', 4960, true]);
});
