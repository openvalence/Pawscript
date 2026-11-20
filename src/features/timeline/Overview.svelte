<script>
  // Overview: the whole video [0, duration] in one strip, independent of app.view. Canvas layers, top to bottom:
  // speed bars of the active axis (cached ImageData), plan band (bar height = intensity), problem
  // ticks; over them scene cuts, the range, loop regions, the compare diff and the player loop. The viewport brush,
  // playhead and snap guide are DOM overlays, so playback and view changes never repaint the canvas.
  // Brush: drag body = pan, edges = zoom, outside = draw a new view, wheel = zoom, double-click = fit,
  // click = seek (and centre the view there if it is outside).
  import CanvasLane from './CanvasLane.svelte';
  import { theme, X, drawRange } from './draw.js';
  import { tl, listOf, durOf, scenesOf } from './state.svelte.js';
  import { boundaryTimes } from './shots.js';
  import { kindOf, rgba as hexA } from './kinds.js';
  import { intensityOf, segState } from './plan.js';
  import { itemAt } from './intervals.js';
  import { localX, CLICK_PX } from './interact.js';
  import { loopLooks } from './loop-look.svelte.js';
  import { reviewMarkers, heatmapSettings } from './deps.js';
  import { colorLut } from '../../lib/analyze/heatmap.js';
  import { finalOf } from '../../lib/finish.js';
  import { brushRect, brushDrag, brushWheel, centerOn, pressKind, bands, heatImage, markerColumns, HeatBins, HEADROOM } from './overview.js';

  let { app } = $props();

  const LANE = 'overview';
  const stats = { paints: 0, cold: 0, paintMs: 0, binsMs: 0, colourMs: 0, heatBuilds: 0, rebuilt: null, paintedAt: 0 };
  if (typeof window !== 'undefined') window.__tlOverviewStats = stats;

  const binsBy = new Map(), luts = new Map();          // HeatBins per axis; colour LUT per scale
  const heat = { key: '', img: null, mean: null, peak: null, vals: null, metric: 'mean' };
  let marks = new Uint8Array(0);
  const rgbOf = (s) => (/^#[0-9a-f]{6}$/i.test(s) ? [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)] : [4, 5, 7]);
  const rgba = (c, a) => (/^#[0-9a-f]{6}$/i.test(c) ? hexA(c, a) : c);   // theme tokens are hex; anything else is used as is
  const metricOf = () => app.settings.get('timeline.overviewMetric', 'mean');

  function paint(ctx, w, h) {
    const p0 = performance.now(), T = theme(), dur = durOf(app), ov = { start: 0, span: dur }, B = bands(h);
    const cv = ctx.canvas, d = cv.width / w;
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, w, h);

    // speed bars: bins follow edits incrementally; the coloured image is rebuilt only when its inputs change
    const axis = app.doc.activeAxis, script = finalOf(app, axis);   // the final (lib/finish.js): what plays
    let bins = binsBy.get(axis);
    if (!bins) binsBy.set(axis, (bins = new HeatBins()));
    const b0 = performance.now(), ch = bins.update(script, dur);
    stats.binsMs = performance.now() - b0;
    if (ch) stats.rebuilt = ch;
    const hs = heatmapSettings(app), max = hs.max || 400, metric = metricOf();
    const y0 = Math.round(B.heat.y * d), Wd = cv.width, Hd = Math.round((B.heat.y + B.heat.h) * d) - y0;
    const key = `${axis}|${bins.version}|${Wd}|${Hd}|${hs.scale}|${max}|${metric}|${T.bg}|${tl.themeTick}`;
    if (key !== heat.key && Hd > 0) {
      const c0 = performance.now();
      if (heat.mean?.length !== Wd) { heat.mean = new Float32Array(Wd); heat.peak = new Float32Array(Wd); }
      if (heat.img?.width !== Wd || heat.img?.height !== Hd) heat.img = new ImageData(Wd, Hd);
      bins.columns(Wd, heat.mean, heat.peak, dur);
      heat.vals = metric === 'peak' ? heat.peak : heat.mean; heat.metric = metric;
      let lut = luts.get(hs.scale);
      if (!lut) luts.set(hs.scale, (lut = colorLut(hs.scale)));
      heatImage(heat.vals, Wd, Hd, lut, max, rgbOf(T.bg), heat.img.data);
      heat.key = key; stats.heatBuilds++; stats.colourMs = performance.now() - c0;
    }
    if (heat.img && Hd > 0) ctx.putImageData(heat.img, 0, y0);
    // the device limit: a hairline at its bar height; bars above it are too fast
    ctx.fillStyle = rgba(T.txHi, 0.2);
    ctx.fillRect(0, Math.round(B.heat.y + B.heat.h * (1 - 1 / HEADROOM)), w, 1);

    // cuts: hairlines through the bars (paw-p2p0: not at a camera move, one take goes on there)
    ctx.fillStyle = rgba(T.txHi, 0.09);
    for (const t of boundaryTimes(scenesOf(app)).cuts) ctx.fillRect(X(ov, w, t), B.heat.y, 1, B.heat.h);
    drawRange(ctx, ov, w, h, app.doc.range);

    // plan: the story as kind colours; the solid part's height is the segment's intensity
    const sel = tl.segs;
    for (const s of listOf(app, 'plan')) {
      const k = kindOf(s.kind), x0 = X(ov, w, s.t0), x1 = X(ov, w, s.t1), sw = Math.max(1, x1 - x0 - (x1 - x0 > 3 ? 1 : 0));
      const ih = Math.max(2, Math.round(B.plan.h * (0.3 + 0.7 * intensityOf(s))));
      ctx.fillStyle = rgba(k.color, 0.2); ctx.fillRect(x0, B.plan.y, sw, B.plan.h - ih);
      ctx.fillStyle = rgba(k.color, k.dash ? 0.55 : 0.9); ctx.fillRect(x0, B.plan.y + B.plan.h - ih, sw, ih);
      if (sel.includes(s.id)) { ctx.fillStyle = T.txHi; ctx.fillRect(x0, B.plan.y - 1, sw, 1); }
      if (sw >= 8 && segState(s) === 'stale') {   // changed since generated: the plan lane's warn dot, small
        const r = B.plan.h >= 9 ? 2 : 1.5;
        ctx.fillStyle = T.warn; ctx.beginPath(); ctx.arc(x0 + sw - r - 2, B.plan.y + r + 1, r, 0, 6.2832); ctx.fill();
      }
    }

    // loop regions: a rail near the top of the bars (where only very fast bars reach), the source cycle solid, its passes /
    // tiles lighter, each in its loop's colour (paw-llaa); the highlighted matches (tl.match) as ticks on the rail
    const looks = loopLooks(app);
    if (looks.size) {
      const y = B.heat.y + 3;
      for (const o of looks.values()) {
        const l = o.l, a = X(ov, w, l.t0), b = Math.max(a + 1, X(ov, w, l.t1)), e = X(ov, w, o.g.end);
        ctx.fillStyle = o.color;
        if (e > b) { ctx.globalAlpha = tl.loop === l.id ? 0.7 : 0.45; ctx.fillRect(b, y, e - b, 2); }
        ctx.globalAlpha = 1; ctx.fillRect(a, y - 1, b - a, 3);
      }
    }
    if (tl.match) {
      ctx.fillStyle = tl.match.color || T.txHi;
      for (const sp of tl.match.spans || []) { const a = X(ov, w, sp.t0); ctx.fillRect(a, B.heat.y, Math.max(2, X(ov, w, sp.t1) - a), 2); }
    }

    // problems on the active axis: worst severity per column; the selected one gets a full-height line
    const items = reviewMarkers?.items ?? [];
    if (items.length) {
      const n = Math.ceil(w);
      if (marks.length !== n) marks = new Uint8Array(n);
      markerColumns(items, axis, dur, w, marks);
      const col = [null, rgba(T.reality, 0.55), T.warn, T.bad];
      for (let c = 0; c < n;) {
        const s = marks[c];
        let e = c + 1;
        while (e < n && marks[e] === s) e++;
        if (s) { ctx.fillStyle = col[s]; ctx.fillRect(c, B.marks.y, e - c, B.marks.h); }
        c = e;
      }
      const it = reviewMarkers.selectedId != null && items.find((x) => x.id === reviewMarkers.selectedId);
      if (it) {
        const x = X(ov, w, it.t0);
        ctx.fillStyle = rgba(T.txHi, 0.35); ctx.fillRect(x, B.heat.y, 1, B.marks.y - B.heat.y);
        ctx.fillStyle = T.txHi; ctx.beginPath(); ctx.moveTo(x - 3.5, h); ctx.lineTo(x + 4.5, h); ctx.lineTo(x + 0.5, h - 5); ctx.fill();
      }
    }
    const diff = reviewMarkers?.diff ?? [];
    if (diff.length) {
      ctx.fillStyle = rgba(T.intent, 0.8);
      for (const x of diff) { const a = X(ov, w, x.t0); ctx.fillRect(a, B.heat.y, Math.max(1, X(ov, w, x.t1) - a), 2); }
    }

    // loop playback
    const lp = app.player.loop;
    if (lp) {
      const x0 = X(ov, w, lp.t0), x1 = Math.max(x0 + 1, X(ov, w, lp.t1));
      ctx.fillStyle = rgba(T.ok, 0.08); ctx.fillRect(x0, 0, x1 - x0, h);
      ctx.fillStyle = rgba(T.ok, 0.8); ctx.fillRect(x0, 0, 1, h); ctx.fillRect(x1 - 1, 0, 1, h); ctx.fillRect(x0, 0, x1 - x0, 2);
    }

    stats.paints++; stats.paintedAt = performance.now(); stats.paintMs = stats.paintedAt - p0;
    if (stats.paints === 1) stats.cold = stats.paintMs;
  }

  // ---- pointer ----
  let drag = null, part = $state(null), dragKind = $state(null), root = $state();
  const cursor = $derived(dragKind === 'body' ? 'grabbing' : dragKind === 'left' || dragKind === 'right' || part === 'left' || part === 'right' ? 'ew-resize' : part === 'body' ? 'grab' : 'default');
  const kindAt = (x, W) => pressKind(x, brushRect(app.view, durOf(app), W), W);

  function down(e) {
    if (e.button !== 0) return;
    const el = e.currentTarget, W = el.clientWidth, x = localX(e, el);
    drag = { kind: kindAt(x, W), x0: x, v0: app.view, W, dur: durOf(app), moved: false };
    el.setPointerCapture?.(e.pointerId);
  }
  function move(e) {
    const el = e.currentTarget, W = el.clientWidth, x = localX(e, el);
    if (drag) {
      tl.hover = null;
      if (!drag.moved && Math.abs(x - drag.x0) < CLICK_PX) return;
      drag.moved = true; dragKind = drag.kind;
      app.setView(brushDrag(drag.kind, drag.v0, drag.x0, x, drag.W, drag.dur));
      return;
    }
    const k = kindAt(x, W);
    part = k === 'new' ? null : k;
    if (tl.hover?.lane === LANE) tl.hover = { ...tl.hover, t: Math.max(0, Math.min(1, x / W)) * durOf(app) };   // CanvasLane computes t in view coords
  }
  function up() {
    const g = drag;
    drag = null; dragKind = null;
    if (!g || g.moved) return;
    const t = Math.max(0, Math.min(g.dur, (g.x0 / g.W) * g.dur));
    app.player.seek(t, { exact: true });
    const v = app.view;
    if (t < v.start || t > v.start + v.span) app.setView(centerOn(v, t, g.dur));
  }
  const cancel = () => { if (drag?.moved) app.setView(drag.v0); drag = null; dragKind = null; };   // pointercancel / Esc: the view before the drag
  const fit = () => app.setView({ start: 0, span: durOf(app) });

  $effect(() => {
    const el = root;
    if (!el) return;
    const fn = (e) => {
      e.preventDefault();
      const W = el.clientWidth, x = localX(e, el), dur = durOf(app), v = app.view;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) app.setView({ start: v.start + ((e.shiftKey ? e.deltaY : e.deltaX) / W) * dur, span: v.span });
      else app.setView(brushWheel(v, (x / W) * dur, e.deltaY, dur));
    };
    el.addEventListener('wheel', fn, { passive: false });
    return () => el.removeEventListener('wheel', fn);
  });

  function hoverText(_t, x, e) {
    const W = e.currentTarget.clientWidth, dur = durOf(app), t = (x / W) * dur, out = [];
    const s = itemAt(listOf(app, 'plan'), t);
    if (s) { const i = intensityOf(s); out.push(kindOf(s.kind).label + (i < 1 ? ` ${Math.round(i * 100)}%` : '')); }
    const v = heat.vals?.[Math.floor((x / W) * heat.vals.length)];
    if (v != null) out.push(`${Math.round(v)} u/s ${heat.metric}`);
    const tol = (3 * dur) / W, axis = app.doc.activeAxis;
    const p = reviewMarkers?.items.find((it) => (!it.axis || it.axis === axis) && it.t0 - tol <= t && t <= it.t1 + tol);
    if (p) out.push(`${p.severity}: ${p.kind}`);
    return out.join(' · ') || null;
  }
