// Fails if the vendored planner drifts from the recorded pin (mirrors Phosphor's test/kinetic-pin.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WASM } from '../src/lib/analyze/kinetic/bytes.js';

const dir = fileURLToPath(new URL('../src/lib/analyze/kinetic/', import.meta.url));
const pin = Object.fromEntries(readFileSync(dir + 'kinetic.pin', 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf(' ')), l.slice(l.indexOf(' ') + 1)]));

test('vendored kinetic bytes.js matches the recorded hash', () => {
  const want = readFileSync(dir + 'bytes.sha256', 'utf8').trim();
  assert.equal(createHash('sha256').update(readFileSync(dir + 'bytes.js')).digest('hex'), want, 'bytes.js changed: refresh via PROVENANCE.md');
  assert.ok(readFileSync(dir + 'PROVENANCE.md', 'utf8').includes(want), 'PROVENANCE.md records the hash');
});

test('vendored wasm is the pinned build', async () => {
  const bytes = Uint8Array.from(atob(WASM), (c) => c.charCodeAt(0));
  assert.equal(bytes.length, Number(pin.bytes));
  const k = (await WebAssembly.instantiate(bytes, {})).instance.exports;
  k._initialize();
  const m = new Uint8Array(k.memory.buffer), p = k.kinetic_version();
  let e = p;
  while (m[e]) e++;
  const v = new TextDecoder().decode(m.subarray(p, e));
  assert.equal(v, pin.version); assert.ok(/ kinetic2 /.test(v) && !/dirty/.test(v));
  assert.ok(pin.nucleus.startsWith(v.split(' ')[1]));
});
