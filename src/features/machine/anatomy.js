// anatomy.js -- the internal path for the Machine view: a 3D centreline following typical adult anorectal and
// colonic anatomy, to scale in mm (pure, no DOM). A planning model, not a measurement of any body and not guidance on
// what is safe for a person; applied to fantasy characters it is a human-derived model scaled by their height.
//
// World frame (the receiver on all fours, back up): the opening at the origin, y = along the rail into the body, z up
// (dorsal, toward the back / sacrum), x across (+x = the receiver's right, -x = their left; seen from behind or from
// above with the head away from the viewer, their left is the viewer's left). The spine runs along y (the body mesh),
// so the sacrum and everything above the pelvic floor keep their place in that frame. The anal canal naturally points
// up and FORWARD (toward the umbilicus: in this frame forward and DOWN, ventral, about 40 deg off the spine's line);
// the machine holds it along the rail instead, which levers it dorsally and opens the anorectal angle by that much
// (postureTilt). The rest stays put: the first version rotated the whole midsagittal anatomy with the canal, so the
// rectum stood straight up into the back and a deep toy hooked dorsally under the spine (paw-584). From the verge in:
//   - the anal canal: straight, along the rail, ~35 mm;
//   - the anorectal flexure: the puborectalis sling pulls the junction forward, so the path turns back toward the
//     sacrum (dorsal) over a few cm, smoothly (a sling, not a kink): the anorectal angle less the postureTilt the rail
//     has already taken up, so the rectum leaves at about 45 deg up and forward, along the sacrum;
//   - the rectum: ONE smooth arc, concave forward, hugging the sacral hollow up to the rectosigmoid junction at about
//     S3, ~150 mm from the verge, coming forward again as it rises: a shallow dorsal excursion of a few cm, bounded by
//     the sacrum; its transverse folds (valves of Houston) are wall indentations, not kinks;
//   - the rectosigmoid junction: a marked turn forward (ventral) and to the side, and a narrowing;
//   - the sigmoid colon: a soft S on its mesentery, leading out to the side into the descending colon, which runs
//     up (cranially) along that flank. Real anatomy puts both on the receiver's LEFT (`side` -1, the default); the
//     side is a per-character field so a character can be mirrored.
// The first version drew the sagittal shape as straight runs joined by short arcs, put the whole sacral turn late,
// drew the folds as radius steps that read as kinks, and folded the sigmoid back in the midline: the rectum read as
// a vertical tower and its 150 mm depth did not show.
//
// Typical adult values, with large individual variation. Sources: Standring (ed.), Gray's Anatomy, 42nd ed. (2020),
// "Rectum", "Anal canal", "Sigmoid colon"; Moore, Dalley & Agur, Clinically Oriented Anatomy, 8th ed. (2018),
// "Rectum and anal canal"; resting anorectal angles as commonly reported in defecography reference ranges.
export const ANATOMY = Object.freeze({
  canalLen: 35,          // anal canal, verge to the anorectal junction: about 3-4 cm (internal + external sphincters)
  anorectalAngle: 90,    // the turn at the anorectal flexure at rest (an interior angle of about 90 deg; it opens to
                         // about 110-130 deg when relaxed / bearing down), deg
  postureTilt: 40,       // how far the rail levers the canal dorsally from its natural line (it points toward the
                         // umbilicus, ~40 deg ventral of the spine's line on all fours); opens the flexure by that, deg
  sacralRise: 45,        // the most the rectum rises dorsally above the canal's line (the sacral hollow), mm at 175 cm
  bellyDepth: 88,        // how far below the canal's line the path's centre can go before the abdominal wall stops it
                         // (the toy beyond shows as the belly bulge), mm at 175 cm
  sag: 22,               // on all fours the sigmoid hangs on its mesentery toward the belly wall (the abdominal contents
                         // rest on it): its loop drawn this much lower; the descending colon, fixed to the back wall,
                         // half as much, mm at 175 cm (paw-3f9 / paw-bii: without it a deep toy ran mid-abdomen, 50-60 mm
                         // above even a slim belly, and its form never reached the skin)
  flankX: 85,            // how far to either side the path's centre can go (the flanks), mm at 175 cm
  deepCeil: -5,          // past the rectosigmoid junction the path's centre stays this far below the canal's line (up =
                         // +): the sigmoid and colon lie in the abdomen, the spine and back muscles above, mm at 175 cm
  flexureLen: 40,        // arc over which the flexure turns (a sling: curvature eased in and out), mm
  sacralTurn: 75,        // the rectum follows the sacral hollow (concave forward), turning back toward the head, deg
  houston: [70, 100, 125],   // transverse rectal folds (valves of Houston) from the verge, mm: about 7, 9-11 (the
                         // largest, middle), 12-13 cm; mild narrowings of the wall
  rsJunction: 150,       // rectosigmoid junction from the verge: about 15 cm (12-18), a marked turn and a narrowing
  rsTurn: 75,            // the turn at the rectosigmoid junction, forward and to the side, deg
  rsLen: 25,             // arc over which it turns, mm
  rsSide: 55,            // how much of that turn goes to the side (0 = straight forward, 90 = straight to the side), deg
  sigmoidLen: 210,       // the sigmoid drawn past the junction (it is 25-40 cm, mobile on its mesentery), mm
  descendingLen: 110,    // the start of the descending colon, up the flank, mm
  canalR: 3.5,           // resting radius of the closed canal (it opens around a toy), mm
  ampullaR: 18,          // rectal ampulla: wide and compliant, mm
  foldR: 14,             // at a transverse fold, mm
  rsR: 10,               // at the rectosigmoid junction: a real narrowing, mm
  sigmoidR: 12,          // sigmoid lumen at rest, mm
  descendingR: 14,       // descending colon lumen at rest, mm
});
export const SIDE = -1;  // the sigmoid / descending colon side: -1 = the receiver's left (anatomical default), +1 mirrored

