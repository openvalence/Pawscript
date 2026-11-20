// The fix log (src/app/fixlog.js, paw-dze): detectors per kind, episode grouping, the hand-edit summary, the live glue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Detector, Grouper, FixLog, pointEdits, axisSpan, scenesDiff, groupsDiff, fxDiff, diffPatches, describe, whereIn, projectId, runChanges } from '../src/app/fixlog.js';
import { Usage } from '../src/app/usage.svelte.js';

const T0 = Date.parse('2026-11-11T10:00:00Z');
const commit = (label, paths = 'scenes', extra = {}) => ({ k: 'edit:commit', label, paths, ...extra });
const kinds = (evs) => { const d = new Detector(); let t = T0; return evs.flatMap((e) => d.see({ t: (t += 1000), s: 's1', ...e })).map((f) => f.kind); };

// one row per kind: the events that lead to it (earlier ones set state), the kinds the last event gives
const TABLE = [
  ['shots detected', [commit('Detect scenes')], ['auto:shots.detect']],
  ['camera moves inside a loop joined', [commit('Camera moves inside a loop joined')], ['auto:shots.loopJoin']],
  ['Suggest', [commit('Groups: suggest')], ['auto:seed.suggest']],
  ['re-found', [commit('Groups: re-found after a cut')], ['auto:seed.refind']],
  ['filled from a repeat (paw-8mf4)', [commit('Groups: auto from 1:23')], ['auto:seed.repeat']],
  ['filled from a run', [commit('Groups: auto from the run at 0:41')], ['auto:seed.repeat']],
  ['fill dropped', [commit('Groups: drop the filled groups')], ['fix:seed.dropFill']],
  ['suggestions accepted as is', [commit('Groups: accept suggestions')], ['ok:seed.accept']],
  ['re-found accepted', [commit('Accept re-found groups')], ['ok:seed.accept']],
  ['painted from scratch (no diff)', [commit('Groups: paint unassigned_1')], ['fix:seed.paint']],
  ['named', [commit('Groups: assign unassigned_1 → c1_hips')], ['fix:seed.name']],
  ['reassigned part', [commit('Groups: assign c1_hips → c1_head')], ['fix:seed.reassign']],
  ['moved to the other character', [commit('Groups: c1_penis → c2_penis')], ['fix:seed.reassign']],
  ['swap C1 / C2 (older logs)', [commit('Groups: swap C1 and C2')], ['fix:seed.swapWho']],
  ['swap Bottom and Top', [commit('Groups: swap Bottom and Top')], ['fix:seed.swapWho']],
  ['swap two groups', [commit('Groups: swap c1_torso ↔ c1_torso2')], ['fix:seed.reassign']],
  ['deleted', [commit('Groups: delete c1_tail')], ['fix:seed.delete']],
  ['moved / scaled', [commit('Groups: move c1_hips'), commit('Groups: scale c1_hips')], ['fix:seed.move', 'fix:seed.move']],
  ['split', [commit('Groups: split c1_tail')], ['fix:seed.split']],
  ['flag', [commit('Groups: pulse c1_balls')], ['fix:seed.flag']],
  ['moved to this frame', [commit('Groups: move to this frame')], ['fix:seed.frame']],
  ['run done', [{ k: 'tracking:runStart', tracker: 'cotracker_points', label: 'track', t0: 1000, t1: 9000, params: '{}' }, { k: 'tracking:runEnd', tracker: 'cotracker_points', run: 'r1', points: 40, picked: 'sem_c1_penis' }], ['auto:track.run']],
  ['re-track of the same span', [{ k: 'tracking:runStart', tracker: 'cotracker_points', t0: 1000, t1: 9000, params: '{}' }, { k: 'tracking:runStart', tracker: 'tapnext_points', t0: 1500, t1: 9000, params: '{"points":1024}', direction: 'forward', seed: 1600 }], ['fix:track.retrack']],
  ['a camera check is not a re-track', [{ k: 'tracking:runStart', tracker: 'cotracker_points', t0: 1000, t1: 9000 }, { k: 'tracking:runStart', tracker: 'cotracker_points', t0: 1000, t1: 9000, label: 'camera' }], []],
  ['cancelled', [{ k: 'tracking:runStart', tracker: 'x', t0: 0, t1: 5000 }, { k: 'tracking:runEnd', tracker: 'x', cancelled: true, ms: 4000 }], ['fix:track.cancel']],
  ['failed', [{ k: 'tracking:runEnd', tracker: 'x', error: 'boom' }], ['fix:track.error']],
  ['run deleted', [{ k: 'tracking:discard', run: 'r1', tracker: 'x' }], ['fix:track.discard']],
  ['channel override', [{ k: 'tracking:setChannel', run: 'r1', scene: 3, from: 'primary', to: 'sem_c1_penis', sidecar: 'sem_c2_hips' }], ['fix:signal.channel']],
  ['source', [commit('Signal: source')], ['fix:signal.source']],
  ['source as a pair (same kind: one chain with the other source changes)', [commit('Signal: source', 'scenes', { diff: { axes: [], scenes: { cuts: { added: [], removed: [] }, joins: { merged: [], split: [] }, keys: { 'derive.source': ['fused', 'rel:sem_c1_penis:sem_c2_hips'] }, t0: 0, t1: 5000 } } })], ['fix:signal.source']],
  ['measured against', [commit('Signal: measured against')], ['fix:signal.against']],
  ['camera removal', [commit('Signal: camera removal'), commit('Camera mode')], ['fix:signal.camera', 'fix:signal.camera']],
  ['range override', [commit('Signal: source of a range'), commit('Signal: resize a range override')], ['fix:signal.range', 'fix:signal.range']],
  ['stroke axis', [commit('Stroke axis (after tracking)')], ['fix:signal.axis']],
  ['flip', [{ k: 'tracking:flip', run: 'r1', t0: 0, t1: 5000 }, { k: 'tracking:orient', run: 'r1', t0: 0, t1: 900, sign: -1 }], ['fix:signal.flip', 'fix:signal.flip']],
  ['direction from repeats', [{ k: 'tracking:repeatDirection', run: 'r2', scene: 0, t0: 9000, t1: 12000, from: 'S2', n: 14, r: -0.91 }], ['auto:signal.direction']],
  ['fusion pin', [commit('Fusion: pin a part')], ['fix:signal.fuse']],
  ['shaft mark', [commit('Shaft: hilted here')], ['fix:signal.shaft']],
  ['detail', [commit('Detail: + Midpoint + Hold (shot)')], ['fix:strokes.detail']],
  ['simplify', [commit('Simplify to this detail (this scene)', 'axes.stroke')], ['fix:strokes.simplify']],
  ['smart stroke', [commit('Smart stroke on')], ['fix:strokes.smart']],
  ['strokes step', [commit('Strokes: range')], ['fix:strokes.step']],
  ['accept', [commit('Accept S3 · 0:12.0–0:20.0 · 12 (replace)', 'axes.stroke')], ['auto:strokes.accept']],
  ['bake is not an accept', [commit('Accept Effects on the stroke (Shift+A bakes) (replace)', 'axes.stroke,fx')], []],
  ['paw-x7w7: Bake, Unbake', [commit('Bake shot 3', 'axes.stroke'), commit('Unbake shot 3', 'axes.stroke')], ['auto:strokes.bake', 'fix:strokes.unbake']],
  ['hand edits', [commit('Move 3 points', 'axes.stroke'), commit('Delete points', 'axes.stroke'), commit('Add point', 'axes.stroke'), commit('Cut', 'axes.stroke')], ['fix:strokes.points', 'fix:strokes.points', 'fix:strokes.points', 'fix:strokes.points']],
  ['generated points are not hand edits', [commit('Assist: flip x', 'axes.stroke'), commit('Autorange: fill gap S2', 'axes.stroke'), commit('Import a.funscript', 'chapters,axes.stroke')], []],
  ['accept undone', [commit('Accept S1 · 0:00.0–0:05.0 · 4 (replace)', 'axes.stroke'), { k: 'edit:undo', label: 'Accept S1 · 0:00.0–0:05.0 · 4 (replace)' }], ['auto:strokes.accept', 'fix:strokes.acceptUndone']],
  ['undo within 10 s', [commit('Merge scenes'), { k: 'edit:undo', label: 'Merge scenes' }], ['fix:structure.merge', 'fix:generic.undo']],
  ['nothing to undo', [{ k: 'edit:undo', label: null }], []],
  ['autorange on / off / policy / band', [commit('Autorange on', 'finish'), commit('Autorange off', 'finish'), commit('Autorange policy', 'finish'), commit('Autorange: handy', 'finish'), commit('Autorange: S3 range'), commit('Range: corner', 'finish')],
    ['auto:finish.autorange', 'fix:finish.autorangeOff', 'fix:finish.policy', 'fix:finish.policy', 'fix:finish.range', 'fix:finish.range']],
  ['autorange apply is neither', [commit('Autorange: apply', 'axes.stroke,fx')], []],
  ['modifiers', [commit('Add Reshape', 'fx'), commit('Mark Orgasm', 'fx'), commit('Delete modifier', 'fx'), commit('Move modifier', 'fx'), commit('Modifier: Throbbing', 'fx'), commit('Mute modifier', 'fx')], ['fix:fx.add', 'fix:fx.add', 'fix:fx.remove', 'fix:fx.retime', 'fix:fx.params', 'fix:fx.params']],
  ['knotting fit edited', [commit('Mark Knotting', 'fx'), commit('Modifier: Knotting', 'fx', { diff: { axes: [], fx: { added: [], removed: [], changed: [{ id: 'k', kind: 'knotting', t0: 0, t1: 9, what: 'params' }], t0: 0, t1: 9 } } })], ['fix:fx.add', 'fix:fx.knotting']],
  ['spurts', [{ k: 'timeline:cum.detect' }, commit('Add 4 spurts (proposed cumshots)', 'fx'), commit('Add spurt', 'fx'), commit('Delete Spurt', 'fx', { diff: { axes: [], fx: { added: [], removed: [{ id: 's', kind: 'spurt', t0: 5, t1: 5 }], changed: [], t0: 5, t1: 5 } } })],
    ['auto:spurts.detect', 'auto:spurts.place', 'fix:spurts.hand', 'fix:spurts.drop']],
  ['structure', [commit('Cut'), commit('Move cut'), commit('Merge shots'), commit('Split scene'), commit('Shot: same take'), commit('Scene tag: Off-screen'), commit('Scene tag: penetration'), commit('Scene fill from both sides'), commit('Scene continues the action')],
    ['fix:structure.cut', 'fix:structure.cut', 'fix:structure.merge', 'fix:structure.split', 'fix:structure.take', 'fix:structure.offscreen', 'fix:structure.tag', 'fix:structure.fill', 'fix:structure.continues']],
  ['fill accepted', [commit('Accept fill (from after)', 'axes.stroke'), commit('Accept bridge', 'axes.stroke')], ['auto:fill.accept', 'auto:fill.accept']],
  ['camera moves offered and taken', [commit('Cuts tracked through: camera moves')], ['ok:structure.cameraMoves']],
  ['setting changed and back', [{ k: 'settings:set', key: 'tracking.direction', from: '"both"', to: '"forward"' }, { k: 'settings:set', key: 'tracking.direction', from: '"forward"', to: '"both"' }], ['fix:settings.revert']],
  ['machine camera orbits are not settings', [{ k: 'settings:set', key: 'machine.cam', from: '1', to: '2' }, { k: 'settings:set', key: 'machine.cam', from: '2', to: '1' }], []],
  ['describe', [{ k: 'tracking:describe', d: 2 }], ['auto:describe']],
  ['an unknown step changing derive values (diff)', [commit('Something new', 'scenes', { diff: { axes: [], scenes: { cuts: { added: [], removed: [] }, joins: { merged: [], split: [] }, keys: { 'derive.cam': [null, { mode: 'off' }] }, t0: 0, t1: 9 } } })], ['fix:signal.camera']],
];
for (const [name, evs, want] of TABLE) test(`fixlog detector: ${name}`, () => assert.deepEqual(kinds(evs), want));

