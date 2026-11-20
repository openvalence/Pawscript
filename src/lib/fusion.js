// fusion.js -- many tracked parts -> one stroke signal (paw-e3i, redesigned paw-iasp). Pure, CPU only, from what a points
// run stored (test/fusion.test.mjs; scored against the owner's scripts by experiments/fusion/score.mjs). Fuzzy, not rigid:
// nothing switches a part on or off by a name list or a cut-off; every factor is a smooth 0..1 membership, multiplied.
// The constants are FUSE / ROLE / ROWS / ACT_ROWS below. Per run scene:
//  1. parts: every painted group's centre (camera removed, aspect-scaled) as its motion around its own 2 s average. A part
//     painted in pieces (a repeat: 'c1_thighs_r2', 'head2': something in front of it) is ONE part: the pieces' motions are
//     averaged where they are seen, so their changing sizes and gaps do not matter.
//  2. bodies: each character's parts describe one body moving. A side of a relationship made of several parts of one
//     character ('Bottom hips / thighs') is that body's motion: the parts' mean weighted by role (core: hips, thighs,
//     torso; genitals; extremities: head, hands, paws, tail count little) and by how well each part agrees with the
//     rest of its body (a tail or a hand moving on its own is an outlier by degree). More parts = a better body
//     estimate, never more votes.
//  3. relationships: a fixed catalogue, not every pair: the two bodies against each other, the penis against the other
//     body, a head / hand / paws against the other one's genitals or body, a hand on its own genitals, a body against the
//     camera, each part alone (ROWS). One character only (solo, or one painted): the extremity nearest the genitals
//     against them, then the body against the camera, then the hips or head alone (SOLO_ROWS: a preference by prior,
//     not an if-chain). The scene's act tags tilt the priors (ACT_ROWS: rimming = Top head vs Bottom hips, ...); several
//     acts blend; a prior strength 0 ignores them. Missing parts simply drop their rows: the data wins.
//  4. each relationship's quality, from the data alone: rhythm (how periodic: the stroke repeats, a wander does not; on an
//     exact loop holding k strokes it is read at loop / k, paw-zhn4: there everything repeats at the loop itself),
//     signal over noise, presence, the tracker's fit. Prior x quality builds a reference stroke (sign-aligned to the
//     strongest row); then each row's phase against the reference: lag (a lagging tail fades smoothly:
//     1 / (1 + (lag / LAG_HALF)^2)), coherence (smoothstep), sign (an anti-phase row is the other side of the stroke).
//  5. weights per 2 s window (0.5 s hop, triangular cross-fade: an occluded part hands over smoothly): prior x pad x the
//     owner's own weight x quality x phase x (its agreement with the reference there)^2. fused = the weighted mean of the
//     sign-aligned, normalised rows, each minus its moving average over two strokes (a shallow stroke stays shallow);
//     oriented like the scene's sidecar pick (the F flip decides the final direction); 0..1 per scene.
// Controls (a shot's derive.fuse, rederive.js fuseClean): exclude [id] / pin [id] (the owner's choice always wins: an
// excluded part or row weighs 0; with pins only pinned rows, or a pinned part's own row, count), pad {x, y} (-1..1: x =
// relative <-> absolute, y = core <-> extremities; scales the priors smoothly, never to 0), prior (0..1: the act tags'
// strength), w {rowId: multiplier} (the full panel's per-row weights). The heavy part (parts, bodies, rows) is cached per
// run scene; a pad drag only re-weighs. info per scene: bodies (parts with phase / lag / coherence / say), relations
// (rows with prior, act gain, quality, phase, share), scene (acts and what they contributed), solo, auto / mix (where the
// automatic and the current weights sit on the pad), conf, windows; candidates = the rows in the old shape (lane strip,
// Fusion view). The 2-D body motions (before the stroke axis flattens them) are in info.motion {t, bodies: {who: {x, y}}}.
// paw-t11b: besides WHAT (the depth signal) fusion says HOW each half-stroke goes, from every part it read, also the ones
// with no say in the depth (voicesOf, lib/fusion-how.js readHow): info.how per scene, and the channel's `how` (every
// scene's turns and halves by time) that the Detail reads (stroke-shape.js shapeFit o.how).
// paw-wg2d: a run scene with the owner's anchors (derive.anchors) is solved backwards to them (fuseScene -> lib/anchors.js
// anchorFit, on the forward result): the mix, its polarity and the turns' timing; no anchors = the forward result exactly.
import { sceneAt } from './runs.js';
import { splitName, whoName, partWord } from '../features/tracking/groups.js';
import { readHow, HOW } from './fusion-how.js';
import { savgol, signalTurns } from './strokes.js';
import { seatDepth, depthRef, bodyScale, depthWord, CAM } from './depth-seat.js';
import { anchorLocal } from './anchors.js';

const fin = Number.isFinite;
/** Experiments only (experiments/fusion/jitter-*.mjs): with on, weigh() keeps its analysis and per-sample row weights. */
export const DEBUG = { on: false, last: null };

// ---- the knobs, in one place ----
export const FUSE = {
  GAP_MS: 300,            // gaps bridged in a part's track
  HP_MS: 2000,            // a part's motion = its centre minus its moving average over this
  WIN_MS: 2000, HOP_MS: 500,   // weighting windows
  LAG_MAX_MS: 400,        // phase search range
  // paw-bc9d: a lag of half a stroke with the sign flipped looks the same as no lag, so a phase search stays under this share
  // of the stroke period it searches against (lagRange: its turn spacing on the short side, at least 300 ms); between a peak
  // and its half-period twin the higher sub-sample peak wins. A HOW voice whose twin (looked for past the range too, within
  // LAG_MAX_MS) fits better than its reading loses say: x (1 - amb), amb = 1 - smooth(twin's residual 1 - r^2 / its own, LAG_AMB)
  LAG_P: 0.45,
  LAG_AMB: [2 / 3, 1],
  LAG_HALF_MS: 80,        // a row lagging the stroke this much keeps half its say
  COH: [0.1, 0.7],        // coherence (|r| with the reference) -> membership: none below, full above
  RHYTHM: [0.05, 0.45],   // rhythm (velocity autocorrelation peak in 0.25..2.5 s) -> membership
  NOISE_FH: 0.0015,       // stroke band (robust std, frame heights) at which a row is half noise
  AGREE: [-0.1, 0.6],     // a part's agreement with the rest of its body -> its say in the body
  FLOOR: 0.05,            // no membership goes below this: nothing is switched off by the data alone
  REF_SHARP: 2,           // the reference stroke weighs rows by weight^this: the most trusted rows define the stroke, not a blend between phases
  PAD_GAIN: 4,            // the pad at an edge multiplies the rows of that kind by this and divides the opposite ones
  EXTRA: 0.7,             // a Top row instantiated for the Extra character
  NEAR_FH: 0.15,          // solo: an extremity this much farther from the genitals than the nearest has 1/e of its prior
  NEAR_PAIRED: 0.3,       // ... and its rows count this much when the tags name an act of two (one character painted: the hand is less likely the stroke than the body)
  // paw-439e: the scene type limits itself. A row the act tags raise keeps its lift (prior x gain over its untagged prior)
  // only as far as it behaves in THIS shot: lift ^ (strength x limit), limit = behave x (1 - contradicted) x (TAG_ALONE +
  // (1 - TAG_ALONE) x confirmed), each 0..1 and smooth:
  //   behave       rhythm (TAG_RHYTHM, no floor) x signal over noise x presence x fit
  //   confirmed    agreement (COH, |r| at the best lag) with a rhythmic relationship that shares none of its parts
  //   contradicted an alternative at least as strong without the tags (its untagged prior x quality over the row's,
  //                TAG_DOM) and more periodic (TAG_RHY) that does not agree with it
  TAG_BASE: 0.3,          // the untagged prior of a row only an act names (the catalogue's extremity-to-other-body prior)
  TAG_RHYTHM: [0, 0.25],  // rhythm -> how well a tagged row behaves (no floor; real strokes read 0.15..0.8)
  TAG_COH: [0.3, 0.8],    // |r| between the tagged row and another -> agreement (none below, full above)
  TAG_DOM: [0.7, 1.4],    // an alternative's untagged standing over the tagged row's -> how strongly it can contradict
  TAG_RHY: [1, 1.3],      // ... x its rhythm over the tagged row's: only a cleaner (more periodic) alternative contradicts
  TAG_ALONE: 0.75,        // the share of its lift (as an exponent) a well-behaved, uncontradicted row keeps with nothing independent to confirm it
  TAG_IGNORED: 0.25,      // below this limit the explanation says the tag is ignored here; below TAG_PARTLY, partly
  TAG_PARTLY: 0.75,
  // paw-439e: an extremity in step with its body earns say there: role is a soft prior, sustained clean agreement (EARN on
  // its agreement with the rest of the body, x presence x fit) lifts it from ROLE_BODY.ext toward EXT_CEIL, and an
  // extremity that earned joins its body's side in the relationships (a tail stands in for occluded hips); EXT_CEIL < 1:
  // never more than a core part
  EARN: [0.8, 0.95],
  EXT_CEIL: 0.5,
  // paw-o74b: a group added to the run from a later seed frame (run.groupSeeds[].span) is not tracked outside its span:
  // there it is absent, and at a span edge inside the scene its say in its body and its rows' weights ramp from 0 over
  // this (smoothstep), so the fused stroke does not step where the part comes into view. Runs without spans: unchanged
  JOIN_MS: 400,
  // paw-5ynj: a part whose mean centre sits this close to a frame edge (frame fractions; none below, full above) is a sliver
  // the frame cuts: its centre is the visible sliver's, not the part's. On a POV shot that is the camera owner's own body
  // (hips at the bottom edge, leading the shaft and carrying camera motion of their own), which the contact row 'Bottom head
  // <-> Top penis / hips' otherwise averaged into the penis side: the turns landed early. Its say in its side and its fit
  // (so its rows' quality) x floor(smooth(distance, EDGE)). null = off
  EDGE: [0.04, 0.08],
  // paw-0sn8 (experiments/fusion/jitter-*.mjs, RESULTS.md): jitter. Per shot in derive.fuse.jit (the panel's chips):
  //   refine  a Savitzky-Golay pass (quadratic, flat holds kept) over the fused signal and its timing series, half-width
  //           refine x the stroke period (refinePeriod: on the short side), easing back to the signal itself within
  //           REFINE_KEEP half-widths of each turn (turns, impacts and the Detail's lopsided strokes stay); 0 = off. Default on
  //   rel     REL_ROWS: the Top's genital base (sheath / balls / knot) against the Bottom body, the penis against its base
  //   dir     one stroke direction per scene (rows within DIR_SNAP read along it, a row's share of motion across it lowers
  //           its weight per window: DIR_COH). Off by default: mixed on the owner's shots
  JIT: { dir: false, rel: true, refine: 0.15 },
  REFINE_KEEP: 2,
  DIR_COH: [0.3, 0.7],
  DIR_SNAP: (35 * Math.PI) / 180,
};
/** What a part is to its body: core (the body itself), gen (genitals), ext (extremities), measure (tracked for a measure:
 *  knot, bulges, tongue: no stroke say unless pinned), other. */
export const ROLE = { hips: 'core', thighs: 'core', torso: 'core', body: 'core', belly: 'core', head: 'ext', hand: 'ext', paws: 'ext', tail: 'ext', arm: 'ext', leg: 'ext', foot: 'ext', feet: 'ext', ear: 'ext',
  shoulder: 'ext', forearm: 'ext', shin: 'ext',   // paw-5r1: limb segments, extremities like hand / paws
  penis: 'gen', balls: 'gen', sheath: 'gen', slit: 'gen', anus: 'gen', knot: 'measure', tongue: 'measure', stomachbulge: 'measure', neckbulge: 'measure' };
export const roleOf = (part) => ROLE[part] || 'other';
/** A part's say in its body's motion, by role. */
export const ROLE_BODY = { core: 1, gen: 0.6, ext: 0.2, other: 0.2, measure: 0 };
const GROUPS = { core: ['hips', 'thighs', 'torso', 'body', 'belly'], gen: ['penis', 'balls', 'sheath', 'slit', 'anus'], ext: ['head', 'hand', 'paws', 'tail'] };
/**
 * The relationships fusion considers: [side A, side B ('cam' = against the camera), prior]. A side 'who:parts': who B =
 * Bottom (c1), T = Top (c2; also instantiated for the Extra at EXTRA), A = each character, O = each other character than
 * A, S = the same character as A; parts 'a|b' or a group name (core, gen, ext). Rows whose parts are not painted drop out.
 */
