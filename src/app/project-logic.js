// project-logic.js -- the project layer's decisions and its file pipeline, in plain JS so node can test it
// (test/app-project.test.mjs). project.svelte.js asks the user and moves state in and out of app.doc.
//
// Safety (outline section 11) is split with the native side (src-tauri/API.md):
//   - every user document goes through backend.writeWithBackup: atomic, first overwrite of a file Pawscript did
//     not write is copied to name.bak, our own previous versions go to rolling backups in app data
//   - here: `shas` (pathKey -> sha256 we last read/wrote there this session). A target whose content is not that
//     (appeared since open, or changed by another program) is a `conflict` the user must confirm; the write then
//     still passes the sha the user saw as expectedSha256, so a change in between is caught natively too
//   - a file whose script we did not change is not rewritten; empty axes are never written
//   - the first failure stops the save and is reported by path
// An empty file counts as absent.

import { graphsToProject, graphsFromProject, withoutGraphGhosts } from '../features/graph/integration/persist.js';
import { fromSaved, toSaved } from '../features/timeline/shots.js';
import { actsFromScenes } from '../features/timeline/regions.js';
import { migrateDetail } from '../lib/detail.js';
import { singleThrob, EVENT_KINDS, KNOT_PUSH, KNOT_PULL } from '../lib/fx.js';
import { stripMods } from '../features/timeline/shots.js';
import { TAG } from '../features/timeline/acts.js';
import { parseFunscript, serializeFunscript, axisName, axisPath, parseAxisFile, discoverAxes, buildExports,
  parse as parseProject, serialize as serializeProject } from '../lib/io/index.js';
import { stamp } from '../lib/provenance.js';
import { normRanges } from '../lib/run-ranges.js';
import { normEmpty } from '../lib/script-of.js';

/** Every axis the app knows, by name (sibling files are looked for for each). */
export const ALL_AXES = ['stroke', 'roll', 'pitch', 'twist', 'surge', 'sway', 'vib', 'valve', 'suck', 'lube', 'v8', 'v9'];
export const VIDEO_EXT = ['mp4', 'm4v', 'mkv', 'webm', 'mov', 'avi'];
export const REF_COLOR = '#E8D8A0';
/** The finish block a project gets when it has none of its own. */
const FINISH_SAVED = Object.freeze({ autorange: false });
/** Extra top-level key in autosave content only: which video / funscript base an untitled snapshot belongs to. */
export const AUTOSAVE_OF = 'pawscriptAutosaveOf';

