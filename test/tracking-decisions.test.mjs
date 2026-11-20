import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decisionsOf, candidateRows, candidateText, decisionLines, primaryHow } from '../src/lib/runs-channel.js';

// a sidecar `primary` note (PROTOCOL v3.2), from trackers/pawtrack/trackers/cotracker_points.py primary_record (synthetic scene)
const NOTE = {
  code: 'primary', message: 'points primary auto -> proj (clicks 0, axis auto)', scene_index: 1,
  data: {
    chosen: 'proj', rule: 'auto: box → proj',
    candidates: {
      proj_cam: { std: 0.00889, travel: 0.0246, valid: 1, cam_conf: 0.75 },
      proj: { std: 0.0418, travel: 0.129, valid: 1 },
      g1_proj: { std: 0.0354, travel: 0.0977, valid: 1, share: 0.25 },
      centroid_y: { std: 0.0418, travel: 0.129, valid: 0.5 },
    },
    axis: { mode: 'auto', deg: 90 }, camera: { cam_conf: 0.75, std: 0.0416 },
    sign: { mode: 'auto', auto: -1, invert: false, applied: -1, energy_top: 63.6, energy_bottom: 25.5, score: -0.428 },
    cadence_fill: { inserted: 2 }, low_motion: { ptp_px: 0.9, thr_px: 4 }, held_input: 'held input auto: scene step 2 ratio 0.5',
  },
};

test('decisionsOf: records by scene_index; old notes keep just the message; other codes ignored', () => {
  const d = decisionsOf([{ code: 'low_motion', message: 'x', scene_index: 0 }, NOTE, { code: 'primary_used', message: 'points primary auto -> dist01', scene_index: 2 }]);
  assert.equal(d.length, 3);
  assert.equal(d[0], undefined);
  assert.equal(d[1].chosen, 'proj'); assert.equal(d[1].message, NOTE.message);
  assert.deepEqual(d[2], { message: 'points primary auto -> dist01' });
  assert.deepEqual(decisionsOf(undefined), []);
  assert.equal(decisionsOf([{ code: 'primary', message: 'm' }])[0].message, 'm');   // no scene_index: scene 0
});

test('candidateRows: the chosen one first, numbers as text', () => {
  const rows = candidateRows(decisionsOf([NOTE])[1]);
  assert.deepEqual(rows.map((r) => r.id), ['proj', 'proj_cam', 'g1_proj', 'centroid_y']);
  assert.deepEqual(rows.map((r) => r.chosen), [true, false, false, false]);
  assert.equal(rows[0].text, 'std 0.0418 fh · travel 0.129 fh · valid 100%');
  assert.equal(rows[1].text, 'std 0.00889 fh · travel 0.0246 fh · valid 100% · cam conf 0.75');
  assert.equal(rows[2].text, 'std 0.0354 fh · travel 0.0977 fh · valid 100% · share 25%');
  assert.equal(candidateText({ std: null, valid: 0.5 }), 'valid 50%');
  assert.deepEqual(candidateRows({ message: 'old' }), []);
});

test('decisionLines: axis, sign, camera, low motion, cadence fill, held input', () => {
  const L = decisionLines(NOTE.data);
  assert.equal(L.length, 6);
  assert.match(L[0], /^axis: auto 90°/);
  assert.equal(L[1], 'sign: auto → −1 (score -0.428: picture motion at the top 63.6, at the bottom 25.5) · applied −1');
  assert.equal(L[2], 'camera: conf 0.75 · moves 0.0416 fh (std)');
  assert.match(L[3], /^low motion: 0.9 px peak-to-peak < 4 px/);
  assert.equal(L[4], 'cadence fill: 2 strokes inserted');
  assert.equal(L[5], 'held input: held input auto: scene step 2 ratio 0.5');   // a string (message) is shown as is
  assert.equal(decisionLines({ sign: { mode: 'auto', auto: null, why: 'too few strokes', invert: true, applied: -1 } })[0],
    'sign: auto undecided (too few strokes), inverted · applied −1');
  assert.deepEqual(decisionLines({ message: 'old' }), []);
  assert.equal(decisionLines({ seed: { frame_ms: 72300, mode: 'roi', reason: 'the ROI was drawn at 72310 ms' } })[0], 'seed: roi at 72.3 s (the ROI was drawn at 72310 ms)');
});

test('primaryHow: a fixed sentence per primary', () => {
  assert.match(primaryHow('proj_cam'), /camera removed, projected on the stroke axis, normalised 0..1 per scene/);
  assert.match(primaryHow('g3_proj'), /^motion group 3's centroid/);
  assert.match(primaryHow('p0_y'), /^point 1's y position \(image up = higher\)/);
  assert.equal(primaryHow('nope'), '');
  assert.equal(primaryHow(undefined), '');
});
