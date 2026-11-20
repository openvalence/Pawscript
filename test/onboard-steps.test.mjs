// paw-kxwz: the first-run hint's state (src/features/onboard/steps.js) and the quick start's Markdown (md.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { factsOf, stepOf, lineOf, hintStep, initHints, dismiss, setHints, hintsOn, helpPage, LINES, CARD } from '../src/features/onboard/steps.js';
import { parseMd, inline } from '../src/features/onboard/md.js';

const settings = (values = {}) => ({ values, get(k, d) { return k in this.values ? this.values[k] : d; }, set(k, v) { this.values[k] = v; } });
const shot = (a, b, x = {}) => ({ start_ms: a, end_ms: b, ...x });
const poly = [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]];
const pts = (a, b) => Array.from({ length: 20 }, (_, k) => ({ at: a + ((b - a) * k) / 19, pos: k % 2 ? 90 : 10 }));

test('the steps follow the work on the shot under the playhead', () => {
  assert.equal(stepOf(factsOf([], -1)), 'cuts', 'no shots: check the cuts');
  const list = [shot(0, 5000), shot(5000, 10000)];
  assert.equal(stepOf(factsOf(list, 0)), 'paint', 'nothing painted');
  list[0].groups = [{ name: 'unassigned_1', poly }];
  assert.equal(stepOf(factsOf(list, 0)), 'name', 'only unnamed parts: name them');
  list[0].groups.push({ name: 'ignore', poly });
  assert.equal(stepOf(factsOf(list, 0)), 'name', 'an ignore region is no part');
  list[0].groups.push({ name: 'c2_penis', poly });
  assert.equal(stepOf(factsOf(list, 0)), 'track', 'a named part: track');
  const ghost = { id: 'run1', script: pts(0, 5000) };
  assert.equal(stepOf(factsOf(list, 0, [], ghost)), 'accept', 'a run covers it but the axis does not yet: check it');
  assert.equal(stepOf(factsOf(list, 0, pts(0, 5000), ghost)), 'next', 'the axis has points over it: next shot');
  assert.equal(stepOf(factsOf(list, 1, pts(0, 5000), null)), 'paint', 'the next shot (another scene) starts over');
  list[1].join = true;   // the same scene: its groups count for both shots
  assert.equal(stepOf(factsOf(list, 1, pts(0, 5000), null)), 'track');
});

test('a line names the key of every command in it, and the tab when the step is done elsewhere', () => {
  const keys = { 'mode.track': ['Ctrl+2'], 'mode.scenes': ['Ctrl+1'], 'track.gridFrame': ['T'], 'tracking.groups': ['Tab'] };
  const kf = (id) => keys[id] || [];
  const words = (l) => l.map((p) => p.keys ? `[${p.keys}]` : p.t).join('');
  assert.equal(words(lineOf('track', 'track', kf)), 'With the shot selected, [T] tracks it. No shot or range selected: the whole video.');
  assert.match(words(lineOf('track', 'scenes', kf)), /^\[Ctrl\+2\] Track tab: With the shot selected, \[T\]/);
  assert.match(words(lineOf('paint', 'track', kf)), /\[Tab\]: paint the penis/);
  assert.equal(lineOf('nope', 'track', kf), null);
  for (const s of Object.keys(LINES)) assert.ok(lineOf(s, 'track', () => ['X']).length > 1, s);
  // a run plays live (no Accept), so the axis covers a tracked shot at once and the user lands on 'next': it names the
  // check, Bake and Publish, never an Accept
  for (const id of ['track.flipAtPlayhead', 'tracking.bake', 'file.publish']) assert.ok(LINES.next[1].includes(`{${id}}`), `next names ${id}`);
  assert.ok(![...Object.values(LINES).map(([, t]) => t), ...CARD].some((t) => /accept/i.test(t)), 'no hint or card line says accept');
});

test('hints: on for a profile with no recent projects, off for any other; x hides a step; the menu brings them back', () => {
  const fresh = settings(); initHints(fresh);
  assert.equal(hintsOn(fresh), true);
  const old = settings({ recent: [{ path: 'a.pawproj' }] }); initHints(old);
  assert.equal(hintsOn(old), false, 'the owner and every existing profile stay quiet');
  const chose = settings({ 'onboard.hints': false }); initHints(chose);
  assert.equal(hintsOn(chose), false, 'decided once: a later boot keeps it');
  const f = { shots: 0 };
  assert.equal(hintStep(fresh, f), 'cuts');
  assert.equal(hintStep(fresh, f, { media: false }), null, 'no video: the video pane says it');
  assert.equal(hintStep(fresh, f, { busy: true }), null, 'tracking: no hint');
  assert.equal(hintStep(old, f), null);
  dismiss(fresh, 'cuts');
  assert.equal(hintStep(fresh, f), null, 'dismissed stays dismissed');
  assert.equal(hintStep(fresh, { shots: 2 }), 'paint', 'the next step still shows');
  setHints(fresh, false);
  assert.equal(hintStep(fresh, { shots: 2 }), null);
  setHints(fresh, true);
  assert.equal(hintStep(fresh, f), 'cuts', 'shown again from the start');
});

test("F1's page: the quick start for a new profile, the shortcuts for an existing one, then the last one picked", () => {
  assert.equal(helpPage(settings({ 'onboard.hints': true })), 'start');
  assert.equal(helpPage(settings({ 'onboard.hints': false })), 'keys');
  assert.equal(helpPage(settings({ 'onboard.hints': true, 'help.page': 'keys' })), 'keys');
  assert.equal(helpPage(settings({ 'help.page': 'start' })), 'start');
});

test('md: headings, paragraphs, lists, code, bold, links as text; comments dropped', () => {
  assert.deepEqual(inline('a `T` b **c** [d](x.md)'), [{ t: 'a ' }, { code: 'T' }, { t: ' b ' }, { b: 'c' }, { t: ' ' }, { t: 'd' }]);
  const b = parseMd('# A\n\nline one\nline two\n\n- x `K`\n  more\n- y\n\n1. one\n2. two\n<!-- hidden\nT = x -->\n## B');
  assert.deepEqual(b.map((x) => x.type), ['h1', 'p', 'ul', 'ol', 'h2']);
  assert.deepEqual(b[1].text, [{ t: 'line one line two' }]);
  assert.deepEqual(b[2].items, [[{ t: 'x ' }, { code: 'K' }, { t: ' more' }], [{ t: 'y' }]]);
  assert.equal(b[3].items.length, 2);
});

test('the quick start parses into its nine steps, each with the mistake people make there', () => {
  const b = parseMd(readFileSync(new URL('../docs/guide/quick-start.md', import.meta.url), 'utf8'));
  const steps = b.filter((x) => x.type === 'h2');
  assert.equal(steps.length, 9);
  const text = (x) => (x.text || []).map((p) => p.t ?? p.code ?? p.b).join('');
  for (const [k, h] of b.entries()) {
    if (h.type !== 'h2') continue;
    const end = b.findIndex((x, j) => j > k && x.type === 'h2');
    assert.ok(b.slice(k, end < 0 ? undefined : end).some((x) => text(x).startsWith('Mistake:')), text(h));
  }
  assert.ok(!b.some((x) => text(x).includes('guide-keys')), 'the key list is a comment, never shown');
});