// ---------- paths ----------
export const pathKey = (p) => String(p).replace(/\\/g, '/').toLowerCase();
export const fileName = (p) => String(p).split(/[\\/]/).pop();
export const dirName = (p) => { const s = String(p), i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')); return i < 0 ? '' : s.slice(0, i); };
export const stem = (p) => String(p).replace(/\.[^.\\/]+$/, '');
export const extOf = (p) => { const m = /\.([^.\\/]+)$/.exec(String(p)); return m ? m[1].toLowerCase() : ''; };
/** dir + name with the dir's own separator; '..' segments resolved. */
export function joinPath(dir, name) {
  if (!dir) return name;
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  const out = [];
  for (const part of (dir + '/' + name).split(/[\\/]/)) {
    if (part === '..' && out.length > 1) out.pop(); else if (part !== '.') out.push(part);
  }
  return out.join(sep);
}

/** Dropped / picked paths by kind. */
export function classifyPaths(paths) {
  const out = { projects: [], videos: [], funscripts: [], other: [] };
  for (const p of paths || []) {
    const e = extOf(p);
    (e === 'pawproj' ? out.projects : e === 'funscript' ? out.funscripts : VIDEO_EXT.includes(e) ? out.videos : out.other).push(p);
  }
  return out;
}

/**
 * Probe -> app media. Takes the native media_probe shape ({duration_ms, video:{fps, is_vfr, display_width, ...,
 * rotation}}) or the sidecar's ({duration_ms, fps, is_vfr, width, height}); null = unknown (player fills duration).
 */
export function mediaFrom(path, m) {
  const pos = (v) => (Number.isFinite(v) && v > 0 ? v : null);
  const v = m?.video || m || {};
  let w = pos(v.display_width) || pos(v.width), h = pos(v.display_height) || pos(v.height);
  if (v.rotation === 90 || v.rotation === 270) [w, h] = [h, w];
  const dur = pos(m?.duration_ms) || pos(v.duration_ms);
  // hasAudio: true / false from ffprobe (has_audio), null when unknown (sidecar probe)
  const fr = v.fps_rational, fpsRational = fr && +(fr.num ?? fr[0]) > 0 && +(fr.den ?? fr[1]) > 0 ? { num: +(fr.num ?? fr[0]), den: +(fr.den ?? fr[1]) } : null;
  return { path, name: fileName(path), durationMs: dur ? Math.round(dur) : 0, fps: pos(v.fps), isVfr: !!v.is_vfr, width: w, height: h, hasAudio: typeof m?.has_audio === 'boolean' ? m.has_audio : null,
    frameCount: pos(v.frame_count) || pos(m?.frame_count), fpsRational,
    ...(pos(m?.start_ms) ? { startMs: pos(m.start_ms) } : {}) };   // paw-ef73.16: the file's first frame time (a file that starts late: the <video> honours it, the app's clock counts from 0)
}

/** {text, sha256} of a file, or null when it is absent or empty. Read errors of an existing file throw. */
export async function readMaybe(backend, path) {
  if (!(await backend.exists(path))) return null;
  const f = await backend.readFile(path);
  return f && f.text && f.text.trim() ? { text: f.text, sha256: f.sha256 } : null;
}

// ---------- open ----------
/**
 * Sibling axis files of `base` (a video path, or any path with the same stem): backend.listDir(dir, {stem, ext})
 * when available, else exists() on the plain and `.pawscript` name of every known axis. The `.pawscript` name
 * wins: it is the file Pawscript saved when the plain one belonged to someone else, so it holds the user's work;
 * the plain file it shadows is reported in `shadowed` and in a note.
 * -> { found: {axis: {path, text, sha256, parsed}}, unreadable: [{path, sha256, error}], notes: [string], shadowed: {axis: path},
 *      others: [paths: funscripts beside it that start with its name but are no axis of it ('clip (1).funscript'); listDir only] }
 */
export async function discover(backend, base) {
  const dir = dirName(base);
  let cands = null, others = [];   // [{axis, path}] in preference order
  if (typeof backend.listDir === 'function') {
    try {
      const listing = (await backend.listDir(dir, { stem: fileName(stem(base)), ext: '.funscript' }))
        .map((e) => (typeof e === 'string' ? (/[\\/]/.test(e) ? e : joinPath(dir, e)) : e.path || joinPath(dir, e.name)));
      const d = discoverAxes(base, listing);
      // 'clip (1)', 'clip_v2', 'clip-alt': variants of this video's script; never 'clip2' (another video's)
      others = d.other.filter((p) => /^[^a-z0-9]/i.test(fileName(p).slice(fileName(stem(base)).length)));
      cands = Object.keys(d.found).flatMap((axis) => [...(d.alternates[axis] || []), d.found[axis]].sort((a, b) => b.alt - a.alt).map((f) => ({ axis, path: f.path })));
    } catch { cands = null; }
  }
  if (!cands) {
    const all = ALL_AXES.flatMap((axis) => [{ axis, path: axisPath(base, axis, { alt: true }) }, { axis, path: axisPath(base, axis) }]);
    const ex = await Promise.all(all.map((c) => Promise.resolve(backend.exists(c.path)).catch(() => false)));
    cands = all.filter((_, i) => ex[i]);
  }
  const found = {}, unreadable = [], notes = [], shadowed = {};
  for (const c of cands) {
    if (found[c.axis]) {
      shadowed[c.axis] = c.path;
      notes.push(`${fileName(c.path)} also exists; ${fileName(found[c.axis].path)} (saved by Pawscript) was loaded instead`);
      continue;
    }
    let f;
    try { f = await readMaybe(backend, c.path); } catch (e) { notes.push(`${fileName(c.path)}: could not be read (${e?.message || e})`); continue; }
    if (!f) continue;
    try {
      const parsed = parseFunscript(f.text);
      found[c.axis] = { path: c.path, text: f.text, sha256: f.sha256, parsed };
      if (parsed.notes.length) notes.push(`${fileName(c.path)}: ${parsed.notes.join('; ')}`);
    } catch (e) {
      unreadable.push({ path: c.path, sha256: f.sha256, error: e.message });
      notes.push(`${fileName(c.path)}: ${e.message} (not loaded)`);
    }
  }
  return { found, unreadable, notes, shadowed, others };
}

/** Session sha map entries for what discover() loaded: {pathKey: sha256}. A file that could not be parsed is left
 *  out on purpose, so a save over it is a conflict the user confirms (planWrites). */
export function shasFrom(found = {}) {
  const shas = {};
  for (const f of Object.values(found)) shas[pathKey(f.path)] = f.sha256;
  return shas;
}

/** Do two Scripts differ (by at and pos)? */
export function scriptsDiffer(a = [], b = []) {
  if (a === b) return false;
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (a[i].at !== b[i].at || a[i].pos !== b[i].pos) return true;
  return false;
}

/** Scene cuts from a file or a sidecar result, keeping only well-formed ones ({start_ms < end_ms}, finite); the old
 *  one-kind overrides (kind / sub / view) become tags (timeline/acts.js migrateScene). */
/** Valid scenes as the flat shot list (timeline/shots.js fromSaved: saved scenes with their shots, or an old flat list /
 *  a Detect scenes result migrated: acts.js migrateScene per entry, then linked / same-act neighbours joined into
 *  scenes); kind ('blank' | 'still') and transition (Detect scenes, PROTOCOL v4.5) are kept, a stored derived
 *  `structure` is dropped (acts.js withStructure recomputes it). */
export const cleanScenes = (a) => migrateDetail(fromSaved(a));   // paw-izk: an old shot Detail tolerance -> its shot override

/** null, false, '', [] and {} (recursively; a `v` version key does not count) hold nothing worth saving. */
const deepEmpty = (v) => v == null || v === false || v === '' || (Array.isArray(v) ? v.every(deepEmpty)
  : typeof v === 'object' ? Object.entries(v).every(([k, x]) => k === 'v' || deepEmpty(x)) : false);
/** An object without its entries that hold nothing (deepEmpty): what a block or extra key really carries. */
export const meaningful = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k, v]) => k !== AUTOSAVE_OF && !deepEmpty(v)));
// ghosts that are recomputed (previews) are never saved; a reference ghost is saved but reloads from its file; a run's
// secondary axes (kind 'axes', tracking/axes-derive.js) are derived again on demand
// 'checkpoint': a history entry shown to compare (paw-up1r stage 2), never part of the document
const PREVIEW_GHOST = new Set(['assist-preview', 'plan', 'graph', 'bridge-preview', 'autorange-preview', 'axes', 'checkpoint']);
// paw-wzxu: fx (the modifiers): a deleted modifier's run ghost (source.mod no longer a modifier) is not saved; it stays in memory, so an
// undo of the delete brings it back and the next save keeps it again
export const savedGhosts = (ghosts = [], fx = null) => {
  const mods = fx && new Set(fx.map((e) => e.id));
  return withoutGraphGhosts(ghosts.filter((g) => g.source !== 'device-preview' && !PREVIEW_GHOST.has(g.source?.kind) && !(mods && g.source?.kind === 'modrun' && g.source.mod && !mods.has(g.source.mod))));
};