/** Where the two resisting bends sit along the path (mm from the verge) for a body scale. */
export function bendsAt(scale = 1) {
  return [ANATOMY.canalLen * scale, ANATOMY.rsJunction * scale];
}

/** Rest bend angles (deg) for a body scale (larger bodies a little straighter) and an openness factor (experience:
 *  < 1 = a more open anorectal angle). */
export function restAngles(scale = 1, open = 1) {
  const f = Math.max(0.6, Math.min(1.3, 1 / Math.sqrt(scale)));
  return { anorectal: Math.max(0, ANATOMY.anorectalAngle * open - ANATOMY.postureTilt) * f, sacral: ANATOMY.sacralTurn * f, rs: ANATOMY.rsTurn * f };
}

/** Total drawn length of the path (mm) for a body scale. */
export const pathLength = (scale = 1) => (ANATOMY.rsJunction + ANATOMY.rsLen + ANATOMY.sigmoidLen + ANATOMY.descendingLen) * scale;

/** The segments, by arc length: 0 canal, 1 rectum, 2 sigmoid, 3 descending colon. */
export const SEGMENTS = Object.freeze(['anal canal', 'rectum', 'sigmoid colon', 'descending colon']);
export function segmentAt(s, scale = 1) {
  const A = ANATOMY, k = scale;
  return s < A.canalLen * k ? 0 : s < A.rsJunction * k ? 1 : s < (A.rsJunction + A.rsLen + A.sigmoidLen) * k ? 2 : 3;
}

// a plateau on [a, b] with cosine ramps of r, integrating to 1
const plateau = (s, a, b, r) => (s < a || s > b ? 0 : (0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, (s - a) / r, (b - s) / r))) / (b - a - r));
const RAD = Math.PI / 180;

/** The bend windows (arc ranges) a toy's own turn is measured over, for a body scale: [[from, to], [from, to]]. */
export const bendWindows = (scale = 1) => { const A = ANATOMY, k = scale; return [[A.canalLen * k, (A.canalLen + A.flexureLen) * k], [A.rsJunction * k, (A.rsJunction + A.rsLen) * k]]; };

/** The curvature (rad/mm) of the canal, flexure, rectum and rectosigmoid turn at arc s, in the path's own transported
 *  frame: ka toward U (starts as +x), kb toward V (starts as +z, dorsal). */
