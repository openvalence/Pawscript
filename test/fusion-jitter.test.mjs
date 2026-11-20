// paw-0sn8: fusion's jitter work -- the smoothing (fuse.jit.refine), the Top's genitals read against the Bottom (REL_ROWS),
// one stroke direction (fuse.jit.dir, off by default), the scene direction and each part's read in the explanation, and
// the per-shot controls surviving fuseClean. Synthetic scenes with a known stroke (test/fusion-synth.mjs JIT_CASES).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fusedChannel, FUSE } from '../src/lib/fusion.js';
import { fuseClean } from '../src/lib/rederive.js';
import { strokes, STROKES } from '../src/lib/strokes.js';
import { JIT_CASES, CASES, T, stroke } from './fusion-synth.mjs';

const OFF = { dir: false, rel: false, refine: 0 };   // the fusion before paw-0sn8
const fuse = (s, jit = null) => { const d0 = s.derives?.[0] || {}; return fusedChannel(s.run, { aspect: s.aspect, derives: [{ ...d0, ...(jit ? { fuse: { jit } } : {}) }] }); };
const corr = (a, b) => { let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0; for (let i = 0; i < a.length; i++) { const x = a[i], y = b[i]; if (!(x === x && y === y)) continue; n++; sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y; } return (sab - (sa * sb) / n) / Math.sqrt((saa - (sa * sa) / n) * (sbb - (sb * sb) / n)); };
const truth = T.map((_, i) => stroke(i));
/** frame-to-frame fuzz: robust std of the second difference over the signal's robust std */
const fuzz = (v) => { const d = [], a = []; for (let i = 1; i + 1 < v.length; i++) { d.push(Math.abs(v[i + 1] - 2 * v[i] + v[i - 1])); a.push(v[i]); } d.sort((x, y) => x - y); const m = a.reduce((s, x) => s + x, 0) / a.length, sd = Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); return d[d.length >> 1] / sd; };
/** mean |dt| of the points' turns against the truth's turns (matched within 100 ms) */
function turnErr(ch) {
  const pts = strokes(Float64Array.from(ch.t), Float64Array.from(ch.v), { ...STROKES, conf: ch.conf, timing: Float64Array.from(ch.timing) }).points;
  const tt = []; for (let i = 1; i + 1 < T.length; i++) if ((truth[i] - truth[i - 1]) * (truth[i + 1] - truth[i]) < 0) tt.push(T[i]);
  const e = []; for (const q of pts) { const d = Math.min(...tt.map((x) => Math.abs(x - q.at))); if (d <= 100) e.push(d); }
  return e.reduce((s, x) => s + x, 0) / e.length;
}

test('defaults: smoothing on, the genital rows on, one direction off', () => {
  assert.equal(FUSE.JIT.dir, false);
  assert.equal(FUSE.JIT.rel, true);
  assert.ok(FUSE.JIT.refine > 0);
});

test('the smoothing takes out frame fuzz and keeps the turns at least as close to the truth (every jitter case)', () => {
  for (const c of JIT_CASES) {
    if (c.id === 'j-across-sway') continue;   // the one case the default reading direction loses (see the dir test)
    const s = c.make(), a = fuse(s, OFF), b = fuse(s, { ...OFF, refine: FUSE.JIT.refine });
    assert.ok(fuzz(Array.from(b.v)) < fuzz(Array.from(a.v)), `${c.id}: fuzz ${fuzz(Array.from(b.v)).toFixed(3)} vs ${fuzz(Array.from(a.v)).toFixed(3)}`);
    assert.ok(turnErr(b) <= turnErr(a) + 3, `${c.id}: turn error ${turnErr(b).toFixed(1)} vs ${turnErr(a).toFixed(1)} ms`);
  }
});

test('smoothing off for a shot is the fusion as weighed (bit for bit the old signal when every candidate is off)', () => {
  const s = CASES[0].make(), a = fuse(s, OFF), b = fuse(s, { ...OFF });
  assert.deepEqual(Array.from(a.v), Array.from(b.v));
  const on = fuse(s, { ...OFF, refine: FUSE.JIT.refine });
  assert.notDeepEqual(Array.from(on.v), Array.from(a.v));
});

