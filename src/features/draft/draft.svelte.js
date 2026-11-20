// draft.svelte.js -- "Draft script": the store draftFor(app) that runs the eight steps (logic.js STEPS) against the
// app, one at a time. Every step that changes the document does it in ONE app.transact at its end, after its sidecar
// work, so a failure or a cancel leaves the document as it was (describe / loop write what finished, and outdate the
// steps after them). Sidecar work goes through the tracking feature's programmatic api (src/features/tracking/api.js:
// owner 'api', so Cancel never kills a panel job); generation is the timeline's own generate(app, 'all'). Step state
// follows undo (view). The last run's step state is the project block 'draft' -- registered by the first draftFor(app),
// which the status chip (status.js) makes at boot.
import { rooted } from '../../lib/rooted.svelte.js';
import { trackingApi } from '../tracking/api.js';
import { generate } from '../timeline/generate.js';
import { importTimeline, toSpans } from '../timeline/plan.js';
import { durOf, newId } from '../timeline/state.svelte.js';
import { assistFor } from '../assist/assist.svelte.js';
import { scriptOf } from '../../lib/script-of.js';   // paw-x7w7: baked + live
import {
  stepsOf, initSteps, stepEvent, pending, isComplete, restoreSteps, saveSteps, factsOf, summaryLine, withDoc,
  planFromScenes, kindForSummary, kindTally, pickTracker, plural, fmtCount, firstLine,
} from './logic.js';

const DEGRADE = 'the plan uses motion-only kinds';
const TAG = 'draft';   // ghost.source.tag of the base-tracking run this pipeline made
// describe errors that will repeat on every scene (stop and degrade); anything else is that scene's own problem
const ENV_ERROR = /not installed|cuda|torch|describe extra|no module named|modulenotfound|spawn/i;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

class Draft {
  mode = $state('rules');          // 'rules' | 'director' (logic.js stepsOf); director needs useSteps(ext) first
  ext = null;                      // {id: async (draft, i, single) -> step result}: the steps draft does not own
  steps = $state.raw(initSteps());
  show = $state(false);            // the dialog
  describeOn = $state(true);
  timeline = $state.raw(null);     // {name, text}: a director timeline replaces the rule-table plan
  running = $state(-1);            // index of the step that runs now
  batch = $state(false);           // Run all in progress
  runId = null;                    // the base-tracking run this pipeline made (replaced on redo)
  cancelled = false;
  epoch = 0;                       // bumped by load() / reset(): a step still in flight then writes nothing
  execEp = 0;                      // the epoch the running step started in

  /** The steps as the document stands now: an undone step (its undo entry no longer applied, or the track's ghost
   *  gone) and the done steps after it are stale. What the dialog shows and Run all goes by. */
  view = $derived.by(() => {
    const h = this.app.history.entries, ghosts = this.app.doc.ghosts || [];
    return withDoc(this.steps, {
      live: (id) => { const e = h.find((x) => x.id === id); return !e || e.applied; },
      gone: (s) => s.id === 'track' && !!s.facts?.runId && !ghosts.some((g) => g.id === s.facts.runId),
    });
  });

  constructor(app) {
    this.app = app;
    this.api = trackingApi(app);
    app.registerBlock?.('draft', { save: () => this.save(), load: (_, v) => this.load(v) });
  }

  get busy() { return this.running >= 0 || this.batch; }
  get complete() { return isComplete(this.view); }
  get facts() { return factsOf(this.view); }
  get summary() { return summaryLine(this.facts); }
  get list() { return stepsOf(this.mode); }
  get current() { return this.running >= 0 ? this.list[this.running] : null; }
  /** load() / reset() happened since the running step started. */
  get moved() { return this.execEp !== this.epoch; }
  /** Sidecar progress of the job running now ({done,total}). */
  get sidecar() { return this.api.progress(); }
  /** What a first run would replace (shown in the dialog). */
  get replaces() {
    const d = this.app.doc, n = (d.plan || []).length, pts = (d.axes?.stroke || []).length;
    return n || pts ? `Replaces the current plan (${plural(n, 'segment')}) and regenerates its spans on stroke (${fmtCount(pts)} points now). Each step is one undo entry.` : '';
  }
  /** Id of the undo entry on top (right after a step's transact: the one it made). */
  top() { const h = this.app.history; return h.entries[h.index - 1]?.id ?? null; }

