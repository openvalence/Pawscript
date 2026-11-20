// lane.js -- the timeline's rows (the shell flattens arrays and sorts by `order`; the point-editing lanes sit
// around order 50). Each component gets {app, height}. Default stack: Overview, Time, Scenes, Modifiers, Range, the
// Tracker (features/tracking/lane.js, 31.75), Audio, the lanes (the loops: on the Shots strip, paw-llaa; no Chapters row: paw-1w0x).
// The legacy Plan row starts hidden (app/layout.svelte.js DEFAULT rows; the bottom tray's Rows tab brings it back, paw-idb5).
import Overview from './Overview.svelte';
import Ruler from './Ruler.svelte';
import ScenesLane from './ScenesLane.svelte';
import PlanLane from './PlanLane.svelte';
import WaveformLane from './WaveformLane.svelte';
import FxLane from './FxLane.svelte';
import RangeLane from './RangeLane.svelte';
import SceneChipsRow from './SceneChipsRow.svelte';
import FilmstripLane from './FilmstripLane.svelte';
import { tl } from './state.svelte.js';
import { extraFor } from './actions-strip.js';

// paw-ef73.7: `modes` = the tabs a row shows in (none: every tab); the Scenes tab is the ruler, the Scenes / Shots strips
// at their usual compact height, the filmstrip (first / last frame per shot) taking the height the point lanes take
// elsewhere, the Scene / Shot chips. `scrubs`: a press-drag there seeks: the ruler only (test/app-tabs.test.mjs).
const NOT_SCENES = ['track', 'refine', 'review'];

export default [
  { id: 'timeline.overview', title: 'Overview', order: 10, height: 44, modes: NOT_SCENES, component: Overview },
  { id: 'timeline.ruler', title: 'Time', order: 20, height: 28, scrubs: true, component: Ruler },
  // two strips: Actions (the action regions, paw-2lp7.5) over Shots (camera spans, paw-k2u); 56 px default (was 24, then 46:
  // app/layout.svelte.js v5 / v6); `extra`: px on top of the row's height (stored or default) while secondary action layers are
  // in view (app/Timeline.svelte adds it, never stores it)
  { id: 'timeline.scenes', title: 'Actions and shots', order: 30, height: 56, extra: () => extraFor(tl.actLayers), component: ScenesLane },
  // the Scenes tab: the shots as pictures (select / move cuts; hover scrubs, a drag does not)
  { id: 'timeline.filmstrip', title: 'Shots (frames)', order: 30.2, height: 'fill', minHeight: 24, modes: ['scenes'], component: FilmstripLane },
  // paw-ef73.20: the one row for modifiers (knotting, orgasm, throbbing, idle, insertion, pull-out; Reshape / Climax run-in / spurts in Refine), every tab
  { id: 'timeline.fx', title: 'Modifiers', order: 31, orderIn: { scenes: 30.1 }, height: 24, component: FxLane },
  // Autorange: shown by the command / while the live pass is on
  { id: 'timeline.range', title: 'Range', order: 31.5, height: 84, modes: NOT_SCENES, component: RangeLane, visible: (app) => tl.range || !!app.doc.finish?.autorange },
  { id: 'timeline.plan', title: 'Plan', order: 35, height: 64, modes: NOT_SCENES, component: PlanLane },
  // paw-llaa: no Loops row: the loops are drawn on their shots (ScenesLane), their preferred frames on the ruler
  // hidden when the probe says the media has no audio track (hasAudio null = unknown: shown, the lane hints)
  { id: 'timeline.waveform', title: 'Audio', order: 48, height: 36, modes: NOT_SCENES, component: WaveformLane, visible: (app) => app.doc.media?.hasAudio !== false },
  // the Scenes tab has no point lanes (and so no lane toolbar): the Scene and Shot chips get a bar of their own
  { id: 'timeline.chips', title: 'Scene and shot', order: 60, height: 32, modes: ['scenes'], component: SceneChipsRow, visible: (app) => !!app.doc.scenes?.length },
  // no hint line (paw-idb5): its keys are F1's "Here" section (palette/here.js), what the pointer is over shows in the status bar
];
