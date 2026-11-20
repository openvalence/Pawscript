// workspace.svelte.js -- the image-labelling workspace's state (paw-714j): a folder of stills, the one on screen, its
// label (the Groups tool's groups on it), saving, and the seeder training offer. The painting is the Groups tool itself
// (groups.svelte.js / GroupsOverlay.svelte), run against a small FRAME-SOURCE FACADE instead of the project: an app-like
// object whose doc holds one scene (the image, 1 s long) and whose player is a still (overlays layer, view, bitmap). The
// project's document, player and history are never touched, so the project cannot become dirty from labelling.
//
//   enter(folder?)   open the folder (a picker when none) and switch to the workspace; leave() returns to the project
//   show(i) / next() / prev() / nextUnlabelled() / skip() / clearSkips() / done() (Enter) / toggleNone() / sameParts()
//   labels: <app data>/seeder/labels/<key>.json (labels.js), saved a moment after every stroke, flushed on moving on
import { rooted } from '../../lib/rooted.svelte.js';
import { History } from '../../app/history.js';
import { Overlays } from '../video/overlays.svelte.js';
import { DEFAULT_VIEW } from '../video/view.js';
import { groupsFor } from '../tracking/groups.svelte.js';
import { adoptTracking } from '../tracking/tracking.svelte.js';
import { splitName, isUnassigned, isSuggested, isCopy, isIgnore, suggestedGroups, splitByConfidence, encodeMask, rasterPoly, maskOf, whoNote } from '../tracking/groups.js';
import { listImages, createLabelStore, makeLabel, restoreGroups, splitStored, nextTodo, counts, counterText, partNames, IMAGE_EXTS, arrangeShuffled, createOrderStore, agreement } from './labels.js';
import { suggestGroupsRequest, tagImageRequest } from '../../lib/protocol.js';
import { countGuess, arrangeAhead, pickAhead, mayTag, progressTip, parseTag, tagJson } from './duos.js';
import { joinPath, copiedFrom } from './datasets.js';
import { ImageLoader, readAhead, thumbFile, thumbKeys, THUMB_PX } from './loader.js';

const SAVE_MS = 400;
const ALLOW = new Set(['edit.undo', 'edit.redo', 'tracking.groupsDelete', 'tracking.groupsGrab', 'tracking.groupsScale', 'tracking.groupsWho1', 'tracking.groupsWho2', 'tracking.groupsWho3', 'tracking.groupsSwap', 'tracking.groupsSmaller', 'tracking.groupsBigger', 'tracking.groupsClose', 'tracking.groupsConfirm', 'tracking.groupsCircle', 'tracking.groupsMagnetWeaker', 'tracking.groupsMarginLess', 'tracking.groupsMarginMore', 'tracking.suggestConfLess', 'tracking.suggestConfMore', 'tracking.groupsMagnetStronger', 'tracking.groupsGrow', 'tracking.groupsLooser', 'tracking.groupsTighter', 'tracking.groupsGrowFill', 'tracking.groupsIgnore', 'tracking.groupsDecline', 'tracking.groupsAssign', 'tracking.groupsFlip', 'tracking.groupsFindKnot', 'tracking.groupsKnot']);
const ALLOW_PREFIX = ['labelling.', 'palette.', 'help.', 'view.theme.', 'view.density.'];

/** The labelling document: one scene holding the image's groups (the shape the Groups tool reads from app.doc). */
class LabelDoc {
  scenes = $state.raw([]);
  media = $state.raw(null);
  dirty = false;
  read() { return { scenes: this.scenes }; }
  write(p, v) { this[p] = v; }
}
/** A still as the player the overlays draw on (features/video overlays + view). */
class StillPlayer {
  overlays = new Overlays();
  view = $state({ ...DEFAULT_VIEW });
  bmp = $state.raw(null);
  timeMs = 0; frameMs = 1000 / 30; el = null; stab = null; ui = {};
  get vw() { return this.bmp?.width || 0; }
  get vh() { return this.bmp?.height || 0; }
  pause() {}
  seek() {}
  frameBitmap = () => this.bmp;   // groups.svelte.js: the pixels for the edge snap
}

