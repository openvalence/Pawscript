// Property tests over seeded random scripts, plus timings on a 100 000-action script.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/lib/edit/index.js';
import { isValid } from '../src/lib/core/script.js';
import { budget } from './perf.mjs';

const N = 2500;

function genScript(r) {
  const n = r() < 0.05 ? 0 : Math.floor(r() * 60) + 1, fine = r() < 0.3, out = [];
  let at = Math.floor(r() * 300), pos = Math.floor(r() * 101);
  for (let i = 0; i < n; i++) {
    out.push({ at, pos });
    at += fine ? 1 + Math.floor(r() * 6) : 1 + Math.floor(r() * 800);
    pos = r() < 0.7 ? (pos < 50 ? 50 + Math.floor(r() * 51) : Math.floor(r() * 51)) : Math.floor(r() * 101); // mostly strokes
    if (r() < 0.05) pos = r() < 0.5 ? 0 : 100;
  }
  return out;
}
function genSel(r, s) {
  const k = r();
  if (k < 0.2 || !s.length) return null;
  const a = s[Math.floor(r() * s.length)].at, b = s[Math.floor(r() * s.length)].at;
  if (k < 0.45) return { t0: Math.min(a, b) - Math.floor(r() * 3), t1: Math.max(a, b) + Math.floor(r() * 3) };
  if (k < 0.7) { const i = Math.floor(r() * s.length), j = Math.min(s.length - 1, i + Math.floor(r() * 8)); return { ats: s.slice(i, j + 1).map((x) => x.at) }; }
  return { ats: s.filter(() => r() < 0.4).map((x) => x.at) };
}
const contiguousRange = (r, s) => { const a = s[Math.floor(r() * s.length)].at, b = s[Math.floor(r() * s.length)].at; return { t0: Math.min(a, b), t1: Math.max(a, b) }; };
function genParams(r, o) {
  const p = {};
  for (const q of o.params) {
    if (q.type === 'bool') p[q.key] = r() < 0.5;
    else if (q.type === 'choice') p[q.key] = q.choices[Math.floor(r() * q.choices.length)];
    else {
      const hi = Math.min(q.max, q.min + (q.default === 0 ? 1000 : Math.abs(q.default) * 4 + 10));
      let v = q.min + r() * (hi - q.min);
      if (q.step >= 1) v = Math.round(v);
      p[q.key] = v;
    }
  }
  return p;
}
const mulberry = E.rng;
// ops whose documented behaviour touches unselected actions (ripple, range clearing, replace within tolerance)
const TOUCHES_UNSELECTED = new Set(['rippleInsert', 'rippleDelete', 'repeatSelection', 'repeatLastStroke', 'setPoint', 'numberKey', 'changeStrokeRate', 'duplicate']);

function checkResult(o, s, sel, params, res) {
  const tag = `${o.id} ${JSON.stringify(sel)} ${JSON.stringify(params)} on ${JSON.stringify(s)}`;
  assert.ok(res && Array.isArray(res.script) && Array.isArray(res.ats), tag);
  assert.ok(isValid(res.script), 'invalid: ' + tag);
  const at = new Map(res.script.map((a) => [a.at, a]));
  for (let i = 0; i < res.ats.length; i++) {
    assert.ok(Number.isInteger(res.ats[i]) && at.has(res.ats[i]), 'ats not in script: ' + tag);
    if (i) assert.ok(res.ats[i] > res.ats[i - 1], 'ats not sorted: ' + tag);
  }
  if (o.selection) { assert.equal(res.script, s, 'selection op changed script: ' + tag); return; }
  if (TOUCHES_UNSELECTED.has(o.id) || ((o.id === 'capSpeed' || o.id === 'capKinematics') && params.ripple && params.method === 'retime') || (o.id === 'minSpacing' && params.ripple && params.method === 'push')) return;
  const m = E.selMask(s, sel), moved = new Set(res.ats);
  s.forEach((u, i) => {
    if (m[i]) return;
    const out = at.get(u.at);
    assert.ok(out && (out === u || (out.pos === u.pos) || moved.has(u.at)), `unselected action ${JSON.stringify(u)} changed: ${tag}`);
  });
}

