// Image labelling for the seeder (paw-714j): the folder listing / filter / "next unlabelled" logic, key stability, the label
// store's round trip (new parts included), and that entering, painting in and leaving the workspace leaves the project
// document byte-identical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync, mkdtempSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileModule } from 'svelte/compiler';
import { budget } from './perf.mjs';

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
const { encodeMask, maskSize, rasterPoly, PARTS } = await import('../src/features/tracking/groups.js');

const e = (name, extra = {}) => ({ name, path: 'W:\\Videos\\' + name, is_dir: false, size: 1000 + name.length, mtime_ms: 1700000000000, ...extra });

test('listing: jpg / jpeg / png / webp only, natural order, folders and gifs skipped, nothing decoded', () => {
  const out = L.listImages([e('img10.png'), e('img2.JPG'), e('a.gif'), e('notes.txt'), e('sub', { is_dir: true }), e('img1.jpeg'), e('z.webp'), e('x.png.bak')]);
  assert.deepEqual(out.map((i) => i.name), ['img1.jpeg', 'img2.JPG', 'img10.png', 'z.webp']);
  assert.ok(out.every((i) => /^i[0-9a-f]{14}$/.test(i.key)));
  assert.equal(new Set(out.map((i) => i.key)).size, out.length);
  const big = Array.from({ length: 3500 }, (_, i) => e(`s${i}.jpg`, { size: 5000 + i }));
  const t0 = performance.now(), l = L.listImages(big);
  assert.equal(l.length, 3500);
  budget(performance.now() - t0 < 600, 'a folder of 3,500 lists in well under a second');
  assert.equal(new Set(l.map((i) => i.key)).size, 3500, 'no key collisions');
});

test('key: path + size + mtime; stable, order-independent, slash / case folded; an edited file is a new image', () => {
  const k = L.imageKey(e('a.jpg'));
  assert.equal(k, L.imageKey(e('a.jpg')));
  assert.equal(k, L.imageKey({ ...e('a.jpg'), path: 'w:/videos/A.JPG' }), 'Windows: case and slashes do not matter');
  assert.notEqual(k, L.imageKey({ ...e('a.jpg'), size: 1 }));
  assert.notEqual(k, L.imageKey({ ...e('a.jpg'), mtime_ms: 1700000000001 }));
  assert.notEqual(k, L.imageKey({ ...e('a.jpg'), path: 'W:\\Videos\\b\\a.jpg' }));
  const a = L.listImages([e('b.png'), e('a.png')]), b = L.listImages([e('a.png'), e('b.png')]);
  assert.deepEqual(a.map((i) => i.key), b.map((i) => i.key));
});

test('next unlabelled wraps, counts and the counter text', () => {
  const im = L.listImages(['a', 'b', 'c', 'd'].map((n) => e(n + '.png'))), key = (n) => im[n].key;
  const done = new Set([key(0), key(2)]);
  assert.equal(L.nextUnlabelled(im, done, -1), 1);
  assert.equal(L.nextUnlabelled(im, done, 1), 3);
  assert.equal(L.nextUnlabelled(im, done, 3), 1, 'wraps round');
  assert.equal(L.nextUnlabelled(im, done, 3, false), -1);
  assert.equal(L.nextUnlabelled(im, new Set(im.map((i) => i.key)), 0), -1, 'everything labelled');
  assert.equal(L.nextUnlabelled([], done, -1), -1);
  assert.deepEqual(L.counts(im, done), { total: 4, labelled: 2, left: 2, skipped: 0 });
  assert.equal(L.counterText({ labelled: 37, left: 3510 }), '37 labeled · 3,510 left');
  assert.deepEqual(L.windowOf(3500, 0, 31), [0, 31]);
  assert.deepEqual(L.windowOf(3500, 3499, 31), [3469, 3500]);
  assert.deepEqual(L.windowOf(5, 2, 31), [0, 5]);
});

