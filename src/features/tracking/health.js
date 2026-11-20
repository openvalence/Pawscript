// paw-wfd2.3: the tracker's conditions for the status bar's health slot (lib/health.js)
import { trackingFor } from './tracking.svelte.js';
import { peekGroups } from './groups.svelte.js';

const firstLine = (s) => String(s || '').split(/\r?\n/)[0].slice(0, 200);
export default [
  // no tracker list: the sidecar is missing or did not start
  { id: 'tracking.unavailable', pri: 1, read: (app) => {
    const tr = trackingFor(app);
    if (tr.trackers.length || tr.busy === 'list' || !tr.error) return null;
    const missing = /not found|no sidecar/i.test(tr.error);
    return { tone: 'bad', text: missing ? 'Tracker not installed' : 'Tracker did not start', tip: firstLine(tr.error),
      action: { label: 'Retry', run: () => app.commands.run('track.listTrackers') } };
  } },
  // the last job failed (app.sidecar stays 'error' until the next one starts)
  { id: 'tracking.failed', pri: 3, read: (app) => {
    const tr = trackingFor(app);
    return app.sidecar === 'error' && tr.trackers.length ? { tone: 'warn', text: 'Last tracker job failed', tip: firstLine(tr.error) || 'See the Tracking panel',
      action: { label: 'Details', run: () => app.showPanel?.('tracking') } } : null;
  } },
  { id: 'tracking.gpu', pri: 5, read: (app) => {
    const n = trackingFor(app).gpuNote;
    return n ? { tone: 'warn', text: 'GPU trackers off', tip: firstLine(n), action: { label: 'Details', run: () => app.showPanel?.('tracking') } } : null;
  } },
  // the sidecar runs the job on the CPU (v4.56 progress device "cpu"): the same job, much slower
  { id: 'tracking.cpu', pri: 4.5, read: (app) => {
    const tr = trackingFor(app);
    return tr.busy && tr.cpu ? { tone: 'warn', text: 'Tracking on CPU', tip: 'No GPU for this job: it runs slowly', action: { label: 'Details', run: () => app.showPanel?.('tracking') } } : null;
  } },
  // shot links or Copy from… have no decoder of their own for this video and read the player's stills: slower, still right
  { id: 'frames.degraded', pri: 6, read: (app) => {
    const why = trackingFor(app).framesWhy || peekGroups(app)?.copyFramesWhy;
    if (!why) return null;
    const p = app.player, fix = app.backend?.transcodePreview;
    return { tone: 'warn', text: 'Frame reader degraded', tip: firstLine(why), ...(fix ? { action: { label: 'Make a proxy', run: () => p.makeProxy() } } : {}) };
  } },
];
