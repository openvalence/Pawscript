// assist.svelte.js -- the assist store, one per app (assistFor(app); peekAssist(app) never creates, for `when`).
// Holds the queue (model.js), the overlay's state (current question, pair, split mode), the frame loader and the
// answer stack. Every answer is applied at once as ONE undo entry (apply.js) and the decisions are persisted as the
// project block 'assist' (app.doc.project.extra.assist, lib/io setBlock). An answer whose undo entry is undone (Ctrl+Z
// anywhere) no longer counts: its question is open again and its decision is not persisted; redo brings it back.

import { rooted } from '../../lib/rooted.svelte.js';
import { untrack } from 'svelte';
import { buildQueue, contactZone, blockOf, readBlock, splitQuestion, progress, turnList, fmtClock, FALLBACK_CHOICES, RETRACK_CHOICES } from './model.js';
import { applyDirection, applyActivity, applyDepth, applyFallback, choiceFor, orientTo } from './apply.js';
import { suggest } from './learn.js';
import { createFrames, thumbOf } from './frames.js';
import { trackingApi } from '../tracking/api.js';
import { overlayAt } from '../../lib/runs.js';
import { getBlock, setBlock } from '../../lib/io/project.js';
import { slice } from '../../lib/core/script.js';
import { toast, dismissToast } from '../../ui/kit/toast.svelte.js';
import { cssVar } from '../../ui/kit/color.js';
import { scriptOf } from '../../lib/script-of.js';   // paw-x7w7: baked + live

const BLOCK = 'assist';
const PREVIEW = 'assist-preview';   // ghost id; source.kind ends in -preview, so the lanes draw it dashed, on top
const TRACKER_EVENTS = new Set(['still', 'carry', 'idle']);

class Assist {
  open = $state(false);
  questions = $state.raw([]);
  cur = $state(0);                  // index into questions
  pairIdx = $state(0);
  mode = $state('ask');             // 'ask' | 'split' | 'done'
  split = $state.raw(null);         // {cands: [{at, pos}], i} while choosing a split point
  zoom = $state(0);   // index into crops (0 = contact zone / tracker region)
  last = $state.raw(null);          // {text, at} what the previous answer did (shown in the header)
  tick = $state(0);                 // bumped when a frame arrives
  thumbs = $state.raw(new Map());   // question id -> thumbnail (learning)
  metrics = [];                     // [{qid, kind, waitMs, cached}] time from answer key to the next question drawn
  memory = null;                    // the block as loaded at the last regenerate
  seen;                             // the raw block object memory was read from / last written (another one = another document)
  builtOn;                          // the active axis's script the queue was built on
  known = new WeakSet();            // scripts this queue's answers produced (undo / redo land on these): anything else = out of date
  key = '';                         // media | axis | runs | scenes at the last regenerate
  stack = [];                       // answers, for Backspace: [{qid, prev, inserted, entryId}]
  frames = null;
  url = '';
  pressAt = 0;
  savedRange = undefined;

  constructor(app) {
    this.app = app;
    this.api = trackingApi(app);
    this._stop = $effect.root(() => {
      // a new video, a new tracking run or another axis: a fresh queue (answers so far are kept in the block). Another
      // document (open, close, restore: its block is not the one this queue read) also gets a fresh queue, and this
      // queue's answers are never written into it.
      $effect(() => {
        const key = [app.doc.media?.path || '', app.doc.activeAxis, this.api.runs().length, (app.doc.scenes || []).length].join('|');
        const raw = this.rawBlock;
        untrack(() => {
          const other = raw !== this.seen;
          if (key === this.key && !other) return;
          if (other) this.memory = null;
          this.key = key;
          this.regenerate();
        });
      });
      // persist the decisions whenever an answer, undo or redo changes what stands
      $effect(() => { this.questions; app.history.index; untrack(() => this.persist()); });
      // keep the timeline on the current question
      $effect(() => { const q = this.q; this.pairIdx; if (this.open && q && this.mode === 'ask') untrack(() => this.sync(q)); });
    });
  }

