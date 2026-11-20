// paw-ef73.3: fades / dissolves on the timeline (features/timeline/transitions.js): pairing cuts, snap places, the shot
// facts, the snap commands' logic, hover words, the ruler drawing. The detector itself: src-tauri/src/transitions.rs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTransitions, placesOf, snapTargets, transitionOfCut, shotFades, snapCut, cutToSnap, cutWhere, transitionText,
  transitionAt, drawTransitions, endOf, framesOf, MIN_W, withEdits, replaceFade, dragFade, newFade, landingOf, hitAt, makeFade } from '../src/features/timeline/transitions.js';

const FM = 1000 / 24;
const f = (n) => Math.round(n * FM);
// from the owner's d162 video (media_repeats on it, 2026-11-12), times rounded to frames at 24 fps
const THROUGH = { kind: 'through-black', f0: 8606, f1: 8673, t0: f(8606), ts: f(8607), tm: f(8636), t1: f(8673), b0: f(8636), b1: f(8638) };
const DISSOLVE = { kind: 'dissolve', f0: 1920, f1: 1939, t0: f(1920), ts: f(1921), tm: f(1930), t1: f(1939), b0: null, b1: null };
const OUT_END = { kind: 'fade-out', f0: 8986, f1: 9029, t0: f(8986), ts: f(8987), tm: f(9021), t1: null, b0: f(9014), b1: f(9029) };
const IN_START = { kind: 'fade-in', f0: -1, f1: 94, t0: null, ts: 0, tm: f(4), t1: f(94), b0: 0, b1: f(9) };
const DUR = f(9029);
const shots = (...cuts) => [0, ...cuts].map((t, i, a) => ({ start_ms: t, end_ms: a[i + 1] ?? DUR }));

test('a loaded list: only valid transitions, sorted; anything else is none (old projects load unchanged)', () => {
  assert.deepEqual(cleanTransitions(undefined), []);
  assert.deepEqual(cleanTransitions({ list: [] }), []);
  assert.deepEqual(cleanTransitions([THROUGH, { kind: 'wipe', f0: 1, f1: 5, ts: 1, tm: 2 }, null, DISSOLVE, { ...DISSOLVE, f1: 1900 }]), [DISSOLVE, THROUGH]);
  assert.equal(framesOf(THROUGH), 66);
  assert.equal(endOf(OUT_END, DUR), DUR);
});

test('the three places a cut can sit; none at the video start or past its end', () => {
  assert.deepEqual(placesOf(THROUGH).map((p) => [p.place, p.t]), [['start', f(8607)], ['middle', f(8636)], ['clean', f(8673)]]);
  assert.deepEqual(placesOf(DISSOLVE).map((p) => p.label), ['dissolve start', 'dissolve middle', 'first clean frame']);
  assert.deepEqual(placesOf(IN_START).map((p) => p.place), ['middle', 'clean']);   // starts at 0: no cut there
  assert.deepEqual(placesOf(OUT_END).map((p) => p.place), ['start', 'middle']);    // ends the video: no clean frame
  assert.equal(snapTargets([THROUGH, DISSOLVE]).length, 6);
});

test('a cut pairs with a transition inside it or at its edge (a frame before, two after the clean frame), nowhere else', () => {
  const L = [DISSOLVE, THROUGH];
  assert.equal(transitionOfCut(L, f(8607), FM, DUR), THROUGH);   // detection's cut at the fade's first frame
  assert.equal(transitionOfCut(L, f(8674), FM, DUR), THROUGH);   // ... and its cut on the frame after the clean one
  assert.equal(transitionOfCut(L, f(8606), FM, DUR), THROUGH);
  assert.equal(transitionOfCut(L, f(8676), FM, DUR), null);
  assert.equal(transitionOfCut(L, f(8600), FM, DUR), null);
  assert.equal(transitionOfCut(L, f(1930), FM, DUR), DISSOLVE);
});

test('shot facts: the clean frame on each side and the fade length, derived from the cuts (they follow a moved cut)', () => {
  const S = shots(f(1930), f(8607), f(8674));   // the sidecar's cuts: a dissolve's middle, a blank scene in a through-black
  const F = shotFades(S, [IN_START, DISSOLVE, THROUGH, OUT_END], FM, DUR);
  assert.equal(F[0].in.x, IN_START); assert.equal(F[0].in.clean, f(94)); assert.equal(F[0].in.frames, 94);
  assert.equal(F[0].out.x, DISSOLVE); assert.equal(F[0].out.clean, f(1920));
  assert.equal(F[1].in.clean, f(1939)); assert.equal(F[1].in.ms, f(1939) - f(1921));
  assert.equal(F[1].out.clean, f(8606));                               // last clean frame before the fade
  assert.equal(F[2].in.x, THROUGH); assert.equal(F[2].out.x, THROUGH);  // the blank scene in the middle: both edges
  assert.equal(F[3].in.clean, f(8673)); assert.equal(F[3].out.x, OUT_END); assert.equal(F[3].out.clean, f(8986));
  const moved = shotFades(shots(f(1700)), [DISSOLVE], FM, DUR);
  assert.deepEqual(moved.map((x) => [x.in, x.out]), [[null, null], [null, null]]);   // the cut left it: no facts
});

