// story.js -- per-second kind evidence -> story segments with their attributes. Shared by the rules brain, the VLM
// brain and decide()'s rules+vlm combine (sum the log scores, decode once). Pure.
import { viterbi, segmentsFrom } from './viterbi.js';
import { ACTIVE, KIND_IDS } from './decisions.js';
import { CLIMAX_FIT } from '../gen/recipes.js';

export const STORY_NAMES = KIND_IDS;
export const STEP_MS = 1000;
export const SWITCH = 4;

export function logSoftmax(row) {
  const m = Math.max(...row), z = m + Math.log(row.reduce((s, x) => s + Math.exp(x - m), 0));
  return row.map((x) => x - z);
}
export const median = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y), n = v.length; return n ? (n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2) : NaN; };
export const quantile = (a, q) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[Math.min(v.length - 1, Math.floor(q * v.length))] : NaN; };
export const stepsOf = ({ t0, t1 }) => Math.max(1, Math.ceil((t1 - t0) / STEP_MS));

/** 1 Hz energy of the scene per step of the scope (null where no sample within 1 s). */
export function energyPerStep(scene, scope) {
  const T = scene?.energy?.t ?? [], V = scene?.energy?.v ?? [], n = stepsOf(scope);
  return Array.from({ length: n }, (_, s) => {
    const mid = scope.t0 + s * STEP_MS + STEP_MS / 2;
    let best = -1, bd = 1000;
    for (let i = 0; i < T.length; i++) { const d = Math.abs(T[i] - mid); if (d <= bd && Number.isFinite(V[i])) { bd = d; best = i; } }
    return best >= 0 ? V[best] : null;
  });
}

/** Times a boundary may snap to: run-in start, orgasm edges, still-span edges, black on/off. */
function hints(req) {
  const h = [], cl = req.facts?.climax, sc = req.facts?.scene;
  if (cl?.window) h.push(Math.max(0, cl.window.t0 - CLIMAX_FIT.runInMs), cl.window.t0, cl.window.t1);
  if (cl?.afterglowTo != null) h.push(cl.afterglowTo);
  for (const [a, b] of sc?.still ?? []) h.push(a, b);
  const sec = sc?.seconds ?? [];
  const credits = (x) => x.creditsLike >= 0.5;
  for (let i = 1; i < sec.length; i++) if (!!sec[i].black !== !!sec[i - 1].black || credits(sec[i]) !== credits(sec[i - 1])) h.push(sec[i].t);
  return h;
}

function tidy(segs, req) {
  // merge runs shorter than 250 ms into a neighbour (the last partial step)
  for (let i = segs.length - 1; i >= 0 && segs.length > 1; i--) {
    if (segs[i].t1 - segs[i].t0 >= 250) continue;
    if (i > 0) segs[i - 1].t1 = segs[i].t1; else segs[1].t0 = segs[0].t0;
    segs.splice(i, 1);
  }
  const H = hints(req);
  for (let i = 1; i < segs.length; i++) {
    const b = segs[i].t0, near = H.filter((x) => Math.abs(x - b) < STEP_MS).sort((x, y) => Math.abs(x - b) - Math.abs(y - b))[0];
    if (near != null && near - segs[i - 1].t0 >= 250 && segs[i].t1 - near >= 250) { segs[i - 1].t1 = near; segs[i].t0 = near; }
  }
  return segs;
}

/** Split long steady active segments where the energy steps down for >= 3 s (trace 2: 0-4.5 s at 0.75 of the
 *  later excursion). ponytail: one split per segment, energy only; a tracked excursion would be the upgrade. */
