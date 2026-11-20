<!-- TrackPlanDialog: Track › Track tagged scenes… (modal.js). The plan read from the scene tags (lib/track-plan.js): one
     row per item (scenes + tags, in–out, action, tracker / ROI / signal, why), "Go there" on a row that needs a box,
     a force re-track switch, Run (tracking.svelte.js runPlanned). Kit only. -->
<script>
  import { Dialog, Button, Switch, Badge } from '../../ui/kit/index.js';
  import { trackingFor } from './tracking.svelte.js';
  import { planSummary } from '../../lib/track-plan.js';
  import { sceneTags, tagLabel } from '../timeline/acts.js';
  import { fmtSpanTime } from '../../lib/time-format.js';

  let { app } = $props();
  const tr = trackingFor(app);
  const plan = $derived(tr.planOpen ? tr.plan({ force: tr.planForce }) : []);
  const live = $derived(tr.planOpen ? tr.liveScenes() : []);
  const nTrack = $derived(plan.filter((x) => x.action === 'track').length);
  const ACTION = { track: ['Track', 'accent'], skip: ['Skip', 'neutral'], 'needs-roi': ['Needs a box', 'warn'], done: ['Done', 'ok'] };
  const t = fmtSpanTime;
  const tags = (it) => [...new Set(it.sceneIdx.flatMap((i) => sceneTags(live[i])))].map(tagLabel).join(', ');
  const trackerName = (it) => it.name || tr.trackers.find((x) => x.id === it.tracker)?.name || it.tracker || '—';
  const roiText = (it) => {
    const k = tr.trackers.find((x) => x.id === it.tracker)?.roi;
    return k === 'none' ? 'no ROI' : !it.roi ? 'no ROI yet' : it.roi.kind === 'box' ? 'box' : `${it.roi.points.length} points`;
  };
  const detail = (it) => [trackerName(it), roiText(it), it.signal && `signal ${it.signal}`, it.segments.length > 1 && `${it.segments.length} runs`].filter(Boolean).join(' · ');
  const block = $derived(!tr.listed ? 'The trackers are not loaded yet.' : tr.locked ? 'A tracker job is running.' : !nTrack ? 'Nothing to track.' : '');
</script>

<Dialog bind:open={tr.planOpen} title="Track tagged scenes" size="lg">
  <p class="lead">From the scene tags: off-screen scenes are skipped (the bridge fills them from the scenes around them),
    internal views track with SAM area, scenes that continue each other are one item. Everything else uses the panel's
    tracker and ROI. Scenes that already have a run are done.</p>
  <div class="opts"><Switch bind:checked={tr.planForce} label="Force re-track (done scenes too)" /></div>
  {#if !plan.length}
    <p class="line">No video length or scenes to plan over yet.</p>
  {:else}
    <ul class="rows">
      {#each plan as it (it.label + it.action + it.t0)}
        <li class="row" data-action={it.action}>
          <div class="main">
            <div class="title"><span class="name">{it.label}</span><span class="k-num when">{t(it.t0)}–{t(it.t1)}</span>
              <Badge tone={ACTION[it.action][1]}>{ACTION[it.action][0]}</Badge></div>
            {#if tags(it)}<div class="note">{tags(it)}</div>{/if}
            {#if it.action === 'track' || it.action === 'needs-roi'}
              <div class="note">{detail(it)}</div>
            {/if}
            {#if it.reason}<div class="note why">{it.reason}</div>{/if}
          </div>
          {#if it.action === 'needs-roi'}<Button size="sm" onclick={() => tr.goToItem(it)}>Go there</Button>{/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#snippet footer({ close })}
    <span class="sum">{planSummary(plan)}</span>
    <Button onclick={() => close('cancel')}>Close</Button>
    <Button variant="primary" disabled={!!block} tip={block} onclick={() => tr.runPlanned(plan)}>{nTrack ? `Run ${nTrack}` : 'Run'}</Button>
  {/snippet}
</Dialog>

<style>
  .lead { margin: 0 0 var(--space-4); color: var(--tx-mut); font-size: var(--fs-2); line-height: var(--lh); }
  .opts { margin: 0 0 var(--space-4); }
  .line { margin: var(--space-3) 0 0; font-size: var(--fs-2); }
  .rows { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line-1); max-height: 52vh; overflow-y: auto; }
  .row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-4); align-items: center; padding: var(--space-3) var(--space-2); border-bottom: 1px solid var(--line-1); }
  .row[data-action='skip'], .row[data-action='done'] { color: var(--tx-mut); }
  .main { min-width: 0; display: grid; gap: var(--space-1); }
  .title { display: flex; align-items: center; gap: var(--space-4); min-height: var(--ctl-h-sm); }
  .name { color: var(--tx-hi); font-size: var(--fs-3); white-space: nowrap; }
  .row[data-action='skip'] .name, .row[data-action='done'] .name { color: var(--tx); }
  .when { color: var(--tx-mut); font-size: var(--fs-1); }
  .note { color: var(--tx-mut); font-size: var(--fs-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row[data-action='needs-roi'] .why { color: var(--warn-ink); }
  .sum { margin-right: auto; color: var(--tx-mut); font-size: var(--fs-2); align-self: center; }
</style>
