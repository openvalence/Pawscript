// figure.js -- the body figure of the Groups picker (paw-h8c, BodyFigure.svelte): a front-facing anthro, divided into
// click targets like a rig picker, one per groups.js part. paw-5r1: the stored side is the CHARACTER's own left / right, and the
// figure faces the viewer, so the character's L limbs are on the viewer's RIGHT (as a person facing you); the figure says so
// ("their L" / "their R" under it) and every side letter on it is the character's. A limb is a chain: shoulder (the upper arm) -
// forearm - hand, thighs - shin - paws.
// The genitals are not drawn on the crotch: they are the chip row under the figure (GENITALS), body / other a second
// row (EXTRA). Pure data (SVG path strings, viewBox units = px at the picker's size): test/groups-figure.test.mjs.
import { PICK_PARTS, PAIRED } from './groups.js';
import { furryOn, PARTS_OFF } from '../../lib/content.js';

const ell = (cx, cy, rx, ry = rx) => `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
export const VIEW = [236, 190];   // paw-cnfg: room for 28 px targets under the hips; paw-5r1: +28 for the shins
// x -> 236 - x on every number pair of a path (the figure's other side)
const flip = (d) => d.replace(/(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g, (_, x, y) => `${+(236 - x).toFixed(2)} ${y}`);
const LEG = 'M100 94L116 94L113 172L101 172Z';
const EAR = 'M106.5 15.5L102 2Q101.8 0.2 103.6 0.9L114.5 8.5Z', EAR_IN = 'M106.5 11.5L104.4 4.8L110.6 9.1Z';
const MUZZLE = ell(118, 27.5, 7.5, 5.5), NOSE = ell(118, 25, 2.2, 1.5);
// the silhouette between the parts (neck, arms, legs): drawn, not a part (no click)
export const LIMBS = ['M112 31L124 31L125.5 42L110.5 42Z', LEG, flip(LEG)];
// the character's right limbs (the viewer's left); lbl = where the side letter sits
const LIMB_R = [
  { part: 'shoulder', side: 'r', d: ['M94.5 41C90 43 87.5 48 86 55L84 64.5L91 66.5L93 58C93.8 53 94.5 49 95.5 46.5Z'], lbl: [77, 57] },
  { part: 'forearm', side: 'r', d: ['M84 66L91 68L83 101L75.5 99Z'], lbl: [69, 88] },
  { part: 'hand', side: 'r', e: [76, 113, 11, 12], lbl: [76, 116.2] },
  { part: 'thighs', side: 'r', e: [104, 119, 13, 14.5], lbl: [104, 122.2] },
  { part: 'shin', side: 'r', e: [104.5, 148, 7.5, 12.5], lbl: [104.5, 151.2] },
  { part: 'paws', side: 'r', e: [103, 176, 14, 9], lbl: [103, 179.2] },
];
// an ellipse is drawn with relative arcs, which flip() cannot mirror: it is rebuilt at the mirrored centre instead
const limb = (r, mirror) => ({ part: r.part, side: mirror ? 'l' : 'r', lbl: mirror ? [236 - r.lbl[0], r.lbl[1]] : r.lbl,
  d: r.e ? [ell(mirror ? 236 - r.e[0] : r.e[0], r.e[1], r.e[2], r.e[3])] : mirror ? r.d.map(flip) : r.d });
// painted in this order (the tail behind); deco = drawn inside the part (same target), lbl = the side letter
export const REGIONS = [
  { part: 'tail', d: ['M136 91C146 103 166 107 180 99C192 92 199 80 197 68C196 61 190 57 186 61C189.5 69 187 80 178.5 86.5C168 94 152 93 140.5 85Z'] },
  { part: 'head', d: [EAR, flip(EAR), 'M104 20C104 11 110 7 118 7C126 7 132 11 132 20C132 24 133.5 27 135.5 30.5L130.5 30C128.5 33.5 123.5 35.5 118 35.5C112.5 35.5 107.5 33.5 105.5 30L100.5 30.5C102.5 27 104 24 104 20Z'],
    deco: [{ d: EAR_IN, k: 'muz' }, { d: flip(EAR_IN), k: 'muz' }, { d: MUZZLE, k: 'muz' }, { d: NOSE, k: 'dot' }, { d: ell(112, 18.5, 1.6), k: 'dot' }, { d: ell(124, 18.5, 1.6), k: 'dot' }] },
  { part: 'torso', d: ['M100 40C108 37.5 128 37.5 136 40C141 41.5 142 45 140.5 49C138 56 133 62 131 72L105 72C103 62 98 56 95.5 49C94 45 95 41.5 100 40Z'],
    deco: [{ d: 'M104 51Q111 57 117 53', k: 'line' }, { d: flip('M104 51Q111 57 117 53'), k: 'line' }, { d: ell(118, 64.5, 0.9), k: 'dot' }] },
  { part: 'hips', d: ['M105 75L131 75C137 78 142 84 142 90C141.5 94 137.5 97 132 97C126 97 122.5 92 118 92C113.5 92 110 97 104 97C98.5 97 94.5 94 94 90C94 84 99 78 105 75Z'] },
  // the limbs as drawn on the viewer's left = the character's RIGHT side; their L is the mirror image (LIMB_R below)
  ...LIMB_R.flatMap((r) => [limb(r, false), limb(r, true)]),
];
// paw-cnfg: the click target of each region is a rectangle [x, y, w, h] sized by how OFTEN the part is used, not by anatomy (thighs, hips,
// torso, head, hands, paws >= 28 px a side; the tail has padding too); they tile the figure without overlapping, so the nearest target wins
// by construction. The drawn shape sits inside its rectangle (the rectangle is the hover highlight: what is lit is what a click takes).
// paw-5r1: the limbs' rectangles on the viewer's left (the character's R); the L ones mirror them
const HIT_R = { shoulder: [62, 38, 32, 32], forearm: [58, 70, 34, 32], hand: [54, 102, 36, 32], thighs: [90, 104, 28, 30], shin: [90, 134, 28, 28], paws: [88, 162, 30, 28] };
const HIT = { head: [94, 0, 48, 37], torso: [94, 37, 48, 39], hips: [94, 76, 48, 28], tail: [184, 56, 32, 62],
  ...Object.fromEntries(Object.entries(HIT_R).flatMap(([p, [x, y, w, h]]) => [[p + ' r', [x, y, w, h]], [p + ' l', [236 - x - w, y, w, h]]])) };
for (const r of REGIONS) r.hit = HIT[r.part + (r.side ? ' ' + r.side : '')];
// paw-43vn: the animal-only shapes (ears, muzzle, nose) and parts (the tail) are left out with furry items off (lib/content.js)
const ANIMAL = new Set([EAR, flip(EAR), EAR_IN, flip(EAR_IN), MUZZLE, NOSE]);
const HUMAN = REGIONS.filter((r) => PARTS_OFF[r.part] !== null)
  .map((r) => ({ ...r, d: r.d.filter((d) => !ANIMAL.has(d)), deco: r.deco?.filter((x) => !ANIMAL.has(x.d)) }));
/** The regions the figure draws now: all of them, or the human figure (no tail, ears or muzzle) with furry items off. */
export const figureRegions = () => (furryOn() ? REGIONS : HUMAN);
/** Which way the figure is seen (paw-5r1): it faces the viewer, so the character's L is on the viewer's right. Captions under it. */
export const SIDE_CAPTION = [{ side: 'r', x: 40, y: 182, text: 'their R' }, { side: 'l', x: 196, y: 182, text: 'their L' }];
/** Every figure target's click rectangle: [{part, side, x, y, w, h}] in viewBox px (= px at the picker's size). */
export const hitLayout = () => REGIONS.map((r) => ({ part: r.part, side: r.side || null, x: r.hit[0], y: r.hit[1], w: r.hit[2], h: r.hit[3] }));
/** The target a click at (x, y) takes: the rectangle holding it, else the nearest one (the gaps between them). */
export function hitAt(x, y) {
  let best = null, bd = Infinity;
  for (const t of hitLayout()) { const d = Math.hypot(Math.max(t.x - x, 0, x - t.x - t.w), Math.max(t.y - y, 0, y - t.y - t.h)); if (d < bd) { bd = d; best = t; } }
  return best;
}
export const GENITALS = ['penis', 'balls', 'sheath', 'slit', 'anus'];   // paw-njnf: no knot: it is a section painted on the penis (K)   // the most used first (penis, balls)
export const EXTRA = ['body', 'other'];
/** Parts with no place on the silhouette (a tongue, bulges under the skin): a second chip row (paw-714j). */
export const FEATURES = ['tongue', 'stomachbulge', 'neckbulge'];
/** What each target is called (the picker's tooltips and filter): side letters as the stored side (the character's own). */
export const sideOf = (part, side) => (PAIRED.includes(part) ? side || 'l' : null);
export const keyOf = (part, side) => part + (sideOf(part, side) || '');
/** Every part / side the figure and its chip rows offer, in groups.js order (the reachability test). */
export const TARGETS = PICK_PARTS.flatMap((p) => (PAIRED.includes(p) ? ['l', 'r'].map((s) => ({ part: p, side: s })) : [{ part: p, side: null }]));