  get q() { return this.questions[this.cur] || null; }
  get progress() { return progress(this.questions.map((q) => this.effective(q))); }
  get openCount() { return this.questions.reduce((n, q) => n + (this.stateOf(q) === 'open' ? 1 : 0), 0); }

  // ---- answers that still stand ----
  live(q) {
    const id = q.answer?.entryId;
    if (!id) return true;
    const e = this.app.history.entries.find((x) => x.id === id);
    return !e || e.applied;
  }
  stateOf(q) { return q.state === 'answered' && !this.live(q) ? 'open' : q.state; }
  effective(q) { return this.stateOf(q) === q.state ? q : { ...q, state: 'open', answer: null }; }

  // ---- queue ----
  gather() {
    const app = this.app, all = this.api.runs().filter((r) => r.tag !== 'camera');   // the hidden whole-frame camera reference is never a candidate
    const ghosts = (app.doc.ghosts || []).filter((g) => g.source?.kind === 'tracker' && g.source?.tag !== 'camera' && g.script?.length);
    // runs whose ghost has points, in the model's shape (range, per-scene signs, whether overlays were stored)
    const runs = all.filter((r) => this.ghost(r.id)?.script?.length).map((r) => ({ id: r.id, name: this.ghost(r.id)?.name || r.name, range: r.range,
      scenes: r.scenes, overlays: !!r.frames?.ov?.some(Boolean) }));
    const run = runs.find((r) => r.id === this.api.selectedId()) || runs.at(-1) || null;
    const og = ghosts.filter((g) => g.id !== run?.id).sort((a, b) => /flow|lk/i.test(b.source?.tracker || b.name) - /flow|lk/i.test(a.source?.tracker || a.name))[0] || null;
    const docScenes = app.doc.scenes || [];
    return {
      script: app.script, axis: app.doc.activeAxis, frameMs: app.player.frameMs || 1000 / 30,
      scenes: docScenes.length ? docScenes.map((s) => ({ t0: s.start_ms, t1: s.end_ms })) : run?.scenes?.length ? run.scenes.map(({ t0, t1 }) => ({ t0, t1 })) : [],
      runs, primary: run, primaryScript: this.ghost(run?.id)?.script || null,
      other: og && { id: og.id, name: og.name, script: og.script },
      events: all.flatMap((r) => (r.events || []).filter((e) => TRACKER_EVENTS.has(e.kind) && e.end_ms > e.t_ms).map((e) => ({ t0: e.t_ms, t1: e.end_ms, kind: e.kind }))),
      plan: app.doc.plan, block: this.block, depth: app.settings.get('assist.depth', true),
    };
  }
  ghost(id) { return id ? (this.app.doc.ghosts || []).find((g) => g.id === id) || null : null; }
  /** A run (trackingApi shape) by id; with no id: the one covering the current question, else the selected one. */
  runInfo(id) {
    const runs = this.api.runs().filter((r) => r.tag !== 'camera');
    if (id) return runs.find((r) => r.id === id) || null;
    const q = this.q, ov = (r) => (q ? Math.min(q.t1, r.range.t1) - Math.max(q.t0, r.range.t0) : 0);
    const cover = q ? runs.filter((r) => r.roi && ov(r) > 0).sort((a, b) => ov(b) - ov(a))[0] : null;
    return cover || runs.find((r) => r.id === this.api.selectedId()) || runs.at(-1) || null;
  }
  get rawBlock() { return getBlock({ extra: this.app.doc.project?.extra }, BLOCK); }
  get block() { return readBlock(this.rawBlock); }
  /** The script changed since the queue was built, and not by its answers (an accepted run, hand edits): Regenerate. */
  get stale() {
    this.questions;
    const s = scriptOf(this.app);
    return s !== this.builtOn && !(s && this.known.has(s));
  }

