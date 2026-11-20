// kinds.js -- how the plan's segment kinds LOOK and map: colour, icon, keyboard slot, sidecar span state.
// The kind ids, labels and default recipes are src/lib/gen/recipes.js KINDS (gen-lib); this adds the visual
// language and the span mapping on top. An unknown kind still draws (as custom).
//
// Colour language (kit series tokens, so dark / light / contrast all work): the story reads as temperature.
// Cool at the start (fade-in blue, foreplay lime), green for oral, yellow for penetration, orange for knotting,
// vermilion for the climax (fast run-in), pink for the orgasm, cooling to violet for the afterglow. Off-story kinds:
// off-screen sky (dashed: motion continues unseen), idle, outro and custom grey. Icons are 16x16 SVG path strings (stroke only), for <svg> and Path2D, drawn
// the way the lanes draw motion: up = out (pos 100), down = deep (pos 0).
import { KINDS as GEN_KINDS } from '../../lib/gen/recipes.js';

// [id, series token (kit palette, so every theme works), dark-theme hex (node / no-DOM fallback), span, icon, dash]
const LOOK = [
  ['fade-in', 'blue', '#6E84F0', 'active', 'M1 8L3 7L5 9L7 6L9 10L11 4L13 12L15 2'],
  ['foreplay', 'lime', '#8CE05A', 'active', 'M1 6Q3.5 3 6 6T11 6T16 6'],
  ['oral', 'green', '#3CEBC0', 'active', 'M1 7Q3.5 0 6 7T11 7T16 7'],
  ['penetration', 'yellow', '#D9E82E', 'active', 'M1 8Q3.5 -1 6 8T11 8T16 8M1 8Q3.5 17 6 8'],
  ['knotting', 'orange', '#F5A733', 'active', 'M1 3L5 12L6.5 10L8 12L9.5 10L11 12L15 3'],
  ['climax', 'vermilion', '#EE5340', 'climax', 'M1 3L2.5 13L4 3L5.5 13L7 3L8.5 13L10 3L11.5 13L13 3L14.5 13'],
  ['orgasm', 'pink', '#CC5CBC', 'orgasm', 'M1 13L2 9L3 13L4 9L5 13L6 9L7 13L8 9L9 13L10 9L11 13L12 9L13 13L14 9L15 13M8 2V5M5.5 3L6.5 5M10.5 3L9.5 5'],
  ['afterglow', 'violet', '#A98BFF', 'active', 'M1 2L3 12L5 4L7 10L9 6L11 9L13 7L15 8'],
  ['offscreen', 'sky', '#1FC3FA', 'carry', 'M1 8Q3.5 1 6 8T11 8T16 8', true],
  ['idle', 'grey', '#A0A3A8', 'idle', 'M5 3V13M11 3V13'],
  ['outro', 'grey', '#A0A3A8', 'idle', 'M1 8H11M8 5L11 8L8 11M14 3V13'],
  ['custom', 'grey', '#A0A3A8', 'active', 'M1 12L4 4L7 12L10 4L13 12L15 6'],
];
// Tag-only looks: scene tags (acts.js) with a colour of their own but no plan kind. In KIND / kindOf, never in KINDS
// (no plan segment, no keyboard slot, not a name kindFromName returns). exposed = muted vermilion (dick out, no act).
const TAG_LOOKS = [['exposed', 'exposed', '#B8695C', 'active', 'M8 2V11M5.5 8.5L8 11L10.5 8.5M4 14H12']];
const KEYS = { 'fade-in': '1', foreplay: '2', oral: '3', penetration: '4', knotting: '5', climax: '6', orgasm: '7', afterglow: '8', offscreen: '9', idle: '0' };