export const ROWS = [
  ['B:core', 'T:core', 1],              // the two bodies against each other: camera moves cancel
  ['T:penis', 'B:core', 0.8],
  ['B:penis', 'T:core', 0.3],
  ['A:head', 'O:penis|core', 0.3],
  ['A:hand', 'O:penis|balls|core', 0.3],
  ['A:paws', 'O:penis|core', 0.2],
  ['A:hand', 'S:penis|balls', 0.15],    // a hand on its own genitals
  ['A:core', 'cam', 0.12],              // a body against the camera (frame)
];
/** One character: the extremity nearest the genitals against them (each extremity a row, its prior falling off with
 *  distance: NEAR_FH), then the body against the camera, then the hips or the head alone (the phase decides). */
export const SOLO_ROWS = [
  ['A:near', 'S:gen|core', 1],
  ['A:core', 'cam', 0.6],
  ['A:hips', 'cam', 0.4],
  ['A:head', 'cam', 0.4],
];
/** paw-0sn8 (fuse.jit.rel): the Top's genitals ride the Top: against the Bottom, and the penis against its own base. */
export const REL_ROWS = [['T:sheath|knot', 'B:core', 0.8], ['T:penis', 'S:sheath|knot', 0.5]];
const SINGLE_PRIOR = 0.04, SINGLE_SOLO = 0.08, ACT_BASE = 1;   // each part alone; a row only an act names starts here
/** Acts of two characters (timeline/acts.js ids): with one of them tagged, a lone painted character is half of the act. */
export const TWO_ACTS = ['penetration', 'oral', 'licking', 'tonguefucking', 'handjob', 'footjob', 'grinding', 'fingering', 'fisting', 'titfuck', 'kissing', 'facesitting'];
/** An act row's 4th field: one row per painted part of side A (paw-0yfp: limbs), not one side of all of them; solo: only
 *  when one character is painted. */
const EACH = { each: true }, EACH_SOLO = { each: true, solo: true };
/** The scene type's influence: act tags (timeline/acts.js ids) -> rows and their gain (x the row's prior). The most
 *  specific matching entries win (fellatio = oral + penetration hides plain penetration); several acts blend (the mean
 *  gain per row). Edit here. */
export const ACT_ROWS = [
  { acts: ['penetration'], rows: [['T:penis|hips', 'B:hips|thighs', 3], ['B:core', 'T:core', 1.5]] },
  // self penetration (its own penis in itself, opt-in by its tag: a lone painted Bottom of a pair has its own penis swinging
  // against its own hips too, so plain penetration never reads that): the penis against its own opening / hips. A penis is
  // no extremity, so SOLO_ROWS' nearest extremity (which carries one's own tail in oneself) never reads it. Hides plain
  // penetration (implied by the tag)
  ...[['selfpen'], ['selfpen', 'penetration']].map((acts) => ({ acts, rows: [['A:penis', 'S:anus|slit|hips|thighs', 3]] })),
  { acts: ['oral', 'penetration'], rows: [['B:head', 'T:penis|hips', 3]] },
  { acts: ['oral'], rows: [['B:head', 'T:penis|hips', 3]] },
  { acts: ['oral', 'licking'], rows: [['B:head', 'T:penis|balls|hips', 3]] },
  { acts: ['licking'], rows: [['T:head', 'B:hips|thighs', 3]] },                // rimming, cunnilingus
  { acts: ['tonguefucking'], rows: [['T:head', 'B:hips|thighs', 3]] },
  { acts: ['handjob'], rows: [['A:hand', 'O:penis|balls|hips', 3]] },
  { acts: ['masturbation'], rows: [['A:hand', 'S:penis|balls|hips', 3]] },
  { acts: ['footjob'], rows: [['A:paws', 'O:penis|hips', 3]] },
  { acts: ['grinding'], rows: [['B:hips|thighs', 'T:hips|thighs', 3]] },
  // paw-0yfp: an arm goes in (or holds what goes in): the giver's limb chain hand - forearm - upper arm (shoulder) against
  // the receiver's hips / thighs, either character giving (O), or one's own arm in oneself (S; only with one character
  // painted: beside a partner the giver's own hips are no receiver). EACH: one row per painted
  // limb part (c2_forearm_r and c2_forearm_l apart: the idle arm is not averaged into the one that goes in; a lone part's
  // row is not down-weighted by its agreement with its own body). Fisting: the hand is inside, the forearm is what shows
  // and slides along its own length (a row reads along its own principal direction); the upper arm as support. Fingering:
  // the hand shows, the forearm supports. Toy: the hand holding it
  ...[['fisting', 'forearm', 3, 'hand', 1.5], ['fingering', 'hand', 3, 'forearm', 1.5], ['toy', 'hand', 2, 'forearm', 1]].flatMap(([act, lead, g, sup, gs]) => {
    const rows = ['O', 'S'].flatMap((w) => [[`A:${lead}`, `${w}:hips|thighs`, g, w === 'S' ? EACH_SOLO : EACH], [`A:${sup}`, `${w}:hips|thighs`, gs, w === 'S' ? EACH_SOLO : EACH], ['A:shoulder', `${w}:hips|thighs`, 1, w === 'S' ? EACH_SOLO : EACH]]);
    return [{ acts: [act], rows }, { acts: [act, 'penetration'], rows }];   // the arm, not a penis, is what goes in: hides plain penetration
  }),
  { acts: ['titfuck'], rows: [['B:torso', 'T:penis|hips', 3]] },
  { acts: ['kissing'], rows: [['B:head', 'T:head', 2]] },
  { acts: ['dancing'], rows: [['A:hips', 'cam', 3], ['A:core', 'cam', 1.5]] },   // paw-n00h: the hips against the frame, then the body; a swinging penis is not the dance
  // paw-210e: a tail on a penis, a partner's or its own (as handjob + masturbation; never its own hips: a tail wags on its
  // base); a tail in the Bottom (as fisting: the Top penetrates; one's own tail in oneself: SOLO_ROWS' nearest extremity);
  // the sitter's hips on the other's head, either one sitting (a row reads along its own repeating direction: a sideways
  // rock is the stroke)
  { acts: ['tailjob'], rows: [['A:tail', 'O:penis|balls|hips', 3], ['A:tail', 'S:penis|balls', 3]] },
  { acts: ['tailpen'], rows: [['T:tail', 'B:hips|thighs', 3]] },
  { acts: ['facesitting'], rows: [['A:hips', 'O:head', 3]] },
];

/** The run's painted groups with a stored centre: [{key: 'sem_c1_hips', name: 'c1_hips', who, part}]. */
export function fusionGroups(run) {
  const ch = run?.channels || {};
  return Object.keys(ch).filter((k) => /^sem_[a-z0-9_]+_x$/.test(k) && ch[k.slice(0, -2) + '_y']).map((k) => {
    const name = k.slice(4, -2), s = splitName(name);
    return { key: k.slice(0, -2), name, who: s.who, part: s.part };
  });
}
/** Does the run have parts to fuse (two groups or more with data)? */
export const canFuse = (run) => fusionGroups(run).filter((g) => run.channels[g.key + '_x'].v.some((y) => y === y)).length >= 2;

// ---- small numerics over Float64Arrays with NaN gaps ----
function bridge(t, v, gapMs) {
  const n = v.length, out = Float64Array.from(v);
  let a = -1;
  for (let i = 0; i < n; i++) {
    if (v[i] === v[i]) {
      if (a >= 0 && i - a > 1 && t[i] - t[a] <= gapMs) for (let k = a + 1; k < i; k++) out[k] = v[a] + ((v[i] - v[a]) * (t[k] - t[a])) / (t[i] - t[a]);
      a = i;
    }
  }
  return out;
}
function movAvgNaN(v, w) {
  const n = v.length, h = Math.floor(w / 2), cs = new Float64Array(n + 1), cn = new Float64Array(n + 1), out = new Float64Array(n);
  for (let i = 0; i < n; i++) { const ok = v[i] === v[i]; cs[i + 1] = cs[i] + (ok ? v[i] : 0); cn[i + 1] = cn[i] + (ok ? 1 : 0); }
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - h), b = Math.min(n, i + h + 1), c = cn[b] - cn[a]; out[i] = v[i] === v[i] && c ? (cs[b] - cs[a]) / c : NaN; }
  return out;
}
const med = (a) => { const b = a.filter(fin).sort((x, y) => x - y), m = b.length >> 1; return b.length ? (b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2) : NaN; };
function corr(x, y, a = 0, b = x.length, lag = 0) {
  let n = 0, sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (let i = Math.max(a, a - lag); i < Math.min(b, b - lag); i++) {
    const u = x[i + lag], v = y[i];
    if (u !== u || v !== v) continue;
    n++; sx += u; sy += v; sxy += u * v; sxx += u * u; syy += v * v;
  }
  if (n < 8) return NaN;
  const vx = sxx - (sx * sx) / n, vy = syy - (sy * sy) / n;
  return vx > 1e-12 && vy > 1e-12 ? (sxy - (sx * sy) / n) / Math.sqrt(vx * vy) : NaN;
}
const smooth = (x, [a, b]) => (x <= a ? 0 : x >= b ? 1 : ((x - a) / (b - a)) ** 2 * (3 - (2 * (x - a)) / (b - a)));
const floor = (m) => FUSE.FLOOR + (1 - FUSE.FLOOR) * m;
/** Unit principal axis of 2-D rows (pca_axis's sign: up, else right, positive). */
function pca(X, Y) {
  let n = 0, mx = 0, my = 0;
  for (let i = 0; i < X.length; i++) if (X[i] === X[i] && Y[i] === Y[i]) { mx += X[i]; my += Y[i]; n++; }
  if (n < 3) return null;
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < X.length; i++) if (X[i] === X[i] && Y[i] === Y[i]) { const a = X[i] - mx, b = Y[i] - my; sxx += a * a; syy += b * b; sxy += a * b; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let ax = Math.cos(th), ay = Math.sin(th);
  if ((Math.abs(ay) >= Math.abs(ax) && ay > 0) || (Math.abs(ax) > Math.abs(ay) && ax < 0)) { ax = -ax; ay = -ay; }
  return [ax, ay];
}
function axisDir(axis, aspect) {
  const m = axis?.mode;
  if (m === 'vertical') return [0, -1];
  if (m === 'horizontal') return [1, 0];
  if (m === 'custom') { const dx = (axis.x1 - axis.x0) * aspect, dy = axis.y1 - axis.y0, L = Math.hypot(dx, dy); return L > 1e-6 ? [-dx / L, -dy / L] : null; }
  return null;
}
/** Rhythm of a velocity series (NaN = unknown): its autocorrelation's highest LOCAL peak in 0.2 .. 2.5 s -> {ms (the
 *  stroke period, 0 = none), r (that peak, 0..1: how periodic)}. On velocity, never on a detrended position: a moving
 *  average's own ripple would read as a rhythm. */
export function rhythmOf(vel, dt) {
  const d = Float64Array.from(vel, (a) => (a === a ? a : 0)), n = d.length;
  let mu = 0;
  for (let i = 0; i < n; i++) mu += d[i];
  mu /= n || 1;
  let v0 = 0;
  for (let i = 0; i < n; i++) { d[i] -= mu; v0 += d[i] * d[i]; }
  if (!(v0 > 0)) return { ms: 0, r: 0 };
  const L0 = Math.max(2, Math.round(200 / dt)), L1 = Math.min((n >> 1) - 1, Math.round(2500 / dt)), r = new Float64Array(L1 + 2);
  for (let L = L0 - 1; L <= L1 + 1; L++) { let s = 0; for (let i = 0; i + L < n; i++) s += d[i] * d[i + L]; r[L] = s / v0; }
  let best = 0, br = 0;
  for (let L = L0; L <= L1; L++) if (r[L] > br && r[L] >= r[L - 1] && r[L] >= r[L + 1]) { br = r[L]; best = L; }
  return { ms: best * dt, r: br };
}

/** paw-zhn4: rhythmOf's autocorrelation of a velocity series (NaN = 0, mean removed) at lag x (samples, fractional:
 *  linear between the two whole lags); NaN when the series has no motion. */
function acfAt(vel, x) {
  const n = vel.length, d = Float64Array.from(vel, (a) => (a === a ? a : 0));
  let mu = 0;
  for (let i = 0; i < n; i++) mu += d[i];
  mu /= n || 1;
  let v0 = 0;
  for (let i = 0; i < n; i++) { d[i] -= mu; v0 += d[i] * d[i]; }
  if (!(v0 > 0)) return () => NaN;
  const at = (L) => { let s = 0; for (let i = 0; i + L < n; i++) s += d[i] * d[i + L]; return s / v0; };
  return (y = x) => { const a = Math.floor(y), f = y - a; return f ? (1 - f) * at(a) + f * at(a + 1) : at(a); };
}
/** paw-zhn4: rhythm read at a known stroke period P (ms): the highest autocorrelation within 0.8..1.2 P -> {ms, r} as
 *  rhythmOf ({0, 0}: nothing periodic there). */
