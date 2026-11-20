// clean.svelte.js -- File > Clean project / Clean project and remove tracker runs (paw-zkvc): the driver. What may be
// removed and what is said: clean.js. The menu tip shows what would be freed: `estimateOf(app)`, refreshed (at most every few
// seconds) when the File menu asks whether the command is enabled.

import { cleanFiles, freedText } from './clean.js';
import { pathKey } from './project-logic.js';
import { runsPath } from '../lib/runs-file.js';

// per app (each tab's own document: one tab's estimate never shows on another's menu)
const estimates = new WeakMap(), ats = new WeakMap();   // ats: not state, written from a when (read while a menu renders)
const blank = $state({ shell: null, items: null, runsBytes: 0 });
/** What Clean would free in this app's document: {shell, items, runsBytes}. */
export function estimateOf(app) {
  if (!app) return blank;
  let e = estimates.get(app);
  if (e) return e;
  const fresh = $state({ shell: null, items: null, runsBytes: 0 });
  estimates.set(app, fresh);
  return fresh;
}
const STALE_MS = 4000;
const errText = (e) => e?.message || String(e);
const SCAN_DB = 'pawscript-shot-scan';   // features/tracking/shot-scan.js: key `${alg}|${video path}|${w}x${h}`

/** The files the open project's media cache entries are made from: the video and its proxies. */
function sources(app) {
  const v = app.doc.media?.path, p = app.player;
  return [...new Set([v, p?.media?.proxyOf ? p.media.path : null, ...Object.values(p?.proxies || {})].filter(Boolean))];
}
function recentEntry(app) {
  const key = app.project?.path || app.doc.media?.path, list = app.settings.get('recent');
  return key && Array.isArray(list) ? list.find((e) => e && pathKey(e.path || '') === pathKey(key)) : null;
}
async function size(be, p) { try { const s = await be.stat(p); return s?.exists ? s.size || 0 : 0; } catch { return 0; } }

/** The shot-link scan entries of `video` in IndexedDB: delete them (dry: count them). -> count */
function scanEntries(video, { dry = false } = {}) {
  if (!video || typeof indexedDB === 'undefined') return Promise.resolve(0);
  return new Promise((res) => {
    try {
      const q = indexedDB.open(SCAN_DB, 1);
      q.onupgradeneeded = () => q.result.createObjectStore('v');
      q.onerror = () => res(0);
      q.onsuccess = () => {
        const db = q.result, tx = db.transaction('v', dry ? 'readonly' : 'readwrite'), store = tx.objectStore('v'), mid = `|${video}|`;
        let n = 0;
        store.openKeyCursor().onsuccess = (e) => { const c = e.target.result; if (!c) return; if (String(c.key).includes(mid)) { n++; if (!dry) store.delete(c.key); } c.continue(); };
        tx.oncomplete = () => { db.close(); res(n); };
        tx.onerror = tx.onabort = () => { db.close(); res(n); };
      };
    } catch { res(0); }
  });
}

/** Re-reads what Clean would free (never more often than every few seconds). Called from the commands' `when`. */
export function refreshEstimate(app, force = false) {
  const now = Date.now();
  if (!force && now - (ats.get(app) || 0) < STALE_MS) return;
  ats.set(app, now);
  const estimate = estimateOf(app);
  queueMicrotask(async () => {
    const be = app.backend;
    if (typeof be.mediaCacheOf !== 'function') { estimate.shell = false; return; }
    try {
      const items = [...(await be.mediaCacheOf(sources(app)))];
      const still = recentEntry(app)?.thumb;
      if (still) items.push({ kind: 'still', bytes: await size(be, still) });
      const proj = app.project?.path;
      const runsBytes = proj ? await size(be, runsPath(proj)) : 0;
      Object.assign(estimate, { shell: true, items, runsBytes });
    } catch { estimate.items = null; }
  });
}

