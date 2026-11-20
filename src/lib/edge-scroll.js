// edge-scroll.js -- a timeline drag follows the pointer past the edge (paw-cp8k: "if I extend something far I don't have to keep
// panning then dragging"). While a drag holds the pointer within EDGE_PX of the left / right edge of a row (or past it), the view
// pans that way, faster the further in; every frame the drag is re-run at the last pointer position (step), so what is dragged
// keeps the time under the pointer while the view moves under it. One helper for every row: CanvasLane (every timeline strip),
// LaneView (the axis lanes) and lib/xform.js (a modal G on a row).

export const EDGE_PX = 40;           // the band inside each edge of a row where the view starts to pan
export const EDGE_MAX_VIEWS = 1.5;   // full speed in view widths per second: one band past the edge and further
const ARM_PX = 3;                    // the pointer must travel this far first: a press held near an edge is not a drag yet

/** Pan speed in screen px per second for pointer x in a row w px wide (+ later, - earlier, 0 none): 0 at the band's inner
 *  line, growing linearly to full speed one band past the edge. Screen px, so it feels the same at any zoom. */
export function edgeSpeed(x, w, margin = EDGE_PX, maxViews = EDGE_MAX_VIEWS) {
  if (!(w > 0) || !Number.isFinite(x)) return 0;
  const m = Math.min(margin, w / 4);   // a narrow row keeps its middle half
  const d = x < m ? x - m : x > w - m ? x - (w - m) : 0;
  return Math.sign(d) * Math.min(1, Math.abs(d) / (2 * m)) * maxViews * w;
}

/** View v panned by dx screen px (a row w px wide) inside [0, dur]: never past an end and never pulled back from one it is
 *  already past (a manual pan may show the out-of-range); the whole video in view: v itself. */
export function edgePan(v, dx, w, dur) {
  if (!dx || !(w > 0) || !(v.span < dur)) return v;
  const s = v.start + (dx / w) * v.span;
  const start = dx < 0 ? Math.min(v.start, Math.max(0, s)) : Math.max(v.start, Math.min(dur - v.span, s));
  return start === v.start ? v : { start, span: v.span };
}

/**
 * One drag opts in: {app, el (the row: its rect is the visible time), step() (re-run the drag at the last pointer position),
 * x0 (the press's clientX; default: the first move's)}.
 * -> {move(clientX): on every pointer move of the drag, stop(restore): when it ends (restore: Esc / cancel, the view back to
 * where the drag began)}. requestAnimationFrame-driven; idle while the pointer is out of the bands; never while the view
 * follows the playhead (playing with Follow on: that owns the view); stops on window blur.
 */
export function edgeFollow({ app, el, step, x0: press = null }) {
  const view0 = app.view;
  let x0 = press, x = 0, armed = false, raf = 0, last = 0, panned = false, live = true;
  const speed = () => { const r = el.getBoundingClientRect(); return { v: edgeSpeed(x - r.left, r.width), w: r.width }; };
  const tick = (now) => {
    const { v, w } = speed(), dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;   // a stalled frame never jumps far
    last = now;
    const nv = v && !(app.player?.playing && app.follow) ? edgePan(app.view, v * dt, w, app.durationMs) : app.view;
    if (nv === app.view) { raf = 0; return; }   // out of the bands, or at an end: idle until the pointer moves again
    app.setView(nv); panned = true;
    step();   // (its pointer move comes back through move(): raf is still set, so no second loop)
    raf = requestAnimationFrame(tick);
  };
  const blur = () => stop(false);
  function move(cx) {
    if (!live) return;
    x = cx; x0 ??= cx;
    if (!armed && Math.abs(cx - x0) < ARM_PX) return;
    armed = true;
    if (!raf && speed().v) { last = 0; raf = requestAnimationFrame(tick); }
  }
  function stop(restore = false) {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (live) removeEventListener('blur', blur);
    live = false;
    if (restore && panned) { app.setView(view0); panned = false; }
  }
  addEventListener('blur', blur);
  return { move, stop };
}
