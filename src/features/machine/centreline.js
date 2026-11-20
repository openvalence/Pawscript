// centreline.js -- where the toy and the gut actually lie (pure, no DOM): one equilibrium between the toy's bending
// stiffness and the tissue's, solved per frame for the view (deterministic: from the state, never from the last frame).
//
//  - Where the toy is, the path IS the toy's centreline: per 1 mm its curvature is the stiffness-weighted blend of the
//    toy's own rest curve (its "bend prior", rolled as it is mounted) and the tissue's (the anatomy's rest curve, with
//    the bends straightened as far as readiness and forcing have taken them: physics.js bendLeft), never tighter than
//    bendFloor x the toy's local radius (silicone wrinkles and folds past that, see physics.js bendTake). A thick or
//    firm toy goes in near straight and pushes the tissue with it; a thin soft one conforms. The anal canal holds the
//    first 35 mm straight.
//  - Past the toy's tip the gut is a second, very soft beam tethered by spring anchors (the rectum to the sacrum, the
//    sigmoid loosely on its mesentery, the descending colon to the back wall): it continues the toy's tangent and
//    relaxes toward its anchors (position-based, inextensible, smooth), so the sigmoid bends and translates as a soft
//    body instead of swinging on a hinge. Deep readiness pulls the sigmoid's resting place toward the midline.
//  - Outside the body the toy hangs on its base (clamped on the carriage, along the rail) with its rest curve; once in,
//    the canal holds its other end on the axis too and the outside part straightens to fit (a beam clamped at both
//    ends: its rest curvature less the linear part that would move either end).
import { restPath, frames, bendWindows, restAngles, curvature, ANATOMY } from './anatomy.js';
import { torsoSection, TORSO_SQ, boneAt, BONE_FROM, boneLinAt } from './body.js';

// where the toy is, its surface stays FLANK_MARGIN inside the slimmest body's flank (the wall and some tissue: it is
// steered along the flank, never through it) and its centre BELLY_MARGIN inside the slimmest belly (its surface may
// push the belly out: the bulge), mm at 175 cm (body.js torsoSection)
const FLANK_MARGIN = 12, BELLY_MARGIN = 14;
// and its upper surface BONE_MARGIN under the front of the sacrum and spine (body.js boneAt), mm at 175 cm
const BONE_MARGIN = 4;
const PULL = 100, PULLW = 1;   // mm, share: how much of the toy's front the descending colon's start draws, and how hard
/** mm (at 175 cm): how far a modelled body's descending colon yields to the toy (paw-lcmb: it is fixed to the back wall),
 *  and how much further once its turn has fully opened (paw-qin8: physics.js descCeil; solvePath descOpen). */
export const DESC_YIELD = 10, DESC_OPEN = 25;
/** The gut carried onto the toy (paw-hito; solvePath forward / descOpen). Past the rectum the toy holds its own line by
 *  its stiffness and the mobile gut (the sigmoid on its mesentery, then the descending colon's lower part once its turn
 *  has opened) is carried onto it, so a deep toy swings forward and to the centre and lies along the front abdominal
 *  wall: the bulge runs up the belly's midline (the owner's reference footage; colonoscopy loop imaging: a straightened
 *  sigmoid passes into the descending colon without angulation, and the loops lie against the anterior wall where hand
 *  pressure on the lower abdomen controls them). The line the carried gut takes (mm at 175 cm): from the end of the
 *  rectosigmoid turn along its tangent, turning no tighter than `turn` toward the midline (within `lx`) and the front
 *  wall (its centre `inset` inside the belly's inner surface, the toy's surface may push the belly out), up along it;
 *  a toy on it is pressed on to it (`press`) and steered toward it (`steer`, judged ahead, within its turn floor). The
 *  gut is carried as far as the descending colon's lower part has come off the back wall (its turn open to `descOpen`:
 *  all of it) times the sigmoid's straightening. Only the
 *  rectum and the colon above the drawn path stay anchored: the drawn path's top end is on a rope to the splenic
 *  flexure (`chord` mm on along its tangent), which lets `slack` mm more gut through as the descending colon is carried
 *  (the colon above the drawn path and the flexure's redundancy: the transverse colon hangs on a long mesocolon). The
 *  gut never stretches: its links keep their length, slack is taken up, never made. */
export const MIDLINE = Object.freeze({ turn: 60, lx: 50, lz: 20, inset: 10, press: 0.35, steer: 0.5, descOpen: 0.25, chord: 50, slack: 70, free: 250 });
/** How far the gut is carried onto the toy (0..1, MIDLINE; solvePath and the readouts): the sigmoid's straightening x
 *  how far the descending colon's turn has opened (a body with its own, fixed descending colon: fixed); else forward. */
export const carriedShare = (forward, descOpen, fixedDesc = true) => { const fw = Math.max(0, Math.min(1, forward)); return fixedDesc ? fw * Math.max(0, Math.min(1, descOpen / MIDLINE.descOpen)) : fw; };
/** The sigmoid straightened with use, as drawn (paw-qin8; physics.js SIGMOID, solvePath forward 0..1): at full, its
 *  loop's resting place moves `straight` of the way to the straight line from the end of the rectosigmoid turn to the
 *  descending colon's start, `mid` of the way in from the flank toward the midline and `wall` of the way down to lying
 *  on the front abdominal wall (the belly's inner surface, its own lumen off it: the lower front of the abdomen, where a
 *  hand pressing from the front controls the loop); the abdominal contents resting on it hold it there (its tether rises by `tether`) and press a
 *  toy in it that way too (`press`, whatever the toy's stiffness), so the toy lies toward the lower front of the belly. */
export const SIGMOID_DRAW = Object.freeze({ straight: 0.5, mid: 0.4, wall: 0.7, tether: 0.08, press: 0.12 });
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The toy's rest curvature from a rest centreline (toy.centre: [[dx, dz], ...] tip -> base in units of its length,
 *  1e-4) rolled by `roll` (rad, the same roll the view applies), as a 1 mm table of [kU, kV] (1/mm). null: straight. */
export function toyBend(toy, roll = 0) {
  const c = toy.centre;
  if (!c?.length) return null;
  const L = toy.length_mm, n = Math.ceil(L) + 1, m = c.length - 1, out = new Float32Array(n * 2), cr = Math.cos(roll), sr = Math.sin(roll);
  const at = (u, k) => { const x = Math.max(0, Math.min(m, (u / L) * m)), i = Math.min(m - 1, Math.floor(x)), f = x - i; return ((c[i][k] + (c[i + 1][k] - c[i][k]) * f) * L) / 1e4; };
  const h = Math.max(4, L / m);
  for (let u = 0; u < n; u++) {
    const a = Math.max(0, u - h), b = Math.min(L, u + h), mid = (a + b) / 2, hh = (b - a) / 2;
    const kx = (at(b, 0) - 2 * at(mid, 0) + at(a, 0)) / (hh * hh), kz = (at(b, 1) - 2 * at(mid, 1) + at(a, 1)) / (hh * hh);
    out[u * 2] = kx * cr - kz * sr; out[u * 2 + 1] = kx * sr + kz * cr;   // the view's roll: (x c - z s, x s + z c)
  }
  return out;
}

/** The equilibrium path for the view. opts: {scale, open, side, step, d (tip depth past the opening, mm), left: [f0, f1]
 *  (the fraction of each bend's rest turn the tissue still asks: bendLeft / rest), lateral (0..1: deep readiness
 *  drawing the sigmoid to the midline), forward (0..1: the sigmoid's straightening, SIGMOID_DRAW), descOpen (0..1: how
 *  far a modelled body's descending colon's turn has opened; it yields DESC_OPEN more at 1; with forward it carries the gut onto the toy, MIDLINE; physics.js pathInputs gives
 *  all four), toy: {r (1 mm radius table), EI (1 mm table), bend (toyBend table | null),
 *  len} | null, tissueEI, floor, body (an imported model's fitted profile, meshbody.js fitProfile: its sections, bone
 *  and belly instead of the procedural body's, and its own resting path (rest) when it has one; null: the procedural)}. -> a path like anatomy.restPath (P, T, U, V, n, step) plus `tip` (node index of the
 *  last node the toy holds, -1 none) and `kmax` (the largest curvature x local toy radius where the toy is). */
