// lane-events.svelte.js -- the Machine panel's knot timing, published for the timeline (paw-i86, paw-kwq). While the
// panel is open it publishes its simulated events (simulateKnots over the FINAL script for its toy / experience / rig:
// debounced and cached by the panel) and its setup {toy, rig, P}; closed, it clears them (never stale). The lanes draw
// the events over the stroke lane when machine.laneEvents is on (machineEventsGhost, through lanes/deps.js); the
// Knotting effect reads the verdict for its span and fits its timing (timeline/deps.js machineKnots).
import { rooted } from '../../lib/rooted.svelte.js';
import { eventMarks, knotVerdict, verdictText, fitKnotTiming } from './knotfit.js';
import { knotOf } from './toys.js';

class MachineKnots {
  events = $state.raw(null);
  setup = $state.raw(null);
}
const all = new WeakMap();
const of = (app) => { let s = all.get(app); if (!s) { s = rooted(() => new MachineKnots(), app); all.set(app, s); } return s; };   // paw-b7da: its own root

/** The panel publishes (or, with nulls, withdraws) its events and setup. */
export function publishKnots(app, events, setup) { const s = of(app); if (s.events !== events) s.events = events; if (s.setup !== setup) s.setup = setup; }

export const laneEventsOn = (app) => app.settings.get('machine.laneEvents', false) === true;

const ghosts = new WeakMap();
/** The events as a lane ghost of marks only (no script: nothing to accept or snap to), or null (off, nothing). */
export function machineEventsGhost(app) {
  if (!laneEventsOn(app)) return null;
  const ev = of(app).events;
  if (!ev?.length) return null;
  let g = ghosts.get(ev);
  if (!g) ghosts.set(ev, (g = { id: 'machine-events', name: 'Machine: knots and bends as simulated', color: 'violet', visible: true, script: [], marks: eventMarks(ev), source: { kind: 'machine-events-preview' } }));
  return g;
}

/** What the timeline's Knotting effects get: the verdict on a span, its text, and the fit (null until the panel published). */
export const machineKnots = {
  ready: (app) => !!of(app).setup,
  verdict: (app, t0, t1) => { const s = of(app); return knotVerdict(s.events, t0, t1, !!(s.setup && knotOf(s.setup.toy))); },
  text: verdictText,
  fit: (app, scriptFor, t0, t1, p) => { const st = of(app).setup; return st ? fitKnotTiming(st, scriptFor, t0, t1, p) : null; },
};
