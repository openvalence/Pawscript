// store.svelte.js -- paw-cdot: Help > Check for updates and Settings > Updates (src-tauri/src/update.rs). Online only when
// the user runs it (or turned on "Check for updates at start"): GitHub's latest.json, then the signed update itself.
import { writing, closeApp } from '../../app/writing.svelte.js';
import { openSettingsAt } from '../settings/commands.js';

/** phase: 'idle' | 'checking' | 'downloading' | 'ready' (downloaded: a restart runs it); found: update_check's answer. */
export const upd = $state({ phase: 'idle', found: null, done: 0, total: null, error: '' });

/** What the last check says, in words. */
export function words(f = upd.found) {
  if (!f) return '';
  if (!f.configured) return `Updates are not configured in this build (version ${f.current}): get new versions from the release page`;
  return f.version ? `Pawscript ${f.version} is out (you have ${f.current})` : `Pawscript ${f.current} is the newest version`;
}

export async function check(app, { quiet = false } = {}) {
  if (upd.phase === 'checking' || upd.phase === 'downloading') return null;
  Object.assign(upd, { phase: 'checking', error: '' });
  try {
    upd.found = await app.backend.updateCheck();
    if (!quiet || upd.found?.version) app.toast(words(), upd.found?.version ? 'info' : 'quiet', upd.found?.version ? { timeout: 12000, action: { label: 'See it', run: () => openSettingsAt(app, 'Updates') } } : {});
  } catch (e) {
    upd.error = e?.message || String(e);
    if (!quiet) app.toast(`Update check: ${upd.error}`, 'warn');
  } finally { upd.phase = upd.phase === 'checking' ? 'idle' : upd.phase; }
  return upd.found;
}

/** Downloads the update (its signature checked by the shell) and puts it in place for the next start. */
export async function install(app) {
  if (!upd.found?.version || upd.phase !== 'idle') return false;
  Object.assign(upd, { phase: 'downloading', done: 0, total: null, error: '' });
  try {
    await app.backend.updateDownload((p) => Object.assign(upd, { done: p.done, total: p.total }));
    upd.phase = 'ready';
    return true;
  } catch (e) {
    Object.assign(upd, { phase: 'idle', error: e?.message || String(e) });
    return false;
  }
}

/** Asks, then writes every open project (as a close does) and restarts into the new version. */
export async function restart(app) {
  if (upd.phase !== 'ready') return false;
  if (writing.jobs.length || writing.closing) { app.toast('A project is being written: restart in a moment', 'warn'); return false; }
  const ok = await app.confirm({ title: `Restart into Pawscript ${upd.found.version}?`, message: 'Every open project is written first and opens again after the restart.', ok: 'Restart' });
  if (!ok) return false;
  try { await closeApp(app, () => app.backend.updateRestart()); }
  catch (e) { upd.error = e?.message || String(e); app.toast(`Not restarted: ${upd.error}`, 'warn'); }
  return true;
}
