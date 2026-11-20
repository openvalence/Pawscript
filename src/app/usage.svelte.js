// usage.svelte.js -- app.usage: a local log of what the user does, to see what happens most and where the friction is.
// Two sinks, nothing leaves the machine:
//  - a ring of the last USAGE_CAP entries {t, kind, detail?} in localStorage 'usage.log' plus running counts per kind
//    (never trimmed) in 'usage.counts' (commands usage.report / usage.clear, menu Help);
//  - JSONL, one file per local day: <app local data dir>/usage-YYYY-MM-DD.jsonl (Tauri only: app_paths data_dir),
//    one line per event {t: ISO, s: session id, k: kind, ...data}, written every few seconds. dev/usage-report.mjs reads it.
// Kinds: every command id (no colon; app.svelte.js onRun adds src key|palette|menu|button|code and focus), and notes
// prefixed with their area ('tracking:runStart', 'edit:undo', 'ui:dialog', ...; dev/usage-report.mjs lists them).
// burst() coalesces high-frequency events (scrub, zoom, slider drags) into one with n + ms. Setting usage.log = false
// stops both sinks.

export const USAGE_CAP = 5000;
const LOG = 'usage.log', COUNTS = 'usage.counts', FILE_MS = 5000, BEAT_MS = 60000, MEM_CAP = 20000, RECENT = 30;
const read = (s, k) => { try { return JSON.parse(s?.getItem(k) || 'null'); } catch { return null; } };
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** Short text for the log: strings clipped, other values as clipped JSON. */
export const clip = (v, n = 160) => { const s = typeof v === 'string' ? v : JSON.stringify(v) ?? String(v); return s.length > n ? s.slice(0, n) + '…' : s; };
const day = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** paw-pq6b: an error raised by the dev server's hot reload, not by the app: Vite's client runs a component's accept handler
 *  with `undefined` when the updated module failed to load (a file mid-merge, the page already reloading), and Svelte's
 *  handler reads `module.default` ("Cannot read properties of undefined (reading 'default')"). Logged as app:hmr, no toast. */
export const fromHotReload = (e) => typeof e?.stack === 'string' && e.stack.includes('/@vite/client');