/**
 * What only a .pawproj can hold (funscripts carry axes, chapters and bookmarks): -> names of the non-empty parts.
 * A save without a project must not report this data as saved.
 */
export function projectOnlyData(d) {
  const out = [];
  if (d.loops?.length) out.push('loops');
  if (d.plan?.length) out.push('plan');
  if (d.scenes?.length) out.push('scenes');
  if (d.fx?.length) out.push('modifiers');
  if (d.finish?.autorange) out.push('autorange');
  if (Object.keys(d.repeats?.loops || {}).length) out.push('loop frames');
  if (d.graphs?.length) out.push('graphs');
  if (savedGhosts(d.ghosts).some((g) => g.source?.kind !== 'reference')) out.push('tracker runs');
  const extra = d.project?.extra || {};
  for (const [k, v] of Object.entries(extra)) if (k !== AUTOSAVE_OF && !deepEmpty(v)) out.push(k === 'assist' ? 'assist answers' : k);
  return out;
}

export const refGhost = (path, script, visible, axis = 'stroke', id = 'ref') =>
  ({ id, name: 'Reference ' + fileName(path), color: REF_COLOR, script, visible, pinned: true, source: { kind: 'reference', path, axis } });

/** doc.files entries for loaded files (raw + meta keep unknown keys; script/chapters refs detect "unchanged"). */
export function filesFrom(found = {}, doc = null) {
  const files = {};
  for (const [axis, f] of Object.entries(found)) {
    files[axis] = { path: f.path, raw: f.parsed.raw, meta: f.parsed.meta, script: f.parsed.script, foreign: true, backedUp: false };
    if (axis === 'stroke') Object.assign(files[axis], { chapters: doc ? doc.chapters : f.parsed.meta.chapters, bookmarks: doc ? doc.bookmarks : f.parsed.meta.bookmarks });
  }
  return files;
}

