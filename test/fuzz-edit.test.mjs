// Property/fuzz tests for the edit ops: contract (normalised, input frozen/untouched), locality (FOLD/EDIT halo),
// idempotence and inverse pairs. Seeded (mulberry32) so a failure prints a reproducible seed + shrunk input.
// FUZZ_SEEDS=n scales the number of seeds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValid } from '../src/lib/core/script.js';
import { mulberry32, hashSeed } from '../src/lib/gen/util.js';
import { OPS } from '../src/lib/edit/index.js';
import { FOLD_HALO, EDIT_HALO, TIME_SHIFT_OPS } from '../src/lib/graph/nodes/index.js';

const SEEDS = Number(process.env.FUZZ_SEEDS) || 300;
const J = (x) => JSON.stringify(x);
const clone = (x) => JSON.parse(J(x));
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };

function randScript(rng, n = Math.floor(rng() * 40)) {
  const out = []; let t = Math.floor(rng() * 500);
  for (let i = 0; i < n; i++) {
    out.push({ at: t, pos: Math.floor(rng() * 101) });
    t += 1 + Math.floor(rng() < 0.2 ? rng() * 30 : rng() < 0.9 ? 30 + rng() * 600 : 2000 + rng() * 4000);
  }
  return out;
}
function randParams(op, rng) {
  const p = {};
  for (const q of op.params) {
    if (rng() < 0.4) continue; // leave default
    if (q.type === 'number') {
      const lo = Math.max(q.min, -3000), hi = Math.min(q.max, 5000);
      p[q.key] = lo + rng() * (hi - lo);
      if (rng() < 0.5 || op.playhead === q.key) p[q.key] = Math.round(p[q.key]);
    } else if (q.type === 'bool') p[q.key] = rng() < 0.5;
    else if (q.type === 'choice') p[q.key] = q.choices[Math.floor(rng() * q.choices.length)];
  }
  return p;
}
function randSel(s, rng) {
  const k = rng();
  if (k < 0.25 || !s.length) return null;
  const end = s[s.length - 1].at + 500;
  if (k < 0.65) { const a = Math.floor(rng() * end); return { t0: a, t1: a + Math.floor(rng() * 4000) }; }
  return { ats: s.filter(() => rng() < 0.3).map((a) => a.at) };
}
/** shrink a failing script by dropping points while `fails` still holds */
function shrink(s, fails) {
  let cur = s;
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < cur.length; i++) {
      const c = cur.slice(0, i).concat(cur.slice(i + 1));
      if (fails(c)) { cur = c; changed = true; i--; }
    }
  }
  return cur;
}

const isSelOp = (o) => o.group === 'select' || o.selection;
const edits = OPS.filter((o) => !isSelOp(o));

for (const op of OPS) {
  test(`fuzz ${op.id}: output normalised, input untouched, no throw`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const rng = mulberry32(hashSeed('edit', op.id, seed));
      const s = randScript(rng), sel = randSel(s, rng), params = randParams(op, rng);
      if (op.id === 'minSpacing' && params.minGapMs) params.minGapMs = Math.round(params.minGapMs); // fractional gaps: see the TODO test below
      const snap = J(s);
      const run = (sc) => op.apply(deepFreeze(clone(sc)), deepFreeze(clone(sel)), params);
      const bad = (sc) => {
        try {
          const r = run(sc);
          if (!Array.isArray(r.ats)) return true;
          if (isSelOp(op)) return r.ats.some((t) => !sc.some((a) => a.at === t));
          return !isValid(r.script);
        } catch { return true; }
      };
      if (bad(s)) {
        const m = shrink(s, bad);
        let why; try { const r = run(m); why = isSelOp(op) ? J(r.ats) : J(r.script); } catch (e) { why = `THROW ${e.message}`; }
        assert.fail(`${op.id} seed ${seed} params ${J(params)} sel ${J(sel)} input ${J(m)} -> ${why}`);
      }
      assert.equal(J(s), snap);
    }
  });
}