export class Usage {
  /** storage: a Storage-like object (localStorage) or null for in-memory only. opts: enabled() -> bool (setting
   *  usage.log), sink: {append(text, t)} (fileSink) or null = lines kept in memory only (this.lines, capped). */
  constructor(storage = typeof localStorage !== 'undefined' ? localStorage : null, cap = USAGE_CAP, { enabled = () => true, sink = null } = {}) {
    this.storage = storage; this.cap = cap; this.timer = 0;
    const log = read(storage, LOG), counts = read(storage, COUNTS);
    this.log = Array.isArray(log) ? log.slice(-cap) : [];
    this.counts = isObj(counts) ? counts : {};
    this.enabled = enabled; this.sink = sink;
    this.sid = Math.random().toString(36).slice(2, 8);
    this.lines = []; this.fileTimer = 0; this.bursts = new Map(); this.lastInput = 0; this.stops = [];
    this.recent = [];          // the last RECENT events {t (ms), k, ...data}: a feedback note's context
    this.tap = null;           // (event {t (ms), s, k, ...data}) after every event: the fix log (app/fixlog.js)
    this.beforeFlush = null;   // () first thing in flushAll: the fix log closes its open episodes
  }
  /** detail: a string / number (ring detail, JSONL `d`) or an object (its fields go into the JSONL line, the ring gets
   *  its JSON). opts.ring false: JSONL only (heartbeats); opts.t: the event's time (a burst's start). */
  note(kind, detail, { ring = true, t = Date.now() } = {}) {
    try {
      if (!kind || !this.enabled()) return;
      kind = String(kind);
      if (ring) {
        const e = { t, kind };
        if (detail != null && detail !== '') e.detail = isObj(detail) ? JSON.stringify(detail) : String(detail);
        this.log.push(e);
        if (this.log.length > this.cap) this.log.splice(0, this.log.length - this.cap);
        this.counts[kind] = (this.counts[kind] || 0) + 1;
        if (this.storage && !this.timer) this.timer = setTimeout(() => this.flush(), 1000);   // one write per burst
      }
      const data = isObj(detail) ? detail : detail != null && detail !== '' ? { d: detail } : {};
      this.lines.push(JSON.stringify({ t: new Date(t).toISOString(), s: this.sid, k: kind, ...data }));
      this.recent.push({ t, k: kind, ...data });
      if (this.recent.length > RECENT) this.recent.shift();
      if (this.tap) { try { this.tap({ t, s: this.sid, k: kind, ...data }); } catch (e) { console.warn('[usage] tap:', e); } }
      if (this.lines.length > MEM_CAP) this.lines.splice(0, this.lines.length - MEM_CAP);
      if (this.sink && !this.fileTimer) this.fileTimer = setTimeout(() => this.flushFile(), FILE_MS);
    } catch (e) { console.warn('[usage]', e); }   // never into the app
  }
  /**
   * One event for a run of rapid calls (scrub, zoom, a slider): emitted `gap` ms after the last call, at the first
   * call's time, as {...last call's data, from: first call's data.from, n: calls, ms: first to last}. opts.key
   * separates bursts of one kind (a setting's key, an effect's id).
   */
  burst(kind, data = {}, { key = kind, gap = 800 } = {}) {
    try {
      if (!this.enabled()) return;
      const now = Date.now(), b = this.bursts.get(key) || { kind, t0: now, n: 0, from: data.from };
      b.n++; b.t1 = now; b.data = data;
      clearTimeout(b.timer); b.timer = setTimeout(() => this.endBurst(key), gap);
      this.bursts.set(key, b);
    } catch (e) { console.warn('[usage]', e); }
  }
  endBurst(key) {
    const b = this.bursts.get(key);
    if (!b) return;
    clearTimeout(b.timer); this.bursts.delete(key);
    this.note(b.kind, { ...b.data, ...(b.from !== undefined ? { from: b.from } : {}), n: b.n, ms: b.t1 - b.t0 }, { t: b.t0 });
  }
  /** Input (pointer / key / wheel) seen within the last `ms`. */
  userActive(ms = 1000) { return Date.now() - this.lastInput < ms; }
  /** [[kind, count]] most frequent first. */
  top(n = Infinity) { return Object.entries(this.counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n); }
  /** Tab-separated: the counts, a blank line, then the log (ISO time, kind, detail), oldest first. */
  report() {
    return ['kind\tcount', ...this.top().map(([k, n]) => `${k}\t${n}`), '', 'time\tkind\tdetail',
      ...this.log.map((e) => `${new Date(e.t).toISOString()}\t${e.kind}\t${e.detail ?? ''}`)].join('\n') + '\n';
  }
  clear() { this.log = []; this.counts = {}; this.flush(); }
  flush() {
    clearTimeout(this.timer); this.timer = 0;
    try { this.storage?.setItem(LOG, JSON.stringify(this.log)); this.storage?.setItem(COUNTS, JSON.stringify(this.counts)); } catch (e) { console.warn('[usage] not saved:', e); }
  }
  /** Hands the pending JSONL lines to the sink. -> the sink's promise (or undefined). */
  flushFile() {
    clearTimeout(this.fileTimer); this.fileTimer = 0;
    if (!this.sink || !this.lines.length) return;
    const text = this.lines.splice(0).join('\n') + '\n';
    try { return this.sink.append(text, Date.now()); } catch (e) { console.warn('[usage] file log:', e); }
  }
  /** Every open burst closed, both sinks written. */
  flushAll() { for (const k of [...this.bursts.keys()]) this.endBurst(k); try { this.beforeFlush?.(); } catch (e) { console.warn('[usage]', e); } this.flush(); return this.flushFile(); }
  /** The app is closing: app:close noted (once), both sinks written. -> the file sink's promise (await it before the
   *  window goes: a page torn down mid-write loses the day's last lines, paw-mn92). */
  close() { if (!this.closed) { this.closed = true; this.note('app:close'); } return this.flushAll(); }

