// director.svelte.js -- directorFor(app): the automated director's store (contract README §9.1). It is a mode of the
// draft runner: draft runs DIRECTOR_STEPS, the six director steps come from steps.js (runner.js does the work). Here:
// settings, the decision records (also the replay cache), user overrides, the user queue, the brains (one registry
// per settings + session: the agent brain's waiting requests live in it), the mailbox files and tools (agent-io.js),
// the 'director' project block, and app.director (the CDP surface, README §7.3).
import { rooted } from '../../lib/rooted.svelte.js';
import { draftFor } from '../draft/draft.svelte.js';
import { trackingApi } from '../tracking/api.js';
import { trackingFor } from '../tracking/tracking.svelte.js';
import { createFrames } from '../assist/frames.js';
import * as L from './lib.js';
import { STEP_OF } from './runner.js';
import { directorSteps } from './steps.js';
import { makeMailbox, makeTools } from './agent-io.js';
import { summary, traceMarkdown } from './panel-logic.js';

const DEFAULTS = L.DEFAULT_SETTINGS;
const fresh = () => ({ stats: null, statsError: '', cands: {}, compare: {}, attempts: {}, priors: {}, force: {}, trackers: null });
const pad = (n) => String(n).padStart(2, '0');
const newSession = (d = new Date()) => `dr-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const clone = (x) => JSON.parse(JSON.stringify(x));

class Director {
  settings = $state.raw(clone(DEFAULTS));
  records = $state.raw({});          // decision id -> TraceRecord
  overrides = $state.raw({});        // decision id -> {value, at}
  queue = $state.raw([]);            // DecisionRequests waiting for the user, oldest first
  facts = $state.raw(null);          // FactSheet of this run (memory only)
  session = $state('');
  agentWaiting = $state.raw([]);     // [{id, kind, round, since}]
  agentLast = $state.raw(null);      // {id, at}
  mailboxError = $state('');
  budget = $state.raw(null);         // Settings.budget + used, per run
  tick = $state(0);                  // thumbnails arrived
  startedAt = $state(0);             // Date.now() at the start of the current run
  memo = fresh();
  force = {};                        // id -> brain: the next decision of id goes to that brain only (re-decide)
  extra = {};                        // brains a harness adds over makeBrains (useBrains)
  cache = null;                      // {key, brains}
  seen = new Map();                  // agent request id -> first seen (ms)
  ac = null;
  rerun = null;                      // a step to run from once the current run ends (an answer during a run)

  constructor(app) {
    this.app = app;
    this.draft = draftFor(app);
    this.api = trackingApi(app);
    this.T = trackingFor(app);
    this.service = { call: (req, o) => this.call(req, o) };
    this.mailbox = makeMailbox(this);
    this.tools = makeTools(this);
    this.L = L;
    this.draft.useSteps(directorSteps(app));
    app.registerBlock?.('director', { save: () => this.save(), load: (_, v) => this.load(v) });
    app.director = {
      pending: () => this.pending(),
      answer: (id, a) => this.agentAnswer(id, a),
      sheet: async (id) => {
        const req = this.agentPending().find((r) => r.id === id) || this.queue.find((q) => q.id === id);
        return { images: (req?.evidence || []).filter((e) => e.type === 'image').map((e) => ({ ...(e.path ? { path: e.path } : {}), ...(e.data?.b64 ? { b64: e.data.b64 } : {}), tiles: e.tiles || [] })) };
      },
      trace: () => Object.values(this.records),
      run: (o) => this.run(o),
      cancel: () => this.cancel(),
    };
  }

  // ---- derived ----
  get running() { return this.draft.busy && this.draft.mode === 'director'; }
  get status() {
    const c = this.running ? this.draft.current : null, sc = this.draft.view.find((s) => s.status === 'running')?.progress?.label || '';
    return { step: c?.id ?? null, label: c?.title ?? null, detail: sc, scene: null, waitingAgent: this.agentWaiting.length, waitingUser: this.queue.length };
  }
  /** The brain registry, rebuilt only when what it is made from changes (settings, session, harness brains). */
  get brains() {
    const s = this.settings, key = JSON.stringify([s.vlmModel, s.agentRoot, s.cdp, this.session, Object.keys(this.extra)]);
    if (this.cache?.key !== key) this.cache = { key, brains: { ...L.makeBrains({ vlmModel: s.vlmModel, agentRoot: s.agentRoot, cdp: s.cdp, io: this.app.backend, session: this.session }), ...this.extra } };
    return this.cache.brains;
  }
  agentPending() { return this.brains.agent?.pending?.() ?? []; }
  get ctx() {
    return { signal: this.ac?.signal ?? new AbortController().signal, service: this.service, tools: this.tools, settings: this.settings,
      note: (t) => console.info('[director]', t), now: () => Date.now() };
  }
  get list() { return Object.values(this.records); }
  chainFor(kind) { return L.chainFor(kind, this.settings); }
  runOf(id) { return this.T.run(id); }
  setChannel(id, ch) { this.T.setChannel(id, ch); }
  /** A sidecar request through tracking's job queue (one process at a time; draft's Cancel kills it, owner 'api'). */
  async call(request) {
    if (this.app.backend.sidecarSession) return this.app.backend.sidecarSession(request);   // N1, when it lands
    return this.T.job('director', request, { owner: 'api', task: false });
  }

  // ---- settings, brains ----
  setSettings(patch) {
    this.settings = { ...this.settings, ...patch, ...(patch.budget ? { budget: { ...this.settings.budget, ...patch.budget } } : {}), ...(patch.override ? { override: { ...this.settings.override, ...patch.override } } : {}) };
    this.app.history?.markDirty?.();
  }
  /** Harness / test hook: brains over the registry ones (by chain name). */
  useBrains(map) { this.extra = { ...map }; this.settings = { ...this.settings }; }

  // ---- running ----
  begin({ poll = true } = {}) {
    if (!this.session) this.session = newSession();
    this.memo = fresh();
    this.memo.force = this.force;
    this.budget = { ...this.settings.budget, used: { tracks: 0, gpuS: 0, images: 0 } };
    this.ac = new AbortController();
    this.startedAt = Date.now();
    this.mailbox.session('running');
    // the agent's waiting requests, for the panel and the chip (the agent brain keeps them; poll while running)
    clearInterval(this.poll);
    if (poll) this.poll = setInterval(() => {
      const list = this.agentPending(), now = Date.now();
      for (const r of list) if (!this.seen.has(r.id)) this.seen.set(r.id, now);
      for (const id of [...this.seen.keys()]) if (!list.some((r) => r.id === id)) { this.seen.delete(id); this.agentLast = { id, at: now }; }
      const next = list.map((r) => ({ id: r.id, kind: r.kind, round: r.round, since: this.seen.get(r.id) }));
      if (JSON.stringify(next) !== JSON.stringify(this.agentWaiting)) this.agentWaiting = next;
    }, 500);
  }
  /** Run all (or from a step id: that step, then everything after it that is pending). */
  async run(o = {}) {
    const D = this.draft;
    if (D.busy) { if (o.from) this.rerun = this.earlier(this.rerun, o.from); return; }
    if (!this.app.doc.media) { this.app.toast('Open a video first', 'warn'); return; }
    if (o.preset) this.setSettings({ preset: o.preset });
    if (D.mode !== 'director') D.setMode('director');
    if (D.mode !== 'director') return;
    this.begin();
    try {
      const i = o.from ? D.list.findIndex((s) => s.id === o.from) : -1;
      if (i < 0) { await D.runAll(); return; }
      // a re-run (an answer, a re-decide): from that step to the end, like Run all, but without the hand-off to
      // assist at the end (each answer would open the overlay again); draft's own step runner, one step at a time
      D.cancelled = false; D.batch = true;
      try {
        for (let k = i; k < D.list.length && !D.cancelled; k++) {
          if (D.steps[k].status === 'skipped' && D.steps[k].user) continue;
          if (!(await D.exec(k))) break;
        }
      } finally { D.batch = false; }
    } finally {
      clearInterval(this.poll); this.agentWaiting = []; this.seen.clear();
      if (this.queue.length) this.app.showPanel?.('director');   // questions wait: they beat the review step's tab
      this.mailbox.session(D.cancelled ? 'stopped' : D.complete ? 'done' : 'paused');
      const next = this.rerun;
      this.rerun = null;
      if (next && !D.cancelled) queueMicrotask(() => this.run({ from: next }));
    }
  }
  earlier(a, b) { if (!a) return b; const l = this.draft.list.map((s) => s.id); return l.indexOf(a) <= l.indexOf(b) ? a : b; }
  cancel() { this.rerun = null; this.ac?.abort(); this.draft.cancel(); }

  /** Re-decide: the record is invalidated (kept as `supersedes` of the new one), o.brain forces that brain, then the
   *  draft runs again from the decision's step. */
  async redecide(id, o = {}) {
    const rec = this.records[id];
    if (!rec) return;
    this.records = { ...this.records, [id]: { ...rec, digest: 'redecide' } };
    if (this.overrides[id]) { const { [id]: _, ...rest } = this.overrides; this.overrides = rest; }
    this.queue = this.queue.filter((q) => q.id !== id);
    if (o.brain) this.force[id] = o.brain;
    await this.run({ from: STEP_OF[rec.kind] });
  }
  /** The request of a decision (the queued one, else rebuilt from its record: a reopened project). */
  reqOf(id) {
    const q = this.queue.find((x) => x.id === id);
    if (q) return q;
    const r = this.records[id];
    return r ? { schema: 'pawscript.director/1', id, kind: r.kind, scope: r.scope, attempt: r.attempt || 0, round: 0, maxRounds: this.settings.maxRounds, question: r.question, facts: {}, frames: r.inputs?.frames || [], deps: r.inputs?.deps || [] } : null;
  }
  /** The user's answer: validated, stored as an override (status user), then a re-run from its step. null = ok. */
  answer(id, value) {
    const req = this.reqOf(id);
    if (!req) return 'unknown decision ' + id;
    const err = L.validate(req.kind, value, req);
    if (err) return err;
    this.overrides = { ...this.overrides, [id]: { value, at: Date.now() } };
    this.queue = this.queue.filter((q) => q.id !== id);
    this.app.history?.markDirty?.();
    this.run({ from: STEP_OF[req.kind] });
    return null;
  }
  /** "Can't tell": the provisional answer stays, the decision is marked abstain and leaves the queue. */
  abstain(id) {
    const r = this.records[id];
    this.queue = this.queue.filter((q) => q.id !== id);
    if (r) this.records = { ...this.records, [id]: { ...r, status: 'abstain', provisional: true } };
  }
  /** CDP answer (README §7.3): an agent-routed request, or a user-queued one ({value} = the user's answer). */
  agentAnswer(id, a) {
    if (this.agentPending().some((r) => r.id === id)) return this.brains.agent.answer(id, a);
    if (this.queue.some((q) => q.id === id)) {
      if (a?.value !== undefined) return this.answer(id, a.value);
      if (a?.abstain !== undefined) { this.abstain(id); return null; }
      return 'a queued decision needs {value} or {abstain}';
    }
    return 'not waiting for ' + id;
  }
  pending() { const a = this.agentPending(); return [...a, ...this.queue.filter((q) => !a.some((r) => r.id === q.id))]; }
  onRecords(recs) { this.mailbox.trace(recs); }

  exportTrace() {
    const m = this.app.doc.media || {}, list = this.list;
    return { json: L.toTrace2(m.path || '', list), md: traceMarkdown(m, list, summary) };
  }

  // ---- thumbnails (panel; never persisted) ----
  thumb(ms) {
    const m = this.app.doc.media;
    if (!m?.path || typeof document === 'undefined') return null;
    const url = this.app.backend.mediaUrl?.(m.path) || m.path;
    if (this.frames?.url !== url) { this.frames?.dispose(); this.frames = Object.assign(createFrames({ url, frameMs: 1000 / (m.fps || 30), maxH: 90, max: 120, onFrame: () => this.tick++ }), { url }); }
    const hit = this.frames.peek(ms);
    if (!hit) this.frames.want([ms]);
    return hit;
  }

  // ---- project block ----
  save() {
    if (!Object.keys(this.records).length && !Object.keys(this.overrides).length && JSON.stringify(this.settings) === JSON.stringify(DEFAULTS)) return null;
    return { v: 1, session: this.session, settings: this.settings, records: this.records, overrides: this.overrides, queue: this.queue.map((q) => q.id) };
  }
  load(v) {
    if (this.running) this.cancel();
    this.memo = fresh(); this.force = {}; this.facts = null; this.rerun = null; this.budget = null; this.mailbox.reset();
    const ok = v && typeof v === 'object' && v.v === 1;
    this.settings = ok && v.settings ? { ...clone(DEFAULTS), ...v.settings } : clone(DEFAULTS);
    this.records = ok && v.records && typeof v.records === 'object' ? v.records : {};
    this.overrides = ok && v.overrides && typeof v.overrides === 'object' ? v.overrides : {};
    this.session = ok && typeof v.session === 'string' ? v.session : '';
    this.queue = [];
    this.queue = ok && Array.isArray(v.queue) ? v.queue.map((id) => this.reqOf(id)).filter(Boolean) : [];
  }
}

const stores = new WeakMap();
/** The director of an app (created on first use: registers the 'director' block and draft's director steps). */
export function directorFor(app) {
  let s = stores.get(app);
  if (!s) { s = rooted(() => new Director(app), app); stores.set(app, s); }   // paw-b7da: its own root, never the asking component's
  return s;
}
export const peekDirector = (app) => stores.get(app) || null;
