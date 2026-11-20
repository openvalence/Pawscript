// tabs.svelte.js -- the tabs in the top bar (paw-shgb): the home tab (the project page) and one tab per open document.
// Stage 2: each document is its own app (createApp + its project, player, undo, feature stores), all sharing one settings
// object, one backend, one usage log and this Tabs. Only the shown app's editor is mounted (Shell.svelte keys it); a hidden
// one keeps its document, undo history, playhead, view, selection and mode in its app, and its jobs and continuous write
// go on (its project's own timer). While the home tab shows, the last shown document stays mounted under it (hidden and
// inert) and only the commands homeAllows admits run (commands.js `scope`).
//
// `make` (boot.js) builds a further app; without it (tests, harnesses on createApp) there is one document, opening another
// replaces it, as stage 1 did.

import { tick, untrack } from 'svelte';
import { pathKey } from './home.js';
import { classifyPaths } from './project-logic.js';
import { shown } from '../lib/shown.svelte.js';
import { reopenGuarded } from './open-guard.js';
import { guard } from './commands.js';

export const HOME = 'home';
const RESUME = 'pawscript.resume';   // project.svelte.js: the resume store; `open` / `active` are the tabs' (keys of the documents)

// what still runs while the home tab hides the editor: the File menu (open, save, close the document), the palette
// and help overlays, the look (paw-rbrd: furry items too, the first-run card's "Hide furry items"), the settings, the tabs themselves.
// Everything else would act on a document nobody sees.
const HOME_PREFIX = /^(tabs|file|help|settings|view\.theme|view\.density)\./;
const HOME_IDS = new Set(['palette.open', 'palette.help', 'palette.close', 'palette.keys', 'quick.open', 'view.furry']);   // F1 works on home too (paw-idb5); the Quick menu, with its own list there
export const homeAllows = (id) => HOME_PREFIX.test(id) || HOME_IDS.has(id);
const hasDoc = (a) => { const d = a.doc; return !!(d.media || Object.keys(d.axes).length); };
const docKey = (a) => a.project?.key || a.doc.project?.path || a.doc.media?.path || a.doc.project?.base || null;
const MEMORY_MB = 1200;   // settings 'tabs.memoryMB': what the hidden tabs' runs may hold before the oldest shown is parked
const fileOf = (p) => String(p).split(/[\\/]/).pop();

export class Tabs {
  apps = $state.raw([]);   // every app of the window in tab order (an app without a document is the spare: the next open uses it)
  #want = $state('');      // the tab the owner picked: an app's tabId or HOME ('' = the first document)
  #last = $state.raw(null);   // the document shown last: it stays mounted under the home tab, the keys go to it
  #focus = null;           // what had focus in the editor when home was shown: it gets it back
  #roots = new Map();      // app -> the effect root it was made under (made by `make`): ended when its tab closes
  make = null;             // () -> a new app on the same settings / backend / tabs (boot.js); null: one document
  restored = false;        // the open tabs are written to the resume store from the first restore on
  // paw-shgb memory policy: a parked tab keeps its place in the strip but not its document (written, then unloaded: its undo
  // history is in its .pawhistory, where the owner was in the resume store); showing it opens it again from disk, where it was.
  // tabId -> {key, name, loading}. Parked: the hidden tabs shown longest ago while their runs pass the budget, and at start every
  // restored tab but the shown one (each opens when first shown).
  parked = $state.raw({});
  #shownAt = new WeakMap();
  #seq = 0;
  // paw-w959: the owner showed or opened a tab since start-up; a document restore() is still opening then comes back behind
  #acted = false;
  #restoring = new WeakSet();
  #quiet(app) { return this.#acted && this.#restoring.has(app); }