export function rhythmNear(vel, dt, P) {
  const A = acfAt(vel, 0), lo = Math.max(2, Math.round((0.8 * P) / dt)), hi = Math.min((vel.length >> 1) - 1, Math.round((1.2 * P) / dt));
  let best = 0, br = 0;
  for (let L = lo; L <= hi; L++) { const r = A(L); if (r > br) { br = r; best = L; } }
  return { ms: best * dt, r: br };
}
/** paw-zhn4: the stroke period of an exact loop of loopMs: loop / k for the largest k (2..LOOP_K.max, the stroke at least
 *  LOOP_K.minMs) that the rows' own motion supports. On an exact loop everything repeats at the loop, tracker jitter and a
 *  still part included, so a vote for one stroke per loop says nothing; a row supports k when it repeats at loop / k
 *  (autocorrelation >= LOOP_K.r) and runs the other way half a stroke later (< 0 at loop / 2k: a stroke, not a harmonic).
 *  k wins when its supporters (each by its presence x fit x signal over noise x that autocorrelation: data only, no prior,
 *  no act gain) hold LOOP_K.share of all the rows' weight. null = one stroke per loop: the rows read as today. */
function loopStroke(rows, dt, loopMs) {
  const live = rows.map((r) => ({ w: r.pres * r.fitMean * r.qNoise, A: acfAt(r.vel, 0) })).filter((x) => x.w > 0);
  const W = live.reduce((s, x) => s + x.w, 0);
  if (!(W > 0)) return null;
  let out = null;
  for (let k = 2; k <= LOOP_K.max && loopMs / k >= LOOP_K.minMs; k++) {
    const P = loopMs / k;
    let s = 0;
    for (const x of live) { const r = x.A(P / dt); if (r >= LOOP_K.r && x.A(P / 2 / dt) < 0) s += x.w * r; }
    if (s / W >= LOOP_K.share) out = { k, ms: P, loopMs, support: +(s / W).toFixed(3) };
  }
  return out;
}
export const LOOP_K = { max: 8, minMs: 250, r: 0.3, share: 0.2 };

/** paw-o74b: a part's join ramp over the scene's times t from its pieces' tracked spans (run.groupSeeds[].span: a group
 *  added from a later seed frame): 0 outside, smoothstep from a span edge inside the scene over JOIN_MS, 1 elsewhere; a piece
 *  without a span counts 1 (the part's ramp is the largest of its pieces'). null when no piece has a span (no change). */
function joinFade(run, names, t) {
  // paw-o74b.1: a part seeded on several frames is stitched into one track: it starts / ends where the union of its seeds'
  // spans does (no ramp at a handover); a seed without a span (tracked with the run) covers the whole run
  const span = (n) => {
    const l = (run?.groupSeeds || []).filter((s) => s?.name === n && (!Array.isArray(s.span) || (s.span[1] >= t[0] && s.span[0] <= t[t.length - 1])));
    if (!l.length || l.some((s) => !(Array.isArray(s.span) && fin(s.span[0]) && fin(s.span[1])))) return null;
    return [Math.min(...l.map((s) => s.span[0])), Math.max(...l.map((s) => s.span[1]))];
  };
  const sp = names.map(span);
  if (!sp.some(Boolean) || !t.length) return null;
  const m = t.length, half = m > 1 ? (t[m - 1] - t[0]) / (m - 1) / 2 : 17, out = new Float64Array(m);
  for (const s of sp) {
    for (let q = 0; q < m; q++) {
      if (!s) { out[q] = 1; continue; }
      if (t[q] < s[0] - half || t[q] > s[1] + half) continue;
      const a = s[0] <= t[0] + half ? 1 : smooth(t[q] - s[0], [0, FUSE.JOIN_MS]), b = s[1] >= t[m - 1] - half ? 1 : smooth(s[1] - t[q], [0, FUSE.JOIN_MS]);
      out[q] = Math.max(out[q], Math.min(a, b));
    }
  }
  return out;
}

// ---- 1-2: parts and bodies ----
/** The scene's parts, repeats merged: [{id (base name), names (pieces), who, part, role, dx, dy (motion), on (present),
 *  fit, at ([x, y] mean position), say (in its body: role x agreement)}]. */
function partsOf(run, idx, t, aspect, exclude) {
  const ch = run.channels, m = idx.length, by = new Map();
  for (const g of fusionGroups(run)) {
    const id = g.name.replace(/\d+$/, '');
    if (exclude.has(id) || exclude.has(g.name)) continue;
    const X = new Float64Array(m), Y = new Float64Array(m), F = new Float64Array(m), fc = ch[g.key + '_fit'];
    let ok = 0;
    idx.forEach((j, q) => { const x = ch[g.key + '_x'].v[j], y = ch[g.key + '_y'].v[j]; X[q] = x === x && x != null ? x * aspect : NaN; Y[q] = y === y && y != null ? y : NaN; if (X[q] === X[q]) ok++; const f = fc?.v[j]; F[q] = f === f && f != null ? f : 1; });
    if (ok < 8) continue;
    const Xb = bridge(t, X, FUSE.GAP_MS), Yb = bridge(t, Y, FUSE.GAP_MS), w = Math.max(3, Math.round(FUSE.HP_MS / ((t[m - 1] - t[0]) / (m - 1) || 33)));
    const mx = movAvgNaN(Xb, w), my = movAvgNaN(Yb, w);
    const vel = (V) => V.map((x, q) => (q ? x - V[q - 1] : NaN));
    const piece = { name: g.name, dx: Xb.map((x, q) => x - mx[q]), dy: Yb.map((y, q) => y - my[q]), vx: vel(Xb), vy: vel(Yb), F, X: Xb, Y: Yb };
    if (!by.has(id)) by.set(id, { id, who: g.who, part: g.part, pieces: [] });
    by.get(id).pieces.push(piece);
  }
  const out = [];
  for (const p of by.values()) {
    const dx = new Float64Array(m).fill(NaN), dy = new Float64Array(m).fill(NaN), vx = new Float64Array(m).fill(NaN), vy = new Float64Array(m).fill(NaN), fit = new Float64Array(m), on = new Uint8Array(m);
    let sx = 0, sy = 0, sn = 0;
    for (let q = 0; q < m; q++) {
      let a = 0, b = 0, f = 0, n = 0, c = 0, e = 0, k = 0;
      for (const pc of p.pieces) if (pc.dx[q] === pc.dx[q] && pc.dy[q] === pc.dy[q]) { a += pc.dx[q]; b += pc.dy[q]; f += pc.F[q]; n++; sx += pc.X[q]; sy += pc.Y[q]; sn++; if (pc.vx[q] === pc.vx[q] && pc.vy[q] === pc.vy[q]) { c += pc.vx[q]; e += pc.vy[q]; k++; } }
      if (n) { dx[q] = a / n; dy[q] = b / n; fit[q] = f / n; on[q] = 1; }
      if (k) { vx[q] = c / k; vy[q] = e / k; }
    }
    out.push({ id: p.id, names: p.pieces.map((pc) => pc.name), who: p.who, part: p.part, role: roleOf(p.part), dx, dy, vx, vy, fit, on, at: sn ? [sx / sn, sy / sn] : [NaN, NaN], say: ROLE_BODY[roleOf(p.part)], fade: joinFade(run, p.pieces.map((pc) => pc.name), t) });
  }
  // paw-5ynj: a sliver at the frame edge (FUSE.EDGE) has less say in its body / side and less fit in its rows
  if (FUSE.EDGE) for (const p of out) {
    const x = p.at[0] / aspect, e = floor(smooth(Math.min(x, 1 - x, p.at[1], 1 - p.at[1]), FUSE.EDGE));
    if (!(e < 1)) continue;
    p.edge = e; p.say *= e;
    for (let q = 0; q < m; q++) p.fit[q] *= e;
  }
  // a body as a whole: each part's agreement (2-D) with the rest of its character's parts -> its say there, by degree
  /** p's 2-D agreement (cosine over the frames both are seen) with the say-weighted mean of the parts os */
  const agreeWith = (p, os) => {
    let sab = 0, saa = 0, sbb = 0;
    for (let q = 0; q < m; q++) {
      if (!p.on[q]) continue;
      let bx = 0, by2 = 0, bw = 0;
      for (const o of os) if (o.on[q]) { bx += o.say * o.dx[q]; by2 += o.say * o.dy[q]; bw += o.say; }
      if (!bw) continue;
      bx /= bw; by2 /= bw;
      sab += p.dx[q] * bx + p.dy[q] * by2; saa += p.dx[q] ** 2 + p.dy[q] ** 2; sbb += bx * bx + by2 * by2;
    }
    return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
  };
  const whos = [...new Set(out.map((p) => p.who))];
  for (const w of whos) {
    const ps = out.filter((p) => p.who === w && p.say > 0);
    if (ps.length < 2) continue;
    for (const p of ps) p.agree = agreeWith(p, ps.filter((o) => o !== p));
    // paw-439e: an extremity's agreement with the body itself (its core and genitals: two hands agreeing with each other
    // are not the body); sustained (the whole scene) and clean (presence x fit) agreement earns it say, up to EXT_CEIL
    const core = ps.filter((o) => o.role === 'core' || o.role === 'gen');
    for (const p of ps) if (p.role === 'ext' && core.length) {
      let n = 0, f = 0;
      for (let q = 0; q < m; q++) if (p.on[q]) { n++; f += p.fit[q]; }
      p.agreeCore = agreeWith(p, core);
      p.earn = smooth(p.agreeCore, FUSE.EARN) * (n / m) * (n ? f / n : 0);
    }
    for (const p of ps) p.say = p.say * floor(smooth(p.agree, FUSE.AGREE)) + (p.earn ? (FUSE.EXT_CEIL - ROLE_BODY.ext) * p.earn : 0);
  }
  return out;
}

