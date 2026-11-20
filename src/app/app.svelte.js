// app.svelte.js -- createApp(): the `app` object every feature receives (interface: src/ARCHITECTURE.md).
// Nothing here imports Tauri: the real backend is passed in by App.svelte, the dev mock passes a fake one,
// so harness pages run in a plain browser.

import { Doc } from './doc.svelte.js';
import { History } from './history.js';
import { Registry } from './commands.js';
import { Settings, SCHEMA } from './settings.svelte.js';
import { Usage, usageCommands, fileSink, sourceOf, focusOf, noteFx, clip } from './usage.svelte.js';
import { FixLog, projectId } from './fixlog.js';
import { Player } from './player.svelte.js';
import { untrack } from 'svelte';
import { clampView, followView } from '../lib/lane.js';
import { Layout } from './layout.svelte.js';
import { toast as kitToast, dismissToast } from '../ui/kit/toast.svelte.js';
import { MODES, migrateMode } from './modes.js';
import { Tabs, tabsCommands, homeAllows } from './tabs.svelte.js';
import editorCommands from './editor-commands.js';
import { bindSettings } from '../lib/content.js';
import { scriptOf, settleEdit, touchedLive, emptiedLive } from '../lib/script-of.js';

let toastSeq = 0, taskSeq = 0, lastQuiet = 0;
const TONE = { info: 'info', ok: 'ok', warn: 'warn', error: 'bad', quiet: 'neutral' };
// settings written as a side effect (or holding a file path): not user setting changes; and personal ones that stay in
// the settings only (stroker.body: the owner's size, Machine panel Stroker mode; stroker.rig / stroker.cam: drawn from it,
// paw-garg; test/machine-stroker.test.mjs). A schema entry marked `private` (folder paths) is logged by its key only.
const UNLOGGED = new Set(['palette.recent', 'layout', 'recent', 'mode', 'stroker.body', 'stroker.rig', 'stroker.cam', 'stroker.camUp']);

class App {
  view = $state.raw({ start: 0, span: 10000 });
  mode = $state('scenes');
  labelling = $state.raw(null);   // the image-labelling workspace (features/labelling) once opened: while .on it owns undo / redo and the keys
  dialog = $state.raw(null);        // {title, message, choices, resolve} for the dialog host
  tasks = $state.raw([]);           // background work for the status bar: [{id, label, done, total, cancel?}]
  sidecar = $state('idle');         // 'idle' | 'busy' | 'error' | 'off' (status bar)
  hosts = false;                    // App.svelte mounts toast/dialog hosts; without them toasts go to the console
  panels = [];                      // discovered panels (App.svelte sets them; showPanel uses them)
  lanes = [];                       // discovered timeline rows (boot.js; the bottom tray's Rows tab lists them)
  blocks = new Map();               // feature blocks persisted in the .pawproj (registerBlock)
  cleanups = [];                    // paw-shgb: what ends with this app (its stores' effect roots, their listeners): destroy() runs them
  #hv = $state(0);
  #ownUsage = true;
  // key overrides only: command lists and key lookups must not rebuild on every unrelated settings write
  #keyv = $derived([this.settings?.values['keys.overrides'], this.settings?.values['keys.preset']]);   // + the keymap preset (paw-5zpf)

