// commands-view.js -- timeline view / navigation commands.
import { tl, listOf, scenesOf } from './state.svelte.js';
import lanes from './lane.js';
import { repeatsShown } from './repeats.svelte.js';
import { transitionsShown } from './transitions.svelte.js';
import { jumpCut } from './commands-scenes.js';
import { nextFrameCursorMode } from './frame-cursor.js';
import { framesView } from './ticks.js';
import { guard } from '../../app/commands.js';

const zoomTo = (app, t0, t1) => { const pad = (t1 - t0) * 0.03; app.setView({ start: t0 - pad, span: t1 - t0 + 2 * pad }); };
const now = (app) => app.player.timeMs;

const before = new WeakMap();   // app -> the view before "Zoom to frames", for the way back (paw-0zfa: each tab its own)
/** Shift+Z (paw-ef73.18): the timeline zoomed around the playhead until frames are ~12 px wide (ticks.js framesView); again
 *  (still zoomed in that far): back to the view before. The rows' width: the Time ruler's. */
export function zoomFrames(app) {
  const w = globalThis.document?.querySelector('[data-tl-lane="ruler"]')?.clientWidth || 1000, fm = app.player.frameMs || 1000 / 30, b = before.get(app);
  if (b && (fm / app.view.span) * w >= 9) { app.setView(b); before.delete(app); return; }
  before.set(app, app.view);
  app.setView(framesView(w, fm, app.player.timeMs));
}

// Lane toggles need the shell's Layout (layout.setRow); it is not on `app` yet, so use app.layout when present.
const toggleLane = (l) => (app) => {
  const lay = app.layout;
  if (!lay?.setRow) { app.toast('Lane toggling is not available here', 'warn'); return; }
  lay.setRow(l.id, { collapsed: !lay.row(l.id).collapsed });
};

export default [
  { id: 'timeline.view.timeMode', title: 'Ruler: timecode / frames', menu: 'View', group: 'timeline', run: () => { tl.timeMode = tl.timeMode === 'time' ? 'frames' : 'time'; } },
  { id: 'timeline.view.repeats', title: 'Ruler: show / hide repeated frames', menu: 'View', group: 'timeline',
    run: (app) => { const on = !repeatsShown(app); app.settings.set('timeline.repeats', on); app.toast(on ? 'Repeated frames shown on the ruler' : 'Repeated frames hidden', 'quiet'); } },
  { id: 'timeline.view.transitions', title: 'Ruler: show / hide fades and dissolves', menu: 'View', group: 'timeline',
    run: (app) => { const on = !transitionsShown(app); app.settings.set('timeline.transitions', on); app.toast(on ? 'Fades and dissolves shown' : 'Fades and dissolves hidden', 'quiet'); } },
  { id: 'timeline.view.frameCursor', title: 'Timeline: frame cursor (full / ruler only / off)', menu: 'View', group: 'timeline',
    tip: 'Gray cursor on the playhead frame, the playhead stays smooth',
    run: (app) => { const m = nextFrameCursorMode(app.settings.get('timeline.frameCursor', 'full')); app.settings.set('timeline.frameCursor', m); app.toast(`Frame cursor: ${{ full: 'on the ruler and through the rows', ruler: 'on the ruler only', off: 'off' }[m]}`, 'quiet'); } },
  // paw-ef73.11: was on the Scenes row's right-click
  { id: 'timeline.view.sceneGuides', title: 'Lanes: show / hide guide lines at scene boundaries', menu: 'View', group: 'timeline',
    run: (app) => { const on = app.settings.get('timeline.sceneGuides', true) === false; app.settings.set('timeline.sceneGuides', on); app.toast(on ? 'Scene guide lines shown' : 'Scene guide lines hidden', 'quiet'); } },
  { id: 'timeline.range.clear', title: 'Clear range selection', menu: 'View', group: 'timeline', when: guard((app) => !!app.doc.range, 'Set a range first (I / O)'), run: (app) => { app.doc.range = null; } },
  { id: 'timeline.zoom.scene', title: 'Zoom to scene at playhead', keys: ['Alt+Shift+Z'], menu: 'View', group: 'timeline-zoom',
    when: guard((app) => scenesOf(app).length > 0, 'Detect scenes first'), run: (app) => {
      const t = now(app), ss = scenesOf(app), s = ss.find((x) => t >= x.start_ms && t < x.end_ms) ?? ss[ss.length - 1];
      zoomTo(app, s.start_ms, s.end_ms);
    } },
  { id: 'timeline.zoom.frames', title: 'Zoom to frames (again: back)', keys: ['Shift+Z'], menu: 'View', group: 'timeline-zoom',
    tip: 'Each frame a numbered cell on the ruler', run: zoomFrames },
  { id: 'timeline.zoom.segments', title: 'Zoom to selected plan segments', keys: ['Ctrl+Alt+Z'], menu: 'View', group: 'timeline-zoom',
    when: guard(() => tl.segs.length > 0, 'Select plan segments first'), run: (app) => {
      const s = listOf(app, 'plan').filter((x) => tl.segs.includes(x.id));
      if (s.length) zoomTo(app, Math.min(...s.map((x) => x.t0)), Math.max(...s.map((x) => x.t1)));
    } },
  { id: 'timeline.cut.next', title: 'Next scene cut', keys: ['Shift+PageDown'], menu: 'Play', group: 'jump', run: (app) => jumpCut(app, 1) },
  { id: 'timeline.cut.prev', title: 'Previous scene cut', keys: ['Shift+PageUp'], menu: 'Play', group: 'jump', run: (app) => jumpCut(app, -1) },
  ...lanes.map((l) => ({ id: 'timeline.toggle.' + l.id.split('.')[1], title: 'Toggle ' + l.title + ' lane', menu: 'View', group: 'timeline-lanes', run: toggleLane(l) })),
];