  /** Rebuild the queue from the document (decisions so far are persisted first, so nothing is asked twice). */
  regenerate() {
    this.persist();
    const url = this.app.doc.media?.path ? this.app.backend.mediaUrl?.(this.app.doc.media.path) || this.app.doc.media.path : '';
    if (url !== this.url) {
      this.frames?.dispose();
      this.url = url;
      this.frames = url ? createFrames({ url, frameMs: this.app.player.frameMs || 1000 / 30, onFrame: () => this.tick++ }) : null;
      this.thumbs = new Map();
    }
    const input = this.gather();
    this.memory = input.block;
    this.seen = this.rawBlock;
    this.builtOn = scriptOf(this.app);
    this.known = new WeakSet();
    this.questions = buildQueue(input);
    this.stack = [];
    this.cur = Math.max(0, this.questions.findIndex((q) => q.state === 'open'));
    this.pairIdx = 0;
    this.mode = this.questions.some((q) => q.state === 'open') ? 'ask' : 'done';
    this.split = null;
    if (this.open) this.preload();
  }

  persist() {
    // only into the document this queue was built for (after an open / close the queue is the previous document's)
    if (!this.memory || this.rawBlock !== this.seen) return;
    const app = this.app, next = blockOf(this.memory, this.questions, (q) => this.live(q));
    const cur = this.rawBlock;
    const empty = !next.splits.length && ['direction', 'track', 'activity', 'depth'].every((k) => !next[k].length);
    if (JSON.stringify(readBlock(cur)) === JSON.stringify(next) || (cur == null && empty)) return;
    const p = app.doc.project || { path: null, extra: {} };
    app.doc.project = { ...p, extra: setBlock({ extra: p.extra }, BLOCK, next).extra };
    this.seen = this.rawBlock;
    app.history.markDirty?.();   // not an undo entry, but the project changed: save asks / autosaves
  }

  clearDecisions() {
    const p = this.app.doc.project;
    this.memory = null;
    if (p?.extra && BLOCK in p.extra) { this.app.doc.project = { ...p, extra: setBlock({ extra: p.extra }, BLOCK, undefined).extra }; this.app.history.markDirty?.(); }
    this.seen = this.rawBlock;
    this.questions = [];
    this.regenerate();
  }

  // ---- overlay ----
  show(id) {
    if (!this.questions.length) this.regenerate();
    if (!this.open) { this.savedRange = this.app.doc.range; this.app.player.pause(); }
    this.open = true;
    const i = id ? this.questions.findIndex((q) => q.id === id) : -1;
    if (i >= 0) this.goto(i);
    else if (!this.q || this.stateOf(this.q) !== 'open') this.advance(-1);
    this.preload();
  }
  close() {
    if (!this.open) return;
    this.open = false; this.mode = this.mode === 'split' ? 'ask' : this.mode; this.split = null;
    this.preview(null);
    if (this.savedRange !== undefined) this.app.doc.range = this.savedRange;
    this.savedRange = undefined;
  }
  toggle() { if (this.open) this.close(); else this.show(); }
  goto(i) {
    if (i < 0 || i >= this.questions.length) return;
    this.cur = i; this.pairIdx = 0; this.split = null;
    this.mode = 'ask';
    this.preload();
  }
  /** Next open question after `from` (wrapping); none left -> 'done'. */
  advance(from = this.cur) {
    const n = this.questions.length;
    for (let k = 1; k <= n; k++) {
      const i = (from + k + n) % n;
      if (this.stateOf(this.questions[i]) === 'open') { this.goto(i); return; }
    }
    this.mode = 'done'; this.split = null;
  }
  step(d) { const n = this.questions.length; if (n) this.goto((this.cur + d + n) % n); }

