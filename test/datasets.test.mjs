// Seeder datasets (paw-855t): the registry and the picker's store logic, per-dataset isolation of labels, "start from the v1 label", the
// include-projects scope, the request, and the comparison lines. The migration itself is src-tauri/src/datasets.rs (cargo test) and the
// sidecar side trackers/tests/test_seeder_datasets.py.
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
const D = await import('../src/features/labelling/datasets.js');
const L = await import('../src/features/labelling/labels.js');
const { LabelWorkspace } = await import('../src/features/labelling/workspace.svelte.js');
const { seedTrainRequest, seedCompareRequest, suggestGroupsRequest } = await import('../src/lib/protocol.js');
const { overviewLine, crossLine } = await import('../src/features/tracking/seed-score.js');
const { encodeMask, maskSize, rasterPoly } = await import('../src/features/tracking/groups.js');

const fsBackend = () => ({
  async listDir(d) { return readdirSync(d).map((name) => { const p = join(d, name), s = statSync(p); return { name, path: p, is_dir: s.isDirectory(), size: s.size, mtime_ms: Math.round(s.mtimeMs) }; }); },
  async readText(p) { return readFileSync(p, 'utf8'); },
  async writeText(p, t) { if (!existsSync(join(p, '..'))) { const x = new Error('not_found'); x.code = 'not_found'; throw x; } writeFileSync(p, t); },
  async makeDir(p) { mkdirSync(p, { recursive: true }); },
  async remove(p) { rmSync(p); },
});

test('registry: parse, fresh, create (images only, active), rename, archive, switch, projects flag; ids and names', () => {
  const fresh = D.freshRegistry(1);
  assert.deepEqual(fresh.datasets.map((d) => [d.id, d.projects]), [['v2', false]]); assert.equal(fresh.active, 'v2');
  const old = { version: 1, active: 'v2', datasets: [{ id: 'v1', name: 'v1', projects: true }, { id: 'v2', name: 'v2', projects: false }, { id: 'BAD id', name: 'x' }, { id: 'v1', name: 'dup' }] };
  const reg = D.parseRegistry(JSON.stringify(old));
  assert.deepEqual(reg.datasets.map((d) => d.id), ['v1', 'v2'], 'bad and duplicate ids dropped');
  assert.equal(D.parseRegistry('{'), null); assert.equal(D.parseRegistry('{"datasets":[]}'), null);
  assert.equal(D.parseRegistry(JSON.stringify({ ...old, active: 'nope' })).active, 'v1', 'an unknown active falls back to the first');
  const { reg: r3, id } = D.withCreated(reg, ' My set 2 ', 5);
  assert.equal(id, 'my-set-2'); assert.equal(r3.active, id); assert.equal(r3.datasets.at(-1).projects, false, 'a new dataset learns from images only');
  assert.equal(D.withCreated(r3, 'My set 2', 6).id, 'my-set-2-2', 'a free id'); assert.equal(D.withCreated(r3, '   ').id, null);
  assert.equal(D.withRenamed(r3, id, 'new look').datasets.at(-1).name, 'new look'); assert.equal(D.withRenamed(r3, id, ' ').datasets.at(-1).name, 'My set 2');
  const a = D.withArchived(r3, 'v1', true);
  assert.deepEqual(D.listed(a).map((d) => d.id), ['v2', id]); assert.deepEqual(D.archivedOf(a).map((d) => d.id), ['v1']);
  assert.equal(D.withArchived(r3, r3.active, true), r3, 'the active dataset cannot be hidden');
  assert.equal(D.withActive(a, 'v1').datasets.find((d) => d.id === 'v1').archived, undefined, 'switching to a hidden one brings it back');
  assert.equal(D.withProjects(reg, 'v2', true).datasets[1].projects, true);
  assert.equal(D.pickerText({ name: 'v2' }, 37), 'v2 · 37 labeled'); assert.equal(D.pickerText({ name: 'v2' }, 3510), 'v2 · 3,510 labeled');
  assert.equal(D.datasetDir('C:\\d\\seeder', { id: 'v1' }), 'C:\\d\\seeder\\datasets\\v1'); assert.equal(D.datasetDir('/s', { id: 'v1', legacy: true }), '/s', 'legacy v1 = the old flat folder');
  assert.equal(D.labelsDirOf('/s', { id: 'v2' }), '/s/datasets/v2/labels');
});

