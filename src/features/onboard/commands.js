// Help menu (paw-kxwz): the quick start (F1's overlay on its Quick start page) and the first-run hints on / off. help.* ids
// run on the project page too (tabs.svelte.js homeAllows).
import { openQuickStart } from './open.js';
import { openSample } from './sample.js';
import { hintsOn, setHints, dismissedOf } from './steps.js';
import { guard } from '../../app/commands.js';

export default [
  { id: 'help.quickStart', title: 'Quick start', menu: 'Help', group: 'guide', tip: 'From a video to a .funscript, step by step (F1)', run: (app) => openQuickStart(app) },
  // paw-ys3x: a finished example to look around in (copied to Videos, the copy opens on the Track tab)
  { id: 'help.sample', title: 'Open the sample project', menu: 'Help', group: 'guide', tip: 'A generated clip, tracked and published, copied to Videos', run: (app) => openSample(app) },
  { id: 'help.hintsShow', title: 'Show first-run hints', menu: 'Help', group: 'guide', tip: 'The next step and its key, over the video', when: guard((app) => !hintsOn(app.settings) || dismissedOf(app.settings).length > 0, 'Hints are already showing'), run: (app) => setHints(app.settings, true) },
  { id: 'help.hintsHide', title: 'Hide first-run hints', menu: 'Help', group: 'guide', when: guard((app) => hintsOn(app.settings), 'Hints are already hidden'), run: (app) => setHints(app.settings, false) },
];