// ---- 3: the relationships ----
const CHARS = ['c1', 'c2', 'x'];
const expand = (spec) => spec.split('|').flatMap((s) => GROUPS[s] || [s]);
/** The rows of the scene (catalogue + solo + acts, resolved on the painted parts). */
function rowsOf(parts, acts, J = FUSE.JIT) {
  const chars = CHARS.filter((w) => parts.some((p) => p.who === w && p.say > 0));
  const solo = chars.length <= 1;
  // unnamed parts (plain 'penis', 'hips': seeded by the tagger, no character) stand in for a part the character lacks
  // paw-439e: a body side ('core') also takes its character's extremities that earned say there (partsOf: in step with the
  // body), each weighing EXT_CEIL x what it earned (an unearned one: nothing)
  const earned = (p) => Object.create(p, { say: { value: FUSE.EXT_CEIL * p.earn }, earned: { value: true } });
  const side = (w, spec, not = []) => {
    const want = expand(spec), no = new Set(not.map((p) => p.id)), named = w ? parts.filter((p) => p.who === w && want.includes(p.part)) : [];
    const un = parts.filter((p) => !p.who && want.includes(p.part) && (!w || !chars.length || (p.role === 'gen' && !parts.some((q) => q.who && q.part === p.part))));
    const ext = w && spec.split('|').includes('core') ? parts.filter((p) => p.who === w && p.role === 'ext' && p.earn > 0 && !want.includes(p.part)).map(earned) : [];
    // paw-0sn8: a measure part named by a REL_ROWS side (the knot) counts there like a genital part
    return [...named, ...un, ...ext].filter((p) => (p.role !== 'measure' || (meas && want.includes(p.part))) && !no.has(p.id)).map((p) => (p.role === 'measure' ? Object.create(p, { say: { value: ROLE_BODY.gen } }) : p));
  };
  let meas = false;   // paw-0sn8: a measure part (knot) joins a side only in the rows that name it (REL_ROWS)
  const rows = new Map();
  const add = (id, A, B, prior, { act = false, ...extra } = {}) => {
    if (!A.length || (B && !B.length) || (B && A.every((p) => B.some((q) => q.id === p.id)))) return null;
    const r = rows.get(id);
    if (r) { r.prior = Math.max(r.prior, prior); if (!act) r.prior0 = Math.max(r.prior0, prior); Object.assign(r, extra); return r; }
    const nr = { id, A, B, prior, prior0: act ? 0 : prior, gains: [], ...extra };   // prior0: the prior without the act tags (paw-439e)
    rows.set(id, nr);
    return nr;
  };
  const rid = (aw, as, bw, bs) => `${aw || 'u'}:${as}~${bs === 'cam' ? 'cam' : `${bw || 'u'}:${bs}`}`;
  const put = (aw, as, bw, bs, prior, extra = {}) => { const A = side(aw, as); return add(rid(aw, as, bw, bs), A, bs === 'cam' ? null : side(bw, bs, A), prior, extra); };
  /** Instantiate a [a, b, prior] spec over the characters: B / T / A / O / S. */
  const each = (a, b, f) => {
    const [ak, as] = a.split(':'), [bk, bs] = b === 'cam' ? [null, 'cam'] : b.split(':');
    const has = (ws) => ws.filter((w) => chars.includes(w));
    const whoA = ak === 'B' ? has(['c1']) : ak === 'T' ? has(['c2', 'x']) : chars.length ? chars : [null];
    for (const wa of whoA) {
      const k = wa === 'x' && ak === 'T' ? FUSE.EXTRA : 1;
      const whoB = bs === 'cam' ? [null] : bk === 'B' ? has(['c1']) : bk === 'T' ? has(['c2', 'x']) : bk === 'S' ? [wa] : chars.filter((c) => c !== wa && !(c === 'x' && wa === 'c2') && !(c === 'c2' && wa === 'x'));   // never Top x Extra (paw-uzzr)
      for (const wb of whoB) if (bs === 'cam' || wb !== wa || bk === 'S') f(wa, as, wb, bs, k);
    }
  };
  if (solo) {
    const paired = (acts || []).some((a) => TWO_ACTS.includes(a));
    const gen = parts.filter((p) => p.role === 'gen' || (p.role === 'core' && !parts.some((q) => q.role === 'gen'))), ext = parts.filter((p) => p.role === 'ext');
    const gc = gen.length ? [gen.reduce((s, p) => s + p.at[0], 0) / gen.length, gen.reduce((s, p) => s + p.at[1], 0) / gen.length] : null;
    const d = (p) => Math.hypot(p.at[0] - gc[0], p.at[1] - gc[1]), dmin = gc ? Math.min(...ext.map(d)) : 0;
    for (const [a, b, pr] of SOLO_ROWS) {
      if (a === 'A:near') { if (gc) for (const p of ext) add(`${p.id}~${p.who || 'u'}:${b.slice(2)}`, [p], side(p.who, b.slice(2), [p]), pr * Math.exp(-(d(p) - dmin) / FUSE.NEAR_FH) * (paired ? FUSE.NEAR_PAIRED : 1), { kind: 'near' }); continue; }
      each(a, b, (wa, as, wb, bs) => put(wa, as, wb, bs, pr, { kind: b === 'cam' ? (as === 'core' ? 'camera' : as) : 'own' }));
    }
  }
  for (const [a, b, pr] of ROWS) each(a, b, (wa, as, wb, bs, k) => put(wa, as, wb, bs, pr * k));
  if (J.rel && !solo) { meas = true; for (const [a, b, pr] of REL_ROWS) each(a, b, (wa, as, wb, bs, k) => put(wa, as, wb, bs, pr * k)); meas = false; }
  if (parts.some((p) => !p.who && p.part === 'penis') && parts.some((p) => !p.who && p.part === 'hips')) put(null, 'penis', null, 'hips', 0.8);
  // each part alone (a part with a side, 'c1_hand_r', is its own row): the panel and pins reach every part; measure parts weigh 0
  for (const p of parts) add(`${p.id}~cam`, [p], null, p.role === 'measure' ? 0 : solo ? SINGLE_SOLO : SINGLE_PRIOR, { single: p.id });
  // the scene type: the most specific matching entries, their gains blended per row
  const tags = new Set(acts || []), hit = ACT_ROWS.filter((e) => e.acts.every((a) => tags.has(a)));
  const used = hit.filter((e) => !hit.some((o) => o !== e && o.acts.length > e.acts.length && e.acts.every((a) => o.acts.includes(a))));
  for (const e of used) for (const [a, b, g, o] of e.rows) each(a, b, (wa, as, wb, bs, k) => {
    if (o?.solo && !solo) return;
    const rs = o?.each ? side(wa, as).map((p) => add(`${p.id}~${wb || 'u'}:${bs}`, [p], side(wb, bs, [p]), ACT_BASE * k, { act: true })) : [put(wa, as, wb, bs, ACT_BASE * k, { act: true })];
    for (const r of rs) if (r) r.gains.push({ act: e.acts.join('+'), g });
  });
  // the same parts on both sides = one row (its other ids kept as aliases: a pin or an exclude by either works)
  const uniq = new Map();
  for (const r of rows.values()) {
    const k = r.B ? [r.A, r.B].map((S) => S.map((p) => p.id).sort().join(',')).sort().join('~') : r.A.map((p) => p.id).sort().join(',') + '~cam';   // A - B and B - A: one row (the sign is found)
    const o = uniq.get(k);
    if (!o) { uniq.set(k, r); r.alias = []; continue; }
    o.alias.push(r.id); o.prior = Math.max(o.prior, r.prior); o.prior0 = Math.max(o.prior0, r.prior0); o.gains.push(...r.gains); if (r.single) o.single = r.single; if (r.kind && !o.kind) o.kind = r.kind;
  }
  rows.clear();
  for (const r of uniq.values()) rows.set(r.id, r);
  for (const r of rows.values()) {
    // blended gain: the mean over the matching entries (an entry that does not name the row counts 1)
    const per = used.map((e) => r.gains.filter((x) => x.act === e.acts.join('+')).reduce((mx, x) => Math.max(mx, x.g), 1));
    r.gain = per.length ? per.reduce((s, x) => s + x, 0) / per.length : 1;
    const all = [...r.A, ...(r.B || [])];
    r.abs = r.B ? 0 : 1;
    r.ext = all.reduce((s, p) => s + (p.role === 'ext' ? 1 : 0), 0) / all.length;
    if (!r.kind) r.kind = r.single ? 'single' : r.B ? (r.A[0].who && r.A[0].who === r.B[0].who ? 'own' : 'relative') : 'camera';
  }
  return { rows: [...rows.values()], solo, chars, acts: used.map((e) => e.acts.join('+')) };
}
const sideWho = (S) => S[0]?.who || null;
function sideLabel(S0) {
  const S = S0.some((p) => !p.earned) ? S0.filter((p) => !p.earned) : S0;   // an extremity that joined its body is not named
  const w = sideWho(S), parts = [...new Set(S.map((p) => p.part))];
  const core = parts.filter((x) => GROUPS.core.includes(x)).length;   // paw-0sn8: genitals alone (sheath / balls / knot) are named, not 'body'
  const word = (parts.length >= 3 && core) || (parts.length > 1 && core === parts.length) ? 'body' : parts.map((x) => partWord(x)).join(' / ');
  const side = S.length === 1 && /_([lr])$/.exec(S[0].id)?.[1];
  return `${w ? whoName(w) + ' ' : ''}${side ? side.toUpperCase() + ' ' : ''}${word}`;
}
const rowLabel = (r) => (r.B ? `${sideLabel(r.A)} ↔ ${sideLabel(r.B)}` : `${sideLabel(r.A)}${r.single ? '' : ' vs camera'}`);

/** A side's motion: its parts' mean, each by its say in the body (one part: itself) -> {dx, dy, on, fit, w: [part share]}. */
function sideMotion(S, m) {
  const dx = new Float64Array(m).fill(NaN), dy = new Float64Array(m).fill(NaN), vx = new Float64Array(m).fill(NaN), vy = new Float64Array(m).fill(NaN), fit = new Float64Array(m), on = new Uint8Array(m);
  const say = S.length === 1 ? [1] : S.map((p) => Math.max(1e-3, p.say)), tot = say.reduce((a, b) => a + b, 0);
  const ramp = S.some((p) => p.fade) ? new Float64Array(m) : null;   // paw-o74b: the side's presence ramp (its parts' join ramps)
  for (let q = 0; q < m; q++) {
    let a = 0, b = 0, f = 0, w = 0, c = 0, e = 0, k = 0;
    S.forEach((p, i) => {
      if (!p.on[q]) return;
      const s = p.fade ? say[i] * p.fade[q] : say[i];
      if (ramp) ramp[q] = Math.max(ramp[q], p.fade ? p.fade[q] : 1);
      a += s * p.dx[q]; b += s * p.dy[q]; f += s * p.fit[q]; w += s; if (p.vx[q] === p.vx[q]) { c += s * p.vx[q]; e += s * p.vy[q]; k += s; }
    });
    if (w) { dx[q] = a / w; dy[q] = b / w; fit[q] = f / w; on[q] = 1; }
    if (k) { vx[q] = c / k; vy[q] = e / k; }
  }
  return { dx, dy, vx, vy, fit, on, w: say.map((s) => s / tot), ramp };
}

