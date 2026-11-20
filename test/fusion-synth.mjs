// fusion-synth.mjs -- synthetic scenes with a known stroke for lib/fusion.js (paw-iasp): one per design point. Used by
// test/fusion.test.mjs and experiments/fusion/score.mjs. Not a test file itself (no .test.mjs).
// A scene: 20 s at 30 fps; the stroke has a drifting tempo (0.9..1.5 Hz) and depth (0.5..1) so turn timing means
// something; parts are frame positions (x 0..1 of the width, y 0..1 of the height, y down) with tracker jitter.
import { channelOf } from '../src/lib/runs.js';

export const FPS = 30, N = 600, ASPECT = 16 / 9;
export const T = Array.from({ length: N }, (_, i) => Math.round((i * 1000) / FPS));
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const gauss = (r) => { const u = Math.max(1e-9, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
// the stroke: depth, + = out
const PH = (() => { const p = [0]; for (let i = 1; i < N; i++) { const s = T[i] / 1000; p.push(p[i - 1] + (2 * Math.PI * (1.2 + 0.3 * Math.sin((2 * Math.PI * s) / 7))) / FPS); } return p; })();
export const stroke = (i) => (0.75 + 0.25 * Math.sin((2 * Math.PI * T[i]) / 1000 / 5.3)) * Math.sin(PH[i]);
/** An irregular slow wander (body sway, a looking head): smoothed noise, unit-ish amplitude, no rhythm. */
export function wander(seed, smoothMs = 900) {
  const r = rng(seed), w = Math.round((smoothMs / 1000) * FPS), raw = Array.from({ length: N + 2 * w }, () => gauss(r)), out = [];
  for (let i = 0; i < N; i++) { let s = 0; for (let k = 0; k < 2 * w; k++) s += raw[i + k] * (1 - Math.abs(k - w) / w); out.push(s); }
  const m = out.reduce((a, b) => a + b, 0) / N, sd = Math.sqrt(out.reduce((a, b) => a + (b - m) ** 2, 0) / N);
  return out.map((x) => (x - m) / sd);
}
const lagged = (f, ms) => (i) => f(Math.max(0, Math.min(N - 1, Math.round(i - (ms / 1000) * FPS))));

/** parts: {name: {at(i) -> [x, y], gap?(i) -> bool}} -> a points run (who_pair_proj = the truth: orientation only). */
export function runOf(parts, { jitter = 0.0015, seed = 1, pair = null } = {}) {
  const ch = {}, r = rng(seed);
  for (const [name, p] of Object.entries(parts)) {
    const xs = [], ys = [];
    T.forEach((ms, i) => { const g = p.gap?.(i), q = p.at(i); xs.push([ms, g ? null : q[0] + jitter * gauss(r)]); ys.push([ms, g ? null : q[1] + jitter * gauss(r)]); });
    ch[`sem_${name}_x`] = channelOf(xs); ch[`sem_${name}_y`] = channelOf(ys);
    ch[`sem_${name}_n`] = channelOf(T.map((ms, i) => [ms, p.gap?.(i) ? 0 : p.n ? p.n(i) : 0.03]));   // paw-0yfp: n(i) = the visible share of the run's points
  }
  // paw-gy1r: pair (i -> value | null) = a depth reference of its own; false = none
  if (pair !== false) ch.who_pair_proj = channelOf(T.map((ms, i) => [ms, pair ? pair(i) : 0.5 + 0.5 * stroke(i)]));
  return { id: 'r', params: { axis: 'auto' }, scenes: [], channels: ch, notes: [], flips: [], range: { start: 0, end: T[N - 1] + 1 } };
}
const ref = () => T.map((ms, i) => [ms, 50 + 50 * stroke(i)]);
const scene = (parts, acts = null, o = {}) => ({ run: runOf(parts, o), aspect: ASPECT, derives: acts ? [{ acts }] : [], s0: 0, s1: T[N - 1] + 1, ref: ref() });

const cam = (amp, seed = 11) => { const a = wander(seed, 1500), b = wander(seed + 1, 1500); return (i) => [amp * a[i], amp * b[i]]; };
const add = (...fs) => (i) => fs.reduce((s, f) => { const q = f(i); return [s[0] + q[0], s[1] + q[1]]; }, [0, 0]);
const at = (x, y) => () => [x, y];
const vert = (amp, f) => (i) => [0, amp * f(i)];   // y down: + amp moves down
const sway = (amp, seed, ms) => { const a = wander(seed, ms), b = wander(seed + 50, ms); return (i) => [amp * a[i], 0.6 * amp * b[i]]; };

/** A big tail (twice the stroke) lagging the stroke by lagMs, the two hips stroking: the lag sweep (a tail's say must fall
 *  smoothly with its lag, never in a step). */
export function tailScene(lagMs) {
  const c = cam(0.01), d = vert(0.03, stroke);
  return scene({ c1_hips: { at: add(at(0.4, 0.55), c) }, c1_tail: { at: add(at(0.35, 0.35), (i) => [0, -0.06 * lagged(stroke, lagMs)(i)], c) }, c2_hips: { at: add(at(0.5, 0.45), d, c) } }, ['anal', 'penetration']);
}
/** The design cases: {id, point (the design point it tests), make() -> scene}. The stroke (truth) is the relative motion
 *  of the two parties the act names; everything else is what real shots throw at fusion. */
export const CASES = [
  { id: 'fellatio-head', point: 'scene type: the Bottom head is the stroke on the Top penis; both bodies rock (more core parts rocking than one head)', make: () => {
    const c = cam(0.01), rock1 = sway(0.03, 21, 1300), rock2 = sway(0.02, 31, 1300);
    return scene({
      c1_head: { at: add(at(0.45, 0.4), rock1, vert(0.05, stroke), c) },
      c1_torso: { at: add(at(0.35, 0.5), rock1, c) }, c1_hips: { at: add(at(0.25, 0.6), rock1, c) }, c1_paws_l: { at: add(at(0.3, 0.75), rock1, c) },
      c2_hips: { at: add(at(0.55, 0.62), rock2, c) }, c2_penis: { at: add(at(0.5, 0.5), rock2, c) }, c2_torso: { at: add(at(0.6, 0.35), rock2, c) },
    }, ['oral', 'penetration']);
  } },
  { id: 'rimming-head', point: 'scene type: the Top head on the Bottom hips; the Top body sways on its own', make: () => {
    const c = cam(0.01), rock1 = sway(0.02, 22, 1300), rock2 = sway(0.035, 32, 1100);
    return scene({
      c2_head: { at: add(at(0.5, 0.5), rock2, (i) => [0.04 * stroke(i), 0.02 * stroke(i)], c) },
      c2_torso: { at: add(at(0.6, 0.4), rock2, c) }, c2_hand_r: { at: add(at(0.45, 0.55), rock2, c) },
      c1_hips: { at: add(at(0.4, 0.5), rock1, c) }, c1_thighs_l: { at: add(at(0.38, 0.65), rock1, c) }, c1_tail: { at: add(at(0.35, 0.35), rock1, sway(0.03, 77, 700), c) },
    }, ['anal', 'licking']);
  } },
  { id: 'handjob', point: 'scene type: a hand on the other one\'s penis; the bodies drift', make: () => {
    const c = cam(0.012), rock1 = sway(0.025, 23, 1500), rock2 = sway(0.025, 33, 1500);
    return scene({
      c2_hand_r: { at: add(at(0.5, 0.5), rock1, vert(0.05, stroke), c) }, c2_head: { at: add(at(0.55, 0.3), rock2, c) }, c2_torso: { at: add(at(0.6, 0.45), rock2, c) },
      c1_penis: { at: add(at(0.5, 0.55), rock1, c) }, c1_hips: { at: add(at(0.48, 0.65), rock1, c) }, c1_balls: { at: add(at(0.5, 0.62), rock1, c) },
    }, ['handjob']);
  } },
  { id: 'solo-hand', point: 'a single character: the hand nearest the genitals against them, the body swaying and the camera moving', make: () => {
    const c = cam(0.02), rock = sway(0.03, 24, 1200);
    return scene({
      c1_hand_r: { at: add(at(0.5, 0.5), rock, vert(0.045, stroke), c) }, c1_penis: { at: add(at(0.5, 0.52), rock, c) },
      c1_hips: { at: add(at(0.48, 0.62), rock, c) }, c1_head: { at: add(at(0.45, 0.2), rock, sway(0.02, 88, 900), c) }, c1_hand_l: { at: add(at(0.3, 0.5), rock, sway(0.02, 89, 900), c) },
    }, ['masturbation']);
  } },
  { id: 'solo-untagged', point: 'a single character, no tags: the same solo order from the parts alone', make: () => {
    const c = cam(0.02), rock = sway(0.03, 25, 1200);
    return scene({
      c1_hand_l: { at: add(at(0.5, 0.5), rock, vert(0.045, stroke), c) }, c1_penis: { at: add(at(0.5, 0.53), rock, c) },
      c1_hips: { at: add(at(0.47, 0.63), rock, c) }, c1_torso: { at: add(at(0.45, 0.4), rock, c) }, c1_head: { at: add(at(0.45, 0.2), rock, sway(0.02, 90, 900), c) },
    });
  } },
  { id: 'halves', point: 'a part painted in pieces (something in front of it moves across): each piece seen < 30 % of the time, merged into one part', make: () => {
    const c = cam(0.035), d = vert(0.04, stroke), on = (k) => (i) => Math.floor(T[i] / 2500) % 3 === k && T[i] % 2500 < 2100;   // the thigh seen in one piece at a time
    return scene({
      c1_thighs_r: { at: add(at(0.4, 0.5), c), gap: (i) => !on(0)(i) }, c1_thighs_r2: { at: add(at(0.42, 0.62), c), gap: (i) => !on(1)(i) }, c1_thighs_r3: { at: add(at(0.41, 0.72), c), gap: (i) => !on(2)(i) },
      c2_hips: { at: add(at(0.5, 0.45), d, c) }, c2_penis: { at: add(at(0.46, 0.55), d, c) }, c2_head: { at: add(at(0.6, 0.2), sway(0.03, 91, 800), c) },
    }, ['anal', 'penetration']);
  } },
  { id: 'camera-bob', point: 'a handheld camera bobbing near the stroke tempo, common to every part: the two bodies relative to each other cancel it', make: () => {
    const bob = (i) => [0.004 * Math.sin((2 * Math.PI * T[i]) / 1000 * 0.8), 0.05 * Math.sin((2 * Math.PI * T[i]) / 1000 * 0.8 + 1)];
    const c = add(cam(0.01), bob);
    return scene({
      c1_hips: { at: add(at(0.4, 0.5), vert(-0.012, stroke), c) }, c1_thighs_l: { at: add(at(0.38, 0.62), vert(-0.012, stroke), c) }, c1_torso: { at: add(at(0.3, 0.4), c) }, c1_head: { at: add(at(0.2, 0.3), c) },
      c2_hips: { at: add(at(0.5, 0.45), vert(0.012, stroke), c) }, c2_torso: { at: add(at(0.6, 0.35), c) }, c2_head: { at: add(at(0.7, 0.2), c) },
    }, ['anal', 'penetration']);
  } },
  { id: 'more-parts', point: 'painting more parts of a body (paws, tail, head, hands, torso swaying together) must not outvote the hips stroke', make: () => {
    const c = cam(0.008), sw = sway(0.04, 26, 1400), d2 = vert(0.035, stroke);
    const p = { c1_hips: { at: add(at(0.4, 0.55), c) }, c1_thighs_r: { at: add(at(0.42, 0.68), c) }, c2_hips: { at: add(at(0.5, 0.45), d2, c) }, c2_penis: { at: add(at(0.46, 0.52), d2, c) } };
    for (const [k, x, y] of [['c1_torso', 0.3, 0.45], ['c1_head', 0.2, 0.35], ['c1_paws_l', 0.25, 0.75], ['c1_paws_r', 0.3, 0.78], ['c1_tail', 0.45, 0.4], ['c1_hand_r', 0.22, 0.7], ['c2_head', 0.6, 0.2], ['c2_hand_l', 0.55, 0.4], ['c2_hand_r', 0.6, 0.45], ['c2_torso', 0.62, 0.3]]) p[k] = { at: add(at(x, y), sw, c) };
    return scene(p, ['anal', 'penetration']);
  } },
  { id: 'lagging-tail', point: 'a big tail lagging the stroke by 200 ms fades by degree; the hips carry it', make: () => tailScene(200) },
  { id: 'wrong-prior', point: 'the tags say rimming but the Top head only wanders; the hips carry the stroke: the data wins over the scene type', make: () => {
    const c = cam(0.01), d = vert(0.035, stroke);
    return scene({ c2_head: { at: add(at(0.5, 0.35), sway(0.04, 27, 700), c) }, c2_hips: { at: add(at(0.5, 0.5), d, c) }, c1_hips: { at: add(at(0.4, 0.55), c) }, c1_thighs_l: { at: add(at(0.38, 0.65), c) } }, ['anal', 'licking']);
  } },
  { id: 'missing-driver', point: 'the tags say fellatio but no head is painted: the bodies against each other', make: () => {
    const c = cam(0.01), d = vert(0.03, stroke);
    return scene({ c1_hips: { at: add(at(0.4, 0.55), c) }, c1_torso: { at: add(at(0.3, 0.45), c) }, c2_hips: { at: add(at(0.5, 0.5), d, c) }, c2_penis: { at: add(at(0.46, 0.5), d, c) } }, ['oral', 'penetration']);
  } },
  { id: 'tag-not-driver', point: 'paw-439e: the scene is tagged handjob but in this shot the hand only fidgets (irregular, as big as the stroke: 644eb8 run10) while the bodies carry the stroke: the tag\'s lift decays (an influence, not a switch)', make: () => {
    const c = cam(0.01), d1 = vert(-0.018, stroke), d2 = vert(0.018, stroke);
    return scene({
      c1_hand_r: { at: add(at(0.48, 0.55), sway(0.035, 28, 700), c) }, c1_hips: { at: add(at(0.4, 0.55), d1, c) }, c1_torso: { at: add(at(0.3, 0.45), d1, c) },
      c2_hips: { at: add(at(0.5, 0.5), d2, c) }, c2_penis: { at: add(at(0.47, 0.55), d2, c) }, c2_torso: { at: add(at(0.6, 0.35), d2, c) },
    }, ['handjob']);
  } },
  { id: 'tail-occluded-hips', point: 'paw-439e: only a tail and hips painted, the Bottom hips hidden half the time, the tail in step with its body: the tail earns its say and stands in for the hips (never more than a core part)', make: () => tailHipsScene() },
  { id: 'dancing-hips', point: 'paw-n00h: a lone dancer, the hips swaying side to side with the rhythm; the painted penis rides the hips and swings on its own, a quarter stroke late and bigger than the sway: the hips against the frame are the stroke', make: () => dancingScene(['dancing']) },
  { id: 'dancing-lap', point: 'paw-n00h: a lap dance: the dancer (Bottom) sways, the seated Top is still but its painted penis swings on its own: the dancer\'s hips are the stroke, not the penis against the dancer', make: () => lapDanceScene(['dancing']) },
  { id: 'tailjob', point: 'paw-210e: the Top\'s tail strokes the Bottom\'s penis; the Top\'s hand rests near it and both bodies sway: the tail against the penis is the stroke', make: () => tailjobScene(['tailjob']) },
  { id: 'tail-penetration', point: 'paw-210e: the Top\'s tail goes in and out of the Bottom; both bodies sway and the Top\'s penis swings on its own: the tail against the Bottom\'s hips is the stroke', make: () => tailPenScene(['anal', 'tailpen']) },
  { id: 'facesitting', point: 'paw-210e: the Top sits on the Bottom\'s face, its hips rocking SIDEWAYS; the head nods a little and the sitter\'s penis swings: the hips against the head, read along the rock', make: () => facesittingScene(['facesitting']) },
];
/** paw-210e: a tailjob (acts = its tags). solo false: the Top's tail strokes the Bottom's penis (the tail rides the Bottom's
 *  rock: the stroke is the tail against the penis), the Top's hand rests beside the penis on its own body's sway; solo true:
 *  one character's own tail on its own penis, its own hand resting nearer the genitals than the tail's centre. */
export function tailjobScene(acts, { solo = false } = {}) {
  const c = cam(0.012), rock1 = sway(0.025, 61, 1400), rock2 = sway(0.025, 62, 1400), w = solo ? 'c1' : 'c2';
  return scene({
    c1_penis: { at: add(at(0.5, 0.55), rock1, c) }, c1_balls: { at: add(at(0.5, 0.62), rock1, c) }, c1_hips: { at: add(at(0.48, 0.66), rock1, c) }, c1_torso: { at: add(at(0.45, 0.4), rock1, c) },
    [`${w}_tail`]: { at: add(at(0.53, 0.52), rock1, vert(0.045, stroke), c) },
    [`${w}_hand_r`]: { at: add(at(0.5, 0.6), solo ? rock1 : rock2, sway(0.012, 63, 900), c) },
    ...(solo ? {} : { c2_hips: { at: add(at(0.62, 0.6), rock2, c) }, c2_torso: { at: add(at(0.66, 0.4), rock2, c) } }),
  }, acts);
}
/** paw-210e: tail penetration (acts = its tags). solo false: the Top's tail strokes in / out of the Bottom (along a
 *  diagonal, riding the Bottom's rock); both bodies sway; the Top's penis swings on its own (2.3x, 250 ms late); solo true:
 *  one character's own tail in itself, its penis swinging the same way. */
export function tailPenScene(acts, { solo = false } = {}) {
  const c = cam(0.012), rock1 = sway(0.025, 64, 1300), rock2 = sway(0.03, 65, 1300), w = solo ? 'c1' : 'c2';
  const tin = (i) => [(0.6 * 0.04 * stroke(i)) / ASPECT, -0.8 * 0.04 * stroke(i)];
  const swing = (i) => [(0.07 * lagged(stroke, 250)(i)) / ASPECT, 0.02 * lagged(stroke, 250)(i)];
  return scene({
    c1_hips: { at: add(at(0.42, 0.55), rock1, c) }, c1_thighs_l: { at: add(at(0.4, 0.68), rock1, c) }, c1_torso: { at: add(at(0.3, 0.45), rock1, c) },
    [`${w}_tail`]: { at: add(at(0.46, 0.5), rock1, tin, c) },
    [`${w}_penis`]: { at: add(at(0.5, 0.6), solo ? rock1 : rock2, swing, c) },
    ...(solo ? {} : { c2_hips: { at: add(at(0.55, 0.5), rock2, c) }, c2_torso: { at: add(at(0.62, 0.35), rock2, c) } }),
  }, acts);
}
/** Self-penetration (acts = its tags): one body, its own penis going in and out of its own opening along a diagonal, the
 *  whole body swaying (as big as the stroke) and the camera wandering; penis = the character the penis is painted as.
 *  decoy: instead a lone Bottom painted in a two-character penetration (the Top unpainted): its body pushed by the stroke,
 *  its own penis swinging on its own (2.3x, 250 ms late): the body is the stroke, not its penis against its hips. */
export function selfPenScene(acts, { penis = 'c1', decoy = false } = {}) {
  const c = cam(0.01), rock = sway(0.035, 81, 1200), tin = (i) => [(0.6 * 0.04 * stroke(i)) / ASPECT, -0.8 * 0.04 * stroke(i)];
  if (decoy) {
    const d = vert(0.025, stroke), swing = (i) => [(0.07 * lagged(stroke, 250)(i)) / ASPECT, 0.02 * lagged(stroke, 250)(i)];
    return scene({ c1_hips: { at: add(at(0.45, 0.6), d, c) }, c1_anus: { at: add(at(0.47, 0.57), d, c) }, c1_torso: { at: add(at(0.35, 0.45), d, c) }, c1_penis: { at: add(at(0.5, 0.66), d, swing, c) } }, acts, { pair: false });
  }
  return scene({
    c1_hips: { at: add(at(0.45, 0.6), rock, c) }, c1_anus: { at: add(at(0.47, 0.57), rock, c) }, c1_torso: { at: add(at(0.35, 0.45), rock, c) },
    [`${penis}_penis`]: { at: add(at(0.5, 0.5), rock, tin, c) },
  }, acts, { pair: false });   // one character: the sidecar has no pair channel
}
/** paw-210e: facesitting (acts = its tags): the sitter (c2, else c1 with sitter 'c1') rocks its hips SIDEWAYS over the
 *  other's head (x = the stroke, a little y); its torso follows at 50 % with a wander, its head at 25 %; the head under it
 *  nods a little on its own rhythm; the sitter's penis rides the hips and swings on its own (2.3x, 250 ms late). */
export function facesittingScene(acts, { sitter = 'c2' } = {}) {
  const c = cam(0.012), o = sitter === 'c2' ? 'c1' : 'c2', hx = (amp) => (i) => [(amp * stroke(i)) / ASPECT, 0.15 * amp * stroke(i)];
  const nod = (i) => [0, 0.006 * Math.sin((2 * Math.PI * T[i]) / 1000 * 2.1)], swing = (i) => [(0.07 * lagged(stroke, 250)(i)) / ASPECT, 0.02 * lagged(stroke, 250)(i)];
  return scene({
    [`${sitter}_hips`]: { at: add(at(0.5, 0.45), hx(0.035), c) }, [`${sitter}_torso`]: { at: add(at(0.5, 0.25), hx(0.0175), sway(0.01, 66, 900), c) },
    [`${sitter}_head`]: { at: add(at(0.5, 0.1), hx(0.009), sway(0.012, 67, 900), c) }, [`${sitter}_penis`]: { at: add(at(0.5, 0.4), hx(0.035), swing, c) },
    [`${o}_head`]: { at: add(at(0.5, 0.52), nod, sway(0.004, 68, 900), c) }, [`${o}_torso`]: { at: add(at(0.5, 0.75), sway(0.006, 69, 1500), c) }, [`${o}_hips`]: { at: add(at(0.5, 0.92), sway(0.006, 70, 1500), c) },
  }, acts);
}
/** paw-0yfp: an arm in the receiver (acts = its tags). The forearm axis U (wrist at the entry, elbow up and to the right) is
 *  the stroke direction: the wrist is s = 0.08 - 0.06 x stroke frame heights inside the receiver's entry (a point riding its
 *  hips' sway), the visible forearm runs from the entry to the elbow (its centre moves half the stroke, its visible share
 *  of the run's points, sem_*_n, shrinks with depth: members slip inside), the upper arm (shoulder part) hangs off the
 *  elbow with the giver's torso sway; the hand shows only near the out end (stroke > 0.6: hidden ~80 % of the time); the
 *  receiver's penis swings on its own (2.3x, 250 ms late) and both bodies sway. giver / receiver = character keys
 *  (receiver = giver: one's own arm in oneself, one character); lost: the forearm gone 1.5 s in every 3 s; fingering: the
 *  hand always shows, the fingers go in (0.035 x stroke) and the forearm rides the hand; idle: the giver's other arm (forearm_l,
 *  hand_l) rests on the receiver's thigh, nudged by the stroke 300 ms late and fidgeting (an owner clip's shot). */
export function fistingScene(acts, { giver = 'c2', receiver = 'c1', lost = false, fingering = false, idle = false } = {}) {
  const c = cam(0.012), rock1 = sway(0.022, 71, 1300), rock2 = sway(0.03, 72, 1300), r = rng(73), U = [0.8, -0.6];
  const u = (len) => (i) => [(len(i) * U[0]) / ASPECT, len(i) * U[1]], E = add(at(0.45, 0.58), rock1, c), self = giver === receiver;
  const s = (i) => (fingering ? 0.03 - 0.035 * stroke(i) : 0.08 - 0.06 * stroke(i)), Lf = 0.24, gone = (i) => lost && Math.floor(T[i] / 1500) % 2 === 1;
  const hand = fingering ? add(E, u((i) => 0.05 - s(i))) : add(E, u((i) => 0.5 * (0.04 - s(i))));
  const fore = fingering ? add(hand, u(() => 0.12), sway(0.004, 74, 900)) : add(E, u((i) => (Lf - s(i)) / 2));
  const elbow = fingering ? add(hand, u(() => 0.24)) : add(E, u((i) => Lf - s(i)));
  const flick = Array.from({ length: N }, () => gauss(r));
  const P = {
    [`${receiver}_hips`]: { at: add(at(0.42, 0.62), rock1, c) }, [`${receiver}_thighs_l`]: { at: add(at(0.38, 0.72), rock1, c) }, [`${receiver}_torso`]: { at: add(at(0.28, 0.48), rock1, c) },
    [`${receiver}_penis`]: { at: add(at(0.46, 0.7), rock1, (i) => [(0.07 * lagged(stroke, 250)(i)) / ASPECT, 0.02 * lagged(stroke, 250)(i)], c) },
    [`${giver}_forearm_r`]: { at: fore, gap: gone, n: fingering ? undefined : (i) => Math.round(900 * 0.05 * (Lf - s(i)) / Lf + 1.5 * flick[i]) / 900 },
    [`${giver}_shoulder_r`]: { at: add(elbow, at(0.03, -0.08), self ? at(0, 0) : (i) => rock2(i).map((x) => 0.5 * x), sway(0.006, 75, 900)) },
    [`${giver}_hand_r`]: { at: hand, gap: fingering ? undefined : (i) => stroke(i) < 0.6 },
  };
  if (idle) { const nudge = (i) => [0.012 * lagged(stroke, 300)(i) / ASPECT, -0.015 * lagged(stroke, 300)(i)]; for (const [k, x, y, sd] of [['forearm_l', 0.33, 0.66, 79], ['hand_l', 0.36, 0.74, 80]]) P[`${giver}_${k}`] = { at: add(at(x, y), rock1, nudge, sway(0.012, sd, 700), c) }; }
  if (!self) Object.assign(P, { [`${giver}_torso`]: { at: add(at(0.7, 0.3), rock2, c) }, [`${giver}_hips`]: { at: add(at(0.75, 0.55), rock2, c) } });
  return scene(P, acts);
}
/** paw-0yfp: a penetration (the Top's hips / penis stroke against the Bottom) with the Top's arm resting on the Bottom's hips
 *  (forearm, hand, upper arm: they ride the Bottom and fidget on their own, as big as the stroke). */
export function restingArmScene(acts) {
  const c = cam(0.01), d = vert(0.035, stroke), rock1 = sway(0.015, 76, 1300), fid = sway(0.03, 77, 700);
  return scene({
    c1_hips: { at: add(at(0.4, 0.58), rock1, c) }, c1_thighs_l: { at: add(at(0.37, 0.7), rock1, c) }, c1_torso: { at: add(at(0.28, 0.48), rock1, c) },
    c2_hips: { at: add(at(0.5, 0.42), d, c) }, c2_penis: { at: add(at(0.46, 0.5), d, c) }, c2_torso: { at: add(at(0.6, 0.3), d, c) },
    c2_hand_r: { at: add(at(0.38, 0.55), rock1, fid, c) }, c2_forearm_r: { at: add(at(0.45, 0.48), rock1, fid, c) }, c2_shoulder_r: { at: add(at(0.53, 0.38), d, sway(0.01, 78, 900), c) },
  }, acts);
}
/** paw-n00h: a lap dance (acts = its tags): the dancer c1 sways as dancingScene (no penis painted), a seated c2 is still,
 *  its penis swinging on its own (the same swing as dancingScene's, without the hips under it). */
export function lapDanceScene(acts) {
  const c = cam(0.012), hx = (amp) => (i) => [(amp * stroke(i)) / ASPECT, 0], swing = (i) => [(0.07 * lagged(stroke, 250)(i)) / ASPECT, 0.02 * lagged(stroke, 250)(i)];
  return scene({
    c1_hips: { at: add(at(0.45, 0.5), hx(0.03), c) }, c1_torso: { at: add(at(0.45, 0.3), hx(0.018), sway(0.01, 53, 900), c) },
    c2_hips: { at: add(at(0.55, 0.7), c) }, c2_torso: { at: add(at(0.6, 0.5), c) }, c2_penis: { at: add(at(0.52, 0.65), swing, c) },
  }, acts);
}
/** paw-n00h: one character dancing (acts = its tags): hips sway (x) = the stroke, the torso follows at 60 % with a wander, the
 *  head wanders, the penis = the hips + its own swing (2.3x the sway, 250 ms late: about 100 deg at the stroke tempo). */
export function dancingScene(acts) {
  const c = cam(0.012), hx = (amp) => (i) => [(amp * stroke(i)) / ASPECT, 0], swing = (i) => [(0.07 * lagged(stroke, 250)(i)) / ASPECT, 0.02 * lagged(stroke, 250)(i)];
  return scene({
    c1_hips: { at: add(at(0.5, 0.6), hx(0.03), c) }, c1_torso: { at: add(at(0.5, 0.4), hx(0.018), sway(0.01, 51, 900), c) },
    c1_head: { at: add(at(0.5, 0.2), sway(0.02, 52, 900), c) }, c1_penis: { at: add(at(0.52, 0.64), hx(0.03), swing, c) },
  }, acts);
}
// ---- paw-0sn8: jitter sources (the owner's "jittery, not refined"), each on a penetration scene whose truth is the
// Top's motion against the Bottom along one picture direction (a diagonal, so neither image axis is the stroke) ----
const DIAG = [0.6, -0.8];   // the stroke direction in the picture (aspect-scaled x, y; y down): up and to the right
const along = (amp, f = stroke) => (i) => [(amp * DIAG[0] * f(i)) / ASPECT, amp * DIAG[1] * f(i)];
const across = (amp, f) => (i) => [(amp * -DIAG[1] * f(i)) / ASPECT, amp * DIAG[0] * f(i)];
/** A camera roll / zoom (wander) about the frame centre applied to a part's position: what translation-only camera
 *  removal leaves (a part's residue grows with its distance from the centre). */
const rolled = (f, degAmp, zoomAmp, seed) => { const a = wander(seed, 1200), z = wander(seed + 3, 1500); return (i) => { const [x, y] = f(i), th = (degAmp * Math.PI / 180) * a[i], s = 1 + zoomAmp * z[i], X = (x - 0.5) * ASPECT, Y = y - 0.5; return [0.5 + (s * (X * Math.cos(th) - Y * Math.sin(th))) / ASPECT, 0.5 + s * (X * Math.sin(th) + Y * Math.cos(th))]; }; };
/** Animated on twos: each drawing held two frames. */
const twos = (f) => (i) => f(i - (i % 2));
/** Random short dropouts (gapMs) about every everyMs; after each the centre comes back shifted (points slid / re-seeded). */
function dropSlide(seed, everyMs, gapMs, step) {
  const r = rng(seed), gaps = [], offs = [[0, 0]];
  for (let t = 500 + r() * everyMs; t < T[N - 1]; t += everyMs * (0.5 + r())) { gaps.push([t, t + gapMs * (0.5 + r())]); offs.push([step * gauss(r), step * gauss(r)]); }
  const k = (i) => gaps.filter((g) => g[1] <= T[i]).length;
  return { gap: (i) => gaps.some((g) => T[i] >= g[0] && T[i] < g[1]), off: (i) => offs.slice(0, k(i) + 1).reduce((s, o) => [s[0] + o[0], s[1] + o[1]], [0, 0]) };
}
const jit = (amp, seed) => { const r = rng(seed), a = Array.from({ length: N }, () => [amp * gauss(r), amp * gauss(r)]); return (i) => a[i]; };
/** The jitter cases: {id, point, make()} like CASES; the truth is stroke(). */
export const JIT_CASES = [
  { id: 'j-dropout-slide', point: 'the Top hips drop out for 100-300 ms every ~1.5 s and come back shifted (points died / slid): steps in its centre', make: () => {
    const c = cam(0.01), d = dropSlide(61, 1500, 200, 0.006), s = along(0.035);
    return scene({ c1_hips: { at: add(at(0.4, 0.6), c) }, c1_thighs_l: { at: add(at(0.36, 0.7), c) }, c2_hips: { at: add(at(0.5, 0.45), s, d.off, c), gap: d.gap }, c2_penis: { at: add(at(0.46, 0.53), s, c) } }, ['anal', 'penetration']);
  } },
  { id: 'j-camera-roll', point: 'a handheld camera that rolls (+-4 deg) and zooms (+-3 %): translation-only camera removal leaves motion that grows with the distance from the centre; parts far apart', make: () => {
    const s = along(0.03), c = cam(0.01);
    const P = { c1_hips: add(at(0.25, 0.7), c), c1_torso: add(at(0.12, 0.5), c), c2_hips: add(at(0.62, 0.35), s, c), c2_penis: add(at(0.55, 0.45), s, c), c2_torso: add(at(0.8, 0.2), s, c) };
    return scene(Object.fromEntries(Object.entries(P).map(([k, f]) => [k, { at: rolled(f, 4, 0.03, 71) }])), ['anal', 'penetration']);
  } },
  { id: 'j-noisy-abs', point: 'a solo-looking take where the Top body is barely painted: its balls ride the stroke but bounce on their own (6-9 Hz) and the sheath / balls are the only Top parts besides a noisy hips', make: () => {
    const c = cam(0.012), s = along(0.03), bounce = (i) => [0.004 * Math.sin(2 * Math.PI * 7.3 * T[i] / 1000), 0.008 * Math.sin(2 * Math.PI * 8.1 * T[i] / 1000 + 1)];
    return scene({ c1_hips: { at: add(at(0.38, 0.62), c) }, c1_thighs_l: { at: add(at(0.34, 0.72), c) },
      c2_hips: { at: add(at(0.52, 0.42), s, jit(0.006, 62), c) }, c2_balls: { at: add(at(0.47, 0.5), s, bounce, c) }, c2_sheath: { at: add(at(0.48, 0.47), s, c) } }, ['anal', 'penetration']);
  } },
  { id: 'j-across-sway', point: 'the Top sways ACROSS the stroke as much as it strokes (an irregular 1 s sway): the row axis must stay on the stroke direction', make: () => {
    const c = cam(0.01), s = along(0.03), wv = wander(63, 500), sw = across(0.03, (i) => wv[i]);
    return scene({ c1_hips: { at: add(at(0.4, 0.6), c) }, c1_torso: { at: add(at(0.28, 0.5), c) }, c2_hips: { at: add(at(0.5, 0.45), s, sw, c) }, c2_penis: { at: add(at(0.46, 0.53), s, sw, c) } }, ['anal', 'penetration']);
  } },
  { id: 'j-twos', point: 'animated on twos (each drawing held two frames) with tracker jitter and a small camera wander: a staircase trace', make: () => {
    const c = cam(0.01), s = along(0.03);
    return scene({ c1_hips: { at: twos(add(at(0.4, 0.6), c)) }, c1_torso: { at: twos(add(at(0.3, 0.48), c)) }, c2_hips: { at: twos(add(at(0.5, 0.45), s, c)) }, c2_penis: { at: twos(add(at(0.46, 0.53), s, c)) } }, ['anal', 'penetration'], { jitter: 0.003 });
  } },
  { id: 'j-chain', point: 'the Top hips half occluded (noisy, dropping out), the Top sheath / balls / knot clean: they ride the Top and measure the stroke against the Bottom', make: () => {
    const c = cam(0.012), s = along(0.03), d = dropSlide(64, 900, 350, 0.01);
    return scene({ c1_hips: { at: add(at(0.38, 0.62), c) }, c1_torso: { at: add(at(0.26, 0.5), c) },
      c2_hips: { at: add(at(0.55, 0.4), s, d.off, jit(0.005, 65), c), gap: d.gap }, c2_sheath: { at: add(at(0.5, 0.47), s, c) }, c2_balls: { at: add(at(0.51, 0.5), s, c) }, c2_knot: { at: add(at(0.47, 0.5), s, c) } }, ['anal', 'penetration']);
  } },
  { id: 'j-holds', point: 'every stroke dwells at the deepest point (a hold, ~1/4 of the stroke) and the Top hips jitter: a refinement must keep the holds flat and their edges in place', make: () => {
    const c = cam(0.01), s = along(0.03, held);
    return { ...scene({ c1_hips: { at: add(at(0.4, 0.6), c) }, c1_torso: { at: add(at(0.28, 0.5), c) }, c2_hips: { at: add(at(0.5, 0.45), s, jit(0.002, 66), c) }, c2_penis: { at: add(at(0.46, 0.53), s, c) } }, ['anal', 'penetration']), ref: T.map((ms, i) => [ms, 50 + 50 * held(i)]), truth: held };
  } },
];
// ---- paw-gy1r: depth level and size. The truth D(i) (-1 deepest .. +1 out) has a level and a size of its own; the Top's
// hips / penis move by it against the Bottom; the pair channel (who_pair_proj) is the depth reference, noisy as a tracker's ----
const smoothstep = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
/** Big full strokes to 10 s, then (over 1 s) small strokes at the deep end: knotted, shallow thrusts at depth. */
export const knotDepth = (i) => { const s = T[i] / 1000, u = smoothstep(9.5, 10.5, s); return (1 - u) * Math.sin(PH[i]) + u * (-0.72 + 0.18 * Math.sin(1.4 * PH[i])); };
/** Constant strokes on a slow level drift (deep to shallow). */
export const driftDepth = (i) => -0.5 + T[i] / T[N - 1] + 0.35 * Math.sin(PH[i]);
/** A tracker's reading of a depth (0..1 = 0.5 + 0.5 D): jitter, a 2-frame spike every ~0.7 s, the floor clipped at clip
 *  (in D), absent where gap(i). */
function noisyRef(D, { seed = 5, jitter = 0.03, clip = -0.82, gap = null } = {}) {
  const r = rng(seed), sp = new Set();
  for (let t = 300; t < T[N - 1]; t += 500 + 400 * r()) { const k = Math.round((t / 1000) * FPS); sp.add(k); sp.add(k + 1); }
  const e = Array.from({ length: N }, () => jitter * gauss(r));
  return (i) => (gap?.(i) ? null : 0.5 + 0.5 * Math.max(clip, D(i)) + e[i] + (sp.has(i) ? 0.15 : 0));
}
const depthScene = (D, pair, o = {}) => {
  const c = cam(0.01), d = vert(0.035, D), parts = o.parts || {
    c1_hips: { at: add(at(0.4, 0.58), c) }, c1_thighs_l: { at: add(at(0.37, 0.7), c) }, c1_torso: { at: add(at(0.28, 0.48), c) },
    c2_hips: { at: add(at(0.5, 0.42), d, c) }, c2_penis: { at: add(at(0.46, 0.5), d, c) },
  };
  return { ...scene(parts, ['anal', 'penetration'], { pair }), ref: T.map((ms, i) => [ms, 50 + 50 * D(i)]), truth: D };
};
/** The depth cases: {id, point, make() -> scene (+ truth)}; fused with derive.fuse.depth 'pair' against without. */
export const DEPTH_CASES = [
  { id: 'd-knot-depth', point: 'big strokes, then small strokes at the deep end; the pair reading is noisy, spiky and clipped at the floor: the level and the small size come from it, the motion from fusion', make: () => depthScene(knotDepth, noisyRef(knotDepth)) },
  { id: 'd-drift', point: 'constant strokes on a slow level drift from deep to shallow: the drift is the depth, kept', make: () => depthScene(driftDepth, noisyRef(driftDepth, { seed: 6, clip: -2 })) },
  { id: 'd-dropout', point: 'the knot scene with the pair reading gone from 7 to 13 s: seated where it is seen, fusion\'s own (cross-faded) where it is not', make: () => depthScene(knotDepth, noisyRef(knotDepth, { seed: 7, gap: (i) => T[i] >= 7000 && T[i] < 13000 })) },
  { id: 'd-relative-only', point: 'only the Top penis against the Bottom hips painted and no pair reading: nothing to seat on, fusion\'s own, and it says so', make: () => {
    const c = cam(0.01), d = vert(0.035, knotDepth);
    return depthScene(knotDepth, false, { parts: { c1_hips: { at: add(at(0.4, 0.58), c) }, c2_penis: { at: add(at(0.46, 0.5), d, c) } } });
  } },
];

// paw-gy1r (owner: "during camera moves relativity and core needs to kinda re-calibrate"): camera moves inside a shot. zoomed
// = every part scaled about the frame centre by z(i) (a push-in: every distance in the picture grows); the truth stays.
export const steadyDepth = (i) => 0.6 * Math.sin(PH[i]);
const zoomBy = (z) => (f) => (i) => { const [x, y] = f(i); return [0.5 + z(i) * (x - 0.5), 0.5 + z(i) * (y - 0.5)]; };
const ramp = (a, b, from, to) => (i) => from + (to - from) * smoothstep(a, b, T[i] / 1000);
function camScene(D, z, { slide = null, camPath = null } = {}) {
  const c = cam(0.01), d = vert(0.035, D), mv = slide || (() => [0, 0]), Z = zoomBy(z);
  const P = { c1_hips: add(at(0.4, 0.58), c, mv), c1_thighs_l: add(at(0.37, 0.7), c, mv), c1_torso: add(at(0.28, 0.48), c, mv), c2_hips: add(at(0.5, 0.42), d, c, mv), c2_penis: add(at(0.46, 0.5), d, c, mv), c2_torso: add(at(0.6, 0.3), c, mv) };
  const s = { ...scene(Object.fromEntries(Object.entries(P).map(([k, f]) => [k, { at: Z(f) }])), ['anal', 'penetration'], { pair: (i) => z(i) * (0.15 + 0.0175 * D(i)) }), ref: T.map((ms, i) => [ms, 50 + 50 * D(i)]), truth: D };   // who_pair_proj as a tracker reads it: the bodies' distance in the picture (a push-in grows it)
  if (camPath) { s.run.channels.cam_x = channelOf(T.map((ms, i) => [ms, camPath(i)])); s.run.channels.cam_y = channelOf(T.map((ms) => [ms, 0])); }
  return s;
}
/** The camera cases: {id, point, move: [t0, t1] (ms), make()}; the truth's level and swing are the same either side of the move. */
export const CAM_CASES = [
  { id: 'c-zoom', point: 'a 1.5x push-in over 2 s mid-shot (8-10 s), the stroke unchanged: the output level and swing stay', move: [8000, 10000], make: () => camScene(steadyDepth, ramp(8, 10, 1, 1.5)) },
  { id: 'c-pan', point: 'a pan: the bodies slide a quarter of the picture over 3 s (6-9 s, camera path moving too), the stroke unchanged', move: [6000, 9000], make: () => { const sl = ramp(6, 9, 0, 0.25); return camScene(steadyDepth, () => 1, { slide: (i) => [sl(i), 0], camPath: (i) => -sl(i) }); } },
  { id: 'c-zoom-depth', point: 'big strokes, then small strokes at depth, a 1.4x push-in during the small ones (13-15 s): the level stays at depth', move: [13000, 15000], make: () => camScene(knotDepth, ramp(13, 15, 1, 1.4)) },
];

/** paw-5ynj: a POV fellatio shot, the camera the Top's eyes. The Bottom head bobs on the shaft (small in the picture: it
 *  moves toward the camera), the Top's penis moves a little in phase (the truth = the head against the shaft), the Top's own
 *  hips are a sliver at the frame's bottom edge (y hipsY) leading the stroke by leadMs (bigger: nearest the camera) with
 *  camera motion of their own (parallax). */
export function povScene({ leadMs = 90, hipsAmp = 0.02, hipsY = 0.97, parallax = 0.008, seed = 1, acts = ['oral', 'penetration'] } = {}) {
  const c = cam(0.01, 11 + seed), rock = sway(0.012, 21 + seed, 1300), px = cam(parallax, 41 + seed);
  const early = (i) => { const x = i + (leadMs / 1000) * FPS, a = Math.max(0, Math.min(N - 2, Math.floor(x))), f = Math.min(1, Math.max(0, x - a)); return (1 - f) * stroke(a) + f * stroke(a + 1); };
  return scene({
    c1_head: { at: add(at(0.5, 0.45), vert(0.02, stroke), rock, c) }, c1_thighs: { at: add(at(0.42, 0.78), rock, c) },
    c2_penis: { at: add(at(0.5, 0.62), vert(-0.006, stroke), c) }, c2_hips: { at: add(at(0.5, hipsY), vert(-hipsAmp, early), c, px) },
  }, acts, { seed });
}

/** The stroke with a hold at every deepest point (its sine clipped at -0.7 of the depth). */
export function held(i) { const d = 0.75 + 0.25 * Math.sin((2 * Math.PI * T[i]) / 1000 / 5.3); return d * Math.max(Math.sin(PH[i]), -0.7); }
/** The Bottom hips seen 2.5 s in 5, its tail (clean, always seen) in step with the Bottom body, the Top hips stroking against
 *  it; a camera wander near the stroke tempo, so a body against the camera is a poor stand-in. */
export function tailHipsScene() {
  const c = cam(0.02), wa = wander(41, 600), wb = wander(42, 600), cw = (i) => [0.012 * wa[i], 0.012 * wb[i]], d1 = vert(-0.02, stroke), d2 = vert(0.02, stroke);
  const hidden = (i) => Math.floor(T[i] / 2500) % 2 === 1;
  return scene({
    c1_hips: { at: add(at(0.4, 0.55), d1, c, cw), gap: hidden }, c1_tail: { at: add(at(0.33, 0.42), d1, c, cw) },
    c2_hips: { at: add(at(0.5, 0.48), d2, c, cw) },
  }, ['anal', 'penetration']);
}

// ---- paw-oc7l: fusion as channels, stage 0 (experiments/fusion/channels.mjs; no test reads these). Each case: a known depth
// truth (truth(i), ref = its script), the stroke along DIAG, the tempo drifting 0.9..1.5 Hz unless stated, tracker jitter as
// runOf. Extra fields: idx (a span of the run), drop [t0, t1] ms (the main rows lost there), shaft (i -> a shaft length
// reading | null: a channel the library has no row for), held (true: lib/held.js retimes before fusion, as the pipeline
// does), lagging (the parts that lag the stroke). The balls = a pendulum hanging from the Top's hips, driven by their
// acceleration (natural 2 Hz, damping 0.2): x'' + 2 z w0 x' + w0^2 x = -h'' (x = balls minus hips, in the hips' units).
const phAt = (P) => (ms) => { const x = (ms / 1000) * FPS, i = Math.max(0, Math.min(N - 2, Math.floor(x))); return P[i] + (P[i + 1] - P[i]) * (x - i); };
const envAt = (ms) => 0.75 + 0.25 * Math.sin((2 * Math.PI * ms) / 1000 / 5.3);
const PH_FAST = (() => { const p = [0]; for (let i = 1; i < N; i++) { const s = T[i] / 1000; p.push(p[i - 1] + (2 * Math.PI * (2 + 0.1 * Math.sin((2 * Math.PI * s) / 7))) / FPS); } return p; })();
/** The stroke at any time (ms), continuous (a lagged channel is exact, not rounded to frames); fast: 500 ms strokes. */
export const strokeAt = (ms, fast = false) => envAt(ms) * Math.sin(phAt(fast ? PH_FAST : PH)(ms));
const series = (f) => Float64Array.from(T, (ms) => f(ms));
/** A pendulum's displacement from its pivot per frame, the pivot moving by h(ms) (same units). */
export function pendulum(h, { f0 = 2, zeta = 0.2 } = {}) {
  const w0 = 2 * Math.PI * f0, sub = 20, dt = 1 / FPS / sub, e = 1 / 240, out = new Float64Array(N);
  const acc = (s) => (h((s + e) * 1000) - 2 * h(s * 1000) + h((s - e) * 1000)) / (e * e);
  let x = 0, v = 0;
  for (let k = -3 * FPS * sub; k <= (N - 1) * sub; k++) {
    if (k >= 0 && k % sub === 0) out[k / sub] = x;
    v += (-acc(k * dt) - 2 * zeta * w0 * v - w0 * w0 * x) * dt; x += v * dt;
  }
  return out;
}
const arr = (a, amp = 1) => (i) => [(amp * DIAG[0] * a[i]) / ASPECT, amp * DIAG[1] * a[i]];
const chScene = (parts, truth, extra = {}) => ({ ...scene(parts, ['anal', 'penetration']), ref: T.map((ms, i) => [ms, 50 + 50 * truth[i]]), truth: (i) => truth[i], ...extra });
const AMP = 0.035;
/** The Bottom pushed along by the thrust (push x the stroke), the shove rippling up its body: each of parts at +lags ms, x decay. */
function bottom(cw, { push = 0.4, lags = [60, 120, 180], decay = [0.7, 0.5, 0.35], fast = false, parts = ['torso', 'shoulder', 'head'] } = {}) {
  const S = series((ms) => strokeAt(ms, fast)), P = { c1_hips: { at: add(at(0.4, 0.6), arr(S, AMP * push), cw) }, c1_thighs_l: { at: add(at(0.36, 0.7), arr(S, AMP * push), cw) } };
  const pos = { torso: [0.3, 0.5], shoulder: [0.24, 0.42], head: [0.18, 0.33] };
  parts.forEach((p, k) => { P[`c1_${p}`] = { at: add(at(...pos[p]), arr(series((ms) => strokeAt(ms - lags[k], fast)), AMP * push * decay[k]), cw) }; });
  return P;
}
/** The Top: hips + penis by truth (absent where gap), the balls hanging from the hips as a pendulum. */
function topOf(cw, S, { gap = null, balls = true, fast = false } = {}) {
  const P = { c2_hips: { at: add(at(0.5, 0.45), arr(S, AMP), cw), gap }, c2_penis: { at: add(at(0.46, 0.53), arr(S, AMP), cw), gap } };
  if (balls) { const sw = pendulum((ms) => strokeAt(ms, fast)); P.c2_balls = { at: add(at(0.47, 0.57), arr(S, AMP), arr(sw, AMP), cw) }; }
  return P;
}
const still = (cw) => ({ c1_hips: { at: add(at(0.4, 0.6), cw) }, c1_thighs_l: { at: add(at(0.36, 0.7), cw) } });
const on = (n) => (f) => (i) => f(i - (i % n));
export const CH_CASES = [
  { id: 'ch-rigid', point: 'rigid thrust only: the Top hips / penis / torso against a still Bottom; alignment must be a no-op', lagging: [], make: () => {
    const cw = cam(0.01), S = series((ms) => strokeAt(ms));
    return chScene({ ...still(cw), c1_torso: { at: add(at(0.28, 0.5), cw) }, ...topOf(cw, S, { balls: false }), c2_torso: { at: add(at(0.62, 0.3), arr(S, AMP), cw) } }, S);
  } },
  { id: 'ch-swing', point: 'the Top balls a driven damped pendulum (2 Hz, damping 0.2) from his hips; his hips + penis hidden 3 s mid-shot (8.5-11.5 s)', lagging: ['c2_balls'], make: () => {
    const cw = cam(0.01), S = series((ms) => strokeAt(ms)), g = (i) => T[i] >= 8500 && T[i] < 11500;
    return chScene({ ...still(cw), c1_torso: { at: add(at(0.28, 0.5), cw) }, ...topOf(cw, S, { gap: g }) }, S, { drop: [8500, 11500] });
  } },
  { id: 'ch-ripple', point: 'the Bottom pushed at 40 % of the thrust, the shove rippling hips -> torso -> shoulder -> head at +60 / 120 / 180 ms, decaying (0.7 / 0.5 / 0.35); truth = the Top against the Bottom hips', lagging: ['c1_torso', 'c1_shoulder', 'c1_head'], make: () => {
    const cw = cam(0.01), S = series((ms) => strokeAt(ms));
    return chScene({ ...bottom(cw), ...topOf(cw, S, { balls: false }) }, S);
  } },
  { id: 'ch-pushed', point: 'the Bottom pushed along at 40 % of the thrust (rigid, in phase) plus a pan (a quarter picture over 6-9 s) and a 1.3x zoom (12-14 s)', lagging: [], make: () => {
    const cw = cam(0.01), S = series((ms) => strokeAt(ms)), sl = ramp(6, 9, 0, 0.25), Z = zoomBy(ramp(12, 14, 1, 1.3));
    const P = { ...bottom(cw, { lags: [0], decay: [1], parts: ['torso'] }), ...topOf(cw, S, { balls: false }), c2_torso: { at: add(at(0.62, 0.3), arr(S, AMP), cw) } };
    return chScene(Object.fromEntries(Object.entries(P).map(([k, p]) => [k, { ...p, at: Z(add(p.at, (i) => [sl(i), 0])) }])), S);
  } },
  { id: 'ch-shaft', point: 'a shaft length reading (how much of the penis shows) seen 50 % of the time (1.5 s on / off), clean; the Top hips / torso noisy', lagging: [], make: () => {
    const cw = cam(0.01), S = series((ms) => strokeAt(ms)), r = rng(81), e = T.map(() => 0.03 * gauss(r));
    return chScene({ c1_hips: { at: add(at(0.4, 0.6), cw) }, c1_torso: { at: add(at(0.28, 0.5), cw) }, c2_hips: { at: add(at(0.5, 0.45), arr(S, AMP), jit(0.006, 82), cw) }, c2_torso: { at: add(at(0.62, 0.3), arr(S, AMP), jit(0.004, 83), cw) } }, S,
      { shaft: (i) => (Math.floor(T[i] / 1500) % 2 === 0 ? 0.5 + 0.4 * S[i] + e[i] : null) });
  } },
  ...[4, 8].map((d) => ({ id: `ch-drop${d}`, point: `the Top hips + penis (the main rows) lost for ${d} s mid-shot; his balls (pendulum) and the Bottom's pushed body / ripple stay`, lagging: ['c2_balls', 'c1_torso', 'c1_head'], make: () => {
    const cw = cam(0.01), S = series((ms) => strokeAt(ms)), t0 = 10000 - d * 500, t1 = 10000 + d * 500, g = (i) => T[i] >= t0 && T[i] < t1;
    return chScene({ ...bottom(cw, { parts: ['torso', 'head'], lags: [60, 180], decay: [0.7, 0.35] }), ...topOf(cw, S, { gap: g }) }, S, { drop: [t0, t1] });
  } })),
  { id: 'ch-twos', point: 'the Top animated on twos, the Bottom on threes (pushed 40 %, a 60 ms torso ripple): each character its own cadence; held.js retimes before fusion', lagging: ['c2_balls', 'c1_torso'], make: () => {
    const cw = cam(0.01), S = series((ms) => strokeAt(ms));
    const re = (P, n) => Object.fromEntries(Object.entries(P).map(([k, p]) => [k, { ...p, at: on(n)(p.at) }]));
    return chScene({ ...re(bottom(cw, { parts: ['torso'] }), 3), ...re(topOf(cw, S), 2) }, S, { held: true });
  } },
  { id: 'ch-short', point: 'a 4 s shot (3.5-7.5 s, the slow end of the tempo drift: ~4 strokes) with the balls and the Bottom ripple', lagging: ['c2_balls', 'c1_torso', 'c1_head'], make: () => {
    const cw = cam(0.01), S = series((ms) => strokeAt(ms));
    return chScene({ ...bottom(cw, { parts: ['torso', 'head'], lags: [60, 180], decay: [0.7, 0.35] }), ...topOf(cw, S) }, S, { idx: T.map((ms, i) => (ms >= 3500 && ms < 7500 ? i : -1)).filter((i) => i >= 0) });
  } },
  { id: 'ch-doubled', point: 'a frequency-doubled part: the Bottom head jolts the same way on both half-strokes (|stroke|), as big as the stroke', lagging: ['c1_head'], make: () => {
    const cw = cam(0.01), S = series((ms) => strokeAt(ms));
    return chScene({ ...still(cw), c1_head: { at: add(at(0.2, 0.33), arr(S.map(Math.abs), AMP), cw) }, ...topOf(cw, S, { balls: false }) }, S);
  } },
  { id: 'ch-fast', point: 'fast 500 ms strokes (1.9-2.1 Hz) and a big Top tail lagging 250 ms: half a period (the trap)', lagging: ['c2_tail'], make: () => {
    const cw = cam(0.01), S = series((ms) => strokeAt(ms, true)), L = series((ms) => strokeAt(ms - 250, true));
    return chScene({ ...still(cw), ...topOf(cw, S, { balls: false, fast: true }), c2_tail: { at: add(at(0.58, 0.4), arr(L, 2 * AMP), cw) } }, S);
  } },
];
