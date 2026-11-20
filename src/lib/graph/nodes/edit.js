// Auto-wrapped lib/edit operations (contract §7.3, DESIGN §5 "Auto-wrapping"). Every OPS entry becomes `edit.<id>`
// (selection helpers `select.<id>`) except EXCLUDED_OPS, so a new library op appears in the palette with no graph code
// and the catalogue sweep test covers it automatically.
//
// The wrapper is written against src/lib/edit/README.md: OPS = [{ id, title, group, params, apply(script, sel, params)
// -> { script, ats }, playhead?, selection? }]. Entries that do not have that shape are skipped (and listed by
// wrapEditOps.skipped), never guessed at.

import { defineNode } from '../model.js';
import { lowerBound } from '../../core/script.js';
import { clipScript, atsToSpans, spansToAts } from '../types.js';
import { script, spans, req, points, SEED_MAX } from './util.js';

export const EXCLUDED_OPS = ['setPoint', 'numberKey', 'setTime'];

/** Ops that move actions in time: folded right to left over spans; downstream spans are not moved. */
export const TIME_SHIFT_OPS = ['move', 'nudgeTime', 'shift', 'stretch', 'fitDuration', 'fitToRange', 'reverse', 'rippleInsert', 'rippleDelete',
  'quantize', 'equaliseSpacing', 'doubleTime', 'halfTime', 'changeStrokeRate', 'repeatLastStroke', 'repeatSelection', 'duplicate', 'jitter', 'humanise'];

const frame = (p, k = 'frameMs') => (p[k] > 0 ? p[k] : 100); // 0 = the media frame, unknown here: assume >= 10 fps

/**
 * ms of context each op needs on each side of a requested range when it runs on the WHOLE (windowed) script;
 * unlisted = Infinity (global). Every finite entry is proven by the halo-honesty test (test/graph-nodes-halo.test.mjs).
 * Ops that anchor anything to the first action they see (smooth's resample grid, simplify's RDP, thinMinGap's first
 * kept point, turn detection with a prominence, selection statistics) are global here, and so are time-moving ops
 * (move, shift, nudgeTime, jitter, humanise): folded over several spans, an action moved into the next span is moved
 * again, so no finite bound holds. quantize is exempt: re-quantising a grid time is a no-op.
 */
export const EDIT_HALO = {
  offset: () => 0,
  invert: () => 0,
  setPos: () => 0,
  nudgePos: () => 0,
  limitRange: () => 0,
  delete: () => 0,
  addMidpoints: () => 0,
  subdivide: () => 0,
  scale: (p) => (p.pivot === 'center' || p.pivot === 'custom' ? 0 : Infinity),
  keepExtremes: (p) => (p.minProminence > 0 ? Infinity : 0),
  extremes: (p) => (p.minProminence > 0 ? Infinity : 0),
  alignExtremes: (p) => (p.minProminence > 0 || p.to !== 'value' ? Infinity : 0),
  quantize: (p) => frame(p) + 1,
};

/**
 * ms of context the per-span fold gives an op around each span (selection = that span). Addition to the contract
 * (which shares EDIT_HALO between both uses): most ops only look at the selected actions and their two neighbours, so
 * the fold can run them on an O(span) clip even when they are global on a whole script. Proven per op by the
 * "fold equals the direct call" test (test/graph-nodes-ops.test.mjs). Unlisted = EDIT_HALO, else Infinity.
 */
export const FOLD_HALO = {
  smooth: () => 0, simplify: () => 0, thinMinGap: () => 0, removeMicroReversals: () => 0,
  remapRange: () => 0, normalise: () => 0, envelope: () => 0, scale: () => 0,
  reverse: () => 0, equaliseSpacing: () => 0, doubleTime: () => 0, halfTime: () => 0,
  jitter: () => 0, humanise: () => 0,
};
const foldHaloOf = (id) => FOLD_HALO[id] ?? EDIT_HALO[id] ?? (() => Infinity);
// ponytail: halos the property tests could not prove stay Infinity (global): correct, only slower previews and folds.
// Prove a tighter bound in the tests before lowering one.
const PALETTE_GROUP = { points: 'Edit · points (advanced)' };
const ICONS = { amplitude: 'sliders', time: 'clock', density: 'simplify', speed: 'speed', rhythm: 'repeat-stroke', variation: 'random', points: 'pointer', select: 'select' };
const FRAME_KEYS = { quantize: 'frameMs', nudgeTime: 'frameMs' }; // default to the media's frame length (0 = media frame)
const SEED_KEYS = new Set(['seed']);

const isShaped = (op) => op && typeof op.id === 'string' && typeof op.apply === 'function' && Array.isArray(op.params);

