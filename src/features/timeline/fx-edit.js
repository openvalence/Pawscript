// fx-edit.js -- pure edits of the Modifiers row (doc.fx, lib/fx.js). Modifiers are LAYERS: they may overlap (applyFx
// runs them in t0 order, later on top), so the row keeps them sorted by t0 and draws overlaps in sub-rows (fxRows). They
// are never baked here: they stay a layer until Flatten (timeline.flatten) writes them into the points. No DOM, no
// Svelte. An edit of a baked modifier (span, kind, params, a copy) un-bakes it: it acts again (on top of what it was baked
// into) instead of silently doing nothing.
// Inner events (innerOf): an orgasm's spurts move with it and go with it.
import { fillSpan } from './plan-edit.js';
import { moveCurve, envelope, spurtKeys, knotInKeys, unknotKeys, throbBeat, FX_KINDS, fxSchema, fxParams, isPointFx, baseTurns, strength, ENV } from '../../lib/fx.js';

const byT0 = (a, b) => a.t0 - b.t0;
const live = ({ baked: _, ...e }) => e;
const patch = (list, ids, fn) => list.map((e) => (ids.includes(e.id) ? live({ ...e, ...fn(e) }) : e));
export const makeFx = (id, kind, t0, t1) => ({ id, kind, t0: Math.round(t0), t1: Math.round(t1), params: {} });

/** The inner events of modifier m: an orgasm's spurts (on [t0, t1]); [] for the other kinds. */
export const innerOf = (list, m) => (m?.kind === 'orgasm' ? list.filter((e) => e.kind === 'spurt' && e.t0 >= m.t0 && e.t0 <= m.t1) : []);
/** ids plus the inner events of the modifiers among them (what moves / goes with them). */
export const withInner = (list, ids) => [...new Set([...ids, ...list.filter((e) => ids.includes(e.id)).flatMap((m) => innerOf(list, m).map((x) => x.id))])];

/** A new modifier over [t0, t1] (inside [0, dur]), on top of whatever is there; a spurt is an instant. -> list | null
 *  (shorter than minLen). */
export function addFx(list, { id, kind, t0, t1, dur = Infinity, minLen = 1 }) {
  if (FX_KINDS[kind]?.point) { const t = Math.max(0, Math.min(dur, Math.round(t0))); return [...list, makeFx(id, kind, t, t)].sort(byT0); }   // a spurt: one instant
  const a = Math.max(0, Math.round(Math.min(t0, t1))), b = Math.min(dur, Math.round(Math.max(t0, t1)));
  return b - a >= minLen ? [...list, makeFx(id, kind, a, b)].sort(byT0) : null;
}

/** The scene around t as a span for a new modifier (between the cuts; 10 s without cuts). -> {t0, t1} | null. */
export function dropSpan(t, { cuts = [], dur, minLen = 1 }) { return fillSpan([], t, { cuts, dur, minLen }); }

/** Sub-row of every effect, first free row from the top (an effect starting where another ends shares its row). -> {row: Map(id -> i), rows}. */
export function fxRows(list) {
  const ends = [], row = new Map();
  for (const e of [...list].sort(byT0)) {
    let i = ends.findIndex((t) => t <= e.t0);
    if (i < 0) i = ends.push(0) - 1;
    ends[i] = e.t1; row.set(e.id, i);
  }
  return { row, rows: Math.max(1, ends.length) };
}

// ---- paw-r9nh: hit sizes, turn snaps, default spans ----
/** How near (CSS px) a modifier's edge or a spurt's diamond takes the pointer (was 6 / 7, less on a narrow block). */
export const FX_EDGE_PX = 9;
/** The stroke's turns in [t0, t1] as snap targets (a modifier's edges land on a turn by default; Shift: free). */
export const turnSnaps = (script, t0, t1) => (Array.isArray(script) && script.length > 2 ? baseTurns(script, t0, t1).map((x) => ({ t: x.at, label: 'turn' })) : []);
/** span with each edge moved onto the nearest turn within maxMs (no turn there: as it was), kept at least minLen long. */
export function onTurns(span, turns, maxMs = 400, minLen = 1) {
  const near = (t) => { let b = t, d = maxMs + 1; for (const x of turns) if (Math.abs(x.at - t) < d) { d = Math.abs(x.at - t); b = x.at; } return b; };
  const t0 = near(span.t0), t1 = near(span.t1);
  return t1 - t0 >= minLen ? { t0, t1 } : span;
}
/** The default span of a new / re-fitted modifier of `kind` at t (double-click on the row; a key with nothing to go on):
 *  a slow single move (insertion, pull-out) = the stroke's half-stroke around t, from turn to turn; every other span kind
 *  = the shot around t (between cuts; no cuts: 10 s, its edges on turns). -> {t0, t1} | null. */
export function defaultSpan(kind, t, { cuts = [], dur = Infinity, script = [], minLen = 1 } = {}) {
  if (FX_KINDS[kind]?.point) return null;
  const T = baseTurns(script, t - 5000, t + 5000), k = T.findIndex((x) => x.at > t);
  if ((kind === 'insertion' || kind === 'pullout') && k > 0 && T[k].at - T[k - 1].at >= minLen) return { t0: T[k - 1].at, t1: T[k].at };
  const g = dropSpan(t, { cuts, dur, minLen });
  return g && !cuts.length ? onTurns(g, baseTurns(script, g.t0 - 1000, g.t1 + 1000), 600, minLen) : g;
}

/** A drag on one modifier: part 'body' shifts it (and its inner events, unless inner: false: an Alt-drag copy) by dt,
 *  't0' / 't1' moves that edge to t. Others never move (layers). -> list (sorted by t0). */
