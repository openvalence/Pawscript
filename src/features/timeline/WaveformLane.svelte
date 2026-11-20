<script>
  // Audio waveform strip: mirrored min/max per pixel column from the video feature's pyramid (deps.js).
  // Columns are recomputed only when the pyramid / view / width change; the playhead is a DOM overlay.
  import CanvasLane from './CanvasLane.svelte';
  import { theme, drawRange, drawCuts, drawHint } from './draw.js';
  import { scenesOf } from './state.svelte.js';
  import { boundaryTimes } from './shots.js';
  import { loadWaveform, wavePeaks } from './deps.js';
  import { pyramidPeak } from './wave-logic.js';

  let { app } = $props();
  let pyr = $state(null), msg = $state(''), detail = $state('');   // msg: '' = ok, else the muted one-line hint; detail: for the hover text
  const path = $derived(app.doc.media?.path);
  // The row itself is hidden by its registration (lane.js visible: media.hasAudio !== false); here only a muted hint.
  const none = (hint, why) => { pyr = null; msg = hint; detail = why; };

  $effect(() => {
    const p = path;
    pyr = null; detail = '';
    if (!p) { none('No audio', 'No media loaded'); return; }
    if (!loadWaveform || !wavePeaks) { none('No audio', 'Waveform service unavailable'); return; }
    msg = 'Loading audio…';
    const ac = new AbortController();
    loadWaveform({ url: app.backend.mediaUrl(p), path: p, backend: app.backend, signal: ac.signal }).then((r) => {
      if (ac.signal.aborted) return;
      if (r?.levels) { pyr = r; msg = ''; }
      else none('No audio', r?.error || 'No audio track');
    });
    return () => ac.abort();
  });
  // dev/test hook: inject a pyramid (no media with audio needed)
  if (typeof window !== 'undefined') window.__tlSetWave = (p) => { pyr = p; msg = p ? '' : 'No audio'; };

  let memo = { pyr: null, start: NaN, span: NaN, w: 0, cols: null }, norm = 1, normOf = null;
  function paint(ctx, w, h) {
    const T = theme(), v = app.view;
    ctx.clearRect(0, 0, w, h);
    drawRange(ctx, v, w, h, app.doc.range);
    const B = boundaryTimes(scenesOf(app));   // paw-p2p0: lines at the cuts, none at a camera move
    if (!pyr) { drawHint(ctx, h, msg); return; }
    if (memo.pyr !== pyr || memo.start !== v.start || memo.span !== v.span || memo.w !== w) {
      memo = { pyr, start: v.start, span: v.span, w, cols: wavePeaks(pyr, v.start, v.start + v.span, w) };
    }
    if (normOf !== pyr) { norm = pyramidPeak(pyr); normOf = pyr; }
    const { min, max } = memo.cols, mid = h / 2, amp = (h / 2 - 2) / norm;
    ctx.fillStyle = T.reality; ctx.globalAlpha = 0.42;
    for (let c = 0; c < w; c++) {
      const top = mid - max[c] * amp, bot = mid - min[c] * amp;
      ctx.fillRect(c, Math.min(top, mid - 0.5), 1, Math.max(1, bot - top));
    }
    ctx.fillStyle = T.reality; ctx.globalAlpha = 0.9;   // brighter core
    for (let c = 0; c < w; c++) {
      const top = mid - max[c] * amp * 0.5, bot = mid - min[c] * amp * 0.5;
      if (bot - top > 1) ctx.fillRect(c, top, 1, bot - top);
    }
    ctx.globalAlpha = 0.12; drawCuts(ctx, v, w, h, B.cuts, T.txHi); ctx.globalAlpha = 1;
  }
</script>

<CanvasLane {app} lane="waveform" {paint} label="Audio waveform" tag={pyr ? 'Audio' : null} hoverText={() => detail || null} />
