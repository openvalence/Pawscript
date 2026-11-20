// Runs filtered by scene, scene -> run channel links, and a run's channel pick kept on its ghost across a save / load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRun, newFrames, runsForScene, linkFor, sceneForRun } from '../src/lib/runs.js';
import { channelPatch, keepOf, runFromGhost, pointsFromChannel } from '../src/lib/runs-channel.js';
import { serialize, parse } from '../src/lib/io/project.js';

const g = (id, t0, t1) => ({ id, source: { kind: 'tracker', range: { t0, t1 } } });

test('runsForScene: runs overlapping the scene; no scene = all; unknown span kept; script extent for imported ghosts', () => {
  const runs = [g('a', 0, 1000), g('b', 1000, 3000), g('c', 2500, 6000), { id: 'ref', script: [{ at: 0, pos: 0 }, { at: 9000, pos: 100 }] }, { id: 'x', script: [] }];
  const ids = (s) => runsForScene(runs, s).map((r) => r.id);
  assert.deepEqual(ids({ start_ms: 1000, end_ms: 2000 }), ['b', 'ref', 'x']);   // a ends where the scene starts: no overlap
  assert.deepEqual(ids({ start_ms: 2000, end_ms: 2600 }), ['b', 'c', 'ref', 'x']);
  assert.deepEqual(ids({ start_ms: 9500, end_ms: 9900 }), ['x']);
  assert.equal(runsForScene(runs, null), runs);
});

test('linkFor: the link overlapping a scene by more than half; sceneForRun: selected scene if overlapped, else the most overlapped', () => {
  const links = [{ t0: 0, t1: 1000 }, { t0: 1000, t1: 3000 }];
  assert.equal(linkFor(links, { start_ms: 0, end_ms: 1000 }), 0);
  assert.equal(linkFor(links, { start_ms: 1000, end_ms: 2000 }), 1);     // a split half keeps its link
  assert.equal(linkFor(links, { start_ms: 900, end_ms: 1100 }), -1);     // straddles both by half: neither
  assert.equal(linkFor(links, { start_ms: 5000, end_ms: 6000 }), -1);
  const scenes = [{ start_ms: 0, end_ms: 1000 }, { start_ms: 1000, end_ms: 4000 }, { start_ms: 4000, end_ms: 5000 }];
  assert.equal(sceneForRun(scenes, { t0: 500, t1: 3000 }), 1);
  assert.equal(sceneForRun(scenes, { t0: 500, t1: 3000 }, 0), 0);
  assert.equal(sceneForRun(scenes, { t0: 500, t1: 3000 }, 2), 1);       // selected scene not under the run
  assert.equal(sceneForRun([], { t0: 0, t1: 1 }), -1);
});

test('a channel pick kept on the ghost survives serialize / parse and rebuilds the same points', () => {
  const dt = 1000 / 30, pairs = [];
  for (let t = 0; t < 4000; t += dt) { const ms = Math.round(t); pairs.push([ms, ms >= 900 && ms < 1000 ? null : 0.4 + 0.2 * Math.sin((2 * Math.PI * t) / 1000)]); }
  const scenes = [{ start_ms: 0, end_ms: 2000, sign: 1 }, { start_ms: 2000, end_ms: 4000, sign: -1 }];
  const run0 = makeRun({ n: 3, tracker: { id: 'tapnext_points', name: 'TAPNext' }, params: { primary: 'auto' }, range: { start: 0, end: 4000 }, roi: { kind: 'box', x: 0, y: 0, w: 1, h: 1 },
    result: { samples: pairs.map(([t]) => [t, 0.5]), points: [{ at: 0, pos: 50 }, { at: 3000, pos: 90 }], scenes, channels: { g2_proj: pairs, g1_proj: pairs } }, frames: newFrames(), runs: [] });
  const fit = { sigmaMs: 40 };
  const run = { ...run0, ...channelPatch(run0, 'g2_proj', fit) };
  run.points = run.points0;
  const ghost = { id: run.id, name: '#3 TAPNext', color: run.color, visible: true, script: Array.from(run.points.at, (at, i) => ({ at, pos: run.points.pos[i] })),
    source: { kind: 'tracker', tracker: run.tracker, runId: run.id, range: { t0: 0, t1: 4000 }, params: run.params, keep: keepOf(run, ['g2_proj'], fit) } };
  assert.deepEqual(Object.keys(ghost.source.keep.channels), ['g2_proj']);   // only the kept channel, not g1_proj

  const text = serialize({ axes: { stroke: [] }, ghosts: [ghost], extra: { links: { v: 1, scenes: [{ t0: 0, t1: 2000, run: 'run3', channel: 'g2_proj', fit }] } } }, { ghostScripts: true });
  assert.match(text, /\[33, 0\.4\d*\]/);                     // float pairs on one line
  assert.match(text, /\[900, null\]/);
  const doc = parse(text);
  assert.deepEqual(doc.extra.links.scenes[0], { t0: 0, t1: 2000, run: 'run3', channel: 'g2_proj', fit });
  const r = runFromGhost(doc.ghosts[0]);
  assert.ok(r.restored);
  assert.equal(r.n, 3); assert.equal(r.name, 'TAPNext'); assert.equal(r.channel, 'g2_proj');
  assert.deepEqual(r.range, { start: 0, end: 4000 });
  assert.deepEqual(r.roi, run.roi);
  assert.equal(r.channels.g2_proj.t.length, pairs.length);
  assert.ok(Number.isNaN(r.channels.g2_proj.v[27]));             // the lost frame stays a gap
  assert.deepEqual(Array.from(r.points0Primary.at), [0, 3000]);
  assert.deepEqual(Array.from(r.points0.at), Array.from(run.points0.at));
  r.points0.pos.forEach((p, i) => assert.ok(Math.abs(p - run.points0.pos[i]) < 0.01));
  // back to primary: the sidecar's points
  assert.deepEqual(Array.from(channelPatch(r, 'primary').points0.pos), [50, 90]);
  assert.equal(runFromGhost({ ...ghost, source: { ...ghost.source, keep: undefined } }), null);
});