  set(i, ev) { this.steps = stepEvent(this.steps, i, ev); }
  progress(i, done, total, label) { if (!this.moved) this.set(i, { type: 'progress', done, total, label }); }

  // ---- running ----
  async exec(i, single = false) {
    const id = this.list[i].id, t = now(), ep = this.epoch;
    const set = (ev) => { if (ep === this.epoch) this.set(i, ev); };   // after a load() the new project's steps stay as loaded
    this.execEp = ep;
    set({ type: 'start' });
    this.running = i;
    try {
      const r = (await (this[id] ? this[id](i, single) : this.ext[id](this, i, single))) || {};
      const ms = now() - t;
      if (r.cancelled) { set({ type: 'cancel', ms, note: r.note, wrote: r.wrote }); return false; }
      if (r.skip) { set({ type: 'skip', reason: r.skip, ms }); return true; }
      set({ type: 'done', note: r.note, facts: r.facts, entry: r.entry, ms });
      return true;
    } catch (e) {
      console.warn('[draft] ' + id, e);
      set({ type: 'fail', error: e, wrote: e?.wrote, ms: now() - t });
      return false;
    } finally { this.running = -1; }
  }
  /** Run (or redo) one step. */
  async run(i) {
    if (this.busy || !this.list[i]) return;
    this.cancelled = false;
    if (this.list[i].id === 'describe') this.describeOn = true;
    await this.exec(i, true);
  }
  /** Run from the first pending step (logic.js pending) to the end -- each step outdates the ones after it, so
   *  they all run again -- leaving user skips skipped; stops at a failure or a cancel. A finished run with
   *  questions waiting ends in the assist overlay (over the Review tab). */
  async runAll() {
    if (this.busy) return;
    this.cancelled = false; this.batch = true;
    let ok = true;
    try {
      for (let i = pending(this.view)[0] ?? this.list.length; i < this.list.length; i++) {
        if (this.cancelled) { ok = false; break; }
        if (this.steps[i].status === 'skipped' && this.steps[i].user) continue;
        if (this.list[i].id === 'describe' && !this.describeOn) { this.set(i, { type: 'skip', reason: 'Turned off', user: true }); continue; }
        if (!(await this.exec(i))) { ok = false; break; }
      }
    } finally { this.batch = false; }
    if (ok && !this.cancelled && this.complete && this.facts.assist?.questions > 0) this.startAssist();
  }
  skip(i) {
    if (this.busy || !this.list[i]) return;
    if (this.list[i].id === 'describe') this.describeOn = false;
    this.set(i, { type: 'skip', reason: this.list[i].id === 'describe' ? 'Turned off' : 'Skipped', user: true });
  }
  setDescribe(on) {
    if (this.busy) return;
    this.describeOn = !!on;
    const i = this.list.findIndex((s) => s.id === 'describe');
    if (!on) this.set(i, { type: 'skip', reason: 'Turned off', user: true });
    else if (this.steps[i].status === 'skipped') this.set(i, { type: 'reset' });
  }
  /** Kill the current sidecar job (only one this pipeline started; queued ones never start) and stop Run all. */
  cancel() { if (!this.busy) return; this.cancelled = true; this.api.cancel(); }
  reset() { if (!this.busy) { this.epoch++; this.steps = initSteps(this.list); } }
  /** The steps draft does not own (director mode): {id: async (draft, i, single) -> step result}. */
  useSteps(ext) { this.ext = ext; }
  setMode(m) { if (!this.busy && m !== this.mode && (m === 'rules' || this.ext)) { this.mode = m; this.steps = initSteps(this.list); } }

  // ---- director timeline (import hook) ----
  /** A director timeline / spans JSON (string or value) for the plan step; throws on unreadable input. */
  setTimeline(input, name = 'timeline.json') {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    importTimeline(text, { dur: durOf(this.app), newId: () => 'probe' });
    this.timeline = { name, text };
  }
  clearTimeline() { this.timeline = null; }
  async pickTimeline() {
    const app = this.app;
    try {
      const path = await app.backend.openDialog({ title: 'Director timeline for the first plan', filters: [{ name: 'Timeline JSON', extensions: ['json'] }] });
      if (!path || Array.isArray(path)) return;
      this.setTimeline(await app.backend.readText(path), path.split(/[\\/]/).pop());
    } catch (e) { app.toast('Timeline not usable: ' + firstLine(e), 'error'); }
  }