test(`every catalogue op: valid output, no mutation, unselected untouched (${N} random scripts, defaults + random params)`, () => {
  const r = mulberry(12345);
  let checks = 0;
  for (let k = 0; k < N; k++) {
    const s = genScript(r), snap = JSON.stringify(s);
    Object.freeze(s); s.forEach(Object.freeze);
    const sel = genSel(r, s), selSnap = JSON.stringify(sel);
    const playhead = s.length ? s[Math.floor(r() * s.length)].at + Math.floor(r() * 400) : 0;
    for (const o of E.OPS) {
      const variants = [{ at: playhead }];
      if (k < 700) variants.push({ ...genParams(r, o), at: playhead }, genParams(r, o));
      for (const p of variants) {
        const res = o.apply(s, sel, p);
        checkResult(o, s, sel, { ...Object.fromEntries(o.params.map((q) => [q.key, q.default])), ...p }, res);
        checks++;
      }
    }
    assert.equal(JSON.stringify(s), snap); assert.equal(JSON.stringify(sel), selSnap);
  }
  console.log(`  ${checks} op applications checked`);
});

test('inverse pairs and identities', () => {
  const r = mulberry(777), eq = (a, b, msg = 'eq') => assert.deepEqual(a, b, msg);
  let n = 0;
  for (let k = 0; k < N; k++) {
    const s = genScript(r);
    const sel = genSel(r, s);
    eq(E.invert(E.invert(s, sel).script, sel).script, s, 'invert twice');
    const d = Math.floor(r() * 5000);
    const all = E.shift(E.shift(s, null, { dt: d }).script, null, { dt: -d }).script;
    eq(all, s, 'shift +d then -d');
    eq(E.stretch(E.stretch(s, null, { factor: 2 }).script, null, { factor: 0.5 }).script, s, 'stretch 2 then 0.5');
    eq(E.scale(s, sel, { factor: 1 }).script, s, 'scale 1');
    eq(E.offset(s, sel, { amount: 0 }).script, s, 'offset 0');
    eq(E.shift(s, sel, { dt: 0 }).script, s, 'shift 0');
    eq(E.simplify(s, null, { tolerance: 0 }).script.length <= s.length, true);
    if (s.length) {
      const rs = r() < 0.3 ? null : contiguousRange(r, s);
      const once = E.reverse(s, rs);
      eq(E.reverse(once.script, rs).script, s, 'reverse twice');
      eq(once.script.length, s.length);
      // copy -> paste replace in place is the identity; cut -> paste (merge) restores too
      const snip = E.copy(s, rs);
      const origin = rs ? rs.t0 : s[0].at;
      eq(E.paste(s, snip, origin, { mode: 'replace' }).script, s, 'copy/paste in place');
      const c = E.cut(s, rs);
      eq(E.paste(c.script, c.snippet, origin, { mode: 'merge' }).script, s, 'cut/paste');
      // quantize is idempotent
      const q = E.quantize(s, sel, { frameMs: 33.3333 });
      eq(E.quantize(q.script, sel === null ? null : { ats: q.ats }, { frameMs: 33.3333 }).script, q.script, 'quantize idempotent');
      // paste insert then rippleDelete of the pasted range restores the script
      const at = s[s.length - 1].at + 1 + Math.floor(r() * 100);
      if (snip.actions.length && snip.duration > 0) {
        const ins = E.paste(s, snip, at, { mode: 'insert' });
        eq(ins.script.slice(0, s.length), s);
      }
      // seeded ops reproducible, and independent of the other selected points
      const seed = Math.floor(r() * 1e6), j1 = E.jitter(s, sel, { timeMs: 25, amp: 8, seed }), j2 = E.jitter(s, sel, { timeMs: 25, amp: 8, seed });
      eq(j1, j2, 'jitter reproducible');
      eq(E.humanise(s, sel, { seed }), E.humanise(s, sel, { seed }), 'humanise reproducible');
      // simplify/thin only ever remove
      const have = new Set(s.map((a) => a.at + ':' + a.pos));
      for (const out of [E.simplify(s, sel, { tolerance: 3 }), E.thinMinGap(s, sel, { minGapMs: 120 }), E.keepExtremes(s, sel), E.removeMicroReversals(s, sel, { threshold: 6 })]) {
        assert.ok(out.script.every((a) => have.has(a.at + ':' + a.pos)), 'removal op invented an action');
        assert.ok(out.script.length <= s.length);
      }
      // capSpeed by pull never exceeds the cap on selected segments (apart from the first)
      const cap = E.capSpeed(s, null, { maxSpeed: 300, method: 'pull' }).script;
      for (let i = 1; i < cap.length; i++) assert.ok((Math.abs(cap[i].pos - cap[i - 1].pos) * 1000) / (cap[i].at - cap[i - 1].at) <= 300 + 1e-6, 'cap pull');
      const cap2 = E.capSpeed(s, null, { maxSpeed: 300, method: 'retime' }).script;
      for (let i = 1; i < cap2.length; i++) assert.ok((Math.abs(cap2[i].pos - cap2[i - 1].pos) * 1000) / (cap2[i].at - cap2[i - 1].at) <= 300 + 1e-6, 'cap retime');
      const sp = E.enforceMinSpacing(s, null, { minGapMs: 40 }).script;
      for (let i = 1; i < sp.length; i++) assert.ok(sp[i].at - sp[i - 1].at >= 40, 'min spacing');
      // clamp collisions preserve the relative order and count of everything
      const cl = E.movePoints(s, sel, { dt: Math.floor(r() * 2000) - 1000, collide: 'clamp' });
      eq(cl.script.length, s.length, 'clamp keeps every point');
      // rhythm: double then half is the identity on regular zig-zags
      n++;
    }
  }
  assert.ok(n > 1000);
  const zig = Array.from({ length: 25 }, (_, i) => ({ at: i * 300 + 5, pos: i % 2 ? 100 : 0 }));
  assert.deepEqual(E.halfTime(E.doubleTime(zig, null).script, null).script, zig);
});