export function dragFx(list, id, part, { dt = 0, t = 0, dur = Infinity, minLen = 1, inner: withIn = true }) {
  const m = list.find((e) => e.id === id), inner = part === 'body' && withIn ? innerOf(list, m) : [];
  const d = m && part === 'body' ? Math.max(-m.t0, Math.min(dur - m.t1, Math.round(dt))) : 0;
  return list.map((e) => {
    if (d && inner.includes(e)) return live({ ...e, t0: e.t0 + d, t1: e.t1 + d });
    if (e.id !== id) return e;
    if (part === 'body') return d ? live({ ...e, t0: e.t0 + d, t1: e.t1 + d }) : e;
    if (part === 't0') return live({ ...e, t0: Math.max(0, Math.min(e.t1 - minLen, Math.round(t))) });
    return live({ ...e, t1: Math.min(dur, Math.max(e.t0 + minLen, Math.round(t))) });
  }).sort(byT0);
}

/** A copy right after the effect (cut at dur). -> {list, id} | null. */
export function duplicateFx(list, id, { newId, dur = Infinity, minLen = 1 }) {
  const e = list.find((x) => x.id === id);
  if (!e) return null;
  if (isPointFx(e)) { const t = Math.min(dur, e.t0 + 300), nid = newId(); return { list: [...list, live({ ...e, id: nid, t0: t, t1: t })].sort(byT0), id: nid }; }   // a spurt: the next one 300 ms on
  const nid = newId(), t0 = e.t1, t1 = Math.min(dur, e.t1 + (e.t1 - e.t0));
  return t1 - t0 >= minLen ? { list: [...list, live({ ...e, id: nid, t0, t1 })].sort(byT0), id: nid } : null;
}

/** Another kind: its params go back to that kind's defaults (they mean other things); it leaves its link. */
export const setFxKind = (list, id, kind) => patch(list, [id], (e) => ({ kind, params: {},   // a spurt is an instant; a span kind gets 2 s
  ...(FX_KINDS[kind]?.point ? { t1: e.t0 } : e.t1 === e.t0 ? { t1: e.t0 + 2000 } : {}) })).map((e) => (e.id === id && e.link ? (({ link: _, ...r }) => r)(e) : e));
export const toggleMute = (list, id) => list.map((e) => (e.id !== id ? e : e.muted ? (({ muted: _, ...r }) => r)(e) : { ...e, muted: true }));
/** Param overrides: undefined removes one (back to the default). On a linked effect the same overrides go to every
 *  member (same link, same kind); the members keep their own spans and a baked member stays baked (only the edited one
 *  un-bakes, as any edit does). */
export function setFxParams(list, id, p) {
  const ids = new Set(linkMembers(list, id).map((e) => e.id));
  return list.map((e) => {
    if (!ids.has(e.id)) return e;
    const params = { ...e.params, ...p };
    for (const k of Object.keys(params)) if (params[k] === undefined) delete params[k];
    return e.id === id ? live({ ...e, params }) : { ...e, params };
  });
}

// ---- linked effects: `link` = a group id; same kind; shared params, own spans ----
/** The effect and every effect linked to it (same link, same kind), in list order. [] when id is not there. */
export function linkMembers(list, id) {
  const e = list.find((x) => x.id === id);
  return !e ? [] : e.link ? list.filter((x) => x.link === e.link && x.kind === e.kind) : [e];
}
/** Link the effects `ids` per kind (a kind with one effect there is left alone). Each kind's group takes the params and
 *  the link id (else newLink()) of `primary` when it has params of its own, else of its first effect by t0 that has
 *  (a tuned recipe is never lost to a default one), else of `primary` / the first.
 *  -> list (the same array when nothing links). */
export function linkFx(list, ids, { primary = null, newLink }) {
  const byKind = new Map(), set = new Map();
  for (const e of list) if (ids.includes(e.id)) byKind.set(e.kind, [...(byKind.get(e.kind) || []), e]);
  for (const g of byKind.values()) {
    if (g.length < 2) continue;
    const own = (e) => e && Object.keys(e.params || {}).length > 0, pe = g.find((e) => e.id === primary), byT = [...g].sort(byT0);
    const src = (own(pe) && pe) || byT.find(own) || pe || byT[0], link = src.link ?? newLink();
    for (const e of g) set.set(e.id, { link, params: { ...src.params } });
  }
  return set.size ? list.map((e) => (set.has(e.id) ? { ...e, ...set.get(e.id) } : e)) : list;
}
/** The spurt a new one at t follows: the nearest one before t in the same scene (no scene there: within 10 s), when it is
 *  linked or its params differ from the defaults (one recipe over a range). -> modifier | null. */
export function recipeSpurt(list, t, scenes = []) {
  const s = scenes.find((x) => t >= x.start_ms && t < x.end_ms);
  const prev = list.filter((e) => e.kind === 'spurt' && e.t0 < t && (s ? e.t0 >= s.start_ms : t - e.t0 <= 10000)).sort((a, b) => b.t0 - a.t0)[0];
  if (!prev) return null;
  const p = fxParams(prev), d = fxParams({ kind: 'spurt' });
  return prev.link || Object.keys(d).some((k) => p[k] !== d[k]) ? prev : null;
}
/** A spurt at t that joins the recipe before it (recipeSpurt: its link and params; an unlinked one with its own params
 *  gets linked with the new one); `unlinked` = a plain one at the defaults. -> {list, linked}. */