  // ---- the steps: each returns {note, facts, entry} | {skip} | {cancelled, note, wrote}, or throws ----
  /** The tracker list; null when the pipeline was cancelled (or the project changed) meanwhile. */
  async listed() {
    try { const t = await this.api.trackers(); return this.cancelled || this.moved ? null : t; }
    catch (e) { if (this.cancelled || this.moved) return null; throw e; }
  }
  /** New describe / loop results (Map: index into base -> result) -> doc.scenes (+ extra) as one undo entry, matched
   *  by start/end (a no-op scenes edit meanwhile does not lose them). -> the entry id, or null if nothing written. */
  writeScenes(label, key, base, results, extra) {
    if (!results.size || this.moved) return null;
    const at = new Map([...results].map(([k, r]) => [base[k].start_ms + ':' + base[k].end_ms, r]));
    let hit = 0;
    const next = (this.app.doc.scenes || []).map((s) => {
      const r = at.get(s.start_ms + ':' + s.end_ms);
      if (r === undefined) return s;
      hit++;
      return { ...s, [key]: r };
    });
    if (!hit) throw new Error('The scenes changed while this step ran; nothing was written.');
    this.app.transact(label, () => { this.app.doc.scenes = next; extra?.(); });
    return this.top();
  }
  /** call(k) per scene, in order. Not single (Run all / Run the rest): scenes that already have a `key` result keep
   *  it (a resume after a cancel). stop(error) true: give up there; else the error is that scene's and the rest run.
   *  -> {base, results (all, by index), fresh (the new ones), errors (by index), abort, cancelled} */
  async eachScene(i, key, call, single, stop = () => true) {
    const base = this.app.doc.scenes || [], results = new Map(), fresh = new Map(), errors = new Map();
    let abort = null, cancelled = false;
    for (let k = 0; k < base.length; k++) {
      if (!single && base[k][key] != null) { results.set(k, base[k][key]); continue; }
      if (this.cancelled || this.moved) { cancelled = true; break; }
      this.progress(i, k, base.length, `scene ${k + 1}/${base.length}`);
      const r = await call(k);
      if (r.cancelled) { cancelled = true; break; }
      if (r.error) { if (stop(r.error)) { abort = r.error; break; } errors.set(k, r.error); continue; }
      results.set(k, r.result); fresh.set(k, r.result);
    }
    return { base, results, fresh, errors, abort, cancelled };
  }

  async scenes() {
    if (!(await this.listed())) return { cancelled: true };
    const r = await this.api.detectScenes();
    if (r.cancelled) return { cancelled: true };
    if (r.error) throw new Error(r.error);
    const m = r.media;
    return { note: plural(r.scenes.length, 'scene') + (m ? ` · ${(m.duration_ms / 1000).toFixed(1)} s at ${m.fps} fps${m.is_vfr ? ' (VFR)' : ''}` : ''), facts: { scenes: r.scenes.length }, entry: this.top() };
  }

  async describe(i, single) {
    if (!this.describeOn) return { skip: 'Turned off' };
    if (!(await this.listed())) return { cancelled: true };
    if (!this.api.canDescribe()) return { skip: `describe is not installed (needs the describe extra and a CUDA GPU); ${DEGRADE}` };
    if (!(this.app.doc.scenes || []).length) return { skip: 'No scenes' };
    const prev = this.steps[i].entry;
    const { base, results, fresh, errors, abort, cancelled } = await this.eachScene(i, 'describe', (k) => this.api.describeScene(k), single, (e) => ENV_ERROR.test(e));
    const entry = this.writeScenes('Draft: describe scenes', 'describe', base, fresh);
    const n = base.length, k = results.size, wrote = !!entry;
    if (cancelled) return { cancelled: true, wrote, note: `Cancelled after ${k}/${n}` };
    if (!k) return { skip: `describe failed: ${firstLine(abort || [...errors.values()][0] || 'no result')}; ${DEGRADE}` };
    const kinds = [...results.values()].map((r) => kindForSummary(r?.summary)?.kind ?? 'no tags');
    const tally = kindTally(kinds.map((kind) => ({ kind })));
    const kept = k - fresh.size, bad = errors.size ? `${errors.size} failed (${firstLine([...errors.values()][0])})` : '';
    const head = abort ? `${k}/${n} described, stopped: ${firstLine(abort)}` : `${plural(k, 'scene')} described${kept ? ` (${kept} kept)` : ''}`;
    return { note: [head, bad, tally].filter(Boolean).join(' · '), facts: { described: k }, entry: entry ?? prev };
  }