test('fixlog detector: values from the diff, re-track changes, groups diff decides repaint / delete / from scratch', () => {
  const d = new Detector(), t = T0;
  const sd = scenesDiff([{ start_ms: 0, end_ms: 5000, derive: { source: 'fused' } }], [{ start_ms: 0, end_ms: 5000, derive: { source: 'sem_c1_penis' } }]);
  const [f] = d.see({ t, s: 's', ...commit('Signal: source', 'scenes', { diff: { axes: [], scenes: sd } }) });
  assert.deepEqual([f.kind, f.manual.from, f.manual.to, f.t0, f.t1], ['fix:signal.source', 'fused', 'sem_c1_penis', 0, 5000]);
  const sug = { name: 'c1_hips', source: 'seeder', poly: [] }, own = { name: 'c1_head', source: 'user' };
  const g = (b, a) => ({ axes: [], scenes: { ...scenesDiff([{ start_ms: 0, end_ms: 9, groups: b }], [{ start_ms: 0, end_ms: 9, groups: a }]) } });
  assert.equal(d.see({ t, ...commit('Groups: paint c1_hips', 'scenes', { diff: g([sug, own], [{ ...sug, source: 'user' }, own]) }) })[0].kind, 'fix:seed.repaint');
  const fresh = d.see({ t, ...commit('Groups: paint c1_tail', 'scenes', { diff: g([sug], [sug, { name: 'c1_tail', source: 'user' }]) }) })[0];
  assert.deepEqual([fresh.kind, fresh.manual.new, fresh.manual.suggested], ['fix:seed.paint', true, 1]);
  assert.equal(d.see({ t, ...commit('Groups: erase c1_hips', 'scenes', { diff: g([sug], []) }) })[0].kind, 'fix:seed.delete');
  assert.equal(d.see({ t, ...commit('Groups: delete c1_hips', 'scenes', { diff: g([sug], []) }) })[0].manual.suggested, true);
  assert.deepEqual(runChanges({ tracker: 'a', params: '{"points":512}', direction: 'both', seed: 100, t0: 0, t1: 1000 }, { tracker: 'b', params: '{"points":1024}', direction: 'forward', seed: 700, t0: 0, t1: 1000 }),
    { tracker: ['a', 'b'], params: { points: ['512', '1024'] }, direction: ['both', 'forward'], seedMs: 600 });
  assert.deepEqual(groupsDiff([sug], [own]).added, ['c1_head']);
});