export function addSpurt(list, { id, t, dur = Infinity, scenes = [], unlinked = false, newLink }) {
  const src = unlinked ? null : recipeSpurt(list, t, scenes), next = addFx(list, { id, kind: 'spurt', t0: t, t1: t, dur });
  return { list: src ? linkFx(next, [src.id, id], { primary: src.id, newLink }) : next, linked: !!src };
}
/** Unlink the effects `ids` (their params stay as they are); a group left with one member drops its link too. */
export function unlinkFx(list, ids) {
  const drop = ({ link: _, ...r }) => r;
  let next = list.map((e) => (ids.includes(e.id) && e.link ? drop(e) : e));
  const n = new Map();
  for (const e of next) if (e.link) n.set(e.link, (n.get(e.link) || 0) + 1);
  next = next.map((e) => (e.link && n.get(e.link) < 2 ? drop(e) : e));
  return next.some((e, i) => e !== list[i]) ? next : list;
}

// ---- the effect popover's curve (CurveEditor lines + handles), per kind; viewBox W x H ----
export const CW = 300, CH = 140;
const PAD = 12, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const xOf = (u) => PAD + u * (CW - 2 * PAD), uOf = (x) => (x - PAD) / (CW - 2 * PAD);
const yOf = (pos) => PAD + (1 - pos / 100) * (CH - 2 * PAD), posOf = (y) => 100 * (1 - (y - PAD) / (CH - 2 * PAD));
const pct = (v) => `${Math.round(v * 100)}%`;
const lim = (key, kind) => { const s = fxSchema(kind).find((q) => q.key === key) || {}; return { min: s.min, max: s.max, step: s.step }; };

/** Reshape: one stroke drawn between two turns (bottom -> top -> bottom), x = share of the stroke's time. */
function reshapeModel(p, kind) {
  const f = p.inFrac ?? 0.5, uT = 1 - f, lo = p.lo ?? 0, hi = p.hi ?? 100, N = 48;
  const outY = (u) => yOf(lo + moveCurve(u, p.accelIn, p.accelOut, p.dwellTop) * (hi - lo));
  const inY = (u) => yOf(hi - moveCurve(u, p.accelIn, p.accelOut, p.dwellBottom) * (hi - lo));
  const pts = [];
  for (let k = 0; k <= N; k++) pts.push([xOf((uT * k) / N), outY(k / N)]);
  for (let k = 1; k <= N; k++) pts.push([xOf(uT + ((1 - uT) * k) / N), inY(k / N)]);
  const L = (key) => ({ key, value: p[key], ...lim(key, kind) });
  // the tangent diamonds slide along the first / last part of the out move (before its dwell)
  const mw = uT * (1 - p.dwellTop);
  const depU = 0.05 + 0.2 * (p.accelIn + 1), arrU = 0.95 - 0.2 * (p.accelOut + 1);
  return {
    lines: [{ pts: [[PAD, yOf(hi)], [CW - PAD, yOf(hi)]], kind: 'guide' }, { pts: [[PAD, yOf(lo)], [CW - PAD, yOf(lo)]], kind: 'guide' },
      { pts: [[PAD, yOf(0)], [xOf(0.5), yOf(100)], [CW - PAD, yOf(0)]], kind: 'ghost' }, { pts }],
    handles: [
      { ...L('inFrac'), label: 'Turn: where the top falls in each stroke', shape: 'vpill', axis: 'x', x: xOf(uT), y: yOf(hi),
        text: p.inFrac == null ? 'turn as tracked' : `tops at in ${pct(f)}`, toValue: (x) => 1 - clamp(uOf(x), 0.1, 0.9) },
      { ...L('dwellTop'), label: 'Dwell at the top (share of the move)', shape: 'vpill', axis: 'x', x: xOf(uT * (1 - p.dwellTop)), y: yOf(hi) + 16,
        text: `top dwell ${pct(p.dwellTop)}`, toValue: (x) => 1 - clamp(uOf(x) / uT, 0, 1) },
      { ...L('dwellBottom'), label: 'Dwell at the bottom (share of the move)', shape: 'vpill', axis: 'x', x: xOf(uT + (1 - uT) * (1 - p.dwellBottom)), y: yOf(lo) - 16,
        text: `bottom dwell ${pct(p.dwellBottom)}`, toValue: (x) => 1 - clamp((uOf(x) - uT) / (1 - uT), 0, 1) },
      { ...L('accelIn'), label: 'Ease leaving a turn (right = slower start)', shape: 'diamond', axis: 'x', x: xOf(mw * depU), y: outY((mw * depU) / uT),
        text: `leave ${p.accelIn.toFixed(2)}`, toValue: (x) => (clamp(uOf(x) / mw, 0.05, 0.45) - 0.05) / 0.2 - 1 },
      { ...L('accelOut'), label: 'Ease arriving at a turn (left = slower arrival)', shape: 'diamond', axis: 'x', x: xOf(mw * arrU), y: outY((mw * arrU) / uT),
        text: `arrive ${p.accelOut.toFixed(2)}`, toValue: (x) => (0.95 - clamp(uOf(x) / mw, 0.55, 0.95)) / 0.2 - 1 },
      { ...L('hi'), label: 'Out end (depth)', shape: 'hpill', axis: 'y', x: xOf(0.97), y: yOf(hi), text: p.hi == null ? 'top as tracked' : `top ${Math.round(hi)}`, toValue: (_, y) => posOf(y) },
      { ...L('lo'), label: 'Deep end (depth)', shape: 'hpill', axis: 'y', x: xOf(uT), y: yOf(lo), text: p.lo == null ? 'bottom as tracked' : `bottom ${Math.round(lo)}`, toValue: (_, y) => posOf(y) },
    ],
  };
}

