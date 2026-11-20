// Labelling workspace image loading (paw-cbw2): the read-ahead window, the byte-capped LRU, the prioritised read queue (max in
// flight, thumbnails never take the last slot, timeout, cancel), stale loads dropped, the thumbnail key, streamed listing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
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
const V = await import('../src/features/labelling/loader.js');
const { LabelWorkspace } = await import('../src/features/labelling/workspace.svelte.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const imgs = (n) => Array.from({ length: n }, (_, i) => ({ key: 'i' + String(i).padStart(14, '0'), path: `p${i}.jpg`, name: `p${i}.jpg` }));

test('read-ahead window: next 4, previous 2, and the next unlabelled one when it is further away', () => {
  const im = imgs(30), none = new Set();
  assert.deepEqual(V.readAhead(im, none, 10), [11, 12, 13, 14, 9, 8]);                       // 11 is the next unlabelled: already in
  assert.deepEqual(V.readAhead(im, none, 0), [1, 2, 3, 4]);                                  // no previous at the start
  assert.deepEqual(V.readAhead(im, none, 29), [28, 27, 0]);                                  // no next at the end; the next unlabelled wraps to 0
  const lab = new Set(im.slice(11, 20).map((x) => x.key));
  assert.deepEqual(V.readAhead(im, lab, 10), [11, 12, 13, 14, 9, 8, 20], 'next unlabelled would skip to 20');
  assert.deepEqual(V.readAhead(im, new Set(im.map((x) => x.key)), 5), [6, 7, 8, 9, 4, 3], 'all labelled: just the window');
  assert.deepEqual(V.readAhead(imgs(1), none, 0), []);
});

test('thumbnail key: the label key names the file, a changed file (new key) gets a new thumbnail', async () => {
  const L = await import('../src/features/labelling/labels.js');
  const e = { path: 'W:\\x\\a.jpg', size: 10, mtime_ms: 5 };
  assert.equal(V.thumbFile('C:\\d\\seeder\\thumbs', L.imageKey(e)), `C:\\d\\seeder\\thumbs\\${L.imageKey(e)}.jpg`);
  assert.equal(V.thumbFile('/d/thumbs/', 'iabc'), '/d/thumbs/iabc.jpg');
  assert.notEqual(L.imageKey(e), L.imageKey({ ...e, mtime_ms: 6 }));
  assert.deepEqual([...V.thumbKeys([{ name: 'i0123456789abcd.jpg' }, { name: 'x.jpg' }, { name: 'i0123456789abcd.json' }])], ['i0123456789abcd']);
});

test('decoded cache: least recently used out by total bytes, bitmaps closed, the pinned one stays', () => {
  const closed = [], bm = (k) => ({ width: 1000, height: 1000, close() { closed.push(k); } });   // 4 MB each
  const c = new V.BitmapCache(10 * 2 ** 20);   // room for 2 (8 MB)
  c.set('a', bm('a')); c.set('b', bm('b')); c.get('a');   // a is now the most recent
  c.set('c', bm('c'));
  assert.deepEqual(c.keys(), ['a', 'c']); assert.deepEqual(closed, ['b']);
  c.pinned = 'a'; c.set('d', bm('d'));
  assert.ok(c.has('a') && c.has('d') && !c.has('c'), 'the pinned (on screen) image is never evicted'); assert.deepEqual(closed, ['b', 'c']);
  c.set('d', bm('d2')); assert.deepEqual(closed, ['b', 'c', 'd'], 'replacing closes the old bitmap');
  assert.equal(c.bytes, 8e6);
  c.clear(); assert.equal(c.size, 0); assert.equal(c.bytes, 0);
  assert.equal(V.CACHE_BYTES / (4000 * 3000 * 4) | 0, 13, '640 MiB holds 13 pictures of 4000 x 3000');
});

test('read queue: at most N in flight, best priority first, thumbnails keep one slot free, queued jobs cancel', async () => {
  const q = new V.ReadQueue({ max: 3, maxLow: 1, timeoutMs: 1000 }), order = [], gates = {};
  const job = (name, prio, opts) => q.add(name, prio, () => { order.push(name); return new Promise((r) => { gates[name] = r; }); }, opts);
  const ps = [job('t1', 10, { low: true, kind: 'thumb' }), job('t2', 10, { low: true, kind: 'thumb' }), job('a', 3), job('b', 2), job('c', 1), job('d', 0)];
  ps.forEach((p) => p.catch(() => {}));
  await sleep(5);
  assert.equal(q.flying, 3); assert.deepEqual(order, ['d', 'c', 'b'], 'by priority; thumbnails wait');
  gates.d(); await sleep(5);
  assert.deepEqual(order, ['d', 'c', 'b', 'a']);
  gates.c(); await sleep(5);
  assert.deepEqual(order, ['d', 'c', 'b', 'a', 't1']); assert.equal(q.flyingLow, 1);
  q.cancel((j) => j.kind === 'thumb');   // t2 still queued: cancelled; t1 running: not
  await assert.rejects(ps[1], { code: 'cancelled' });
  for (const g of Object.values(gates)) g(); await sleep(5);
  assert.equal(q.flying, 0); assert.ok(q.peak <= 3, 'never more than 3 at once, peak ' + q.peak);
});

test('read queue: a read that takes too long fails with timeout and frees its slot (the queue moves on)', async () => {
  const q = new V.ReadQueue({ max: 1, timeoutMs: 30 });
  const slow = q.add('slow', 0, () => new Promise(() => {})), after = q.add('next', 1, async () => 'ok');
  await assert.rejects(slow, { code: 'timeout' });
  assert.equal(await after, 'ok');
});

test('loader: one read per image, a queued one is promoted, queued reads outside the wanted set are cancelled, late results after clear are dropped and closed', async () => {
  const reads = [], closed = [];
  const loader = new V.ImageLoader({ queue: new V.ReadQueue({ max: 1 }), read: async (p) => { reads.push(p); await sleep(15); return p; }, decode: async (p) => ({ width: 10, height: 10, p, close() { closed.push(p); } }) });
  const im = imgs(6);
  const first = loader.get(im[0], 5), again = loader.get(im[0], 0);
  assert.strictEqual(first, again, 'de-duplicated');
  [1, 2, 3].forEach((k) => loader.prefetch(im[k], k));
  loader.keep(new Set([im[0].key, im[1].key]));          // 2 and 3 were queued, not started: cancelled
  await first; await sleep(60);
  assert.deepEqual(reads, ['p0.jpg', 'p1.jpg']); assert.ok(loader.peek(im[1].key) && !loader.peek(im[2].key));
  const late = loader.get(im[4], 0); late.catch(() => {});
  await sleep(5); loader.clear();                          // read of p4 is in flight
  await assert.rejects(late, { code: 'cancelled' });
  await sleep(40);
  assert.ok(!loader.peek(im[4].key)); assert.ok(closed.includes('p4.jpg'), 'the late bitmap was closed, not cached');
  assert.equal(loader.cache.size, 0);
});

// ---- the workspace over a slow backend ----
const fsBackend = (data, slow) => ({
  async listDir(d) { return readdirSync(d).map((name) => { const p = join(d, name), s = statSync(p); return { name, path: p, is_dir: s.isDirectory(), size: s.size, mtime_ms: Math.round(s.mtimeMs) }; }); },
  async readText(p) { return readFileSync(p, 'utf8'); },
  async writeText(p, t) { writeFileSync(p, t); },
  async makeDir(p) { mkdirSync(p, { recursive: true }); },
  async remove() {},
  async readBytes(p) { await slow(p); return new Uint8Array(readFileSync(p)); },
  async appPaths() { return { data_dir: data }; },
  mediaUrl: (p) => p,
});
function setup(slow, extra = {}) {
  globalThis.createImageBitmap = async (b) => ({ width: 640, height: 480, tag: b.size, close() {} });
  const root = mkdtempSync(join(tmpdir(), 'lbl-ld-')), dir = join(root, 'images'), data = join(root, 'data');
  mkdirSync(dir); mkdirSync(data);
  for (let i = 0; i < 12; i++) writeFileSync(join(dir, `p${String(i).padStart(2, '0')}.png`), 'x'.repeat(i + 1));   // size = index + 1: tells the images apart
  const vals = { 'labelling.shuffle': false }, real = { settings: { get: (k, d) => (k in vals ? vals[k] : d), set: (k, v) => { vals[k] = v; } }, backend: { ...fsBackend(data, slow), ...extra }, doc: {}, labelling: null,
    commands: { keysFor: () => [], setGate() {} }, toast() {}, player: { pause() {} } };
  return { ws: new LabelWorkspace(real), dir };
}

test('workspace: 20 quick nexts end on the right image; a late load never replaces the current one; read-ahead makes the next instant', async () => {
  const delays = new Map(), started = [];
  const { ws, dir } = setup(async (p) => { started.push(p); await sleep(delays.get(p.slice(-7)) || 5); });
  assert.ok(await ws.enter(dir)); assert.equal(ws.index, 0);
  await sleep(80);   // read-ahead of 1..4
  assert.ok(ws.loader.peek(ws.images[1].key) && ws.loader.peek(ws.images[4].key), 'the next ones are decoded already');
  const t0 = performance.now(); await ws.next(); const dt = performance.now() - t0; assert.ok(ws.ready && ws.index === 1, 'next after read-ahead is ready'); budget(dt < 20, 'next after read-ahead is immediate');
  // a slow image 8, then the owner moves on to 9 before it arrives
  delays.set('p08.png', 120);
  ws.show(8); await sleep(5); await ws.show(9);
  assert.equal(ws.index, 9); assert.equal(ws.doc.media.name, 'p09.png');
  await sleep(200);
  assert.equal(ws.doc.media.name, 'p09.png', 'the late image 8 did not replace the current one'); assert.ok(ws.ready);
  // fast run
  await ws.show(0);
  for (let k = 0; k < 11; k++) ws.next();
  await sleep(300);
  assert.equal(ws.index, 11); assert.equal(ws.doc.media.name, 'p11.png'); assert.equal(ws.player.bmp.tag, 12, 'the pixels are the last image\'s'); assert.ok(ws.ready);
  assert.ok(ws.loader.queue.peak <= V.MAX_READS);
  await ws.leave();
  assert.equal(ws.loader.cache.size, 0, 'leaving closes the decoded images');
});

test('workspace: a read that fails shows its error, does not stall the queue, retry loads it', async () => {
  let fail = true;
  const { ws, dir } = setup(async (p) => { if (fail && p.endsWith('p01.png')) throw new Error('share went away'); });
  await ws.enter(dir);
  await ws.show(1);
  assert.ok(!ws.ready && /share went away/.test(ws.failed));
  await ws.show(2); assert.ok(ws.ready && ws.failed === '', 'moving on works');
  await ws.show(1); assert.ok(!ws.ready);
  fail = false; await ws.retry();
  assert.ok(ws.ready && ws.doc.media.name === 'p01.png');
  await ws.leave();
});

test('workspace: the folder is listed in batches (labelling starts on the first), merged in natural order, the current image kept by key', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const e = (n) => ({ name: n, path: 'W:\\x\\' + n, is_dir: false, size: 3, mtime_ms: 1 });
  const { ws } = setup(async () => {}, {
    async listDirStream(folder, exts, onBatch) { onBatch([e('p10.png'), e('p2.png')]); await gate; onBatch([e('p1.png'), e('skip.txt')]); return 3; },
    async readBytes() { return new Uint8Array(3); },
  });
  assert.ok(await ws.enter('W:\\x'));   // resolves with the first batch
  assert.ok(ws.listing && ws.on); assert.deepEqual(ws.images.map((i) => i.name), ['p2.png', 'p10.png']); assert.ok(ws.ready, 'labelling can start at once');
  assert.equal(ws.current.name, 'p2.png');
  release(); await sleep(20);
  assert.ok(!ws.listing); assert.deepEqual(ws.images.map((i) => i.name), ['p1.png', 'p2.png', 'p10.png']); assert.equal(ws.index, 1); assert.equal(ws.current.name, 'p2.png', 'index follows the image');
  await ws.leave();
});

