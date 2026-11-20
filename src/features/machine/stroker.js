// stroker.js -- the Machine panel's Stroker mode (paw-un2p, paw-n2ms): the penis is the fixed body and a sleeve moves
// over it, driven by the script; per frame which part of the penis is inside the sleeve, how tightly, and how fast the
// sleeve slides over it, reduced to a stimulation signal per zone (glans, corona band, upper shaft, lower shaft / base).
// Pure, no DOM.
//
// Geometry. The penis is a radius profile like a toy (toys.js): s mm from the TIP (0) to the visible base (lengthMm),
// plus a root of padMm under the pubic pad (s > lengthMm) that only shows when the pad is pressed in. Anatomy, stylised:
// a rounded glans to a corona that flares a few % over the shaft, the sulcus behind it, a shaft tapering a little
// toward the tip, a base that meets the body (the cross-section's top / bottom detail is the view's, stroker3d.js).
// Along the axis z = mm from the visible base (z = L - s; the root at z < 0). A sleeve is an inner-channel profile
// [[x, r], ...], x mm from its entrance (0) to its far end (lengthMm), open or closed there; a case may stand frontMm
// in front of its entrance. Its entrance sits at e (mm from the base): the channel covers z in [e, e + lengthMm]. The
// script drives e (pos 0 = deepest = the sleeve down at the base):
//   e(pos) = rig.downMm + (pos / 100) * (rig.upMm - rig.downMm)
// (down and up are where the entrance is at pos 0 and pos 100; dragging up below down inverts the mapping; either may
// lie past the hilt, e < 0 down to EMIN, or past the tip, where nothing touches). Nothing is clamped: past its limits the
// sleeve deforms with a soft, smooth, finite contact pressure (pressureAt):
//  - the case front pushed past the hilt by q mm first compresses the pubic pad: c = pad * (1 - exp(-q / pad)) (soft,
//    never more than the pad), which exposes c mm more shaft (the root); the rest of q presses on bone (a steep, still
//    finite, resistance); both press on the stations next to the (dented) body;
//  - a closed end the tip reaches presses on the stations past its end plane;
//  - an open end simply lets the tip out (no contact there).
//
// Contact and pressure per 1 mm station: interference d = max(0, r_penis - r_channel), the channel stretched by
// d; pressure p = E * d / (r_channel + d) (its hoop strain, saturating), E = 1 - 0.6 * soft (wall softness 0..1).
// Zero outside the channel or where the channel is wider than the penis.
//
// Soft body ("jiggle", the Machine's toy mode, physics.js oscOf): the hand or device holds the sleeve's shell at the
// driven e; the inner wall, where it grips the penis, follows through the wall's shear spring as an underdamped
// oscillator (20 .. 7 Hz, firm .. soft; damping ratio 0.3), its rest point dragged back by friction against
// the motion, up to lagMax = 1.5 + 6 * soft mm at full grip (grip = total pressure / NREF, capped at 1). Stepped
// exactly every DT ms, so it never blows up at any stiffness. The shaft's skin is dragged along with the sleeve by
// skin = SKIN_MM * grip * tanh(v / 150) mm (taut toward the base going down, bunched toward the glans going up): the
// shaft zones are read that far along (the glans and its corona do not slide).
//
// Stimulation rate of zone Z at time t:  S_Z = w_Z * sum_{s in Z} p(s) * |v|   (v: the inner wall's sliding speed,
// mm/s; w_Z the zone's sensitivity weight). Displayed over REF (the default glans fully in a snug channel at
// 150 mm/s ~ 1). Totals integrate S_Z over time. A geometric estimate for comparing scripts and setups, not a
// measurement of sensation.
import { oscOf } from './physics.js';
import { radiusAt } from './toys.js';
import { meshProfile } from './penismesh.js';

export const DT = 5;               // ms per solver step (the Machine's dtMs)
// zone indices are stable (old results and settings): the corona band came last; DISPLAY is the anatomical order
export const ZONES = Object.freeze(['glans', 'upper', 'base', 'corona']);
export const DISPLAY = Object.freeze([0, 3, 1, 2]);
export const ZONE_LABEL = Object.freeze({ glans: 'glans', upper: 'shaft', base: 'base', corona: 'corona' });
export const WEIGHTS_DEFAULT = Object.freeze({ glans: 1, upper: 0.45, base: 0.25, corona: 1.2 });
const NZ = ZONES.length;

