// open.js -- F1's overlay on its Quick start page (the page is remembered: steps.js helpPage).
import { show } from '../palette/state.svelte.js';

export function openQuickStart(app) {
  app.settings.set('help.page', 'start');
  show('help');
}
