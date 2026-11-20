/**
 * icons.js -- the kit's icon set, drawn for it in Phosphor's icon style (ui/navIcons.js there): a 16-unit
 * viewBox, open strokes at 1.5 in currentColor with round caps and joins. An entry is a stroke path `d`, or
 * { s, f } with a stroked part and a filled part (transport glyphs, dots).
 * Render with <Icon name="play" />. The list is in README.md and docs/icons.md; ICON_NAMES has it at runtime.
 *
 * Drawing rules (keep them when adding a glyph; _demo/IconsDemo.svelte ?mode=grid shows the keylines):
 * - Pixel grid. A 1.5 stroke centred on a quarter line (n.25 or n.75) covers one whole pixel plus a half at
 *   1x and lands on whole device pixels at 2x. Every horizontal and vertical stroke centre sits on a quarter
 *   line, never on a whole or half unit. Silhouette edges are outer-crisp: left and top edges at n.75, right
 *   and bottom edges at n.25 (the solid pixel is the outside one), so a frame from 2.75 to 13.25 is
 *   symmetric about 8. Each closed part follows that on its own (grid's cells: 2.75..6.25 and 9.75..13.25,
 *   so the gap between them stays clear). Free parallel lines (menu, list, log rows) all sit at n.75. A
 *   single centre axis (a plus, an arrow shaft, the stem of info or a clock hand) sits at 7.75, never 8: the
 *   quarter offset is invisible at 1x and buys a crisp line at 1x and 2x. test/kit-icons.test.mjs checks
 *   every straight stroke for this. Filled parts
 *   have edges on whole units; a filled transport glyph is a fill plus the same path stroked, so its corners
 *   get the stroke's 0.75 radius like every stroked corner.
 * - Live area. Square glyphs fill 2..14 (outer edge, stroke included: 12 units, 2 padding); round glyphs
 *   overshoot by 0.5 (status circles r 5.75 about 8: 1.5..14.5); triangles overshoot further. Nothing
 *   reaches past 1..15. Corners are the stroke's own round join (0.75), arcs only where the object is round.
 * - Metaphors. One glyph per idea: select = dashed marquee, roi = corner brackets with a centre cross,
 *   target = rings, crosshair = ring with ticks; export/import = arrow leaving/entering a bracket (sideways),
 *   upload/download = arrow up/down on a tray; cut = scissors (one glyph, two names); split = clip halves
 *   with the razor line between; fullscreen = corner brackets, expand/collapse = diagonal arrows,
 *   zoom-fit = |<->|.
 */

const r2 = (v) => Math.round(v * 100) / 100;
const C = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
const dot = (cx, cy, r = 1) => C(cx, cy, r);
/** The point at clock angle `deg` (0 = up, clockwise) on a circle. */
const at = (cx, cy, r, deg) => {
  const a = (deg * Math.PI) / 180;
  return `${r2(cx + r * Math.sin(a))} ${r2(cy - r * Math.cos(a))}`;
};
/** An open arc from clock angle a0 to a1 (clockwise when a1 > a0). */
const arc = (cx, cy, r, a0, a1) =>
  `M${at(cx, cy, r, a0)}A${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${at(cx, cy, r, a1)}`;
/** An arc from a0 to a1 (clockwise when a1 > a0) with an arrowhead of size s at its end, along the travel. */
const cycle = (cx, cy, r, a0, a1, s = 2) => {
  const d = a1 + (a1 > a0 ? 90 : -90), [x, y] = at(cx, cy, r, a1).split(' ').map(Number);
  return arc(cx, cy, r, a0, a1) + `M${at(x, y, s, d + 135)}L${x} ${y}L${at(x, y, s, d - 135)}`;
};
/** A filled cog ring: n teeth from rRoot to rTip, a hole of rHole (drawn the other way round: nonzero fill). */
function cog(n, rRoot, rTip, halfRoot, halfTip, rHole) {
  const step = 360 / n;
  let d = '';
  for (let i = 0; i < n; i++) {
    const c = i * step;
    d += `${i ? 'L' : 'M'}${at(8, 8, rRoot, c - halfRoot)}L${at(8, 8, rTip, c - halfTip)}`
      + `A${rTip} ${rTip} 0 0 1 ${at(8, 8, rTip, c + halfTip)}L${at(8, 8, rRoot, c + halfRoot)}`
      + `A${rRoot} ${rRoot} 0 0 1 ${at(8, 8, rRoot, c + step - halfRoot)}`;
  }
  return d + 'z' + C(8, 8, rHole);
}
/** Stroke and fill of one path: a solid glyph with the stroke's round corners. */
const solid = (d) => ({ s: d, f: d });