// ---- the body (personal: lives in settings only, never in a project, a pack or the usage log) ----
export const BODY_DEFAULT = Object.freeze({ lengthMm: 140, girthMm: 120, glansMm: 30, taper: 0.06, padMm: 15, knot: false });
export const BODY_LIMITS = Object.freeze({ lengthMm: [60, 300], girthMm: [60, 220], glansMm: [10, 60], taper: [0, 0.3], padMm: [0, 40] });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** A stored body made safe (missing or out-of-range numbers: the default / the limit). */
export function validBody(b) {
  const o = b && typeof b === 'object' ? b : {}, out = {};
  for (const k of Object.keys(BODY_LIMITS)) out[k] = Number.isFinite(+o[k]) && o[k] !== null && o[k] !== '' ? clamp(+o[k], ...BODY_LIMITS[k]) : BODY_DEFAULT[k];
  out.glansMm = Math.min(out.glansMm, 0.45 * out.lengthMm);
  out.padMm = Math.round(out.padMm);
  out.knot = o.knot === true;
  return out;
}

export const CORONA = 1.06;   // the corona's flare over the shaft just behind it
/** The penis as a toy-shaped profile {length_mm, profile [[s, r]] tip -> base and on into the root, glansMm, R, rootMm}:
 *  a rounded glans whose corona flares CORONA over the shaft, the sulcus behind it, a shaft tapering toward the tip, a
 *  base that widens a little into the body; with knot, a bulb near the base (toys with knots exist; off by default).
 *  With a mesh (penismesh.js, the realistic style; paw-45rb): the mesh's own mean radius per station instead (its
 *  taper and anatomy; the body's taper is not used). */
export function penisProfile(body, mesh = null) {
  if (mesh) return meshProfile(mesh, validBody(body));
  const b = validBody(body), L = b.lengthMm, g = b.glansMm, R = b.girthMm / (2 * Math.PI), root = b.padMm;
  const shaft = (s) => R * (1 - b.taper * (1 - Math.min(s, L) / L));
  const rC = shaft(g) * CORONA, profile = [];
  for (let s = 0; s <= L + root; s++) {
    let r;
    if (s <= g) {
      const u = Math.min(1, s / (0.85 * g));
      r = rC * (0.28 + 0.72 * Math.sqrt(1 - (1 - u) ** 2)) + 0.03 * rC * Math.exp(-(((s - 0.95 * g) / 2) ** 2));   // the dome, the corona's ridge
    } else r = shaft(s) * (1 - 0.08 * Math.exp(-(((s - g - 3) / 2.5) ** 2)));   // the sulcus
    if (s > L - 8) r *= 1 + 0.03 * Math.min(1, (s - (L - 8)) / 8);   // the base meets the body
    if (b.knot) r += 0.45 * R * Math.exp(-(((s - 0.86 * L) / (0.06 * L)) ** 2));
    profile.push([s, +r.toFixed(3)]);
  }
  return { length_mm: L, profile, glansMm: g, R, rootMm: root };
}

/** The zone of station s (mm from the tip): glans to just before the corona, the corona band (the ridge and the
 *  frenulum's level, 3 mm before to 4 mm past it), then the shaft split in half; the root is base. */
export function zoneOf(s, body) {
  const b = validBody(body), g = b.glansMm;
  return s < g - 3 ? 'glans' : s <= g + 4 ? 'corona' : s <= (g + 4 + b.lengthMm) / 2 ? 'upper' : 'base';
}

