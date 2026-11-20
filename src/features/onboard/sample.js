// sample.js -- Help › Open the sample project (paw-ys3x): the generated, CC0 sample (sample/, made by dev/sample/) is
// bundled with the front end, so it needs no install folder. It is copied once to <home>\Videos (else Documents)\Pawscript
// sample and that copy opens on the Track tab; the bundled files are never opened or changed. A copy already there is
// opened as it is (the person's own work on it).
const FILES = import.meta.glob(['/sample/*.{mp4,pawproj,pawruns,funscript}', '/sample/*.pawhistory/*'], { query: '?url', import: 'default', eager: true });
export const SAMPLE = 'Pawscript sample';
const PROJ = SAMPLE + '.pawproj';
const sep = (p) => (/^[a-z]:\\|^\\\\/i.test(p) ? '\\' : '/');
const join = (a, b) => a.replace(/[\\/]+$/, '') + sep(a) + b.replace(/[\\/]/g, sep(a));

/** The bundled files: [{rel ('Pawscript sample.pawhistory/index.json'), url}], the project last (a copy cut short has none). */
export const sampleFiles = () => Object.entries(FILES).map(([k, url]) => ({ rel: k.replace(/^\/sample\//, ''), url }))
  .sort((a, b) => (a.rel === PROJ) - (b.rel === PROJ) || (a.rel < b.rel ? -1 : 1));

/** Where the copy goes: <home>\Videos (else Documents)\Pawscript sample, home read from the app's own data folder; null when
 *  neither is found. */
export async function sampleDir(be) {
  const p = await Promise.resolve(be.appPaths?.()).catch(() => null);
  const home = /^(.*?)[\\/]AppData[\\/]/i.exec(p?.config_dir || p?.data_dir || '')?.[1];
  if (!home) return null;
  for (const sub of ['Videos', 'Documents']) {
    const d = join(home, sub);
    if ((await Promise.resolve(be.stat?.(d)).catch(() => null))?.is_dir) return join(d, SAMPLE);
  }
  return null;
}

/** Copy the sample (once) and open the copy on the Track tab. fetchBytes(url) -> ArrayBuffer | Uint8Array (tests). -> bool */
export async function openSample(app, { fetchBytes = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(`${r.status} ${u}`); return r.arrayBuffer(); }) } = {}) {
  const be = app.backend, files = sampleFiles();
  if (!files.some((f) => f.rel === PROJ)) { app.toast('This build has no sample project', 'warn'); return false; }
  let dir = await sampleDir(be);
  if (!dir) {
    const picked = await be.openDialog({ directory: true, title: 'Where should the sample project go?' });
    if (!picked) return false;
    dir = join(Array.isArray(picked) ? picked[0] : picked, SAMPLE);
  }
  const proj = join(dir, SAMPLE + '.pawproj');
  const had = await Promise.resolve(be.exists(proj)).catch(() => false);
  if (!had) {
    try {
      for (const d of new Set(files.map((f) => f.rel.split('/').slice(0, -1).join('/')))) await be.makeDir?.(d ? join(dir, d) : dir);
      for (const f of files) {
        const bytes = new Uint8Array(await fetchBytes(f.url)), to = join(dir, f.rel);
        // text through the shell's written log: the app's next write of the copy is its own (no "changed outside Pawscript" .bak)
        if (/\.(pawproj|funscript|json)$/.test(f.rel) && be.writeWithBackup) await be.writeWithBackup(to, new TextDecoder().decode(bytes));
        else await be.writeBytes(to, bytes);
      }
    } catch (e) {
      app.toast(`The sample could not be copied to ${dir}: ${e?.message || e}`, 'error');
      return false;
    }
  }
  const ok = app.tabs ? await app.tabs.open([proj]) : await app.project.openPaths([proj]);
  if (!ok) return false;
  (app.tabs?.appFor(proj) || app).setMode?.('track');
  app.toast(had ? `Opened your copy of the sample in ${dir}` : `Sample project copied to ${dir}`, 'ok');
  return true;
}