// ---- the analysis (cached): parts, bodies, rows and their data-only quality ----
const CACHE = new WeakMap();
function analyse(run, idx, { aspect, axis, exclude, acts, J = FUSE.JIT, loopMs = 0 }) {
  const ch = run.channels, gs = fusionGroups(run), src = ch[gs[0].key + '_x'];
  // ponytail: keyed on the first group's channel object + the group names; a caller that swaps one other group's channel
  // alone (nothing does: fusionInput rebuilds them all) would read a stale analysis
  const key = JSON.stringify([gs.map((g) => g.name), idx[0], idx.length, idx[idx.length - 1], aspect, axis || null, [...exclude].sort(), acts || null, (run.groupSeeds || []).map((s) => s?.span || null), !!J.dir, !!J.rel, J.dir ? FUSE.DIR_SNAP : 0, CAM.ZOOM, FUSE.EDGE,...(loopMs > 0 ? [loopMs] : [])]);
  let memo = CACHE.get(src);
  if (!memo) CACHE.set(src, (memo = new Map()));
  if (memo.has(key)) return memo.get(key);
  const m = idx.length, t = idx.map((j) => src.t[j]), dt = (t[m - 1] - t[0]) / (m - 1) || 1000 / 30, u = axisDir(axis, aspect);
  const parts = partsOf(run, idx, t, aspect, exclude);
  const R = parts.length ? rowsOf(parts, acts, J) : { rows: [], solo: true, chars: [], acts: [] };
  const lw = (per) => Math.max(3, Math.round(Math.min(4000, Math.max(800, 2 * (per || FUSE.HP_MS / 2))) / dt));
  const SM = R.rows.map((r) => [sideMotion(r.A, m), r.B ? sideMotion(r.B, m) : null]);
  // a row's 2-D motion: its sides' velocities (A minus B) summed into a relative position where both are seen, minus its own
  // moving average over HP_MS there. paw-0sn8: built from velocities, not from each part's position about its own average,
  // so a part seen only part of the time (dropping out, a piece) is centred on the same frames as its other side and its
  // gaps are absence, never motion
  const wHP = Math.max(3, Math.round(FUSE.HP_MS / dt));
  // paw-gy1r: in body units where the camera zooms (depth-seat.js bodyScale: the characters' own size per frame; null = no
  // zoom worth correcting, nothing changes): a push-in does not make the strokes bigger. BS.move: where the camera moves
  const BS = bodyScale(run, idx, src.t, aspect), S = BS.s;
  const relPos = (va, vb, a, b) => { let acc = 0; const P = new Float64Array(m); for (let q = 0; q < m; q++) { const d = va[q] - (b ? vb[q] : 0); if (d === d) acc += S ? d / S[q] : d; P[q] = a.on[q] && (!b || b.on[q]) ? acc : NaN; } const M = movAvgNaN(P, wHP); return P.map((x, q) => x - M[q]); };
  const XY = SM.map(([a, b]) => [relPos(a.vx, b?.vx, a, b), relPos(a.vy, b?.vy, a, b)]);
  // paw-0sn8 (jit.dir): the stroke is motion along one direction. A row's own direction = where its motion REPEATS (the
  // angle whose projected velocity has the clearest rhythm, x its energy share there: a big irregular sway does not win);
  // the scene's = the rows' directions averaged (axial), each by prior x act gain x rhythm^2 x presence; a row within
  // DIR_SNAP of it is read along the scene's direction, another keeps its own (a head bobbing on a shaft at an angle)
  let sAx = null;
  const rax = R.rows.map(() => null);
  if (J.dir && !u) {
    let c2 = 0, s2 = 0;
    R.rows.forEach((r, i) => {
      const [a, b] = SM[i], VX = a.vx.map((x, q) => (b ? x - b.vx[q] : x)), VY = a.vy.map((y, q) => (b ? y - b.vy[q] : y));
      let n = 0;
      for (let q = 0; q < m; q++) if (VX[q] === VX[q] && VY[q] === VY[q]) n++;
      if (n < 16) return;
      const E = [], RR = [];
      for (let k = 0; k < 12; k++) {
        const th = (k * Math.PI) / 12, c = Math.cos(th), sn = Math.sin(th), pv = VX.map((x, q) => x * c + VY[q] * sn);
        let e = 0;
        for (const x of pv) if (x === x) e += x * x;
        E.push(e); RR.push(rhythmOf(pv, dt).r);
      }
      const eMax = Math.max(...E) || 1;
      let best = 0;
      for (let k = 1; k < 12; k++) if (RR[k] * Math.sqrt(E[k] / eMax) > RR[best] * Math.sqrt(E[best] / eMax)) best = k;
      const th = (best * Math.PI) / 12;
      rax[i] = { th, r: RR[best] };
      if (!r.B) return;
      const w = r.prior * (r.gain || 1) * RR[best] ** 2 * (n / m);
      c2 += w * Math.cos(2 * th); s2 += w * Math.sin(2 * th);
    });
    if (c2 || s2) { const th = 0.5 * Math.atan2(s2, c2); sAx = [Math.cos(th), Math.sin(th)]; if ((Math.abs(sAx[1]) >= Math.abs(sAx[0]) && sAx[1] > 0) || (Math.abs(sAx[0]) > Math.abs(sAx[1]) && sAx[0] < 0)) sAx = [-sAx[0], -sAx[1]]; }
  }
  /** Row i's reading direction: the stroke axis tool's, else (jit.dir) the scene's or its own, else its principal axis. */
  const axisOf = (i, X, Y) => {
    if (u) return u;
    if (sAx && rax[i]) { const d = Math.abs(Math.atan2(Math.sin(rax[i].th) * sAx[0] - Math.cos(rax[i].th) * sAx[1], Math.cos(rax[i].th) * sAx[0] + Math.sin(rax[i].th) * sAx[1])); return Math.min(d, Math.PI - d) <= FUSE.DIR_SNAP ? sAx : [Math.cos(rax[i].th), Math.sin(rax[i].th)]; }
    return pca(X, Y);
  };
  R.rows.forEach((r, ri) => {
    const [a, b] = SM[ri], [X, Y] = XY[ri];
    r.wA = a.w; r.wB = b?.w || null;
    r.ramp = a.ramp || b?.ramp ? Float64Array.from({ length: m }, (_, q) => Math.min(a.ramp ? a.ramp[q] : 1, b?.ramp ? b.ramp[q] : 1)) : null;   // paw-o74b
    const v = axisOf(ri, X, Y);
    r.axis = v; r.X = X; r.Y = Y;
    if (sAx && v) r.xc = X.map((x, q) => -x * v[1] + Y[q] * v[0]);   // the motion across the stroke direction
    r.x = v ? X.map((x, q) => x * v[0] + Y[q] * v[1]) : new Float64Array(m).fill(NaN);
    r.on = r.x.map((x) => (x === x ? 1 : 0));
    r.fit = a.fit.map((f, q) => (b ? f * b.fit[q] : f));
    r.sigma = 1.4826 * med(Array.from(r.x, Math.abs));
    r.z = r.x.map((x) => x / (r.sigma || 1));
    const VX = a.vx.map((x, q) => (b ? x - b.vx[q] : x)), VY = a.vy.map((y, q) => (b ? y - b.vy[q] : y));
    r.vel = v ? VX.map((x, q) => (x * v[0] + VY[q] * v[1]) / (S ? S[q] : 1)) : S ? VX.map((x, q) => x / S[q]) : VX;
    const pk = rhythmOf(r.vel, dt);
    r.period = pk.ms; r.rhythm = pk.r;
    r.qRhythm = floor(smooth(pk.r, FUSE.RHYTHM));
    r.qNoise = fin(r.sigma) && r.sigma > 0 ? 1 / (1 + (FUSE.NOISE_FH / r.sigma) ** 4) : 0;
    r.pres = r.on.reduce((s, x) => s + x, 0) / m;
    let fs = 0, fn = 0;
    for (let q = 0; q < m; q++) if (r.on[q]) { fs += r.fit[q]; fn++; }
    r.fitMean = fn ? fs / fn : 0;
    r.label = rowLabel(r);
  });
  // paw-zhn4: on an exact loop every row repeats at the loop length, so its rhythm there says nothing; when the rows' own
  // motion says the loop holds k strokes, each row's rhythm and period are read at the stroke (loop / k) instead
  const LK = loopMs > 0 ? loopStroke(R.rows, dt, loopMs) : null;
  if (LK) for (const r of R.rows) { const pk = rhythmNear(r.vel, dt, LK.ms); r.period = pk.ms; r.rhythm = pk.r; r.qRhythm = floor(smooth(pk.r, FUSE.RHYTHM)); }
  for (const r of R.rows) r.q = r.qRhythm * r.qNoise * r.pres * r.fitMean;
  // paw-439e: a row the act tags lift: its own behaviour, and its agreement (|r| at the best lag) with every other row and
  // whether it shares a part with it (data only: the limit itself is weighed per call, so pins / excludes count)
  const Lag = Math.max(1, Math.round(FUSE.LAG_MAX_MS / dt));
  for (const r of R.rows) {
    r.base = r.prior0 > 0 ? r.prior0 : FUSE.TAG_BASE;
    r.lift = (r.prior * r.gain) / r.base;
    if (!(r.lift > 1 + 1e-9)) continue;
    r.behave = smooth(r.rhythm, FUSE.TAG_RHYTHM) * r.qNoise * r.pres * r.fitMean;
    const mine = new Set([...r.A, ...(r.B || [])].map((p) => p.id));
    r.vs = R.rows.map((o) => (o === r || !(o.prior0 > 0) ? null : { c: Math.abs(maxCorr((k) => corr(r.z, o.z, 0, m, k), Lag).r), indep: ![...o.A, ...(o.B || [])].some((p) => mine.has(p.id)) }));
  }
  // the rows' final form: minus a moving average over two strokes (bodies settling go, a shallow stroke stays shallow)
  const per = med(R.rows.filter((r) => r.q > 0.05 && r.prior > 0).map((r) => r.period).filter((x) => x > 0)) || 0;
  // (the position from the row's velocity, summed: no 2 s detrend in it, and no jump where a piece of a part comes or goes)
  for (const r of R.rows) {
    let acc = 0;
    const pos = r.x.map((x, q) => { const d = r.vel[q]; if (d === d) acc += d; return x === x ? acc : NaN; }), b = movAvgNaN(pos, lw(per));
    r.f = pos.map((x, q) => (x - b[q]) / (r.sigma || 1));
  }
  const W = Math.max(8, Math.round(FUSE.WIN_MS / dt)), hop = Math.max(1, Math.round(FUSE.HOP_MS / dt)), starts = [];
  for (let s = 0; s + W <= m; s += hop) starts.push(s);
  if (!starts.length || starts[starts.length - 1] + W < m) starts.push(Math.max(0, m - W));
  // the 2-D body motions (each character's parts by their say), kept for later consumers (a learned model, a twist axis)
  const motion = { t: Float64Array.from(t), bodies: {} };
  for (const w of [...new Set(parts.map((p) => p.who || 'u'))]) { const S = parts.filter((p) => (p.who || 'u') === w && p.say > 0); if (S.length) { const s = sideMotion(S, m); motion.bodies[w] = { x: s.dx, y: s.dy }; } }
  const out = { t, dt, m, parts, ...R, starts, W, motion, per, sAx, u, cam: BS, ...(LK ? { loop: LK } : {}) };
  if (memo.size > 48) memo.delete(memo.keys().next().value);
  memo.set(key, out);
  return out;
}

/** paw-0sn8 (jit.refine): the stroke period the refinement scales with, on the short side (it must never eat a real
 *  stroke): twice the 25th percentile of the turn-to-turn intervals the strokes step finds on v, or the fused rhythm when
 *  that is clear (r >= 0.3) and shorter. */
function refinePeriod(v, t, dt, tu) {
  const iv = tu.slice(1).map(([i], k) => t[i] - t[tu[k][0]]).sort((a, b) => a - b);
  const rh = rhythmOf(Array.from(v, (x, q) => (q && x === x && v[q - 1] === v[q - 1] ? x - v[q - 1] : NaN)), dt);
  const p = Math.min(iv.length >= 4 ? 2 * iv[Math.floor(0.25 * iv.length)] : Infinity, rh.r >= 0.3 && rh.ms > 0 ? rh.ms : Infinity);
  return fin(p) ? Math.min(2500, Math.max(300, p)) : 0;
}
/** Savitzky-Golay (quadratic, half-width hMs) over each gap-free stretch of v, in place, flat holds kept; around each turn
 *  (turns: [[sample index, kind]], the strokes step's turns on the unrefined signal) the signal eases back to its own over
 *  REFINE_KEEP half-widths, so a turn, an impact's landing and a held turn's arrival stay where and as they were (fusion's
 *  HOW and the Detail read them there). */
function refine(v, dt, hMs, turns) {
  const h = Math.round(hMs / dt);
  if (h < 2) return;
  const raw = Float64Array.from(v), R = Math.round(FUSE.REFINE_KEEP * h), keep = new Float64Array(v.length);
  for (const [i] of turns) for (let q = Math.max(0, i - R); q <= Math.min(v.length - 1, i + R); q++) keep[q] = Math.max(keep[q], 1 - Math.abs(q - i) / (R + 1));
  for (let i = 0; i < v.length;) {
    if (v[i] !== v[i]) { i++; continue; }
    let j = i;
    while (j < v.length && v[j] === v[j]) j++;
    v.set(savgol(v.subarray(i, j), h), i);
    i = j;
  }
  for (let q = 0; q < v.length; q++) if (keep[q] > 0 && v[q] === v[q]) v[q] = keep[q] * raw[q] + (1 - keep[q]) * v[q];
}

// ---- 4-5: the weighting (fast: a pad drag re-runs only this) ----
/** Multiplier of row r for pad p {x, y}: x -1 relative .. +1 absolute, y -1 core .. +1 extremities. Never 0. */
export const padGain = (r, p) => (p ? FUSE.PAD_GAIN ** ((p.x || 0) * (2 * r.abs - 1) + (p.y || 0) * (2 * r.ext - 1)) : 1);
/** The largest |r| over lags +-L (R(k) = r at lag k) -> {k, r (signed, 0 = none)}. */
function maxCorr(R, L) {
  let k0 = 0, br = R(0);
  for (let l = 1; l <= L; l++) for (const k of [l, -l]) { const r = R(k); if (fin(r) && (!fin(br) || Math.abs(r) > Math.abs(br) + 1e-9)) { k0 = k; br = r; } }
  return { k: k0, r: fin(br) ? br : 0 };
}
/** Peaks of |R(k)| for k in a..b (s: only that sign of R) -> [{k, h (|r| at the parabola's vertex: sub-sample)}]. */
function corrPeaks(R, a, b, s = 0) {
  const o = [];
  for (let k = a; k <= b; k++) {
    const r = R(k), y = Math.abs(r), y0 = Math.abs(R(k - 1)), y2 = Math.abs(R(k + 1));
    if (!fin(y) || y0 > y || y2 >= y || (s && Math.sign(r) !== s)) continue;
    const d = y0 - 2 * y + y2;
    o.push({ k, h: fin(d) && d < 0 ? Math.min(1, y - (y0 - y2) ** 2 / (8 * d)) : y });
  }
  return o;
}
/** Lag (samples), coherence (signed r at it) of z against ref, searched over +-L (lagRange). paw-bc9d: where the largest |r|
 *  is a peak, the peak of the range with the highest sub-sample height (a lag between two frames is not beaten by its
 *  half-period twin landing on a frame); where it sits on the range's edge, that edge as before. P (samples, 0 = skip): amb
 *  0..1, how much better the half-period twin of that reading fits (the opposite sign, P / 2 away, past the range too but
 *  within M = LAG_MAX_MS: a longer lag is not a body part's; measured on the samples both share; LAG_AMB). */
export function phase(z, ref, L, P = 0, M = L) {
  const c = new Map(), R = (k) => { if (!c.has(k)) c.set(k, corr(z, ref, 0, z.length, k)); return c.get(k); };
  const b = maxCorr(R, L), pk = corrPeaks(R, -L, L);
  let best = pk.find((x) => x.k === b.k) || { k: b.k };
  if (pk.includes(best)) for (const x of pk) if (x.h > best.h) best = x;
  const r = R(best.k), n = z.length;
  let amb = 0;
  const win = P > 0 && fin(r) && r ? [1, -1].map((d) => Math.round(best.k + (d * P) / 2)).map((c0) => [Math.max(-M, c0 - Math.max(1, Math.round(P / 4))), Math.min(M, c0 + Math.max(1, Math.round(P / 4)))]).filter(([a, e]) => a <= e) : [];
  if (win.length) {
    const lo = Math.min(best.k, ...win.map((w) => w[0])) - 1, hi = Math.max(best.k, ...win.map((w) => w[1])) + 1, A = Math.max(0, -lo), B = Math.min(n, n - hi), y = ref.slice(A, B), C = new Map();
    const Rc = (k) => { if (!C.has(k)) C.set(k, corr(z.slice(A + k, B + k), y)); return C.get(k); }, own = corrPeaks(Rc, best.k, best.k)[0];
    const tw = win.flatMap(([a, e]) => corrPeaks(Rc, a, e, -Math.sign(r))), res = (h) => Math.max(1e-9, 1 - h * h);
    if (tw.length) amb = 1 - smooth(Math.min(...tw.map((x) => res(x.h))) / res(own ? own.h : Math.abs(Rc(best.k)) || 0), FUSE.LAG_AMB);
  }
  return { lag: best.k, r: fin(r) ? r : 0, amb };
}
/** paw-bc9d: the phase search range against a stroke signal v (t ms, dt): {L (samples), P (its stroke period, samples; 0 =
 *  unknown), M (LAG_MAX_MS, samples)}. P = the 25th percentile of its full-stroke turn spacings (a turn to the next of its
 *  kind: a lopsided stroke is not read as two), else its rhythm when clear (r >= 0.3), at least 300 ms; L = LAG_P x P,
 *  never past M. Unknown: M as before. */