/**
 * The document to app.load() after opening a video (or funscripts without one).
 * mode 'edit': found files become axes (+ chapters/bookmarks from the stroke file) and a hidden pinned reference
 * ghost of the original stroke; 'reference': axes empty, the stroke file (else the first found) as a visible pinned
 * ghost; 'ignore': nothing loaded.
 */
export function buildOpenDoc({ media = null, found = {}, mode = 'edit' }) {
  const doc = { media, axes: {}, chapters: [], bookmarks: [], loops: [], plan: [], ghosts: [], files: {} };
  const refAxis = found.stroke ? 'stroke' : Object.keys(found)[0];
  if (mode === 'edit') {
    for (const [axis, f] of Object.entries(found)) doc.axes[axis] = f.parsed.script;
    if (found.stroke) { doc.chapters = found.stroke.parsed.meta.chapters; doc.bookmarks = found.stroke.parsed.meta.bookmarks; }
    doc.files = filesFrom(found, doc);
    // paw-2pcf: axes embedded in the stroke file (funscript 1.1 axes[] / 2.0 channels{}) are axes too, unless a sibling file has
    // that axis (the sibling wins); the ones taken are dropped from the stroke file at its next save (they go to sibling files)
    const st = found.stroke?.parsed, used = Object.keys(st?.embedded || {}).filter((a) => !found[a]);
    for (const a of used) doc.axes[a] = st.embedded[a];
    if (doc.files.stroke && st?.meta.embedded) {
      const keep = st.meta.embedded.filter((e) => used.includes(e.axis)), { embedded: _, ...meta } = st.meta;   // eslint-disable-line no-unused-vars
      doc.files = { ...doc.files, stroke: { ...doc.files.stroke, meta: keep.length ? { ...meta, embedded: keep } : meta } };
    }
  }
  if (refAxis && mode !== 'ignore') doc.ghosts = [refGhost(found[refAxis].path, found[refAxis].parsed.script, mode === 'reference', refAxis)];
  return doc;
}

// ---------- projects and autosave ----------
/** app.doc (+ view/playhead) -> the doc shape lib/io project.js serializes; unknown keys ride in doc.project.extra. */
export function projectDoc(d, { view = null, playheadMs = null, blocks = null, blockKeys = null } = {}) {
  const p = d.project || {};
  // a registered block whose save() returned null is cleared, not left at the value loaded from the file
  const extra = { ...(p.extra || {}) };
  for (const k of blockKeys || []) delete extra[k];
  const pd = { media: d.media, axes: d.axes, activeAxis: d.activeAxis, chapters: d.chapters, bookmarks: d.bookmarks, loops: d.loops, plan: d.plan,
    // live previews are recomputed, never saved: the machine preview, the graph's output ghosts, savedGhosts' preview kinds
    ghosts: savedGhosts(d.ghosts, d.fx || []), extra: { ...extra, ...(blocks || {}), scenes: d.scenes?.length ? toSaved(d.scenes) : undefined, acts: d.scenes?.length || d.acts?.length ? d.acts || [] : undefined, modifiers: d.fx?.length ? d.fx : undefined, finish: d.finish || FINISH_SAVED, repeats: d.repeats || undefined, runRanges: d.runRanges ?? undefined, bakedEmpty: d.bakedEmpty?.length ? d.bakedEmpty : undefined }, meta: p.meta, settings: p.settings, profileId: p.profileId, view, playheadMs: playheadMs == null ? null : Math.round(playheadMs) };
  return graphsToProject(pd, d.graphs);
}

