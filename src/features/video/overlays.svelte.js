// overlays.svelte.js -- the overlay layer other features draw on (app.player.overlays). Everything is in
// normalised 0..1 video coordinates; env.map turns them into stage pixels through the same matrix as the video,
// so drawings stay glued under zoom, pan, rotation and flips.
//
//   const off = app.player.overlays.add({ id: 'tracking.runs', order: 10, draw(ctx, env) { ... } });
//   app.player.overlays.addTool({ id: 'tracking.roi', cursor: 'crosshair', hint, down(p, e), move(p, e), up(p, e), context(p, e) });
//   app.player.overlays.tool = 'tracking.roi';      // the active pointer tool (null = drag pans the view)
//   a tool with `frame` (a CSS color) gets a border around the stage while it is the active tool (a mode easy to miss)
//
// draw(ctx, env) runs inside a Svelte effect: $state it reads is tracked, so a drawer repaints by itself when
// its data changes (plain data: call overlays.invalidate()). ctx is in stage CSS px (devicePixelRatio applied).
// env = { w, h, dpr, vw, vh, scale (stage px per video px), map(nx, ny) -> [x, y], unmap(x, y) -> [nx, ny],
//         timeMs, frame, playing, app }.   Pointer tools get p = { nx, ny (clamped 0..1), rx, ry (unclamped), x, y }.

export class Overlays {
  drawers = $state.raw([]);
  tools = $state.raw({});
  tool = $state(null);
  version = $state(0);

  add(d) {
    this.drawers = [...this.drawers.filter((x) => x.id !== d.id), d].sort((a, b) => (a.order || 0) - (b.order || 0));
    return () => this.remove(d.id);
  }
  remove(id) { this.drawers = this.drawers.filter((x) => x.id !== id); }
  addTool(t) {
    this.tools = { ...this.tools, [t.id]: t };
    return () => { const { [t.id]: _, ...rest } = this.tools; this.tools = rest; if (this.tool === t.id) this.tool = null; };
  }
  get activeTool() { return (this.tool && this.tools[this.tool]) || null; }
  invalidate() { this.version++; }
}

// ---- drawing helpers (shared by every client) ----

/** Path of a normalised rectangle (4 mapped corners: right under any rotation/flip). */
export function pathRect(ctx, env, x, y, w, h) {
  const p = [env.map(x, y), env.map(x + w, y), env.map(x + w, y + h), env.map(x, y + h)];
  ctx.moveTo(p[0][0], p[0][1]); for (let i = 1; i < 4; i++) ctx.lineTo(p[i][0], p[i][1]); ctx.closePath();
}
/** Path of a normalised polygon [[x, y], ...]. */
export function pathPoly(ctx, env, poly) {
  poly.forEach(([x, y], i) => { const [X, Y] = env.map(x, y); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
  ctx.closePath();
}

/** Rule-of-thirds and/or title/action-safe frames (mode: 'off' | 'thirds' | 'safe' | 'both'). */
export function drawGuides(ctx, env, mode) {
  if (!mode || mode === 'off') return;
  ctx.save(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(236,239,244,.35)'; ctx.setLineDash([]);
  ctx.beginPath();
  if (mode === 'thirds' || mode === 'both') {
    for (const f of [1 / 3, 2 / 3]) {
      let [a, b] = [env.map(f, 0), env.map(f, 1)]; ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      [a, b] = [env.map(0, f), env.map(1, f)]; ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    }
  }
  ctx.stroke();
  if (mode === 'safe' || mode === 'both') {
    ctx.setLineDash([4, 4]);
    for (const m of [0.05, 0.1]) { ctx.beginPath(); pathRect(ctx, env, m, m, 1 - 2 * m, 1 - 2 * m); ctx.stroke(); }
  }
  ctx.restore();
}
