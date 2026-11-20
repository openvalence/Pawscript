// pack.js -- File > Pack project (paw-2k9s): one .pawpack a friend opens in Pawscript (or unpacks with any zip tool):
// the video byte for byte, every axis as a standard .funscript named the way players expect beside the video, the
// .pawproj and its .pawruns, and the manifest. Format and privacy rules: docs/formats/pawpack.md. The bytes are streamed by the shell
// (src-tauri/src/pack.rs, backend.packWrite / packManifest / packUnpack), never through this heap except the runs (the
// same encode a save does). Everything above `packProject` is pure (test/pack.test.mjs).

import { fileName, dirName, stem, joinPath, pathKey, projectDoc, exportItems } from './project-logic.js';
import { serialize as serializeProject, BUILTIN_PRESETS, axisPath } from '../lib/io/index.js';
import { APP_VERSION, howOf } from '../lib/provenance.js';
import { finalAxes } from '../lib/finish.js';
import { encodeRunsAsync } from '../lib/runs-file.js';
import { scriptOf } from '../lib/script-of.js';   // paw-x7w7: baked + live

export const PACK_FORMAT = 'pawpack', PACK_VERSION = '1.0', PACK_MAJOR = 1, MANIFEST = 'pawpack.json';
export const isPackPath = (p) => /\.pawpack$/i.test(String(p || ''));
const errText = (e) => e?.message || String(e);

export function fmtBytes(n) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, x = Math.max(0, +n || 0);
  while (x >= 1000 && i < u.length - 1) { x /= 1024; i++; }
  return `${i ? (x < 10 ? x.toFixed(1) : Math.round(x)) : Math.round(x)} ${u[i]}`;
}