test('fixlog diffs: axis span, scenes cuts / joins / keys, fx, patches', () => {
  const a = [{ at: 0, pos: 0 }, { at: 100, pos: 100 }, { at: 200, pos: 0 }, { at: 300, pos: 100 }];
  const b = [a[0], { at: 120, pos: 90 }, a[2], a[3]];
  assert.deepEqual(axisSpan(a, b), { t0: 100, t1: 120, n0: 1, n1: 1 });
  assert.equal(axisSpan(a, a), null);
  const s0 = [{ start_ms: 0, end_ms: 5000 }, { start_ms: 5000, end_ms: 9000 }];
  const s1 = [{ start_ms: 0, end_ms: 3000 }, { start_ms: 3000, end_ms: 5000, fill: 'both' }, { start_ms: 5000, end_ms: 9000, join: true }];
  const d = scenesDiff(s0, s1);
  assert.deepEqual([d.cuts.added, d.cuts.removed, d.joins.merged, d.t0, d.t1], [[3000], [], [5000], 0, 9000]);
  const f = fxDiff([{ id: 'a', kind: 'spurt', t0: 10, t1: 10 }, { id: 'b', kind: 'throb', t0: 0, t1: 50 }], [{ id: 'b', kind: 'throb', t0: 20, t1: 70 }, { id: 'c', kind: 'knotting', t0: 0, t1: 900 }]);
  assert.deepEqual([f.added.map((e) => e.id), f.removed.map((e) => e.id), f.changed.map((e) => [e.id, e.what, e.dt])], [['c'], ['a'], [['b', 'span', 20]]]);
  const p = diffPatches([{ path: 'axes.stroke', before: a, after: b }, { path: 'finish', before: { autorange: false }, after: { autorange: true } }]);
  assert.deepEqual([p.axes[0].axis, p.finish.autorange], ['stroke', ['false', 'true']]);
});

