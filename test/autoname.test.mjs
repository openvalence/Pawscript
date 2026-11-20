// Auto-naming of painted blobs (paw-p9ve, sidecar `name_groups`, PROTOCOL v4.34): the pure side (autoname.js) and the store logic through the
// labelling workspace: proposal -> confirm all -> saved with named_by; doubtful ones not confirmed; a manual name re-proposes the others with
// that as context; nothing unconfirmed is saved as a name; an armed part wins.
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
const { nameMasks, readProposals, planConfirm, proposalOf, guessText } = await import('../src/features/tracking/autoname.js');
const { nameGroupsRequest } = await import('../src/lib/protocol.js');

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

test('masks of a request: named blobs carry part / who, unassigned ones are what is proposed; ignore regions and hidden groups stay out', () => {
  const gs = [{ name: 'c1_hips', who: 'c1', part: 'hips', mask: rle }, U(1), { name: 'ignore', mask: rle }, { ...U(2), off: true }, { name: 'c2_body', who: 'c2', part: 'body', mask: rle }, { name: 'c1_tail', poly: [] }];
  const { masks, at } = nameMasks(gs);
  assert.deepEqual(masks.map((m) => [m.part || null, m.who || null]), [['hips', 'c1'], [null, null], ['body', 'c2']]);
  assert.deepEqual([...at.keys()], [1]);
  assert.equal(at.get(1), gs[1]);
  const r = nameGroupsRequest({ image: 'a.png', masks, seed: { dir: 'D:\\s', dataset: 'D:\\s\\v2', key: 'ik' } });
  assert.deepEqual([r.cmd, r.image, r.seed.key, r.seed.dataset, 'video' in r], ['name_groups', 'a.png', 'ik', 'D:\\s\\v2', false]);
  assert.equal(nameGroupsRequest({ video: 'v.mp4', t_ms: 10.6, masks, seed: { dir: 'd', key: 'k', features: 'hydra' } }).t_ms, 11);
});

test('proposals: unknown answers give none; the confirm plan takes the confident ones for the active character, skips the other character\'s, first free side', () => {
  assert.equal(proposalOf({ part: [], conf: 0, auto: true }).auto, false, 'no parts = unknown, never auto');
  const gs = [U(1), U(2), U(3), U(4), { name: 'c1_hand_l', who: 'c1', part: 'hand', mask: rle }];
  const props = readProposals({ blobs: [blob('thighs', 0.97, true), blob('thighs', 0.95, true), blob('hips', 0.5, false), blob('hand', 0.99, true, 'c2'), { part: [] }] }, new Map([[0, gs[0]], [1, gs[1]], [2, gs[2]], [3, gs[3]]]));
  assert.equal(props.size, 4);
  assert.deepEqual(planConfirm(gs, props, 'c1'), [{ k: 0, who: 'c1', part: 'thighs', side: 'l' }, { k: 1, who: 'c1', part: 'thighs', side: 'r' }], 'low confidence and the other character are left for the pass');
  assert.equal(planConfirm(gs, props, 'c2').length, 3, 'as Top: the two thighs and the c2 hand (r: c1 has the l one)');
  assert.match(guessText(props.get(gs[2]), (x) => x), /guess: hips 50 %/);
});

