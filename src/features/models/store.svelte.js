// store.svelte.js -- paw-cdot: the downloader's state and actions, one for the window (the models folder is the app's,
// not a tab's). `app` is anything with {backend, settings} (a tab's app, or the first-start screen's small stand-in).
// Every network call starts from a user's click: Download, Check for model updates (and the app's first start screen's
// Download). The rest (what is on the disk) is read locally.
import embedded from './manifest.json';
import { parseManifest, rows, toFetch, baseUrl, runtimeNeeded, modelsReady, matchFile, errorWords, isRuntime, isManual, isHosted, otherVersion, fmtBytes, chooseRuntime, rateMeter, runtimeThere, RUNTIME_WORDS } from './logic.js';

export const EMBEDDED = parseManifest(embedded);
const entryOf = (id) => EMBEDDED.models.find((m) => isRuntime(m) && m.id === id);

/** info: models_info; rt: runtime_status; gpu: gpu_probe (the display adapters and the runtime they pick, paw-vdb3.3);
 *  facts: {path: {exists, bytes, part}} in the models folder; verified: {path: sha256} (Verify, an import, a download); fetched: the server's newer manifest; picked: {id: true}
 *  optional models ticked; job: {kind, id, model, file, done, total, rate, left}; ready: the required models are usable (tracking
 *  may run; true when not known, e.g. the browser harness, and with the fake tracker). */
export const models = $state({ info: null, rt: null, gpu: null, facts: {}, verified: {}, fetched: null, picked: {}, job: null, message: '', error: '', ready: true });

/** The models folder: the setting, else beside the app. */
export const folderOf = (app) => (app.settings.get('models.dir') || '').trim() || models.info?.defaultDir || '';
export const list = () => rows(EMBEDDED, models.fetched);
const pathsOf = (m) => (m ? m.files.map((f) => f.path) : []);
const say = (message, error = '') => Object.assign(models, { message, error });

/** What is on the disk now. false: no shell to ask (a plain browser). */
export async function refresh(app) {
  const be = app.backend;
  if (typeof be?.modelsInfo !== 'function') { models.ready = true; return false; }
  try {
    models.info = await be.modelsInfo(app.settings.get('models.dir') || null);
    models.rt = await be.runtimeStatus().catch(() => null);
    const dir = folderOf(app);
    const paths = [...new Set(list().filter((r) => !isRuntime(r.model)).flatMap((r) => [...pathsOf(r.model), ...pathsOf(r.old)]))];
    models.facts = Object.fromEntries((await be.modelsScan(dir, paths)).map((f) => [f.path, f]));
    models.gpu ||= await be.gpuProbe?.().catch(() => null) ?? null;   // the adapters do not change while the app runs
  } catch (e) { say('', errorWords(e)); }
  models.ready = !models.info || models.info.fake || modelsReady(list(), models.facts, models.verified);
  return true;
}

/** The runtime this PC uses (the setting, else the one for the GPU found) and why: logic.js chooseRuntime. Reads the settings. */
export const choice = (app) => chooseRuntime({ setting: app.settings.get('models.runtime'), probe: models.gpu, rt: models.rt, entries: EMBEDDED.models.filter(isRuntime) });
export const chosenEntry = (app) => entryOf(choice(app).id);

/** The chosen runtime must be downloaded before the app can run its trackers or read videos. */
export const needsRuntime = (app) => runtimeNeeded(models.rt, chosenEntry(app));

const base = (app) => baseUrl({ env: models.info?.envUrl, setting: app.settings.get('models.baseUrl') });
const strip = ({ path, url, bytes, sha256 }) => ({ path, url, bytes, sha256 });

/** Downloads these rows (ids; manual models are skipped: nobody hosts them). The runtime first, then the models; each file
 *  kept only once its SHA-256 checks out. -> 'unpack' (the runtime came: the caller lets the shell unpack it), true, false */
