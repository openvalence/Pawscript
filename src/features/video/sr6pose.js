// sr6pose.js -- the six-axis preview's pure parts (paw-jyde.2; Sr6View.svelte draws them; test/sr6pose.test.mjs).
// World frame (mm), drawn, NOT a device frame. It is the WEARER's (the person the fixed shaft belongs to): the floor is their
// body at the shaft's base; y = along the shaft, away from them (the stroke); z = the wearer's up (toward their head; the
// receiving body's back in rear entry); x = the wearer's LEFT. Every number here is UNVERIFIED (no SR6 to compare with).
//   stroke 0 = deepest (the receiver low on the shaft, at the wearer), 100 = out; the five others 50 = centre.
// Signs follow lib/six-axis.js (its "rear" view = the camera along the shaft from the wearer's side = the "you" view here):
//   sway + = +x = the wearer's left (six-axis: the receiving body's left seen from behind; on screen in "you": LEFT);
//   surge + = +z = the wearer's up (six-axis: up in the picture of that view); twist + = counter-clockwise as the wearer sees it
//   (looking along the shaft); roll (about the up axis z) + = counter-clockwise seen from above the wearer's head looking down
//   the shaft (six-axis: roll + = counter-clockwise in its high-angle POV / top view): the receiver's top tips to the wearer's
//   left; pitch (about the left-right axis x) + = the receiver's top tips toward the wearer's down (counter-clockwise seen from
//   their left side; six-axis gives no side for it: unverified).
// Rotations are about the receiver's middle, in the order twist, roll, pitch, then the translation.
export const IDS = ['stroke', 'surge', 'sway', 'twist', 'roll', 'pitch'];
export const ROT = ['twist', 'roll', 'pitch'];
export const TCODE = { stroke: 'L0', surge: 'L1', sway: 'L2', twist: 'R0', roll: 'R1', pitch: 'R2' };

/** Full-scale travel per axis: stroke = mm from 0 to 100; surge / sway = mm from centre to 0 or 100; twist / roll / pitch =
 *  degrees from centre to 0 or 100. ALL GUESSES: T-code itself carries no units (each axis is 0..9999 of whatever the device
 *  can do), the bead's research (paw-jyde) gives no SR6 travel, and there is no device here to measure. Round numbers of the
 *  order SR6-class builds are talked about; the preview only has to look plausible, never measure. */
export const RANGE = {
  stroke: { mm: 120 },   // GUESS: a typical stroker rail
  surge: { mm: 30 },     // GUESS
  sway: { mm: 30 },      // GUESS
  twist: { deg: 90 },    // GUESS: a twist receiver on a hobby servo
  roll: { deg: 30 },     // GUESS
  pitch: { deg: 30 },    // GUESS
};
// drawn sizes (mm): the fixed shaft from the floor up, the receiver (a sleeve with its opening at the bottom)
export const SHAFT = { r: 13, len: 150 };
export const SLEEVE = { r: 24, len: 80, y0: 15 };   // y0: the opening's height at stroke 0
const D = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const c50 = (v) => ((Number.isFinite(v) ? v : 50) - 50) / 50;

/** The six values with every axis but `solo` held at centre (stroke too); no solo = the values themselves. */
export function masked(vals, solo) {
  if (!solo || !IDS.includes(solo)) return vals;
  return Object.fromEntries(IDS.map((id) => [id, id === solo ? vals?.[id] : 50]));
}

/** {stroke, surge, sway, twist, roll, pitch} (0..100, missing / NaN = centre) and k = exaggeration of the five secondary
 *  axes -> {p: the receiver's middle [x, y, z] mm, r: {twist, roll, pitch} rad}. */
