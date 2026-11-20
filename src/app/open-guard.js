// open-guard.js -- paw-a82t: a document that crashed the renderer while it reopened at start must not reopen at every start
// (a crash loop that never reaches the project page). Per document: before a start-up reopen its path is marked "opening"
// in localStorage; the mark goes once it has stood STABLE_MS. A mark still there at the next start means that reopen never
// came back: it is not reopened, the project page says so quietly with an "Open anyway" (which goes through here too).
// ponytail: only the start-up reopen is guarded (the crash loop); a document opened by hand that crashes is reopened once at
// the next start, and that one is guarded. A mark is cleared by Open anyway, not by opening the document from its card.

import { pathKey } from './home.js';

const fileName = (p) => String(p).split(/[\\/]/).pop();

const KEY = 'pawscript.opening';
export const STABLE_MS = 5000;

const read = (st) => { try { const o = JSON.parse(st?.getItem(KEY) || 'null'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };
const write = (st, o) => { try { st?.setItem(KEY, JSON.stringify(o)); } catch { /* full or blocked: no guard this time */ } };
const unmark = (st, k) => { const o = read(st); if (k in o) { delete o[k]; write(st, o); } };

/** paw-wra0: the app closes cleanly (writing.svelte.js closeApp): no open was cut short by a crash, every mark goes. */
export const clearOpening = (st) => { try { st?.removeItem(KEY); } catch { /* blocked: the marks stay */ } };

/** Was a reopen of `path` still unfinished when the app last stopped? */
export const wasOpening = (st, path) => pathKey(path) in read(st);

/** Opens `path` (open(path) -> bool) with the mark held until it has stood `stableMs`. -> what open returned */
export async function openGuarded(st, path, open, { stableMs = STABLE_MS } = {}) {
  const k = pathKey(path);
  write(st, { ...read(st), [k]: Date.now() });
  let ok = false;
  try { ok = await open(path); } finally {
    if (!ok) unmark(st, k);   // refused or failed without a crash: nothing to guard
    else setTimeout(() => unmark(st, k), stableMs)?.unref?.();
  }
  return ok;
}

/** The start-up reopen of `path`: skipped (false) when its last one never came back, with a quiet note and Open anyway. */
export async function reopenGuarded(app, path, open) {
  const st = app.settings?.storage;
  if (!wasOpening(st, path)) return openGuarded(st, path, open);
  console.warn('[open-guard] not reopened at start: its last reopen did not finish');
  app.toast?.(`${fileName(path)} was not reopened: Pawscript stopped while it was opening last time.`, 'quiet', {
    timeout: 0, action: { label: 'Open anyway', run: () => openGuarded(st, path, (p) => (app.tabs ? app.tabs.open([p]) : open(p))) },
  });
  return false;
}
