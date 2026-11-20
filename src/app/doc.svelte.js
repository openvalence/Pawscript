// doc.svelte.js -- the document store. Every field is $state.raw and holds an immutable value: replace, never
// mutate (doc.chapters = [...doc.chapters, c]). That is what lets history diff by identity and keeps 100k-action
// scripts out of Svelte's deep proxies.
//
// Undoable (go through app.edit / app.transact): axes.<id>, chapters, bookmarks, loops, plan, graphs, scenes, fx, finish,
// repeats, acts, runRanges, bakedEmpty.
// Not undoable: activeAxis, selection (restored with each undo step), range, ghosts, media.

import { normScenes } from '../features/timeline/shots.js';
import { normActs, projectScenes, syncActs, withCarried, withPositioning } from '../features/timeline/regions.js';

export const UNDOABLE = ['chapters', 'bookmarks', 'loops', 'plan', 'graphs', 'scenes', 'fx', 'finish', 'repeats', 'acts', 'runRanges', 'bakedEmpty'];
export const EMPTY = (k) => (k === 'finish' || k === 'repeats' || k === 'runRanges' ? null : []);   // finish / repeats are objects (or null), runRanges a list or null (a project before ranges), the rest lists

export class Doc {
  axes = $state.raw({});                        // { [axisId]: Script }
  activeAxis = $state('stroke');
  selection = $state.raw({ axis: 'stroke', ats: new Set() });
  range = $state.raw(null);                     // { t0, t1 } | null
  chapters = $state.raw([]);                    // [{ id, t0, t1, name, color }]
  bookmarks = $state.raw([]);                   // [{ id, at, note }]
  loops = $state.raw([]);                       // [{ id, t0, t1, tiledTo? }]
  plan = $state.raw([]);                        // [{ id, t0, t1, kind, recipe, params }]
  // the shots [{ start_ms, end_ms, join?, sign?, loop?, describe?, kind?, ... }] (sidecar shape; tracking detects, timeline
  // edits). A scene = a run of joined shots; every write goes through features/timeline/shots.js normScenes, so a writer
  // may change one shot's scene facts (tags, groups, fill) and the whole scene follows
  // paw-2lp7.2: and the regions (features/timeline/regions.js) hold the act facts (act tags, join, range, tease): a write of the
  // shots syncs the regions from what was written (syncActs), a write of the regions projects them onto the shots
  #scenes = $state.raw([]);
  get scenes() { return this.#scenes; }
  // paw-2lp7.4: and a cutaway under an action region is `carried` (regions.js withCarried), on either write
  // paw-2lp7.1: and each shot carries the positioning ranges over it (regions.js withPositioning), on either write
  set scenes(v) { const r = syncActs(normScenes(v || [], this.#scenes), this.#acts); this.#acts = r.acts; this.#scenes = withPositioning(withCarried(r.scenes, r.acts), r.acts); }
  // the action regions [{ id, kind, t0, t1, layer, tags, mix?, range?, tease? }] (stage 1: nothing draws them yet)
  #acts = $state.raw([]);
  get acts() { return this.#acts; }
  set acts(v) { this.#acts = normActs(v || []); this.#scenes = withPositioning(withCarried(projectScenes(this.#scenes, this.#acts), this.#acts), this.#acts); }
  fx = $state.raw([]);                          // the modifiers [{ id, kind, t0, t1, params?, muted?, label? }] (lib/fx.js; the timeline's Modifiers row)
  // the finishing stack's settings (lib/finish.js): {autorange (the live pass on), strength, policy, applied?} | null
  finish = $state.raw(null);
  // repeated frames (features/timeline/repeats.svelte.js): {loops: {[loop key]: bucket id}}, the frame picked per loop | null
  repeats = $state.raw(null);
  // paw-1ysd: which run plays where [{id, run, t0, t1, layer}] (lib/run-ranges.js) | null (a project before ranges: derived from the links)
  runRanges = $state.raw(null);
  // paw-q8jh: live pieces baked with no points left in them [{axis, t0, t1}] (lib/script-of.js): nothing plays there
  bakedEmpty = $state.raw([]);
  graphs = $state.raw([]);                      // node graphs (features/graph; persisted as the .pawproj 'graphs' block)
  ghosts = $state.raw([]);                      // [{ id, name, color, script, visible, source, pinned? }]
  media = $state.raw(null);                     // { path, name, durationMs, fps, isVfr, width, height } | null
  dirty = $state(false);
  // files this document came from / saves to, per axis: { [axisId]: { path, foreign, raw } } (shell-private)
  files = $state.raw({});
  project = $state.raw(null);                   // { path } of the .pawproj, when saved as one

  /** Every undoable value, flat, for history. */
  read() {
    const o = {};
    for (const [k, v] of Object.entries(this.axes)) o['axes.' + k] = v;
    for (const k of UNDOABLE) o[k] = this[k];
    return o;
  }
  write(path, value) {
    if (path.startsWith('axes.')) {
      const id = path.slice(5), next = { ...this.axes };
      if (value === undefined) delete next[id]; else next[id] = value;
      this.axes = next;
    } else if (path === 'scenes') this.#scenes = value ?? [];   // history restores a pair that was in sync: as it was
    else if (path === 'acts') this.#acts = value ?? [];
    else if (UNDOABLE.includes(path)) this[path] = value ?? EMPTY(path);
  }
  readSel() { return { selection: this.selection, activeAxis: this.activeAxis }; }
  writeSel(s) { if (s) { this.selection = s.selection; this.activeAxis = s.activeAxis; } }

  /** Replace everything (open / new / recover). */
  load(d = {}) {
    this.axes = d.axes || {};
    this.activeAxis = d.activeAxis || (this.axes.stroke || !Object.keys(this.axes).length ? 'stroke' : Object.keys(this.axes)[0]);
    this.selection = { axis: this.activeAxis, ats: new Set() };
    this.range = d.range || null;
    this.#scenes = [];   // a new document: nothing to tell an edit from
    this.#acts = [];
    // without saved regions the scenes make them (regions.js actsFromScenes: what syncActs does from none)
    for (const k of UNDOABLE) if (k !== 'acts' || d.acts) this[k] = d[k] || EMPTY(k);
    this.ghosts = d.ghosts || [];
    this.media = d.media || null;
    this.files = d.files || {};
    this.project = d.project || null;
  }
}
