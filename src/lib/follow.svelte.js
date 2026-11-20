// follow.svelte.js -- the app's "what the machine follows" (paw-rtby; paw-x7w7). The script itself (lib/finish.js finalOf over
// lib/script-of.js scriptOf: baked + live runs, fills and bridges, in every tab), and in the Track tab, while a track runs, its
// live trace put in on the active axis (follow.js followBase), so the machine preview and the position bar follow the tracker
// as it goes. Device playback reads finalOf: the same script without the running trace.
import { rooted } from './rooted.svelte.js';
import { finalOf, finalScript, docOf } from './finish.js';
import { followBase, liveScript } from './follow.js';
import { peekTracking } from '../features/tracking/tracking.svelte.js';

const NONE = Object.freeze([]);

class Follow {
  constructor(app) { this.app = app; }
  /** The active axis with the running track's trace in it: {axis, script (final), spans} | null (no track running). */
  withLive = $derived.by(() => {
    const app = this.app, tr = app.mode === 'track' ? peekTracking(app) : null;
    if (!tr?.live) return null;
    tr.tick;
    const axis = app.doc.activeAxis, d = docOf(app, axis), ls = liveScript(tr.live.frames);
    if (!ls.length) return null;
    const r = followBase(d.axes[axis], [{ t0: ls[0].at, t1: ls[ls.length - 1].at, script: ls, kind: 'live', name: 'live' }]);
    if (!r.spans.length) return null;
    return { axis, script: finalScript({ ...d, axes: { [axis]: r.script } }, axis, app.finishEnv?.() ?? {}), spans: r.spans };
  });
}

const per = new WeakMap();
// paw-8ika: made under its own effect root, never under the reaction that first asks. Its deriveds belong to the effect that
// is running when they are made; made inside a component's derived (the position bar's, the simulator's), they died with that
// component (the document closed: the overlays unmount) and from then on returned their last value: the next video's Track tab
// showed the closed project's run, frozen while scrubbing.
const followFor = (app) => { let f = per.get(app); if (!f) { f = rooted(() => new Follow(app), app); per.set(app, f); } return f; };

/** What the machine follows on `axis`: {script (a final, lib/finish.js), spans (the running track's trace in it, kind 'live';
 *  [] = the script itself)}. live: false leaves the running trace out (the planner: it would restart on every batch). */
export function followOf(app, axis = app.doc.activeAxis, { live = true } = {}) {
  const b = live && axis === app.doc.activeAxis && app.mode === 'track' ? followFor(app).withLive : null;
  return b ? { script: b.script, spans: b.spans } : { script: finalOf(app, axis), spans: NONE };
}