export function lagRange(t, v, dt, tu = signalTurns(t, v).turns) {
  const M = Math.max(1, Math.round(FUSE.LAG_MAX_MS / dt)), iv = tu.slice(2).map(([i], k) => t[i] - t[tu[k][0]]).sort((a, b) => a - b);
  let ms = iv.length >= 3 ? iv[Math.floor(0.25 * iv.length)] : 0;
  if (!ms) { const rh = rhythmOf(Array.from(v, (x, q) => (q && x === x && v[q - 1] === v[q - 1] ? x - v[q - 1] : NaN)), dt); ms = rh.r >= 0.3 ? rh.ms : 0; }
  if (!(ms > 0)) return { L: M, P: 0, M };
  const P = Math.max(300, ms) / dt;
  return { L: Math.max(1, Math.min(M, Math.floor(FUSE.LAG_P * P))), P, M };
}
/** paw-439e: how much of its act lift row r keeps here (FUSE TAG_*: see there) -> {L 0..1, behave, confirmed, contra, by
 *  (the index of the alternative that contradicts it most)}. live = the rows that count (pins / excludes). */
export function tagLimit(r, rows, live) {
  let sup = 0, con = 0, by = -1;
  const own = r.base * r.q;
  r.vs.forEach((v, j) => {
    if (!v || !live[j]) return;
    const o = rows[j], agree = smooth(v.c, FUSE.TAG_COH), clean = smooth(o.rhythm, FUSE.RHYTHM) * o.pres;
    if (v.indep) sup = Math.max(sup, agree * clean);
    const c = (own > 0 ? smooth((o.prior0 * o.q) / own, FUSE.TAG_DOM) : 1) * smooth(o.rhythm / (r.rhythm || 1e-6), FUSE.TAG_RHY) * (1 - agree) * clean;
    if (c > con) { con = c; by = j; }
  });
  return { L: r.behave * (1 - con) * (FUSE.TAG_ALONE + (1 - FUSE.TAG_ALONE) * sup), behave: r.behave, confirmed: sup, contra: con, by };
}
/** paw-o60v.2: corr(sign x z over [st, e), ref over the same samples) with no copies: corr's arithmetic, in its order. */
function corrSeg(z, s, ref, st, e) {
  let n = 0, sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (let q = st; q < e; q++) {
    const u = s * z[q], v = ref[q];
    if (u !== u || v !== v) continue;
    n++; sx += u; sy += v; sxy += u * v; sxx += u * u; syy += v * v;
  }
  if (n < 8) return NaN;
  const vx = sxx - (sx * sx) / n, vy = syy - (sy * sy) / n;
  return vx > 1e-12 && vy > 1e-12 ? (sxy - (sx * sy) / n) / Math.sqrt(vx * vy) : NaN;
}
/** paw-o60v.2: the weighting windows' parts that no control changes, once per analysis: per window its end, its triangular
 *  cross-fade, and per row its presence, fit sum, direction share (jit.dir) and camera motion; the cross-fades' sum per sample. */
function winStats(A) {
  const { rows, m, starts, W } = A, den = new Float64Array(m);
  const win = starts.map((st) => {
    const e = Math.min(m, st + W), tw = Float64Array.from({ length: e - st }, (_, k) => 1 + 1e-3 - Math.abs(k + 0.5 - (e - st) / 2) / ((e - st) / 2));
    const rs = rows.map((r) => {
      let pres = 0, fit = 0;
      for (let q = st; q < e; q++) if (r.on[q]) { pres++; fit += r.fit[q]; }
      let dc = 1;
      if (r.xc) {   // paw-0sn8 (jit.dir): the row's share of motion along the scene's stroke direction in this window
        let al = 0, ac = 0;
        for (let q = st; q < e; q++) if (r.on[q] && r.xc[q] === r.xc[q]) { al += r.x[q] ** 2; ac += r.xc[q] ** 2; }
        dc = al + ac > 0 ? floor(smooth(al / (al + ac), FUSE.DIR_COH)) : 1;
      }
      // paw-gy1r: while the camera moves (zoom / pan: A.cam.move), a body against the frame carries camera residue: less say
      let mv = 0;
      if (r.abs && A.cam?.move) for (let q = st; q < e; q++) mv = Math.max(mv, A.cam.move[q]);
      return { pres, fit, dc, mv };
    });
    for (let q = st; q < e; q++) den[q] += tw[q - st];
    return { e, tw, rs };
  });
  return { win, den };
}
function weigh(A, ctl) {
  const { rows, m, dt, starts, W } = A, s = ctl.prior ?? 1, pins = ctl.pins, excl = ctl.excl;
  const named = (r, set) => set.has(r.id) || r.alias.some((x) => set.has(x)), pinned = (r) => named(r, pins) || (r.single && pins.has(r.single));
  // paw-0yfp: pins narrow the mix only while one pinned row is on (not left out, not at x0): the owner turning his only pin
  // off means "not this one", never "nothing at all"
  const usable = (r) => !named(r, excl) && fin(r.sigma) && r.sigma > 0;
  const pinOn = pins.size > 0 && rows.some((r) => pinned(r) && usable(r) && ctl.w?.[r.id] !== 0);
  const live = rows.map((r) => usable(r) && (!pinOn || pinned(r)));
  const lim = rows.map((r) => (r.vs ? tagLimit(r, rows, live) : null));   // paw-439e: the scene type limits itself
  const P = rows.map((r, i) => Math.max(pinned(r) ? 1 : 0, r.base * r.lift ** (s * (lim[i]?.L ?? 1))) * padGain(r, ctl.pad) * (ctl.w?.[r.id] ?? 1));   // a pin always counts
  const w0 = rows.map((r, i) => (live[i] ? P[i] * r.q : 0));
  // the reference stroke: rows by (prior x quality)^REF_SHARP, sign-aligned to the strongest; each row's phase (lag,
  // coherence, sign) against it. The prior leads; the data vetoes through quality (a wandering or noisy row cannot lead)
  let anchor = -1;
  w0.forEach((w, i) => { if (w > 0 && (anchor < 0 || w > w0[anchor])) anchor = i; });
  if (anchor < 0) return null;
  const sign = rows.map((r, i) => (i === anchor ? 1 : (corr(r.z, rows[anchor].z) || 0) < 0 ? -1 : 1));
  const S = new Float64Array(m), D = new Float64Array(m);
  rows.forEach((r, i) => { const w = w0[i] ** FUSE.REF_SHARP; if (w > 0) for (let q = 0; q < m; q++) { const z = r.z[q]; if (z === z) { S[q] += w * sign[i] * z; D[q] += w; } } });
  const ref = Float64Array.from(S, (x, q) => (D[q] > 0 ? x / D[q] : NaN)), L = lagRange(A.t, ref, dt).L;
  // (paw-bc9d: the mix keeps the largest |r| inside the range; the sub-sample peak choice is for the parts' readings: phase())
  const ph = rows.map((r, i) => { if (!live[i]) return { lag: 0, r: 0 }; const z = r.z.map((x) => sign[i] * x), b = maxCorr((k) => corr(z, ref, 0, m, k), L); return { lag: b.k, r: b.r }; });
  ph.forEach((p, i) => { if (p.r < 0) { sign[i] = -sign[i]; p.r = -p.r; } });
  const mPhase = ph.map((p) => 1 / (1 + ((p.lag * dt) / FUSE.LAG_HALF_MS) ** 2)), mCoh = ph.map((p) => floor(smooth(p.r, FUSE.COH)));
  // window weights, cross-faded per sample (paw-o60v.2: what does not depend on the controls, per window and row, is kept on
  // the analysis: winStats; the arithmetic is today's, in the same order)
  const WS = A.win || (A.win = winStats(A)), den = WS.den, wsum = rows.map(() => new Float64Array(m)), windows = [];
  for (let wi = 0; wi < starts.length; wi++) {
    const st = starts[wi], { e, tw, rs } = WS.win[wi], wwin = {};
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], { pres, fit, dc, mv } = rs[i];
      if (!live[i] || !pres) continue;
      const rl = corrSeg(r.z, sign[i], ref, st, e);
      const w = P[i] * r.qRhythm * r.qNoise * (pres / (e - st)) * (fit / pres) * mPhase[i] * Math.max(0, fin(rl) ? rl : 0) ** 2 * dc * (1 - CAM.ABS_MOVE * mv);
      if (!(w > 0)) continue;
      wwin[r.id] = w;
      const ws = wsum[i], on = r.on;
      for (let q = st; q < e; q++) if (on[q]) ws[q] += w * tw[q - st];
    }
    const tot = Object.values(wwin).reduce((x, y) => x + y, 0);
    windows.push({ t: Math.round(A.t[st]), t1: Math.round(A.t[e - 1]), w: tot ? Object.fromEntries(Object.entries(wwin).map(([k, w]) => [k, w / tot])) : {} });
  }
  // the per-sample row weights (paw-o74b: a row joining mid-scene ramps in)
  const WQ = rows.map((r, i) => { const o = new Float64Array(m), ws = wsum[i], rp = r.ramp; for (let q = 0; q < m; q++) o[q] = rp ? (ws[q] / (den[q] || 1)) * rp[q] : ws[q] / (den[q] || 1); return o; });
  const v = new Float64Array(m).fill(NaN), conf = new Float64Array(m), tim = new Float64Array(m).fill(NaN), nr = rows.length, phr = ph.map((p) => p.r);
  for (let q = 0; q < m; q++) {
    let sv = 0, w = 0, ag = 0, st = 0, wt = 0;
    for (let i = 0; i < nr; i++) {
      const wq = WQ[i][q], x = rows[i].f[q];
      if (!(wq > 0) || x !== x) continue;
      sv += wq * sign[i] * x; w += wq; ag += wq * phr[i];
      const w4 = wq ** 4; st += w4 * sign[i] * x; wt += w4;   // the timing series: the best-agreeing rows decide WHEN
    }
    if (w > 0) { v[q] = sv / w; conf[q] = ag / w; tim[q] = wt > 0 ? st / wt : v[q]; }
  }
  const tot = rows.map((_, i) => wsum[i].reduce((x, y) => x + y, 0)), all = tot.reduce((x, y) => x + y, 0) || 1;
  if (DEBUG.on) DEBUG.last = { A, wq: WQ, sign: [...sign], L };
  const raw = Float64Array.from(v), tu = signalTurns(A.t, v).turns, lv = lagRange(A.t, raw, dt, tu);   // paw-0sn8: HOW reads the parts at the unrefined signal's turns (a rounder turn is no rest); paw-bc9d: lv = the parts' search range against it
  if (ctl.J?.refine > 0) {
    const Pm = refinePeriod(v, A.t, dt, tu);
    if (Pm) { refine(v, dt, Pm * ctl.J.refine, tu); refine(tim, dt, Pm * ctl.J.refine, tu); }
  }
  return { v, raw, conf, tim, sign, ph, mPhase, mCoh, P, live, lim, windows, share: tot.map((x) => x / all), lv, pinsOff: pins.size > 0 && !pinOn };
}
/** Where weights sit on the pad: the share-weighted (relative -1 .. absolute +1, core -1 .. extremities +1). */
function padSpot(rows, share) {
  let x = 0, y = 0, s = 0;
  rows.forEach((r, i) => { x += share[i] * (2 * r.abs - 1); y += share[i] * (2 * r.ext - 1); s += share[i]; });
  return s > 0 ? { x: +(x / s).toFixed(3), y: +(y / s).toFixed(3) } : { x: 0, y: 0 };
}

/** paw-t11b: every part fusion read (excluded ones aside) as a voice for HOW (lib/fusion-how.js): its motion along its own
 *  axis sign-aligned with the fused stroke v and its lag, its say on HOW (coherence x presence x fit x stroke over jitter),
 *  and what of its 2-D motion the stroke does not explain (the part minus its least-squares share of v at its lag).
 *  paw-bc9d: lr = the search range against v (lagRange); a voice whose half-period twin fits better (amb) loses say. */
