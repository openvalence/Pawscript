// Source nodes (contract §7, DESIGN §7 "Sources"): document values in, typed values out. Every source declares
// `reads`, so it recomputes only when the document value it reads changes identity. Sources emit complete span
// lists in every run (cheap), so span-consuming nodes downstream may be local.

import { defineNode } from '../model.js';
import { normalize } from '../../core/script.js';
import { normSpans, atsToSpans, clipScript, sampleScript, resampleSeries, makeSignal } from '../types.js';
import { num, text, json, choice, script, signal, spans, number, points, genSignal, onGrid } from './util.js';
import { directionOf, signAt } from '../../polarity.js';

const G = 'Sources';
const clipIfWindow = (s, ctx) => (ctx.window ? clipScript(s, ctx.range.t0, ctx.range.t1) : s);

export const axis = defineNode({
  type: 'src.axis', title: 'Axis', group: G, icon: 'axis',
  aliases: ['stroke', 'roll', 'pitch', 'twist', 'script', 'current'],
  help: 'The current script of an axis. Feeding it to an output of the same axis is allowed ("polish my script") and warned about.',
  ins: [], outs: [script()],
  params: [text('axis', 'Axis', 'stroke', { editor: 'axis' })],
  reads: (p) => [['axis', p.axis]],
  halo: () => 0, local: true,
  eval(_in, p, ctx) {
    const s = ctx.read('axis', p.axis);
    if (s === undefined) { ctx.info(`axis "${p.axis}" has no script yet`); return { script: [] }; }
    return { script: clipIfWindow(s, ctx) };
  },
});

export const ghost = defineNode({
  type: 'src.ghost', title: 'Ghost', group: G, icon: 'ghost',
  aliases: ['tracker', 'reference', 'overlay', 'run'],
  help: 'A ghost overlay (tracker result, reference) as a script. Binds by id, then by name. The graph never sees its own preview ghosts.',
  ins: [], outs: [script()],
  params: [text('ghost', 'Ghost', '', { editor: 'ghost' })],
  reads: (p) => [['ghost', p.ghost]],
  halo: () => 0, local: true,
  eval(_in, p, ctx) {
    if (!p.ghost) throw new Error('pick a ghost');
    const g = ctx.read('ghost', p.ghost);
    if (!g) throw new Error(`ghost not found: "${p.ghost}"`);
    const s = Array.isArray(g.script) ? g.script : [];
    return { script: clipIfWindow(s, ctx) };
  },
});

// Confidence for a signal with no recorded confidence: 1 wherever the signal is known, NaN elsewhere. Used by both
// the no-confidence-channel run and the missing-run ghost fallback (an all-NaN confidence would blank every blend).
const knownConfidence = (sig, grid, ctx) => {
  const sv = onGrid(sig, grid);
  return genSignal(ctx, (k) => (sv[k] === sv[k] ? 1 : NaN), [0, 1]);
};

/** [a, b) cut at the run's flipped stretches (paw-57ve; paw-vtec: its direction map's partial part, sorted, apart) -> [[t0, t1, flipped]]. */
const pieces = (a, b, fl) => {
  const out = [];
  let x = a;
  for (const [u, v] of fl || []) { if (v <= x || u >= b) continue; if (u > x) out.push([x, u, false]); out.push([Math.max(x, u), Math.min(b, v), true]); x = Math.min(b, v); }
  if (b > x) out.push([x, b, false]);
  return out;
};

