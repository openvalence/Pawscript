<script>
  // The shell's stand-in lane until src/features/lanes ships its editor: draws one axis (and the visible ghosts on
  // the active axis) with lib/lane.js drawLane. Click seeks and picks the nearest point, drag pans, wheel zooms,
  // double-click fits. Editing is by keyboard commands (digits, nudges, Del).
  import { drawLane, zoomAt, panBy, xToMs, msToX } from '../lib/lane.js';
  import { nearest } from '../lib/core/script.js';
  import { theme } from '../features/timeline/draw.js';
  import { paint as tok } from '../features/tracking/colors.js';
  import { scriptOf } from '../lib/script-of.js';   // paw-x7w7: baked + live

  let { app, axis } = $props();
  let canvas = $state(), w = $state(0), h = $state(0);
  const cache = new WeakMap();
  const arrays = (s) => {   // Script -> typed arrays for drawLane, once per Script identity
    let a = cache.get(s);
    if (!a) { a = { at: Float64Array.from(s, (x) => x.at), pos: Float64Array.from(s, (x) => x.pos) }; cache.set(s, a); }
    return a;
  };
  const active = $derived(app.doc.activeAxis === axis);

  let raf = 0;
  $effect(() => {
    w; h; app.view; app.player.timeMs; app.doc.axes; app.doc.ghosts; app.doc.selection; app.doc.range; active;
    if (!raf) raf = requestAnimationFrame(paint);
  });
  function paint() {
    raf = 0;
    if (!canvas || !w || !h) return;
    const d = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * d) || canvas.height !== Math.round(h * d)) { canvas.width = Math.round(w * d); canvas.height = Math.round(h * d); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const layers = [];
    if (active) for (const g of app.doc.ghosts) if (g.visible && g.script?.length) { const a = arrays(g.script); layers.push({ color: tok(g.color), pat: a.at, ppos: a.pos, ref: !!g.pinned, dim: true }); }
    const s = scriptOf(app, axis);
    if (s.length) { const a = arrays(s); layers.push({ color: active ? theme().reality : theme().txMut, pat: a.at, ppos: a.pos, ref: true }); }
    const r = app.doc.range;
    drawLane(ctx, w, h, app.view, layers, { playhead: app.player.timeMs, range: r ? { start: r.t0, end: r.t1 } : null });
    // selected points on top
    const sel = app.doc.selection;
    if (sel.axis === axis && sel.ats.size) {
      const padT = 14, padB = 12;
      ctx.fillStyle = theme().highlight;
      for (const p of s) if (sel.ats.has(p.at)) {
        const x = msToX(app.view, w, p.at);
        if (x < -5 || x > w + 5) continue;
        ctx.beginPath(); ctx.arc(x, padT + (1 - p.pos / 100) * (h - padT - padB), 4.5, 0, 6.2832); ctx.fill();
      }
    }
  }

  let press = null;
  function down(e) {
    canvas.setPointerCapture(e.pointerId);
    press = { x: e.clientX, view: app.view, moved: false };
    if (!active) app.setActiveAxis(axis);
  }
  function move(e) {
    if (!press) return;
    const dx = e.clientX - press.x;
    if (Math.abs(dx) > 3) press.moved = true;
    if (press.moved) app.setView(panBy(press.view, dx, w, app.durationMs));
  }
  function up(e) {
    if (press && !press.moved) {
      const t = xToMs(app.view, w, e.clientX - canvas.getBoundingClientRect().left);
      const s = scriptOf(app, axis), i = nearest(s, t, (8 / w) * app.view.span);
      if (i >= 0) { app.select(e.shiftKey ? [...app.doc.selection.ats, s[i].at] : [s[i].at], axis); app.player.seek(s[i].at); }
      else { if (!e.shiftKey) app.select([], axis); app.player.seek(t); }
    }
    press = null;
  }
  $effect(() => {
    const c = canvas;
    if (!c) return;
    const wheel = (e) => {
      e.preventDefault();
      const x = e.clientX - c.getBoundingClientRect().left;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) app.setView(panBy(app.view, -(e.deltaX || e.deltaY), w, app.durationMs));
      else app.setView(zoomAt(app.view, xToMs(app.view, w, x), Math.exp(e.deltaY * 0.0015), app.durationMs));
    };
    c.addEventListener('wheel', wheel, { passive: false });
    return () => c.removeEventListener('wheel', wheel);
  });
</script>

<div class="lane" bind:clientWidth={w} bind:clientHeight={h} class:active>
  <canvas bind:this={canvas} onpointerdown={down} onpointermove={move} onpointerup={up} ondblclick={() => app.setView({ start: 0, span: app.durationMs })}></canvas>
</div>

<style>
  .lane { position: relative; width: 100%; height: 100%; overflow: hidden; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; touch-action: none; }
</style>