test('fixlog pointEdits: moved / added / deleted, max and where in the stroke', () => {
  const acc = [{ at: 0, pos: 10 }, { at: 500, pos: 90 }, { at: 1000, pos: 10 }, { at: 1500, pos: 50 }, { at: 1600, pos: 51 }, { at: 2000, pos: 90 }];
  const now = [acc[0], { at: 520, pos: 84 }, { at: 1000, pos: 10 }, { at: 1500, pos: 50 }, { at: 1100, pos: 30 }, { at: 2000, pos: 90 }];   // 500 moved (a turn), 1600 deleted (a hold), 1100 added
  const r = pointEdits(acc, now);
  assert.deepEqual([r.n, r.moved, r.added, r.deleted, r.dtMax, r.dpMax, r.where], [6, 1, 1, 1, 20, 6, { turn: 1, mid: 0, hold: 1 }]);
  assert.deepEqual(pointEdits(acc, acc), { n: 6, moved: 0, added: 0, deleted: 0, dtMax: 0, dtSum: 0, dpMax: 0, dpSum: 0, where: { turn: 0, mid: 0, hold: 0 } });
  const far = pointEdits([{ at: 0, pos: 0 }], [{ at: 5000, pos: 0 }]);
  assert.deepEqual([far.moved, far.added, far.deleted], [0, 1, 1]);
});

