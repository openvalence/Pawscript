// references.js (paw-qynw): the owner's reference stretches -- strike / unstrike, the record, reading it back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strike, unstrike, keptOf, referenceRecord, referenceClean, referenceName } from '../src/lib/references.js';

test('strike merges overlapping and touching regions, clipped to the stretch; a click removes one', () => {
  let s = strike([], 100, 200, 0, 1000);
  s = strike(s, 400, 300, 0, 1000);   // drawn backwards
  s = strike(s, 180, 320, 0, 1000);   // joins both
  assert.deepEqual(s, [[100, 400]]);
  s = strike(s, 900, 1200, 0, 1000);
  assert.deepEqual(s, [[100, 400], [900, 1000]]);
  assert.deepEqual(strike(s, 50, 50), s, 'an empty drag strikes nothing');
  assert.deepEqual(unstrike(s, 950), [[100, 400]]);
  assert.equal(keptOf(0, 1000, s), 1000 - 300 - 100);
});

test('a record describes itself and reads back; junk does not', () => {
  const run = { id: 'run7', tracker: { id: 'tapnext_points' }, range: { start: 0, end: 20000 }, scenes: [{ start_ms: 0, end_ms: 9000 }, { start_ms: 9000, end_ms: 20000 }],
    channels: { sem_c1_hips_x: {}, sem_c1_hips_y: {}, sem_c2_hips_x: {}, sem_c2_hips_y: {}, fused: {}, proj_cam: {} } };
  const r = referenceRecord({ project: 'W:\p\a.pawproj', runsFile: 'W:\p\a.pawruns', mediaHash: 'abc123', run, t0: 1000.4, t1: 8000, struck: [[2000, 2500.6]], points: [[500, 10], [1500, 90], [3000, 5], [9000, 50]], tags: ['oral', 'penetration'], shots: [{ t0: 0, t1: 9000, tags: ['oral'] }], savedAt: 'x' });
  assert.equal(r.kind, 'pawscript-reference');
  assert.deepEqual([r.t0, r.t1, r.struck], [1000, 8000, [[2000, 2501]]]);
  assert.deepEqual(r.points, [[1500, 90], [3000, 5]], 'only the script inside the stretch');
  assert.deepEqual(r.groups, ['c1_hips', 'c2_hips']);
  assert.ok(r.channels.includes('fused') && r.tracker === 'tapnext_points' && r.scenes.length === 1);
  const back = referenceClean(JSON.parse(JSON.stringify(r)));
  assert.deepEqual([back.run, back.t0, back.t1, back.struck, back.points], ['run7', 1000, 8000, [[2000, 2501]], [[1500, 90], [3000, 5]]]);
  assert.equal(referenceClean({ kind: 'pawscript-reference', run: 'r', t0: 5, t1: 5 }), null);
  assert.equal(referenceClean({ run: 'r', t0: 0, t1: 5 }), null);
  assert.equal(referenceName(r), 'abc123_run7_1000-8000.json');
});
