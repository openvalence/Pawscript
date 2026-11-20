// Colours shared by the panel, lane and overlay: theme tokens (series palette), never hex. CSS uses them as is;
// a canvas resolves them with paint() at paint time, so a theme switch applies on the next repaint.
import { splitName } from './groups.js';
export const SPAN_COLOR = { active: 'var(--series-green)', idle: 'var(--series-grey)', carry: 'var(--series-blue)', climax: 'var(--series-vermilion)', orgasm: 'var(--series-pink)' };
export const KIND_COLOR = { ...SPAN_COLOR, still: 'var(--series-yellow)' };   // run event bands
export const LIVE_COLOR = 'var(--tx-hi)';
export const TAG_COLOR = 'var(--series-violet)';
/** 'var(--x)' -> the token's current literal value (canvas needs literals); anything else unchanged. */
export function paint(c) {
  const m = /^var\((--[\w-]+)\)$/.exec(c || '');
  if (!m || typeof document === 'undefined') return c;
  let v = painted.get(m[1]);
  if (v === undefined && (v = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim())) painted.set(m[1], v);   // unresolved (styles not loaded yet): asked again
  return v || c;
}
// paw-bz1t: the tokens read once per theme (the tracker view asked ~20 a frame: style recalcs during playback)
const painted = new Map();
if (typeof MutationObserver === 'function' && typeof document !== 'undefined') new MutationObserver(() => painted.clear()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-density', 'style', 'class'] });
export const AXIS_COLOR = 'var(--series-orange)';   // the stroke axis arrow
/** Point-tracker motion groups (overlay pts[i][3]): g1..g4, then static (0); unassigned (-1) draws faint grey. */
export const GROUP_COLORS = ['var(--series-sky)', 'var(--series-orange)', 'var(--series-green)', 'var(--series-pink)'];
export const STATIC_COLOR = 'var(--series-grey)';
export const PAIR_COLOR = 'var(--tx-mut)';   // pair_proj trace in the lane (dashed)
export const INK_COLOR = 'var(--tx-hi)';    // blobs view: labels, readouts, hovered point
export const GRID_COLOR = 'var(--tx)';      // blobs view: the camera reference grid
/** A part of body g (1..4; PROTOCOL v3.4 parts g{k}p{j}): its body's colour, lighter. CSS form (chips). */
export const partColor = (g) => `color-mix(in srgb, ${GROUP_COLORS[g - 1]} 55%, white)`;
/** The canvas twin: a resolved '#rrggbb' mixed 45 % toward white; anything else unchanged. */
export function lighter(hex, f = 0.45) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16), c = (s) => Math.round(((n >> s) & 255) * (1 - f) + 255 * f);
  return `rgb(${c(16)}, ${c(8)}, ${c(0)})`;
}
/** Pinned semantic groups (PROTOCOL v4.6, sem_<name>_*, pts[i][5] = 1 penis, 2 balls, 3 hips): fixed colours of their
 *  own, hips the body-ish accent, balls / penis lighter. CSS form (chips); semPaint is the canvas twin. */
export const SEM_NAMES = ['penis', 'balls', 'hips'];
const SEM_BASE = { penis: 'var(--series-vermilion)', balls: 'var(--series-yellow)', hips: 'var(--series-violet)' };
// v4.11 user groups (groups.js names; 'tail2' = a second tail): any other name gets a series colour of its own
const USER_BASE = { knot: 'var(--series-yellow)', thighs: 'var(--series-violet)', tongue: 'var(--series-pink)', stomachbulge: 'var(--series-lime)', neckbulge: 'var(--series-green)', hand: 'var(--series-blue)', head: 'var(--series-sky)', tail: 'var(--series-green)', torso: 'var(--series-orange)',
  paws: 'var(--series-pink)', body: 'var(--series-grey)', other: 'var(--series-lime)', ignore: 'var(--series-grey)' };
