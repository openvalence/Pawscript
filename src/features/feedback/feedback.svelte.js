// feedback.svelte.js -- the feedback note store (paw-dze): ` opens one inline field in the status bar (NoteField.svelte),
// Enter saves the note with its context to <app local data dir>/feedback.jsonl (feedback.js has the shape), Esc
// cancels. Notes showed as dots on the Chapters row, removed with it (paw-1w0x): `shown` / `remove` have no timeline caller now.
// Saved even with the usage log off (a note is typed on purpose); its usage-log mirror and the fix log follow the switch.
import { rooted } from '../../lib/rooted.svelte.js';
import { fileSink, focusOf } from '../../app/usage.svelte.js';
import { projectId, whereIn } from '../../app/fixlog.js';
import { parseNote, parseNotes, compactEvent } from './feedback.js';

const first = (mods, name) => Object.values(mods).map((m) => m?.[name]).find((v) => v != null);
const trackingMods = import.meta.glob('../tracking/tracking.svelte.js', { eager: true });
const groupsMods = import.meta.glob('../tracking/groups.svelte.js', { eager: true });
const timelineMods = import.meta.glob('../timeline/state.svelte.js', { eager: true });
const FILE = 'feedback.jsonl';
let seq = 0;

export class Feedback {
  open = $state(false);
  notes = $state.raw([]);     // every note in feedback.jsonl (all videos)
  sel = $state(null);         // the note selected on the Chapters row (Delete / X removes it)
  ctx = null;                 // the context captured when the field opened
  constructor(app) {
    this.app = app;
    const be = app.backend || {};
    this.sink = be.isTauri && be.appPaths ? fileSink(be, () => FILE) : null;
    this.loaded = this.#load();
  }
  async path() { const d = (await this.app.backend.appPaths()).data_dir; return d + (d.includes('\\') ? '\\' : '/') + FILE; }
  async #load() {
    const be = this.app.backend;
    if (!this.sink) return;
    try { const p = await this.path(); if (await be.exists(p)) this.notes = parseNotes(await be.readText(p)); } catch (e) { console.warn('[feedback] could not read the notes:', e); }
  }
  /** The notes of the video open now, while the setting feedback.markers is on. */
  get shown() {
    if (this.app.settings.get('feedback.markers', true) === false) return [];
    const id = projectId(this.app.doc.media);
    return id ? this.notes.filter((n) => n.project === id) : [];
  }
  /** Open the field: the context is taken now (the playhead, the focus before the field takes it). */
  start() {
    if (this.open) return;
    this.ctx = noteContext(this.app, focusOf(typeof document !== 'undefined' ? document.activeElement : null));
    this.open = true;
  }
  cancel() { this.open = false; this.ctx = null; }
  /** Save the field's text (empty: nothing saved). -> the note | null. */
  save(raw) {
    const { tone, text } = parseNote(raw), app = this.app, ctx = this.ctx || noteContext(app, '');
    this.open = false; this.ctx = null;
    if (!text) return null;
    const t = Date.now(), note = { t: new Date(t).toISOString(), s: app.usage?.sid, k: 'note', id: `n${t.toString(36)}${(seq++).toString(36)}`, tone, text, ...ctx };
    this.notes = [...this.notes, note];
    this.#append(note);
    app.usage?.note('note:feedback', { id: note.id, tone, text: text.slice(0, 200), project: note.project, at: note.at, scene: note.scene, shot: note.shot });
    app.fixes?.noteFeedback({ id: note.id, tone, text });
    app.toast(`Note saved${tone !== 'note' ? ` (${tone})` : ''}`, 'quiet');
    return note;
  }
  remove(id) {
    if (!this.notes.some((n) => n.id === id)) return;
    this.notes = this.notes.filter((n) => n.id !== id);
    if (this.sel === id) this.sel = null;
    this.#append({ t: new Date().toISOString(), k: 'delete', id });
    this.app.usage?.note('note:delete', { id });
  }
  #append(r) { try { this.sink?.append(JSON.stringify(r) + '\n'); } catch (e) { console.warn('[feedback]', e); } }
}

/** What a note saves about where the owner was. No path, no picture of the video. */
export function noteContext(app, focus = '') {
  const doc = app.doc, t = app.player?.timeMs ?? 0, fms = app.player?.frameMs || 0, w = whereIn(doc.scenes, t);
  const tl = first(timelineMods, 'tlFor')?.(app), tr = app.tracking ?? first(trackingMods, 'peekTracking')?.(app), g = first(groupsMods, 'peekGroups')?.(app);
  let run = null;
  try {
    const sig = tr?.signalState?.(t), r = sig && tr.run(sig.runId);
    if (r) run = { id: r.id, tracker: r.tracker, source: sig.source, ...(sig.pair ? { pair: sig.pair } : {}), against: sig.against, direction: r.direction || 'both', ...(sig.override ? { override: true } : {}) };
  } catch { /* no run here */ }
  const sel = doc.selection?.axis === doc.activeAxis ? doc.selection.ats.size : 0;
  return {
    project: projectId(doc.media), video: doc.media?.name || '', at: Math.round(t), frame: fms ? app.player.frameAt?.(t) ?? Math.round(t / fms) : null, scene: w.scene ?? null, shot: w.shot ?? null,
    sel: { shots: (tl?.shots || []).map((k) => k + 1), points: sel, range: doc.range ? { t0: Math.round(doc.range.t0), t1: Math.round(doc.range.t1) } : null },
    mode: app.mode, tool: g?.on ? 'groups' : tr?.axisOn ? 'axis' : tr?.pairPick ? 'pair' : '', focus, axis: doc.activeAxis, run,
    zoom: Math.round(app.view?.span ?? 0), playing: !!app.player?.playing,
    recent: (app.usage?.recent || []).slice(-15).map(compactEvent),
    screenshot: null,   // not taken: WebView2 has no cheap capture of the window with the video masked (docs/fix-log.md)
  };
}

const stores = new WeakMap();
/** The app's feedback store (created on first use; also set as app.feedback for the Chapters row). */
export function feedbackOf(app) {
  let s = stores.get(app);
  if (!s) { s = rooted(() => new Feedback(app), app); stores.set(app, s); app.feedback = s; }   // paw-b7da: its own root, never the asking component's
  return s;
}