// ---- sleeves: generic parametric presets (plausible round numbers) and the named ones ----
// The named presets (the owner's request) are OUR plain parametric profile at the products' overall dimensions, kept
// in one table (SLEEVE_SPECS): a figure is verified only when its key is in `verified`, with the source; the rest are
// approximations to be replaced by measurements (the owner is collecting them). One plain channel each (a slight
// constriction near each entrance, roughly constant inside): not the products' interior textures.
// Product names are trademarks of their owners, used only to identify compatible sleeves (NOTICE).
// Figures (mm): `verified` lists the ones printed on the maker's graphics the owner supplied (2026-11-18), `stated` the
// maker's "up to" lengths relayed by the owner (read as the channel's depth: in these products the sleeve fills the
// case end to end, so only the end wall and cap are lost); every other figure was read off the owner's pictures against
// their rulers or against a verified length (approx.):
//  - Quickshot (the popular one, modelled closest): case 62 across (70 over its middle band); the channel from its
//    cross-section picture scaled to the 89 mm depth: symmetric, an 18 mm mouth at each end (about 14 mm long), then
//    four ring ridges ~10 mm across, ~16 mm apart (at 20.6, 36.5, 52.5 and 68.4 mm), rounded chambers ~20 mm across
//    between them;
//  - Flight Pilot: total ~195 to the slanted cap's middle (the cut-away picture, scaled by its stated 178 mm channel;
//    the shelf photo gave ~200); its case wide at the entrance end (~78) tapering to ~56 under the cap; channel: a
//    short entrance bulb, a constriction, a long canal, a narrower top section;
//  - GO: total ~208 (the advert, scaled by the classic beside it at 248), barrel ~55, flared entrance end ~80 (the
//    advert and the ruler picture differ: 76-86), the loose sleeve's flange seating in it;
//  - classic: barrel ~72, flared entrance end ~96 (the ruler picture).
// Diameters are estimates from proportion. The channels follow the cut-away pictures' coarse layout (a wider chamber
// behind the entrance, a narrower canal, tapering to the closed end), never their textures: [fraction of the depth,
// diameter] points.
/** The Quickshot's channel ([fraction of 89 mm, diameter]): mouths, four ridges, rounded chambers between them. */
function qsChannel() {
  const L = 89, ridges = [20.6, 36.5, 52.5, 68.4], pts = [[0, 18], [14, 18]];
  ridges.forEach((x, i) => {
    pts.push([x, 10]);
    if (i < ridges.length - 1) { const m = (x + ridges[i + 1]) / 2; pts.push([m - 4, 18], [m, 20], [m + 4, 18]); }
  });
  pts.push([75, 18], [L, 18]);
  return pts.map(([x, d]) => [+(x / L).toFixed(4), d]);
}
const OWNER_GRAPHIC = 'manufacturer graphic supplied by the owner 2026-11-18', UP_TO = "maker's 'up to' figure, relayed by the owner 2026-11-18";
export const SLEEVE_SPECS = Object.freeze({
  'fl-quickshot': { name: 'Fleshlight Quickshot', open: true, endCap: false, caseMm: 112, channelMm: 89, caseOuterMm: 62, bandOuterMm: 70, entranceOuterMm: 62, flare: null, entranceDiaMm: 17,
    channel: qsChannel(), soft: 0.4, verified: ['caseMm', 'channelMm'], stated: [], source: OWNER_GRAPHIC },
  'fl-pilot': { name: 'Fleshlight Flight Pilot', open: false, endCap: true, caseMm: 195, channelMm: 178, caseOuterMm: 56, bandOuterMm: null, entranceOuterMm: 78, flare: [0.3, 0.45], entranceDiaMm: 12,
    channel: [[0, 12], [0.08, 20], [0.17, 11], [0.3, 15], [0.6, 15], [0.8, 12], [1, 10]], soft: 0.45, verified: [], stated: ['channelMm'], source: UP_TO },
  'fl-go': { name: 'Fleshlight GO', open: false, endCap: true, caseMm: 208, channelMm: 203, caseOuterMm: 55, bandOuterMm: null, entranceOuterMm: 80, flare: [0.22, 0.14], entranceDiaMm: 12,
    channel: [[0, 12], [0.1, 19], [0.2, 12], [0.5, 14], [0.8, 12], [1, 10]], soft: 0.5, verified: [], stated: ['channelMm'], source: UP_TO },
  'fl-standard': { name: 'Fleshlight (standard)', open: false, endCap: true, caseMm: 248, channelMm: 216, caseOuterMm: 72, bandOuterMm: null, entranceOuterMm: 96, flare: [0.22, 0.14], entranceDiaMm: 12,
    channel: [[0, 12], [0.1, 20], [0.2, 13], [0.5, 15], [0.8, 13], [1, 11]], soft: 0.5, verified: ['caseMm', 'channelMm'], stated: [], source: OWNER_GRAPHIC },
});
/** What a named preset's figures rest on, for its tooltip. */
const tipHead = (sp, lengths) => {
  if (lengths) return 'Lengths from the maker, diameters approx.';
  if ((sp.stated || []).includes('channelMm')) return 'Depth as the maker states it, other sizes approx.';
  return 'Approx. dimensions, not measured yet';
};
/** A named preset from its spec: the channel at five stations, the case in front of the entrance (an open case: the
 *  spare length split over both ends; a closed one: flush). */
function fromSpec(id, sp) {
  const L = sp.channelMm, lengths = sp.verified.includes('channelMm') && sp.verified.includes('caseMm');
  return { id, name: sp.name, lengthMm: L, caseMm: sp.caseMm, caseOuterMm: sp.caseOuterMm, entranceOuterMm: sp.entranceOuterMm, ...(sp.bandOuterMm ? { bandOuterMm: sp.bandOuterMm } : {}), ...(sp.flare ? { flare: sp.flare } : {}),
    frontMm: sp.open ? Math.max(0, (sp.caseMm - L) / 2) : 0, open: sp.open, soft: sp.soft, profile: sp.channel.map(([f, dia]) => [+(f * L).toFixed(1), dia / 2]), verified: sp.verified.length > 0,
    tip: `${tipHead(sp, lengths)}\nOne plain channel, no texture` };
}
const flat = (len, r) => [[0, r], [len * 0.25, r], [len * 0.5, r], [len * 0.75, r], [len, r]];
export const SLEEVES = Object.freeze([
  { id: 'closed-long', name: 'Closed sleeve (long)', lengthMm: 200, open: false, soft: 0.5, profile: [[0, 7], [50, 9], [100, 9], [150, 9], [200, 10]], tip: 'A long closed sleeve: the tip stops at its end' },
  { id: 'closed-short', name: 'Closed sleeve (short)', lengthMm: 130, open: false, soft: 0.5, profile: [[0, 7], [32, 9], [65, 9], [98, 9], [130, 10]], tip: 'A short closed sleeve: the tip stops at its end' },
  { id: 'open-short', name: 'Open-ended short sleeve', lengthMm: 90, open: true, soft: 0.4, profile: [[0, 7], [22, 8], [45, 8], [68, 8], [90, 7]], tip: 'Open at both ends, the tip can pass through' },
  { id: 'ring', name: 'Ring stroker', lengthMm: 25, open: true, soft: 0.3, profile: flat(25, 8), tip: 'A short ring or open hand stroker' },
  ...Object.entries(SLEEVE_SPECS).map(([id, sp]) => fromSpec(id, sp)),
]);