/** Orgasm / climax: the flutter envelope over the span (x = span time), slow -> pulsing -> slow. */
function pulseModel(p, kind) {
  const yA = (a) => PAD + (1 - a / 2) * (CH - 2 * PAD), aOf = (y) => 2 * (1 - (y - PAD) / (CH - 2 * PAD)), pts = [];
  for (let k = 0; k <= 60; k++) pts.push([xOf(k / 60), yA(p.pulse * envelope(k / 60, p.rampIn, p.rampOut))]);
  const L = (key) => ({ key, value: p[key], ...lim(key, kind) });
  return {
    // depth on the same plot, on the pos scale: two horizontal pills like the knot levels
    lines: [{ pts: [[PAD, yA(0)], [CW - PAD, yA(0)]], kind: 'guide' }, { pts: [[PAD, yOf(p.lo)], [CW - PAD, yOf(p.lo)]], kind: 'ghost' },
      { pts: [[PAD, yOf(p.hi)], [CW - PAD, yOf(p.hi)]], kind: 'ghost' }, { pts }],
    handles: [
      { ...L('hi'), label: 'Depth ceiling, strokes pulled under it', shape: 'hpill', axis: 'y', x: xOf(0.88), y: yOf(p.hi), text: `ceiling ${Math.round(p.hi)}`, toValue: (_, y) => clamp(posOf(y), 0, 100) },
      { ...L('lo'), label: 'Deep end the strokes are pulled to', shape: 'hpill', axis: 'y', x: xOf(0.96), y: yOf(p.lo), text: `deep ${Math.round(p.lo)}`, toValue: (_, y) => clamp(posOf(y), 0, 100) },
      { ...L('rampIn'), label: 'Flutter builds over (share of the span)', shape: 'vpill', axis: 'x', x: xOf(p.rampIn), y: yA(p.pulse), text: `build ${pct(p.rampIn)}`, toValue: (x) => clamp(uOf(x), 0, 0.5) },
      { ...L('rampOut'), label: 'Flutter fades over (share of the span)', shape: 'vpill', axis: 'x', x: xOf(1 - p.rampOut), y: yA(p.pulse), text: `fade ${pct(p.rampOut)}`, toValue: (x) => clamp(1 - uOf(x), 0, 0.5) },
      { ...L('pulse'), label: 'Flutter at the peak', shape: 'hpill', axis: 'y', x: xOf(0.5), y: yA(p.pulse), text: `flutter ${p.pulse.toFixed(2)}×`, toValue: (_, y) => clamp(aOf(y), 0, 2) },
    ],
  };
}

/** Knotting: one knot cycle (the fitted move shares), its levels as horizontal pills. */
function knotModel(p, kind) {
  const fr = [p.fPull, p.fPopOut, p.fTop, p.fDown, p.fPress, p.fPopIn].map((x) => Math.max(0, x)), sum = fr.reduce((a, b) => a + b, 0) || 1;
  const lv = [['lo', 'full depth'], ['knotOut', 'knot out'], ['popTo', 'pop to'], ['hi', 'top'], ['knotIn', 'knot in'], ['press', 'press']];
  let u = 0;
  const at = [0, ...fr.map((x) => (u += x / sum))];
  const pts = [[xOf(0), yOf(p.lo)], ...lv.slice(1).map(([k], i) => [xOf(at[i + 1]), yOf(p[k])]), [xOf(1), yOf(p.lo)]];
  return {
    lines: [{ pts }],
    handles: lv.map(([key, name], i) => ({ key, value: p[key], ...lim(key, kind), label: `Knot: ${name} level`, shape: 'hpill', axis: 'y',
      x: xOf(i ? at[i] : 0.02), y: yOf(p[key]), text: `${name} ${Math.round(p[key])}`, toValue: (_, y) => clamp(posOf(y), 0, 100) })),
  };
}

/** Knotting, one knot (mode 'single'): the insertion over the span (x = span time): start level, push (start + ease
 *  diamonds), the pop (time, drop), the full depth, the settle and the tie's hold level. */
