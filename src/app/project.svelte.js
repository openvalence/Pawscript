// project.svelte.js -- app.project: open, import, save, save as, export, close, revert, autosave + crash recovery,
// recent files, close guard (ARCHITECTURE.md "app.project", src-tauri/API.md). Decisions and the write pipeline
// are in project-logic.js (node tested); this file asks the user and moves state in and out of app.doc.
//
// Where things live: the .pawproj path, the pseudo base of a video-less document and the project's pass-through
// keys are in app.doc.project ({path, base, extra, meta, settings, profileId}); per-axis source files in
// app.doc.files ({path, raw, meta, script, chapters?, bookmarks?, foreign, backedUp}). So everything follows
// app.load.
//
// paw-up1r stage 1 + paw-bztd: the project is continuous. Every change reaches its .pawproj (and .pawruns) about a second
// after it is made (never during a drag or playback, a minute at most): no Save question on close / open another / quit, no
// "Recover unsaved work?". A document that never had a place gets <video stem>.pawproj beside the video, else one in
// <data_dir>/projects. Beside it, <stem>.pawhistory/ (project-history.js) keeps the undo stack (reopened with the project) and
// automatic checkpoints (after a track, before a run is discarded, on close; restorable from the project page). Where the
// owner was (playhead, view, tab, selection ...) is kept per document in localStorage 'pawscript.resume' and put back on open.
// The app-data autosaves (backend.autosave*) remain only as the net when the project cannot be written.

import * as L from './project-logic.js';
import { parseFunscript, parseAxisFile, axisName, axisPath, parse as parseProject, serialize as serializeProject,
  addRecent, removeRecent, pinRecent, markMissing, BUILTIN_PRESETS } from '../lib/io/index.js';
import { probeRequest } from '../lib/protocol.js';
import { finalAxes } from '../lib/finish.js';
import { howOf, readProvenance, originText, APP_BUILD } from '../lib/provenance.js';
import { summarize, thumbTime, thumbKey } from './home.js';
import { isPackPath, openPack } from './pack.js';
import { historyDir, contentKey, pruneCheckpoints, exportHistory, importHistory, UNDO_BYTES, undoText, undoUsable, publishKey, kindOf, bareName } from './project-history.js';
import { reopenGuarded } from './open-guard.js';
import { diffDocs, compactChanges, summaryOf, restoreSection, scopeLabel } from './history-diff.js';
import { UNDOABLE, EMPTY } from './doc.svelte.js';
import { untrack } from 'svelte';
import { scriptOf } from '../lib/script-of.js';   // paw-x7w7: baked + live
import { startWrite, closeApp } from './writing.svelte.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const errText = (e) => e?.message || String(e);
const newSession = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const quiet = (p) => Promise.resolve(p).catch(() => {});
const sameRefs = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
// feature state a resume puts back (absent features: nothing), like features/feedback does
const first = (mods, name) => Object.values(mods).map((m) => m?.[name]).find((v) => v != null);
const timelineMods = import.meta.glob('../features/timeline/state.svelte.js', { eager: true });
const trackingMods = import.meta.glob('../features/tracking/tracking.svelte.js', { eager: true });
const RESUME = 'pawscript.resume';
const LOCK_BEAT_MS = 30_000, LOCK_STALE_MS = 90_000;   // paw-vm6e: the project lock's refresh, and the age a crashed window's lock is taken at
const RESUME_SEL = 300;         // paw-juqk: a bigger selection is not kept (a few KB per document at most)
const RESUME_CHARS = 400_000;    // the whole store, well under WebView2's ~5 M chars per origin
const RUN_GHOST = new Set(['tracker', 'modrun']);
const runIdsOf = (ghosts = []) => new Set(ghosts.filter((g) => RUN_GHOST.has(g.source?.kind)).map((g) => g.id));
// paw-f4i2: what one write of the document came to, for every caller: {ok: true} | {ok: false, why} (stale: another document
// was loaded meanwhile, nothing of this one to keep)
const WROTE = Object.freeze({ ok: true });
const failed = (why, stale = false) => ({ ok: false, why: String(why || 'failed'), ...(stale ? { stale: true } : {}) });

class Project {
  lastAutosave = $state(0);         // ms of the last write of the project (or of an app-data snapshot)
  writeError = $state('');          // why the project could not be written ('' = it is on disk); the status bar says it
  keptIn = $state('');              // paw-f4i2: the app-data snapshot (read back) holding the work the project file lacks, '' none
  busy = $state('');                // '' | 'open' | 'save' | 'export' | 'publish'
  // paw-up1r stage 2: the published version {version, commit (its history entry id | null), at (ms), key (publishKey),
  // adopted?} | null, and the commit dialog's content (null = closed; {loading} | {groups, scope, empty, since})
  published = $state.raw(null);
  commitDraft = $state.raw(null);
  #shas = {};                       // pathKey -> sha256 we last read/wrote there this session (project-logic.js)
  #session = newSession();          // autosave session of the open document
  #sessions = new Set([this.#session]);   // every session this document autosaved under (cleared after a save)
  #timer = 0;
  #running = false;
  #snapKey = null;
  #autosaveFailed = false;
  #q = Promise.resolve();           // writes, checkpoints and snapshots, one at a time; a load waits for them
  #gen = 0;                         // bumped by every load: a write started under one document never lands for another
  #lastText = null;                 // the .pawproj text last written (or read at open): the state on disk
  #opened = null;                   // {text, path} the project file as opened, kept as a checkpoint before its first write
  #wrote = false;                   // written this session (a close checkpoint only then)
  #snapped = false;                 // an app-data snapshot holds this document's work: cleared once the project is written
  #hist = null;                     // {dir, list} the open project's .pawhistory folder (dir null until made) and checkpoints
  #runIds = null;                   // the tracker-run ghost ids at the last write (milestones: a run landed / went)
  #mem = { last: null, docs: {} };  // resume store without localStorage (tests, harnesses)
  #persisted = null;                // what of the saved state is not undoable (persistable ghosts, project blocks), at the last check
  #settleUntil = 0;
  #stopWatch;

  constructor(app) {
    this.app = app;
    // Changes that are not undo steps (a reference ghost, a tracker run, the ruler mode, assist answers in a project
    // block) still change what a save writes: they mark the document dirty, so the continuous write sees them.
    // ponytail: a short settle window after each open re-baselines instead of tracking which feature wrote what.
    (app.cleanups ??= []).push(() => { this.#stopWatch?.(); this.stopAutosave(); });   // paw-shgb: a closed tab's watch ends with it
    this.#stopWatch = $effect.root(() => {
      $effect(() => {
        const now = this.#persistState();
        untrack(() => {
          const was = this.#persisted;
          this.#persisted = now;
          if (!was || this.busy || Date.now() < this.#settleUntil || this.app.doc.dirty) return;
          if (!sameRefs(was.ghosts, now.ghosts) || was.json !== now.json) this.app.history.markDirty();
        });
      });
    });
  }
  #persistState() {
    const d = this.app.doc;
    let blocks = null;
    try { blocks = this.app.saveBlocks?.(); } catch { /* a feature's block failed; reported when saving */ }
    return { ghosts: L.savedGhosts(d.ghosts || []), json: JSON.stringify([L.meaningful(d.project?.extra), L.meaningful(blocks)]) };
  }
  #exists(p) { return Promise.resolve(this.app.backend.exists(p)).catch(() => false); }

  get path() { return this.app.doc.project?.path ?? null; }
  /** Path the sibling funscripts derive from: the video, else the project, else a funscript's stem. */
  get base() { return this.app.doc.media?.path || this.path || this.app.doc.project?.base || ''; }
  get name() { return this.path ? L.fileName(this.path) : this.app.doc.media?.name || (this.base ? L.fileName(this.base) : ''); }
  get hasDoc() { const d = this.app.doc; return !!(d.media || this.path || d.project?.base || Object.values(d.axes).some((s) => s.length)); }

