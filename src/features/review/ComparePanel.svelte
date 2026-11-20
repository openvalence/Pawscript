<script>
  import { tooltip } from '../../ui/kit/tooltip.js';
  import './review.css';
  import { Select, Button, IconButton, SegmentedControl, Section, DataTable, EmptyState, Icon } from '../../ui/kit/index.js';
  import { getReview } from './state.svelte.js';
  import { getCompare } from './compare.svelte.js';
  import { cmd } from '../../app/cmd.js';
  import { grade } from './logic/compare.js';
  import { fmtTime } from '../../lib/funscript.js';
  import { fmtSpan } from '../../lib/time-format.js';
  import { onMount, untrack } from 'svelte';

  let { app } = $props();
  const rv = getReview(app), cmp = getCompare(app);
  onMount(() => cmp.mount());

  let tab = $state('regions');
  const q = $derived(cmp.quick);
  const rows = $derived(cmp.rows);
  const headline = $derived(cmp.score?.overall ?? q);
  const g = $derived(grade(headline?.f1));
  const win = $derived(cmp.window);
  const axisName = $derived(app.doc.activeAxis.charAt(0).toUpperCase() + app.doc.activeAxis.slice(1));

  const secs = (a, b) => `${fmtTime(a)} – ${fmtTime(b)}`;
  const go = (t0, t1) => rv.focusSpan(t0, t1);
  async function copy() { try { await navigator.clipboard.writeText(cmp.asText()); app.toast('Comparison copied', 'ok'); } catch { app.toast('Could not copy', 'error'); } }

  const ghostOptions = $derived(cmp.ghosts.map((gh) => ({ value: gh.id, label: gh.name })));
  const scopeOptions = $derived.by(() => {
    return [{ value: 'all', label: 'Whole script' }, { value: 'range', label: 'Selected range', disabled: !app.doc.range }];   // no chapters (paw-1w0x)
  });
  const pct = (v) => (v == null ? '-' : (v * 100).toFixed(0) + '%');
  // a row click (or the keyboard) shows that span on the timeline
  const goRow = (set, list, key) => { const k = [...set][0], r = list.find((x) => x[key] === k); if (r) go(r.t0, r.t1); };
  // every row in the panel's own scroll (a 10-row box scrolling inside the scrolling panel showed two bars); ponytail: past
  // 200 rows the table scrolls itself again, to keep the DOM small
  const tableH = (n) => `height: calc(var(--row-h) * ${Math.min(n, 200) + 1} + 2px)`;
  const adoptRow = (r) => cmp.adopt(r.t0, r.t1);
  let regSort = $state({ key: 'err', dir: 'desc' });
  // ponytail: the kit's windowRange does not clamp its start to the row count, so a table that shrinks while
  // scrolled past its new end would render a negative window. Pull the scroll back first (drop once the kit clamps).
  let regTable = $state(), missTable = $state(), body = $state();
  $effect.pre(() => {
    for (const [t, n, sel] of [[regTable, cmp.regions.length, 'r'], [missTable, cmp.misses.length, 'm']]) {
      const vp = body?.querySelector(`.tbl[data-t="${sel}"] .k-scroll-viewport`), rh = vp && parseFloat(getComputedStyle(vp).getPropertyValue('--k-rh'));
      if (t && n && rh && vp.scrollTop > (n - 1) * rh) untrack(() => t.scrollToIndex(n - 1));
    }
  });
  // narrow panels drop the secondary column of each table instead of scrolling it sideways
  let panelW = $state(0);
  const narrow = $derived(panelW > 0 && panelW < 300);
  const SCENE_COLS = [
    { key: 'i', label: 'Scene', width: 'minmax(56px, 1fr)', format: (v) => v + 1 },
    { key: 't0', label: 'Span', width: 'minmax(108px, 1fr)', numeric: true, align: 'left', format: (v, r) => fmtSpan(r.t0, r.t1) },
    { key: 'f1', label: 'F1', width: 56, numeric: true, format: pct },
    { key: 'lag_ms', label: 'Lag', width: 72, numeric: true, format: (v) => (v == null ? '-' : Math.round(v) + ' ms') },
  ];
  const sceneCols = $derived(panelW > 0 && panelW < 340 ? SCENE_COLS.slice(0, 3) : SCENE_COLS);
  const MISS_COLS = [
    { key: 'at', label: 'At', width: 88, numeric: true, align: 'left', sortable: true, format: (v) => fmtTime(v) },
    { key: 'what', label: 'What', sortable: true, format: (v, m) => `${m.kind > 0 ? 'Peak' : 'Valley'} ${v === 'extra' ? 'only in yours' : 'missing in yours'}` },
  ];
</script>

