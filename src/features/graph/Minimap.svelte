<!--
  Minimap: the whole graph in a 180 x 112 canvas (nodes, frames, selection, the viewport). Press or drag to
  centre the canvas there; the wheel zooms the canvas around that point.
-->
<script>
  import { fitCanvas, tok } from './editor/plot.js';
  import { boundsOf, centerOn } from './editor/geometry.js';

  let { rects = [], frames = [], view, vw, vh, onview } = $props();
  const W = 180, H = 112, PAD = 6;
  let cv = $state();

  // world -> minimap transform over the union of the graph and the visible area
  const map = $derived.by(() => {
    const vis = { x: -view.x / view.k, y: -view.y / view.k, w: vw / view.k, h: vh / view.k };
    const b = boundsOf([...rects, ...frames, vis]) || { x0: 0, y0: 0, x1: 1, y1: 1 };
    const s = Math.min((W - 2 * PAD) / Math.max(1, b.x1 - b.x0), (H - 2 * PAD) / Math.max(1, b.y1 - b.y0));
    const ox = PAD + (W - 2 * PAD - (b.x1 - b.x0) * s) / 2 - b.x0 * s, oy = PAD + (H - 2 * PAD - (b.y1 - b.y0) * s) / 2 - b.y0 * s;
    return { s, ox, oy, vis };
  });

  let raf = 0;
  $effect(() => { void map; void rects; void frames; if (!raf) raf = requestAnimationFrame(paint); return () => { cancelAnimationFrame(raf); raf = 0; }; });
  function paint() {
    raf = 0;
    if (!cv) return;
    const ctx = fitCanvas(cv, W, H), { s, ox, oy, vis } = map;
    const R = (r) => [ox + r.x * s, oy + r.y * s, Math.max(1.5, r.w * s), Math.max(1.5, r.h * s)];
    ctx.fillStyle = tok('--line-1');
    for (const f of frames) ctx.fillRect(...R(f));
    for (const r of rects) { ctx.fillStyle = r.sel ? tok('--highlight') : tok('--line-4'); ctx.fillRect(...R(r)); }
    ctx.strokeStyle = tok('--reality'); ctx.lineWidth = 1;
    const [x, y, w, h] = R(vis);
    ctx.fillStyle = tok('--reality'); ctx.globalAlpha = 0.1; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
  }
  let dragging = false;
  function go(e) {
    const r = cv.getBoundingClientRect(), { s, ox, oy } = map;
    const wx = (e.clientX - r.left - ox) / s, wy = (e.clientY - r.top - oy) / s;
    onview?.(centerOn(view, wx, wy, vw, vh));
  }
</script>

<div class="gmini gover" aria-label="Minimap" role="navigation">
  <canvas bind:this={cv} style:width={W + 'px'} style:height={H + 'px'}
          onpointerdown={(e) => { e.stopPropagation(); dragging = true; e.currentTarget.setPointerCapture(e.pointerId); go(e); }}
          onpointermove={(e) => dragging && go(e)} onpointerup={() => (dragging = false)} onpointercancel={() => (dragging = false)}></canvas>
</div>

<style>
  .gmini { position: absolute; right: 8px; bottom: 8px; z-index: 3; padding: 2px; background: color-mix(in srgb, var(--bg-card) 92%, transparent);
    border: 1px solid var(--line-2); border-radius: var(--radius); box-shadow: var(--shadow-1); }
  canvas { display: block; cursor: pointer; }
</style>