export function solvePath({ scale = 1, open = 1, side = -1, step = 4, d = 0, left = [1, 1], lateral = 0, forward = 0, descOpen = 0, toy = null, tissueEI = 1, floor = 2.75, body = null } = {}) {
  // (a modelled body brings its own resting path, its colon's centre line: anatomy.js meshPath)
  const own = body?.rest && body.rest.step === step ? body.rest : null, rest = own || restPath(scale, { open, side, step }), n = rest.n, A = ANATOMY, k = scale;
  const secAt = body ? body.section : (y) => torsoSection(y, k), boneOf = body ? body.boneAt : (y) => boneAt(y, k), boneFrom = body ? body.boneFrom : BONE_FROM * k;
  // (a modelled body's own bends: anatomy.js bodyBends; its rectosigmoid junction where its rectum ends)
  const B = own && body.bends, c = A.canalLen * k, win = B ? B.windows : bendWindows(scale), sE = B ? B.windows[1][1] : (A.rsJunction + A.rsLen) * k, rsAt = B ? B.rs : A.rsJunction * k;
  // the tissue's own target curvature: the rest curve with each bend straightened to `left` of its turn; the rectum
  // lies on the sacrum, so its own arc gives back what the flexure opened and it still arrives heading the same way
  const ang = restAngles(scale, open), sac = Math.max(0, (ang.sacral - (1 - left[0]) * ang.anorectal) / ang.sacral);
  const fac = (s) => {
    let f = 1;
    for (let i = 0; i < 2; i++) { const [a, b] = win[i], e = 6 * k; const w = smooth(a - e, a + e, s) * (1 - smooth(b - e, b + e, s)); f *= 1 - w * (1 - left[i]); }
    const e = 6 * k, ws = smooth(win[0][1] - e, win[0][1] + e, s) * (1 - smooth(win[1][0] - e, win[1][0] + e, s));
    return f * (1 - ws * (1 - sac));
  };
  // exact (analytic) up to the end of the rectosigmoid turn, from the sampled colon past it
  const kt = (s) => {
    const g = fac(s);
    if (s <= sE && !own) { const [a, b] = curvature(s, k, ang, side); return [a * g, b * g]; }
    const x = Math.max(0, Math.min(n - 1, s / step)), i = Math.min(n - 2, Math.floor(x)), f = x - i;
    return [(rest.ka[i] + (rest.ka[i + 1] - rest.ka[i]) * f) * g, (rest.kb[i] + (rest.kb[i + 1] - rest.kb[i]) * f) * g];
  };
  // integrate a curvature field from the opening along +y; returns positions at every node up to `upTo` and the end frame
  const P = new Float32Array(n * 3), out = { ...rest, P, T: new Float32Array(n * 3), U: new Float32Array(n * 3), V: new Float32Array(n * 3), ka: new Float32Array(n), kb: new Float32Array(n), tip: -1, kmax: 0 };
  const integrate = (upTo, curv, into, onStep) => {
    let p = [0, 0, 0], T = [0, 1, 0], U = [1, 0, 0], V = [0, 0, 1];
    const h = 1;
    for (let s = 0, i = 0; s <= upTo + 1e-9; s += h) {
      while (i * step <= s + 1e-9 && i < n) { const e = i * step - s; into(i, [p[0] + T[0] * e, p[1] + T[1] * e, p[2] + T[2] * e], T); i++; }
      const [ka, kb] = s < c ? [0, 0] : curv(s + h / 2);
      onStep?.(s, ka, kb);
      const nt = [0, 1, 2].map((q) => T[q] + (ka * U[q] + kb * V[q]) * h), l = Math.hypot(...nt) || 1;
      p = [0, 1, 2].map((q) => p[q] + (T[q] + nt[q] / l) * 0.5 * h);
      U = [0, 1, 2].map((q) => U[q] - ka * T[q] * h); V = [0, 1, 2].map((q) => V[q] - kb * T[q] * h); T = nt.map((x) => x / l);
      const lu = Math.hypot(...U) || 1, lv = Math.hypot(...V) || 1; U = U.map((x) => x / lu); V = V.map((x) => x / lv);
    }
    return { p, T };
  };
  // anchors: the relaxed rectum (integrated: the flexure opens with readiness), the colon on its tethers (drawn toward
  // the midline by deep readiness; the descending colon, on the back wall, half as much)
  const anchor = new Float32Array(n * 3);
  const iE = Math.min(n - 1, Math.round(sE / step));
  integrate(iE * step, kt, (i, p) => anchor.set(p, i * 3));
  const off = [0, 1, 2].map((q) => anchor[iE * 3 + q] - rest.P[iE * 3 + q]);
  for (let i = iE + 1; i < n; i++) {
    const s = i * step, fade = Math.exp(-(s - sE) / (40 * k)), seg = rest.seg[i], lat = lateral * (seg === 3 ? 0.5 : 1) * smooth(sE, sE + 40 * k, s);
    anchor[i * 3] = (rest.P[i * 3] + off[0] * fade) * (1 - lat);
    anchor[i * 3 + 1] = rest.P[i * 3 + 1] + off[1] * fade; anchor[i * 3 + 2] = rest.P[i * 3 + 2] + off[2] * fade;
  }
  // the sigmoid straightened with use (SIGMOID_DRAW): its loop toward the line from the end of the turn to the
  // descending colon's start, and forward (-z, ventral) toward the belly's inner surface, both ends held (eased in over
  // 40 mm, out over 60 mm)
  // (the gut's own link lengths, taken before the draw below: straightening takes up the sigmoid's slack, it never
  // stretches the gut; paw-hito: with them taken after, the drawn loop's longer chain let the free gut grow ~40 mm)
  const len0 = new Float32Array(n);
  for (let i = 1; i < n; i++) len0[i] = Math.hypot(anchor[i * 3] - anchor[i * 3 - 3], anchor[i * 3 + 1] - anchor[i * 3 - 2], anchor[i * 3 + 2] - anchor[i * 3 - 1]);
  const iS0 = rest.seg.findIndex((g, i) => i > iE && g === 3), iS = iS0 > iE + 2 ? iS0 : n - 1, fw = Math.max(0, Math.min(1, forward)), sw = new Float32Array(n), cw = new Float32Array(n);
  if (fw > 0) for (let i = iE + 1; i < iS; i++) {
    const s = i * step, w = fw * smooth(sE, sE + 40 * k, s) * (1 - smooth(iS * step - 60 * k, iS * step, s)), f = (i - iE) / (iS - iE);
    for (let q = 0; q < 3; q++) anchor[i * 3 + q] += (anchor[iE * 3 + q] + (anchor[iS * 3 + q] - anchor[iE * 3 + q]) * f - anchor[i * 3 + q]) * SIGMOID_DRAW.straight * w;
    anchor[i * 3] *= 1 - SIGMOID_DRAW.mid * w;
    const sc = body ? secAt(anchor[i * 3 + 1]) : null, wallZ = (sc ? sc[0] - sc[3] + BELLY_MARGIN * k : -A.bellyDepth * k) + A.sigmoidR * k;
    if (anchor[i * 3 + 2] > wallZ) anchor[i * 3 + 2] += (wallZ - anchor[i * 3 + 2]) * SIGMOID_DRAW.wall * w;
    sw[i] = w;
  }
  // (paw-hito) the gut carried onto the toy (MIDLINE): where the toy is (and the gut just ahead of its tip) its resting
  // place moves onto the carried line by `release`: the sigmoid's straightening (forward) x how far the descending
  // colon's turn has opened (descOpen, full at MIDLINE.descOpen). While the descending colon is still fixed the short
  // gut from the tip to it has no slack to give, so the toy stays on the loop drawn forward (SIGMOID_DRAW) and is drawn
  // toward the descending colon's start (PULL); a toy lies on the carried line as far as it does not hold its own (its
  // stiffness share and turn floor, below). A procedural body has no fixed descending colon: forward alone carries it.
  const release = carriedShare(fw, descOpen, !!B), iR = Math.max(2, Math.round(rsAt / step)), tipN = toy && d > 0 ? Math.min(n - 1, Math.floor(d / step)) : -1;
  if (release > 0 && tipN > iR) {
    const route = new Float32Array(n * 3);
    let p = [anchor[iR * 3], anchor[iR * 3 + 1], anchor[iR * 3 + 2]], t = [0, 1, 2].map((q) => anchor[iR * 3 + q] - anchor[(iR - 2) * 3 + q]);
    { const l = Math.hypot(...t) || 1; t = t.map((v) => v / l); }
    const maxTurn = step / (MIDLINE.turn * k);
    for (let i = iR; i < n; i++) {
      route.set(p, i * 3);
      // toward the midline and the front wall (its centre `inset` inside the belly's inner surface), under the bone
      const sc = body ? secAt(p[1]) : null, zw = (sc ? sc[0] - sc[3] + BELLY_MARGIN * k : -A.bellyDepth * k) + MIDLINE.inset * k;
      const zt = Math.min(zw, boneOf(p[1]) - 40 * k), want = [-p[0] / (MIDLINE.lx * k), 1, (zt - p[2]) / (MIDLINE.lz * k)], wl = Math.hypot(...want);
      for (let q = 0; q < 3; q++) want[q] /= wl;
      const cs = Math.max(-1, Math.min(1, t[0] * want[0] + t[1] * want[1] + t[2] * want[2])), ang = Math.acos(cs);
      if (ang <= maxTurn) t = want;
      else { const o = want.map((v, q) => v - cs * t[q]), ol = Math.hypot(...o) || 1; t = t.map((v, q) => v * Math.cos(maxTurn) + (o[q] / ol) * Math.sin(maxTurn)); }
      p = p.map((v, q) => v + t[q] * step);
    }
    for (let i = iR + 1; i < n; i++) {
      const s = i * step, w = smooth(rsAt + 10 * k, sE + 20 * k, s) * release * (i <= tipN ? 1 : 1 - smooth(d, d + 40 * k, s));
      if (w <= 0) continue;
      // (never further back than the loop drawn forward alone: carrying it on to the toy only brings it forward)
      for (let q = 0; q < 2; q++) anchor[i * 3 + q] += (route[i * 3 + q] - anchor[i * 3 + q]) * w;
      anchor[i * 3 + 2] = Math.min(anchor[i * 3 + 2], anchor[i * 3 + 2] + (route[i * 3 + 2] - anchor[i * 3 + 2]) * w);
      cw[i] = w;
    }
  }
  // one beam on an elastic foundation, position-based (Gauss-Seidel, a fixed number of passes from the anchors: the
  // same inputs always give the same shape): the canal holds its stretch straight on the axis; every node is pulled
  // toward its anchor (the tissue's tethers: firm on the rectum, loose on the sigmoid); where the toy is, the bending
  // is the toy's (stiffness share EI / (EI + tissue EI) toward the toy's own rest curve) and never tighter than
  // floor x its radius, with the toy's length kept; past it the gut keeps its own shape softly and its own lengths
  const tl = toy ? toy.r.length - 1 : 0, uAt = (i) => Math.max(0, Math.min(tl, Math.round(d - i * step)));
  const occ = (i) => !!toy && d > 0 && i * step <= d, last = toy && d > 0 ? Math.min(n - 1, Math.floor(d / step)) : -1;
  out.tip = last;
  const iC = Math.floor(c / step);
  // (the rectum held to the sacrum, the sigmoid loose on its mesentery, the descending colon on the back wall: with a
  // modelled body's own segments the descending colon is held firmly, it shifts but never swings in front)
  const tether = (i) => { const s = i * step, seg = rest.seg[i]; return seg <= 1 ? 0.3 - 0.12 * smooth(c, rsAt, s) : seg === 2 ? 0.02 + SIGMOID_DRAW.tether * fw : B ? 0.3 : 0.1; };
  const share = new Float32Array(n), lapT = new Float32Array(n * 3), lapA = new Float32Array(n * 3), turnMax = new Float32Array(n).fill(Math.PI);
  for (let i = 1; i < n - 1; i++) {
    for (let q = 0; q < 3; q++) lapA[i * 3 + q] = anchor[(i - 1) * 3 + q] + anchor[(i + 1) * 3 + q] - 2 * anchor[i * 3 + q];
    if (!occ(i)) continue;
    const u = uAt(i), e = toy.EI[u], ba = toy.bend ? toy.bend[u * 2] : 0, bb = toy.bend ? toy.bend[u * 2 + 1] : 0;
    share[i] = e / (e + tissueEI); len0[i] = step;
    turnMax[i] = step / (floor * Math.max(1, toy.r[u]));
    for (let q = 0; q < 3; q++) lapT[i * 3 + q] = (ba * rest.U[i * 3 + q] + bb * rest.V[i * 3 + q]) * step * step;
  }
  if (last >= 0 && last + 1 < n) { len0[last + 1] = step; turnMax[last] = Math.min(turnMax[last], 0.45); }   // the gut leaves the tip near its tangent
  // start where the toy wants to be: a stiff toy along the canal's line (its share of the bending), a soft one on the
  // relaxed path. The passes below only diffuse a few cm, so starting on the relaxed path dragged even a stiff toy
  // along it (round the sacral hollow and up toward the back: paw-584)
  P.set(anchor);
  for (let i = 0; i <= iC; i++) P.set([0, i * step, 0], i * 3);
  for (let i = iC + 1; i <= last; i++) { const w = share[i]; P[i * 3] *= 1 - w; P[i * 3 + 1] = P[i * 3 + 1] * (1 - w) + i * step * w; P[i * 3 + 2] *= 1 - w; }
  // the dorsal bound: the sacral hollow up to the rectosigmoid junction, then (the abdomen: the sigmoid runs forward
  // into it, the spine behind) easing down to just ventral of the canal's line over the next 200 mm
  // (a body's own path: its own bone and belly bound it, not these numbers)
  const ceilAt = Float32Array.from({ length: n }, (_, i) => (own ? 1e4 : A.sacralRise * k + (A.deepCeil - A.sacralRise) * k * smooth(A.rsJunction * k, (A.rsJunction + 200) * k, i * step)));
  const ITER = 160, floorZ = -A.bellyDepth * k, side_ = A.flankX * k, flankSoft = 30 * k;
  // where the toy is, the line is for its surface: the rectum's own lumen reaches the sacrum, a toy wider than it lies
  // that much further forward (it pushes the gut ventrally, never into the bone; paw-3f9: the leaner body's back)
  const ceilT = Float32Array.from(ceilAt, (c, i) => (occ(i) ? c - 0.7 * Math.max(0, toy.r[uAt(i)] - A.ampullaR * k) : c));
  const bound = (i, g) => {
    const zc = P[i * 3 + 2], xc = P[i * 3];
    // where the toy is, also its upper surface under the bone (the relaxation spreads the deflection along the toy; the
    // link pass below then holds it within the turn floor)
    const y = P[i * 3 + 1], ct0 = occ(i) && y > boneFrom ? Math.min(ceilT[i], boneOf(y) - BONE_MARGIN * k - toy.r[uAt(i)]) : ceilT[i];
    // an imported model: its own belly, flanks and bone bound the gut too (the procedural body's are the constants)
    const sc = body ? secAt(y) : null, ct = sc && y > boneFrom ? Math.min(ct0, boneOf(y) - BONE_MARGIN * k) : ct0;
    const fz = sc ? Math.min(ct - 1, sc[0] - sc[3] + BELLY_MARGIN * k) : floorZ, sd = sc ? Math.max(10 * k, sc[1] - FLANK_MARGIN * k) : side_;
    if (zc > ct) P[i * 3 + 2] -= (zc - ct) * g; else if (zc < fz) P[i * 3 + 2] -= (zc - fz) * g;
    if (Math.abs(xc) > sd) P[i * 3] -= Math.sign(xc) * (Math.abs(xc) - sd) * g;
  };
  // a modelled body's descending colon is fixed to the back wall (paw-lcmb): it yields DESC_YIELD (DESC_OPEN more as
  // its turn opens, paw-qin8) and no more; round the toy before the link pass, so the toy bends to follow it within its
  // turn floor (held after the link pass too; the physics stops a toy too stiff for what is left of that turn short of it)
  const iD0 = B ? rest.seg.findIndex((g) => g === 3) : -1, iD = iD0 > iC + 1 ? iD0 : n;   // (the descending colon's first node)
  // (paw-hito: carried off the back wall as far as `release`: free at 1)
  const yieldMm = (DESC_YIELD + DESC_OPEN * Math.max(0, Math.min(1, descOpen)) + MIDLINE.free * release) * k;
  const holdDesc = (i) => {
    if (rest.seg[i] !== 3) return;
    const dx = P[i * 3] - anchor[i * 3], dy = P[i * 3 + 1] - anchor[i * 3 + 1], dz = P[i * 3 + 2] - anchor[i * 3 + 2], l = Math.hypot(dx, dy, dz), m = yieldMm;
    if (l > m) { const f = m / l; P[i * 3] = anchor[i * 3] + dx * f; P[i * 3 + 1] = anchor[i * 3 + 1] + dy * f; P[i * 3 + 2] = anchor[i * 3 + 2] + dz * f; }
  };
  for (let it = 0; it < ITER; it++) {
    for (let i = iC + 1; i < n - 1; i++) {
      // (a modelled body's descending colon holds even round the toy: it is fixed to the back wall)
      // (a toy in the straightened sigmoid pressed toward the front wall with it, whatever its stiffness: SIGMOID_DRAW.press)
      // (paw-hito: its hold round the toy lets go as it is carried, release)
      const hold = B && rest.seg[i] === 3 ? 1 - release : 0;
      const a = tether(i) * (occ(i) ? 1 - share[i] * (1 - hold) : 1) + (occ(i) ? Math.max(SIGMOID_DRAW.press * sw[i], MIDLINE.press * cw[i]) : 0), b = occ(i) ? 0.3 * share[i] + 0.15 : 0.2;
      for (let q = 0; q < 3; q++) {
        // (paw-hito: carried, the toy's tip bends with the toy only: the gut past it never drags it round)
        const nb = i === last && release > 0 ? 2 * P[i * 3 + q] - P[(i - 1) * 3 + q] : P[(i + 1) * 3 + q];
        P[i * 3 + q] += a * (anchor[i * 3 + q] - P[i * 3 + q]) + b * ((P[(i - 1) * 3 + q] + nb - 2 * P[i * 3 + q]) - (occ(i) ? lapT[i * 3 + q] : lapA[i * 3 + q]));
      }
      // where the toy is the bounds push before the link pass, so its stiffness and turn floor keep the last word: a stiff
      // toy meets the sacrum as a smooth curve (it may ride a little past the line), never a kink
      if (occ(i)) { bound(i, 0.5); if (B) holdDesc(i); }
    }
    // outward from the canal: each link back to its length (the toy's exactly `step`), and where the toy is no turn at
    // a node sharper than its floor allows (the next link is swung back toward the last)
    for (let i = iC + 1; i < n; i++) {
      // (a modelled body's descending colon is fixed to the back wall: its links are not dragged along by the sigmoid,
      // which takes up its own slack as the toy straightens it; only the toy's own reach moves it)
      // (paw-hito: once carried off it, release > 0, it follows the toy's tip too)
      if (B && rest.seg[i] === 3 && release <= 0) continue;
      const j = i - 1;
      let dx = P[i * 3] - P[j * 3], dy = P[i * 3 + 1] - P[j * 3 + 1], dz = P[i * 3 + 2] - P[j * 3 + 2], l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      if (occ(j) && j <= last) {
        let px = P[j * 3] - P[j * 3 - 3], py = P[j * 3 + 1] - P[j * 3 - 2], pz = P[j * 3 + 2] - P[j * 3 - 1];
        const pl = Math.hypot(px, py, pz) || 1; px /= pl; py /= pl; pz /= pl;
        const tm = turnMax[j];
        // no turn at a node sharper than the toy's floor: the link is swung back toward the last
        const limit = () => {
          const cs = Math.max(-1, Math.min(1, dx * px + dy * py + dz * pz));
          if (Math.acos(cs) <= tm) return;
          let ox = dx - cs * px, oy = dy - cs * py, oz = dz - cs * pz;
          const ol = Math.hypot(ox, oy, oz);
          if (ol < 1e-9) { ox = 0; oy = 0; oz = 0; } else { ox /= ol; oy /= ol; oz /= ol; }
          dx = px * Math.cos(tm) + ox * Math.sin(tm); dy = py * Math.cos(tm) + oy * Math.sin(tm); dz = pz * Math.cos(tm) + oz * Math.sin(tm);
        };
        limit();
        // (paw-hito) where the gut is carried onto its line (MIDLINE) the toy is steered toward it, judged a little ahead
        // and within its turn floor, as far as it is carried: its stiffness decides how soon it gets there (its floor and
        // its share of the bending, which the relaxation above already weighed); the bone and the belly keep the last word
        if (cw[i] > 0) {
          const R = toy.r[uAt(i)], ah = len0[i] + Math.min(0.6 * floor * Math.max(1, R), Math.max(0, last - i) * step) + step, g = MIDLINE.steer * cw[i] * (1 - 0.5 * share[i]);
          const ia = Math.min(n - 1, i + Math.round((ah - len0[i]) / step));   // (the carried line where the look-ahead lands; toward the front only, never back)
          const ex = dx * ah - (P[j * 3] + dx * ah - anchor[ia * 3]) * g, ey = dy * ah, ez = dz * ah - Math.max(0, P[j * 3 + 2] + dz * ah - anchor[ia * 3 + 2]) * g, el = Math.hypot(ex, ey, ez) || 1;
          dx = ex / el; dy = ey / el; dz = ez / el;
          limit();
        }
        // the bone (body.js boneAt): the toy's upper surface never crosses the front of the sacrum and the spine. Where
        // it would come within `soft` of it (judged a little ahead) the link is steered ventrally, along it, within the
        // turn floor: the toy slides along the sacrum toward the belly (paw-dd9: a toy riding the sacral line pushed
        // the back's skin out)
        {
          const R = toy.r[uAt(i)], ahead = len0[i] + 0.6 * floor * Math.max(1, R);
          // (the bone keeps falling past the promontory: aim under it at the look-ahead point and at twice the distance)
          const qx = P[j * 3] + dx * ahead, qy = P[j * 3 + 1] + dy * ahead, qz = P[j * 3 + 2] + dz * ahead;
          const lim = Math.min(boneOf(qy), boneOf(qy + dy * ahead)) - BONE_MARGIN * k - R;
          if (qz > lim - flankSoft) {
            const hh = Math.max(0, Math.min(1, 0.5 + (0.5 * (lim - qz)) / flankSoft)), tz = lim + (qz - lim) * hh - flankSoft * hh * (1 - hh) - 0.5 * flankSoft * (1 - hh);
            const ex = qx - P[j * 3], ey = qy - P[j * 3 + 1], ez = tz - P[j * 3 + 2], el = Math.hypot(ex, ey, ez) || 1;
            dx = ex / el; dy = ey / el; dz = ez / el;
            limit();
          }
        }
        // the body's sides and belly (body.js torsoSection, the slimmest): the toy's surface stays flankMargin inside the
        // flank, and its centre bellyMargin inside the belly (beyond that its surface may push the belly out: the
        // bulge). Where the next node would come within `soft` of that, it is steered back (a smooth minimum on the
        // section's superellipse norm, then the same turn floor): it bends along the wall as far as its stiffness
        // lets it, never with a kink
        // (judged a little ahead, about half the toy's tightest turn: a stiff toy has to start turning early)
        const R = toy.r[uAt(i)], ahead = len0[i] + Math.min(0.6 * floor * Math.max(1, R), cw[i] > 0 ? (last - i) * step : Infinity);   // (paw-hito: carried, never past the tip: no toy there to meet the wall)
        const qx = P[j * 3] + dx * ahead, qy = P[j * 3 + 1] + dy * ahead, qz = P[j * 3 + 2] + dz * ahead;
        const [zc, hw, , rb] = secAt(qy), W = hw - FLANK_MARGIN * k - R, B = rb - BELLY_MARGIN * k, dzc = Math.min(0, qz - zc);
        const nrm = W > 1 && B > 1 ? ((Math.abs(qx) / W) ** TORSO_SQ + (Math.abs(dzc) / B) ** TORSO_SQ) ** (1 / TORSO_SQ) : 0, sn = Math.min(0.35, (flankSoft * (1 - 0.6 * cw[i])) / Math.min(W, B));   // (paw-hito: carried on to the front wall, pressed into it more)   // (capped: a thick toy in a small body leaves W tiny)
        if (nrm > 1 - sn) {
          const hh = Math.max(0, Math.min(1, 0.5 + (0.5 * (1 - nrm)) / sn)), f = (1 + (nrm - 1) * hh - sn * hh * (1 - hh)) / nrm;
          let ex = qx * f - P[j * 3], ey = dy * ahead, ez = (dzc < 0 ? zc + dzc * f : qz) - P[j * 3 + 2];
          const el = Math.hypot(ex, ey, ez) || 1; dx = ex / el; dy = ey / el; dz = ez / el;
          limit();
        }
      }
      P[i * 3] = P[j * 3] + dx * len0[i]; P[i * 3 + 1] = P[j * 3 + 1] + dy * len0[i]; P[i * 3 + 2] = P[j * 3 + 2] + dz * len0[i];
    }
    // the body bounds the gut past the toy (last in every pass, so they hold in the result): the sacrum and spine
    // dorsally (ceilAt), the abdominal wall ventrally (bellyDepth), the flanks
    for (let i = iC + 1; i < n; i++) if (!occ(i)) bound(i, 1);
    if (B && iD < n) {
      for (let i = iD; i < n; i++) holdDesc(i);
      // (paw-hito) carried off the back wall: the drawn path's top end on its rope to the splenic flexure (MIDLINE), and
      // the free gut laid back from it to the toy's tip (alternating with the pass out from the canal: both ends held, its
      // own length kept; the last pass is the one out, so no gap at the tip)
      if (release > 0 && it < ITER - 1) {
        const e = (n - 1) * 3, F = [0, 1, 2].map((q) => rest.P[e + q] + rest.T[e + q] * MIDLINE.chord * k), rl = (MIDLINE.chord + MIDLINE.slack * release) * k;
        const fx = P[e] - F[0], fy = P[e + 1] - F[1], fz = P[e + 2] - F[2], fl = Math.hypot(fx, fy, fz);
        if (fl > rl) { const f = rl / fl; P[e] = F[0] + fx * f; P[e + 1] = F[1] + fy * f; P[e + 2] = F[2] + fz * f; }
        for (let i = n - 2; i > Math.max(iC, last); i--) {
          const dx = P[i * 3] - P[i * 3 + 3], dy = P[i * 3 + 1] - P[i * 3 + 4], dz = P[i * 3 + 2] - P[i * 3 + 5], l = Math.hypot(dx, dy, dz) || 1, f = len0[i + 1] / l;
          P[i * 3] = P[i * 3 + 3] + dx * f; P[i * 3 + 1] = P[i * 3 + 4] + dy * f; P[i * 3 + 2] = P[i * 3 + 5] + dz * f;
        }
      }
      // the free gut laid back from the descending colon's start too (alternating with the pass out from the canal: both
      // its ends held, its own length kept; paw-hito: the empty sigmoid drawn forward tore a 34 mm link at the junction;
      // with a toy in, the pull below closes the gap)
      else if (fw > 0 && last < 0 && it < ITER - 1) for (let i = iD - 1; i > iC; i--) {
        const dx = P[i * 3] - P[i * 3 + 3], dy = P[i * 3 + 1] - P[i * 3 + 4], dz = P[i * 3 + 2] - P[i * 3 + 5], l = Math.hypot(dx, dy, dz) || 1, f = len0[i + 1] / l;
        P[i * 3] = P[i * 3 + 3] + dx * f; P[i * 3 + 1] = P[i * 3 + 4] + dy * f; P[i * 3 + 2] = P[i * 3 + 5] + dz * f;
      }
      // no gap at the descending colon's start (paw-lcmb): the gut from the toy's last free node a to it has only its
      // own length; where the toy ran straighter than that allows, its front is drawn toward the start (the next pass
      // bends it there within its turn floor), and at the end the free gut between runs straight to the start
      const a = Math.min(last >= 0 ? last : iC, iD - 1), gx = P[iD * 3] - P[a * 3], gy = P[iD * 3 + 1] - P[a * 3 + 1], gz = P[iD * 3 + 2] - P[a * 3 + 2], g = Math.hypot(gx, gy, gz), room = (iD - a) * step;
      // (paw-hito: less as the descending colon is carried with the toy: then it follows the tip instead)
      if (g > room && last >= 0 && release < 1) { const m = Math.max(1, Math.round((PULL * k) / step)), e = (g - room) / g; for (let i = Math.max(iC + 1, a - m); i <= a; i++) { const w = PULLW * (1 - release) * e * ((i - (a - m)) / m); P[i * 3] += gx * w; P[i * 3 + 1] += gy * w; P[i * 3 + 2] += gz * w; } }
      if (it === ITER - 1 && last >= 0 && g > room && release <= 0) for (let i = a + 1; i < iD; i++) { const f = (i - a) / (iD - a); for (let q = 0; q < 3; q++) P[i * 3 + q] = P[a * 3 + q] + (P[iD * 3 + q] - P[a * 3 + q]) * f; }
    }
  }
  // the largest curvature x local radius where the toy is (the floor is 1 / floor)
  for (let i = iC; i < last; i++) {
    const ax = P[i * 3] - P[i * 3 - 3], ay = P[i * 3 + 1] - P[i * 3 - 2], az = P[i * 3 + 2] - P[i * 3 - 1], bx = P[i * 3 + 3] - P[i * 3], by = P[i * 3 + 4] - P[i * 3 + 1], bz = P[i * 3 + 5] - P[i * 3 + 2];
    const th = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / ((Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz)) || 1))));
    out.kmax = Math.max(out.kmax, (th / step) * Math.max(1, toy.r[uAt(i)]));
  }
  // tangents (central differences; the toy's end keeps the toy's tangent) and transported frames
  for (let i = 0; i < n; i++) {
    // (the toy's last node looks back only: the gut just past its tip may double back, and its turn tilted the tip)
    const a = Math.max(0, i - 1), b = i === last ? i : Math.min(n - 1, i + 1);
    let t = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
    if (i === 0) t = [0, 1, 0];
    const l = Math.hypot(...t) || 1;
    out.T.set(t.map((x) => x / l), i * 3);
  }
  frames(out);
  return out;
}