test('workspace: thumbnails are made by the backend for the strip, at most 2 at a time, never a full-size read; the tile stays neutral until one exists', async () => {
  const made = []; let flying = 0, peak = 0;
  const { ws, dir } = setup(async () => {}, { async imageThumbnail(src, dest) { flying++; peak = Math.max(peak, flying); await sleep(10); flying--; made.push(dest); } });
  await ws.enter(dir);
  assert.ok(ws.thumbs.size === 0 && ws.thumbUrl(ws.images[3]) === '');
  ws.wantThumbs(ws.images.slice(0, 8)); await sleep(100);
  assert.equal(made.length, 8); assert.ok(peak <= V.MAX_LOW, 'peak ' + peak);
  assert.ok(made[0].endsWith(ws.images[0].key + '.jpg') && made[0].includes('thumbs'), made[0]);
  assert.ok(ws.thumbUrl(ws.images[3]).endsWith(ws.images[3].key + '.jpg'));
  await ws.leave();
});

// ---- shuffled order ----
test('shuffle: the same seed gives the same order, other seeds differ, adding files keeps the earlier order, new ones land after the current', async () => {
  const L = await import('../src/features/labelling/labels.js');
  const im = imgs(200), by = (a) => a.images.map((x) => x.key);
  const a = L.arrangeShuffled(im, null, 7), b = L.arrangeShuffled([...im].reverse(), null, 7), c = L.arrangeShuffled(im, null, 8);
  assert.deepEqual(by(a), by(b), 'same seed, same order whatever the listing order'); assert.notDeepEqual(by(a), by(c));
  assert.notDeepEqual(by(a), im.map((x) => x.key), 'actually shuffled'); assert.equal(new Set(by(a)).size, 200);
  // hash order: adding files never reorders the others
  const more = [...im, ...imgs(230).slice(200)], m = by(L.arrangeShuffled(more, null, 7)).filter((k) => by(a).includes(k));
  assert.deepEqual(m, by(a));
  // a stored order + 30 new files: the old ones keep their order, the new ones are all after the current image
  const cur = a.order[50], d = L.arrangeShuffled(more, a.order, 7, cur), pos = (k) => d.order.indexOf(k);
  assert.deepEqual(d.order.filter((k) => a.order.includes(k)), a.order);
  assert.ok(more.slice(200).every((x) => pos(x.key) > pos(cur)), 'never before the current image'); assert.equal(d.order.length, 230);
  assert.ok(more.slice(200).some((x) => pos(x.key) < d.order.length - 5), 'spread out, not appended');
  // previous / next are inverses over the arranged list
  const ws = d.images; for (let i = 1; i < ws.length - 1; i++) assert.equal(ws[i + 1 - 1].key, d.order[i]);
  // removed files drop out
  assert.equal(L.arrangeShuffled(im.slice(0, 100), a.order, 7, cur).images.length, 100);
});

