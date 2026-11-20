// library.js -- the toy picker's catalogue (Vite only: JSON + image URLs). Entries: the bundled library
// (toys/library.json, built by tools/build-toy-library.mjs; private use, THIRD-PARTY.md), the two generic
// fallbacks, the owner's own toys from their local data file (owner.js: toys/owner/*.json, not in the repo) and the
// owner's imported toys (settings 'machine.toys').
import LIB from './toys/library.json';
import { BUILTIN_TOYS, libraryToy, validToy, SIZE_LABELS, sortSizes } from './toys.js';
import { ownerList, ownerEntries, ownerToy } from './owner.js';

// (absent-safe: no folder, no files, no toys)
const OWNER = ownerList(import.meta.glob('./toys/owner/*.json', { eager: true, import: 'default' }));

const urls = import.meta.glob('./toys/img/*.webp', { eager: true, query: '?url', import: 'default' });
const url = (name) => (name ? urls[`./toys/img/${name}`] : null) || null;
const meshes = import.meta.glob('./toys/mesh/*', { eager: true, query: '?url', import: 'default' });

/** URLs of a library toy's mesh and normal map (fetched when the toy is picked), or null. */
export function meshUrls(key) {
  const bin = meshes[`./toys/mesh/${key}.bin`];
  return bin ? { bin, nrm: meshes[`./toys/mesh/${key}.nrm.webp`] || null, tex: meshes[`./toys/mesh/${key}.tex.webp`] || null } : null;
}

/** Picker entries: {key, name, sizes: [{value, label}], thumb, kind: 'library'|'generic'|'owner'|'custom'}. */
export function entries(custom = []) {
  return [
    ...LIB.toys.map((e) => ({ key: e.sku, name: e.name, kind: 'library', thumb: url(`${e.sku}.thumb.webp`) || url(`${e.sku}.webp`), knot: !!e.knot,
      sizes: sortSizes(Object.keys(e.sizes)).map((s) => ({ value: s, label: SIZE_LABELS[s] || s })) })),
    ...BUILTIN_TOYS.map((t) => ({ key: t.id, name: t.name, kind: 'generic', thumb: null, sizes: [], toy: t })),
    ...ownerEntries(OWNER),
    ...custom.map(validToy).filter(Boolean).map((t) => ({ key: t.id, name: t.name, kind: 'custom', thumb: null, sizes: [], toy: t })),
  ];
}

/** The toy for a picker key and size. */
export function toyFor(key, size, custom = []) {
  const e = LIB.toys.find((x) => x.sku === key);
  if (e) { const t = libraryToy(e, size in e.sizes ? size : defaultSize(e), LIB); return { ...t, img: url(`${e.sku}.webp`) }; }
  const theirs = ownerToy(OWNER, key, size);
  if (theirs) return theirs;
  const own = BUILTIN_TOYS.find((t) => t.id === key) || custom.map(validToy).find((t) => t?.id === key);
  // unknown key: the first library toy; the public build has an empty library (build-nas.ps1): the first generic toy
  return own || (LIB.toys[0] ? toyFor(LIB.toys[0].sku, '', custom) : BUILTIN_TOYS[0]);
}

/** Medium when there is one, else the middle size. */
function defaultSize(e) { const k = sortSizes(Object.keys(e.sizes)); return k.includes('medium') ? 'medium' : k[k.length >> 1]; }
