// groups.js -- the Groups tool's pure side (paw-kkb; sidecar PROTOCOL v4.11 `suggest_groups`, `track.groups`). The owner
// paints one soft mask per group on the scene's seed frame; a polygon is fitted to each mask as it is painted, and the
// polygon is what Track sends. Pure (no DOM): test/tracking-groups.test.mjs.
//
//   scene.groups = [{name, poly: [[x, y], ...] (0..1 frame), pinned, t_ms, off?, score?, source?, mask: {w, h, rle},
//                    who?, part?, side?}]
//     pulse  (paw-ol3) a pulse part's flag when it differs from the default (anus on; balls / sheath / penis off)
//     shaft  (paw-azd) a penis group's depth flag when it differs from the default (on in a scene tagged penetration
//            with a where, else off): Track measures how much of it is inside (SAM of the visible shaft)
//     who    c1 | c2 | x (Bottom | Top | Extra; paw-emy, paw-uzzr, PROTOCOL v4.12): the character; part = a PARTS name; side = l | r for PAIRED parts
//            (paw-5r1: the character's own left / right);
//            name is then derived: who_part_side ('c1_penis', 'c2_hand_l', 'c1_tail2' for a repeat). No who: v4.11 as is.
//     name   penis | balls | hips | hand | head | tail | torso | paws | body | other (body = unpinned: a seed hull whose
//            points join the motion clustering); t_ms = the frame it was painted on (the tracker seeds that scene there)
//     off    a suggestion toggled off: kept, drawn faint, not sent
//     mask   the soft brush mask at MASK_W x (MASK_W / aspect), 16 levels, run-length coded: [level, run, level, run, ...]
//     source user | seeder | tagger | sam (Suggest) | repeat (paw-8mf4: copied unchanged from an exact repeat of a painted
//            frame) | run (paw-8mf4: rebuilt from a stored run's seeded points on an exact repeat); copies carry `from`
//            (the source frame, ms) and are not training labels (paintedKey, seeder.py); any edit of the take makes them
//            'user' (groups.svelte.js #put)
//     points (paw-8mf4, PROTOCOL v4.21) a run-derived group's seed points [[x, y], ...] (0..1 frame): Track seeds exactly
//            these; mask / poly are their footprint (discs around them) for drawing and old sidecars; a reshape drops them
//     erased (paw-yx6q) {w, h, rle}: what the owner erased from it on its frame; every later result is cut by it until a paint
//            stroke of the group goes over it (erasedOf / nextErased / clipErased); Track sends it as `erased` outlines (v4.53)
//     knot   (paw-njnf) {w, h, rle} on a penis group: its knot section (the knot brush, inside its mask); Track sends it as `knot` (v4.54)
//     unassigned_1, unassigned_2, ... (paw-1mo): painted first, assigned later (no who / part yet): saved, drawn neutral,
//            never sent to Track (trackGroups skips them; unassignedIn counts them for the warning)

import { sceneRange, takeRange } from '../timeline/shots.js';
import { hasTag, sceneWheres } from '../timeline/acts.js';
import { contours } from './snap.js';
import { partName, partShown } from '../../lib/content.js';

export const GROUP_NAMES = ['penis', 'balls', 'hips', 'hand', 'head', 'tail', 'torso', 'paws', 'body', 'other'];
// a character's parts (the Groups tool's chips, in this order); the limbs come in pairs (L / R)
// paw-714j: knot, thighs, tongue, stomachbulge, neckbulge (ids carry no underscore: a group name is who_part_side). The sidecar's
// seeder.PARTS (seeder part head) and partlabel.PAIRED must name the same ones: test/groups-vocab.test.mjs + test_seeder.py
// paw-5r1: shoulder (the upper arm), forearm, shin (the lower leg): a limb is a chain, shoulder - forearm - hand, thighs - shin - paws
export const PARTS = ['penis', 'sheath', 'balls', 'knot', 'slit', 'anus', 'hips', 'head', 'shoulder', 'forearm', 'hand', 'thighs', 'shin', 'paws', 'tail', 'torso', 'tongue', 'stomachbulge', 'neckbulge', 'body', 'other'];
/** paw-njnf: the parts a group can be given (the picker, its chips, auto-naming): every part but the knot, a section of the penis. */
export const PICK_PARTS = PARTS.filter((p) => p !== 'knot');
/** A part as people read it ('stomachbulge' -> 'stomach bulge'; paws -> feet with furry items off: lib/content.js). */
export const PART_WORDS = { stomachbulge: 'stomach bulge', neckbulge: 'neck bulge' };
export const partWord = (p) => PART_WORDS[p] || partName(p);
// pulse parts (paw-ol3, PROTOCOL v4.16): their contractions are spurt cues (detect cumshots tracks them with SAM over the
// orgasm span); anus is one by default, balls / sheath / penis when the owner flags them (the pulse glyph)
export const PULSE_PARTS = ['anus', 'balls', 'sheath', 'penis'];
/** Is group g a pulse group? Its own `pulse` flag, else its part is anus. */
export const isPulse = (g) => (typeof g?.pulse === 'boolean' ? g.pulse : (g?.part || splitName(g?.name).part) === 'anus');
/** Can group g be a pulse group (the glyph toggles it)? */
export const canPulse = (g) => !isUnassigned(g) && PULSE_PARTS.includes(g?.part || splitName(g?.name).part);
/** Group g with its pulse flag flipped (the default kept implicit: no key when it equals the part's default). */
export function togglePulse(g) {
  const on = !isPulse(g), { pulse: _, ...r } = g, dflt = (g.part || splitName(g.name).part) === 'anus';   // eslint-disable-line no-unused-vars
  return on === dflt ? r : { ...r, pulse: on };
}
// shaft consumption (paw-azd, PROTOCOL v4.17): Track runs SAM on a penis group's visible shaft on top of the points ->
// how much is inside (lib/shaft.js); on by default for a penis in a scene tagged penetration with a where (the depth glyph)
/** Can group g carry the shaft pass (the depth glyph toggles it)? */
export const canShaft = (g) => !isUnassigned(g) && (g?.part || splitName(g?.name).part) === 'penis';
const shaftDefault = (g, scene) => canShaft(g) && !!scene && hasTag(scene, 'penetration') && sceneWheres(scene).length > 0;
/** Is group g measured for depth in `scene` (its shot)? Its own `shaft` flag, else the default. */
export const isShaft = (g, scene) => (typeof g?.shaft === 'boolean' ? g.shaft && canShaft(g) : shaftDefault(g, scene));
/** Group g with its shaft flag flipped (no key when it equals the scene's default). */
export function toggleShaft(g, scene) {
  const on = !isShaft(g, scene), { shaft: _, ...r } = g;   // eslint-disable-line no-unused-vars
  return on === shaftDefault(r, scene) ? r : { ...r, shaft: on };
}
// paw-4c48.19 (PROTOCOL v4.52): the same SAM depth measurement on any other painted part the owner turns on (a forearm on a
// fisting shot, a tail, a toy): off unless he does, remembered with the group (`depth`), applied by the next Track
/** Can group g be measured for depth with SAM (the depth glyph, a part other than the penis)? */
export const canDepth = (g) => !isUnassigned(g) && !isIgnore(g) && !canShaft(g) && !['body', 'other'].includes(g?.part || splitName(g?.name).part);
/** Is group g measured for depth (its own flag; off by default)? */
export const isDepth = (g) => g?.depth === true && canDepth(g);
/** Group g with its depth flag flipped (off = no key). */
export function toggleDepth(g) {
  const { depth: _, ...r } = g;   // eslint-disable-line no-unused-vars
  return isDepth(g) ? r : { ...r, depth: true };
}
/** paw-5r1: the parts with a side, l | r = the CHARACTER's own left / right (body side, whatever the camera shows: never the picture's
 *  half). The side is what the owner says; a proposal may only suggest one (pairSide), shown before Enter, F flips it. */
