// Multi-axis sibling file naming, both directions. Pure string work: the caller supplies directory listings.
//   video.mp4 + 'stroke' -> video.funscript        video.mp4 + 'roll' -> video.roll.funscript
// App axis ids are the AXES names ('stroke', 'roll', 'pitch', 'twist', 'surge', 'sway', 'vib', ...); T-code ids
// ('L0', 'R1', ...) are accepted anywhere and mapped to the name. Reuses funscript.js axisOf / AXES.
import { AXES, axisOf } from '../funscript.js';

const NAME = { L0: 'stroke', L1: 'surge', L2: 'sway', R0: 'twist', R1: 'roll', R2: 'pitch', V0: 'vib', A0: 'valve', A1: 'suck', A2: 'lube', V8: 'v8', V9: 'v9' };
export const ALT_TAG = 'pawscript';   // matches runs.js exportTarget: <name>.pawscript.funscript

/** 'R1' | 'roll' | 'Roll' | '' -> 'roll'; null if not a known axis. */
export function axisName(id) {
  const code = AXES[String(id ?? '').toLowerCase()];
  return code ? NAME[code] : null;
}

const norm = (p) => String(p).replace(/\\/g, '/');
const dirOf = (p) => { const s = norm(p), i = s.lastIndexOf('/'); return i < 0 ? '' : s.slice(0, i); };
const fileOf = (p) => norm(p).split('/').pop();
const stemOf = (name) => name.replace(/\.[^.]*$/, '');

/** Path of an axis file next to the video. opts.alt -> the `.pawscript` variant (never overwrites the user's file). */
export function axisPath(videoPath, axis, { alt = false } = {}) {
  const name = axisName(axis);
  if (!name) throw new Error(`unknown axis "${axis}"`);
  const base = String(videoPath).replace(/\.[^.\\/]+$/, '');
  return base + (alt ? '.' + ALT_TAG : '') + (name === 'stroke' ? '' : '.' + name) + '.funscript';
}

/** { axisName: path } for several axes. */
export const axisPaths = (videoPath, axes, opts) => Object.fromEntries(axes.map((a) => [axisName(a), axisPath(videoPath, a, opts)]));

/** Inverse of axisPath: 'a/b/video.roll.funscript' -> { base: 'a/b/video', axis: 'roll', alt: false }; null if not a funscript. */
export function parseAxisFile(path) {
  const ax = axisOf(fileOf(path));
  if (!ax) return null;
  let base = ax.base, alt = false;
  const tag = '.' + ALT_TAG;
  if (base.toLowerCase().endsWith(tag)) { base = base.slice(0, -tag.length); alt = true; }
  const dir = dirOf(path);
  return { base: dir ? dir + '/' + base : base, axis: NAME[ax.axis], alt };
}

/**
 * Which sibling axis files exist for a video, given a directory listing (names or full paths).
 * Matching is case-insensitive on the stem and, if the listing has directories, on the directory.
 * -> { found: {axis: {path, alt}}, alternates: {axis: [{path, alt}]}, other: [paths of unrelated funscripts] }
 * `found` prefers the plain name over the `.pawscript` variant; the loser goes to `alternates`.
 */
export function discoverAxes(videoPath, listing) {
  const stem = stemOf(fileOf(videoPath)).toLowerCase(), dir = dirOf(videoPath).toLowerCase();
  const found = {}, alternates = {}, other = [];
  const entries = [];
  for (const p of listing) {
    const ax = parseAxisFile(p);
    if (!ax) continue;
    const sameDir = !dirOf(p) || !dir || dirOf(p).toLowerCase() === dir;
    if (sameDir && fileOf(ax.base).toLowerCase() === stem) entries.push({ axis: ax.axis, path: p, alt: ax.alt }); else other.push(p);
  }
  entries.sort((a, b) => a.alt - b.alt || (a.path < b.path ? -1 : 1));
  for (const e of entries) {
    const entry = { path: e.path, alt: e.alt };
    if (found[e.axis]) (alternates[e.axis] ||= []).push(entry); else found[e.axis] = entry;
  }
  return { found, alternates, other };
}

/** Per-axis export targets, same policy as runs.js exportTarget: never replace an existing file unless overwrite. */
export function exportTargets(videoPath, axes, existingPaths = [], overwrite = false) {
  const have = new Set(existingPaths.map((p) => norm(p).toLowerCase()));
  return Object.fromEntries(axes.map((a) => {
    const orig = axisPath(videoPath, a), exists = have.has(norm(orig).toLowerCase());
    const alt = exists && !overwrite, script = alt ? axisPath(videoPath, a, { alt: true }) : orig;
    return [axisName(a), { script, bak: script + '.bak', orig, alt }];
  }));
}
