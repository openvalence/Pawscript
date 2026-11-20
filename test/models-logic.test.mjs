// paw-cdot: the downloader's model (src/features/models/logic.js): the manifest check, path safety, the state of every
// row (installed / missing / damaged / update), the runtime decision, file matching for an import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseManifest, safePath, rows, modelState, rowState, toFetch, runtimeNeeded, modelsReady, matchFile, otherVersion, baseUrl,
  MODELS_BASE_URL, fmtBytes, isRuntime, chooseRuntime, isHosted, rateMeter, fmtSpeed,
} from '../src/features/models/logic.js';

const shipped = JSON.parse(readFileSync(new URL('../src/features/models/manifest.json', import.meta.url), 'utf8'));
const h = (c) => c.repeat(64);
const model = (id, files, extra = {}) => ({ id, title: id, required: false, files: files.map(([path, bytes, sha]) => ({ path, bytes, sha256: sha, url: path.replace(/^\.cache\//, '') })), ...extra });
const man = (models) => ({ kind: 'pawscript.models/1', version: 1, models });

test('the shipped manifest: valid, the runtime pinned, taggerine manual, no CoTracker', () => {
  const m = parseManifest(shipped);
  const ids = m.models.map((x) => x.id);
  for (const id of ['sam2.1-tiny', 'sam2.1-small', 'sam2.1-base_plus', 'sam2.1-large', 'tapnext-256', 'tapnext-512', 'hydra-3.5', 'taggerine', 'runtime']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.some((id) => /cotracker/i.test(id)), 'CoTracker3 is never in the manifest');
  const rt = m.models.find(isRuntime);
  assert.match(rt.version, /^runtime \d{4}-\d\d-\d\d /);
  assert.equal(rt.files[0].path, 'runtime.zip');
  const tag = m.models.find((x) => x.id === 'taggerine');
  assert.equal(tag.source, 'manual');
  assert.ok(tag.downloadPage.startsWith('https://huggingface.co/lodestones/taggerine'));
  assert.ok(tag.files.every((f) => !f.url && /^[0-9a-f]{64}$/.test(f.sha256)), 'pinned, never uploaded');
  assert.deepEqual(tag.files.map((f) => f.path.split('/').pop()), ['tagger_proto.safetensors', 'tagger_vocab.json']);
  for (const x of m.models) assert.ok(x.licenceUrl?.startsWith('https://'), `${x.id} links its licence`);
  assert.deepEqual(m.models.filter((x) => x.required && !isRuntime(x)).map((x) => x.id), ['sam2.1-tiny', 'sam2.1-small', 'tapnext-256']);
});

test('paths that leave the models folder, and broken manifests, are refused', () => {
  assert.ok(safePath('.cache/sam2/sam2.1_hiera_tiny.pt') && safePath('runtime.zip'));
  for (const bad of ['../x', '.cache/../../x', '/etc/x', 'C:/x', 'a\\..\\b', '', 'a//b', 'con/x', 'x.', 'a/./b']) assert.equal(safePath(bad), false, bad);
  assert.throws(() => parseManifest({ kind: 'other', models: [] }), /not a Pawscript/);
  assert.throws(() => parseManifest(man([model('a', [['../a.pt', 1, h('a')]])])), /unsafe path/);
  assert.throws(() => parseManifest(man([model('a', [['a.pt', 1, 'nothex']])])), /SHA-256/);
  assert.throws(() => parseManifest(man([model('a', [['a.pt', 1, h('a')]]), model('a', [['b.pt', 1, h('b')]])])), /id twice/);
  assert.throws(() => parseManifest(man([{ ...model('m', [['m.bin', 5]]), source: 'manual' }])), /download page/);
  assert.throws(() => parseManifest(man([{ ...model('a', [['a.pt', 1, h('a')]]), licenceUrl: 'http://x' }])), /licenceUrl/);
});

test('states: missing, installed, damaged by size or by hash, partly there', () => {
  const m = model('sam', [['.cache/sam2/a.pt', 100, h('a')], ['.cache/sam2/b.pt', 50, h('b')]]);
  assert.equal(modelState(m, {}), 'missing');
  const both = { '.cache/sam2/a.pt': { exists: true, bytes: 100 }, '.cache/sam2/b.pt': { exists: true, bytes: 50 } };
  assert.equal(modelState(m, both), 'installed');
  assert.equal(modelState(m, { ...both, '.cache/sam2/b.pt': { exists: true, bytes: 49 } }), 'damaged');
  assert.equal(modelState(m, both, { '.cache/sam2/a.pt': h('f') }), 'damaged', 'Verify found another hash');
  assert.equal(modelState(m, both, { '.cache/sam2/a.pt': h('a') }), 'installed');
  assert.equal(modelState(m, { '.cache/sam2/a.pt': { exists: true, bytes: 100 } }), 'missing', 'one file of two');
  // what is left to fetch: the missing file, less what its .part holds
  const half = { '.cache/sam2/a.pt': { exists: true, bytes: 100 }, '.cache/sam2/b.pt': { exists: false, part: 20 } };
  assert.deepEqual(toFetch(m, half).files.map((f) => f.path), ['.cache/sam2/b.pt']);
  assert.equal(toFetch(m, half).bytes, 30);
});

test('a manual model in another version is installed, and said so', () => {
  const tag = { ...model('tag', [['.cache/taggerine/v.json', 10, h('c')]]), source: 'manual', downloadPage: 'https://x.example' };
  const facts = { '.cache/taggerine/v.json': { exists: true, bytes: 12 } };
  assert.equal(modelState(tag, facts), 'installed');
  assert.equal(modelState(tag, facts, { '.cache/taggerine/v.json': h('d') }), 'installed');
  assert.ok(otherVersion(tag, { '.cache/taggerine/v.json': h('d') }));
  assert.ok(!otherVersion(tag, { '.cache/taggerine/v.json': h('c') }));
});

test('a fetched manifest: changed files are an update, new models join, the runtime stays the compiled one', () => {
  const rt = { ...model('runtime', [['runtime.zip', 9, h('9')]]), kind: 'runtime', version: 'runtime A', required: true };
  const old = man([model('sam', [['.cache/sam2/a.pt', 100, h('a')]], { required: true }), rt]);
  const fetched = man([model('sam', [['.cache/sam2/a2.pt', 120, h('2')]], { required: true }), model('new', [['.cache/n.pt', 5, h('5')]]),
    { ...rt, version: 'runtime B', files: [{ path: 'runtime.zip', bytes: 1, sha256: h('e'), url: 'r' }] }]);
  const list = rows(old, fetched);
  assert.deepEqual(list.map((r) => r.model.id), ['sam', 'runtime', 'new']);
  assert.equal(list.find((r) => r.model.id === 'runtime').model.version, 'runtime A', 'never from the server');
  const facts = { '.cache/sam2/a.pt': { exists: true, bytes: 100 } };
  const sam = list[0];
  assert.equal(rowState(sam, facts), 'update');
  assert.ok(modelsReady(list, facts), 'an update is still usable');
  assert.equal(rowState(sam, { ...facts, '.cache/sam2/a2.pt': { exists: true, bytes: 120 } }), 'installed');
  assert.equal(rowState(sam, {}), 'missing');
  assert.ok(!modelsReady(list, {}));
  assert.deepEqual(rows(old, null).map((r) => r.old), [undefined, undefined]);
});

const RT = (id, o = {}) => ({ id, installed: null, python: false, zip: false, ...o });
const OLD = 'runtime 2026-11-18 python3.12.12';

test('the runtime: downloaded only for the shared build, when none or another version is unpacked and no zip waits', () => {
  const entry = { id: 'runtime', version: OLD };
  assert.equal(runtimeNeeded({ portable: false, runtimes: [RT('runtime')] }, entry), false, 'a dev build');
  assert.equal(runtimeNeeded({ portable: true, runtimes: [RT('runtime')] }, entry), true, 'a clean first start');
  assert.equal(runtimeNeeded({ portable: true, runtimes: [RT('runtime', { zip: true })] }, entry), false, 'runtime.zip (or parts) beside the exe: the setup unpacks it');
  assert.equal(runtimeNeeded({ portable: true, runtimes: [RT('runtime', { python: true, installed: OLD + '\r\n' })] }, entry), false, 'the same version');
  assert.equal(runtimeNeeded({ portable: true, runtimes: [RT('runtime', { python: true, installed: 'runtime 2026-11-17 python3.12.12' })] }, entry), true, 'an update that needs a new runtime');
  assert.equal(runtimeNeeded({ portable: true, runtimes: [RT('runtime', { python: true, installed: OLD })] }, { id: 'runtime-rocm', version: 'x' }), false, 'a shell that does not know this runtime');
});

test('the shipped manifest holds the AMD runtime, published (uploaded 2026-11-19)', () => {
  const m = parseManifest(shipped);
  const rocm = m.models.find((x) => x.id === 'runtime-rocm');
  assert.ok(isRuntime(rocm) && isHosted(rocm) && rocm.files[0].path === 'runtime-rocm.zip');
  assert.equal(rows(m).filter((r) => isRuntime(r.model)).length, 2, 'the compiled manifest pins both');
});

test('the runtime for this PC: the GPU found picks it, the setting overrides, an unpublished one falls back', () => {
  const entries = [{ id: 'runtime' }, { id: 'runtime-rocm' }];
  const nv = { runtime: 'runtime', name: 'NVIDIA GeForce RTX 4090' }, amd = { runtime: 'runtime-rocm', name: 'AMD Radeon RX 9070 XT' };
  const rt = { portable: true, runtimes: [RT('runtime'), RT('runtime-rocm')] };
  let c = chooseRuntime({ probe: nv, rt, entries });
  assert.deepEqual([c.id, c.why, c.note, c.other], ['runtime', 'NVIDIA GeForce RTX 4090 found', '', 'runtime-rocm']);
  c = chooseRuntime({ probe: amd, rt, entries });
  assert.deepEqual([c.id, c.why, c.other], ['runtime-rocm', 'AMD Radeon RX 9070 XT found', 'runtime']);
  const unpublished = [{ id: 'runtime' }, { id: 'runtime-rocm', hosted: false }];
  c = chooseRuntime({ probe: amd, rt, entries: unpublished });
  assert.deepEqual([c.id, c.auto, c.why, c.note], ['runtime', 'runtime', 'AMD Radeon RX 9070 XT found', 'AMD (ROCm) runtime not published yet']);
  const there = { portable: true, runtimes: [RT('runtime'), RT('runtime-rocm', { python: true })] };
  assert.equal(chooseRuntime({ probe: amd, rt: there, entries: unpublished }).id, 'runtime-rocm', 'unpublished but unpacked: used');
  c = chooseRuntime({ setting: 'runtime', probe: amd, rt, entries });
  assert.deepEqual([c.id, c.why, c.note, c.auto], ['runtime', 'Your choice', 'AMD Radeon RX 9070 XT found', 'runtime-rocm']);
  assert.equal(chooseRuntime({ setting: 'bogus', probe: nv, rt, entries }).id, 'runtime', 'a setting that is no runtime is auto');
  c = chooseRuntime({ probe: { runtime: 'runtime', name: null }, rt, entries });
  assert.deepEqual([c.id, c.why, c.note], ['runtime', 'No discrete GPU found', 'Trackers run on the CPU']);
  assert.equal(chooseRuntime({ rt, entries }).id, 'runtime', 'no probe (a shell without it)');
});

test('a brought file is matched by its name, within a row or anywhere', () => {
  const list = rows(parseManifest(shipped));
  assert.equal(matchFile(list, 'D:\\Files\\tagger_vocab.json')?.model.id, 'taggerine');
  assert.equal(matchFile(list, 'C:/x/SAM2.1_HIERA_TINY.PT')?.model.id, 'sam2.1-tiny');
  assert.equal(matchFile(list, 'C:/x/sam2.1_hiera_tiny.pt', 'taggerine'), null, 'not this row\'s file');
  assert.equal(matchFile(list, 'C:/x/runtime.zip'), null, 'the runtime is never brought in this way');
  assert.equal(matchFile(list, 'C:/x/holiday.mp4'), null);
});

test('the models server: env var, then the setting, then the default', () => {
  assert.equal(baseUrl({}), MODELS_BASE_URL);
  assert.equal(MODELS_BASE_URL, 'https://dl.openvalence.org/pawscript/v1/');
  assert.equal(baseUrl({ setting: 'https://mirror.example/m/' }), 'https://mirror.example/m/');
  assert.equal(baseUrl({ env: 'http://127.0.0.1:9/m/', setting: 'https://mirror.example/m/' }), 'http://127.0.0.1:9/m/');
  assert.equal(fmtBytes(2_532_282_370), '2.5 GB');
  assert.equal(fmtBytes(156_008_466), '156 MB');
  assert.equal(fmtBytes(258), '1 KB');
  assert.equal(fmtBytes(0), '0 KB', 'nothing is not "1 KB" (the Models foot, a download that has not started)');
});

test('download speed: smoothed, time left hidden until it settles, one written form', () => {
  const m = rateMeter();
  assert.deepEqual(m(5e6, 1e9, 0), { rate: 0, left: null }, 'one sample: no speed (a resumed .part does not count as speed)');
  assert.equal(m(55e6, 1e9, 1000).rate, 50e6, 'the first interval seeds it');
  let r;
  for (let t = 1150; t <= 2000; t += 150) r = m(55e6 + (t - 1000) * 1e5, 1e9, t);   // a burst at 100 MB/s
  assert.ok(r.rate > 50e6 && r.rate < 70e6, `a burst moves it a little, not all the way (${r.rate})`);
  assert.equal(m(140e6, 1e9, 1999).left, null, 'a sample from the past changes nothing and stays unsettled');
  const s = m(140e6, 1e9, 2150);
  assert.ok(s.left > 0 && Math.abs(s.left - ((1e9 - 140e6) * 1000) / s.rate) < 1e-6, 'settled after 2 s: time left from the smoothed speed');
  assert.equal(fmtSpeed({ rate: 48.24e6, left: 72_000 }), '48.2 MB/s · 1:12 left');
  assert.equal(fmtSpeed({ rate: 48.24e6, left: null }), '48.2 MB/s');
  assert.equal(fmtSpeed({ rate: 640e3, left: 400 }), '640 KB/s · 1.0 s left');
  assert.equal(fmtSpeed({ rate: 0, left: null }), '');
  assert.equal(fmtSpeed(), '');
});