const FREE = ['var(--series-lime)', 'var(--series-blue)', 'var(--series-green)', 'var(--series-pink)', 'var(--series-orange)'];
const baseOf = (s) => { const n = String(s || '').replace(/\d+$/, ''); return SEM_BASE[n] || USER_BASE[n] || FREE[[...n].reduce((h, c) => h + c.charCodeAt(0), 0) % FREE.length]; };
// ---- the part palette (paw-kqpn): ONE continuous map from where a part sits on the body to its colour, OKLCH ----
// character = hue family (Bottom blue, Top orange, Extra green). Every part has a place on a schematic body, POS = [u, v]: u = side to side
// (-1 = stored side 'l', the character's own left (paw-5r1), 0 the midline, +1 their right), v = up / down from the crotch (0 the crotch,
// + up, - down); the picker's figure (figure.js) has the same up / down layout (it faces the viewer, so their L is drawn on the right: the
// colours are the body's, not the picture's). A limb is a chain of related shades: shoulder - forearm - hand, thighs - shin - paws (paw-5r1).
// Side: the hue leans away from the family's centre in proportion to u (L toward the warm end
// of the family, R toward the cool end: HUE_SPAN deg at u = +-1) and L is a touch lighter. Up / down: the crotch is the anchor (L 0.67, the
// most saturated); going up the colour gets steadily lighter (toward a pale tint at the head), going down deeper (toward a rich shade at the
// paws, never under L_FLOOR so it still reads on the dark lane); chroma eases off with |v| (less going up: the pale end keeps some colour).
// The crotch cluster (penis, knot, sheath, balls, anus, slit, tail: painted on top of one another, the parts that matter most) is spread
// over a small lattice of the same two gradients (side columns, up / down rows) and gets ONE cue of its own: the parts painted on top of
// one another alternate full (shaft, knot, tail) and muted chroma (balls, sheath, slit, anus: CROTCH_C), so every overlapping pair there
// differs by at least MIN_DE_CROTCH (OKLab; 0.010 before).
export const FAMILY = { c1: { h: 255, warm: 1, dl: 0 }, c2: { h: 50, warm: -1, dl: -0.02 }, x: { h: 145, warm: -1, dl: 0.06 } };   // base hue (deg), the warm direction
export const HUE_SPAN = 40, SIDE_L = 0.055;   // deg of hue at |u| = 1; L is SIDE_L * |u| lighter than R
export const L_FLOOR = 0.55;   // the darkest any part gets (dark lane); L_CROTCH the anchor; going up L rises UP_L per unit v, going down it falls DOWN_L
export const L_CEIL = 0.93;   // the palest (outlines on a light picture)
export const L_CROTCH = 0.67, UP_L = 0.24, DOWN_L = 0.11, C_MAX = 0.19, C_EASE = 0.3, C_EASE_UP = 0.15;
export const MIN_DE = 0.03, MIN_DE_SIDE = 0.08, MIN_DE_CROTCH = 0.075;   // OKLab distance: neighbouring parts / the L and R of one part / overlapping crotch parts (tests/part-colors)
export const POS = {   // [u, v]: the part's place; paired parts take +-u by side (hand out at torso height, paws below the thighs)
  penis: [0, 0.1], sheath: [-0.5, 0.35], slit: [0.5, 0.35], knot: [0.35, -0.2], balls: [-0.35, -0.2], anus: [0.5, -0.65], tail: [0, -0.65],   // the crotch lattice (knot / balls inside the thighs' columns)
  hips: [0, 0.42], thighs: [0.5, -0.38],
  torso: [0, 0.72], stomachbulge: [0.2, 0.6], neckbulge: [-0.5, 0.78], body: [-0.5, 0.5],
  hand: [1, 0.5], head: [0, 1.05], paws: [0.7, -1], tongue: [0.5, 0.95], other: [0, 0.4],
  shoulder: [1.15, 0.9], forearm: [0.85, 0.75], shin: [1.15, -0.4],   // paw-5r1: the limb chains, between their neighbours up / down; u picked so every step and L / R stays apart (part-colors test)
};
export const CROTCH_C = { balls: 0.5, sheath: 0.5, slit: 0.5, anus: 0.5 };   // the crotch's own cue: muted chroma on the parts under / around the full ones (shaft, knot, tail)
const REP_L = 0.04;   // a repeat (thighs_r2) is its first, this much lighter per repeat (at most 3)
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gam = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
/** '#rrggbb' -> OKLab [L, a, b]. */
export function oklab(hexStr) {
  const n = parseInt(String(hexStr).slice(1), 16), r = lin(((n >> 16) & 255) / 255), g = lin(((n >> 8) & 255) / 255), b = lin((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export const deltaE = (a, b) => { const p = oklab(a), q = oklab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
const rgbOf = (L, C, h) => {   // OKLCH -> linear sRGB (unclamped)
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
};
/** OKLCH -> '#rrggbb', the chroma lowered until it fits sRGB (hue and lightness kept). */
export function oklch(L, C, h) {
  let c = C, v = rgbOf(L, c, h);
  for (let i = 0; i < 40 && v.some((x) => x < -0.0005 || x > 1.0005); i++) { c *= 0.94; v = rgbOf(L, c, h); }
  return '#' + v.map((x) => Math.round(255 * gam(Math.min(1, Math.max(0, x)))).toString(16).padStart(2, '0')).join('');
}
/** The colour of who_part_side (repeat: its digits): '#rrggbb'. The only place the scheme is computed. */
export function partHex({ who, part, side, rep = 1 }) {
  const f = FAMILY[who] || FAMILY.c1, [pu, v] = POS[part] || POS.other, u = side === 'l' ? -Math.abs(pu) : side === 'r' ? Math.abs(pu) : pu;
  const h = f.h - f.warm * HUE_SPAN * u, d = Math.min(1.2, Math.abs(v));
  const L = Math.min(L_CEIL, Math.max(L_FLOOR, L_CROTCH + f.dl + (v > 0 ? UP_L : DOWN_L) * v - SIDE_L * u)) + REP_L * Math.min(3, Math.max(0, rep - 1));
  return oklch(L, C_MAX * (1 - (v > 0 ? C_EASE_UP : C_EASE) * Math.min(1, d)) * (CROTCH_C[part] ?? 1), h);
}
const repOf = (s) => +(/(\d+)$/.exec(String(s || ''))?.[1] || 1);
const whoHex = (s) => { const q = splitName(s); return q.who ? partHex({ who: q.who, part: q.part, side: q.side, rep: repOf(s) }) : null; };
export const WHO_BASE = { c1: oklch(0.72 + FAMILY.c1.dl, 0.15, FAMILY.c1.h), c2: oklch(0.72 + FAMILY.c2.dl, 0.15, FAMILY.c2.h), x: oklch(0.72 + FAMILY.x.dl, 0.15, FAMILY.x.h) };
// groups painted before they were assigned (groups.js isUnassigned): neutral, so an assignment visibly colours them
const UNASSIGNED = /^unassigned_\d+$/, UNASSIGNED_COLOR = 'var(--tx)';
/** A character's own colour (its centre, its chips). CSS form; whoPaint is the canvas twin. */
export const whoColor = (w) => WHO_BASE[w] || 'var(--tx)';
export const whoPaint = (w) => paint(whoColor(w));
export const semColor = (s) => whoHex(s) || (s === 'hips' ? SEM_BASE.hips : `color-mix(in srgb, ${baseOf(s)} 60%, white)`);
export const semPaint = (s) => whoHex(s) || (s === 'hips' ? paint(SEM_BASE.hips) : lighter(paint(baseOf(s)), 0.4));
/** A drawn group's colour (Groups tool): a character's part: partHex; other names their series colour; CSS form, groupPaint is the canvas twin. */
export const groupColor = (s) => { if (UNASSIGNED.test(s || '')) return UNASSIGNED_COLOR; return whoHex(s) || baseOf(s); };
export const groupPaint = (s) => { if (UNASSIGNED.test(s || '')) return paint(UNASSIGNED_COLOR); return whoHex(s) || paint(baseOf(s)); };
/** paw-njnf: a penis group's knot section: the penis' colour, darker (same hue: it is a section of that part, not a part of its own). */
export const knotPaint = (s) => { const c = groupPaint(s); if (!/^#[0-9a-f]{6}$/i.test(c)) return c; const [L, a, b] = oklab(c); return oklch(Math.max(0.25, L - 0.22), Math.hypot(a, b), (Math.atan2(b, a) * 180) / Math.PI); };