const LASSO = 'M8 2.5C4.9 2.5 2.5 4.1 2.5 6s2.4 3.5 5.5 3.5c.9 0 1.7-.1 2.4-.4M10.4 9.1c.5.8.1 1.8-.9 2.4-.9.5-.8 1.7-1.5 2.2M13.5 6c0-1.9-2.4-3.5-5.5-3.5';
const SPEAKER = 'M2.75 6.25h2.5l3-2.75v9l-3-2.75h-2.5z';
const EYE = 'M2.25 8C3.6 5.4 5.6 4 8 4s4.4 1.4 5.75 4C12.4 10.6 10.4 12 8 12S3.6 10.6 2.25 8z';
const LINK_A = 'M7 4.75L8.25 3.5a2.65 2.65 0 0 1 3.75 3.75L10.75 8.5';
const LINK_B = 'M9 11.25L7.75 12.5A2.65 2.65 0 0 1 4 8.75L5.25 7.5';
const SQUARE = 'M2.75 2.75h10.5v10.5H2.75z';
const STATUS = C(8, 8, 5.75);
const SCISSORS = C(5, 11.5, 1.75) + C(11, 11.5, 1.75) + 'M6.25 10.25L11.25 2.75M9.75 10.25L4.75 2.75';
const MAGNET = 'M2.75 2.75v5a5.25 5.25 0 0 0 10.5 0v-5h-3.5v5a1.75 1.75 0 0 1-3.5 0v-5zM2.75 5.25h3.5M9.75 5.25h3.5';
const SLIDERS = 'M3.75 2.75v10.5M7.75 2.75v10.5M11.75 2.75v10.5M2.25 5.25h3M6.25 10.75h3M10.25 7.75h3';
const TRASH = 'M2.75 4.25h10.5M6.25 4.25v-1.5h3.5v1.5M4.25 4.25l.75 9h6l.75-9M6.75 7v3.5M9.25 7v3.5';
const GRIP = { f: dot(6, 4) + dot(10, 4) + dot(6, 8) + dot(10, 8) + dot(6, 12) + dot(10, 12) };