  #first = null;           // the window's first app: the root component, the window's listeners and the device link hold it, so it
                           // never goes. With `make` it never holds a document (each document's app goes with its tab, all of
                           // it: a store a closed editor handed a closure keeps nothing); without, it is the one document's
  constructor(app) { this.#first = app; this.#adopt(app); shown.app = app; }   // a test's createApp: the one it drives
  #adopt(app) { app.tabId = this.#seq++ ? 'doc' + this.#seq : 'doc'; app.tabs = this; this.apps = [...this.apps, app]; }

  /** The open documents: [{id, app}], in tab order. */
  get list() { return this.apps.filter((a) => hasDoc(a) || this.parked[a.tabId]).map((a) => ({ id: a.tabId, app: a, parked: this.parked[a.tabId] || null })); }
  /** The tab's name: its project / video, a parked one's file. */
  nameOf(a) {
    const own = (x) => x.project?.name || x.doc.media?.name || this.parked[x.tabId]?.name || (Object.keys(x.doc.axes).length ? 'Untitled' : '');
    const n = own(a);
    // paw-qf5o: two open tabs of one name (a project and its unpacked pack): each also names its folder
    if (!n || !this.list.some((t) => t.app !== a && own(t.app) === n)) return n;
    const dir = String(docKey(a) || this.parked[a.tabId]?.key || '').split(/[\\/]/).slice(-2, -1)[0];
    return dir ? `${n} · ${dir}` : n;
  }
  /** 'home' or the shown document's id (home whenever nothing is open). */
  get active() {
    const l = this.apps.filter((a) => hasDoc(a) && !this.parked[a.tabId]);   // a parked tab shows once it is open again
    if (this.#want === HOME || !l.length) return HOME;
    return l.some((a) => a.tabId === this.#want) ? this.#want : l.includes(this.#last) ? this.#last.tabId : l[0].tabId;
  }
  get home() { return this.active === HOME; }
  /** A document is open but hidden behind the home tab: its keys, playback and focus are off. */
  get hidden() { return this.home && this.list.length > 0; }
  /** The app the window shows (its editor mounted, the keys, menus and status bar its): the shown document; on home the last
   *  shown one (mounted under the page), else the first app. */
  get current() {
    const id = this.active;
    if (id !== HOME) return this.appOf(id);
    const l = this.apps.filter((a) => hasDoc(a) && !this.parked[a.tabId]);
    return (l.includes(this.#last) ? this.#last : l[0]) || this.apps.find((a) => !this.parked[a.tabId]) || this.apps[0];
  }
  appOf(id) { return this.apps.find((a) => a.tabId === id) || null; }

  /** Show a tab. Leaving a document pauses it (its job, its write and the device link carry on; only the shown one plays);
   *  coming back from home gives focus back to where it was. */
  show(id) { this.#acted = true; return this.#show(id); }
  #show(id) {
    if (id !== HOME && !this.list.some((t) => t.id === id)) return false;
    if (id !== HOME && this.parked[id]) { this.#unpark(this.appOf(id)); return true; }
    if (id === this.active) return true;
    const was = this.current, leaving = !this.home;
    if (leaving) {
      was.player?.pause?.();
      const a = typeof document !== 'undefined' ? document.activeElement : null;
      this.#focus = id === HOME && a && a !== document.body ? a : null;
    }
    this.#want = id;
    if (id !== HOME) this.#last = this.appOf(id);
    shown.app = this.current;
    this.#shownAt.set(this.current, Date.now());
    this.current.usage?.note('ui:tab', { tab: id === HOME ? 'home' : 'doc', n: this.list.length });
    this.#budgetSoon();
    if (id !== HOME && this.#focus && this.current === was) {
      const f = this.#focus;
      this.#focus = null;
      tick().then(() => { if (f.isConnected) f.focus({ preventScroll: true }); });
    }
    this.#persist();
    return true;
  }
  /** Ctrl+Tab / Ctrl+Shift+Tab: the next / previous tab, round. */
  cycle(dir = 1) {
    const ids = [HOME, ...this.list.map((t) => t.id)];
    return this.show(ids[(ids.indexOf(this.active) + dir + ids.length) % ids.length]);
  }
  /** Drag reorder: the document tab `id` before the document tab `before` (null: last). */
  move(id, before = null) {
    const a = this.appOf(id);
    if (!a || id === before) return false;
    const rest = this.apps.filter((x) => x !== a), i = before ? rest.findIndex((x) => x.tabId === before) : -1;
    rest.splice(i < 0 ? rest.length : i, 0, a);
    this.apps = rest;
    this.#persist();
    return true;
  }

  /** app.load ran in `app` (a document was opened, restored or closed). Opened: its tab shows. Closed: with other apps open
   *  the app goes and its neighbour shows (home when it was the last document); the last app stays as the spare. */
  loaded(app = this.apps[0]) {
    if (!this.apps.includes(app)) return;
    if (hasDoc(app)) {
      if (this.parked[app.tabId]) { const { [app.tabId]: _, ...rest } = this.parked; this.parked = rest; }
      if (this.#quiet(app)) { this.#persist(); return; }
      this.#want = app.tabId; this.#last = app; this.#focus = null;
      shown.app = app;
      this.#shownAt.set(app, Date.now());
      this.#persist();
      this.#budgetSoon();
      return;
    }
    if (this.parked[app.tabId]) { this.#persist(); return; }   // parked: its tab stays
    if (this.apps.length < 2) { this.#want = HOME; shown.app = app; this.#persist(); return; }
    const docs = this.apps.filter((a) => a === app || hasDoc(a) || this.parked[a.tabId]), i = docs.indexOf(app), next = docs[i + 1] || docs[i - 1] || null;
    const wasShown = untrack(() => this.current) === app || this.#last === app;
    this.apps = app === this.#first ? [...this.apps.filter((a) => a !== app), app] : this.apps.filter((a) => a !== app);
    if (this.#last === app) this.#last = null;
    if (wasShown && next && this.parked[next.tabId]) { this.#want = HOME; this.#unpark(next); }   // its neighbour opens again, home meanwhile
    else if (wasShown) this.#want = next && this.#want !== HOME ? next.tabId : HOME;
    if (wasShown && next && !this.parked[next.tabId]) this.#last = next;
    shown.app = this.current;
    this.#persist();
    if (app !== this.#first) setTimeout(() => this.#drop(app), 0);   // after the close that called this has unwound
  }
  /** A closed tab's app: its timers, listeners and effects end (its memory goes with it). */
  #drop(app) {
    try { app.project?.stopAutosave?.(); } catch { /* best-effort */ }
    try { app.destroy?.(); } catch (e) { console.warn('[tabs] destroy:', e); }
    this.#roots.get(app)?.();
    this.#roots.delete(app);
  }

  /** The tab's x / middle-click: File > Close for an open document (written, no question); a parked one just goes. */
  close(app) {
    if (!this.parked[app?.tabId]) return app?.commands.run('file.close');
    const { [app.tabId]: _, ...rest } = this.parked;
    this.parked = rest;
    this.loaded(app);   // no document and not parked: it goes as a closed tab does
    return true;
  }

  // ---- memory: parking ----
  /** Park a hidden tab: its document written, then unloaded; the tab stays. Never the shown one, one with a job running, one
   *  busy, or one with no project file yet (it could not come back). -> bool */
  async park(app) {
    const p = app?.project;
    if (!this.make || !p || !this.apps.includes(app) || app === this.#first || app === this.current || this.parked[app.tabId] || !hasDoc(app) || p.busy || !p.path || app.jobBusy?.()) return false;
    if (!(await p.flush().catch(() => false)) && app.doc.dirty) return false;   // not written: it stays in memory
    if (app === this.current || app.jobBusy?.() || !this.apps.includes(app)) return false;   // shown, busy or closed meanwhile
    // its place goes to a fresh app holding nothing (the tab, its id, its name); the app itself is closed and dropped whole
    // a new tab id: the strip's keyed entry is made again (the old one's closures held the old app)
    const fresh = this.#spawn(), id = 'doc' + ++this.#seq;
    fresh.tabId = id; fresh.tabs = this;
    this.#shownAt.set(fresh, this.#shownAt.get(app) || 0);
    this.parked = { ...this.parked, [id]: { key: p.path, name: p.name, loading: false } };
    this.apps = this.apps.map((a) => (a === app ? fresh : a));
    if (this.#last === app) this.#last = null;
    let closed = false;
    try { closed = await p.close({ anyway: true }); }   // work only in app data comes back when it is shown again
    finally {
      if (closed) this.#drop(app);
      else {   // paw-f4i2: not left (an edit meanwhile could not be written): the document stays, the fresh app goes
        this.apps = this.apps.map((a) => (a === fresh ? app : a));
        const { [id]: _, ...rest } = this.parked; this.parked = rest;
        this.#drop(fresh);
      }
    }
    if (!closed) return false;
    fresh.usage?.note('ui:tabPark', { n: this.list.length });
    return true;
  }
  /** A further app (make) under its own root, not yet in the strip. */
  #spawn() {
    let app = null;
    // under its own root: a store made by the first open must not belong to whatever reaction ran the open (paw-b7da)
    const stop = $effect.root(() => { app = this.make(); });
    app ??= this.make();   // the server build (node tests) has no effect roots
    this.#roots.set(app, stop);
    return app;
  }
  /** Show a parked tab: its document opens again in its app (where it was: the resume store), then shows. */
  async #unpark(app) {
    const P = this.parked[app?.tabId];
    if (!P || P.loading) return false;
    this.parked = { ...this.parked, [app.tabId]: { ...P, loading: true } };
    let ok = false;
    try { ok = await app.project.openPaths([P.key]); } catch (e) { console.warn('[tabs] reopen:', e); }
    if (!ok && this.parked[app.tabId]) this.parked = { ...this.parked, [app.tabId]: { ...P, loading: false } };   // still parked: a click tries again
    return ok;
  }
  /** Hidden tabs past the budget (settings 'tabs.memoryMB'): the one shown longest ago is parked, until under it. */
  #budgetSoon() { clearTimeout(this.#budgetTimer); this.#budgetTimer = setTimeout(() => this.budget(), 1500); }
  #budgetTimer = 0;
  async budget() {
    const cap = +(this.apps[0]?.settings?.get?.('tabs.memoryMB', MEMORY_MB) ?? MEMORY_MB);
    const hidden = this.apps.filter((a) => a !== this.current && hasDoc(a) && !this.parked[a.tabId]);
    let total = hidden.reduce((n, a) => n + (+a.heavyMB?.() || 0), 0);
    for (const a of hidden.sort((x, y) => (this.#shownAt.get(x) || 0) - (this.#shownAt.get(y) || 0))) {
      if (total <= cap) break;
      const mb = +a.heavyMB?.() || 0;
      if (mb > 0 && (await this.park(a))) total -= mb;
    }
  }

  /** The app holding this path (its project, video or funscript base), else null. */
  appFor(path) {
    if (!path) return null;
    const k = pathKey(path);
    return this.list.map((t) => t.app).find((a) => { const d = a.doc; return [d.project?.path, d.media?.path, d.project?.base, this.parked[a.tabId]?.key].some((p) => p && pathKey(p) === k); }) || null;
  }
  /** Is this path an open document (its project, video or funscript base)? */
  isOpen(path) { return !!this.appFor(path); }
  /** Show the tab of an open path. -> bool */
  showPath(path) { const a = this.appFor(path); return !!a && this.show(a.tabId); }

  /** The app a new document goes into: the spare (an app with no document), else a new one (`make`), else (one-document
   *  mode) the current app, whose document the open replaces. */
  #target() {
    const spare = this.apps.find((a) => (!this.make || a !== this.#first) && !hasDoc(a) && !this.parked[a.tabId] && !a.project?.busy);
    if (spare) return { app: spare, made: false };
    if (!this.make) return { app: this.current, made: false };
    const app = this.#spawn();
    this.#adopt(app);
    return { app, made: true };
  }
  /** Run fn(app) on the app a new document goes into (#target); a success shows it, a failure in a new app drops it. */
  async into(fn) {
    const { app, made } = this.#target();
    let ok = false;
    try { ok = !!(await fn(app)); }
    finally {
      if (!(ok && hasDoc(app)) && this.parked[app.tabId]) { const { [app.tabId]: _, ...rest } = this.parked; this.parked = rest; }   // its 'opening' tab goes
      if (ok && hasDoc(app) && !this.#quiet(app)) this.#show(app.tabId);
      else if (made && !hasDoc(app)) { this.apps = this.apps.filter((a) => a !== app); this.#drop(app); }
    }
    return ok;
  }
  /** Open from the project page, a drop, the File menu, the OS: an open document again only switches to its tab;
   *  funscripts alone while a document shows are imported into it (as before); anything else opens in a tab of its own
   *  through app.project.openPaths (its questions). -> bool */
  async open(paths, opts = {}) {
    const list = [].concat(paths || []).filter(Boolean);
    if (!list.length) return false;
    this.#acted = true;
    const hit = list.length === 1 && this.appFor(list[0]);
    if (hit) return this.show(hit.tabId);
    const c = classifyPaths(list), cur = this.current;
    if (!c.projects.length && !c.videos.length && c.funscripts.length && !this.home && hasDoc(cur)) return cur.project.openPaths(list, opts);
    // a video whose project is open: that tab (opening the video again goes back into its project)
    const v = !c.projects.length && c.videos.length === 1 && this.appFor(c.videos[0].replace(/\.[^.\\/]+$/, '.pawproj'));
    if (v) return this.show(v.tabId);
    // its tab shows at once, turning while it opens (a big project's runs take seconds); the shown tab stays until it is open
    return this.into((a) => { if (this.make) this.parked = { ...this.parked, [a.tabId]: { key: list[0], name: fileOf(list[0]), loading: true } }; return a.project.openPaths(list, opts); });
  }

  // ---- the open tabs across a restart ----
  #store(fn) {
    const st = this.apps[0]?.settings?.storage;
    if (!st) return null;
    let s;
    try { s = JSON.parse(st.getItem(RESUME) || 'null') || {}; } catch { s = {}; }
    if (!fn) return s;
    fn(s);
    try { st.setItem(RESUME, JSON.stringify(s)); } catch (e) { console.warn('[tabs] not kept:', e); }
    return s;
  }
  /** The open documents (their keys: project, else video, else funscript base) and the shown one, for the next start. */
  #persist() {
    if (!this.restored) return;
    const open = this.list.map((t) => this.parked[t.id]?.key || docKey(t.app)).filter(Boolean), cur = this.home ? null : docKey(this.current);
    this.#store((s) => { s.open = open; s.active = cur; s.last = cur ?? s.last ?? null; });
  }
  /** Note the open tabs now (a document got its place: its key changed). */
  note() { this.#persist(); }
  /** At launch: every tab that was open comes back, in order, each where it was; the one shown at quit shows (home if home
   *  showed), unless the owner showed or opened a tab meanwhile: then it comes back behind (paw-w959). Older stores (one document, `last`) reopen that one. -> the number reopened */
  async restore() {
    const s = this.#store() || {}, exists = (p) => Promise.resolve(this.apps[0].backend.exists(p)).catch(() => false);
    // setting tabs.reopen off: nothing comes back (the Projects page shows); the list is written afresh from here on
    const list = this.apps[0].settings?.get?.('tabs.reopen') === false ? [] : Array.isArray(s.open) ? s.open : s.last ? [s.last] : [];
    // the shown one opens; the others come back parked (each opens when first shown: a start never decodes every tab's runs)
    const first = list.find((p) => s.active && pathKey(p) === pathKey(s.active)) ?? (Array.isArray(s.open) && !s.active ? null : list[0]);
    let n = 0;
    try {
      for (const p of list) {
        if (typeof p !== 'string' || this.appFor(p) || !(await exists(p))) continue;
        // paw-a82t: the start-up open is guarded (one that never came back last time stays closed, with Open anyway)
        if (p === first || !this.make) { if (await this.into((a) => { this.#restoring.add(a); return reopenGuarded(a, p, (x) => a.project.openPaths([x])); })) n++; continue; }
        const { app } = this.#target();
        this.parked = { ...this.parked, [app.tabId]: { key: p, name: fileOf(p), loading: false } };
        n++;
      }
    } finally {
      this.restored = true;
      this.#restoring = new WeakSet();   // a later load of those documents (a reload, a checkpoint) shows as before
      const want = !this.#acted && s.active && this.appFor(s.active);
      if (want) this.#show(want.tabId);
      else if (!this.#acted && n && Array.isArray(s.open) && !s.active) this.#show(HOME);
      this.#persist();
    }
    return n;
  }
  /** Every document written and left (quit: the window closes; nothing is unloaded, the tabs reopen at the next start).
   *  -> false when one stays (paw-f4i2: its work is kept nowhere else; it said so) */
  async closeAll({ quit = true } = {}) {
    let all = true;
    for (const a of [...this.apps]) {
      try { if ((await a.project?.close?.({ quit })) === false) all = false; } catch (e) { all = false; console.warn('[tabs] close:', e); }
    }
    return all;
  }
}

/** The tab commands (registered by createApp, so they come before every feature's: Ctrl+Tab is theirs). */
export const tabsCommands = (app) => {
  const T = () => app.tabs;
  const docName = (a) => a.project?.name || a.doc.media?.name || 'Untitled';
  return [
    { id: 'tabs.home', title: 'Go to projects', menu: 'View', group: 'tabs', when: guard(() => !T().home, 'You are on the project page'), run: () => T().show(HOME) },
    { id: 'tabs.doc', get title() { return 'Back to ' + docName(T()?.current ?? app); }, menu: 'View', group: 'tabs', when: guard(() => T().hidden, 'The document is already shown'), run: () => T().show(T().current.tabId) },
    { id: 'tabs.next', title: 'Next tab', keys: ['Ctrl+Tab'], menu: 'View', group: 'tabs', when: guard(() => T().list.length > 0, 'Open a document first'), run: () => T().cycle(1) },
    { id: 'tabs.prev', title: 'Previous tab', keys: ['Ctrl+Shift+Tab'], menu: 'View', group: 'tabs', when: guard(() => T().list.length > 0, 'Open a document first'), run: () => T().cycle(-1) },
  ];
};
