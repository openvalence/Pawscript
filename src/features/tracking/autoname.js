// autoname.js -- the pure side of auto-naming painted blobs (paw-p9ve, sidecar `name_groups`, PROTOCOL v4.34).
// The owner paints, the model PROPOSES a part for each unnamed blob (tentative on screen, never silently committed). One key confirms the
// proposals that are confident (the sidecar's `auto`: held-out, 65 % of blobs at 96 % right); a doubtful one is drawn "?" and stays for the
// assign pass. The CHARACTER is the owner's: a confirmed proposal takes the active character (keys 1 / 2 / 3), because appearance alone
// named it right only 71 % of the time given one named blob (RESULTS.md), so the sidecar's own `who` is a cross-check: a proposal whose
// appearance says "the other character" is left for the pass, never confirmed. A confirmed name is the owner's label (source 'user') marked
// `named_by: 'auto'` so it can be audited.
import { PAIRED, isUnassigned, isIgnore, splitName, groupName, PARTS, PICK_PARTS, WHO_GATE, pairSide } from './groups.js';
import { partShown } from '../../lib/content.js';

export const NAMED_BY = 'auto';

/** The request's masks: every visible group with a stored mask; a named one carries its part / who (fixed context for the others). `at`
 *  maps request index -> the unassigned group object (to proposals). -> {masks, at} */
export function nameMasks(groups) {
  const masks = [], at = new Map();
  for (const g of groups || []) {
    if (!g || g.off || isIgnore(g) || !g.mask?.rle?.length) continue;
    const m = { w: g.mask.w, h: g.mask.h, rle: g.mask.rle };
    if (isUnassigned(g)) at.set(masks.length, g);
    else { const s = splitName(g.name), part = g.part || s.part, who = g.who || s.who; masks.push(part && PARTS.includes(part) ? { ...m, part, ...(who ? { who } : {}) } : m); continue; }
    masks.push(m);
  }
  return { masks, at };
}

/** A sidecar blob -> {parts: [{part, p}], conf, auto, who} (empty parts = unknown: no model / no features). */
export const proposalOf = (b) => ({ parts: (b?.part || []).filter((x) => PICK_PARTS.includes(x.part) && partShown(x.part)),   /* paw-njnf: never a knot of its own; paw-43vn: no part furry items off does not offer */ conf: +b?.conf || 0, auto: !!b?.auto && !!b?.part?.length, who: b?.who === 'c1' || b?.who === 'c2' ? b.who : null, whoConf: Number.isFinite(b?.who_conf) ? b.who_conf : 0.7 });   // v4.36: who_conf = how that who was decided (held-out); an older sidecar's who is a cross-check as before
/** The sidecar's character for a proposal when it is sure enough to apply by itself (WHO_GATE), else null (the owner's active character decides). */
export const sureWho = (p) => (p?.who && p.whoConf >= WHO_GATE ? p.who : null);

/** The proposals of a result: Map group object -> proposal, for the unassigned groups in `at`. */
export function readProposals(res, at) {
  const out = new Map();
  (res?.blobs || []).forEach((b, i) => { const g = at.get(i); if (g) { const p = proposalOf(b); if (p.parts.length) out.set(g, p); } });
  return out;
}

/** The would-be name of a proposal for `who` ('c1_thighs_l'): its colour on the blob. */
export const proposedName = (p, who, side = 'l') => groupName({ who, part: p.parts[0].part, side: PAIRED.includes(p.parts[0].part) ? side : null });

/** paw-5r1: the side each unassigned blob whose top proposal is a paired part would get: Map k -> {side, how}. The side is the CHARACTER's
 *  own left / right and the owner's word: one they flipped (mine.sides, F) is kept ('own'); else L, or R when that character's L of the part
 *  is painted (or confidently proposed to an earlier blob) and its R is not ('pair'); nothing known: L ('default': the owner paints the character's left
 *  first). Never from where the blob sits in the picture. In painting order, so two new forearms are proposed L then R. */
export function proposedSides(groups, props, who, mine = null) {
  const used = new Set((groups || []).filter((g) => !isUnassigned(g)).map((g) => g.name.replace(/\d+$/, ''))), out = new Map(), todo = [];
  (groups || []).forEach((g, k) => {
    const p = isUnassigned(g) ? props?.get(g) : null, part = p?.parts?.[0]?.part;
    if (!PAIRED.includes(part)) return;
    const w = mine?.whos?.get(g) || sureWho(p) || who, own = mine?.sides?.get(g);
    if (own) { used.add(groupName({ who: w, part, side: own })); out.set(k, { side: own, how: 'own' }); }   // the owner's flips first: the others make room
    else todo.push([k, p, w, part]);
  });
  for (const [k, p, w, part] of todo) {
    const side = pairSide(used, w, part), other = used.has(groupName({ who: w, part, side: side === 'l' ? 'r' : 'l' })) || used.has(groupName({ who: w, part, side }));
    if (p.auto) used.add(groupName({ who: w, part, side }));   // a doubtful proposal ('?') takes no side from a sure one
    out.set(k, { side, how: other ? 'pair' : 'default' });
  }
  return out;
}
/** A proposed side as the blob's chip says it: 'L', 'R', 'L (default)'. */
export const sideText = (s) => (s ? s.side.toUpperCase() + (s.how === 'default' ? ' (default)' : '') : '');