  /** settings / usage / tabs (paw-shgb): a further tab's app shares the first one's (one settings object, one usage log,
   *  one Tabs that adopts it). */
  constructor({ backend = {}, storage, commands = [], PlayerClass = Player, settings = null, usage = null, tabs = null } = {}) {
    this.backend = backend;
    this.doc = new Doc();
    this.settings = settings || new Settings(storage);
    if (!settings) bindSettings(this.settings);   // paw-43vn: the furry items setting's labels read it (lib/content.js); one settings object for every tab
    // local usage log (usage.svelte.js): the ring, plus the daily JSONL file under Tauri; setting usage.log turns it off
    this.#ownUsage = !usage;
    this.usage = usage || new Usage(storage, undefined, { enabled: () => this.settings.get('usage.log') !== false, sink: backend.isTauri && backend.appPaths ? fileSink(backend) : null });
    if (!settings) this.settings.onSet = (key, from, to) => {
      if (UNLOGGED.has(key) || key.startsWith('tracking.spans:') || from === to) return;
      this.usage.burst('settings:set', SCHEMA[key]?.private ? { key } : { key, from: clip(from ?? null, 120), to: clip(to ?? null, 120) }, { key: 'settings:' + key });
    };
    // the fix log (fixlog.js): what the owner had to change of what the app produced; raw facts into the usage log,
    // episodes into <data_dir>/fixes.jsonl. Same switch as the usage log.
    const logOn = () => this.settings.get('usage.log') !== false;
    this.fixes = new FixLog({
      enabled: logOn, note: (k, d) => this.usage.note(k, d, { ring: false }),
      sink: backend.isTauri && backend.appPaths ? fileSink(backend, () => 'fixes.jsonl') : null,
      ctx: () => ({ project: projectId(this.doc.media), video: this.doc.media?.name || '', at: this.player?.timeMs, scenes: this.doc.scenes }),
      axis: (id) => (id in this.doc.axes ? scriptOf(this, id) : null), sid: () => this.usage.sid,
    });
    if (this.#ownUsage) {   // one usage log: the owner's edits are the shown tab's, every tab's episodes close on a flush
      this.usage.tap = (ev) => (this.tabs?.current ?? this).fixes.event(ev);
      this.usage.beforeFlush = () => { for (const a of this.tabs?.apps ?? [this]) a.fixes.closeAll(); };
    }
    this.player = new PlayerClass(this);
    this.layout = new Layout(this);
    this.mode = migrateMode(this.settings);   // a stored 'script' (before the stage tabs) opens as Refine
    this.player.setRate(this.settings.get('player.rate'));

    const doc = this.doc;
    const h = this._history = new History({
      read: () => doc.read(), write: (p, v) => doc.write(p, v),
      readSel: () => doc.readSel(), writeSel: (s) => doc.writeSel(s),
      window: this.settings.get('history.coalesceMs'), cap: this.settings.get('history.capActions'),
      onChange: () => { this.#hv++; doc.dirty = h.dirty; },
      // one event per new undo step (coalesced nudges are one); the effects layer's changes itemised
      onRecord: (label, patches) => {
        this.fixes.record(label, patches);
        this.usage.note('edit:commit', { label, paths: patches.map((p) => p.path).join(',') });
        const fx = patches.find((p) => p.path === 'fx');
        if (fx) noteFx(this.usage, fx.before, fx.after);
      },
    });
    const self = this;
    this.history = {
      get entries() { self.#hv; return h.list(); },
      get index() { self.#hv; return h.index; },
      get canUndo() { self.#hv; return h.canUndo; },
      get canRedo() { self.#hv; return h.canRedo; },
      get undoLabel() { self.#hv; return h.index ? h.entries[h.index - 1].label : ''; },
      get redoLabel() { self.#hv; return h.canRedo ? h.entries[h.index].label : ''; },
      undo: () => this.undo(), redo: () => this.redo(), goto: (n) => h.goto(n),
      markSaved: () => h.markSaved(), markDirty: () => h.markDirty(), rebase: (path, fn) => h.rebase(path, fn),
      // Clear history keeps unsaved work unsaved (paw-xn04: it made a never-saved document look clean: no question on close)
      reset: () => { const dirty = h.dirty; h.reset(); if (dirty) h.markDirty(); },
    };

    let cv = $state(0);
    const reg = this._registry = new Registry({
      app: this,
      getOverrides: () => this.settings.get('keys.overrides') || {},
      setOverrides: (o) => this.settings.set('keys.overrides', o),
      getSetting: (k, d) => this.settings.get(k, d),   // paw-5z78: the keyboard settings
      onChange: () => cv++,
      onRun: (c, via) => { this.settings.set('palette.recent', reg.recent); this.usage.note(c.id, { src: sourceOf(via), focus: focusOf(typeof document !== 'undefined' ? document.activeElement : null), mode: this.mode }); },
      onError: (e, c) => { console.error('[command]', c?.id, e); this.toast(`${c?.title || c?.id}: ${e?.message || e}`, 'error'); },
      onWhy: (why) => this.toast(why, 'quiet', { timeout: 4000 }),
    });
    reg.recent = [...(this.settings.get('palette.recent') || [])];
    this.commands = {
      run: (id, args) => reg.run(id, args),
      list: (o) => { cv; this.#keyv; return reg.list(o); },
      keysFor: (id) => { cv; this.#keyv; return reg.keysFor(id); },
      defaultKeys: (id) => { cv; this.#keyv; return reg.defaultKeys(id); },   // paw-5zpf: in the active keymap preset
      get preset() { return reg.preset; },
      get: (id) => reg.get(id),
      setGate: (f) => { reg.gate = f; cv++; },
      enabled: (id) => reg.enabled(id),
      keyOk: (id) => { cv; return reg.keyOk(id); },   // paw-5zpf: does its key reach it here (its keyWhen)
      whyNot: (id) => reg.whyNot(id),   // paw-kxwz: a disabled command's reason (its `why`): the palette and the menus' greyed rows say it
      register: (list, source) => reg.register(list, source),
      unregister: (ids) => reg.unregister(ids),
      setKeys: (id, keys) => reg.setKeys(id, keys),
      resetAll: () => reg.resetAll(),
      isOverridden: (id) => { cv; this.#keyv; return reg.isOverridden(id); },
      conflicts: (o) => { cv; this.#keyv; return reg.conflicts(o); },
      winner: (keys, skip) => reg.winner(keys, skip),
      get recent() { cv; return reg.recent; },
      get via() { return reg.via || ''; },   // 'key' while a key press runs the command (file.close: Ctrl+W on home does nothing)
      handleKey: (e) => reg.handleKey(e),
      guardKey: (e) => reg.guardKey(e),
      notePointer: (e) => reg.notePointer(e),
      handleKeyUp: (e) => reg.handleKeyUp(e),
    };
    // the top bar's tabs (paw-shgb): while the home tab hides the document, only its own commands run. A further tab's app
    // joins the first one's Tabs (it adopts it once made)
    if (tabs) this.tabs = tabs; else new Tabs(this);
    reg.scope = (c) => !this.tabs.hidden || homeAllows(c.id);
    reg.register(tabsCommands(this), 'app');
    reg.register(editorCommands, 'app');   // paw-5z78: before every feature's arrows and Escape (a selected editor item first)
    reg.register(commands, 'app');
    reg.register(usageCommands, 'app');

    // usage: play / pause from any source, user seeks (scrubs coalesced; the tracker's follow and loop wraps are not
    // user input) and loops; the heartbeat, dialogs and window errors (usage.start)
    const player = this.player, seek = player.seek.bind(player), setLoop = player.setLoop.bind(player);
    player.seek = (ms, o) => { const from = player.timeMs, r = seek(ms, o); if (this.usage.userActive(1500)) this.usage.burst('play:seek', { from: Math.round(from), to: Math.round(+ms || 0) }); return r; };   // the video player's seek returns a promise
    player.setLoop = (l) => { const had = player.loop; setLoop(l); if (had || player.loop) this.usage.note('play:loop', player.loop ? { t0: Math.round(player.loop.t0), ms: Math.round(player.loop.t1 - player.loop.t0) } : { off: true }); };
    if (this.#ownUsage) this.usage.start(typeof window !== 'undefined' ? window : null, { beat: () => { const a = this.tabs?.current ?? this; return { playing: !!a.player.playing, mode: a.mode, tabs: this.tabs?.list.length ?? 1 }; } });

    // follow the playhead while playing (the timeline keeps it in view)
    this._stop = $effect.root(() => {
      let was = null;
      $effect(() => {
        const on = !!this.player.playing;
        if (was !== null && on !== was) untrack(() => this.usage.note(on ? 'play:play' : 'play:pause', { at: Math.round(this.player.timeMs), rate: this.player.rate }));
        was = on;
      });
      $effect(() => {
        const dur = this.durationMs, t = Math.max(0, Math.min(dur, this.player.timeMs));   // a clock outside [0, dur] fits no view
        if (!this.player.playing || !this.follow) return;
        const v = followView(this.view, t, dur), cur = untrack(() => this.view);
        if (v.start !== cur.start || v.span !== cur.span) this.view = v;   // followView/clampView return new objects
      });
    });
  }

  // ---- document ----
  /** Duration of the media: the probe's, else the player's; 0 with no media or unknown (seek / end clamps use this). */
  get mediaMs() { return this.doc.media ? this.doc.media.durationMs || this.player.durationMs || 0 : 0; }
  /** Last action time across every axis (0 for none). */
  get scriptEndMs() {
    let end = 0;
    for (const s of Object.values(this.doc.axes)) if (s?.length) end = Math.max(end, s[s.length - 1].at);
    return end;
  }
  /** Duration of the timeline: the media's, but never shorter than the script (points past the video end stay
   *  visible and editable); with no media the script's end plus a little. */
  get durationMs() {
    const m = this.mediaMs, end = this.scriptEndMs;
    if (m) return Math.max(m, end);
    return end ? end + 2000 : 60000;
  }

  /** The ONLY way to change a script. One undo entry (or part of the open transaction). opts.coalesce merges
   *  rapid repeats of the same label (nudges) into one entry. paw-x7w7: `next` is the script as the editor sees it
   *  (lib/script-of.js scriptOf: baked + live); what is written is settled: a live shot the edit changed is baked with
   *  the edit in this same step, live shots it left alone stay live. opts.empty (the Delete / Cut commands, paw-q8jh): a live
   *  piece the edit leaves with no point is baked empty (a writer working from the baked points never empties one). */
  edit(label, axis, next, opts = {}) {
    if (!Array.isArray(next)) throw new TypeError('app.edit: next must be a Script array');
    const live = this.liveOf?.(axis), raw = settleEdit(this.doc.axes[axis], live, next), blank = opts.empty ? emptiedLive(live, next) : [];
    if (this.doc.axes[axis] === raw && !blank.length) return;
    for (const s of touchedLive(live, next)) this.fixes?.produced?.(axis, live.script, s.t0, s.t1, label);   // the fix log measures hand edits against the run's points
    this._history.transact(label, () => {
      if (this.doc.axes[axis] !== raw) this.doc.axes = { ...this.doc.axes, [axis]: raw };
      if (blank.length) this.doc.bakedEmpty = [...(this.doc.bakedEmpty || []), ...blank.map((s) => ({ axis, t0: s.t0, t1: s.t1 }))];   // paw-q8jh: every point of a live piece deleted: baked empty
      const sel = this.doc.selection;
      if (sel.axis === axis && sel.ats.size) {
        const have = new Set();
        for (const a of next) if (sel.ats.has(a.at)) have.add(a.at);
        if (have.size !== sel.ats.size) this.doc.selection = sel.active?.every((t) => have.has(t)) ? { axis, ats: have, active: sel.active } : { axis, ats: have };
      }
    }, opts);
  }
  /** Group several edits and doc changes (chapters, loops, ... by plain assignment) into one undo entry.
   *  fn may be async; a throw rolls everything back. */
  transact(label, fn, opts) { return this._history.transact(label, fn, opts); }
  /** Open a group by hand (drags): const g = app.begin('Move points'); ... g.commit() or g.cancel(). */
  begin(label, opts) { return this._history.begin(label, opts); }
  /** paw-zu4h: '' or why undo / redo wait now (the tracking store: a track is running; its landing would drop the redo steps). */
  undoBlock = null;
  #blocked(what) { const why = this.undoBlock?.(); if (why) this.toast(`${what} waits: ${why}`, 'quiet'); return !!why; }
  undo() { if (this.#blocked('Undo')) return null; const e = this._history.undo(); this.usage.note('edit:undo', { label: e?.label ?? null }); if (e) this.toast('Undo: ' + e.label, 'quiet'); return e; }
  redo() { if (this.#blocked('Redo')) return null; const e = this._history.redo(); this.usage.note('edit:redo', { label: e?.label ?? null }); if (e) this.toast('Redo: ' + e.label, 'quiet'); return e; }

  /** Replace the selection: ats = iterable of action times on `axis` (default: the active axis). */
  select(ats, axis = this.doc.activeAxis) {
    // paw-5zpf: the active element (selection.active, its point times) stays while it is still selected: the selection grows around it
    const s = new Set(ats), a = this.doc.selection, active = a.axis === axis && a.active?.every((t) => s.has(t)) ? a.active : null;
    this.doc.selection = active ? { axis, ats: s, active } : { axis, ats: s };
  }
  setActiveAxis(axis) {
    this.doc.activeAxis = axis;
    if (this.doc.selection.axis !== axis) this.doc.selection = { axis, ats: new Set() };
  }
  /** The active axis's script ([] if it has none yet): baked + live (lib/script-of.js scriptOf, paw-x7w7). */
  get script() { return scriptOf(this); }

  /** New document (keeps settings). Clears undo history. */
  load(d) {
    this.fixes?.reset();   // the open episodes summarised against the document they belong to
    this.player.pause();
    this.doc.load(d);
    this._history.reset();
    this.player.setLoop(null);
    if (d?.media) this.player.setMedia(d.media);
    else this.player.setDuration(this.durationMs);
    this.view = clampView({ start: 0, span: this.durationMs }, this.durationMs);
    this.tabs?.loaded(this);
  }

  // ---- feature blocks in the .pawproj ----
  /** A feature's own top-level block in the project file: save(app) -> JSON value (null = omit), load(app, value|null),
   *  saved?(app, projectPath) -> Promise (after each save of the .pawproj: a file the feature keeps beside it),
   *  autosaved?(app, dir) -> Promise (after each autosave snapshot: dir = its autosave folder). load gets a third
   *  argument {autosaveDir} when the document was restored from an autosave. */
  registerBlock(key, { save, load, saved, autosaved, ...more }) { this.blocks.set(key, { save, load, saved, autosaved, ...more }); }   // more: a block's own extras (runs: refs, revive, compact)
  /** Every block's autosaved(app, dir); a throw fails the autosave (it is retried on the next tick). */
  async blocksAutosaved(dir) { for (const b of this.blocks.values()) if (b.autosaved) await b.autosaved(this, dir); }
  /** Every block's saved(app, projectPath), in order. -> ['key: error', ...] (empty = all written). */
  async blocksSaved(projectPath, opts) {
    const errors = [];
    for (const [k, b] of this.blocks) if (b.saved) { try { await b.saved(this, projectPath, opts); } catch (e) { console.error('[block ' + k + ']', e); errors.push(`${k}: ${e?.message || e}`); } }
    return errors;
  }
  saveBlocks() {
    const o = {};
    for (const [k, b] of this.blocks) { try { const v = b.save(this); if (v != null) o[k] = v; } catch (e) { console.error('[block ' + k + ']', e); } }
    return o;
  }
  loadBlocks(extra = {}, ctx = {}) { for (const [k, b] of this.blocks) { try { b.load(this, extra[k] ?? null, ctx); } catch (e) { console.error('[block ' + k + ']', e); } } }

  // ---- view ----
  setView(v) {
    const from = this.view.span;
    this.view = clampView(v, this.durationMs);
    if (this.view.span !== from) this.usage.burst('view:zoom', { from: Math.round(from), to: Math.round(this.view.span) });
  }
  get follow() { return this.settings.get('player.follow'); }
  set follow(on) { this.settings.set('player.follow', !!on); }
  setMode(m) { if (MODES.includes(m)) { if (m !== this.mode) this.usage.note('ui:mode', { mode: m, from: this.mode }); this.mode = m; this.settings.set('mode', m); } }
  /** Bring a panel into view: switch mode if the panel isn't in this one, unfold its area, select its tab. */
  showPanel(id) {
    const p = this.panels.find((x) => x.id === id);
    if (!p) return false;
    if (p.modes && !p.modes.includes(this.mode)) this.setMode(p.modes[0]);
    this.layout.tab(p.dock, id);
    return true;
  }
  /** Show the panel, or fold its area if it is already the visible tab. */
  togglePanel(id) {
    const p = this.panels.find((x) => x.id === id);
    if (!p) return false;
    if (this.layout.shows(id)) { this.layout.toggle(this.layout.dockOf(p), false); return true; }
    return this.showPanel(id);
  }
  /** Panels shown in an area in the current mode, in tab order: an area id, or a dock name (left / right / bottom). */
  panelsIn(dock) { return this.layout.panelsIn(dock); }

  // ---- feedback ----
  /** kind: 'info' | 'ok' | 'warn' | 'error' | 'quiet'. opts: {timeout ms, action: {label, run}, actions: [more {label, run}]}. Returns an id. */
  toast(msg, kind = 'info', opts = {}) {
    if (!/^(Undo|Redo): /.test(msg)) this.usage.note('ui:toast', { level: kind, text: clip(String(msg), 200) });   // undo / redo have their own events
    if (!this.hosts) { (kind === 'error' ? console.error : kind === 'warn' ? console.warn : console.log)('[toast:' + kind + ']', msg); return ++toastSeq; }
    if (kind === 'quiet' && lastQuiet) dismissToast(lastQuiet);   // quiet feedback (speed, undo label) replaces itself
    const id = kitToast(String(msg), { kind: TONE[kind] || 'info', timeout: opts.timeout ?? (kind === 'quiet' ? 1400 : kind === 'error' ? this.settings.get('ui.toastErrorS') * 1000 : 4000), action: opts.action, actions: opts.actions, tip: opts.tip });
    if (kind === 'quiet') lastQuiet = id;
    return id;
  }
  dismiss(id) { dismissToast(id); }
  /** A choice dialog: choices [{id, label, kind?: 'primary'|'danger'}] -> Promise<id | null (dismissed)>.
   *  A 'danger' choice is only returned when a person clicked it in the dialog (never from a script). */
  choose({ title = '', message = '', choices = [{ id: 'ok', label: 'OK', kind: 'primary' }], detail = '' } = {}) {
    if (!this.hosts) {
      if (typeof window === 'undefined' || !window.confirm) return Promise.resolve(choices[0]?.id ?? null);
      return Promise.resolve(window.confirm([title, message].filter(Boolean).join('\n\n')) ? choices[0]?.id ?? null : null);
    }
    return new Promise((resolve) => {
      this.dialog?.resolve(null);
      // A destructive choice (kind 'danger': Discard, Replace, ...) only counts when a person clicked it (how.trusted,
      // set by the dialog host from the click's isTrusted); a script resolving it gets null (= dismissed).
      const dlg = { title, message, detail, choices, resolve: (v, how) => {
        if (v != null && choices.find((c) => c.id === v)?.kind === 'danger' && !how?.trusted) { console.warn('[dialog] destructive choice "' + v + '" needs a user click; treated as dismissed'); v = null; }
        if (this.dialog === dlg) this.dialog = null;
        resolve(v);
      } };
      this.dialog = dlg;
    });
  }
  /** confirm({title, message, ok, cancel, danger}) -> Promise<bool>. */
  async confirm({ title = '', message = '', ok = 'OK', cancel = 'Cancel', danger = false, detail = '' } = {}) {
    const r = await this.choose({ title, message, detail, choices: [{ id: 'ok', label: ok, kind: danger ? 'danger' : 'primary' }, { id: 'cancel', label: cancel }] });
    return r === 'ok';
  }
  /** Background work shown in the status bar: const t = app.task('Tracking'); t.update(done, total); t.end(). */
  task(label, { cancel } = {}) {
    const id = ++taskSeq;
    this.tasks = [...this.tasks, { id, label, done: 0, total: 0, cancel }];
    const patch = (p) => (this.tasks = this.tasks.map((t) => (t.id === id ? { ...t, ...p } : t)));
    return { id, update: (done, total) => patch({ done, total }), label: (l) => patch({ label: l }), end: () => (this.tasks = this.tasks.filter((t) => t.id !== id)) };
  }

  /** A closed tab's app (tabs.svelte.js) or a test's: a shared usage log goes on while another tab uses it. */
  destroy() { for (const f of this.cleanups?.splice(0) || []) { try { f(); } catch (e) { console.warn('[app] cleanup:', e); } } if (this.#ownUsage && !this.tabs?.apps.some((a) => a !== this)) this.usage.stop(); this._stop?.(); this.player.detach(); this.player.pause(); }
}

/** opts: { backend, storage (localStorage | null = in-memory), commands: Command[] } */
export function createApp(opts) { return new App(opts); }
export { MODES };