test('fixlog grouper: one episode per scene and gap; chains; video-wide facts; idle close; cost', () => {
  const out = [], g = new Grouper({ idleMs: 60000, onClose: (r) => out.push(r) });
  const f = (dt, kind, o = {}) => g.add({ t: T0 + dt * 1000, s: 's', project: 'p', kind, ...o });
  const sc = { sceneT0: 10000, sceneT1: 20000, scene: 3, shot: 5 };
  f(0, 'auto:track.run', { t0: 10000, t1: 20000, ...sc, auto: { tracker: 'cotracker_points' } });
  f(10, 'fix:signal.flip', { t0: 10000, t1: 20000, ...sc });
  f(20, 'fix:signal.source', { at: 12000, ...sc, manual: { from: 'fused', to: 'sem_c1_penis' } });
  f(25, 'fix:signal.source', { at: 13000, ...sc, manual: { from: 'sem_c1_penis', to: 'rel:a:b' } });
  f(30, 'fix:strokes.detail', { at: 30000, sceneT0: 25000, sceneT1: 40000, scene: 4, shot: 7 });   // another scene: its own episode
  f(35, 'auto:finish.autorange', { scope: 'video' });
  f(40, 'fix:settings.revert', { key: 'x' });   // no time: the latest scene episode
  assert.equal(g.open.length, 3);
  f(200, 'fix:track.cancel', { at: 12000, ...sc });   // after the idle gap: everything before closes, a new episode
  assert.equal(out.length, 3);
  const s3 = out.find((r) => r.scene === 3), s4 = out.find((r) => r.scene === 4), all = out.find((r) => r.whole);
  assert.deepEqual(s3.fixes.map((x) => [x.kind, x.n]), [['fix:signal.flip', 1], ['fix:signal.source', 2]]);
  assert.deepEqual(s3.fixes[1].chain.map((m) => m.to), ['sem_c1_penis', 'rel:a:b']);
  assert.deepEqual(s3.cost, { s: 25, n: 3 });
  assert.match(s3.text, /^S3 · shot 5 \(0:10\.0–0:20\.0\): tracked \(cotracker_points\); flipped direction; changed source fused -> sem_c1_penis -> rel:a:b 2x · 25 s, 3 actions$/);
  assert.deepEqual(s4.fixes.map((x) => x.kind), ['fix:strokes.detail', 'fix:settings.revert']);
  assert.deepEqual([all.auto[0].step, all.fixes.length], ['finish.autorange', 0]);
  g.closeAll();
  assert.equal(out.length, 4);
});

