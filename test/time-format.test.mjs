// One written form per kind of time (paw-p8o2): a time like the transport's readout, a span to a tenth, a length in ms / s / clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fmtTime, fmtSpan, fmtSpanTime, fmtDuration } from '../src/lib/time-format.js';
import { fmtTime as transport } from '../src/features/video/frames.js';

test('a time reads as the transport shows it', () => {
  for (const ms of [0, 5000, 83456, 3_723_004]) assert.equal(fmtTime(ms), transport('ms', ms));
  assert.equal(fmtTime(5000), '0:05.000');
  assert.equal(fmtTime(3_723_004), '1:02:03.004');
});

test('a span: both ends to a tenth, cut not rounded, an en dash', () => {
  assert.equal(fmtSpan(0, 15000), '0:00.0–0:15.0');
  assert.equal(fmtSpanTime(12_499), '0:12.4');
  assert.equal(fmtSpan(72_300, 100_000), '1:12.3–1:40.0');   // the run titles' form (tracking-title.test.mjs, the fix log reads it)
});

test('a length: ms, then seconds, then a clock', () => {
  assert.deepEqual([250, 1500, 9949, 9950, 40_000, 59_499, 59_500, 90_000, 3_725_000].map(fmtDuration),
    ['250 ms', '1.5 s', '9.9 s', '10 s', '40 s', '59 s', '1:00', '1:30', '1:02:05']);
  assert.equal(fmtDuration(NaN), '');
});

test('the status bar, the Actions panel, the review panels and the Projects page use the module, not their own', () => {
  const src = (f) => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
  for (const f of ['app/StatusBar.svelte', 'app/home.js', 'features/tracking/ScenesPanel.svelte', 'features/tracking/TrackerPanel.svelte',
    'features/tracking/DetailChip.svelte', 'features/timeline/SceneQuickBar.svelte', 'features/review/StatsPanel.svelte', 'features/review/ComparePanel.svelte',
    'features/lanes/render.js', 'lib/runs.js']) {
    assert.match(src(f), /lib\/time-format\.js'|'\.\/time-format\.js'/, f);
    assert.doesNotMatch(src(f), /Math\.floor\(\w+ \/ 60(000)?\)\}:\$\{/, `${f}: a hand-rolled m:ss`);
  }
});
