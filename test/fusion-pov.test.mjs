// paw-5ynj: on a POV shot the camera owner's own hips (a sliver at the frame's bottom edge, leading the shaft) must not time
// the contact row 'Bottom head <-> Top penis / hips': the fused turns land on the shaft's, and shots without an edge sliver
// do not change at all (experiments/fusion/pov.mjs: the full matrix).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fusedChannel, FUSE } from '../src/lib/fusion.js';
import { povScene, CASES } from './fusion-synth.mjs';
import { turnErr } from '../experiments/fusion/pov.mjs';

const without = (f) => { const e = FUSE.EDGE; FUSE.EDGE = null; try { return f(); } finally { FUSE.EDGE = e; } };

test('POV: the edge hips no longer pull the fused turns early', () => {
  const s = () => povScene({ leadMs: 120, hipsAmp: 0.02 });
  const before = without(() => turnErr(s())), after = turnErr(s());
  assert.ok(before.err < -1, `the reproduction: turns early before (${before.err.toFixed(2)} frames)`);
  assert.ok(Math.abs(after.err) < 0.4, `turns on the shaft's (${after.err.toFixed(2)} frames)`);
  assert.equal(after.F1, 1);
  const ch = fusedChannel(s().run, { aspect: 16 / 9, derives: [{ acts: ['oral', 'penetration'] }] });
  const hips = ch.info[0].bodies.flatMap((b) => b.parts).find((p) => p.id === 'c2_hips');
  assert.ok(hips.inBody < 0.1, `the sliver has little say in its body (${hips.inBody})`);
});

test('no edge sliver: fusion is bit-identical with the edge rule on or off', () => {
  for (const id of ['fellatio-head', 'handjob', 'more-parts']) {
    const c = CASES.find((x) => x.id === id), d = (s) => fusedChannel(s.run, { aspect: s.aspect, derives: s.derives });
    const a = without(() => d(c.make())), b = d(c.make());
    assert.deepEqual(Array.from(b.v), Array.from(a.v), id);
    assert.deepEqual(Array.from(b.timing), Array.from(a.timing), id);
  }
});