/** An op's params in the kit dialect, with the graph flags. */
function paramsOf(op) {
  return op.params.map((q) => {
    const p = { ...q };
    if (!p.unit) delete p.unit;
    // whole-unit steps (ms, pos, counts) become 'int', so a scrub or a linked number never sends a fraction the op
    // would carry into its output (edit minSpacing with a fractional minGapMs returns non-integer times)
    if (p.type === 'number' && p.step === 1 && Number.isInteger(p.min) && Number.isInteger(p.max) && Number.isInteger(p.default)) p.type = 'int';
    const numeric = p.type === 'number' || p.type === 'int' || p.type === 'float';
    if (numeric && FRAME_KEYS[op.id] === p.key) Object.assign(p, { min: 0, default: 0, hint: '0 = the media\'s frame length' });
    if (numeric && SEED_KEYS.has(p.key)) Object.assign(p, { type: 'int', min: 0, max: SEED_MAX, step: 1, seed: true });
    else if (numeric && op.playhead !== p.key) p.mod = 'number';
    return p;
  });
}

const withFrame = (op, p, ctx) => {
  const k = FRAME_KEYS[op.id];
  return k && !(p[k] > 0) ? { ...p, [k]: ctx.frameMs } : p;
};

/** One wrapped op: edit.<id> (script, where) -> script, changed | select.<id> (script, where) -> points. */
function wrapOne(op) {
  const sel = op.group === 'select' || op.selection === true;
  const id = op.id, halo = EDIT_HALO[id] ?? (() => Infinity), foldHalo = foldHaloOf(id), timeShift = TIME_SHIFT_OPS.includes(id);
  const common = {
    title: op.title || id,
    icon: ICONS[op.group] ?? 'wand',
    aliases: [id, op.group].filter(Boolean),
    params: paramsOf(op),
    ins: [script('script', req)],
    perSpan: true,
  };
  if (sel) {
    return defineNode({
      ...common, type: `select.${id}`, group: 'Select',
      help: `${op.title}: the actions it selects, as points. Feed them to any "Only inside". Starts from the actions inside "Only inside" (all when unconnected).`,
      outs: [spans('points', points)],
      eval({ script: s, where }, p) {
        const r = op.apply(s, where ? { ats: spansToAts(s, where) } : null, p);
        return { points: atsToSpans(r.ats) };
      },
      summary: ({ points: pts }) => `${pts.length} selected`,
    });
  }
  return defineNode({
    ...common, type: `edit.${id}`, group: PALETTE_GROUP[op.group] ?? `Edit · ${op.group || 'other'}`,
    help: `${op.title}${op.playhead ? ` (${op.playhead} is a plain time here)` : ''}. Only inside spans: runs once per span with that span's kind overrides${timeShift ? ' (right to left; it shifts time, downstream spans are not shifted)' : ''}. Range ops use each span's own extent. "changed" = the actions it produced.`,
    outs: [script(), spans('changed', points)],
    halo, local: Object.prototype.hasOwnProperty.call(EDIT_HALO, id) || undefined, timeShift: timeShift || undefined,
    // frameMs 0 = the media frame: an input the engine's cache key does not otherwise see
    ...(FRAME_KEYS[id] ? { reads: (p) => (p[FRAME_KEYS[id]] > 0 ? [] : [['frameMs']]) } : {}),
    bypass: { script: 'script' },
    eval({ script: s }, p, ctx) {
      if (!ctx.where) {
        const r = op.apply(s, null, withFrame(op, p, ctx));
        return { script: r.script, changed: atsToSpans(r.ats) };
      }
      const list = timeShift ? [...ctx.where].reverse() : ctx.where, ats = new Set();
      let cur = s;
      for (const span of list) {
        const q = withFrame(op, ctx.paramsFor(span), ctx);
        const range = span.t0 === span.t1 ? { ats: [span.t0] } : { t0: span.t0, t1: span.t1 - 1 };
        const h = Number(foldHalo(q));
        if (Number.isFinite(h) && h >= 0) {
          const clip = clipScript(cur, span.t0 - h, span.t1 + h);
          if (!clip.length) continue;
          const r = op.apply(clip, range, q);
          const a = clip[0].at, b = clip[clip.length - 1].at, out = r.script;
          // past the clip is only legitimate where the clip is the script's own end (nothing beyond to collide with)
          if (out.length && ((out[0].at < a && clip[0] !== cur[0]) || (out[out.length - 1].at > b && clip[clip.length - 1] !== cur[cur.length - 1]))) throw new Error(`${id}: produced actions outside its halo (library change? remove it from EDIT_HALO)`);
          // splice back over the clip's extent: O(span) work in the op, one array copy here
          cur = cur.slice(0, lowerBound(cur, a)).concat(out, cur.slice(lowerBound(cur, b + 1)));
          for (const t of r.ats) ats.add(t);
        } else {
          const r = op.apply(cur, range, q);
          cur = r.script;
          for (const t of r.ats) ats.add(t);
        }
      }
      return { script: cur, changed: atsToSpans(ats) };
    },
    summary: ({ script: out, changed }) => (out ? `${out.length} pts · ${changed?.length ?? 0} changed` : '—'),
  });
}

/** OPS -> NodeDef[]. Ops without the README shape are skipped; their ids are in the returned array's `skipped`. */
export function wrapEditOps(OPS) {
  const defs = [], skipped = [];
  for (const op of Array.isArray(OPS) ? OPS : []) {
    if (!isShaped(op)) { skipped.push(op?.id ?? String(op)); continue; }
    if (EXCLUDED_OPS.includes(op.id)) continue;
    defs.push(wrapOne(op));
  }
  defs.skipped = skipped;
  return defs;
}