/** A parsed project (lib/io parse shape) -> app.load() shape. path: the .pawproj (or null); base: pseudo base of a video-less doc. */
export function appDocFrom(pd, { path = null, base = null } = {}) {
  const { graphs, extra: ex } = graphsFromProject(pd);
  // the shell's own blocks: detected / edited scene cuts, the modifiers (doc.fx), the finishing stack, the loop frames picked
  const { scenes = [], acts: savedActs, modifiers = [], fx: oldFx = [], finish: fin, repeats = null, runRanges = null, bakedEmpty = null, ...extra } = ex;
  const old = Number.isInteger(pd.meta?.migratedFrom) && pd.meta.migratedFrom < 3, flat = cleanScenes(scenes);
  // paw-8b4h: a modifier is never a scene tag; one left in a scene's tags (any version) goes to the modifiers on load
  const conv = old || flat.some((s) => s.tags?.some(isModTag)) ? modsFromV2(old ? oldFx : [], flat, old ? null : Array.isArray(modifiers) ? modifiers : []) : null;
  const fold = foldKinds(conv ? conv.fx : modifiers), mods = fold.fx, said = [conv?.note, fold.note].filter(Boolean).join('; ');
  // paw-2lp7.2: a project saved before action regions: its scenes make them (timeline/regions.js; the toast says how many)
  const shots = conv ? conv.scenes : flat, acts = Array.isArray(savedActs) ? savedActs : actsFromScenes(shots);
  return {
    media: pd.media, axes: pd.axes, activeAxis: pd.activeAxis, chapters: pd.chapters, bookmarks: pd.bookmarks, loops: pd.loops, plan: pd.plan,
    ghosts: withoutGraphGhosts(pd.ghosts), graphs, scenes: shots, acts, fx: Array.isArray(mods) ? mods.filter((e) => e && typeof e.id === 'string' && Number.isFinite(e.t0) && Number.isFinite(e.t1) && (e.t1 > e.t0 || (e.kind === 'spurt' && e.t1 === e.t0))).sort((a, b) => a.t0 - b.t0) : [],
    finish: fin && typeof fin === 'object' && !Array.isArray(fin) ? fin : undefined, runRanges: normRanges(runRanges), bakedEmpty: normEmpty(bakedEmpty), repeats: repeats && typeof repeats === 'object' && !Array.isArray(repeats) ? repeats : null,
    project: { path, base, extra, meta: pd.meta || null, settings: pd.settings || {}, profileId: pd.profileId ?? null, ...(said && { converted: said }), ...(!Array.isArray(savedActs) && acts.length && { regionsMade: acts.length }) },
  };
}

/**
 * paw-ef73.20, one-shot best effort for a project saved before modifiers (format < 3): its effects and modifier spans
 * become modifiers. An effect stays what it was ('throb' is 'throbbing'; a throb one-shot a one-beat throbbing range); a
 * span with an effect of its family at exactly its times (the old tie) IS that modifier; any other span becomes a muted
 * modifier (it was a mark without a shape: muted, it still feeds Autorange and the sidecar as before); the scene-level
 * insertion tag becomes a push (a knotting in mode 'none') over its span unless one is there. The spans and the
 * insertion tag leave the scenes. paw-8b4h: also for any project whose scenes still carry a modifier as a tag (a bare
 * 'orgasm' = the whole scene; a '-orgasm' removal only silenced the tagger's detection, which is a suggestion now: dropped);
 * `mods` = its modifiers block (kept, and one of the kind there is the tie). -> {fx, scenes, note: words for the toast | ''}.
 */