/** What confirm-all does: [{k, who, part, side}] for the unassigned groups with a confident proposal, in painting order. The character is
 *  `who` (the active one) unless the owner set one for that blob (mine.whos: hover + 1 / 2 / 3), which also lifts the "appearance says the
 *  other character" skip; a proposal whose appearance names the other character is otherwise skipped. A paired part takes its proposed
 *  side (proposedSides: the owner's flip, else the other limb's, else L). */
export function planConfirm(groups, props, who, mine = null) {
  const sides = proposedSides(groups, props, who, mine), out = [];
  (groups || []).forEach((g, k) => {
    const p = isUnassigned(g) ? props?.get(g) : null, own = mine?.whos?.get(g) || null, w = own || sureWho(p) || who;
    if (!p?.auto || (!own && !sureWho(p) && p.who && (p.whoConf ?? 0.7) >= 0.7 && p.who !== who)) return;
    out.push({ k, who: w, part: p.parts[0].part, side: sides.get(k)?.side || null });
  });
  return out;
}

// ---- Find knot (paw-dgtr): the knot from the painted shaft's own shape ----
// Measured on the owner's labels (experiments/seeder-probe/RESULTS.md, "Auto knot"): no detector reached a useful precision for an
// AUTOMATIC knot (16 shafts with a knot of 68), so it is an explicit action; its region is the widest stretch of the shaft across its
// principal axis, in the base half when the character's balls / sheath / hips say where the base is (median IoU 0.42 with the painted knot).
export const KNOT = { smooth: 0.06, rise: 0.3, trim: 0.08, base: 0.5, minRatio: 1.05 };
/** A shaft mask {w, h, a} -> the knot region (a mask of the same size: the shaft's pixels across its widest stretch) or null (no bulge).
 *  cues: [[x, y]] (mask px) centres of the same character's balls / sheath / hips: the base end. */
export function knotRegion(m, cues = [], o = KNOT) {
  const { w, h, a } = m, xs = [], ys = [];
  for (let i = 0; i < a.length; i++) if (a[i] >= 0.5) { xs.push((i % w) + 0.5); ys.push(Math.floor(i / w) + 0.5); }
  const N = xs.length;
  if (N < 30) return null;
  let cx = 0, cy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < N; i++) { cx += xs[i]; cy += ys[i]; }
  cx /= N; cy /= N;
  for (let i = 0; i < N; i++) { const dx = xs[i] - cx, dy = ys[i] - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(th), uy = Math.sin(th);
  const s = xs.map((x, i) => (x - cx) * ux + (ys[i] - cy) * uy), lo = Math.floor(Math.min(...s)), idx = s.map((v) => Math.floor(v - lo)), n = Math.max(...idx) + 1;
  const width = new Float64Array(n);
  for (const j of idx) width[j]++;
  const k = Math.max(1, Math.round(o.smooth * n)), sm = new Float64Array(n);   // a box filter, the ends held (edge padding)
  for (let j = 0; j < n; j++) { let t = 0; for (let d = -k; d <= k; d++) t += width[Math.min(n - 1, Math.max(0, j + d))]; sm[j] = t / (2 * k + 1); }
  const a0 = Math.floor(o.trim * n), b0 = Math.max(a0 + 1, Math.floor((1 - o.trim) * n)), core = [...sm.slice(a0, b0)].sort((p, q) => p - q);
  const w0 = core.length % 2 ? core[core.length >> 1] : (core[core.length / 2 - 1] + core[core.length / 2]) / 2;
  const e = cues.length ? Math.sign(cues.reduce((t, [x, y]) => t + (x - cx) * ux + (y - cy) * uy, 0)) : 0;   // +1: the base at the high end
  let lo2 = a0, hi2 = b0;
  if (e > 0) lo2 = Math.max(a0, Math.floor((1 - o.base) * n)); else if (e < 0) hi2 = Math.min(b0, Math.floor(o.base * n) + 1);
  let j = lo2;
  for (let t = lo2; t < hi2; t++) if (sm[t] > sm[j]) j = t;
  if (!(sm[j] >= o.minRatio * w0)) return null;
  const lvl = w0 + o.rise * (sm[j] - w0);
  let l = j, r = j;
  while (l > 0 && sm[l - 1] >= lvl) l--;
  while (r < n - 1 && sm[r + 1] >= lvl) r++;
  const out = { w, h, a: new Float32Array(w * h) };
  for (let i = 0; i < N; i++) if (idx[i] >= l && idx[i] <= r) out.a[Math.floor(ys[i]) * w + Math.floor(xs[i])] = 1;
  return out;
}
/** The centre [x, y] (mask px) of a mask's pixels >= 0.5, or null. */
export function maskCentre({ w, a }) {
  let x = 0, y = 0, n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] >= 0.5) { x += (i % w) + 0.5; y += Math.floor(i / w) + 0.5; n++; }
  return n ? [x / n, y / n] : null;
}

/** What a doubtful proposal says in a tip: "guess: thighs 62 %, hips 20 %". */
export const guessText = (p, word = (x) => x) => (p?.parts?.length ? 'guess: ' + p.parts.slice(0, 2).map((x) => `${word(x.part)} ${Math.round(x.p * 100)} %`).join(', ') : '');