test('snapping a cut: start / darkest / first clean frame; never a cut that is not asked for', () => {
  const S = shots(f(1930), f(8674));
  const a = snapCut(S, 2, THROUGH, 'start', FM);
  assert.equal(a[2].start_ms, f(8607)); assert.equal(a[1].end_ms, f(8607));
  assert.deepEqual(a.filter((_, k) => k !== 1 && k !== 2), S.filter((_, k) => k !== 1 && k !== 2));   // the other cut stays
  assert.equal(snapCut(S, 2, THROUGH, 'middle', FM)[2].start_ms, f(8636));
  assert.equal(snapCut(S, 2, THROUGH, 'clean', FM)[2].start_ms, f(8673));
  const there = snapCut(S, 1, DISSOLVE, 'middle', FM);
  assert.equal(there, S);                                                // already there: the same list (no undo step)
  assert.equal(snapCut(S, 2, OUT_END, 'clean', FM), null);                // no clean frame after
  const two = shots(f(8607), f(8674));                                   // the sidecar's blank scene inside a through-black
  assert.equal(snapCut(two, 2, THROUGH, 'start', FM), null);             // onto the other cut: refused, nothing squashed
  assert.equal(snapCut(two, 2, THROUGH, 'middle', FM)[2].start_ms, f(8636));
  // the command's target: the transition at the playhead (else the nearest), its cut nearest the playhead
  assert.deepEqual(cutToSnap(S, [DISSOLVE, THROUGH], f(8650), FM, DUR), { i: 2, x: THROUGH });
  assert.deepEqual(cutToSnap(S, [DISSOLVE, THROUGH], f(2500), FM, DUR), { i: 1, x: DISSOLVE });
  assert.equal(cutToSnap(shots(f(5000)), [DISSOLVE, THROUGH], f(8650), FM, DUR), null);   // no cut in it: nothing moves
  assert.equal(cutToSnap(S, [], 0, FM, DUR), null);
});

test('hover words: length in frames and ms, black frames, clean frames, where the cut sits', () => {
  const s = transitionText(THROUGH, { frameMs: FM, dur: DUR, cut: f(8674) });
  assert.match(s, /^Fade through black: 66 frames \(2750 ms\)/);
  assert.match(s, /2 frames full black/);
  assert.match(s, /last clean frame 5:58\.583/);
  assert.match(s, /first clean frame at 6:01\.375/);
  assert.match(s, /cut 1 frame after the first clean frame$/);
  assert.match(transitionText(OUT_END, { frameMs: FM, dur: DUR }), /the video ends inside it/);
  assert.match(transitionText(IN_START, { frameMs: FM, dur: DUR }), /the video opens inside it/);
  assert.equal(cutWhere(THROUGH, f(8607), FM), 'at the fade start');
  assert.equal(cutWhere(THROUGH, f(8636), FM), 'at the darkest frame');
  assert.equal(cutWhere(THROUGH, f(8610), FM), '3 frames into it');
  assert.equal(cutWhere(IN_START, f(93), FM), '1 frame before the first clean frame');   // the owner's complaint, 644eb
  assert.equal(transitionAt([DISSOLVE, THROUGH], f(8700), 10, DUR), null);
  assert.equal(transitionAt([DISSOLVE, THROUGH], f(8673) + 5, 10, DUR), THROUGH);
});

test('drawing: a ramp with solid black at any zoom; a thin one is a MIN_W wedge at its darkest frame', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => calls.push([k, ...a])), set: (o, k, v) => { o[k] = v; return true; } });
  const opt = { y0: 17, h: 9, dur: DUR, ink: '#888', black: '#000' };
  drawTransitions(ctx, { start: f(8600), span: f(80) }, 800, [THROUGH], opt);
  const black = calls.find((c) => c[0] === 'fillRect');
  assert.ok(black && black[3] > 10, 'the black frames are a solid block');
  calls.length = 0;
  drawTransitions(ctx, { start: 0, span: DUR }, 400, [DISSOLVE], opt);   // 19 frames over 6 minutes on 400 px
  const xs = calls.filter((c) => c[0] === 'lineTo' || c[0] === 'moveTo').map((c) => c[1]);
  assert.ok(Math.max(...xs) - Math.min(...xs) >= MIN_W - 0.01, 'still MIN_W wide');
});

