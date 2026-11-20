<script module>
  /** paw-unuy: the Track button's tooltip, one line: what it tracks with (the grid's tracker and its points), then how to change it. */
  export const trackerShort = (t) => (t ? t.name.replace(/\s*\(.*\)$/, '').replace(/\s+(points|mask)$/i, '') : '');
  export function trackTip(tr, gridPts, what = 'the selection') {
    const g = tr?.gridTracker;
    return `Track ${what} with ${g ? trackerShort(g) : 'no point tracker'} · ${gridPts} pts, a point grid over the whole frame (painted groups ride along) · cog: settings`;
  }
  /** paw-bunr: the Track ROI button's tooltip: names its tracker. */
  export const roiTip = (tr, what = '') => `Track ROI${what ? ' ' + what : ''} with ${trackerShort(tr?.partTracker) || 'no tracker'}: one painted part; several: pick one`;
</script>

<script>
  // The tracker's settings (paw-unuy), paw-bunr: two sections, each headed with its button's icon, name and key: Track (T, always
  // TAPNext++: the grid points and its params) and Track ROI (Ctrl+T, always SAM: its params, the model size). No tracker picks
  // here: the Tracker panel's pick is for the custom tracks (right-click on either button). Then the signal, Cancel and the
  // Tracker panel. Opened from the cog beside Track (timeline/SceneChips.svelte). `compact`: the toolbar has no room for Groups / Track ROI, so they are here too.
  import Icon from '../../ui/kit/Icon.svelte';
  import Prop from '../../app/Prop.svelte';
  import Button from '../../ui/kit/Button.svelte';
  import ParamForm from '../../ui/kit/ParamForm.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { trackerSchemaOf } from './tracker-schema.js';
  import { fmtKeys } from '../../app/keymap.js';
  import { cmd } from '../../app/cmd.js';

  let { app, tr, sig = '', busy = false, compact = false, onroi, ongroups, groupsTip = '' } = $props();
  const g = $derived(tr.gridTracker), p = $derived(tr.partTracker);
  const sections = $derived([['grid', 'Track', 'track.gridFrame', g], ['crosshair', 'Track ROI', 'track.run', p]]);
  const keyOf = (id) => { const k = app.commands.keysFor?.(id)?.[0]; return k ? ` (${fmtKeys(k)})` : ''; };
  const gridPts = $derived(Math.round(+app.settings.get('tracking.gridPoints', 512)) || 512);
  const GRID_TIP = 'Points of Track (T): the grid over the whole frame; more points follow small parts better and cost VRAM (TAPNext++ 512 px with 1024 points is about 12.7 GB)';
</script>

<div class="tm" data-testid="track-menu">
  {#if compact}
    <div class="row">
      <Button size="sm" icon="brush" onclick={ongroups} tip={groupsTip}>Groups</Button>
      <Button size="sm" icon="crosshair" {...cmd(app, 'track.run', undefined, { tip: roiTip(tr), before: onroi })}>Track ROI</Button>
    </div>
  {/if}
  {#if tr.gpuNote}<p class="k-hint gpu" data-testid="track-menu-gpu-note">{tr.gpuNote}</p>{/if}
  {#each sections as [icon, name, id, t] (id)}
    <div class="sec" data-testid="track-menu-{id}">
      <div class="head"><Icon name={icon} size={14} /><b>{name}{keyOf(id)}</b><span class="k-hint">· {trackerShort(t) || 'no tracker'}</span></div>
      {#if id === 'track.gridFrame'}
        <div class="row"><span class="lbl" {@attach tooltip(GRID_TIP)}>Points</span>
          <Prop {app} key="tracking.gridPoints" label="Track: grid points" tip={GRID_TIP} data-testid="track-points" />
        </div>
      {/if}
      {#if t?.params?.length && trackerSchemaOf(t, tr.hasAxis?.(t)).length}
        <div class="form">{#key t.id}<ParamForm schema={trackerSchemaOf(t, tr.hasAxis?.(t))} groupsOpen={false} values={tr.paramsBy[t.id]} onchange={(v) => Object.assign(tr.paramsBy[t.id], v)} />{/key}</div>
      {/if}
    </div>
  {/each}
  <div class="row"><span class="lbl">Signal</span><span class="k-hint num grow">{sig || '–'}{busy ? ` · ${tr.progressLabel}` : ''}</span>
    {#if tr.busy === 'track'}<Button size="sm" variant="ghost" icon="stop" {...cmd(app, 'track.cancel', undefined, { tip: 'Stop the running track' })}>Cancel</Button>{/if}
  </div>
  <Button size="sm" variant="ghost" icon="sliders" onclick={() => app.showPanel?.('tracking')} tip="Runs, track options, ROI and stroke axis">Tracker panel</Button>
</div>

<style>
  .tm { display: grid; gap: var(--space-2); width: 320px; max-height: min(70vh, 560px); overflow: auto; }
  .row { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
  /* the parameter labels' voice (ParamForm .kit-pf-label): one label style in the popover (paw-p8o2) */
  .lbl { width: 4.5em; flex: none; font-size: var(--fs-2); font-weight: 500; line-height: var(--lh-tight); letter-spacing: .04em;
    color: var(--tx-mut); text-transform: var(--label-case); cursor: help; }
  .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sec { display: grid; gap: var(--space-2); }
  .head { display: flex; align-items: center; gap: var(--space-2); font-size: var(--fs-2); }
  .gpu { margin: 0; color: var(--tx-val); }
  .form { border-top: var(--bw) solid var(--line-1); padding-top: var(--space-2); }
</style>
