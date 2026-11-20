// commands.js -- the Settings panel and the settings file. Ctrl+, opens (or folds) the panel; on the Projects page it shows
// the open document's tab first, and with no document open it opens the same panel over the page (sheet.svelte.js).
import { exportSettings, importSettings, resetAll } from './files.js';
import { sheet } from './sheet.svelte.js';

function open(app) {
  if (app.tabs?.home) {
    if (!app.tabs.hidden) { sheet.open = !sheet.open; return; }   // nothing open: the panel over the Projects page
    app.tabs.show(app.tabId);
    app.showPanel('settings');
    return;
  }
  app.togglePanel('settings');
}

/** paw-cdot: the Settings panel shown (not toggled) at one group: the Models list, the Updates group. */
export function openSettingsAt(app, group) {
  if (app.tabs?.home && !app.tabs.hidden) sheet.open = true;
  else { if (app.tabs?.home) app.tabs.show(app.tabId); app.showPanel('settings'); }
  sheet.find = { app, group };
}

export default [
  { id: 'settings.open', title: 'Settings', keys: ['Ctrl+,'], menu: 'File', group: 'settings', aliases: ['preferences', 'options'], tip: 'Every preference, grouped and searchable', run: open },
  { id: 'settings.export', title: 'Export settings…', group: 'settings', aliases: ['save settings'], run: (app) => exportSettings(app) },
  { id: 'settings.import', title: 'Import settings…', group: 'settings', aliases: ['load settings'], run: (app) => importSettings(app) },
  { id: 'settings.resetAll', title: 'Reset all settings to defaults…', group: 'settings', run: (app) => resetAll(app) },
];