/** A stored sleeve made safe, or null. {id, name, lengthMm, open, soft, profile: [[x, r], ...] from the entrance}. */
export function validSleeve(t) {
  if (!t || typeof t !== 'object' || !Array.isArray(t.profile) || !(+t.lengthMm > 5)) return null;
  const L = clamp(+t.lengthMm, 5, 400);
  const profile = t.profile.filter((p) => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1])).map(([x, r]) => [clamp(+x, 0, L), clamp(+r, 1, 60)]).sort((a, b) => a[0] - b[0]);
  if (profile.length < 2) return null;
  const num = (k, lo, hi) => (Number.isFinite(+t[k]) && +t[k] > 0 ? { [k]: clamp(+t[k], lo, hi) } : {});
  return { id: String(t.id || 's-' + Date.now().toString(36)), name: String(t.name || 'Sleeve').slice(0, 60), lengthMm: L, open: t.open !== false, soft: clamp(Number.isFinite(+t.soft) ? +t.soft : 0.5, 0, 1), profile,
    ...num('caseMm', L, 500), ...num('caseOuterMm', 10, 200), ...num('bandOuterMm', 10, 220), ...num('entranceOuterMm', 10, 220),
    ...(Array.isArray(t.flare) && t.flare.length === 2 && t.flare.every((x) => Number.isFinite(+x)) ? { flare: [clamp(+t.flare[0], 0, 1), clamp(+t.flare[1], 0.02, 1)] } : {}), frontMm: Number.isFinite(+t.frontMm) ? clamp(+t.frontMm, 0, 60) : 0,
    ...(t.verified ? { verified: true } : {}), ...(t.tip ? { tip: String(t.tip) } : {}) };
}

/** The sleeve for an id: a preset with the owner's edits (settings stroker.sleeves {id: sleeve}) on top, an imported
 *  one (stroker.imported), else the first preset. */
export function sleeveFor(id, edits = {}, imported = []) {
  const base = SLEEVES.find((s) => s.id === id) || imported.map(validSleeve).find((s) => s?.id === id) || SLEEVES[0];
  const e = edits?.[base.id];
  return (e && validSleeve({ ...base, ...e, id: base.id, name: base.name })) || validSleeve(base);
}

/** A sleeve from an imported toy profile (toys.js: [[s, r]] tip -> base): the traced shape is taken as the channel,
 *  its narrow end the entrance. */
export const sleeveFromToy = (toy) => validSleeve({ id: toy.id, name: toy.name, lengthMm: toy.length_mm, open: false, soft: 0.5, profile: toy.profile.map(([s, r]) => [s, r]) });

/** Channel radius at x mm from the entrance (linear between stations; Infinity outside the channel). */
export function channelAt(sl, x) {
  if (x < 0 || x > sl.lengthMm) return Infinity;
  // (toys.js radiusAt's arithmetic, without its per-call object: geometry() calls this some 35 000 times)
  const pr = sl.profile, n = pr.length;
  if (!n) return 0;
  if (x <= pr[0][0]) return pr[0][1];
  let lo = 0, hi = n - 1;
  if (x >= pr[hi][0]) return pr[hi][1];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pr[m][0] <= x) lo = m; else hi = m; }
  const [x0, r0] = pr[lo], [x1, r1] = pr[hi];
  return x1 > x0 ? r0 + ((r1 - r0) * (x - x0)) / (x1 - x0) : r0;
}

/** The hand's squeeze (grip 0..1, 0 = neutral): a caseless sleeve's channel narrows by up to GRIP_MM all along; a hard
 *  case takes the squeeze itself (no change). */
export const GRIP_MM = 3;
export function applyGrip(sl, grip) {
  const g = clamp(+grip || 0, 0, 1);
  if (!g || sl.caseMm) return sl;
  return { ...sl, profile: sl.profile.map(([x, r]) => [x, Math.max(1, r - g * GRIP_MM)]) };
}

/** The sleeve wall's outer radius when its channel (rest rc) is stretched to ri, its rest outer radius ro0: the wall
 *  keeps its cross-section (area), so it thins as it stretches: ro = sqrt(ro0^2 + ri^2 - rc^2). */