export const PAIRED = ['shoulder', 'forearm', 'hand', 'thighs', 'shin', 'paws'];
/** The side a new paired part of `who` is proposed with: `want` (default L: the owner paints the character's left first), unless that
 *  side is already painted and the other is not (the other limb then: a second hand is the R one). used: a Set of base names (no repeat digits). */
export const pairSide = (used, who, part, want = 'l') => {
  const o = want === 'l' ? 'r' : 'l';
  return used.has(groupName({ who, part, side: want })) && !used.has(groupName({ who, part, side: o })) ? o : want;
};
/** Parts that LIVE ON another part (paw-noy2: a knot is seeded on top of the penis): child part -> the parts it may overlap. ONE table
 *  for every tool (brush exclusion, magnet, circle to fill, grow, seeding points); the sidecar's partlabel.ON_PART must say the same
 *  (test/groups-vocab.test.mjs). Between any other two groups the "never into another group" rule stays. */
export const ON_PART = { knot: ['penis'], sheath: ['penis', 'hips'], tongue: ['head'], stomachbulge: ['torso', 'hips'], neckbulge: ['head', 'torso'], balls: ['hips'], thighs: ['hips'], paws: ['thighs', 'shin', 'hips'], shoulder: ['torso'], forearm: ['shoulder'], hand: ['forearm'], shin: ['thighs'] };
/** Does group `child` live on group `parent` (names or groups): the same character (or none named) and a part of the table. */
export function sitsOn(child, parent) {
  const c = splitName(typeof child === 'string' ? child : child?.name), p = splitName(typeof parent === 'string' ? parent : parent?.name);
  return !!c.part && !!p.part && (!c.who || !p.who || c.who === p.who) && (ON_PART[c.part] || []).includes(p.part);
}
/** May the two groups overlap (either lives on the other)? */
export const mayOverlap = (a, b) => sitsOn(a, b) || sitsOn(b, a) || isIgnore(a) || isIgnore(b);
/** paw-855t: an ignore region (a picture's inset crop, anything training must not learn from) is a group of its own kind in the tool: named
 *  'ignore', 'ignore2' ..., no character, never tracked, never a part. It may overlap anything (and a part painted inside one is still a label).
 *  Stored apart from the parts: a label file's `ignore: [mask]` (labelling/labels.js), in a .pawproj scene's groups by this name. */
export const IGNORE = 'ignore';
export const isIgnore = (g) => /^ignore\d*$/.test(typeof g === 'string' ? g : g?.name || '');
// The characters (paw-uzzr). The stored ids stay c1 / c2 (+ x): group names, label files, projects, run channels and the
// sidecar protocol. People read them through WHO_NAME / whoName only: c1 = Bottom (the one receiving, or the only
// character), c2 = Top (the one giving), x = Extra (anything else worth tracking). A test fails when a raw "C1" / "C2"
// is left in the UI source outside this block.
export const WHOS = ['c1', 'c2', 'x'];
export const WHO_NAME = { c1: 'Bottom', c2: 'Top', x: 'Extra' };
/** Short forms where space is tight. */
export const WHO_SHORT = { c1: 'B', c2: 'T', x: 'X' };
/** What each is for (the picker's tips). */
export const WHO_ROLE = { c1: 'the one receiving, or the only character', c2: 'the one giving', x: 'anything else worth tracking: a second penis, a third character, an object' };
/** The ids' pattern for a regexp source (group names, channels): 'c1' | 'c2' | 'x'. */
export const WHO_RE = 'c[12]|x';
/** An id as people read it ('c1' -> 'Bottom'); anything else unchanged. */
export const whoName = (w) => WHO_NAME[w] || w || '';
export const whoShort = (w) => WHO_SHORT[w] || w || '';
/** Stored text that names a character the old way ('anus (C2)', a pulse cue saved before paw-uzzr) in today's words. */
export const legacyWho = (s) => String(s ?? '').replace(/\b(C1|C2)\b/g, (m) => whoName(m.toLowerCase()));
/** The next who after `w` in Bottom, Top, Extra order (a cycle). */
export const nextWho = (w) => WHOS[(WHOS.indexOf(w) + 1) % WHOS.length];
/** {who, part, side} -> the group's name (cli.parse_groups' rule): 'c1_penis', 'c2_hand_l'; no who: the bare part. */
export const groupName = ({ who, part, side }) => (part === IGNORE ? IGNORE : [who, part || 'other', PAIRED.includes(part) ? side : null].filter(Boolean).join('_'));
/** A group / channel name -> {who: 'c1' | 'c2' | 'x' | null, part, side: 'l' | 'r' | null}; a repeat's digits are dropped
 *  ('c1_tail2' -> c1 tail). Plain v4.11 names: who null, part = the name without its digits. */
export function splitName(name) {
  const m = /^(c[12]|x)_([a-z0-9]+?)(?:_([lr]))?\d*$/.exec(String(name || ''));
  return m ? { who: m[1], part: m[2], side: m[3] || null } : { who: null, part: String(name || '').replace(/\d+$/, ''), side: null };
}
/** A group painted before it was given a character and part (paw-1mo): 'unassigned_3'. */
export const isUnassigned = (g) => /^unassigned_\d+$/.test(typeof g === 'string' ? g : g?.name || '');
/** The next free 'unassigned_N' among the groups. */
export function freeUnassigned(groups) {
  const used = new Set((groups || []).map((g) => g.name));
  let k = 1;
  while (used.has('unassigned_' + k)) k++;
  return 'unassigned_' + k;
}
/** A name as people read it: 'c1_penis' -> 'Bottom penis', 'c2_hand_l' -> 'Top L hand', 'x_tail2' -> 'Extra tail 2',
 *  'unassigned_2' -> '? 2'; plain names unchanged. */
export function partLabel(name) {
  if (isUnassigned(name)) return '? ' + String(name).slice(11);
  const { who, part, side } = splitName(name), rep = /\d+$/.exec(String(name || ''))?.[0];
  return who ? `${whoName(who)} ${side ? side.toUpperCase() + ' ' : ''}${partWord(part)}${rep ? ' ' + rep : ''}` : String(name || '');
}
/** Every group of the scene moved to the other character (Bottom <-> Top): who and name swapped, nothing else; Extra stays. */
export const swapWho = (groups) => (groups || []).map((g) => {
  const to = { c1: 'c2', c2: 'c1' }[g.who];
  return to ? { ...g, who: to, name: g.name.replace(/^c[12](?=_)/, to) } : g;
});
export const MASK_W = 320;
export const THRESHOLD = 0.5;   // the soft mask's edge: the fitted polygon follows mask >= 0.5
export const POLY_EPS = 0.0025; // RDP tolerance, frame heights (grown x1.5 until <= POLY_MAX vertices)
export const POLY_MAX = 64;
export const POLY_EPS_REL = 0.02;   // ... and at most this x the part's equivalent radius: a tolerance made for big parts must not cut a small one's corners
const LEVELS = 15;