function splitByEnergy(segs, e, t0) {
  const out = [];
  for (const g of segs) {
    const a = Math.round((g.t0 - t0) / STEP_MS), b = Math.round((g.t1 - t0) / STEP_MS), part = e.slice(a, b);
    const ok = ['foreplay', 'oral', 'penetration', 'knotting', 'custom'].includes(g.label) && part.filter(Number.isFinite).length >= 6;
    let best = null;
    const dev = (v) => { const m = median(v); return v.filter(Number.isFinite).reduce((s, x) => s + Math.abs(x - m), 0); };
    if (ok) for (let j = 3; j <= part.length - 3; j++) {   // the cut that leaves the least spread on both sides
      const A = part.slice(0, j), B = part.slice(j), m1 = median(A), m2 = median(B), r = Math.min(m1, m2) / Math.max(m1, m2), cost = dev(A) + dev(B);
      if (Number.isFinite(r) && r <= 0.8 && (!best || cost < best.cost)) best = { j, r, cost };
    }
    if (!best) { out.push(g); continue; }
    const cut = t0 + (a + best.j) * STEP_MS;
    out.push({ ...g, t1: cut }, { ...g, t0: cut });
  }
  return out;
}

const mean = (a) => { const v = a.filter(Number.isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };
const r2 = (x) => Math.round(x * 100) / 100;

/**
 * logp: steps x STORY_NAMES log scores over req.scope (1 s steps from scope.t0). o: {vis?: P(contact visible) per
 * step, int?: E[intensity] per step, rate?: stroke rate in turns/s for offscreen strokes, energy?: per step}.
 * -> {segments (README story shape, tiling the scope), raw (mean posterior of the decoded labels), labels}.
 */
export function buildStory(req, logp, o = {}) {
  const { t0, t1 } = req.scope, names = STORY_NAMES, labels = viterbi(logp, SWITCH);
  const e = o.energy ?? energyPerStep(req.facts?.scene, req.scope);
  let segs = tidy(segmentsFrom(labels, names, t0, STEP_MS, t1), req);
  segs = tidy(splitByEnergy(segs, e, t0), req);
  const stepsIn = (g) => { const a = Math.max(0, Math.floor((g.t0 - t0) / STEP_MS)), b = Math.max(a + 1, Math.ceil((g.t1 - t0) / STEP_MS)); return [a, b]; };
  const activeE = median(segs.filter((g) => ACTIVE.has(g.label) && g.label !== 'afterglow').flatMap((g) => e.slice(...stepsIn(g))));
  const views = req.facts?.scene?.describe?.views ?? [], cam = req.facts?.camera?.mode;
  const segments = segs.map((g) => {
    const kind = g.label, [a, b] = stepsIn(g), act = ACTIVE.has(kind);
    let intensity = 1;
    const ratio = median(e.slice(a, b)) / activeE, it = mean(o.int?.slice(a, b) ?? []);
    if (act && kind !== 'climax' && kind !== 'orgasm' && kind !== 'afterglow') {
      if (Number.isFinite(ratio)) intensity = ratio >= 0.85 ? 1 : r2(Math.max(0.2, ratio));
      else if (Number.isFinite(it)) intensity = r2(Math.max(0.2, it));
    }
    const vis = mean(o.vis?.slice(a, b) ?? []);
    const s = {
      t0: g.t0, t1: g.t1, kind, visible: kind === 'offscreen' ? false : act && Number.isFinite(vis) ? vis >= 0.5 : true,
      action: act ? 'continues' : 'stops', intensity,
      name: [kind, act && kind !== 'offscreen' ? views[0] : null, cam ? `cam ${cam}` : null].filter(Boolean).join(' · ').replace(/_/g, ' '),
    };
    if (kind === 'offscreen' && o.rate > 0) Object.assign(s, { recipe: 'penetration-strokes', params: { rate: r2(o.rate) } });
    if (kind === 'orgasm') s.recipe = 'orgasm';
    return s;
  });
  const raw = labels.length ? mean(labels.map((l, i) => Math.exp(logSoftmax(logp[i])[l]))) : 0;
  return { segments, raw: r2(raw * 100) / 100 || 0, labels };
}
