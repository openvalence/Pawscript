// group-look.js -- how a painted part looks in the Groups tool (paw-c1m1), pure (test/group-look.test.mjs). The owner: "a hatched
// texture leading to the next limb is what makes it readable ... the labels get in the way when painting: make them better /
// redundant". A look only: nothing here is stored or sent to the tracker.
//   fill style (setting tracking.groups.fill): dither (default, DITHER below) | hatch | gradient (the soft tint as before) | flat (an
//          even tint, hard edge); in every style a measured part carries a ruler along its long edge, a spurt-cue part dotted rings
//   hatch: fine lines inside each mask along the part's own axis, its sense from the body outward along the limb chain
//          (PARENT: torso -> shoulder -> forearm -> hand, hips -> thighs -> shin -> paws, torso -> head, hips -> tail ...); the
//          pattern by place in the chain (STYLE) so neighbours differ at a glance even where colours are close; the character's
//          L limbs dashed, R and midline solid (one rule everywhere)
//   the name inside its mask (maskStats' spot: the widest interior spot, along the long axis, never upside down; fitLabel: full name,
//          else the short tag, else none: the brush's own label names the part under it). Drawn, never a hit target.
import { splitName, isUnassigned, isIgnore } from './groups.js';
import { oklab, oklch } from './colors.js';

/** The label's ink: a pale tone of the group's own colour (the fill is mid-light; a dark halo keeps it off the footage). */
export function labelTone(c) {
  if (!/^#[0-9a-f]{6}$/i.test(c || '')) return '#eef1f5';
  const [, a, b] = oklab(c);
  return oklch(0.95, Math.min(0.05, Math.hypot(a, b)), (Math.atan2(b, a) * 180) / Math.PI);
}

export const FILL_STYLES = ['dither', 'hatch', 'gradient', 'flat'];
export const FILL_NAMES = { dither: 'Dither', hatch: 'Hatch', gradient: 'Gradient', flat: 'Flat' };
export const nextFill = (s) => FILL_STYLES[(FILL_STYLES.indexOf(s) + 1) % FILL_STYLES.length];

/** The part each part hangs from (its joint toward the body); hips is the root. */
export const PARENT = { torso: 'hips', shoulder: 'torso', forearm: 'shoulder', hand: 'forearm', thighs: 'hips', shin: 'thighs', paws: 'shin', head: 'torso',
  tail: 'hips', penis: 'hips', sheath: 'hips', balls: 'hips', slit: 'hips', anus: 'hips', knot: 'penis', tongue: 'head', neckbulge: 'torso', stomachbulge: 'torso' };
const BODY = ['hips', 'torso', 'body'];
// the pattern by place in the chain: spacing / line width in stage px, cross = a second set of lines across
export const STYLES = {
  sparse: { spacing: 11, width: 1 },               // the torso: the big body part, quiet
  grid: { spacing: 11, width: 1, cross: true },    // the hips: the root, sparse cross-hatch
  wide: { spacing: 7, width: 2.6 },                // first segment: shoulder, thighs, head, tail, penis
  fine: { spacing: 4.5, width: 1 },                // second segment: forearm, shin, knot, tongue, stomach bulge
  cross: { spacing: 6, width: 1.2, cross: true },  // the extremity: hand, paws
  dots: { spacing: 5, width: 1.2, dots: true },    // the parts round the crotch under the shaft (balls, sheath, slit, anus) and the neck bulge
};
const STYLE_OF = { torso: 'sparse', body: 'sparse', hips: 'grid', shoulder: 'wide', thighs: 'wide', head: 'wide', tail: 'wide', penis: 'wide',
  forearm: 'fine', shin: 'fine', knot: 'fine', tongue: 'fine', stomachbulge: 'fine', hand: 'cross', paws: 'cross',
  balls: 'dots', sheath: 'dots', slit: 'dots', anus: 'dots', neckbulge: 'dots' };
export const DASH = [6, 3];   // the character's L side: dashed lines (R and midline parts solid)

/** A group name's hatch: {key, style, spacing, width, cross?, dots?, dash (L side)} or null (unassigned, ignore, other: no hatch). */
export function hatchOf(name) {
  if (!name || isUnassigned(name) || isIgnore(name)) return null;
  const { part, side } = splitName(name), style = STYLE_OF[part];
  if (!style) return null;
  const dash = side === 'l' && !STYLES[style].dots;
  return { key: style + (dash ? '-l' : ''), style, ...STYLES[style], dash };
}

// paw-c1m1 (owner: "like what is used for cheap alpha blend, almost a loud dither ... to build the gradient"): Dither, the default.
// One square grid, ONE cell size for every part (owner 2026-11-19; setting tracking.groups.ditherCell, css px, scaled by DPI,
// never by zoom), 1-bit per cell in the group's colour (empty cells clear:
// the footage shows), coverage by an ordered Bayer 4 x 4 threshold ramping from `hi` at the body end of the part (solid) through
// a checkerboard to `lo` (sparse dots) toward the next limb (chainDirs' sense); the character's L side: the Bayer matrix mirrored (its mid-tone diagonals lean the
// other way), the same one rule as the hatch's L dashes.
export const DITHER = {
  sparse: { hi: 0.8, lo: 0.15 }, grid: { hi: 1, lo: 0.3 }, wide: { hi: 1, lo: 0.12 },
  fine: { hi: 1, lo: 0.12 }, cross: { hi: 0.9, lo: 0.2 }, dots: { hi: 0.65, lo: 0.25 },
};
export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** A group name's dither: {key, style, hi, lo, mirror (L side)} or null (unassigned, ignore, other: the plain tint). */
export function ditherOf(name) {
  const h = hatchOf(name);
  if (!h) return null;
  const mirror = splitName(name).side === 'l';
  return { key: h.style + (mirror ? '-l' : ''), style: h.style, ...DITHER[h.style], mirror };
}
/** The cell geometry in device px from the settings: pitch (the one cell size, css px x DPI, at least 2) and the dot, its
 *  share of the pitch (at least 1 px), centred in the cell. -> {cd, s, off}. */
export function ditherGeom(cell = 4, dotPct = 100, dpr = 1) {
  const cd = Math.max(2, Math.round(cell * dpr)), s = Math.min(cd, Math.max(1, Math.round(cd * (dotPct / 100))));
  return { cd, s, off: Math.floor((cd - s) / 2) };
}
/** Is cell (i, j) on at coverage c (0..1)? The ordered threshold; mirror: the matrix flipped left / right. */
export const ditherOn = (i, j, c, mirror = false) => c > (BAYER4[(((j % 4) + 4) % 4) * 4 + (mirror ? 3 - (((i % 4) + 4) % 4) : ((i % 4) + 4) % 4)] + 0.5) / 16;

/** The busy mark (SAM is finding the part): a disc of n x n ordered-dither cells centred on (0, 0), `cell` px each. Each cell's
 *  threshold t (0..1) is mostly its distance from the centre, plus the Bayer value; it is on while the pulse phase p > t, so cells
 *  appear from the centre out and dissolve back. -> [{x, y, t}] (cell top-left corner). */
export function busyCells(n = 8, cell = 4) {
  const out = [], R = n / 2;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const d = Math.hypot(i + 0.5 - R, j + 0.5 - R) / R;
    if (d > 1) continue;
    out.push({ x: (i - R) * cell, y: (j - R) * cell, t: +(0.6 * d + 0.4 * (BAYER4[(j % 4) * 4 + (i % 4)] + 0.5) / 16).toFixed(3) });
  }
  return out;
}