test('workspace: shuffled by default, stable across leaving, re-entering and a new session; reshuffle changes it; folder order is one toggle away; previous goes back', async () => {
  const { ws, dir } = setup(async () => {});
  const real = ws.real; real.settings.set('labelling.shuffle', true);
  assert.ok(await ws.enter(dir)); await sleep(20);
  const names = () => ws.images.map((i) => i.name), first = names();
  assert.ok(ws.shuffle); assert.notDeepEqual(first, [...first].sort(), 'shuffled');
  await ws.show(3); await ws.next(); assert.equal(ws.current.name, first[4]); await ws.prev(); assert.equal(ws.current.name, first[3], 'previous goes back to the image just before');
  await ws.leave(); await sleep(20);
  const ws2 = new LabelWorkspace(real); await ws2.enter(dir); await sleep(20);
  assert.deepEqual(ws2.images.map((i) => i.name), first, 'the same order after a restart (the seed is stored with the folder)');
  ws2.setShuffle(false); assert.deepEqual(ws2.images.map((i) => i.name), [...first].sort(), 'folder order');
  assert.equal(real.settings.get('labelling.shuffle'), false);
  ws2.setShuffle(true); assert.deepEqual(ws2.images.map((i) => i.name), first, 'back to the same shuffle');
  const cur = ws2.current.name; ws2.reshuffle();
  assert.notDeepEqual(ws2.images.map((i) => i.name), first); assert.equal(ws2.current.name, cur, 'the image on screen stays');
  await sleep(20); const second = ws2.images.map((i) => i.name);
  await ws2.leave(); const ws3 = new LabelWorkspace(real); await ws3.enter(dir); await sleep(20);
  assert.deepEqual(ws3.images.map((i) => i.name), second, 'the new seed is the stored one');
  await ws3.leave();
});