  /**
   * Listeners on the window: input recency, a heartbeat every minute ({active: input in the last minute, ...beat()}),
   * window errors, flush on hide / unload, and every <dialog> opening and closing (ui:dialogOpen, ui:dialog with its
   * dwell ms). Idempotent; stop() undoes it.
   */
  start(win = typeof window !== 'undefined' ? window : null, { beat = () => ({}) } = {}) {
    if (!win?.addEventListener || this.stops.length) return;
    const doc = win.document;
    const on = (el, type, f, o) => { el.addEventListener(type, f, o); this.stops.push(() => el.removeEventListener(type, f, o)); };
    const input = () => { this.lastInput = Date.now(); };
    for (const type of ['pointerdown', 'keydown', 'wheel']) on(win, type, input, { capture: true, passive: true });
    on(doc, 'visibilitychange', () => { if (doc.visibilityState === 'hidden') this.flushAll(); });
    on(win, 'beforeunload', () => { this.close(); });
    // (the browser's ResizeObserver loop notice is no error of the app's: boot.js does not report it either)
    on(win, 'error', (e) => { if (!/ResizeObserver loop/.test(e?.message || '')) this.note(fromHotReload(e?.error) ? 'app:hmr' : 'app:error', { text: clip(e?.message || 'error') }); });
    on(win, 'unhandledrejection', (e) => this.note(fromHotReload(e?.reason) ? 'app:hmr' : 'app:error', { text: clip(e?.reason?.message || String(e?.reason)) }));
    const hb = setInterval(() => {
      let b = {};
      try { b = beat(); } catch { /* best-effort */ }
      this.note('app:heartbeat', { active: this.userActive(BEAT_MS), hidden: doc.visibilityState === 'hidden', ...b }, { ring: false });
    }, BEAT_MS);
    this.stops.push(() => clearInterval(hb));
    if (win.MutationObserver && doc.body) {
      const open = new Map();
      let pending = 0;
      const scan = () => {
        pending = 0;
        const now = new Set(doc.querySelectorAll('dialog[open]'));
        for (const el of now) if (!open.has(el)) { const name = dialogName(el); open.set(el, { name, t: Date.now() }); this.note('ui:dialogOpen', { name }); }
        for (const [el, o] of open) if (!now.has(el)) { open.delete(el); this.note('ui:dialog', { name: o.name, ms: Date.now() - o.t }); }
      };
      // ponytail: re-scans dialog[open] at most every 250 ms on any DOM change; cheap (a handful of dialogs), hook the kit Dialog instead if it ever shows in a profile
      const mo = new win.MutationObserver(() => { if (!pending) pending = setTimeout(scan, 250); });
      mo.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
      this.stops.push(() => { mo.disconnect(); clearTimeout(pending); });
    }
    this.note('app:start', { day: day(Date.now()) });
  }
  stop() { this.flushAll(); for (const f of this.stops.splice(0)) f(); }
}