export const maskSize = (aspect) => ({ w: MASK_W, h: Math.max(8, Math.round(MASK_W / (aspect || 16 / 9))) });
export const newMask = ({ w, h }) => ({ w, h, a: new Float32Array(w * h) });
export const cloneMask = (m) => ({ w: m.w, h: m.h, a: m.a.slice() });

// The brush (paw-1mo): a round stamp whose 0.5 level sits exactly at radius r (the ring the overlay draws), full inside
// r x (1 - SOFT), nothing past r x (1 + SOFT), linear between. Painting keeps the larger value and erasing the smaller
// (max / min, never adds up): the fitted edge is where the ring passed, however fast, slow or often the stroke went
// there, and a single click paints a whole disc.
export const SOFT = 0.25;
/** The brush swept from p to q ([x, y] mask px, a capsule: continuous at any speed), radius r px. */
export function stroke(m, p, q, r, { erase = false } = {}) {
  const { w, h, a } = m, R = r * (1 + SOFT), dx = q[0] - p[0], dy = q[1] - p[1], L2 = dx * dx + dy * dy;
  const x0 = Math.max(0, Math.floor(Math.min(p[0], q[0]) - R)), x1 = Math.min(w - 1, Math.ceil(Math.max(p[0], q[0]) + R));
  const y0 = Math.max(0, Math.floor(Math.min(p[1], q[1]) - R)), y1 = Math.min(h - 1, Math.ceil(Math.max(p[1], q[1]) + R));
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, t = L2 ? Math.min(1, Math.max(0, ((px - p[0]) * dx + (py - p[1]) * dy) / L2)) : 0;
      const v = Math.min(1, (1 + SOFT - Math.hypot(px - p[0] - t * dx, py - p[1] - t * dy) / r) / (2 * SOFT));
      if (v <= 0) continue;
      const i = y * w + x;
      a[i] = erase ? Math.min(a[i], 1 - v) : Math.max(a[i], v);
    }
  }
}
/** One stamp at (cx, cy). */
export const dab = (m, cx, cy, r, opts) => stroke(m, [cx, cy], [cx, cy], r, opts);

/** Polygon [[x, y], ...] (0..1) -> mask (1 inside, pixel centres, even-odd scanlines). */
export function rasterPoly(poly, size) {
  const m = newMask(size), { w, h, a } = m;
  if (!poly || poly.length < 3) return m;
  const P = poly.map(([x, y]) => [x * w, y * h]);
  for (let y = 0; y < h; y++) {
    const yc = y + 0.5, xs = [];
    for (let i = 0; i < P.length; i++) {
      const [ax, ay] = P[i], [bx, by] = P[(i + 1) % P.length];
      if ((ay <= yc) !== (by <= yc)) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((u, v) => u - v);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(w - 1, Math.floor(xs[k + 1] - 0.5)); x++) a[y * w + x] = 1;
  }
  return m;
}

// 8 neighbours, clockwise on screen (y down): E, SE, S, SW, W, NW, N, NE
const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];

/** The mask's 8-connected blobs at THRESHOLD: {lab (blob id per px, 0 = none), n: [px count per id, index 0 unused]}. */
function label(m) {
  const { w, h, a } = m, lab = new Int32Array(w * h), n = [0], stack = [];
  for (let i = 0; i < w * h; i++) {
    if (a[i] < THRESHOLD || lab[i]) continue;
    const id = n.length;
    let c = 0;
    lab[i] = id; stack.push(i);
    while (stack.length) {
      const j = stack.pop(), x = j % w, y = (j - x) / w;
      c++;
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d], ny = y + DY[d], k = ny * w + nx;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && !lab[k] && a[k] >= THRESHOLD) { lab[k] = id; stack.push(k); }
      }
    }
    n.push(c);
  }
  return { lab, n };
}
export const MIN_ISLAND = 4;   // px: a smaller blob (an erase leftover) is not a patch of its own

/** The mask's value at (x, y) mask px, bilinear between pixel centres, 0 outside. */
function sample(m, x, y) {
  const fx = x - 0.5, fy = y - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
  const at = (X, Y) => (X >= 0 && Y >= 0 && X < m.w && Y < m.h ? m.a[Y * m.w + X] : 0);
  return (at(ix, iy) * (1 - u) + at(ix + 1, iy) * u) * (1 - v) + (at(ix, iy + 1) * (1 - u) + at(ix + 1, iy + 1) * u) * v;
}
/** Blob `id`'s outer boundary -> polygon (0..1, <= POLY_MAX vertices) | null. Marching squares on the SOFT mask at THRESHOLD (a
 *  sub-pixel iso-line, however few pixels the part has; a part is padded by a pixel so one at the frame's edge still closes), the
 *  smallest closed chain round the blob's first pixel, RDP-simplified. Before paw-s63m this walked the thresholded pixels (Moore
 *  tracing) and moved each corner outward: a part 4-5 mask px wide was a square or an octagon and lost a third of its area. */
function outline(m, lab, id) {
  const { w, h, a } = m, W = w + 2, H = h + 2, s = new Float32Array(W * H).fill(1);
  let px = 0, start = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; s[(y + 1) * W + x + 1] = THRESHOLD - a[i]; if (lab[i] === id) { px++; if (start < 0) start = i; } }
  const sx = (start % w) + 1.5, sy = Math.floor(start / w) + 1.5;
  let best = null, ba = Infinity;
  for (const c of contours(s, W, H)) {
    if (!c.closed || c.p.length < 3 || !inPoly(c.p, sx, sy)) continue;
    const ar = polyArea(c.p);
    if (ar < ba) { ba = ar; best = c.p; }
  }
  if (!best) return null;
  let eps = Math.min(POLY_EPS * h, POLY_EPS_REL * Math.sqrt(px / Math.PI)), poly = rdpClosed(best, eps);
  while (poly.length > POLY_MAX) poly = rdpClosed(best, (eps *= 1.5));
  return poly.length >= 3 ? poly.map(([X, Y]) => [+(Math.min(w, Math.max(0, X - 1)) / w).toFixed(4), +(Math.min(h, Math.max(0, Y - 1)) / h).toFixed(4)]) : null;
}

/**
 * The polygon fitted to a mask: threshold at THRESHOLD, the largest 8-connected blob, its outer boundary (Moore
 * tracing), RDP-simplified to <= POLY_MAX vertices, each vertex moved onto the sub-pixel THRESHOLD edge.
 * -> {poly: [[x, y], ...] 0..1 | null, blobs: patches (blobs of MIN_ISLAND px or more, the largest counted always),
 *     islands: the other patches' outlines (not tracked: the overlay shows them and offers to split them off)}.
 */
export function fitPoly(m) {
  const { lab, n } = label(m);
  let best = 0;
  for (let id = 1; id < n.length; id++) if (n[id] > (n[best] || 0)) best = id;
  if (!best) return { poly: null, blobs: 0, islands: [] };
  const islands = [];
  for (let id = 1; id < n.length; id++) if (id !== best && n[id] >= MIN_ISLAND) { const q = outline(m, lab, id); if (q) islands.push(q); }
  return { poly: outline(m, lab, best), blobs: 1 + islands.length, islands };
}

/** The mask cut into one mask per patch (largest first): each soft pixel goes to the nearest patch (8-neighbour
 *  steps), specks under MIN_ISLAND px join their nearest patch too. [] for an empty mask. */
