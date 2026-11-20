// boot.js -- paw-cdot: "Check for updates at start" (off by default): once per window, quietly (a toast only when a newer
// version is out).
import { check } from './store.svelte.js';

let done = false;
export default function boot(app) {
  if (done || !app.settings.get('updates.checkAtStart') || typeof app.backend?.updateCheck !== 'function') return;
  done = true;
  setTimeout(() => check(app, { quiet: true }), 5000);   // after the start's own work
}
