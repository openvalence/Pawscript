// The Director panel's pure half (src/features/director/panel-logic.js): summaries, grouping, footer counts, and the
// ask-card choices, each of which must be a value BRAINS' validate() accepts for its request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summary, groups, footer, cardChoices, traceMarkdown, badgeOf } from '../src/features/director/panel-logic.js';
import { validate } from '../src/lib/director/decisions.js';

const scope = { scene: 1, t0: 4000, t1: 24000 };
const req = (kind, facts = {}, extra = {}) => ({ id: `${kind}:s1@4000`, kind, scope, facts, frames: [{ t: 5000 }, { t: 5400 }], ...extra });

test('summaries read like the trace', () => {
  assert.equal(summary('track', { keep: 'run21', channel: 'dist01', agree: ['run22'], reject: {} }), 'track · keep run21 dist01 · agrees run22');
  assert.equal(summary('track', { keep: null, agree: [], reject: {}, fallback: { recipe: 'penetration-strokes', params: {} } }), 'track · none → penetration-strokes');
  assert.equal(summary('direction', { sign: -1, pairs: [] }), 'direction · −1 mirrored');
  assert.equal(summary('climax', { window: { t0: 56222, t1: 66300 }, afterglowTo: 80400 }), 'orgasm · 56.2–66.3 s · afterglow to 80.4 s');
  assert.equal(summary('story', { segments: [{ kind: 'offscreen', visible: false }] }), 'story · offscreen (off)');
  assert.equal(badgeOf('vlm:qwen3.5-2b'), 'V');
});

test('groups by scene (video first), footer counts brains, redos and provisional', () => {
  const recs = [
    { id: 'track:s1@4000', kind: 'track', scope, brain: 'rules', attempt: 1, provisional: false },
    { id: 'camera:s1', kind: 'camera', scope: { scene: 1, t0: 4000, t1: 24000 }, brain: 'rules', attempt: 0, provisional: false },
    { id: 'climax:v', kind: 'climax', scope: { scene: null, t0: 0, t1: 60000 }, brain: 'agent', attempt: 0, provisional: false },
    { id: 'direction:s1@4000', kind: 'direction', scope, brain: 'default', attempt: 0, provisional: true },
  ];
  const g = groups(recs);
  assert.deepEqual(g.map((x) => x.label), ['Video', 'Scene 2']);
  assert.deepEqual(g[1].rows.map((r) => r.kind), ['camera', 'track', 'direction']);
  assert.equal(footer(recs), '4 decisions · 2 R · 1 A · 1 – · 1 redo · 1 provisional');
  assert.match(traceMarkdown({ path: 'x.mp4' }, recs.map((r) => ({ ...r, value: null, conf: 0.5, status: 'decided', rationale: 'a | b' }))), /## track[\s\S]*a \/ b/);
});

test('every card choice is a valid answer for its request', () => {
  const runs = [{ id: 'run1', role: 'subject', channel: 'proj' }, { id: 'run2', role: 'subject', channel: 'area' }, { id: 'run3', role: 'reference', channel: 'primary' }];
  const cases = [
    [req('camera'), { mode: 'static', p95Px: 1, rateHz: null, phaseMs: null, moveSpans: [], valid: ['single', 'relative', 'rate'] }],
    [{ ...req('climax'), id: 'climax:v', scope: { scene: null, t0: 0, t1: 60000 } }, { window: { t0: 48000, t1: 56000 }, afterglowTo: 56000 }],
    [{ ...req('story'), id: 'story:s1' }, null],
    [req('roi'), { probes: [{ id: 'p1', tracker: 'lk_box', roi: { kind: 'box', x: 0, y: 0, w: 1, h: 1 }, params: {}, role: 'subject', part: 'frame' }] }],
    [req('track', { runs, segment: { kind: 'penetration' }, camera: { valid: ['single', 'relative', 'rate'] } }), { keep: 'run1', agree: [], reject: {} }],
    [req('direction', { pickPairs: [{ a: { at: 5000, pos: 10 }, b: { at: 5400, pos: 90 } }] }), { sign: 1, pairs: [] }],
    [req('direction'), { sign: 0, pairs: [] }],
    [req('verify', { checks: [] }), { verdict: 'ok', checks: [], note: '' }],
  ];
  for (const [r, prov] of cases) {
    const c = cardChoices(r, prov);
    assert.ok(c.choices.length >= 2, r.id + ' offers choices');
    for (const ch of c.choices) assert.equal(validate(r.kind, ch.value, r), null, `${r.id} ${ch.id}`);
  }
  // track: reference runs are not offered; direction: a blind pair, the sign from the hidden positions
  const t = cardChoices(cases[4][0], cases[4][1]);
  assert.deepEqual(t.choices.map((c) => c.id), ['run1', 'run2', 'none']);
  const d = cardChoices(cases[5][0], null);
  assert.deepEqual(d.pair.map((p) => p.label), ['A', 'B']);
  const deepA = d.choices.find((c) => c.id === 'A').value, at5000 = d.pair.find((p) => p.t === 5000).label;
  assert.equal(deepA.sign, at5000 === 'A' ? 1 : -1, 'deep at the low tracked pos = +1');
});
