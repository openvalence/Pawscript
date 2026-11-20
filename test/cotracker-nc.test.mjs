// paw-0ous: CoTracker3 (CC BY-NC 4.0) is flagged wherever it is listed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { trackerOptions } from '../src/features/timeline/quickbar.js';
import { NC_BADGE, NC_LINE, NC_LICENSE } from '../src/lib/protocol.js';

test('the CoTracker entry carries the non-commercial badge, others do not', () => {
  const o = trackerOptions([{ id: 'cotracker_points', name: 'CoTracker3', roi: 'points' }, { id: 'lk_box', name: 'Optical flow (box)' }]);
  assert.equal(o.find((x) => x.value === 'cotracker_points').hint, NC_BADGE);
  assert.equal(o.find((x) => x.value === 'lk_box').hint, undefined);
  assert.ok(NC_LINE.length <= 60 && NC_BADGE.length <= 60 && NC_LICENSE.startsWith('https://'));
});