function knotInModel(p, kind) {
  const from = p.from ?? 100, a = p.popAt, u0 = Math.max(0, a - p.push), knot = clamp(p.lo + p.popDepth, 0, 100), b = Math.min(1, a + 0.02), c = Math.min(1, b + p.settle);
  const pushY = (w) => yOf(from + moveCurve(w, p.easeIn, p.easeOut) * (knot - from)), pts = [[xOf(0), yOf(from)]];
  for (let k = 0; k <= 24; k++) pts.push([xOf(u0 + ((a - u0) * k) / 24), pushY(k / 24)]);
  pts.push(...knotInKeys(p, from).slice(-3).map(([u, pos]) => [xOf(u), yOf(pos)]));
  const L = (key) => ({ key, value: p[key], ...lim(key, kind) }), mw = Math.max(a - u0, 1e-3);
  const depU = 0.05 + 0.2 * (p.easeIn + 1), arrU = 0.95 - 0.2 * (p.easeOut + 1);
  return {
    lines: [{ pts: [[PAD, yOf(p.hold)], [CW - PAD, yOf(p.hold)]], kind: 'guide' }, { pts: [[PAD, yOf(p.lo)], [CW - PAD, yOf(p.lo)]], kind: 'guide' }, { pts }],
    handles: [
      { ...L('from'), label: 'Push starts from (as tracked: the trace)', shape: 'hpill', axis: 'y', x: xOf(Math.min(0.04, u0 / 2)), y: yOf(from),
        text: p.from == null ? 'from as tracked' : `from ${Math.round(from)}`, toValue: (_, y) => clamp(posOf(y), 0, 100) },
      { ...L('push'), label: 'Push length, share of the span before the pop', shape: 'vpill', axis: 'x', x: xOf(u0), y: yOf(from) + 16,
        text: `push ${pct(p.push)}`, toValue: (x) => clamp(a - uOf(x), 0.05, a) },
      { ...L('easeIn'), label: 'Ease into the push (right = slower start)', shape: 'diamond', axis: 'x', x: xOf(u0 + mw * depU), y: pushY(depU),
        text: `ease in ${p.easeIn.toFixed(2)}`, toValue: (x) => (clamp((uOf(x) - u0) / mw, 0.05, 0.45) - 0.05) / 0.2 - 1 },
      { ...L('easeOut'), label: 'Ease onto the knot (left = slower arrival)', shape: 'diamond', axis: 'x', x: xOf(u0 + mw * arrU), y: pushY(arrU),
        text: `ease out ${p.easeOut.toFixed(2)}`, toValue: (x) => (0.95 - clamp((uOf(x) - u0) / mw, 0.55, 0.95)) / 0.2 - 1 },
      { ...L('popDepth'), label: 'The pop drops by, onto the full depth', shape: 'hpill', axis: 'y', x: xOf(Math.max(0, a - 0.07)), y: yOf(knot),
        text: `pop ${Math.round(p.popDepth)}`, toValue: (_, y) => clamp(posOf(y) - p.lo, 0, 60) },
      { ...L('popAt'), label: 'The knot pops at (share of the span)', shape: 'vpill', axis: 'x', x: xOf(a), y: yOf((knot + p.lo) / 2),
        text: `pops at ${pct(a)}`, toValue: (x) => clamp(uOf(x), 0.05, 1) },
      { ...L('lo'), label: 'Full depth (where the pop lands)', shape: 'hpill', axis: 'y', x: xOf(Math.min(0.99, b + 0.02)), y: yOf(p.lo),
        text: `depth ${Math.round(p.lo)}`, toValue: (_, y) => clamp(posOf(y), 0, 100) },
      { ...L('settle'), label: 'Settles over, share of the span after the pop', shape: 'vpill', axis: 'x', x: xOf(c), y: yOf(p.hold) - 16,
        text: `settle ${pct(p.settle)}`, toValue: (x) => clamp(uOf(x) - b, 0, 0.5) },
      { ...L('hold'), label: 'Held at (the tie, to the end of the span)', shape: 'hpill', axis: 'y', x: xOf(0.97), y: yOf(p.hold),
        text: `tie ${Math.round(p.hold)}`, toValue: (_, y) => clamp(posOf(y), 0, 100) },
    ],
  };
}

/** Insertion: one slow push over the span (x = span time): the start level, the push (start pill, ease diamonds), where
 *  it arrives and the depth it ends at (held to the end). Drag the end above the start for a slow pull-out. */
function insertionModel(p, kind) {
  const from = p.from ?? 100, a = p.arrive, u0 = Math.max(0, a - p.push), mw = Math.max(a - u0, 1e-3), out = p.to > from;
  const pushY = (w) => yOf(from + moveCurve(w, p.easeIn, p.easeOut) * (p.to - from)), pts = [[xOf(0), yOf(from)]];
  for (let k = 0; k <= 24; k++) pts.push([xOf(u0 + (mw * k) / 24), pushY(k / 24)]);
  pts.push([xOf(1), yOf(p.to)]);
  const L = (key) => ({ key, value: p[key], ...lim(key, kind) }), dy = out ? -16 : 16;
  const depU = 0.05 + 0.2 * (p.easeIn + 1), arrU = 0.95 - 0.2 * (p.easeOut + 1);
  return {
    lines: [{ pts: [[PAD, yOf(p.to)], [CW - PAD, yOf(p.to)]], kind: 'guide' }, { pts }],
    handles: [
      { ...L('from'), label: 'Starts from (as before: the script at the start)', shape: 'hpill', axis: 'y', x: xOf(Math.min(0.04, u0 / 2)), y: yOf(from),
        text: p.from == null ? 'from as before' : `from ${Math.round(from)}`, toValue: (_, y) => clamp(posOf(y), 0, 100) },
      { ...L('push'), label: `${out ? 'Pull' : 'Push'} length, share of the span`, shape: 'vpill', axis: 'x', x: xOf(u0), y: yOf(from) + dy,
        text: `${out ? 'pull' : 'push'} ${pct(p.push)}`, toValue: (x) => clamp(a - uOf(x), 0.05, a) },
      { ...L('easeIn'), label: 'Ease into it (right = slower start)', shape: 'diamond', axis: 'x', x: xOf(u0 + mw * depU), y: pushY(depU),
        text: `ease in ${p.easeIn.toFixed(2)}`, toValue: (x) => (clamp((uOf(x) - u0) / mw, 0.05, 0.45) - 0.05) / 0.2 - 1 },
      { ...L('easeOut'), label: 'Settle onto the end (left = slower arrival)', shape: 'diamond', axis: 'x', x: xOf(u0 + mw * arrU), y: pushY(arrU),
        text: `settle ${p.easeOut.toFixed(2)}`, toValue: (x) => (0.95 - clamp((uOf(x) - u0) / mw, 0.55, 0.95)) / 0.2 - 1 },
      { ...L('arrive'), label: 'Arrives at, then held', shape: 'vpill', axis: 'x', x: xOf(a), y: yOf(p.to) - dy,
        text: `arrives ${pct(a)}`, toValue: (x) => clamp(uOf(x), 0.05, 1) },
      { ...L('to'), label: 'Ends at, held to the end (above the start: a pull-out)', shape: 'hpill', axis: 'y', x: xOf(0.97), y: yOf(p.to),
        text: `${out ? 'out to' : 'depth'} ${Math.round(p.to)}`, toValue: (_, y) => clamp(posOf(y), 0, 100) },
    ],
  };
}