/** Quaternion [x, y, z, w] of the rotation whose columns are U, T, V (local x -> U, y -> T, z -> V). */
export function quatOf(U, T, V) {
  const m00 = U[0], m01 = T[0], m02 = V[0], m10 = U[1], m11 = T[1], m12 = V[1], m20 = U[2], m21 = T[2], m22 = V[2], tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
  const l = Math.hypot(x, y, z, w) || 1;
  return [x / l, y / l, z / l, w / l];
}

/** The toy's centreline for the shader: N samples from its tip (u = 0) to its base (u = L), {C (N x 3 world mm), Q (N x
 *  4 quaternions), sigma (N: arc past the opening, < 0 outside)}. path: solvePath's (body frame); d: tip depth past the
 *  opening; dc: the carriage (world); xb: the body's offset along y; bend: toyBend table | null; base: baseOf(). */
/** How a mesh's base sits relative to its own long axis (mesh.js restCentre), rolled, for toyCentreline: the slope
 *  toward the tip and the offset of its centreline at the base. */
export function baseOf(rc, L, roll = 0) {
  const c = rc.c, n = c.length, cr = Math.cos(roll), sr = Math.sin(roll), r = ([x, z]) => [x * cr - z * sr, x * sr + z * cr];
  return { t: r([-(c[n - 1][0] - c[n - 2][0]) * (n - 1), -(c[n - 1][1] - c[n - 2][1]) * (n - 1)]), o: r([c[n - 1][0] * L, c[n - 1][1] * L]) };
}
export function toyCentreline({ path, d, dc, xb = 0, L, bend = null, base = null, N = 40 }) {
  const C = new Float32Array(N * 3), Q = new Float32Array(N * 4), sigma = new Float32Array(N), scale = Math.max(0.3, (d + xb - (dc - L)) / L);
  const uOpen = d > 0 ? Math.min(L, d / scale) : 0, lo = (L - uOpen) * scale, e = smooth(0, 30, d), tl = bend ? bend.length / 2 - 1 : 0;
  const kAt = (u, q) => (bend ? bend[Math.max(0, Math.min(tl, Math.round(u))) * 2 + q] : 0);
  // the outside part hangs on its base; once in, the canal clamps its other end on the axis too
  const ab = [[0, 0], [0, 0]];
  if (bend && e > 0 && lo > 5) for (let q = 0; q < 2; q++) {
    let I0 = 0, I1 = 0;
    for (let l = 0.5; l < lo; l += 1) { const kk = kAt(L - l / scale, q); I0 += kk; I1 += (lo - l) * kk; }
    const a11 = lo, a12 = (lo * lo) / 2, a22 = (lo * lo * lo) / 6, det = a11 * a22 - a12 * a12;
    ab[q] = [(I0 * a22 - I1 * a12) / det * e, (a11 * I1 - a12 * I0) / det * e];
  }
  const uk = (k) => (k / (N - 1)) * L;
  // base -> opening (or the tip, when not in yet)
  // base: how the mesh's base sits on its own long axis ({t: [x, z] slope toward the tip, o: [x, z] mm}, rolled): free, the
  // toy hangs exactly as modelled; once in, the mount and the canal line it up (blended out over the first 30 mm)
  const bt = base ? base.t.map((v) => v * (1 - e)) : [0, 0], bo = base ? base.o.map((v) => v * (1 - e)) : [0, 0], bl = Math.hypot(bt[0], 1, bt[1]);
  let p = [bo[0], dc - L, bo[1]], T = [bt[0] / bl, 1 / bl, bt[1] / bl], U = [1, 0, 0], V = [0, 0, 1];
  { const du = U[0] * T[0] + U[1] * T[1] + U[2] * T[2]; U = U.map((x, q) => x - du * T[q]); const lu = Math.hypot(...U); U = U.map((x) => x / lu); V = [U[1] * T[2] - U[2] * T[1], U[2] * T[0] - U[0] * T[2], U[0] * T[1] - U[1] * T[0]]; }
  const put = (k, P, Tt, Uu, Vv, sg) => { C.set(P, k * 3); Q.set(quatOf(Uu, Tt, Vv), k * 4); sigma[k] = sg; };
  let k = N - 1;
  const stop = d > 0 ? uOpen : 0;
  for (let u = L, l = 0; ; ) {
    while (k >= 0 && uk(k) >= u - 1e-9 && uk(k) >= stop - 1e-9) { const ex = (uk(k) - u) * scale; put(k, [p[0] - T[0] * ex, p[1] - T[1] * ex, p[2] - T[2] * ex], T, U, V, d - uk(k) * scale); k--; }
    if (u <= stop + 1e-9) break;
    const h = Math.min(1, u - stop), ka = kAt(u, 0) - (ab[0][0] + ab[0][1] * l), kb = kAt(u, 1) - (ab[1][0] + ab[1][1] * l);
    // walking from the base toward the tip
    const nt = [0, 1, 2].map((q) => T[q] + (ka * U[q] + kb * V[q]) * h * scale), ln = Math.hypot(...nt) || 1;
    p = [0, 1, 2].map((q) => p[q] + (T[q] + nt[q] / ln) * 0.5 * h * scale);
    U = [0, 1, 2].map((q) => U[q] - ka * T[q] * h * scale); V = [0, 1, 2].map((q) => V[q] - kb * T[q] * h * scale); T = nt.map((x) => x / ln);
    const lu = Math.hypot(...U) || 1, lv = Math.hypot(...V) || 1; U = U.map((x) => x / lu); V = V.map((x) => x / lv);
    u -= h; l += h * scale;
  }
  // inside: the solved path, moved with the body (and by whatever the outside part did not quite close)
  if (d > 0) {
    const gap = [p[0], p[1] - xb, p[2]];
    for (; k >= 0; k--) {
      const s = d - uk(k) * scale, i = Math.max(0, Math.min(path.tip >= 0 ? path.tip : path.n - 1, path.n - 1, Math.round(s / path.step))), x = s / path.step;
      let P;
      // (past the path's end, or past the toy's own last node (path.tip: the gut beyond may lie far off where it doubles
      // back or the descending colon holds it), along the last node's tangent)
      const end = path.tip >= 0 && x > path.tip ? path.tip : x >= path.n - 1 ? path.n - 1 : -1;
      if (end >= 0) { const j = end * 3, ex = s - end * path.step; P = [path.P[j] + path.T[j] * ex, path.P[j + 1] + path.T[j + 1] * ex, path.P[j + 2] + path.T[j + 2] * ex]; }
      else { const a = Math.floor(x), f = x - a; P = [0, 1, 2].map((q) => path.P[a * 3 + q] + (path.P[a * 3 + 3 + q] - path.P[a * 3 + q]) * f); }
      const g = (Arr) => [Arr[i * 3], Arr[i * 3 + 1], Arr[i * 3 + 2]];
      put(k, [P[0] + gap[0], P[1] + xb + gap[1], P[2] + gap[2]], g(path.T), g(path.U), g(path.V), s);
    }
  }
  return { C, Q, sigma, scale };
}
/** The toy's drawn centre line with the tip's wobble (physics.js WOBBLE, mm): the last 60 mm of a toyCentreline swung
 *  across its frame's U, most at the tip. For the view only (readouts and the bulge keep the unwobbled line). */
