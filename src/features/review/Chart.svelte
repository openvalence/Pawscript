<script>
  // A small crisp canvas chart: bars (histograms) or a filled line (time series). Colours are kit tokens, re-read
  // when the theme or density changes.
  //   values   number[] (null = gap)        type   'bars' | 'line'
  //   marker   { f: 0..1 along x, label }   a vertical limit line (e.g. the device speed limit)
  //   split    bar index from which bars are drawn in the warning colour (bars over the limit)
  //   ticks    [{ f, label }] x labels under the plot       readout (i) => string shown top-right while hovering
  //   yMax     fixed y maximum (else the data max)          height   css px
  //   color    series key (kit SERIES: 'sky', 'violet', ...)
  import { cssVar, onThemeChange } from '../../ui/kit/index.js';

  let { values = [], type = 'bars', marker = null, split = -1, ticks = [], readout = null, yMax = null, height = 64, color = 'sky', label = '' } = $props();

  let canvas, wrap, w = $state(0), hover = $state(-1), themeVer = $state(0);
  const cv = (name) => cssVar(name, wrap);
  $effect(() => onThemeChange(() => themeVer++));

  function draw() {
    if (!canvas || !w) return;
    const dpr = window.devicePixelRatio || 1, h = height, ticksH = ticks.length ? 13 : 0, ph = h - ticksH - 2;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const n = values.length, max = yMax ?? Math.max(1e-9, ...values.filter((v) => v != null));
    const mut = cv('--tx-mut'), hi = cv('--tx-hi'), main = cv(`--series-${color}`), over = cv('--bad');
    ctx.strokeStyle = cv('--line-2'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, ph + 0.5); ctx.lineTo(w, ph + 0.5); ctx.stroke();
    if (n) {
      const bw = w / n;
      if (type === 'bars') {
        for (let i = 0; i < n; i++) {
          const v = values[i] ?? 0, bh = Math.max(v > 0 ? 1 : 0, (v / max) * (ph - 2));
          ctx.fillStyle = i === hover ? hi : split >= 0 && i >= split ? over : main;
          ctx.globalAlpha = i === hover ? 1 : 0.85;
          const x0 = Math.floor(i * bw), x1 = Math.max(x0 + 1, Math.floor((i + 1) * bw) - (bw > 4 ? 1 : 0));
          ctx.fillRect(x0, ph - bh, x1 - x0, bh);
        }
        ctx.globalAlpha = 1;
      } else {
        const X = (i) => (i + 0.5) * bw, Y = (v) => ph - 1 - (v / max) * (ph - 4);
        let seg = [];
        const flush = () => {
          if (seg.length) {
            ctx.beginPath(); ctx.moveTo(X(seg[0]), ph); for (const i of seg) ctx.lineTo(X(i), Y(values[i])); ctx.lineTo(X(seg.at(-1)), ph); ctx.closePath();
            ctx.globalAlpha = 0.16; ctx.fillStyle = main; ctx.fill(); ctx.globalAlpha = 1;
            ctx.beginPath(); seg.forEach((i, k) => (k ? ctx.lineTo(X(i), Y(values[i])) : ctx.moveTo(X(i), Y(values[i]))));
            ctx.strokeStyle = main; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
          }
          seg = [];
        };
        for (let i = 0; i < n; i++) { if (values[i] == null) flush(); else seg.push(i); }
        flush();
        if (hover >= 0 && values[hover] != null) { ctx.fillStyle = hi; ctx.beginPath(); ctx.arc(X(hover), Y(values[hover]), 2.5, 0, 7); ctx.fill(); }
      }
    }
    ctx.font = `${cv('--fs-1') || '11px'} ${cv('--mono')}`; ctx.textBaseline = 'top';
    if (marker) {
      const x = Math.round(marker.f * w) + 0.5, ink = cv('--warn-ink');
      ctx.strokeStyle = ink; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ph); ctx.stroke(); ctx.setLineDash([]);
      const right = x > w * 0.6, tw = ctx.measureText(marker.label).width, lx = right ? x - 4 - tw : x + 4;
      ctx.fillStyle = cv('--bg'); ctx.globalAlpha = 0.85; ctx.fillRect(lx - 2, 0, tw + 4, 13); ctx.globalAlpha = 1;
      ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.fillText(marker.label, lx, 1);
    }
    ctx.fillStyle = mut;
    for (const t of ticks) { ctx.textAlign = t.f <= 0.02 ? 'left' : t.f >= 0.98 ? 'right' : 'center'; ctx.fillText(t.label, t.f * w, ph + 3); }
    if (hover >= 0 && readout) {
      const s = readout(hover);
      if (s) { ctx.textAlign = 'right'; ctx.fillStyle = hi; ctx.fillText(s, w - 2, marker && marker.f > 0.6 ? 14 : 0); }
    }
  }
  $effect(() => { values; type; marker; split; ticks; yMax; height; hover; w; color; themeVer; draw(); });

  function move(e) {
    const n = values.length, r = canvas.getBoundingClientRect();
    hover = n ? Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n))) : -1;
  }
</script>

<div class="chart" bind:this={wrap} bind:clientWidth={w} style:height="{height}px" role="img" aria-label={label}>
  <canvas bind:this={canvas} onpointermove={move} onpointerleave={() => (hover = -1)}></canvas>
</div>

<style>
  /* the canvas is out of flow so its backing size never becomes the wrapper's min-content width: the chart shrinks with the panel */
  .chart { width: 100%; min-width: 0; position: relative; overflow: hidden; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
</style>
