// paw-2lp7.2: what every scene consumer sees, as a digest, for a set of documents. test/fixtures/regions-head.json holds it as
// made by the code before action regions (HEAD 4d96616: scenes, no doc.acts); test/regions.test.mjs asserts that the same
// documents converted to regions (regions.js actsFromScenes) and projected back through the shim give the same digest.
// Re-make (only on purpose, from the scenes-only code): node test/regions-snapshot.mjs > test/fixtures/regions-head.json
// paw-2lp7.4: the `cutaways` entry alone is re-made by the new model (its old fills read as cutaways: the 'both' one under the
// action is bridged like off-screen and transparent for Autorange's runs, the 'timing' one tracked for its timing, the lone
// 'before' one an intermission); every other entry is still the scenes-only code's.
// The owner's projects (read only, numbers only): node test/regions-snapshot.mjs --dir <folder of *.pawproj>
// Per document: per shot the tags / act kind / needs a where / structure / skip reason / join / range / tease the readers see
// (state scenesOf, modScenesOf), structureAuto, sceneRuns, Autorange's plan (bands per span), fusion's acts per tracked piece
// (rederive runDerives over halves of every shot), the track plan (planTracks as Track calls it), tagSpans, modHints.
import { normScenes, sceneRuns } from '../src/features/timeline/shots.js';
import { TAG, sceneTags, actKind, needsWhere, sceneStructure, skipReason, structureAuto, withStructure, tagSpans, isInternal, isOffscreen, isExposed, isBlank, sceneKind, sceneCamera } from '../src/features/timeline/acts.js';
import { withMods, modHints } from '../src/features/timeline/mods.js';
import { rangePlan } from '../src/lib/autorange.js';
import { runDerives } from '../src/lib/rederive.js';
import { planTracks } from '../src/lib/track-plan.js';
import { continuations } from '../src/lib/scenes-continue.js';

const SCENE_OPTS = { internal: isInternal, kind: sceneKind, blank: isBlank };
const D = (acts, extra = {}) => ({ summary: { acts, positions: [], views: [], count: 'two', species: ['canine'] }, tags: acts.map((tag) => ({ tag, score: 0.9 })), ...extra });
const NOBODY = { summary: { acts: [], positions: [], views: [], count: 'unknown', species: [] }, tags: [] };
const QUIET = { summary: { acts: [], positions: [], views: [], count: 'two', species: ['canine'] }, tags: [] };
/** Contiguous shots from lengths (ms) and per-shot facts. */
function shots(lens, facts = []) {
  let t = 0;
  return lens.map((n, i) => { const s = { start_ms: t, end_ms: t + n, ...(facts[i] || {}) }; t += n; return s; });
}
/** A stroke script over [t0, t1): a turn every 250 ms. */
const strokes = (spans) => spans.flatMap(([a, b]) => { const out = []; for (let t = a + 50, k = 0; t < b - 50; t += 250, k++) out.push({ at: t, pos: k % 2 ? 90 : 10 }); return out; });