export function modsFromV2(oldFx = [], scenes = [], mods = null) {
  const FAM = { orgasm: ['orgasm'], knotting: ['knotting'], throbbing: ['throb', 'throbbing'], insertion: ['knotting'] };
  const own = Array.isArray(mods) ? mods.length : 0;
  const fx = [...(mods || []), ...(Array.isArray(oldFx) ? oldFx : []).filter((e) => e && typeof e.id === 'string' && Number.isFinite(e.t0) && Number.isFinite(e.t1)).map((e) => {
    if (e.kind !== 'throb') return e;
    return e.t1 > e.t0 ? { ...e, kind: 'throbbing' } : { ...e, kind: 'throbbing', ...singleThrob(e.t0, e.params) };
  })];
  let n = 0;
  scenes.forEach((s, i) => {
    if (s.join === true) return;
    let k = i;
    while (scenes[k + 1]?.join === true) k++;
    const a = s.start_ms, b = scenes[k].end_ms;
    for (const t of s.tags || []) {
      const id = typeof t === 'string' ? t : t?.id, t0 = Math.max(a, t?.t0 ?? a), t1 = Math.min(b, t?.t1 ?? b);
      if (!FAM[id] || !(t1 > t0)) continue;   // a span (or a bare id: the whole scene)
      const tied = fx.some((e, j) => FAM[id].includes(e.kind) && (id === 'insertion' || j < own ? e.t0 < t1 && e.t1 > t0 : e.t0 === t0 && e.t1 === t1));
      if (!tied) { fx.push(id === 'insertion' ? { id: `fx${id}${t0}`, kind: 'knotting', t0, t1, params: { ...KNOT_PUSH } } : { id: `fx${id}${t0}`, kind: id, t0, t1, params: {}, muted: true }); n++; }
    }
  });
  const out = stripMods(scenes).map((s) => {
    if (!s.tags?.some(isModTag)) return s;
    const { tags, ...rest } = s, keep = tags.filter((t) => !isModTag(t));
    return keep.length ? { ...rest, tags: keep } : rest;
  });
  const note = mods ? (n ? `made by an older version: ${n} scene tag${n === 1 ? '' : 's'} (orgasm, knotting …) ${n === 1 ? 'is a modifier' : 'are modifiers'} on the Modifiers row now, muted so it plays as before (unmute one to shape it)` : '')
    : fx.length ? `made by an older version: its ${fx.length} effects and modifier spans are modifiers now${n ? ` (${n} that had no shape are muted, so it plays as before; unmute one to shape it)` : ''}` : '';
  return { fx, scenes: out, note };
}
/** A scene tags entry that is a modifier (paw-8b4h: never a scene tag): 'orgasm', '-knotting', a {id: kind, t0, t1} span.
 *  'idle' as a plain id is the structure tag. */
export const isModTag = (t) => (typeof t === 'string' ? TAG[t.replace(/^-/, '')]?.cat === 'modifier' : EVENT_KINDS.includes(t?.id) || TAG[t?.id]?.cat === 'modifier');

/**
 * paw-ajvq, any project (no back-compat beyond this): the modifier kinds that are gone. An Insertion / Pull-out is a
 * knotting push / pull (mode 'none'; its from / to / push kept, arrive = popAt, the rest the push's defaults); a Climax
 * run-in is dropped (Reshape's depth band does it). -> {fx, note: words for the toast | ''}.
 */
export function foldKinds(list) {
  if (!Array.isArray(list)) return { fx: list, note: '' };
  let moved = 0, dropped = 0;
  const fx = list.flatMap((e) => {
    if (e?.kind === 'climax') { dropped++; return []; }
    if (e?.kind !== 'insertion' && e?.kind !== 'pullout') return [e];
    moved++;
    const { arrive, easeIn: _i, easeOut: _o, ...p } = e.params || {};
    return [{ ...e, kind: 'knotting', params: { ...(e.kind === 'pullout' ? KNOT_PULL : KNOT_PUSH), ...p, ...(arrive != null ? { popAt: arrive } : {}), mode: 'none' } }];
  });
  const note = [moved && `${moved} insertion / pull-out modifier${moved === 1 ? ' is a knotting push' : 's are knotting pushes'} now`,
    dropped && `${dropped} Climax run-in modifier${dropped === 1 ? '' : 's'} dropped (Reshape's depth band does it)`].filter(Boolean).join('; ');
  return moved || dropped ? { fx, note: `made by an older version: ${note}` } : { fx: list, note: '' };
}

/** Autosave content: the .pawproj text with ghost scripts (tracker runs survive a crash) and the doc's base. */
export function autosaveContent(d, { projectPath = null, base = '', view, playheadMs, now = Date.now(), blocks = null, blockKeys = null } = {}) {
  const pd = projectDoc(d, { view, playheadMs, blocks, blockKeys });
  return serializeProject({ ...pd, extra: { ...(pd.extra || {}), [AUTOSAVE_OF]: base || null } }, { projectPath, savedAt: new Date(now).toISOString(), ghostScripts: true });
}
/** Autosave text -> { pd (lib/io parse shape, AUTOSAVE_OF stripped), base, warnings }. Throws ProjectError. */
export function parseAutosave(text) {
  const warnings = [];
  const pd = parseProject(text, { lenient: true, warnings });
  const { [AUTOSAVE_OF]: base = null, ...extra } = pd.extra || {};
  return { pd: { ...pd, extra }, base, warnings };
}