  sync(q) {
    const app = this.app, pad = Math.max(1000, (q.t1 - q.t0) * 0.15);
    app.doc.range = { t0: q.t0, t1: q.t1 };
    const t = q.kind === 'direction' ? q.pairs[this.pairIdx]?.a.at ?? q.t0 : q.times?.[0] ?? q.t0;
    app.player.seek(t);
    const v = app.view;
    if (q.t0 < v.start || q.t1 > v.start + v.span || v.span > 6 * (q.t1 - q.t0 + 2 * pad)) app.setView({ start: q.t0 - pad, span: q.t1 - q.t0 + 2 * pad });
    this.preview(q);
  }
  /** An activity question shows what "yes, it continues" would generate, as a preview ghost on the lane. */
  preview(q) {
    const app = this.app, others = (app.doc.ghosts || []).filter((g) => g.id !== PREVIEW);
    if (!q || q.kind !== 'activity' || this.stateOf(q) !== 'open') { if (others.length !== (app.doc.ghosts || []).length) app.doc.ghosts = others; return; }
    const r = applyActivity(scriptOf(app, q.axis), app.doc.plan, q, 'carry');
    app.doc.ghosts = [...others, { id: PREVIEW, name: 'Assist: if the action continues', color: cssVar('--intent') || '#A78BFA', visible: true,
      script: slice(r.script, q.t0, q.t1), source: { kind: 'assist-preview', range: { t0: q.t0, t1: q.t1 } } }];
  }

  // ---- frames ----
  /** The times a question shows (first pair first). */
  timesOf(q, pairs = 2) {
    if (!q) return [];
    if (q.kind === 'direction') return q.pairs.slice(0, pairs).flatMap((p) => [p.a.at, p.b.at]);
    if (q.kind === 'depth') return [this.deepestAt(q)];
    return q.times || [];
  }
  /** The deepest turning point the script has in the span NOW (an earlier answer may have flipped it). */
  deepestAt(q) {
    const T = turnList(scriptOf(this.app, q.axis), q.t0, q.t1);
    return T.length ? T.reduce((m, x) => (x.pos < m.pos ? x : m)).at : q.times[0];
  }
  preload() {
    const f = this.frames;
    if (!f) return;
    const q = this.q;
    f.want(this.timesOf(q, 1), { front: true });
    f.want(this.timesOf(q, 2).slice(2));
    let n = 0;
    for (let k = 1; k < this.questions.length && n < 6; k++) {
      const x = this.questions[(this.cur + k) % this.questions.length];
      if (this.stateOf(x) !== 'open') continue;
      f.want(this.timesOf(x, n < 3 ? 2 : 1)); n++;
    }
    if (q?.kind === 'direction') f.get(q.pairs[0].a.at).then((b) => this.noteThumb(q.id, b));
  }
  noteThumb(id, bmp) { if (bmp && !this.thumbs.has(id)) { const t = thumbOf(bmp); if (t) this.thumbs = new Map(this.thumbs).set(id, t); } }
  /** Crops Z cycles through: [name, box|null]. Direction / depth: the contact zone first, then the tracker region, then the whole frame. */
  get crops() {
    const q = this.q, out = [], roi = this.trackerRoi;
    if (q?.kind === 'direction' || q?.kind === 'depth') {
      const ov = (s) => Math.min(q.t1, s.end_ms) - Math.max(q.t0, s.start_ms);
      const sc = (this.app.doc.scenes || []).filter((s) => ov(s) > 0).sort((a, b) => ov(b) - ov(a))[0];
      const cz = contactZone(sc?.describe?.tags);
      if (cz) out.push(['contact zone', cz]);
      if (roi && (!cz || cz.x !== roi.x || cz.y !== roi.y || cz.w !== roi.w || cz.h !== roi.h)) out.push(['tracker region', roi]);
    } else if (roi) out.push(['tracker region', roi]);
    return out.length ? [...out, ['whole frame', null]] : [];
  }
  /** What the frames are cropped to now (normalised box or null) and its name. */
  get crop() { const c = this.crops; return c.length ? c[this.zoom % c.length] : null; }
  /** Region to zoom to (normalised): the run's ROI, padded, or null. */
  get trackerRoi() {
    const r = this.q?.kind === 'track' ? this.runInfo(this.q.ghost) : this.runInfo();
    const roi = r?.roi;
    if (!roi) return null;
    let [x0, y0, x1, y1] = roi.kind === 'box' ? [roi.x, roi.y, roi.x + roi.w, roi.y + roi.h]
      : [Math.min(...roi.points.map((p) => p[0])), Math.min(...roi.points.map((p) => p[1])), Math.max(...roi.points.map((p) => p[0])), Math.max(...roi.points.map((p) => p[1]))];
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = Math.max(0.35, (x1 - x0) * 2), h = Math.max(0.35, (y1 - y0) * 2);
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }
  overlay(ghostId, t) { const r = this.runInfo(ghostId); return r ? overlayAt(r.frames, t, 2 * (this.app.player.frameMs || 34)) : null; }