export function voicesOf(A, v, lr = lagRange(A.t, v, A.dt)) {
  const { parts, m } = A, { L, P, M } = lr, out = [];
  for (const p of parts) {
    let n = 0, fs = 0;
    for (let q = 0; q < m; q++) if (p.on[q]) { n++; fs += p.fit[q]; }
    if (n < 0.2 * m) continue;
    const ax = pca(p.dx, p.dy), a0 = ax ? p.dx.map((x, q) => x * ax[0] + p.dy[q] * ax[1]) : Float64Array.from(p.dx);
    const ph = phase(a0, v, L, P, M), s = ph.r < 0 ? -1 : 1, a = a0.map((x) => s * x), lag = ph.lag;
    const amp = 1.4826 * med(Array.from(a, Math.abs)), d2 = [];
    for (let q = 1; q + 1 < m; q++) { const x = a[q + 1] - 2 * a[q] + a[q - 1]; if (x === x) d2.push(Math.abs(x)); }
    const noise = (1.4826 * med(d2)) / Math.sqrt(6) || 1e-9;
    // the stroke's share of the part (dx, dy on v at the part's lag, least squares), the rest is its own motion
    const vs = (q) => (q - lag >= 0 && q - lag < m ? v[q - lag] : NaN);
    let sv = 0, sx = 0, sy = 0, c = 0, svv = 0, sxv = 0, syv = 0;
    for (let q = 0; q < m; q++) { const w = vs(q); if (!p.on[q] || w !== w || p.dx[q] !== p.dx[q]) continue; c++; sv += w; sx += p.dx[q]; sy += p.dy[q]; svv += w * w; sxv += p.dx[q] * w; syv += p.dy[q] * w; }
    const den = svv - (sv * sv) / (c || 1), bx = c > 8 && den > 1e-12 ? (sxv - (sx * sv) / c) / den : 0, by = c > 8 && den > 1e-12 ? (syv - (sy * sv) / c) / den : 0;
    const rx = p.dx.map((x, q) => { const w = vs(q); return w === w ? x - bx * w : NaN; }), ry = p.dy.map((y, q) => { const w = vs(q); return w === w ? y - by * w : NaN; });
    out.push({ id: p.id, label: sideLabel([p]), role: p.role, a, lag, coh: Math.abs(ph.r), amb: ph.amb, w: smooth(Math.abs(ph.r), HOW.COH) * (n / m) * (fs / n) * smooth(amp / noise, HOW.SNR) * (1 - ph.amb), wr: (n / m) * (fs / n), on: p.on, fit: p.fit, rx, ry, amp });
  }
  return out;
}

/**
 * Fused stroke of one run scene: idx (sample indices into the run's channels), opts {aspect, axis (derive.axis or the
 * run's own), fuse ({exclude, pin, pad, prior, w}), acts (the shot's act tags), orient (a channel name to orient by)} ->
 * {v (Float64Array, NaN = none), conf, timing, info} | null (nothing usable).
 */
export function fuseScene(run, idx, { anchors = null, ...o } = {}) {
  const out = fuseForward(run, idx, o);
  if (!out || !anchors?.length || DEBUG.on) return out;
  // paw-wg2d / paw-ze8n: the owner's anchors as local evidence (lib/anchors.js anchorLocal) on the forward result (cached as
  // ever); per forward result, the last few anchor sets are kept (a mark dragged frame by frame re-solves only this)
  const F = OUT_A.get(out), key = JSON.stringify(anchors);
  if (!F) return out;
  const hit = F.anc.get(key);
  if (hit && (!hit.live || o.live)) return hit.out;
  const { A, live } = F, s = anchorLocal({ t: A.t, v: out.v, raw: F.raw, tim: out.timing, conf: out.conf, windows: out.info.windows, periodMs: out.info.periodMs, rows: A.rows.map((r, i) => (live[i] ? { id: r.id, label: r.label, f: r.f, q: r.q, on: r.on } : null)).filter(Boolean) }, anchors);
  if (!s) return out;
  const info = { ...out.info, anchors: s.info };
  if (!o.live && s.info.sections.some((x) => !x.unchanged)) {   // HOW reads the anchored signal (its turns moved, maybe the other way up)
    const vs = voicesOf(A, s.raw, lagRange(A.t, s.raw, A.dt)), say = {};
    for (const b of info.bodies) for (const p of b.parts) say[p.id] = p.say;
    info.how = readHow(A.t, s.raw, vs);
    info.how.secondary = vs.filter((x) => x.wr >= HOW.SECONDARY[0] && (say[x.id] || 0) < HOW.SECONDARY[1]).map((x) => x.id);
    info.how.used = info.how.secondary.length > 0;
  }
  const res = { v: s.v, conf: s.conf || out.conf, timing: s.tim, info, range: s.range };   // range: the automatic signal's, so the channel's 0..1 scale (and every untouched section) stays as it was
  if (F.anc.size >= 6) F.anc.delete(F.anc.keys().next().value);
  F.anc.set(key, { out: res, live: !!o.live });
  return res;
}
/** paw-wg2d: a forward result -> {A (its analysis), live (the rows that counted), raw (its unrefined signal), anc (anchored results by anchors)}. */
const OUT_A = new WeakMap();
/** Experiments only (experiments/anchors): a fuseScene result's analysis and rows ({A, live, raw} | null). */
export const forwardOf = (out) => OUT_A.get(out) || null;
function fuseForward(run, idx, { aspect = 16 / 9, axis = null, fuse = null, acts = null, orient = null, live = false, loopMs = 0 } = {}) {
  const ch = run.channels, gs = fusionGroups(run);
  if (idx.length < 16 || !gs.length) return null;
  // paw-o60v.2: per analysis (cached per run scene: analyse), the exact results by the owner's controls: a pad drag re-weighs
  // only the scene it moves, a release lands on what the rest computed. live (a drag between rests): no HOW (the parts'
  // readings against the new mix: the last exact one stands in until the pointer rests); never kept
  const ex0 = [...new Set(fuse?.exclude || [])].filter((x) => !x.includes('~')), tags0 = [...new Set(acts || [])], off0 = tags0.filter((a) => (fuse?.actsOff || []).includes(a));
  const A0 = analyse(run, idx, { aspect, axis, acts: off0.length ? tags0.filter((a) => !off0.includes(a)) : acts, J: { ...FUSE.JIT, ...(fuse?.jit || {}) }, exclude: new Set(ex0), loopMs });
  let M = DEBUG.on ? null : MEMO.get(A0);   // (the experiments' DEBUG hook reads each weigh: never cached there)
  if (DEBUG.on) return fuseScene0(run, idx, { aspect, axis, fuse, acts, orient, loopMs, live: false, M: { res: new Map(), neutral: new Map(), how: null } });
  if (!M) MEMO.set(A0, (M = { res: new Map(), neutral: new Map(), how: null }));
  const mk = JSON.stringify([fuse, acts, orient]), oc = (orient && ch[orient]) || null, hit = M.res.get(mk);
  if (hit && hit.oc === oc) return hit.out;
  const out = fuseScene0(run, idx, { aspect, axis, fuse, acts, orient, loopMs, live, M });
  if (!live) { if (M.res.size >= 8) M.res.delete(M.res.keys().next().value); M.res.set(mk, { oc, out }); if (out) M.how = out.info.how; }
  return out;
}
const MEMO = new WeakMap();
function fuseScene0(run, idx, { aspect, axis, fuse, acts, orient, loopMs, live, M }) {
  const ch = run.channels;
  const excl = new Set(fuse?.exclude || []), pins = new Set(fuse?.pin || []);
  // paw-439e: the shot's act tags minus the ones the owner turned off for this shot / run (fuse.actsOff)
  const tags = [...new Set(acts || [])], off = tags.filter((a) => (fuse?.actsOff || []).includes(a));
  const J = { ...FUSE.JIT, ...(fuse?.jit || {}) };
  const opt = { aspect, axis, acts: off.length ? tags.filter((a) => !off.includes(a)) : acts, J, loopMs }, exParts = [...excl].filter((x) => !x.includes('~'));
  let A = analyse(run, idx, { ...opt, exclude: new Set(exParts) }), none = false;
  // paw-0yfp: the owner's controls never make the scene vanish (the panel that would bring them back goes with it): every
  // part left out, every relationship left out or at x0 -> the automatic mix plays, said so (info.none)
  if (!A.rows.length && exParts.length) { A = analyse(run, idx, { ...opt, exclude: new Set() }); none = true; }
  if (!A.rows.length) return null;
  const ctl = { prior: fuse?.prior ?? 1, pad: fuse?.pad || null, w: fuse?.w || null, pins, excl, J };
  let res = none ? null : weigh(A, ctl);
  if (!res && (pins.size || excl.size || ctl.w)) { res = weigh(A, { ...ctl, pins: new Set(), excl: new Set(), w: null }); none = true; }
  const dbg = DEBUG.last;
  if (!res || !res.v.some((x) => x === x)) return null;
  // (the automatic mix does not move with the pad: weighed once per analysis and controls; nothing writes into it)
  let neutral = res;
  if ((ctl.pad || ctl.w) && !none) {
    const nk = JSON.stringify([ctl.prior, [...pins], [...excl], J]);
    if (M.neutral.has(nk)) neutral = M.neutral.get(nk) || res;
    else { const w = weigh(A, { ...ctl, pad: null, w: null }); neutral = w || res; if (M.neutral.size >= 8) M.neutral.delete(M.neutral.keys().next().value); M.neutral.set(nk, w); }
  }
  DEBUG.last = dbg;
  // orientation: like the scene's sidecar pick (or who_pair: farther apart = out); a shot that played another channel is
  // matched to that one when it switches (runs-channel.js channelPatch, paw-s80k: this alone is a coin toss off the pick)
  const ref = orient && ch[orient] ? idx.map((j) => ch[orient].v[j]) : null;
  const { v, conf, tim, sign } = res;
  if (ref && (corr(v, ref) || 0) < 0) { for (let q = 0; q < v.length; q++) { v[q] = -v[q]; tim[q] = -tim[q]; res.raw[q] = -res.raw[q]; } for (let i = 0; i < sign.length; i++) sign[i] = -sign[i]; }
  const info = explain(A, res, neutral, ctl, fuse);
  info.scene.tags = tags; info.scene.off = off;
  if (A.loop) info.loop = A.loop;   // paw-zhn4: an exact loop of loopMs holding k strokes: the rhythm read at the stroke (ms)
  if (none) info.none = true;   // paw-0yfp: nothing the owner kept contributes: the automatic mix plays (its shares shown)
  else if (res.pinsOff) info.pinsOff = true;   // every pin is off: the pins do not narrow the mix
  // paw-t11b: HOW each half-stroke goes, from every part (the turns the strokes step finds on this signal). The Detail reads
  // it only where the scene has a secondary part (tracked, with next to no say in the depth: balls, a tail, a head, a
  // bulge): measured against the owner's scripts it is not clearly better everywhere, so plain runs keep today's Detail
  const out = { v, conf, timing: tim, info };
  OUT_A.set(out, { A, live: res.live, raw: res.raw, anc: new Map() });   // paw-wg2d: what the anchors' solve needs
  if (live) { info.how = M.how || { turns: [], halves: [], types: [], secondary: [], used: false }; return out; }
  const vs = voicesOf(A, res.raw, res.lv), say = {};
  for (const b of info.bodies) for (const p of b.parts) say[p.id] = p.say;
  info.how = readHow(A.t, res.raw, vs);
  info.how.secondary = vs.filter((x) => x.wr >= HOW.SECONDARY[0] && (say[x.id] || 0) < HOW.SECONDARY[1]).map((x) => x.id);
  info.how.used = info.how.secondary.length > 0;
  return out;
}

/** paw-439e: what the scene type did here, one line per lifted row whose limit cut its lift: "handjob tag: Bottom hand ↔
 *  Top body is not carrying the stroke here (contradicted by Bottom torso ↔ Top body): ignored". */