// a backend over the real file system (the Rust store's rules: no parent folder = not_found, makeDir = mkdir -p)
const fsBackend = () => ({
  async listDir(d) { return readdirSync(d).map((name) => { const p = join(d, name), s = statSync(p); return { name, path: p, is_dir: s.isDirectory(), size: s.size, mtime_ms: Math.round(s.mtimeMs) }; }); },
  async readText(p) { return readFileSync(p, 'utf8'); },
  async writeText(p, t) { if (!existsSync(join(p, '..'))) { const x = new Error('not_found'); x.code = 'not_found'; throw x; } writeFileSync(p, t); },
  async makeDir(p) { mkdirSync(p, { recursive: true }); },
  async remove(p) { rmSync(p); },
});
const group = (name, box, size = maskSize(4 / 3)) => {
  const poly = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]];
  const [who, part, side] = name.split('_');
  return { name, who, part, ...(side ? { side } : {}), poly, pinned: true, t_ms: 123, source: 'tagger', score: 0.4, mask: encodeMask(rasterPoly(poly, size)) };
};

test('label store round trip: groups in the .pawproj encoding, none, remove, the new parts', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'lbl-')), 'seeder', 'labels'), st = L.createLabelStore(fsBackend(), dir);
  assert.equal((await st.keys()).size, 0, 'no folder yet: nothing labelled');
  const names = ['c1_penis', 'c2_thighs_l', 'c1_knot', 'c1_tongue', 'c2_stomachbulge', 'c1_neckbulge'];
  assert.ok(['knot', 'thighs', 'tongue', 'stomachbulge', 'neckbulge'].every((p) => PARTS.includes(p)));
  const groups = names.map((n, i) => group(n, [0.05 + i * 0.1, 0.1, 0.12 + i * 0.1, 0.4]));
  const lab = L.makeLabel({ image: 'W:\\Videos\\a.png', key: 'iabcdef01234567', w: 640, h: 480, groups, now: 5 });
  await st.write(lab);
  await st.write(L.makeLabel({ image: 'W:\\Videos\\b.png', key: 'i00000000000001', w: 10, h: 10, none: true, now: 6 }));
  assert.deepEqual([...(await st.keys())].sort(), ['i00000000000001', 'iabcdef01234567']);
  const back = await st.read('iabcdef01234567');
  assert.deepEqual(back.groups.map((g) => g.name), names);
  assert.ok(back.groups.every((g) => g.source === 'user' && g.t_ms === 0 && g.mask.rle.length && g.poly.length === 4 && !('score' in g)), 'painted: the .pawproj fields, source user');
  assert.deepEqual(back.groups.map((g) => [g.who, g.part, g.side || null]), names.map((n) => { const [w, p, s] = n.split('_'); return [w, p, s || null]; }));
  assert.equal(back.image, 'W:\\Videos\\a.png'); assert.equal(back.w, 640); assert.equal(back.savedAt, 5);
  const none = await st.read('i00000000000001');
  assert.deepEqual([none.none, none.groups], [true, []]);
  assert.deepEqual(L.restoreGroups(back).map((g) => g.t_ms), Array(6).fill(0));
  assert.deepEqual(L.partNames([...groups, { name: 'unassigned_1' }]), names);
  assert.equal(await st.read('inothere'), null);
  await st.remove('i00000000000001'); await st.remove('i00000000000001');
  assert.deepEqual([...(await st.keys())], ['iabcdef01234567']);
  writeFileSync(join(dir, 'junk.json'), '{'); writeFileSync(join(dir, 'iabcdef01234567.json.tmp'), '');
  assert.deepEqual([...(await st.keys())], ['iabcdef01234567'], 'stray files are not labels');
  assert.equal(L.parseLabel('{"key":1}'), null);
});

