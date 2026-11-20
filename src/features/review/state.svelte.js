// Review state: one instance per `app` (getReview(app)), shared by every review panel and command.
// Owns the device profile choice, the problem list (incremental, debounced), ignore rules, filters, navigation,
// fixes and review playback. Pure logic is in logic/*.js (node-tested).
import { rooted } from '../../lib/rooted.svelte.js';
import { untrack } from 'svelte';
import { findProblems } from '../../lib/analyze/index.js';
import { ProblemIndex, defaultFilter, filterProblems, sortProblems, countBy, emptyIgnore, ignoreId, ignoreKind, isIgnored, pruneIgnore, neighbour } from './logic/problems.js';
import { applyFix, hasFix, fixLabel } from './logic/fixes.js';
import { listProfiles, profileKey, activeProfile, strokeRangeOf, GENERIC } from './logic/profiles.js';
import { reviewMarkers } from './markers.svelte.js';
import { clampView } from '../../lib/lane.js';
import { scriptOf } from '../../lib/script-of.js';   // paw-x7w7: baked + live

const LEAD_MS = 1500, TAIL_MS = 1000, DEBOUNCE_MS = 140;
const instances = new WeakMap();

/** The one Review instance for this app. Also reachable as `app.review`. */
export function getReview(app) {
  let r = instances.get(app);
  if (!r) { r = rooted(() => new Review(app), app); instances.set(app, r); try { app.review = r; } catch { /* frozen app */ } }   // paw-b7da: its own root
  return r;
}

/** Heatmap settings for any feature: { scale: name in analyze SCALES, max: units/s at the top of the scale }. */
export function heatmapSettings(app) {
  const prof = activeProfile(app.settings);
  return { scale: app.settings.get('review.heatmapScale', 'heat'), max: app.settings.get('review.heatmapMax', 0) || prof.maxSpeed };
}

class Review {
  problems = $state.raw([]);          // every problem in scope (all severities), sorted by time, ignored ones included
  ignore = $state.raw(emptyIgnore());
  filter = $state(defaultFilter());
  selectedId = $state(null);
  busy = $state(false);
  lastMs = $state(0);                 // duration of the last recompute
  stepping = $state(false);           // "step through problems while playing"
  #app; #index; #timer = 0; #ctxVer = 0; #lastCh = null; #lastMedia = null; #loopOwned = null; #stop;