export function wobbledC(tc, wob, L) {
  const N = tc.C.length / 3, C = Float32Array.from(tc.C);
  if (wob) for (let k = 0; k < N && (k / (N - 1)) * L < 60; k++) { const U1 = qrot([...tc.Q.subarray(k * 4, k * 4 + 4)], [1, 0, 0]), w = wob * (1 - (k / (N - 1)) * L / 60) ** 2; for (let q = 0; q < 3; q++) C[k * 3 + q] += U1[q] * w; }
  return C;
}

/** World point of toy station u (mm from the tip) on a toyCentreline result. */
export function toyPoint(tc, u, L) {
  const N = tc.C.length / 3, x = Math.max(0, Math.min(N - 1, (u / L) * (N - 1))), i = Math.min(N - 2, Math.floor(x)), f = x - i;
  return [0, 1, 2].map((q) => tc.C[i * 3 + q] + (tc.C[i * 3 + 3 + q] - tc.C[i * 3 + q]) * f);
}

/** The body wall's thickness over the toy (mm): thicker with weight and height; the gut's own wall adds GUT_WALL. */
export const bodyWall = (scale = 1, weight = 0.25) => 6 * scale + 16 * weight;
export const GUT_WALL = 3, GUT_LAYER = 22;   // mm: the gut's own wall; the loops the toy pushes ahead of it deep in (at 175 cm)

