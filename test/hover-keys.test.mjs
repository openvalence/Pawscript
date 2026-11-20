// Hover keys (paw-cnfg): hover + 1 / 2 / 3 sets a blob's character, hover + F flips its side: store logic, key scoping (same harness as autoname.test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync, mkdtempSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileModule } from 'svelte/compiler';

registerHooks({
  load(url, ctx, next) {
    if (!url.startsWith('file:') || url.includes('node_modules')) return next(url, ctx);
    if (url.endsWith('.svelte')) return { format: 'module', shortCircuit: true, source: 'export default function Stub() {}' };
    if (url.endsWith('.svelte.js')) return { format: 'module', shortCircuit: true, source: compileModule(readFileSync(fileURLToPath(url), 'utf8'), { filename: fileURLToPath(url), generate: 'server' }).js.code };
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' };
    if (url.endsWith('.js') && readFileSync(fileURLToPath(url), 'utf8').includes('import.meta.glob')) return { format: 'module', shortCircuit: true, source: readFileSync(fileURLToPath(url), 'utf8').replace(/import\.meta\.glob\([^)]*\)/g, '({})') };
    return next(url, ctx);
  },
});
const { LabelWorkspace } = await import('../src/features/labelling/workspace.svelte.js');
const { default: commands } = await import('../src/features/tracking/commands.js');
const { groupColor } = await import('../src/features/tracking/colors.js');

const fsBackend = () => ({
  async listDir(d) { return readdirSync(d).map((name) => { const p = join(d, name), s = statSync(p); return { name, path: p, is_dir: s.isDirectory(), size: s.size, mtime_ms: Math.round(s.mtimeMs) }; }); },
  async readText(p) { return readFileSync(p, 'utf8'); },
  async writeText(p, t) { if (!existsSync(join(p, '..'))) { const x = new Error('not_found'); x.code = 'not_found'; throw x; } writeFileSync(p, t); },
  async makeDir(p) { mkdirSync(p, { recursive: true }); },
  async remove(p) { rmSync(p); },
});
const rle = { w: 4, h: 2, rle: [15, 4, 0, 4] };
const U = (n) => ({ name: 'unassigned_' + n, mask: rle, poly: [[0, 0], [1, 0], [1, 1]] });
const blob = (part, conf, auto, who = null) => ({ part: [{ part, p: conf }, { part: 'hips', p: 0.1 }], conf, auto, who, who_by: who ? 'split' : null, named: false });

function workspace(prefix) {
  globalThis.createImageBitmap = async () => ({ width: 640, height: 480, close() {} });
  const root = mkdtempSync(join(tmpdir(), prefix)), imgs = join(root, 'images'), data = join(root, 'data');
  mkdirSync(imgs); mkdirSync(data);
  for (const n of ['a.png', 'b.png']) writeFileSync(join(imgs, n), 'x');
  const be = { ...fsBackend(), async readBytes(p) { return new Uint8Array(readFileSync(p)); }, async appPaths() { return { data_dir: data }; }, mediaUrl: (p) => p };
  const vals = { 'labelling.shuffle': false };
  const real = { settings: { get: (k, d) => (k in vals ? vals[k] : d), set: (k, v) => { vals[k] = v; } }, backend: be, doc: { media: { path: 'C:\\v\\x.mp4', width: 640, height: 480 }, scenes: [{ start_ms: 0, end_ms: 4000 }], dirty: false }, labelling: null,
    commands: { keysFor: () => [], setGate() {} }, toast() {}, player: { pause() {}, timeMs: 0 } };
  return { ws: new LabelWorkspace(real), imgs, data };
}

const BLOB = (part, conf, auto, who = null) => ({ part: [{ part, p: conf }, { part: 'hips', p: 0.1 }], conf, auto, who, who_by: who ? 'split' : null, named: false });
const over = (G, x, y) => { G.hover = { nx: x + 0.02, ny: y, x: 0, y: 0 }; };
async function painted(prefix, n = 3, part = 'thighs', at = [[0.2, 0.2], [0.5, 0.2], [0.8, 0.2]]) {
  const { ws, data } = workspace(prefix);
  assert.ok(await ws.enter(join(data, '..', 'images')));
  const G = ws.G;
  ws.nameJob = async (req) => ({ result: { blobs: req.masks.map(() => BLOB(part, 0.97, true)) } });
  for (const [x, y] of at.slice(0, n)) { G.begin(x, y, false); G.move(x + 0.04, y); G.end(); }
  await G.proposalsSettled();
  return { ws, G, at };
}

