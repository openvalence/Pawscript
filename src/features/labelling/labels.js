// labels.js -- image labelling for the learned seeder (paw-714j): the pure side. A folder of stills is listed (never
// decoded or hashed), each image has a cheap stable key (path + size + mtime), and the painted groups of an image are
// ONE small JSON in the app's data folder, <app data>/seeder/labels/<key>.json:
//   {image: absolute path, key, w, h, groups: [{name, who?, part?, side?, poly, mask: {w, h, rle}, knot?: {w, h, rle}, pinned?, t_ms: 0,
//    source: 'user'}], ignore?: [{w, h, rle}], none?: true, complete?: true, savedAt}
// `knot` (paw-k393): a penis group's knot section (the knot brush, inside its mask), as in a .pawproj; the seeder trains its knot class on it.
// `complete` (paw-855t): the owner marked the picture fully labelled (everything worth labelling is painted): its unpainted patches are
// reliable negatives for training. Default absent = partial: an unpainted patch is unknown, a weak negative (seeder.py NEG_WEIGHT).
// `ignore` (paw-855t): regions of the picture training must not learn from (an inset crop of another angle): masks in the groups'
// encoding, their own list so nothing mistakes one for a part. In the Groups tool they are groups named ignore, ignore2 ... (groups.js).
// groups are exactly the .pawproj encoding (groups.js), so the seeder (trackers/pawtrack/seeder.py image_labels) reads
// them like a project frame. `none` = "nothing to label here" (no groups; a negative). NOTHING is ever written beside
// the images. Pure; the store takes the backend (listDir / readText / writeText / makeDir / remove). test/labelling.test.mjs.

import { IGNORE, isIgnore, freeName, fitPoly, decodeMask, foldKnots } from '../tracking/groups.js';

export const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];   // gif and anything else is skipped
const extOf = (name) => { const i = String(name).lastIndexOf('.'); return i < 0 ? '' : String(name).slice(i).toLowerCase(); };
export const isImage = (e) => !!e && !e.is_dir && IMAGE_EXTS.includes(extOf(e.name));

/** The images of a listing (backend.listDir entries): files with a supported extension, in natural name order
 *  (img2 before img10), each with its key. Folders are not entered. */
