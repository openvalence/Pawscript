// commands.js -- paw-cdot: Help > Check for updates (the one place besides Settings > Updates; asks GitHub only when run).
import { guard } from '../../app/commands.js';
import { openSettingsAt } from '../settings/commands.js';
import { upd, check, install, restart } from './store.svelte.js';

export default [
  { id: 'app.checkForUpdates', title: 'Check for updates', menu: 'Help', group: 'about', aliases: ['update', 'new version', 'upgrade'], tip: 'Asks GitHub for a newer version, sends nothing else',
    when: guard(() => upd.phase === 'idle' || upd.phase === 'ready', 'Already checking or downloading'), run: (app) => { openSettingsAt(app, 'Updates'); return check(app); } },
  { id: 'app.installUpdate', title: 'Download and install the update', group: 'about',
    when: guard(() => upd.phase === 'idle' && !!upd.found?.version, () => (upd.phase !== 'idle' ? 'Already downloading or downloaded' : 'Check for updates first: no newer version known')), run: (app) => install(app) },
  { id: 'app.restartToUpdate', title: 'Restart to finish the update', group: 'about', when: guard(() => upd.phase === 'ready', 'No update downloaded yet'), run: (app) => restart(app) },
];