  async loops(i, single) {
    if (!(this.app.doc.scenes || []).length) return { skip: 'No scenes' };
    const prev = this.steps[i].entry;
    const { base, results, fresh, abort, cancelled } = await this.eachScene(i, 'loop', (k) => this.api.loopScene(k), single);
    const exact = [...results].filter(([, r]) => r?.kind === 'exact' && r.period_ms > 0 && r.cycles >= 2);
    const periodic = [...results.values()].filter((r) => r?.kind === 'periodic').length;
    // a newly found exact loop also becomes a loop region (one cycle at the scene start), unless one is there already
    const entry = this.writeScenes('Draft: loop check', 'loop', base, fresh, () => {
      const loops = [...(this.app.doc.loops || [])];
      for (const [k, r] of exact) {
        if (!fresh.has(k)) continue;
        const t0 = Math.round(base[k].start_ms), t1 = Math.round(base[k].start_ms + r.period_ms);
        if (!loops.some((l) => l.t0 < t1 && l.t1 > t0)) loops.push({ id: newId('lp'), t0, t1 });
      }
      if (loops.length !== (this.app.doc.loops || []).length) this.app.doc.loops = loops.sort((a, b) => a.t0 - b.t0);
    });
    const n = base.length, kept = results.size - fresh.size, wrote = !!entry;
    if (cancelled) return { cancelled: true, wrote, note: `Cancelled after ${results.size}/${n}` };
    if (abort) throw Object.assign(new Error(`${results.size}/${n} checked (kept), then: ${firstLine(abort)}`), { wrote });
    const note = `${plural(exact.length, 'exact loop')} · ${periodic} periodic · ${n - exact.length - periodic} none${kept ? ` (${kept} kept)` : ''}`;
    return { note, facts: { exact: exact.length, periodic }, entry: entry ?? prev };
  }

  async plan() {
    const app = this.app, dur = durOf(app), id = () => newId('seg');
    let plan, note;
    if (this.timeline) {
      const r = importTimeline(this.timeline.text, { dur, newId: id });
      plan = r.plan;
      note = `${plural(plan.length, 'segment')} from ${this.timeline.name}${r.warnings.length ? ` · ${plural(r.warnings.length, 'warning')}: ${r.warnings[0]}` : ''}`;
    } else {
      plan = planFromScenes(app.doc.scenes || [], { dur, newId: id });
      note = `${plural(plan.length, 'segment')} · ${kindTally(plan)}`;
    }
    if (!plan.length) throw new Error('The plan came out empty (no video duration?).');
    app.transact('Draft: first plan', () => { app.doc.plan = plan; });
    return { note, facts: { segments: plan.length }, entry: this.top() };
  }

  async track(i) {
    const app = this.app, ts = await this.listed();
    if (!ts) return { cancelled: true };
    const pick = pickTracker(ts);
    if (!pick) throw new Error('No tracker can run without a region (needs one with a box ROI).');
    const t0 = 0, t1 = durOf(app);
    this.progress(i, 0, 0, pick.name || pick.tracker);
    const r = await this.api.trackRange({ tracker: pick.tracker, range: { t0, t1 }, roi: pick.roi, spans: toSpans(app.doc.plan || []), tag: TAG });
    if (r.cancelled) return { cancelled: true };
    if (r.error) throw new Error(r.error);
    if (this.moved) return { cancelled: true };
    const old = this.runId;
    this.runId = r.run.id;
    // a redo replaces this pipeline's previous run -- only while that ghost is still the draft's (a hand-made run can
    // get the same id once the draft's ghost was removed)
    if (old && old !== r.run.id && (app.doc.ghosts || []).find((g) => g.id === old)?.source?.tag === TAG) this.api.removeRun(old);
    const pts = r.run.points.at.length;
    return { note: `${pick.name || pick.tracker}${pick.roi ? ' (whole frame)' : ''} · ${fmtCount(pts)} points · ghost #${r.run.n}`, facts: { runId: r.run.id, points: pts } };
  }

