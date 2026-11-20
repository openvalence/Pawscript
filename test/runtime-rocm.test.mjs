// paw-vdb3.2: the AMD runtime's manifest entry (runtime-rocm.zip: python-rocm\ beside python\, src-tauri/src/portable.rs
// ZIPS) is pinned like the CUDA one and stays unpublished until the owner uploads it; its pins live in the repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const shipped = JSON.parse(read('src/features/models/manifest.json'));

test('runtime-rocm: pinned by size and SHA-256, under runtime/ with its hash in the name, for AMD', () => {
  const rocm = shipped.models.find((x) => x.id === 'runtime-rocm');
  assert.equal(rocm.kind, 'runtime');
  assert.equal(rocm.gpu, 'amd');
  assert.equal(typeof rocm.hosted, 'boolean');
  assert.match(rocm.version, /^runtime-rocm \d{4}-\d\d-\d\d python3\.12\.\d+ torch[\d.]+\+rocm[\d.]+ ffmpeg[\d.]+$/);
  for (const a of ['gfx1201', 'gfx1200', 'gfx1100', 'gfx1101', 'gfx1102']) assert.ok(rocm.archs.includes(a), a);
  assert.equal(rocm.files.length, 1);
  const [f] = rocm.files;
  assert.equal(f.path, 'runtime-rocm.zip');
  assert.ok(Number.isSafeInteger(f.bytes) && f.bytes > 1e9 && /^[0-9a-f]{64}$/.test(f.sha256));
  assert.equal(f.url, `runtime/runtime-rocm-${rocm.version.split(' ')[1]}-${f.sha256.slice(0, 8)}.zip`);
});

test('runtime-rocm: built from the pinned requirements, the CUDA runtime untouched', () => {
  const rocm = shipped.models.find((x) => x.id === 'runtime-rocm');
  const torch = read('trackers/requirements-rocm.txt').match(/^torch==(\S+)/m)[1];
  assert.ok(rocm.version.split(' ').includes(`torch${torch}`), `${rocm.version} vs torch==${torch}`);
  assert.match(shipped.models.find((x) => x.id === 'runtime').version, /torch2\.12\.1\+cu130/);
});
