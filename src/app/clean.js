// clean.js -- File > Clean project (paw-zkvc), the pure part (test/clean.test.mjs): what Clean may remove, and what it
// says. The driver is clean.svelte.js. Clean removes what the app rebuilds by itself: the media cache entries of the
// project's video and its proxies (shell: media_cache_of / media_cache_remove_of), the project page's still of it, the
// shot-link scan results kept for it in IndexedDB. Never the video, the project, a .funscript, the backups, the
// autosaves or (paw-up1r) the checkpoint history; the tracker runs (.pawruns) only through the second command.

import { pathKey, fileName } from './project-logic.js';
import { fmtBytes } from './pack.js';

const LABEL = { scrub: 'scrub cache', proxy: 'proxy', remux: 'scrub copy', thumbs: 'filmstrip', peaks: 'waveform', frametimes: 'frame times',
  probe: 'video facts', repeats: 'repeated frames', still: 'project page still', scan: 'shot-link scan', runs: 'tracker run frames',
  runsold: 'old run versions' };   // paw-ee14: what no run and no history entry uses any more, dropped from the .pawruns
export const labelOf = (kind) => LABEL[kind] || kind;

/** [{kind, bytes}] -> the same per kind, biggest first. */
export function byKind(items) {
  const m = new Map();
  for (const it of items || []) if (it && it.bytes >= 0) m.set(it.kind, (m.get(it.kind) || 0) + it.bytes);
  return [...m].map(([kind, bytes]) => ({ kind, bytes })).sort((a, b) => b.bytes - a.bytes);
}

/** 'Freed 3.2 GB: scrub cache 2.6 GB, proxy 540 MB, waveform 120 KB' ('Nothing to free' when empty). */
export function freedText(items, verb = 'Freed') {
  const k = byKind(items), total = k.reduce((s, x) => s + x.bytes, 0);
  if (!k.length) return 'Nothing to free';
  return `${verb} ${fmtBytes(total)}: ${k.map((x) => `${labelOf(x.kind)} ${fmtBytes(x.bytes)}`).join(', ')}`;
}

/** The files Clean itself deletes (the shell removes the cache entries): the still when it is the app's own (under
 *  <data_dir>/thumbs), and with `runs` the project's .pawruns. Anything else is refused here, whatever asked for it. */
export function cleanFiles({ still = null, dataDir = '', runsFile = null, runs = false, keep = [] }) {
  const out = [], kept = new Set(keep.filter(Boolean).map(pathKey));
  const thumbs = pathKey(dataDir).replace(/\/+$/, '') + '/thumbs/';
  if (still && dataDir && pathKey(still).startsWith(thumbs) && !kept.has(pathKey(still))) out.push({ kind: 'still', path: still });
  if (runs && runsFile && /\.pawruns$/i.test(runsFile) && !kept.has(pathKey(runsFile))) out.push({ kind: 'runs', path: runsFile });
  return out.filter((f) => mayRemove(f.path, { runs, dataDir }));
}

/** The last word: never the video, a project, a funscript, an autosave, a backup, the history / checkpoints (<stem>.pawhistory, paw-up1r). */
export function mayRemove(path, { runs = false, dataDir = '' } = {}) {
  const k = pathKey(path), n = fileName(k), root = pathKey(dataDir).replace(/\/+$/, '');
  // paw-y2br: the app's own folders under its data folder, not any user folder of that name (D:/Projects/...); with no data
  // folder known, any folder of those names
  const own = root ? k.startsWith(root + '/') && /^(autosave|backups|checkpoints|history)\//.test(k.slice(root.length + 1)) : /\/(autosave|backups|checkpoints|history|projects)\//.test(k);
  if (/\.(funscript|pawproj|pawpack|bak)$/.test(n) || /\.pawhistory(\/|$)/.test(k) || own) return false;
  if (/\.pawruns$/.test(n)) return runs;
  return !!dataDir && k.startsWith(pathKey(dataDir).replace(/\/+$/, '') + '/thumbs/') && /\.jpg$/.test(n);
}

/** The menu tip: what Clean frees (estimate {items, runsBytes, shell}), and what the runs command loses. */
export function cleanTip(est, { runs = false } = {}) {
  if (est?.shell === false) return 'Needs an app restart / update: this build of the shell cannot clean one project yet';
  const what = runs
    ? 'Also removes every tracker run\'s frame data (the .pawruns goes to the Recycle Bin, or into the backups folder on a drive without one). The accepted script points stay as they are; changing anything derived from the runs (re-composing a shot, Adjust, groups, Fusion) needs re-tracking.'
    : 'Removes what this project keeps cached (scrub cache, proxies, filmstrip, waveform, scan results); it all rebuilds when needed. Never the video, the project, the .funscript files or the tracker runs.';
  if (!est?.items) return what;
  const items = runs && est.runsBytes ? [...est.items, { kind: 'runs', bytes: est.runsBytes }] : est.items;
  return `${freedText(items, 'Would free')}.\n${what}`;
}
