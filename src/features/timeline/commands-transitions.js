// commands-transitions.js -- fades and dissolves (paw-ef73.3; the ruler toggle is in commands-view.js): put the cut of the
// transition at (else nearest) the playhead at its start, its darkest frame or its first clean frame. Only on request (or
// a cut dragged near one: interact.js): a fade between two scenes belongs wherever the owner puts the cut.
import { scenesOf, setScenes, durOf } from './state.svelte.js';
import { cutToSnap, snapCut, placesOf } from './transitions.js';
import { shownTransitions, transitionsShown, nudgeFade, fadeSelected, fadesOfShot, addFade } from './transitions.svelte.js';
import { sceneAtPlayhead } from './scenes.js';
import { tl } from './state.svelte.js';
import { guard } from '../../app/commands.js';

const WHERE = { start: 'its start', middle: 'its darkest frame', clean: 'its first clean frame' };
const has = guard((app) => shownTransitions(app).length > 0 && scenesOf(app).length > 1,
  (app) => (!transitionsShown(app) ? 'Show fades and dissolves on the ruler first' : scenesOf(app).length > 1 ? 'No fade or dissolve in this video' : 'Detect scenes first'));

function snap(app, place) {
  const fm = app.player.frameMs || 1000 / 30, shots = scenesOf(app);
  const c = cutToSnap(shots, shownTransitions(app), app.player.timeMs, fm, durOf(app));
  if (!c) { app.toast('No cut in the fade or dissolve at the playhead', 'quiet'); return; }
  const next = snapCut(shots, c.i, c.x, place, fm);
  if (!next) { app.toast(placesOf(c.x).some((q) => q.place === place) ? 'Another cut is in the way (merge the shots first)' : `This one has no ${WHERE[place].slice(4)} to cut at`, 'quiet'); return; }
  if (next !== shots) {
    app.transact(`Cut at the fade's ${WHERE[place].slice(4)}`, () => setScenes(app, next));
    app.usage?.note?.('transitions:snapCut', { place, kind: c.x.kind });
  }
  app.player.seek(next[c.i].start_ms);
}

// paw-ef73.22: a fade in / out on the shot at the playhead (the shot's right-click menu has the same): 0.3 s, then its grip adjusts it
const shotAt = (app) => { const l = scenesOf(app), i = sceneAtPlayhead(l, app.player); return i < 0 ? null : { l, i }; };
const canAdd = (side) => guard((app) => { const s = shotAt(app); return !!s && !fadesOfShot(app, s.l, s.i)[side]; }, (app) => (shotAt(app) ? `This shot has a fade ${side} already` : 'Detect scenes first'));
const add = (side) => (app) => { const s = shotAt(app); if (s) addFade(app, s.l, s.i, side); };

// paw-ef73.13: a fade selected on the Shots strip (click its handle) nudges by a frame while the Scenes row has focus
const nudging = (app) => tl.focus === 'scenes' && fadeSelected(app);

export default [
  { id: 'timeline.fade.addIn', title: 'Fade in on the shot at the playhead', group: 'scenes', when: canAdd('in'), run: add('in') },
  { id: 'timeline.fade.addOut', title: 'Fade out on the shot at the playhead', group: 'scenes', when: canAdd('out'), run: add('out') },
  { id: 'timeline.fade.cleanLater', title: 'Selected fade: first clean frame one frame later', keys: ['Alt+ArrowRight'], group: 'scenes', hidden: true, when: nudging, run: (app) => nudgeFade(app, 1) },
  { id: 'timeline.fade.cleanEarlier', title: 'Selected fade: first clean frame one frame earlier', keys: ['Alt+ArrowLeft'], group: 'scenes', hidden: true, when: nudging, run: (app) => nudgeFade(app, -1) },
  { id: 'timeline.cut.fadeStart', title: 'Cut at the start of the fade / dissolve at the playhead', group: 'scenes', when: has, run: (app) => snap(app, 'start') },
  { id: 'timeline.cut.fadeMiddle', title: 'Cut at the middle of the fade at the playhead', group: 'scenes', when: has, run: (app) => snap(app, 'middle') },
  { id: 'timeline.cut.fadeClean', title: 'Cut after the fade at the playhead', group: 'scenes', when: has, run: (app) => snap(app, 'clean') },
];
