// files.js -- the settings as a file (export / import) and Reset all. Settings are personal: they are never written into a
// project, a pack or a bug report; this file is the one way they leave the app, and only where you save it.
import { SCHEMA } from '../../app/settings.svelte.js';
import { exportText, parseImport, resettable, applySetting } from './logic.js';

const FILTERS = [{ name: 'Pawscript settings', extensions: ['json'] }];
const applyAll = (app, keys) => { for (const k of keys) applySetting(app, k); };

export async function exportSettings(app) {
  const be = app.backend;
  const path = await be.saveDialog?.({ title: 'Export settings', defaultPath: 'pawscript-settings.json', filters: FILTERS });
  if (!path) return false;
  try { await be.writeText(path, exportText(app.settings)); }
  catch (e) { app.toast(`Settings not exported: ${e?.message || e}`, 'error'); return false; }
  app.toast('Settings exported', 'ok');
  return true;
}

export async function importSettings(app) {
  const be = app.backend;
  const path = await be.openDialog?.({ title: 'Import settings', multiple: false, filters: FILTERS });
  if (typeof path !== 'string' || !path) return false;
  let got;
  try { got = parseImport(await be.readText(path), app.settings); }
  catch (e) { app.toast(`Settings not imported: ${e?.message || e}`, 'error'); return false; }
  const keys = Object.keys(got.values);
  app.settings.setMany(got.values);
  app.settings.flush();
  applyAll(app, keys);
  app.toast(`${keys.length} settings imported${got.skipped.length ? `, ${got.skipped.length} skipped (values that do not fit)` : ''}`, 'ok');
  return true;
}

/** Every preference back to its default, after a confirm; layouts, recent lists and key bindings stay. */
export async function resetAll(app) {
  const keys = resettable(app.settings);
  if (!keys.length) { app.toast('Every setting is at its default', 'quiet'); return false; }
  const ok = await app.confirm({ title: 'Reset all settings?', message: `${keys.length} changed setting${keys.length === 1 ? '' : 's'} go back to their defaults.`,
    detail: 'Layouts, recent lists, key bindings and the tracker view options stay.', ok: 'Reset all', danger: true });
  if (!ok) return false;
  app.settings.reset(keys);
  applyAll(app, keys.filter((k) => SCHEMA[k]));
  app.toast('Settings back to their defaults', 'ok');
  return true;
}
