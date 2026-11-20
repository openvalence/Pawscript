// home.js -- the project page's model (paw-xn04), pure so node can test it (test/app-home.test.mjs).
//
// Recents live where they always did (settings 'recent', lib/io recovery.js addRecent). An entry may now also carry
// `video` (a project's video), `summary` (summarize(): how far along it is, refreshed on open / save / autosave) and
// `thumb` / `thumbKey` / `thumbMs` (a JPEG in <data_dir>/thumbs, project.svelte.js). Unsaved work comes from the autosave
// folders themselves (backend.autosaveList, unsaved_work), so it is listed as long as its autosave exists: until it is
// saved or explicitly discarded, whatever the recents list says.

export const pathKey = (p) => String(p).replace(/\\/g, '/').toLowerCase();
const fileName = (p) => String(p).split(/[\\/]/).pop();
const isLink = (l) => l && Number.isFinite(l.t0) && Number.isFinite(l.t1);

/** Shots of a document (doc.scenes is the flat list of shots; join: true puts a shot in the scene before it). */
const shotsOf = (d) => (Array.isArray(d?.scenes) ? d.scenes.filter((s) => Number.isFinite(s?.start_ms) && Number.isFinite(s?.end_ms)) : []);
/** A shot is tracked when a scene link (tracking block `links`) covers most of it. */
const trackedBy = (links) => (s) => links.some((l) => Math.min(l.t1, s.end_ms) - Math.max(l.t0, s.start_ms) > (s.end_ms - s.start_ms) / 2);

/**
 * How far along a document is: {durationMs, scenes, shots, tracked, points, coverage (0..1 of the busy time, null when
 * unknown), axes: [axis ids with points]}. d: an app.doc (or appDocFrom of a snapshot); links: the `links` block
 * ({v, scenes: [...]}) when the caller has it, else d.project.extra.links. Busy time = the shots not tagged off-screen (no
 * shots: the whole video); covered = within it, the time between stroke points less than 2 s apart.
 */
export function summarize(d, { links = null } = {}) {
  const shots = shotsOf(d), L = ((links ?? d?.project?.extra?.links)?.scenes || []).filter(isLink);
  const axes = Object.entries(d?.axes || {}).filter(([, s]) => s?.length).map(([a]) => a);
  const stroke = d?.axes?.stroke || [], durationMs = d?.media?.durationMs || 0;
  const busy = shots.length ? shots.filter((s) => !(s.tags || []).includes('offscreen')).map((s) => [s.start_ms, s.end_ms]) : durationMs ? [[0, durationMs]] : [];
  const total = busy.reduce((n, [a, b]) => n + Math.max(0, b - a), 0);
  let covered = 0;
  for (let i = 1; i < stroke.length; i++) {
    const a = stroke[i - 1].at, b = stroke[i].at;
    if (b - a >= 2000) continue;
    for (const [s, e] of busy) covered += Math.max(0, Math.min(b, e) - Math.max(a, s));
  }
  return {
    durationMs, scenes: shots.filter((s, i) => i === 0 || !s.join).length, shots: shots.length, tracked: shots.filter(trackedBy(L)).length,
    points: Object.values(d?.axes || {}).reduce((n, s) => n + (s?.length || 0), 0), coverage: total ? Math.min(1, covered / total) : null, axes,
  };
}

/** The frame a card shows (ms): the middle of the first tracked shot, else of the first shot with stroke points, else
 *  10 % in (never the first, often black, frame). */
export function thumbTime(d, { links = null, durationMs = 0 } = {}) {
  const shots = shotsOf(d), L = ((links ?? d?.project?.extra?.links)?.scenes || []).filter(isLink), stroke = d?.axes?.stroke || [];
  const s = shots.find(trackedBy(L)) || shots.find((x) => stroke.some((p) => p.at >= x.start_ms && p.at < x.end_ms));
  if (s) return Math.round((s.start_ms + s.end_ms) / 2);
  const D = durationMs || d?.media?.durationMs || 0;
  return D ? Math.round(D * 0.1) : 1000;
}

/** Cache key of a card's thumbnail: the project (or video) path + the video's size and mtime, so a replaced video gets a new one. */
export function thumbKey(path, stat) {
  const s = `${pathKey(path)}|${stat?.size ?? ''}|${stat?.mtime_ms ?? ''}`;
  let h = 0x811c9dc5, g = 0x01000193;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 16777619); g = Math.imul(g ^ s.charCodeAt(i), 2246822519); }
  return (h >>> 0).toString(16).padStart(8, '0') + (g >>> 0).toString(16).padStart(8, '0');
}

