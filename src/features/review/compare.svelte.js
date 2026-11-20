// Compare state: active axis vs a ghost. Instant in-browser numbers (analyze `compare`) plus, when the sidecar is
// there, the full `score` result with its per-scene breakdown. Difference markers go to reviewMarkers.diff.
import { rooted } from '../../lib/rooted.svelte.js';
import { untrack } from 'svelte';
import { compare } from '../../lib/analyze/index.js';
import { scoreRequest } from '../../lib/protocol.js';
import { replaceRange, slice } from '../../lib/core/script.js';
import { shapeScore, shapeScenes, disagreements, mismatches, compareAsText } from './logic/compare.js';
import { reviewMarkers } from './markers.svelte.js';
import { trackingApi } from '../tracking/api.js';

const MAX_MARKERS = 400, instances = new WeakMap();
export const getCompare = (app, review) => { let c = instances.get(app); if (!c) { c = rooted(() => new Compare(app, review), app); instances.set(app, c); } return c; };   // paw-b7da: its own root

class Compare {
  ghostId = $state(null);
  scope = $state('all');                // 'all' | 'range' (no chapters: paw-1w0x)
  quick = $state.raw(null);             // analyze compare() result
  regions = $state.raw([]);             // worst-disagreement windows [{t0,t1,err,peak}]
  misses = $state.raw([]);              // unmatched turning points [{id,at,t0,t1,what}]
  score = $state.raw(null);             // sidecar { overall, scenes }
  scoreErr = $state('');
  scoreBusy = $state(false);
  busy = $state(false);
  #app; #timer = 0; #refs = 0; #stop;

  constructor(app) {
    this.#app = app;
    this.#stop = $effect.root(() => {
      $effect(() => {                   // recompute (debounced) while a compare view is mounted
        const g = this.ghost, s = app.script, r = this.window;
        void g?.script; void s; void r;
        if (!this.#refs) return;
        untrack(() => this.schedule());
      });
    });
  }

  /** Panels call mount() / unmount() so nothing is computed while no compare view is open. */
  mount() { this.#refs++; this.schedule(true); return () => { this.#refs = Math.max(0, this.#refs - 1); }; }

  get ghosts() { return this.#app.doc.ghosts; }
  get ghost() { const gs = this.ghosts; return gs.find((g) => g.id === this.ghostId) ?? gs[0] ?? null; }
  /** [t0,t1] the comparison covers. */
  get window() {
    const app = this.#app, s = app.script, g = this.ghost, d = app.doc;
    const lo = Math.min(s[0]?.at ?? Infinity, g?.script?.[0]?.at ?? Infinity), hi = Math.max(s.at(-1)?.at ?? 0, g?.script?.at(-1)?.at ?? 0);
    if (this.scope === 'range' && d.range) return [d.range.t0, d.range.t1];
    return [Number.isFinite(lo) ? lo : 0, hi];
  }

  schedule(now = false) {
    clearTimeout(this.#timer);
    if (now) return this.run();
    this.busy = true;
    this.#timer = setTimeout(() => this.run(), 220);
  }
  run() {
    clearTimeout(this.#timer);
    const g = this.ghost, s = this.#app.script;
    if (!g?.script?.length || !s.length) { this.quick = null; this.regions = []; this.misses = []; this.busy = false; this.#publish(); return; }
    const [t0, t1] = this.window;
    const q = compare(s, g.script, { t0, t1 });
    this.quick = q;
    this.misses = mismatches(q);
    this.regions = disagreements(s, g.script, t0, t1);
    this.busy = false;
    this.#publish();
  }
  #publish() {
    const diff = [...this.misses.map((m) => ({ id: m.id, t0: m.t0, t1: m.t1, what: m.what })), ...this.regions.map((r) => ({ id: `differs@${r.t0}`, t0: r.t0, t1: r.t1, what: 'differs' }))]
      .sort((a, b) => a.t0 - b.t0).slice(0, MAX_MARKERS);
    reviewMarkers.set({ diff });
  }
  clearMarkers() { reviewMarkers.set({ diff: [] }); }

  get rows() { return shapeScore(this.quick); }
  get scoreRows() { return shapeScore(this.score?.overall); }
  get scenes() { return shapeScenes(this.score?.scenes); }
  /** Sidecar available: Tauri host, or a backend that provides `score` (tests, the dev harness). */
  get sidecarReady() { return !!this.#app.backend?.score || (!!this.#app.backend?.isTauri && !!this.#app.backend?.sidecar && this.#app.sidecar !== 'off'); }

  async runScore() {
    const app = this.#app, g = this.ghost, s = app.script;
    if (!g?.script?.length || !s.length || this.scoreBusy) return;
    const [t0, t1] = this.window;
    const req = scoreRequest({ candidate: s, reference: g.script, start_ms: t0, end_ms: t1, fps: app.doc.media?.fps });
    this.scoreBusy = true; this.scoreErr = ''; this.score = null;
    const task = app.task('Scoring against reference');
    try {
      let res;
      // the app: through tracking's job queue (one sidecar process at a time, a dying one is waited for)
      res = app.backend.isTauri ? await trackingApi(app).score(req) : app.backend.score ? await app.backend.score(req) : await app.backend.sidecar(req);
      const r = res?.result ?? res;
      if (res?.error || !r?.overall) this.scoreErr = res?.error || 'The sidecar returned no score';
      else this.score = { overall: r.overall, scenes: r.scenes ?? [] };
    } catch (e) { this.scoreErr = String(e?.message || e); }
    finally { task.end(); this.scoreBusy = false; }
  }

  /** Take the ghost's content over [t0,t1] into the script: a direct replace (one undo step). (There is no Accept any more:
   *  paw-sl5a dropped the lookup of a track(ing).accept command, gone since 2e31f7a.) */
  adopt(t0, t1) {
    const app = this.#app, g = this.ghost;
    if (!g?.script) return false;
    const s = app.script;
    app.edit('Adopt from ghost', app.doc.activeAxis, replaceRange(s, t0, t1, slice(g.script, t0, t1)));
    app.toast(`Adopted ${g.name} over ${((t1 - t0) / 1000).toFixed(1)} s`, 'ok');
    return true;
  }
  asText() { return compareAsText(`${this.#app.doc.activeAxis} vs ${this.ghost?.name ?? ''}`, this.score ? this.scoreRows : this.rows, this.scenes); }
  destroy() { this.#stop?.(); clearTimeout(this.#timer); }
}