  async generate() {
    const app = this.app, plan = app.doc.plan || [];
    if (!plan.length) return { skip: 'No plan' };
    if (!plan.some((s) => !s.locked)) return { skip: 'Every segment is locked' };
    const switched = app.doc.activeAxis !== 'stroke';
    if (switched) app.setActiveAxis('stroke');
    const r = generate(app, 'all');
    if (!r.targets.length) return { skip: 'Every segment is locked' };
    const errs = r.issues.filter((x) => x.level === 'error'), points = scriptOf(app, 'stroke').length;
    return { note: `${plural(r.done.length, 'segment')} · ${plural(points, 'point')} on stroke${switched ? ' (now the active axis)' : ''}${errs.length ? ` · ${plural(errs.length, 'error')}: ${errs[0].msg}` : ''}`, facts: { points }, entry: this.top() };
  }

  async assist(i, single) {
    // assist asks about the run selected in the tracker panel: hand it the base track this pipeline made
    if (this.runId && this.api.runs().some((r) => r.id === this.runId)) this.api.select(this.runId);
    const A = assistFor(this.app);
    A.regenerate();
    const open = A.questions.filter((q) => A.stateOf(q) === 'open');
    const gain = open.reduce((s, q) => s + (+q.value || 0), 0);
    if (single && open.length) this.startAssist();
    return { note: open.length ? `${plural(open.length, 'question')} waiting · est. +${gain.toFixed(2)}` : 'No questions waiting', facts: { questions: open.length, gain } };
  }
  startAssist() { this.show = false; assistFor(this.app).show(); }

  async review() {
    const app = this.app, panel = (id) => (app.panels || []).find((p) => p.id === id);
    app.setMode('review');
    const pr = panel('review.problems'), cp = panel('review.compare');
    if (pr) app.showPanel(pr.id);
    const apart = pr && cp && app.layout?.dockOf(cp) !== app.layout?.dockOf(pr);
    if (apart) app.showPanel(cp.id);
    const dp = app.devicePreview;
    if (dp?.available && !dp.on) dp.toggle(true);
    const parts = ['Review tab', pr ? (apart ? 'Problems + Compare' : 'Problems (Compare is the next tab)') : 'no Problems panel',
      dp?.available ? 'machine preview on' : 'no kinematic profile: machine preview off'];
    return { note: parts.join(' · ') };
  }
  openReview() { this.show = false; if (this.app.mode !== 'review') this.review(); }

  // ---- project block ----
  save() {
    if (this.steps.every((s) => s.status === 'idle' && !s.note) && this.describeOn && !this.timeline && this.mode === 'rules') return null;
    return { v: 1, mode: this.mode, steps: saveSteps(this.steps), describe: this.describeOn, runId: this.runId, timeline: this.timeline };
  }
  load(v) {
    if (this.busy) this.cancel();
    this.epoch++;
    this.mode = v?.mode === 'director' ? 'director' : 'rules';
    this.steps = restoreSteps(v?.steps, this.list);
    this.describeOn = v?.describe !== false;
    this.runId = typeof v?.runId === 'string' ? v.runId : null;
    this.timeline = v?.timeline && typeof v.timeline.text === 'string' ? { name: String(v.timeline.name || 'timeline.json'), text: v.timeline.text } : null;
  }
}

const stores = new WeakMap();
/** The draft store of an app (created on first use; registers the 'draft' project block). */
export function draftFor(app) {
  let s = stores.get(app);
  if (!s) { s = rooted(() => new Draft(app), app); stores.set(app, s); }   // paw-b7da: its own root, never the asking component's
  return s;
}
export const peekDraft = (app) => stores.get(app) || null;