  // ---------- recent ----------
  get recent() {
    const r = this.app.settings.get('recent');
    return Array.isArray(r) ? r.filter((e) => e && typeof e.path === 'string').map((e) => ({ name: L.fileName(e.path), kind: 'video', pinned: false, missing: false, ...e, openedAt: e.openedAt ?? e.at ?? 0 })) : [];
  }
  #touchRecent(path, kind) {
    this.app.settings.set('recent', addRecent(this.recent, { path, kind, ...this.#recentFacts() }));
    if (typeof this.app.backend.recentAdd === 'function') quiet(this.app.backend.recentAdd(path));   // feeds the OS-level list
    quiet(this.#thumb());
  }
  /** The open document's recent entry key: its project, else its video, else its funscript base. */
  get #recentPath() { return this.path || this.app.doc.media?.path || this.app.doc.project?.base || null; }
  /** The same, for the tabs (paw-shgb: the open tabs come back at start by it). */
  get key() { return this.hasDoc ? this.#recentPath : null; }
  /** What the project page shows of the open document (home.js summarize), stored in its recent entry. */
  #recentFacts(blocks = undefined) {
    const d = this.app.doc;
    let links = null;
    try { links = (blocks === undefined ? this.app.saveBlocks?.() : blocks)?.links ?? null; } catch { /* a block failed: no links */ }
    // app.doc's fields are accessors (a $state class): named here, a spread of it would be empty
    // paw-pjlg: the points as they play (baked + live runs), not the baked ones only
    const axes = Object.fromEntries([...new Set([...Object.keys(d.axes || {}), 'stroke'])].map((a) => [a, scriptOf(this.app, a)]));
    return { video: d.media?.path || null, summary: summarize({ axes, scenes: d.scenes, project: d.project, media: { ...(d.media || {}), durationMs: this.app.mediaMs || d.media?.durationMs || 0 } }, { links }) };
  }
  /** Refresh the open document's entry (summary) without moving it in the list. */
  #noteRecent(blocks) {
    const p = this.#recentPath, list = this.recent, i = p ? list.findIndex((e) => L.pathKey(e.path) === L.pathKey(p)) : -1;
    if (i < 0) return;
    const next = list.slice();
    next[i] = { ...list[i], ...this.#recentFacts(blocks) };
    this.app.settings.set('recent', next);
  }
  #patchRecent(path, patch) { this.app.settings.set('recent', this.recent.map((e) => (L.pathKey(e.path) === L.pathKey(path) ? { ...e, ...patch } : e))); }
  #dataDir = null;
  /** The card's still: one frame (home.js thumbTime) as a small JPEG in <data_dir>/thumbs, written by the native frame extractor
   *  at open / save time (never at the home screen), keyed by the entry and the video's size + mtime. Errors are swallowed:
   *  the page shows a placeholder. Private: the app data dir only, never logged. */
  async #thumb() {
    const be = this.app.backend, d = this.app.doc, video = d.media?.path, key = this.#recentPath;
    if (!video || !key || typeof be.saveFrame !== 'function' || typeof be.appPaths !== 'function' || typeof be.makeDir !== 'function') return;
    try {
      const st = await be.stat(video);
      if (!st?.exists) return;
      let links = null;
      try { links = this.app.saveBlocks?.()?.links ?? null; } catch { /* none */ }
      const tk = thumbKey(key, st), ms = thumbTime(d, { links, durationMs: this.app.mediaMs });
      const e = this.recent.find((x) => L.pathKey(x.path) === L.pathKey(key));
      if (!e || (e.thumbKey === tk && Math.abs((e.thumbMs ?? -1e9) - ms) < 1000 && e.thumb && (await this.#exists(e.thumb)))) return;
      const dir = (await (this.#dataDir ??= Promise.resolve(be.appPaths()))).data_dir + '\\thumbs';
      await be.makeDir(dir);
      const dest = `${dir}\\${tk}-${ms}.jpg`;
      await be.saveFrame(video, ms, dest, { maxWidth: 480 });
      this.#patchRecent(key, { thumb: dest, thumbKey: tk, thumbMs: ms });
      if (e.thumb && L.pathKey(e.thumb) !== L.pathKey(dest) && L.pathKey(e.thumb).includes('/thumbs/')) await quiet(be.remove(e.thumb));
    } catch { /* no still: the card shows a placeholder */ }
  }
  removeRecent(path) {
    const e = this.recent.find((x) => L.pathKey(x.path) === L.pathKey(path));
    this.app.settings.set('recent', removeRecent(this.recent, path));
    if (e?.thumb && L.pathKey(e.thumb).includes('/thumbs/')) quiet(this.app.backend.remove?.(e.thumb));   // our own cached still only, never the user's files
  }
  pinRecent(path, on = true) { this.app.settings.set('recent', pinRecent(this.recent, path, on)); }
  /** Re-check which recent entries still exist (sets `missing`). */
  async refreshRecent() {
    const list = this.recent;
    const ok = await Promise.all(list.map((e) => Promise.resolve(this.app.backend.exists(e.path)).catch(() => false)));
    const gone = new Set(list.filter((_, i) => !ok[i]).map((e) => L.pathKey(e.path)));
    this.app.settings.set('recent', markMissing(this.recent, (p) => !gone.has(L.pathKey(p))));
  }
  async openRecent(path) {
    if (!path) return false;
    if (!(await Promise.resolve(this.app.backend.exists(path)).catch(() => false))) {
      this.app.toast(`${L.fileName(path)} is no longer there`, 'warn');
      this.app.settings.set('recent', this.recent.map((e) => (L.pathKey(e.path) === L.pathKey(path) ? { ...e, missing: true } : e)));
      return false;
    }
    return this.#openTab([path]);
  }
  /** paw-shgb: what the owner opens goes into a tab of its own (the open one again only switches to it); without tabs
   *  (harnesses) it replaces the document. */
  #openTab(paths) { return this.app.tabs?.open ? this.app.tabs.open(paths) : this.openPaths(paths); }

  // ---------- open ----------
  async openDialog() {
    const p = await this.app.backend.openDialog({ title: 'Open', multiple: true,
      filters: [{ name: 'Video, project or funscript', extensions: [...L.VIDEO_EXT, 'pawproj', 'pawpack', 'funscript'] }] });
    const list = [].concat(p || []);
    return list.length ? this.#openTab(list) : false;
  }

  /** A dropped / picked set: a .pawproj wins; else a video (+ funscripts that are not its siblings are imported); else funscripts.
   *  opts.recover: an unsaved autosave of what is opened is restored without asking (the project page's cards). The ONE
   *  entry point the project page opens through (the tabs work swaps it). */
  async openPaths(paths, opts = {}) {
    const recover = !!opts.recover;
    const pack = [].concat(paths || []).find(isPackPath);   // paw-2k9s: a .pawpack unpacks, then its project opens
    if (pack) return openPack(this.app, pack);
    const c = L.classifyPaths([].concat(paths || []));
    const n = c.projects.length + c.videos.length + c.funscripts.length;
    if (c.projects.length) {
      if (n > 1) this.app.toast(`Opened ${L.fileName(c.projects[0])} only, not the other files`, 'warn');
      return this.openProject(c.projects[0], { recover });
    }
    if (c.videos.length) {
      if (c.videos.length > 1) this.app.toast(`Opening ${L.fileName(c.videos[0])} (one video at a time)`, 'warn');
      const v = c.videos[0], extras = c.funscripts.filter((f) => L.pathKey(parseAxisFile(f)?.base || '') !== L.pathKey(L.stem(v)));
      // the video's own project (what the continuous write made beside it): opening the video again goes back into it
      const own = L.stem(v) + '.pawproj';
      const ok = (await this.#exists(own)) ? await this.openProject(own, { recover }) : await this.openVideo(v, { recover });
      if (ok) for (const f of extras) await this.importFile(f);
      return ok;
    }
    if (c.funscripts.length) {
      if (this.hasDoc) { let ok = false; for (const f of c.funscripts) ok = (await this.importFile(f)) || ok; return ok; }
      return this.#openFunscripts(c.funscripts, { recover });
    }
    if (c.other.length) this.app.toast(`Can't open ${L.fileName(c.other[0])}: not a video, .pawproj or .funscript`, 'warn');
    return false;
  }

  /** Open a video: probe it, find sibling funscripts for every axis, offer autosave recovery, then load. */
  openVideo(path, opts = {}) { return this.#openAt({ base: path, video: path, ...opts }); }

  /** Funscripts without a video: use a same-stem video if there is one, else edit the files on their own. */
  async #openFunscripts(paths, opts = {}) {
    const first = parseAxisFile(paths[0]);
    if (!first) return false;
    // a missing or empty file is reported, not opened as an empty document under its name
    let f0 = null;
    try { f0 = await L.readMaybe(this.app.backend, paths[0]); } catch (e) { this.app.toast(`Could not read ${L.fileName(paths[0])}: ${errText(e)}`, 'error'); return false; }
    if (!f0) { this.app.toast(`${L.fileName(paths[0])} ${(await this.#exists(paths[0])) ? 'is empty' : 'was not found'}`, 'error'); return false; }
    const others = paths.filter((f) => L.pathKey(parseAxisFile(f)?.base || '') !== L.pathKey(first.base));
    let ok = (await this.#exists(first.base + '.pawproj')) ? await this.openProject(first.base + '.pawproj', opts) : null;
    for (const e of ok === null ? L.VIDEO_EXT : []) {
      const v = first.base + '.' + e;
      if (await Promise.resolve(this.app.backend.exists(v)).catch(() => false)) { ok = await this.openVideo(v, opts); break; }
    }
    if (ok === null) ok = await this.#openAt({ base: first.base + '.funscript', video: null, mode: 'edit', ...opts });
    if (ok) for (const f of others) await this.importFile(f);
    return ok;
  }

  /** restore: {cand, pd} chosen already (checkRecovery) -> no recovery question. */
  async #openAt({ base, video, mode = null, force = false, restore = null }) {
    this.app.usage?.note('project:open', { file: L.fileName(base || video || ''), kind: video ? 'video' : 'funscript' });
    const app = this.app, be = app.backend;
    if (this.busy) { app.toast('Busy: ' + this.busy, 'quiet'); return false; }
    if (video && !restore && !(await this.#exists(video))) { app.toast(`${L.fileName(video)} was not found`, 'error'); return false; }
    // paw-tjy6: a file that is there but ffprobe cannot read (empty, damaged, not a video) opens nothing: no card, no decode
    const probe = video ? await this.#probe(video) : null;
    if (probe?.unreadable && !restore) {
      const st = await Promise.resolve(be.stat?.(video)).catch(() => null);
      app.toast(`${L.fileName(video)} can't be read as a video${st?.exists && !st.size ? ' (empty file)' : ''}`, 'error');
      return false;
    }
    if (!force && !(await this.#leave())) return false;   // paw-f4i2: work kept nowhere stays open
    this.busy = 'open';
    try {
      const [disc, offer] = await Promise.all([
        L.discover(be, base),
        restore || L.findCandidate(be, { base }),
      ]);
      const media = video ? L.mediaFrom(video, probe?.media) : null;
      const notes = [...disc.notes];
      if (video && !probe?.media) notes.unshift(`Video not probed (${probe?.error || 'no probe'}); duration comes from the player`);
      const project = video ? null : { path: null, base };

      // an app-data snapshot of work never written to a project (a failed write, an older version's autosave): it is the
      // newest state, so it opens without a question
      if (offer) {
        const d = L.appDocFrom(offer.pd, { base: project?.base ?? null });
        if (media) d.media = probe?.media || !d.media ? media : { ...d.media, path: video, name: media.name };
        await this.#applyRestore(d, offer.cand, disc, L.shasFrom(disc.found), notes);
        this.#touchRecent(video || base, video ? 'video' : 'funscript');
        this.#resume(video || base, offer.pd);
        return true;
      }

      // the scripts beside the video are loaded, no question (paw-kdck): the one a player picks per axis (lib/io discoverAxes),
      // the other candidates offered as ghosts in the same toast
      mode ||= 'edit';
      const d = L.buildOpenDoc({ media, found: disc.found, mode });
      d.project = project;
      await this.#load(d, mode === 'edit' ? L.shasFrom(disc.found) : {}, notes);
      if (mode === 'edit') this.#knowFiles(disc.found);
      this.#touchRecent(video || base, video ? 'video' : 'funscript');
      this.#resume(video || base, null);
      const got = Object.values(disc.found), others = [...Object.values(disc.shadowed || {}), ...(disc.others || [])];
      if (video && got.length) {
        app.toast(`Loaded ${got.map((f) => L.fileName(f.path)).join(', ')} from beside the video${others.length ? ` (${plural(others.length, 'other script')} there too)` : ''}`, 'quiet',
          { timeout: others.length ? 9000 : 4000, ...(others.length ? { action: { label: `Show ${others.length === 1 ? 'it' : 'them'} as ghosts`, run: async () => { for (const p of others) await this.importFile(p, { as: 'ghost' }); } } } : {}) });
      }
      return true;
    } catch (e) {
      app.toast(`Could not open ${L.fileName(video || base)}: ${errText(e)}`, 'error');
      return false;
    } finally { this.busy = ''; }
  }

  /** Load a restored document: dirty, so the continuous write puts it in its project; the snapshot goes once that is done. */
  async #applyRestore(d, cand, disc, shas, notes) {
    d.ghosts = await L.rehydrateGhosts(this.app.backend, d.ghosts);
    d.files = L.filesFrom(disc?.found || {});
    // blocks may keep a file in the autosave folder (tracking: runs.pawruns): their load reads it from there
    await this.#load(d, shas, notes, { autosaveDir: cand.snapshots?.[0]?.path ? L.dirName(cand.snapshots[0].path) : null });
    this.app.history.markDirty();
    if (cand.session) { this.#session = cand.session; this.#sessions.add(cand.session); }   // its next snapshot (if any) replaces it
    this.#snapped = true;
    this.app.toast(`Restored the work kept in app data on ${new Date(cand.updated_ms).toLocaleString()} (newer than the files)`, 'ok');
  }

  /** ffprobe (native) first; the sidecar probe only when ffmpeg is missing. -> {media} | {error} */
  async #probe(path) {
    const be = this.app.backend;
    if (typeof be.mediaProbe === 'function') {
      try { return { media: await be.mediaProbe(path) }; }
      // unreadable: ffprobe ran and could not read it (not: ffprobe could not start, media.rs/ffmpeg.rs "cannot start")
      catch (e) { if (e?.code !== 'ffmpeg_missing') return { error: errText(e), unreadable: e?.code === 'no_media' || (e?.code === 'ffmpeg_failed' && !/cannot start/.test(errText(e))) }; }
    }
    try {
      if (typeof be.sidecar !== 'function') return { error: 'no ffprobe and no sidecar' };
      const r = await be.sidecar(probeRequest(path));
      return r?.result?.media ? { media: r.result.media } : { error: String(r?.error || 'no result').split('\n')[0] };
    } catch (e) { return { error: errText(e) }; }
  }

  /** What Pawscript last wrote to or loaded from each funscript beside the document: pathKey -> {path, sha}. Kept in the project
   *  ('scriptFiles'), so "changed outside" means changed since then, never "the project is ahead of its funscript". */
  #known = {};
  /** found: discover().found; stored: the project's scriptFiles block. A file it has no sha for (an older project) is taken as
   *  known now. -> the files changed outside since (they keep the stored sha until loaded or written). */
  #knowFiles(found, stored = null) {
    const was = Object.fromEntries((Array.isArray(stored?.files) ? stored.files : []).filter((x) => typeof x?.path === 'string' && typeof x.sha256 === 'string').map((x) => [L.pathKey(x.path), x.sha256]));
    const changed = [];
    for (const [axis, f] of Object.entries(found || {})) {
      const k = L.pathKey(f.path), sha = was[k];
      if (sha && sha !== f.sha256) changed.push({ ...f, axis });
      this.#known[k] = { path: f.path, sha: sha || f.sha256 };
    }
    return changed;
  }
  #knowWritten(path, sha) { if (path && sha) this.#known[L.pathKey(path)] = { path, sha }; }
  /** The toast's "Load the file": the files on disk become the axes, one undo step, a checkpoint first. */
  async #takeFiles(list) {
    const app = this.app, names = list.map((f) => L.fileName(f.path)).join(', ');
    await this.checkpoint(`Before loading ${names}`);
    const d = app.doc;
    app.transact(`Load ${names}`, () => { d.axes = { ...d.axes, ...Object.fromEntries(list.map((f) => [f.axis, f.parsed.script])) }; });
    d.files = { ...d.files, ...L.filesFrom(Object.fromEntries(list.map((f) => [f.axis, f])), d) };
    for (const f of list) { this.#knowWritten(f.path, f.sha256); this.#shas[L.pathKey(f.path)] = f.sha256; }
    d.ghosts = d.ghosts.filter((g) => !(g.source?.kind === 'reference' && /^disk/.test(g.id) && list.some((f) => L.pathKey(f.path) === L.pathKey(g.source.path))));
    app.toast(`Loaded ${names}`, 'ok');
  }

  /** app.load + session state. notes: parse repairs etc. -> one toast. Waits for a write in flight first: its last
   *  step (the blocks' files: tracking's runs) reads the stores this load replaces, and would write B's runs into
   *  A's place (paw-xn04). */
  async #load(d, shas, notes = [], ctx = {}) {
    await this.#q;
    this.#gen++;
    this.#known = {};
    this.#fpPath = null;
    this.app.load(d);
    this.app.loadBlocks?.(d.project?.extra || {}, ctx);
    this.#shas = shas;
    this.#snapKey = null;
    this.#session = newSession();
    this.#sessions = new Set([this.#session]);
    this.#persisted = null;
    this.#lastText = this.#opened = this.#hist = this.#docs = null;
    this.checkpoints = [];
    this.published = this.commitDraft = null;
    this.#wrote = this.#snapped = false;
    this.writeError = this.keptIn = this.readOnly = '';
    this.#copyKey = null;
    this.#lockAt = 0;
    this.#settleUntil = Date.now() + 1500;
    this.#runIds = runIdsOf(this.app.doc.ghosts);
    const media = this.app.mediaMs, end = this.app.scriptEndMs;
    if (media && end > media + 500) notes = [...notes, `The script runs ${((end - media) / 1000).toFixed(1)} s past the end of the video (the timeline shows all of it)`];
    if (notes.length) this.app.toast(notes.join('\n'), 'info', { timeout: 8000 });
  }

  async openProject(path, { force = false, restore = null } = {}) {
    this.app.usage?.note('project:open', { file: L.fileName(path), kind: 'project' });   // the file name only, never the folder
    const app = this.app, be = app.backend;
    if (this.busy) { app.toast('Busy: ' + this.busy, 'quiet'); return false; }
    if (!force && !(await this.#leave())) return false;   // paw-f4i2: work kept nowhere stays open
    this.busy = 'open';
    try {
      let file;
      try { file = await L.readMaybe(be, path); } catch (e) { app.toast(`Could not read ${L.fileName(path)}: ${errText(e)}`, 'error'); return false; }
      if (!file) { app.toast(`${L.fileName(path)} is missing or empty`, 'error'); return false; }
      const warnings = [];
      let pd;
      try { pd = parseProject(file.text, { lenient: true, warnings }); }
      catch (e) { app.toast(`${L.fileName(path)} is not a usable project: ${(e.errors || []).slice(0, 3).map((x) => `${x.path}: ${x.message}`).join('; ') || errText(e)}`, 'error', { timeout: 0 }); return false; }
      const notes = warnings.map((w) => `${L.fileName(path)}: ${w}`);
      let moved = null;

      if (pd.media?.path) {
        // the video beside the project (its saved relative path) wins: a copied project folder edits its own copy
        const rel = pd.media.relativePath && L.joinPath(L.dirName(path), pd.media.relativePath);
        if (rel && L.pathKey(rel) !== L.pathKey(pd.media.path) && (await this.#exists(rel))) {
          if (await this.#exists(pd.media.path)) notes.push(`Using the video beside the project (${rel}), not ${pd.media.path}`);
          pd.media = { ...pd.media, path: rel };
        } else if (!(await this.#exists(pd.media.path))) {
          moved = await this.#relink(pd.media, [L.dirName(path), L.dirName(pd.media.path)]);
          if (moved) { pd.media = { ...pd.media, path: moved }; notes.push(`Video found at ${moved} (same file, moved)`); }
          else notes.push(`Video not found: ${pd.media.path}. Use Locate video in the video pane`);
        }
      }
      const base = pd.media?.path || path;
      const [disc, offer] = await Promise.all([L.discover(be, base), restore || L.findCandidate(be, { projectPath: path })]);
      notes.push(...disc.notes);
      const shas = { ...L.shasFrom(disc.found), [L.pathKey(path)]: file.sha256 };

      // newer work kept in app data (an older version's autosave, a write that failed): it opens, no question; the file as
      // it was becomes a checkpoint at the first write
      if (offer) {
        const d = L.appDocFrom(offer.pd, { path });
        d.media = pd.media || d.media;
        await this.#applyRestore(d, offer.cand, disc, shas, notes);
        this.#resume(path, offer.pd);   // paw-abi2: at once (its tab shows from the load on), not after the reads below
        this.#opened = { text: file.text, path, label: 'As opened, before the work kept in app data' };
        this.#knowFiles(disc.found, pd.extra?.scriptFiles);
        this.#lastText = file.text;
        // its history and published version as the file records them (the snapshot has neither): the next write keeps them;
        // not its undo stack, which belongs to the file's state, not the snapshot's
        await this.#loadHistory(path, file.sha256, { undo: false });
        this.published = this.#publishedFrom(pd.extra?.published, disc.found, pd.extra?.scriptFiles);
        await this.checkLock();
        this.#touchRecent(path, 'project');
        return true;
      }
      const d = L.appDocFrom(pd, { path });
      d.ghosts = await L.rehydrateGhosts(be, d.ghosts);
      d.files = L.filesFrom(disc.found);
      await this.#load(d, shas, notes);
      this.#resume(path, pd);   // paw-abi2: at once (app.load showed its tab), not after the history and lock reads below
      // a funscript beside it changed by another tool since Pawscript last wrote (or loaded) it: the project stays, the file is a
      // ghost to compare, one quiet toast offers it (paw-kdck); the project merely ahead of its own funscript is nothing
      const outside = this.#knowFiles(disc.found, pd.extra?.scriptFiles);
      if (outside.length) {
        const ids = new Set(app.doc.ghosts.map((g) => g.id)), id = (i) => { let k = 'disk' + (i || ''); while (ids.has(k)) k += '_'; ids.add(k); return k; };
        app.doc.ghosts = [...app.doc.ghosts, ...outside.map((f, i) => L.refGhost(f.path, f.parsed.script, true, f.axis, id(i)))];
        app.toast(`${outside.map((f) => L.fileName(f.path)).join(', ')} changed outside Pawscript since it last wrote ${outside.length === 1 ? 'it' : 'them'}: shown as a ghost to compare`, 'info',
          { timeout: 12000, action: { label: outside.length === 1 ? 'Load the file' : 'Load the files', run: () => this.#takeFiles(outside) } });
      }
      this.#opened = { text: file.text, path, label: 'As opened' };
      this.#lastText = file.text;
      await this.#loadHistory(path, file.sha256);
      this.published = this.#publishedFrom(pd.extra?.published, disc.found, pd.extra?.scriptFiles);
      if (moved) app.history.markDirty();   // the video's new place is written at the next tick
      await this.checkLock();
      this.#touchRecent(path, 'project');
      return true;
    } catch (e) {
      app.toast(`Could not open ${L.fileName(path)}: ${errText(e)}`, 'error');
      return false;
    } finally { this.busy = ''; }
  }

  /** At launch (paw-bztd): the document that was open when the app last quit opens again, where it was; not when its last
   *  start-up reopen never came back (paw-a82t, open-guard.js: it crashed the renderer). -> bool */
  async reopenLast() {
    const p = this.#store().last;
    if (!p || this.busy || this.hasDoc || !(await this.#exists(p))) return false;
    return reopenGuarded(this.app, p, (x) => this.openPaths([x]));
  }
  /** The project page: restore one autosave by id, without the question (a card is the answer). -> bool */
  async restoreAutosave(id) {
    const app = this.app, be = app.backend;
    if (this.busy || typeof be.autosaveList !== 'function') return false;
    const cand = (await be.autosaveList().catch(() => [])).find((c) => c.id === id && c.snapshots?.length);
    if (!cand) { app.toast('That autosave is gone', 'warn'); return false; }
    let s;
    try { s = L.parseAutosave(await be.readText(cand.snapshots[0].path)); }
    catch (e) { app.toast(`The autosave of ${cand.title || 'a document'} could not be read: ${errText(e)}`, 'warn'); return false; }
    if (!(await this.#leave())) return false;
    return this.#restoreCand(cand, s);
  }
  /** The project page: drop one autosave, after an explicit confirmation (never automatic). -> bool */
  async discardAutosave(id, title = '') {
    const ok = await this.app.confirm({ title: 'Discard unsaved work?', message: `${title || 'This document'} was never saved: its autosave is the only copy of that work.`, ok: 'Discard', danger: true });
    if (!ok) return false;
    await quiet(this.app.backend.autosaveClear(id));
    return true;
  }
  async #restoreCand(cand, s) {
    const be = this.app.backend, restore = { cand, pd: s.pd, base: s.base };
    const exists = (p) => Promise.resolve(be.exists(p)).catch(() => false);
    if (cand.project_path && (await exists(cand.project_path))) return this.openProject(cand.project_path, { force: true, restore });
    if (!cand.project_path && s.base) {
      const video = s.pd.media?.path && L.pathKey(s.pd.media.path) === L.pathKey(s.base) ? s.base : null;
      return this.#openAt({ base: s.base, video, force: true, restore });
    }
    // project file gone, or a document that never had a file: restore as is (Save recreates the project)
    await this.#applyRestore(L.appDocFrom(s.pd, { path: cand.project_path || null }), cand, null, {}, []);
    return true;
  }

  /** A moved video: files with the saved fingerprint (file_fingerprint, 'q1') under the given folders, same name first. */
  async #relink(media, dirs) {
    const be = this.app.backend;
    if (typeof be.relinkSearch !== 'function' || media?.hash?.algo !== 'q1' || !media.hash.value) return null;
    const want = L.fileName(media.path).toLowerCase();
    for (const dir of [...new Set(dirs.filter(Boolean))]) {
      let list = [];
      try { list = (await be.relinkSearch(dir, media.hash.value, { maxDepth: 3 })) || []; } catch { continue; }
      if (list.length) return list.find((p) => L.fileName(p).toLowerCase() === want) || list[0];
    }
    return null;
  }

  // ---------- import ----------
  async importDialog() {
    const p = await this.app.backend.openDialog({ title: 'Import funscript', multiple: true, filters: [{ name: 'Funscript', extensions: ['funscript'] }] });
    const list = [].concat(p || []);
    if (!list.length) return false;
    if (!this.hasDoc) return this.openPaths(list);
    for (const f of list) await this.importFile(f);
    return true;
  }

  /** Load a funscript into its axis (from the file name; asks if that axis has points) or as a reference ghost. as: 'axis'|'ghost' skips the question. */
  async importFile(path, { as = null } = {}) {
    const app = this.app, d = app.doc;
    let file, parsed;
    try { file = await L.readMaybe(app.backend, path); if (!file) throw new Error('missing or empty'); parsed = parseFunscript(file.text); }
    catch (e) { app.toast(`Can't import ${L.fileName(path)}: ${errText(e)}`, 'error'); return false; }
    const axis = parseAxisFile(path)?.axis || 'stroke', cur = d.axes[axis] || [];
    const how = as || (cur.length ? await app.choose({
      title: `Import ${L.fileName(path)}`, message: `The ${axis} axis already has ${plural(cur.length, 'point')}.`,
      choices: [{ id: 'axis', label: `Replace ${axis}`, kind: 'danger' }, { id: 'ghost', label: 'Add as reference ghost', kind: 'primary' }, { id: 'cancel', label: 'Cancel' }],
    }) : 'axis');
    if (how === 'ghost') {
      let n = 1;
      while (d.ghosts.some((g) => g.id === 'ref' + (n > 1 ? n : ''))) n++;
      d.ghosts = [...d.ghosts, L.refGhost(path, parsed.script, true, axis, 'ref' + (n > 1 ? n : ''))];
    } else if (how === 'axis') {
      app.transact(`Import ${L.fileName(path)}`, () => {
        d.axes = { ...d.axes, [axis]: parsed.script };
        if (axis === 'stroke' && !d.chapters.length && parsed.meta.chapters.length) d.chapters = parsed.meta.chapters;
        if (axis === 'stroke' && !d.bookmarks.length && parsed.meta.bookmarks.length) d.bookmarks = parsed.meta.bookmarks;
      });
      app.setActiveAxis(axis);
      // importing the very file a save writes to: keep its unknown keys, and replacing it needs no confirmation
      const target = d.files[axis]?.path || (this.base ? axisPath(this.base, axis) : null);
      if (target && L.pathKey(target) === L.pathKey(path)) {
        d.files = { ...d.files, [axis]: L.filesFrom({ [axis]: { path, parsed } }, axis === 'stroke' ? d : null)[axis] };
        this.#shas[L.pathKey(path)] = file.sha256;
        this.#knowWritten(path, file.sha256);
      }
    } else return false;
    app.toast(`Imported ${L.fileName(path)} ${how === 'ghost' ? 'as a reference ghost' : 'into ' + axis}${parsed.notes.length ? ': ' + parsed.notes.join('; ') : ''}\n${this.originOf(parsed.raw)}`, 'ok');
    return true;
  }

  // ---------- save ----------
  /** Ctrl+S during an open / save / export: said out loud, never a silent no-op. */
  #busyNotSaved() {
    if (!this.busy) return false;
    this.app.toast(`Not saved: still busy (${this.busy}), save again when it finishes`, 'warn');
    return true;
  }

  /** Save: the .pawproj (if there is one) and every non-empty axis as its sibling funscript. opts.funscriptsOnly skips the project.
   *  A video without a project gets one beside it (<video stem>.pawproj, no dialog) unless that name is taken. */
  async save({ funscriptsOnly = false, scripts = true } = {}) {
    const app = this.app, d = app.doc;
    if (this.#busyNotSaved()) return false;
    if (!this.path && !funscriptsOnly && d.media?.path) {
      const beside = L.stem(d.media.path) + '.pawproj';
      return (await this.#exists(beside)) ? this.saveAs() : this.#saveTo(beside);
    }
    const projectPath = funscriptsOnly ? null : this.path, base = this.base;
    if (!base) {
      if (this.hasDoc) return this.saveAs();
      app.toast('Nothing to save', 'quiet');
      return false;
    }
    // loops, plan, scenes, tracker runs, assist answers ... only fit in a .pawproj: a session without one gets one
    const lost = projectPath ? [] : L.projectOnlyData(d);
    if (lost.length && !funscriptsOnly) return this.saveAs();
    this.busy = 'save';
    try {
      await this.#q;   // a continuous write in flight finishes first (the same files)
      const refs = this.#refs(), kept = this.#persistState();
      // the funscripts get the final; the .pawproj keeps the layers. scripts false (Save As, stage 2): only Publish writes them
      const { items, empty, skipped } = scripts || !projectPath ? L.saveItems({ axes: finalAxes(app), chapters: d.chapters, bookmarks: d.bookmarks, files: d.files, prov: this.#prov(projectPath) }, base) : { items: [], empty: [], skipped: [] };
      let picked = null;
      const ask = async (c) => { picked = { choice: await this.#askConflicts(c), conflicts: c }; return picked.choice; };
      const res = await L.writeFiles({ backend: app.backend, items, shas: this.#shas, ask, keep: app.settings.get('backup.keep') });
      if (res.cancelled) {
        if (picked?.choice === 'reload' || picked?.choice === 'ghost') { this.busy = ''; await this.#onConflictChoice(picked); }
        else app.toast('Save canceled', 'quiet');
        return false;
      }
      this.#recordWritten(res.written, refs);
      if (res.failed) { this.#reportFailure('Save', res); return false; }
      // the project after its funscripts: it records what was just written to them (scriptFiles), so the next open knows them
      let undo, ghostIds;
      if (projectPath) {
        await this.#fingerprint();
        undo = this.#undoJson();   // paw-zrru: with the text below
        ghostIds = new Set((d.ghosts || []).map((g) => g.id));
        const text = this.#text(app.saveBlocks?.(), projectPath);
        await this.#blocksSaving(projectPath, this.#gen);   // paw-abi2
        const pr = await L.writeFiles({ backend: app.backend, items: [{ axis: null, path: projectPath, unchanged: false, text }], shas: this.#shas, ask: async () => 'replace', keep: app.settings.get('backup.keep') });
        res.written.push(...pr.written); res.backups.push(...pr.backups);
        if (pr.failed) { res.failed = pr.failed; this.#reportFailure('Save', res); return false; }
      }
      // files features keep beside the project (tracking: <stem>.pawruns); a failure keeps the document dirty
      const beside = projectPath ? (await app.blocksSaved?.(projectPath, { keep: ghostIds })) || [] : [];
      const proj = res.written.find((w) => !w.axis);
      if (proj) { this.#lastText = proj.text; this.#wrote = true; await this.#writeUndo(projectPath, undo).catch((e) => console.warn('[project] undo history not written:', e)); }

      const notes = [];
      for (const p of empty) notes.push(`${L.fileName(p)} left unchanged (its axis is empty)`);
      if (skipped.length) notes.push(`Not saved (no file name): ${skipped.join(', ')}`);
      if (!projectPath && !scriptOf(app, 'stroke').length && (d.chapters.length || d.bookmarks.length)) notes.push('Chapters and bookmarks are kept in the stroke file, which is empty: use Save As for a project');
      // funscripts written but project-only data is not on disk: the document stays dirty and its autosaves stay
      if (lost.length) notes.push(`Not saved: ${lost.join(', ')} need a project. Use Save As… (your changes stay unsaved and autosaved)`);
      else if (beside.length) { this.#settle(refs, kept, false); notes.push(`Not saved: ${beside.join('; ')} (your changes stay unsaved and autosaved)`); }
      else if (this.#settle(refs, kept)) {
        await this.#clearAutosaves();
        this.#noteRecent();
        quiet(this.#thumb());
      } else notes.push('Edits made while saving are not saved yet');
      const n = res.written.length;
      app.usage?.note('project:save', { files: n, project: !!projectPath, notes: notes.length });
      app.toast((n ? `Saved ${plural(n, 'file')}` : 'Saved (files already up to date)') +
        (res.backups.length ? `. Originals kept as ${res.backups.map(L.fileName).join(', ')}` : '') + (notes.length ? '\n' + notes.join('\n') : ''), notes.length ? 'warn' : 'ok');
      return true;
    } catch (e) {
      app.toast(`Save failed: ${errText(e)}`, 'error', { timeout: 0 });
      return false;
    } finally { this.busy = ''; }
  }

  /** What a written funscript says of where it came from (lib/provenance.js): the project's file name and, per axis, how. */
  #prov(projectPath) {
    const d = this.app.doc;
    return { project: projectPath ? L.fileName(projectPath) : null, how: Object.fromEntries(Object.keys(d.axes).map((a) => [a, howOf({ base: scriptOf(this.app, a), ghosts: d.ghosts, axis: a, fx: d.fx })])) };
  }
  /** "Written by Pawscript 0.1.0 on ... from this project" / "From OpenFunscripter, by X" / ... for a parsed file's raw. */
  originOf(raw) { return originText(readProvenance(raw), { project: this.path ? L.fileName(this.path) : null }); }

  #refs() { const d = this.app.doc; return [d.axes, d.chapters, d.bookmarks, d.loops, d.plan, d.scenes, d.graphs, d.fx, d.repeats, d.runRanges, d.bakedEmpty]; }

  /** media.size + media.hash (file_fingerprint) in the project, so a moved video can be found again. Taken once per video
   *  path per opened document (paw-o2ij: every write, not only Ctrl+S), so a replaced or relinked video is fingerprinted anew. */
  #fpPath = null;
  async #fingerprint() {
    const d = this.app.doc, be = this.app.backend, m = d.media;
    if (!m?.path || this.#fpPath === m.path || typeof be.fileFingerprint !== 'function') return;
    this.#fpPath = m.path;
    try { const f = await be.fileFingerprint(m.path); if (f?.fingerprint && d.media === m && f.fingerprint !== m.hash?.value) d.media = { ...m, size: f.size ?? m.size ?? null, hash: { algo: 'q1', value: f.fingerprint } }; }
    catch { /* video gone or unreadable: written with the fingerprint it had */ }
  }
  #same(refs) { const now = this.#refs(); return refs.every((v, i) => v === now[i]); }
  /** paw-zrru: the project file now holds the state of refs / kept (taken when its write started). That is the saved position
   *  only when nothing changed since and all of it was written (all); else NO position is: an undo / redo made during the write
   *  back to the position saved before looked written (history dirty = top entry != saved entry), so nothing wrote it again
   *  and close / quit / parking a tab kept the older file. -> clean */
  #settle(refs, kept, all = true) {
    const clean = all && this.#same(refs) && this.#samePersist(kept);
    if (clean) this.app.history.markSaved(); else this.app.history.markDirty();
    return clean;
  }
  /** Changes that are not undo steps (a run finished, a channel pick) made while the save ran are not in what it wrote. */
  #samePersist(was) { const now = this.#persistState(); return now.json === was.json && sameRefs(now.ghosts, was.ghosts); }

  /** After a (partial) save: written axis files become ours, and their raw keeps the keys for the next save. */
  #recordWritten(written, [, chapters, bookmarks]) {
    const d = this.app.doc;
    let files = d.files;
    for (const it of written) {
      if (!it.axis) continue;
      this.#knowWritten(it.path, it.result?.sha256);
      const prev = files[it.axis];
      files = { ...files, [it.axis]: { ...prev, path: it.path, raw: it.raw, meta: prev?.meta, script: it.script,
        ...(axisName(it.axis) === 'stroke' ? { chapters, bookmarks } : {}), foreign: false, backedUp: true } };
    }
    if (files !== d.files) d.files = files;
  }

  #reportFailure(what, res) {
    const f = res.failed;
    const msg = `${what} failed at ${L.fileName(f.path)}: ${f.code === 'conflict' ? 'it changed on disk again, nothing was replaced' : f.error}.` +
      (res.written.length ? ` Written before the failure: ${res.written.map((w) => L.fileName(w.path)).join(', ')}.` : ' Nothing was written.') +
      (res.backups.length ? ` Originals kept as ${res.backups.map(L.fileName).join(', ')}.` : '') + ' Your changes are still open.';
    this.app.toast(msg, 'error', { timeout: 0 });
  }

  async #askConflicts(conflicts) {
    const names = conflicts.map((c) => L.fileName(c.path)).join(', ');
    const r = await this.app.choose({
      title: 'Replace files on disk?',
      message: `${names} ${conflicts.length === 1 ? 'is' : 'are'} not the version opened here (created or changed by something else since).`,
      detail: 'Replacing a file Pawscript did not write keeps the original as name.bak beside it.',
      choices: [{ id: 'replace', label: 'Replace', kind: 'danger' },
        ...(conflicts.some((c) => c.axis && L.altPathOf(c.path)) ? [{ id: 'alt', label: 'Save as .pawscript.funscript' }] : []),
        ...(conflicts.some((c) => c.axis && !c.error) ? [{ id: 'ghost', label: 'Compare (show theirs as ghost)' }, { id: 'reload', label: 'Reload from disk…' }] : []),
        { id: 'cancel', label: 'Cancel', kind: 'primary' }],
    });
    return r || 'cancel';
  }
  /** Conflict answers that cancel the save: compare (the files on disk as reference ghosts) or reload (asks first). */
  async #onConflictChoice({ choice, conflicts }) {
    if (choice === 'reload') return this.revert();
    for (const c of conflicts) if (c.axis && !c.error) await this.importFile(c.path, { as: 'ghost' });
    this.app.toast('Save canceled: the files on disk are shown as ghosts', 'info');
  }

  /** Save as a .pawproj (picked with the save dialog; null = cancelled). If the dialog cannot open: funscripts next to the video. */
  async saveAs() {
    const app = this.app;
    if (this.#busyNotSaved()) return false;
    const defaultPath = this.path || (this.base ? L.stem(this.base) + '.pawproj' : 'untitled.pawproj');
    let p;
    try { p = await app.backend.saveDialog({ title: 'Save project', defaultPath, filters: [{ name: 'Pawscript project', extensions: ['pawproj'] }] }); }
    catch (e) {
      if (!this.base) { app.toast(`The save dialog could not open (${errText(e)})`, 'error'); return false; }
      app.toast(`Save dialog failed (${errText(e)}), saving the funscripts next to the video`, 'warn');
      return this.save({ funscriptsOnly: true });
    }
    if (!p) return false;
    // stage 2: Save As moves the project; only Publish writes the funscripts beside the video
    return this.#saveTo(/\.pawproj$/i.test(p) ? p : p + '.pawproj', { scripts: false });
  }
  /** Save as the project at p; on failure the document keeps its previous project path. */
  async #saveTo(p, opts = {}) {
    const d = this.app.doc, prev = d.project;
    d.project = { ...(prev || {}), path: p };
    if (!(await this.save(opts))) { if (d.project?.path === p) d.project = prev; return false; }
    this.#touchRecent(p, 'project');
    return true;
  }

  // ---------- export ----------
  async exportDialog() {
    const app = this.app, d = app.doc;
    const fa = finalAxes(app), axes = Object.keys(fa).filter((a) => fa[a].length);   // paw-x7w7: live runs export like points
    if (!axes.length) { app.toast('Nothing to export: every axis is empty', 'warn'); return false; }
    const active = d.activeAxis, safe = BUILTIN_PRESETS.find((x) => x.id === 'device-safe');
    const what = await app.choose({
      title: 'Export funscripts', message: 'Which axes?',
      choices: [{ id: 'all', label: axes.length > 1 ? `All axes (${axes.join(', ')})` : axes[0], kind: 'primary' },
        ...(axes.length > 1 && axes.includes(active) ? [{ id: 'active', label: `Only ${active}` }] : []),
        ...(safe ? [{ id: 'safe', label: `All, ${safe.name}` }] : []),
        { id: 'cancel', label: 'Cancel' }],
    });
    if (!what || what === 'cancel') return false;
    const where = await app.choose({
      title: 'Export to',
      choices: [...(this.base ? [{ id: 'next', label: `Next to ${L.fileName(this.base)}`, kind: 'primary' }] : []), { id: 'folder', label: 'Choose a folder…' }, { id: 'cancel', label: 'Cancel' }],
    });
    if (!where || where === 'cancel') return false;
    let dir = null;
    if (where === 'folder') {
      dir = await app.backend.openDialog({ title: 'Export folder', directory: true, multiple: false });
      if (Array.isArray(dir)) dir = dir[0];
      if (!dir) return false;
    }
    return this.exportTo({ axes: what === 'active' ? [active] : axes, dir, preset: what === 'safe' ? 'device-safe' : 'as-is' });
  }

  /** Programmatic export: {axes: [axis], dir: folder | null (next to the video), preset: BUILTIN_PRESETS id}. */
  async exportTo({ axes, dir = null, preset = 'as-is' }) {
    const app = this.app, d = app.doc;
    if (this.busy) { app.toast('Busy: ' + this.busy, 'quiet'); return false; }
    if (!dir && !this.base) { app.toast('Pick a folder to export to', 'warn'); return false; }
    this.busy = 'export';
    try {
      const p = BUILTIN_PRESETS.find((x) => x.id === preset) || BUILTIN_PRESETS[0];
      const items = L.exportItems({ axes: finalAxes(app), chapters: d.chapters, bookmarks: d.bookmarks, files: d.files, prov: this.#prov(this.path) }, { axes, base: this.base, dir, preset: p });
      const res = await L.writeFiles({ backend: app.backend, items, shas: this.#shas, ask: (c) => this.#askConflicts(c), keep: app.settings.get('backup.keep') });
      if (res.cancelled) return false;
      // an export over a save target: the next save must rewrite it from the document
      let files = d.files;
      for (const it of res.written) this.#knowWritten(it.path, it.result?.sha256);
      for (const it of res.written) if (files[it.axis] && L.pathKey(files[it.axis].path) === L.pathKey(it.path)) files = { ...files, [it.axis]: { ...files[it.axis], script: null } };
      if (files !== d.files) d.files = files;
      if (res.failed) { this.#reportFailure('Export', res); return false; }
      const folder = dir || L.dirName(this.base);   // the folder's name; its full path in the tooltip (paw-p8o2)
      app.toast(`Exported ${plural(res.written.length, 'file')}${p.id !== 'as-is' ? ` (${p.name})` : ''} to ${L.fileName(folder) || 'the video folder'}` +
        (res.backups.length ? `. Originals kept as ${res.backups.map(L.fileName).join(', ')}` : ''), 'ok', { tip: folder });
      return true;
    } catch (e) {
      app.toast(`Export failed: ${errText(e)}`, 'error', { timeout: 0 });
      return false;
    } finally { this.busy = ''; }
  }

  // ---------- close ----------
  /** Leaving the document (open another, close, quit): its last change written (an app-data snapshot when that fails), a
   *  checkpoint when it was written this session, and where the owner was kept. Never a question (paw-up1r).
   *  -> where its latest state is (#where): '' = nowhere but here, it must not go (paw-f4i2) */
  async #leave() {
    if (!this.hasDoc) return 'file';
    await this.flush();
    this.#noteResume(true);   // after the write: a document placed by it is kept under its new project
    if (this.#wrote) await this.#queue(() => this.#checkpointNow('On close')).catch((e) => console.warn('[project] checkpoint:', e));
    const where = this.#where();
    if (where) await this.#unlock();
    return where;
  }

  // ---------- one window per project (paw-vm6e) ----------
  // ponytail: a lock file beside the history (<stem>.pawhistory/lock.json: {id, app: data folder, at}) refreshed every 30 s;
  // one older than 90 s, or left by this same app (a crashed run), is taken over. Two windows opening in the same second can
  // both take it.
  readOnly = $state('');            // why this window does not write its project ('' = it does)
  #lockId = newSession();
  #lockAt = 0;
  async #lockFile(path) { return L.joinPath((await this.#history(path)).dir, 'lock.json'); }
  /** The project's lock: this window holds it (and writes), or another live window does (this one only keeps app data). */
  async checkLock() {
    const path = this.path, be = this.app.backend;
    this.#lockAt = Date.now();
    if (!path || typeof be.writeText !== 'function' || typeof be.readText !== 'function') return;
    let file, other = null, me = null;
    try { me = (await (this.#dataDir ??= Promise.resolve(be.appPaths?.()))).data_dir || null; } catch { /* unknown */ }
    try {
      file = await this.#lockFile(path);
      const j = JSON.parse(await be.readText(file));
      // the same app (its data folder; one window per app) left it: a run that crashed or was killed, never another window
      if (j?.id && j.id !== this.#lockId && !(me && j.app === me) && Date.now() - (+j.at || 0) < LOCK_STALE_MS) other = j;
    } catch { /* no lock (or unreadable): free */ }
    if (path !== this.path || !file) return;
    if (other) {
      if (!this.readOnly) this.app.toast(`${L.fileName(path)} is open in another Pawscript window: this window does not write it. Your changes here are kept in app data; close the other window to write from here`, 'warn', { timeout: 0 });
      this.readOnly = 'open in another Pawscript window';
      return;
    }
    try { await be.writeText(file, JSON.stringify({ id: this.#lockId, app: me, at: Date.now() })); } catch { /* not lockable: written as before */ }
    if (this.readOnly) { this.readOnly = ''; this.#retryAt = 0; this.app.toast(`${L.fileName(path)} is written from this window now`, 'quiet'); }
  }
  async #unlock() {
    const path = this.path, be = this.app.backend;
    if (!path || this.readOnly || typeof be.remove !== 'function' || typeof be.readText !== 'function') return;
    try { const file = await this.#lockFile(path); if (JSON.parse(await be.readText(file))?.id === this.#lockId) await be.remove(file); } catch { /* none */ }
  }
  /** Where the document's latest state is: 'file' (its project is written), 'copy' (Save a copy to…), 'app data' (a snapshot
   *  read back), '' (only in memory). */
  #where() {
    if (!this.app.doc.dirty) return 'file';
    const key = this.#keepKey(), same = (k) => k && k.length === key.length && k.every((v, i) => v === key[i]);
    if (same(this.#copyKey)) return 'copy';
    return this.keptIn && same(this.#snapKey) ? 'app data' : '';
  }
  /** The document holds work kept nowhere else (not its file, a copy, nor app data): closing it would lose that work. */
  get unsaved() { return this.hasDoc && !this.#where(); }

  /** Close the document: written, checkpointed, gone; no question. quit: the app is closing (it reopens on the next
   *  start, paw-bztd). force is accepted for older scripts and changes nothing. paw-f4i2: a document whose work is kept
   *  nowhere else stays open (and so does a tab closed by hand while only app data has its work, unless `anyway`), saying
   *  what failed and where the work is. -> false while busy or when it stays */
  async close({ quit = false, anyway = false } = {}) {
    if (this.busy && !quit) { this.app.toast('Busy: ' + this.busy, 'quiet'); return false; }
    const where = await this.#leave();
    if (!where || (where === 'app data' && !quit && !anyway)) { this.#notClosed(where, quit); return false; }
    if (quit) return true;
    this.#store((s) => { s.last = null; });
    await this.#load({}, {});
    return true;
  }
  /** The plain word when a close is held: what failed, where the work is; Retry, Save a copy to… (and Close anyway when app
   *  data has it). */
  #notClosed(where, quit) {
    const app = this.app, name = this.name || 'This document', why = this.writeError || 'it could not be written';
    const msg = where
      ? `${name} was not closed: it could not be written (${why}). Your work is kept in app data (${this.keptIn}) and comes back when you open it again.`
      : `${quit ? 'Pawscript did not close' : `${name} was not closed`}: ${name} could not be written (${why}) and its work could not be kept in app data either. It is still open here.`;
    app.tabs?.show?.(app.tabId);
    this.#failToasts.push(app.toast(msg, 'error', { timeout: 0, action: { label: 'Retry', run: () => this.retryWrite({ close: quit ? 'app' : 'tab' }) },
      actions: [{ label: 'Save a copy to…', run: () => this.saveCopy() }, ...(where && !quit ? [{ label: 'Close anyway', run: () => this.close({ anyway: true }) }] : [])] }));
  }
  /** Retry (the held close, the status bar): the write again now; once it is in its file, a held close goes on. -> written */
  async retryWrite({ close = null } = {}) {
    this.#retryAt = 0;
    await this.flush();
    if (this.#where() !== 'file') { this.app.toast(`${this.name || 'The document'} is still not written: ${this.writeError || 'it could not be written'}`, 'error'); return false; }
    if (close === 'tab') await this.close();
    else if (close === 'app') await closeApp(this.app);
    return true;
  }
  /** Save a copy to… (offered while the project cannot be written; the one place a save dialog is right): the project as it is
   *  now, and its runs, in a file picked by hand. The document stays where it is. -> bool */
  async saveCopy() {
    const app = this.app, be = app.backend, stem = L.fileName(L.stem(this.path || this.base || '')) || 'Untitled';
    let p;
    try { p = await be.saveDialog({ title: 'Save a copy', defaultPath: `${stem} (copy).pawproj`, filters: [{ name: 'Pawscript project', extensions: ['pawproj'] }] }); }
    catch (e) { app.toast(`The save dialog could not open: ${errText(e)}`, 'error'); return false; }
    if (!p) return false;
    const dest = /\.pawproj$/i.test(p) ? p : p + '.pawproj', key = this.#keepKey();
    try {
      await be.writeWithBackup(dest, this.#text(undefined, dest), {});
      await app.blocks?.get('runs')?.copyTo?.(dest);
    } catch (e) { app.toast(`The copy was not written to ${dest}: ${errText(e)}`, 'error', { timeout: 0 }); return false; }
    this.#copyKey = key;
    app.toast(`A copy of your work is in ${dest}. This document still belongs to ${this.path || 'no file yet'}`, 'ok', { timeout: 10000 });
    return true;
  }

  /** Reload from disk, dropping unsaved changes (asks first). */
  async revert() {
    const d = this.app.doc, path = this.path, video = d.media?.path, base = this.base;
    if (!path && !base) return false;
    if (d.dirty && !(await this.app.confirm({ title: 'Revert to saved?', message: 'Discard all unsaved changes and reload from disk?', ok: 'Revert', danger: true }))) return false;
    await this.#clearAutosaves();
    if (path) return this.openProject(path, { force: true });
    if (video) return this.openVideo(video, { force: true });
    return this.#openAt({ base, video: null, mode: 'edit', force: true });
  }

  // ---------- continuous write (paw-up1r stage 1) ----------
  #queue(job) { const p = this.#q.then(job); this.#q = p.catch(() => {}); return p; }

  /** About once a second: where the owner is (resume), and the pending change written. Never during a drag or while the
   *  video plays (paw-o60v.3): it waits for a rest, a minute at most. settings 'autosave.seconds' 0 turns writing off. */
  startAutosave() {
    this.stopAutosave();
    this.#running = true;
    const tick = () => {
      this.#timer = setTimeout(async () => {
        if (!this.#running) return;
        try {
          this.#noteResume();
          if (Date.now() - this.#lockAt >= LOCK_BEAT_MS) await this.checkLock();   // paw-vm6e: held, or taken once the other window let go
          const due = Number(this.app.settings.get('autosave.seconds')) !== 0 && this.app.doc.dirty && !this.busy && Date.now() >= this.#retryAt;
          if (!due) this.#waitFrom = null;
          else if ((!this.#held && !this.app.player?.playing) || Date.now() - (this.#waitFrom ??= Date.now()) >= 60000) { this.#waitFrom = null; await this.flush(); }
          // the learned seeder retrains after a save (tracking 'seeder' block): here once the project rested 30 s after a write
          if (this.#seedDue && !this.app.doc.dirty && Date.now() - this.lastAutosave > 30000) { this.#seedDue = false; quiet(this.app.blocks?.get('seeder')?.saved?.(this.app, this.path)); }
        } catch (e) { console.warn('[project] write:', e); }
        finally { if (this.#running) tick(); }
      }, 1000);
    };
    tick();
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.#onUnload);
      for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'blur']) window.addEventListener(t, this.#onPointer, true);
    }
  }
  stopAutosave() {
    this.#running = false;
    clearTimeout(this.#timer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.#onUnload);
      for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'blur']) window.removeEventListener(t, this.#onPointer, true);
    }
  }
  #held = false;       // a pointer button is down (a drag in progress)
  #waitFrom = null;    // since when a write waits for a rest
  #retryAt = 0;        // after a failed write: the next try
  #seedDue = false;
  #onPointer = (e) => { this.#held = e.type === 'pointerdown'; };
  #onUnload = () => { this.#noteResume(true); if (this.app.doc.dirty) this.flush(); };

  /** Write the pending change now: the project, else (it, or a block's file, cannot be written) an app-data snapshot, read
   *  back. -> true only when the project and its files were written now */
  async flush() {
    if (!this.hasDoc) return false;
    const r = await this.#queue(() => this.#writeNow());
    if (!r.ok && !r.stale && this.app.doc.dirty) {
      // placed: the project file was just written (without its runs): a fresh snapshot, newer than it, or the next open
      // would take the file and miss the runs
      const kept = await this.#queue(() => this.#autosaveNow(!!r.placed));
      // said once per failure: what failed and whether the work is really in app data (paw-f4i2: never promised unchecked)
      if (this.writeError && !this.#told) {
        this.#told = true;
        const name = this.path ? L.fileName(this.path) : this.name || 'the document';
        this.#failToasts.push(this.app.toast(kept ? `Could not write ${name}: ${this.writeError}\nYour work is kept in app data until it can be written`
          : `Could not write ${name}: ${this.writeError}\nIt could not be kept in app data either: keep Pawscript open and use Save a copy to…`,
        'error', { timeout: 0, action: { label: 'Retry', run: () => this.retryWrite() }, actions: [{ label: 'Save a copy to…', run: () => this.saveCopy() }] }));
      }
    }
    return r.ok;
  }
  #told = false;       // the failure toast was shown (again after the next good write)
  #failToasts = [];    // the failure / held-close toasts: dismissed once the project is written again
  #copyKey = null;     // #keepKey() of the document when Save a copy to… last wrote it
  /** The older name (error nets, scripts). */
  flushAutosave() { return this.flush(); }

  /** The .pawproj text of the open document. No view / playhead: where the owner was is resume state, not the document. */
  #text(blocks = this.app.saveBlocks?.(), path = this.path) {
    const files = Object.values(this.#known).map((x) => ({ path: x.path, sha256: x.sha }));   // scriptFiles: what the funscripts beside it were
    // published: the version beside the video (stage 2); kept by the project, never by a restore
    const pub = this.published ? { published: { v: 1, ...this.published } } : {};
    return serializeProject(L.projectDoc(this.app.doc, { blocks: { ...(blocks || {}), ...(files.length ? { scriptFiles: { v: 1, files } } : {}), ...pub }, blockKeys: [...(this.app.blocks?.keys() || []), 'scriptFiles', 'published'] }),
      { projectPath: path, savedAt: new Date().toISOString(), ghostScripts: true });
  }

  /** -> {ok} | {ok: false, why} (#writeProject) */
  async #writeNow() {
    const app = this.app, d = app.doc;
    if (!d.dirty) return failed('nothing to write');
    if (this.busy) return failed('busy: ' + this.busy);
    if (!this.hasDoc || typeof app.backend.writeWithBackup !== 'function') return failed('no way to write here');
    if (this.readOnly) { this.#writeFailed(this.readOnly); return failed(this.readOnly); }   // paw-vm6e: the other window writes it
    const gen = this.#gen;
    if (this.path) return this.#writeProject(gen);
    // never had a place: beside its video (as Save named it), else the app data folder; said once, quietly
    let err = '';
    for (const p of await this.#places()) {
      if (gen !== this.#gen) return failed('', true);
      const prev = d.project;
      d.project = { ...(prev || {}), path: p };
      const r = await this.#writeProject(gen, true);
      if (r.ok || r.placed) {   // placed: the project is there, a block's file failed (said by flush)
        this.#touchRecent(p, 'project');
        app.tabs?.note?.();   // the tab is kept under its project now
        // paw-vhcd: its name and where, never the full path
        const beside = this.base && L.pathKey(L.dirName(this.base)) === L.pathKey(L.dirName(p));
        app.toast(`Kept as ${L.fileName(p)} ${beside ? (d.media ? 'beside the video' : 'beside the scripts') : 'in the app data folder'}`, 'quiet', { timeout: 6000, tip: p });   // the full path in its tooltip (paw-p8o2)
        return r;
      }
      if (r.stale) return r;
      err = r.why || err;
      if (gen === this.#gen && d.project?.path === p) d.project = prev;
    }
    if (gen !== this.#gen) return failed('', true);
    this.#writeFailed(err || 'no folder to keep it in');
    return failed(this.writeError);
  }

  /** Where a document that never had a place can go: <stem>.pawproj beside its video / funscript (unless that name is
   *  taken, or the setting project.newIn says the projects folder), then <data_dir>/projects/<name>-<id>.pawproj. */
  async #places() {
    const out = [], base = this.base, be = this.app.backend;
    if (base && this.app.settings.get('project.newIn') !== 'appData' && !(await this.#exists(L.stem(base) + '.pawproj'))) out.push(L.stem(base) + '.pawproj');
    try {
      const dir = L.joinPath((await (this.#dataDir ??= Promise.resolve(be.appPaths()))).data_dir, 'projects');
      await be.makeDir?.(dir);
      out.push(L.joinPath(dir, `${(L.fileName(L.stem(base || '')) || 'Untitled').replace(/[^\w .()-]+/g, '_')}-${this.#session.slice(0, 8)}.pawproj`));
    } catch { /* no app data folder (harness): beside only */ }
    return out;
  }

  /** One write of the project, its blocks' files (runs), its undo history. -> {ok} | {ok: false, why, placed?: the project
   *  file was written, a block's was not} (placing: a failed project write is not reported, the next place is tried). */
  async #writeProject(gen, placing = false) {
    const app = this.app, path = this.path;
    await this.#fingerprint();
    if (gen !== this.#gen) return failed('', true);
    const refs = this.#refs(), kept = this.#persistState(), blocks = app.saveBlocks?.(), text = this.#text(blocks, path);
    const undo = this.#undoJson();   // paw-zrru: the undo stack of this very state, as undo.json is paired with this text's sha
    const ghostIds = new Set((app.doc.ghosts || []).map((g) => g.id));   // paw-abi2: the runs this text names stay in the runs file
    // its first write here: the file as it was opened is a checkpoint (kept for good when it is the project's first)
    const o = this.#opened;
    if (o && L.pathKey(o.path) === L.pathKey(path)) {
      this.#opened = null;
      try { const h = await this.#history(path); if (!h.list.length || o.label.includes('app data')) await this.#checkpointNow(o.label, { text: o.text, keep: !h.list.length }); }
      catch (e) { console.warn('[project] checkpoint:', e); }
    }
    // milestones (paw-up1r): a run gone since the last write -> the state before (what is on disk) is a checkpoint; a run
    // landed -> the state after it, once written
    const ids = runIdsOf(app.doc.ghosts), had = this.#runIds || ids, gone = [...had].some((id) => !ids.has(id)), landed = [...ids].some((id) => !had.has(id));
    if (gone && this.#lastText) await this.#checkpointNow('Before a run was discarded', { text: this.#lastText }).catch((e) => console.warn('[project] checkpoint:', e));
    await this.#blocksSaving(path, gen);
    if (gen !== this.#gen) return failed('', true);
    let res;
    // the project changed outside Pawscript since we read it: replaced, that version kept as .bak (write_with_backup)
    const job = startWrite(L.fileName(path));   // paw-ee14: what the close panel names
    try { res = await L.writeFiles({ backend: app.backend, items: [{ axis: null, path, text, unchanged: false }], shas: this.#shas, ask: async () => 'replace', keep: app.settings.get('backup.keep') }); }
    catch (e) { res = { failed: { error: errText(e) } }; }
    finally { job.end(); }
    if (gen !== this.#gen) return failed('', true);
    if (res.failed) { if (!placing) this.#writeFailed(res.failed.error); return failed(res.failed.error); }
    // only when the file differed from what was opened (a replace confirmed): the shell also keeps a .bak of a file this
    // install never wrote (an unpacked pack, a copy), which is no change outside Pawscript (paw-qf5o)
    if (res.backups?.length && res.written?.some((w) => w.confirmed)) app.toast(`${L.fileName(path)} had been changed outside Pawscript: that version is kept as ${res.backups.map(L.fileName).join(', ')}`, 'warn', { timeout: 10000 });
    this.#lastText = text;
    this.#runIds = ids;
    this.#wrote = this.#seedDue = true;
    const errs = [];
    for (const [k, b] of app.blocks || []) {   // the blocks' own files (tracking: <stem>.pawruns); the seeder's retrain waits for a rest
      if (!b.saved || k === 'seeder' || gen !== this.#gen) continue;
      try { await b.saved(app, path, { keep: ghostIds }); } catch (e) { console.error('[block ' + k + ']', e); errs.push(`${k}: ${errText(e)}`); }
    }
    if (gen !== this.#gen) return failed('', true);
    // the undo stack: the document itself is in its file, so a failure here only costs the reopened undo steps
    try { await this.#writeUndo(path, undo); } catch (e) { console.warn('[project] undo history not written:', e); }
    this.lastAutosave = Date.now();
    // paw-f4i2: a block's file not written (the runs) is a failed write: the document stays dirty and goes to app data
    if (errs.length) { this.#settle(refs, kept, false); this.#writeFailed(errs.join('; ')); return { ...failed(this.writeError), placed: true }; }
    this.#settle(refs, kept);
    if (this.writeError) { this.writeError = ''; this.#told = false; for (const id of this.#failToasts.splice(0)) if (id != null) app.dismiss?.(id); app.toast(`${L.fileName(path)} is written again`, 'quiet'); }
    this.#noteRecent(blocks);
    if (this.#snapped) { this.#snapped = false; await this.#clearAutosaves(); }
    if (landed) await this.#checkpointNow('After a track', { text }).catch((e) => console.warn('[project] checkpoint:', e));
    return WROTE;
  }
  /** paw-abi2: the blocks' own files before the .pawproj (block saving: tracking writes every run either .pawproj can name),
   *  so a kill between the two writes never leaves a project naming a run its .pawruns lacks (frames gone for good); a run
   *  only in the .pawruns opens with its ghost back. A failure here is only logged: the write after the .pawproj reports it. */
  async #blocksSaving(path, gen) {
    for (const [k, b] of this.app.blocks || []) {
      if (!b.saving || gen !== this.#gen) continue;
      try { await b.saving(this.app, path); } catch (e) { console.warn('[block ' + k + '] before the project:', e); }
    }
  }
  /** A write failed: the status bar says why, the tick tries again in 10 s (flush says it once and keeps the work). */
  #writeFailed(why) {
    this.writeError = String(why || 'failed');
    this.#retryAt = Date.now() + 10000;
  }

  /** <stem>.pawhistory/undo.json: the undo stack, paired with the .pawproj just written (its sha256). */
  #undoJson() { return exportHistory(this.app._history, this.app.doc.read()).json; }
  async #writeUndo(path, json = this.#undoJson()) {
    const h = await this.#history(path);
    await this.app.backend.writeText(L.joinPath(h.dir, 'undo.json'), undoText(this.#shas[L.pathKey(path)], json));
  }

  // ---------- history folder, checkpoints ----------
  checkpoints = $state.raw([]);   // the open project's checkpoints, newest first: [{id, at, label, auto, keep?}]

  /** Where a project's history is: beside it, else (a protected folder) <data_dir>/history/<key>. */
  async #histDir(path) {
    const has = async (d) => (await this.#exists(L.joinPath(d, 'index.json'))) || (await this.#exists(L.joinPath(d, 'undo.json')));
    const beside = historyDir(path);
    if (await has(beside)) return beside;
    const alt = await this.#appHistDir(path);
    return alt && (await has(alt)) ? alt : beside;
  }
  async #appHistDir(path) {
    try { return L.joinPath((await (this.#dataDir ??= Promise.resolve(this.app.backend.appPaths()))).data_dir, 'history/' + thumbKey(path)); } catch { return null; }
  }
  async #readIndex(dir) {
    try {
      const j = JSON.parse(await this.app.backend.readText(L.joinPath(dir, 'index.json')));
      return (Array.isArray(j?.checkpoints) ? j.checkpoints : []).filter((c) => c && typeof c.id === 'string' && Number.isFinite(c.at));
    } catch { return []; }
  }
  /** The open project's history for writing: {path, dir, list (oldest first), ready}; the folder made once. */
  async #history(path) {
    if (this.#hist?.path !== path) { const dir = await this.#histDir(path); this.#hist = { path, dir, list: await this.#readIndex(dir), ready: false }; }
    const h = this.#hist, be = this.app.backend;
    if (!h.ready) {
      try { await be.makeDir?.(h.dir); }
      catch (e) { const alt = await this.#appHistDir(path); if (!alt) throw e; await be.makeDir(alt); h.dir = alt; }
      h.ready = true;
    }
    return h;
  }
  /** At open: the checkpoints, and the undo stack when it was written with this very file. */
  async #loadHistory(path, sha, { undo = true } = {}) {
    const gen = this.#gen;
    try {
      const dir = await this.#histDir(path), list = await this.#readIndex(dir);
      if (gen !== this.#gen) return;
      this.#hist = { path, dir, list, ready: false };
      this.checkpoints = [...list].reverse();
      if (!undo) return;
      const uf = L.joinPath(dir, 'undo.json'), st = await Promise.resolve(this.app.backend.stat?.(uf)).catch(() => null);
      if (st && st.size > 4 * UNDO_BYTES) return;   // an oversized undo.json (written before the byte bound) is not read: it is replaced at the next write
      const u = JSON.parse(await this.app.backend.readText(uf));
      if (gen === this.#gen && undoUsable(u, sha)) importHistory(this.app._history, u.entries, this.app.doc.read());
    } catch { /* no history yet */ }
  }

  /** A checkpoint now (its text, or the document's): skipped when the newest one holds the same document (a commit of that
   *  state turns the newest automatic one into the commit). kind 'auto' | 'commit' | 'publish' (stage 2: commits and
   *  publishes are never pruned); each entry keeps what changed since the entry before it (history-diff.js), its scope and
   *  a summary; a commit passes `diff` (since the last commit, what its dialog showed). */
  async #checkpointNow(label, { text = null, keep = false, kind = 'auto', note = '', id = null, version = null, diff = null } = {}) {
    const path = this.path, be = this.app.backend;
    if (!path || typeof be.writeText !== 'function') return null;
    text ??= this.#text(undefined, path);
    const h = await this.#history(path), key = contentKey(text), last = h.list[h.list.length - 1];
    // paw-s49h: the runs as the runs file holds them now (record hashes): a restore brings a gone run back whole
    let runRefs = null;
    try { runRefs = this.app.blocks?.get('runs')?.refs?.() || null; } catch { /* no runs store */ }
    if (runRefs && !Object.keys(runRefs).length) runRefs = null;
    const sameRuns = JSON.stringify(last?.runRefs || null) === JSON.stringify(runRefs);
    // the same document and runs as the newest entry: that entry (a commit of it turns an automatic one into the commit). A run
    // change is not in the .pawproj: it makes a new entry, never replaces the newest one's runRefs (the records those name
    // stay kept, the runs file's collection never drops them while the entry lives)
    const top = last?.key === key && !keep && kind !== 'publish' && sameRuns;
    if (top) {
      if (kind === 'auto' || kindOf(last) !== 'auto') return last;
      // a commit's scope is its own diff's (since the last commit), never the automatic entry's; a project-wide one has none
      const { scope: was, ...rest } = last, scope = diff ? diff.scope : was;
      const up = { ...rest, label, auto: false, kind, ...(note ? { note } : {}), ...(scope && scope.kind !== 'project' ? { scope } : {}), ...(diff ? { changes: compactChanges(diff) } : {}) };
      h.list = [...h.list.slice(0, -1), up];
      await this.#writeIndex(h);
      return up;
    }
    let state = null, changes = [], scope = diff?.scope || null;
    try {
      state = this.#docOf(text, path);
      const d = diff || diffDocs(last ? await this.#entryDoc(h, last) : null, state);
      changes = compactChanges(d);
      scope ??= d.scope;
    } catch (e) { console.warn('[project] checkpoint summary:', e); }
    const cid = id || this.#newId(h), at = Number(cid) || Date.now();   // at = id: unique, so the order never ties
    const c = { id: cid, at, label, auto: kind === 'auto', kind, ...(note ? { note } : {}), ...(version ? { version } : {}), ...(keep ? { keep: true } : {}), key,
      ...(scope && scope.kind !== 'project' ? { scope } : {}), changes, ...(state ? { sum: summaryOf(state) } : {}), ...(runRefs ? { runRefs } : {}) };
    await be.writeText(L.joinPath(h.dir, c.id + '.pawproj'), text);
    if (state) this.#remember(key, state);
    const { keep: stay, drop } = pruneCheckpoints([...h.list, c], { recent: this.app.settings.get('project.checkpoints') });
    h.list = stay.reverse();
    await this.#writeIndex(h);
    for (const x of drop) await quiet(be.remove(L.joinPath(h.dir, x.id + '.pawproj')));
    return c;
  }
  #newId(h, at = Date.now()) { while (h.list.some((c) => c.id === String(at))) at++; return String(at); }
  /** paw-ee14 / paw-s49h: every run record the open project's history entries refer to: the runs file keeps them (and their
   *  frames) until no entry does. */
  runRefsKept() {
    const h = this.#hist;
    if (!h || !this.path || h.path !== this.path) return [];
    return [...new Set(h.list.flatMap((c) => Object.values(c.runRefs || {})))];
  }
  async #writeIndex(h) {
    await this.app.backend.writeText(L.joinPath(h.dir, 'index.json'), JSON.stringify({ v: 1, checkpoints: h.list }, null, 1));
    if (this.#hist === h) this.checkpoints = [...h.list].reverse();
  }
  /** A .pawproj text -> the app.load shape (what history-diff compares and a restore applies). */
  #docOf(text, path = this.path) { return L.appDocFrom(parseProject(text, { lenient: true, warnings: [] }), { path }); }
  #docs = null;   // contentKey -> parsed entry state, the last few (a diff against the newest entry reads no file)
  #remember(key, state) { const m = (this.#docs ??= new Map()); m.delete(key); m.set(key, state); while (m.size > 3) m.delete(m.keys().next().value); }
  async #entryDoc(h, c) {
    const hit = c.key && this.#docs?.get(c.key);
    if (hit) return hit;
    const state = this.#docOf(await this.app.backend.readText(L.joinPath(h.dir, c.id + '.pawproj')));
    if (c.key) this.#remember(c.key, state);
    return state;
  }
  #entry(id) { const h = this.#hist; return h && this.path && h.path === this.path ? { h, c: h.list.find((x) => x.id === id) } : { h: null, c: null }; }
  /** A checkpoint of the document as it is now: features call it before a big change ('Before clean'). -> it | null */
  async checkpoint(label) {
    await this.flush();
    return this.#queue(() => this.#checkpointNow(label)).catch((e) => { console.warn('[project] checkpoint:', e); return null; });
  }
  /** Back to a history entry: one undo step (Ctrl+Z takes it back), the state before it a checkpoint first; where the owner
   *  was stays. section: only the entry's scope (a shot / scene commit): points and timed things inside its span, nothing
   *  outside it. Never a run lost: the runs made since stay (their ghosts and frames), a run the entry had comes back as its
   *  points (its frames only if the runs file still holds them). The editable things that are not undo steps (the
   *  features' project blocks) come back with a whole restore and stay with Ctrl+Z. */
  async restoreCheckpoint(id, { section = false } = {}) {
    const app = this.app, path = this.path, { h, c } = this.#entry(id);
    if (!c || !path || this.busy) return false;
    const sc = section ? c.scope : null;
    if (section && !(sc && Number.isFinite(sc.t0) && sc.t1 > sc.t0)) return false;
    let then;
    try { then = await this.#entryDoc(h, c); }
    catch (e) { app.toast(`That entry could not be read: ${errText(e)}`, 'error'); return false; }
    await this.flush();
    const name = bareName(c.note || c.label);
    const before = await this.#queue(() => this.#checkpointNow(`Before going back to “${name}”`)).catch(() => null);
    const d = app.doc, label = `Go back to “${name}”${sc ? ` in ${scopeLabel(sc)}` : ''}`;
    if (sc) {
      const now = { ...d.read(), axes: d.axes, scenes: d.scenes };
      for (const k of Object.keys(now)) if (k.startsWith('axes.')) delete now[k];
      const next = restoreSection(now, then, { t0: sc.t0, t1: sc.t1, last: d.scenes.at(-1)?.end_ms === sc.t1 });
      if (!Object.keys(next).length) { app.toast(`${scopeLabel(sc)} is already as in “${name}”`, 'quiet'); return true; }
      app.transact(label, () => {
        const axes = { ...d.axes };
        for (const [k, v] of Object.entries(next)) if (k.startsWith('axes.')) { if (v.length || axes[k.slice(5)]) axes[k.slice(5)] = v; } else d[k] = v;
        if (Object.keys(next).some((k) => k.startsWith('axes.'))) d.axes = axes;
      });
    } else {
      const ghosts = await L.rehydrateGhosts(app.backend, then.ghosts), ids = new Set(ghosts.map((g) => g.id));
      app.transact(label, () => {
        d.axes = { ...(then.axes || {}) };
        for (const k of UNDOABLE) if (k !== 'acts' || then.acts) d[k] = then[k] ?? EMPTY(k);
      });
      d.ghosts = [...ghosts, ...d.ghosts.filter((g) => !ids.has(g.id))];
      this.#runIds = new Set([...(this.#runIds || []), ...runIdsOf(d.ghosts)]);   // a run brought back is not a track landing
      d.project = { ...(d.project || {}), extra: then.project?.extra || {}, settings: then.project?.settings || {}, meta: then.project?.meta ?? d.project?.meta ?? null, profileId: then.project?.profileId ?? null };
      // the blocks as they were, but not the runs: those in memory are the newest (a restore drops none), and re-reading the
      // .pawruns is the 1.2 s task measured on the big project (126 MB)
      const ex = then.project?.extra || {};
      for (const [k, b] of app.blocks || []) if (k !== 'runs') { try { b.load(app, ex[k] ?? null, {}); } catch (e) { console.error('[block ' + k + ']', e); } }
      // paw-s49h: a run the entry had and the project lost comes back whole (frames too) from the runs file
      if (c.runRefs) await app.blocks?.get('runs')?.revive?.(c.runRefs)?.catch?.((e) => console.warn('[project] runs back:', e));
    }
    app.history.markDirty();   // written at the next tick
    app.toast(`Back to “${name}” (${new Date(c.at).toLocaleString()})${sc ? ` in ${scopeLabel(sc)} only` : ''}. Ctrl+Z takes it back${before ? `; what was there is the checkpoint “${before.label}”` : ''}`, 'ok', { timeout: 7000 });
    return true;
  }

  // ---------- commit, publish (paw-up1r stage 2) ----------
  /** What changed since the last commit (or publish; else since the project's first entry), grouped by section. */
  async pendingChanges() {
    await this.flush();
    const path = this.path;
    const h = path ? await this.#history(path) : null, list = h?.list || [];
    const since = [...list].reverse().find((c) => kindOf(c) !== 'auto') || list[0] || null;
    const was = since ? await this.#entryDoc(h, since).catch(() => null) : null;
    return { ...diffDocs(was, this.#docOf(this.#text())), since };
  }
  /** Ctrl+S: the commit dialog (features/history CommitDialog) opens on the changes since the last commit. */
  async askCommit() {
    if (!this.hasDoc || this.commitDraft) return;
    this.commitDraft = { loading: true };
    let p;
    try { p = await this.pendingChanges(); }
    catch (e) { this.commitDraft = null; this.app.toast(`Could not list the changes: ${errText(e)}`, 'error'); return; }
    if (!this.commitDraft?.loading) return;
    // settings project.unchangedSave / project.commitAsk: nothing changed -> a quiet note instead of the dialog; no note asked
    // -> commit at once (as the dialog's Commit with an empty note)
    const S = this.app.settings;
    if (p.empty && p.since && S.get('project.unchangedSave') === 'toast') { this.commitDraft = null; this.app.toast('Nothing changed since the last commit', 'quiet'); return; }
    if (!(p.empty && p.since) && S.get('project.commitAsk') === false) { this.commitDraft = null; return this.commit({ diff: p }); }
    this.commitDraft = p;
  }
  cancelCommit() { this.commitDraft = null; }
  /** A commit: a named entry of the history that is never pruned. note: optional; diff: what the dialog showed (its scope).
   *  -> the entry | null */
  async commit({ note = '', diff = null } = {}) {
    const app = this.app;
    this.commitDraft = null;
    if (!this.hasDoc) return null;
    if (this.busy) { app.toast(`Not committed: still busy (${this.busy}). Commit again when it finishes.`, 'warn'); return null; }
    if (!this.path) app.history.markDirty();   // a document never written gets its place first
    await this.flush();
    if (!this.path) { app.toast('Not committed: the project could not be written', 'error'); return null; }
    diff ||= await this.pendingChanges().catch(() => null);
    if (diff?.empty && diff.since) { app.toast('Nothing changed since the last commit', 'quiet'); return null; }
    const c = await this.#queue(() => this.#checkpointNow('Commit', { kind: 'commit', note: String(note || '').trim(), diff })).catch((e) => { app.toast(`Not committed: ${errText(e)}`, 'error'); return null; });
    if (c) app.toast(`Committed${c.scope ? ' ' + scopeLabel(c.scope) : ''}${c.note ? `: “${c.note}”` : ''}`, 'ok');
    return c;
  }
  /** Rename / annotate an entry (its note). */
  async annotateCheckpoint(id, note) {
    const { h, c } = this.#entry(id);
    if (!c) return false;
    const n = String(note || '').trim();
    h.list = h.list.map((x) => (x.id === id ? (n ? { ...x, note: n } : (({ note: _, ...r }) => r)(x)) : x));
    await this.#queue(() => this.#writeIndex(h));
    return true;
  }
  /** Delete an entry (its snapshot goes; a published version's funscripts stay where they are). */
  async deleteCheckpoint(id) {
    const { h, c } = this.#entry(id);
    if (!c) return false;
    h.list = h.list.filter((x) => x.id !== id);
    await this.#queue(async () => { await this.#writeIndex(h); await quiet(this.app.backend.remove(L.joinPath(h.dir, id + '.pawproj'))); });
    return true;
  }
  /** Compare: the entry's script, every axis, as a ghost over the current one (one entry at a time; again = off). -> on */
  async compareCheckpoint(id) {
    const app = this.app, d = app.doc, { h, c } = this.#entry(id);
    const others = d.ghosts.filter((g) => g.source?.kind !== 'checkpoint');
    if (!c || d.ghosts.some((g) => g.source?.kind === 'checkpoint' && g.source.id === id)) { d.ghosts = others; return false; }
    let then;
    try { then = await this.#entryDoc(h, c); } catch (e) { app.toast(`That entry could not be read: ${errText(e)}`, 'error'); return false; }
    const name = bareName(c.note || c.label);
    d.ghosts = [...others, ...Object.entries(then.axes || {}).filter(([, s]) => s?.length).map(([axis, script]) => ({
      id: `cmp-${id}-${axis}`, name: `${name} · ${new Date(c.at).toLocaleString()}`, color: '#c9a0ff', script, visible: true, pinned: true, axis, source: { kind: 'checkpoint', id, axis } }))];
    return true;
  }
  /** The comparing entry's id | null. */
  get comparing() { return this.app.doc.ghosts.find((g) => g.source?.kind === 'checkpoint')?.source.id ?? null; }

  /** Publish: the ONLY write of the funscripts beside the video. Each is stamped with metadata.pawscript.publish {version
   *  (n + 1), commit (the history entry of this very state), date, build}; the project records it (published, scriptFiles)
   *  and a 'publish' entry holds that state, so every published file maps to a restorable one. Nothing changed since the
   *  last publish: said, nothing written. -> bool */
  async publish() {
    const app = this.app, d = app.doc;
    if (this.busy) { app.toast(`Not published: still busy (${this.busy}). Publish again when it finishes.`, 'warn'); return false; }
    if (!Object.values(finalAxes(app)).some((s) => s?.length)) { app.toast('Nothing to publish: every axis is empty', 'warn'); return false; }   // paw-x7w7: live runs count
    if (!this.path) app.history.markDirty();
    await this.flush();
    const path = this.path, base = this.base;
    if (!path || !base) { app.toast('Not published: the project could not be written', 'error'); return false; }
    this.busy = 'publish';
    try {
      await this.#q;
      const axes = finalAxes(app), key = publishKey(axes, d.chapters, d.bookmarks), was = this.published;
      if (was?.key === key) { app.toast(`v${was.version} is published: nothing changed since`, 'quiet'); return true; }
      const h = await this.#history(path), id = this.#newId(h), now = new Date();
      const version = Math.max(was?.version || 0, ...h.list.map((c) => (kindOf(c) === 'publish' && c.version) || 0)) + 1;
      const publish = { version, commit: id, date: now.toISOString(), build: APP_BUILD.commit || null };
      const refs = this.#refs();
      const { items, skipped } = L.saveItems({ axes, chapters: d.chapters, bookmarks: d.bookmarks, files: d.files, prov: { ...this.#prov(path), publish, now } }, base);
      for (const it of items) it.unchanged = false;
      let picked = null;
      const res = await L.writeFiles({ backend: app.backend, items, shas: this.#shas, ask: async (cf) => { picked = { choice: await this.#askConflicts(cf), conflicts: cf }; return picked.choice; }, keep: app.settings.get('backup.keep') });
      if (res.cancelled) {
        if (picked?.choice === 'reload' || picked?.choice === 'ghost') { this.busy = ''; await this.#onConflictChoice(picked); }
        else app.toast('Not published', 'quiet');
        return false;
      }
      this.#recordWritten(res.written, refs);
      if (res.failed) { this.#reportFailure('Publish', res); return false; }
      // paw-f4i2: published only once the project records it (and its entry): else vN is neither said nor taken, the next
      // Publish writes it again. In the write queue, so the history index never takes two writes at once
      this.published = { version, commit: id, at: now.getTime(), key };
      app.history.markDirty();
      const gen = this.#gen, r = await this.#queue(async () => {
        const w = await this.#writeProject(gen);
        // the project records vN: it is taken even if its history entry cannot be written (the file maps to the project then)
        if (w.ok) await this.#checkpointNow(`Published v${version}`, { kind: 'publish', id, version, text: this.#lastText }).catch((e) => console.warn('[project] publish entry:', e));
        return w;
      }).catch((e) => failed(errText(e)));
      if (!r.ok) {
        if (gen === this.#gen && this.published?.version === version) this.published = was;
        if (!r.stale) app.toast(`Not published: ${items.map((it) => L.fileName(it.path)).join(', ')} ${items.length === 1 ? 'is' : 'are'} written, but ${L.fileName(path)} could not record v${version} (${r.why}). Publish again once it can be written.`, 'error', { timeout: 0 });
        return false;
      }
      app.usage?.note('project:publish', { version, files: res.written.length });
      app.toast(`Published v${version}: ${items.map((it) => L.fileName(it.path)).join(', ')}${skipped.length ? `\nNot published (no file name): ${skipped.join(', ')}` : ''}${res.backups.length ? `\nOriginals kept as ${res.backups.map(L.fileName).join(', ')}` : ''}`, 'ok');
      return true;
    } catch (e) {
      app.toast(`Publish failed: ${errText(e)}`, 'error', { timeout: 0 });
      return false;
    } finally { this.busy = ''; }
  }
  /** At open: the published version the project records (or its newest publish entry); a project from before Publish whose
   *  funscripts are exactly what Pawscript last wrote (scriptFiles) adopts them as v1. */
  #publishedFrom(stored, found, scriptFiles) {
    const list = this.#hist?.list || [], last = [...list].reverse().find((c) => kindOf(c) === 'publish');
    const own = stored && Number.isInteger(stored.version) && stored.version > 0 ? { version: stored.version, commit: stored.commit ?? null, at: +stored.at || 0, key: stored.key ?? null, ...(stored.adopted ? { adopted: true } : {}) } : null;
    if (own && (!last || own.version >= last.version)) return own;
    if (last) return { version: last.version, commit: last.id, at: last.at, key: null };
    const known = Object.fromEntries((Array.isArray(scriptFiles?.files) ? scriptFiles.files : []).map((x) => [L.pathKey(x?.path || ''), x?.sha256]));
    const files = Object.values(found || {}), prov = files.map((f) => readProvenance(f.parsed?.raw));
    if (!files.length || !files.every((f, i) => known[L.pathKey(f.path)] === f.sha256 && prov[i].kind === 'pawscript')) return null;
    return { version: 1, commit: null, at: Math.max(0, ...prov.map((p) => Date.parse(p.written) || 0)) || Date.now(), key: null, adopted: true };
  }

  // ---------- resume (paw-bztd) ----------
  #resumeJson = null;
  /** The resume store {last: the document open at quit, docs: {pathKey: state}}: localStorage, else memory. fn changes it. */
  #store(fn) {
    const st = this.app.settings?.storage;
    let s = this.#mem;
    if (st) { try { s = JSON.parse(st.getItem(RESUME) || 'null') || { last: null, docs: {} }; } catch { s = { last: null, docs: {} }; } }
    s.docs ||= {};
    if (!fn) return s;
    fn(s);
    // paw-juqk: at most 60 documents and RESUME_CHARS in all, the oldest going first (the store shares the origin's quota with
    // the settings: it must never crowd them out)
    const old = Object.keys(s.docs).sort((a, b) => (s.docs[a].at || 0) - (s.docs[b].at || 0));
    while (old.length > 60) delete s.docs[old.shift()];
    let text = JSON.stringify(s);
    while (text.length > RESUME_CHARS && old.length) { delete s.docs[old.shift()]; text = JSON.stringify(s); }
    if (st) { try { st.setItem(RESUME, text); } catch (e) { console.warn('[project] resume not kept:', e); } } else this.#mem = s;
    return s;
  }
  /** Where the owner is in the open document (shaped per document, for several open at once: paw-shgb). */
  #resumeOf() {
    const a = this.app, p = a.player, d = a.doc, T = first(timelineMods, 'tlFor')?.(a), tr = first(trackingMods, 'peekTracking')?.(a);
    return {
      t: Math.round(p.displayMs ?? p.timeMs ?? 0), view: a.view, mode: a.mode, axis: d.activeAxis,
      sel: { axis: d.selection?.axis, ats: d.selection?.ats?.size <= RESUME_SEL ? [...d.selection.ats] : [] }, range: d.range || null,
      loop: p.loop || null, rate: p.rate, video: p.view || null,
      tl: T ? { scene: T.scene, shots: T.shots, act: T.act, fx: T.fx, segs: T.segs } : null, run: tr?.selectedId || '',
    };
  }
  /** paw-juqk: written only when it changed, and not while the video plays (the tick); leaving and unload always (force). */
  #noteResume(force = false) {
    const k = this.hasDoc && this.#recentPath;
    // paw-zrru: not while a document opens: its loaded state (playhead 0, the whole view) would replace the entry #resume reads
    if (!k || (!force && (this.app.player?.playing || this.busy === 'open'))) return;
    let s;
    try { s = JSON.stringify([k, this.#resumeOf()]); } catch { return; }
    if (s === this.#resumeJson) return;
    this.#resumeJson = s;
    const r = JSON.parse(s)[1];
    this.#store((st) => { st.docs[L.pathKey(k)] = { ...r, at: Date.now() }; st.last = k; });
  }
  /** After an open: back where the owner was in it (an older project without a resume entry: its saved view / playhead). */
  #resume(key, pd) {
    const r = this.#store().docs[L.pathKey(key)] || (pd?.view || pd?.playheadMs != null ? { view: pd.view, t: pd.playheadMs } : null);
    this.#applyResume(r);
    first(trackingMods, 'peekTracking')?.(this.app)?.adoptOldRanges?.(r?.run || '');   // paw-05cg: after the selection is back
    this.#resumeJson = null;
    this.#store((s) => { s.last = key; });
  }
  #applyResume(r) {
    if (!r) return;
    const a = this.app, p = a.player, d = a.doc, gen = this.#gen, ok = (x) => x && x.t1 > x.t0;
    try {
      if (r.mode && r.mode !== a.mode) a.setMode(r.mode);
      if (r.axis && d.axes[r.axis]) a.setActiveAxis(r.axis);
      if (r.sel?.ats?.length && d.axes[r.sel.axis]) { const have = new Set(d.axes[r.sel.axis].map((x) => x.at)); a.select(r.sel.ats.filter((t) => have.has(t)), r.sel.axis); }
      if (ok(r.range)) d.range = { t0: r.range.t0, t1: r.range.t1 };
      if (Number.isFinite(r.rate)) p.setRate?.(r.rate);
      if (ok(r.loop)) p.setLoop?.({ t0: r.loop.t0, t1: r.loop.t1 });
      if (r.video && 'view' in p) p.view = { ...p.view, ...r.video };
      if (r.view) a.setView(r.view);
      const T = first(timelineMods, 'tlFor')?.(a), n = d.scenes?.length || 0;   // this document's own (it may open in a hidden tab)
      if (T && r.tl) {
        if (r.tl.scene < n) T.scene = r.tl.scene;
        T.shots = (r.tl.shots || []).filter((i) => i < n);
        if (d.acts?.some((x) => x.id === r.tl.act)) T.act = r.tl.act;
        if (d.fx?.some((x) => x.id === r.tl.fx)) T.fx = r.tl.fx;
        T.segs = (r.tl.segs || []).filter((id) => d.plan?.some((x) => x.id === id));
      }
      const tr = first(trackingMods, 'peekTracking')?.(a);
      if (tr && r.run && d.ghosts.some((g) => g.id === r.run)) tr.select(r.run);
      // the playhead once the video can seek (and the view again: the duration may only be known then)
      if (Number.isFinite(r.t)) (async () => {
        // a video loading (features/video), not a bare clock; a tab opened in the background has no <video> yet: its clock takes
        // the time now and the pane shows that frame when it mounts (paw-shgb)
        const waits = () => !p.ready && ('url' in p ? !!p.url && !!p.el : !!p.el);
        for (let i = 0; i < 200 && waits() && gen === this.#gen; i++) await new Promise((res) => setTimeout(res, 50));
        if (gen !== this.#gen) return;
        await p.seek(r.t, { exact: true });
        if (r.view && gen === this.#gen) a.setView(r.view);
      })().catch((e) => console.warn('[project] resume:', e));
    } catch (e) { console.warn('[project] resume:', e); }
  }

  // ---------- app-data snapshots: the net when the project cannot be written ----------
  /** What a snapshot or a copy holds is the document now: its undoable parts, ghosts, media, project and blocks. */
  #keepKey() {
    const d = this.app.doc;
    return [...this.#refs(), d.ghosts, d.media, d.graphs, d.project, this.#persistState().json];
  }
  /** -> true when app data holds the document as it is now (written now and read back, or already) */
  async #autosaveNow(force) {
    const d = this.app.doc, be = this.app.backend;
    if (!d.dirty || typeof be.autosaveWrite !== 'function' || (!force && (this.busy === 'save' || this.busy === 'open'))) return false;
    const key = this.#keepKey();
    if (!force && this.#snapKey && key.every((v, i) => v === this.#snapKey[i])) return !!this.keptIn;
    try {
      const blocks = this.app.saveBlocks?.(), session = this.#session;
      const content = L.autosaveContent(d, { projectPath: this.path, base: this.base, view: this.app.view, playheadMs: this.app.player.timeMs, blocks, blockKeys: [...(this.app.blocks?.keys() || [])] });
      const snap = await be.autosaveWrite({ projectPath: this.path, session, title: this.name || 'Untitled', content, keep: 10 });
      // paw-f4i2: kept only once it reads back the same (a full or failing disk can take a write and keep nothing)
      if (!snap?.path || (typeof be.readText === 'function' && (await be.readText(snap.path)) !== content)) throw new Error('the snapshot does not read back');
      // tracking: runs.pawruns, only when runs changed; never another document's runs (a load waits for this; belt and braces)
      if (session === this.#session) await this.app.blocksAutosaved?.(L.dirName(snap.path));
      if (session === this.#session) { this.#noteRecent(blocks); this.keptIn = snap.path; }
      this.#sessions.add(this.#session);
      this.#snapped = true;
      if (this.#autosaveFailed) { this.#autosaveFailed = false; this.app.toast('Autosave works again', 'quiet'); }
    } catch (e) {
      this.keptIn = '';
      this.#snapKey = null;
      if (!this.#autosaveFailed) { this.#autosaveFailed = true; this.app.toast(`Autosave failed: ${errText(e)}`, 'warn'); }
      return false;
    }
    this.#snapKey = key;
    this.lastAutosave = Date.now();
    return true;
  }

  /** After a clean write / save / revert: drop this document's app-data snapshots (its project's, and its untitled sessions'). */
  async #clearAutosaves() {
    const be = this.app.backend;
    if (typeof be.autosaveList !== 'function') return;
    try {
      for (const c of await be.autosaveList()) {
        if ((c.project_path && this.path && L.pathKey(c.project_path) === L.pathKey(this.path)) || this.#sessions.has(c.session)) await quiet(be.autosaveClear(c.id));
      }
    } catch (e) { console.warn('[project] autosaves not cleared:', e); }
    this.#snapKey = null;
    this.keptIn = '';
  }
}


/** The object the shell mounts as app.project. */
export function createProject(app) { return new Project(app); }