// ---- locality: with a range selection, output outside [t0-h, t1+h] equals input there
const haloOf = (op, p) => {
  const f = FOLD_HALO[op.id] ?? EDIT_HALO[op.id];
  return f ? Number(f({ ...Object.fromEntries(op.params.map((q) => [q.key, q.default])), ...p })) : Infinity;
};
for (const op of edits.filter((o) => !TIME_SHIFT_OPS.includes(o.id) && Number.isFinite(haloOf(o, {})))) {
  test(`fuzz ${op.id}: nothing outside selection +- halo changes`, () => {
    for (let seed = 0; seed < SEEDS * 2; seed++) {
      const rng = mulberry32(hashSeed('halo', op.id, seed));
      const s = randScript(rng, 5 + Math.floor(rng() * 40));
      const a = Math.floor(rng() * s[s.length - 1].at), b = a + 50 + Math.floor(rng() * 3000);
      const p = randParams(op, rng), h = haloOf(op, p);
      if (!Number.isFinite(h)) continue;
      const sel = { t0: a, t1: b - 1 }; // the fold's range convention
      const outside = (sc) => sc.filter((x) => x.at < a - h || x.at > b + h);
      const fails = (sc) => J(outside(sc)) !== J(outside(op.apply(sc, sel, p).script));
      if (fails(s)) {
        const m = shrink(s, fails);
        assert.fail(`${op.id} seed ${seed} sel ${J(sel)} halo ${h} params ${J(p)} input ${J(m)} -> ${J(op.apply(m, sel, p).script)}`);
      }
    }
  });
}

// ---- idempotence / inverse pairs
const run = (id, s, p, sel = null) => OPS.find((o) => o.id === id).apply(s, sel, p).script;
const IDEMPOTENT = {
  quantize: (r) => ({ frameMs: 10 + Math.floor(r() * 90) }),
  limitRange: (r) => ({ lo: Math.floor(r() * 50), hi: 50 + Math.floor(r() * 51), mode: 'clamp' }),
  setPos: (r) => ({ pos: Math.floor(r() * 101) }),
  thinMinGap: (r) => ({ minGapMs: 20 + Math.floor(r() * 300), keep: 'first' }),
  capSpeed: (r) => ({ maxSpeed: 100 + Math.floor(r() * 800), method: 'pull' }),
  minSpacing: (r) => ({ minGapMs: 20 + Math.floor(r() * 300), method: 'drop' }),
  keepExtremes: () => ({}),
  removeMicroReversals: (r) => ({ threshold: 1 + Math.floor(r() * 10) }),
  normalise: () => ({}),
  remapRange: (r) => ({ lo: Math.floor(r() * 40), hi: 60 + Math.floor(r() * 41) }),
};
for (const [id, mk] of Object.entries(IDEMPOTENT)) {
  test(`fuzz ${id}: idempotent`, () => {
    for (let seed = 0; seed < SEEDS * 2; seed++) {
      const rng = mulberry32(hashSeed('idem', id, seed));
      const s = randScript(rng, 2 + Math.floor(rng() * 40)), p = mk(rng);
      const fails = (sc) => { const o1 = run(id, sc, p); return J(run(id, o1, p)) !== J(o1); };
      if (fails(s)) {
        const m = shrink(s, fails), o1 = run(id, m, p);
        assert.fail(`${id} seed ${seed} params ${J(p)} input ${J(m)} -> once ${J(o1)} twice ${J(run(id, o1, p))}`);
      }
    }
  });
}
const INVERSE = {
  'invert twice': (s) => run('invert', run('invert', s, {}), {}),
  'reverse twice': (s) => run('reverse', run('reverse', s, {}), {}),
  'shift then unshift': (s, r) => { const dt = Math.floor(r() * 3000); return run('shift', run('shift', s, { dt }), { dt: -dt }); },
  'move then unmove': (s, r) => { const dt = Math.floor(r() * 3000); return run('move', run('move', s, { dt }), { dt: -dt }); },
  'stretch 2 then 0.5': (s) => run('stretch', run('stretch', s, { factor: 2 }), { factor: 0.5 }),
};
for (const [name, fn] of Object.entries(INVERSE)) {
  test(`fuzz inverse: ${name}`, () => {
    for (let seed = 0; seed < SEEDS * 2; seed++) {
      const rng = mulberry32(hashSeed('inv', name, seed));
      const s = randScript(rng, 1 + Math.floor(rng() * 30)), rs = rng();
      const f = (sc) => fn(sc, mulberry32(hashSeed(seed, rs)));
      if (J(f(s)) !== J(s)) {
        const m = shrink(s, (sc) => J(f(sc)) !== J(sc));
        assert.fail(`${name} seed ${seed} input ${J(m)} -> ${J(f(m))}`);
      }
    }
  });
}

