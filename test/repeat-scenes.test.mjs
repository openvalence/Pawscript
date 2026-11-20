// paw-ef73.4: the repeated frames as evidence for the scene structure (src/features/timeline/repeat-scenes.js) on
// synthetic picture sequences, and the app side (repeat-offers.svelte.js) on the real shell store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexRepeats } from '../src/features/timeline/repeats.js';
import { falseMoves, cutSnaps, sameFootage, autoLoops, shotPictures } from '../src/features/timeline/repeat-scenes.js';

const FM = 100;   // 10 fps
/** A picture string -> the backend's repeats ({frames, buckets}): one letter a picture, the same letter again later =
 *  the same picture, a run of one letter = a held picture (one occurrence), '.' = a picture seen once. */
function seq(s) {
  const occ = new Map();
  for (let f = 0; f < s.length; f++) {
    const c = s[f];
    if (c === '.') continue;
    const list = occ.get(c) || [];
    if (f > 0 && s[f - 1] === c) list.at(-1).f1 = f; else list.push({ f0: f, f1: f, t_ms: f * FM });
    occ.set(c, list);
  }
  return indexRepeats({ frames: s.length, exact: 1, buckets: [...occ.values()].filter((l) => l.length > 1) });
}
const S = (f0, f1, x = {}) => ({ start_ms: f0 * FM, end_ms: f1 * FM, ...x });
const cam = { join: true, split: 'camera' };

test('a camera move inside one loop, phase continuous, is a false one (exact): at the wrap and inside a pass', () => {
  const ix = seq('ABCD'.repeat(6));
  assert.deepEqual(falseMoves(ix, [S(0, 12), S(12, 24, cam)], FM).map((x) => [x.i, x.exact, x.loop]), [[1, true, 0]]);   // D | A: last member to first, next pass
  assert.equal(falseMoves(ix, [S(0, 13), S(13, 24, cam)], FM)[0].exact, true);   // A | B: the next member, same pass
  // a held picture across the boundary: the picture does not change there at all
  assert.equal(falseMoves(seq('AABBCC'.repeat(4)), [S(0, 7), S(7, 24, cam)], FM)[0].exact, true);
});

test('weaker evidence is an offer, not exact: two different loops meet, or only the shots share pictures; no evidence: nothing', () => {
  const two = seq('ABC'.repeat(4) + 'DEF'.repeat(4));
  assert.deepEqual(falseMoves(two, [S(0, 12), S(12, 24, cam)], FM).map((x) => x.exact), [false]);   // C | D: both repeat, other loops
  const shared = seq('ABCDABCD..' + 'ABCDABCD');
  const w = falseMoves(shared, [S(0, 10), S(10, 18, cam)], FM);
  assert.deepEqual(w.map((x) => [x.exact, x.n]), [[false, 4]]);   // a unique picture before the move, but 4 pictures in common
  assert.deepEqual(falseMoves(seq('..........'), [S(0, 5), S(5, 10, cam)], FM), []);
  // only camera moves count: a hard cut inside the same loop is a cut snap's business, not this rule's
  assert.deepEqual(falseMoves(seq('ABCD'.repeat(6)), [S(0, 12), S(12, 24, { join: true })], FM), []);
  assert.deepEqual(falseMoves(null, [S(0, 12), S(12, 24, cam)], FM), []);
});

