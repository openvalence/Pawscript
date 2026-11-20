// boot.js -- the tracking store is made at boot (app/plugins.js 'boot'), outside every component: its always-on effects belong to
// none and its project blocks ('tracking', 'runs', 'links', 'loopLinks') are registered before any project loads (paw-pq6b;
// it was the status bar's Draft chip that made it first).
import { trackingFor } from './tracking.svelte.js';

// paw-shgb: the tabs ask how heavy a hidden document is (its runs) and whether a job of its runs
export default (app) => {
  const t = trackingFor(app);   // its destroy runs with the app's (lib/rooted.svelte.js)
  app.heavyMB = () => t.heapMB;
  app.jobBusy = () => !!(t.busy && t.busy !== 'list') || !!t.batch || !!t.planBusy;
};
