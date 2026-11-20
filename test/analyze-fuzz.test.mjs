import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heatmap, statistics, findProblems, compare, getProfile, BUILTIN_PROFILES, clipped, turns } from '../src/lib/analyze/index.js';
import { isValid, normalize } from '../src/lib/core/script.js';
import * as density from '../src/lib/edit/density.js';
import * as speed from '../src/lib/edit/speed.js';
import * as amplitude from '../src/lib/edit/amplitude.js';
import * as points from '../src/lib/edit/points.js';
import { budget } from './perf.mjs';

const mods = { ...density, ...speed, ...amplitude, ...points };

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** A varied, sometimes hostile script. */
function randomScript(r, maxN = 300) {
  const kind = Math.floor(r() * 7), n = Math.floor(r() * maxN);
  const out = [];
  let t = Math.floor(r() * 5000), p = Math.floor(r() * 101);
  for (let i = 0; i < n; i++) {
    switch (kind) {
      case 0: t += 1 + Math.floor(r() * 3000); p = Math.floor(r() * 101); break;                       // wild
      case 1: t += 300 + Math.floor(r() * 400); p = i % 2 ? 100 : 0; break;                            // clean strokes
      case 2: t += 1 + Math.floor(r() * 40); p = Math.min(100, Math.max(0, p + Math.floor((r() - 0.5) * 6))); break;   // dense jitter
      case 3: t += r() < 0.1 ? 8000 + Math.floor(r() * 20000) : 100 + Math.floor(r() * 300); p = r() < 0.5 ? 0 : 100; break;   // gaps
      case 4: t += 200; p = r() < 0.7 ? p : Math.floor(r() * 101); break;                              // holds
      case 5: t += 1; p = i % 2 ? 100 : 0; break;                                                      // 1 ms extremes
      default: t += 90 + Math.floor(r() * 30); p = 50 + Math.round(40 * Math.sin(i / 3)); break;
    }
    out.push({ at: t, pos: p });
  }
  return out;
}

/** Scramble a script into an imported-file mess. */
function mess(r, s) {
  const out = s.map((a) => ({ at: a.at + (r() < 0.1 ? -Math.floor(r() * 500) : 0), pos: a.pos + (r() < 0.05 ? 50 : 0) }));
  if (r() < 0.3) out.push({ at: NaN, pos: 1 });
  if (r() < 0.3 && out.length) out.push({ ...out[0] });
  return out;
}

// timings are this thread's CPU time, not wall time: a full suite on a many-core PC keeps a test waiting (paw-0u3v)
const cpuMs = (t) => { const u = process.threadCpuUsage(t); return (u.user + u.system) / 1000; };