export function curvature(s, k, ang, side) {
  const A = ANATOMY, c = A.canalLen * k, f1 = c + A.flexureLen * k, rs = A.rsJunction * k;
  let ka = 0, kb = 0;
  kb += ang.anorectal * RAD * plateau(s, c, f1, 12 * k);
  kb -= ang.sacral * RAD * plateau(s, f1, rs, 25 * k);
  const r = ang.rs * RAD * plateau(s, rs, rs + A.rsLen * k, 8 * k), fw = A.rsSide * RAD;
  kb -= r * Math.cos(fw); ka += side * r * Math.sin(fw);
  return [ka, kb];
}

const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** Cubic Hermite between p0 (tangent m0) and p1 (tangent m1) at t. */
const herm = (p0, m0, p1, m1, t) => { const t2 = t * t, t3 = t2 * t, h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2; return [0, 1, 2].map((i) => h00 * p0[i] + h10 * m0[i] + h01 * p1[i] + h11 * m1[i]); };

// the sigmoid's soft S and the descending colon: control points from the end of the rectosigmoid turn, in body mm
// (x toward the colon side, y toward the head, z dorsal) with their tangent directions (the side's sign is applied)
// (the sigmoid runs forward into the lower abdomen, ventral of the canal's line; the descending colon stays a little
// ventral of it too, so a long toy's tip ends up toward the belly, never toward the back)
// (z before the sag; the last number is how much of ANATOMY.sag each point takes)
const COLON = [
  [[29, 22, -40], [0.55, 0.6, -0.6], 0.7],     // forward and out, away from the sacrum, down toward the belly
  [[44, 77, -62], [-0.05, 1, 0], 1],            // the first bend of the S: toward the head, a little back in
  [[74, 127, -50], [0.55, 0.8, 0.25], 1],       // the second: out to the flank and back up a little
  [[80, 182, -38], [0, 1, 0.05], 0.5],          // the descending colon begins: up along the flank
  [[80, 282, -30], [0, 1, 0.05], 0.5],
];

const cache = new Map();
/** The resting path, sampled every `step` mm of arc length: {step, n, len, P, T, U, V (Float32Array n*3: position,
 *  tangent, the transported frame), ka, kb (Float32Array n: curvature toward U / V, rad/mm), seg (Uint8Array n)}.
 *  open: the anorectal openness factor; side: -1 left (default), +1 right. Cached: do not mutate. */
