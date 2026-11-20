<script>
  // MockCanvas.svelte -- the editor mock's canvas surfaces: 'lane' (script graph + ghosts + selection +
  // playhead), 'ruler' (time ticks), 'overview' (whole-video speed heatmap + chapters + view window).
  // Every colour is a token read with cssVar() from the canvas itself (so a data-theme subtree re-inks it),
  // re-read on onThemeChange() and on resize. Device-pixel aligned: hairlines land on whole pixels.
  import { cssVar } from '../color.js';
  import { onThemeChange } from '../tokens.js';

  let {
    kind = 'lane', script = [], ghosts = [], view = { start: 0, span: 10_000 }, playhead = 0,
    selection = null, duration = 1, bins = null, chapters = [], label = '', ...rest
  } = $props();

  let cv, w = $state(0), h = $state(0), themeTick = $state(0);

  $effect(() => onThemeChange(() => themeTick++));
  $effect(() => {
    const ro = new ResizeObserver(([e]) => { w = Math.round(e.contentRect.width); h = Math.round(e.contentRect.height); });
    ro.observe(cv.parentElement);
    return () => ro.disconnect();
  });

  $effect(() => {
    themeTick; // redraw on theme / density
    const deps = [kind, script, ghosts, view.start, view.span, playhead, selection, bins, chapters, w, h];
    if (!w || !h || !deps) return;
    draw();
  });

  const tok = (n) => cssVar(n, cv);
  const rgba = (n, a) => `rgba(${tok(n)}, ${a})`;

  function draw() {
    const dpr = devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const px = (x) => Math.round(x * dpr) / dpr + 0.5 / dpr; // centre of a device pixel
    const hair = 1 / dpr;
    if (kind === 'overview') return overview(g, px, hair);
    const x = (t) => ((t - view.start) / view.span) * w;
    if (kind === 'ruler') return ruler(g, x, px, hair);
    lane(g, x, px, hair);
  }

  function tickStep(span, width) {
    const target = span / (width / 90);
    for (const s of [100, 200, 500, 1000, 2000, 5000, 10_000, 30_000, 60_000]) if (s >= target) return s;
    return 60_000;
  }
  const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${ms % 1000 ? '.' + String(ms % 1000).padStart(3, '0').replace(/0+$/, '') : ''}`;

  function ruler(g, x, px, hair) {
    g.fillStyle = tok('--bg-raised'); g.fillRect(0, 0, w, h);
    const step = tickStep(view.span, w), minor = step / 5;
    g.lineWidth = hair;
    g.font = `${tok('--fs-1')} ${tok('--mono')}`; g.textBaseline = 'top';
    for (let t = Math.ceil(view.start / minor) * minor; t <= view.start + view.span; t += minor) {
      const major = Math.abs(t % step) < 1e-6;
      g.strokeStyle = tok(major ? '--line-4' : '--line-2');
      g.beginPath(); g.moveTo(px(x(t)), major ? 0 : h - 5); g.lineTo(px(x(t)), h); g.stroke();
      if (major) { g.fillStyle = tok('--tx-mut'); g.fillText(fmt(t), Math.round(x(t)) + 4, 3); }
    }
    g.strokeStyle = tok('--line-1'); g.beginPath(); g.moveTo(0, px(h - 1)); g.lineTo(w, px(h - 1)); g.stroke();
    playheadAt(g, px(x(playhead)), hair, true);
  }

  function playheadAt(g, X, hair, cap) {
    g.strokeStyle = tok('--highlight'); g.lineWidth = Math.max(hair, 1);
    g.beginPath(); g.moveTo(X, 0); g.lineTo(X, h); g.stroke();
    if (cap) { g.fillStyle = tok('--highlight'); g.beginPath(); g.moveTo(X - 5, 0); g.lineTo(X + 5, 0); g.lineTo(X, 6); g.closePath(); g.fill(); }
  }

  function lane(g, x, px, hair) {
    const pad = 6, y = (pos) => pad + (1 - pos / 100) * (h - 2 * pad);
    g.fillStyle = tok('--bg-sunken'); g.fillRect(0, 0, w, h);
    g.lineWidth = hair;
    // grid: pos quarters, second ticks
    for (const p of [0, 25, 50, 75, 100]) {
      g.strokeStyle = tok(p === 50 ? '--line-2' : '--line-1');
      g.beginPath(); g.moveTo(0, px(y(p))); g.lineTo(w, px(y(p))); g.stroke();
    }
    const step = tickStep(view.span, w);
    g.strokeStyle = tok('--line-1');
    for (let t = Math.ceil(view.start / step) * step; t <= view.start + view.span; t += step) {
      g.beginPath(); g.moveTo(px(x(t)), 0); g.lineTo(px(x(t)), h); g.stroke();
    }
    const inView = (s) => s.filter((a) => a.at >= view.start - 2000 && a.at <= view.start + view.span + 2000);
    // ghosts first, under the script
    for (const gh of ghosts) {
      g.strokeStyle = tok(`--series-${gh.color}`); g.globalAlpha = 0.85; g.lineWidth = 1.25;
      g.setLineDash(gh.dash || []);
      line(g, inView(gh.script), x, y);
      g.setLineDash([]); g.globalAlpha = 1;
    }
    // selection box
    if (selection) {
      const x0 = x(selection.t0), x1 = x(selection.t1), y0 = y(selection.p1), y1 = y(selection.p0);
      g.fillStyle = rgba('--highlight-rgb', 0.08); g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.strokeStyle = rgba('--highlight-rgb', 0.7); g.lineWidth = hair;
      g.strokeRect(px(x0), px(y0), Math.round(x1 - x0), Math.round(y1 - y0));
    }
    const pts = inView(script);
    g.strokeStyle = tok('--tx-hi'); g.lineWidth = 1.5; g.lineJoin = 'round';
    line(g, pts, x, y);
    // points: hollow squares, selected ones filled with the highlight
    const sel = (a) => selection && a.at >= selection.t0 && a.at <= selection.t1 && a.pos >= selection.p0 && a.pos <= selection.p1;
    const bg = tok('--bg-sunken'), hi = tok('--tx-hi'), hl = tok('--highlight');
    if (view.span / w < 40) for (const a of pts) {
      const X = Math.round(x(a.at)), Y = Math.round(y(a.pos)), s = sel(a);
      g.fillStyle = s ? hl : bg; g.fillRect(X - 3, Y - 3, 6, 6);
      g.strokeStyle = s ? hl : hi; g.lineWidth = 1; g.strokeRect(X - 2.5, Y - 2.5, 5, 5);
    }
    playheadAt(g, px(x(playhead)), hair, false);
    if (label) {
      g.font = `${tok('--fs-1')} ${tok('--mono')}`; g.fillStyle = tok('--tx-mut'); g.textBaseline = 'top';
      g.fillText(label, 6, 4);
    }
  }

  function line(g, pts, x, y) {
    g.beginPath();
    pts.forEach((a, i) => (i ? g.lineTo(x(a.at), y(a.pos)) : g.moveTo(x(a.at), y(a.pos))));
    g.stroke();
  }

  function overview(g, px, hair) {
    const x = (t) => (t / duration) * w, band = 4;
    g.fillStyle = tok('--bg-sunken'); g.fillRect(0, 0, w, h);
    for (const c of chapters) { g.fillStyle = tok(`--series-${c.color}`); g.fillRect(x(c.t0), 0, x(c.t1) - x(c.t0) - 1, band); }
    if (bins) {
      // speed ramp: slow -> fast through five series hues; bar height follows speed too
      const ramp = ['--series-blue', '--series-green', '--series-yellow', '--series-orange', '--series-vermilion'].map(tok);
      const max = 500, bw = w / bins.length;
      for (let i = 0; i < bins.length; i++) {
        const v = Math.min(1, bins[i] / max);
        if (!v) continue;
        g.fillStyle = ramp[Math.min(ramp.length - 1, Math.floor(v * ramp.length))];
        g.globalAlpha = 0.35 + 0.65 * v;
        const bh = Math.max(2, (h - band - 2) * (0.25 + 0.75 * v));
        g.fillRect(i * bw, h - bh, Math.max(1, bw - (bw > 3 ? 1 : 0)), bh);
      }
      g.globalAlpha = 1;
    }
    // the lanes' view window: dim outside, frame inside
    const a = x(view.start), b = x(view.start + view.span);
    g.fillStyle = tok('--scrim'); g.fillRect(0, band, a, h - band); g.fillRect(b, band, w - b, h - band);
    g.strokeStyle = tok('--tx-hi'); g.lineWidth = hair;
    g.strokeRect(px(a), px(band), Math.max(2, Math.round(b - a)), Math.round(h - band - 1));
    playheadAt(g, px(x(playhead)), hair, false);
  }
</script>

<div class="wrap"><canvas bind:this={cv} style:width="{w}px" style:height="{h}px" {...rest}></canvas></div>

<style>
  .wrap { position: relative; flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
  canvas { position: absolute; inset: 0; display: block; }
</style>
