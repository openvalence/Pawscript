// paw-3ga3: composeLive in one pass gives what the span-by-span compose gave (golden hashes taken from that implementation,
// 953ca2f + paw-40ps / paw-q8jh) over the fixtures the live-script tests and perf scripts use, plus seeded scenes with micro
// features at every join (where the join cleanup acts), baked shots, pieces and an overlapping fill. GOLDEN_PRINT=1 prints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { liveSpans, composeLive } from '../src/lib/script-of.js';

const saw = (t0, t1, per, lo, hi) => { const s = []; for (let t = t0, i = 0; t < t1; t += per, i++) s.push({ at: t, pos: i % 2 ? hi : lo }); return s; };
const inS = (s, t0, t1) => s.filter((p) => p.at >= t0 && p.at < t1);
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const CLEANS = { off: null, std: { gapMs: 60, posTol: 6 }, wide: { gapMs: 140, posTol: 12, blendMs: 500 } };

function scenarios() {
  const out = {};
  // test/script-of.test.mjs
  const shots3 = [{ start_ms: 0, end_ms: 2000 }, { start_ms: 2000, end_ms: 4000 }, { start_ms: 4000, end_ms: 6000 }];
  const run1 = { id: 'run1', name: '#1', script: saw(0, 6000, 100, 30, 70) }, baked = saw(0, 2000, 250, 0, 100);
  out.scriptOf = { base: baked, spans: liveSpans({ shots: shots3, base: baked, runOf: () => run1 }) };
  out.scriptOfSelected = { base: [], spans: liveSpans({ selected: run1 }) };
  // test/review-live-pieces.test.mjs: two runs in one shot
  const A = { id: 'A', name: '#1', script: saw(0, 4000, 100, 30, 70) }, B = { id: 'B', name: '#2', script: saw(0, 4000, 100, 10, 90) };
  out.pieces = { base: [], spans: liveSpans({ shots: [{ start_ms: 0, end_ms: 4000 }], runOf: () => [{ t0: 0, t1: 2000, g: A }, { t0: 2000, t1: 4000, g: B }] }) };
  // the review's perf.mjs (50 shots) and dev/perf/live-script.mjs (60 shots, 3 runs, a third baked)
  { const s = saw(0, 500000, 150, 20, 80), sh = Array.from({ length: 50 }, (_, i) => ({ start_ms: i * 10000, end_ms: (i + 1) * 10000 }));
    out.perf50 = { base: [], spans: liveSpans({ shots: sh, runOf: () => ({ id: 'r', name: 'r', script: s }) }) }; }
  { const dur = 20 * 60000, len = dur / 60, sh = Array.from({ length: 60 }, (_, k) => ({ start_ms: Math.round(k * len), end_ms: Math.round((k + 1) * len) }));
    const pts = (seed) => { const o = []; for (let t = 0, i = 0; t < dur; t += 200, i++) o.push({ at: t, pos: Math.round(50 + 45 * Math.sin(i / 2 + seed)) }); return o; };
    const runs = [0, 1, 2].map((r) => ({ id: 'run' + (r + 1), name: '#' + (r + 1), script: pts(r) }));
    const b = sh.filter((_, k) => k % 3 === 0).flatMap((s) => pts(9).filter((p) => p.at >= s.start_ms && p.at < s.end_ms));
    out.perfProject = { base: b, spans: liveSpans({ shots: sh, base: b, runOf: (k) => runs[k % 3] }) }; }
  // seeded: short shots, dense noisy runs (micro legs and blips at every join), pieces, baked shots, fills
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const r = rng(seed), sh = [];
    for (let t = 0; sh.length < 40;) { const l = 200 + Math.round(r() * 2400); sh.push({ start_ms: t, end_ms: t + l }); t += l; }
    const end = sh[sh.length - 1].end_ms, noisy = (amp) => { const o = []; let t = Math.round(r() * 30), p = 50; while (t < end) { p = Math.max(0, Math.min(100, p + (r() < 0.25 ? (r() - 0.5) * amp : (r() - 0.5) * 8))); o.push({ at: t, pos: Math.round(p) }); t += 15 + Math.round(r() * 70); } return o; };
    const g1 = { id: 'run1', name: '#1', script: noisy(90) }, g2 = { id: 'run2', name: '#2', script: noisy(60) };
    const base = sh.filter((_, k) => k % 7 === 3).flatMap((s) => noisy(80).filter((p) => p.at >= s.start_ms && p.at < s.end_ms));
    const runOf = (k) => { const s = sh[k], m = Math.round((s.start_ms + s.end_ms) / 2); return k % 3 === 1 ? [{ t0: s.start_ms, t1: m, g: g1 }, { t0: m, t1: s.end_ms, g: g2 }] : k % 5 === 2 ? null : k % 2 ? g2 : g1; };
    const bridges = sh.map((s, k) => (k % 5 === 2 ? { t0: s.start_ms, t1: s.end_ms, script: noisy(40).filter((p) => p.at >= s.start_ms && p.at < s.end_ms), mode: 'fill' } : null)).filter(Boolean);
    out['seeded' + seed] = { base, spans: liveSpans({ shots: sh, base, runOf, bridges }) };
    // an overlapping fill (a bridge over a run piece): later wins there
    if (seed <= 2) out['overlap' + seed] = { base, spans: [...liveSpans({ shots: sh, base, runOf }), { t0: sh[4].start_ms + 50, t1: sh[6].end_ms - 50, script: noisy(30), kind: 'fill', name: 'fill' }] };
  }
  return out;
}