export function pose(vals, k = 1) {
  const a = vals || {}, e = (id) => clamp(c50(a[id]) * k, -1, 1);
  const s = Number.isFinite(a.stroke) ? clamp(a.stroke, 0, 100) / 100 : 0.5;
  return {
    p: [e('sway') * RANGE.sway.mm, SLEEVE.y0 + SLEEVE.len / 2 + s * RANGE.stroke.mm, e('surge') * RANGE.surge.mm],
    r: { twist: e('twist') * RANGE.twist.deg * D, roll: e('roll') * RANGE.roll.deg * D, pitch: e('pitch') * RANGE.pitch.deg * D },
  };
}

/** A receiver-local point (origin = its middle, y along it, z = its up side: the stripe) -> world. */
export function place(P, v) {
  let [x, y, z] = v;
  const { twist: t, roll: r, pitch: q } = P.r;
  [x, z] = [x * Math.cos(t) + z * Math.sin(t), -x * Math.sin(t) + z * Math.cos(t)];  // +twist: +x toward -z (ccw as the wearer sees it)
  [x, y] = [x * Math.cos(r) + y * Math.sin(r), -x * Math.sin(r) + y * Math.cos(r)];  // +roll: the top (+y) tips to +x (the wearer's left)
  [z, y] = [z * Math.cos(q) - y * Math.sin(q), z * Math.sin(q) + y * Math.cos(q)];   // +pitch: the top (+y) tips to -z (the wearer's down)
  return [x + P.p[0], y + P.p[1], z + P.p[2]];
}
/** The opening's centre (local bottom of the sleeve) in world mm. */
export const openingOf = (P) => place(P, [0, -SLEEVE.len / 2, 0]);

// ---- views ----
/** Each view: away = where the camera looks, up = roughly up on screen (world vectors); right = up x away. Order = the buttons.
 *  "you" is the wearer's own eye: behind the shaft's base, raised toward their head, looking down along the shaft. */
const B35 = 35 * D, B25 = 25 * D;
const yawTilt = (yaw, tilt) => { const p = yaw * D, t = tilt * D; return { away: [-Math.sin(p) * Math.cos(t), -Math.sin(t), Math.cos(p) * Math.cos(t)], up: [-Math.sin(p) * Math.sin(t), Math.cos(t), Math.cos(p) * Math.sin(t)] }; };
// What each view shows (the tips name only the best axes): iso a little of every axis; you = the wearer's right on the
// picture's right, sway + to the left, pitch hardly shows; facing and feet are mirrored (the wearer's right on the
// picture's left), the stroke hardly shows when facing; side and feet: the shaft up the picture, side hides sway and
// roll, feet hides surge and pitch.
export const VIEWS = {
  iso: { ...yawTilt(35, 22), label: '3/4', tip: 'Three-quarter view from your left, every axis shows' },
  you: { away: [0, Math.cos(B35), -Math.sin(B35)], up: [0, Math.sin(B35), Math.cos(B35)], label: 'you',
    tip: 'The wearer’s view, your right on the picture’s right' },
  facing: { away: [0, -Math.cos(B25), -Math.sin(B25)], up: [0, -Math.sin(B25), Math.cos(B25)], label: 'facing',
    tip: 'Facing the wearer, your right is on the picture’s LEFT' },
  side: { away: [-1, 0, 0], up: [0, 1, 0], label: 'side', tip: 'From your left side: stroke, surge and pitch show best' },
  feet: { away: [0, 0, 1], up: [0, 1, 0], label: 'feet', tip: 'From your feet, your right on the picture’s LEFT' },
};
/** A remembered view name -> a view key: older names stay valid (rear was the camera at the wearer's feet, top looked back down
 *  the shaft); anything else = 3/4. */