test('hover + 1 / 2 / 3 on an assigned group: its character changes, part and side kept, a free repeat on a clash, one undo step, colour at once', async () => {
  const { ws, G, at } = await painted('hk-who-');
  G.assign(0, { who: 'c1', part: 'thighs', side: 'l' }); G.assign(1, { who: 'c2', part: 'thighs', side: 'l' }); G.assign(2, { who: 'c1', part: 'hips' });
  const before = ws.groups.map((g) => g.name);
  over(G, ...at[0]);
  assert.equal(G.hitAt(G.hover.nx, G.hover.ny), 0);
  assert.equal(G.whoKey('c2'), true);
  assert.deepEqual(ws.groups.map((g) => g.name), ['c2_thighs_l2', 'c2_thighs_l', 'c1_hips'], 'Top already has its L thighs: the next free repeat');
  assert.deepEqual([ws.groups[0].who, ws.groups[0].side, ws.groups[0].part], ['c2', 'l', 'thighs']);
  assert.notEqual(groupColor('c2_thighs_l2'), groupColor('c1_thighs_l'), 'its colour is the new character\'s');
  ws.undo();
  assert.deepEqual(ws.groups.map((g) => g.name), before, 'one undo step');
  over(G, ...at[2]); G.whoKey('x');
  assert.equal(ws.groups[2].name, 'x_hips');
  assert.equal(G.who, 'x', 'the active group followed');
  ws.undo(); assert.equal(ws.groups[2].name, 'c1_hips');
  await ws.leave();
});

test('hover + 2 on a blob with a proposal APPLIES it as Top at once (its proposed part kept); Enter then names the rest', async () => {
  const { ws, G, at } = await painted('hk-prop-');
  G.proposals = new Map(ws.groups.map((g) => [g, { parts: [{ part: 'hand', p: 0.97 }], conf: 0.97, auto: true, who: 'c1' }]));   // appearance says Bottom
  G.active = -1; G.who = 'c2';
  assert.equal(G.confirmable, 0, 'every blob looks like Bottom: skipped as Top');
  over(G, ...at[1]); G.whoKey('c2');
  assert.equal(ws.groups[1].name, 'c2_hand_l', 'pointing at it and pressing 2 is the confirmation: named now, as Top');
  assert.equal(ws.groups[1].named_by, 'auto');
  G.who = 'c1';
  assert.equal(G.confirmProposals(), 2, 'the other two are Bottom: the active one');
  assert.deepEqual(ws.groups.map((g) => g.name), ['c1_hand_l', 'c2_hand_l', 'c1_hand_r']);
  assert.ok(ws.groups.every((g) => g.named_by === 'auto'));
  await ws.leave();
});

test('hover + 1 on a blob with only a doubtful guess still applies its top part; with no proposal it only remembers the character', async () => {
  const { ws, G, at } = await painted('hk-doubt-');
  G.proposals = new Map([[ws.groups[0], { parts: [{ part: 'thighs', p: 0.55 }, { part: 'hips', p: 0.3 }], conf: 0.55, auto: false }]]);
  G.active = -1;
  over(G, ...at[0]); G.whoKey('c1');
  assert.equal(ws.groups[0].name, 'c1_thighs_l');
  over(G, ...at[2]); G.whoKey('c2');
  assert.equal(G.whoSet.get(ws.groups[2]), 'c2', 'no proposal: nothing to apply, the character is remembered');
  await ws.leave();
});

test('with nothing under the pointer (and nothing selected), 1 / 2 / 3 keep their meaning: the character painted next', async () => {
  const { ws, G } = await painted('hk-none-', 1);
  G.active = -1; G.hover = { nx: 0.9, ny: 0.9, x: 0, y: 0 };
  assert.deepEqual(G.keyTargets(), []);
  assert.equal(G.whoKey('c2'), false);
  assert.equal(G.who, 'c2');
  assert.equal(G.whoSet.size, 0);
  await ws.leave();
});

test('hover + F: an assigned paired part swaps l <-> r (with its twin: both swap, one undo step); an unpaired part does nothing', async () => {
  const { ws, G, at } = await painted('hk-flip-');
  G.assign(0, { who: 'c1', part: 'thighs', side: 'l' }); G.assign(1, { who: 'c1', part: 'thighs', side: 'r' }); G.assign(2, { who: 'c1', part: 'hips' });
  const before = ws.groups.map((g) => g.name);
  over(G, ...at[0]);
  assert.equal(G.flipSide(G.keyTargets()[0]), 'r');
  assert.deepEqual(ws.groups.map((g) => [g.name, g.side]), [['c1_thighs_r', 'r'], ['c1_thighs_l', 'l'], ['c1_hips', undefined]], 'the twin took the other side');
  ws.undo(); assert.deepEqual(ws.groups.map((g) => g.name), before, 'one undo step');
  G.remove(1);   // no twin now: a plain rename
  G.flipSide(0);
  assert.equal(ws.groups[0].name, 'c1_thighs_r');
  const names = ws.groups.map((g) => g.name), hipsK = names.indexOf('c1_hips');
  assert.equal(G.flipSide(hipsK), false, 'hips have no sides');
  assert.deepEqual(ws.groups.map((g) => g.name), names);
  await ws.leave();
});