  // ---- learning ----
  get samples() {
    return this.questions.filter((q) => q.kind === 'direction' && q.state === 'answered' && !q.memory && q.answer?.fact && this.live(q))
      .map((q) => ({ flip: q.answer.flipped, cues: q.cues, thumb: this.thumbs.get(q.id) || null, label: q.label }));
  }
  /** Suggestion for the current question: {choice, reason} or null (never applied without Enter). */
  get suggestion() {
    const q = this.q;
    if (!q || q.kind !== 'direction' || this.stateOf(q) !== 'open' || this.mode !== 'ask') return null;
    const s = q.suggest || suggest(q, this.samples, this.thumbs.get(q.id) || null);
    return s && { choice: choiceFor(scriptOf(this.app, q.axis), q, this.pairIdx, s.flip), reason: s.reason, flip: s.flip };
  }

  // ---- keys ----
  /** One key from the overlay (commands.js). Returns true if it did something. */
  press(key) {
    if (!this.open) return false;
    this.pressAt = performance.now();
    const q = this.q;
    if (key === 'Escape') { if (this.mode === 'split') { this.mode = 'ask'; this.split = null; } else this.close(); return true; }
    if (key === 'Backspace') { if (this.mode === 'split') { this.mode = 'ask'; this.split = null; } else this.back(); return true; }
    if (this.mode === 'split') return this.splitKey(key);
    if (this.mode === 'done') { if (key === 'Enter') this.close(); return true; }
    if (!q) return false;
    if (key === 'Tab' || key === 'Shift+Tab') { if (q.kind === 'direction' && q.pairs.length > 1) this.pairIdx = (this.pairIdx + (key === 'Tab' ? 1 : q.pairs.length - 1)) % q.pairs.length; this.preload(); return true; }
    if (key === 'Z') { this.zoom = (this.zoom + 1) % Math.max(1, this.crops.length); return true; }
    if (key === 'ArrowUp' || key === 'PageUp') { this.step(-1); return true; }
    if (key === 'PageDown') { this.step(1); return true; }
    if (key === 'Enter') { const s = this.suggestion; if (s) return this.answer(s.choice); return false; }
    const c = q.choices.find((x) => x.key === key || x.alt === key);
    return c ? this.answer(c.id) : false;
  }