export function splitMask(m) {
  const { w, h, a } = m, { lab, n } = label(m);
  const ids = n.map((c, id) => id).filter((id) => id && n[id] >= MIN_ISLAND).sort((p, q) => n[q] - n[p]);
  if (!ids.length) return [];
  const own = owners(m, lab, (id) => ids.includes(id));
  return ids.map((id) => { const o = newMask(m); for (let i = 0; i < w * h; i++) if (own[i] === id) o.a[i] = a[i]; return o; });
}
/** Every painted px (a > 0) -> the blob it belongs to: its own, else the nearest blob `use(id)` admits (multi-source BFS, 8-neighbour steps). */
function owners(m, lab, use) {
  const { w, h, a } = m, own = new Int32Array(w * h), queue = [];
  for (let i = 0; i < w * h; i++) if (lab[i] && use(lab[i])) { own[i] = lab[i]; queue.push(i); }
  for (let k = 0; k < queue.length; k++) {
    const j = queue[k], x = j % w, y = (j - x) / w;
    for (let d = 0; d < 8; d++) {
      const nx = x + DX[d], ny = y + DY[d], i = ny * w + nx;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && !own[i] && a[i] > 0) { own[i] = own[j]; queue.push(i); }
    }
  }
  return own;
}

/** paw-1co9: an erase leaves each patch it cut into ONE piece. A patch of `before` (8-connected at THRESHOLD) that the erase
 *  took pixels from keeps the piece of `after` holding the most `keep` points (mask px: the group's SAM positives; ties and
 *  none: the largest); its other pieces, and a piece under MIN_ISLAND px (a crumb), go with their soft rim. Patches the erase
 *  did not touch, and paint outside `before` (the magnet), stay. Only removes: nothing erased comes back. -> a new mask, or
 *  `after` itself when nothing goes. */
export function eraseIslands(before, after, keep = []) {
  const { w, h } = after, A = label(after), B = label(before), nA = A.n.length;
  if (before.w !== w || before.h !== h || nA < 2) return after;
  const parent = new Int32Array(nA), held = new Int32Array(nA), lost = new Uint8Array(B.n.length), best = new Int32Array(B.n.length);
  for (let i = 0; i < w * h; i++) {
    const p = B.lab[i];
    if (!p) continue;
    if (after.a[i] < THRESHOLD) lost[p] = 1;
    else if (!parent[A.lab[i]]) parent[A.lab[i]] = p;
  }
  for (const [x, y] of keep || []) { const X = Math.floor(x), Y = Math.floor(y); if (X >= 0 && Y >= 0 && X < w && Y < h && A.lab[Y * w + X]) held[A.lab[Y * w + X]]++; }
  for (let id = 1; id < nA; id++) {
    const p = parent[id], b = best[p];
    if (p && lost[p] && (!b || held[id] > held[b] || (held[id] === held[b] && A.n[id] > A.n[b]))) best[p] = id;
  }
  const gone = (id) => { const p = parent[id]; return !!p && !!lost[p] && (id !== best[p] || A.n[id] < MIN_ISLAND); };
  let any = false;
  for (let id = 1; id < nA && !any; id++) any = gone(id);
  if (!any) return after;
  const own = owners(after, A.lab, () => true), out = newMask(after);
  for (let i = 0; i < w * h; i++) if (!own[i] || !gone(own[i])) out.a[i] = after.a[i];
  return out;
}

/** Mask m moved by (dx, dy) mask px, scaled by s and turned by rot (radians, pixel space) about (cx, cy) (bilinear). */
export function transformMask(m, { dx = 0, dy = 0, s = 1, cx = 0, cy = 0, rot = 0 } = {}) {
  const o = newMask(m), c = Math.cos(rot), n = Math.sin(rot);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const u = (x + 0.5 - dx - cx) / s, v = (y + 0.5 - dy - cy) / s;
    o.a[y * m.w + x] = sample(m, cx + u * c + v * n, cy - u * n + v * c);
  }
  return o;
}

/** The mask's value at frame point (nx, ny) (0..1 coords). */
export const maskAt = (m, nx, ny) => sample(m, nx * m.w, ny * m.h);

