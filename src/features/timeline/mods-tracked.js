// mods-tracked.js -- a modifier is tracked when its reacting part was tracked there (paw-ef73.20, owner: "if you track
// it, it's tracked, if you don't its not"). Pure. Nothing is stored: when a tracker run over the modifier's span has an
// existing signal of the part that reacts, the modifier takes its timing from that signal; remove the run (or the
// group) and it is generated again. The signals are the ones the app already reads (no new estimator):
//   orgasm     balls contraction peaks (runs-channel scalePeaks of sem_balls_scale / sem_c1_balls_scale ...): its spurts,
//              one per peak, where no spurt was placed by hand inside it (hand-placed spurts always win)
//   throbbing  the beat period off balls / penis scale peaks (lib/fx throbPeriod, as its Fit button)
//   knotting   one knot in / out, a push / pull: the move and pop timing off a SAM-measured shaft's inserted fraction
//              (lib/shaft.js sem_<name>_in, confident frames only) through lib/fx fitKnotIn / fitKnotOut / fitInsertion;
//              a knotting in cycles keeps its cycles on the tracked turns (it always follows the strokes)
//   idle       generated only (a hold)
// The owner's own params win over the fitted ones (an edit in Refine is never overwritten). Not measured: whether a
// tracked timing is better than the generated one (the big-knot probe found plain pushes beat the tracker's timing on
// slow insertions); this only makes it possible, per modifier, by tracking the part.
import { scalePeaks } from '../../lib/runs-channel.js';
import { shaftNames, CONF_MIN } from '../../lib/shaft.js';
import { throbPeriod, fitKnotIn, fitKnotOut, fitInsertion, knotMode, fxParams } from '../../lib/fx.js';
import { measureOf } from './mod-runs.js';

/** The part that reacts, per kind: the prompt's word and the Groups part to paint (none: generated only). */
export const REACTS = { orgasm: 'balls', throbbing: 'penis', knotting: 'penis' };
const SCALE = { balls: /^sem_(c[12]_)?balls\d*_scale$/, penis: /^sem_(c[12]_)?penis\d*_scale$/ };
const partOf = (ch) => (/balls/.test(ch) ? 'balls' : 'penis');

/** The confident samples of a shaft group's inserted fraction over [t0 - 3 s, t1 + 3 s] -> {t, v}. */
function shaftSamples(run, name, t0, t1) {
  const v = run.channels[`sem_${name}_in`], c = run.channels[`sem_${name}_in_conf`], T = [], V = [];
  for (let i = 0; i < (v?.t?.length || 0); i++) if (v.t[i] >= t0 - 3000 && v.t[i] <= t1 + 3000 && c?.v?.[i] >= CONF_MIN && v.v[i] === v.v[i] && v.v[i] != null) { T.push(v.t[i]); V.push(v.v[i]); }
  return { t: T, v: V };
}

/** The channels of run that could drive modifier m (scale channels for orgasm / throbbing, shaft inserted fractions for
 *  the rest), in trackedBy's order. */
export function drivers(m, run) {
  const ch = run?.channels || {};
  if (m.kind === 'orgasm' || m.kind === 'throbbing') return Object.keys(ch).filter((k) => SCALE.balls.test(k) || (m.kind === 'throbbing' && SCALE.penis.test(k))).sort((a, b) => partOf(a).localeCompare(partOf(b)));   // balls first
  return REACTS[m.kind] ? shaftNames(run).map((n) => `sem_${n}_in`) : [];
}

/**
 * What drives modifier m from run (the tracker run under its span, with its channels), base = the stroke's points
 * (knotting's mode); only = that channel alone (an assignment). -> {part, ch, params?, spurts?} | null (generated).
 */
export function trackedBy(m, run, base = [], only = null) {
  if (!REACTS[m?.kind] || !run?.channels || !(m.t1 > m.t0)) return null;
  const ch = run.channels;
  if (m.kind === 'orgasm' || m.kind === 'throbbing') {
    const keys = drivers(m, run).filter((k) => !only || k === only);
    for (const k of keys) {
      const peaks = scalePeaks(ch[k], m.t0, m.t1, { sign: -1, minGapMs: m.kind === 'throbbing' ? 200 : 300 });
      if (m.kind === 'throbbing') { const p = throbPeriod(peaks); if (p) return { part: partOf(k), ch: k, params: { period: p } }; }
      else if (peaks.length) return { part: 'balls', ch: k, spurts: peaks };
    }
    return null;
  }
  const mode = m.kind === 'knotting' ? knotMode(fxParams(m), base, m.t0, m.t1) : null;
  if (mode === 'cycles') return null;
  for (const name of shaftNames(run).filter((n) => !only || only === `sem_${n}_in`)) {
    const s = shaftSamples(run, name, m.t0, m.t1);
    const params = mode === 'single' ? fitKnotIn(s, m.t0, m.t1) : mode === 'unknot' ? fitKnotOut(s, m.t0, m.t1) : fitInsertion(s, m.t0, m.t1);
    if (params) return { part: 'penis', ch: `sem_${name}_in`, params };
  }
  return null;
}