test('hover + F on a proposed paired blob sets the side Enter uses', async () => {
  const { ws, G, at } = await painted('hk-flipprop-', 2);
  G.active = -1; G.who = 'c1';
  over(G, ...at[0]);
  assert.equal(G.flipSide(G.keyTargets()[0]), 'r');
  G.confirmProposals();
  assert.deepEqual(ws.groups.map((g) => g.name), ['c1_thighs_r', 'c1_thighs_l']);
  await ws.leave();
});

test('key scoping: F is the Groups flip only while a group is under the pointer (or selected in the labelling workspace); 1 / 2 / 3 stay the Groups keys', async () => {
  const { ws, G, at } = await painted('hk-keys-');
  const byId = Object.fromEntries(commands.map((c) => [c.id, c])), order = commands.map((c) => c.id);
  assert.deepEqual(byId['tracking.groupsFlip'].keys, ['F']); assert.deepEqual(byId['track.flipAtPlayhead'].keys, ['F']);
  assert.ok(order.indexOf('tracking.groupsFlip') < order.indexOf('track.flipAtPlayhead'), 'registered first: wins when its `when` holds');
  assert.equal(byId['track.flipAtPlayhead'].when({ mode: 'timeline' }), false, 'the stroke-direction flip keeps its own condition');
  const app = { mode: 'track', labelling: { on: true, app: ws.app }, settings: ws.app.settings, toast() {} };
  const when = byId['tracking.groupsFlip'].when;
  G.active = -1; G.hover = null;
  assert.equal(when(app), false, 'no group under the pointer, none selected: F is not the Groups key');
  over(G, ...at[0]); assert.equal(when(app), true, 'hovering a group');
  G.hover = null; G.active = 0; assert.equal(when(app), true, 'labelling workspace: a selected group');
  G.labelMode = false; assert.equal(when(app), false, 'Track tab: a selection alone does not take F (the pointer must be on the picture)');
  G.hover = { nx: 0.9, ny: 0.9, x: 0, y: 0 }; assert.equal(when(app), true, 'on the picture off every group, a group selected');
  G.hover = null; G.labelMode = true;
  for (const id of ['tracking.groupsWho1', 'tracking.groupsWho2', 'tracking.groupsWho3']) assert.equal(byId[id].when(app), true, id + ' stays available while the tool is open');
  await ws.leave();
});

test('paw-5r1: two new forearm blobs: the first proposed as the character’s L (the default, and the chip says so), the second R; F flips before Enter; where they sit in the picture does not matter', async () => {
  for (const at of [[[0.2, 0.2], [0.8, 0.2]], [[0.8, 0.2], [0.2, 0.2]]]) {   // the same two blobs, painted the other way round in the picture
    const { ws, G } = await painted('hk-limb-', 2, 'forearm', at);
    G.active = -1; G.who = 'c1';
    assert.deepEqual([0, 1].map((k) => G.proposedSide(G.groups[k])), [{ side: 'l', how: 'default' }, { side: 'r', how: 'pair' }]);
    assert.equal(G.flipSide(1), 'l', 'F on the second: L');
    assert.deepEqual([0, 1].map((k) => G.proposedSide(G.groups[k]).side), ['r', 'l'], 'the first now takes the free side');
    assert.equal(G.proposedSide(G.groups[1]).how, 'own');
    G.confirmProposals();
    assert.deepEqual(ws.groups.map((g) => [g.name, g.side]), [['c1_forearm_r', 'r'], ['c1_forearm_l', 'l']]);
    await ws.leave();
  }
});

test('paw-5r1: the character’s L forearm already painted: a new forearm blob is proposed R (the other limb); stored sides are never re-derived', async () => {
  const { ws, G } = await painted('hk-limb2-', 2, 'forearm');
  G.active = -1; G.who = 'c2';
  G.assign(0, { who: 'c2', part: 'forearm', side: 'l' });
  assert.deepEqual(G.proposedSide(G.groups[1]), { side: 'r', how: 'pair' });
  G.confirmProposals();
  assert.deepEqual(ws.groups.map((g) => g.name), ['c2_forearm_l', 'c2_forearm_r']);
  G.assign(1, { who: 'c2', part: 'shin', side: 'l' });   // what the owner says stays: no rule moves it
  assert.deepEqual(ws.groups.map((g) => [g.name, g.side]), [['c2_forearm_l', 'l'], ['c2_shin_l', 'l']]);
  await ws.leave();
});