export const wallOuter = (rc, ri, ro0) => Math.sqrt(Math.max(0, ro0 * ro0 + ri * ri - rc * rc));

// ---- the stroke mapping ----
/** Default rig for a body: down at the base, up 15 mm short of the tip. */
export const rigDefault = (body) => ({ downMm: 0, upMm: Math.max(10, validBody(body).lengthMm - 15) });
/** A sensible stroke window for a sleeve on a body, set when the sleeve is picked: a short open sleeve (the Quickshot's
 *  use) travels over the upper shaft and the glans; a ring stays near the tip; a full-length closed sleeve gets nearly
 *  the whole travel. */
export function rigFor(body, sleeve) {
  const L = validBody(body).lengthMm;
  if (sleeve && sleeve.lengthMm < 40) return { downMm: Math.round(0.5 * L), upMm: L - 8 };
  if (sleeve && sleeve.open && sleeve.lengthMm < L) return { downMm: Math.round(0.4 * L), upMm: L - 25 };
  return rigDefault(body);
}
/** stroker.rig as stored (paw-garg): the markers as fractions of the length, as mm from the base would give the length
 *  back. Nothing is stored for the sleeve's own window (rigFor): the setting is null then. */
export const rigToStore = (rig, body) => { const L = validBody(body).lengthMm; return { down: rig.downMm / L, up: rig.upMm / L }; };
/** The stroke window from stroker.rig: fractions (rigToStore), an older {downMm, upMm}, else the sleeve's own (rigFor). */
export function rigOf(stored, body, sleeve) {
  const s = stored && typeof stored === 'object' ? stored : {}, L = validBody(body).lengthMm;
  if (Number.isFinite(s.down) && Number.isFinite(s.up)) return { downMm: Math.round(s.down * L), upMm: Math.round(s.up * L) };
  return { ...rigFor(body, sleeve), ...s };
}
/** The entrance (mm from the base) the script asks for at pos. */
export const entranceOf = (rig, pos) => rig.downMm + (pos / 100) * (rig.upMm - rig.downMm);
/** How far past the hilt the stroke window's markers go (mm from the base, negative), and the tables' start. */
export const EMIN = -60, ETAB = -80;
/** The lowest the entrance can go (past the hilt; the pressure there is soft, never a hard stop). */
export const entranceMin = () => EMIN;
/** The pubic pad at entrance e: {q: how far the case front is pushed past the hilt, c: how much of that the pad took
 *  (soft, at most the pad's depth), excess: the rest, pressing on bone}. */
export function padPress(geo, e) {
  const q = Math.max(0, (geo.sleeve.frontMm || 0) - e), pad = geo.body.padMm;
  const c = pad > 0 ? pad * (1 - Math.exp(-q / pad)) : 0;
  return { q, c, excess: q - c };
}
/** Where the channel's entrance really sits for a driven e: past the hilt the case front stops on the compressed pad
 *  (at -c), so the channel goes no deeper than that; the rest of the push is against bone. */
export const seated = (geo, e) => { const pp = padPress(geo, e); return pp.q > 0 ? (geo.sleeve.frontMm || 0) - pp.c : e; };
/** The shaft showing at entrance e: the visible length plus what the pressed pad gives up (at most the pad). */
export const exposedMm = (geo, e) => geo.L + padPress(geo, e).c;
/** Where the sleeve is pushed past its limits at entrance e: {endMm (a closed end pressed in by the tip), pastMm (the
 *  case front past the hilt), padMm (of that, taken by the pad), out (an open end: the tip is out of its far end)}. */
export function overrun(geo, e) {
  const pp = padPress(geo, e), eg = pp.q > 0 ? (geo.sleeve.frontMm || 0) - pp.c : e;
  return { endMm: geo.sleeve.open ? 0 : Math.max(0, geo.L - eg - geo.sleeve.lengthMm), pastMm: pp.q, padMm: pp.c, out: geo.sleeve.open && eg + geo.sleeve.lengthMm < geo.L, seat: eg };
}
const SOFT = { end: 0.8, pad: 0.35, bone: 1.2, mm: 6, boneMm: 4, baseZ: 15 };   // soft contact: saturating per station
export const SKIN_MM = 5;   // the shaft skin's drag with the sleeve at full grip

// ---- the geometry, tabulated per entrance position (1 mm) ----
/** Everything the hot loop needs for (body, sleeve, weights): per station the penis radius and zone (the root
 *  included); per entrance e (ETAB .. L + 1 mm) the summed pressure per zone and in all (the solver's grip). `mesh`:
 *  the realistic style's penis (penismesh.js; its profile, kept as geo.mesh for the view), else the parametric one. */