// ---- Suggest on a still image: a suggestion is not a label ----
test('Suggest on an image: shown suggestions are never saved or trained on; accepted ones are saved as the owner\'s, marked from suggest; the compare view reads found / missed / extra', async () => {
  const { suggestGroupsRequest } = await import('../src/lib/protocol.js');
  const { agreement, agreementText } = await import('../src/features/labelling/labels.js');
  assert.deepEqual(suggestGroupsRequest({ image: 'C:\i\a.jpg', seed: { dir: 'D:\s', key: 'ik' } }), { cmd: 'suggest_groups', image: 'C:\i\a.jpg', params: {}, seed: { dir: 'D:\s', key: 'ik' } }, 'an image request has no video / time');
  const { ws, dir } = setup(async () => {});
  const labels = join(dir, '..', 'data', 'seeder', 'datasets', 'v2', 'labels');
  await ws.enter(dir); await ws.show(0);
  ws.G.setSuggestConf(0.3);   // paw-r6t0: Suggest shows 80 % and up by default; this test is about what is shown being never saved
  const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const reqs = [];
  ws.suggestJob = async (req) => { reqs.push(req); return { result: { ms: 7, seeder: { frames: 4, videos: 2 }, groups: [{ name: 'c1_hips', poly: box(0.1, 0.1, 0.5, 0.5), score: 0.5, source: 'seeder', tentative: true }, { name: 'c1_knot', poly: box(0.6, 0.6, 0.9, 0.9), score: 0.9, source: 'tagger' }] } }; };
  await ws.G.suggest();
  assert.equal(reqs[0].image, ws.current.path); assert.ok(!('video' in reqs[0]) && reqs[0].seed.key === ws.current.key);
  assert.equal(ws.suggestionCount, 2); assert.equal(ws.painted.length, 0); assert.ok(ws.compare && !ws.compare.hadLabels);
  await ws.flush(); await sleep(450);
  const saved = () => { try { return readdirSync(labels); } catch { return []; } };
  assert.deepEqual(saved(), [], 'shown suggestions are not written as labels'); assert.equal(ws.labelled.size, 0);
  // accept one: it is the owner's now (source user) and says where it came from; the other, never accepted, is absent
  const k = ws.groups.findIndex((g) => g.name === 'c1_hips'); ws.G.accept(k);
  await ws.flush();
  assert.equal(saved().length, 1);
  const lab = JSON.parse(readFileSync(join(labels, saved()[0]), 'utf8'));
  assert.deepEqual(lab.groups.map((g) => [g.name, g.source, g.from]), [['c1_hips', 'user', 'suggest']]);
  assert.ok(lab.groups.every((g) => !('score' in g) && !('tentative' in g)));
  // the training side reads only source user: the label file has exactly the accepted group (the sidecar test checks seeder.image_labels skips the rest)
  // compare against labels already there: nothing is overwritten; hide / show; the readout
  ws.dismissSuggestions(); assert.equal(ws.painted.length, 1);
  ws.suggestJob = async () => ({ result: { ms: 3, groups: [{ name: 'c1_hips', poly: box(0.1, 0.1, 0.5, 0.5), score: 0.8, source: 'seeder' }, { name: 'c1_tongue', poly: box(0.6, 0.1, 0.8, 0.3), score: 0.6, source: 'tagger' }] } });
  await ws.suggest();
  assert.ok(ws.compare.hadLabels); assert.equal(ws.painted.length, 1, 'the owner\'s label is kept'); assert.equal(ws.suggestionCount, 2);
  assert.deepEqual(ws.compare.rows.map((r) => [r.name, r.state]), [['c1_hips', 'found'], ['c1_tongue', 'unpainted']]); assert.ok(ws.compare.rows[0].overlap > 0.9, 'same region: ' + ws.compare.rows[0].overlap);
  ws.toggleSuggestions(); assert.equal(ws.suggestionCount, 0); assert.equal(ws.painted.length, 1); assert.equal(ws.compare.shown, false);
  ws.toggleSuggestions(); assert.equal(ws.suggestionCount, 2);
  await ws.flush(); await sleep(450);
  assert.equal(JSON.parse(readFileSync(join(labels, saved()[0]), 'utf8')).groups.length, 1, 'the second, unaccepted suggestions did not reach the label');
  const rows = agreement([{ name: 'c1_knot' }, { name: 'c1_hips' }, { name: 'unassigned_1' }], [{ name: 'c1_hips' }, { name: 'c2_head' }], () => 0.82);
  assert.equal(agreementText(rows), 'c1_knot missed · c1_hips found 82 % · c2_head extra');
  await ws.leave();
});

test('paw-fheb read-ahead preloads the image U lands on when the caller gives it (skips)', () => {
  const im = Array.from({ length: 30 }, (_, i) => ({ key: 'k' + i, path: 'p' + i }));
  assert.deepEqual(V.readAhead(im, new Set(), 10, { next: 25 }), [11, 12, 13, 14, 9, 8, 25]);
  assert.deepEqual(V.readAhead(im, new Set(), 10, { next: -1 }), [11, 12, 13, 14, 9, 8], 'nothing to label: just the window');
});