test('a hard cut 1-2 frames off: the frames before it show the next shot (snap earlier), or the frames after it the previous one (later)', () => {
  // the next shot's cycle DEF starts 2 frames before the detected cut at frame 11
  const early = seq('ABCABCABC' + 'DE' + 'FDEFDEFDEF');
  assert.deepEqual(cutSnaps(early, [S(0, 11), S(11, 21)], FM).map((c) => [c.i, c.d, c.to]), [[1, -2, 900]]);
  // the previous shot's ABC goes on 2 frames after the detected cut at frame 9
  const late = seq('ABCABCABC' + 'AB' + 'DEFDEFDEF');
  assert.deepEqual(cutSnaps(late, [S(0, 9), S(9, 20)], FM).map((c) => [c.d, c.to]), [[2, 1100]]);
  // on the right frame: no snap; a camera move is never snapped
  const right = seq('ABCABCABC' + 'DEFDEFDEF');
  assert.deepEqual(cutSnaps(right, [S(0, 9), S(9, 18)], FM), []);
  assert.deepEqual(cutSnaps(early, [S(0, 11), S(11, 21, cam)], FM), []);
  // 3 frames off is beyond the rule (max 2)
  assert.deepEqual(cutSnaps(seq('ABCABCABC' + 'DEF' + 'DEFDEFDEF'), [S(0, 12), S(12, 21)], FM).map((c) => c.d), [-2]);
});

test('shots in different scenes that share >= 3 pictures are the same footage; 2 are not; one scene already: nothing', () => {
  const ix = seq('ABCDABCD' + 'xyzw'.split('').join('.') + 'ABCDAB');
  const L = [S(0, 8), S(8, 15), S(15, 21)];
  assert.deepEqual(sameFootage(ix, L, FM), [{ a: 0, b: 2, n: 4 }]);
  assert.deepEqual(sameFootage(ix, [S(0, 8), S(8, 15), S(15, 21, { join: true })], FM), [{ a: 0, b: 2, n: 4 }]);   // shot 2 in shot 1's scene
  assert.deepEqual(sameFootage(ix, [S(0, 8), S(8, 15, { join: true }), S(15, 21, { join: true })], FM), []);   // one scene
  assert.deepEqual(sameFootage(seq('ABAB....AB'), [S(0, 4), S(4, 8), S(8, 10)], FM), []);   // 2 pictures only
  assert.deepEqual(shotPictures(ix, L, FM).map((s) => s.size), [4, 0, 4]);
});

test('loops marked: back-to-back passes (>= 3) at a steady period; two passes or a reuse far away are not; overlapping runs keep the richer loop', () => {
  assert.deepEqual(autoLoops(seq('ABCD'.repeat(5)), FM).map((l) => [l.t0, l.t1, l.end, l.n, l.members]), [[0, 400, 2000, 5, 4]]);
  assert.deepEqual(autoLoops(seq('ABCD'.repeat(2) + '......'), FM), []);   // twice: not a cycle yet
  // three passes, then the same pictures once more much later: the run is the three passes
  assert.deepEqual(autoLoops(seq('ABCD'.repeat(3) + '.'.repeat(40) + 'ABCD'), FM).map((l) => [l.t0, l.end, l.n]), [[0, 1200, 3]]);
  // J and K come back once more later (5 occurrences, another findLoops loop over the same passes): A..H's loop wins
  const ix = seq('ABCDEFGHJK'.repeat(4) + '.'.repeat(30) + 'JK');
  assert.equal(ix.loops.length, 2);
  assert.deepEqual(autoLoops(ix, FM).map((l) => [l.t0, l.n, l.members]), [[0, 4, 8]]);
  // a slowly changing tempo is still one run (each gap within 10 % / 2 frames of the one before)
  const drift = seq('ABCD' + 'ABCD.' + 'ABCD..' + 'ABCD..');
  assert.deepEqual(autoLoops(drift, FM).map((l) => l.n), [4]);
});

test('paw-fc0r: a marked loop ends where its pictures stop: a last pass cut short no longer reaches across the cut', () => {
  // ABCDEFGH x3, then the cycle cut after its 3rd picture (ABC) and new footage XYZ x4 from frame 27. A B C occur once
  // more than D..H, so findLoops makes D..H the loop: its run ends with H at frame 23
  const [a, x] = autoLoops(seq('ABCDEFGH'.repeat(3) + 'ABC' + 'XYZ'.repeat(4)), FM);
  assert.deepEqual([a.t0, a.t1, a.end, a.n], [300, 1100, 2400, 3]);   // was end 2700: the last pass + one cycle, past H
  assert.deepEqual([x.t0, x.end], [2700, 3900]);
  // a whole last pass: unchanged
  assert.deepEqual(autoLoops(seq('ABCD'.repeat(5)), FM).map((l) => [l.t0, l.end]), [[0, 2000]]);
});

