// Scene fill (paw-job): what is left of it after paw-2lp7.4 is the bridge's timing option (lib/scenes-continue.js fillScript,
// fillSpans), the track skip reason, prominence turns and the dressing (the bridges and their Accept: test/cutaway.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillScript, fillSpans, turnsIn } from '../src/lib/scenes-continue.js';
import { skipReason } from '../src/features/timeline/acts.js';
import { planTracks } from '../src/lib/track-plan.js';

// alternating lo / hi every `half` ms from t0 to t1 (pos 0 = deep, 100 = out: hi = a top)
const strokes = (t0, t1, half, lo = 10, hi = 90) => { const out = []; for (let t = t0, k = 0; t <= t1; t += half, k++) out.push({ at: t, pos: k % 2 ? hi : lo }); return out; };
const gaps = (s) => s.slice(1).map((p, i) => p.at - s[i].at);
const B = strokes(0, 10000, 400), A = strokes(14000, 24000, 250, 30, 70), T0 = 10100, T1 = 13900;

test('paw-2lp7.4: fillSpans = runs of bridged shots with the timing option; an old before / after / both is no fill (the bridge carries it)', () => {
  const sc = [{ start_ms: 0, end_ms: 10 }, { start_ms: 10, end_ms: 20, fill: 'timing', tags: ['offscreen'] }, { start_ms: 20, end_ms: 30, fill: 'timing', tags: ['offscreen'] },
    { start_ms: 30, end_ms: 40, fill: 'both', tags: ['offscreen'] }, { start_ms: 40, end_ms: 50, fill: 'timing', tags: ['cutaway'] }, { start_ms: 50, end_ms: 60, fill: 'timing', tags: ['cutaway'], carried: true }];
  assert.deepEqual(fillSpans(sc), [{ lo: 1, hi: 2, mode: 'timing', a: 0, c: 3 }, { lo: 5, hi: 5, mode: 'timing', a: 4, c: 6 }], 'an intermission cutaway (shot 4) is not bridged: its timing does nothing');
  assert.equal(skipReason({ fill: 'both' }), '', 'no fill reason any more: an unmarked shot is tracked');
  assert.equal(skipReason({ fill: 'timing', tags: ['offscreen'] }), '', 'timing: tracked for its turn times');
});

// ---- paw-b26: Fill: timing from this shot; paw-uiu: prominence turns, fills dressed like their neighbours ----
import { layoutOf, dressScript, shapeAt } from '../src/lib/stroke-shape.js';

test('timing fill: the shot\'s own turn times, the depth from before easing to after, joined at both ends', () => {
  // the shot's own tracked points (a flapping dick): irregular turns at its own tempo, its depth meaningless (40..60)
  const own = [10300, 10700, 11300, 11650, 12300, 12800, 13300, 13700].map((at, k) => ({ at, pos: k % 2 ? 60 : 40 }));
  const { script, need } = fillScript(B, A, T0, T1, { mode: 'timing', own });
  assert.equal(need, '');
  assert.deepEqual(script.map((p) => p.at), own.map((p) => p.at), 'every turn at the shot\'s own time');
  const first = script[0], last = script.at(-1);
  assert.ok(Math.abs(first.pos - (own[0].pos < 50 ? 10 : 90)) <= 3, `starts at the before side's depth: ${first.pos}`);
  assert.ok(Math.abs(last.pos - 70) <= 4, `ends near the after side's top: ${last.pos}`);
  assert.ok(script.every((p, k) => !k || (p.pos - 50) * (script[k - 1].pos - 50) < 0), 'still alternating tops and bottoms');
  assert.equal(fillScript(B, A, T0, T1, { mode: 'timing', own: [] }).need, 'timing', 'no motion of its own: says so');
  assert.equal(fillScript([], [], T0, T1, { mode: 'timing', own }).need, 'both', 'no neighbours: no depth');
});

test('Track tagged scenes tracks an off-screen shot with a timing fill (for its timing); a plain off-screen shot stays bridged', () => {
  const sc = [{ start_ms: 0, end_ms: 5000, tags: ['anal'] }, { start_ms: 5000, end_ms: 8000, tags: ['offscreen'], fill: 'timing' }, { start_ms: 8000, end_ms: 9000, tags: ['offscreen'] }];
  assert.equal(skipReason(sc[1]), '');
  const items = planTracks(sc, { trackerId: 'x', trackers: [{ id: 'x', roi: 'none' }], skip: skipReason });
  assert.ok(items.some((x) => x.action === 'track' && x.sceneIdx.includes(1)), JSON.stringify(items.map((x) => [x.action, x.sceneIdx])));
  assert.ok(items.some((x) => x.action === 'skip' && x.sceneIdx.includes(2)));
});

test('turnsIn counts a dense, wobbly script\'s strokes, not its wiggles', () => {
  const wob = []; for (let t = 0; t <= 8000; t += 50) wob.push({ at: t, pos: Math.round(50 + 40 * Math.sin((2 * Math.PI * t) / 1000) + 3 * Math.sin((2 * Math.PI * t) / 130)) });
  const n = turnsIn(wob, 0, 8000).length;
  assert.ok(n >= 15 && n <= 17, `${n} turns for 8 strokes`);
});

test('fills take the neighbours\' midpoint / hold layout, the same on every generated stroke, as the Detail allows', () => {
  // neighbours: every up-move with a midpoint at 70 % of its time, 75 % of its way; every top held 30 % of a stroke
  const side = (t0) => { const s = []; for (let k = 0; k < 10; k++) { const t = t0 + k * 1000; s.push({ at: t, pos: k % 2 ? 90 : 10 }); s.push(k % 2 ? { at: t + 300, pos: 90 } : { at: t + 700, pos: 70 }); } return s; };
  const L = layoutOf([side(0), side(30000)]);
  assert.ok(Math.abs(L.mid[1].u - 0.7) < 0.01 && Math.abs(L.mid[1].df - 0.75) < 0.01 && L.mid[-1] === null && Math.abs(L.hold.top - 0.3) < 0.01 && L.hold.bottom === null, JSON.stringify(L));
  const gen = []; for (let k = 0; k < 9; k++) gen.push({ at: 12000 + k * 800, pos: k % 2 ? 85 : 15 });
  const d = dressScript(gen, L, shapeAt({}), { minGapMs: 60 });
  const ups = [], tops = [];
  for (let i = 0; i + 1 < d.length; i++) {
    if (d[i].pos === 15) ups.push(d[i + 1].pos !== 85);   // a bottom: is the next point a midpoint?
    if (d[i].pos === 85 && d[i + 1].pos === 85) tops.push(d[i + 1].at - d[i].at);
  }
  assert.ok(ups.length >= 4 && ups.every(Boolean), 'every up-move has its midpoint');
  assert.ok(tops.length >= 3 && tops.every((x) => x === tops[0]), `every inner top held alike: ${tops}`);
  assert.equal(dressScript(gen, L, shapeAt({ shape: 'turns' })), gen, 'Turns only: as generated');
  assert.ok(!dressScript(gen, L, shapeAt({ shape: 'mid' })).some((p, i, a) => i && p.pos === a[i - 1].pos), '+ Midpoint: no holds');
});
