<!--
  Frame: one video frame from the assist frame loader, drawn to fit (letterboxed), optionally cropped to a normalised
  region (zoom) and with a tracker overlay frame on top. Draws as soon as the bitmap is in the cache; ondrawn(cached)
  fires once per ms value (the overlay measures time-to-next-question with it).
-->
<script>
  import { drawFrameOverlay } from '../video/roi.js';
  import { theme } from '../timeline/draw.js';

  let { A, ms, crop = null, overlay = null, color = null, ondrawn = null } = $props();
  let canvas = $state(null), w = $state(0), h = $state(0);
  let drawnFor = -1, last = null;

  $effect(() => {
    A.tick; const t = ms, c = canvas, cw = w, ch = h, cr = crop, ov = overlay;
    if (!c || !cw || !ch || t == null) return;
    const bmp = A.frames?.peek(t);
    if (!bmp) { A.frames?.get(t); if (last) { clear(c, cw, ch); last = null; } return; }
    if (last && last[0] === bmp && last[1] === cw && last[2] === ch && last[3] === cr && last[4] === ov) return;   // a frame for someone else arrived
    last = [bmp, cw, ch, cr, ov];
    draw(c, cw, ch, bmp, cr, ov);
    if (drawnFor !== t) { drawnFor = t; ondrawn?.(t); }
  });

  function clear(c, cw, ch) {
    const dpr = devicePixelRatio || 1;
    c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr);
  }
  function draw(c, cw, ch, bmp, cr, ov) {
    const dpr = devicePixelRatio || 1;
    c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // source rect: the crop grown to the canvas aspect, kept inside the frame
    let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
    if (cr) {
      sw = cr.w * bmp.width; sh = cr.h * bmp.height;
      const want = cw / ch;
      if (sw / sh < want) sw = Math.min(bmp.width, sh * want); else sh = Math.min(bmp.height, sw / want);
      sx = Math.max(0, Math.min(bmp.width - sw, (cr.x + cr.w / 2) * bmp.width - sw / 2));
      sy = Math.max(0, Math.min(bmp.height - sh, (cr.y + cr.h / 2) * bmp.height - sh / 2));
    }
    const s = Math.min(cw / sw, ch / sh), dw = sw * s, dh = sh * s, dx = (cw - dw) / 2, dy = (ch - dh) / 2;
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, sx, sy, sw, sh, dx, dy, dw, dh);
    if (ov) drawFrameOverlay(g, { map: (x, y) => [dx + (x * bmp.width - sx) * s, dy + (y * bmp.height - sy) * s] }, ov, color ?? theme().highlight);
  }
</script>

<div class="frame" bind:clientWidth={w} bind:clientHeight={h}>
  <canvas bind:this={canvas} style="width:{w}px;height:{h}px"></canvas>
  {#if !A.frames}<span class="none">no video</span>{/if}
</div>

<style>
  .frame { position: relative; width: 100%; height: 100%; min-height: 0; overflow: hidden; background: var(--bg-sunken); }
  canvas { position: absolute; inset: 0; display: block; }
  .none { position: absolute; inset: 0; display: grid; place-items: center; color: var(--tx-ghost); font-size: var(--fs-2); }
</style>
