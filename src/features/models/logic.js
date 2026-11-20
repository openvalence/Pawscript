// logic.js -- paw-cdot: the downloader's model, pure (test/models-logic.test.mjs). The manifest (manifest.json, built by
// dev/share/build-models.ps1 and compiled in; a newer one may be fetched from the server when the user asks) lists the
// runtime and the models with every file's size and SHA-256; the shell (src-tauri/src/models.rs) says what is on the
// disk; this file turns the two into a state per row and the words for it.
//
// States: 'installed' | 'missing' (none or some of its files) | 'damaged' (a size that is wrong, or a hash Verify found
// wrong) | 'update' (the files of the compiled manifest are there, the fetched one has newer ones).

/** The models server: ONE place (OpenValence's R2 bucket behind its own domain). The setting models.baseUrl and
 *  PAWSCRIPT_MODELS_URL may change the folder, not the host: the shell downloads only from MODELS_HOST (or this PC, for
 *  tests; src-tauri/src/models.rs ALLOWED_HOST). */
export const MODELS_HOST = 'dl.openvalence.org';
export const MODELS_BASE_URL = `https://${MODELS_HOST}/pawscript/v1/`;
export const MANIFEST_KIND = 'pawscript.models/1';

/** The address in use: the env var, else the setting, else the default. */
export const baseUrl = ({ env, setting } = {}) => (env || '').trim() || (setting || '').trim() || MODELS_BASE_URL;