test('the include-projects scope and the requests: images only for a new dataset, projects for v1; the dataset travels with Train, Suggest and the comparison', () => {
  const lib = ['C:\\lib'], v1 = { id: 'v1', projects: true, dir: 'S\\datasets\\v1', labels: 'S\\datasets\\v1\\labels' }, v2 = { id: 'v2', projects: false, dir: 'S\\datasets\\v2', labels: 'S\\datasets\\v2\\labels' };
  assert.deepEqual(D.trainScope(v1, { folders: lib, projectPath: 'C:\\p.pawproj', seed: 'S' }), { folders: lib, projects: ['C:\\p.pawproj'], labels: v1.labels, dataset: v1.dir }, 'v1 keeps including projects');
  assert.deepEqual(D.trainScope(v2, { folders: lib, projectPath: 'C:\\p.pawproj', seed: 'S' }), { folders: [], projects: [], labels: v2.labels, dataset: v2.dir }, 'a new dataset: images only');
  assert.deepEqual(D.trainScope(null, { folders: lib, seed: 'S' }), { folders: lib, projects: [], labels: 'S/labels', dataset: '' }, 'no registry: as before');
  const req = seedTrainRequest({ dir: 'S', ...D.trainScope(v2, { folders: lib, seed: 'S' }) });
  assert.equal(req.dataset, v2.dir); assert.deepEqual(req.folders, []); assert.equal(req.labels, v2.labels);
  assert.ok(!('dataset' in seedTrainRequest({ dir: 'S', folders: lib })), 'old shape unchanged');
  assert.equal(suggestGroupsRequest({ image: 'a.png', seed: { dir: 'S', dataset: v2.dir, key: 'k' } }).seed.dataset, v2.dir);
  assert.equal(seedCompareRequest({ dir: 'S', active: 'v2', datasets: [v1, v2], folders: lib }).cmd, 'seed_compare');
});

test('comparison lines: each dataset\'s own score, and every head on the active labels', () => {
  const sc = (f) => ({ overall: { found: f }, sources: 3 });
  assert.equal(overviewLine([{ name: 'v2', active: true, frames: 37, trained: true, score: sc(0.58) }, { name: 'v1', frames: 412, trained: true, score: sc(0.44) }, { name: 'v0', trained: false }]),
    'v2 (active): held-out found 58 % on its 37 labels · v1: held-out found 44 % on its 412 labels');
  assert.equal(overviewLine([]), '');
  const cross = { active: 'v2', frames: 8, common: ['penis', 'hips'], rows: [{ name: 'v2', own: true, found: 0.62 }, { name: 'v1', own: false, found: 0.44, n_frames: 5, excluded: 3 }] };
  assert.equal(crossLine(cross), "on v2's labels (8 pictures, 2 parts every head knows): v2 head found 62 % (held-out), v1 head found 44 % (on the 5 of them it never saw, 3 it trained on left out)");
  assert.match(crossLine({ active: 'v2', note: 'fewer than two trained datasets', rows: [] }), /fewer than two/);
  assert.equal(crossLine(null), '');
});