test('entering, painting on and leaving the workspace leaves the project document byte-identical; labels come back', async () => {
  globalThis.createImageBitmap = async () => ({ width: 640, height: 480, close() {} });
  const root = mkdtempSync(join(tmpdir(), 'lbl-ws-')), imgs = join(root, 'images'), data = join(root, 'data');
  mkdirSync(imgs); mkdirSync(data);
  for (const n of ['a.png', 'b.png', 'c.jpg']) writeFileSync(join(imgs, n), 'not decoded: the bitmap is stubbed');
  writeFileSync(join(imgs, 'skip.gif'), 'x');
  const be = { ...fsBackend(), async readBytes(p) { return new Uint8Array(readFileSync(p)); }, async appPaths() { return { data_dir: data }; }, mediaUrl: (p) => p };
  const vals = { 'labelling.shuffle': false }, toasts = [], gate = [];
  const project = { media: { path: 'C:\\v\\x.mp4', width: 1920, height: 1080 }, scenes: [{ start_ms: 0, end_ms: 4000, groups: [group('c1_hips', [0.2, 0.2, 0.4, 0.4], maskSize(16 / 9))] }], dirty: false, axes: { stroke: [{ at: 0, pos: 50 }] } };
  const real = { settings: { get: (k, d) => (k in vals ? vals[k] : d), set: (k, v) => { vals[k] = v; } }, backend: be, doc: project, labelling: null,
    commands: { keysFor: () => [], setGate: (f) => gate.push(f) }, toast: (m) => toasts.push(m), player: { pause() {}, timeMs: 1234 } };
  const before = JSON.stringify(real.doc) + '|' + real.player.timeMs;
  const ws = new LabelWorkspace(real);
  assert.ok(await ws.enter(imgs), 'opens');
  assert.equal(ws.images.length, 3); assert.equal(ws.index, 0); assert.ok(ws.ready && real.labelling === ws && ws.on);
  assert.equal(vals['labelling.folder'], imgs, 'the last folder is remembered');
  assert.equal(ws.counter, '0 labeled · 3 left');
  assert.ok(gate[0]({ id: 'labelling.next' }) && gate[0]({ id: 'tracking.groupsWho1' }) && !gate[0]({ id: 'player.toggle' }) && !gate[0]({ id: 'tracking.groups' }));
  const G = ws.G;
  assert.ok(G.on && G.labelMode);
  // paint two parts on the first image
  G.pickPart('hips'); G.begin(0.3, 0.3, false); G.move(0.35, 0.3); G.end();
  G.pickPart('head'); G.begin(0.7, 0.6, false); G.move(0.72, 0.62); G.end();
  assert.deepEqual(ws.groups.map((g) => g.name), ['c1_hips', 'c1_head']);
  assert.ok(ws.canUndo); ws.undo(); assert.equal(ws.groups.length, 1); ws.redo(); assert.equal(ws.groups.length, 2);
  await ws.next();                       // flushes image 0
  assert.equal(ws.index, 1); assert.equal(ws.groups.length, 0, 'a new image starts empty');
  assert.equal(ws.labelled.size, 1); assert.equal(ws.counter, '1 labeled · 2 left');
  assert.equal(readdirSync(join(data, 'seeder', 'datasets', 'v2', 'labels')).length, 1);
  assert.deepEqual(readdirSync(imgs).sort(), ['a.png', 'b.png', 'c.jpg', 'skip.gif'], 'nothing was written beside the images');
  ws.sameParts();                        // the last image's part names to paint, the first armed
  assert.deepEqual(ws.queue, ['c1_hips', 'c1_head']); assert.ok(G.armed && G.nextName === 'c1_hips');
  G.begin(0.5, 0.5, false); G.move(0.55, 0.5); G.end();
  assert.ok(G.armed && G.nextName === 'c1_head', 'the next queued part is armed after the stroke');
  await ws.toggleNone();                 // has groups: refused
  assert.equal(ws.none, false);
  G.remove(0);
  await ws.flush();
  assert.equal(ws.labelled.size, 1, 'an image whose groups are all deleted is unlabelled again');
  await ws.toggleNone();                 // nothing here: stored, on to the next unlabelled one
  assert.equal(ws.index, 2); assert.equal(ws.labelled.size, 2);
  await ws.leave();
  assert.ok(!ws.on); assert.equal(gate.at(-1), null);
  assert.equal(JSON.stringify(real.doc) + '|' + real.player.timeMs, before, 'the project document is byte-identical');
  assert.equal(real.doc.dirty, false);
  // re-enter: the labels are back (from disk), the walk starts at the first unlabelled image
  const ws2 = new LabelWorkspace(real);
  await ws2.enter(imgs);
  assert.equal(ws2.counter, '2 labeled · 1 left'); assert.equal(ws2.index, 2);
  await ws2.show(0);
  assert.deepEqual(ws2.groups.map((g) => g.name), ['c1_hips', 'c1_head'], 'the painted parts are restored');
  await ws2.show(1);
  assert.equal(ws2.none, true, '"nothing here" is restored');
  await ws2.leave();
});