test('app: Detect-time join, the offers, automatic loops (marked once, removable in one press, never over the owner\'s)', async () => {
  const { fileURLToPath } = await import('node:url');
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  try {
    const M = await server.ssrLoadModule('/dev/mock-app.js');
    const RS = await server.ssrLoadModule('/src/features/timeline/repeats.svelte.js');
    const O = await server.ssrLoadModule('/src/features/timeline/repeat-offers.svelte.js');
    const A = await server.ssrLoadModule('/src/features/timeline/loop-actions.js');
    // 'ABCD' x6 (2.4 s) then 'EFG' x4 (1.2 s); the owner's own loop at 2.6-2.9 s
    const pics = 'ABCD'.repeat(6) + 'EFG'.repeat(4), r = { frames: pics.length, exact: 1, buckets: seq(pics).buckets.map((b) => b.occ.map((o) => ({ f0: o.f0, f1: o.f1, t_ms: o.t }))) };
    const backend = { ...M.mockBackend(), frameRepeats: () => ({ promise: Promise.resolve(r), cancel() {} }) };
    const doc = { ...M.sampleDoc({ minutes: 1 }), media: { path: 'v.mp4', durationMs: 60000, fps: 10 }, loops: [{ id: 'mine', t0: 2600, t1: 2900 }], ghosts: [],
      scenes: [S(0, 12), S(12, 24, cam), S(24, 36, { join: true })] };
    const app = M.createMockApp({ doc, keys: false, backend });
    app.player.frameMs = FM;
    RS.loadRepeats(app);
    await new Promise((res) => setTimeout(res, 0));
    assert.ok(RS.repeatsOf(app));
    // the camera move at 1.2 s is inside the ABCD loop: joined, one undo step
    assert.equal(O.joinLoopMoves(app), 1);
    assert.deepEqual(app.doc.scenes.map((s) => [s.start_ms, s.end_ms]), [[0, 2400], [2400, 3600]]);
    app.undo();
    assert.equal(app.doc.scenes.length, 3);
    // the same boundary is now a one-press offer (repeats arrived after Detect, say)
    const of = O.offersOf(app).find((o) => o.kind === 'join');
    assert.equal(of.t, 1200);
    O.takeOffer(app, of);
    assert.equal(app.doc.scenes.length, 2);
    app.undo();
    O.dropOffer(app, O.offersOf(app).find((o) => o.kind === 'join'));
    assert.equal(O.offersOf(app).filter((o) => o.kind === 'join').length, 0);
    // loops: ABCD marked; EFG would overlap the owner's loop at 2.6 s: left alone
    assert.equal(O.markAutoLoops(app), 1);
    const auto = app.doc.loops.find((l) => l.auto);
    assert.deepEqual([auto.t0, auto.t1, auto.auto.end, auto.auto.n], [0, 400, 2400, 6]);
    assert.ok(app.doc.loops.some((l) => l.id === 'mine' && !l.auto));
    assert.ok(O.isAutoLoop(auto));
    assert.equal(O.isAutoLoop({ ...auto, t1: 500 }), false);   // resized by the owner: theirs
    assert.equal(O.markAutoLoops(app), 0);   // once per video and session
    // one press removes it; it is not marked again for this project
    O.removeAutoLoops(app, [auto.id]);
    assert.ok(!app.doc.loops.some((l) => l.auto));
    assert.deepEqual(app.doc.repeats.off, [auto.auto.key]);
    app.undo();
    A.deleteLoop(app, auto.id);   // Delete on it does the same
    assert.deepEqual(app.doc.repeats.off, [auto.auto.key]);
  } finally { await server.close(); }
});