export async function download(app, ids) {
  if (models.job) return false;
  const be = app.backend, id = crypto.randomUUID();
  const want = list().filter((r) => ids.includes(r.model.id) && !isManual(r.model) && isHosted(r.model)).sort((a, b) => isRuntime(b.model) - isRuntime(a.model));
  let unpack = false;
  say('');
  try {
    for (const { model } of want) {
      const rt = isRuntime(model);
      const { files, bytes } = rt ? { files: model.files, bytes: model.files.reduce((n, f) => n + f.bytes, 0) } : toFetch(model, models.facts, models.verified);
      if (!files.length) continue;
      models.job = { kind: 'download', id, model: model.id, title: model.title, file: '', done: 0, total: bytes, rate: 0, left: null };
      const meter = rateMeter();
      await be.modelsDownload(id, base(app), rt ? models.rt.dir : folderOf(app), files.map(strip), (p) => Object.assign(models.job, p, meter(p.done, p.total, performance.now())));
      for (const f of files) models.verified[f.path] = f.sha256;   // checked by the shell before it was kept
      unpack ||= rt;
    }
    say(want.length ? 'Downloaded and checked' : '');
  } catch (e) { say('', errorWords(e)); }
  finally {
    models.job = null;
    await refresh(app);
    be.modelsChanged?.()?.catch?.(() => {});
  }
  if (unpack) { await be.runtimeUnpack(); return 'unpack'; }
  return !models.error;
}

export function cancel(app) {
  if (models.job) app.backend.modelsCancel(models.job.id).catch(() => {});
}

/** Deletes the files the manifest names for this row (never anything else in the folder). */
export async function remove(app, id) {
  const row = list().find((r) => r.model.id === id);
  if (!row || models.job) return false;
  const paths = [...new Set([...pathsOf(row.model), ...pathsOf(row.old)])];
  try {
    const n = await app.backend.modelsRemove(folderOf(app), paths);
    for (const p of paths) delete models.verified[p];
    say(`${row.model.title}: ${n} file${n === 1 ? '' : 's'} removed`);
  } catch (e) { say('', errorWords(e)); }
  await refresh(app);
  app.backend.modelsChanged?.()?.catch?.(() => {});
  return true;
}

/** Hashes every model file there is (Damaged shows the ones that do not match). */
export async function verify(app) {
  if (models.job) return false;
  const id = crypto.randomUUID(), paths = Object.values(models.facts).filter((f) => f.exists).map((f) => f.path);
  models.job = { kind: 'verify', id, title: 'Checking the files', file: '', done: 0, total: 0 };
  try {
    models.verified = { ...models.verified, ...(await app.backend.modelsVerify(id, folderOf(app), paths, (p) => Object.assign(models.job, p))) };
    const bad = list().filter((r) => !isRuntime(r.model) && r.model.files.some((f) => !isManual(r.model) && models.verified[f.path] && models.verified[f.path] !== f.sha256));
    say(bad.length ? `Damaged: ${bad.map((r) => r.model.title).join(', ')} (Re-download)` : 'Every file checks out');
  } catch (e) { say('', errorWords(e)); }
  finally { models.job = null; }
  await refresh(app);
  return true;
}

/** Asks the models server for its manifest (the user's click): rows whose files changed show Update available. */
export async function checkUpdates(app) {
  if (models.job) return false;
  models.job = { kind: 'check', id: '', title: 'Asking the models server', file: '', done: 0, total: 0 };
  try {
    models.fetched = parseManifest(await app.backend.modelsManifest(base(app)));
    const n = list().filter((r) => r.old).length, added = list().length - EMBEDDED.models.length;
    say(n || added ? `${n ? `${n} update${n === 1 ? '' : 's'}` : ''}${n && added ? ', ' : ''}${added ? `${added} more model${added === 1 ? '' : 's'}` : ''}` : 'Every model is up to date');
  } catch (e) { say('', errorWords(e)); }
  finally { models.job = null; }
  await refresh(app);
  return true;
}

/** Files the user brings (Choose files…, a drop): each one goes to the model it is named for (within `only`, a row's id),
 *  checked, then MOVED into the models folder. A hosted model's file must be the tested one; a manual model's may be
 *  another version (said, not refused). */
