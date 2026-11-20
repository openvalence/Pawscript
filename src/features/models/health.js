// paw-wfd2.3: the tracker models' condition for the status bar's health slot (lib/health.js)
import { models } from './store.svelte.js';
import { openSettingsAt } from '../settings/commands.js';

export default [
  { id: 'models.missing', pri: 4, read: (app) => (models.ready ? null : {
    tone: 'warn', text: 'Tracker models missing', tip: 'Tracking needs them; editing does not',
    action: { label: 'Download', run: () => openSettingsAt(app, 'Models') },
  }) },
];