const img = (n) => ({ name: n });
test('workspace: v2 is created and active on a fresh start; labels are per dataset; switching follows; start from the v1 label; nothing is deleted', async () => {
  globalThis.createImageBitmap = async () => ({ width: 640, height: 480, close() {} });
  const root = mkdtempSync(join(tmpdir(), 'ds-ws-')), imgs = join(root, 'images'), data = join(root, 'data'), seed = join(data, 'seeder');
  mkdirSync(imgs); mkdirSync(seed, { recursive: true });
  for (const n of ['a.png', 'b.png', 'c.png']) writeFileSync(join(imgs, n), 'stub');
  // what the app's start-up leaves after the one-time move: v1 holds the old labels, v2 is new and active
  const be = { ...fsBackend(), async readBytes(p) { return new Uint8Array(readFileSync(p)); }, async appPaths() { return { data_dir: data }; }, mediaUrl: (p) => p };
  const vals = { 'labelling.shuffle': false }, toasts = [];
  const mkReal = () => ({ settings: { get: (k, d) => (k in vals ? vals[k] : d), set: (k, v) => { vals[k] = v; } }, backend: be, doc: { media: null, scenes: [] }, labelling: null, commands: { keysFor: () => [], setGate() {} }, toast: (m) => toasts.push(m), player: { pause() {}, timeMs: 0 } });   // a new app each time: the datasets store is per app
  // 1. a fresh start: no registry at all: v2 is made, active, empty
  const w0 = new LabelWorkspace(mkReal());
  await w0.enter(imgs);
  assert.equal(w0.ds.active.id, 'v2'); assert.deepEqual(w0.ds.reg.datasets.map((d) => d.id), ['v2']);
  assert.ok(existsSync(join(seed, 'datasets.json')), 'the registry is stored');
  assert.equal(w0.counter, '0 labeled · 3 left');
  await w0.leave(); rmSync(join(seed, 'datasets.json'));
  // 2. the migrated layout: v1 (projects on) with two labelled images, v2 empty and active
  const v1l = join(seed, 'datasets', 'v1', 'labels'); mkdirSync(v1l, { recursive: true });
  const keys = L.listImages(['a.png', 'b.png', 'c.png'].map((n) => ({ name: n, path: join(imgs, n), is_dir: false, size: 4, mtime_ms: Math.round(statSync(join(imgs, n)).mtimeMs) })));
  const size = maskSize(4 / 3), poly = [[0.1, 0.1], [0.4, 0.1], [0.4, 0.5], [0.1, 0.5]];
  const g = (name) => ({ name, who: 'c1', part: name.split('_')[1], poly, pinned: true, t_ms: 0, source: 'user', mask: encodeMask(rasterPoly(poly, size)) });
  for (const [i, nm] of [[0, 'c1_hips'], [1, 'c1_head']]) writeFileSync(join(v1l, keys[i].key + '.json'), JSON.stringify(L.makeLabel({ image: keys[i].path, key: keys[i].key, w: 640, h: 480, groups: [g(nm)], now: 1 })));
  writeFileSync(join(seed, 'datasets.json'), JSON.stringify({ version: 1, active: 'v2', datasets: [{ id: 'v1', name: 'v1', projects: true }, { id: 'v2', name: 'v2', projects: false }] }));
  const ws = new LabelWorkspace(mkReal());
  await ws.enter(imgs);
  assert.equal(D.pickerText(ws.ds.active, ws.counts.labelled), 'v2 · 0 labeled'); assert.equal(ws.counter, '0 labeled · 3 left');
  assert.deepEqual(ws.otherNames(ws.images[0]), ['v1'], 'labelled in v1, not here: the faint mark');
  assert.deepEqual(ws.otherNames(ws.images[2]), []);
  // 3. start from the v1 label: in the tool, never on disk until it is edited or accepted; never automatic
  assert.equal(ws.groups.length, 0, 'never automatic'); assert.equal(await ws.startFrom('v2'), false, 'only from a dataset that has the label');
  assert.ok(await ws.startFrom('v1'));
  assert.deepEqual(ws.groups.map((g2) => g2.name), ['c1_hips']); assert.ok(ws.pendingCopy && ws.copied === 'v1');
  await ws.flush();
  assert.equal(existsSync(join(seed, 'datasets', 'v2', 'labels')), false, 'a started-from label is not a v2 label yet');
  await ws.done();                     // Done keeps it as it is
  const v2l = join(seed, 'datasets', 'v2', 'labels');
  assert.equal(readdirSync(v2l).length, 1); const saved = JSON.parse(readFileSync(join(v2l, readdirSync(v2l)[0]), 'utf8'));
  assert.equal(saved.copied, 'v1', 'provenance is kept'); assert.deepEqual(saved.groups.map((x) => x.name), ['c1_hips']);
  assert.equal(readdirSync(v1l).length, 2, 'v1 is untouched');
  // 4. paint something new in v2 on image 3; v1 does not see it
  await ws.show(2);
  ws.G.pickPart('hips'); ws.G.begin(0.3, 0.3, false); ws.G.move(0.35, 0.3); ws.G.end();
  await ws.flush();
  assert.equal(readdirSync(v2l).length, 2); assert.equal(readdirSync(v1l).length, 2);
  // 5. switch to v1: its labels, counter and marks follow; the other dataset is the faint one now
  assert.ok(await ws.switchDataset('v1'));
  assert.equal(ws.ds.active.id, 'v1'); assert.equal(ws.counter, '2 labeled · 1 left'); assert.equal(D.pickerText(ws.ds.active, ws.counts.labelled), 'v1 · 2 labeled');
  assert.equal(ws.index, 2, 'the picture on screen stays'); assert.deepEqual(ws.groups, [], 'and shows v1\'s (no) label of it');
  assert.deepEqual(ws.otherNames(ws.images[2]), ['v2'], 'labelled in v2, not in v1');
  assert.equal(JSON.parse(readFileSync(join(seed, 'datasets.json'), 'utf8')).active, 'v1', 'the choice is stored');
  await ws.show(0); assert.deepEqual(ws.groups.map((x) => x.name), ['c1_hips']);
  // 6. a new dataset, named inline: empty, active, images only
  const id = await ws.createDataset('Duos test');
  assert.equal(id, 'duos-test'); assert.equal(ws.counter, '0 labeled · 3 left'); assert.equal(ws.ds.active.projects, false);
  assert.deepEqual(ws.otherNames(ws.images[0]).sort(), ['v1', 'v2'], 'the others are offered as starting points');
  assert.equal(readdirSync(join(seed, 'datasets')).includes('duos-test'), false, 'its folder appears with its first label');
  // 7. back to v2 and rename; nothing was removed anywhere
  assert.ok(await ws.switchDataset('v2')); assert.equal(ws.counter, '2 labeled · 1 left');
  await ws.ds.rename('v2', 'new technique'); assert.equal(D.pickerText(ws.ds.active, ws.counts.labelled), 'new technique · 2 labeled');
  await ws.ds.archive('duos-test', true); assert.deepEqual(D.listed(ws.ds.reg).map((d) => d.id), ['v1', 'v2']);
  assert.equal(readdirSync(v1l).length, 2); assert.equal(readdirSync(v2l).length, 2);
  await ws.leave();
});