/** Clean project: removes the open project's cached data; with `runs` its tracker runs' frame data too. -> bool */
export async function cleanProject(app, { runs = false } = {}) {
  const be = app.backend, P = app.project, player = app.player, video = app.doc.media?.path || null;
  if (typeof be.mediaCacheRemoveOf !== 'function') { app.toast('Clean project needs a newer app version: restart or update Pawscript', 'warn'); return false; }
  if (P.busy) { app.toast('Busy: ' + P.busy, 'quiet'); return false; }
  P.busy = 'clean';
  const freed = [], kept = [], notes = [];
  try {
    const srcs = sources(app);
    // let go of the cached files in use: a proxy playing goes back to the original, hover scrub to the source
    const h = player?.media?.proxyOf ? player.media.proxyH : 0;
    if (h) await player.useProxy(0);
    player?.scrubCacheCleared?.();
    const r = await be.mediaCacheRemoveOf(srcs);
    freed.push(...r.freed); kept.push(...r.kept);
    if (player) { player.proxies = {}; if (h) player.proxyLost = h; }

    const { data_dir: dataDir } = await be.appPaths();
    const rec = recentEntry(app), proj = P.path;
    const files = cleanFiles({ still: rec?.thumb, dataDir, runsFile: proj ? runsPath(proj) : null, runs, keep: [video, proj] });
    for (const f of files.filter((x) => x.kind === 'still')) {
      const bytes = await size(be, f.path);
      try { await be.remove(f.path); freed.push({ kind: 'still', bytes }); } catch { /* gone already */ }
      app.settings.set('recent', app.settings.get('recent').map((e) => (pathKey(e?.path || '') === pathKey(rec.path) ? (({ thumb: _, thumbKey: __, thumbMs: ___, ...x }) => x)(e) : e)));
    }
    const scans = await scanEntries(video);
    if (scans) freed.push({ kind: 'scan', bytes: 0 });
    // paw-ee14: the copy-on-write runs file written whole, without the run versions nothing uses any more
    if (!runs) { const old = await Promise.resolve(app.blocks?.get('runs')?.compact?.()).catch(() => 0); if (old > 0) freed.push({ kind: 'runsold', bytes: old }); }

    if (runs) {
      const { trackingFor } = await import('../features/tracking/tracking.svelte.js');
      const t = trackingFor(app), file = files.find((x) => x.kind === 'runs');
      await t.runsLoad;
      // paw-up1r: the project as it was, in its history (the runs' frames go to the Recycle Bin below); paw-f4i2: no checkpoint, no clean
      if (proj && P.checkpoint && !(await P.checkpoint('Before clean'))) throw new Error('the checkpoint before it could not be written, nothing of the runs was removed');
      if (file && (await size(be, file.path))) {
        const bytes = await size(be, file.path), where = await be.removeRecoverably(file.path);
        freed.push({ kind: 'runs', bytes });
        notes.push(where === 'recycle-bin' ? 'The old .pawruns is in the Recycle Bin.' : `The old .pawruns was moved to ${where}.`);
        // paw-lacf: what "remove tracker runs" keeps, said (the list still shows them; a small .pawruns is written at once)
        notes.push('The runs stay in the project with their points and channels; only their frame data is gone (re-track a shot to rebuild it).');
      }
      // frames gone from every run (unapplied and applied alike); the points, channels and ghosts stay
      const strip = (list) => list.map((x) => (x.frames ? { ...x, frames: null } : x));
      t.runs = strip(t.runs); t.fileRuns = strip(t.fileRuns || []);
      t.runsDirty = true;
      if (proj) await t.saveRunsFile(proj);   // the runs without frames, at once: the project stays whole on disk
    }
    app.usage?.note('project:clean', { runs, mb: Math.round(freed.reduce((s, x) => s + x.bytes, 0) / 2 ** 20), kept: kept.length });
    if (kept.length) notes.push(`${freedText(kept, 'Kept (still open)')}.`);
    app.toast(`${freedText(freed)}${scans ? ` (and ${scans} shot-link scan${scans === 1 ? '' : 's'})` : ''}.${notes.length ? '\n' + notes.join('\n') : ''}`, 'ok', { timeout: 8000 });
    return true;
  } catch (e) {
    app.toast(`Clean project stopped: ${errText(e)}${freed.length ? `. ${freedText(freed)} before that` : ''}`, 'error', { timeout: 0 });
    return false;
  } finally {
    P.busy = '';
    refreshEstimate(app, true);
  }
}