// An unassigned part's dither shimmers (slow soft swells) and a part just named fills in (the grow): both move the dither's
// coverage per cell, so dots switch on and off (binary, the part's own colour and alpha) on their anchored grid. Never under
// prefers-reduced-motion (GroupsOverlay checks).
export const CAUSTIC = { period: 9000, amp: 0.18, hyst: 0.012 };   // ms per cycle; coverage added at a swell's top; the per-cell hysteresis
/** The swells over cells i0..i0+nw-1 x j0..j0+nh-1 (indices from the part's grid anchor) at t ms, into out (row-major, -1..1,
 *  averaging 0): two broad warped sine fields (60 to 100 cells a wave) drifting against each other, each warp a function of
 *  one axis only (two sines per cell). Changes at most about 0.0009 per ms: keep CAUSTIC.hyst above amp x that x a frame / 2. -> out. */
export function causticField(i0, j0, nw, nh, t, out = new Float32Array(nw * nh)) {
  const w = (2 * Math.PI * t) / CAUSTIC.period, col = new Float32Array(nw);
  for (let i = 0; i < nw; i++) col[i] = 0.9 * Math.sin(0.07 * (i0 + i) - 0.4 * w) - 0.8 * w;
  for (let j = 0, k = 0; j < nh; j++) {
    const J = j0 + j, row = 0.9 * Math.sin(0.06 * J + 0.5 * w) + w;
    for (let i = 0; i < nw; i++, k++) out[k] = (Math.sin(0.09 * (i0 + i) + row) + Math.sin(0.08 * J + col[i])) / 2;
  }
  return out;
}
export const GROW = { ms: 750, amp: 0.75, fill: 0.55 };   // total ms; coverage added inside the disc; share of ms the disc takes to reach the edge
/** The fill-in when a part is named, at d cells from its middle, t ms after, rmax its farthest cell -> 0..1: a disc from the middle
 *  grows to past the edge (soft front, at least 2 cells, 12 % of rmax; easing out) over GROW.fill of the time, everything behind
 *  the front held at 1, then the whole of it fades back to 0. Never falls at a cell while the disc grows; 0 before and after. */