// ---- guarantees the op titles promise (whole script)
const PROMISES = {
  'capSpeed pull: no step above maxSpeed': (s, r) => { const maxSpeed = 50 + Math.floor(r() * 900); const o = run('capSpeed', s, { maxSpeed, method: 'pull' }); return o.every((a, i) => !i || Math.abs(a.pos - o[i - 1].pos) * 1000 / (a.at - o[i - 1].at) <= maxSpeed + 1e-9); },
  'capSpeed retime: no step above maxSpeed': (s, r) => { const maxSpeed = 50 + Math.floor(r() * 900); const o = run('capSpeed', s, { maxSpeed, method: 'retime' }); return isValid(o) && o.every((a, i) => !i || Math.abs(a.pos - o[i - 1].pos) * 1000 / (a.at - o[i - 1].at) <= maxSpeed + 1e-9); },
  'minSpacing push (int gap): all gaps >= minGapMs': (s, r) => { const minGapMs = 1 + Math.floor(r() * 400), ripple = r() < 0.5; const o = run('minSpacing', s, { minGapMs, method: 'push', ripple }); return isValid(o) && o.every((a, i) => !i || a.at - o[i - 1].at >= minGapMs); },
  'thinMinGap: all gaps >= minGapMs': (s, r) => { const minGapMs = 1 + Math.floor(r() * 400); const o = run('thinMinGap', s, { minGapMs, keep: r() < 0.5 ? 'first' : 'extreme' }); return isValid(o) && o.every((a, i) => !i || a.at - o[i - 1].at >= minGapMs); },
  'quantize: every time on the grid': (s, r) => { const frameMs = 5 + Math.floor(r() * 95); const o = run('quantize', s, { frameMs }); return isValid(o) && o.every((a) => Math.abs(a.at / frameMs - Math.round(a.at / frameMs)) < 1e-6 || Math.abs(Math.round(a.at / frameMs) * frameMs - a.at) <= 0.5); },
  'limitRange clamp: positions inside [lo,hi]': (s, r) => { const lo = Math.floor(r() * 50), hi = lo + Math.floor(r() * 50); const o = run('limitRange', s, { lo, hi, mode: 'clamp' }); return o.every((a) => a.pos >= lo && a.pos <= hi) && o.length === s.length; },
};
// a fractional minGapMs (graph param) must still give integer `at` (cascadeRetime rounds up)
PROMISES['minSpacing push ripple, fractional gap: valid'] = (s, r) => { const minGapMs = 1 + r() * 400; return isValid(run('minSpacing', s, { minGapMs, method: 'push', ripple: true })); };
for (const [name, fn] of Object.entries(PROMISES)) {
  test(`fuzz promise: ${name}`, () => {
    for (let seed = 0; seed < SEEDS * 2; seed++) {
      const rng = mulberry32(hashSeed('promise', name, seed));
      const s = randScript(rng, 2 + Math.floor(rng() * 40)), rs = rng();
      const ok = (sc) => { try { return fn(sc, mulberry32(hashSeed(seed, rs))); } catch { return false; } };
      if (!ok(s)) { const m = shrink(s, (sc) => !ok(sc)); assert.fail(`${name} seed ${seed} (rng arg ${rs}) input ${J(m)}`); }
    }
  });
}