/** A manifest path the shell will accept (src-tauri pack::safe_name): relative, '/'-separated, no '..', no drive. */
export function safePath(p) {
  if (typeof p !== 'string' || !p || p.length > 400 || p.startsWith('/') || /[\\:<>"|?*\x00-\x1f]/.test(p)) return false;
  return p.split('/').every((s) => s && s !== '.' && s !== '..' && !/[. ]$/.test(s) && !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s));
}
const hex64 = (h) => typeof h === 'string' && /^[0-9a-f]{64}$/i.test(h);
const https = (u) => typeof u === 'string' && /^https:\/\/[^\s/]+/.test(u);

/** Manifest text or object -> {models} (checked); throws with what is wrong. A manual model needs no url, a hosted one
 *  needs a url and a SHA-256 for every file; licenceUrl / downloadPage must be https. */
export function parseManifest(m) {
  const o = typeof m === 'string' ? JSON.parse(m) : m;
  if (!o || o.kind !== MANIFEST_KIND || !Array.isArray(o.models)) throw new Error('not a Pawscript models manifest');
  const ids = new Set();
  for (const x of o.models) {
    const why = (w) => { throw new Error(`model ${x?.id || '?'}: ${w}`); };
    if (!x || typeof x.id !== 'string' || !x.id || ids.has(x.id)) why('no id, or the id twice');
    ids.add(x.id);
    if (!Array.isArray(x.files) || !x.files.length) why('no files');
    const manual = x.source === 'manual';
    if (manual && !https(x.downloadPage)) why('a manual model needs its download page');
    if (x.licenceUrl && !https(x.licenceUrl)) why('licenceUrl is not https');
    for (const f of x.files) {
      if (!safePath(f?.path)) why(`unsafe path ${JSON.stringify(f?.path)}`);
      if (!(Number.isSafeInteger(f.bytes) && f.bytes > 0)) why(`${f.path}: no size`);
      if (!manual && (!hex64(f.sha256) || typeof f.url !== 'string' || !f.url)) why(`${f.path}: no SHA-256 or url`);
    }
  }
  return o;
}

export const isRuntime = (m) => m?.kind === 'runtime';
export const isManual = (m) => m?.source === 'manual';
const sameFiles = (a, b) => a.files.length === b.files.length && a.files.every((f, i) => f.path === b.files[i].path && f.sha256 === b.files[i].sha256);

/** The rows: the compiled manifest's models, each replaced by the fetched one's of the same id (old: the compiled entry
 *  when its files differ), plus models only the fetched one has. The runtime is never taken from a fetched manifest: the
 *  compiled one pins what this build needs. -> [{model, old?}] */
export function rows(embedded, fetched = null) {
  const byId = new Map((fetched?.models || []).filter((m) => !isRuntime(m)).map((m) => [m.id, m]));
  const out = embedded.models.map((m) => {
    const f = !isRuntime(m) && byId.get(m.id);
    byId.delete(m.id);
    return f && !sameFiles(f, m) ? { model: f, old: m } : { model: m };
  });
  for (const m of byId.values()) out.push({ model: m });
  return out;
}

/** One file: facts {exists, bytes, part} (the shell's scan), verified: its SHA-256 from Verify / an import, if known. */
export function fileState(f, fact, verified, { manual = false } = {}) {
  if (!fact?.exists) return 'missing';
  if (verified && f.sha256) return verified === f.sha256 ? 'installed' : manual ? 'installed' : 'damaged';
  if (fact.bytes !== f.bytes && !manual) return 'damaged';
  return 'installed';
}

/** A model's state from its files' (see the top). facts / verified: {path: ...}. */
export function modelState(m, facts = {}, verified = {}) {
  const st = m.files.map((f) => fileState(f, facts[f.path], verified[f.path], { manual: isManual(m) }));
  if (st.every((s) => s === 'missing')) return 'missing';
  if (st.includes('damaged')) return 'damaged';
  return st.includes('missing') ? 'missing' : 'installed';
}

/** A row's state: 'update' when the compiled entry's files are there and the fetched entry's are not. */
export function rowState(row, facts, verified) {
  const s = modelState(row.model, facts, verified);
  return s !== 'installed' && row.old && modelState(row.old, facts, verified) === 'installed' ? 'update' : s;
}

/** A manual model brought in another version than the one tested (an import said so). */
export const otherVersion = (m, verified = {}) => isManual(m) && m.files.some((f) => verified[f.path] && f.sha256 && verified[f.path] !== f.sha256);

/** The files of a model still to fetch (not installed), and their bytes less any finished part. */
export function toFetch(m, facts = {}, verified = {}) {
  const files = m.files.filter((f) => fileState(f, facts[f.path], verified[f.path]) !== 'installed');
  return { files, bytes: files.reduce((n, f) => n + Math.max(0, f.bytes - (facts[f.path]?.exists ? 0 : facts[f.path]?.part || 0)), 0) };
}

/** The runtime: needed when this is the shared build and no runtime archive waits beside the exe, and the unpacked runtime
 *  is missing or another version than the compiled manifest pins. rt: the shell's runtime_status. */
export function runtimeNeeded(rt, entry) {
  if (!rt?.portable || !entry || rt.zip) return false;
  return !rt.python || (entry.version || '').trim() !== (rt.installed || '').trim();
}

/** Every required model (not the runtime) usable: installed, or installed in its compiled version ('update'). */
export const modelsReady = (list, facts, verified) => list.filter((r) => r.model.required && !isRuntime(r.model)).every((r) => ['installed', 'update'].includes(rowState(r, facts, verified)));

/** Which model and file a brought file is (by its name): within `only` (a row's id) or any. -> {model, file} | null */
export function matchFile(list, name, only = null) {
  const n = String(name).split(/[\\/]/).pop().toLowerCase();
  for (const { model } of list) {
    if (isRuntime(model) || (only && model.id !== only)) continue;
    const f = model.files.find((x) => x.path.split('/').pop().toLowerCase() === n);
    if (f) return { model, file: f };
  }
  return null;
}

/** 1.2 GB / 340 MB; a few bytes are 1 KB, none are 0 KB. */
export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '?';
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${n > 0 ? Math.max(1, Math.round(n / 1e3)) : 0} KB`;
}

export const STATE_WORDS = { installed: 'Installed', missing: 'Not downloaded', damaged: 'Damaged', update: 'Update available' };

/** The words for a shell error ({code, message}): its message says what to do (models.rs), a cancel says it resumes. */
export const errorWords = (e) => (e?.code === 'cancelled' ? 'Cancelled: Download carries on where it stopped' : e?.message || String(e || 'It did not work'));