export const run = defineNode({
  type: 'src.run', title: 'Tracker run', group: G, icon: 'crosshair',
  aliases: ['tracker', 'signal', 'confidence', 'channel', 'events', 'scenes', 'samples'],
  help: 'A tracking run: its signal (primary ×100 in pos units, or a named channel), confidence 0..1, points, events and scenes (value = sign). Runs are session-only: a missing run falls back to the ghost with the same id.',
  ins: [],
  outs: [signal('signal'), signal('confidence'), script('points'), spans('events'), spans('scenes')],
  params: [
    text('run', 'Run', '', { editor: 'run' }),
    text('channel', 'Channel', 'primary', { editor: 'channel' }),
    choice('channelScale', 'Channel scale', 'fit', ['fit', 'raw'], { hint: 'fit: its own min..max onto 0..100, raw: as recorded' }),
    num('maxGapMs', 'Max sample gap', 100, 0, 5000, 10, { unit: 'ms', hint: 'longer gaps between tracker samples become NaN (unknown)' }),
  ],
  reads: (p) => [['run', p.run], ['ghost', p.run]],
  halo: () => 0, local: true,
  eval(_in, p, ctx) {
    if (!p.run) throw new Error('pick a run');
    const r = ctx.read('run', p.run), grid = ctx.grid();
    const gap = p.maxGapMs > 0 ? p.maxGapMs : Infinity;
    if (!r) {
      const g = ctx.read('ghost', p.run);
      if (!g) throw new Error(`run not found: "${p.run}" (runs are not saved across reloads)`);
      ctx.warn(`run "${p.run}" is gone; reading its ghost instead (confidence 1 where known, no events or scenes)`, undefined, 'source-missing');
      const s = Array.isArray(g.script) ? g.script : [];
      const sig = sampleScript(s, grid);
      return { signal: sig, confidence: knownConfidence(sig, grid, ctx), points: clipIfWindow(s, ctx), events: [], scenes: [] };
    }
    let sig;
    const ch = p.channel && p.channel !== 'primary' ? r.channels?.[p.channel] : null;
    if (p.channel && p.channel !== 'primary' && !ch) throw new Error(`run "${p.run}" has no channel "${p.channel}"`);
    if (ch) {
      const span = ch.max - ch.min || 1;
      sig = p.channelScale === 'raw'
        ? resampleSeries(ch.t, ch.v, grid, { maxGapMs: gap })
        : resampleSeries(ch.t, ch.v, grid, { maxGapMs: gap, scale: 100 / span, offset: (-100 * ch.min) / span });
      if (p.channelScale === 'raw') sig.range = [ch.min, ch.max];
    } else {
      sig = resampleSeries(r.samples?.t ?? [], r.samples?.v ?? [], grid, { maxGapMs: gap, scale: 100 });
    }
    let conf;
    if (r.confidence?.t?.length) { conf = resampleSeries(r.confidence.t, r.confidence.v, grid, { maxGapMs: gap }); conf.range = [0, 1]; }
    else {
      conf = knownConfidence(sig, grid, ctx);
      ctx.info('this run has no confidence channel: confidence is 1 wherever the signal is known');
    }
    const at = r.points?.at ?? [], pos = r.points?.pos ?? [];
    const pts = normalize(Array.from(at, (t, i) => ({ at: t, pos: pos[i] })));
    const events = normSpans((r.events || []).map((e) => ({ t0: e.t_ms, t1: e.end_ms ?? e.t_ms, kind: e.kind, label: e.label || e.kind })));
    const dir = r.dir || directionOf(r, r.flipSpans);
    const scenes = normSpans((r.scenes || []).flatMap((s) => pieces(s.start_ms, s.end_ms, dir.partial).map(([t0, t1]) => { const v = signAt({ ...r, dir }, (t0 + t1) / 2); return { t0, t1, kind: 'scene', value: v, label: v < 0 ? 'flipped' : 'scene' }; })));
    return { signal: sig, confidence: conf, points: clipIfWindow(pts, ctx), events, scenes };
  },
  summary: ({ signal: s, points: pts }) => (s ? `${s.v.length} smp · ${pts?.length ?? 0} pts` : '—'),
});

export const plan = defineNode({
  type: 'src.plan', title: 'Plan segments', group: G, icon: 'layers',
  aliases: ['segments', 'kinds', 'plan lane', 'structure'],
  help: 'The plan lane as spans: kind = segment kind, data = {id, recipe, params, intensity}.',
  ins: [], outs: [spans()],
  params: [json('kinds', 'Only kinds', [], { editor: 'kinds' })],
  reads: () => [['plan']],
  halo: () => 0, local: true,
  eval(_in, p, ctx) {
    const keep = Array.isArray(p.kinds) && p.kinds.length ? new Set(p.kinds) : null;
    const segs = (ctx.read('plan') || []).filter((s) => !keep || keep.has(s.kind));
    return { spans: normSpans(segs.map((s) => ({ t0: s.t0, t1: s.t1, kind: s.kind, label: s.name || s.recipe || s.kind,
      data: { id: s.id, recipe: s.recipe, params: s.params, intensity: s.intensity ?? s.params?.intensity } }))) };
  },
  summary: ({ spans: s }) => `${s.length} segments`,
});

export const chapters = defineNode({
  type: 'src.chapters', title: 'Chapters', group: G, icon: 'chapters',
  help: 'Chapters as spans (kind "chapter", label = name).',
  ins: [], outs: [spans()], params: [],
  reads: () => [['chapters']], halo: () => 0, local: true,
  eval: (_in, _p, ctx) => ({ spans: normSpans((ctx.read('chapters') || []).map((c) => ({ t0: c.t0, t1: c.t1, kind: 'chapter', label: c.name || '', data: { id: c.id } }))) }),
});