export class LabelWorkspace {
  on = $state(false);
  folder = $state('');
  images = $state.raw([]);          // [{path, name, size, mtime_ms, key}] (listed, never decoded)
  labelled = $state.raw(new Set()); // keys with a label file
  skipped = $state.raw(new Set());  // paw-fheb: keys put off "for later" in this dataset (its order file; not a label): U passes over them while others are left
  marks = $state.raw(new Map());    // key -> {none, n}: read lazily for the thumbnails on screen
  index = $state(-1);
  ready = $state(false);            // the image on screen is loaded and its label restored
  failed = $state('');              // why the image on screen cannot be shown
  none = $state(false);             // "nothing to label here" on the image on screen
  others = $state.raw(new Map());   // paw-855t: dataset id -> the keys labelled THERE (a faint mark on the strip: "labelled in v1, not here")
  copied = $state('');              // the label on screen was started from another dataset's (its id): provenance, stored with it
  pendingCopy = $state(false);      // ... and has not been edited or accepted yet: nothing of it is saved, it is a starting point only
  complete = $state(false);         // "fully labelled" on the image on screen: its unpainted patches are reliable negatives for training
  queue = $state.raw([]);           // part names still to paint on this image ("same parts as the last image")
  busy = $state(false);             // the folder is being opened (nothing listed yet)
  listing = $state(false);          // names are still arriving (the strip and counter are partial)
  placeholder = $state('');         // the small thumbnail of the image on screen while it loads
  thumbs = $state.raw(new Set());   // keys that have a thumbnail file in <app data>/seeder/thumbs
  thumbsDir = '';
  suggesting = $state(false);       // a Suggest job is running for the image on screen
  compare = $state.raw(null);       // after Suggest: {rows: agreement per part, shown, hadLabels, learned, tagger, ms}
  duos = $state(false);             // paw-9p1h: duos first (pictures guessed to show two characters come ahead of the cursor; the tagger looks lazily)
  guesses = $state.raw(new Map());  // key -> {count, conf, tags}: the tagger's count guess per picture (cached in <app data>/seeder/tags)
  shuffle = $state(true);           // shuffled order (stable per folder: a stored seed) or folder order (by name)
  note = $state('');
  #hv = $state(0);
  #tok = 0; #timer = 0; #dirty = false; #prev = []; #lastNames = []; #store = null; #raw = []; #ltok = 0; #want = -1; #sugMasks = new Set(); #held = []; #seed = 0; #saved = null; #orders = null; #bad = new Set();
  loader = new ImageLoader({
    // the bytes come natively over the asset protocol (no IPC copy); readBytes only where there is no such URL (tests)
    read: async (path) => {
      const be = this.real.backend, u = be.mediaUrl?.(path);
      if (u && /^(https?|asset):/.test(u) && typeof fetch === 'function') { const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); }
      return new Blob([await be.readBytes(path)]);
    },
    decode: (blob) => createImageBitmap(blob),   // off the main thread
    delay: () => (import.meta.env?.VITE_EXPOSE_APP ? globalThis.__labelReadDelay || 0 : 0),   // test builds only: a slow share
  });
  stage = null;                     // the stage element (set by LabelWorkspace.svelte)

  constructor(app) {
    this.real = app;
    const doc = this.doc = new LabelDoc(), player = this.player = new StillPlayer();
    const h = this.hist = new History({ read: () => doc.read(), write: (p, v) => doc.write(p, v), window: 0, onChange: () => { this.#hv++; } });
    const ws = this;
    // the frame-source facade the Groups tool and its overlay run on
    this.app = {
      doc, player, mode: 'track', labelling: true, real: app,
      settings: app.settings, commands: app.commands, backend: app.backend,
      toast: (...a) => app.toast(...a),
      transact: (label, fn, opts) => { const r = h.transact(label, fn, opts); ws.#edited(); return r; },
      stageEl: () => ws.stage,
    };
    adoptTracking(this.app, {   // the tracker store a project has: nothing here runs (no video, no jobs)
      get aspect() { return doc.media?.width && doc.media?.height ? doc.media.width / doc.media.height : 4 / 3; },
      videoPath: null, busy: '', owner: '', axisOn: false, runs: [], tracker: null, params: {}, roi: null, busyRange: null, currentScene: -1, scenes: [],
      toggleAxisTool() {}, cancelOwner() {}, job: async () => ({ error: 'no tracker in the labelling workspace' }),
    });
    this.G.labelMode = true;
    this.G.labelSuggest = () => this.suggest();
    this.G.labelCtx = () => this.current?.path;
    this.G.nameJob = (req) => this.nameJob(req);                        // paw-p9ve: the proposals of unnamed blobs (sidecar name_groups) through the same queue
    this.G.labelTarget = () => (this.current ? { image: this.current.path, key: this.current.key } : null);
  }

  get G() { return groupsFor(this.app); }
  get current() { return this.images[this.index] || null; }
  get counts() { return counts(this.images, this.labelled, this.skipped); }
  /** The image U would land on from image i (-1: everything labelled). */
  todo(i) { return nextTodo(this.images, this.labelled, this.skipped, i); }
  get counter() { return counterText(this.counts); }
  get canUndo() { this.#hv; return this.hist.canUndo; }
  get canRedo() { this.#hv; return this.hist.canRedo; }
  undo() { const e = this.hist.undo(); if (e) { this.#edited(); this.real.toast('Undo: ' + e.label, 'quiet'); } return e; }
  redo() { const e = this.hist.redo(); if (e) { this.#edited(); this.real.toast('Redo: ' + e.label, 'quiet'); } return e; }
  get groups() { return this.doc.scenes[0]?.groups || []; }
  /** The owner's groups on the image: painted or accepted. Suggestions still on offer (and anything from a tool) are not labels. */
  get painted() { return this.groups.filter((g) => !isSuggested(g) && !isCopy(g)); }
  /** The parts among them (paw-855t: ignore regions are painted too, but are not parts). */
  get parts() { return this.painted.filter((g) => !isIgnore(g)); }
  get unassigned() { return this.groups.filter(isUnassigned).length; }

  // ---- entering and leaving ----
  /** paw-855t: the seeder datasets (shared with the Groups tool: one active dataset, one head for Suggest everywhere). */
  get ds() { return groupsFor(this.real).datasets; }
  /** The ACTIVE dataset's labels folder (<app data>/seeder/datasets/<id>/labels), or null outside the app. */
  async labelsDir() { await this.ds.ready(); return this.ds.info()?.labels || null; }
  /** Point the stores at the active dataset: its labels, its shuffle order of `folder`, who is labelled there and in the others. */
  async #bind(folder) {
    const be = this.real.backend, info = this.ds.info();
    this.#store = createLabelStore(be, info.labels);
    this.#orders = createOrderStore(be, joinPath(info.dir, 'order'), folder);
    const [keys, st] = await Promise.all([this.#store.keys(), this.#orders.read(), this.#loadOthers()]);
    this.labelled = keys; this.marks = new Map();
    this.#seed = st ? st.seed : Math.floor(Math.random() * 2 ** 32); this.#saved = st ? st.order : null; this.skipped = new Set(st?.skipped || []);
  }
  async #loadOthers() {
    const be = this.real.backend, m = new Map();
    await Promise.all((this.ds.reg?.datasets || []).filter((d) => d.id !== this.ds.reg.active && !d.archived).map(async (d) => m.set(d.id, await createLabelStore(be, this.ds.infoOf(d.id).labels).keys())));
    this.others = m;
  }
  /** Other datasets that have a label for this image: [{id, name}]. */
  otherLabelled(im) { const out = []; for (const [id, keys] of this.others) if (keys.has(im.key)) out.push({ id, name: this.ds.reg.datasets.find((d) => d.id === id)?.name || id }); return out; }
  /** Datasets (names) that have a label for this image, other than the active one. */
  otherNames(im) { const out = []; for (const [id, keys] of this.others) if (keys.has(im.key)) out.push(this.ds.reg.datasets.find((d) => d.id === id)?.name || id); return out; }
  /** Switch the active dataset (the picker): what is labelled, the strip's marks, the counter, "next unlabelled", the order and Suggest follow it. */
  async switchDataset(id) {
    if (!this.on || id === this.ds.reg?.active) return false;
    await this.flush();
    if (!(await this.ds.switchTo(id))) return false;
    await this.#afterDatasetChange();
    return true;
  }
  /** A new empty dataset, active at once. */
  async createDataset(name) {
    if (!this.on) return null;
    await this.flush();
    const id = await this.ds.create(name);
    if (id) await this.#afterDatasetChange();
    return id;
  }
  async #afterDatasetChange() {
    const cur = this.current?.key;
    this.#tok++; this.ready = false;
    await this.#bind(this.folder);
    this.#arrange(cur);
    const real = groupsFor(this.real);
    real.seeder = null; real.cross = null;
    real.loadSeeder();
    this.note = '';
    if (this.images.length) await this.show(Math.max(0, this.index));
  }
  /** "Start from the v1 label": the picture's label in another dataset as a starting point here (never automatic). It lives in the tool, not
   *  on disk, until the owner edits it or accepts it as it is (Done): until then it is not a label of this dataset and trains nothing. */
  async startFrom(id) {
    const img = this.current;
    if (!this.ready || !img || !this.others.get(id)?.has(img.key) || this.groups.length) return false;
    const src = copiedFrom(await createLabelStore(this.real.backend, this.ds.infoOf(id).labels).read(img.key), id);
    if (!src) return false;
    this.doc.scenes = [{ start_ms: 0, end_ms: 1000, groups: restoreGroups(src) }];
    this.hist.reset();
    this.none = !!src.none; this.complete = !!src.complete; this.copied = id; this.pendingCopy = true;
    this.G.active = this.groups.length ? 0 : -1;
    this.real.toast(`Started from the ${this.ds.reg.datasets.find((d) => d.id === id)?.name || id} label: edit it, or Done keeps it`, 'quiet');
    return true;
  }
  /** Open the workspace on `folder` (none given: the folder picker, starting at the last one). */
  async enter(folder) {
    if (this.on) return false;
    const be = this.real.backend, last = this.real.settings.get('labelling.folder', '');
    if (!folder) {
      folder = await be.openDialog?.({ directory: true, title: 'Label images in a folder', ...(last ? { defaultPath: last } : {}) });
      if (!folder || Array.isArray(folder)) return false;
    }
    const dir = await this.labelsDir();
    if (!dir) { this.real.toast('Image labels need the app’s data folder (not available here)', 'warn'); return false; }
    if (this.ds.reg?.error) this.real.toast('The old labels could not be moved into dataset v1: ' + this.ds.reg.error, 'warn');
    this.busy = true; this.listing = true;
    const ltok = ++this.#ltok;
    this.thumbsDir = joinPath(this.ds.info().seed, 'thumbs');
    this.images = []; this.#raw = []; this.marks = new Map(); this.thumbs = new Set(); this.#bad.clear(); this.loader.clear(); this.index = -1; this.#want = -1;
    this.shuffle = this.real.settings.get('labelling.shuffle', true) !== false;
    this.duos = this.real.settings.get('labelling.duos', false) === true;
    this.guesses = new Map(); this.#tagFail.clear(); this.#tagMade = false;
    this.#tagDir = joinPath(this.ds.info().seed, 'tags');
    try {
      [this.thumbs] = await Promise.all([be.listDir(this.thumbsDir).then(thumbKeys, () => new Set()), this.#bind(folder)]);
    }
    catch (e) { this.busy = this.listing = false; this.real.toast('Cannot open the folder: ' + (e?.message || e), 'error'); return false; }
    // names arrive in batches (off the UI thread in the backend): labelling starts on the first ones
    let failed = null, gotFirst;
    const first = new Promise((r) => { gotFirst = r; });
    const onBatch = (entries) => { if (ltok === this.#ltok) { this.#merge(entries); gotFirst(); } };
    const run = be.listDirStream ? be.listDirStream(folder, IMAGE_EXTS, onBatch) : be.listDir(folder).then((l) => onBatch(l));
    run.then(() => {}, (e) => { failed = e; }).then(() => { if (ltok === this.#ltok) { this.listing = false; this.#merge([]); this.#saveOrder(); } gotFirst(); });
    await first;
    this.busy = false;
    if (failed && !this.images.length) { this.listing = false; this.real.toast('Cannot open the folder: ' + (failed?.message || failed), 'error'); return false; }
    this.folder = folder;
    this.real.settings.set('labelling.folder', folder);
    this.real.player?.pause?.();   // the project's video stays where it is, silent
    this.real.labelling = this;
    this.real.commands.setGate?.((c) => ALLOW.has(c.id) || ALLOW_PREFIX.some((p) => c.id.startsWith(p)));
    this.on = true;
    this.ready = false; this.index = -1;
    groupsFor(this.real).loadSeeder();
    if (!this.images.length) { this.note = 'No jpg, png or webp images in this folder'; return true; }
    this.note = '';
    await this.show(Math.max(0, this.todo(-1)));
    this.#loadGuesses().then(() => this.#tagSoon(), () => {});
    return true;
  }
  /** Back to the project exactly as it was (nothing of it was touched). */
  async leave() {
    if (!this.on) return;
    await this.flush();
    this.#tok++; this.#ltok++; this.listing = false; this.#stopTagging();
    const G = this.G;
    if (G.on) G.toggle(false);
    this.real.commands.setGate?.(null);
    this.on = false; this.ready = false;
    this.player.bmp = null; this.doc.media = null; this.doc.scenes = [];
    this.loader.clear();
  }
  /** Names arrived: merge, sort (natural order), keep the image on screen where it is by its key. */
  #merge(entries) {
    if (entries.length) this.#raw = this.#raw.concat(entries);
    else if (this.#raw.length === this.images.length) return;
    const cur = this.current?.key;
    this.#arrange(cur);
  }
  /** images = the listing in the active order; the image on screen (by key) keeps being the current one. */
  #arrange(cur = this.current?.key) {
    const list = listImages(this.#raw);
    const base = this.shuffle ? arrangeShuffled(list, this.#saved, this.#seed, cur).images : list;
    this.#order = this.shuffle ? base.map((im) => im.key) : null;
    const at = cur ? this.images.findIndex((im) => im.key === cur) : -1;   // paw-9p1h: duos first re-sorts only AHEAD of the picture on screen
    this.images = this.duos || this.#duoOff ? arrangeAhead(base, this.images, at + 1, this.guesses, this.duos) : base;
    this.#duoOff = false;
    if (cur) this.index = this.images.findIndex((im) => im.key === cur);
    if (this.index >= 0) this.#aim(this.index);
  }
  #order = null; #duoOff = false; #tagging = 0; #tagBusy = new Set(); #tagFail = new Set(); #tagTimer = 0; #tagDir = '';
  /** Remember the shuffle (seed and order) of a fully listed folder. */
  #saveOrder() {
    if (!this.shuffle || this.listing || !this.#order || !this.#orders) return;
    this.#saved = this.#order;
    this.#writeState();
  }
  #writeState() { this.#orders?.write({ seed: this.#seed, order: this.#saved, ...(this.skipped.size ? { skipped: [...this.skipped] } : {}) }).catch(() => {}); }
  /** Shuffled <-> folder order (remembered). */
  setShuffle(on) {
    if (!this.on || on === this.shuffle) return;
    this.shuffle = on; this.real.settings.set('labelling.shuffle', on);
    this.#arrange(); this.#saveOrder();
  }
  // ---- duos first (paw-9p1h) ----
  get looked() { let n = 0; for (const im of this.images) if (this.guesses.has(im.key)) n++; return n; }
  get duoTip() { return progressTip(this.looked, this.images.length); }
  isDuo(im) { return this.guesses.get(im.key)?.count === 'duo'; }
  /** Duos first on / off (remembered). On: the tagger starts looking a few pictures ahead; the list re-sorts only ahead of the cursor. */
  setDuos(on) {
    if (!this.on || on === this.duos) return;
    this.duos = on; this.real.settings.set('labelling.duos', on);
    if (!on) { this.#duoOff = true; this.#stopTagging(); }
    this.#arrange(); this.#tagSoon();
  }
  /** The tagger may look at the next picture now (pure rule in duos.js): the workspace is open and ready, nothing else uses the sidecar, the owner is not painting. */
  get #mayTag() {
    const G = this.G, tr = groupsFor(this.real).tr;
    return mayTag({ on: this.on, enabled: this.duos, ready: this.ready, trackerBusy: !!tr?.busy || !!tr?.locked || this.training, painting: !!(G.draft || G.xf || G.picker || G.lasso || G.busy || this.suggesting) });
  }
  tagJob = (req) => groupsFor(this.real).tr.job('tag', req, { title: 'Looking at pictures', owner: 'duos', task: false });   // injectable for tests; the normal job queue
  #tagSoon(ms = 1500) { clearTimeout(this.#tagTimer); if (this.on && this.duos) this.#tagTimer = setTimeout(() => this.#tagNext(), ms); }
  async #tagNext() {
    if (this.#tagging || !this.on || !this.duos) return;
    if (!this.#mayTag) { this.#tagSoon(4000); return; }   // painting or another job: look again in a few seconds
    const [im] = pickAhead(this.images.filter((x) => !this.#tagFail.has(x.key)), this.images.findIndex((x) => x.key === this.current?.key), this.guesses, this.#tagBusy, 1);
    if (!im) { this.#tagSoon(8000); return; }   // nothing ahead is unlooked-at (or a folder still listing): check again later
    const ltok = this.#ltok;
    this.#tagging++; this.#tagBusy.add(im.key);
    try {
      let g = null;
      const be = this.real.backend, file = this.#tagFile(im.key);
      if (file) { try { g = parseTag(await be.readText(file)); } catch { /* not cached */ } }
      if (!g) {
        const r = await this.tagJob(tagImageRequest({ image: im.path }));
        if (!this.on || !this.duos || ltok !== this.#ltok) return;
        if (r.cancelled) return;
        if (r.error || !r.result?.scores) {
          this.#tagFail.add(im.key);
          if (r.error && /GPU|CUDA|dependencies/.test(String(r.error))) { this.real.toast('Duos first stopped: ' + String(r.error).split(/\r?\n/)[0], 'warn'); this.setDuos(false); }
          return;
        }
        g = countGuess(r.result.scores);
        if (file) { try { if (!this.#tagMade) { await be.makeDir(this.#tagDir); this.#tagMade = true; } await be.writeText(file, tagJson(im.key, g)); } catch { /* the guess still counts this session */ } }
      }
      this.#gotGuess(im.key, g);
    } finally { this.#tagging--; this.#tagBusy.delete(im.key); this.#tagSoon(this.#mayTag ? 50 : 4000); }
  }
  #tagMade = false;
  #tagFile(key) { return this.#tagDir ? joinPath(this.#tagDir, key + '.json') : ''; }
  #gotGuess(key, g) {
    this.guesses = new Map(this.guesses).set(key, g);
    this.#arrange();   // ahead of the cursor only
  }
  /** Stop looking (leaving, or the setting went off): the job in flight is cancelled, nothing is queued. */
  #stopTagging() { clearTimeout(this.#tagTimer); groupsFor(this.real).tr?.cancelOwner?.('duos'); }
  /** The cached guesses of the folder's pictures (one read per key, in the background, only those on the list). */
  async #loadGuesses() {
    const be = this.real.backend, dir = this.#tagDir;
    if (!dir) return;
    const names = await be.listDir(dir).then((l) => new Set(l.map((e) => (e.name || '').replace(/\.json$/, ''))), () => new Set());
    const got = new Map(this.guesses);
    await Promise.all(this.images.filter((im) => names.has(im.key) && !got.has(im.key)).map(async (im) => { try { const g = parseTag(await be.readText(this.#tagFile(im.key))); if (g) got.set(im.key, g); } catch { /* skip */ } }));
    if (dir === this.#tagDir && this.on) { this.guesses = got; this.#arrange(); }
  }
  /** A new random order (the current image stays where it is on screen). */
  reshuffle() {
    if (!this.on) return;
    this.#seed = Math.floor(Math.random() * 2 ** 32); this.#saved = null;
    if (!this.shuffle) { this.shuffle = true; this.real.settings.set('labelling.shuffle', true); }
    this.#arrange(); this.#saveOrder();
  }

  // ---- moving through the folder ----
  /** Read-ahead: while image i is worked on, the next few (and the previous, and the next unlabelled one) load at lower priority. */
  #aim(i) {
    const im = this.images, want = readAhead(im, this.labelled, i, { next: this.todo(i) }), keep = new Set([im[i]?.key, ...want.map((j) => im[j].key)]);
    this.loader.keep(keep);
    want.forEach((j, r) => this.loader.prefetch(im[j], 1 + r));
  }
  /** The strip's tiles on screen need thumbnails: made once by the backend (local cache), nearest the current image first, at most
   *  MAX_LOW at a time and never ahead of an image read. A failure leaves the neutral tile. */
  wantThumbs(list) {
    const be = this.real.backend;
    if (!be.imageThumbnail || !this.thumbsDir) return;
    const keys = new Set(list.map((im) => im.key)), ci = this.index;
    this.loader.queue.cancel((j) => j.kind === 'thumb' && !keys.has(j.key.slice(2)));
    const at = (im) => Math.abs(this.images.indexOf(im) - ci);
    for (const im of [...list].sort((a, b) => at(a) - at(b))) {
      if (this.thumbs.has(im.key) || this.#bad.has(im.key)) continue;
      this.loader.queue.add('t:' + im.key, 10 + at(im), async () => {
        const d = this.loader.delay(); if (d) await new Promise((r) => setTimeout(r, d));
        await be.imageThumbnail(im.path, thumbFile(this.thumbsDir, im.key), THUMB_PX);
      }, { low: true, kind: 'thumb' }).then(() => { if (this.on) this.thumbs = new Set(this.thumbs).add(im.key); }, (e) => { if (e?.code !== 'cancelled') this.#bad.add(im.key); });
    }
  }
  thumbUrl(im) { return this.thumbs.has(im.key) ? this.real.backend.mediaUrl?.(thumbFile(this.thumbsDir, im.key)) || '' : ''; }
  /** Show image i: save the one on screen, show the new one as soon as it is decoded (a cached one at once; else the
   *  thumbnail blurred meanwhile), its label restored. A load for an image the owner has left is ignored. */
  async show(i) {
    if (!this.on || i < 0 || i >= this.images.length) return;
    const tok = ++this.#tok;
    this.#want = i;   // the image the owner is heading for: fast presses of next count from here, not from the one still on screen
    await this.flush();
    if (tok !== this.#tok) return;
    const G = this.G, img = this.images[i];
    this.ready = false; this.failed = ''; this.index = i; this.queue = []; G.disarm();
    this.compare = null; this.#held = []; this.#sugMasks = new Set();
    if (G.draft) G.cancel();
    this.loader.pin(img.key);
    this.#aim(i);
    let bmp = this.loader.peek(img.key), label = null;
    if (!bmp) {
      this.placeholder = this.thumbUrl(img);
      this.player.bmp = null; this.doc.scenes = [{ start_ms: 0, end_ms: 1000, groups: [] }];   // the old picture's shapes must not sit on the new one
    } else this.placeholder = '';
    try {
      const lp = this.labelled.has(img.key) ? this.#store.read(img.key) : null;
      if (!bmp) bmp = await this.loader.get(img, 0);
      label = await lp;
    } catch (e) { if (tok === this.#tok) this.failed = e?.code === 'timeout' ? 'it took too long' : e?.message || String(e); return; }
    if (tok !== this.#tok) return;
    this.placeholder = '';
    const groups = restoreGroups(label);
    this.player.bmp = bmp;
    this.player.view = { ...DEFAULT_VIEW };
    this.doc.media = { path: img.path, name: img.name, width: bmp.width, height: bmp.height, hash: { value: img.key } };
    this.doc.scenes = [{ start_ms: 0, end_ms: 1000, groups }];
    this.hist.reset();
    this.none = !!label?.none; this.complete = !!label?.complete; this.copied = label?.copied || ''; this.pendingCopy = false;
    this.#prev = partNames(groups);
    G.scene = 0; G.active = groups.length ? 0 : -1; G.xf = null; G.picker = null;
    if (!G.on) G.toggle(true);
    this.ready = true;
  }
  /** Try the image on screen again after a failed read. */
  retry() { return this.index >= 0 ? this.show(this.index) : undefined; }
  get #at() { return this.#want >= 0 ? this.#want : this.index; }
  next() { return this.show(Math.min(this.images.length - 1, this.#at + 1)); }
  prev() { return this.show(Math.max(0, this.#at - 1)); }
  /** The next image with no label (wrapping round; skipped ones only when nothing else is left); -1 / a toast when everything is labelled. */
  async nextUnlabelled() {
    const j = this.todo(this.#at);
    if (j < 0 || (j === this.index && this.labelled.has(this.current?.key))) { this.real.toast('Everything in this folder is labeled', 'quiet'); return false; }
    await this.show(j);
    return true;
  }
  /** paw-bybk: leaving the picture by U or Skip does what Enter does first: the confident name proposals are confirmed (nothing is asked);
   *  the unsure ones stay unnamed, and a quiet toast says how many were left on the picture just left. -> the blobs left unnamed. */
  async settleNames() {
    if (!this.ready || this.G.draft || !this.on) return 0;
    if (this.unassigned) { await this.G.proposalsSettled(); this.G.confirmProposals(); }
    const n = this.unassigned;
    if (n) this.real.toast(`${n} blob${n === 1 ? '' : 's'} left unnamed on the picture you left`, 'quiet');
    return n;
  }
  /** U: the names are settled (settleNames), then the next unlabelled image. */
  async advance() { await this.settleNames(); return this.nextUnlabelled(); }
  /** paw-fheb: put the image on screen off "for later" (stored with this dataset's order, not in its label) and go to the next one to label. */
  async skip() {
    const img = this.images[this.#at];
    if (!this.on || !img) return false;
    if (this.parts.length || this.unassigned) await this.settleNames();   // paw-bybk: painted blobs are saved with their confident names
    if (!this.labelled.has(img.key) && !this.skipped.has(img.key)) { this.skipped = new Set(this.skipped).add(img.key); this.#writeState(); }
    return this.nextUnlabelled();
  }
  /** Every skipped image is offered again in its place. */
  clearSkips() {
    if (!this.skipped.size) return;
    const n = this.skipped.size;
    this.skipped = new Set(); this.#writeState();
    if (this.index >= 0) this.#aim(this.index);
    this.real.toast(`${n} skipped image${n === 1 ? '' : 's'} back in the walk`, 'quiet');
  }
  /** The confident name proposals are confirmed (named_by 'auto'), the unassigned groups left get their parts (the assign pass), the
   *  label is saved. next (the Done, next button): then on to the next unlabelled image. Enter passes next false: it never leaves
   *  the image (the owner: "enter should also not go to the next img"); U moves on. */
  async done({ next = true } = {}) {
    const G = this.G;
    if (!this.ready || G.draft) return;
    if (this.unassigned) { await G.proposalsSettled(); G.confirmProposals(); }   // paw-p9ve: paint, paint, Enter: the confident proposals are named first
    if (this.unassigned && G.startPass()) return;
    if (this.pendingCopy) { this.pendingCopy = false; this.#dirty = true; }   // Done on a started-from label keeps it as it is
    await this.flush();
    if (next) await this.nextUnlabelled();
  }
  /** "Nothing to label here": stored (so the image is not offered again and can serve as a negative); again: back to unlabelled. */
  async toggleNone() {
    if (!this.ready) return;
    if (!this.none && this.parts.length) { this.real.toast('This image has groups: delete them first', 'quiet'); return; }
    this.none = !this.none;
    this.#dirty = true;
    await this.flush();
    if (this.none) await this.nextUnlabelled();
  }
  /** Y: "everything worth labelling in this picture is painted" (default off: partial). Stored; training then takes its unpainted
   *  patches as strong negatives. Needs painted parts (a picture with nothing on it is "nothing here"). */
  async toggleComplete() {
    if (!this.ready) return;
    if (!this.complete && !this.parts.length) { this.real.toast('Paint the parts first, or use Nothing here', 'quiet'); return; }
    this.complete = !this.complete;
    this.#dirty = true;
    this.real.toast(this.complete ? 'Fully labeled: unpainted areas teach the seeder “nothing here”' : 'Partial again: unpainted areas are unknown to the seeder', 'quiet');
    await this.flush();
  }
  /** R: the part names of the last image with groups become this image's to-paint list; the first is armed. */
  sameParts() {
    if (!this.ready) return;
    const names = this.#lastNames.filter((n) => !this.groups.some((g) => g.name === n));
    if (!names.length) { this.real.toast(this.#lastNames.length ? 'This image already has those parts' : 'No earlier image with parts yet', 'quiet'); return; }
    this.queue = names;
    this.#armNext();
  }
  /** Arm a queued part (click on its chip, or the next one). */
  arm(name) {
    const q = splitName(name), G = this.G;
    if (q.who) G.setWho(q.who);
    if (!(G.armed && G.nextName === name && G.active < 0)) G.pickPart(q.part || 'other', q.side || undefined);
  }
  #armNext() {
    const todo = this.queue.filter((n) => !this.groups.some((g) => g.name === n));
    if (!todo.length) { this.G.disarm(); return; }
    this.arm(todo[0]);
  }

  // ---- Suggest on the image (sidecar suggest_groups with image) ----
  /** Runs one Suggest job (injectable for tests): the app's tracker queue (the sidecar's normal job rules). */
  /** paw-p9ve: one name_groups job (injectable for tests): same queue and VRAM rules as Suggest. */
  nameJob = (req) => groupsFor(this.real).tr.job('name', req, { title: 'Naming groups', owner: 'name' });
  suggestJob = (req) => groupsFor(this.real).tr.job('groups', req, { title: 'Suggesting groups' });
  /** What the learned head + tagger would pin on the image on screen, shown as suggestions (dashed / faint) among the owner's groups,
   *  never replacing them; a per-part agreement when the image already has the owner's labels. A suggestion is NOT a label. */
  async suggest() {
    const img = this.current;
    if (!this.ready || this.suggesting || !img) return;
    const real = groupsFor(this.real), tok = this.#tok, G = this.G;
    this.suggesting = true; G.busy = true;
    try {
      const dir = await real.seedDir(), ds = await real.dataset();
      const ignore = this.painted.filter(isIgnore).map((g) => g.mask).filter((m) => m?.rle);
      const r = await this.suggestJob(suggestGroupsRequest({ image: img.path, ...(ignore.length ? { ignore } : {}), params: { head_shape: this.real.settings.get('tracking.seeder.sam') ? 'sam' : 'head', paint_margin: real.margin }, seed: dir ? { dir, ...(ds ? { dataset: ds.dir } : {}), key: img.key, features: this.real.settings.get('tracking.seeder.features', 'auto') } : null }));
      if (r.cancelled) return;
      if (r.error) { this.real.toast('Suggest failed: ' + String(r.error).split(/\r?\n/)[0], 'error'); return; }
      if (tok !== this.#tok) return;   // the owner moved on meanwhile
      const res = r.result || {};
      if ('seeder' in res) real.seeder = res.seeder ? { ...(real.seeder || {}), ...res.seeder } : null;
      this.#offer(res);
    } finally { this.suggesting = false; G.busy = false; }
  }
  /** Draw a suggest_groups result as suggestions among the painted groups; compare against them. */
  #offer(res) {
    const G = this.G, own = this.parts, size = G.size;
    const sug = suggestedGroups(res, 0, own, (poly) => encodeMask(rasterPoly(poly, size)));
    this.#sugMasks = new Set(sug.map((g) => g.mask.rle.join(',')));
    this.#held = [];
    const iou = (a, b) => { const x = maskOf(a, size).a, y = maskOf({ poly: b.poly }, size).a; let i = 0, u = 0; for (let k = 0; k < x.length; k++) { const p = x[k] > 0.5, q = y[k] > 0.5; if (p && q) i++; if (p || q) u++; } return u ? i / u : 0; };
    const rows = agreement(own, res.groups || [], iou, !(this.complete || this.none));
    this.compare = { rows, shown: true, hadLabels: own.length > 0, who: whoNote(res.who), learned: sug.filter((g) => g.source === 'seeder').length, tagger: sug.filter((g) => g.source !== 'seeder').length, ms: res.ms || 0 };
    const { shown, hidden } = splitByConfidence(sug, G.suggestConf);   // paw-r6t0: only the candidates at or above the shown confidence are in the picture
    G.holdSuggestions(hidden);
    this.compare = { ...this.compare, learned: shown.filter((g) => g.source === 'seeder').length, tagger: shown.filter((g) => g.source !== 'seeder').length, hidden: hidden.length };
    this.app.transact('Groups: suggest', () => { this.doc.scenes = [{ ...this.doc.scenes[0], groups: [...this.groups.filter((g) => !isSuggested(g)), ...shown] }]; });
    if (shown.length) G.active = this.groups.length - shown.length;
    this.real.toast(shown.length ? `${shown.length} suggested${hidden.length ? ` · ${hidden.length} more below ${Math.round(G.suggestConf * 100)} %` : ''} (dashed until you accept them)` : hidden.length ? `Nothing above ${Math.round(G.suggestConf * 100)} % (${hidden.length} below: lower the confidence beside Suggest)` : 'Nothing suggested on this image', 'quiet');
  }
  /** Compare: hide / show the suggestions over the owner's labels (they stay held, not discarded). */
  toggleSuggestions() {
    if (!this.compare) return;
    const on = !this.compare.shown, keep = this.groups.filter((g) => !isSuggested(g));
    if (!on) this.#held = this.groups.filter(isSuggested);
    this.doc.scenes = [{ ...this.doc.scenes[0], groups: on ? [...keep, ...this.#held.filter((h) => !keep.some((k) => k.name === h.name))] : keep }];
    this.compare = { ...this.compare, shown: on };
  }
  /** Drop the suggestions (the owner's groups stay). */
  dismissSuggestions() {
    this.doc.scenes = [{ ...this.doc.scenes[0], groups: this.painted }];
    this.compare = null; this.#held = []; this.G.holdSuggestions([]); this.G.active = this.groups.length ? 0 : -1;
  }
  get suggestionCount() { return this.groups.filter(isSuggested).length; }

  // ---- saving ----
  /** A stroke / edit / undo finished: save soon; advance the part queue. */
  #edited() {
    this.#dirty = true; this.pendingCopy = false;   // an edit makes a started-from label this dataset's own
    if (this.parts.length && this.none) this.none = false;   // painting on a "nothing here" image makes it a labelled one
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.flush(), SAVE_MS);
    if (this.queue.length) this.#armNext();
  }
  /** Write (or delete) the label of the image on screen when it changed. */
  async flush() {
    clearTimeout(this.#timer);
    const img = this.current;
    if (!this.#dirty || !img || !this.#store || !this.ready) return;
    this.#dirty = false;
    const { width: w, height: h } = this.doc.media || {}, none = this.none && !this.parts.length, complete = this.complete && !none && this.parts.length > 0;
    // ONLY what the owner painted or accepted is a label (source user); suggestions still on offer are never written. A group that is
    // exactly a suggestion's mask (accepted untouched) is marked from: 'suggest' (ponytail: an accepted one edited later keeps the mark)
    const { groups: parts, ignore } = splitStored(this.painted), groups = parts.map((g) => (g.mask?.rle && this.#sugMasks.has(g.mask.rle.join(',')) ? { ...g, from: 'suggest' } : g));
    const set = new Set(this.labelled), marks = new Map(this.marks);
    try {
      if (groups.length || ignore.length || none) {   // ponytail: ignore regions alone are saved (not lost on moving on) and count as labelled; they train nothing until a part or "nothing here" is there
        await this.#store.write(makeLabel({ image: img.path, key: img.key, w, h, groups, ignore, none, complete, copied: this.copied || undefined }));
        set.add(img.key); marks.set(img.key, { none, n: groups.length, ign: ignore.length, complete });
        if (this.skipped.has(img.key)) { const k = new Set(this.skipped); k.delete(img.key); this.skipped = k; this.#writeState(); }   // labelling a skipped image clears its skip
        if (groups.length) { this.#lastNames = partNames(groups); this.#prev = this.#lastNames; }
      } else { await this.#store.remove(img.key); set.delete(img.key); marks.delete(img.key); }
    } catch (e) { this.#dirty = true; this.real.toast('Could not save the label: ' + (e?.message || e), 'error'); return; }
    this.labelled = set; this.marks = marks;
    this.#aim(this.index);   // the next unlabelled image may have changed
  }
  /** Read the stored label of a labelled thumbnail on screen (none / n groups) for its mark. */
  async markOf(img) {
    if (this.marks.has(img.key) || !this.labelled.has(img.key)) return;
    const l = await this.#store.read(img.key);
    if (this.marks.has(img.key)) return;
    this.marks = new Map(this.marks).set(img.key, { none: !!l?.none, n: l?.groups?.length || 0, ign: l?.ignore?.length || 0, complete: !!l?.complete });
  }
  /** The seeder's tool state (the project's Groups tool owns the record and the job): what it learned, is it training. */
  get seeder() { return groupsFor(this.real).seeder; }
  get training() { return groupsFor(this.real).training; }
  /** "Train the seeder": the request the app already sends (seed_train: projects' groups + these image labels); the labels are
   *  flushed first; a no-op in the sidecar when nothing changed since the last training. */
  async train() {
    await this.flush();
    return groupsFor(this.real).retrain({ images: true });
  }
}

const stores = new WeakMap();
export function labellingFor(app) {
  let s = stores.get(app);
  if (!s) { s = rooted(() => new LabelWorkspace(app), app); stores.set(app, s); }   // paw-b7da: its own root, never the asking component's
  return s;
}
