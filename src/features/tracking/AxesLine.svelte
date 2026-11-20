<script>
  // paw-2pcf: the shot's secondary axes in one line (the Shot popover, tracking/axes-derive.js shotAxes): the view the
  // picture is read from, then per axis a tiny meter: filled = measured, hollow = an estimate (weak), a dash = no data
  // (the lane stays as it is); its width is the confidence. Hover: what it was measured from. Click a meter: that axis
  // the other way round in this shot (one undo step; the ghost re-derives). Then the actions it needs: Derive (a run with
  // no axes yet), Show lanes (data on an axis with no lane: a lane plays its axis live, paw-x7w7).
  import Button from '../../ui/kit/Button.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { SECONDARY } from '../../lib/six-axis.js';
  import { shotAxes, deriveCommand, addLanesCommand, flipAxisCommand, frameWords } from './axes-derive.js';

  let { app, tr, shot } = $props();
  const info = $derived((void app.doc.ghosts, void app.doc.axes, void tr.scenes, shot >= 0 ? shotAxes(app, tr, shot) : null));
  const any = $derived(!!info && SECONDARY.some((a) => info.axes[a].label !== 'none'));
  const viewText = $derived(!info ? '' : info.pov && info.view === 'top' ? 'POV' : info.guessed ? 'side?' : info.view);
  const viewTip = $derived(!info ? '' : info.guessed ? 'No angle on this shot: read as a side view, so every axis is an estimate at most. Pick side / rear / front / top above'
    : info.pov ? (info.frame ? 'A POV shot of one character: read like a rear view (it faces or backs the camera)' : 'A POV shot: read like a view from above (the stroke runs into the picture)') : `Read as a ${info.view} view (the Angle chips above)`);
  const tipOf = (a, x) => `${a}: ${x.label === 'none' ? 'no data here (the lane stays as it is)' : `${x.label} (confidence ${Math.round(100 * x.conf)} %, up to ±${x.amp}) from ${x.from}`}${x.sides ? ` · which way is + comes from the painted sides (the ${info?.frame ? 'character' : 'Bottom'}’s own left / right)` : ''}${x.flipped ? ' · flipped in this shot' : ''} · click: ${a} the other way round in this shot`;
  // paw-jyde.11: a solo reading says what it is measured against (the pair's words say "relative to the Top" in each meter's tip)
  const frameTip = $derived(info?.frame ? frameWords(info.frame) : '');
  const short = { surge: 'L1', sway: 'L2', twist: 'R0', roll: 'R1', pitch: 'R2' };
</script>

{#if info}
  <div class="ax" role="group" aria-label="Secondary axes of this shot">
    <span class="view" {@attach tooltip(viewTip)}>{viewText}</span>
    {#if info.frame}<span class="view vs" class:guess={info.frame.refGuess || info.frame.camLeak || info.frame.facing} data-testid="axes-vs-frame" {@attach tooltip(frameTip)}>vs frame</span>{/if}
    {#each SECONDARY as a (a)}
      {@const x = info.axes[a]}
      <button type="button" class="m {x.label}" class:flip={x.flipped} aria-pressed={x.flipped} aria-label="{a}: {x.label}" data-axis={a} data-label={x.label}
        onclick={() => flipAxisCommand(app, tr, a, shot)} {@attach tooltip(tipOf(a, x))}>
        <span class="nm">{a}<small>{short[a]}</small></span>
        <span class="bar">{#if x.label !== 'none'}<i style:width="{Math.max(12, Math.round(100 * x.conf))}%"></i>{:else}–{/if}</span>
      </button>
    {/each}
    {#if !any && tr.runs.length}<Button size="sm" variant="ghost" onclick={() => deriveCommand(app, tr)} tip="Measure the secondary axes from the run">Derive axes</Button>{/if}
    {#if info.missing.length}<Button size="sm" variant="ghost" onclick={() => addLanesCommand(app)} tip="Add the lanes of the axes that have data here ({info.missing.join(', ')}), to play them live and edit them">Show lanes</Button>{/if}
  </div>
{/if}

<style>
  .ax { display: flex; align-items: center; gap: var(--space-1); flex-wrap: wrap; font-size: var(--fs-1); color: var(--tx-val); }
  .view { padding: 0 var(--space-2); border: var(--bw) solid var(--line-2); border-radius: var(--radius); color: var(--tx-hi); }
  .vs.guess { border-style: dashed; color: var(--tx-val); }
  .m { display: inline-flex; align-items: center; gap: var(--space-1); height: var(--ctl-h-sm, 22px); padding: 0 var(--space-2); font: inherit; color: inherit; background: none; border: var(--bw) solid transparent; border-radius: var(--radius); cursor: pointer; }
  .m:hover { border-color: var(--line-4); }
  .m.flip { border-color: var(--sel-line); }
  .nm small { margin-left: 2px; color: var(--tx-mut); font-size: 0.85em; }
  .bar { display: inline-block; width: 22px; height: 6px; border-radius: var(--radius-pill); background: var(--bg-sunken); overflow: hidden; color: var(--tx-mut); line-height: 6px; text-align: center; }
  .bar i { display: block; height: 100%; background: var(--reality, var(--tx-hi)); }
  .m.estimate .bar i { background: none; box-shadow: inset 0 0 0 1px var(--reality, var(--tx-hi)); }
  .m.none { color: var(--tx-mut); }
  .m.none .bar { background: none; }
</style>