/** The toy's own envelope for the body wall (the body shader's uToyW, bulgeAt): per toyCentreline sample k (tip ->
 *  base) [a, b, off, sigma]: the cross-section's half-width across the toy's drawn axis (its outline) and across the
 *  other (from its area: an oval toy is oval), the outline's offset along the drawn axis (a foot or a flare to one
 *  side), each low-passed over the wall thickness (a thin wall shows ridges, a thick one only the overall shape) and
 *  with the gut's wall on top, and deep in (past the rectum, where the gut lies against the front wall) the loops the
 *  toy displaces; and the sample's depth past the opening (sigma). toy: {length_mm, profile, outline?}. */
export function bulgeStations(tc, toy, wall, scale = 1) {
  const N = tc.C.length / 3, L = toy.length_mm, out = new Float32Array(N * 4), o = toy.outline, n = o ? o.length - 1 : 0;
  const rAt = (u) => { const p = toy.profile, x = Math.max(0, Math.min(p.length - 1, (u / L) * (p.length - 1))), i = Math.min(p.length - 2, Math.floor(x)); return p[i][1] + (p[i + 1][1] - p[i][1]) * (x - i); };
  const oAt = (u) => { const x = Math.max(0, Math.min(n, (u / L) * n)), i = Math.min(n - 1, Math.floor(x)), f = x - i; return [o[i][1] + (o[i + 1][1] - o[i][1]) * f, o[i][2] + (o[i + 1][2] - o[i][2]) * f]; };
  for (let k = 0; k < N; k++) {
    const u = (k / (N - 1)) * L;
    let r = 0, l = 0, rr = 0;
    for (let j = -2; j <= 2; j++) {   // a box over the wall thickness: what shows through
      const v = u + (j / 2) * wall * 0.75;
      r += rAt(v) / 5;
      if (o) { const [a, b] = oAt(v); l += a / 5; rr += b / 5; }
    }
    const wx = o ? Math.max(1, (rr - l) / 2) : r, wz = o ? (r * r) / wx : r, off = o ? (l + rr) / 2 : 0, s = tc.scale ?? 1;
    const gut = GUT_WALL + GUT_LAYER * scale * smooth(120 * scale, 230 * scale, tc.sigma[k]);
    out.set([wx * s + gut, wz * s + gut, off, tc.sigma[k]], k * 4);
  }
  return out;
}