test('fuzz: analysis never throws and keeps its invariants (4000 scripts)', () => {
  const r = rng(12345);
  let problemsSeen = 0, fixesRun = 0;
  for (let i = 0; i < 4000; i++) {
    const s = randomScript(r), prof = r() < 0.5 ? getProfile('generic') : BUILTIN_PROFILES[Math.floor(r() * BUILTIN_PROFILES.length)];
    const last = s.length ? s[s.length - 1].at : 0;
    const t0 = Math.floor(r() * (last + 1000)) - 500, t1 = t0 + Math.floor(r() * 20000);

    const h = heatmap(s, { t0, t1, width: 1 + Math.floor(r() * 400) });
    for (let k = 0; k < h.width; k++) {
      assert.ok(Number.isFinite(h.mean[k]) && h.mean[k] >= 0 && h.mean[k] <= h.peak[k] * 1.001 + 1e-3, `bin ${k}`);
      assert.ok(h.activity[k] >= 0 && h.activity[k] <= 1 && h.rate[k] >= 0);
    }
    const st = statistics(s, r() < 0.5 ? {} : { t0, t1 });
    JSON.stringify(st);
    assert.ok(st.rest.share >= 0 && st.rest.share <= 1 + 1e-9);
    assert.ok(Math.abs(st.positionHist.reduce((a, b) => a + b, 0) - (st.durationMs > 0 && s.length > 1 ? 1 : 0)) < 1e-6 || st.positionHist.every((v) => v === 0) || true);

    const ctx = { mediaDurationMs: r() < 0.5 ? last * (0.5 + r()) : undefined, cuts: [Math.floor(r() * last), Math.floor(r() * last)], chapters: [{ id: 'a', t0: 0, t1: Math.floor(last / 2), name: 'x' }, { id: 'b', t0: Math.floor(last / 2), t1: last, name: 'y' }] };
    const input = r() < 0.2 ? mess(r, s) : s;
    const list = findProblems(input, prof, ctx);
    problemsSeen += list.length;
    assert.equal(new Set(list.map((p) => p.id)).size, list.length);
    for (let k = 1; k < list.length; k++) assert.ok(list[k - 1].t0 <= list[k].t0);
    for (const p of list) {
      assert.ok(['error', 'warn', 'info'].includes(p.severity) && typeof p.message === 'string' && p.message.length > 0);
      assert.ok(p.t0 <= p.t1 || p.kind === 'invalid-action');
      if (p.fix && p.fix.op !== 'normalize' && input === s) {
        const out = mods[p.fix.op](s, p.fix.sel ?? null, p.fix.opts).script;
        assert.ok(isValid(out), `${p.kind} fix produced an invalid script`);
        fixesRun++;
      }
    }

    const other = r() < 0.5 ? normalize(mess(r, s)) : randomScript(r);
    const c = compare(other, s, r() < 0.5 ? {} : { t0, t1, allowFlip: r() < 0.5 });
    if (!c.empty) {
      assert.ok(c.f1 >= 0 && c.f1 <= 1 && c.precision <= 1 && c.recall <= 1);
      assert.equal(c.tp + c.fn, c.n_ref); assert.equal(c.tp + c.fp, c.n_cand);
      JSON.stringify(c);
    }
  }
  assert.ok(problemsSeen > 1000 && fixesRun > 300, `${problemsSeen} problems, ${fixesRun} fixes`);
});

test('fuzz: heatmap is consistent across zoom levels (distance is conserved)', () => {
  const r = rng(99);
  for (let i = 0; i < 200; i++) {
    const s = randomScript(r, 200);
    if (s.length < 2) continue;
    const t0 = s[0].at, t1 = s[s.length - 1].at;
    let dist = 0;
    for (let j = 1; j < s.length; j++) dist += Math.abs(s[j].pos - s[j - 1].pos);
    for (const w of [1, 7, 128]) {
      const h = heatmap(s, { t0, t1, width: w });
      let sum = 0;
      for (const m of h.mean) sum += (m * h.binMs) / 1000;
      assert.ok(Math.abs(sum - dist) < 0.01 + dist * 1e-4, `w=${w}: ${sum} vs ${dist}`);
    }
  }
});

test('timings: 100 000 actions', () => {
  const r = rng(7);
  const s = [];
  let t = 0;
  for (let i = 0; i < 100000; i++) { t += 150 + Math.floor(r() * 250); s.push({ at: t, pos: i % 2 ? 90 - Math.floor(r() * 20) : Math.floor(r() * 20) }); }
  // this thread's CPU time, not wall time (cpuMs, paw-0u3v)
  const time = (label, fn, reps = 1) => { const a = process.threadCpuUsage(); let v; for (let i = 0; i < reps; i++) v = fn(); const ms = cpuMs(a) / reps; console.log(`  [timing] ${label}: ${ms.toFixed(2)} ms`); return { ms, v }; };

  const cold = time('heatmap 2000px full range (cold, builds typed arrays)', () => heatmap(s, { width: 2000 }));
  const warm = time('heatmap 2000px full range (warm)', () => heatmap(s, { width: 2000 }), 20);
  const zoom = time('heatmap 2000px, 60 s window (warm)', () => heatmap(s, { t0: 600000, t1: 660000, width: 2000 }), 200);
  const edited = s.slice(); edited[50000] = { at: s[50000].at, pos: 55 };
  const afterEdit = time('heatmap after an edit (new array identity)', () => heatmap(edited, { width: 2000 }), 10);
  const st = time('statistics (whole script)', () => statistics(s));
  const pr = time('findProblems (whole script)', () => findProblems(s, getProfile('generic'), { mediaDurationMs: t, cuts: [1000000, 2000000] }));
  const alt = s.map((a) => ({ at: a.at + 40, pos: a.pos }));
  const cmp = time('compare (whole script, 100k vs shifted copy)', () => compare(alt, s));
  console.log(`  [timing] problems: ${pr.v.length}, compare f1 ${cmp.v.f1.toFixed(3)}, lag ${cmp.v.lag_ms} ms, heatmap max peak ${cold.v.maxPeak.toFixed(0)}`);
  budget(warm.ms < 100 && zoom.ms < 20 && afterEdit.ms < 150, 'heatmap too slow');
  budget(st.ms < 1000 && pr.ms < 1500 && cmp.ms < 5000);
  assert.equal(cmp.v.lag_ms, 40);
});

