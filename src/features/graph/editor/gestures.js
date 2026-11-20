// gestures.js -- the editor's pointer gesture rules and the Escape ladder, as pure functions
// (test/graph-editor-gestures.test.mjs). The component feeds DOM facts in and acts on what comes out.
//
// PROVENANCE: the `gest` state machine of OpenValence/Phosphor (Apache-2.0) src/ui/graph/GraphEditor.svelte
// l.307-437 (down / move / up with a 4 px dead zone, pan, marquee, move, wire, pinch), split out and extended
// with knife, frame resize and a wire's input end being re-routed.

export const DEAD_ZONE = 4;
export const passed = (dx, dy, px = DEAD_ZONE) => Math.abs(dx) + Math.abs(dy) > px;

/**
 * What a pointerdown starts. on: 'socket' | 'node' | 'frame' | 'frameEdge' | 'wire' | 'control' | 'canvas' |
 * 'overlay' (palette, toolbar, minimap: theirs). Returns the gesture kind or null (let the target have it).
 *  - middle button anywhere, or Space held: pan
 *  - Ctrl+drag on canvas or a wire: knife (cuts the wires the stroke crosses); on a node Ctrl/Shift toggle selection
 *  - Shift+drag on canvas: marquee adding to the selection; Ctrl+Shift: marquee toggling
 *  - plain drag on canvas: marquee when boxMode, else pan
 *  - socket: wire; an input socket that already has a link re-routes that link (grabs its far end)
 *  - node / frame header: move; frame edge: resize
 */
export function classifyDown({ on, button = 0, shift = false, ctrl = false, space = false, boxMode = false, linked = false, side = null }) {
  if (on === 'overlay') return null;
  if (button === 1 || (space && button === 0)) return 'pan';
  if (button !== 0) return null;
  if (on === 'control') return null;
  if (on === 'socket') return side === 'in' && linked ? 'reroute' : 'wire';
  if (on === 'node' || on === 'frame') return 'move';
  if (on === 'frameEdge') return 'resize';
  if (on === 'wire') return ctrl ? 'knife' : 'wire-select';
  if (ctrl && !shift) return 'knife';
  if (shift) return ctrl ? 'box-toggle' : 'box-add';
  return boxMode ? 'box' : 'pan';
}

/**
 * Selection after a click (no drag) on a node. sel: Set; shift/ctrl toggles; a plain click on a node already
 * selected keeps a multi-selection only while dragging, so on release it becomes that node alone.
 */
export function clickSelect(sel, id, { shift = false, ctrl = false, dragged = false } = {}) {
  if (shift || ctrl) {
    const out = new Set(sel);
    if (out.has(id)) out.delete(id); else out.add(id);
    return out;
  }
  if (dragged && sel.has(id)) return sel;
  return new Set([id]);
}

/** Selection at pointerdown on a node: an unselected node becomes the selection (or joins it with Shift/Ctrl). */
export function pressSelect(sel, id, { shift = false, ctrl = false } = {}) {
  if (sel.has(id)) return sel;
  return shift || ctrl ? new Set([...sel, id]) : new Set([id]);
}

/**
 * Selection on release of a press on a node that did not drag. `was` = the node was selected BEFORE the press
 * (pressSelect already added it with a modifier, so only a node that was already in toggles off; toggling
 * the freshly added one would undo the press). A plain click leaves that node alone.
 */
export function releaseSelect(sel, id, { shift = false, ctrl = false, was = false } = {}) {
  if (shift || ctrl) return was ? clickSelect(sel, id, { shift, ctrl }) : sel;
  return clickSelect(sel, id);
}

/**
 * The Escape ladder (DESIGN 8.6): the innermost open thing closes first.
 * state: { gesture, palette, menu, field, maximised, selection (count), wire (selected wire) }.
 * Returns 'gesture' | 'palette' | 'menu' | 'field' | 'maximise' | 'selection' | null.
 */
export function escapeTarget(s) {
  if (s.gesture) return 'gesture';
  if (s.palette) return 'palette';
  if (s.menu) return 'menu';
  if (s.field) return 'field';
  if (s.maximised) return 'maximise';
  if (s.selection || s.wire) return 'selection';
  return null;
}

const PLAIN = /^(Shift\+)?([A-Z0-9]|[,./;'[\]=`-]|Arrow(Left|Right|Up|Down)|Delete|Backspace|Home|End|PageUp|PageDown|Enter)$/;

/**
 * What the canvas itself does with a keydown, before it bubbles to the command registry (which owns every
 * bound key, graph or not: ARCHITECTURE "no key handling outside the registry"). k = { chord, winner, inField,
 * onCardControl, prevented }: winner = the command the registry would run for chord right now (null = none).
 *  'pass'    leave it alone (the registry, a field, or the browser has it)
 *  'space'   note Space held for Space-drag pan; NOT prevented, so the registry still runs whatever Space is bound to
 *  'card'    Escape in a card's inline field (that did not consume it): focus goes back to the card
 *  'search'  an unmodified letter no command takes: open the node search seeded with it
 *  'swallow' any other plain key no command takes (no browser scrolling of the canvas)
 */
export function canvasKey({ chord, winner = null, inField = false, onCardControl = false, prevented = false }) {
  if (prevented || !chord) return 'pass';
  if (inField) return chord === 'Escape' && onCardControl ? 'card' : 'pass';
  if (/^(Shift\+)?Space$/.test(chord)) return 'space';
  if (winner || !PLAIN.test(chord) || chord.endsWith('Enter')) return 'pass';
  return /^(Shift\+)?[A-Z]$/.test(chord) ? 'search' : 'swallow';
}

/** Arrow key -> grid delta for moving the selection (Shift = 5 steps). */
export function arrowDelta(key, shift = false, grid = 20) {
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
  if (!d) return null;
  const s = grid * (shift ? 5 : 1);
  return [d[0] * s, d[1] * s];
}