/** Knotting, unknot (mode 'unknot'): the knot coming out over the span (x = span time): the tie, the pull (start pill,
 *  tug diamonds: the first slip's depth and, left-right, how many), the level where the knot gives, the pop (time, where
 *  it lands), the settle and the level it ends at. */
function unknotModel(p, kind) {
  const to = p.to ?? 100, a = p.popAt, u0 = Math.max(0, a - p.pull), b = Math.min(1, a + 0.02), c = Math.min(1, b + p.settle), n = Math.round(p.tugs);
  const L = (key) => ({ key, value: p[key], ...lim(key, kind) }), mw = Math.max(a - u0, 1e-3);
  const line = (w) => p.hold + w * (p.knotOut - p.hold), wTug = n ? 0.4 + 0.3 / n : 0.9;   // the first slip (no tugs: parked at 0.9)
  return {
    lines: [{ pts: [[PAD, yOf(p.hold)], [CW - PAD, yOf(p.hold)]], kind: 'guide' }, { pts: [[PAD, yOf(to)], [CW - PAD, yOf(to)]], kind: 'guide' },
      { pts: unknotKeys(p, to).map(([u, pos]) => [xOf(u), yOf(pos)]) }],
    handles: [
      { ...L('hold'), label: 'The tie, held deep until the pull', shape: 'hpill', axis: 'y', x: xOf(Math.min(0.04, u0 / 2)), y: yOf(p.hold),
        text: `tie ${Math.round(p.hold)}`, toValue: (_, y) => clamp(posOf(y), 0, 100) },
      { ...L('pull'), label: 'Pull length, share of the span before the pop', shape: 'vpill', axis: 'x', x: xOf(u0), y: yOf(p.hold) - 16,
        text: `pull ${pct(p.pull)}`, toValue: (x) => clamp(a - uOf(x), 0.05, a) },
      { ...L('tugs'), label: 'Tugs before it gives (left: more, far right: none)', shape: 'diamond', axis: 'x', x: xOf(u0 + wTug * mw), y: yOf(line(wTug)) - 14,
        text: `${n} tug${n === 1 ? '' : 's'}`, toValue: (x) => { const w = (uOf(x) - u0) / mw; return w >= 0.78 ? 0 : clamp(Math.round(0.3 / Math.max(0.01, w - 0.4)), 1, 6); } },
      ...(n ? [{ ...L('tugAmp'), label: 'Each tug slips back in by (pos)', shape: 'diamond', axis: 'y', x: xOf(u0 + wTug * mw), y: yOf(Math.max(0, line(wTug) - p.tugAmp)),
        text: `slip ${Math.round(p.tugAmp)}`, toValue: (_, y) => clamp(line(wTug) - posOf(y), 0, 30) }] : []),
      { ...L('knotOut'), label: 'The knot gives at (pos the pull reaches)', shape: 'hpill', axis: 'y', x: xOf(Math.max(0, a - 0.07)), y: yOf(p.knotOut),
        text: `gives ${Math.round(p.knotOut)}`, toValue: (_, y) => clamp(posOf(y), 0, 100) },
      { ...L('popAt'), label: 'The knot pops out at (share of the span)', shape: 'vpill', axis: 'x', x: xOf(a), y: yOf((p.knotOut + p.popTo) / 2),
        text: `pops at ${pct(a)}`, toValue: (x) => clamp(uOf(x), 0.05, 1) },
      { ...L('popTo'), label: 'The pop lands at (pos)', shape: 'hpill', axis: 'y', x: xOf(Math.min(0.99, b + 0.02)), y: yOf(p.popTo),
        text: `pop to ${Math.round(p.popTo)}`, toValue: (_, y) => clamp(posOf(y), 0, 100) },
      { ...L('settle'), label: 'Settles over, share of the span after the pop', shape: 'vpill', axis: 'x', x: xOf(c), y: yOf(to) + 16,
        text: `settle ${pct(p.settle)}`, toValue: (x) => clamp(uOf(x) - b, 0, 0.5) },
      { ...L('to'), label: 'Ends at, held to the end (as tracked: the trace)', shape: 'hpill', axis: 'y', x: xOf(0.97), y: yOf(to),
        text: p.to == null ? 'to as tracked' : `to ${Math.round(to)}`, toValue: (_, y) => clamp(posOf(y), 0, 100) },
    ],
  };
}