// Theme-resolved colours, re-read when <html data-theme> changes. `color` is the resolved hex (canvas, rgba());
// `css` is the token itself for DOM styles (follows a theme switch without a re-render).
let resolved = null;
const hasDom = typeof document !== 'undefined' && typeof getComputedStyle === 'function';
if (hasDom && typeof MutationObserver === 'function') new MutationObserver(() => { resolved = null; }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
function colorOf(id, series, hex) {
  if (!hasDom) return hex;
  if (!resolved) { const cs = getComputedStyle(document.documentElement); resolved = Object.fromEntries(LOOK.map(([k, s]) => [k, cs.getPropertyValue('--series-' + s).trim()])); }
  return /^#[0-9a-f]{6}$/i.test(resolved[id]) ? resolved[id] : hex;
}

/** [{id, label, recipe, color, css, series, span, icon, dash, key}] in story order. */
const look = ([id, series, hex, span, icon, dash]) => ({
  id, series, hex, css: `var(--series-${series}, ${hex})`, span, icon, dash: !!dash, key: KEYS[id] ?? null,
  label: GEN_KINDS[id]?.label ?? id, recipe: GEN_KINDS[id]?.recipe ?? 'strokes',
  get color() { return colorOf(id, series, hex); },
});
export const KINDS = LOOK.map(look);
export const KIND = Object.fromEntries([...KINDS, ...TAG_LOOKS.map(look)].map((k) => [k.id, k]));
const PLAN_KIND = new Set(KINDS.map((k) => k.id));
export const kindOf = (id) => KIND[id] || Object.create(KIND.custom, { id: { value: id || 'custom' }, label: { value: id || 'Custom' } });
export const kindByKey = (key) => KINDS.find((k) => k.key === key) ?? null;

/** Sidecar span state -> kind (track `spans` states plus the `still` event kind). */
export const SPAN_KIND = { active: 'penetration', idle: 'idle', carry: 'offscreen', climax: 'climax', orgasm: 'orgasm', still: 'idle' };

// Names a director model (or a person) might use. Lower-cased, separators collapsed to one space.
const ALIASES = {
  'fade-in': ['fade in', 'fadein', 'intro', 'start', 'opening', 'warmup', 'warm up', 'build', 'build up', 'buildup'],
  foreplay: ['tease', 'teasing', 'licking', 'touch', 'touching', 'grinding', 'small', 'gentle'],
  oral: ['blowjob', 'bj', 'sucking', 'mouth'],
  penetration: ['main', 'main act', 'active', 'sex', 'thrust', 'thrusting', 'riding', 'stroke', 'strokes', 'follow', 'fucking'],
  knotting: ['knot', 'knotted', 'tie', 'tied', 'knot pop', 'pop'],
  climax: ['run in', 'run-in', 'build to climax', 'fast strokes', 'fast climax'],
  orgasm: ['cum', 'cumming', 'cumshot', 'ejaculation', 'spurt', 'pulses', 'climaxing', 'orgasming', 'finish', 'peak', 'tremor'],
  afterglow: ['ending', 'slow ending', 'end', 'cooldown', 'cool down', 'fade out', 'fadeout', 'aftercare', 'ramp down'],
  offscreen: ['carry', 'off screen', 'cutaway active', 'continues', 'offscreen'],
  idle: ['title', 'cutaway', 'cut away', 'pause', 'still', 'rest', 'hold', 'none', 'talk', 'dialogue', 'black', 'transition'],
  outro: ['credits', 'end card'],
};
const ALIAS = new Map(Object.entries(ALIASES).flatMap(([k, names]) => names.map((n) => [n, k])));
/** Any kind name -> a kind id, or null if unknown. */
export function kindFromName(name) {
  const n = String(name ?? '').toLowerCase().replace(/[_./]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (PLAN_KIND.has(n)) return n;
  const d = n.replace(/ /g, '-');
  return PLAN_KIND.has(d) ? d : ALIAS.get(n) ?? ALIAS.get(n.replace(/-/g, ' ')) ?? null;
}

/** '#rrggbb' + alpha -> 'rgba(...)'. */
export function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
