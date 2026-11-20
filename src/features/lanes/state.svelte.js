// state.svelte.js -- the lane editor's UI state, one per app (shared by LaneStack, every lane and commands.js).
// Persistent preferences live in app.settings under 'lanes.*'; transient interaction state lives here.

import { rooted } from '../../lib/rooted.svelte.js';
import { PAD, COLLAPSED_H, MIN_H, MAX_H } from './geom.js';
import { finalOf, layersOf } from '../../lib/finish.js';
import { scriptOf } from '../../lib/script-of.js';
import { machineGhost } from './deps.js';
import { modeOf } from './elements.js';

export const KNOWN_AXES = ['stroke', 'surge', 'sway', 'twist', 'roll', 'pitch', 'vib', 'valve', 'suck', 'lube'];
const DEF_LAYOUT = { order: [], h: {}, collapsed: {}, hidden: {}, locked: {}, ghostsOff: {} };
export { COLLAPSED_H, MIN_H, MAX_H };
export const defaultHeight = (axis) => (axis === 'stroke' ? 168 : 104);

class LanesState {
  hover = $state.raw(null);      // {axis, x, y, h} pointer over a lane (mouse recording reads this)
  push = $state(false);          // sticky "push" drag mode (Meta while dragging does the same)
  rec = $state.raw(null);        // {mode: 'live'|'tap', axis, t0, samples: [{t,pos}], keyPos: number|null}
  popover = $state.raw(null);    // {axis, at, x, y} numeric point editor
  menu = $state.raw(null);       // {x, y, items} context menu
  xform = $state.raw(null);      // {axis, script, idx} while a modal G / S transform previews (commands.js, lib/xform.js)
  spaceHeld = false;             // Space held: drag pans
  clip = null;                   // lib/edit snippet {origin, duration, actions}
  solo = $state(null);           // axis id: only this lane is editable
  lastGhost = null;
  resizeLane = null;             // (axis, px): move a lane's bottom edge as its grip does (LaneStack sets it; Ctrl+wheel uses it)              // id of the ghost the user last accepted from or snapped to (Ctrl+Enter takes it)

  els = {};                      // axis -> the lane's canvas element (set by LaneView; not reactive)

  constructor(app) { this.app = app; }

  /** Client (viewport) coordinates of (at, pos) on a lane, or null if that lane is not mounted. */
  screenPoint(axis, at, pos) {
    const el = this.els[axis];
    if (!el) return null;
    const r = el.getBoundingClientRect(), v = this.app.view;
    return { x: r.left + ((at - v.start) / v.span) * r.width, y: r.top + PAD + (1 - pos / 100) * (r.height - 2 * PAD), rect: r };
  }

  get layout() { return { ...DEF_LAYOUT, ...(this.app.settings.get('lanes.layout') || {}) }; }
  setLayout(patch) { this.app.settings.set('lanes.layout', { ...this.layout, ...patch }); }
  flag(name, axis) { return !!this.layout[name]?.[axis]; }
  toggleFlag(name, axis, v) { const m = { ...this.layout[name] }; m[axis] = v ?? !m[axis]; this.setLayout({ [name]: m }); }
  height(axis) {
    if (this.flag('collapsed', axis)) return COLLAPSED_H;
    return this.layout.h[axis] ?? defaultHeight(axis);
  }
  setHeight(axis, px) { this.setLayout({ h: { ...this.layout.h, [axis]: Math.round(Math.max(MIN_H, Math.min(MAX_H, px))) } }); }