export const loops = defineNode({
  type: 'src.loops', title: 'Loop regions', group: G, icon: 'loop',
  help: 'Loop regions as spans (kind "loop", data = {id, tiledTo}).',
  ins: [], outs: [spans()], params: [],
  reads: () => [['loops']], halo: () => 0, local: true,
  eval: (_in, _p, ctx) => ({ spans: normSpans((ctx.read('loops') || []).map((l) => ({ t0: l.t0, t1: l.t1, kind: 'loop', label: 'loop', data: { id: l.id, tiledTo: l.tiledTo ?? null } }))) }),
});

export const bookmarks = defineNode({
  type: 'src.bookmarks', title: 'Bookmarks', group: G, icon: 'bookmark',
  aliases: ['taps', 'markers', 'beats'],
  help: 'Bookmarks as points (label = note). Usable as tap/beat times.',
  ins: [], outs: [spans('spans', points)], params: [],
  reads: () => [['bookmarks']], halo: () => 0, local: true,
  eval: (_in, _p, ctx) => ({ spans: normSpans((ctx.read('bookmarks') || []).map((b) => ({ t0: b.at, t1: b.at, kind: 'bookmark', label: b.note || '', data: { id: b.id } }))) }),
});

export const range = defineNode({
  type: 'src.range', title: 'Time range (I/O)', group: G, icon: 'ruler',
  help: 'The I/O time-range selection as one span, or none.',
  ins: [], outs: [spans()], params: [],
  reads: () => [['range']], halo: () => 0, local: true,
  eval(_in, _p, ctx) {
    const r = ctx.read('range');
    return { spans: r && Number.isFinite(r.t0) && Number.isFinite(r.t1) ? normSpans([{ t0: r.t0, t1: r.t1, kind: 'range' }]) : [] };
  },
});

export const selection = defineNode({
  type: 'src.selection', title: 'Selection', group: G, icon: 'select',
  help: 'The selected actions as points. The selection is not saved and not undoable, so a graph that depends on it changes when you click.',
  ins: [], outs: [spans('spans', points)], params: [],
  reads: () => [['selection']], halo: () => 0, local: true,
  eval(_in, _p, ctx) {
    ctx.warn('selection is not saved and not undoable');
    const s = ctx.read('selection');
    return { spans: atsToSpans(s?.ats ?? [], 'selected') };
  },
});

export const scenes = defineNode({
  type: 'src.scenes', title: 'Scenes / cuts', group: G, icon: 'film',
  aliases: ['cuts', 'shots'],
  help: 'The tracking feature\'s scene list as spans (value = sign: -1 = flipped).',
  ins: [], outs: [spans()], params: [],
  reads: () => [['scenes']], halo: () => 0, local: true,
  eval: (_in, _p, ctx) => ({ spans: normSpans((ctx.read('scenes') || []).map((s) => ({ t0: s.start_ms, t1: s.end_ms, kind: 'scene', value: s.sign ?? s.auto_sign ?? 1 }))) }),
});

// features/timeline/kinds.js SPAN_KIND (copied: lib never imports features)
const SPAN_KIND = { active: 'penetration', idle: 'idle', carry: 'offscreen', climax: 'climax', orgasm: 'orgasm', still: 'idle' };

export const trackSpans = defineNode({
  type: 'src.trackSpans', title: 'Span labels', group: G, icon: 'flag',
  aliases: ['active', 'idle', 'carry', 'climax', 'orgasm', 'labels'],
  help: 'The tracking feature\'s span labels: active → penetration, idle → idle, carry → offscreen, climax → climax (run-in), orgasm → orgasm.',
  ins: [], outs: [spans()], params: [],
  reads: () => [['trackSpans']], halo: () => 0, local: true,
  eval: (_in, _p, ctx) => ({ spans: normSpans((ctx.read('trackSpans') || []).map((s) => ({ t0: s.start_ms, t1: s.end_ms, kind: SPAN_KIND[s.state] ?? s.state, label: s.state }))) }),
});