{#snippet adoptCell(r)}
  <!-- not a tab stop: Enter (or a double-click) on the row adopts it, so Tab leaves the table in one step -->
  <IconButton size="sm" icon="import" label="Adopt this region" tabindex="-1" onclick={(e) => { e.stopPropagation(); adoptRow(r); }}
    tip="Replace your script with the ghost over {secs(r.t0, r.t1)} (one undo step)" shortcut="Enter" />
{/snippet}

<div class="rv kit-root" bind:clientWidth={panelW}>
  <div class="rv-head">
    <div class="rv-row">
      <Select class="rv-grow" full label="Ghost to compare with" options={ghostOptions} value={cmp.ghost?.id} placeholder="No ghost loaded" disabled={!cmp.ghosts.length} onchange={(v) => (cmp.ghostId = v)} />
      <Select label="Compare over" options={scopeOptions} value={cmp.scope} onchange={(v) => (cmp.scope = v)} />
      <IconButton variant="default" icon="copy" label="Copy as text" onclick={copy} disabled={!q} />
    </div>
    <div class="k-hint">{axisName} against {cmp.ghost?.name ?? 'a reference'} over <span class="k-num">{secs(win[0], win[1])}</span></div>
  </div>

  <div class="rv-body k-scroll" aria-busy={cmp.busy} bind:this={body}>
    {#if !cmp.ghost}
      <EmptyState icon="ghost" title="Nothing to compare with" description="Load a reference funscript as a ghost, or run a tracker, and its numbers show up here." />
    {:else if !q}
      <EmptyState icon="ghost" title="Not enough data" description="Both scripts need points in the chosen span." />
    {:else}
      <Section title="Agreement" count={cmp.score ? 'sidecar score' : 'quick estimate'}>
        <div class="agree">
          <span class="big k-num {g}" aria-label="F1 score">{headline.f1 == null ? '-' : (headline.f1 * 100).toFixed(0) + '%'}</span>
          <span class="k-hint">Turning-point F1: how many extremes of your script land within 150 ms of the reference's.</span>
        </div>
      </Section>

      <Section title="Quick numbers" count="in browser">
        <div class="rv-kv">{#each rows as r (r.key)}<span {@attach tooltip(r.hint)}>{r.label}</span><span class="k-num">{r.value}</span>{/each}</div>
      </Section>

      <Section title="Full score">
        <div class="score-run">
          <span class="k-hint">{cmp.score ? 'Sign, lag and per-scene detail from the sidecar scorer.' : cmp.sidecarReady ? 'Run it for the exact scorer with sign detection, lag and a per-scene breakdown.' : 'Needs the tracking sidecar (not running).'}</span>
          <Button size="sm" icon="play" loading={cmp.scoreBusy} disabled={!cmp.sidecarReady} onclick={() => cmp.runScore()}
            tip={cmp.sidecarReady ? 'Score with the tracker: sign, lag and per-scene detail' : 'The tracker is not available'}>{cmp.score ? 'Run again' : 'Run'}</Button>
        </div>
        {#if cmp.scoreErr}<div class="rv-err" role="alert"><Icon name="error" size={14} />{cmp.scoreErr}</div>
        {:else if cmp.score}
          <div class="rv-kv">{#each cmp.scoreRows as r (r.key)}<span {@attach tooltip(r.hint)}>{r.label}</span><span class="k-num">{r.value}</span>{/each}</div>
          {#if cmp.scenes.length}
            <DataTable class="tbl" label="Scenes" columns={sceneCols} rows={cmp.scenes} rowKey="i" multiple={false} onselect={(set) => goRow(set, cmp.scenes, 'i')} style={tableH(cmp.scenes.length)} />
          {/if}
        {/if}
      </Section>

      <Section title="Differences">
        <SegmentedControl size="sm" full label="Difference view" bind:value={tab}
          options={[{ value: 'regions', label: `Regions ${cmp.regions.length}` }, { value: 'extremes', label: `Extremes ${cmp.misses.length}` }]} />
        {#if tab === 'regions'}
          {#if !cmp.regions.length}<div class="k-hint gap">No window differs by more than a few units.</div>
          {:else}
            <DataTable bind:this={regTable} class="tbl" data-t="r" label="Regions that differ, Enter adopts the ghost there" rows={cmp.regions} rowKey="t0" multiple={false} bind:sort={regSort}
              onselect={(set) => goRow(set, cmp.regions, 't0')} onactivate={adoptRow} style={tableH(cmp.regions.length)}
              columns={[
                { key: 't0', label: 'From', width: 'minmax(72px, 1fr)', numeric: true, align: 'left', sortable: true, format: (v) => fmtTime(v) },
                { key: 'err', label: 'Mean', width: 72, numeric: true, sortable: true, format: (v) => v.toFixed(0) },
                ...(narrow ? [] : [{ key: 'peak', label: 'Peak', width: 72, numeric: true, sortable: true, format: (v) => v.toFixed(0) }]),
                { key: 'adopt', label: '', width: 36, align: 'center', cell: adoptCell },
              ]} />
          {/if}
        {:else if !cmp.misses.length}<div class="k-hint gap">Every extreme is matched.</div>
        {:else}
          <DataTable bind:this={missTable} class="tbl" data-t="m" label="Unmatched extremes" columns={MISS_COLS} rows={cmp.misses} multiple={false} onselect={(set) => goRow(set, cmp.misses, 'id')} style={tableH(cmp.misses.length)} />
        {/if}
      </Section>
    {/if}
  </div>

  <div class="rv-foot">
    <Button size="sm" icon="import" disabled={!app.doc.range || !cmp.ghost} onclick={() => cmp.adopt(app.doc.range.t0, app.doc.range.t1)} tip="Take the ghost over the selected range (one undo step)">Adopt in range</Button>
    <Button size="sm" variant="ghost" icon="eraser" {...cmd(app, 'review.compareClear', undefined, { tip: 'Remove the difference markers from the timeline' })}>Clear markers</Button>
  </div>
</div>

<style>
  .agree { display: flex; align-items: center; gap: var(--space-5); }
  .big { flex: none; font-size: var(--fs-7); line-height: 1; color: var(--tx-hi); }
  .big.good { color: var(--ok-ink); }
  .big.fair { color: var(--warn-ink); }
  .big.poor { color: var(--bad-ink); }
  .big.none { color: var(--tx-mut); }
  .score-run { display: flex; align-items: center; gap: var(--space-4); margin-bottom: var(--space-3); }
  .score-run .k-hint { flex: 1; min-width: 0; }
  .rv :global(.tbl) { margin-top: var(--space-4); }
  .gap { margin-top: var(--space-4); }
</style>