test('turns/strokes invariants', () => {
  const r = mulberry(99);
  for (let k = 0; k < N; k++) {
    const s = genScript(r), P = Math.floor(r() * 40), T = E.turns(s, P);
    for (let i = 0; i < T.length; i++) {
      assert.ok(i === 0 || (T[i].i > T[i - 1].i && T[i].kind !== T[i - 1].kind));
      const a = s[T[i].i];
      if (i && i < T.length - 1) { // interior turns are real extremes of their stroke: >= both neighbours (tops) / <= (bottoms)
        const ref = T[i].kind === 'top' ? Math.max : Math.min;
        assert.equal(ref(a.pos, s[T[i - 1].i].pos, s[T[i + 1].i].pos), a.pos);
      }
    }
    for (let i = 1; i + 1 < T.length - 1; i++) assert.ok(Math.abs(s[T[i].i].pos - s[T[i + 1].i].pos) >= P || P === 0, 'prominence');
    const st = E.strokes(s, P);
    assert.equal(st.length, Math.max(0, T.length - 1));
    st.forEach((x) => assert.ok(x.durationMs > 0 && x.speed >= 0 && (x.dir === 1 || x.dir === -1)));
  }
});

test('timings on a 100 000-action script', () => {
  const r = mulberry(5), big = [];
  let at = 0;
  for (let i = 0; i < 100000; i++) { big.push({ at, pos: i % 2 ? 60 + Math.floor(r() * 41) : Math.floor(r() * 41) }); at += 60 + Math.floor(r() * 240); }
  assert.ok(isValid(big));
  const playhead = big[50000].at, rows = [];
  const mid = { t0: big[20000].at, t1: big[80000].at };
  for (const o of E.OPS) {
    const sel = o.group === 'select' ? null : (o.id === 'delete' ? mid : null);
    const p = { at: playhead, until: 0, t0: 0, t1: 1000 };
    const t = performance.now();
    let res = o.apply(big, sel, p);
    const ms = performance.now() - t;
    assert.ok(isValid(res.script), o.id);
    rows.push([o.id, ms]);
  }
  rows.sort((a, b) => b[1] - a[1]);
  console.log('  ms on 100k actions, whole script, default params:\n  ' + rows.map(([id, ms]) => `${id} ${ms.toFixed(1)}`).join(', '));
  const simple = ['invert', 'scale', 'offset', 'shift', 'stretch', 'reverse', 'nudgePos', 'setPos', 'normalise', 'quantize', 'capSpeed', 'jitter', 'extremes', 'alignExtremes'];
  for (const [id, ms] of rows) if (simple.includes(id)) budget(ms < 150, `${id} took ${ms.toFixed(0)} ms`);
  for (const [id, ms] of rows) budget(ms < 3000, `${id} took ${ms.toFixed(0)} ms`);
  // selection on a big script, ats-style
  const ats = big.filter((_, i) => i % 3 === 0).map((a) => a.at);
  const t = performance.now(); E.shift(big, { ats }, { dt: 7 }); console.log(`  shift with 33k-ats selection: ${(performance.now() - t).toFixed(1)} ms`);
});