export const DOCS = {
  plain: { scenes: shots([4000, 5000, 3000, 6000], [
    { tags: ['anal', 'penetration'] },
    { describe: D(['fellatio']) },
    { describe: QUIET },
    { tags: ['handjob'] },
  ]), script: strokes([[0, 9000], [12000, 18000]]) },
  joined: { scenes: shots([3000, 3000, 2000, 4000, 4000, 3000], [
    { tags: ['vaginal', 'penetration'], describe: D(['vaginal_penetration']) },
    { join: true, split: 'camera' },
    { join: true },
    { join: false, describe: D(['anal_penetration']) },
    { join: true, describe: D(['fellatio']) },
    { join: false, tags: ['vaginal', 'penetration'] },
  ]), script: strokes([[0, 19000]]) },
  twoActs: { scenes: shots([5000, 4000, 4000, 6000, 3000], [
    { tags: ['anal', 'penetration', 'handjob'] },
    { tags: ['handjob', 'exposed'] },
    { tags: ['slit', 'penetration', 'grinding'] },
    { tags: ['anal', 'penetration', { id: 'handjob', t0: 14500, t1: 16000 }] },
    { join: true },
  ]), script: strokes([[0, 22000]]) },
  cutaways: { scenes: shots([4000, 1500, 4000, 2000, 3000, 1000, 4000], [
    { tags: ['anal', 'penetration'] },
    { join: true, fill: 'both' },
    { join: true },
    { join: true, fill: 'timing' },
    { join: true },
    { fill: 'before' },
    { tags: ['oral', 'penetration'] },
  ]), script: strokes([[0, 5500], [5500, 9500], [11500, 14500], [15500, 19500]]) },
  offscreen: { scenes: shots([4000, 2000, 4000, 2000, 4000], [
    { tags: ['vaginal', 'penetration'] },
    { join: true, tags: ['offscreen'] },
    { join: true },
    { tags: ['offscreen'] },
    { tags: ['vaginal', 'penetration'] },
  ]), script: strokes([[0, 4000], [6000, 10000], [12000, 16000]]) },
  blank: { scenes: shots([1000, 4000, 800, 5000, 1200], [
    { kind: 'blank' },
    { tags: ['oral', 'penetration'] },
    { kind: 'blank' },
    { tags: ['anal', 'penetration'], describe: D(['anal_penetration']) },
    { kind: 'blank' },
  ]), script: strokes([[1000, 5000], [5800, 10800]]) },
  structure: { scenes: shots([3000, 2000, 5000, 4000, 3000, 2000, 3000, 2500], [
    { kind: 'still', describe: NOBODY },
    { describe: QUIET, tags: ['intro'] },
    { tags: ['anal', 'penetration'], describe: D(['anal_penetration']) },
    { tags: ['idle'] },
    { tags: ['vaginal', 'penetration', '-idle'] },
    { describe: QUIET, tags: ['exposed', 'after'] },
    { describe: QUIET, tags: ['-after'] },
    { kind: 'still', describe: NOBODY },
  ]), script: strokes([[5000, 10000], [14000, 17000]]) },
  modifiers: { scenes: shots([6000, 5000, 4000, 3000], [
    { tags: ['anal', 'penetration'] },
    { join: true },
    { tags: ['vaginal', 'penetration'] },
    { describe: QUIET },
  ]), fx: [
    { id: 'm1', kind: 'orgasm', t0: 8000, t1: 10500, params: {} },
    { id: 'm2', kind: 'knotting', t0: 2000, t1: 5000, params: { mode: 'single' } },
    { id: 'm3', kind: 'idle', t0: 15000, t1: 18000, params: {} },
    { id: 'm4', kind: 'insertion', t0: 11000, t1: 12000, params: {} },
  ], script: strokes([[0, 15000]]) },
  range: { scenes: shots([4000, 4000, 4000, 3000], [
    { tags: ['anal', 'penetration'], range: { lo: 20, hi: 70 } },
    { join: true },
    { tags: ['oral', 'penetration'], tease: true },
    { tags: ['vaginal', 'penetration'], range: { off: true } },
  ]), script: strokes([[0, 15000]]) },
  describe: { scenes: shots([3000, 3000, 4000, 4000], [
    { describe: D(['anal_penetration']), tags: ['-anal'] },
    { join: true, describe: D(['vaginal_penetration']) },
    { tags: ['fingering'] },
    { describe: D(['rimming', 'tongue_in_ass']), tags: ['-licking'] },
  ]), script: strokes([[0, 14000]]) },
  internal: { scenes: shots([4000, 2000, 4000], [
    { tags: ['anal', 'penetration'] },
    { join: true, tags: ['internal'] },
    { join: true },
  ]), script: strokes([[0, 10000]]) },
};
for (const d of Object.values(DOCS)) d.scenes = normScenes(d.scenes);

