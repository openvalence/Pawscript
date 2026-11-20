<!--
  ProbeLane: a timeline row that draws the probed graph value (P on a node) aligned with app.view, pixel for
  pixel with the lanes (msToX): a script as a polyline (up = out), a signal as its min/max band with NaN gaps
  blank, spans as bars in kind colours, points as ticks. Hover sets the shared time cursor; a click seeks.
-->
<script>
  import { untrack } from 'svelte';
  import { msToX, xToMs } from '../../lib/lane.js';
  import OutOfRange from '../timeline/OutOfRange.svelte';
  import { drawValue, fitCanvas, tok, fmtT, readout } from './editor/plot.js';
  import { valueAt } from '../../lib/graph/types.js';
  import { ctlOf } from './deps.js';
  import { titleOf } from './editor/cards.js';

  let { app, height = 64 } = $props();
  let cv = $state(), w = $state(0);
  const ctl = (() => { try { return ctlOf(untrack(() => app)); } catch { return null; } })();
  const probe = $derived(ctl?.probe ?? null);
  const node = $derived(probe ? ctl.graph?.nodes.find((n) => n.id === probe.node) : null);
  const port = $derived.by(() => {
    if (!node) return null;
    const ps = ctl.registry.portsOf(node, ctl.graph);
    return ps.outs.find((p) => p.name === probe.port) || ps.outs[0] || null;
  });
  const type = $derived(port ? (port.type !== 'any' ? port.type : ctl.program?.types?.get(`${node.id}:${port.name}`) || 'any') : null);
  const value = $derived(port ? ctl.valueOf(node.id, port.name) : undefined);
  let hoverX = $state(null);

  let raf = 0;
  $effect(() => {
    void w; void height; void value; void app.view; void app.player?.timeMs; void ctl?.hoverTime; void hoverX;
    if (!raf) raf = requestAnimationFrame(paint);
    return () => { cancelAnimationFrame(raf); raf = 0; };
  });
  function paint() {
    raf = 0;
    if (!cv || !w) return;
    const ctx = fitCanvas(cv, w, height), v = app.view;
    if (!v) return;
    if (value !== undefined && type) drawValue(ctx, w, height, type, value, v.start, v.start + v.span, { pad: 6, labels: true, dots: true, width: 1.5 });
    const line = (t, color, dash) => {
      const x = msToX(v, w, t) + 0.5;
      if (x < 0 || x > w) return;
      ctx.strokeStyle = color; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); ctx.setLineDash([]);
    };
    if (ctl?.hoverTime != null) line(ctl.hoverTime, tok('--tx-mut'), [2, 2]);
    line(app.player?.timeMs ?? 0, tok('--highlight'), []);
  }
  const hoverT = $derived(hoverX != null && app.view ? xToMs(app.view, w, hoverX) : null);
  const text = $derived(hoverT != null && value !== undefined && type ? readout(type, safe(() => valueAt(type, value, hoverT))) : '');
  function safe(f) { try { return f(); } catch { return null; } }
  function pmove(e) { hoverX = e.offsetX; if (ctl) ctl.hoverTime = xToMs(app.view, w, e.offsetX); }
  function pleave() { hoverX = null; if (ctl) ctl.hoverTime = null; }
</script>

<div class="gprobe" bind:clientWidth={w} style:height={height + 'px'}>
  <canvas bind:this={cv} style:width={w + 'px'} style:height={height + 'px'} aria-label="Graph probe"
          onpointermove={pmove} onpointerleave={pleave} onclick={(e) => app.player?.seek?.(xToMs(app.view, w, e.offsetX))}></canvas>
  <OutOfRange {app} />
  {#if !probe || !node}
    <span class="gprobe-empty">No probe — select a node in the graph and press P</span>
  {:else}
    <span class="gprobe-tag">{titleOf(node, ctl.registry.get(node.type))}.{port?.name}{#if text} · @{fmtT(hoverT)} → {text}{/if}</span>
  {/if}
</div>

<style>
  .gprobe { position: relative; width: 100%; background: var(--bg-sunken); overflow: hidden; }
  canvas { display: block; cursor: crosshair; }
  .gprobe-empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--tx-mut); font-size: var(--fs-1); pointer-events: none; }
  .gprobe-tag { position: absolute; left: 6px; top: 3px; padding: 0 4px; font-size: var(--fs-1); color: var(--tx); background: color-mix(in srgb, var(--bg-sunken) 80%, transparent);
    border-radius: var(--radius); pointer-events: none; font-family: var(--mono); }
</style>