export function restPath(scale = 1, { open = 1, side = SIDE, step = 4 } = {}) {
  const key = `${scale}|${open}|${side}|${step}`;
  if (cache.has(key)) return cache.get(key);
  const A = ANATOMY, k = scale, ang = restAngles(scale, open), len = pathLength(scale), h = 0.25;
  const pts = [];
  // 1. canal, flexure, rectum and the rectosigmoid turn: integrated from their curvature (arc length exact)
  let P = [0, 0, 0], T = [0, 1, 0], U = [1, 0, 0], V = [0, 0, 1];
  const sE = (A.rsJunction + A.rsLen) * k;
  for (let s = 0; s < sE - 1e-9; s += h) {
    pts.push(P);
    const [ka, kb] = curvature(s + h / 2, k, ang, side);
    const Tm = norm3([0, 1, 2].map((i) => T[i] + (ka * U[i] + kb * V[i]) * h * 0.5));
    P = [0, 1, 2].map((i) => P[i] + Tm[i] * h);
    const nT = norm3([0, 1, 2].map((i) => T[i] + (ka * U[i] + kb * V[i]) * h));
    U = norm3([0, 1, 2].map((i) => U[i] - ka * T[i] * h)); V = norm3([0, 1, 2].map((i) => V[i] - kb * T[i] * h)); T = nT;
  }
  // 2. the sigmoid and the descending colon: a smooth Hermite chain from the end of the turn, resampled by arc length
  const ctrl = [[P, T], ...COLON.map(([o, t, g]) => [[P[0] + side * o[0] * k, P[1] + o[1] * k, P[2] + (o[2] - g * A.sag) * k], norm3([side * t[0], t[1], t[2]])])];
  const fine = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const [p0, t0] = ctrl[i], [p1, t1] = ctrl[i + 1], ch = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    for (let j = 0; j < 200; j++) fine.push(herm(p0, t0.map((x) => x * ch), p1, t1.map((x) => x * ch), j / 200));
  }
  fine.push(ctrl.at(-1)[0]);
  let acc = 0, need = h;
  for (let i = 1; i < fine.length && pts.length * h <= len + 2; i++) {
    const a = fine[i - 1], b = fine[i], dl = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    while (acc + dl >= need) { const f = (need - acc) / dl; pts.push([0, 1, 2].map((q) => a[q] + (b[q] - a[q]) * f)); need += h; }
    acc += dl;
  }
  // 3. sample every `step`, with tangents (central differences of the fine samples) and a transported frame
  const n = Math.floor(len / step) + 1, every = Math.round(step / h);
  const out = { step, n, len: (n - 1) * step, scale, side, P: new Float32Array(n * 3), T: new Float32Array(n * 3), U: new Float32Array(n * 3), V: new Float32Array(n * 3), ka: new Float32Array(n), kb: new Float32Array(n), seg: new Uint8Array(n) };
  const at = (j) => pts[Math.max(0, Math.min(pts.length - 1, j))];
  for (let i = 0; i < n; i++) {
    const j = i * every;
    out.P.set(at(j), i * 3); out.T.set(norm3([0, 1, 2].map((q) => at(j + 2)[q] - at(j - 2)[q])), i * 3); out.seg[i] = segmentAt(i * step, k);
  }
  out.T.set([0, 1, 0], 0);
  frames(out);
  cache.set(key, out);
  return out;
}

/** The resting path of a modelled body (paw-27u0): its colon's own centre line (pts: [[x, y, z], ...] mm in the
 *  simulation's frame, from the anorectal junction up the rectum, sigmoid and descending colon; meshbody.js) after
 *  the anal canal, which the rail holds straight along +y for ANATOMY.canalLen; a smooth Hermite joins the canal's end
 *  to the centre line 35 mm on (the flexure, about as long as ANATOMY.flexureLen). Sampled like restPath; its `side` is where the colon ends up (-1 the receiver's left).
 *  The bends' physics (bendsAt, restAngles) stay ANATOMY's. */
export function meshPath(pts, scale = 1, { step = 4 } = {}) {
  const k = scale, c = ANATOMY.canalLen * k, h = 0.25;
  // a moving average, three passes (the centre line is from bins of the mesh: a few mm of noise, and a bin straddling a
  // tight turn cuts its corner)
  const avg = (P) => P.map((_, i) => { const a = Math.max(0, i - 2), b = Math.min(P.length - 1, i + 2), s = [0, 0, 0]; for (let j = a; j <= b; j++) for (let q = 0; q < 3; q++) s[q] += P[j][q] / (b - a + 1); return s; });
  const sm = avg(avg(avg(pts)));
  const C = [0, c, 0], q0 = Math.max(1, sm.findIndex((p) => Math.hypot(p[0] - C[0], p[1] - C[1], p[2] - C[2]) >= 35 * k && p[1] > C[1]));
  const tq = norm3([0, 1, 2].map((q) => sm[Math.min(sm.length - 1, q0 + 1)][q] - sm[q0 - 1][q])), Q = sm[q0], ch = Math.hypot(Q[0] - C[0], Q[1] - C[1], Q[2] - C[2]);
  const fine = [];
  for (let s = 0; s < c; s += h) fine.push([0, s, 0]);
  for (let j = 0; j < 200; j++) fine.push(herm(C, [0, ch, 0], Q, tq.map((x) => x * ch), j / 200));
  for (let i = q0; i < sm.length - 1; i++) for (let j = 0; j < 20; j++) fine.push(sm[i].map((x, q) => x + ((sm[i + 1][q] - x) * j) / 20));
  fine.push(sm.at(-1));
  const pts2 = [fine[0]];
  let acc = 0, need = h;
  for (let i = 1; i < fine.length; i++) {
    const a = fine[i - 1], b = fine[i], dl = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    while (dl > 0 && acc + dl >= need) { const f = (need - acc) / dl; pts2.push([0, 1, 2].map((q) => a[q] + (b[q] - a[q]) * f)); need += h; }
    acc += dl;
  }
  const n = Math.floor(((pts2.length - 1) * h) / step) + 1, every = Math.round(step / h), at = (j) => pts2[Math.max(0, Math.min(pts2.length - 1, j))];
  const out = { step, n, len: (n - 1) * step, scale, P: new Float32Array(n * 3), T: new Float32Array(n * 3), U: new Float32Array(n * 3), V: new Float32Array(n * 3), ka: new Float32Array(n), kb: new Float32Array(n), seg: new Uint8Array(n) };
  for (let i = 0; i < n; i++) { const j = i * every; out.P.set(at(j), i * 3); out.T.set(norm3([0, 1, 2].map((q) => at(j + 2)[q] - at(j - 2)[q])), i * 3); out.seg[i] = segmentAt(i * step, k); }
  out.T.set([0, 1, 0], 0);
  let sx = 0;
  for (let i = Math.floor((2 * n) / 3); i < n; i++) sx += out.P[i * 3];
  out.side = sx > 0 ? 1 : -1;
  return frames(out);
}