  constructor(app) {
    this.#app = app;
    this.#index = new ProblemIndex((s, p, c) => findProblems(s, p, c));
    // ignore rules are a `review` block in the .pawproj; created lazily, so also pick up the block of a doc opened before.
    // save always returns the block: null would let a stale one in doc.project.extra survive a "clear all".
    app.registerBlock?.('review', { save: () => ({ ignore: this.ignore }), load: (_, v) => this.loadIgnore(v) });
    this.loadIgnore(app.doc.project?.extra?.review ?? null);
    this.#stop = $effect.root(() => {
      $effect(() => {                                   // recompute (debounced) when anything the finder depends on changes
        const axes = Object.keys(app.doc.axes).map((a) => scriptOf(app, a)), active = app.doc.activeAxis, chapters = app.doc.chapters, media = app.doc.media;
        this.profile; this.scope;
        if (chapters !== this.#lastCh || media !== this.#lastMedia) { this.#lastCh = chapters; this.#lastMedia = media; this.#ctxVer++; }
        void axes; void active;
        untrack(() => this.schedule());
      });
      $effect(() => {                                   // markers for the timeline and status bar
        const list = this.problems.filter((p) => !isIgnored(p, this.ignore)), counts = countBy(this.problems, this.ignore);
        untrack(() => reviewMarkers.set({ items: list.map(({ id, axis, t0, t1, severity, kind }) => ({ id, axis, t0, t1, severity, kind })), counts }));
      });
      $effect(() => {                                   // step through problems while playing
        const t = app.player.timeMs;
        if (!this.stepping || !app.player.playing) return;
        untrack(() => {
          const cur = this.problems.find((p) => p.id === this.selectedId);
          if (cur && t > cur.t1 + TAIL_MS) this.playFrom(1);
        });
      });
    });
  }

  destroy() { this.#stop?.(); clearTimeout(this.#timer); }

  // ---- device profile ----
  get customProfiles() { return this.#app.settings.get('review.profiles', []); }
  get profiles() { return listProfiles(this.customProfiles); }
  /** The active profile as run: includes the stroke window (`review.strokeMm`) for profiles with kinematics.strokeRange. */
  get profile() { return activeProfile(this.#app.settings); }
  /** Stroke window (mm) of the active profile; null when it has no strokeRange. */
  get strokeMm() { return strokeRangeOf(this.profile) ? this.profile.kinematics.strokeMm : null; }
  setStrokeMm(mm) { const id = this.profile.id; this.#app.settings.set('review.strokeMm', { ...this.#app.settings.get('review.strokeMm', {}), [id]: Math.round(mm) }); }
  get scope() { return this.#app.settings.get('review.scope', 'active'); }          // 'active' | 'all'
  setProfile(id) { this.#app.settings.set('review.profile', id); }
  setScope(s) { this.#app.settings.set('review.scope', s); }
  /** Insert or replace a custom profile (by id) and optionally select it. */
  saveProfile(p, select = true) {
    const rest = this.customProfiles.filter((x) => x.id !== p.id);
    this.#app.settings.set('review.profiles', [...rest, p]);
    if (select) this.setProfile(p.id);
  }
  deleteProfile(id) {
    this.#app.settings.set('review.profiles', this.customProfiles.filter((x) => x.id !== id));
    if (this.profile.id === id || this.#app.settings.get('review.profile') === id) this.setProfile(GENERIC.id);
  }

  // ---- recompute ----
  schedule(immediate = false) {
    clearTimeout(this.#timer);
    const first = !this.#index.cache.size;
    if (immediate || first) this.recompute();
    else { this.busy = true; this.#timer = setTimeout(() => this.recompute(), DEBOUNCE_MS); }
  }
  recompute() {
    clearTimeout(this.#timer);
    const app = this.#app, t0 = performance.now(), prof = this.profile, set = app.settings;
    // the micro-glitch thresholds are the join cleanup's (settings edit.cleanMicroMs / edit.cleanMicroPos)
    const thresholds = { microGapMs: set?.get?.('edit.cleanMicroMs') ?? 60, microPos: set?.get?.('edit.cleanMicroPos') ?? 6 };
    const key = profileKey(prof) + '|' + this.#ctxVer + '|' + thresholds.microGapMs + '/' + thresholds.microPos;
    const axes = this.scope === 'all' ? Object.keys(app.doc.axes) : [app.doc.activeAxis];
    for (const a of [...this.#index.cache.keys()]) if (!axes.includes(a)) this.#index.clear(a);
    const ctx = { mediaDurationMs: app.doc.media?.durationMs, thresholds };   // no chapters (paw-1w0x): nothing shows them
    const all = [];
    for (const a of axes) {
      const s = scriptOf(app, a);   // paw-x7w7: what plays (live runs in)
      if (s?.length) all.push(...this.#index.update(a, s, prof, key, ctx));
    }
    all.sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
    this.problems = all;
    if (this.selectedId && !all.some((p) => p.id === this.selectedId)) this.selectedId = null;
    const pruned = pruneIgnore(this.ignore, all);
    if (pruned !== this.ignore && this.scope === 'all') this.#saveIgnore(pruned, false);
    this.lastMs = performance.now() - t0;
    this.busy = false;
  }
  /** Recompute now (tests, commands). */
  flush() { this.recompute(); }

  // ---- derived views ----
  visible = $derived(sortProblems(filterProblems(this.problems, this.filter, this.ignore), this.filter.sort, this.filter.dir));
  counts = $derived(countBy(this.problems, this.ignore));
  kinds = $derived([...new Set(this.problems.map((p) => p.kind))].sort());
  current = $derived(this.problems.find((p) => p.id === this.selectedId) ?? null);
  isIgnored(p) { return isIgnored(p, this.ignore); }
  canFix(p) { return hasFix(p); }
  fixText(p) { return fixLabel(p); }

  // ---- ignore rules (the project's `review` block; older versions kept them in the setting `review.ignore` by media path) ----
  loadIgnore(block = null) {
    const r = block?.ignore, d = this.#app.doc, legacy = d.media?.path || d.project?.path;
    const old = !block && legacy ? this.#app.settings.get('review.ignore', {})?.[legacy] : null;   // read-only migration
    const ok = (x) => x && Array.isArray(x.ids) && Array.isArray(x.kinds);
    this.ignore = ok(r) ? { ids: r.ids.filter((x) => typeof x === 'string'), kinds: r.kinds.filter((x) => typeof x === 'string') } : ok(old) ? old : emptyIgnore();
  }
  #saveIgnore(rules, user = true) {
    if (rules === this.ignore) return;
    this.ignore = rules;
    if (user) this.#app.history?.markDirty?.();      // part of the project now: Save / autosave must pick it up
  }
  toggleIgnore(p, on = !this.isIgnored(p)) { this.#saveIgnore(ignoreId(this.ignore, p.id, on)); }
  toggleIgnoreKind(kind, on = true) { this.#saveIgnore(ignoreKind(this.ignore, kind, on)); }
  clearIgnores() { this.#saveIgnore(emptyIgnore()); }

  // ---- navigation ----
  /** Seek to a problem, select its points, bring it into view. opts.seek=false keeps the playhead. */
  jump(p, { seek = true, lead = 0 } = {}) {
    const app = this.#app;
    if (!p) return;
    if (p.axis !== app.doc.activeAxis) app.setActiveAxis(p.axis);
    app.select(p.ats ?? [], p.axis);
    this.selectedId = p.id; reviewMarkers.set({ selectedId: p.id });
    this.focusSpan(p.t0, p.t1, { seek, lead });
  }
  /** Seek to t0 (minus lead) and scroll/zoom the shared view so [t0,t1] is visible. */
  focusSpan(t0, t1, { seek = true, lead = 0 } = {}) {
    const app = this.#app;
    if (seek) app.player.seek(Math.max(0, t0 - lead));
    const v = app.view, len = t1 - t0, pad = Math.max(1500, len * 0.25);
    if (t0 - pad < v.start || t1 + pad > v.start + v.span) {
      const span = Math.max(v.span, Math.min(len + pad * 2, app.durationMs));
      app.setView(clampView({ start: t0 - Math.max(0, span - len) / 2, span }, app.durationMs));
    }
  }
  /** Problems the navigation commands walk through: what the list shows (filters on, ignored off), by time. */
  navList = $derived(sortProblems(filterProblems(this.problems, { ...this.filter, showIgnored: false }, this.ignore)));
  step(dir) {
    const p = neighbour(this.navList, this.#app.player.timeMs, dir);
    if (p) this.jump(p); else this.#app.toast('No problems', 'quiet');
    return p;
  }

  // ---- fixes ----
  /** One undo entry. Returns true if the script changed. */
  fix(p) {
    const app = this.#app, s = scriptOf(app, p.axis);
    if (!s.length || !hasFix(p)) return false;
    const next = applyFix(s, p);
    if (next === s) { app.toast('Nothing to change', 'quiet'); return false; }
    app.edit(`Fix: ${fixLabel(p)}`, p.axis, next);
    this.recompute();
    app.toast(`${fixLabel(p)}: done`, 'ok', { action: { label: 'Undo', run: () => app.undo() } });
    return true;
  }
  /** Fix `p`, then select the next problem after it (keeps the playhead). Ctrl+F8 and the row's Fix button. */
  fixAndAdvance(p) {
    if (!p || !hasFix(p)) return false;
    const next = this.navList.find((q) => q.t0 > p.t1 && q.id !== p.id), done = this.fix(p);
    if (next) this.jump(next, { seek: false });
    return done;
  }
  /** Ignore `p`, then select the next problem after it. Alt+F8 and the row's Ignore button. */
  ignoreAndAdvance(p) {
    if (!p) return;
    const next = this.navList.find((q) => q.t0 > p.t0 && q.id !== p.id);
    this.toggleIgnore(p, true);
    if (next) this.jump(next, { seek: false });
  }
  /** Apply the fix of every non-ignored problem of `kind` (across the scope's axes) as one undo entry. Returns the number of axes changed. */
  fixKind(kind) {
    const app = this.#app, probs = this.problems.filter((p) => p.kind === kind && !this.isIgnored(p) && hasFix(p));
    if (!probs.length) return 0;
    const byAxis = new Map();
    for (const p of probs) if (!byAxis.has(p.axis)) byAxis.set(p.axis, p);
    let n = 0;
    app.transact(`Fix all: ${kind}`, () => {
      for (const [axis, p] of byAxis) {
        const s = scriptOf(app, axis), next = applyFix(s, p, { all: true });
        if (next !== s) { app.edit(`Fix all: ${kind}`, axis, next); n++; }
      }
    });
    this.recompute();
    app.toast(n ? `Fixed ${probs.length} ${kind} problem${probs.length === 1 ? '' : 's'}` : 'Nothing to change', n ? 'ok' : 'quiet');
    return n;
  }
  /** Quick action: bring every segment under the device speed limit (the "speed-limit" fix, whole axis). */
  limitSpeed(axis = this.#app.doc.activeAxis) {
    const app = this.#app, s = scriptOf(app, axis);
    if (!s.length) return false;
    const next = applyFix(s, { fix: { op: 'capSpeed', opts: { maxSpeed: this.profile.maxSpeed, method: 'pull' } } });
    if (next === s) { app.toast(`Already within ${this.profile.maxSpeed} u/s`, 'quiet'); return false; }
    app.edit(`Limit speed to ${this.profile.maxSpeed} u/s`, axis, next);
    this.recompute();
    return true;
  }

  // ---- review playback helpers ----
  /** Play from `LEAD_MS` before the previous (dir<0) / next (dir>0) problem relative to the playhead. */
  playFrom(dir = -1) {
    const app = this.#app, p = neighbour(this.navList, app.player.timeMs - (dir < 0 ? LEAD_MS : 0), dir);
    if (!p) { app.toast('No problems', 'quiet'); return null; }
    this.jump(p, { lead: LEAD_MS });
    app.player.play();
    return p;
  }
  /** Loop the neighbourhood of the current (else nearest) problem; again to release. */
  toggleLoop() {
    const app = this.#app, pl = app.player;
    if (this.#loopOwned && pl.loop && pl.loop.t0 === this.#loopOwned.t0) { pl.setLoop(null); this.#loopOwned = null; app.toast('Loop off', 'quiet'); return; }
    const p = this.current ?? neighbour(this.navList, pl.timeMs + 1, 1);
    if (!p) { app.toast('No problems', 'quiet'); return; }
    this.jump(p, { seek: false });
    this.#loopOwned = { t0: Math.max(0, p.t0 - LEAD_MS), t1: p.t1 + TAIL_MS };
    pl.setLoop(this.#loopOwned);
    pl.seek(this.#loopOwned.t0);
    pl.play();
  }
  toggleStepping() {
    this.stepping = !this.stepping;
    this.#app.toast(this.stepping ? 'Stepping through problems while playing' : 'Stepping off', 'quiet');
    if (this.stepping && !this.#app.player.playing) this.playFrom(1);
  }
}