export function growAt(d, t, rmax) {
  const u = t / GROW.ms;
  if (!(u >= 0 && u < 1)) return 0;
  const soft = Math.max(2, 0.12 * rmax), g = Math.min(1, u / GROW.fill), R = (1 - (1 - g) ** 2) * (rmax + soft);
  const front = Math.min(1, Math.max(0, (R - d) / soft)), fade = u <= GROW.fill ? 1 : 1 - (u - GROW.fill) / (1 - GROW.fill);
  return front * front * (3 - 2 * front) * fade * fade * (3 - 2 * fade);
}
/** Is cell (i, j) on at static coverage c with the swell f there (0: none) and the grow s (0..1)? ditherOn on the moved coverage; was
 *  (the cell's last state, null: none) holds it within CAUSTIC.hyst of its threshold, so a slow field never blinks a cell for a frame. */
export function shimmerOn(i, j, c, f, s = 0, mirror = false, was = null) {
  const v = c + CAUSTIC.amp * f + GROW.amp * s;
  if (was == null) return ditherOn(i, j, v, mirror);
  if (ditherOn(i, j, v - CAUSTIC.hyst, mirror)) return true;
  return ditherOn(i, j, v + CAUSTIC.hyst, mirror) ? !!was : false;
}

/** One pass over a mask ({w, h, a}): weighted centroid, principal axis, the box, and the label spot. Mask px. -> {n (px >= 0.5),
 *  cx, cy, ax, ay (unit long axis), elong (sqrt of the eigenvalue ratio), x0, y0, x1, y1, spot: {x, y, r (inscribed radius),
 *  along (room along the axis through the spot)}} or {n: 0}. */
export function maskStats(m) {
  const { w, h, a } = m, n = w * h, ins = new Uint8Array(n);
  let c = 0, sx = 0, sy = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) if (a[i] >= 0.5) { ins[i] = 1; c++; sx += x; sy += y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (!c) return { n: 0 };
  const cx = sx / c, cy = sy / c;
  let xx = 0, yy = 0, xy = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (ins[y * w + x]) { const dx = x - cx, dy = y - cy; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
  const tr = (xx + yy) / 2, det = Math.sqrt(Math.max(0, ((xx - yy) / 2) ** 2 + xy * xy)), l1 = tr + det, l2 = Math.max(1e-9, tr - det);
  let ang = 0.5 * Math.atan2(2 * xy, xx - yy), ax = Math.cos(ang), ay = Math.sin(ang);
  if (ax < 0 || (ax === 0 && ay < 0)) { ax = -ax; ay = -ay; }   // a canonical sense (right, else down); chainDirs turns it outward
  let ta = Infinity, tb = -Infinity, na = Infinity, nb = -Infinity;   // the extent along the axis / across it, from the centroid (the ruler's place)
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (ins[y * w + x]) { const dx = x - cx, dy = y - cy, t = dx * ax + dy * ay, q = -dx * ay + dy * ax; if (t < ta) ta = t; if (t > tb) tb = t; if (q < na) na = q; if (q > nb) nb = q; }
  // distance to the nearest outside px (the frame's edge counts as outside): two chamfer passes, 1 / sqrt 2, inside the box only
  const bw = x1 - x0 + 3, bh = y1 - y0 + 3, d = new Float32Array(bw * bh), S = Math.SQRT2;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const X = x + x0 - 1, Y = y + y0 - 1; d[y * bw + x] = X >= 0 && Y >= 0 && X < w && Y < h && ins[Y * w + X] ? 1e9 : 0; }
  for (let y = 1; y < bh - 1; y++) for (let x = 1; x < bw - 1; x++) { const i = y * bw + x; if (d[i]) d[i] = Math.min(d[i], d[i - 1] + 1, d[i - bw] + 1, d[i - bw - 1] + S, d[i - bw + 1] + S); }
  let dm = 0;
  for (let y = bh - 2; y > 0; y--) for (let x = bw - 2; x > 0; x--) { const i = y * bw + x; if (d[i]) { d[i] = Math.min(d[i], d[i + 1] + 1, d[i + bw] + 1, d[i + bw + 1] + S, d[i + bw - 1] + S); if (d[i] > dm) dm = d[i]; } }
  // the spot: among the px within 1 of the widest, the one nearest the centroid (a small edit elsewhere moves it little), first in scan order on a tie
  let bx = 0, by = 0, best = Infinity;
  for (let y = 1; y < bh - 1; y++) for (let x = 1; x < bw - 1; x++) {
    if (d[y * bw + x] < dm - 1) continue;
    const X = x + x0 - 1, Y = y + y0 - 1, q = (X - cx) ** 2 + (Y - cy) ** 2;
    if (q < best) { best = q; bx = X; by = Y; }
  }
  const r = d[(by - y0 + 1) * bw + (bx - x0 + 1)];
  // room along the axis: the shortest of three runs (the centre line and two lines r / 2 to either side) through the spot
  const inAt = (x, y) => { const X = Math.floor(x + 0.5), Y = Math.floor(y + 0.5); return X >= 0 && Y >= 0 && X < w && Y < h && ins[Y * w + X] === 1; };
  const run = (ox, oy) => { let L = 0; for (const s of [1, -1]) { let t = 0.5; while (t < w + h && inAt(bx + ox + s * t * ax, by + oy + s * t * ay)) t += 0.5; L += t - 0.5; } return L; };
  const o = r / 2, along = Math.min(run(0, 0), run(-ay * o, ax * o), run(ay * o, -ax * o));
  return { n: c, cx, cy, ax, ay, elong: Math.sqrt(l1 / l2), x0, y0, x1, y1, ta, tb, na, nb, spot: { x: bx, y: by, r, along } };
}