export function geometry(body, sleeve, weights = WEIGHTS_DEFAULT, mesh = null) {
  const b = validBody(body), pen = penisProfile(b, mesh), L = b.lengthMm, n = pen.profile.length, sl = sleeve, E = 1 - 0.6 * sl.soft;
  const rp = new Float32Array(n), zone = new Uint8Array(n);
  for (let s = 0; s < n; s++) { rp[s] = pen.profile[s][1]; zone[s] = ZONES.indexOf(zoneOf(s, b)); }
  const ne = L + 2 - ETAB, P = Array.from({ length: NZ }, () => new Float32Array(ne)), N = new Float32Array(ne);
  const geo = { body: b, sleeve: sl, L, rp, zone, E, P, N, mesh, glansN:Math.max(1, zone.filter((z) => z === 0).length), w: ZONES.map((z) => clamp(+(weights?.[z] ?? WEIGHTS_DEFAULT[z]) || 0, 0, 2)) };
  for (let i = 0; i < ne; i++) {
    for (let s = 0; s < n; s++) {
      const p = pressureAt(geo, s, i + ETAB);
      if (p > 0) { P[zone[s]][i] += p; N[i] += p; }
    }
  }
  return geo;
}

/** Contact pressure (0 .. ~1) at station s (mm from the tip) with the entrance at e (mm from the base). */
export function pressureAt(geo, s, e) {
  const sl = geo.sleeve, pp = padPress(geo, e), z = geo.L - s, x = z - (pp.q > 0 ? (sl.frontMm || 0) - pp.c : e);   // (the seated entrance)
  if (z < -pp.c) return 0;   // the root under the pad, not pressed out
  let p = 0;
  // the case front past the hilt: the pad compressing (soft), then bone (steep, finite), on the stations at the body
  const zb = z + pp.c;
  if (pp.q > 0 && zb < SOFT.baseZ) {
    const pad = geo.body.padMm, soft = pad > 0 ? SOFT.pad * (pp.c / pad) ** 2 : 0;
    p += geo.E * (soft + SOFT.bone * (1 - Math.exp(-pp.excess / SOFT.boneMm))) * (1 - zb / SOFT.baseZ);
  }
  // a closed end pressed in by the tip; the stations past the end plane keep the channel's grip at its end and press
  // on the end wall as well (continuous as a station crosses the plane)
  const past = !sl.open && x > sl.lengthMm;
  if (past) p += geo.E * SOFT.end * (1 - Math.exp(-(x - sl.lengthMm) / SOFT.mm));
  const rc = channelAt(sl, past ? sl.lengthMm : x);
  if (!Number.isFinite(rc)) return p;
  const d = geo.rp[s] - rc;
  return d > 0 ? p + (geo.E * d) / (rc + d) : p;
}

const tab = (T, e0) => { const e = e0 - ETAB; if (!(e > 0)) return T[0]; const n = T.length - 1; if (e >= n) return T[n]; const i = Math.floor(e), f = e - i; return T[i] + (T[i + 1] - T[i]) * f; };
const SHAFT = [false, true, true, false];   // the zones whose skin slides with the sleeve
/** Summed pressure per zone (ZONES order) at entrance e, the shaft zones read `skin` mm along (interpolated). */
export const zonePressure = (geo, e, skin = 0) => geo.P.map((T, z) => tab(T, SHAFT[z] ? e - skin : e));
/** The skin's drag (mm, + toward the tip) for the inner wall at e moving at v. */
export const skinOf = (geo, e, v) => SKIN_MM * Math.min(1, tab(geo.N, e) / NREF) * Math.tanh(v / 150);
/** A closed end's suction (summed pressure on the glans) while the sleeve is drawn off (v > 0) with its end near the
 *  tip: SUCK.p at full speed and no gap, falling off over SUCK.mm of gap between the tip and the end; none for an open
 *  sleeve, none going down, none without a seal (scaled by the grip). */
export const SUCK = Object.freeze({ p: 3, mm: 12, v: 200 });
export function suctionOf(geo, e, v) {
  const sl = geo.sleeve;
  if (sl.open || !(v > 0)) return 0;
  const gap = Math.max(0, seated(geo, e) + sl.lengthMm - geo.L);
  const seal = Math.min(1, tab(geo.N, e) / NREF);   // (a loose channel holds no air)
  return geo.E * SUCK.p * seal * Math.exp(-gap / SUCK.mm) * Math.tanh(v / SUCK.v);
}
export const NREF = 20;            // grip at which the friction lag is full (summed pressure: about half a snug sleeve on)
export const REF = 30 * 0.3 * 150; // the default glans fully in a snug channel at 150 mm/s