  /** Apply choice `id` to the current question. */
  answer(id) {
    const app = this.app, q = this.q;
    if (!q) return false;
    const before = app.history.index;
    const entry = () => (app.history.index > before ? app.history.entries[app.history.index - 1]?.id ?? null : null);
    const script = scriptOf(app, q.axis);
    let answer = { choice: id }, state = 'answered', inserted = [], text = '';
    if (id === 'skip') { state = 'skipped'; text = `Skipped ${q.label}`; }
    else if (id === 'split') { this.enterSplit(); return true; }
    else if (q.kind === 'direction') {
      const r = applyDirection(script, q, id, this.pairIdx);
      if (r.flipped) app.edit(`Assist: flip ${q.label}`, q.axis, r.script);
      answer = { choice: id, pair: this.pairIdx, fact: r.fact, flipped: r.flipped };
      text = r.flipped ? `Flipped ${q.label}` : `${q.label} was already right`;
    } else if (q.kind === 'track') {
      if (id === 'no') inserted = [this.fallbackOf(q)];   // use the other run here, or re-track
      text = id === 'yes' ? `Track ok for ${q.label}` : `Track rejected for ${q.label}`;
    } else if (q.kind === 'fallback') {
      const g = this.ghost(q.other);
      if (id === 'use' && g) { app.edit(`Assist: use ${g.name} for ${q.label}`, q.axis, applyFallback(script, g.script, q.t0, q.t1)); text = `Used ${g.name} for ${q.label}`; }
      if (id === 'retrack') return this.retrack(q);
      if (id === 'keep') text = `Kept ${q.label}`;
    } else if (q.kind === 'activity') {
      const r = applyActivity(script, app.doc.plan, q, id, { maxSpeed: app.settings.get('gen.maxSpeed', 450) });
      app.transact(`Assist: ${id} ${q.label}`, () => { app.edit(`Assist: ${id} ${q.label}`, q.axis, r.script); app.doc.plan = r.plan; });
      text = `${id === 'carry' ? 'Carried the rhythm' : id === 'idle' ? 'Held still' : 'Climax'} ${q.label}`;
    } else if (q.kind === 'depth') {
      const next = applyDepth(script, q, id);
      if (next !== script) app.edit(`Assist: depth ${q.label}`, q.axis, next);
      text = `Depth ${id} for ${q.label}`;
    }
    answer.entryId = entry();
    if (answer.entryId) this.known.add(scriptOf(app, q.axis));
    this.stack.push({ qid: q.id, prev: { state: q.state, answer: q.answer }, inserted: inserted.map((x) => x.id), entryId: answer.entryId });
    const qs = this.questions.map((x) => (x === q ? { ...x, state, answer } : x));
    qs.splice(this.cur + 1, 0, ...inserted);
    this.questions = qs;
    this.last = { text, undo: !!answer.entryId };
    if (answer.entryId) {   // one toast, replaced by the next answer's
      if (this.toastId) dismissToast(this.toastId);
      this.toastId = toast(text, { kind: 'ok', timeout: 2500, action: { label: 'Undo', run: () => app.undo() } });
    }
    this.advance();
    return true;
  }

  /** After "no, wrong thing": use the other run here (if there is one), re-track with a new ROI, or keep. */
  fallbackOf(q) {
    const g = q.other ? this.ghost(q.other) : null;
    return { id: `fallback:${q.ghost}:${q.t0}-${q.t1}`, kind: 'fallback', t0: q.t0, t1: q.t1, axis: q.axis, label: q.label, ghost: q.ghost, other: g ? q.other : null,
      prompt: g ? `Use ${g.name} here instead?` : 'Re-track this span with a new region?', choices: g ? FALLBACK_CHOICES : RETRACK_CHOICES,
      times: q.times.slice(0, 3), evidence: {}, value: q.value, state: 'open', answer: null };
  }
  retrack(q) {
    const app = this.app;
    this.stack.push({ qid: q.id, prev: { state: q.state, answer: q.answer }, inserted: [], entryId: null });
    this.questions = this.questions.map((x) => (x === q ? { ...x, state: 'answered', answer: { choice: 'retrack' } } : x));
    this.close();
    app.doc.range = { t0: q.t0, t1: q.t1 };
    app.setMode('track');
    app.player.seek(q.t0);
    app.toast(`Paint the part for ${q.label} with Groups (${app.commands.keysFor?.('tracking.groups')?.[0] || 'Tab'}), then press ${app.commands.keysFor?.('track.run')?.[0] || 'Ctrl+T'} (Track ROI)`, 'info');
    return true;
  }

  /** Backspace: undo the last answer (its edit too, if nothing was edited since) and go back to its question. */
  back() {
    const e = this.stack.pop(), app = this.app;
    if (!e) { app.toast('Nothing to take back', 'quiet'); return false; }
    if (e.entryId) {
      const top = app.history.entries[app.history.index - 1];
      if (top?.id === e.entryId) app.undo();
      else if (app.history.entries.find((x) => x.id === e.entryId)?.applied) app.toast('Other edits came after that answer: undo them from History', 'warn');
    }
    const drop = new Set(e.inserted);
    const qs = this.questions.filter((x) => !drop.has(x.id)).map((x) => (x.id === e.qid ? { ...x, ...e.prev } : x));
    this.questions = qs;
    this.last = { text: 'Took back the last answer' };
    this.goto(qs.findIndex((x) => x.id === e.qid));
    return true;
  }

