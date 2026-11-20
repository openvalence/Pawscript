// boot.js -- builds the full app: the store, every discovered feature, the project layer, global key and
// error handling. Used by main.js (real app, Tauri backend) and dev/shell.js (plain browser, mock backend).

import { createApp } from './app.svelte.js';
import { coreFor, applyLook } from './core-commands.js';
import projectCommands from './project-commands.js';
import { createProject } from './project.svelte.js';
import { panels, lanes, featureCommands, VideoPlayer, problems, features, boots } from './plugins.js';
import { fmtKeys } from './keymap.js';
import { DevicePreview } from './device-preview.svelte.js';
import { fromHotReload } from './usage.svelte.js';

// modal features first: while their overlay is open their guarded commands (Esc, digits, Tab) are the top key scope
const FIRST = ['palette', 'assist', 'tracking', 'timeline', 'review', 'inspector', 'graph', 'video', 'lanes'];

/** opts: {backend, storage} -> app (not yet mounted): the window's first app; app.tabs.make builds one more per tab (paw-shgb),
 *  sharing its settings object, usage log, backend and tabs. The window's listeners are registered once, here, and go to
 *  the shown tab's app (app.tabs.current). */
export function bootApp({ backend, storage }) {
  const app = bootDoc({ backend, storage });
  app.tabs.make = () => {
    const a = bootDoc({ backend, settings: app.settings, usage: app.usage, tabs: app.tabs });
    a.project.startAutosave();
    return a;
  };
  const cur = () => app.tabs.current;
  windowWiring(app, cur);
  if (typeof document !== 'undefined') document.body.classList.add('kit-root');
  applyLook(app);
  logConflicts(app);
  for (const p of problems) console.warn('[plugins]', p);
  return app;
}

/** One document's app: the store, every feature's commands and long-lived stores, the project layer. */
function bootDoc(opts) {
  const app = createApp({ ...opts, PlayerClass: VideoPlayer || undefined });
  app.hosts = true;
  app.panels = panels;
  app.lanes = lanes;   // the timeline rows (the bottom tray's Rows tab lists them; paw-idb5)
  // Earlier registration wins a shared key, so contextual features (narrow `when`: an overlay is open, a job
  // runs, a plan segment / loop / chapter is selected) go before the broad editors; the shell's core last.
  const rank = (f) => { const i = FIRST.indexOf(f); return i < 0 ? FIRST.length : i; };
  for (const list of [...featureCommands].sort((a, b) => rank(a[0]?.feature) - rank(b[0]?.feature))) app.commands.register(list, list[0]?.feature || 'feature');
  app.commands.register(projectCommands, 'project');
  app.commands.register(coreFor(features), 'app');
  app.project = createProject(app);
  app.devicePreview = new DevicePreview(app);
  app.cleanups.push(() => app.devicePreview.destroy());   // paw-shgb: a closed tab's effects end with it
  app.features = features;
  app.pluginProblems = problems;
  // paw-pq6b: features' long-lived stores (tracking: its always-on effects, its project blocks) made here, not by whichever
  // component asks first: that was the status bar's Draft chip, so any error in them read "in DraftChip.svelte in StatusBar.svelte"
  for (const b of boots) {
    try { b.run(app); } catch (e) { const m = `${b.feature}/boot: ${e?.message || e}`; if (!problems.includes(m)) problems.push(m); console.error('[plugins]', b.feature, 'boot', e); }
  }
  return app;
}

/** The window's own listeners, once: keys and pointer to the shown tab's app, the window size, the error net. */
function windowWiring(app, cur) {
  // keys: one bubble-phase window listener (overlays and capture UIs stop propagation before it)
  window.addEventListener('pointerdown', (e) => cur().commands.notePointer(e), true);
  // paw-ks21: no browser focus navigation. Space / Tab / arrows outside a text entry go to the key map only (commands.js guardKey)
  document.addEventListener('keydown', (e) => cur().commands.guardKey(e), true);
  window.addEventListener('keydown', (e) => cur().commands.handleKey(e));
  window.addEventListener('keyup', (e) => cur().commands.handleKeyUp(e));
  window.addEventListener('blur', () => { for (const a of app.tabs.apps) a._registry.held = null; });
  // paw-r73w: the window size (the room the panels get), at start and once a resize settles
  const size = () => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio });
  app.usage?.note?.('ui:window', size());
  window.addEventListener('resize', () => app.usage?.burst?.('ui:window', size(), { gap: 2000 }));
  // no WebView menu (Print / Reload ...) on right click; our own menus handle the event first, text fields keep theirs
  window.addEventListener('contextmenu', (e) => { if (!e.target?.closest?.('input, textarea, [contenteditable]')) e.preventDefault(); });

  // global error net: report, never lose the document
  let last = 0;
  const report = (what, e) => {
    if (/ResizeObserver loop/.test(e?.message || e)) return;   // benign browser notice
    if (fromHotReload(e)) return console.warn('[pawscript] dev server hot reload:', e);   // not the app's (usage.svelte.js fromHotReload)
    console.error('[pawscript]', what, e);
    if (Date.now() - last < 1500) return;
    last = Date.now();
    cur().toast(`${what}: ${e?.message || e}`, 'error');
    for (const a of app.tabs.apps) a.project?.flushAutosave?.();
  };
  window.addEventListener('error', (e) => report('Unexpected error', e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => report('Unexpected error', e.reason));
}

/** Every key collision across all registered commands, logged once at startup (Help > Shortcuts shows them live). */
export function logConflicts(app) {
  const list = app.commands.conflicts({ all: true });
  const title = (id) => app.commands.get(id)?.title || id;
  const line = (c) => `${fmtKeys(c.keys)}${c.kind === 'prefix' ? ' (prefix of ' + fmtKeys(c.longer) + ')' : ''}: ${c.ids.map((id) => `${title(id)} [${id}]`).join(' | ')}`;
  const real = list.filter((c) => c.kind !== 'shared'), shared = list.filter((c) => c.kind === 'shared');
  if (real.length) { console.groupCollapsed(`[keys] ${real.length} binding conflict(s)`); real.forEach((c) => console.warn(line(c))); console.groupEnd(); }
  else console.info('[keys] no conflicts');
  // shared keys: resolved by `when` + priority (first enabled in registration order runs), listed for review
  if (shared.length) { console.groupCollapsed(`[keys] ${shared.length} shared key(s), resolved by when/priority`); shared.forEach((c) => console.info(line(c))); console.groupEnd(); }
  return list;
}