/** Snapshots normally keep ghost scripts; an emptied reference ghost is reloaded from its file, other emptied ones dropped. */
export async function rehydrateGhosts(backend, ghosts) {
  const out = [];
  for (const g of ghosts || []) {
    if (g.script?.length) { out.push(g); continue; }
    if (g.source?.kind !== 'reference' || !g.source.path) continue;
    try { const f = await readMaybe(backend, g.source.path); if (f) out.push({ ...g, script: parseFunscript(f.text).script }); } catch { /* reference file gone: drop the ghost */ }
  }
  return out;
}

/**
 * The autosave candidate (backend.autosaveList entry with unsaved_work) for a document, newest first:
 * a project by project_path; an untitled doc by the AUTOSAVE_OF base inside its newest snapshot.
 * -> null | { cand, pd, base }
 */
export async function findCandidate(backend, { projectPath = null, base = '' }) {
  if (typeof backend.autosaveList !== 'function') return null;
  let list;
  try { list = await backend.autosaveList(); } catch { return null; }
  for (const cand of list) {
    if (!cand.unsaved_work || !cand.snapshots?.length) continue;
    if (projectPath ? !cand.project_path || pathKey(cand.project_path) !== pathKey(projectPath) : cand.project_path) continue;
    let s;
    try { s = parseAutosave(await backend.readText(cand.snapshots[0].path)); } catch { continue; }
    if (!projectPath && (!s.base || !base || pathKey(s.base) !== pathKey(base))) continue;
    return { cand, pd: s.pd, base: s.base };
  }
  return null;
}

// ---------- save / export ----------
/**
 * What a save writes for the axes: each NON-EMPTY axis to its file (doc.files[axis].path, else the sibling of
 * `base`), keeping the loaded file's unknown keys; chapters/bookmarks go into the stroke file's metadata.
 * doc: {axes, chapters, bookmarks, files, prov?}. prov = {project, how: {axis: how}, version?, now?}: every file written carries
 * metadata.pawscript (lib/provenance.js stamp). -> { items: [{axis, path, text, raw, script, unchanged}], empty: [paths left alone], skipped: [axis] }
 */
export function saveItems(doc, base) {
  const items = [], empty = [], skipped = [];
  for (const [axis, script] of Object.entries(doc.axes || {})) {
    const f = doc.files?.[axis];
    if (!script?.length) { if (f) empty.push(f.path); continue; }
    const path = f?.path || (base && axisName(axis) ? axisPath(base, axis) : null);
    if (!path) { skipped.push(axis); continue; }
    const stroke = axisName(axis) === 'stroke';
    const unchanged = !!f && f.script === script && !f.meta?.embedded?.length && (!stroke || (f.chapters === doc.chapters && f.bookmarks === doc.bookmarks));
    const raw = stampOf(doc.prov, axis, serializeFunscript({ script, meta: f?.meta, raw: f?.raw }, stroke ? { chapters: doc.chapters || [], bookmarks: doc.bookmarks || [] } : {}));
    items.push({ axis, path, text: JSON.stringify(raw), raw, script, unchanged });
  }
  return { items, empty, skipped };
}

const stampOf = (prov, axis, raw) => (prov ? stamp(raw, { ...prov, how: prov.how?.[axis] ?? null }) : raw);

/** Export items: the chosen axes through an export preset, into `dir` (else next to base). Written unless identical. */
export function exportItems(doc, { axes, base, dir = null, preset }) {
  const pick = Object.fromEntries(axes.filter((a) => doc.axes[a]?.length && axisName(a)).map((a) => [a, doc.axes[a]]));
  const scripts = buildExports(pick, preset);
  const at = dir ? joinPath(dir, fileName(base || 'untitled.mp4')) : base;
  return Object.entries(scripts).map(([axis, script]) => {
    const f = doc.files?.[axis], stroke = axisName(axis) === 'stroke';
    const raw = stampOf(doc.prov, axis, serializeFunscript({ script, meta: f?.meta, raw: f?.raw }, stroke ? { chapters: doc.chapters || [], bookmarks: doc.bookmarks || [] } : {}));
    return { axis, path: axisPath(at, axis), text: JSON.stringify(raw), raw, script, unchanged: false };
  });
}