  // ---- split ----
  enterSplit() {
    const q = this.q, script = scriptOf(this.app, q.axis);
    const cands = turnList(script, q.t0, q.t1).filter((x) => x.kind === 'bottom');
    if (cands.length < 2) { this.app.toast('Too few strokes to split here', 'quiet'); return; }
    const want = q.evidence?.presplit ?? (q.t0 + q.t1) / 2;
    let i = 1;
    for (let k = 1; k < cands.length; k++) if (Math.abs(cands[k].at - want) < Math.abs(cands[i].at - want)) i = k;
    this.split = { cands, i };
    this.mode = 'split';
    this.frames?.want(cands.map((c) => c.at), { front: true });
    this.app.player.seek(cands[i].at);
  }
  splitKey(key) {
    const s = this.split, n = s.cands.length;
    const move = { ArrowLeft: -1, ArrowRight: 1, 'Shift+ArrowLeft': -5, 'Shift+ArrowRight': 5, Home: -n, End: n }[key];
    if (move) { const i = Math.max(1, Math.min(n - 1, s.i + move)); this.split = { ...s, i }; this.app.player.seek(s.cands[i].at); return true; }
    if (key === 'Enter' || key === 'S') return this.doSplit();
    return true;
  }
  /** Split the current question just before the selected candidate: both halves get their own question. */
  doSplit(i = this.split?.i) {
    const q = this.q, s = this.split;
    if (!q || !s || i < 1) return false;
    const script = scriptOf(this.app, q.axis);
    const prevTurn = turnList(script, q.t0, s.cands[i].at).at(-1);
    const at = Math.round(((prevTurn?.at ?? s.cands[i - 1].at) + s.cands[i].at) / 2);
    const halves = splitQuestion(q, at, script, this.app.player.frameMs || 1000 / 30);
    this.stack.push({ qid: q.id, prev: { state: q.state, answer: q.answer }, inserted: halves.map((h) => h.id), entryId: null });
    const qs = this.questions.map((x) => (x === q ? { ...x, state: 'split', answer: { choice: 'split', at } } : x));
    qs.splice(this.cur + 1, 0, ...halves.filter((h) => !qs.some((x) => x.id === h.id)));
    this.questions = qs;
    this.last = { text: `Split ${q.label} at ${fmtClock(at)}` };
    this.split = null; this.mode = 'ask';
    this.advance();
    return true;
  }

  // ---- whole-document commands ----
  /** Every recorded direction the active axis disagrees with: inverted, one undo entry. */
  reapply() {
    const app = this.app, b = blockOf(this.memory, this.questions, (q) => this.live(q));
    const r = orientTo(app.script, b.direction);
    if (!r.spans.length) { app.toast('The active axis already agrees with every recorded direction', 'quiet'); return 0; }
    app.edit('Assist: apply recorded directions', app.doc.activeAxis, r.script);
    app.toast(`Flipped ${r.spans.length} span${r.spans.length === 1 ? '' : 's'} to match your answers`, 'ok', { action: { label: 'Undo', run: () => app.undo() } });
    return r.spans.length;
  }
  /** The same for every tracker ghost (ghosts are not undoable; they are read-only overlays). */
  orientGhosts() {
    const app = this.app, b = blockOf(this.memory, this.questions, (q) => this.live(q));
    let n = 0;
    app.doc.ghosts = (app.doc.ghosts || []).map((g) => {
      if (g.source?.kind !== 'tracker' || !g.script?.length) return g;
      const r = orientTo(g.script, b.direction);
      n += r.spans.length;
      return r.spans.length ? { ...g, script: r.script } : g;
    });
    app.toast(n ? `Oriented ${n} ghost span${n === 1 ? '' : 's'}` : 'Ghosts already agree with your answers', n ? 'ok' : 'quiet');
    return n;
  }

  destroy() { this._stop?.(); this.frames?.dispose(); }
}

const stores = new WeakMap();
/** The assist store of an app (created on first use). */
export function assistFor(app) {
  let s = stores.get(app);
  if (!s) { s = rooted(() => new Assist(app), app); stores.set(app, s); }   // paw-b7da: its own root, never the asking component's
  return s;
}
/** The store if it exists (never creates: for command `when`). */
export const peekAssist = (app) => stores.get(app) || null;