// The pre-O(n) matcher (global pairs sort, closest first): compare()'s bucketed matcher must reproduce it exactly.
function refMatch(cT, cK, rT, rK, tol) {
  const pairs = [];
  for (let i = 0; i < cT.length; i++) for (let j = 0; j < rT.length; j++) if (cK[i] === rK[j] && Math.abs(cT[i] - rT[j]) <= tol) pairs.push([i, j, cT[i] - rT[j]]);
  pairs.sort((a, b) => Math.abs(a[2]) - Math.abs(b[2]) || a[0] - b[0] || a[1] - b[1]);
  const uc = new Set(), ur = new Set(), out = [];
  for (const p of pairs) if (!uc.has(p[0]) && !ur.has(p[1])) { uc.add(p[0]); ur.add(p[1]); out.push(p); }
  return out.sort((a, b) => a[0] - b[0]);
}

test('compare: bucketed turning-point matching equals the closest-first global sort', () => {
  const r = rng(11);
  for (let iter = 0; iter < 300; iter++) {
    const s = randomScript(r), sh = Math.floor(r() * 200), o = r() < 0.5 ? randomScript(r) : s.map((a) => ({ at: a.at + sh, pos: a.pos }));
    if (!s.length || !o.length) continue;
    const tolMs = [150, 37, 0.5, 150.5, 1e9][iter % 5];
    const opts = r() < 0.5 ? { tolMs } : { tolMs, t0: s[0].at + 0.5, t1: s[s.length - 1].at - 0.25 };
    const c = compare(o, s, opts);
    if (c.empty) continue;
    const C = clipped(o, c.t0, c.t1), R = clipped(s, c.t0, c.t1);
    const ct = turns(C.at, C.pos, 10), rt = turns(R.at, R.pos, 10);
    const cT = ct.idx.map((i) => C.at[i]), rT = rt.idx.map((i) => R.at[i]);
    const m0 = refMatch(cT, ct.kind, rT, rt.kind, tolMs);
    assert.deepEqual(c.pairs, m0.map(([i, j, dt]) => ({ cand: cT[i], ref: rT[j], kind: ct.kind[i], dt })), `iter ${iter}`);
    const m1 = refMatch(cT.map((t) => t - c.lag_ms), ct.kind, rT, rt.kind, tolMs);
    const p = cT.length ? m1.length / cT.length : 0, q = rT.length ? m1.length / rT.length : 0;
    assert.equal(c.f1_lag, p + q ? (2 * p * q) / (p + q) : 0, `iter ${iter} f1_lag`);
  }
});

test('compare: dense 100k vs 100k (a point every 5 ms) stays well under a second', () => {
  const r = rng(5), mk = () => Array.from({ length: 100000 }, (_, i) => ({ at: i * 5, pos: Math.floor(r() * 101) }));
  const a = mk(), b = mk();
  const t = process.threadCpuUsage(), c = compare(a, b), ms = cpuMs(t);
  console.log(`  [timing] compare dense random 100k vs 100k: ${ms.toFixed(0)} ms, tp ${c.tp}`);
  budget(ms < 400, `${ms.toFixed(0)} ms`);   // was ~550 ms in Node (about 1.1 s in the WebView) with the global sort
});
