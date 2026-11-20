// writing.svelte.js -- paw-ee14: the writes in flight (the project, its runs), for the "Writing your project" panel shown
// when the app is closed while one is under way (ClosingPanel.svelte), and the close itself: the window closes by itself
// once every tab is written; Cancel keeps the app open (the writes go on). Writes are copy-on-write, so a forced close
// (a second close, Task Manager, power loss) keeps the last complete version.

import { clearOpening } from './open-guard.js';

let n = 0;
/** jobs: [{id, what, done, total}] (bytes; total 0 = no measure); closing: the close is waiting for them; shown: the panel
 *  is up (after a moment: a quick write closes without it); cancelable: the shell can call the close off (it waits while
 *  the app beats). */
export const writing = $state({ jobs: [], closing: false, shown: false, cancelable: false, cancelled: false });

/** A write in flight: `what` (a file name) -> {progress(done, total), end()}. */
export function startWrite(what) {
  const id = ++n;
  writing.jobs.push({ id, what, done: 0, total: 0 });
  return {
    progress(done, total) { const j = writing.jobs.find((x) => x.id === id); if (j) { j.done = done; j.total = total; } },
    end() { const i = writing.jobs.findIndex((x) => x.id === id); if (i >= 0) writing.jobs.splice(i, 1); },
  };
}

const SHOW_MS = 250, BEAT_MS = 1000, USAGE_MS = 1000;

/** The window's close was requested (held by the shell): every tab written (and checkpointed), then the window closes,
 *  unless Cancel was pressed meanwhile. While writing the shell is told every second that the app is alive.
 *  finish: what closes it (paw-cdot: an update's restart instead of the close). */
export async function closeApp(app, finish = () => app.backend.windowCloseNow()) {
  const be = app.backend;
  if (writing.closing) { writing.cancelled = false; writing.shown = true; return; }   // asked again after a Cancel: closing again
  Object.assign(writing, { closing: true, shown: false, cancelled: false });
  const beat = () => Promise.resolve(be.closeHeartbeat?.()).then(() => { writing.cancelable = typeof be.closeCancel === 'function'; }, () => {});
  beat();
  const timer = setInterval(beat, BEAT_MS), show = setTimeout(() => { writing.shown = true; }, SHOW_MS);
  let held = false;
  try {
    // a change made after a Cancel, while the first pass was still writing, is written by the next pass
    for (let k = 0; k < 3; k++) {
      held = (await app.tabs.closeAll({ quit: true })) === false;   // paw-f4i2: a document whose work is kept nowhere else holds the close
      if (writing.cancelled || held || !app.tabs.apps.some((a) => a.project ? a.project.unsaved : a.doc?.dirty)) break;
    }
  } catch (e) { held = true; console.warn('[close]', e); }
  finally {
    clearInterval(timer); clearTimeout(show);
    const stay = writing.cancelled || held;
    Object.assign(writing, { closing: false, shown: false, cancelled: false });
    if (!stay) {
      clearOpening(app.settings?.storage);   // paw-wra0: a clean quit is no crash (the next start reopens what was open)
      // paw-mn92: app:close reaches the usage log before the page goes (at most a second's wait)
      try { await Promise.race([app.usage?.close?.(), new Promise((r) => setTimeout(r, USAGE_MS))]); } catch { /* best-effort */ }
      await finish();
    } else if (held) Promise.resolve(be.closeCancel?.()).catch(() => {});   // the app stays open: the shell's held close is let go
  }
}

/** Cancel on the panel: the app stays open, the writes go on; the next close request is held again. */
export function cancelClose(app) {
  writing.cancelled = true;
  writing.shown = false;
  Promise.resolve(app.backend.closeCancel?.()).catch(() => {});
}