/** Point-in-polygon (even-odd). */
export function inPoly(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export const polyArea = (p) => Math.abs((p || []).reduce((s, [x, y], i) => { const [u, v] = p[(i + 1) % p.length]; return s + x * v - u * y; }, 0)) / 2;
/** Indices of the groups whose outline holds (x, y) (0..1), smallest first (the one on top of an overlap). */
export const groupsAt = (groups, x, y) => (groups || []).map((g, k) => k).filter((k) => groups[k].poly?.length >= 3 && inPoly(groups[k].poly, x, y)).sort((p, q) => polyArea(groups[p].poly) - polyArea(groups[q].poly));

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1], L = Math.hypot(bx - ax, by - ay) || 1;
  let k = 0, dm = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
    if (d > dm) { dm = d; k = i; }
  }
  return dm <= eps ? [pts[0], pts[pts.length - 1]] : [...rdp(pts.slice(0, k + 1), eps).slice(0, -1), ...rdp(pts.slice(k), eps)];
}
/** RDP on a closed ring: split at the point farthest from the first, simplify both halves. */
function rdpClosed(ring, eps) {
  let k = 0, dm = -1;
  for (let i = 1; i < ring.length; i++) { const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]); if (d > dm) { dm = d; k = i; } }
  const a = rdp(ring.slice(0, k + 1), eps), b = rdp([...ring.slice(k), ring[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Mask -> {w, h, rle: [level 0..15, run, ...]}; decode is its inverse (levels / 15). */
export function encodeMask(m) {
  const rle = [];
  let v = -1, n = 0;
  for (let i = 0; i < m.a.length; i++) {
    const q = Math.round(Math.min(1, Math.max(0, m.a[i])) * LEVELS);
    if (q === v) n++;
    else { if (n) rle.push(v, n); v = q; n = 1; }
  }
  if (n) rle.push(v, n);
  return { w: m.w, h: m.h, rle };
}
export function decodeMask(e) {
  const m = newMask(e), { a } = m;
  let i = 0;
  for (let k = 0; k + 1 < (e.rle?.length || 0) && i < a.length; k += 2) { a.fill(e.rle[k] / LEVELS, i, Math.min(a.length, i + e.rle[k + 1])); i += e.rle[k + 1]; }
  return m;
}
/** A stored group's mask at `size` (its own when it has one of that size, else its polygon rasterised). */
export const maskOf = (g, size) => (g.mask?.w === size.w && g.mask?.h === size.h && Array.isArray(g.mask.rle) ? decodeMask(g.mask) : rasterPoly(g.poly, size));

// ---- paw-yx6q: what the owner erased from a group stays erased. `g.erased` = {w, h, rle} (0 / 15 levels) on the group's seed
// frame: every later result for that group (a stroke, a SAM regrow or refinement, the dial, fill) is cut by it, until a paint
// stroke of the same group goes over it again. Saved with the group (scene.groups in the .pawproj); Track sends it as polygons.
/** Group g's erase record at `size` as 0 / 1 (Uint8Array w x h), or null. Another size: nearest-neighbour resampled. */
export function erasedOf(g, size) {
  const e = g?.erased;
  if (!e || !Array.isArray(e.rle) || !(e.w > 0) || !(e.h > 0)) return null;
  const m = decodeMask(e), out = new Uint8Array(size.w * size.h);
  for (let y = 0; y < size.h; y++) for (let x = 0; x < size.w; x++) out[y * size.w + x] = m.a[Math.min(e.h - 1, Math.floor(((y + 0.5) * e.h) / size.h)) * e.w + Math.min(e.w - 1, Math.floor(((x + 0.5) * e.w) / size.w))] >= THRESHOLD ? 1 : 0;
  return out;
}
/** The erase record after a gesture: `er` (or none) plus the pixels an erase swept (`swept`, >= 0.5), less the pixels a paint
 *  stroke of the same group covered (`painted`, >= 0.5). -> Uint8Array | null (nothing erased). */
export function nextErased(er, n, { swept = null, painted = null } = {}) {
  if (!er && !swept) return null;
  const out = er ? er.slice() : new Uint8Array(n);
  let any = 0;
  for (let i = 0; i < n; i++) {
    if (swept && swept[i] >= THRESHOLD) out[i] = 1;
    if (painted && painted[i] >= THRESHOLD) out[i] = 0;
    any |= out[i];
  }
  return any ? out : null;
}
/** Mask m with the erased pixels at 0 (a new mask when anything changed, else m). */
export function clipErased(m, er) {
  if (!er) return m;
  let a = null;
  for (let i = 0; i < m.a.length; i++) if (er[i] && m.a[i] > 0) { a ||= m.a.slice(); a[i] = 0; }
  return a ? { w: m.w, h: m.h, a } : m;
}
/** Group g with erase record er (Uint8Array at `size` | null: the key goes). */
export function withErased(g, er, size) {
  const { erased: _, ...r } = g;   // eslint-disable-line no-unused-vars
  return er ? { ...r, erased: encodeMask({ w: size.w, h: size.h, a: er }) } : r;
}
/** An encoded mask as outlines (0..1 frame): every patch of 4 px or more. */
function maskPolys(e) {
  if (!e?.rle?.length) return [];
  const f = fitPoly(decodeMask(e));
  return f.poly ? [f.poly, ...f.islands] : [];
}
/** The erase record as outlines for Track (PROTOCOL v4.53 `track.groups[].erased`). */
export const erasedPolys = (g) => maskPolys(g?.erased);

// ---- paw-njnf: the knot is a SECTION of a penis group, not a group of its own. `g.knot` = {w, h, rle} (0 / 15 levels), always
// inside the penis' own mask: painted with the knot brush (K) on the penis, erased with Shift; absent = no knot (the usual case).
// Track sends it as the penis entry's `knot` outlines (v4.54): its points are a labelled subset of the penis' points, so it shares
// the penis' fit and re-placement; the sidecar reports its centre as sem_<who>_knot_* (what lib/shaft.js and fusion read).
/** Is g an old-style knot group (part knot, painted as a group of its own)? */
export const isKnotGroup = (g) => !isUnassigned(g) && !isIgnore(g) && (g?.part || splitName(g?.name).part) === 'knot';
/** Penis group g's knot section at `size` (Float32Array 0..1, w x h) | null. */
export function knotOf(g, size) {
  const e = g?.knot;
  if (!e || !Array.isArray(e.rle) || !(e.w > 0) || !(e.h > 0)) return null;
  const m = decodeMask(e);
  if (e.w === size.w && e.h === size.h) return m.a;
  const out = new Float32Array(size.w * size.h);
  for (let y = 0; y < size.h; y++) for (let x = 0; x < size.w; x++) out[y * size.w + x] = m.a[Math.min(e.h - 1, Math.floor(((y + 0.5) * e.h) / size.h)) * e.w + Math.min(e.w - 1, Math.floor(((x + 0.5) * e.w) / size.w))];
  return out;
}
/** Group g with knot section a (Float32Array at `size`; null or empty: the key goes). */
export function withKnot(g, a, size) {
  const { knot: _, ...r } = g;   // eslint-disable-line no-unused-vars
  return a && a.some((v) => v >= THRESHOLD) ? { ...r, knot: encodeMask({ w: size.w, h: size.h, a }) } : r;
}
/** The knot section as outlines for Track (PROTOCOL v4.54 `track.groups[].knot`). */
export const knotPolys = (g) => maskPolys(g?.knot);
/** Old projects (paw-njnf): each knot group whose mask overlaps or touches (within 2 mask px) a penis group of the same character on
 *  the same frame (within `slack` ms) becomes that penis' section: the penis takes the knot's pixels into its mask and the knot as its
 *  section (added to one it has); the knot group goes. Any other knot group stays as it was (tracked as before). Never touches
 *  anything else. -> {list, folded: [knot group names]} | null (nothing to fold). */
export function foldKnots(list, slack = 20) {
  let out = null;
  const folded = [];
  for (const k of list || []) {
    if (!isKnotGroup(k) || k.off) continue;
    const cur = out || list, who = k.who || splitName(k.name).who;
    const size = k.mask?.w > 0 ? { w: k.mask.w, h: k.mask.h } : null;
    if (!size) continue;
    const km = maskOf(k, size).a;
    let best = -1, bestHit = 0;
    cur.forEach((p, j) => {
      if (p === k || p.off || !canShaft(p) || (p.who || splitName(p.name).who) !== who || !(Math.abs((p.t_ms ?? 0) - (k.t_ms ?? 0)) <= slack)) return;
      const pm = maskOf(p, size).a, hit = touching(km, pm, size.w, size.h, 2);
      if (hit > bestHit) { bestHit = hit; best = j; }
    });
    if (best < 0) continue;
    const p = cur[best], pm = maskOf(p, size).a, joined = new Float32Array(pm.length), sec = knotOf(p, size)?.slice() || new Float32Array(pm.length);
    for (let i = 0; i < pm.length; i++) { joined[i] = Math.max(pm[i], km[i]); sec[i] = Math.max(sec[i], km[i]); }
    const poly = fitPoly({ ...size, a: joined }).poly;
    if (!poly) continue;
    out = cur.filter((x) => x !== k).map((x) => (x === p ? withKnot({ ...noPoints(p), poly, mask: encodeMask({ ...size, a: joined }) }, sec, size) : x));
    folded.push(k.name);
  }
  return out ? { list: out, folded } : null;
}
/** How many px of mask a (>= 0.5) lie within r px (Chebyshev) of mask b (>= 0.5). */
function touching(a, b, w, h, r) {
  let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (a[y * w + x] < THRESHOLD) continue;
    let hit = false;
    for (let dy = -r; dy <= r && !hit; dy++) for (let dx = -r; dx <= r && !hit; dx++) { const X = x + dx, Y = y + dy; hit = X >= 0 && Y >= 0 && X < w && Y < h && b[Y * w + X] >= THRESHOLD; }
    if (hit) n++;
  }
  return n;
}

/** A name not yet used in the scene's groups (tail, tail2, ...): the sidecar would rename a repeat the same way. */
export function freeName(groups, name) {
  const used = new Set((groups || []).map((g) => g.name));
  let n = name, k = 2;
  while (used.has(n)) n = name + k++;
  return n;
}
export const isPinned = (name) => !/^((?:c[12]|x)_)?body\d*$/.test(name) && !isIgnore(name);

/** Scene list with scene i's groups replaced ([] / null removes the key). */
export function setGroups(list, i, groups) {
  if (!list[i]) return list;
  return list.map((s, k) => { if (k !== i) return s; const { groups: _, ...r } = s; return groups?.length ? { ...r, groups } : r; });   // eslint-disable-line no-unused-vars
}

// ---- scenes contain shots (timeline/shots.js): the groups belong to the scene, each drawn on one frame. The Groups
// tool works on a take (shots joined by camera moves: one continuous run); a hard cut inside the scene starts another
// take, whose groups are drawn (or re-found) on its own frame under the same names.
/** [t0, t1) of the take shot i is in. */
const takeSpan = (scenes, i) => { const r = takeRange(scenes, i); return r ? [scenes[r[0]].start_ms, scenes[r[1]].end_ms] : null; };
/** Does group g belong to the take of shot i? Its frame is inside the take; a frame in none of the scene's shots (a stale
 *  one) counts for the scene's first take. */
function inTake(scenes, i, g) {
  const sp = takeSpan(scenes, i), r = sceneRange(scenes, i);
  if (!sp || !r) return false;
  const t = g?.t_ms, inScene = Number.isFinite(t) && t >= scenes[r[0]].start_ms && t < scenes[r[1]].end_ms;
  return inScene ? t >= sp[0] && t < sp[1] : takeRange(scenes, i)[0] === r[0];
}
/** The groups of the take shot i is in (what the Groups tool shows and edits there). */
export const takeGroups = (scenes, i) => (scenes?.[i]?.groups || []).filter((g) => inTake(scenes, i, g));
/** paw-0apg: the take's groups drawn with the Groups tool off at frame t: all of them until a run covers t (an owner run:
 *  not a camera / modifier / derived fill one; a discarded run is gone from runs), then only those painted on frame t (the
 *  tool's frame identity: within 3/4 frame, at least 20 ms; a group without a frame: the take's first seed frame). */
export function groupsShownAt(list, runs, t, frameMs) {
  if (!(runs || []).some((r) => !r.tag && !r.mod && !r.derived && r.range && t >= r.range.start && t < r.range.end)) return list;
  const first = Math.min(...list.map((g) => g.t_ms).filter(Number.isFinite)), slack = Math.max(20, (frameMs || 33) * 0.75);
  return list.filter((g) => Math.abs((Number.isFinite(g.t_ms) ? g.t_ms : first) - t) <= slack);
}
/** paw-o74b.1: the take's groups that cannot be seeds (paw-p42x census: takes painted before the second seed): a frame
 *  outside the scene (stale), or one part twice on one frame (within slack ms: the later one in the list is kept). ->
 *  {list (the take's groups without them), stale, dups} | null (nothing to drop). */
export function tidySeeds(scenes, i, slack = 20) {
  const take = takeGroups(scenes, i), r = sceneRange(scenes, i);
  if (!take.length || !r) return null;
  const a = scenes[r[0]].start_ms, b = scenes[r[1]].end_ms, stale = take.filter((g) => Number.isFinite(g.t_ms) && (g.t_ms < a || g.t_ms >= b));
  const live = take.filter((g) => !stale.includes(g)), dups = live.filter((g, k) => live.some((h, j) => j > k && h.name === g.name && Math.abs(h.t_ms - g.t_ms) <= slack));
  return stale.length || dups.length ? { list: live.filter((g) => !dups.includes(g)), stale: stale.length, dups: dups.length } : null;
}
/** The groups drawn in the scene's other takes (a hard cut inside it): the names to re-find, newest take before i first. */
export function otherTakeGroups(scenes, i) {
  const r = takeRange(scenes, i), all = scenes?.[i]?.groups || [];
  if (!r) return [];
  return all.filter((g) => !inTake(scenes, i, g)).sort((a, b) => Math.abs(scenes[r[0]].start_ms - a.t_ms) - Math.abs(scenes[r[0]].start_ms - b.t_ms));
}
/** The prior list for suggest_groups (PROTOCOL v4.13) from the scene's other takes: one entry per identity (the nearest
 *  take's), {name, who?, part?, side?, poly}. [] when the take has groups of its own or the scene has none elsewhere. */
export function priorFor(scenes, i) {
  if (takeGroups(scenes, i).length) return [];
  const seen = new Set(), out = [];
  for (const g of otherTakeGroups(scenes, i)) {
    if (g.off || isIgnore(g) || seen.has(g.name) || !(g.poly?.length >= 3)) continue;
    seen.add(g.name);
    out.push({ name: g.name, ...(g.who ? { who: g.who, part: g.part || splitName(g.name).part, ...(g.side ? { side: g.side } : {}) } : { part: splitName(g.name).part }), poly: g.poly });
  }
  return out;
}
/** A short fingerprint of an encoded mask (its run-length numbers): a SAM state (`sam.fp`) is good only while the group's mask is still the one it came with. */
export function maskFp(m) {
  let h = 2166136261 >>> 0;
  for (const v of m?.rle || []) h = Math.imul(h ^ (v | 0), 16777619) >>> 0;
  return `${m?.rle?.length || 0}:${h.toString(36)}`;
}
/** Suggest's result groups -> stored groups on frame t (re-found ones keep `prior` / `unconfirmed`); mask(poly) -> its encoded mask.
 *  paw-5r1: a paired part's side is only the sidecar's proposal (a character's first L, its second R): when that side of the part is
 *  already painted here and the other is not, the suggestion takes the other (a second hand is the R one), never a repeat of the L. */
export function suggestedGroups(res, t, used, mask) {
  const list = [...used], out = [];
  for (const x of res?.groups || []) {
    if (!(x.poly?.length >= 3)) continue;
    const s0 = splitName(x.name), base = !x.unconfirmed && s0.who && PAIRED.includes(s0.part) && s0.side
      ? groupName({ ...s0, side: pairSide(new Set(list.map((g) => g.name.replace(/\d+$/, ''))), s0.who, s0.part, s0.side) }) : x.name;
    const name = x.unconfirmed ? x.name : freeName(list, base), q = splitName(name);
    const g = { name, poly: x.poly, pinned: x.pinned !== false && isPinned(name), t_ms: Math.round(t), score: x.score, source: x.source || 'tagger', mask: mask(x.poly),
      ...(q.who ? { who: q.who, part: x.part || q.part, ...(q.side ? { side: q.side } : {}) } : {}), ...(x.unconfirmed ? { unconfirmed: true, prior: x.prior } : {}),
      ...(x.tentative ? { tentative: true } : {}), ...(x.mask_from ? { mask_from: x.mask_from } : {}), ...(x.sam?.mask ? { sam: { pos: x.sam.pos || [], neg: x.sam.neg || [], mask: x.sam.mask } } : {}), ...(Number.isFinite(x.who_conf) ? { who_conf: x.who_conf } : {}) };   // v4.18; v4.29: mask_from sam | head | cam = who drew the outline: a learned suggestion below the seeder's confidence
    if (g.sam) g.sam.fp = maskFp(g.mask);   // v4.37 (paw-om3e): the prompts Suggest sent to SAM and SAM's chosen mask, so the dab / loosen dial re-ask SAM from them after Accept
    list.push(g); out.push(g);
  }
  return out;
}
// paw-r6t0: Suggest returns every candidate with its score; the app SHOWS only those at or above the confidence the owner sets (live).
export const SUGGEST_CONF = 0.8;                 // default shown confidence
export const SUGGEST_CONF_MIN = 0.3;             // the control's range (below it the candidates are noise)
export const YOUNG_PICTURES = 30;                // a head trained on fewer pictures than this is rough (pawtrack: none; the app says so)
/** Is suggestion g shown at confidence `conf`? Painted groups and re-found ones (unconfirmed) always are; scoreless ones when their part is offered. */
export const shownAt = (g, conf) => !isSuggested(g) || !!g.unconfirmed || (partShown(g.part || splitName(g.name).part) && (!Number.isFinite(g.score) || g.score >= conf - 1e-9));   // paw-43vn: a part furry items off does not offer stays held, like one below the confidence
/** A group list split by confidence: {shown, hidden} (the order kept). */
export function splitByConfidence(list, conf) {
  const shown = [], hidden = [];
  for (const g of list || []) (shownAt(g, conf) ? shown : hidden).push(g);
  return { shown, hidden };
}
/** "9 shown · 6 more below 80 %" (nothing hidden: "9 shown"). */
export const shownLine = (n, hidden, conf) => `${n} shown${hidden ? ` · ${hidden} more below ${Math.round(conf * 100)} %` : ''}`;
export const WHO_GATE = 0.95;   // = pawtrack/bodies.py GATE: at or above this the sidecar's Bottom / Top is applied by itself; below it the character is the owner's (active one, hover 1 / 2 / 3) and the label says '?'
/** How the characters were decided (suggest_groups' `who` record): '2 bodies · roles: left-head fallback'. */
export function whoNote(w) {
  if (!w) return '';
  if (w.fallback) return 'bodies: not split (' + w.fallback + ')';
  const by = { solo: 'solo = Bottom', left: 'roles: left-head fallback', role: 'roles learned', painted: "named from this video's painted scenes", given: 'named from your labels' }[w.by] || w.by;
  return `${w.bodies} ${w.bodies === 1 ? 'body' : 'bodies'} · ${by}${w.sam && !['used', 'none'].includes(w.sam) ? ' · SAM off' : ''}`;
}
/** The plain note when the active dataset's head was trained on few pictures (seeder = the sidecar's record), else ''. */
export function youngNote(seeder, name) {
  const n = seeder?.frames;
  if (!Number.isFinite(n) || n >= YOUNG_PICTURES) return '';
  return `${name || 'This dataset'} has ${n} labeled picture${n === 1 ? '' : 's'}: suggestions will be rough until about ${YOUNG_PICTURES}+`;
}
/** Group g accepted as it is (a re-found one: the owner says it is right). */
export const confirmGroup = (g) => { if (!g?.unconfirmed) return g; const { unconfirmed: _, prior: __, ...r } = g; return r; };   // eslint-disable-line no-unused-vars

/** Scene list with the take of shot i holding `groups` (the scene's other takes keep theirs). */
export const setTakeGroups = (list, i, groups) => setGroups(list, i, [...(list[i]?.groups || []).filter((g) => !inTake(list, i, g)), ...(groups || [])]);

/** The track request's `groups` for (t0, t1): every scene's groups that are on, have a polygon and were painted
 *  inside both that scene and the range. */
export function trackGroups(scenes, t0, t1) {
  const out = [];
  for (const s of scenes || []) {
    if (!(s.end_ms > t0 && s.start_ms < t1)) continue;
    for (const g of foldKnots(s.groups)?.list || s.groups || []) {   // paw-njnf: an old knot group on a penis goes as its section
      if (g.off || isUnassigned(g) || isIgnore(g) || !(g.poly?.length >= 3) || !Number.isFinite(g.t_ms) || g.t_ms < s.start_ms || g.t_ms >= s.end_ms || g.t_ms < t0 || g.t_ms >= t1) continue;
      const twin = out.findIndex((x) => x.name === g.name && x.t_ms === Math.round(g.t_ms));   // paw-o74b.1: one part twice on one frame (an older project): the later one
      if (twin >= 0) out.splice(twin, 1);
      const er = erasedPolys(g), kn = g.pinned !== false && canShaft(g) ? knotPolys(g) : [];   // paw-yx6q (v4.53): no points seeded there, no shaft mask there on the seed frame; paw-njnf (v4.54): the knot section
      out.push({ name: g.name, poly: g.poly, pinned: g.pinned !== false, t_ms: Math.round(g.t_ms), ...(g.points?.length ? { points: g.points } : {}), ...(g.who ? { who: g.who, part: g.part || splitName(g.name).part, ...(g.side ? { side: g.side } : {}) } : {}),
        ...(g.pinned !== false && isShaft(g, s) ? { shaft: true } : {}), ...(g.pinned !== false && isDepth(g) ? { depth: true } : {}), ...(er.length ? { erased: er } : {}), ...(kn.length ? { knot: kn } : {}) });
    }
  }
  return out;
}

/** The `cum` request's groups (PROTOCOL v4.16) for a scene (its shots, or one shot): their groups on, assigned, with a
 *  polygon and a frame, each with `pulse` (isPulse); [] when none is a pulse group (then nothing is tracked). */
export function cumGroups(shots) {
  const gs = [...new Set((Array.isArray(shots) ? shots : [shots]).flatMap((s) => s?.groups || []))]
    .filter((g) => !g.off && !isUnassigned(g) && !isIgnore(g) && g.poly?.length >= 3 && Number.isFinite(g.t_ms));
  if (!gs.some(isPulse)) return [];
  return gs.map((g) => ({ name: g.name, poly: g.poly, t_ms: Math.round(g.t_ms), pulse: isPulse(g), ...(g.who ? { who: g.who, part: g.part || splitName(g.name).part } : { part: splitName(g.name).part }) }));
}

/** How many groups trackGroups(scenes, t0, t1) leaves out because they are not assigned yet (the Track warning). */
export function unassignedIn(scenes, t0, t1) {
  let n = 0;
  for (const s of scenes || []) if (s.end_ms > t0 && s.start_ms < t1) for (const g of s.groups || []) if (!g.off && isUnassigned(g) && g.t_ms >= t0 && g.t_ms < t1) n++;
  return n;
}

// ---- assigning (paw-1mo: paint first, assign after; pure list -> list, one undo step each in the tool) ----
const withName = (g, name) => { const q = splitName(name), { who: _w, part: _p, side: _s, ...r } = g; return { ...r, name, pinned: isPinned(name), ...(q.who ? { who: q.who, part: q.part, ...(q.side ? { side: q.side } : {}) } : {}) }; };   // eslint-disable-line no-unused-vars
/** Group k given character and part (side for a paired part, the character's own; default L): named who_part_side, a free name ('c1_tail2' for a second tail). */
export function assignGroup(list, k, { who, part, side }) {
  const g = list[k];
  if (!g) return list;
  const base = groupName({ who, part, side: PAIRED.includes(part) ? side || 'l' : null });
  if (g.name.replace(/\d+$/, '') === base) return list;
  const out = [...list];
  out[k] = withName(g, freeName(list.filter((x) => x !== g), base));
  return out;
}
/** Groups k and j trade their assignments (names, characters, parts); with an unassigned one that moves the label. */
export function swapAssign(list, k, j) {
  const a = list[k], b = list[j];
  if (!a || !b || k === j) return list;
  const out = [...list];
  out[k] = withName(a, b.name); out[j] = withName(b, a.name);
  return out;
}

/** The frame the Groups tool opens on for scene s: its groups' frame, else the roi's (inside it), else its first frame. */
export function seedFrameOf(s, roi) {
  const g = (s?.groups || []).find((x) => Number.isFinite(x.t_ms));
  if (g) return g.t_ms;
  if (roi && Number.isFinite(roi.t_ms) && roi.t_ms >= s.start_ms && roi.t_ms < s.end_ms) return roi.t_ms;
  return s ? s.start_ms : 0;
}

// ---- Suggest's proposals (paw-bn2, PROTOCOL v4.18): the learned seeder (source 'seeder'), the tag CAM ('tagger'), SAM
// bodies ('sam'). A suggestion stays one until the owner accepts or fixes it (repaint, reassign): then it is a painted
// group (source 'user'), which the seeder trains on at the next save.
export const CONFIDENT = 0.7;   // = pawtrack/seeder.py CONFIDENT: below it a learned suggestion is tentative
/** Is group g a suggestion the owner has not accepted? */
export const isSuggested = (g) => !!g?.source && g.source !== 'user' && !isCopy(g);
/** Was group g copied from a repeated frame (paw-8mf4: source 'repeat' painted groups, 'run' a run's seeded points)? Drawn
 *  and tracked like painted ones, never collected as separate training examples (the same picture). */
export const isCopy = (g) => g?.source === 'repeat' || g?.source === 'run';
/** Group g without its run seed points (its shape changed: the mask is what tracks now). */
export const noPoints = (g) => { if (!g?.points) return g; const { points: _, ...r } = g; return r; };   // eslint-disable-line no-unused-vars
/** A suggestion's confidence 0..1 (the seeder's peak heat, the tag probability, SAM's score); null for painted groups. */
export const confidenceOf = (g) => (isSuggested(g) && Number.isFinite(g.score) ? Math.max(0, Math.min(1, g.score)) : null);
/** A low-confidence suggestion (drawn faint and dashed). */
export const isTentative = (g) => isSuggested(g) && (g.tentative === true || (g.source === 'seeder' && confidenceOf(g) < CONFIDENT));
/** Group g accepted as it is: a re-found one confirmed, a suggestion made a painted group (source 'user'). */
export function acceptGroup(g) {
  const c = confirmGroup(g);
  if (isCopy(c)) { const { from: _, ...r } = c; return { ...r, source: 'user' }; }   // eslint-disable-line no-unused-vars
  if (!isSuggested(c)) return c;
  const { tentative: _t, score: _s, outline: _o, mask_from: _m, who_conf: _w, ...r } = c;   // eslint-disable-line no-unused-vars
  return { ...r, source: 'user' };
}
export const SEED_SPAN = 2000, SEED_STEP = 400;   // ms: Suggest picks its seed frame in the take's first 2 s (the seeder probe)
/** The frames Suggest may pick the seed frame from (v4.18 candidates): the frame on screen t first, then every
 *  SEED_STEP ms of the take's first SEED_SPAN, each moved to the start of the frame at or after it (whole ms, inside
 *  that frame: frameMs, the player's frame length; the sidecar takes the frame at or before a time, and a group's frame
 *  must be one the playhead can stand on); [] (suggest on t) when the take has painted groups (their frame is fixed) or
 *  t is past its first SEED_SPAN (the owner chose a frame further in). */
export function seedCandidates(scenes, i, t, frameMs = 0, win = null) {
  const r = takeRange(scenes, i);
  if (!r || takeGroups(scenes, i).some((g) => !isSuggested(g))) return [];
  const a = Math.ceil(win ? win.a : scenes[r[0]].start_ms), b = win ? win.b : scenes[r[1]].end_ms;   // paw-ef73.9: win = the take's seed window (lib/seed-window.js)
  if (!(t >= a && t - a <= SEED_SPAN)) return [];
  const snap = (x) => (frameMs > 0 ? Math.ceil(Math.ceil(x / frameMs - 1e-6) * frameMs) : Math.round(x));
  const out = [Math.round(t)];
  for (let x = a; x < Math.min(b, a + SEED_SPAN); x += SEED_STEP) { const y = snap(x); if (y < b && Math.abs(y - t) > 20 && !out.includes(y)) out.push(y); }
  return out.length > 1 ? out : [];
}
/** The seed library (v4.18 seed_train folders): settings 'tracking.seeder.folders' when set, else the folders of the
 *  recently opened videos / projects (settings 'recent'), each once (case-insensitive), missing entries left out. */
export function seedFolders(list, recent) {
  const dirOf = (p) => String(p || '').replace(/[\\/][^\\/]*$/, '');
  const src = Array.isArray(list) && list.length ? list : (recent || []).filter((e) => e?.path && !e.missing).map((e) => dirOf(e.path));
  const seen = new Set();
  return src.filter((d) => d && !seen.has(d.toLowerCase()) && seen.add(d.toLowerCase()));
}
/** The painted (training) side of a document's groups, as a string: changes when a save brings new or changed labels. */
// paw-bsyo: peek-scrub while painting (hold Space, move the mouse sideways; no button): pointer px per frame, and Shift's finer ratio
export const PEEK_PX = 6, PEEK_FINE = 4;
/** Whole frames a drag of `dx` px is (Shift: `fine`). */
export const peekFrames = (dx, fine = false) => Math.round(dx / (PEEK_PX * (fine ? PEEK_FINE : 1)));
/** Where a peek `k` frames from the seed frame (ms `seed`) lands: {k, ms}, k clamped so the frame stays in the take [lo, hi] (no drift: ms is from the seed, never from the last stop). */
export function peekAt(seed, k, frameMs, lo, hi) {
  k = Math.min(Math.floor((hi - seed) / frameMs), Math.max(Math.ceil((lo - seed) / frameMs), k));
  return { k, ms: Math.min(hi, Math.max(lo, Math.round(seed + k * frameMs))) };
}

export function paintedKey(scenes) {
  let h = 5381;
  const add = (v) => { const s = String(v); for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; };
  for (const s of scenes || []) for (const g of s.groups || []) {
    if (isSuggested(g) || isCopy(g) || g.off || isUnassigned(g)) continue;
    add(g.name); add(g.t_ms); add(g.mask?.rle ? g.mask.rle.join(',') : JSON.stringify(g.poly || []));
    if (g.knot?.rle) add('knot' + g.knot.rle.join(','));   // paw-k393: the knot section trains the seeder's knot class (no section: the key it had)
  }
  return h.toString(36);
}

// paw-ls54: the Groups dock on the video's left edge (GroupsOverlay.svelte)
/** The parts most often painted: the dock's chips after a group's own part and its proposal. */
export const COMMON_PARTS = ['penis', 'balls', 'sheath', 'anus', 'slit', 'hips', 'head', 'tail'];
/** The dock's part chips for one group: `first` (its own part, then its proposal's parts, best first) and then
 *  COMMON_PARTS, each part once, a paired part as its L and R; at most `max`. -> [{part, side}] */
export function chipParts(first = [], max = 8) {
  const out = [], seen = new Set();
  for (const p of [...first, ...COMMON_PARTS]) {
    if (!PICK_PARTS.includes(p) || !partShown(p) || seen.has(p)) continue;
    seen.add(p);
    if (PAIRED.includes(p)) out.push({ part: p, side: 'l' }, { part: p, side: 'r' });
    else out.push({ part: p, side: null });
  }
  return out.slice(0, max);
}
/** The dock's group rows: the assigned groups (index order), then the unassigned ones folded into one line
 *  {fold: n} (none without any), followed by their rows when it is open. -> [{k} | {fold}] */
export function dockRows(list, open = false) {
  const named = [], un = [];
  (list || []).forEach((g, k) => (isUnassigned(g) ? un : named).push({ k }));
  return un.length ? [...named, { fold: un.length }, ...(open ? un : [])] : named;
}
