// The owner's own toys (src/features/machine/owner.js): the loader with and without the local data folder, and every
// owner toy at every size when the folder is there (it is local only: skipped in a checkout without it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { ownerList, ownerEntries, ownerToy, ownerThumb } from '../src/features/machine/owner.js';
import { knotOf, radiusAt } from '../src/features/machine/toys.js';
import { makeContext } from '../src/features/machine/physics.js';
import { toyBend } from '../src/features/machine/centreline.js';

const DIR = new URL('../src/features/machine/toys/owner/', import.meta.url);
const sample = { toys: [
  { id: 'own-a', name: 'A', firmness: '3', sizes: [{ value: 'S', label: 'S', length_mm: 200, usable_mm: 180, profile: [[0, 8], [100, 15], [150, 25], [170, 14], [200, 30]], knot: { from_mm: 120, to_mm: 170 } },
    { value: 'L', label: 'L', length_mm: 300, usable_mm: 280, profile: [[0, 10], [300, 30]], knot: null }] },
  { id: 'own-b', name: 'B', sizes: [{ length_mm: 150, profile: [[0, 5], [150, 20]], outline: [[0, -6, 6], [150, -25, 25]], centre: [[0, 0], [0, 200], [0, 0]] }] },
  { id: 'own-a', name: 'duplicate', sizes: [{ length_mm: 100, profile: [[0, 1], [100, 2]] }] },
  { name: 'no id', sizes: [{ length_mm: 100, profile: [[0, 1], [100, 2]] }] },
  { id: 'no-sizes', sizes: [{ length_mm: 5, profile: [] }] },
] };

test('owner toys: no folder, no files or junk -> none (a checkout without the data builds the same)', () => {
  assert.deepEqual(ownerList({}), []);
  assert.deepEqual(ownerList(undefined), []);
  assert.deepEqual(ownerList({ 'x.json': null, 'y.json': { toys: 'no' } }), []);
  assert.deepEqual(ownerEntries([]), []);
  assert.equal(ownerToy([], 'own-a', 'S'), null);
});

test('owner toys: entries, sizes, the toy at a size (unknown size: the middle one), thumbnails from the profile', () => {
  const list = ownerList({ 'f.json': sample });
  assert.deepEqual(list.map((t) => t.id), ['own-a', 'own-b']);
  const e = ownerEntries(list);
  assert.equal(e[0].kind, 'owner');
  assert.deepEqual(e[0].sizes, [{ value: 'S', label: 'S' }, { value: 'L', label: 'L' }]);
  assert.deepEqual(e[1].sizes, [], 'one size: no size chips');
  assert.ok(e[0].thumb.startsWith('data:image/svg+xml,') && decodeURIComponent(e[0].thumb).includes('<path'));
  const s = ownerToy(list, 'own-a', 'S');
  assert.equal(s.id, 'own-a:S'); assert.equal(s.usable_mm, 180); assert.deepEqual(s.firmness, ['3']);
  assert.ok(Math.abs(knotOf(s).peak_mm - 150) <= 1, 'the marked knot is the knot');
  assert.equal(knotOf(ownerToy(list, 'own-a', 'L')), null, 'no knot: none detected either');
  assert.equal(ownerToy(list, 'own-a', 'XL').id, 'own-a:S', 'unknown size: the middle one');
  const b = ownerToy(list, 'own-b');
  assert.equal(b.usable_mm, 150); assert.equal(b.outline.length, 2); assert.ok(toyBend(b, 0), 'a rest curve');
  assert.ok(ownerThumb(list[1].sizes[0]).length > 100);
});

const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json')) : [];
test('owner toys: every toy in the local folder builds at every size', { skip: files.length ? false : 'no local owner folder' }, () => {
  const list = ownerList(Object.fromEntries(files.map((f) => [f, JSON.parse(readFileSync(new URL(f, DIR), 'utf8'))])));
  assert.ok(list.length >= 1);
  for (const t of list) for (const z of t.sizes) {
    const toy = ownerToy(list, t.id, z.value), id = toy.id;
    assert.ok(toy.length_mm > 50 && toy.length_mm < 600, `${id} ${toy.length_mm}`);
    assert.ok(toy.usable_mm > 0.5 * toy.length_mm && toy.usable_mm <= toy.length_mm, `${id} usable ${toy.usable_mm}`);
    assert.ok(toy.profile.every(([, r]) => r > 0.5 && r < 80), `${id} radius`);
    assert.ok(toy.profile[0][0] === 0 && Math.abs(toy.profile.at(-1)[0] - toy.length_mm) < 0.5, `${id} spans its length`);
    if (z.knot) { const k = knotOf(toy); assert.ok(k && k.peak_mm <= toy.usable_mm, `${id} knot inside the usable length`); }
    else assert.equal(knotOf(toy), null, `${id} no stray knot`);
    assert.ok(radiusAt(toy, toy.usable_mm / 2) > 5, id);
    assert.ok(makeContext(toy, { offsetMm: -15, strokeMm: toy.usable_mm + 15 }).len > 0, `${id} simulates`);
  }
});