test('fixlog live: stamps scene / shot, writes raw facts to the usage log, summarises hand edits of an Accept at close, episodes to the sink', () => {
  let now = T0;
  const notes = [], lines = [];
  const scenes = [{ start_ms: 0, end_ms: 4000 }, { start_ms: 4000, end_ms: 8000, join: true }, { start_ms: 8000, end_ms: 12000 }];
  const doc = { axes: { stroke: [] }, scenes, at: 5000 };
  const log = new FixLog({ now: () => now, note: (k, d) => notes.push([k, d]), sink: { append: (s) => lines.push(s) }, ctx: () => ({ project: 'p1', video: 'v.mp4', at: doc.at, scenes: doc.scenes }), axis: (id) => doc.axes[id] });
  const acc = Array.from({ length: 9 }, (_, i) => ({ at: 4000 + i * 500, pos: i % 2 ? 90 : 10 }));
  log.event({ t: now, k: 'tracking:runStart', tracker: 'tapnext_points', t0: 4000, t1: 8000, params: '{}' });
  log.event({ t: (now += 30000), k: 'tracking:runEnd', tracker: 'tapnext_points', run: 'r1', points: 9 });
  doc.axes.stroke = acc;
  log.record('Accept S2 · 0:04.0–0:08.0 · 9 (replace)', [{ path: 'axes.stroke', before: [], after: acc }]);
  now += 5000;
  const moved = acc.map((p, i) => (i === 3 ? { at: 5600, pos: 80 } : p));
  log.record('Move 1 point', [{ path: 'axes.stroke', before: acc, after: moved }]);
  doc.axes.stroke = moved;
  now += 4000;
  const del = moved.filter((_, i) => i !== 5);
  log.record('Delete points', [{ path: 'axes.stroke', before: moved, after: del }]);
  doc.axes.stroke = del;
  assert.deepEqual(notes.map(([k]) => k), ['auto:track.run', 'auto:strokes.accept', 'fix:strokes.points', 'fix:strokes.points']);
  assert.deepEqual([notes[2][1].scene, notes[2][1].shot, notes[2][1].project, notes[2][1].autoStep], [1, 2, 'p1', 'strokes.accept']);
  log.closeAll();
  assert.equal(lines.length, 1);
  const ep = JSON.parse(lines[0]);
  assert.deepEqual([ep.scene, ep.t0, ep.t1, ep.auto.map((a) => a.step)], [1, 0, 8000, ['track.run', 'strokes.accept']]);
  const pts = ep.fixes.find((x) => x.kind === 'fix:strokes.points').points;
  assert.deepEqual([pts.moved, pts.deleted, pts.added, pts.dpMax, pts.dtMax], [1, 1, 0, 10, 100]);
  assert.match(ep.text, /points by hand: moved 1, added 0, deleted 1 of 9/);
  assert.ok(notes.some(([k]) => k === 'fix:strokes.pointsSummary'));
});