// ---- paw-ef73.13: the owner's hand edits, and where a click on a shot lands ----
test('edits lie over the detected list, keyed by overlap, so a re-run (a new detected list) never undoes them', () => {
  const moved = dragFade(THROUGH, 'clean', f(8680), FM, DUR);
  let E = replaceFade([], THROUGH, moved, DUR);
  assert.equal(E.length, 1); assert.equal(E[0].user, true); assert.equal(E[0].t1, f(8680));
  const L = withEdits([DISSOLVE, THROUGH], E, DUR);
  assert.deepEqual(L.map((x) => x.t1), [f(1939), f(8680)]);                       // the edit replaces the detected one
  const rerun = [DISSOLVE, { ...THROUGH, f1: 8672, t1: f(8672) }];                  // the pass again, a frame different
  assert.deepEqual(withEdits(rerun, E, DUR).map((x) => x.t1), [f(1939), f(8680)]);   // the edit still wins
  assert.equal(shotFades(shots(f(8607)), withEdits(rerun, E, DUR), FM, DUR)[1].in.clean, f(8680));   // the Track pass seeds from the edit
  E = replaceFade(E, L[0], null, DUR);                                                // remove the dissolve
  assert.deepEqual(withEdits(rerun, E, DUR).map((x) => x.kind), ['through-black']);
  assert.ok(E.some((e) => e.none));
  const added = newFade('in', { start_ms: f(5000), end_ms: f(5200) }, f(5010), FM);   // one the pass missed
  assert.deepEqual([added.kind, added.ts, added.t1, framesOf(added)], ['fade-in', f(5000), f(5010), 10]);
  E = replaceFade(E, null, added, DUR);
  assert.equal(withEdits(rerun, E, DUR).length, 2);
  assert.equal(withEdits(rerun, [], DUR), rerun);                                      // no edits: the list as it was
});

test('dragging a handle: kept in order, frame values; back onto the other edge removes it; the black span too', () => {
  assert.equal(dragFade(THROUGH, 'start', f(8620), FM, DUR).ts, f(8620));
  assert.equal(dragFade(THROUGH, 'start', f(8650), FM, DUR).ts, f(8636));             // never past the black
  assert.equal(dragFade(THROUGH, 'clean', f(8600), FM, DUR).t1, f(8638));             // never before the black's end
  const fi = makeFade('fade-in', f(100), f(110), null, null, FM);
  assert.equal(dragFade(fi, 'clean', f(100), FM, DUR), null);                           // clean onto the start: removed
  const fo = makeFade('fade-out', f(200), f(210), null, null, FM);
  assert.equal(dragFade(fo, 'start', f(210), FM, DUR), null);
  const nb = dragFade(THROUGH, 'b1', f(8636), FM, DUR);
  assert.deepEqual([nb.b0, nb.b1], [null, null]);                                      // the black span closed: none
  assert.equal(newFade('in', { start_ms: 0, end_ms: 1000 }, 10, FM), null);            // under a frame: nothing
  const V = { start: f(8600), span: f(80) }, xOf = (t) => (t - V.start) / V.span * 800;
  assert.equal(hitAt([THROUGH], V, 800, xOf(f(8673)) - 8, [], true, DUR).h, 'clean');   // the grip sits 8 px inside the fade
});

test('a click on a shot that fades in (or is dissolved into) lands on its first clean frame; a fade out changes nothing', () => {
  const L = [IN_START, DISSOLVE, THROUGH, OUT_END];
  assert.equal(landingOf(L, 0, f(1930), FM, DUR), f(94));                // the video's first shot: after the fade in
  assert.equal(landingOf(L, f(1930), f(8607), FM, DUR), f(1939));        // dissolved into: its first clean frame
  assert.equal(landingOf(L, f(8674), f(8986), FM, DUR), f(8674));        // starts a frame after the clean frame: there
  assert.equal(landingOf(L, f(8607), f(8674), FM, DUR), f(8607));        // the black lead-in shot itself (ends a frame after the clean one)
  assert.equal(landingOf(L, f(8987), DUR, FM, DUR), f(8987));            // a fade out: no change
  assert.equal(landingOf(L, f(4000), f(5000), FM, DUR), f(4000));        // no fade: no change
  assert.equal(landingOf([], 0, 100, FM, DUR), 0);
});