/** A modelled body's own bend positions on its resting path (paw-kkmv, paw-jgcj): the anal canal (ANATOMY.canalLen),
 *  the rectosigmoid junction (the arc nearest rsPoint, framed mm: where its rectum ends), the start of the descending
 *  colon (past the junction, where the path first reaches 85 % of its reach to its side: up the flank, fixed to the
 *  back wall). Rewrites rest.seg by them (0 canal, 1 rectum, 2 sigmoid, 3 descending colon). -> {canal, rs, desc,
 *  bends: [canal, rs], windows: [[a, b], [a, b]]} (mm of arc). */
export function bodyBends(rest, rsPoint, scale = 1) {
  const A = ANATOMY, c = A.canalLen * scale, { n, step, P } = rest;
  let rs = 0, best = Infinity, reach = 0;
  for (let i = 0; i < n; i++) { const dd = Math.hypot(P[i * 3] - rsPoint[0], P[i * 3 + 1] - rsPoint[1], P[i * 3 + 2] - rsPoint[2]); if (dd < best) { best = dd; rs = i * step; } reach = Math.max(reach, Math.abs(P[i * 3])); }
  rs = Math.max(c + A.flexureLen * scale, rs);
  let desc = rest.len;
  for (let i = Math.ceil(rs / step); i < n; i++) if (Math.abs(P[i * 3]) >= 0.85 * reach) { desc = i * step; break; }
  for (let i = 0; i < n; i++) { const s = i * step; rest.seg[i] = s < c ? 0 : s < rs ? 1 : s < desc ? 2 : 3; }
  // the turn into the descending colon (paw-lcmb): between the tangents 20 mm before its start and 40 mm into it
  const T = (s) => { const i = Math.max(0, Math.min(n - 1, Math.round(s / step))); return [rest.T[i * 3], rest.T[i * 3 + 1], rest.T[i * 3 + 2]]; }, ta = T(desc - 20 * scale), tb = T(desc + 40 * scale);
  const descTurn = desc < rest.len ? (Math.acos(Math.max(-1, Math.min(1, ta[0] * tb[0] + ta[1] * tb[1] + ta[2] * tb[2]))) * 180) / Math.PI : 0;
  return { canal: c, rs, desc, descTurn, bends: [c, rs], windows: [[c, c + A.flexureLen * scale], [rs, rs + A.rsLen * scale]] };
}

/** Transported (rotation-minimising) frames U, V along a sampled path from its tangents, starting at x / z; and the
 *  curvature components ka, kb from the change of tangent per step. Mutates path. */