const pick = (o, ks) => Object.fromEntries(ks.map((k) => [k, o[k] ?? null]));
/** The digest of one document {scenes (the stored flat shots), fx, script}. */
export function digest(doc) {
  const L = doc.scenes || [], fx = doc.fx || [], script = doc.script || [];
  if (!L.length) return null;
  const M = withMods(L, fx), S = withStructure(L, M), MS = withStructure(M);
  const shotsOut = S.map((s, i) => ({ tags: sceneTags(s), kind: actKind(s), needsWhere: needsWhere(s), st: sceneStructure(s), skip: skipReason(MS[i]),
    join: L[i].join === true, range: L[i].range ?? null, tease: L[i].tease ?? null }));
  const plan = rangePlan(MS, script, { fx }).map((p) => pick(p, ['i', 't0', 't1', 'lo', 'hi', 'lo1', 'hi1', 'rule', 'source', 'reason', 'family']));
  const pieces = L.flatMap((s) => { const m = Math.round((s.start_ms + s.end_ms) / 2); return [{ start_ms: s.start_ms, end_ms: m }, { start_ms: m, end_ms: s.end_ms }]; });
  const fusion = runDerives({ id: 'r1', range: { start: L[0].start_ms, end: L[L.length - 1].end_ms }, scenes: pieces }, L).map((d) => d?.acts ?? null);
  const live = withStructure(M);
  const track = planTracks(live, { trackerId: 'cotracker_points', trackers: [{ id: 'cotracker_points', roi: 'none' }], internal: isInternal, offscreen: isOffscreen, exposed: isExposed, skip: skipReason, camera: sceneCamera })
    .map((x) => pick(x, ['sceneIdx', 'action', 'segments', 'reason', 'signal', 'label']));
  return { shots: shotsOut, structureAuto: structureAuto(M), runs: sceneRuns(L), plan, fusion, track, tagSpans: tagSpans(live, continuations(live, SCENE_OPTS)), modHints: modHints(S, fx) };
}
export const digestAll = (docs = DOCS) => Object.fromEntries(Object.entries(docs).map(([k, d]) => [k, digest(d)]));

const idOf = (e) => String((typeof e === 'string' ? e : e?.id) ?? '');
const owned = (e) => { const id = idOf(e), c = TAG[id.replace(/^-/, '')]?.cat; return c === 'where' || c === 'what' || (c === 'structure' && id[0] !== '-'); };
/** The shots without what the regions own (paw-2lp7.2): act tags (where / what, a set structure), join (a camera split and the
 *  owner's split marker stay), range, tease, the derived scene describe. */
export function stripFacts(L) {
  return L.map((s) => {
    const n = { ...s }, t = (s.tags || []).filter((e) => !owned(e));
    if (t.length) n.tags = t; else delete n.tags;
    for (const k of ['range', 'tease', 'scene_describe']) delete n[k];
    if (n.join === true) delete n.join;
    return n;
  });
}
/** The document as the shim gives it: regions made from its scenes, projected onto its shots stripped of those facts. */
export async function converted(d) {
  const { projectScenes, actsFromScenes, withCarried } = await import('../src/features/timeline/regions.js');
  const acts = d.acts ?? actsFromScenes(d.scenes);
  return { ...d, scenes: withCarried(projectScenes(stripFacts(d.scenes), acts), acts) };   // paw-2lp7.4: as Doc's setters do
}

/** --dir <folder>: before / after over the *.pawproj there (read only; numbers only): shots and plan entries that differ. */
async function compareDir(dir) {
  const fs = await import('node:fs'), { parse } = await import('../src/lib/io/project.js'), { appDocFrom } = await import('../src/app/project-logic.js');
  const J = JSON.stringify, tot = { projects: 0, shots: 0, runs: 0, regions: 0, secondary: 0, differ: 0 };
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.pawproj')).sort()) {
    const d = appDocFrom(parse(fs.readFileSync(`${dir}/${f}`, 'utf8')), { path: `${dir}/${f}` }), doc = { scenes: d.scenes, fx: d.fx, script: d.axes?.stroke || [] };
    if (!d.scenes.length) continue;
    const B = digest(doc), A = digest(await converted({ ...doc, acts: d.acts }));
    tot.projects++; tot.shots += B.shots.length; tot.runs += B.runs.length; tot.regions += d.acts.length; tot.secondary += d.acts.filter((r) => r.layer > 0).length;
    B.shots.forEach((s, i) => { const k = Object.keys(s).filter((x) => J(s[x]) !== J(A.shots[i]?.[x])); if (k.length) { tot.differ++; for (const x of k) tot['shot.' + x] = (tot['shot.' + x] || 0) + 1; } });
    for (const k of ['structureAuto', 'runs', 'plan', 'fusion', 'track', 'tagSpans', 'modHints']) if (J(B[k]) !== J(A[k])) tot[k] = (tot[k] || 0) + 1;
  }
  return tot;
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const i = process.argv.indexOf('--dir');
  if (i > 0) compareDir(process.argv[i + 1]).then((t) => console.log(t));
  else process.stdout.write(JSON.stringify(digestAll()) + '\n');
}
