<script>
  // paw-4c48.15: the shaft's data, a band under the shaft strip on the Tracker lane while the owner turns it on (setting
  // 'tracking.shaftData', off by default: off, it is not there and takes no room; the source menu's "Shaft data" row, the command
  // tracking.shaftData). Per run scene of the picked run, from the store's shaftReadings (what the position bar's diamond and
  // the Shaft source read):
  //   the two readings of how much of the shaft is out, 0 (all in) at the bottom .. 1 (all of it out) at the top: the penis
  //   points still visible (green) and SAM's outline length (blue); the one in use drawn bold, the other thin; each solid where
  //   it is sure, faint where not
  //   the in-use reading's depth scale as two dashed levels: "fully out" and "hilted" (the owner's marks when set, else the
  //   largest / smallest lengths that recur with the strokes: lib/shaft.js depthScale)
  //   a thin state strip along the bottom: measured / unsure / held (no geometry of its own: the last placement kept) / none;
  //   the sidecar's own reason for SAM's frames in the tooltip (PROTOCOL v4.50 sem_<name>_why: bound / hidden / few / lost)
  //   hover (a kit tooltip per 6 px): the time, both readings, the value the diamond shows there, the state and why
  // Display only: nothing that makes the script reads it.
  import { xToMs, msToX } from '../../lib/lane.js';
  import { shaftOf, partNames, partWord, railAt, railPos, stateIndex, CONF_MIN, WHY_TEXT } from '../../lib/shaft.js';
  import { lowerBound } from '../../lib/lane.js';
  import { trackingFor } from './tracking.svelte.js';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { paint as tok } from './colors.js';
  import { onThemeChange } from '../../ui/kit/tokens.js';
  import { fmtTime } from '../../lib/funscript.js';
  import { posToY } from '../lanes/geom.js';

  // paw-unuy (the owner: "I'd layer this tbh rather than under"): `layered` = drawn over the combined lane on its pos scale (the
  // in-use reading's hilted level at 0, its fully-out level at 100: the script's axis), translucent, its state strip in the lane's top
  // padding, no words on it: `notes` (per scene; the lane's band shows the one at the playhead) and `cells` (the hover words) go out
  let { app, run, layered = false, bottom = 0, notes = $bindable([]), cells = $bindable([]) } = $props();
  // svelte-ignore state_referenced_locally
  const tr = trackingFor(app);
  let canvas = $state(), w = $state(0), h = $state(0), themeTick = $state(0);
  $effect(() => onThemeChange(() => themeTick++));
  const COL = { points: 'var(--series-green)', sam: 'var(--series-sky)' }, WORD = { points: 'the penis points', sam: "SAM's outline" };
  const word = (n, part) => (part && n === 'points' ? `the ${partWord(part)} points` : WORD[n]);   // paw-4c48.19
  const STATE = { measured: 'var(--series-green)', unsure: 'var(--warn-ink)', held: 'var(--tx-ghost)' }, SH = 4, PAD = 3;
  // paw-unuy: each scene's readings fill the band (their own range and the depth scale's two levels, a little margin), so a thin band
  // is not mostly empty; the 'fully out' / 'hilted' lines say where the scale is
  let sc = [0, 1];
  const unit = (x) => Math.min(1.05, Math.max(-0.05, (x - sc[0]) / (sc[1] - sc[0])));
  const X = (t) => msToX(app.view, w, t), Y = (x) => (layered ? posToY(h, 100 * unit(x)) : PAD + (1 - unit(x)) * (h - SH - 2 * PAD - 1));
  const aspect = () => { const m = app.doc.media; return m?.width && m?.height ? m.width / m.height : 16 / 9; };

  /** A reading's own length on frame i of its rail context (what depthScale reads): the points' share, SAM's visible share. */
  const lenAt = (c, i) => (c?.G ? c.G.L[i] / (c.Lf * (c.G.sc[i] || 1)) : NaN);
  /** Frame i of context c: 'measured' | 'unsure' | 'held'. */
  const stateOf = (c, i) => (!c.G.src[i] ? 'held' : c.conf[i] >= CONF_MIN ? 'measured' : 'unsure');
  const scenes = $derived.by(() => {
    if (!run) return [];
    app.doc.scenes; tr.derivePreview; run.channels; run.shaftSrc; run.partSrc;   // marks, the source, the composed fusion
    const sc = run.scenes?.length ? run.scenes : [{ start_ms: run.range.start, end_ms: run.range.end }];
    // paw-4c48.19: a shot playing a depth part shows that part's readings (shaftReadings follows the shot's source)
    const has = (k) => shaftOf(run, k, { points: true }) || partNames(run).some((p) => shaftOf(run, k, { points: true, part: p }));
    return sc.flatMap((s, k) => (has(k) ? [{ k, t0: Math.max(s.start_ms, run.range.start), t1: Math.min(s.end_ms, run.range.end), R: tr.shaftReadings(run, k) }] : []));
  });
  /** The reason code nearest t (within 60 ms) | NaN. */
  const whyAt = (c, t) => { if (!c?.t?.length) return NaN; const j = Math.min(c.t.length - 1, lowerBound(c.t, t)), k = j > 0 && Math.abs(c.t[j - 1] - t) < Math.abs(c.t[j] - t) ? j - 1 : j, v = c.v[k]; return Math.abs(c.t[k] - t) <= 60 && v != null ? +v : NaN; };
  const sceneAtT = (t) => scenes.find((e) => t >= e.t0 && t < e.t1) || null;

  /** The value range scene e's band shows: its readings and its in-use depth scale (fully out / hilted), 8 % margin. */
  function sceneScale(e, U) {
    let lo = Infinity, hi = -Infinity;
    const take = (v) => { if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } };
    if (U?.G) { take(U.a); take(U.b); }
    for (const n of ['points', 'sam']) { const c = e.R[n]; if (c?.G) for (let i = 0; i < c.G.t.length; i++) take(lenAt(c, i)); }
    if (!(hi - lo > 0.02)) { const m = Number.isFinite(lo) ? (lo + hi) / 2 : 0.5; lo = m - 0.05; hi = m + 0.05; }
    const p = (hi - lo) * 0.08;
    return [lo - p, hi + p];
  }
  let raf = 0;
  $effect(() => { w; h; themeTick; app.view; app.player.timeMs; scenes; if (!raf) raf = requestAnimationFrame(paintIt); });
  $effect(() => () => cancelAnimationFrame(raf));
  function paintIt() {
    raf = 0;
    if (!canvas || !w || !h) return;
    const d = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * d) || canvas.height !== Math.round(h * d)) { canvas.width = Math.round(w * d); canvas.height = Math.round(h * d); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const a = app.view.start, b = a + app.view.span, ghost = tok('var(--tx-ghost)');
    ctx.font = '8px var(--mono, monospace)'; ctx.textBaseline = 'middle';
    for (const e of scenes) {
      if (e.t1 < a || e.t0 > b) continue;
      const x0 = Math.max(0, X(e.t0)), x1 = Math.min(w, X(e.t1)), used = e.R.reading;
      // the in-use reading's depth scale
      const U = used ? e.R[used] : null;
      sc = layered && U?.G && U.b !== U.a ? [U.a, U.b] : sceneScale(e, U);
      if (U?.G && !layered) for (const [v, label] of [[U.b, 'fully out'], [U.a, 'hilted']]) {
        ctx.setLineDash([3, 3]); ctx.strokeStyle = ghost; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, Y(v) + 0.5); ctx.lineTo(x1, Y(v) + 0.5); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = ghost; ctx.textAlign = 'left'; ctx.fillText(label, x0 + 2, Y(v) + (label === 'hilted' ? -4 : 4));
      }
      // the readings: the one in use bold, the other thin; sure solid, unsure faint
      for (const name of used === 'sam' ? ['points', 'sam'] : ['sam', 'points']) {   // the one in use drawn last (on top)
        const c = e.R[name];
        if (!c?.G) continue;
        const T = c.G.t, xs = Array.from(T, X);
        ctx.strokeStyle = tok(COL[name]);
        for (const sure of [false, true]) {
          ctx.lineWidth = name === used ? 2 : 1; ctx.globalAlpha = (layered ? 0.55 : 1) * (sure ? (name === used ? 1 : 0.7) : 0.3); ctx.beginPath();
          let pen = false;
          for (let i = 0; i < T.length; i++) {
            const v = lenAt(c, i), ok = Number.isFinite(v) && c.G.src[i] && (sure ? c.conf[i] >= CONF_MIN : true);
            if (!ok || xs[i] < -4 || xs[i] > w + 4) { pen = false; continue; }
            if (pen) ctx.lineTo(xs[i], Y(v)); else ctx.moveTo(xs[i], Y(v));
            pen = true;
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      // the state strip (the in-use reading's frames; an unsure scene: all unsure)
      const S = U?.G ? U : e.R.ctx?.G ? e.R.ctx : null;
      if (S) {
        const T = S.G.t, xs = Array.from(T, X);
        for (let i = 0; i < T.length; i++) {
          if (xs[i] > w || (xs[i + 1] ?? xs[i] + 2) < 0) continue;
          ctx.fillStyle = tok(STATE[e.R.unsure ? 'unsure' : stateOf(S, i)]);
          ctx.fillRect(xs[i], layered ? 4 : h - SH, Math.max(1, (xs[i + 1] ?? xs[i] + 1) - xs[i]), SH);
        }
      }
      if (layered) continue;   // its words: the lane's band (notes)
      // which reading, at the scene's left
      ctx.textAlign = 'left'; ctx.fillStyle = used ? tok(COL[used]) : tok('var(--warn-ink)');
      ctx.fillText(used ? `${used === 'points' ? 'points' : 'SAM'} in use${Number.isFinite(e.R.q) ? ` · repeats ${e.R.q.toFixed(2)}` : ''}` : 'unsure: neither reading repeats with the strokes', x0 + 2, h - SH - 6);
    }
    const px = X(app.player.timeMs);
    if (!layered && px >= 0 && px <= w) { ctx.fillStyle = tok('var(--highlight)'); ctx.fillRect(Math.round(px), 0, 1, h); }
  }

  // ---- hover: a kit tooltip per 6 px column, with what the diamond shows there ----
  const CELL = 6;
  // layered: the words go out (the lane's band and hover), nothing of this component takes a pointer
  $effect(() => { if (!layered) return; notes = scenes.map((e) => ({ t0: e.t0, t1: e.t1, unsure: !e.R.reading, text: e.R.reading ? `shaft: ${e.R.reading === 'points' ? 'points' : 'SAM'} in use${Number.isFinite(e.R.q) ? ` · repeats ${e.R.q.toFixed(2)}` : ''}` : 'shaft unsure: neither reading repeats with the strokes' })); });
  $effect(() => { if (layered) cells = hov; });
  const hov = $derived.by(() => {
    if (!w || !scenes.length) return [];
    app.view;
    const out = [], A = aspect();
    for (let x = 0; x < w; x += CELL) {
      const t = xToMs(app.view, w, x + CELL / 2), e = sceneAtT(t);
      if (!e) continue;
      const S = e.R.ctx?.G ? e.R.ctx : null, i = S ? stateIndex(S.G, t) : -1;
      if (i < 0) continue;
      const r = railAt(S, t, A), dia = r ? railPos(r, A) : NaN, st = e.R.unsure ? 'unsure' : r?.held ? 'held' : stateOf(S, i);
      const vals = ['points', 'sam'].map((n) => { const c = e.R[n], j = c?.G ? stateIndex(c.G, t) : -1, v = j >= 0 ? lenAt(c, j) : NaN; return `${word(n, e.R.part)} ${Number.isFinite(v) ? Math.round(100 * v) + ' % out' : c?.why ? '(none: ' + c.why + ')' : '–'}`; });
      // paw-4c48.17: the sidecar's own reason for SAM's frame (PROTOCOL v4.50: sem_<name>_why; older runs have none)
      const wc = whyAt(run.channels?.[`sem_${S.name}_why`], t), samWhy = wc > 0 && WHY_TEXT[wc] ? ` · SAM: ${WHY_TEXT[wc]}` : '';
      const why = e.R.unsure ? `neither reading repeats with the strokes here (${e.R.unsure})` : st === 'held' ? 'no geometry of its own here (fewer than 3 penis points tracked): the last placement is kept' : st === 'unsure' ? (e.R.reading === 'points' ? 'the penis points have no fit of their own here' : wc > 0 && WHY_TEXT[wc] ? WHY_TEXT[wc] : `SAM is unsure here (confidence under ${CONF_MIN})`) : '';
      out.push({ x, t: Math.round(t), dia: Number.isFinite(dia) ? +dia.toFixed(1) : null, st,
        text: `${fmtTime(t)} · ${e.R.part ? partWord(e.R.part) + ': ' : ''}${e.R.reading ? `${word(e.R.reading, e.R.part)} in use` : 'unsure'} · ${vals.join(' · ')} · the diamond: ${Number.isFinite(dia) ? Math.round(dia) : '–'} · ${st}${why ? ': ' + why : ''}${e.R.reading !== 'sam' ? samWhy : ''}` });
    }
    return out;
  });
</script>

<div class="shd" class:layered style:bottom={layered ? bottom + 'px' : null} data-testid="shaft-data" bind:clientWidth={w} bind:clientHeight={h} role="img" aria-label="The shaft's readings over the shot: points and SAM, which one is used, measured / held / unsure">
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
  {#each layered ? [] : hov as c (c.x)}<span class="cell" data-t={c.t} data-diamond={c.dia ?? ''} data-state={c.st} style:left="{c.x}px" style:width="{CELL}px" {@attach tooltip({ text: c.text, placement: 'top', delay: 200 })}></span>{/each}
</div>

<style>
  .shd { position: relative; overflow: hidden; background: var(--bg-sunken); border-top: 1px solid var(--line-1); }
  .shd.layered { position: absolute; left: 0; right: 0; top: 0; z-index: 0; background: none; border: 0; pointer-events: none; }   /* over the combined lane, under its pointer canvas's words */
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .cell { position: absolute; top: 0; bottom: 0; }
</style>