const qrot = (q, v) => {   // v + 2 q.xyz x (q.xyz x v + w v), as the shader
  const [x, y, z, w] = q, c1 = [y * v[2] - z * v[1] + w * v[0], z * v[0] - x * v[2] + w * v[1], x * v[1] - y * v[0] + w * v[2]];
  return [v[0] + 2 * (y * c1[2] - z * c1[1]), v[1] + 2 * (z * c1[0] - x * c1[2]), v[2] + 2 * (x * c1[1] - y * c1[0])];
};
/** How far (mm) the skin at world point p is pushed out along its normal by the toy under it: the skin stays at least
 *  the wall thickness outside the toy's own surface (bulgeStations: its true, rolled cross-section per sample), with a
 *  soft knee that widens with the wall (a thin wall drapes crisply over the head, the taper and a knot; a thick one
 *  only swells), only where the toy is past `from` mm deep and on skin past 1.5-3.2 x `from` into the body (the
 *  opening's own skin is the sleeve's, the pubic arch and the genitals stay), never on bone-backed skin (the back: dorsal of `bone`, body.js boneLine; the pelvic
 *  ring), and saturating softly toward `cap`. roll: the toy's roll (rad).
 *  Mirrors the body shader (gl3d.js) exactly. */
export function bulgeAt(p, tc, st, roll, wall, { from = 60, cap = 60, bone = null, nor = null } = {}) {
  // bone-backed skin never moves (paw-dd9): the pelvic ring, the pubic arch and the skin around the opening (short of
  // 1.5-3.2 x `from` into the body), and the back, everywhere dorsal of the bone line (bone: body.js boneLine)
  // (paw-ani1: eased over a wide band, 30 mm at the bone line; saturating softly at cap)
  const near = smooth(1.5 * from, 3.2 * from, p[1]) * (1 - (bone ? smooth(-30, 0, p[2] - boneLinAt(bone, p[1])) : 0));
  if (near <= 0) return 0;   // (no walk over the toy: the readout samples thousands of points a frame)
  const N = tc.C.length / 3, cr = Math.cos(roll), sr = Math.sin(roll), C = tc.C, Q = tc.Q;
  let dist = 1e9, S = 0, G0 = 0, G1 = 0, G2 = 0;
  // (per segment between two samples, its section and frame interpolated along it: no step at a sample; scalar maths,
  // no allocation, the same as the shader)
  for (let k = 0; k < N - 1; k++) {
    const c0 = C[k * 3], c1 = C[k * 3 + 1], c2 = C[k * 3 + 2], e0 = C[k * 3 + 3] - c0, e1 = C[k * 3 + 4] - c1, e2 = C[k * 3 + 5] - c2, ee = Math.max(1e-6, e0 * e0 + e1 * e1 + e2 * e2);
    const t = Math.max(0, Math.min(1, ((p[0] - c0) * e0 + (p[1] - c1) * e1 + (p[2] - c2) * e2) / ee)), i4 = k * 4;
    const a = st[i4] + (st[i4 + 4] - st[i4]) * t, b = st[i4 + 1] + (st[i4 + 5] - st[i4 + 1]) * t, off = st[i4 + 2] + (st[i4 + 6] - st[i4 + 2]) * t, sg = st[i4 + 3] + (st[i4 + 7] - st[i4 + 3]) * t;
    const sgn = Q[i4] * Q[i4 + 4] + Q[i4 + 1] * Q[i4 + 5] + Q[i4 + 2] * Q[i4 + 6] + Q[i4 + 3] * Q[i4 + 7] < 0 ? -1 : 1;
    let x = Q[i4] + (sgn * Q[i4 + 4] - Q[i4]) * t, y = Q[i4 + 1] + (sgn * Q[i4 + 5] - Q[i4 + 1]) * t, z = Q[i4 + 2] + (sgn * Q[i4 + 6] - Q[i4 + 2]) * t, w = Q[i4 + 3] + (sgn * Q[i4 + 7] - Q[i4 + 3]) * t;
    const ql = Math.hypot(x, y, z, w) || 1; x /= ql; y /= ql; z /= ql; w /= ql;
    // the rotation's columns: X (local x), T (local y, the toy's line), Z (local z); rolled: ex, ez
    const X0 = 1 - 2 * (y * y + z * z), X1 = 2 * (x * y + w * z), X2 = 2 * (x * z - w * y), T0 = 2 * (x * y - w * z), T1 = 1 - 2 * (x * x + z * z), T2 = 2 * (y * z + w * x), Z0 = 2 * (x * z + w * y), Z1 = 2 * (y * z - w * x), Z2 = 1 - 2 * (x * x + y * y);
    const ex0 = cr * X0 + sr * Z0, ex1 = cr * X1 + sr * Z1, ex2 = cr * X2 + sr * Z2, ez0 = -sr * X0 + cr * Z0, ez1 = -sr * X1 + cr * Z1, ez2 = -sr * X2 + cr * Z2;
    const d0 = p[0] - (c0 + e0 * t + ex0 * off), d1 = p[1] - (c1 + e1 * t + ex1 * off), d2 = p[2] - (c2 + e2 * t + ex2 * off);
    const cx = d0 * ex0 + d1 * ex1 + d2 * ex2, cz = d0 * ez0 + d1 * ez1 + d2 * ez2;
    const rho = Math.hypot(cx, cz), gap = rho - (a * b * rho) / Math.max(1e-3, Math.hypot(b * cx, a * cz)), gate = 1 - Math.max(0, Math.min(1, (sg - from) / 40));
    // (a capped tube: ax the signed distance past its nearer end, the tip or the base, < 0 within it; aj how far past
    // this segment's end a point lies that projects beyond it at a joint)
    const sl = Math.sqrt(ee), end = (k === 0 && t <= 0) || (k === N - 2 && t >= 1), aj0 = Math.abs((p[0] - c0 - e0 * t) * e0 + (p[1] - c1 - e1 * t) * e1 + (p[2] - c2 - e2 * t) * e2) / sl;
    const ax = end ? aj0 : -Math.min((k + t) * sl, (N - 1 - k - t) * sl), aj = end ? 0 : aj0;
    const dk = Math.min(Math.max(gap, ax), 0) + Math.hypot(Math.max(gap, 0), Math.max(ax, 0) + aj) + gate * 200;
    // (a soft minimum over 10 mm, the direction away from the axis blended alike: smooth where the nearest sample changes)
    if (dk < dist) { const r = Math.exp((dk - dist) / 10); S *= r; G0 *= r; G1 *= r; G2 *= r; dist = dk; }
    const wk = Math.exp((dist - dk) / 10), ri = 1 / Math.max(rho, 1e-3);
    S += wk; G0 += wk * (cx * ex0 + cz * ez0) * ri; G1 += wk * (cx * ex1 + cz * ez1) * ri; G2 += wk * (cx * ex2 + cz * ez2) * ri;
  }
  dist -= 10 * Math.log(Math.max(S, 1) / 2);
  const ws = 0.35 * wall + 2, xk = (wall - dist) / ws, c = Math.max(cap, 1);
  // (with the skin's normal nor: only skin facing away from the toy and not back toward the opening, as the shader)
  const gl = Math.hypot(G0, G1, G2) || 1, face = nor ? smooth(0.1, 0.5, (G0 * nor[0] + G1 * nor[1] + G2 * nor[2]) / gl) * (1 - smooth(0.35, 0.6, -nor[1])) : 1;
  return c * Math.tanh((ws * (xk > 30 ? xk : Math.log1p(Math.exp(xk)))) / c) * near * face;
}

