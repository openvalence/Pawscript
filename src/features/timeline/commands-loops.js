// commands-loops.js -- loop commands (L / Shift+L, mark and loop playback, stay the shell's core commands).
import { tl } from './state.svelte.js';
import * as A from './loop-actions.js';
import { loopPop } from './LoopPopover.svelte';
import { loopLooks, setLoopPick, seekSame, clearMatch } from './loop-look.svelte.js';
import { pickStep, passAt } from './loop-marks.js';
import { gridOf } from '../../lib/lane.js';
import { guard, whyOf } from '../../app/commands.js';

const has = guard((app) => !!A.targetLoop(app), 'Click a loop or put the playhead on one');
const NO_LOOPS = 'Mark a loop first (L)';
// paw-llaa: the loops live on the Shots strip (and their ticks on the ruler). Keys reused from elsewhere (Enter,
// Delete/Backspace, Alt+arrows) need BOTH keyboard focus on that row or the ruler (tl.focus mirrors DOM focus) and a
// selected loop (a click on it; a click on anything else in the row clears it); Enter / Delete also wait while the popover
// is open. Sorted before commands-scenes.js, so a selected loop wins Delete over the shot / cut keys.
const sel = (app) => ['scenes', 'ruler', 'loops'].includes(tl.focus) && !!A.getLoop(app, tl.loop);
const selClosed = guard((app) => sel(app) && !loopPop.id, (app) => (sel(app) ? 'Close the loop options first' : 'Click a loop first'));
// args.id (context menu) names the loop; else the selected one, else the one under the playhead
const pick = (app, args) => A.getLoop(app, args?.id) ?? A.targetLoop(app);
const on = (fn) => (app, args) => { const l = pick(app, args); if (l) fn(app, l.id); };
const G = { menu: 'Play', group: 'loop' };
/** The selected loop's preferred frame one frame on (wrapping in its cycle); the playhead shows it. */
function nudgePick(app, dir) {
  const o = loopLooks(app).get(tl.loop);
  if (!o) return;
  const p = pickStep(o.g, o.pick, dir);
  setLoopPick(app, o.l.id, p);
  const k = passAt(o.l, o.g, app.player.timeMs, gridOf(app.player) || 1000 / 30);
  app.player.seek(loopLooks(app).get(tl.loop)?.ticks[k]?.t ?? o.l.t0);
}

export default [
  { id: 'loops.tile', title: 'Tile loop across range', keys: ['Ctrl+L'], ...G, when: has, run: on(A.tileLoop) },
  { id: 'loops.retile', title: 'Re-tile loop (selected, else every stale loop)', keys: ['Ctrl+Shift+L'], ...G,
    when: guard((app) => app.doc.loops.length > 0, NO_LOOPS),
    run: (app, args) => { const l = A.getLoop(app, args?.id ?? tl.loop); if (l && (args?.id || A.isStale(app, l))) A.retileLoop(app, l.id); else A.retileStale(app); } },
  { id: 'loops.removeTiles', title: 'Remove loop tiles', ...G, when: guard((app) => !!A.targetLoop(app)?.tiledTo, (app) => whyOf(app, has) || 'Tile the loop first'), run: on(A.removeTiles) },
  { id: 'loops.playback', title: 'Loop playback on this loop', ...G, when: has, run: on(A.togglePlayback) },
  // the context menu's Delete (the keyed loops.delete needs lane focus, which a menu click takes away)
  { id: 'loops.remove', title: 'Delete loop', ...G, hidden: true, when: has, run: on(A.deleteLoop) },
  { id: 'loops.snap', title: 'Snap the loop to frames', ...G, when: has, run: on(A.snapLoop) },
  { id: 'loops.useDetected', title: 'Loop: use detected period', ...G, when: has, run: on(A.useDetected) },
  { id: 'loops.next', title: 'Next loop', keys: ['Ctrl+Alt+L'], ...G, when: guard((app) => app.doc.loops.length > 0, NO_LOOPS), run: (app) => A.gotoLoop(app, 1) },
  { id: 'loops.prev', title: 'Previous loop', keys: ['Ctrl+Alt+Shift+L'], ...G, when: guard((app) => app.doc.loops.length > 0, NO_LOOPS), run: (app) => A.gotoLoop(app, -1) },
  { id: 'loops.open', title: 'Loop options…', keys: ['Enter'], ...G, when: selClosed,
    run: (app) => { loopPop.id = tl.loop; } },
  { id: 'loops.delete', title: 'Delete loop', keys: ['Delete', 'Backspace'], ...G, when: selClosed, run: (app) => A.deleteLoop(app, tl.loop) },
  // paw-llaa: with a loop selected, Alt+← / → move its preferred frame a frame (every pass follows); its cycle's edges:
  // Alt+Shift+← / → the out edge, Ctrl+Alt+Shift+← / → the in edge (core ←/→ step frames otherwise)
  { id: 'loops.pickNext', title: 'Loop: preferred frame +1', keys: ['Alt+ArrowRight'], ...G, hidden: true, when: sel, run: (app) => nudgePick(app, 1) },
  { id: 'loops.pickPrev', title: 'Loop: preferred frame −1', keys: ['Alt+ArrowLeft'], ...G, hidden: true, when: sel, run: (app) => nudgePick(app, -1) },
  { id: 'loops.outPlus', title: 'Loop out +1 frame', keys: ['Alt+Shift+ArrowRight'], ...G, hidden: true, when: sel, run: (app) => A.nudgeLoop(app, tl.loop, 't1', 1) },
  { id: 'loops.outMinus', title: 'Loop out −1 frame', keys: ['Alt+Shift+ArrowLeft'], ...G, hidden: true, when: sel, run: (app) => A.nudgeLoop(app, tl.loop, 't1', -1) },
  { id: 'loops.inPlus', title: 'Loop in +1 frame', keys: ['Ctrl+Alt+Shift+ArrowRight'], ...G, hidden: true, when: sel, run: (app) => A.nudgeLoop(app, tl.loop, 't0', 1) },
  { id: 'loops.inMinus', title: 'Loop in −1 frame', keys: ['Ctrl+Alt+Shift+ArrowLeft'], ...G, hidden: true, when: sel, run: (app) => A.nudgeLoop(app, tl.loop, 't0', -1) },
  // paw-llaa: step the playhead through every place the picture under it plays (across shots, wrapping; inside a loop with
  // no repeated frames: its passes at that phase); the ruler says where ("3 of 29 in shot 21.1 · +12 in 1 other shot")
  { id: 'loops.nextSame', title: 'Next same frame (the picture under the playhead, elsewhere)', keys: ['Alt+.'], ...G, when: guard((app) => !!app.doc.media, 'Open a video first'), run: (app) => seekSame(app, 1) },
  { id: 'loops.prevSame', title: 'Previous same frame', keys: ['Alt+,'], ...G, when: guard((app) => !!app.doc.media, 'Open a video first'), run: (app) => seekSame(app, -1) },
  { id: 'loops.clearMatch', title: 'Clear the highlighted matches', keys: ['Escape'], ...G, hidden: true, when: () => !!tl.match, run: () => clearMatch() },
];
