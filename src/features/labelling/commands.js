// Image labelling for the seeder (paw-714j). The keys work only inside the workspace (while it is open the shell admits
// only these, the Groups tool's own and the palette: app/commands.js gate). Space stays play / pause everywhere (here: nothing).
// Skip is L (later): K is the Groups tool's knot brush here too (paw-k393).
import { labellingFor } from './workspace.svelte.js';
import { guard, whyOf } from '../../app/commands.js';

const on = guard((app) => !!app.labelling?.on, 'Only while labeling images');
const ws = (app) => app.labelling;
const free = (app) => on(app) && ws(app).ready && !ws(app).G.draft && !ws(app).G.xf && !ws(app).G.picker;
// moving on works while an image is still loading (fast presses of next must not be dropped); painting and the rest wait for it
const nav = (app) => on(app) && !ws(app).G.draft && !ws(app).G.xf && !ws(app).G.picker;
export default [
  { id: 'labelling.open', title: 'Label images for the seeder…', menu: 'File', group: 'open', when: guard((app) => !on(app), 'Already labeling images'), run: (app, args) => labellingFor(app).enter(args?.folder) },
  { id: 'labelling.leave', title: 'Leave image labeling', menu: 'File', group: 'open', keys: ['Ctrl+Shift+L'], when: on, run: (app) => ws(app).leave() },
  { id: 'labelling.next', title: 'Labeling: next image', keys: ['ArrowRight'], hidden: true, when: (app) => nav(app) && ws(app).index < ws(app).images.length - 1, run: (app) => ws(app).next() },
  { id: 'labelling.prev', title: 'Labeling: previous image', keys: ['ArrowLeft'], hidden: true, when: (app) => nav(app) && ws(app).index > 0, run: (app) => ws(app).prev() },
  { id: 'labelling.done', title: 'Labeling: confirm the names on this image', keys: ['Enter'], hidden: true, when: free, run: (app) => ws(app).done({ next: false }) },
  // paw-m3b6: the toolbar's Done, next (no key of its own: Enter only confirms the names)
  { id: 'labelling.doneNext', title: 'Labeling: done, next unlabeled image', hidden: true, when: free, run: (app) => ws(app).done() },
  { id: 'labelling.nextUnlabelled', title: 'Labeling: next unlabeled image', keys: ['U'], hidden: true, when: nav, run: (app) => ws(app).advance() },
  { id: 'labelling.skip', title: 'Labeling: skip this image for later', keys: ['L'], hidden: true, when: (app) => nav(app) && !!ws(app).current, run: (app) => ws(app).skip() },
  { id: 'labelling.clearSkips', title: 'Labeling: clear skips', when: guard((app) => on(app) && ws(app).skipped.size > 0, (app) => whyOf(app, on) || 'No skipped images'), run: (app) => ws(app).clearSkips() },
  { id: 'labelling.none', title: 'Labeling: nothing to label in this image', keys: ['N'], hidden: true, when: free, checked: (app) => !!ws(app)?.none, run: (app) => ws(app).toggleNone() },
  { id: 'labelling.complete', title: 'Labeling: fully labeled on / off', keys: ['Y'], hidden: true, when: free, checked: (app) => !!ws(app)?.complete, run: (app) => ws(app).toggleComplete() },
  { id: 'labelling.shuffle', title: 'Labeling: shuffled / folder order', keys: ['Shift+O'], hidden: true, when: on, checked: (app) => !!ws(app)?.shuffle, run: (app) => ws(app).setShuffle(!ws(app).shuffle) },
  { id: 'labelling.duos', title: 'Labeling: duos first', keys: ['Shift+D'], hidden: true, when: on, checked: (app) => !!ws(app)?.duos, run: (app) => ws(app).setDuos(!ws(app).duos) },
  { id: 'labelling.reshuffle', title: 'Labeling: reshuffle', hidden: true, when: on, run: (app) => ws(app).reshuffle() },
  { id: 'labelling.train', title: 'Labeling: train the seeder on these labels', hidden: true, when: (app) => on(app) && !ws(app).training, run: (app) => ws(app).train() },
  { id: 'labelling.suggest', title: 'Labeling: suggest groups on this image', keys: ['Shift+S'], hidden: true, when: free, run: (app) => ws(app).suggest() },
  { id: 'labelling.sameParts', title: 'Labeling: same parts as the last image', keys: ['R'], hidden: true, when: free, run: (app) => ws(app).sameParts() },
];
