// boot.js -- paw-cdot: what is on the disk is read once per window at start (no network), and the tracking commands that
// need the models say so instead of starting a tracker that cannot load them: "Download the tracker models first", with
// the Models group one click away. The editor, playback and everything else work without models.
import { models, refresh } from './store.svelte.js';
import { openSettingsAt } from '../settings/commands.js';

/** The commands that start a model tracker (features/tracking/commands.js). */
export const NEEDS_MODELS = ['track.gridFrame', 'track.run', 'track.full', 'track.beside', 'track.plan', 'track.forward', 'track.backward', 'track.both'];
export const SAY = 'Download the tracker models first';
let read = null;

/** A command's run, wrapped: with the needed models missing it says so (and offers Settings > Models) instead. */
export function needModels(run) {
  return (app, args) => {
    if (models.ready) return run(app, args);
    app.toast(SAY, 'warn', { action: { label: 'Models…', run: () => openSettingsAt(app, 'Models') } });
    return false;
  };
}

export default function boot(app) {
  read ??= refresh(app).catch(() => {});
  for (const id of NEEDS_MODELS) {
    const c = app.commands.get(id);
    if (c && !c.needsModels) Object.assign(c, { run: needModels(c.run), needsModels: true });
  }
}
