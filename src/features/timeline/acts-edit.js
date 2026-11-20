// acts-edit.js -- paw-2lp7.5: the action regions' edits as the app makes them (one undo step each, a quiet toast when refused),
// shared by the Actions strip (ScenesLane), its chips (RegionChips), the Actions panel and the commands (commands-acts.js).
// The selected region is tl.act (its id); the recent actions (the 1-9 keys) are the setting 'timeline.actMru'.
import { tl, scenesOf, listOf, setSel, durOf } from './state.svelte.js';
import { NO_SEL } from './shots.js';
import { setRegionTags, regionWords, deleteRegion, acceptRegion, acceptAll, actsAt } from './regions.js';
import { pushMru } from './actions-strip.js';
import { playheadFrameStart } from '../../lib/lane.js';

export const actsOf = (app) => listOf(app, 'acts');
/** The selected region (tl.act), else null. */
export const selectedAct = (app) => (tl.act ? (app.doc.acts || []).find((r) => r.id === tl.act) ?? null : null);
/** The region a key acts on: the selected one, else the main-line action at the playhead (else any there). */
export const targetAct = (app) => { const at = actsAt(app.doc.acts, playheadFrameStart(app.player)); return selectedAct(app) ?? at.find((r) => r.layer === 0 && r.kind !== 'positioning') ?? at[0] ?? null; };
/** The recent actions (newest first, at most 9). */
export const mruOf = (app) => { const m = app.settings?.get?.('timeline.actMru', []); return Array.isArray(m) ? m.filter((t) => Array.isArray(t) && t.length) : []; };
export const noteMru = (app, tags) => { if (tags?.length) app.settings?.set?.('timeline.actMru', pushMru(mruOf(app), tags)); };
/** One undoable write of the regions: false (and `why` as a quiet toast) when the edit changes nothing. */
export function commitActs(app, label, list, why = '') {
  if (!list) { if (why) app.toast?.(why, 'quiet'); return false; }
  app.transact(label, () => { app.doc.acts = list; });
  return true;
}
/** Select region r (null: none): the shot selection goes, the range becomes its span (Track works on it); opt.seek: the
 *  playhead to its start and the view onto it (the Actions panel). */
export function selectAct(app, r, { seek = false } = {}) {
  tl.act = r?.id ?? null;
  tl.actPop = null;
  if (!r) return;
  setSel(NO_SEL);
  tl.cut = null;
  app.doc.range = { t0: r.t0, t1: Math.min(r.t1, durOf(app)) };
  if (seek) {
    app.player?.seek?.(r.t0);
    const v = app.view;
    if (v && (r.t0 < v.start || r.t1 > v.start + v.span)) app.setView?.({ start: Math.max(0, r.t0 - Math.min(v.span, r.t1 - r.t0) * 0.15), span: Math.max(v.span, (r.t1 - r.t0) * 1.3) });
  }
  app.usage?.note?.('acts:select', { kind: r.kind, layer: r.layer });
}
/** Region id's tags (one action) in one undo step; noted as a recent action. */
export function setTags(app, id, tags, label = 'Action tags') {
  const ok = commitActs(app, label, setRegionTags(app.doc.acts, id, tags));
  if (ok) noteMru(app, tags);
  return ok;
}
export function removeAct(app, id) {
  const r = (app.doc.acts || []).find((x) => x.id === id);
  if (!commitActs(app, r?.auto ? 'Dismiss proposed action' : 'Delete action region', deleteRegion(app.doc.acts, id), 'No action region')) return;
  if (tl.act === id) tl.act = null;
  app.usage?.note?.('acts:delete', { auto: !!r?.auto });
}
export function acceptAct(app, id) {
  if (commitActs(app, 'Accept proposed action', acceptRegion(app.doc.acts, id), 'Not a proposal')) app.usage?.note?.('acts:accept', { all: false });
}
export function acceptAllActs(app) {
  const n = (app.doc.acts || []).filter((r) => r.auto).length;
  if (commitActs(app, `Accept ${n} proposed action${n === 1 ? '' : 's'}`, acceptAll(app.doc.acts), 'No proposals')) { app.toast?.(`${n} proposed action${n === 1 ? '' : 's'} accepted`, 'quiet'); app.usage?.note?.('acts:accept', { all: true, n }); }
}
const mss = (ms) => `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(1).padStart(4, '0')}`;
/** A region in words for toasts and tips: 'anal penetration 0:12.0–0:40.5 (layer 1)'. */
export const actLabel = (r) => `${regionWords(r)} ${mss(r.t0)}–${mss(r.t1)}${r.layer ? ` (layer ${r.layer})` : ''}`;
export { mss };
/** The shots (indices) a region covers more than half of, else those it touches. */
export function shotsUnder(app, r) {
  const l = scenesOf(app), on = l.flatMap((s, i) => (Math.min(s.end_ms, r.t1) - Math.max(s.start_ms, r.t0) > (s.end_ms - s.start_ms) / 2 ? [i] : []));
  return on.length ? on : l.flatMap((s, i) => (s.end_ms > r.t0 && s.start_ms < r.t1 ? [i] : []));
}
