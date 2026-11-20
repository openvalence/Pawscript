// frame-cursor.js -- the grey frame cursor (paw-ef73.22, owner: "the grey cursor should always be visible, pink stays
// smooth, the grey snaps"): the frame that contains the playhead, drawn at that frame's start, with the frame's width as a
// faint block (and its number) on the ruler. Pure: the one time -> x mapping (draw.js X / frameAt / frameTime), nothing
// else; CanvasLane draws it. Setting timeline.frameCursor: off | ruler | full (View menu: Timeline: frame cursor).
import { X, frameAt, frameTime } from './draw.js';
import { frameLen } from '../../lib/lane.js';

export const FRAME_CURSOR_MODES = ['off', 'ruler', 'full'];
export const FRAME_CURSOR_DEFAULT = 'full';
export const BLOCK_MIN_PX = 6;   // the faint frame-wide block (and the number) only where a frame is at least this wide
export const frameCursorMode = (v) => (FRAME_CURSOR_MODES.includes(v) ? v : FRAME_CURSOR_DEFAULT);
/** The next mode in the View menu's cycle: full -> ruler -> off -> full. */
export const nextFrameCursorMode = (m) => FRAME_CURSOR_MODES[(FRAME_CURSOR_MODES.indexOf(frameCursorMode(m)) + 2) % 3];

/** The frame containing time t: {n, t0 (its start ms), x (its start px, unrounded), w (its width px), wide}. */
export function frameBoxAt(view, laneW, t, frameMs) {
  const n = Math.max(0, frameAt(t, frameMs)), x = X(view, laneW, frameTime(n, frameMs));
  const w = X(view, laneW, frameTime(n + 1, frameMs)) - x;
  return { n, t0: frameTime(n, frameMs), x, w, wide: w >= BLOCK_MIN_PX };
}
/** What `lane` draws for the playhead at t: null (off, or this row is not drawn in this mode / the frame is off screen) or
 *  {...frameBoxAt, block: the ruler's block + number}. mode: off | ruler | full; ruler: this lane is the Time ruler. */
export function frameCursorOf(mode, ruler, view, laneW, t, frameMs) {
  const m = frameCursorMode(mode);
  if (m === 'off' || (m === 'ruler' && !ruler) || !(laneW > 0) || !frameLen(frameMs) || !Number.isFinite(t)) return null;
  const b = frameBoxAt(view, laneW, t, frameMs);
  if (b.x + Math.max(b.w, 1) < -1 || b.x > laneW + 1) return null;
  return { ...b, block: ruler && b.wide };
}
