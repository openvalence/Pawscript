// dock.js -- the tracker dock's facts (TrackerDock.svelte, paw-ufv): the channels the frame on show has (one per colour
// slot of the blobs view: pinned parts, motion groups g1..g4, still points, unassigned) and per channel the few numbers
// a scripter weighs a tracker by: how much it moves on the stroke axis, how well it follows the run's stroke, how many
// of its points were lost. Pure (test/tracking-dock.test.mjs).
import { lowerBound } from '../../lib/lane.js';
import { sceneAt } from '../../lib/runs.js';
import { sceneGroups } from '../../lib/runs-channel.js';
import { MAX_SEM, slotOf, semNames, sampleAt, runAxis } from './blobs.js';
import { partLabel } from './groups.js';

const fin = (v) => typeof v === 'number' && v === v;
export const SLOTS = 6 + MAX_SEM;   // blobs slotOf: 0..3 g1..g4, 4 still, 5 unassigned, 5 + id a pinned group

/** A slot's stable key (settings tracking.dock.hidden survives runs whose pinned ids differ): 'g1', 'still', 'other',
 *  'sem:c1_penis'. sn = semNames(run). */
export const slotKey = (slot, sn) => (slot < 4 ? 'g' + (slot + 1) : slot === 4 ? 'still' : slot === 5 ? 'other' : 'sem:' + (sn[slot - 6] || '#' + (slot - 5)));

/**
 * The channels of the run scene [tMin, tMax) on show (every slot with points on any of its frames, so a part hidden for a
 * moment keeps its row): [{slot, key, label, name (a pinned group's name | null), stem (its channel stem, 'sem_c1_penis' |
 * 'g2' | null)}], pinned parts first (by name; slot -1: one without points of its own on the frames), then g1..g4, still,
 * unassigned.
 */