// ---- the soft-body step ----
/** Solver constants for a sleeve: its exact oscillator (physics.js oscOf) and its friction lag. */
export function solverOf(sleeve) {
  const soft = sleeve.soft;
  return { osc: oscOf(8 + 14 * soft, 0.3, DT), lagMax: 1.5 + 6 * soft };
}
/** One step: the shell moved from c0 to c1 (mm, entrance from the base) over DT; st = {e, v} (the inner wall). */
export function stepSleeve(st, c0, c1, geo, sv) {
  const dts = DT / 1000, vc = (c1 - c0) / dts, K = sv.osc.sub[0], O = sv.osc;
  const grip = Math.min(1, tab(geo.N, st.e) / NREF), lag = sv.lagMax * grip * Math.tanh(st.v / 60);
  const y0 = st.e - c0 + lag, u0 = st.v - vc;   // in the shell's frame, about the friction-shifted rest point
  const e = c1 - lag + K.e * (K.c * y0 + (u0 + O.zw * y0) * K.s);
  let v = vc + K.e * (K.c * u0 - (O.w2 * y0 + O.zw * u0) * K.s);
  st.e = Math.max(ETAB, e);   // (past the hilt the contact is soft: no stop but the tables' end)
  if (st.e === ETAB && v < 0) v = 0;
  st.v = v;
  return st;
}

/** The script's pos at t (linear; j: a running index hint {j}). */
function posAtFast(sc, t, h) {
  const n = sc.length;
  if (!n) return 50;
  if (t <= sc[0].at) { h.j = 0; return sc[0].pos; }
  while (h.j < n - 1 && sc[h.j + 1].at <= t) h.j++;
  while (h.j > 0 && sc[h.j].at > t) h.j--;
  const A = sc[h.j], B = sc[h.j + 1];
  return !B ? A.pos : A.pos + ((B.pos - A.pos) * (t - A.at)) / (B.at - A.at);
}
const lowerIdx = (sc, t) => { let lo = 0, hi = sc.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sc[m].at < t) lo = m + 1; else hi = m; } return Math.max(0, lo - 1); };

/** The sleeve's drive (shell entrance, mm from the base) at t: the rig's mapping, held at the markers' range. */
export const driveAt = (sc, t, rig, eMin = EMIN, h = { j: lowerIdx(sc, t) }) => Math.max(eMin, entranceOf(rig, posAtFast(sc, t, h)));

export const SETTLE_MS = 500;      // the inner wall forgets its start within this (damping 0.3 at >= 7 Hz: ~7 time constants)

/**
 * The state at t: the inner wall {e, v} (integrated over the SETTLE_MS before t from rest on the drive; a pure function
 * of the inputs), the skin's drag, the live heat per station (S per station, low-passed over 120 ms) and per zone now.
 * -> {e, drive, v, skin, heat: Float32Array (stations, tip -> root), zone: [...ZONES] (S / REF), pressure, ...overrun}
 */
export function stateAt(sc, t, rig, geo, sv = solverOf(geo.sleeve)) {
  const t0 = Math.floor((t - SETTLE_MS) / DT) * DT, h = { j: lowerIdx(sc, t0) };
  let c0 = driveAt(sc, t0, rig, EMIN, h);
  const st = { e: c0, v: 0 }, n = geo.rp.length, heat = new Float32Array(n), k = 1 - Math.exp(-DT / 120);
  for (let tt = t0 + DT; tt <= t + 1e-9; tt += DT) {
    const c1 = driveAt(sc, tt, rig, EMIN, h);
    stepSleeve(st, c0, c1, geo, sv);
    c0 = c1;
    if (tt > t - 300) {
      const sk = skinOf(geo, st.e, st.v), av = Math.abs(st.v), su = suctionOf(geo, st.e, st.v) / geo.glansN;
      for (let s = 0; s < n; s++) { const z = geo.zone[s], q = geo.w[z] * (pressureAt(geo, s, SHAFT[z] ? st.e - sk : st.e) + (z === 0 ? su : 0)) * av; heat[s] += (q - heat[s]) * k; }
    }
  }
  const skin = skinOf(geo, st.e, st.v), suction = suctionOf(geo, st.e, st.v), zp = zonePressure(geo, st.e, skin), av = Math.abs(st.v);
  zp[0] += suction;
  return { e: st.e, drive: c0, v: st.v, skin, suction, heat, zone: zp.map((p, i) => (geo.w[i] * p * av) / REF), pressure: zp, ...overrun(geo, st.e) };
}

/**
 * The whole script, off the frame path: per BUCKET ms the mean stimulation per zone (S / REF) and the strokes (between
 * turns of the drive) with their per-zone integrals. Chunked: a generator that yields every `slice` steps (the caller
 * resumes it between frames); its return value is the result.
 * -> {t0, bucket, z: [Float32Array per zone], end, past (fraction of each bucket), strokes: [{t0, t1, z: [...]}]}
 */
