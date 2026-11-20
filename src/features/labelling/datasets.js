// datasets.js -- image-label DATASETS for the learned seeder (paw-855t): the pure side. A dataset is a named set of image labels with its
// own trained head, score and trend: <app data>/seeder/datasets/<id>/{labels, order, head.pt, head.json, score.json, cross.json}; thumbnails
// (per image) and feature caches (per image and feature source) stay shared in <app data>/seeder. The registry is <seeder>/datasets.json:
//   {version: 1, active: id, datasets: [{id, name, projects: bool (also learn from the painted groups of .pawproj projects), archived?, created}]}
// The Rust start-up (src-tauri/src/datasets.rs) moves the old flat layout into "v1" once and creates "v2" as the active new one; when that
// failed (migration-error.txt beside the old files) the app keeps working on the old layout as a LEGACY v1 (dir = the seeder folder itself).
// Nothing is ever deleted: "archive" only hides a dataset from the picker. Pure; the store takes the backend. test/datasets.test.mjs.

const sep = (d) => (d.includes('\\') ? '\\' : '/');
export const joinPath = (d, ...p) => p.reduce((a, x) => a.replace(/[\\/]+$/, '') + sep(d) + x, d);
export const registryFile = (seed) => joinPath(seed, 'datasets.json');
/** A dataset's folder: datasets/<id>; a legacy v1 (the move failed) is the seeder folder itself. */
export const datasetDir = (seed, ds) => (ds?.legacy ? seed : joinPath(seed, 'datasets', ds.id));
export const labelsDirOf = (seed, ds) => joinPath(datasetDir(seed, ds), 'labels');
export const orderDirOf = (seed, ds) => joinPath(datasetDir(seed, ds), 'order');

const ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
/** An id for a name ('My set 2' -> 'my-set-2'), free among `taken`. */
export function idFor(name, taken = []) {
  const base = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'dataset';
  let id = base, k = 2;
  while (taken.includes(id)) id = `${base}-${k++}`;
  return id;
}
/** The default registry of a fresh install: only v2. */
export const freshRegistry = (now = Date.now()) => ({ version: 1, active: 'v2', datasets: [{ id: 'v2', name: 'v2', projects: false, created: now }] });
/** The registry when the old layout could not be moved: the old files are a legacy v1, the only dataset until the move works (the next start tries again). */
export const legacyRegistry = (error, now = Date.now()) => ({ version: 1, active: 'v1', error, datasets: [{ id: 'v1', name: 'v1', projects: true, legacy: true, created: now }] });

/** A registry file's text -> the registry, or null when it is not one (entries that are not datasets are dropped; active falls back to the first). */
export function parseRegistry(text) {
  let d;
  try { d = JSON.parse(text); } catch { return null; }
  if (!d || !Array.isArray(d.datasets)) return null;
  const seen = new Set(), datasets = [];
  for (const x of d.datasets) {
    if (!x || typeof x.id !== 'string' || !ID.test(x.id) || seen.has(x.id)) continue;
    seen.add(x.id);
    datasets.push({ id: x.id, name: String(x.name || x.id).slice(0, 40), projects: x.projects === true, ...(x.archived ? { archived: true } : {}), ...(x.legacy ? { legacy: true } : {}), created: Number.isFinite(x.created) ? x.created : 0 });
  }
  if (!datasets.length) return null;
  return { version: 1, active: seen.has(d.active) ? d.active : datasets.find((x) => !x.archived)?.id || datasets[0].id, datasets, ...(d.error ? { error: d.error } : {}) };
}
export const activeOf = (reg) => reg?.datasets.find((d) => d.id === reg.active) || null;
/** The datasets the picker lists: not archived, plus the active one whatever it is. */
export const listed = (reg) => (reg?.datasets || []).filter((d) => !d.archived || d.id === reg.active);
export const archivedOf = (reg) => (reg?.datasets || []).filter((d) => d.archived && d.id !== reg.active);
/** 'v2 · 37 labelled' */
export const pickerText = (ds, n) => `${ds?.name || ''} · ${(n ?? 0).toLocaleString('en-US')} labeled`;

