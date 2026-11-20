// paw-k8pe (the owner: "this tapnext bar at the bottom with the microscopic polarity isn't great"): the run's name, its direction
// and its Adjust row moved UP into the lane toolbar, right of Track's cog (tracking/RunBar.svelte); the run strip under the lane
// is a clean extent bar. The behaviour is checked in the real window (dev/runbar-check.mjs); this pins what it rests on (the
// components do not render under node).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL('../src/features/' + f, import.meta.url), 'utf8');
const lane = read('tracking/TrackingLane.svelte'), bar = read('tracking/RunBar.svelte'), strip = read('tracking/RunRangeStrip.svelte');
const chips = read('timeline/SceneChips.svelte');

test('the run controls render in the lane toolbar after the cog, for bandRun, and only on the Track lane', () => {
  const cog = chips.indexOf('data-btn="track-menu"'), rb = chips.indexOf('<RunBar {app}');
  assert.ok(cog > 0 && rb > cog, 'RunBar comes after the Track cog in the chips');
  assert.match(lane, /const bandRun = \$derived\(pickRun \|\| tr\.deriveRun\(tr\.currentScene\)\)/, 'the rule is kept');
  assert.match(lane, /get on\(\) \{ return !!bandRun; \}/, 'no run: nothing');
  assert.match(lane, /if \(embedded\) \{[\s\S]{0,300}tr\.runBar = bar/, 'only the combined (Track tab) lane hands them over');
});

test('the band no longer holds the row: no duplicate', () => {
  const band = lane.slice(lane.indexOf('data-testid="inspector-band"'), lane.indexOf('{#if tr.bandOpen && bandRun}'));
  assert.ok(band.length > 0);
  assert.doesNotMatch(band, /pickRow/, 'the band row renders no pick row any more');
});

test('the direction is the F command at a button size; the chip and it never fold; the rest folds into one popover', () => {
  const pol = lane.slice(lane.indexOf('{#snippet polarity('), lane.indexOf('{/snippet}', lane.indexOf('{#snippet polarity(')));
  assert.match(pol, /cmd\(app, 'track\.flipAtPlayhead'/);
  assert.match(pol, /<Button size="sm"/);
  assert.match(pol, /\{polFlipped \? 'flipped' : 'normal'\}/, 'in words');
  assert.match(bar, /<span class="fix">.*\{@render bar\.chip\(\)\}.*\{@render bar\.pol\(tight\)\}.*<\/span>/);
  assert.doesNotMatch(bar.slice(bar.indexOf('<Popover')), /bar\.(chip|pol)\(\)/, 'neither is ever in the popover');
  assert.equal((bar.match(/<Popover /g) || []).length, 1, 'one overflow popover');
  assert.match(bar, /gs\.slice\(0, n\)[\s\S]*gs\.slice\(n\)/, 'the same groups, the tail in the popover');
  for (const k of ['src', 'pair', 'vs', 'pad', 'pin', 'depth', 'base', 'anchor']) assert.match(lane, new RegExp(`key: '${k}'`), k);
});

test('the strips under the lane: the kit\'s small type (no 7-9 px fonts), sized by ui.density', () => {
  const shaft = read('tracking/ShaftStrip.svelte');
  for (const [name, src, sel] of [['lane', lane, '.edge .ovb'], ['lane', lane, '.edge .ovx'], ['shaft', shaft, '.tm'], ['shaft', shaft, '.kgrip']]) {
    const rule = src.match(new RegExp(sel.replace(/\./g, '\\.') + ' \\{[^}]*\\}'))?.[0] || '';
    assert.ok(rule, `${name} ${sel}`);
    assert.doesNotMatch(rule, /\b[0-9]px\s*[/;]|font-size:\s*[0-9]px/, `${name} ${sel}: ${rule}`);
  }
  assert.match(lane, /app\.settings\.get\('ui\.density'\)/, 'the one size setting');
});

test('the run strip: a clean bar, no name and no ± glyph; Invert stays in its right-click menu', () => {
  assert.doesNotMatch(strip, /class="inv"/);
  assert.doesNotMatch(strip, /class="nm"/);
  assert.match(strip, /label: 'Invert this range'/);
  assert.match(strip, /\.rg \{ position: absolute; top: 2px; bottom: 2px;/, '6 px of a 10 px strip');
});