test('fixlog: with usage.log off nothing is recorded or written (live log and the usage log tap)', () => {
  const lines = [], wrote = [];
  let on = false;
  const u = new Usage(null, 100, { enabled: () => on, sink: { append: (t) => wrote.push(t) } });
  const log = new FixLog({ enabled: () => on, note: (k, d) => u.note(k, d), sink: { append: (s) => lines.push(s) }, ctx: () => ({ project: 'p', scenes: [] }) });
  u.tap = (ev) => log.event(ev);
  u.note('tracking:runEnd', { tracker: 'x', run: 'r', points: 3 });
  log.record('Merge scenes', [{ path: 'scenes', before: [], after: [] }]);
  log.closeAll(); u.flushAll();
  assert.deepEqual([lines, wrote, u.lines, log.grp.open], [[], [], [], []]);
  on = true;
  u.note('tracking:runEnd', { tracker: 'x', run: 'r', points: 3 });
  log.closeAll(); u.flushAll();
  assert.equal(lines.length, 1);
  assert.match(wrote.join(''), /"k":"auto:track.run"/);
});

test('fixlog: never throws into the app, project id has no path, whereIn', () => {
  const log = new FixLog({ ctx: () => { throw new Error('ctx'); }, note: () => { throw new Error('note'); } });
  assert.doesNotThrow(() => { log.event({ t: 1, k: 'tracking:discard', run: 'r' }); log.record('x', null); log.closeAll(); log.tick(); });
  const id = projectId({ path: 'C:\\Users\\Someone\\Videos\\clip.mp4', name: 'clip.mp4' });
  assert.match(id, /^n[0-9a-f]{8}$/);
  assert.equal(id, projectId({ name: 'clip.mp4', hash: { algo: 'q1', value: 'abc' } }));   // the same before and after the fingerprint exists
  assert.deepEqual(whereIn([{ start_ms: 0, end_ms: 10 }, { start_ms: 10, end_ms: 20, join: true }, { start_ms: 20, end_ms: 30 }], 25), { shot: 3, scene: 2, sceneT0: 20, sceneT1: 30 });
  assert.equal(describe({ whole: true, auto: [], ok: [], fixes: [], notes: [], cost: { s: 0, n: 0 } }), 'whole video: nothing');
});

test('paw-wzxu: Accepts one after another are each logged with their own span and shot (an Accept rebuilds every point object)', () => {
  let now = T0;
  const notes = [];
  const scenes = [{ start_ms: 0, end_ms: 4000 }, { start_ms: 4000, end_ms: 8000 }, { start_ms: 8000, end_ms: 12000 }];
  const log = new FixLog({ now: () => now, note: (k, d) => notes.push([k, d]), sink: { append: () => {} }, ctx: () => ({ project: 'p', video: 'v.mp4', scenes }) });
  const clone = (s) => s.map((p) => ({ ...p }));   // what normalize() does to the untouched points
  let s = Array.from({ length: 24 }, (_, i) => ({ at: i * 500, pos: i % 2 ? 90 : 10 }));
  for (const [k, t0] of [[1, 4000], [2, 8000]]) {   // the run of S2, then the run of S3, each over its own shot
    const next = clone(s).map((p) => (p.at >= t0 && p.at < t0 + 4000 ? { at: p.at, pos: p.pos === 90 ? 80 : 20 } : p));
    log.record(`Accept S${k + 1} · run (replace)`, [{ path: 'axes.stroke', before: s, after: next }]);
    s = next; now += 400;
  }
  const acc = notes.filter(([k]) => k === 'auto:strokes.accept').map(([, d]) => [d.t0, d.t1, d.shot]);
  assert.deepEqual(acc, [[4000, 7500, 2], [8000, 11500, 3]], 'each its own shot, not the whole script');
  assert.deepEqual(axisSpan(s, clone(s)), null, 'equal values are no change');
});