test('store: paint x3 -> proposals; Enter names the confident ones as the owner\'s labels (named_by auto), the rest wait; a manual name re-proposes with context; nothing unconfirmed is saved as a name', async () => {
  const { ws, data } = workspace('lbl-auto-');
  assert.ok(await ws.enter(join(data, '..', 'images')));
  const reqs = [];
  let answer = (req) => req.masks.map(() => blob('thighs', 0.97, true));
  ws.nameJob = async (req) => { reqs.push(req); return { result: { blobs: answer(req) } }; };
  const G = ws.G, stroke = (x, y) => { G.begin(x, y, false); G.move(x + 0.04, y); G.end(); };
  stroke(0.2, 0.2); stroke(0.5, 0.2); stroke(0.8, 0.2);
  assert.deepEqual(ws.groups.map((g) => g.name), ['unassigned_1', 'unassigned_2', 'unassigned_3']);
  answer = () => [blob('thighs', 0.97, true), blob('thighs', 0.9, true), blob('hips', 0.4, false)];
  await G.proposalsSettled();
  const r0 = reqs.at(-1);
  assert.deepEqual([r0.cmd, r0.image, r0.masks.length, r0.seed.key], ['name_groups', ws.current.path, 3, ws.current.key]);
  assert.ok(r0.masks.every((m) => !m.part), 'nothing is named yet');
  assert.deepEqual(ws.groups.map((g) => !!G.proposalFor(g)?.auto), [true, true, false]);
  assert.ok(ws.groups.every((g) => g.named_by === undefined), 'a proposal is not a name');
  G.who = 'c1';
  await ws.done();   // Enter: the confident ones are named, as the owner's, marked; the doubtful one is the pass's
  assert.deepEqual(ws.groups.map((g) => g.name), ['c1_thighs_l', 'c1_thighs_r', 'unassigned_3']);
  assert.deepEqual(ws.groups.map((g) => g.named_by), ['auto', 'auto', undefined]);
  assert.ok(ws.groups.slice(0, 2).every((g) => g.source === 'user'));
  assert.ok(G.picker?.pass && G.picker.k === 2, 'the assign pass stops on the doubtful one only');
  assert.equal(ws.index, 0, 'it did not move on while a blob is unnamed');
  G.closePicker();
  G.assign(2, { who: 'c1', part: 'hips' });
  assert.equal(ws.groups[2].named_by, undefined, 'the owner\'s own naming is never marked auto');
  stroke(0.3, 0.6);
  answer = (req) => req.masks.map((m) => (m.part ? { part: [] } : blob('penis', 0.99, true, 'c2')));
  await G.proposalsSettled();
  assert.deepEqual(reqs.at(-1).masks.map((m) => [m.part || null, m.who || null]), [['thighs', 'c1'], ['thighs', 'c1'], ['hips', 'c1'], [null, null]], 'the named blobs are the context');
  assert.equal(G.confirmable, 0, 'the appearance says the other character: not confirmed as Bottom');
  assert.equal(G.confirmProposals(), 0);
  G.setWho('c2');
  assert.equal(G.confirmable, 1);
  assert.equal(G.confirmProposals(), 1);
  assert.equal(ws.groups[3].name, 'c2_penis');
  stroke(0.6, 0.8);
  answer = (req) => req.masks.map((m) => (m.part ? { part: [] } : blob('tail', 0.99, true)));
  await G.proposalsSettled();
  await ws.flush();
  const saved = JSON.parse(readFileSync(join(data, 'seeder', 'datasets', 'v2', 'labels', ws.current.key + '.json'), 'utf8'));
  assert.deepEqual(saved.groups.map((g) => [g.name, g.source, g.named_by || null]), [['c1_thighs_l', 'user', 'auto'], ['c1_thighs_r', 'user', 'auto'], ['c1_hips', 'user', null], ['c2_penis', 'user', 'auto'], ['unassigned_1', 'user', null]], 'an unconfirmed blob is saved unnamed, as before');
  G.pickPart('tail');
  stroke(0.1, 0.9);
  assert.equal(ws.groups.at(-1).name, 'c2_tail', 'an armed part names its blob at once');
  assert.equal(G.proposalFor(ws.groups.at(-1)), null);
  await ws.leave();
});

test('no model / failed job: no proposals and the old flow is untouched', async () => {
  const { ws, data } = workspace('lbl-auto2-');
  await ws.enter(join(data, '..', 'images'));
  ws.nameJob = async () => ({ result: { blobs: [{ part: [], conf: 0, auto: false }], note: 'no naming model for these labels yet: Train' } });
  const G = ws.G;
  G.begin(0.3, 0.3, false); G.move(0.35, 0.3); G.end();
  await G.proposalsSettled();
  assert.equal(G.proposalFor(ws.groups[0]), null);
  await ws.done();
  assert.ok(G.picker?.pass, 'Enter goes to the assign pass as before');
  ws.nameJob = async () => ({ error: 'boom' });
  G.closePicker();
  G.begin(0.6, 0.6, false); G.move(0.65, 0.6); G.end();
  await G.proposalsSettled();
  assert.equal(G.confirmable, 0);
  await ws.leave();
});

// ---- paw-svnz: who by bodies, with a confidence: applied by itself only at the gate, never over the owner's own choice ----
const { whoNote, WHO_GATE } = await import('../src/features/tracking/groups.js');
const { sureWho } = await import('../src/features/tracking/autoname.js');

test('who confidence: a sure who names the proposal, an unsure one is advisory, the owner\'s hover wins, an older sidecar keeps the cross-check', () => {
  const g = [U(1), U(2), U(3)];
  const mk = (who, who_conf) => proposalOf({ ...blob('hips', 0.97, true, who), ...(who_conf != null ? { who_conf } : {}) });
  const props = new Map([[g[0], mk('c2', 0.97)], [g[1], mk('c2', 0.5)], [g[2], mk('c2')]]);   // sure | the left-head fallback | an older sidecar (no who_conf)
  assert.equal(sureWho(props.get(g[0])), 'c2');
  assert.equal(sureWho(props.get(g[1])), null);
  // active character c1: the sure one is named c2; the fallback one takes the active c1 (its who is not trusted, not a cross-check either); the old-style who still skips
  const plan = planConfirm(g, props, 'c1');
  assert.deepEqual(plan.map((e) => [e.k, e.who]), [[0, 'c2'], [1, 'c1']]);
  // the owner pressed 2 on the first and 1 on the third: theirs, whatever the sidecar says
  const own = planConfirm(g, props, 'c1', { whos: new Map([[g[0], 'c1'], [g[2], 'c1']]), sides: new Map() });
  assert.deepEqual(own.map((e) => [e.k, e.who]), [[0, 'c1'], [1, 'c1'], [2, 'c1']]);
  assert.ok(WHO_GATE >= 0.95);
});

