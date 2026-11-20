// Ignore regions (paw-855t): a paintable "ignore" region of the Groups tool (an inset crop of another angle), how it is stored (a label
// file's own `ignore` list; a project scene's groups named ignore), that nothing treats it as a part, how it is drawn, and the labelling
// workspace's round trip. test_seeder_ignore.py is the training side.
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
const L = await import('../src/features/labelling/labels.js');
const { LabelWorkspace } = await import('../src/features/labelling/workspace.svelte.js');
const GJ = await import('../src/features/tracking/groups.js');
const { veilPixels, VEIL_ALPHA } = await import('../src/features/tracking/ignore-veil.js');
const { default: trackingCommands } = await import('../src/features/tracking/commands.js');
const { encodeMask, maskSize, rasterPoly, newMask } = GJ;

const square = (b) => [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
const ignoreGroup = (name, box, size = maskSize(4 / 3)) => ({ name, poly: square(box), pinned: false, t_ms: 0, source: 'user', mask: encodeMask(rasterPoly(square(box), size)) });
const part = (name, box, size = maskSize(4 / 3)) => { const [who, p, side] = name.split('_'); return { name, who, part: p, ...(side ? { side } : {}), poly: square(box), pinned: true, t_ms: 0, source: 'user', mask: encodeMask(rasterPoly(square(box), size)) }; };

test('an ignore region is its own kind: named ignore / ignore2, never a part, never tracked, may overlap anything', () => {
  assert.ok(GJ.isIgnore('ignore') && GJ.isIgnore({ name: 'ignore12' }) && !GJ.isIgnore('c1_ignore') && !GJ.isIgnore('ignored') && !GJ.isIgnore({ name: 'c1_penis' }));
  assert.equal(GJ.groupName({ who: 'c1', part: 'ignore' }), 'ignore', 'no character');
  assert.equal(GJ.groupName({ who: 'c2', part: 'hips' }), 'c2_hips');
  assert.equal(GJ.freeName([{ name: 'ignore' }], 'ignore'), 'ignore2');
  assert.deepEqual(GJ.splitName('ignore2'), { who: null, part: 'ignore', side: null });
  assert.equal(GJ.isPinned('ignore'), false);
  assert.ok(!GJ.PARTS.includes('ignore'), 'not a part of the vocabulary');
  assert.ok(GJ.mayOverlap('ignore', 'c1_penis') && GJ.mayOverlap('c2_hips', 'ignore2') && !GJ.mayOverlap('c1_penis', 'c2_hips'), 'an ignore region never blocks a part and is never blocked');
  const scenes = [{ start_ms: 0, end_ms: 4000, groups: [{ ...part('c1_penis', [0.1, 0.1, 0.3, 0.4]), t_ms: 100 }, { ...ignoreGroup('ignore', [0.6, 0.1, 1, 0.9]), t_ms: 100 }] }];
  assert.deepEqual(GJ.trackGroups(scenes, 0, 4000).map((g) => g.name), ['c1_penis'], 'Track never gets it');
  assert.deepEqual(GJ.cumGroups(scenes[0]), [], 'not a pulse part');
});

test('the Ignore entry is a command on a free key, in the labelling workspace too', () => {
  const c = trackingCommands.find((x) => x.id === 'tracking.groupsIgnore');
  assert.ok(c && c.keys.length === 1 && c.keys[0] === 'V' && c.hidden);
  const taken = trackingCommands.filter((x) => x.id !== c.id && (x.keys || []).includes('V'));
  assert.equal(taken.length, 0, 'V is not bound to anything else in the tracking commands');
});

test('label file: the ignore list is its own, in the groups\' mask encoding; no list when there is none', () => {
  const size = maskSize(4 / 3), ign = ignoreGroup('ignore', [0.6, 0.1, 1, 0.9], size);
  const { groups, ignore } = L.splitStored([part('c1_hips', [0.1, 0.1, 0.3, 0.4]), ign, ignoreGroup('ignore2', [0, 0.8, 0.2, 1])]);
  assert.deepEqual(groups.map((g) => g.name), ['c1_hips']); assert.equal(ignore.length, 2);
  const lab = L.makeLabel({ image: 'x.png', key: 'iabcdef01234567', w: 640, h: 480, groups, ignore, now: 1 });
  assert.ok(lab.groups.every((g) => !GJ.isIgnore(g)) && lab.ignore.length === 2 && lab.ignore[0].rle.length && lab.ignore[0].w === size.w, 'nothing mistakes one for a part');
  assert.ok(!('ignore' in L.makeLabel({ image: 'x.png', key: 'iabcdef01234567', w: 1, h: 1, groups, now: 1 })), 'an old-shaped label has no list');
  const back = L.parseLabel(JSON.stringify(lab));
  assert.equal(back.ignore.length, 2);
  const tool = L.restoreGroups(back);
  assert.deepEqual(tool.map((g) => g.name), ['c1_hips', 'ignore', 'ignore2'], 'back in the tool as groups named ignore, ignore2');
  assert.ok(tool[1].poly.length >= 3 && tool[1].mask.rle.length && tool[1].pinned === false && tool[1].source === 'user');
  const again = L.splitStored(tool);
  assert.deepEqual(again.ignore, ignore, 'the round trip keeps the masks exactly');
  assert.equal(L.parseLabel(JSON.stringify({ ...lab, ignore: [{ w: 0, h: 5, rle: [] }, null, { rle: 'x' }] })).ignore, undefined, 'broken entries are dropped');
  assert.deepEqual(L.restoreGroups({ groups: [], ignore: [{ w: 8, h: 8, rle: [0, 64] }] }), [], 'an empty region is nothing');
});

test('drawn distinctly: a dark hatched veil, not a part\'s light tint', () => {
  const m = newMask({ w: 40, h: 30 });
  for (let y = 5; y < 25; y++) for (let x = 10; x < 30; x++) m.a[y * 40 + x] = 1;
  m.a[5 * 40 + 10] = 0.5;
  const d = veilPixels(m), at = (x, y) => Array.from(d.slice((y * 40 + x) * 4, (y * 40 + x) * 4 + 4));
  assert.deepEqual(at(2, 2), [0, 0, 0, 0], 'clear outside the region');
  const inside = []; for (let x = 10; x < 20; x++) inside.push(at(x, 12));
  const dark = inside.filter((p) => p[0] < 20), light = inside.filter((p) => p[0] > 150);
  assert.ok(dark.length >= 7 && light.length >= 1, 'near-black with a lighter diagonal hatch');
  assert.ok(dark.every((p) => p[3] === VEIL_ALPHA) && VEIL_ALPHA > 110 * 1.5, 'far more opaque than the 110 / 255 part tint');
  const row = (y) => Array.from({ length: 20 }, (_, i) => at(10 + i, y)[0] > 150 ? 1 : 0).join('');
  assert.notEqual(row(12), row(13), 'the hatch runs diagonally');
  assert.ok(d[(5 * 40 + 10) * 4 + 3] < d[(12 * 40 + 14) * 4 + 3], 'a soft edge stays soft');
});

// ---- the workspace: paint an ignore region and a part, save, come back ----
const fsBackend = () => ({
  async listDir(d) { return readdirSync(d).map((name) => { const p = join(d, name), s = statSync(p); return { name, path: p, is_dir: s.isDirectory(), size: s.size, mtime_ms: Math.round(s.mtimeMs) }; }); },
  async readText(p) { return readFileSync(p, 'utf8'); },
  async writeText(p, t) { if (!existsSync(join(p, '..'))) { const x = new Error('not_found'); x.code = 'not_found'; throw x; } writeFileSync(p, t); },
  async makeDir(p) { mkdirSync(p, { recursive: true }); },
  async remove(p) { rmSync(p); },
});
test('workspace: the ignore region is painted with the part tools, saved as its own list, not a part, and Suggest sends it', async () => {
  globalThis.createImageBitmap = async () => ({ width: 640, height: 480, close() {} });
  const root = mkdtempSync(join(tmpdir(), 'ign-ws-')), imgs = join(root, 'images'), data = join(root, 'data');
  mkdirSync(imgs); mkdirSync(data);
  for (const n of ['a.png', 'b.png']) writeFileSync(join(imgs, n), 'stub');
  const be = { ...fsBackend(), async readBytes(p) { return new Uint8Array(readFileSync(p)); }, async appPaths() { return { data_dir: data }; }, mediaUrl: (p) => p };
  const vals = { 'labelling.shuffle': false }, toasts = [];
  const real = { settings: { get: (k, d) => (k in vals ? vals[k] : d), set: (k, v) => { vals[k] = v; } }, backend: be, doc: { media: null, scenes: [] }, labelling: null,
    commands: { keysFor: () => [], setGate() {} }, toast: (m) => toasts.push(m), player: { pause() {}, timeMs: 0 } };
  const ws = new LabelWorkspace(real);
  assert.ok(await ws.enter(imgs));
  const G = ws.G;
  G.pickPart('hips'); G.begin(0.2, 0.3, false); G.move(0.25, 0.3); G.end();                       // a part on the left
  G.pickPart('ignore'); assert.ok(G.armed && G.nextName === 'ignore');
  G.begin(0.8, 0.5, false); G.move(0.85, 0.55); G.end();                                           // an inset on the right
  assert.deepEqual(ws.groups.map((g) => g.name), ['c1_hips', 'ignore']);
  assert.equal(ws.parts.length, 1, 'the ignore region is not a part');
  G.begin(0.1, 0.8, false, 1, true); G.move(0.15, 0.85); G.end();                                  // Ctrl+stroke: a second one
  assert.deepEqual(ws.groups.map((g) => g.name), ['c1_hips', 'ignore', 'ignore2']);
  // painting a part INSIDE the ignore region is allowed (the brush is not blocked by it)
  G.pickPart('head'); G.begin(0.82, 0.52, false); G.move(0.84, 0.54); G.end();
  assert.ok(ws.groups.some((g) => g.name === 'c1_head'), 'a part inside an ignore region is still a label');
  const hit = G.groups.find((g) => g.name === 'c1_head');
  assert.ok(GJ.maskAt(G.maskFor(hit), 0.83, 0.53) > 0.5, 'and it really has paint there');
  await ws.flush();
  const dir = join(data, 'seeder', 'datasets', 'v2', 'labels'), files = readdirSync(dir);
  assert.equal(files.length, 1);
  const d = JSON.parse(readFileSync(join(dir, files[0]), 'utf8'));
  assert.deepEqual(d.groups.map((g) => g.name), ['c1_hips', 'c1_head'], 'parts only in groups');
  assert.equal(d.ignore.length, 2, 'two regions in the list');
  // Suggest sends them
  let sent = null;
  ws.suggestJob = async (req) => { sent = req; return { result: { groups: [], ms: 1 } }; };
  await ws.suggest();
  assert.equal(sent.ignore.length, 2); assert.ok(sent.ignore[0].rle.length);
  // leave and come back: the regions are back in the tool
  await ws.leave();
  const ws2 = new LabelWorkspace(real);
  await ws2.enter(imgs);
  await ws2.show(0);
  assert.deepEqual(ws2.groups.map((g) => g.name), ['c1_hips', 'c1_head', 'ignore', 'ignore2']);
  assert.equal(ws2.labelled.size, 1);
  // only ignore on an image: saved (the work is not lost), no part
  await ws2.show(1);
  ws2.G.pickPart('ignore'); ws2.G.begin(0.5, 0.5, false); ws2.G.move(0.55, 0.5); ws2.G.end();
  await ws2.flush();
  assert.equal(readdirSync(dir).length, 2);
  await ws2.toggleNone();
  assert.equal(ws2.none, true, '"nothing here" with an inset: a negative that still has its region');
  const b = JSON.parse(readFileSync(join(dir, readdirSync(dir).filter((f) => f !== files[0])[0]), 'utf8'));
  assert.ok(b.none && b.ignore.length === 1 && b.groups.length === 0);
  await ws2.leave();
});

test('paw-i5qx: Ignore from the assign picker makes the same group as the old way (V, then a stroke); off again: unassigned', async () => {
  globalThis.createImageBitmap = async () => ({ width: 640, height: 480, close() {} });
  const root = mkdtempSync(join(tmpdir(), 'ign-pick-')), imgs = join(root, 'images'), data = join(root, 'data');
  mkdirSync(imgs); mkdirSync(data);
  for (const n of ['a.png', 'b.png']) writeFileSync(join(imgs, n), 'stub');
  const be = { ...fsBackend(), async readBytes(p) { return new Uint8Array(readFileSync(p)); }, async appPaths() { return { data_dir: data }; }, mediaUrl: (p) => p };
  const vals = { 'labelling.shuffle': false };
  const real = { settings: { get: (k, d) => (k in vals ? vals[k] : d), set: (k, v) => { vals[k] = v; } }, backend: be, doc: { media: null, scenes: [] }, labelling: null, commands: { keysFor: () => [], setGate() {} }, toast() {}, player: { pause() {}, timeMs: 0 } };
  const ws = new LabelWorkspace(real);
  await ws.enter(imgs);
  const G = ws.G, stroke = () => { G.begin(0.6, 0.4, false); G.move(0.7, 0.45); G.move(0.72, 0.6); G.end(); };
  const shape = (g) => JSON.parse(JSON.stringify({ ...g, mask: GJ.encodeMask(G.maskFor(g)) }));
  // the old way: V arms the ignore region, the stroke paints it
  G.pickPart('ignore'); stroke();
  const old = shape(G.groups[0]);
  assert.equal(old.name, 'ignore');
  // the new way, on the next picture: paint first, then the picker's Ignore
  await ws.show(1);
  assert.equal(G.armed, false);
  stroke();
  assert.ok(GJ.isUnassigned(G.groups[0]), 'painted first: unassigned');
  assert.ok(G.openPicker(0));
  G.setIgnore(true);
  assert.deepEqual(shape(G.groups[0]), old, 'the same group: name, no character, not pinned, the same mask and outline');
  assert.equal(G.picker, null, 'the choice closes the picker like any part');
  assert.equal(ws.parts.length, 0, 'not a part');
  // the inverse: back to an unassigned group, the paint kept
  G.openPicker(0); G.setIgnore(false);
  assert.ok(GJ.isUnassigned(G.groups[0]) && !GJ.isIgnore(G.groups[0]));
  assert.deepEqual(shape(G.groups[0]).mask, old.mask);
  assert.ok(G.picker, 'the picker stays open to pick its part');
  G.setIgnore(true); G.openPicker(0); G.setIgnore(true);
  assert.equal(G.groups.filter((g) => GJ.isIgnore(g)).length, 1, 'already one: nothing changes');
  // Shift+click on a list row (armGroup): strokes anywhere paint into that group
  G.closePicker(); G.disarm();
  G.begin(0.1, 0.1, false); G.move(0.15, 0.12); G.end();
  const k = G.groups.findIndex((g) => GJ.isUnassigned(g));
  G.armGroup(k);
  const n = G.groups.length;
  G.begin(0.3, 0.85, false); G.move(0.32, 0.86); G.end();
  assert.equal(G.groups.length, n, 'no new group');
  assert.ok(GJ.maskAt(G.maskFor(G.groups[k]), 0.31, 0.855) > 0.5, 'the far stroke went into the armed group');
  await ws.leave();
});

test('fully labelled: a per-image toggle, stored as complete: true, partial by default, back after a reload', async () => {
  const g = [part('c1_hips', [0.1, 0.1, 0.3, 0.4])];
  assert.ok(!('complete' in L.makeLabel({ image: 'x', key: 'i1', w: 1, h: 1, groups: g })), 'partial is the default: nothing stored');
  assert.equal(L.parseLabel(JSON.stringify(L.makeLabel({ image: 'x', key: 'i1', w: 1, h: 1, groups: g, complete: true }))).complete, true);
  assert.ok(!('complete' in L.makeLabel({ image: 'x', key: 'i1', w: 1, h: 1, none: true, complete: true })), '"nothing here" needs no flag: every patch is a negative already');
  assert.ok(!('complete' in L.parseLabel('{"key":"i1","groups":[],"complete":"yes"}')));
  globalThis.createImageBitmap = async () => ({ width: 640, height: 480, close() {} });
  const root = mkdtempSync(join(tmpdir(), 'cmp-ws-')), imgs = join(root, 'images'), data = join(root, 'data');
  mkdirSync(imgs); mkdirSync(data); writeFileSync(join(imgs, 'a.png'), 'stub');
  const be = { ...fsBackend(), async readBytes(p) { return new Uint8Array(readFileSync(p)); }, async appPaths() { return { data_dir: data }; }, mediaUrl: (p) => p };
  const vals = { 'labelling.shuffle': false }, toasts = [];
  const real = { settings: { get: (k, d) => (k in vals ? vals[k] : d), set: (k, v) => { vals[k] = v; } }, backend: be, doc: { media: null, scenes: [] }, labelling: null, commands: { keysFor: () => [], setGate() {} }, toast: (m) => toasts.push(m), player: { pause() {}, timeMs: 0 } };
  const ws = new LabelWorkspace(real);
  await ws.enter(imgs);
  await ws.toggleComplete(); assert.equal(ws.complete, false, 'refused with nothing painted');
  ws.G.pickPart('hips'); ws.G.begin(0.3, 0.3, false); ws.G.move(0.35, 0.3); ws.G.end();
  await ws.toggleComplete(); assert.equal(ws.complete, true);
  const file = join(data, 'seeder', 'datasets', 'v2', 'labels', readdirSync(join(data, 'seeder', 'datasets', 'v2', 'labels'))[0]);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).complete, true);
  assert.equal(ws.marks.get(ws.current.key).complete, true, 'the thumbnail mark follows');
  await ws.leave();
  const ws2 = new LabelWorkspace(real); await ws2.enter(imgs); await ws2.show(0);
  assert.equal(ws2.complete, true, 'back after a reload');
  await ws2.toggleComplete(); assert.ok(!('complete' in JSON.parse(readFileSync(file, 'utf8'))), 'off again: partial');
  await ws2.leave();
});