const hash = (r) => createHash('sha1').update(JSON.stringify({ s: r.script.map((p) => [p.at, p.pos]), u: r.spans.map((s) => [s.t0, s.t1, s.id ?? s.name]) })).digest('hex').slice(0, 16);

const GOLDEN = {
 "scriptOf/off": "9b272d5c2652ba7f",
 "scriptOf/std": "9b272d5c2652ba7f",
 "scriptOf/wide": "9b272d5c2652ba7f",
 "scriptOfSelected/off": "867ab9f088b65120",
 "scriptOfSelected/std": "867ab9f088b65120",
 "scriptOfSelected/wide": "867ab9f088b65120",
 "pieces/off": "c8639c7f1787b955",
 "pieces/std": "c8639c7f1787b955",
 "pieces/wide": "c8639c7f1787b955",
 "perf50/off": "09687251b030640b",
 "perf50/std": "09687251b030640b",
 "perf50/wide": "09687251b030640b",
 "perfProject/off": "c440f338f0445cb0",
 "perfProject/std": "c440f338f0445cb0",
 "perfProject/wide": "c440f338f0445cb0",
 "seeded1/off": "321e5791c946e042",
 "seeded1/std": "e74a6bae78592319",
 "seeded1/wide": "86a6c3d22f539cb3",
 "overlap1/off": "65cbfcbf33605d50",
 "overlap1/std": "84a2114d9f06fd14",
 "overlap1/wide": "87cebe130d26bd7e",
 "seeded2/off": "d7115a230bf158d4",
 "seeded2/std": "f061a179f84d0a26",
 "seeded2/wide": "235340e981c918ad",
 "overlap2/off": "b16a547537cc32f6",
 "overlap2/std": "38886c8acd700b6d",
 "overlap2/wide": "dbeb9cfb3859450c",
 "seeded3/off": "ddba6e4b9cc1ce2e",
 "seeded3/std": "bab0617ed215111b",
 "seeded3/wide": "29f9ae787e3c9774",
 "seeded4/off": "a5b4eb5d9a5ed570",
 "seeded4/std": "f4d50b0b34c7b6dc",
 "seeded4/wide": "be278208f2e0c6b0",
 "seeded5/off": "62e65fdb19c1a86e",
 "seeded5/std": "a57c16374a98bfd1",
 "seeded5/wide": "435656d1bcc9e7eb",
 "seeded6/off": "9d632b211cdd6921",
 "seeded6/std": "b80878f0556d19fd",
 "seeded6/wide": "14d3e9029e6847f6"
};

test('composeLive: the same script and spans as the span-by-span compose on every fixture', () => {
  const S = scenarios(), got = {};
  for (const [name, { base, spans }] of Object.entries(S)) for (const [c, clean] of Object.entries(CLEANS)) got[`${name}/${c}`] = hash(composeLive(base, spans, clean));
  if (process.env.GOLDEN_PRINT) console.log(JSON.stringify(got, null, 1));
  assert.ok(Object.keys(GOLDEN).length, 'golden hashes present');
  assert.deepEqual(got, GOLDEN);
  // sanity: the fixtures do exercise the cleanup (some differ with it on) and the baked points stay
  assert.ok([1, 2, 3, 4, 5, 6].every((k) => got[`seeded${k}/std`] !== got[`seeded${k}/off`]), 'the cleanup acts on the seeded joins');
  const r = composeLive(S.scriptOf.base, S.scriptOf.spans, CLEANS.std);
  assert.deepEqual(inS(r.script, 0, 2000), S.scriptOf.base);
});

test('fractional cuts (an old or hand-made file): no point of the run falls between two shots', () => {
  const run = { id: 'r', name: 'r', script: saw(0, 3000, 1, 20, 80) };
  const shots = [{ start_ms: 0, end_ms: 1000.4 }, { start_ms: 1000.4, end_ms: 2000.6 }, { start_ms: 2000.6, end_ms: 3000 }];
  const spans = liveSpans({ shots, runOf: () => run, bridges: [] });
  assert.deepEqual(spans.map((s) => [s.t0, s.t1]), [[0, 1000], [1000, 2001], [2001, 3000]], 'edges on the integer ms grid');
  assert.deepEqual(composeLive([], spans).script, run.script, 'every point plays (1000 and 2001 fell in no shot)');
});