const OLD = { rear: 'feet', top: 'facing', front: 'facing' };
export const viewOf = (v) => (VIEWS[v] ? v : OLD[v] || 'iso');
const CENTRE = [0, 110, 0], DIST = 900;
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unitV = (a) => { const n = Math.hypot(...a) || 1; return a.map((x) => x / n); };
/** Camera basis of a view: right, up (screen) and away (depth) unit vectors in world coords (away = right x up). */
export function basis(view) {
  const v = VIEWS[viewOf(view)], away = unitV(v.away), right = unitV(cross(v.up, away)), up = cross(away, right);
  return { right, up, away };
}const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** World mm -> [screen x (right +), screen y (up +), depth (away +)] in mm about the scene centre, mild perspective. */
export function project(view, v, B = basis(view)) {
  const d = [v[0] - CENTRE[0], v[1] - CENTRE[1], v[2] - CENTRE[2]], z = dot(d, B.away), f = DIST / (DIST + z);
  return [dot(d, B.right) * f, dot(d, B.up) * f, z];
}
const BOUNDS = [-62, 62, 0, SLEEVE.y0 + RANGE.stroke.mm + SLEEVE.len + 6, -62, 62];   // x, y, z extents the scene can reach
/** A view fitted into w x h canvas px: v (world mm) -> [px x, px y (down +), depth]. Same scale for every pose of a view. */
export function viewport(view, w, h, pad = 8) {
  const B = basis(view), [x0, x1, y0, y1, z0, z1] = BOUNDS;
  let a = Infinity, b = -Infinity, c = Infinity, e = -Infinity;
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) { const [sx, sy] = project(view, [x, y, z], B); a = Math.min(a, sx); b = Math.max(b, sx); c = Math.min(c, sy); e = Math.max(e, sy); }
  const s = Math.min((w - 2 * pad) / (b - a), (h - 2 * pad) / (e - c)), ox = w / 2 - ((a + b) / 2) * s, oy = h / 2 + ((c + e) / 2) * s;
  const px = (v) => { const [sx, sy, z] = project(view, v, B); return [ox + sx * s, oy - sy * s, z]; };
  px.scale = s; px.basis = B;
  return px;
}