export async function importFiles(app, paths, only = null) {
  if (models.job || !paths?.length) return false;
  const items = [], unknown = [];
  for (const src of paths) {
    const m = matchFile(list(), src, only);
    if (m) items.push({ model: m.model, item: { src, path: m.file.path, bytes: m.file.bytes, sha256: m.file.sha256 || null, strict: !isManual(m.model) } });
    else unknown.push(String(src).split(/[\\/]/).pop());
  }
  if (!items.length) { say('', `${unknown.join(', ')}: not a file any model here expects`); return false; }
  const id = crypto.randomUUID();
  models.job = { kind: 'import', id, title: 'Checking and moving the files', file: '', done: 0, total: 0 };
  try {
    const got = await app.backend.modelsImport(id, folderOf(app), items.map((x) => x.item), (p) => Object.assign(models.job, p));
    for (const g of got) models.verified[g.path] = g.sha256;
    const titles = [...new Set(items.map((x) => x.model.title))];
    const other = [...new Set(items.filter((x) => otherVersion(x.model, models.verified)).map((x) => x.model.title))];
    say(`${titles.join(', ')}: in place${other.length ? `; ${other.join(', ')} is a different version than the one tested` : ''}${unknown.length ? `; not used: ${unknown.join(', ')}` : ''}`);
  } catch (e) { say('', errorWords(e)); }
  finally { models.job = null; }
  await refresh(app);
  app.backend.modelsChanged?.()?.catch?.(() => {});
  return true;
}

export async function chooseFiles(app, id = null) {
  const got = await app.backend.openDialog?.({ title: 'Choose the model files', multiple: true, directory: false });
  return importFiles(app, [].concat(got || []), id);
}

/** A new models folder (nothing is moved or deleted in the old one: it is just no longer looked in). '' = beside the app. */
export async function setFolder(app, dir) {
  if (models.job) return false;
  if (dir) app.settings.set('models.dir', dir); else app.settings.reset('models.dir');
  app.settings.flush?.();
  models.verified = {};
  await refresh(app);
  app.backend.modelsChanged?.()?.catch?.(() => {});
  return true;
}

export async function chooseFolder(app) {
  const dir = await app.backend.openDialog?.({ title: 'Where the models go', directory: true, multiple: false });
  return typeof dir === 'string' && dir ? setFolder(app, dir) : false;
}

export const openFolder = (app) => app.backend.openPath(folderOf(app)).catch((e) => say('', errorWords(e)));
export const openLink = (app, url) => app.backend.openUrl?.(url).catch((e) => say('', errorWords(e)));

/** models.runtime was just written (its Prop): an unpublished runtime that is not on the disk is refused and the setting goes
 *  back; else the shell drops its idle tracker, and with `fetch` (Settings; the first-start screen's Download fetches by
 *  itself) the chosen runtime is downloaded and unpacked now. The unpack runs in the shell while the app stays up: a
 *  tracker waits for it (portable.rs wait_ready). */
export async function runtimeChosen(app, { fetch = true } = {}) {
  const c = choice(app), entry = entryOf(c.id);
  if (!isHosted(entry) && !runtimeThere(models.rt, c.id)) {
    app.settings.reset('models.runtime');
    say('', `${RUNTIME_WORDS[c.id]} runtime is not published yet`);
    return false;
  }
  app.settings.flush?.();
  app.backend.modelsChanged?.()?.catch?.(() => {});
  if (!fetch || !needsRuntime(app)) return true;
  if ((await download(app, [c.id])) !== 'unpack') return false;
  models.job = { kind: 'unpack', id: '', title: 'Unpacking the runtime', file: '', done: 0, total: 0 };
  try {
    do await new Promise((r) => setTimeout(r, 1500)); while ((await app.backend.portableStatus?.().catch(() => null))?.state === 'unpacking');
  } finally { models.job = null; }
  await refresh(app);
  return true;
}

/** Deletes the runtime that is not the chosen one (its folder; the shared ffmpeg stays). */
export async function removeRuntime(app, id) {
  if (models.job || id === choice(app).id) return false;
  try { await app.backend.runtimeRemove(id); say(`${RUNTIME_WORDS[id]} runtime removed`); } catch (e) { say('', errorWords(e)); }
  await refresh(app);
  return true;
}

/** Bytes the picked rows still need, and the drive's free bytes. */
export function plan(ids, app) {
  const want = list().filter((r) => ids.includes(r.model.id) && !isManual(r.model));
  const bytes = want.reduce((n, r) => n + (isRuntime(r.model) ? (needsRuntime(app) ? r.model.files[0].bytes : 0) : toFetch(r.model, models.facts, models.verified).bytes), 0);
  return { bytes, free: models.info?.free ?? null, words: `${bytes ? `${fmtBytes(bytes)} to download` : 'Nothing to download'}${models.info?.free != null ? `, ${fmtBytes(models.info.free)} free` : ''}` };
}
