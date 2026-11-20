// The band under the Track tab's stroke lane holds the shot's Adjust strip (its only place since 145370e). The strip edits the
// run whose RANGE plays at the shot (tracking deriveRun, paw-1ysd), so its ▾ must open whenever there is such a run, not only
// when a run is selected or linked: with ranges, nothing selected and no link (a reopened project, a run strip pick) it was
// disabled and Adjust unreachable (dev/runsel-check.mjs found it). Source guard: the component does not render under node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL('../src/features/tracking/' + f, import.meta.url), 'utf8');
const lane = read('TrackingLane.svelte'), strip = read('DeriveStrip.svelte');

test('the band ▾ opens for the run the Adjust strip edits (the range playing at the shot), not only the picked run', () => {
  assert.match(strip, /const run = \$derived\(i >= 0 \? tr\.deriveRun\(i\) : null\)/, 'the strip edits deriveRun');
  assert.match(lane, /const bandRun = \$derived\(pickRun \|\| tr\.deriveRun\(tr\.currentScene\)\)/);
  const more = lane.match(/data-testid="inspector-more"[^>]*>/)?.[0] || '';
  assert.match(more, /disabled=\{!bandRun\}/, 'the ▾ is enabled by bandRun');
  assert.match(lane, /\{#if tr\.bandOpen && bandRun\}\s*<div class="bandmore/, 'and the unfolded body shows for it');
});
