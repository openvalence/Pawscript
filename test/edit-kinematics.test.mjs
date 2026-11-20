import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capKinematics, limitsFor, OPS } from '../src/lib/edit/index.js';
import { strokeShortfalls } from '../src/lib/analyze/index.js';
import { isValid } from '../src/lib/core/script.js';
import { createCatalogue } from '../src/lib/graph/nodes/index.js';

const alt = (n, periodMs) => Array.from({ length: n }, (_, i) => ({ at: i * periodMs, pos: i % 2 ? 100 : 0 }));
const all = (s) => ({ ats: s.map((a) => a.at) });
const limits = limitsFor('nucleus-capstan', 200);

test('limitsFor: kinematic profile in pos units at the stroke window; speed-only fallback', () => {
  assert.equal(limits.v, 600);
  assert.equal(limitsFor('nucleus-capstan', 100).v, 1200);
  const g = limitsFor('generic');
  assert.equal(g.v, 250); assert.ok(g.a > 1e8 && g.j > 1e17);
});

test('retime whole script: 2000 actions at 1000 pos/s -> no shortfalls; 300 pos/s already fits and is untouched', () => {
  const fast = alt(2000, 100);
  assert.ok(strokeShortfalls(fast, limits).length > 0, 'the fixture is over the limit');
  const r = capKinematics(fast, all(fast), { profile: 'nucleus-capstan', strokeMm: 200, method: 'retime' });
  assert.ok(isValid(r.script));
  assert.equal(strokeShortfalls(r.script, limits).length, 0);
  assert.ok(r.script.every((a, i) => a.pos === fast[i].pos), 'positions kept');
  const ok = alt(2000, 333);
  assert.equal(strokeShortfalls(ok, limits).length, 0);
  assert.deepEqual(capKinematics(ok, all(ok), { method: 'retime' }).script, ok);
  assert.deepEqual(capKinematics(ok, all(ok), { method: 'pull' }).script, ok);
});

test('pull whole script: every remaining shortfall is <= 1 unit; times kept; integer pos', () => {
  const fast = alt(2000, 100);
  const r = capKinematics(fast, all(fast), { profile: 'nucleus-capstan', strokeMm: 200, method: 'pull' });
  assert.ok(isValid(r.script));
  assert.ok(r.script.every((a, i) => a.at === fast[i].at && Number.isInteger(a.pos)));
  const sf = strokeShortfalls(r.script, limits);
  assert.ok(sf.every((x) => x.shortfallUnits <= 1), 'worst ' + Math.max(0, ...sf.map((x) => x.shortfallUnits)));
  assert.ok(r.script[1].pos < 100 && r.script[1].pos > 0, 'pulled: ' + r.script[1].pos);
});

test('a hold stays a hold; unselected actions are untouched; no mutation', () => {
  const s = [{ at: 0, pos: 0 }, { at: 50, pos: 100 }, { at: 100, pos: 100 }, { at: 150, pos: 100 }, { at: 200, pos: 0 }];
  const copy = JSON.parse(JSON.stringify(s));
  const r = capKinematics(s, all(s), { method: 'pull' });
  assert.deepEqual(s, copy);
  assert.ok(r.script[1].pos < 100);
  assert.equal(r.script[2].pos, r.script[1].pos); assert.equal(r.script[3].pos, r.script[1].pos);
  const part = capKinematics(s, { ats: [50] }, { method: 'pull' });
  assert.ok(part.script[1].pos < 100);
  assert.equal(part.script[2], s[2]); assert.equal(part.script[3], s[3]); assert.equal(part.script[4], s[4]);
  assert.deepEqual(capKinematics(s, { ats: [] }, {}).script, s);
});

test('registered in OPS (group speed) and as a graph node edit.capKinematics', () => {
  const o = OPS.find((x) => x.id === 'capKinematics');
  assert.equal(o.group, 'speed');
  assert.ok(o.params.find((p) => p.key === 'profile').choices.includes('nucleus-capstan'));
  const fast = alt(20, 100);
  const r = o.apply(fast, all(fast), { method: 'retime' });
  assert.equal(strokeShortfalls(r.script, limits).length, 0);
  assert.ok(createCatalogue().has('edit.capKinematics'));
});
