import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasScore, weakParts, scoreChange, scoreLine, weakestLine, scoreTip, featuresLine, outlineNote } from '../src/features/tracking/seed-score.js';

const score = {
  frames: 52, sources: 26,
  overall: { n: 383, found: 0.512, iou: 0.266, cerr: 0.059, extra: 5.2 },
  parts: {
    penis: { n: 44, sources: 24, too_few: false, found: 0.39, iou: 0.36, cerr: 0.06 },
    hips: { n: 64, sources: 9, too_few: false, found: 0.33, iou: 0.2, cerr: 0.077 },
    head: { n: 63, sources: 25, too_few: false, found: 0.63, iou: 0.34, cerr: 0.045 },
    tongue: { n: 4, sources: 4, too_few: true },
    neckbulge: { n: 1, sources: 1, too_few: true },
  },
  previous: { found: 0.48, iou: 0.27, cerr: 0.062, extra: 5.5, frames: 40, sources: 20 },
};

test('who drew the outline, for the suggestion tip', () => {
  assert.match(outlineNote({ mask_from: 'sam' }), /drawn by SAM/);
  assert.match(outlineNote({ mask_from: 'head' }), /coarse blob/);
  assert.match(outlineNote({ mask_from: 'cam' }), /tagger/);
  assert.equal(outlineNote({}), '');
});

test('the feature source in one line', () => {
  assert.equal(featuresLine({ features: { source: 'hydra', pack: false, wanted: 'hydra', stale: false } }), 'seeder features: Hydra (built in)');
  assert.equal(featuresLine({ features: { source: 'taggerine', pack: true, wanted: 'taggerine', stale: false } }), 'seeder features: taggerine (optional pack installed)');
  assert.match(featuresLine({ features: { source: 'hydra', pack: true, wanted: 'taggerine', stale: true } }), /Hydra \(built in\) · the pack is installed: Train to use it/);
  assert.match(featuresLine({ features: { source: 'taggerine', pack: true, wanted: 'hydra', stale: true } }), /Hydra is selected in the settings: Train to switch/);
  assert.match(featuresLine({ features: { source: 'hydra', note: 'taggerine could not be loaded (x); Hydra features used' } }), /could not be loaded/);
  assert.match(featuresLine({ features: { source: 'taggerine' }, unused: 'cannot run here now' }), /cannot run here now/);
  assert.equal(featuresLine({}), '');
});

test('the headline line is plain', () => {
  assert.equal(scoreLine(score), 'held-out: found 51 % · overlap 27 % · centre 5.9 % · 5.2 extra per picture · 26 sources');
  assert.equal(scoreLine({ pending: true }), 'held-out score: computing…');
  assert.match(scoreLine({ overall: { n: 0, found: null } }), /not enough labels/);
  assert.equal(scoreLine(null), '');
  assert.equal(hasScore({ pending: true }), false);
});

test('the change since the previous Train, in points', () => {
  assert.equal(scoreChange(score), '+3.2 found, −0.4 overlap, −0.3 centre points since the previous Train (40 frames then)');
  assert.equal(scoreChange({ ...score, previous: undefined }), '');
});

test('parts: weakest first, the too-few ones last, fewest first', () => {
  assert.deepEqual(weakParts(score).map((p) => p.part), ['hips', 'penis', 'head', 'neckbulge', 'tongue']);
  assert.equal(weakestLine(score), 'hips: found 33 % from 9 sources');
  const tip = scoreTip(score);
  assert.match(tip, /hips: found 33 %.*64 painted from 9 sources/);
  assert.match(tip, /neckbulge: too few \(1 painted from 1 source;/);
  assert.ok(tip.indexOf('hips') < tip.indexOf('penis') && tip.indexOf('penis') < tip.indexOf('tongue'));
});
