// seed-score.js -- the seeder's held-out score in words (PROTOCOL v4.27, paw-26iv): the pure side. The sidecar (pawtrack/seedscore.py)
// scores the head on pictures it did NOT train on (grouped by source); this turns its record into the one line next to the seeder
// row, the change since the previous Train, and the per-part breakdown (weakest first: what to label next).
//   score = {overall: {found, iou, cerr, extra, n}, parts: {part: {n, sources, too_few, found?, iou?, cerr?}}, sources, frames,
//            previous?: {found, iou, cerr, extra, frames, sources}, pending?, error?}

const pct = (x, d = 0) => `${(x * 100).toFixed(d)} %`;
const pts = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}`;

/** v4.38: the ONE namer of every dataset, held out by source (seed_train's `namer` / namer.json): on the active dataset's pictures (`id`,
 *  shown as `name`), else on all; what it learned from (auto-named labels counted: drift to watch); the weakest part with >= 3 examples. */
export function namerLine(n, id, name = id, label = (p) => p) {
  const s = n?.score;
  if (!s) return n?.error ? 'namer: training failed (see the log)' : '';
  const a = s.by_ds?.[id], w = (s.parts || []).find((p) => p[1] >= 3);
  return `namer: top-1 ${pct((a || s).top1)} · top-3 ${pct((a || s).top3)}${a ? ` on ${name}` : ''} held out · from ${n.blobs} names in ${(n.datasets || []).length || 1} dataset${(n.datasets || []).length === 1 ? '' : 's'} (${n.auto || 0} auto-named)${w ? ` · weakest ${label(w[0])} ${pct(w[2])}` : ''}`;
}
/** Its hover text: every dataset's and every part's held-out accuracy (weakest first, with n). */
export function namerTip(n, label = (p) => p) {
  const s = n?.score;
  if (!s) return '';
  const ds = Object.entries(s.by_ds || {}).map(([d, v]) => `${d} ${pct(v.top1)} / ${pct(v.top3)} (${v.n})`).join(', ');
  return `One naming model for every dataset (a thigh is a thigh whatever the painting technique), scored on pictures it did not train on (${s.folds}-fold by source). All: top-1 ${pct(s.top1)} / top-3 ${pct(s.top3)} over ${s.n} names in ${s.images} pictures${ds ? `; per dataset ${ds}` : ''}. Per part (top-1, weakest first): ${(s.parts || []).map((p) => `${label(p[0])} ${pct(p[2])} (${p[1]})`).join(', ')}. ${n.auto || 0} of the ${n.blobs} names it learned from were confirmed auto-names${n.missing ? `; ${n.missing} labelled pictures have no cached features yet (Train in their dataset)` : ''}.`;
}

/** v4.28: the one-line status of the seeder's feature source, from the seeder record's `features` (seeder.status) and `unused`. */
export function featuresLine(s) {
  const f = s?.features;
  if (!f) return '';
  let t = `seeder features: ${f.source === 'taggerine' ? 'taggerine (optional pack installed)' : 'Hydra (built in)'}`;
  if (f.stale && f.wanted === 'taggerine') t += ' · the pack is installed: Train to use it';
  else if (f.stale && f.wanted === 'hydra' && f.source === 'taggerine') t += ' · Hydra is selected in the settings: Train to switch';
  if (f.note) t += ` · ${f.note}`;
  if (s.unused) t += ` · ${s.unused}`;
  return t;
}

/** v4.29: who drew a suggestion's outline, for its tip (mask_from from the sidecar): '' when it did not say. */
export const outlineNote = (g) => (g?.mask_from === 'sam' ? " · outline drawn by SAM from the seeder's point" : g?.mask_from === 'head' ? " · outline is the seeder's own coarse blob (SAM had nothing acceptable)" : g?.mask_from === 'cam' ? " · outline from the tagger's own region (SAM had nothing acceptable)" : '');

/** True when there are numbers to show. */
export const hasScore = (s) => !!s && !s.pending && !s.error && s.overall && s.overall.found != null;

/** Parts that have a score, weakest (lowest found) first, then the ones with too few examples (fewest first). */
export function weakParts(s, label = (p) => p) {
  const parts = Object.entries(s?.parts || {}).map(([part, v]) => ({ part, label: label(part), ...v }));
  const scored = parts.filter((p) => !p.too_few && p.found != null).sort((a, b) => a.found - b.found || b.n - a.n);
  const few = parts.filter((p) => p.too_few).sort((a, b) => a.n - b.n);
  return [...scored, ...few];
}

/** '+3.1 found, −0.4 overlap since the previous Train' (percentage points; centre error: a minus is better), or ''. */
export function scoreChange(s) {
  const p = s?.previous, o = s?.overall;
  if (!hasScore(s) || !p || p.found == null) return '';
  const bit = (name, a, b) => (a != null && b != null ? `${pts(a - b)} ${name}` : '');
  const t = [bit('found', o.found, p.found), bit('overlap', o.iou, p.iou), bit('centre', o.cerr, p.cerr)].filter(Boolean).join(', ');
  return t ? `${t} points since the previous Train (${p.frames} frame${p.frames === 1 ? '' : 's'} then)` : '';
}

/** Did the share of painted parts the head produced no blob for ("silent") rise by more than 3 points since the previous Train? */
export const fewerParts = (s) => s?.overall?.silent != null && s.previous?.silent != null && s.overall.silent - s.previous.silent > 0.03;

/** The one line: 'held-out: found 51 % · overlap 27 % · centre 5.9 % · 26 sources', or a word on why not. */
export function scoreLine(s) {
  if (!s) return '';
  if (s.pending) return 'held-out score: computing…';
  if (s.error) return 'held-out score: failed (see the log)';
  if (!hasScore(s)) return 'held-out score: not enough labels yet';
  const o = s.overall, x = o.extra_strict != null ? ` · ${o.extra_strict.toFixed(1)} false positives per picture on ${o.n_strict} fully labelled / nothing-here (all pictures: ${o.extra?.toFixed(1)} extra)` : o.extra != null ? ` · ${o.extra.toFixed(1)} extra per picture${o.extra_strict === null ? ' (partial labels: blobs on parts you did not paint count; mark pictures fully labelled for a false-positive rate)' : ''}` : '';
  const sil = o.silent != null ? ` · silent ${pct(o.silent)}` : '', fewer = fewerParts(s) ? ' · the seeder is finding fewer parts than before' : '';
  const prop = o.proposals != null ? ` · ${o.proposals.toFixed(1)} proposals a picture${o.dup_share != null ? `, ${pct(o.dup_share)} duplicates` : ''}` : '';   // paw-r6t0
  return `held-out: found ${pct(o.found)} · overlap ${pct(o.iou)} · centre ${pct(o.cerr, 1)}${x}${sil}${prop} · ${s.sources} source${s.sources === 1 ? '' : 's'}${fewer}`;
}

/** The weakest scored part in words: 'hips: found 33 % from 9 sources' (or ''). */
export function weakestLine(s, label = (p) => p) {
  const w = weakParts(s, label).find((p) => !p.too_few);
  return w ? `${w.label}: found ${pct(w.found)} from ${w.sources} source${w.sources === 1 ? '' : 's'}` : '';
}

/** The hover text: what the numbers mean, the change since last time, every part weakest first, the rest that is too few. */
export function scoreTip(s, label = (p) => p) {
  if (!hasScore(s)) return scoreLine(s);
  const head = 'Scored on pictures the model did not train on: the labelled sources are split into 5 groups (a video is one source, a still image its own); for each group a model learns from the other four and is tested on it. Found = the part\'s blob lies on the painted part; overlap = how much of the painted shape it covers; centre = how far off, as a share of the picture diagonal; extra = blobs that match nothing you painted.';
  const ch = scoreChange(s);
  const rows = weakParts(s, label).map((p) => (p.too_few ? `${p.label}: too few (${p.n} painted from ${p.sources} source${p.sources === 1 ? '' : 's'}; it needs 5 from 2)` : `${p.label}: found ${pct(p.found)} · overlap ${pct(p.iou)} · centre ${pct(p.cerr, 1)} · ${p.n} painted from ${p.sources} source${p.sources === 1 ? '' : 's'}`));
  return [head, ch, 'Weakest first, so you know what to label next:', ...rows].filter(Boolean).join('\n');
}

const pc = (x) => (x == null ? '?' : `${Math.round(x * 100)} %`);
/** paw-855t: each dataset's own held-out score side by side ('v2 (active): held-out found 62 % on its 37 labels · v1: ...'). Not comparable across label
 *  sets (each is scored on its own pictures): crossLine is. overview: [{name, active, frames, trained, score}]. */
export function overviewLine(overview) {
  const t = (overview || []).filter((o) => o.trained);
  if (!t.length) return '';
  return t.map((o) => `${o.name}${o.active ? ' (active)' : ''}: ${o.score && hasScore(o.score) ? `held-out found ${pc(o.score.overall.found)}` : 'no score yet'} on its ${o.frames} labels`).join(' · ');
}
/** paw-855t: every dataset's head scored on the ACTIVE dataset's labels: "on v2's labels (8 pictures ...): v2 head found 62 % (held-out), v1 head found 44 % (on the 5 of them it never saw ...)". */
export function crossLine(cross, nameOf = (id) => id) {
  if (!cross) return '';
  if (cross.note) return `datasets compared on ${nameOf(cross.active)}'s labels: ${cross.note}`;
  const rows = (cross.rows || []).map((r) => (r.error ? `${r.name} head: ${r.error}` : `${r.name} head found ${pc(r.found)}${r.own ? ' (held-out)' : r.n_frames != null ? ` (on the ${r.n_frames} of them it never saw${r.excluded ? `, ${r.excluded} it trained on left out` : ''})` : ''}`));
  return rows.length ? `on ${nameOf(cross.active)}'s labels (${cross.frames} pictures, ${cross.common?.length || 0} part${cross.common?.length === 1 ? '' : 's'} every head knows): ${rows.join(', ')}` : '';
}