test('per-scene composition: two scenes of one run use two channels (links), the rest the default; kept and recomposed after a reload', () => {
  const pairs1 = [], pairs2 = [];
  for (let ms = 0; ms < 4000; ms += 33) { pairs1.push([ms, Math.sin(ms / 159)]); pairs2.push([ms, Math.cos(ms / 80)]); }
  const scenes = [{ start_ms: 0, end_ms: 2000, sign: 1 }, { start_ms: 2000, end_ms: 4000, sign: 1 }];
  const run = makeRun({ n: 4, tracker: { id: 'cotracker_points', name: 'CoTracker' }, params: {}, range: { start: 0, end: 4000 }, roi: null,
    result: { samples: pairs1.map(([t]) => [t, 0.5]), points: [{ at: 500, pos: 10 }, { at: 2500, pos: 90 }], scenes, channels: { g1_proj: pairs1, g2_proj: pairs2 } }, frames: newFrames(), runs: [] });
  const g1 = pointsFromChannel(run, 'g1_proj'), g2 = pointsFromChannel(run, 'g2_proj', { sigmaMs: 30 });
  const part = (p, a, b) => Array.from(p.at).map((at, i) => [at, p.pos[i]]).filter(([at]) => at >= a && at < b);
  const flat = (p) => Array.from(p.at).map((at, i) => [at, p.pos[i]]);
  const links = [{ t0: 0, t1: 2000, run: 'run4', channel: 'g1_proj' }, { t0: 2000, t1: 4000, run: 'run4', channel: 'g2_proj', fit: { sigmaMs: 30 } }, { t0: 0, t1: 2000, run: 'run9', channel: 'g2_proj' }];
  const both = channelPatch(run, 'primary', {}, links);
  assert.deepEqual(both.sceneChannels, ['g1_proj', 'g2_proj']);
  assert.equal(both.channel, 'primary');
  assert.deepEqual(flat(both.points0), [...part(g1, -Infinity, 2000), ...part(g2, 2000, Infinity)]);
  assert.ok(both.lane.t.length > pairs1.length && Number.isNaN(both.lane.v[both.lane.t.length - 1]));   // both scenes' traces, a gap after each
  // only scene 2 linked: scene 1 falls back to the run's default (primary = the sidecar's points there)
  const one = channelPatch(run, 'primary', {}, links.slice(1));
  assert.deepEqual(one.sceneChannels, ['primary', 'g2_proj']);
  assert.deepEqual(flat(one.points0), [[500, 10], ...part(g2, 2000, Infinity)]);
  // no links, primary default: the sidecar's points, no composed lane
  const none = channelPatch(run, 'primary');
  assert.deepEqual(flat(none.points0), [[500, 10], [2500, 90]]);
  assert.equal(none.lane, null);
  // a link to a channel the run does not have is ignored
  assert.deepEqual(channelPatch(run, 'primary', {}, [{ t0: 0, t1: 2000, run: 'run4', channel: 'nope' }]).sceneChannels, ['primary', 'primary']);

  // the ghost keeps both linked channels; after serialize / parse the run recomposes the same points with the links
  const r = { ...run, ...both, points: both.points0 };
  const ghost = { id: 'run4', name: '#4 CoTracker', color: r.color, script: flat(r.points).map(([at, pos]) => ({ at, pos })),
    source: { kind: 'tracker', tracker: r.tracker, runId: 'run4', range: { t0: 0, t1: 4000 }, params: {}, keep: keepOf(r, ['g1_proj', 'g2_proj']) } };
  const doc = parse(serialize({ axes: { stroke: [] }, ghosts: [ghost], extra: { links: { v: 1, scenes: links } } }, { ghostScripts: true }));
  const back = runFromGhost(doc.ghosts[0], doc.extra.links.scenes);
  assert.deepEqual(Object.keys(back.channels).sort(), ['g1_proj', 'g2_proj']);
  assert.deepEqual(back.sceneChannels, ['g1_proj', 'g2_proj']);
  assert.deepEqual(Array.from(back.points0.at), Array.from(both.points0.at));
  back.points0.pos.forEach((p, i) => assert.ok(Math.abs(p - both.points0.pos[i]) < 0.01));
  assert.ok(back.lane);
});