const label = (el) => (el?.getAttribute?.('aria-label') || '').split(':')[0].trim();
function dialogName(el) {
  const by = el.getAttribute('aria-labelledby'), h = (by && el.ownerDocument.getElementById(by)) || el.querySelector('h1, h2, h3, [class*=title]');
  return clip(label(el) || h?.textContent?.trim() || String(el.className || 'dialog'), 60);
}
/** Where keyboard focus is: a timeline lane ('lane:plan'), else the nearest labelled region (dialog, dock, lane, group). */
export function focusOf(el) {
  if (!el?.closest || el === el.ownerDocument?.body) return '';
  const lane = el.closest('[data-tl-lane]');
  if (lane) return 'lane:' + lane.getAttribute('data-tl-lane');
  const d = el.closest('dialog');
  if (d) return 'dialog:' + dialogName(d);
  return clip(label(el.closest('section[aria-label], [role=application][aria-label], [role=group][aria-label], canvas[aria-label]')) || el.tagName.toLowerCase(), 60);
}
/** How a command was started: `via` ('key': the registry's keymap) if given, else from the DOM event being dispatched. */
export function sourceOf(via, ev = typeof window !== 'undefined' ? window.event : null) {
  if (via) return via;
  const t = ev?.target, type = ev?.type || '';
  if (t?.closest?.('dialog[aria-label="Command palette"]')) return 'palette';
  if (t?.closest?.('[role=menu], [role=menubar], [role=menuitem]')) return 'menu';
  if (/^(click|pointer|mouse)/.test(type)) return 'button';
  if (/^key/.test(type)) return 'key';
  return 'code';
}
/** Effects added / removed (immediately) and edited (one burst per effect) between two doc.fx lists. */
export function noteFx(usage, before = [], after = []) {
  const b = new Map((before || []).map((e) => [e.id, e])), a = new Map((after || []).map((e) => [e.id, e]));
  const desc = (e) => ({ id: e.id, kind: e.kind, mode: e.params?.mode, ms: Math.round(e.t1 - e.t0) });
  for (const [id, e] of a) {
    const o = b.get(id);
    if (!o) usage.note('fx:add', desc(e));
    else if (o !== e) {
      const keys = [...new Set([...Object.keys(o.params || {}), ...Object.keys(e.params || {})])].filter((k) => o.params?.[k] !== e.params?.[k]);
      const what = [...(o.t0 !== e.t0 || o.t1 !== e.t1 ? ['span'] : []), ...(o.kind !== e.kind ? ['kind'] : []), ...(!!o.muted !== !!e.muted ? ['muted'] : []), ...(!!o.baked !== !!e.baked ? ['baked'] : []), ...keys];
      if (what.length) usage.burst('fx:edit', { ...desc(e), what: what.join(',') }, { key: 'fx:edit:' + id, gap: 1500 });
    }
  }
  for (const [id, e] of b) if (!a.has(id)) usage.note('fx:remove', desc(e));
}

/**
 * The JSONL file sink (Tauri): appends to <data_dir>/usage-YYYY-MM-DD.jsonl (or name(day): the fix log's fixes.jsonl,
 * the feedback notes' feedback.jsonl) through the backend's atomic writeText. Its own files only, never the settings.
 * ponytail: the shell has no append command, so the day's text is kept and the whole file rewritten each flush (a busy
 * day is ~1 MB); add a Rust usage_append command if that ever shows up. A file that exists but cannot be read is
 * never overwritten (the sink goes quiet); a failed write keeps the text and retries with the next flush.
 */
export function fileSink(backend, name = (d) => `usage-${d}.jsonl`) {
  let dir = null, cur = '', text = null, dead = false, chain = Promise.resolve();
  const append = async (lines, t) => {
    if (dead) return;
    dir ??= (await backend.appPaths()).data_dir;
    const f = name(day(t)), path = `${dir}${dir.includes('\\') ? '\\' : '/'}${f}`;
    if (f !== cur) { cur = f; text = null; }
    if (text == null) {
      try { text = (await backend.exists(path)) ? await backend.readText(path) : ''; } catch (e) { dead = true; throw e; }
    }
    text += lines;
    await backend.writeText(path, text);
  };
  return { append: (lines, t = Date.now()) => (chain = chain.then(() => append(lines, t)).catch((e) => console.warn('[usage] file log:', e?.message || e))) };
}

/** For features that note what they do: noteUsage(app, 'timeline:selectScene', detail?). No-op without app.usage. */
export const noteUsage = (app, kind, detail) => app?.usage?.note(kind, detail);

export const usageCommands = [
  { id: 'usage.report', title: 'Usage report (copy)', menu: 'Help', group: 'usage', run: async (app) => {
    const u = app.usage, top = u.top(15);
    if (!top.length) { app.toast('Nothing logged yet', 'quiet'); return; }
    let copied = false;
    try { await navigator.clipboard.writeText(u.report()); copied = true; } catch { /* no clipboard permission */ }
    app.toast(top.map(([k, n]) => `${n}\t${k}`).join('\n') + `\n${copied ? 'Full report copied (tab-separated).' : 'Could not copy the full report.'}`, 'info', { timeout: 15000 });
  } },
  { id: 'usage.clear', title: 'Clear usage log', menu: 'Help', group: 'usage', run: async (app) => {
    if (await app.confirm({ title: 'Clear the usage log?', message: `${app.usage.log.length} entries and every count are removed.`, ok: 'Clear', danger: true })) app.usage.clear();
  } },
];