test('how the characters were decided is said plainly', () => {
  assert.equal(whoNote({ bodies: 2, by: 'left' }), '2 bodies · roles: left-head fallback');
  assert.equal(whoNote({ bodies: 1, by: 'solo' }), '1 body · solo = Bottom');
  assert.equal(whoNote({ bodies: 2, by: 'left', sam: 'RuntimeError: no VRAM' }), '2 bodies · roles: left-head fallback · SAM off');
  assert.equal(whoNote({ bodies: 0, fallback: 'more than two heads / torsos: not split' }), 'bodies: not split (more than two heads / torsos: not split)');
  assert.equal(whoNote(null), '');
});

test('paw-dgtr knotRegion: the widest stretch of a shaft, in its base half when the base is known; a straight shaft has none', async () => {
  const { knotRegion, maskCentre } = await import('../src/features/tracking/autoname.js');
  const W = 120, H = 90, shaft = (bulgeAt, r = 9) => {   // a horizontal shaft x 20..100, half-width 4, a round bulge of radius r at x = bulgeAt
    const a = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x >= 20 && x < 100 && Math.abs(y - 45) <= 4) || (bulgeAt && (x - bulgeAt) ** 2 + (y - 45) ** 2 <= r * r)) a[y * W + x] = 1;
    return { w: W, h: H, a };
  };
  assert.equal(knotRegion(shaft(0)), null, 'no bulge: nothing found');
  const xsOf = (m) => { const xs = []; m.a.forEach((v, i) => { if (v) xs.push(i % W); }); return [Math.min(...xs), Math.max(...xs)]; };
  const k = knotRegion(shaft(35));
  const [x0, x1] = xsOf(k);
  assert.ok(x0 >= 22 && x1 <= 48 && x0 < 35 && x1 > 35, `the bulge's stretch: ${x0}..${x1}`);
  assert.ok(k.a.every((v, i) => !v || shaft(35).a[i]), 'inside the shaft');
  // two bulges: the one at the base wins when the character's balls say where the base is (right end here)
  const two = shaft(35, 7); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - 85) ** 2 + (y - 45) ** 2 <= 49) two.a[y * W + x] = 1;
  assert.ok(xsOf(knotRegion(two, [[110, 50]]))[0] > 60, 'base at the right: the right bulge');
  assert.ok(xsOf(knotRegion(two, [[5, 50]]))[1] < 60, 'base at the left: the left bulge');
  assert.deepEqual(maskCentre({ w: 2, a: new Float32Array([1, 0, 0, 1]) }), [1, 1]);
});

test('paw-dgtr Find knot (paw-njnf): the knot section of the shaft, never a group', async () => {
  const { ws, data } = workspace('lbl-knot-');
  assert.ok(await ws.enter(join(data, '..', 'images')));
  ws.nameJob = async (req) => ({ result: { blobs: req.masks.map((m) => (m.part ? { part: [] } : blob('penis', 0.99, true))) } });
  const G = ws.G, sz = G.size, a = new Float32Array(sz.w * sz.h);
  for (let y = 0; y < sz.h; y++) for (let x = 0; x < sz.w; x++) if ((x >= 60 && x < 260 && Math.abs(y - 120) <= 10) || (x - 100) ** 2 + (y - 120) ** 2 <= 22 * 22) a[y * sz.w + x] = 1;
  const { encodeMask, fitPoly } = await import('../src/features/tracking/groups.js');
  const m = { ...sz, a };
  ws.app.transact('t', () => { ws.doc.scenes = [{ ...ws.doc.scenes[0], groups: [{ name: 'c2_penis', who: 'c2', part: 'penis', poly: fitPoly(m).poly, t_ms: 0, source: 'user', mask: encodeMask(m) }] }]; });
  G.who = 'c1';
  assert.equal(G.findKnot(1), false, 'not a shaft: nothing');
  assert.ok(G.findKnot(0));
  assert.deepEqual(ws.groups.map((g) => g.name), ['c2_penis'], 'no group of its own');
  const { knotOf } = await import('../src/features/tracking/groups.js'), sec = knotOf(ws.groups[0], sz);
  assert.ok(sec && sec[120 * sz.w + 100] >= 0.5 && sec[120 * sz.w + 230] < 0.5, 'the section: the bulge, not the whole shaft');
  await ws.leave();
});