/** Convex hull of [x, y] points (monotone chain): a tilted cylinder's outline = the hull of its two end rings. */
export function hull(pts) {
  const s = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => { const h = []; for (const q of list) { while (h.length >= 2 && cr(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop(); h.push(q); } h.pop(); return h; };
  return s.length < 3 ? s : half(s).concat(half(s.slice().reverse()));
}

// ---- values ----
/** Interpolated value per axis at t (posAt: the device plays the straight line between points); NaN = no script. */
export function valuesAt(scripts, t, posAt) {
  return Object.fromEntries(IDS.map((id) => { const s = scripts?.[id]; return [id, s?.length ? posAt(s, t) : NaN]; }));
}
/** The opening's path over the last `span` ms (oldest first), as the preview poses it. */
export function trail(scripts, t, posAt, { k = 1, solo = null, span = 1000, n = 30 } = {}) {
  const out = [];
  for (let i = n; i >= 0; i--) out.push(openingOf(pose(masked(valuesAt(scripts, t - (span * i) / n, posAt), solo), k)));
  return out;
}
/** Which scripts are previewed: the followed ones (the Track tab's running track) over the lanes. -> {scripts, src}. */
export function pickScripts(followed, lanes) {
  const f = followed || {}, scripts = Object.fromEntries(IDS.map((id) => [id, f[id] ?? lanes?.[id] ?? null]));
  return { scripts, src: IDS.some((id) => f[id]) ? 'unapplied' : 'script' };
}
/** Has the script points in [t0, t1] (the shot), or a line running through it? No shot: any points. */
export function hasData(s, shot) {
  if (!s?.length) return false;
  if (!shot) return true;
  return s.some((p) => p.at >= shot.start_ms && p.at <= shot.end_ms) || (s[0].at < shot.start_ms && s[s.length - 1].at > shot.end_ms);
}
/** The axes ghost segment that covers t (label not 'none') -> {label ('measured' | 'estimate'), guessed (the view or the solo
 *  reading's up is a guess), frame (a solo reading: its info) | null, from (the measurement)} | null. */
export function qualityAt(segs, t) {
  const g = (segs || []).find((s) => s.label && s.label !== 'none' && t >= s.t0 && t < s.t1);
  if (!g) return null;
  return { label: g.label, guessed: !!(g.guessed || g.frame?.refGuess || g.frame?.facing), frame: g.frame || null, from: g.from || null };
}

// ---- gauges ----
export const ARC = 70 * D;   // a rotation gauge's needle sweep each side of centre (display only)
/** One gauge: translations a bar (f = 0..1 along it; secondary ones have a centre mark), rotations an arc (a = needle angle,
 *  + = clockwise on screen). has = a value to show. */
export function gauge(id, v) {
  const has = Number.isFinite(v), x = has ? clamp(v, 0, 100) : 50;
  return ROT.includes(id) ? { kind: 'arc', has, v: x, a: ((x - 50) / 50) * ARC } : { kind: 'bar', has, v: x, f: x / 100, centre: id !== 'stroke' };
}

// ---- the floating box (stage px) ----
export const BOX = { w: 270, min: 176, max: 560, gap: 10, gapB: 34 };   // gapB: room under it for the stage's tool hint (bottom-left)
/** Inside the box: the header, the 3-D view, two rows of three gauges. */
export function layout(w) {
  const pad = 6, head = 20, vh = Math.round(w * 0.78), gh = 36, cw = (w - 2 * pad) / 3, gy = pad + head + vh;
  return { w, h: gy + 2 * gh + pad, head, view: { x: 0, y: pad + head, w, h: vh },
    gauges: IDS.map((id, i) => ({ id, x: pad + (i % 3) * cw, y: gy + Math.floor(i / 3) * gh, w: cw, h: gh })) };
}
const unit = (v) => Number.isFinite(v) && v >= 0 && v <= 1;
/** The stored placement {fx, fy (where the box sits in the free room: 0 = left / top, 1 = right / bottom), w} in a stage of
 *  W x H -> {x, y, w, h}, inside the stage. Broken / missing settings = the default (bottom-left, BOX.w). */
export function boxOf(st, W, H) {
  const g = BOX.gap, gv = g + BOX.gapB, hOf = (w) => layout(w).h;
  let w = clamp(Number.isFinite(st?.w) ? st.w : BOX.w, BOX.min, BOX.max);
  while (w > BOX.min && (w > W - 2 * g || hOf(w) > H - gv)) w = Math.max(BOX.min, w - 4);   // a small stage: shrink to fit
  const h = hOf(w), fx = unit(st?.fx) ? st.fx : 0, fy = unit(st?.fy) ? st.fy : 1;
  return { x: g + fx * Math.max(0, W - w - 2 * g), y: g + fy * Math.max(0, H - h - gv), w, h };
}
/** A box at (x, y, w) -> its stored placement in a W x H stage. */
export function boxStore(x, y, w, W, H) {
  const g = BOX.gap, gv = g + BOX.gapB, h = layout(w).h, fx = W - w - 2 * g > 0 ? clamp((x - g) / (W - w - 2 * g), 0, 1) : 0, fy = H - h - gv > 0 ? clamp((y - g) / (H - h - gv), 0, 1) : 1;
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  return { fx: r4(fx), fy: r4(fy), w: Math.round(w) };
}
/** Move by (dx, dy) px. */
export const boxMove = (b, dx, dy, W, H) => boxStore(b.x + dx, b.y + dy, b.w, W, H);
/** Resize from the top-right corner by (dx, dy) px: the bottom-left corner stays (the larger of the two pulls wins). */
export function boxResize(b, dx, dy, W, H) {
  const grow = Math.abs(dx) >= Math.abs(dy) ? dx : -dy * (b.w / b.h), w = clamp(b.w + grow, BOX.min, BOX.max), h = layout(w).h;
  return boxStore(b.x, b.y + b.h - h, w, W, H);
}