test('paw-fheb skip: U passes over skipped images while others are left, then they come back in order; the counter', () => {
  const im = L.listImages(['a', 'b', 'c', 'd', 'e'].map((n) => e(n + '.png'))), key = (n) => im[n].key;
  const lab = new Set([key(0)]), sk = new Set([key(1), key(3)]);
  assert.equal(L.nextTodo(im, lab, sk, 0), 2, 'b is skipped');
  assert.equal(L.nextTodo(im, lab, sk, 2), 4, 'd is skipped');
  assert.equal(L.nextTodo(im, lab, sk, 4), 2, 'wraps over the skipped ones');
  assert.equal(L.nextTodo(im, lab, new Set(), 0), 1, 'no skips: plain next unlabelled');
  const lab2 = new Set([key(0), key(2), key(4)]);
  assert.equal(L.nextTodo(im, lab2, sk, 4), 1, 'only skipped left: from the start, in order');
  assert.equal(L.nextTodo(im, lab2, sk, 1), 3, 'on a skipped one: the next skipped');
  assert.equal(L.nextTodo(im, new Set(im.map((x) => x.key)), sk, 0), -1);
  assert.deepEqual(L.counts(im, lab, sk), { total: 5, labelled: 1, left: 2, skipped: 2 });
  assert.deepEqual(L.counts(im, new Set([key(1)]), sk), { total: 5, labelled: 1, left: 3, skipped: 1 }, 'a labelled skipped image counts as labelled');
  assert.equal(L.counterText(L.counts(im, lab, sk)), '1 labeled · 2 left · 2 skipped');
  assert.equal(L.counterText(L.counts(im, lab)), '1 labeled · 4 left', 'no skips: no skipped count');
});

test('paw-fheb skip in the workspace: stored with the dataset order (not a label), arrows still land, labelling clears it, clear skips', async () => {
  globalThis.createImageBitmap = async () => ({ width: 640, height: 480, close() {} });
  const root = mkdtempSync(join(tmpdir(), 'lbl-skip-')), imgs = join(root, 'images'), data = join(root, 'data');
  mkdirSync(imgs); mkdirSync(data);
  for (const n of ['a.png', 'b.png', 'c.png', 'd.png']) writeFileSync(join(imgs, n), 'x');
  const be = { ...fsBackend(), async readBytes(p) { return new Uint8Array(readFileSync(p)); }, async appPaths() { return { data_dir: data }; }, mediaUrl: (p) => p };
  const vals = { 'labelling.shuffle': false };
  const real = { settings: { get: (k, d) => (k in vals ? vals[k] : d), set: (k, v) => { vals[k] = v; } }, backend: be, doc: { scenes: [] }, labelling: null,
    commands: { keysFor: () => [], setGate() {} }, toast() {}, player: { pause() {} } };
  const ws = new LabelWorkspace(real);
  await ws.enter(imgs);
  assert.equal(ws.index, 0);
  await ws.skip();
  assert.equal(ws.index, 1); assert.equal(ws.counter, '0 labeled · 3 left · 1 skipped');
  await ws.skip(); assert.equal(ws.index, 2);
  await ws.nextUnlabelled(); assert.equal(ws.index, 3, 'U passes over a and b');
  await ws.nextUnlabelled(); assert.equal(ws.index, 2, 'wraps to c, not to a');
  await ws.prev(); await ws.prev(); assert.equal(ws.index, 0, 'the arrows still land on skipped images');
  const labels = join(data, 'seeder', 'datasets', 'v2', 'labels');
  assert.ok(!existsSync(labels) || readdirSync(labels).length === 0, 'a skip writes no label');
  const order = join(data, 'seeder', 'datasets', 'v2', 'order'), f = readdirSync(order);
  assert.equal(JSON.parse(readFileSync(join(order, f[0]), 'utf8')).skipped.length, 2, 'stored with the dataset order');
  const G = ws.G;
  G.pickPart('hips'); G.begin(0.3, 0.3, false); G.move(0.35, 0.3); G.end();
  await ws.flush();
  assert.ok(!ws.skipped.has(ws.current.key), 'labelling a skipped image clears its skip');
  assert.equal(ws.counter, '1 labeled · 2 left · 1 skipped');
  // a new session reads the skips back
  await ws.leave();
  const ws2 = new LabelWorkspace(real);
  await ws2.enter(imgs);
  assert.equal(ws2.index, 2, 'opens on the first un-skipped unlabelled image');
  assert.equal(ws2.skipped.size, 1);
  await ws2.show(3); await ws2.toggleNone();   // d done: only the skipped b is left
  assert.equal(ws2.index, 2);
  await ws2.toggleNone();
  assert.equal(ws2.index, 1, 'nothing else left: the skipped image comes back');
  ws2.clearSkips();
  assert.equal(ws2.skipped.size, 0); assert.equal(ws2.counter, '3 labeled · 1 left');
  await ws2.leave();
});