const ELONG = 1.5;   // longer than this x its width: the part's own axis is its direction; rounder: the chain's vector
/** The hatch direction of each painted part. items: [{name, st (maskStats)}]. -> [{ux, uy (unit, mask px), ramp (the sense is
 *  known: the hatch fades from the joint outward)}]: the part's long axis turned to point away from the part it hangs from
 *  (PARENT, walking up while a link is not painted; paired parts: the same side), else from the character's body centre (its
 *  other hips / torso), else the long axis as it is (no ramp). */
export function chainDirs(items) {
  const info = items.map((it) => ({ ...splitName(it.name), st: it.st }));
  const find = (who, part, side, self) => info.findIndex((q, j) => j !== self && q.st?.n && q.who === who && q.part === part && (!side || !q.side || q.side === side));
  return info.map((q, i) => {
    const st = q.st;
    if (!st?.n) return null;
    let anc = -1;
    if (q.who) for (let p = PARENT[q.part]; p && anc < 0; p = PARENT[p]) anc = find(q.who, p, q.side, i);
    // the sense: from the anchor (the part it hangs from, else the body centre) to the parts hanging from it (their mean), else
    // to itself. Both ends: a centroid alone misleads where a limb lies alongside its parent (an arm hanging by the torso)
    let ox = st.cx, oy = st.cy, tx = st.cx, ty = st.cy, known = false;
    if (anc >= 0) { ox = info[anc].st.cx; oy = info[anc].st.cy; known = true; }
    else if (q.who) {   // the body centre: the character's other body parts
      let n = 0, bx = 0, by = 0;
      info.forEach((o, j) => { if (j !== i && o.st?.n && o.who === q.who && BODY.includes(o.part)) { bx += o.st.cx * o.st.n; by += o.st.cy * o.st.n; n += o.st.n; } });
      if (n) { ox = bx / n; oy = by / n; known = true; }
    }
    if (q.who) {
      let n = 0, sx = 0, sy = 0;
      info.forEach((o, j) => { if (j !== i && o.st?.n && o.who === q.who && PARENT[o.part] === q.part && (!q.side || !o.side || o.side === q.side)) { sx += o.st.cx; sy += o.st.cy; n++; } });
      if (n) { tx = sx / n; ty = sy / n; known = true; }
    }
    const vx = known ? tx - ox : 0, vy = known ? ty - oy : 0;
    const L = Math.hypot(vx, vy), has = L > 1;
    if (st.elong < ELONG && has) return { ux: vx / L, uy: vy / L, ramp: true };
    const s = has && st.ax * vx + st.ay * vy < 0 ? -1 : 1;
    return { ux: s * st.ax, uy: s * st.ay, ramp: has };
  });
}

/** An angle (rad) a text can be read at: in (-pi / 2, pi / 2] (never upside down). */
export function readable(ang) {
  let a = ang % Math.PI;
  if (a > Math.PI / 2) a -= Math.PI;
  else if (a <= -Math.PI / 2) a += Math.PI;
  return a;
}

/** The label that fits: room {along, thick} (stage px), the full name and the short tag, measure(text, px) -> width at that font
 *  size. Tries the full name from 12 down to 9 px (tagOnly: not at all), then the tag from 11 down to 8 px. -> {text, px, full} or
 *  null (nothing fits). */
export function fitLabel(room, full, tag, measure, { tagOnly = false } = {}) {
  const tries = [...(tagOnly ? [] : [12, 11, 10, 9].map((px) => ({ text: full, px, full: true }))), ...[11, 10, 9, 8].map((px) => ({ text: tag, px, full: false }))];
  for (const t of tries) if (t.text && t.px * 1.25 <= room.thick && measure(t.text, t.px) + 4 <= room.along) return t;
  return null;
}