export function listImages(entries) {
  const cmp = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare;
  return (entries || []).filter(isImage).sort((a, b) => cmp(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((e) => ({ path: e.path, name: e.name, size: e.size ?? 0, mtime_ms: e.mtime_ms ?? 0, key: imageKey(e) }));
}

/** cyrb53: a 53-bit string hash (not cryptographic: an identity, not a secret). */
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
/** An image's key: a hash of its path (slashes and case folded: Windows) + size + mtime. Nothing is read from the file,
 *  so it is stable across sessions and orderings; an edited or replaced file (size / mtime change) is a new image,
 *  a moved one too. 'i' + 14 hex digits (a file name and the seeder's feature cache name as they are). */
export const imageKey = ({ path, size, mtime_ms }) => 'i' + cyrb53(`${String(path).replace(/\\/g, '/').toLowerCase()}|${size ?? 0}|${mtime_ms ?? 0}`).toString(16).padStart(14, '0');

/** The keys a labels-folder listing holds ('<key>.json'). */
export const labelledKeys = (entries) => new Set((entries || []).filter((e) => !e.is_dir && /^i[0-9a-f]{14}\.json$/.test(e.name)).map((e) => e.name.slice(0, -5)));

/** Index of the next image after `from` with no label, wrapping round to the start; -1 when all are labelled. */
export function nextUnlabelled(images, labelled, from = -1, wrap = true) {
  const n = images.length;
  for (let k = 1; k <= n; k++) {
    const i = from + k;
    if (i >= n && !wrap) return -1;
    const j = ((i % n) + n) % n;
    if (!labelled.has(images[j].key)) return j;
  }
  return -1;
}
/** paw-fheb: the next image to label after `from` with images skipped "for later" passed over while any image is neither labelled nor
 *  skipped; once none is, the skipped ones come back in strip order (from the start, or onwards from a skipped one on screen). -1: all labelled. */
export function nextTodo(images, labelled, skipped, from = -1) {
  if (skipped?.size) {
    const j = nextUnlabelled(images, { has: (k) => labelled.has(k) || skipped.has(k) }, from);
    if (j >= 0) return j;
    if (!skipped.has(images[from]?.key)) from = -1;
  }
  return nextUnlabelled(images, labelled, from);
}
/** {total, labelled, left, skipped} for the images and the label keys (left: unlabelled and not skipped). */
export function counts(images, labelled, skipped = new Set()) {
  let n = 0, k = 0;
  for (const im of images) if (labelled.has(im.key)) n++; else if (skipped.has(im.key)) k++;
  return { total: images.length, labelled: n, left: images.length - n - k, skipped: k };
}
/** '37 labelled · 3,510 left' (· '4 skipped' when some are) */
export const counterText = (c) => `${c.labelled.toLocaleString('en-US')} labeled · ${c.left.toLocaleString('en-US')} left${c.skipped ? ` · ${c.skipped.toLocaleString('en-US')} skipped` : ''}`;
/** The thumbnail window [lo, hi) of `size` images around index i. */
export function windowOf(n, i, size = 25) {
  const lo = Math.max(0, Math.min(n - size, i - (size >> 1)));
  return [Math.max(0, lo), Math.min(n, Math.max(0, lo) + size)];
}

// ---- the stored groups ----
const KEEP = ['name', 'who', 'part', 'side', 'poly', 'mask', 'knot', 'pinned', 'off', 'pulse', 'shaft', 'depth', 'from', 'named_by'];   // depth: paw-4c48.19   // from: 'suggest' = accepted from a suggestion as it was   // knot: paw-k393, a penis' knot section
/** A scene group -> what a label stores (the .pawproj fields; every label is a hand-painted frame: t_ms 0, source user). */
export function storeGroup(g) {
  const o = {};
  for (const k of KEEP) if (g[k] !== undefined) o[k] = g[k];
  return { ...o, t_ms: 0, source: 'user' };
}
/** The label record for an image; none: "nothing to label here" (no groups then). */
export function makeLabel({ image, key, w, h, groups = [], ignore = [], none = false, complete = false, now = Date.now(), copied }) {
  return { image, key, w, h, groups: none ? [] : groups.map(storeGroup), ...(ignore.length ? { ignore } : {}), ...(none ? { none: true } : {}), ...(complete && !none ? { complete: true } : {}), ...(copied ? { copied } : {}), savedAt: now };
}
/** A label file's text -> the label, or null when it is not one. */
export function parseLabel(text) {
  let d;
  try { d = JSON.parse(text); } catch { return null; }
  if (!d || typeof d.key !== 'string' || !Array.isArray(d.groups || [])) return null;
  const ignore = (d.ignore || []).filter((m) => m && Array.isArray(m.rle) && m.w > 0 && m.h > 0);
  const { ignore: _, complete: __, ...rest } = d;   // eslint-disable-line no-unused-vars
  return { ...rest, groups: (d.groups || []).filter((g) => g && typeof g.name === 'string' && g.mask?.rle), ...(ignore.length ? { ignore } : {}), ...(d.none ? { none: true } : {}), ...(d.complete === true && !d.none ? { complete: true } : {}) };
}
/** The groups a stored label gives the tool (scene.groups of the image's one shot): its parts, then its ignore regions as groups named
 *  ignore, ignore2 ... (the polygon fitted to the mask, as the tool does after a stroke). paw-k393: an old label's own knot part on a penis
 *  of the same character is read as that penis' knot section (groups.js foldKnots, as projects are); the file changes only on an edit. */
export function restoreGroups(label) {
  const parts = (label?.groups || []).map((g) => ({ ...g, t_ms: 0, source: 'user' }));
  const out = foldKnots(parts)?.list || parts;
  (label?.ignore || []).forEach((mask) => {
    const poly = fitPoly(decodeMask(mask)).poly;
    if (poly) out.push({ name: freeName(out, IGNORE), poly, pinned: false, t_ms: 0, source: 'user', mask });
  });
  return out;
}
/** A tool's groups split for storing: {groups: the parts, ignore: the ignore regions' masks}. */
export const splitStored = (groups) => ({ groups: (groups || []).filter((g) => !isIgnore(g)), ignore: (groups || []).filter(isIgnore).map((g) => g.mask).filter((m) => m?.rle) });
/** The distinct part names a set of groups holds, in order, assigned ones only ('c1_head', not 'unassigned_1'). */
export const partNames = (groups) => [...new Set((groups || []).map((g) => g.name).filter((n) => n && !/^unassigned_\d+$/.test(n)))];

/** The labels folder over a backend: keys(), read(key), write(label), remove(key). Folders are made on the first write. */
export function createLabelStore(be, dir) {
  const sep = dir.includes('\\') ? '\\' : '/', file = (key) => dir.replace(/[\\/]+$/, '') + sep + key + '.json';
  let made = false;
  return {
    dir, file,
    async keys() { try { return labelledKeys(await be.listDir(dir)); } catch { return new Set(); } },   // no folder yet: nothing labelled
    async read(key) { try { return parseLabel(await be.readText(file(key))); } catch { return null; } },
    async write(label) {
      if (!made) { await be.makeDir(dir); made = true; }
      await be.writeText(file(label.key), JSON.stringify(label));
    },
    async remove(key) { try { await be.remove(file(key)); } catch { /* already gone */ } },
  };
}

// ---- shuffled order (paw-cbw2) ----
const U53 = 2 ** 53;
const rank = (seed, key) => cyrb53(String(key), seed >>> 0) / U53;   // a number in [0, 1) per (seed, key): the permutation
/** `images` (any order) in a random order fixed by `seed` (and by nothing else: the same seed gives the same order, and
 *  adding images never reorders the others). With `saved` (an order stored earlier: image keys) that order is kept, files
 *  that were not in it are inserted at random places AFTER the image with key `curKey` (never before it).
 *  -> {images, order: keys}. Pure. */
export function arrangeShuffled(images, saved, seed, curKey) {
  const by = new Map(images.map((im) => [im.key, im]));
  if (!saved) {
    const order = images.map((im) => im.key).sort((a, b) => rank(seed, a) - rank(seed, b) || (a < b ? -1 : 1));
    return { images: order.map((k) => by.get(k)), order };
  }
  const was = new Set(saved), order = saved.filter((k) => by.has(k));
  const fresh = images.map((im) => im.key).filter((k) => !was.has(k)).sort((a, b) => rank(seed, a) - rank(seed, b) || (a < b ? -1 : 1));
  for (const k of fresh) {
    const cur = order.indexOf(curKey), from = cur + 1;
    order.splice(from + Math.floor(rank(seed + 1, k) * (order.length - from + 1)), 0, k);
  }
  return { images: order.map((k) => by.get(k)), order };
}
/** The shuffle state of a folder: <dataset>/order/<folder key>.json = {folder, seed, order: [image keys] | null, skipped?: [image keys]}
 *  (skipped, paw-fheb: "later" in this dataset; not a label, not a training signal). */
export function createOrderStore(be, dir, folder) {
  const sep = dir.includes('\\') ? '\\' : '/', file = dir.replace(/[\\/]+$/, '') + sep + imageKey({ path: folder, size: 0, mtime_ms: 0 }) + '.json';
  let made = false;
  return {
    async read() { try { const d = JSON.parse(await be.readText(file)); return Number.isFinite(d.seed) ? { ...d, order: Array.isArray(d.order) ? d.order : null } : null; } catch { return null; } },
    async write(d) { if (!made) { await be.makeDir(dir); made = true; } await be.writeText(file, JSON.stringify({ folder, ...d })); },
  };
}

// ---- Suggest on a still image (paw-714j): a suggestion is NOT a label ----
/** Per part: what Suggest found against what the owner painted. painted: the owner's groups; found: the suggest_groups result's
 *  groups; iou(painted, found) -> 0..1. -> [{name, state: 'found' | 'missed' | 'extra', overlap?}] (owner's parts first). */
export function agreement(painted, found, iou, partial = false) {
  const by = new Map((found || []).map((f) => [f.name, f])), rows = [];
  for (const g of painted || []) {
    if (/^unassigned_\d+$/.test(g.name)) continue;
    const f = by.get(g.name);
    rows.push(f ? { name: g.name, state: 'found', overlap: iou(g, f) } : { name: g.name, state: 'missed' });
    by.delete(g.name);
  }
  for (const name of by.keys()) rows.push({ name, state: partial ? 'unpainted' : 'extra' });   // a partial picture: what you did not paint is unknown, not wrong (it may be right: accept it)
  return rows;
}
/** One line for the rows: 'knot found 82 % · tongue missed · hips extra'. */
export const agreementText = (rows, label = (n) => n) => rows.map((r) => `${label(r.name)} ${r.state === 'unpainted' ? 'not painted' : r.state}${r.state === 'found' ? ` ${Math.round(100 * (r.overlap || 0))} %` : ''}`).join(' · ');
