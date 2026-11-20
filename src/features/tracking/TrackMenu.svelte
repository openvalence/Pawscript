<script module>
  /** paw-unuy: the Track button's tooltip, one line: what it tracks with (the grid's tracker and its points), then how to change it. */
  export function trackTip(tr, gridPts, what = 'the selection') {
    const g = tr?.gridTracker;
    return `Track ${what}: ${g ? g.name.replace(/\s*\(.*\)$/, '') : 'no point tracker'} · ${gridPts} pts, a point grid over the whole frame (painted groups ride along) · ▾ or right-click: the tracker's settings`;
  }
</script>

<script>
  // The tracker's settings (paw-unuy, the owner of the tracker chip: "move this into a right click menu here"): what the chip showed
  // (the tracker and its mode, the points, the signal, a running job) and what it reached (Cancel, the Tracker panel), plus the
  // settings it only named: Track's grid points and the tracker's own params (the model input size, points per group, ...: their
  // ParamForm editors, as in the Tracker panel). Opened from the ▾ beside Track and by right-click on Track / Track ROI
  // (timeline/SceneChips.svelte). `compact`: the toolbar has no room for Groups / Track ROI, so they are here too.
  import Select from '../../ui/kit/Select.svelte';
  import Prop from '../../app/Prop.svelte';
  import Button from '../../ui/kit/Button.svelte';
  import IconButton from '../../ui/kit/IconButton.svelte';
  import ParamForm from '../../ui/kit/ParamForm.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { trackerSchemaOf } from './tracker-schema.js';
  import { trackerOptions } from '../timeline/quickbar.js';
  import { cmd } from '../../app/cmd.js';

  let { app, tr, sig = '', busy = false, compact = false, onroi, ongroups, groupsTip = '' } = $props();
  const t = $derived(tr.tracker);
  const schema = $derived(trackerSchemaOf(t, tr.hasAxis?.(t)));
  const gridPts = $derived(Math.round(+app.settings.get('tracking.gridPoints', 512)) || 512);
  const GRID_TIP = 'Points of Track (T): the grid over the whole frame; more points follow small parts better and cost VRAM (TAPNext++ 512 px with 1024 points is about 12.7 GB)';
</script>

<div class="tm" data-testid="track-menu">
  {#if compact}
    <div class="row">
      <Button size="sm" icon="brush" onclick={ongroups} tip={groupsTip}>Groups</Button>
      <Button size="sm" icon="crosshair" {...cmd(app, 'track.run', undefined, { tip: 'Track ROI: one painted part; several: pick one', before: onroi })}>Track ROI</Button>
    </div>
  {/if}
  <div class="row"><span class="lbl" {@attach tooltip('Track ROI uses it if it takes a box (else SAM)')}>Tracker</span>
    <span class="sel"><Select size="sm" full label="Tracker" placeholder={tr.listed ? 'Tracker' : 'Trackers…'} options={trackerOptions(tr.trackers, (t) => tr.gpuOff?.(t))} value={tr.trackerId} disabled={!!tr.busy} onchange={(v) => tr.selectTracker(v)} /></span>
    {#if tr.listed}<IconButton icon="refresh" size="sm" label="Reload the tracker list" {...cmd(app, 'track.listTrackers', undefined, { tip: 'Reload the tracker list' })} />{/if}
  </div>
  {#if tr.gpuNote}<p class="k-hint gpu" data-testid="track-menu-gpu-note">{tr.gpuNote}</p>{/if}
  <div class="row"><span class="lbl" {@attach tooltip(GRID_TIP)}>Points</span>
    <Prop {app} key="tracking.gridPoints" label="Track: grid points" tip={GRID_TIP} data-testid="track-points" />
    <span class="k-hint grow">Track's grid{tr.gridTracker ? ` · ${tr.gridTracker.name.replace(/\s*\(.*\)$/, '')}` : ''}</span>
  </div>
  <div class="row"><span class="lbl">Signal</span><span class="k-hint num grow">{sig || '–'}{busy ? ` · ${tr.progressLabel}` : ''}</span>
    {#if tr.busy === 'track'}<Button size="sm" variant="ghost" icon="stop" {...cmd(app, 'track.cancel', undefined, { tip: 'Stop the running track' })}>Cancel</Button>{/if}
  </div>
  {#if t && schema.length}
    <div class="form">{#key t.id}<ParamForm {schema} groupsOpen={false} values={tr.paramsBy[t.id]} onchange={(v) => Object.assign(tr.paramsBy[t.id], v)} />{/key}</div>
  {/if}
  <Button size="sm" variant="ghost" icon="sliders" onclick={() => app.showPanel?.('tracking')} tip="Runs, track options, ROI and stroke axis">Tracker panel</Button>
</div>

<style>
  .tm { display: grid; gap: var(--space-2); width: 320px; max-height: min(70vh, 560px); overflow: auto; }
  .row { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
  /* the parameter labels' voice (ParamForm .kit-pf-label): one label style in the popover (paw-p8o2) */
  .lbl { width: 4.5em; flex: none; font-size: var(--fs-2); font-weight: 500; line-height: var(--lh-tight); letter-spacing: .04em;
    color: var(--tx-mut); text-transform: var(--label-case); cursor: help; }
  .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sel { flex: 1; min-width: 0; }
  .gpu { margin: 0; color: var(--tx-val); }
  .form { border-top: var(--bw) solid var(--line-1); padding-top: var(--space-2); }
</style>