/**
 * The cards, most recent first (pinned on top). recent: settings 'recent' entries; autosaves: the unsaved autosave
 * candidates, each {id, project_path, base (the video / funscript an untitled one belongs to), title, updated_ms,
 * summary?, video?}. A video entry that a project card already shows is folded into it unless it has unsaved work
 * of its own. Every unsaved autosave is a card: matched to its entry (project path, else base) or on its own.
 * -> [{key, path, kind: 'project' | 'video' | 'funscript' | 'unsaved', name, video, openedAt, pinned, missing, summary,
 *      thumb, thumbKey, autosave: candidate | null, unsaved: bool (no saved project: 'not saved yet')}]
 */
export function homeCards(recent = [], autosaves = []) {
  const K = pathKey, used = new Set(), out = [];
  const projVideos = new Set(recent.filter((e) => e.kind === 'project' && e.video).map((e) => K(e.video)));
  const mine = (e) => (c) => !used.has(c.id) && (e.kind === 'project' ? !!c.project_path && K(c.project_path) === K(e.path) : !c.project_path && !!c.base && K(c.base) === K(e.path));
  for (const e of recent) {
    if (!e || typeof e.path !== 'string') continue;
    const a = autosaves.find(mine(e)) || null;
    if (e.kind !== 'project' && projVideos.has(K(e.path)) && !a) continue;
    if (a) used.add(a.id);
    const video = e.kind === 'project' ? e.video || a?.video || null : e.kind === 'video' ? e.path : null;
    out.push({ ...e, key: K(e.path), name: fileName(video || e.path), video, autosave: a, unsaved: e.kind !== 'project' && !!a,
      summary: e.summary || a?.summary || null, openedAt: Math.max(e.openedAt || 0, a?.updated_ms || 0) });
  }
  for (const a of autosaves) {
    if (used.has(a.id)) continue;
    const path = a.project_path || a.base || null, video = a.video || (a.base && !/\.funscript$/i.test(a.base) ? a.base : null);
    out.push({ key: 'autosave:' + a.id, path, kind: a.project_path ? 'project' : 'unsaved', name: fileName(video || path || a.title || 'Untitled'), video,
      openedAt: a.updated_ms || 0, pinned: false, missing: false, summary: a.summary || null, autosave: a, unsaved: !a.project_path });
  }
  return out.sort((x, y) => (!!y.pinned - !!x.pinned) || y.openedAt - x.openedAt);
}

/** The state line of a card, as short phrases: ['12 scenes', '8 / 30 shots tracked', '1,204 points', '64 % covered', 'stroke + roll']. */
export function stateLine(s) {
  if (!s) return [];
  const n = (v) => v.toLocaleString('en-US'), pl = (v, w) => `${n(v)} ${w}${v === 1 ? '' : 's'}`, out = [];
  if (s.scenes) out.push(pl(s.scenes, 'scene'));
  if (s.shots) out.push(`${s.tracked} / ${s.shots} shots tracked`);
  out.push(s.points ? pl(s.points, 'point') : 'no points yet');
  if (s.points && s.coverage != null) out.push(`${Math.round(s.coverage * 100)} % covered`);
  if (s.axes?.length) out.push(s.axes.length === 1 ? `${s.axes[0]} only` : s.axes.join(' + '));
  return out;
}

/** '3 min ago', '5 h ago', 'yesterday', '12 days ago', or a date. */
export function ago(ms, now = Date.now()) {
  const m = Math.round((now - ms) / 60000);
  if (!ms) return '';
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  if (m < 2880) return 'yesterday';
  if (m < 60 * 24 * 60) return `${Math.round(m / 1440)} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
/** A folder shortened for a card: its last two parts with the drive ('W:\…\Videos\set'). */
export function shortDir(p) {
  const parts = String(p || '').split(/[\\/]/).slice(0, -1).filter(Boolean);
  if (parts.length <= 3) return parts.join('\\');
  return `${parts[0]}\\…\\${parts.slice(-2).join('\\')}`;
}
export { fmtDuration } from '../lib/time-format.js';   // a video's length (paw-p8o2: one form per kind)