test('Decline all: one undoable step that removes only pending suggestions; never a label; "not painted" on a partial picture', async () => {
  globalThis.createImageBitmap = async () => ({ width: 640, height: 480, close() {} });
  const root = mkdtempSync(join(tmpdir(), 'dec-ws-')), imgs = join(root, 'images'), data = join(root, 'data');
  mkdirSync(imgs); mkdirSync(data); writeFileSync(join(imgs, 'a.png'), 'stub');
  const be = { ...fsBackend(), async readBytes(p) { return new Uint8Array(readFileSync(p)); }, async appPaths() { return { data_dir: data }; }, mediaUrl: (p) => p };
  const vals = { 'labelling.shuffle': false };
  const real = { settings: { get: (k, d) => (k in vals ? vals[k] : d), set: (k, v) => { vals[k] = v; } }, backend: be, doc: { media: null, scenes: [] }, labelling: null, commands: { keysFor: () => [], setGate() {} }, toast() {}, player: { pause() {}, timeMs: 0 } };
  const ws = new LabelWorkspace(real);
  await ws.enter(imgs);
  const G = ws.G;
  G.pickPart('hips'); G.begin(0.2, 0.3, false); G.move(0.25, 0.3); G.end();
  const res = { groups: [{ name: 'c1_head', poly: square([0.6, 0.1, 0.8, 0.3]), score: 0.9, source: 'seeder' }, { name: 'c1_tail', poly: square([0.1, 0.7, 0.3, 0.9]), score: 0.8, source: 'seeder' }], ms: 1 };
  ws.suggestJob = async () => ({ result: res });
  await ws.suggest();
  assert.equal(ws.suggestionCount, 2);
  assert.ok(ws.compare.rows.some((r) => r.state === 'unpainted') && /not painted/.test(L.agreementText(ws.compare.rows)) && !/extra/.test(L.agreementText(ws.compare.rows)), 'partial picture: what you did not paint is "not painted", not "extra"');
  await ws.suggest();
  assert.equal(ws.suggestionCount, 2, 'Suggest again replaces the pending ones, they do not pile up');
  await ws.flush();
  const dir = join(data, 'seeder', 'datasets', 'v2', 'labels');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, readdirSync(dir)[0]), 'utf8')).groups.map((g) => g.name), ['c1_hips'], 'unaccepted suggestions are never written');
  assert.ok(G.declineAll());
  assert.deepEqual(ws.groups.map((g) => g.name), ['c1_hips'], 'only the pending suggestions went');
  assert.ok(ws.canUndo); ws.undo();
  assert.equal(ws.suggestionCount, 2, 'one undo step brings them all back');
  ws.redo();
  assert.equal(G.declineAll(), false, 'nothing pending: nothing to do');
  await ws.flush();
  const d = JSON.parse(readFileSync(join(dir, readdirSync(dir)[0]), 'utf8'));
  assert.deepEqual(d.groups.map((g) => g.name), ['c1_hips']);
  const rows = L.agreement([{ name: 'c1_hips' }], [{ name: 'c2_head' }], () => 0, false);
  assert.equal(L.agreementText(rows), 'c1_hips missed · c2_head extra', 'on a fully labelled / nothing-here picture it is a real extra');
  const sc = await import('../src/features/tracking/seed-score.js');
  assert.ok(sc.fewerParts({ overall: { silent: 0.2 }, previous: { silent: 0.1 } }) && !sc.fewerParts({ overall: { silent: 0.12 }, previous: { silent: 0.1 } }));
  assert.match(sc.scoreLine({ sources: 5, overall: { found: 0.5, iou: 0.3, cerr: 0.05, extra: 3, extra_strict: 0.4, n_strict: 6, silent: 0.2 }, previous: { silent: 0.1 } }), /false positives per picture on 6 fully labelled.*silent 20 %.*finding fewer parts than before/);
  await ws.leave();
});