/** Spurt: the ringing about a flat trace (at 50) over -300..+700 ms around the shot; a symmetric amount pill, rise / fall diamonds. */
function spurtModel(p, kind) {
  const ms0 = -300, ms1 = 700, xMs = (ms) => xOf((ms - ms0) / (ms1 - ms0)), msX = (x) => ms0 + uOf(x) * (ms1 - ms0), B = 50;
  const keys = spurtKeys(p), L = (key) => ({ key, value: p[key], ...lim(key, kind) });
  const out = keys.find(([, o]) => o > 0);   // the first swing shallower (count >= 2)
  return {
    lines: [{ pts: [[PAD, yOf(B)], [CW - PAD, yOf(B)]], kind: 'ghost' }, { pts: [[xMs(0), PAD], [xMs(0), CH - PAD]], kind: 'guide' },
      { pts: [[PAD, yOf(B + p.amount)], [CW - PAD, yOf(B + p.amount)]], kind: 'guide' }, { pts: [[PAD, yOf(B - p.amount)], [CW - PAD, yOf(B - p.amount)]], kind: 'guide' },
      { pts: [[PAD, yOf(B)], ...keys.map(([t, o]) => [xMs(t), yOf(B + o)]), [CW - PAD, yOf(B)]] }],
    handles: [
      { ...L('amount'), label: 'Swing about the trace, deeper first', shape: 'hpill', axis: 'y', x: xMs(p.hold / 2), y: yOf(clamp(B - p.amount, 0, 100)),
        text: `\u00b1${Math.round(p.amount)}`, toValue: (_, y) => clamp(B - posOf(y), 0, 50) },
      { ...L('rise'), label: 'Each swing deeper takes at least (ms)', shape: 'diamond', axis: 'x', x: xMs(-p.rise), y: yOf(B), text: `deeper ${Math.round(p.rise)} ms`, toValue: (x) => clamp(-msX(x), 20, 500) },
      ...(out ? [{ ...L('fall'), label: 'Each swing shallower takes at least (ms)', shape: 'diamond', axis: 'x', x: xMs(out[0]), y: yOf(B + out[1]),
        text: `shallower ${Math.round(p.fall)} ms`, toValue: (x) => clamp(msX(x) - p.hold, 20, 500) }] : []),
    ],
  };
}

/** Throbbing: three beats on a flat trace over -100..2100 ms (x = ms, fixed, so dragging the period moves the second
 *  beat; depth drawn x2): the dip's depth, attack / release diamonds on the trace, the period pill on the second beat,
 *  the lub-dub pill, and the build / fade pills (share of the span) along the top. point (a single throb: one beat
 *  long): the one beat over -100..800 ms, no period / build / fade. */
const SPAN_ONLY = new Set(['period', 'rampIn', 'rampOut', 'jitter']);
function throbModel(p, kind, point = false) {
  const ms0 = -100, ms1 = point ? 800 : 2100, xMs = (ms) => xOf((ms - ms0) / (ms1 - ms0)), msX = (x) => ms0 + uOf(x) * (ms1 - ms0);
  const sg = p.dir === 'swell' ? 1 : -1, B = sg < 0 ? 90 : 10, G = 2,   // offsets drawn x2 (a beat is small)
    A = p.amount, K = throbBeat(p), L = (key) => ({ key, value: p[key], ...lim(key, kind) });
  const pts = [[PAD, yOf(B)]];
  for (let tb = 0; tb <= ms1; tb += point ? Infinity : Math.max(p.period, K[K.length - 1][0])) for (const [dt, o] of K) if (tb + dt <= ms1) pts.push([xMs(tb + dt), yOf(B + G * o)]);
  pts.push([CW - PAD, yOf(B)]);
  const atk = K[1][0], end = K[K.length - 1][0], dub = p.double > 0 ? K[3] : [Math.max(120, atk + 20) + p.attack, 0];
  const bpm = Math.round(60000 / p.period), up = sg < 0 ? -14 : 14;
  return {
    lines: [{ pts: [[PAD, yOf(B)], [CW - PAD, yOf(B)]], kind: 'ghost' }, { pts: [[PAD, yOf(B + G * sg * A)], [CW - PAD, yOf(B + G * sg * A)]], kind: 'guide' }, { pts }],
    handles: [
      { ...L('amount'), label: `Each beat ${sg < 0 ? 'dips deeper' : 'swells out'} by (pos, from the trace)`, shape: 'hpill', axis: 'y', x: xMs(atk), y: yOf(B + G * sg * A),
        text: `${sg < 0 ? '−' : '+'}${Math.round(A)}`, toValue: (_, y) => clamp((sg * (posOf(y) - B)) / G, 0, 40) },
      { ...L('attack'), label: 'The dip takes at least (ms)', shape: 'diamond', axis: 'x', x: xMs(atk), y: yOf(B) - up,
        text: `down ${Math.round(p.attack)} ms`, toValue: (x) => clamp(msX(x), 10, 500) },
      { ...L('release'), label: 'The return takes at least (ms)', shape: 'diamond', axis: 'x', x: xMs(end), y: yOf(B) - up,
        text: `back ${Math.round(p.release)} ms`, toValue: (x) => clamp(msX(x) - (end - p.release), 20, 1500) },
      { ...L('period'), label: `Beat every (ms, ${bpm} bpm): drag the second beat`, shape: 'vpill', axis: 'x', x: xMs(p.period), y: yOf(B) - 2 * up,
        text: `${Math.round(p.period)} ms · ${bpm} bpm`, toValue: (x) => clamp(msX(x), 250, 2000) },
      { ...L('double'), label: 'Second beat at +120 ms (lub-dub), 0: none', shape: 'hpill', axis: 'y', x: xMs(dub[0]), y: yOf(B + G * sg * A * p.double),
        text: p.double > 0 ? `dub ${pct(p.double)}` : 'no dub', toValue: (_, y) => clamp((sg * (posOf(y) - B)) / G / Math.max(1, A), 0, 1) },
      { ...L('rampIn'), label: 'Builds over (share of the span)', shape: 'vpill', axis: 'x', x: xOf(p.rampIn), y: yOf(sg < 0 ? 6 : 94), text: `build ${pct(p.rampIn)}`, toValue: (x) => clamp(uOf(x), 0, 0.5) },
      { ...L('rampOut'), label: 'Fades over (share of the span)', shape: 'vpill', axis: 'x', x: xOf(1 - p.rampOut), y: yOf(sg < 0 ? 6 : 94), text: `fade ${pct(p.rampOut)}`, toValue: (x) => clamp(1 - uOf(x), 0, 0.5) },
    ].filter((h) => !point || !SPAN_ONLY.has(h.key)),
  };
}