export const BUCKET = 50;
export function* integrate(sc, rig, geo, { slice = 20000 } = {}) {
  const empty = () => Array.from({ length: NZ }, () => new Float32Array(0));
  const out = { t0: 0, bucket: BUCKET, z: empty(), end: new Float32Array(0), past: new Float32Array(0), strokes: [] };
  if (!sc?.length) return out;
  const sv = solverOf(geo.sleeve), T0 = Math.floor(sc[0].at / DT) * DT, T1 = sc[sc.length - 1].at + 500;
  const nb = Math.ceil((T1 - T0) / BUCKET) + 1;
  out.t0 = T0; out.z = Array.from({ length: NZ }, () => new Float32Array(nb)); out.end = new Float32Array(nb); out.past = new Float32Array(nb);
  const h = { j: 0 }, zero = () => new Array(NZ).fill(0);
  let c0 = driveAt(sc, T0, rig, EMIN, h), dir = 0, cur = { t0: T0, t1: T0, z: zero() }, k = 0;
  const st = { e: c0, v: 0 }, per = BUCKET / DT;
  for (let tt = T0 + DT; tt <= T1; tt += DT) {
    const c1 = driveAt(sc, tt, rig, EMIN, h);
    const d = Math.sign(c1 - c0);
    if (d && dir && d !== dir) { cur.t1 = tt; out.strokes.push(cur); cur = { t0: tt, t1: tt, z: zero() }; }
    if (d) dir = d;
    stepSleeve(st, c0, c1, geo, sv);
    c0 = c1;
    const av = Math.abs(st.v), b = Math.floor((tt - T0) / BUCKET), sk = skinOf(geo, st.e, st.v), su = suctionOf(geo, st.e, st.v);
    for (let z = 0; z < NZ; z++) { const S = (geo.w[z] * (tab(geo.P[z], SHAFT[z] ? st.e - sk : st.e) + (z === 0 ? su : 0)) * av) / REF; out.z[z][b] += S / per; cur.z[z] += (S * DT) / 1000; }
    const o = overrun(geo, st.e);
    if (o.endMm > 0) out.end[b] += 1 / per;
    if (o.pastMm > 0) out.past[b] += 1 / per;
    if (++k % slice === 0) yield k;
  }
  cur.t1 = T1; if (cur.z.some((x) => x > 0)) out.strokes.push(cur);
  return out;
}
/** Runs integrate() to the end (tests, small scripts). */
export function integrateAll(sc, rig, geo) { const it = integrate(sc, rig, geo, { slice: Infinity }); let r = it.next(); while (!r.done) r = it.next(); return r.value; }

const sumOf = (a) => a.reduce((x, y) => x + y, 0);
/**
 * Totals over [a, b] ms of an integrate() result: {sum, share, mean (per second): per zone in ZONES order, glansStrokes
 * (0..1: strokes in which the glans or its corona was stroked at all, over strokes in range), strokes, endFrac,
 * pastFrac (of the time)}.
 */
export function totals(res, a = -Infinity, b = Infinity) {
  const sum = new Array(NZ).fill(0);
  if (!res?.z?.[0]?.length) return { sum, share: sum.slice(), glansStrokes: 0, strokes: 0, mean: sum.slice(), endFrac: 0, pastFrac: 0 };
  const i0 = Math.max(0, Math.floor((a - res.t0) / res.bucket)), i1 = Math.min(res.z[0].length - 1, Math.floor((b - res.t0) / res.bucket));
  let endB = 0, pastB = 0;
  for (let i = i0; i <= i1; i++) { for (let z = 0; z < res.z.length; z++) sum[z] += (res.z[z][i] * res.bucket) / 1000; endB += res.end?.[i] || 0; pastB += res.past?.[i] || 0; }
  const all = sumOf(sum), secs = Math.max(1e-9, ((i1 - i0 + 1) * res.bucket) / 1000);
  const st = res.strokes.filter((s) => s.t1 > a && s.t0 < b), moving = st.filter((s) => sumOf(s.z) > 1e-4);
  const gl = moving.filter((s) => { const g = s.z[0] + (s.z[3] || 0); return g > 0.02 * sumOf(s.z) && g > 1e-4; }).length;
  const nB = Math.max(1, i1 - i0 + 1);
  return { sum, share: sum.map((x) => (all > 0 ? x / all : 0)), glansStrokes: moving.length ? gl / moving.length : 0, strokes: moving.length, mean: sum.map((x) => x / secs), endFrac: endB / nB, pastFrac: pastB / nB };
}

/** "glans 40 %, corona 22 %, shaft 30 %, base 8 %; glans-time 71 % of strokes" (empty without contact). */
export function totalsText(t) {
  if (!t || !(sumOf(t.sum) > 0)) return 'no sliding contact';
  const p = (x) => `${Math.round(x * 100)} %`;
  const extra = [t.endFrac > 0.005 ? `end contact ${p(t.endFrac)} of the time` : '', t.pastFrac > 0.005 ? `past hilt ${p(t.pastFrac)}` : ''].filter(Boolean);
  return `${DISPLAY.map((i) => `${ZONE_LABEL[ZONES[i]]} ${p(t.share[i])}`).join(', ')}; glans-time ${p(t.glansStrokes)} of strokes${extra.length ? `; ${extra.join(', ')}` : ''}`;
}
