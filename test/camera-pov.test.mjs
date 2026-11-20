// paw-2vd5: the POV camera tag. Set by Describe from Hydra's first-person labels (first_person_view; every *_pov label
// implies it), never by camera.py; beats the detected motion kind, a hand-set tag beats it; camera removal off and proj by
// default; not a camera move (soft cuts and the seed window read scene.camera / the move tags only).
import assert from 'node:assert/strict';
import test from 'node:test';
import { tagsOf, sceneTags, sceneCamera, toggleTag, MIN_SCORE } from '../src/features/timeline/acts.js';
import { camTagDefault, CAM_TAG_DEFAULT } from '../src/lib/rederive.js';
import { cameraDefault, cameraNote, CAMERA_SIGNAL } from '../src/lib/runs-channel.js';
import { trackCuts, CAMERA_MOVES } from '../src/lib/protocol.js';
import { seedWindow } from '../src/lib/seed-window.js';
import { withProposals } from '../src/lib/scenes-continue.js';

const seg = (t0, t1, kind) => ({ t0, t1, kind });
const D = (...tags) => ({ tags: tags.map(([tag, score]) => ({ tag, score })) });

test('Describe labels -> pov: first_person_view or any *_pov at MIN_SCORE, never below, never another label', () => {
  assert.deepEqual(tagsOf(D(['first_person_view', 0.74])), ['pov']);
  assert.deepEqual(tagsOf(D(['male_pov', 0.8])), ['pov']);
  assert.deepEqual(tagsOf(D(['penetrating_pov', 0.7], ['anal_penetration', 0.9])), ['anal', 'penetration', 'pov']);
  assert.deepEqual(tagsOf(D(['first_person_view', MIN_SCORE - 0.01])), []);
  assert.deepEqual(tagsOf(D(['low-angle_view', 0.9], ['first_person', 0.9])), []);
  // a summary does not hide it: pov reads the raw tags, not summary.acts
  assert.deepEqual(tagsOf({ ...D(['receiving_pov', 0.6]), summary: { acts: [], positions: [], views: ['receiving_pov'] } }), ['pov']);
});

test('pov beats the detected motion kind; the motion stays in scene.camera; a hand-set camera tag beats pov', () => {
  const s = { start_ms: 0, end_ms: 4000, describe: D(['first_person_view', 0.9]), camera: [seg(0, 4000, 'reciprocal')] };
  assert.equal(sceneCamera(s), 'pov');
  assert.deepEqual(sceneTags(s), ['pov'], 'one camera tag');
  assert.equal(sceneCamera({ ...s, describe: D(['side_view', 0.9]) }), 'reciprocal', 'no pov label: the motion kind');
  const hand = { ...s, tags: toggleTag(s, 'handheld') };
  assert.equal(sceneCamera(hand), 'handheld');
  const off = { ...s, tags: toggleTag(s, 'pov') };
  assert.deepEqual(off.tags, ['-pov']); assert.equal(sceneCamera(off), null, 'cleared by hand');
  const set = { start_ms: 0, end_ms: 4000, camera: [seg(0, 4000, 'pan')] }, on = { ...set, tags: toggleTag(set, 'pov') };
  assert.deepEqual(on.tags, ['pov']); assert.equal(sceneCamera(on), 'pov', 'set by hand on an undescribed shot');
});

test('downstream: camera removal off, signal proj, its own why line', () => {
  assert.equal(CAM_TAG_DEFAULT.pov, 'off');
  const d = camTagDefault({ start_ms: 0, end_ms: 1, tags: ['pov'] });
  assert.deepEqual([d.tag, d.label, d.cam.mode], ['pov', 'POV', 'off']);
  assert.equal(CAMERA_SIGNAL.pov, 'proj');
  const ch = { t: Float64Array.from([0, 1000]), v: Float32Array.from([0, 1]) };
  assert.equal(cameraDefault('pov', { channels: { proj: ch, proj_cam: ch } }, 0, 2000), 'proj');
  assert.match(cameraNote('pov'), /POV.*no camera removal/);
});

test('pov is not a camera move: soft cuts and the seed window are the same with or without it', () => {
  assert.ok(!CAMERA_MOVES.includes('pov'));
  const doc = (tags) => [{ start_ms: 0, end_ms: 3000 }, { start_ms: 3000, end_ms: 8000, ...(tags ? { tags } : {}), camera: [seg(3000, 4000, 'zoom'), seg(4000, 8000, 'reciprocal')] }];
  assert.deepEqual(trackCuts('document', doc(['pov']), 0, 8000), trackCuts('document', doc(), 0, 8000));
  assert.deepEqual(trackCuts('document', doc(['pov']), 0, 8000).map((c) => [c.t_ms, c.kind]), [[3000, 'hard'], [4000, 'soft']]);
  const shot = (tags) => [{ start_ms: 0, end_ms: 5000, ...(tags ? { tags } : {}) }];
  assert.deepEqual(seedWindow(shot(['pov']), 0, [], 40, 5000), seedWindow(shot(), 0, [], 40, 5000));
  assert.equal(seedWindow(shot(['pov']), 0, [], 40, 5000).a, 0, 'no lead-in from the tag');
  const three = [{ start_ms: 0, end_ms: 1000 }, { start_ms: 1000, end_ms: 2000, tags: ['pov'] }, { start_ms: 2000, end_ms: 3000 }];
  assert.equal(withProposals(three, new Set([2000]))[2].continues, 'auto', 'a camera tag, not an act of the user\'s own');
});