// ---------- paths and privacy ----------
// a whole string that is an absolute path: C:\..., C:/..., \\server\..., /Users/... (and the other usual unix homes)
const ABS = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]|\/\/[^/]|\/(?:Users|home|mnt|media|Volumes|private|tmp|var|opt|srv|root)\/)/i;
// an absolute path inside a longer string (a note, a message): up to the next space or quote
const EMBED = /(?:\b[A-Za-z]:[\\/]|\\\\[^\\/\s"']+[\\/])[^\s"'<>|?*]*/g;
const isAbs = (s) => typeof s === 'string' && ABS.test(s);

/** An absolute path -> the part under the first of `roots` that holds it ('/'-separated), else its file name. */
export function relName(p, roots = []) {
  const k = pathKey(p);
  for (const r of roots) {
    if (!r) continue;
    const rk = pathKey(r).replace(/\/+$/, '') + '/';
    if (k.startsWith(rk)) return String(p).replace(/\\/g, '/').slice(rk.length);
  }
  return fileName(p);
}

/** A copy of a JSON-like value with every absolute path made relative (relName); unchanged parts are the same objects.
 *  skip: keys left as they are (typed arrays, frame data). */
export function scrubPaths(v, roots = [], skip = null) {
  if (typeof v === 'string') return isAbs(v) ? relName(v, roots) : v.replace(EMBED, (m) => relName(m, roots));
  if (!v || typeof v !== 'object' || ArrayBuffer.isView(v)) return v;
  if (Array.isArray(v)) { let out = null; v.forEach((x, i) => { const y = scrubPaths(x, roots); if (y !== x) (out ??= v.slice())[i] = y; }); return out || v; }
  if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return v;   // Map, Set, class instances: not JSON
  let out = null;
  for (const [k, x] of Object.entries(v)) {
    if (skip?.has(k)) continue;
    const y = scrubPaths(x, roots);
    if (y !== x) (out ??= { ...v })[k] = y;
  }
  return out || v;
}

/** The user name a path under the user's home names ('C:\\Users\\Ann\\...' -> 'Ann'), else ''. */
export const userOf = (p) => /[\\/](?:Users|home)[\\/]([^\\/]+)/i.exec(String(p || ''))?.[1] || '';

/** What in `text` must not leave this machine: absolute paths, the user's home folder. -> ['why', ...] ([] = clean). */
export function privacyIssues(text, { user = '' } = {}) {
  const s = String(text), out = [];
  const m = /(?:^|[^A-Za-z0-9])([A-Za-z]:[\\/]+[^\s"'<>|?*\\/]*)/.exec(s) || /(\\\\[^\\/\s"']+\\)/.exec(s);
  if (m) out.push(`an absolute path (${m[1].slice(0, 24)}…)`);
  if (user && new RegExp(`(?:Users|home)(?:\\\\\\\\|\\\\|/)+${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'i').test(s)) out.push('the user folder');
  return out;
}

/** The JSON manifest of a .pawruns file's bytes (what privacyIssues reads; the frame sections are numbers). */
export function runsManifestText(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const n = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(8, true);
  return new TextDecoder().decode(u8.subarray(12, 12 + n));
}

// ---------- names and manifest ----------
/** Inside the pack, all at the root: the video under its own name, the scripts / project / runs named after it. */
export function packNames({ video = null, project = null } = {}) {
  const base = video ? fileName(video) : stem(fileName(project || 'untitled')) + '.pawproj';
  const s = stem(base);
  return { base, video: video ? base : null, project: s + '.pawproj', runs: s + '.pawruns', pack: s + '.pawpack' };
}

/** The manifest the shell completes (it adds `files`: name, role, size, sha256 per entry). */
export function buildManifest({ now = new Date(), commit = null, media = null, names, published = null }) {
  const m = media || {}, num = (x) => (Number.isFinite(x) && x > 0 ? x : null);
  return {
    format: PACK_FORMAT, version: PACK_VERSION, created: now.toISOString(),
    app: { name: 'Pawscript', version: APP_VERSION, commit: commit || null },
    video: names.video ? { name: names.video, durationMs: num(m.durationMs), fps: num(m.fps), width: num(m.width), height: num(m.height), size: num(m.size) } : null,
    project: names.project,
    // paw-up1r stage 2: the scripts in the pack are this published version (absent: never published, the current work)
    ...(published ? { published: { version: published.version, date: published.at ? new Date(published.at).toISOString() : null } } : {}),
    // a later version may carry this manifest and the scripts inside the video file instead (docs/formats/pawpack.md)
  };
}

/** The JS mirror of the shell's name check (pack.rs safe_name): relative, no '..', no drive, nothing Windows refuses. */
export function safeEntryName(name) {
  const s = String(name ?? '');
  if (!s || s.length > 400 || s.startsWith('/') || /[\\:<>"|?*\x00-\x1f]/.test(s)) return false;
  return s.split('/').every((p) => p && p !== '.' && p !== '..' && !/[. ]$/.test(p) && !/^(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/i.test(p));
}

/** A manifest read from a pack -> throws an Error with a plain message when it cannot be opened here. */
export function checkPackManifest(m) {
  if (m?.format !== PACK_FORMAT) throw new Error('not a Pawscript pack');
  const major = Number(String(m.version ?? '').split('.')[0]);
  if (!Number.isInteger(major)) throw new Error(`pack version ${JSON.stringify(m.version)} is not a version`);
  if (major > PACK_MAJOR) throw new Error(`made by a newer Pawscript (pack format ${m.version}), update Pawscript to open it`);
  const files = Array.isArray(m.files) ? m.files : [];
  for (const f of files) {
    if (!safeEntryName(f?.name)) throw new Error(`it names a file outside its folder (${JSON.stringify(f?.name)}): refused`);
    if (!/^[0-9a-f]{64}$/i.test(String(f.sha256 || ''))) throw new Error(`${f.name} has no checksum`);
  }
  if (!files.length) throw new Error('it lists no files');
  return m;
}

/** Where a pack unpacks: a folder named after it, beside it; ' (2)', ' (3)' ... when that name is taken. */
export function unpackDir(packPath, taken = () => false, parent = dirName(packPath)) {
  const s = stem(fileName(packPath));
  for (let i = 1; ; i++) { const d = joinPath(parent, i === 1 ? s : `${s} (${i})`); if (!taken(d)) return d; }
}

/** The published funscripts beside the video (the files Publish last wrote, doc.files), read from disk, named after the
 *  pack's base: [{name, raw}] ([] when one cannot be read: the caller falls back to the current work). */
export async function publishedScripts(be, files = {}, base) {
  const out = [];
  for (const [axis, f] of Object.entries(files || {})) {
    if (!f?.path) continue;
    let text = null;
    try { text = await be.readText(f.path); } catch { return []; }
    try { out.push({ name: axisPath(base, axis), raw: JSON.parse(text) }); } catch { return []; }
  }
  return out;
}

// ---------- the commands ----------
const RUN_TYPED = new Set(['samples', 'channels', 'confidence', 'points', 'points0', 'points0Primary', 'frames', 'lane']);
export const packReady = (app) => typeof app?.backend?.packWrite === 'function';
export const NEEDS_SHELL = 'Needs an app restart / update: this build of the shell cannot write packs yet';
export const PACK_TIP = 'One .pawpack file to share: the video as it is, every axis as a .funscript, the project and its tracker runs. Opens in Pawscript; any zip tool unpacks it.';

/** File > Pack project. -> bool */
export async function packProject(app) {
  const be = app.backend, d = app.doc, P = app.project;
  if (!packReady(app)) { app.toast(NEEDS_SHELL, 'warn'); return false; }
  if (P.busy) { app.toast('Busy: ' + P.busy, 'quiet'); return false; }
  const video = d.media?.path || null, names = packNames({ video, project: P.path || P.base });
  const where = dirName(video || P.path || P.base || '');
  const dest0 = await be.saveDialog({ title: 'Pack project', defaultPath: where ? joinPath(where, names.pack) : names.pack, filters: [{ name: 'Pawscript pack', extensions: ['pawpack'] }] });
  if (!dest0) return false;
  const dest = isPackPath(dest0) ? dest0 : dest0 + '.pawpack';
  P.busy = 'pack';
  let task = null, staged = null;
  try {
    const paths = await be.appPaths();
    const user = userOf(paths.data_dir) || userOf(paths.cache_dir);
    const roots = [dirName(P.path || ''), dirName(video || '')].filter(Boolean);
    const entries = [];
    if (video) entries.push({ name: names.video, role: 'video', path: video });
    // the scripts: the published version as it is beside the video (paw-up1r stage 2: never unpublished work); nothing ever
    // published: what Export writes (the final, provenance stamped). Named after the video
    const published = P.published ? await publishedScripts(be, d.files, names.base) : null;
    if (published?.length) for (const s of published) entries.push({ name: s.name, role: 'script', text: JSON.stringify(scrubPaths(s.raw, roots)) });
    else {
      const axes = finalAxes(app), list = Object.keys(axes).filter((a) => axes[a]?.length);
      const prov = { project: names.project, how: Object.fromEntries(Object.keys(d.axes).map((a) => [a, howOf({ base: scriptOf(app, a), ghosts: d.ghosts, axis: a, fx: d.fx })])) };
      const preset = BUILTIN_PRESETS.find((x) => x.id === 'as-is') || BUILTIN_PRESETS[0];
      for (const it of exportItems({ axes, chapters: d.chapters, bookmarks: d.bookmarks, files: d.files, prov }, { axes: list, base: names.base, dir: null, preset })) {
        entries.push({ name: it.path, role: 'script', text: JSON.stringify(scrubPaths(it.raw, roots)) });
      }
    }
    // the project, as a save writes it, its media path relative (the video sits beside it in the pack)
    const pd = projectDoc(d, { view: app.view, playheadMs: app.player?.timeMs, blocks: app.saveBlocks?.(), blockKeys: [...(app.blocks?.keys() || [])] });
    if (pd.media) { const { relativePath: _, proxyOf: __, ...m } = pd.media; pd.media = { ...m, path: names.video || m.name || '' }; }
    pd.ghosts = scrubPaths(pd.ghosts, roots);
    // paw-qf5o: the published version the pack carries (its scripts are the published ones): the unpacked project says so
    if (published?.length && P.published?.version) pd.extra = { ...(pd.extra || {}), published: { v: 1, ...P.published } };
    pd.extra = scrubPaths(pd.extra, roots);
    pd.settings = scrubPaths(pd.settings, roots);
    entries.push({ name: names.project, role: 'project', text: serializeProject(pd, { projectPath: names.project, ghostScripts: true }) });
    // the tracker runs, as a save writes them (current, saved or not), staged in the app cache for the shell to stream
    const { trackingFor } = await import('../features/tracking/tracking.svelte.js');
    const runs = trackingFor(app).runsToSave?.() || [];
    let runsText = '';
    if (runs.length) {
      const { bytes } = await encodeRunsAsync(runs.map((r) => scrubPaths(r, roots, RUN_TYPED)));
      runsText = runsManifestText(bytes);
      const dir = joinPath(paths.cache_dir, 'pack-staging');
      await be.makeDir(dir);
      staged = joinPath(dir, names.runs);
      await be.writeBytes(staged, bytes);
      entries.push({ name: names.runs, role: 'runs', path: staged });
    }
    const manifest = buildManifest({ commit: import.meta.env?.VITE_PAWSCRIPT_COMMIT, media: d.media, names, published: published?.length ? P.published : null });
    // nothing that names this machine's folders leaves it (the shell checks the computer name too)
    for (const [name, text] of [[MANIFEST, JSON.stringify(manifest)], ...entries.filter((e) => e.text).map((e) => [e.name, e.text]), ...(runsText ? [[names.runs, runsText]] : [])]) {
      const why = privacyIssues(text, { user });
      if (why.length) { app.toast(`Not packed: ${name} still names ${why.join(' and ')}, nothing written`, 'error', { timeout: 0 }); return false; }
    }
    let job = null;
    task = app.task?.('Pack project', { cancel: () => job?.cancel() });
    job = be.packWrite(dest, manifest, entries, { onProgress: (f) => task?.update(Math.round(f * 1000), 1000) });
    const res = await job.promise;
    app.usage?.note('project:pack', { mb: Math.round(res.size / 2 ** 20), files: entries.length + 1 });
    app.toast(`Packed ${fileName(res.path)} (${fmtBytes(res.size)})`, 'ok', { timeout: 10000, action: { label: 'Show in folder', run: () => be.reveal(res.path) } });
    return true;
  } catch (e) {
    if (e?.code === 'cancelled') app.toast('Pack canceled, nothing written', 'quiet');
    else app.toast(`Pack failed: ${errText(e)}, nothing written`, 'error', { timeout: 0 });
    return false;
  } finally {
    task?.end();
    if (staged) be.remove(staged).catch(() => {});
    P.busy = '';
  }
}

/** Open a .pawpack (File > Open, a drop, the project page): unpack beside it (or into a chosen folder when that is not
 *  writable), checksums checked by the shell, then open its project. -> bool */
export async function openPack(app, path) {
  const be = app.backend, P = app.project;
  if (typeof be.packManifest !== 'function') { app.toast(`Can't open ${fileName(path)}: opening packs needs an app restart / update`, 'warn'); return false; }
  if (P.busy) { app.toast('Busy: ' + P.busy, 'quiet'); return false; }
  let m;
  try { m = checkPackManifest(await be.packManifest(path)); }
  catch (e) { app.toast(`Can't open ${fileName(path)}: ${errText(e)}`, 'error', { timeout: 0 }); return false; }
  const exists = async (p) => { try { return !!(await be.stat(p))?.exists; } catch { return false; } };
  const pick = async (parent) => { const taken = new Set(); let d; for (;;) { d = unpackDir(path, (x) => taken.has(x), parent); if (!(await exists(d))) return d; taken.add(d); } };
  let dir = await pick(dirName(path)), files = null, task = null, job = null;
  P.busy = 'unpack';
  try {
    for (let tries = 0; tries < 2 && !files; tries++) {
      task = app.task?.(`Unpack ${fileName(path)}`, { cancel: () => job?.cancel() });
      try {
        job = be.packUnpack(path, dir, { onProgress: (f) => task?.update(Math.round(f * 1000), 1000) });
        files = await job.promise;
      } catch (e) {
        if (tries || !['protected', 'permission_denied'].includes(e?.code)) throw e;
        task?.end(); task = null;
        let to = await be.openDialog({ title: `Unpack ${fileName(path)} to`, directory: true, multiple: false });
        if (Array.isArray(to)) to = to[0];
        if (!to) return false;
        dir = await pick(to);
      } finally { task?.end(); task = null; }
    }
  } catch (e) {
    app.toast(e?.code === 'cancelled' ? 'Unpack canceled, nothing kept' : `Can't open ${fileName(path)}: ${errText(e)}, nothing kept`, e?.code === 'cancelled' ? 'quiet' : 'error', { timeout: e?.code === 'cancelled' ? undefined : 0 });
    return false;
  } finally { P.busy = ''; }
  app.usage?.note('project:unpack', { files: files.length });
  const byRole = (r) => m.files.filter((f) => f.role === r).map((f) => joinPath(dir, f.name));
  app.toast(`Unpacked ${fileName(path)} into ${dir}`, 'quiet');
  const proj = byRole('project')[0];
  return P.openPaths(proj ? [proj] : [...byRole('video'), ...byRole('script')]);
}