</script>

<div class="ov" bind:this={root}>
  <CanvasLane {app} lane={LANE} label="Overview" {paint} {cursor} playhead={false} wheel={false} oob={false} follow={false} {hoverText}
    onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={cancel} ondblclick={fit}>
    {#snippet children({ w })}
      {#if w > 0}
        {@const dur = durOf(app)}
        {@const r = brushRect(app.view, dur, w)}
        {@const x0 = Math.round(r.x0)}
        {@const x1 = Math.max(x0 + 2, Math.round(r.x1))}
        <div class="brush" class:l={(dragKind ?? part) === 'left'} class:r={(dragKind ?? part) === 'right'} class:b={(dragKind ?? part) === 'body'}
          style:left="{x0}px" style:width="{x1 - x0}px"></div>
        <div class="head" style:transform="translateX({Math.round((app.player.timeMs / dur) * w)}px)"></div>
        {#if tl.snap}<div class="snapline" style:transform="translateX({Math.round((tl.snap.t / dur) * w)}px)"></div>{/if}
      {/if}
    {/snippet}
  </CanvasLane>
</div>

<style>
  .ov { position: absolute; inset: 0; }
  .ov :global(.snap) { display: none; }   /* CanvasLane's guide is placed in view coords; ours (.snapline) in overview coords */
  .brush, .head, .snapline { position: absolute; top: 0; bottom: 0; pointer-events: none; }
  /* the view: a bright frame with a dark outer keyline so it reads on any heat colour */
  .brush { --c: var(--tx-hi); box-sizing: border-box; background: color-mix(in srgb, var(--c) 8%, transparent); border: 1px solid color-mix(in srgb, var(--c) 90%, transparent);
    border-top-color: color-mix(in srgb, var(--c) 50%, transparent); border-bottom-color: color-mix(in srgb, var(--c) 50%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--bg-sunken) 60%, transparent); }
  .brush.b { background: color-mix(in srgb, var(--c) 13%, transparent); }
  .brush.l { border-left-color: var(--tx-hi); border-left-width: 2px; }
  .brush.r { border-right-color: var(--tx-hi); border-right-width: 2px; }
  .head { left: 0; width: 1px; background: var(--highlight); }
  .head::before { content: ''; position: absolute; top: 0; left: -3px; border: 3.5px solid transparent; border-top: 4px solid var(--highlight); }
  .snapline { left: 0; width: 1px; background: repeating-linear-gradient(to bottom, var(--warn) 0 3px, transparent 3px 6px); }
</style>