  get snap() {
    const s = this.app.settings;
    return { frames: s.get('edit.snapFrames'), ghosts: !!s.get('lanes.snapGhosts', false), cuts: !!s.get('lanes.snapCuts', true) };
  }
  get speedColors() { return this.app.settings.get('lanes.speedColors', true); }
  get showGhosts() { return this.app.settings.get('lanes.ghosts', true); }
  get latency() { return +this.app.settings.get('lanes.latencyMs', 0) || 0; }
  /** Scrub while dragging: a moved point (or a transform-box edge) seeks the paused player to its new time; Alt+hover peeks a point's frame. */
  get dragScrub() { return this.app.settings.get('lanes.dragScrub', true) !== false; }
  get hoverScrub() { return this.app.settings.get('lanes.hoverScrub', false) === true; }
  /** Frame thumbnail above the hover / drag tip (needs media). */
  get hoverThumb() { return this.app.settings.get('lanes.hoverThumb', true) !== false; }
  get maxSpeed() { return +this.app.settings.get('lanes.speedMax', 400) || 400; }
  /** A plain drag on empty lane space: 'box' (box select) or 'pan' (settings lanes.dragAction; a modifier box-selects either way). */
  get dragAction() { return this.app.settings.get('lanes.dragAction') === 'pan' ? 'pan' : 'box'; }
  /** A double-click on empty lane space: 'add' (a point there) or 'fit' (zoom to fit; settings lanes.dblClick). */
  get dblClick() { return this.app.settings.get('lanes.dblClick') === 'fit' ? 'fit' : 'add'; }
  /** paw-5zpf: the selection mode (elements.js MODES; setting lanes.selectMode). */
  get selMode() { return modeOf(this.app.settings.get('lanes.selectMode', 'point')); }
  toggle(key, def) { const s = this.app.settings; s.set(key, !s.get(key, def)); return s.get(key); }

  /** Lane order: the user's order, then any other axes the document has, in the usual axis order. */
  ids() {
    const have = Object.keys(this.app.doc.axes);
    if (!have.length) have.push('stroke');
    const order = this.layout.order.filter((id) => have.includes(id));
    const rest = have.filter((id) => !order.includes(id)).sort((a, b) => (KNOWN_AXES.indexOf(a) + 1 || 99) - (KNOWN_AXES.indexOf(b) + 1 || 99));
    return [...order, ...rest];
  }
  editable(axis) { return !this.flag('locked', axis) && (!this.solo || this.solo === axis); }
  /** Visible ghosts of an axis (tracker runs as they are: on a live shot the script IS the run, paw-x7w7), and on the stroke
   *  the FINAL (lib/finish.js: the points through the live Autorange pass and effects; what plays and exports) whenever it
   *  differs from the points: the lane edits the points, the final follows. */
  ghostsFor(axis) {
    if (!this.showGhosts || this.flag('ghostsOff', axis)) return [];
    const out = (this.app.doc.ghosts || []).filter((g) => g.visible !== false && (g.axis ?? 'stroke') === axis && g.script?.length);
    const own = axis === 'stroke' ? finalGhost(this.app) : null, mk = axis === 'stroke' ? machineGhost(this.app) : null;   // + the Machine's knot events (marks)
    return [...out, ...(own ? [own] : []), ...(mk ? [mk] : [])];
  }
}

const finals = new WeakMap();
/** The final as a preview ghost (never accepted, never saved), named by what acts: the lane header's legend says it.
 *  Same object while the final keeps its identity. null when the final is the points. */
export function finalGhost(app) {
  const base = scriptOf(app, 'stroke'), fin = finalOf(app);
  if (!base.length || fin === base) return null;
  const c = finals.get(fin);
  if (c) return c;
  const L = layersOf(app.doc), what = [L.autorange && 'autorange', L.effects && `${L.effects} modifier${L.effects === 1 ? '' : 's'}`].filter(Boolean).join(' + ');
  const g = { id: 'final', name: `Final (${what}): what plays · you edit the points`, color: '#ff7ac8', visible: true, script: fin, source: { kind: 'final-preview', axis: 'stroke' } };
  finals.set(fin, g);
  return g;
}

const all = new WeakMap();
/** The lanes state for an app (created on first use). */
export function lanes(app) {
  let s = all.get(app);
  if (!s) { s = rooted(() => new LanesState(app), app); all.set(app, s); }   // paw-b7da: its own root, never the asking component's
  return s;
}
