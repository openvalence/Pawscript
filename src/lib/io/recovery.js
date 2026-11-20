// Autosave snapshots, backup rotation and the recent-files list. Pure decisions only: the Rust side does the
// file operations (write the snapshot, list a folder, delete what rotateBackups says to delete).
import { toJSON, parse, ProjectError } from './project.js';

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
/** number (ms) | ISO string | Date -> ms; NaN if unusable. */
export const toMs = (t) => (typeof t === 'number' ? t : t instanceof Date ? t.getTime() : typeof t === 'string' ? Date.parse(t) : NaN);

// ---------- autosave snapshot ----------
export const SNAP_FORMAT = 'pawsnap', SNAP_VERSION = 1;

/**
 * Snapshot of a dirty document: { format, version, createdAt (ISO), projectPath|null, projectSavedAt|null, clean, project }
 * `project` is the full .pawproj object (selection excluded). `clean: true` marks a snapshot written right after
 * a save / at clean exit, which never needs recovery.
 * opts: { now (ms|ISO, default Date.now()), projectPath, projectSavedAt (the saved file's savedAt/mtime), clean, appVersion }
 */
export function makeSnapshot(doc, opts = {}) {
  const createdAt = new Date(opts.now ?? Date.now()).toISOString();
  return {
    format: SNAP_FORMAT, version: SNAP_VERSION, createdAt, projectPath: opts.projectPath ?? null,
    projectSavedAt: opts.projectSavedAt != null ? new Date(toMs(opts.projectSavedAt)).toISOString() : null,
    clean: !!opts.clean, project: toJSON(doc, { savedAt: createdAt, appVersion: opts.appVersion, projectPath: opts.projectPath }),
  };
}
export const serializeSnapshot = (snap) => JSON.stringify(snap);

/** text -> { meta: {createdAt, projectPath, projectSavedAt, clean}, doc }. Throws ProjectError. */
export function parseSnapshot(text, opts = {}) {
  let o;
  try { o = JSON.parse(text); } catch (e) { throw new ProjectError([{ path: '(snapshot)', message: 'not valid JSON: ' + e.message }]); }
  if (!isObj(o) || o.format !== SNAP_FORMAT) throw new ProjectError([{ path: 'format', message: `expected "${SNAP_FORMAT}", got ${JSON.stringify(o && o.format)}` }]);
  if (o.version !== SNAP_VERSION) throw new ProjectError([{ path: 'version', message: `unsupported snapshot version ${JSON.stringify(o.version)}` }]);
  if (!Number.isFinite(toMs(o.createdAt))) throw new ProjectError([{ path: 'createdAt', message: `expected an ISO date, got ${JSON.stringify(o.createdAt)}` }]);
  const doc = parse(JSON.stringify(o.project), { lenient: true, ...opts });
  return { meta: { createdAt: o.createdAt, projectPath: o.projectPath ?? null, projectSavedAt: o.projectSavedAt ?? null, clean: !!o.clean }, doc };
}

/**
 * Should the user be offered this snapshot on open?
 * projectInfo: null if there is no project file, else { mtimeMs } (or { savedAt }) of the saved project.
 * -> { recover: boolean, reason }. A clean snapshot never recovers; otherwise recover when there is no saved
 * project (unsaved work, or the file vanished) or the snapshot is more than slackMs newer than the saved file.
 */
export function shouldRecover(meta, projectInfo, { slackMs = 2000 } = {}) {
  if (meta.clean) return { recover: false, reason: 'snapshot was written after a clean save' };
  const snap = toMs(meta.createdAt);
  if (!Number.isFinite(snap)) return { recover: false, reason: 'snapshot has no valid date' };
  if (!projectInfo) return { recover: true, reason: meta.projectPath ? 'the project file is missing' : 'the project was never saved' };
  const saved = toMs(projectInfo.mtimeMs ?? projectInfo.savedAt);
  if (!Number.isFinite(saved)) return { recover: true, reason: 'the saved project has no readable date' };
  return snap > saved + slackMs ? { recover: true, reason: 'the autosave is newer than the saved project' } : { recover: false, reason: 'the saved project is as new as the autosave' };
}
export const isRecoveryNewer = (meta, projectMtimeMs, opts) => shouldRecover(meta, projectMtimeMs == null ? null : { mtimeMs: projectMtimeMs }, opts).recover;

// ---------- rolling backups ----------
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace('T', '-').replace('Z', '');   // 20261106T101500.123Z -> 20261106-101500.123
/** `<base>.<UTC stamp>.bak`, e.g. show.pawproj.20261106-101500.123.bak (sorts chronologically as text). */
export const backupName = (base, when) => `${base}.${stamp(toMs(when))}.bak`;
/** ms parsed from a backup name of `base`, or null when it is not one of ours. */
export function parseBackupName(name, base) {
  if (!name.startsWith(base + '.') || !name.endsWith('.bak')) return null;
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.(\d{3})$/.exec(name.slice(base.length + 1, -4));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]) : null;
}
/**
 * Which backups of `base` to keep: the newest `keep` (default 10, outline section 11). Names that are not
 * backups of `base` are ignored (never in `remove`). -> { keep: [...newest first], remove: [...] }
 */
export function rotateBackups(names, { base, keep = 10 } = {}) {
  const mine = names.map((n) => [n, parseBackupName(n, base)]).filter(([, t]) => t !== null).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1));
  const n = Math.max(0, keep);
  return { keep: mine.slice(0, n).map((x) => x[0]), remove: mine.slice(n).map((x) => x[0]) };
}

// ---------- recent files ----------
// entry: { path, name, kind: 'project'|'video'|'funscript', openedAt (ms), pinned: bool, missing: bool }
export const RECENT_CAP = 20;
const key = (p) => String(p).replace(/\\/g, '/').toLowerCase();   // Windows: case-insensitive, slash-agnostic

/** Most recent first: pinned entries on top (their own recency order), then the rest. Pure; returns a new list. */
const order = (list) => [...list.filter((e) => e.pinned), ...list.filter((e) => !e.pinned)];

/** Add or touch an entry (dedupe by normalised path, keeps its pin). Cap applies to unpinned entries only. */
export function addRecent(list, entry, { cap = RECENT_CAP, now = Date.now() } = {}) {
  const prev = list.find((e) => key(e.path) === key(entry.path));
  const e = { kind: 'project', pinned: false, ...prev, name: String(entry.path).split(/[\\/]/).pop(), ...entry, openedAt: now, missing: false };
  const rest = list.filter((x) => key(x.path) !== key(entry.path)).sort((a, b) => b.openedAt - a.openedAt);
  const all = order([e, ...rest]);
  let unpinned = 0;
  return all.filter((x) => x.pinned || ++unpinned <= cap);
}
export const pinRecent = (list, path, pinned = true) => order(list.map((e) => (key(e.path) === key(path) ? { ...e, pinned } : e)));
export const removeRecent = (list, path) => list.filter((e) => key(e.path) !== key(path));
/** Mark entries whose path is not in `existing` (a Set/array of paths, or a predicate) as missing; never drops them. */
export function markMissing(list, existing) {
  const has = typeof existing === 'function' ? existing : ((s) => (p) => s.has(key(p)))(new Set([...existing].map(key)));
  return list.map((e) => ({ ...e, missing: !has(e.path) }));
}
export const pruneMissing = (list) => list.filter((e) => !e.missing || e.pinned);