test('a failed move: the registry is absent, a note beside the old files: the old files are a legacy v1 (the only dataset, no new one can be made), nothing is written', async () => {
  const seed = join(mkdtempSync(join(tmpdir(), 'ds-legacy-')), 'seeder'); mkdirSync(join(seed, 'labels'), { recursive: true });
  writeFileSync(join(seed, 'migration-error.txt'), 'head.pt is locked');
  const be = fsBackend();
  const store = D.createRegistryStore(be, seed), reg = await store.load();
  assert.equal(reg.error, 'head.pt is locked'); assert.equal(reg.datasets[0].legacy, true); assert.equal(D.labelsDirOf(seed, reg.datasets[0]), join(seed, 'labels'));
  assert.equal(existsSync(join(seed, 'datasets.json')), false, 'nothing written: the next start tries the move again');
  await store.save(reg); assert.equal(existsSync(join(seed, 'datasets.json')), false, 'a legacy registry is never saved');
});

test('v4.38: the namer learns from every dataset: namerScope and the seed_train request', () => {
  const list = [{ id: 'v1', labels: 'S\datasets\v1\labels', projects: true }, { id: 'v2', labels: 'S\datasets\v2\labels', projects: false }];
  assert.deepEqual(D.namerScope(list, { folders: ['W:\p'], projectPath: 'W:\p\a.pawproj' }), { labels: { v1: 'S\datasets\v1\labels', v2: 'S\datasets\v2\labels' }, folders: ['W:\p'], projects: ['W:\p\a.pawproj'] });
  assert.deepEqual(D.namerScope([list[1]], { folders: ['W:\p'] }), { labels: { v2: 'S\datasets\v2\labels' } }, 'no dataset learns from projects: none sent');
  const req = seedTrainRequest({ dir: 'S', namer: D.namerScope(list) });
  assert.deepEqual(Object.keys(req.namer.labels), ['v1', 'v2']);
  assert.ok(!('namer' in seedTrainRequest({ dir: 'S' })), 'old shape unchanged');
});

test('v4.38: the namer line: held out on the active dataset, what it learned from, the weakest part', async () => {
  const { namerLine, namerTip } = await import('../src/features/tracking/seed-score.js');
  const n = { blobs: 664, auto: 140, datasets: ['v1', 'v2'], missing: 0, score: { top1: 0.905, top3: 0.971, n: 664, images: 56, folds: 5, parts: [['neckbulge', 1, 0], ['sheath', 6, 0.333], ['head', 77, 0.987]], by_ds: { v2: { top1: 0.936, top3: 0.983, n: 407 } } } };
  assert.equal(namerLine(n, 'v2', 'v2'), 'namer: top-1 94 % · top-3 98 % on v2 held out · from 664 names in 2 datasets (140 auto-named) · weakest sheath 33 %');
  assert.match(namerLine(n, 'v9', 'new'), /^namer: top-1 91 % · top-3 97 % held out/, 'a dataset with no pictures scored yet: the score over all');
  assert.equal(namerLine(null, 'v2'), '');
  assert.equal(namerLine({ error: 'x' }, 'v2'), 'namer: training failed (see the log)');
  assert.match(namerTip(n), /neckbulge 0 % \(1\), sheath 33 % \(6\), head 99 % \(77\)/);
  assert.match(namerTip(n), /140 of the 664 names/);
});