const up = (reg, f) => ({ ...reg, datasets: reg.datasets.map(f) });
/** Make `id` the active dataset (an archived one comes back from the archive). */
export const withActive = (reg, id) => (reg.datasets.some((d) => d.id === id) ? { ...reg, active: id, datasets: reg.datasets.map((d) => { if (d.id !== id || !d.archived) return d; const { archived: _, ...r } = d; return r; }) } : reg);   // eslint-disable-line no-unused-vars
/** Add a dataset named `name` (a new one learns from images only: projects off) and make it active. -> {reg, id} (same reg when the name is empty). */
export function withCreated(reg, name, now = Date.now()) {
  const nm = String(name || '').trim().slice(0, 40);
  if (!nm) return { reg, id: null };
  const id = idFor(nm, reg.datasets.map((d) => d.id));
  return { reg: { ...reg, active: id, datasets: [...reg.datasets, { id, name: nm, projects: false, created: now }] }, id };
}
export const withRenamed = (reg, id, name) => { const nm = String(name || '').trim().slice(0, 40); return nm ? up(reg, (d) => (d.id === id ? { ...d, name: nm } : d)) : reg; };
/** Hide (or show again) a dataset; the active one cannot be archived. Nothing is removed from disk. */
export const withArchived = (reg, id, on) => (id === reg.active && on ? reg : up(reg, (d) => (d.id === id ? (on ? { ...d, archived: true } : (({ archived: _, ...r }) => r)(d)) : d)));   // eslint-disable-line no-unused-vars
export const withProjects = (reg, id, on) => up(reg, (d) => (d.id === id ? { ...d, projects: !!on } : d));

/** The registry over a backend: load() (creating the default one; a failed migration = the legacy layout), save(reg). */
export function createRegistryStore(be, seed) {
  return {
    async load(now = Date.now()) {
      let text = null;
      try { text = await be.readText(registryFile(seed)); } catch { text = null; }
      const reg = text != null ? parseRegistry(text) : null;
      if (reg) return reg;
      let err = '';
      try { err = (await be.readText(joinPath(seed, 'migration-error.txt'))).trim(); } catch { err = ''; }
      // no registry and a note from the start-up: the old labels are still where they were (legacy v1); nothing is written, so the next start tries again
      if (err) return legacyRegistry(err, now);
      const fresh = freshRegistry(now);
      try { await be.makeDir(seed); await be.writeText(registryFile(seed), JSON.stringify(fresh, null, 1)); } catch { /* the in-memory default still works this session */ }
      return fresh;
    },
    async save(reg) {
      if (reg.error) return;   // legacy mode: the registry would claim a move that did not happen
      await be.makeDir(seed);
      await be.writeText(registryFile(seed), JSON.stringify({ version: 1, active: reg.active, datasets: reg.datasets }, null, 1));
    },
  };
}

/** "Start from the v1 label": another dataset's label as the starting point of this image in this one. Never automatic. The copy lives in
 *  the tool (not on disk) until the owner edits it or accepts it as it is (Done); `copied` then records where it came from. */
export const copiedFrom = (label, fromId) => (label ? { ...label, copied: fromId } : null);

/** What a Train reads for dataset `ds` (the active one; null = no registry, the pre-dataset layout): its image labels always; the project
 *  library's folders and the open project only when the dataset also learns from projects (off for a new one, on for v1). */
/** v4.38: what the ONE namer of every dataset learns from: each listed dataset's labels {id: folder}, and the projects when some dataset learns from them. */
export function namerScope(list, { folders = [], projectPath = '' } = {}) {
  return { labels: Object.fromEntries(list.map((d) => [d.id, d.labels])), ...(list.some((d) => d.projects) ? { folders, projects: projectPath ? [projectPath] : [] } : {}) };
}
export function trainScope(ds, { folders = [], projectPath = '', seed = '' } = {}) {
  const on = !ds || ds.projects;
  return { folders: on ? folders : [], projects: on && projectPath ? [projectPath] : [], labels: ds ? ds.labels : seed ? joinPath(seed, 'labels') : '', dataset: ds?.dir || '' };
}