export const tags = defineNode({
  type: 'src.tags', title: 'Tags', group: G, icon: 'marker',
  help: 'Tag timeline spans (kind = tag, value = score). Empty until a tags provider exists.',
  ins: [], outs: [spans()],
  params: [text('tag', 'Tag (empty = all)', '')],
  reads: () => [['tags']], halo: () => 0, local: true,
  eval(_in, p, ctx) {
    const t = ctx.read('tags');
    if (t == null) { ctx.info('needs a tags provider'); return { spans: [] }; }
    return { spans: normSpans(t.filter((x) => !p.tag || x.tag === p.tag).map((x) => ({ t0: x.t0, t1: x.t1, kind: x.tag, label: x.tag, value: x.score }))) };
  },
});

export const audio = defineNode({
  type: 'src.audio', title: 'Audio envelope', group: G, icon: 'wave',
  aliases: ['sound', 'loudness', 'waveform', 'peaks'],
  help: 'The audio peak envelope 0..1 on the graph grid. Empty (NaN) until the waveform has loaded.',
  ins: [], outs: [signal()], params: [],
  reads: () => [['audio']], halo: () => 0, local: true,
  eval(_in, _p, ctx) {
    const a = ctx.read('audio'), g = ctx.grid();
    if (!a || !a.v) { ctx.info('the waveform has not loaded yet'); return { signal: makeSignal(g.i0, g.n, g.dt, NaN) }; }
    const v = onGrid({ i0: a.i0 ?? 0, dt: a.dt, v: a.v }, g);
    const sig = makeSignal(g.i0, g.n, g.dt, NaN);
    sig.v.set(v);
    sig.range = [0, 1];
    return { signal: sig };
  },
});

export const time = defineNode({
  type: 'src.time', title: 'Time', group: G, icon: 'clock',
  aliases: ['ramp', 't', 'seconds'],
  help: 'Time in seconds as a signal (0 at the start of the video). A ramp for expressions and envelopes.',
  ins: [], outs: [signal()], params: [],
  reads: () => [['durationMs']], halo: () => 0, local: true, // the grid spans the timeline: its length is an input
  eval: (_in, _p, ctx) => ({ signal: genSignal(ctx, (_k, t) => t / 1000) }),
});

export const media = defineNode({
  type: 'src.media', title: 'Media info', group: G, icon: 'film',
  help: 'Video duration (ms) and frame rate as numbers.',
  ins: [], outs: [number('duration'), number('fps')], params: [],
  reads: () => [['media'], ['durationMs'], ['frameMs']], halo: () => 0, local: true,
  eval: (_in, _p, ctx) => ({ duration: ctx.durationMs, fps: ctx.fps > 0 ? ctx.fps : 30 }),
});

// ---------------------------------------------------------------- constants

const C = 'Constants';

export const constNumber = defineNode({
  type: 'const.number', title: 'Number', group: C, icon: 'hash',
  aliases: ['constant', 'value'],
  help: 'A constant number. Wire it into a param socket or a signal input.',
  ins: [], outs: [number()],
  params: [num('value', 'Value', 50, -1e9, 1e9, 1, { inline: true })],
  halo: () => 0, local: true,
  eval: (_in, p) => ({ value: p.value }),
});

const asActions = (list) => normalize((Array.isArray(list) ? list : []).map((a) => (Array.isArray(a) ? { at: a[0], pos: a[1] } : a || {})));

export const constScript = defineNode({
  type: 'const.script', title: 'Script template', group: C, icon: 'stroke',
  aliases: ['template', 'cycle', 'pattern', 'snippet'],
  help: 'A small hand-made script ([{at, pos}] or [[at, pos]]). Use it as a loop template for "Tile" or as a fixed motion.',
  ins: [], outs: [script('value')],
  params: [json('points', 'Points', [{ at: 0, pos: 100 }, { at: 300, pos: 10 }, { at: 700, pos: 100 }], { editor: 'script' })],
  halo: () => 0, local: true,
  eval: (_in, p) => ({ value: asActions(p.points) }),
});

export const constSpans = defineNode({
  type: 'const.spans', title: 'Spans', group: C, icon: 'timeline',
  aliases: ['ranges', 'regions', 'times', 'points'],
  help: 'A stored list of spans [{t0, t1, kind?, label?, value?}] (t0 = t1 for points).',
  ins: [], outs: [spans('value')],
  params: [json('spans', 'Spans', [], { editor: 'spans' })],
  halo: () => 0, local: true,
  eval: (_in, p) => ({ value: normSpans(p.spans) }),
});

export const SOURCES = [axis, ghost, run, plan, chapters, loops, bookmarks, range, selection, scenes, trackSpans, tags, audio, time, media, constNumber, constScript, constSpans];