export const ICONS = {
  // ---- transport (solid: fill + stroke of one path) ----
  play: solid('M5.75 3.75L12.75 8l-7 4.25z'),
  pause: solid('M4.75 3.75h1v8.5h-1zM10.25 3.75h1v8.5h-1z'),
  stop: solid('M4.75 4.75h6.5v6.5h-6.5z'),
  record: { f: C(8, 8, 4.75) },
  'step-back': { s: 'M11.25 4.75v6.5M8.25 5.25v5.5L4.25 8z', f: 'M8.25 5.25v5.5L4.25 8z' },
  'step-forward': { s: 'M4.75 4.75v6.5M7.75 5.25v5.5L11.75 8z', f: 'M7.75 5.25v5.5L11.75 8z' },
  'skip-back': { s: 'M3.75 3.75v8.5' + 'M12.25 4.25v7.5L6.5 8z', f: 'M12.25 4.25v7.5L6.5 8z' },
  'skip-forward': { s: 'M12.25 3.75v8.5' + 'M3.75 4.25v7.5L9.5 8z', f: 'M3.75 4.25v7.5L9.5 8z' },
  rewind: solid('M7.75 4.75v6.5L2.75 8zM13.25 4.75v6.5L8.25 8z'),
  'fast-forward': solid('M2.75 4.75v6.5L7.75 8zM8.25 4.75v6.5L13.25 8z'),
  loop: 'M10.75 2.75l2.5 2.5-2.5 2.5M13.25 5.25h-7.5a3 3 0 0 0-3 3M5.25 8.25l-2.5 2.5 2.5 2.5M2.75 10.75h7.5a3 3 0 0 0 3-3',
  speed: { s: arc(8, 8.75, 5.25, -125, 125) + `M8 8.75L${at(8, 8.75, 3.75, 45)}`, f: dot(8, 8.75, 1.25) },
  volume: SPEAKER + arc(8.25, 8, 2.5, 50, 130) + arc(8.25, 8, 5, 45, 135),
  mute: SPEAKER + 'M10.25 6.25l3 3M13.25 6.25l-3 3',

  // ---- edit ----
  undo: 'M5.25 3.25L2.75 5.75l2.5 2.5M2.75 5.75H10a3.25 3.25 0 0 1 0 6.5H7.25',
  redo: 'M10.75 3.25l2.5 2.5-2.5 2.5M13.25 5.75H6a3.25 3.25 0 0 0 0 6.5h2.75',
  cut: SCISSORS,
  scissors: SCISSORS,
  copy: 'M5.75 5.75h7.5v7.5h-7.5zM2.75 10.25v-7.5h7.5',
  paste: 'M5.75 3.75h-2v9.5h8.5v-9.5h-2M5.75 2.75h4.5v2h-4.5z',
  add: 'M7.75 3.25v9M3.25 7.75h9',
  remove: 'M3.25 7.75h9',
  delete: TRASH,
  duplicate: 'M5.75 5.75h7.5v7.5h-7.5zM2.75 10.25v-7.5h7.5M9.25 8v2.5M8 9.25h2.5',
  pen: 'M2.75 13.25v-2.75l7.75-7.75 2.75 2.75-7.75 7.75zM9 4.25l2.75 2.75',
  pointer: 'M3 3l3.5 10 1.75-4.75L13 6.5z',
  select: 'M2.75 4.25v-1.5h1.5M7.25 2.75h1.5M11.75 2.75h1.5v1.5M13.25 7.25v1.5M13.25 11.75v1.5h-1.5M8.75 13.25h-1.5M4.25 13.25h-1.5v-1.5M2.75 8.75v-1.5',
  move: 'M7.75 2.5v10.5M2.5 7.75h10.5M5.75 4.5l2-2 2 2M5.75 11l2 2 2-2M4.5 5.75l-2 2 2 2M11 5.75l2 2-2 2',
  magnet: MAGNET,
  lasso: LASSO,
  split: 'M7.75 1.75v12.5M5.25 4.75h-3v6.5h3M10.25 4.75h3v6.5h-3',
  flip: { s: 'M2.25 7.75h1M7.25 7.75h1M12.25 7.75h1M4.75 10.25h6l-3 3z', f: 'M4.75 5.25h6l-3-3z' },
  'flip-h': { s: 'M7.75 2.25v1M7.75 7.25v1M7.75 12.25v1M10.25 4.75v6l3-3z', f: 'M5.25 4.75v6l-3-3z' },
  grow: 'M7.75 2.25v2.5M7.75 11.25v2.5M2.25 7.75h2.5M11.25 7.75h2.5M3.9 3.9l1.8 1.8M10.3 10.3l1.8 1.8M12.1 3.9l-1.8 1.8M5.7 10.3l-1.8 1.8',
  wand: 'M2.75 13.25l7.5-7.5M9.25 4.75l2 2M12.25 2v2.5M11 3.25h2.5M13.25 8.75v2M12.25 9.75h2M4.75 1.75v2M3.75 2.75h2',
  wave: 'M2.75 8q1.75-5.5 3.5 0t3.5 0t3.5 0',
  stroke: 'M2.75 12.25l2.5-8.5 2.5 8.5 2.5-8.5 2.5 8.5',
  smooth: 'M2.75 11.25c3.25 0 2.5-6.5 5.25-6.5s2 6.5 5.25 6.5',
  simplify: { s: 'M2.75 12.25L6 4.75l4 6 3.25-7', f: dot(6, 4.75, 1.25) + dot(10, 10.75, 1.25) },

  // ---- view ----
  'zoom-in': C(6.75, 6.75, 4) + 'M9.75 9.75l3.5 3.5M6.75 5.25v3M5.25 6.75h3',
  'zoom-out': C(6.75, 6.75, 4) + 'M9.75 9.75l3.5 3.5M5.25 6.75h3',
  'zoom-fit': 'M2.75 3.25v9M13.25 3.25v9M5.25 7.75h5.5M6.75 6.25l-1.5 1.5 1.5 1.5M9.25 6.25l1.5 1.5-1.5 1.5',
  eye: EYE + C(8, 8, 1.75),
  'eye-off': 'M5.4 4.65A6 6 0 0 1 8 4c2.4 0 4.4 1.4 5.75 4a10 10 0 0 1-1.6 2.25M10.4 11.4A6 6 0 0 1 8 12c-2.4 0-4.4-1.4-5.75-4a10 10 0 0 1 1.95-2.6M6.75 6.75a1.75 1.75 0 0 0 2.5 2.5M2.75 2.75l10.5 10.5',
  lock: 'M3.75 7.25h8.5v6h-8.5zM5.25 7.25V5.5a2.75 2.75 0 0 1 5.5 0v1.75',
  unlock: 'M3.75 7.25h8.5v6h-8.5zM5.25 7.25V5.5a2.75 2.75 0 0 1 5.35-.9',
  maximize: SQUARE,
  'panel-left': SQUARE + 'M6.25 2.75v10.5',
  'panel-right': SQUARE + 'M9.75 2.75v10.5',
  'panel-bottom': SQUARE + 'M2.75 9.75h10.5',
  layers: 'M8 2.25l5.75 2.75L8 7.75 2.25 5zM2.25 8L8 10.75 13.75 8M2.25 11L8 13.75 13.75 11',
  grid: 'M2.75 2.75h3.5v3.5h-3.5zM9.75 2.75h3.5v3.5h-3.5zM2.75 9.75h3.5v3.5h-3.5zM9.75 9.75h3.5v3.5h-3.5z',
  list: { s: 'M6.25 3.75h7M6.25 7.75h7M6.25 11.75h7', f: dot(3.25, 3.75) + dot(3.25, 7.75) + dot(3.25, 11.75) },
  sun: C(7.75, 7.75, 2.5) + 'M7.75 2.25v1.25M7.75 12v1.25M2.25 7.75H3.5M12 7.75h1.25M3.85 3.85l.9.9M10.75 10.75l.9.9M3.85 11.65l.9-.9M10.75 4.75l.9-.9',
  moon: 'M13.25 9.5A5.25 5.25 0 1 1 6.5 2.75a4.25 4.25 0 0 0 6.75 6.75z',
  contrast: { s: STATUS, f: 'M8 2.25a5.75 5.75 0 0 0 0 11.5z' },

  // ---- timeline ----
  timeline: 'M2.75 3.75h4.5M9.75 3.75h3.5M2.75 7.75h7.5M5.75 11.75h7.5',
  chapters: 'M1.75 4.75h12.5v6.5H1.75zM6.25 4.75v6.5M9.75 4.75v6.5',
  bookmark: 'M4.75 2.75h6.5v10.5L8 10.75l-3.25 2.5z',
  flag: 'M3.75 13.25V2.75h8.75l-2.25 3 2.25 3H3.75',
  marker: 'M4.75 2.75h6.5v4l-3.5 2.75-3-2.75zM7.75 9.5v3.75',
  heatmap: 'M2.75 13.25h10.5M3.25 10.75v-2M6.25 10.75v-5M9.25 10.75v-3M12.25 10.75v-8',
  ruler: 'M2.25 5.25h11.5v5.5H2.25zM5.25 5.25v2M7.75 5.25v3M10.25 5.25v2',
  clock: STATUS + 'M7.75 4.75v3.5L10 9.75',
  history: 'M2.75 8a5.25 5.25 0 1 0 1.55-3.7M2.75 2.75v2.5h2.5M7.75 5.25v3l2 1.25',
  pin: 'M5.75 2.75h4.5M6.75 2.75v3.5l-2.5 3h7.5l-2.5-3v-3.5M7.75 9.25v4',

  // ---- tracking ----
  target: STATUS + C(8, 8, 2.5),
  roi: 'M2.75 5.25v-2.5h2.5M10.75 2.75h2.5v2.5M13.25 10.75v2.5h-2.5M5.25 13.25h-2.5v-2.5M7.75 6.25v3M6.25 7.75h3',
  crosshair: C(7.75, 7.75, 4.25) + 'M7.75 1.75v3M7.75 10.75v3M1.75 7.75h3M10.75 7.75h3',
  film: 'M2.75 2.75h10.5v10.5H2.75zM5.25 2.75v10.5M10.75 2.75v10.5M2.75 6.25h2.5M2.75 9.75h2.5M10.75 6.25h2.5M10.75 9.75h2.5',
  image: 'M2.75 2.75h10.5v10.5H2.75zM2.75 11.25l3.5-3.5 3 3 1.75-1.75 2.25 2.25' + C(10.25, 5.75, 1.25),
  device: 'M4.75 1.75h6.5v12.5h-6.5zM7.25 11.75h1.5',
  machine: 'M2.75 2.75h3.5M9.75 2.75h3.5M5.75 9.25v-3.5a2.25 2.25 0 0 1 4.5 0v3.5zM3.75 11.75h8.5M7.75 11.75v1.5',   // a toy on a carriage, into a gap
  plug: 'M6.25 2.75v2.5M9.75 2.75v2.5M4.25 5.25h7.5v2.5a3.75 3.75 0 0 1-7.5 0zM7.75 11.5v2.25',
  link: 'M6.5 9.5l3-3' + LINK_A + LINK_B,
  unlink: LINK_A + LINK_B + 'M5.25 2.25v1.5M2.25 5.25h1.5M10.75 13.75v-1.5M13.75 10.75h-1.5',

  // ---- status (circles r 5.75; the triangle is drawn larger to match them) ----
  info: { s: STATUS + 'M7.75 7.25v3.5', f: dot(7.75, 5.1, 1) },
  warning: { s: 'M8 1.75l6.25 11.5H1.75zM7.75 6v3.25', f: dot(7.75, 11.1, 0.95) },
  error: STATUS + 'M5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5',
  success: STATUS + 'M5.25 8.25l1.75 1.75 3.75-4',
  check: 'M3.25 8.25l3 3 6.5-6.5',
  help: { s: STATUS + 'M6 6.4a1.75 1.75 0 1 1 2.55 1.55c-.5.25-.8.65-.8 1.2v.35', f: dot(7.75, 11.1, 0.95) },
  dot: { f: C(8, 8, 3) },
  bell: 'M4.25 10V6.75a3.75 3.75 0 0 1 7.5 0V10l1.5 1.75H2.75zM6.75 13.75h2.5',

  // ---- files ----
  file: 'M3.75 2.75h5.5l3 3v7.5h-8.5zM9.25 2.75v3h3',
  folder: 'M2.75 3.75h3.5l1.5 1.5h5.5v7H2.75z',
  'folder-open': 'M2.75 12.25v-8.5h3.5l1.5 1.5h4.5v2M2.75 12.25l1.75-5h9.25l-1.75 5z',
  save: 'M2.75 2.75h8l2.5 2.5v8h-10.5zM5.25 2.75v3h5v-3M5.25 13.25v-3.5h5.5v3.5',
  export: 'M9.25 4.75v-2h-6.5v10.5h6.5v-2M6.25 7.75h7M11 5.5l2.25 2.25L11 10',
  import: 'M6.75 4.75v-2h6.5v10.5h-6.5v-2M2.75 7.75h7M7.5 5.5l2.25 2.25L7.5 10',
  download: 'M7.75 2.75v7M4.75 6.75l3 3 3-3M2.75 10.25v3h10.5v-3',
  upload: 'M7.75 9.75v-7M4.75 5.75l3-3 3 3M2.75 10.25v3h10.5v-3',
  refresh: 'M13.25 8a5.25 5.25 0 1 1-1.55-3.7M13.25 2.75v2.5h-2.5',
  shuffle: 'M2 4.25h2.5c3 0 4 7.5 7 7.5H14M2 11.75h2.5c1 0 1.8-1 2.4-2.2M9.1 6.7C9.7 5.5 10.5 4.25 11.5 4.25H14M12 2.75l2 1.5-2 1.5M12 10l2 1.75-2 1.75',

  // ---- chrome ----
  settings: SLIDERS,
  search: C(6.75, 6.75, 4.25) + 'M10 10l3.25 3.25',
  filter: 'M2.25 2.75h11.5L9.25 8.25v5l-2.5-1.25V8.25z',
  close: 'M4 4l7.5 7.5M11.5 4L4 11.5',
  menu: 'M2.75 3.75h10.5M2.75 7.75h10.5M2.75 11.75h10.5',
  more: { f: dot(3, 8) + dot(8, 8) + dot(13, 8) },
  'more-v': { f: dot(8, 3) + dot(8, 8) + dot(8, 13) },
  grip: GRIP,
  'grip-h': { f: dot(4, 6) + dot(8, 6) + dot(12, 6) + dot(4, 10) + dot(8, 10) + dot(12, 10) },
  'chevron-down': 'M3.75 5.75l4 4 4-4',
  'chevron-up': 'M3.75 9.75l4-4 4 4',
  'chevron-left': 'M9.75 3.75l-4 4 4 4',
  'chevron-right': 'M5.75 3.75l4 4-4 4',
  'chevrons-up-down': 'M4.75 5.75l3-3 3 3M4.75 9.75l3 3 3-3',
  'arrow-up': 'M7.75 12.75v-10M3.75 6.75l4-4 4 4',
  'arrow-down': 'M7.75 2.75v10M3.75 8.75l4 4 4-4',
  'arrow-left': 'M12.75 7.75h-10M6.75 3.75l-4 4 4 4',
  'arrow-right': 'M2.75 7.75h10M8.75 3.75l4 4-4 4',
  keyboard: { s: 'M1.75 3.75h12.5v8.5H1.75zM5.25 9.75h5.5', f: dot(4.5, 6.5, 0.8) + dot(7, 6.5, 0.8) + dot(9.5, 6.5, 0.8) + dot(12, 6.5, 0.8) },
  command: 'M1.75 2.75h12.5v10.5H1.75zM4.75 6.25l1.75 1.5-1.75 1.5M8.25 10.25h3',
  external: 'M9.25 2.75h4v4M13.25 2.75l-5.5 5.5M11.25 9.25v4h-8.5v-8.5h4',

  // ---- added: editing and timeline ----
  axis: 'M3.75 2.75v9.5h9.5M2.25 4.25l1.5-1.5 1.5 1.5M11.75 10.75l1.5 1.5-1.5 1.5',
  ghost: { s: 'M3.75 13.25V7a4.25 4.25 0 0 1 8.5 0v6.25l-1.4-1.25-1.4 1.25L8 12l-1.45 1.25-1.4-1.25z', f: dot(6.5, 7, 0.9) + dot(9.5, 7, 0.9) },
  'magnet-off': MAGNET + 'M1.75 1.75l12.5 12.5',
  snap: 'M7.75 2.25v11.5M9.75 5.25h3.5v5h-3.5M2.75 7.75h2.5M4 6.25l1.5 1.5L4 9.25',
  frame: 'M4.75 2.25v11.5M11.25 2.25v11.5M2.25 4.75h11.5M2.25 11.25h11.5',
  keyframe: 'M8 3.25L12.75 8 8 12.75 3.25 8z',
  bezier: 'M2.75 10.75h2.5v2.5h-2.5zM10.75 2.75h2.5v2.5h-2.5zM4 10.75A6.75 6.75 0 0 1 10.75 4',
  'loop-in': 'M5.25 2.75h-2.5v10.5h2.5' + cycle(10, 8, 3.25, 40, 330, 1.75),
  'loop-out': 'M10.75 2.75h2.5v10.5h-2.5' + cycle(6, 8, 3.25, -40, -330, 1.75),
  'repeat-stroke': 'M2.75 6.75l2.5-4 2.5 4 2.5-4 2.5 4M13.25 9.25v.5a2 2 0 0 1-2 2h-8.5M4.75 9.75l-2 2 2 2',
  random: { s: SQUARE, f: dot(5.5, 5.5) + dot(8, 8) + dot(10.5, 10.5) },
  normalize: 'M2.75 2.75h10.5M2.75 13.25h10.5M2.75 10.25l2.5-4.5 2.5 4.5 2.5-4.5 2.5 4.5',
  expand: 'M9.25 2.75h4v4M13.25 2.75l-4.5 4.5M6.75 13.25h-4v-4M2.75 13.25l4.5-4.5',
  collapse: 'M8.75 3.25v4h4M8.75 7.25l4.5-4.5M7.25 12.75v-4h-4M7.25 8.75l-4.5 4.5',
  pip: { s: 'M1.75 2.75h12.5v10.5H1.75z', f: 'M8 8h4.5v3.5H8z' },
  fullscreen: 'M2.75 6.25v-3.5h3.5M9.75 2.75h3.5v3.5M13.25 9.75v3.5h-3.5M6.25 13.25h-3.5v-3.5',
  'exit-fullscreen': 'M6.25 2.75v3.5h-3.5M13.25 6.25h-3.5v-3.5M9.75 13.25v-3.5h3.5M2.75 9.75h3.5v3.5',
  drag: GRIP,
  'cursor-text': 'M5.75 2.75h1c.55 0 1 .45 1 1v8.5c0 .55-.45 1-1 1h-1M9.75 2.75h-1c-.55 0-1 .45-1 1v8.5c0 .55.45 1 1 1h1M6.25 7.75h3',
  hand: 'M5.25 8.75v-4.5a1 1 0 0 1 2 0v3.5M7.25 7.25v-4a1 1 0 0 1 2 0v4M9.25 7.25v-3a1 1 0 0 1 2 0v4M11.25 8.25v-1.5a1 1 0 0 1 2 0v2.5c0 2.5-1.75 4-4 4h-.75c-1.4 0-2.4-.6-3.15-1.75L3.4 9.4a1 1 0 0 1 1.6-1.15l.25.35',
  brush: 'M13.25 2.75L9 7M7.25 6.75l2 2M7.25 8.25c-1.75-.25-3 .75-3 2.5 0 1-.5 1.75-1.5 2.5 3 .75 5.75-.25 6.25-3.25',
  eraser: 'M9.25 2.75l4 4-6.5 6.5H4.25l-1.75-1.75a1 1 0 0 1 0-1.5zM6 6l4 4M7.25 13.25h6',
  bolt: 'M9.25 1.75l-5.5 7.5h4l-1 5 5.5-7.5h-4z',

  // ---- added: chrome and system ----
  trash: TRASH,
  plus: 'M7.75 3.25v9M3.25 7.75h9',
  minus: 'M3.25 7.75h9',
  x: 'M4 4l7.5 7.5M11.5 4L4 11.5',
  sliders: SLIDERS,
  tune: 'M2.75 3.75H6M9 3.75h4.25M2.75 11.75H8.5M11.5 11.75h1.75' + C(7.5, 3.75, 1.5) + C(10, 11.75, 1.5),
  gear: { f: cog(8, 4.75, 6.25, 13, 9, 2.75) },
  bug: 'M5.25 6.25h5.5v3.5a2.75 2.75 0 0 1-5.5 0zM6.25 6.25a1.75 1.75 0 0 1 3.5 0M7.75 8.25v3.75M2.75 8.75h2.5M10.75 8.75h2.5M3.25 4.75l2 1.5M12.75 4.75l-2 1.5M3.25 12.75l2.25-1.5M12.75 12.75l-2.25-1.5',
  log: 'M2.75 3.75h1.5M6.75 3.75h6.5M2.75 7.75h1.5M6.75 7.75h6.5M2.75 11.75h1.5M6.75 11.75h4.5',
  terminal: 'M3.25 4.25l3.5 3.5-3.5 3.5M8.25 11.75h4.5',
  cpu: 'M4.75 4.75h6.5v6.5h-6.5zM6.75 2.25v2.5M9.25 2.25v2.5M6.75 11.25v2.5M9.25 11.25v2.5M2.25 6.75h2.5M2.25 9.25h2.5M11.25 6.75h2.5M11.25 9.25h2.5',
  gpu: 'M2.25 2.75v10.5M2.25 3.75h11.5v6.5H2.25M5.75 10.25v2.5h5.5v-2.5' + C(6.25, 7, 1.5) + C(10.25, 7, 1.5),
  bluetooth: 'M4.5 5.25l6.5 5.5-3.25 2.5V2.75L11 5.25l-6.5 5.5',
  wifi: { s: arc(8, 12.75, 3.5, -45, 45) + arc(8, 12.75, 6.5, -45, 45) + arc(8, 12.75, 9.5, -40, 40), f: dot(8, 12.75, 1.1) },
  usb: { s: 'M7.75 3.5v9M7.75 10.75l-3-2V7.5M7.75 9.25l3-2v-1', f: 'M7.75 1.5l1.75 2.5h-3.5z' + dot(4.75, 6.25, 1.25) + 'M9.75 3.75h2v2h-2z' + dot(7.75, 12.75, 1.5) },
  battery: { s: 'M1.75 4.75h10v6.5h-10zM13.75 6.75v2.5', f: 'M3.5 6.5h4v3h-4z' },
  power: arc(7.75, 8.5, 5, 40, 320) + 'M7.75 2.25v5.5',
  'stop-circle': { s: STATUS + 'M6.75 6.75h2.5v2.5h-2.5z', f: 'M6.75 6.75h2.5v2.5h-2.5z' },
  'play-circle': { s: STATUS + 'M6.75 5.75l3.75 2.25-3.75 2.25z', f: 'M6.75 5.75l3.75 2.25-3.75 2.25z' },
  timer: 'M3.75 2.75h8.5M3.75 13.25h8.5M5.25 2.75v2L8 7.75l-2.75 3v2.5M10.75 2.75v2L8 7.75l2.75 3v2.5',
  stopwatch: C(7.75, 8.75, 4.5) + 'M6.5 2.75H9M7.75 2.75v1.5M7.75 8.75l1.75-1.75M11.25 4.75l.75-.75',
  'heart-rate': 'M1.75 8.25h2.75l1.5-3.5 3 7 1.5-3.5h3.75',
  hash: 'M6.75 2.75l-1.5 10.5M11 2.75l-1.5 10.5M3.25 5.75h10M2.75 10.25h10',
  percent: 'M12.75 3.25l-9.5 9.5' + C(4.75, 4.75, 1.75) + C(11.25, 11.25, 1.75),
};

export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

/** { s, f } for a name (stroke and fill path data; either may be ''). Unknown names throw: a typo. */
export function iconPaths(name) {
  const v = ICONS[name];
  if (v == null) throw new Error(`Icon: unknown icon "${name}"`);
  return typeof v === 'string' ? { s: v, f: '' } : { s: v.s || '', f: v.f || '' };
}