test('paw-bybk: U and Skip confirm the confident proposals first, leave the unsure ones unnamed and say how many', async () => {
  globalThis.createImageBitmap = async () => ({ width: 640, height: 480, close() {} });
  const root = mkdtempSync(join(tmpdir(), 'lbl-settle-')), imgs = join(root, 'images'), data = join(root, 'data');
  mkdirSync(imgs); mkdirSync(data);
  for (const n of ['a.png', 'b.png', 'c.png', 'd.png']) writeFileSync(join(imgs, n), 'x');
  const be = { ...fsBackend(), async readBytes(p) { return new Uint8Array(readFileSync(p)); }, async appPaths() { return { data_dir: data }; }, mediaUrl: (p) => p };
  const vals = { 'labelling.shuffle': false }, toasts = [];
  const real = { settings: { get: (k, d) => (k in vals ? vals[k] : d), set: (k, v) => { vals[k] = v; } }, backend: be, doc: { scenes: [] }, labelling: null,
    commands: { keysFor: () => [], setGate() {} }, toast: (m) => toasts.push(m), player: { pause() {} } };
  const ws = new LabelWorkspace(real), G = ws.G;
  await ws.enter(imgs);
  const confirms = [];
  G.proposalsSettled = async () => {};
  // the confident proposal names the first blob (as the Groups tool's confirmProposals does); the second stays unnamed
  G.confirmProposals = () => { confirms.push(ws.index); ws.app.transact('Groups: name', () => { const gs = ws.groups.map((g) => ({ ...g })); gs[0].name = 'c1_hips'; ws.doc.scenes = [{ ...ws.doc.scenes[0], groups: gs }]; }); };
  const paint = () => { G.begin(0.2, 0.2, false); G.move(0.25, 0.2); G.end(); G.begin(0.7, 0.6, false); G.move(0.72, 0.62); G.end(); };
  paint();
  assert.deepEqual(ws.groups.map((g) => g.name), ['unassigned_1', 'unassigned_2']);
  await ws.advance();                    // U
  assert.deepEqual(confirms, [0], 'confirmed on the picture left');
  assert.equal(ws.index, 1);
  assert.ok(toasts.some((m) => /1 blob left unnamed/.test(m)), toasts.join('|'));
  assert.equal(JSON.parse(readFileSync(join(data, 'seeder', 'datasets', 'v2', 'labels', readdirSync(join(data, 'seeder', 'datasets', 'v2', 'labels'))[0]), 'utf8')).groups[0].name, 'c1_hips', 'saved with the confirmed name');
  await ws.advance();                    // U on an empty picture: nothing to confirm, no toast, just moves
  assert.equal(confirms.length, 1); assert.equal(ws.index, 2);
  paint(); toasts.length = 0;
  await ws.skip();                       // Skip with painted blobs does the same
  assert.deepEqual(confirms, [0, 2]); assert.equal(ws.index, 3);
  assert.ok(toasts.some((m) => /1 blob left unnamed/.test(m)));
  await ws.leave();
});