const bulgeIdx = new WeakMap();
/** The skin vertices the bulge readout samples (paw-ekys): every third skin vertex (part flag 1, or every vertex of a
 *  procedural body) over the belly, the flanks and below, 50-560 mm in at height 175 (the back never bulges), as
 *  indices; cached per mesh, so a frame never walks the whole body. */
export function bulgeSample(m, scale = 1) {
  let ix = bulgeIdx.get(m);
  if (!ix) {
    const a = [];
    for (let i = 0, k = 0; i < m.pos.length / 3; i++) {
      if (m.col && m.col[i * 4 + 3] !== 1) continue;
      const y = m.pos[i * 3 + 1], z = m.pos[i * 3 + 2];
      if (y > 50 * scale && y < 560 * scale && z < 40 * scale && k++ % 3 === 0) a.push(i);
    }
    bulgeIdx.set(m, (ix = Int32Array.from(a)));
  }
  return ix;
}

// ---- a modelled body's colon carried by the solved path (paw-kkmv) ----
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qconj = (a) => [-a[0], -a[1], -a[2], a[3]];
/** A sampled path's point, unit tangent and frame quaternion (U, T, V -> x, y, z) at arc s (linear between nodes). */
function pathFrame(p, s) {
  const x = Math.max(0, Math.min(p.n - 1, s / p.step)), i = Math.min(p.n - 2, Math.floor(x)), f = x - i, at = (A, q) => A[i * 3 + q] + (A[i * 3 + 3 + q] - A[i * 3 + q]) * f;
  const P = [0, 1, 2].map((q) => at(p.P, q)), un = (v) => { const l = Math.hypot(...v) || 1; return v.map((c) => c / l); };
  const T = un([0, 1, 2].map((q) => at(p.T, q))), U0 = [0, 1, 2].map((q) => at(p.U, q)), du = U0[0] * T[0] + U0[1] * T[1] + U0[2] * T[2], U = un(U0.map((c, q) => c - du * T[q]));
  const V = [U[1] * T[2] - U[2] * T[1], U[2] * T[0] - U[0] * T[2], U[0] * T[1] - U[1] * T[0]];
  return { P, T, Q: quatOf(U, T, V) };
}
/** The shortest rotation taking unit a to unit b (w >= 0; no twist about either). */
export function quatFromTo(a, b) {
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], w = 1 + a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (w < 1e-6) return [1, 0, 0, 0];   // (opposite: never on a gut)
  const l = Math.hypot(c[0], c[1], c[2], w); return [c[0] / l, c[1] / l, c[2] / l, w / l];
}
/** The colon's stations for the vertex shader (uColonC / uColonQ, `count` of them evenly over the resting path): where
 *  the gut lies now, as the resting place moved by what the toy did to it (solved minus the same solve without a toy,
 *  so a colon with nothing in it rests exactly in its anatomical place), and in w the radius the colon must open to
 *  there (the toy's radius + the gut's wall where the toy is, plus the chord's sag at a bend; else 0; the colon's own
 *  folds lie flat on it there: carryColon). toyR(u): the
 *  toy's radius u mm from its tip; d: the tip's arc.
 *  The frame is the resting frame swung (shortest rotation) from the resting tangent to the tangent now: never a twist
 *  about the gut's own line (paw-ani1: frames transported from the opening along differently bent paths disagree
 *  about the twist far up, and the whole colon spun; the toy's roll bends the path but never spins the gut).
 *  held: the gut's slow return (physics.js TISSUE_RETURN): [{path, d}, {path, d}, rs], the solves at the rectum's and
 *  the sigmoid's envelope depths; past the tip each part lies where its envelope's toy left it (the rectum's up to
 *  the junction rs, the sigmoid's past it), so a withdrawal leaves the gut to sink back in its own time.
 *  -> {C, Q (Float32Array count x 4), step}. */
export function colonStations(rest, solved, idle, d = 0, toyR = null, { count = 32, wall = 3, held = null } = {}) {
  const C = new Float32Array(count * 4), Q = new Float32Array(count * 4), step = rest.len / (count - 1), mix = (u, v, t) => u.map((c, i) => c + (v[i] - c) * t);
  const un = (v) => { const l = Math.hypot(...v) || 1; return v.map((c) => c / l); };
  // a station for one solve p with its tip at dd: on the solved path where the toy is, past its tip (over 40 mm) the
  // resting place moved by the toy; its tangent likewise
  // (past the tip the gut's tangent turns from the tip's over the same 40 mm: where the toy straightens the sigmoid's
  // loop the gut just past its tip doubles back, and a station's frame flipped as the tip went by it)
  const place = (p, dd, s, r, b) => {
    const a = pathFrame(p, s), on = toyR ? 1 - Math.max(0, Math.min(1, (s - dd) / 40)) : 0;
    const aT = toyR && dd > 0 && s > dd - 4 ? un(mix(pathFrame(p, dd - 4).T, a.T, smooth(dd - 4, dd + 40, s))) : a.T;
    return { P: mix(r.P.map((c, i) => c + a.P[i] - b.P[i]), a.P, on), T: un(mix(qrot(quatFromTo(b.T, aT), r.T), aT, on)) };
  };
  let prev = null;
  const sags = new Float32Array(count);
  for (let k = 0; k < count; k++) {
    const s = k * step, r = pathFrame(rest, s), b = pathFrame(idle, s);
    let { P, T } = place(solved, d, s, r, b);
    if (held && s > d) {
      const [hr, hs, rs] = held, pr = place(hr.path, hr.d, s, r, b), ps = place(hs.path, hs.d, s, r, b), wr = 1 - smooth(rs - 20, rs + 20, s), h = smooth(d, d + 30, s);
      P = mix(P, mix(ps.P, pr.P, wr), h); T = un(mix(T, mix(ps.T, pr.T, wr), h));
    }
    // (plus the sag of a straight chord between stations where the path bends: the toy follows the path itself)
    const ki = Math.min(solved.n - 1, Math.round(s / solved.step)), sag = (step * step * Math.hypot(solved.ka[ki], solved.kb[ki])) / 8;
    const w = toyR && s <= d ? toyR(d - s) + wall + sag : 0;
    let q = qmul(quatFromTo(r.T, T), r.Q);
    if (prev && q[0] * prev[0] + q[1] * prev[1] + q[2] * prev[2] + q[3] * prev[3] < 0) q = q.map((c) => -c);   // (one hemisphere along the gut)
    C.set([...P, w], k * 4); Q.set(q, k * 4); prev = q; sags[k] = sag;
  }
  // the shader interpolates the opening linearly between stations: where the toy between two is wider than that line
  // (a knot, the head, the tip just past a station) both are raised by the shortfall, so the wall never cuts into the
  // toy (paw-j7em: with point values it did, and past the tip the opening fell to 0 under the press: a waist)
  if (toyR && d > 0) for (let k = 0; k < count - 1 && k * step < d; k++) {
    let v = 0;
    const x1 = Math.min(d, (k + 1) * step);
    for (let x = k * step; x <= x1 + 1e-9; x = x < x1 && x + 0.5 > x1 ? x1 : x + 0.5) {   // (every 0.5 mm and the end: the tip)
      const f = x / step - k, need = toyR(d - x) + wall + Math.max(sags[k], sags[k + 1]);
      v = Math.max(v, need - (C[k * 4 + 3] + (C[k * 4 + 7] - C[k * 4 + 3]) * f));
    }
    if (v > 0) { C[k * 4 + 3] += v; C[k * 4 + 7] += v; }
  }
  // the tip's arc and the opening there (colonRadius: the folds relax from it over TENT); no toy: far behind
  const fi = Math.max(0, Math.min(count - 1.001, d / step)), i0 = Math.floor(fi);
  const tip = toyR && d > 0 ? [d, C[i0 * 4 + 3] + (C[i0 * 4 + 7] - C[i0 * 4 + 3]) * (fi - i0)] : [-1e4, 0];
  // per vertex (paw-fbqn; the shader where it reads the toy's profile, ring.js PROFILE): the opening is the toy's own
  // radius at the vertex's arc plus the wall and the chord's sag there (the stations' w in exact.C, linear between), so
  // a knot, a ridge or a flare shows as itself instead of widening the two stations round it; the tip's opening likewise
  let exact = null;
  if (toyR && d > 0) {
    const Cx = Float32Array.from(C);
    for (let k = 0; k < count; k++) Cx[k * 4 + 3] = sags[k];
    exact = { d, add: wall, C: Cx, tip: [d, toyR(0) + wall + sags[i0] + (sags[Math.min(count - 1, i0 + 1)] - sags[i0]) * (fi - i0)] };
  }
  return { C, Q, step, tip, exact };
}
/** Binds a framed colon mesh to its resting path (part flag 4: the rectum, sigmoid and descending colon the path runs
 *  in): per vertex the arc of the nearest point of the path and the offset from it in the path's frame (U, V across,
 *  T along), its normal turned into that frame; unbound vertices get arc -1. -> {bind (Float32Array nv x 4: s, a, b,
 *  t), nor (a copy with the bound normals local)}. */
