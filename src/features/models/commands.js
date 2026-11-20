// commands.js -- paw-cdot: every Models action in the registry (searchable in the palette), each saying why when it is off.
// The list itself is Settings > Models (ModelsList.svelte); a download or a check goes online only when run.
import { guard } from '../../app/commands.js';
import { openSettingsAt } from '../settings/commands.js';
import { models, list, download, cancel, remove, verify, checkUpdates, chooseFiles, chooseFolder, setFolder, openFolder, EMBEDDED } from './store.svelte.js';
import { rowState, isRuntime, isManual } from './logic.js';

const idle = guard(() => !models.job, 'A download or check is under way: wait or Cancel it');
const rowOf = (id) => list().find((r) => r.model.id === id);
const st = (id) => { const r = rowOf(id); return r ? rowState(r, models.facts, models.verified) : 'missing'; };
const missingRequired = () => list().filter((r) => r.model.required && !isRuntime(r.model) && !isManual(r.model) && !['installed', 'update'].includes(rowState(r, models.facts, models.verified)));
const both = (a, b) => guard((app) => a(app) && b(app), (app) => (a(app) ? b.why : a.why));
const hosted = EMBEDDED.models.filter((m) => !isRuntime(m));

export default [
  { id: 'models.open', title: 'Models: download, update, remove', group: 'models', aliases: ['tracker models', 'checkpoints', 'weights', 'sam', 'tapnext', 'hydra', 'licence'], tip: 'Settings > Models', run: (app) => openSettingsAt(app, 'Models') },
  { id: 'models.downloadRequired', title: 'Download the needed tracker models', group: 'models', aliases: ['get models'],
    when: both(idle, guard(() => missingRequired().length > 0, 'Every needed model is installed')), run: (app) => download(app, missingRequired().map((r) => r.model.id)) },
  { id: 'models.cancel', title: 'Cancel the model download', group: 'models', when: guard(() => !!models.job?.id, 'Nothing is downloading'), run: (app) => cancel(app) },
  { id: 'models.checkUpdates', title: 'Check for model updates', group: 'models', tip: 'Asks the models server; nothing is downloaded', when: idle, run: (app) => { openSettingsAt(app, 'Models'); return checkUpdates(app); } },
  { id: 'models.verify', title: 'Verify the model files (SHA-256)', group: 'models', when: both(idle, guard(() => !!models.info?.exists, 'Nothing downloaded in the models folder yet')), run: (app) => { openSettingsAt(app, 'Models'); return verify(app); } },
  { id: 'models.chooseFiles', title: 'Bring model files you already have…', group: 'models', aliases: ['import model', 'taggerine'], when: idle, run: (app) => { openSettingsAt(app, 'Models'); return chooseFiles(app); } },
  { id: 'models.openFolder', title: 'Open the models folder', group: 'models', when: guard(() => !!models.info?.exists, 'Nothing downloaded in the models folder yet'), run: (app) => openFolder(app) },
  { id: 'models.chooseFolder', title: 'Choose the models folder…', group: 'models', when: idle, run: (app) => chooseFolder(app) },
  { id: 'models.folderNextToApp', title: 'Models folder: next to the app', group: 'models', when: both(idle, guard((app) => !!(app.settings.get('models.dir') || '').trim(), 'The models are already looked for next to the app')), run: (app) => setFolder(app, '') },
  ...hosted.map((m) => isManual(m)
    ? { id: `models.get.${m.id}`, title: `Choose the files of ${m.title}…`, group: 'models', when: idle, run: (app) => chooseFiles(app, m.id) }
    : { id: `models.get.${m.id}`, title: `Download ${m.title}`, group: 'models', when: both(idle, guard(() => st(m.id) !== 'installed', `${m.title} is installed`)), run: (app) => download(app, [m.id]) }),
  ...hosted.map((m) => ({ id: `models.remove.${m.id}`, title: `Remove ${m.title}`, group: 'models', tip: 'Only its own files, nothing else in the folder',
    when: both(idle, guard(() => st(m.id) !== 'missing' || m.files.some((f) => models.facts[f.path]?.exists || models.facts[f.path]?.part), `${m.title} is not downloaded`)), run: (app) => remove(app, m.id) })),
];
