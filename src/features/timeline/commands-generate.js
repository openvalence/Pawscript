// Plan generation commands ("edit the plan, not the points"). Ctrl+G is the inspector's Go to (registered
// first, always enabled), so Generate is Ctrl+Shift+G. Split at playhead, Delete, kind digits and Enter (the
// popover) belong to the plan lane's commands.
import { tl } from './state.svelte.js';
import { generate, detach, toggleLock, togglePreview, previewOn, importFile, exportPlan, inspect, selectedIds } from './generate.js';
import { guard } from '../../app/commands.js';

const hasPlan = guard((app) => (app.doc.plan?.length ?? 0) > 0, 'Add a plan segment first');
const hasSel = guard((app) => selectedIds(app).length > 0, 'Select plan segments first');
const G = { menu: 'Edit', group: 'plan' };

export default [
  { id: 'timeline.plan.generate', title: 'Generate plan (new + stale, or the selection)', keys: ['Ctrl+Shift+G'], ...G, when: hasPlan,
    run: (app) => generate(app, tl.focus === 'plan' && hasSel(app) ? 'selected' : 'needed') },
  { id: 'timeline.plan.generateAll', title: 'Generate whole plan', keys: ['Ctrl+Alt+G'], ...G, when: hasPlan, run: (app) => generate(app, 'all') },
  { id: 'timeline.plan.generateSelected', title: 'Generate selected segments', ...G, when: hasSel, run: (app) => generate(app, 'selected') },
  { id: 'timeline.plan.detach', title: 'Detach selected segments (keep their points)', ...G, when: hasSel, run: (app) => detach(app) },
  { id: 'timeline.plan.lock', title: 'Lock / unlock selected segments', keys: ['Alt+Shift+L'], ...G, when: hasSel, run: (app) => toggleLock(app) },
  { id: 'timeline.plan.preview', title: 'Plan preview on / off', keys: ['Ctrl+Alt+P'], ...G, run: (app) => { togglePreview(app); app.toast(`Plan preview ${previewOn(app) ? 'on' : 'off'}`, 'quiet'); } },
  { id: 'timeline.plan.import', title: 'Import plan timeline (director JSON / spans)…', ...G, run: (app) => importFile(app, 'replace') },
  { id: 'timeline.plan.importMerge', title: 'Import plan timeline into the gaps…', ...G, run: (app) => importFile(app, 'merge') },
  { id: 'timeline.plan.exportDirector', title: 'Export plan as director timeline JSON…', ...G, when: hasPlan, run: (app) => exportPlan(app, 'director') },
  { id: 'timeline.plan.exportSpans', title: 'Export plan as tracking spans…', ...G, when: hasPlan, run: (app) => exportPlan(app, 'spans') },
  { id: 'timeline.plan.inspect', title: 'Open the plan inspector', keys: ['Ctrl+Alt+I'], ...G, run: (app) => inspect(app) },
];