export function frames(path) {
  const { n, T, U, V, ka, kb, step } = path;
  U.set([1, 0, 0], 0); V.set([0, 0, 1], 0);
  for (let i = 1; i < n; i++) {
    const t0 = [T[i * 3 - 3], T[i * 3 - 2], T[i * 3 - 1]], t1 = [T[i * 3], T[i * 3 + 1], T[i * 3 + 2]];
    // the previous U projected onto the plane normal to the new tangent (steps of a few mm: no need for reflections)
    const u0 = [U[i * 3 - 3], U[i * 3 - 2], U[i * 3 - 1]], du = u0[0] * t1[0] + u0[1] * t1[1] + u0[2] * t1[2];
    const u = norm3([u0[0] - du * t1[0], u0[1] - du * t1[1], u0[2] - du * t1[2]]);
    const v = [u[1] * t1[2] - u[2] * t1[1], u[2] * t1[0] - u[0] * t1[2], u[0] * t1[1] - u[1] * t1[0]];   // V = U x T (+z at the start)
    const dt = [t1[0] - t0[0], t1[1] - t0[1], t1[2] - t0[2]];
    ka[i - 1] = (dt[0] * u0[0] + dt[1] * u0[1] + dt[2] * u0[2]) / step;
    kb[i - 1] = (dt[0] * V[i * 3 - 3] + dt[1] * V[i * 3 - 2] + dt[2] * V[i * 3 - 1]) / step;
    U.set(u, i * 3); V.set(v, i * 3);
  }
  ka[n - 1] = ka[n - 2] || 0; kb[n - 1] = kb[n - 2] || 0;
  return path;
}

/** Point [x, y, z] at arc length s on a sampled path (linear between samples; straight past the ends). */
export function pointAt(path, s) {
  const { step, n, P, T } = path, x = s / step;
  if (x <= 0) return [P[0] + T[0] * s, P[1] + T[1] * s, P[2] + T[2] * s];
  if (x >= n - 1) { const j = (n - 1) * 3, e = s - (n - 1) * step; return [P[j] + T[j] * e, P[j + 1] + T[j + 1] * e, P[j + 2] + T[j + 2] * e]; }
  const i = Math.floor(x), f = x - i;
  return [0, 1, 2].map((q) => P[i * 3 + q] + (P[i * 3 + 3 + q] - P[i * 3 + q]) * f);
}

/** Resting lumen radius (mm) at arc length s for a body scale: closed canal, wide ampulla with its folds (gentle
 *  indentations), the narrowing at the rectosigmoid junction, the sigmoid, the descending colon. */
export function restRadius(s, scale = 1) {
  const A = ANATOMY, k = scale, c = A.canalLen * k, rs = A.rsJunction * k, sd = (A.rsJunction + A.rsLen + A.sigmoidLen) * k;
  const ease = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
  let r;
  if (s < c) r = A.canalR * Math.sqrt(k);
  else if (s < c + 20 * k) r = ease(A.canalR * Math.sqrt(k), A.ampullaR * k, (s - c) / (20 * k));
  else if (s < rs - 12 * k) r = A.ampullaR * k;
  else if (s < rs + 8 * k) r = ease(A.ampullaR * k, A.rsR * k, (s - (rs - 12 * k)) / (12 * k));
  else if (s < sd) r = ease(A.rsR * k, A.sigmoidR * k, (s - rs - 8 * k) / (20 * k));
  else r = ease(A.sigmoidR * k, A.descendingR * k, (s - sd) / (30 * k));
  for (const h of A.houston) r -= (A.ampullaR - A.foldR) * k * Math.exp(-(((s - h * k) / (5 * k)) ** 2));   // the folds
  return Math.max(A.canalR, r);
}

/** The wall's radius (mm) at arc length s with the toy's tip at depth d: the empty lumen (lumen(s); the resting lumen
 *  by default), opened around the toy wherever the toy is (its radius at that point, a little clearance), and to the
 *  ring aperture at the opening. The toy rides the path's centreline, so the wall never lets it through. toyR(x) = the
 *  toy's radius x mm from its tip. */
export function wallRadius(s, d, toyR, aperture = 0, scale = 1, lumen = null) {
  let r = lumen ? lumen(s) : restRadius(s, scale);
  if (s >= 0 && s <= d) r = Math.max(r, toyR(d - s) * 1.08 + 1);
  return s < 8 ? Math.max(r, aperture) : r;
}