/** Current disk state per target: {pathKey: {text, sha256} | null (absent/empty) | {error}}. */
export async function readCurrent(backend, paths) {
  const out = {};
  for (const p of paths) {
    try { out[pathKey(p)] = await readMaybe(backend, p); } catch (e) { out[pathKey(p)] = { error: e?.message || String(e) }; }
  }
  return out;
}

/**
 * Per item, what writing it takes (plus `expected`, the expectedSha256 to pass):
 *   create (nothing there) | skip (unchanged by us, or identical) | write (holds what we last read/wrote)
 *   conflict (not what we last saw there, or unreadable: confirm first)
 */
export function planWrites(items, current, shas) {
  return items.map((it) => {
    const k = pathKey(it.path), cur = current[k] ?? null;
    if (cur === null) return { ...it, action: 'create', expected: undefined };
    if (cur.error) return { ...it, action: 'conflict', expected: null, error: cur.error };
    if (it.unchanged || cur.text === it.text) return { ...it, action: 'skip' };
    return shas[k] && shas[k] === cur.sha256 ? { ...it, action: 'write', expected: cur.sha256 } : { ...it, action: 'conflict', expected: cur.sha256 };
  });
}

/** The `.pawscript` name for an axis file ('clip.roll.funscript' -> 'clip.pawscript.roll.funscript'); null if it already is one. */
export function altPathOf(path) {
  const a = parseAxisFile(path);
  if (!a || a.alt) return null;
  return joinPath(dirName(path), fileName(axisPath(a.base + '.x', a.axis, { alt: true })));
}

/**
 * Write a plan in order through backend.writeWithBackup. Stops at the first failure; updates `shas` for every
 * file written. Unresolved conflicts are refused.
 * -> { written: [item + {result}], backups: [first_backup paths], failed: null | {path, code, error} }
 */
export async function commitWrites(backend, plan, { shas, keep }) {
  const written = [], backups = [];
  for (const it of plan) {
    if (it.action === 'skip') continue;
    try {
      if (it.action === 'conflict') throw Object.assign(new Error('replacing it was not confirmed'), { code: 'conflict' });
      const result = await backend.writeWithBackup(it.path, it.text, { keep, expectedSha256: it.expected });
      shas[pathKey(it.path)] = result.sha256;
      if (result.first_backup) backups.push(result.first_backup);
      written.push({ ...it, result });
    } catch (e) {
      return { written, backups, failed: { path: it.path, code: e?.code || 'io', error: e?.message || String(e) } };
    }
  }
  return { written, backups, failed: null };
}

/**
 * The whole write pipeline for a save or an export.
 * ask(conflicts) -> 'replace' | 'alt' (axis files go to their .pawscript name) | 'cancel'.
 * -> { cancelled } | { written, backups, failed, plan }
 */
export async function writeFiles({ backend, items, shas, ask, keep = 10 }) {
  let plan = planWrites(items, await readCurrent(backend, items.map((i) => i.path)), shas);
  const conflicts = plan.filter((p) => p.action === 'conflict');
  if (conflicts.length) {
    const choice = await ask(conflicts);
    if (choice !== 'replace' && choice !== 'alt') return { cancelled: true };
    if (choice === 'alt') {
      const moved = plan.map((p) => (p.action === 'conflict' && p.axis && altPathOf(p.path) ? { ...p, path: altPathOf(p.path), unchanged: false } : p));
      const cur = await readCurrent(backend, moved.filter((p, i) => p !== plan[i]).map((p) => p.path));
      plan = moved.map((p, i) => (p !== plan[i] ? planWrites([p], cur, shas)[0] : p));
    }
    // confirmed: replace what the user was shown (writeWithBackup still refuses if it changes again; .bak first)
    plan = plan.map((p) => (p.action === 'conflict' ? { ...p, action: 'write', confirmed: true } : p));
  }
  return { ...(await commitWrites(backend, plan, { shas, keep })), plan };
}