/** paw-r9nh: the strength envelope over the span (x = span time, y = strength 0..1): the plateau's level, where the
 *  build ends and the fade starts (pills on it), the levels it builds from / fades to (only while there is a build /
 *  fade), and `follow` (a diamond along the floor: right = the strength follows the strokes' travel more). */
export function envModel(p) {
  const L = (key) => { const s = ENV.find((q) => q.key === key); return { key, value: p[key], min: s.min, max: s.max, step: s.step }; };
  const y = (a) => yOf(100 * a), aOf = (yy) => clamp(posOf(yy) / 100, 0, 1), pts = [], low = [];
  for (let k = 0; k <= 60; k++) { const a = strength(k / 60, p); pts.push([xOf(k / 60), y(a)]); low.push([xOf(k / 60), y(a * (1 - p.follow))]); }
  const k = p.envIn + p.envOut > 1 ? 1 / (p.envIn + p.envOut) : 1, ui = p.envIn * k, uo = 1 - p.envOut * k;
  return {
    lines: [{ pts: [[PAD, y(1)], [CW - PAD, y(1)]], kind: 'guide' }, { pts: [[PAD, y(0)], [CW - PAD, y(0)]], kind: 'guide' },
      ...(p.follow > 0 ? [{ pts: low, kind: 'ghost' }] : []), { pts }],
    handles: [
      { ...L('envPeak'), label: 'Strength (1: in full, 0: the strokes as they are)', shape: 'hpill', axis: 'y', x: xOf((ui + uo) / 2), y: y(p.envPeak),
        text: `strength ${pct(p.envPeak)}`, toValue: (_, yy) => aOf(yy) },
      { ...L('envIn'), label: 'Builds up over, share of the span', shape: 'vpill', axis: 'x', x: xOf(ui), y: y(p.envPeak) + 16,
        text: p.envIn > 0 ? `build ${pct(p.envIn)}` : 'build', toValue: (x) => clamp(uOf(x), 0, 1) },
      { ...L('envOut'), label: 'Fades over, share of the span', shape: 'vpill', axis: 'x', x: xOf(uo), y: y(p.envPeak) + 16,
        text: p.envOut > 0 ? `fade ${pct(p.envOut)}` : 'fade', toValue: (x) => clamp(1 - uOf(x), 0, 1) },
      ...(p.envIn > 0 ? [{ ...L('envFrom'), label: 'Strength it builds from', shape: 'hpill', axis: 'y', x: xOf(0.03), y: y(p.envFrom), text: `from ${pct(p.envFrom)}`, toValue: (_, yy) => aOf(yy) }] : []),
      ...(p.envOut > 0 ? [{ ...L('envTo'), label: 'Strength it fades to', shape: 'hpill', axis: 'y', x: xOf(0.97), y: y(p.envTo), text: `to ${pct(p.envTo)}`, toValue: (_, yy) => aOf(yy) }] : []),
      { ...L('follow'), label: 'Follows the strokes (right: weaker on small strokes)', shape: 'diamond', axis: 'x',
        x: xOf(p.follow), y: CH - PAD + 6, text: p.follow > 0 ? `follows strokes ${pct(p.follow)}` : 'follow strokes', toValue: (x) => clamp(uOf(x), 0, 1) },
    ],
  };
}

/** -> {lines, handles} for CurveEditor; p = fxParams(modifier) merged with the drag draft (knotting: p.mode resolved,
 *  'single' draws the one-knot insertion, 'unknot' the knot coming out, anything else the cycle); point = a single throb
 *  (one beat long: its one beat). Idle has no curve (a hold). */
export function curveModel(kind, p, point = false) {
  return kind === 'shape' ? reshapeModel(p, kind) : kind === 'insertion' || kind === 'pullout' ? insertionModel(p, kind) : kind === 'knotting' ? (p.mode === 'single' ? knotInModel(p, kind) : p.mode === 'unknot' ? unknotModel(p, kind) : knotModel(p, kind))
    : kind === 'spurt' ? spurtModel(p, kind) : kind === 'throbbing' ? throbModel(p, kind, point) : kind === 'orgasm' || kind === 'climax' ? pulseModel(p, kind) : { lines: [], handles: [] };
}
// numbers with no handle that still belong in the twins (the rest of a kind's schema stays at its defaults)
const EXTRA = { knotting: ['popSpeed', 'variation'], orgasm: ['fastMs', 'flutterMs', 'edgeMs'], climax: ['fastMs', 'flutterMs', 'edgeMs'], spurt: ['hold', 'count', 'decay'], throbbing: ['jitter'] };
/** The numeric twins: one per handle, plus EXTRA[kind] (null = as tracked shows the default). */
export function curveTwins(kind, p, handles = curveModel(kind, p).handles, point = false) {
  const keys = new Set([...handles.map((h) => h.key), ...((kind === 'knotting' && (p.mode === 'single' || p.mode === 'unknot') ? [] : EXTRA[kind]) || []).filter((k) => !(point && SPAN_ONLY.has(k)))]);
  return fxSchema(kind).filter((s) => keys.has(s.key))
    .map((s) => ({ key: s.key, label: s.label, value: p[s.key] ?? s.default ?? s.min, min: s.min, max: s.max, step: s.step, unit: s.unit }));
}