function tagNotes(relations) {
  const out = [];
  for (const r of relations) {
    if (r.limit == null || r.limit >= FUSE.TAG_PARTLY) continue;
    const why = r.contra > 0.5 && r.against ? `contradicted by ${r.against}` : r.behave < 0.5 ? 'not rhythmic or not visible enough' : r.contra > 0.25 && r.against ? `partly contradicted by ${r.against}` : 'nothing independent confirms it';
    out.push({ id: r.id, limit: r.limit, text: `${(r.acts || []).join(', ').replace(/\+/g, ' + ')} tag: ${r.label} ${r.limit < FUSE.TAG_IGNORED ? 'is not carrying the stroke here' : 'is only partly carrying the stroke here'} (${why}): ${r.limit < FUSE.TAG_IGNORED ? 'ignored' : `${Math.round(100 * r.limit)} % of its lift`}` });
  }
  return out;
}
const AXIAL = new WeakMap();   // part -> its motion along its own principal axis (explain)
/** The structured explanation the UI draws (see the header). */
function explain(A, res, neutral, ctl, fuse) {
  const { rows, parts, dt } = A, rnd = (x, k = 3) => +(+x).toFixed(k);
  // each part's say in the fused signal: its rows' shares split by its weight inside each side
  const say = {}, split = (r, i) => {
    const out = [], s = res.sign[i] < 0 ? -1 : 1;
    r.A.forEach((p, k) => p.names.forEach((n) => out.push({ name: n, part: p.id, w: r.wA[k] / p.names.length / (r.B ? 2 : 1), s })));
    if (r.B) r.B.forEach((p, k) => p.names.forEach((n) => out.push({ name: n, part: p.id, w: r.wB[k] / p.names.length / 2, s: -s })));
    return out;
  };
  const relations = rows.map((r, i) => {
    const sp = split(r, i);
    for (const x of sp) say[x.part] = (say[x.part] || 0) + res.share[i] * x.w;
    const top = (S, w) => S[w.indexOf(Math.max(...w))]?.names[0];
    return { id: r.id, label: r.label, kind: r.kind, abs: r.abs, ext: rnd(r.ext), parts: r.B ? [top(r.A, r.wA), top(r.B, r.wB)] : [top(r.A, r.wA)], split: sp,
      sideA: r.A.map((p) => p.id), sideB: r.B ? r.B.map((p) => p.id) : null,
      prior: rnd(r.prior), gain: rnd(r.gain), acts: r.gains.length ? [...new Set(r.gains.map((g) => g.act))] : undefined, pad: rnd(padGain(r, ctl.pad)), user: ctl.w?.[r.id] ?? 1,
      ...(res.lim[i] ? { lift: rnd(r.lift), limit: rnd(res.lim[i].L), behave: rnd(res.lim[i].behave), confirmed: rnd(res.lim[i].confirmed), contra: rnd(res.lim[i].contra), against: res.lim[i].by >= 0 ? rows[res.lim[i].by].label : undefined } : {}),
      rhythm: rnd(r.rhythm), noise: rnd(r.qNoise), present: rnd(r.pres), quality: rnd(r.q), lagMs: Math.round(res.ph[i].lag * dt), coh: rnd(res.ph[i].r), phase: rnd(res.mPhase[i]),
      sign: res.sign[i], share: rnd(res.share[i], 4), excluded: ctl.excl.has(r.id) || r.alias.some((x) => ctl.excl.has(x)) || undefined, pinned: ctl.pins.has(r.id) || r.alias.some((x) => ctl.pins.has(x)) || (r.single && ctl.pins.has(r.single)) || undefined };
  });
  const order = relations.map((_, i) => i).sort((a, b) => relations[b].share - relations[a].share || relations[b].prior * relations[b].gain - relations[a].prior * relations[a].gain);
  // per body: its parts with their own phase against the fused stroke
  const fused = res.v, L = res.lv.L, u = (p) => { if (AXIAL.has(p)) return AXIAL.get(p); const v = pca(p.dx, p.dy), a = v ? p.dx.map((x, q) => x * v[0] + p.dy[q] * v[1]) : p.dx; AXIAL.set(p, a); return a; };   // (a part's own axis: once per analysis)
  const bodies = [...new Set(parts.map((p) => p.who || 'u'))].map((w) => ({ who: w, label: w === 'u' ? 'Unassigned' : whoName(w),
    parts: parts.filter((p) => (p.who || 'u') === w).map((p) => { const ph = phase(u(p), fused, L); return { id: p.id, names: p.names, label: sideLabel([p]), role: p.role, lagMs: Math.round(Math.abs(ph.r) > 0.05 ? ph.lag * dt : 0), coh: rnd(Math.abs(ph.r)), anti: ph.r < 0 || undefined, inBody: rnd(p.say), agree: p.agree != null ? rnd(p.agree) : undefined, earned: p.earn ? rnd(p.earn) : undefined, say: rnd(say[p.id] || 0, 4), excluded: undefined }; }) }));
  const best = order.find((i) => res.share[i] > 0);
  // paw-0sn8: the scene's stroke direction (the stroke axis tool's, jit.dir's scene direction, else the leading relationship's
  // axis) and, per part, what it is read against (its strongest relationship: the other side, or the frame) and how much of
  // that relationship's motion runs along the direction (1 = all along the stroke, 0 = all across)
  const lead = order.find((i) => res.share[i] > 0 && rows[i].B) ?? best;
  const dU = A.u || A.sAx || (lead != null ? rows[lead].axis : null);
  const along = (r) => { if (!dU || !r.X) return null; let a = 0, b = 0; for (let q = 0; q < r.X.length; q++) { const x = r.X[q], y = r.Y[q]; if (x === x && y === y) { a += (x * dU[0] + y * dU[1]) ** 2; b += x * x + y * y; } } return b > 0 ? rnd(a / b, 2) : null; };
  const dir = dU ? { u: [rnd(dU[0], 4), rnd(dU[1], 4)], from: A.u ? 'axis' : A.sAx ? 'scene' : 'lead', label: lead != null ? relations[lead].label : '', contact: lead != null ? { a: rows[lead].A.map((p) => p.names[0]), b: rows[lead].B ? rows[lead].B.map((p) => p.names[0]) : [] } : null } : null;
  for (const b of bodies) for (const p of b.parts) {
    let bi = -1, bw = 0;
    relations.forEach((r, i) => { const w = res.share[i] * r.split.filter((x) => x.part === p.id).reduce((s2, x) => s2 + x.w, 0); if (w > bw) { bw = w; bi = i; } });
    if (bi < 0) continue;
    const r = rows[bi], mineA = r.A.some((q) => q.id === p.id);
    p.vs = r.B ? sideLabel(mineA ? r.B : r.A) : 'the frame'; p.rel = !!r.B; p.dirCoh = along(r);
  }
  const soloRule = A.solo && best != null ? { rule: rows[best].kind === 'near' ? 'near' : rows[best].kind === 'camera' ? 'camera' : rows[best].single ? 'part' : rows[best].kind, label: relations[best].label } : null;
  const confAll = (() => { let s = 0, n = 0; for (let q = 0; q < res.conf.length; q++) if (res.v[q] === res.v[q]) { s += res.conf[q]; n++; } return n ? rnd(s / n) : 0; })();
  return {
    bodies, relations: order.map((i) => relations[i]),
    scene: { acts: A.acts, strength: ctl.prior, rows: relations.filter((r) => r.gain !== 1 || r.limit != null).map((r) => ({ id: r.id, label: r.label, gain: r.gain, acts: r.acts, lift: r.lift, limit: r.limit })), notes: tagNotes(relations) },
    solo: soloRule, dir, jit: ctl.J, auto: padSpot(rows, neutral.share), mix: padSpot(rows, res.share), pad: ctl.pad || { x: 0, y: 0 }, conf: confAll, periodMs: Math.round(A.per || 0), windows: res.windows,
    // the rows in the old candidate shape (the lane's strip, the Fusion view, the Fused from list)
    candidates: order.map((i) => { const c = relations[i]; return { id: c.id, label: c.label, kind: c.sideB ? 'pair' : 'single', parts: c.parts, split: c.split, sign: c.sign, share: c.share, r: c.coh, lagMs: c.lagMs, lagging: c.phase < 0.5, excluded: c.excluded, pinned: c.pinned, off: (!c.prior && !c.pinned) || undefined }; }),
    motion: A.motion, fuse: fuse || null,
  };
}

/**
 * The run's 'fused' channel: every run scene fused (fuseScene), 0..1 per scene by its min..max; scenes that cannot be
 * fused stay NaN. ctx {aspect, derives (rederive.js runDerives: a scene's axis / fuse / acts), trackedAxis}. ->
 * {t, v, min, max, scaled, conf, timing, info: [per run scene info | null], how: {turns, halves} (paw-t11b: every scene's
 * HOW by time, type ids made unique per scene: 'k:id')} | null.
 * paw-gy1r: a scene whose derive.fuse.depth names a reference (lib/depth-seat.js) is seated on its level and size before the
 * 0..1 scaling: + level (Float32Array, the level used, same scale as v; NaN elsewhere), depth [per run scene: {from, used,
 * r, name} | {from, why} | null] (also info[k].depth).
 * paw-zhn4: loops [per run scene: the period (ms) of the exact loop it is, 0 = none] -> the rows' rhythm and the scene's
 * period (periodMs: the detrend, the depth seat, the Shaft source's repeats) at the stroke when the loop holds several.
 */
export function fusedChannel(run, { aspect = 16 / 9, derives = [], trackedAxis = null, live = false, loops = null, signs = null } = {}) {
  const gs = fusionGroups(run);
  if (gs.length < 2) return null;
  const T = run.channels[gs[0].key + '_x'].t, n = T.length, scenes = run.scenes || [], per = new Map();
  for (let j = 0; j < n; j++) { const k = sceneAt(scenes, T[j]); if (!per.has(k)) per.set(k, []); per.get(k).push(j); }
  const v = new Float32Array(n).fill(NaN), conf = new Float32Array(n), timing = new Float32Array(n).fill(NaN), info = [], how = { turns: [], halves: [] };
  const level = new Float32Array(n).fill(NaN), depth = [];
  let kept = false;
  const chosen = (k) => (run.notes || []).find((x) => x?.code === 'primary' && (x.scene_index ?? 0) === Math.max(0, k))?.data?.chosen;
  for (const [k, idx] of per) {
    const d = derives[k] ?? (k < 0 ? derives[0] : null) ?? null;
    const o = [chosen(k), 'who_pair_proj', run.params?.primary].find((c) => c && run.channels[c] && c !== 'fused');
    // paw-wg2d: the run scene's anchors (derive.anchors: pos 0 = fully in) as values of this signal, which plays its scene's
    // way up (signs(k, ms): the scene sign x the owner's whole-scene flip x a flipped stretch over ms; +1 when not given)
    const sgn = (ms) => ((signs ? signs(Math.max(0, k), ms) : 1) < 0 ? -1 : 1);
    const anchors = d?.anchors?.length ? d.anchors.map((a) => { const sg = sgn(a.ms); return { ms: a.ms, pos: a.pos, sign: sg, y: sg > 0 ? a.pos / 100 : 1 - a.pos / 100 }; }) : null;
    const f = fuseScene(run, idx, { aspect, axis: d?.axis || trackedAxis, fuse: d?.fuse, acts: d?.acts, orient: o, live, loopMs: loops?.[Math.max(0, k)] || 0, anchors });
    info[Math.max(0, k)] = f ? f.info : null;
    if (!f) continue;
    if (f.info.how?.used) { how.turns.push(...f.info.how.turns); how.halves.push(...f.info.how.halves.map((h) => ({ ...h, type: `${k}:${h.type}` }))); }
    // paw-gy1r: the motion seated on the depth reference's level and size (the timing series with the same map)
    let fv = f.v, ft = f.timing, lv = null;
    const from = d?.fuse?.depth;
    if (from) {
      const ref = depthRef(run, k, idx, T, from, { pick: o, calib: d?.shaft, aspect, scale: bodyScale(run, idx, T, aspect), motion: { t: Float64Array.from(idx, (j) => T[j]), v: f.v } });
      const s = ref.x ? seatDepth(idx.map((j) => T[j]), f.v, ref.x, { periodMs: f.info.periodMs }) : ref;
      depth[Math.max(0, k)] = f.info.depth = s.v ? { from, used: +s.used.toFixed(3), r: +s.r.toFixed(3), name: ref.name, word: depthWord(from) } : { from, why: `${depthWord(from)}: ${s.why}`, word: depthWord(from) };
      if (s.v) { fv = s.v; ft = s.map(f.timing); lv = s.level; }
    }
    let lo = Infinity, hi = -Infinity;
    // paw-ze8n: an anchored scene keeps the automatic signal's scale (f.range), so its untouched sections stay as they were
    if (f.range && !lv) { [lo, hi] = f.range; kept = true; } else for (const x of fv) if (x === x) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    const sc = (x) => (hi - lo > 1e-12 ? (x - lo) / (hi - lo) : 0.5);
    idx.forEach((j, q) => { const x = fv[q]; if (x === x) { v[j] = sc(x); conf[j] = f.conf[q]; timing[j] = lv ? sc(ft[q]) : ft[q]; if (lv) level[j] = sc(lv[q]); } });
  }
  let min = kept ? 0 : Infinity, max = kept ? 1 : -Infinity;   // (a kept scale spans 0..1 as the automatic one did)
  for (const y of v) if (y === y) { min = Math.min(min, y); max = Math.max(max, y); }
  if (min > max) min = max = 0;
  how.turns.sort((a, b) => a.t - b.t); how.halves.sort((a, b) => a.t0 - b.t0);
  return { t: Float64Array.from(T), v, min, max, scaled: Float32Array.from(v, (y) => (y - min) / (max - min || 1)), conf, timing, info, how, ...(depth.length ? { level, depth } : {}) };
}
