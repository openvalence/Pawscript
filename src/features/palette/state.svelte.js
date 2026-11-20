// state.svelte.js -- which overlay is open (one at a time: 'palette' | 'help' | 'keys' | null), its query, and where
// focus goes back to when it closes. The commands toggle it; the modal components read it.
import { tick } from 'svelte';
import { eventChord } from '../../app/keymap.js';

// focusKeys: true (the editor's search) or {id, slot} (palette.keys: capture keys for that command)
export const ui = $state({ open: null, query: '', focusKeys: false, ctx: null });
let opener = null;

/** ctx: where the palette was opened (logic.js paletteContext), taken before the dialog moves focus off a timeline row. */
export function show(kind, query = '', ctx = null) {
  if (!ui.open) opener = typeof document !== 'undefined' ? document.activeElement : null;
  ui.open = kind;
  ui.query = query;
  ui.ctx = ctx;
}

/** Close; resolves once the dialog is gone and focus is back where it was (the page is inert until then). */
export async function hide() {
  if (!ui.open) return;
  ui.open = null;
  const el = opener;
  opener = null;
  await tick();
  if (!ui.open && el?.isConnected && el !== document.body) el.focus({ preventScroll: true });
}

export const toggle = (kind) => (ui.open === kind ? hide() : show(kind));

/** Attachment for an overlay's <dialog>: modal (top layer, page inert) while mounted. */
export const modal = (el) => {
  el.showModal();
  return () => el.open && el.close();
};

const OWN = ['palette.open', 'palette.help', 'palette.keys'];
/**
 * keydown inside an overlay that the overlay did not handle: our own commands' keys go on to the app's keymap
 * (Ctrl+K toggles the palette shut); everything else stops here, so Space or a digit never edits the document
 * behind the overlay.
 */
export function fence(app, e) {
  const ch = eventChord(e);
  if (!ch || !OWN.some((id) => app.commands.keysFor(id).includes(ch))) e.stopPropagation();
}