export function bindColon(m, rest) {
  const nv = m.pos.length / 3, bind = new Float32Array(nv * 4).fill(-1), nor = Float32Array.from(m.nor), { n, step, P, T, U, V } = rest;
  for (let i = 0; i < nv; i++) {
    if (m.col[i * 4 + 3] !== 4) continue;
    const p = [m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]];
    let best = Infinity, bs = 0;
    for (let j = 0; j < n - 1; j++) {
      const ax = P[j * 3], ay = P[j * 3 + 1], az = P[j * 3 + 2], ex = P[j * 3 + 3] - ax, ey = P[j * 3 + 4] - ay, ez = P[j * 3 + 5] - az, ee = ex * ex + ey * ey + ez * ez || 1;
      const f = Math.max(0, Math.min(1, ((p[0] - ax) * ex + (p[1] - ay) * ey + (p[2] - az) * ez) / ee)), dx = p[0] - ax - ex * f, dy = p[1] - ay - ey * f, dz = p[2] - az - ez * f, dd = dx * dx + dy * dy + dz * dz;
      if (dd < best) { best = dd; bs = (j + f) * step; }
    }
    const { P: c, Q: q } = pathFrame(rest, bs), qi = qconj(q);
    const loc = (v) => { const r = qmul(qmul(qi, [...v, 0]), q); return [r[0], r[1], r[2]]; };   // the world vector in the frame (x U, y T, z V)
    const o = loc([p[0] - c[0], p[1] - c[1], p[2] - c[2]]), nn = loc([m.nor[i * 3], m.nor[i * 3 + 1], m.nor[i * 3 + 2]]);
    bind.set([bs, o[0], o[2], o[1]], i * 4); nor.set(nn, i * 3);
  }
  return { bind, nor };
}
/** mm: how far the colon's own folds stand off the toy where it is opened round it (carryColon, the shader). */
export const FOLD = 4;
/** mm: over how far ahead of the toy's tip the gut eases from lying on the toy back to its own lumen (the tissue tenting
 *  ahead of the tip; colonRadius, the shader). */
export const TENT = 18;
/** The drawn distance from the gut's centre line of a colon wall point whose own (resting) distance is r, at arc s, with
 *  the opening w there (colonStations: the toy + the gut's wall, 0 where there is none) and tip = [the tip's arc, the
 *  opening there] (paw-j7em): never inside the opening; where the toy is, its folds pressed to within FOLD of it;
 *  over TENT past the tip eased back to its own, monotone (the press stays at the tip's opening there, never falling
 *  with the toy's narrow tip into a waist). Mirrored by the vertex shader (gl3d.js COLON). */
export function colonRadius(r, s, w, tip) {
  const t = smooth(0, TENT, s - tip[0]), hi = (s <= tip[0] ? w : tip[1]) + FOLD;
  return Math.max(w, Math.min(r, hi)) * (1 - t) + Math.max(w, r) * t;
}
const qrot3 = (q, v) => { const c1 = [q[1] * v[2] - q[2] * v[1] + q[3] * v[0], q[2] * v[0] - q[0] * v[2] + q[3] * v[1], q[0] * v[1] - q[1] * v[0] + q[3] * v[2]]; return [v[0] + 2 * (q[1] * c1[2] - q[2] * c1[1]), v[1] + 2 * (q[2] * c1[0] - q[0] * c1[2]), v[2] + 2 * (q[0] * c1[1] - q[1] * c1[0])]; };
/** One carried colon vertex where the vertex shader puts it (gl3d.js COLON; for the tests): bind [s, a, b, t] on the
 *  stations {C, Q, step} -> [x, y, z]. */
export function carryColon(bind, { C, Q, step, tip = [-1e4, 0] }, exact = null) {
  const n = C.length / 4, fi = Math.max(0, Math.min(n - 1.001, bind[0] / step)), i = Math.floor(fi), f = fi - i;
  let q1 = [...Q.slice(i * 4 + 4, i * 4 + 8)]; const q0 = [...Q.slice(i * 4, i * 4 + 4)];
  if (q0[0] * q1[0] + q0[1] * q1[1] + q0[2] * q1[2] + q0[3] * q1[3] < 0) q1 = q1.map((x) => -x);
  let q = q0.map((x, k) => x + (q1[k] - x) * f); const ql = Math.hypot(...q); q = q.map((x) => x / ql);
  // (opened to w where the toy is; its folds and haustra wider than that pressed to within FOLD mm of it; colonRadius)
  // (exact: {d, add, tip, toyR}: the opening per vertex from the toy's own profile, colonStations' exact; else the stations')
  const c = [0, 1, 2, 3].map((k) => C[i * 4 + k] + (C[i * 4 + 4 + k] - C[i * 4 + k]) * f), r = Math.hypot(bind[1], bind[2]);
  if (exact) { c[3] = bind[0] <= exact.d ? exact.toyR(exact.d - bind[0]) + exact.add + exact.C[i * 4 + 3] + (exact.C[i * 4 + 7] - exact.C[i * 4 + 3]) * f : 0; tip = exact.tip; }
  const sc = r > 0.01 ? colonRadius(r, bind[0], c[3], tip) / r : 1;
  const o = qrot3(q, [bind[1] * sc, bind[3], bind[2] * sc]);
  return [c[0] + o[0], c[1] + o[1], c[2] + o[2]];
}
/** One organ vertex where the vertex shader pushes it (gl3d.js uPush; for the tests): p (world mm) against the toy's
 *  centreline tc and stations wallSt (bulgeStations), wall + soft margins -> [x, y, z]. */
export function pushAside(p, tc, wallSt, { wall = 8, soft = 15, half = 3 } = {}) {
  let push = [0, 0, 0];
  for (let pass = 0; pass < 2; pass++) {
    let ws = 0, sm = 0, add = [0, 0, 0];   // (a soft maximum over the stations, as the shader)
    for (let k = 0; k < 40; k++) {
      if (wallSt[k * 4 + 3] < 4) continue;
      const q = [tc.Q[k * 4], tc.Q[k * 4 + 1], tc.Q[k * 4 + 2], tc.Q[k * 4 + 3]], T = qrot3(q, [0, 1, 0]), d = [p[0] + push[0] - tc.C[k * 3], p[1] + push[1] - tc.C[k * 3 + 1], p[2] + push[2] - tc.C[k * 3 + 2]];
      const al = d[0] * T[0] + d[1] * T[1] + d[2] * T[2];
      if (Math.abs(al) > 2 * half + 2) continue;
      const rad = [d[0] - T[0] * al, d[1] - T[1] * al, d[2] - T[2] * al], rho = Math.hypot(...rad), x = Math.max(wallSt[k * 4], wallSt[k * 4 + 1]) + wall - rho;
      const s = x > soft ? x : x > -soft ? ((x + soft) ** 2) / (4 * soft) : 0;
      if (s > 0 && rho > 1e-3) { const w = s * Math.exp(Math.min(s, 60) / 6); ws += w; sm += w * s; add = add.map((c, i) => c + (w * rad[i]) / rho); }
    }
    const al = Math.hypot(...add);
    if (ws > 0 && al > 1e-6) push = push.map((c, i) => c + (add[i] / al) * (sm / ws));
  }
  const pl = Math.hypot(...push), k = pl > 60 ? 60 / pl : 1;
  return [p[0] + push[0] * k, p[1] + push[1] * k, p[2] + push[2] * k];
}
