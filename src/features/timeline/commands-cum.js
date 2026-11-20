// commands-cum.js -- "detect cumshots" (cum.svelte.js): palette / menu twins of the Modifiers row's cumshot bar.
import { cumScene, cumWhy, detectCum, placeCum, clearCum } from './cum.svelte.js';
import { guard } from '../../app/commands.js';

const G = { menu: 'Edit', group: 'Modifiers' };
const proposals = guard((app) => !!cumScene(app)?.scene.cum?.length, 'Detect cumshots in this scene first');
export default [
  { id: 'timeline.cum.detect', title: 'Detect cumshots in the range or scene', ...G,
    when: (app) => cumWhy(app).enabled, why: (app) => cumWhy(app).reason, run: (app, args) => detectCum(app, args) },
  { id: 'timeline.cum.place', title: 'Place the proposed spurts of this scene', ...G, when: proposals,
    run: (app) => placeCum(app, cumScene(app).i) },
  { id: 'timeline.cum.clear', title: 'Drop the proposed spurts of the scene at the playhead', ...G, when: proposals,
    run: (app) => clearCum(app, cumScene(app).i) },
];