// ---- assignment after the fact (paw-ef73.26, owner: "assigned after the fact ... or from the original track") ----
// m.src = {run, ch}: one of its own runs (run.mod === m.id) or the shot's run under it, and which channel drives it;
// 'none': generated, chosen; absent (or naming a run that is gone: deleting a run unassigns): the default = the one
// candidate when exactly one exists (today's "the shot's run happens to have the part"), else generated.
/** Everything that can drive m: its own runs' channels, then the shot run's. -> [{run, ch, own, tracker, ...trackedBy}]. */
export function sourcesOf(m, own = [], shot = null, base = []) {
  const out = [];
  for (const r of [...own, ...(shot && !own.includes(shot) ? [shot] : [])]) for (const ch of drivers(m, r)) {
    const tr = trackedBy(m, r, base, ch);
    if (tr) out.push({ ...tr, run: r.id, own: r.mod === m.id, tracker: r.tracker });
  }
  return out;
}
/** What drives m: its assigned source (src), else the default (exactly one candidate: auto) -> source | null. */
export function assignedOf(m, own = [], shot = null, base = []) {
  if (m.src === 'none') return null;
  const r = m.src?.run ? [...own, shot].find((x) => x && x.id === m.src.run) : null, tr = r ? trackedBy(m, r, base, m.src.ch) : null;
  if (tr) return { ...tr, run: r.id, own: r.mod === m.id, tracker: r.tracker };
  const c = sourcesOf(m, own, shot, base);
  return c.length === 1 ? { ...c[0], auto: true } : null;
}
const PART = { penis: 'shaft', balls: 'balls' };
/** The label's words for what drives a modifier: 'tracked: SAM shaft · own run' / 'tracked: balls · shot run'. */
export const sourceText = (s, word = (id) => id) => (s.own ? `tracked: ${word(s.tracker)} ${PART[s.part] ?? s.part} · own run` : `tracked: ${s.part} · shot run`) + (s.measured ? ' · depth' : '');

/**
 * The modifiers as they act: each tracked one with its fitted timing under its own params, an orgasm's tracked spurts
 * added where it has no hand-placed spurt. runOver(t0, t1) -> the run under the span (with channels) | null; own(m) ->
 * the modifier's own runs; snap(t) -> where a tracked spurt lands (paw-r9nh: the start of its frame, as a hand-placed one).
 * -> {list (the same array when nothing is tracked), by: Map(id -> assignedOf result)}.
 */
export function resolveTracked(fx = [], runOver, base = [], own = () => [], snap = (t) => Math.round(t)) {
  const by = new Map(), out = [];
  for (const m of fx) {
    const mine = !m.muted && !m.baked && REACTS[m.kind] ? own(m) : null, shot = mine && runOver(m.t0, m.t1), tr = mine ? assignedOf(m, mine, shot, base) : null;
    if (!tr) { out.push(m); continue; }
    // stage 4 (mod-runs.js measureSpans): an assigned shaft measure is in the shot's points already: its curve stays out
    if (!tr.auto && measureOf(m, [...mine, shot].find((r) => r?.id === tr.run))) { by.set(m.id, { ...tr, measured: true }); out.push({ ...m, muted: true }); continue; }
    by.set(m.id, tr);
    out.push(tr.params ? { ...m, params: { ...tr.params, ...m.params } } : m);
    if (tr.spurts && !fx.some((e) => e.kind === 'spurt' && e.t0 >= m.t0 && e.t0 <= m.t1)) out.push(...tr.spurts.map((t, i) => ({ id: `${m.id}~s${i}`, kind: 'spurt', t0: snap(t), t1: snap(t), params: {} })));
  }
  return { list: by.size ? out.sort((a, b) => a.t0 - b.t0) : fx, by };
}