export function dockChannels(run, fr, tMin = -Infinity, tMax = Infinity) {
  if (!fr?.ov?.length) return [];
  const has = lostShares(fr, tMin, tMax), sn = semNames(run), out = [];
  const t = fr.t[Math.max(0, Math.min(fr.t.length - 1, lowerBound(fr.t, tMin)))], names = run ? sceneGroups(run, sceneAt(run.scenes || [], t)) : {};
  const seen = new Set(), part = (name, s) => {
    if (seen.has(name)) return;
    seen.add(name);
    out.push({ slot: s, key: 'sem:' + name, label: partLabel(names['sem_' + name]?.label || name), name, stem: 'sem_' + name });
  };
  for (let s = 6; s < SLOTS; s++) if (fin(has[s])) part(sn[s - 6] || '#' + (s - 5), s);
  // pinned groups the frames' points do not name (a .pawruns written before paw-u4q kept x, y, v and the group only):
  // from their centre channels, where they have data in the scene
  for (const k in run?.channels || {}) {
    if (!k.startsWith('sem_') || !k.endsWith('_x')) continue;
    const name = k.slice(4, -2), X = run.channels[k];
    if (seen.has(name) || !run.channels['sem_' + name + '_y']) continue;
    let any = false;
    for (let j = lowerBound(X.t, tMin); j < X.t.length && X.t[j] < tMax && !any; j++) any = fin(X.v[j]);
    if (any) { const id = sn.indexOf(name) + 1; part(name, id ? 5 + id : -1); }
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (let s = 0; s < 4; s++) if (fin(has[s])) out.push({ slot: s, key: 'g' + (s + 1), label: names['g' + (s + 1)]?.label ? `${names['g' + (s + 1)].label} ${s + 1}` : 'g' + (s + 1), name: null, stem: 'g' + (s + 1) });
  if (fin(has[4])) out.push({ slot: 4, key: 'still', label: 'Still', name: null, stem: null });
  if (fin(has[5])) out.push({ slot: 5, key: 'other', label: 'Unassigned', name: null, stem: null });
  return out;
}

/** hidden keys (settings) -> a flag per slot for drawBlobsView's o.hide (null when nothing is hidden). */
export function hiddenSlots(hidden, sn) {
  if (!hidden?.length) return null;
  const set = new Set(hidden), out = new Uint8Array(SLOTS);
  let any = 0;
  for (let s = 0; s < SLOTS; s++) if (set.has(slotKey(s, sn))) { out[s] = 1; any = 1; }
  return any ? out : null;
}

/** The stroke axis as a unit vector in square (aspect-scaled) units, fusion.js's sign convention (up, else right,
 *  positive): [ux, uy] (image y down), vertical when the run has none. */
export function axisUnit(run, tMin, tMax, aspect = 1) {
  const a = run ? runAxis(run, tMin, tMax, aspect) : null;
  let ux = a ? a.dx * aspect : 0, uy = a ? a.dy : -1;
  const L = Math.hypot(ux, uy);
  if (!(L > 1e-9)) return [0, -1];
  ux /= L; uy /= L;
  if ((Math.abs(uy) >= Math.abs(ux) && uy > 0) || (Math.abs(ux) > Math.abs(uy) && ux < 0)) { ux = -ux; uy = -uy; }
  return [ux, uy];
}

// series helpers (NaN gaps)
function highPass(v, t, ms) {   // v minus its centred moving average over ms
  const n = v.length, cs = new Float64Array(n + 1), cn = new Float64Array(n + 1), out = new Float64Array(n);
  for (let k = 0; k < n; k++) { const ok = fin(v[k]); cs[k + 1] = cs[k] + (ok ? v[k] : 0); cn[k + 1] = cn[k] + (ok ? 1 : 0); }
  for (let k = 0, a = 0, b = 0; k < n; k++) {
    while (t[a] < t[k] - ms / 2) a++;
    while (b < n && t[b] <= t[k] + ms / 2) b++;
    const c = cn[b] - cn[a];
    out[k] = fin(v[k]) && c ? v[k] - (cs[b] - cs[a]) / c : NaN;
  }
  return out;
}
function corr(x, y) {
  let n = 0, sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (let k = 0; k < x.length; k++) {
    const u = x[k], v = y[k];
    if (!fin(u) || !fin(v)) continue;
    n++; sx += u; sy += v; sxy += u * v; sxx += u * u; syy += v * v;
  }
  if (n < 8) return NaN;
  const vx = sxx - (sx * sx) / n, vy = syy - (sy * sy) / n;
  return vx > 1e-12 && vy > 1e-12 ? (sxy - (sx * sy) / n) / Math.sqrt(vx * vy) : NaN;
}
const median = (a) => { const b = a.filter(fin).sort((x, y) => x - y), m = b.length >> 1; return b.length ? (b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2) : NaN; };

const lostCache = new WeakMap();
/** Per slot, the share of its points hidden averaged over the frames of [tMin, tMax) that have any (NaN: no points there).
 *  One pass over the frames for every slot, cached per frames object and span; live frames (growing) continue the pass. */
export function lostShares(fr, tMin, tMax) {
  let m = lostCache.get(fr);
  if (!m) lostCache.set(fr, (m = new Map()));
  const key = tMin + ':' + tMax;
  let c = m.get(key);
  if (!c) m.set(key, (c = { k: lowerBound(fr.t, tMin), s: new Float64Array(SLOTS), f: new Float64Array(SLOTS), all: new Uint32Array(SLOTS), vis: new Uint32Array(SLOTS), v: null }));
  if (c.v && c.k >= fr.ov.length) return c.v;
  for (; c.k < fr.ov.length && fr.t[c.k] < tMax; c.k++) {
    const pts = fr.ov[c.k]?.pts;
    if (!pts) continue;
    c.all.fill(0); c.vis.fill(0);
    for (const q of pts) { const g = slotOf(q); c.all[g]++; if (q[2]) c.vis[g]++; }
    for (let g = 0; g < SLOTS; g++) if (c.all[g]) { c.s[g] += 1 - c.vis[g] / c.all[g]; c.f[g]++; }
  }
  if (c.k < fr.ov.length) c.k = fr.ov.length;   // past tMax: done
  c.v = Float64Array.from(c.s, (x, g) => (c.f[g] ? x / c.f[g] : NaN));
  return c.v;
}

const statCache = new WeakMap();
/**
 * One channel's facts over its run scene [tMin, tMax): {moves (robust stroke-band size of its centre on the stroke axis,
 * camera removed, frame heights; NaN without a centre channel), agree (|correlation| of that motion with the run's
 * stroke there: ref {t, v}, the lane trace / samples; 0..1, NaN when unknown), lost (the share of its points hidden,
 * averaged over the scene's frames; NaN without frames)}. Cached per run, channel and scene.
 */
export function channelStats(run, fr, ch, tMin, tMax, { aspect = 1, ref = null } = {}) {
  if (!ch) return { moves: NaN, agree: NaN, lost: NaN };
  const owner = run || fr;
  let m = statCache.get(owner);
  if (!m) statCache.set(owner, (m = new Map()));
  const key = `${ch.key}:${tMin}:${tMax}:${aspect}:${ref ? 1 : 0}`;
  const hit = m.get(key);
  if (hit && hit.ref === ref && hit.fr === fr && hit.n === fr?.ov?.length) return hit.v;
  const out = { moves: NaN, agree: NaN, lost: NaN };
  const X = ch.stem && run?.channels?.[ch.stem + '_x'], Y = ch.stem && run?.channels?.[ch.stem + '_y'];
  if (X && Y) {
    const i0 = lowerBound(X.t, tMin), i1 = lowerBound(X.t, tMax), [ux, uy] = axisUnit(run, tMin, tMax, aspect), n = i1 - i0;
    const t = new Float64Array(n), p = new Float64Array(n), same = Y.t === X.t || Y.t.length === X.t.length;
    for (let k = 0; k < n; k++) { const x = X.v[i0 + k], y = same ? Y.v[i0 + k] : sampleAt(Y, X.t[i0 + k], 0); t[k] = X.t[i0 + k]; p[k] = fin(x) && fin(y) ? x * aspect * ux + y * uy : NaN; }
    const hp = highPass(p, t, 2000);
    out.moves = 1.4826 * median(Array.from(hp, Math.abs));
    if (ref?.t?.length) {
      const r = new Float64Array(n);
      for (let k = 0; k < n; k++) r[k] = sampleAt(ref, t[k], 250);
      const c = corr(hp, highPass(r, t, 2000));
      out.agree = fin(c) ? Math.abs(c) : NaN;
    }
  }
  if (fr?.ov?.length && ch.slot >= 0) out.lost = lostShares(fr, tMin, tMax)[ch.slot];
  const N = ch.stem && run?.channels?.[ch.stem + '_n'];
  if (!fin(out.lost) && N) {   // no member points on the frames: the visible members' share against its best in the scene
    let s = 0, c = 0, mx = 0;
    for (let j = lowerBound(N.t, tMin); j < N.t.length && N.t[j] < tMax; j++) if (fin(N.v[j])) { s += N.v[j]; c++; mx = Math.max(mx, N.v[j]); }
    if (c && mx > 0) out.lost = 1 - s / c / mx;
  }
  m.set(key, { ref, fr, n: fr?.ov?.length, v: out });
  return out;
}

