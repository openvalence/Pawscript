// The part vocabulary is one list on two sides (paw-714j): the app's groups.js PARTS / PAIRED and the sidecar's seeder.PARTS /
// partlabel.PAIRED. This fails when they drift (a part the app can paint that the seeder cannot learn, or the reverse).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PARTS, PAIRED, WHOS, WHO_NAME, ON_PART, sitsOn, mayOverlap, splitName, groupName, partLabel, partWord } from '../src/features/tracking/groups.js';
import { groupColor } from '../src/features/tracking/colors.js';

const py = (f) => readFileSync(new URL('../trackers/pawtrack/' + f, import.meta.url), 'utf8');
/** The quoted words of `NAME = [...]` / `NAME = (...)` in a python file (comments after a # are ignored). */
function list(src, name) {
  const all = src.split(/\r?\n/), at = all.findIndex((l) => l.startsWith(name + ' = '));
  assert.ok(at >= 0, name + ' not found');
  let text = '';
  for (const l of all.slice(at)) { const code = l.split('#')[0]; text += code; if (/[\])]\s*$/.test(code)) break; }
  return [...text.matchAll(/"([a-z0-9]+)"/g)].map((x) => x[1]);
}
// parts the seeder head does not learn (no class): the app paints them, the tracker pins them
const NOT_LEARNED = ['slit', 'anus', 'body', 'other'];
const NEW = ['knot', 'thighs', 'tongue', 'stomachbulge', 'neckbulge', 'shoulder', 'forearm', 'shin'];
const LIMBS = ['shoulder', 'forearm', 'shin'];   // paw-5r1

test('the app and the sidecar name the same parts', () => {
  const seeder = list(py('seeder.py'), 'PARTS');
  assert.deepEqual([...seeder].sort(), PARTS.filter((p) => !NOT_LEARNED.includes(p)).sort(), 'seeder.PARTS = groups.js PARTS minus the unlearned ones');
  assert.deepEqual(list(py('partlabel.py'), 'PAIRED'), PAIRED, 'paired parts (L / R) agree');
  for (const f of ['autoname.py', 'bodies.py']) assert.deepEqual(list(py(f), 'PAIRED'), PAIRED, f + ' PAIRED = partlabel.PAIRED');
  assert.ok(PAIRED.includes('thighs') && LIMBS.every((p) => PAIRED.includes(p)), 'the limb segments have sides');
  assert.deepEqual(seeder.slice(-LIMBS.length), LIMBS, 'new seeder classes go at the end (an older head keeps its indices by name anyway)');
  assert.deepEqual(NEW.filter((p) => !PARTS.includes(p)), []);
  for (const p of PARTS) assert.match(p, /^[a-z0-9]+$/, `${p}: no underscore (a group name is who_part_side)`);
  const cam = py('partlabel.py');
  for (const p of ['knot', 'tongue', 'stomachbulge', 'neckbulge']) assert.ok(new RegExp(`"${p}": "${p}"`).test(cam), `${p} has a tagger CAM label`);
  assert.ok(!/"thighs": "/.test(cam), 'thighs has no tagger tag of its own: seeder only');
  for (const p of LIMBS) assert.ok(!new RegExp(`"${p}": "`).test(cam), `${p}: seeder only (no tagger CAM label)`);
});

test('the characters (who ids) are the same list on both sides (paw-uzzr)', () => {
  assert.deepEqual(list(py('partlabel.py'), 'WHOS'), WHOS, 'partlabel.WHOS = groups.js WHOS');
  const pulse = py('pulse.py').match(/^WHO_NAME = \{([^}]*)\}/m)[1];
  assert.deepEqual([...pulse.matchAll(/"([a-z0-9]+)": "([A-Za-z]+)"/g)].map((m) => [m[1], m[2]]), Object.entries(WHO_NAME), 'the sidecar reads ids as the app does');
  // both sidecar name readers take exactly these ids: x_paws_l can never be a part or a side
  const alt = WHOS.map((w) => (w.length > 1 ? w.replace('1', '[12]') : w)).filter((w, i, a) => a.indexOf(w) === i);
  for (const f of ['seeder.py', 'partlabel.py']) assert.ok(py(f).includes('^(c[12]|x)_'), f + ' splits who with (c[12]|x)');
  assert.ok(alt.length >= 2);
  for (const who of WHOS) for (const n of [`${who}_penis`, `${who}_paws_l`, `${who}_penis2`]) assert.equal(splitName(n).who, who, n);
});

test('new parts: names round-trip, read as words, and have colours of their own', () => {
  for (const p of NEW) for (const who of ['c1', 'c2', 'x']) {
    const side = PAIRED.includes(p) ? 'r' : null, name = groupName({ who, part: p, side });
    assert.deepEqual(splitName(name), { who, part: p, side }, name);
    assert.deepEqual(splitName(name + '2'), { who, part: p, side }, 'a repeat keeps its part');
  }
  assert.equal(partLabel('c1_stomachbulge'), 'Bottom stomach bulge'); assert.equal(partLabel('c2_thighs_l'), 'Top L thighs'); assert.equal(partWord('knot'), 'knot');
  assert.equal(partLabel('c2_forearm_l'), 'Top L forearm'); assert.equal(partLabel('c1_shin_r2'), 'Bottom R shin 2'); assert.equal(partLabel('x_shoulder_l'), 'Extra L shoulder');
  assert.deepEqual(splitName('c2_forearm_l'), { who: 'c2', part: 'forearm', side: 'l' });
  for (const p of LIMBS) assert.notEqual(groupColor(`c1_${p}_l`), groupColor(`c1_${p}_r`), `${p}: L and R differ`);
  const cols = PARTS.map((p) => groupColor('c1_' + p));
  assert.equal(new Set(cols).size, cols.length, 'every part of a character has its own colour');
  for (const p of NEW) assert.notEqual(groupColor('c1_' + p), groupColor('c2_' + p), 'the two characters differ');
});

test('the parent -> child table (parts that live on another part) is the same on both sides', () => {
  const src = py('partlabel.py'), at = src.indexOf('ON_PART = {'), body = src.slice(at, src.indexOf('\n}', at)), table = {};
  for (const m of body.matchAll(/"([a-z0-9]+)": \(([^)]*)\)/g)) table[m[1]] = [...m[2].matchAll(/"([a-z0-9]+)"/g)].map((x) => x[1]);
  assert.deepEqual(table, ON_PART, 'groups.js ON_PART = partlabel.ON_PART');
  for (const [c, ps] of Object.entries(ON_PART)) { assert.ok(PARTS.includes(c), c); for (const p of ps) assert.ok(PARTS.includes(p), p); assert.ok(!ps.includes(c)); }
  assert.ok(sitsOn('c1_knot', 'c1_penis') && !sitsOn('c1_knot', 'c2_penis') && !sitsOn('c1_penis', 'c1_knot') && mayOverlap('c1_penis', 'c1_knot'));
  assert.ok(!mayOverlap('c1_hips', 'c2_hips') && !mayOverlap('c1_penis', 'c1_paws_l'));
  // paw-5r1: the limb chain joints may overlap (a forearm painted against the hand / upper arm), across characters never
  assert.ok(mayOverlap('c1_forearm_l', 'c1_hand_l') && mayOverlap('c1_shoulder_r', 'c1_forearm_r') && mayOverlap('c1_shin_l', 'c1_paws_l') && mayOverlap('c2_thighs_l', 'c2_shin_l'));
  assert.ok(!mayOverlap('c1_forearm_l', 'c2_hand_l') && !mayOverlap('c1_shin_l', 'c1_hand_l'));
});