test('the Top sheath / knot ride the Top: read against the Bottom body, they carry a stroke the noisy Top hips cannot', () => {
  const s = JIT_CASES.find((c) => c.id === 'j-chain').make(), old = fuse(s, OFF), now = fuse(s);
  const lead = now.info[0].relations[0];
  assert.match(lead.label, /^Top sheath \/ knot ↔ Bottom body$/);
  assert.ok(corr(Array.from(now.v), truth) > corr(Array.from(old.v), truth) + 0.03, `r ${corr(Array.from(now.v), truth).toFixed(3)} vs ${corr(Array.from(old.v), truth).toFixed(3)}`);
  const knot = now.info[0].bodies.flatMap((b) => b.parts).find((p) => p.id === 'c2_knot');
  assert.ok(knot.say > 0.05, 'the knot counts in that row (a measure part elsewhere)');
  assert.equal(knot.rel, true);
  assert.equal(knot.vs, 'Bottom body');
  // the balls are not in it: they swing on their own (fusion's HOW reads that ring)
  assert.ok(!now.info[0].relations.some((r) => r.label.includes('balls') && r.label.includes('↔')), 'no balls in a relative genital row');
});

test('the scene direction: along the stroke in the picture, at the leading relationship, each part read with its along share', () => {
  const s = JIT_CASES.find((c) => c.id === 'j-chain').make(), inf = fuse(s).info[0];
  const u = inf.dir.u, ang = (Math.abs(Math.atan2(u[0] * -0.8 - u[1] * 0.6, u[0] * 0.6 + u[1] * -0.8)) * 180) / Math.PI;
  assert.ok(Math.min(ang, 180 - ang) < 8, `direction off by ${ang.toFixed(1)} deg`);
  assert.equal(inf.dir.from, 'lead');
  assert.deepEqual(inf.dir.contact.b.sort(), ['c1_hips', 'c1_torso']);
  for (const p of inf.bodies.flatMap((b) => b.parts)) assert.ok(p.dirCoh == null || (p.dirCoh >= 0 && p.dirCoh <= 1), p.id);
  assert.ok(inf.bodies.flatMap((b) => b.parts).find((p) => p.id === 'c2_sheath').dirCoh > 0.9);
  // a body against the frame reads as absolute
  const solo = fuse(CASES.find((c) => c.id === 'solo-untagged').make()).info[0];
  assert.ok(solo.bodies.flatMap((b) => b.parts).some((p) => p.vs != null));
});

test('one direction (fuse.jit.dir): a Top that sways across the stroke as much as it strokes no longer hides it', () => {
  const s = JIT_CASES.find((c) => c.id === 'j-across-sway').make(), old = fuse(s, OFF), dir = fuse(s, { dir: true });
  assert.ok(corr(Array.from(dir.v), truth) > 0.9, `dir r ${corr(Array.from(dir.v), truth).toFixed(3)}`);
  assert.ok(Math.abs(corr(Array.from(old.v), truth)) < 0.5, 'the reading of each relationship on its own main axis loses it');
  assert.equal(dir.info[0].dir.from, 'scene');
  assert.equal(dir.info[0].jit.dir, true);
});

test('fuseClean keeps the Signal chips only where they differ from the defaults', () => {
  assert.deepEqual(fuseClean({ jit: { dir: true } }), { jit: { dir: true } });
  assert.deepEqual(fuseClean({ jit: { refine: 0 } }), { jit: { refine: 0 } });
  assert.equal(fuseClean({ jit: { dir: false, refine: 0.15 } }), null);
  assert.deepEqual(fuseClean({ pad: { x: 0.5, y: 0 }, jit: { dir: true, refine: 0, junk: 1 } }), { pad: { x: 0.5, y: 0 }, jit: { dir: true, refine: 0 } });
});

