<script>
  import { tooltip } from '../../ui/kit/tooltip.js';
  import './review.css';
  import { Select, TextField, IconButton, Button, ToggleButton, VirtualList, EmptyState, Icon, Menu, cssVar, onThemeChange } from '../../ui/kit/index.js';
  import { untrack, tick } from 'svelte';
  import { getReview } from './state.svelte.js';
  import { fmtTime } from '../../lib/funscript.js';
  import { SEVERITIES, kindLabel } from './logic/problems.js';

  let { app } = $props();
  const rv = getReview(app);
  const SEV = { error: { label: 'Errors', icon: 'error' }, warn: { label: 'Warnings', icon: 'warning' }, info: { label: 'Notes', icon: 'info' } };
  const SORTS = [{ value: 'time', label: 'By time' }, { value: 'severity', label: 'By severity' }, { value: 'kind', label: 'By kind' }, { value: 'length', label: 'By length' }];

  let root = $state(), list = $state(), rowH = $state(48);
  // two lines per problem: twice the density's row height
  $effect(() => { if (!root) return; const read = () => (rowH = 2 * (parseFloat(cssVar('--row-h', root)) || 24)); read(); return onThemeChange(read); });

  const rows = $derived(rv.visible);
  const selIndex = $derived(rv.selectedId ? rows.findIndex((p) => p.id === rv.selectedId) : -1);
  const selKind = $derived(rv.current?.kind ?? (rv.filter.kinds.length === 1 ? rv.filter.kinds[0] : null));
  const selKindFixable = $derived(selKind ? rv.problems.filter((p) => p.kind === selKind && rv.canFix(p) && !rv.isIgnored(p)).length : 0);
  const ignoredCount = $derived(rv.problems.length - rv.counts.total);
  const kindOptions = $derived([{ value: '', label: 'All kinds' }, ...rv.kinds.map((k) => ({ value: k, label: kindLabel(k), hint: String(rv.counts.kinds[k] ?? 0) }))]);
  const filtered = $derived(!!rv.filter.q.trim() || rv.filter.kinds.length > 0 || rv.filter.severities.length < SEVERITIES.length);
  const clearFilters = () => Object.assign(rv.filter, { q: '', kinds: [], severities: [...SEVERITIES] });

  // sort order and check scope live in one menu: the head keeps to search, severity and kind
  let menuOpen = $state(false), menuAnchor = $state();
  const sortLabel = $derived(SORTS.find((o) => o.value === rv.filter.sort)?.label ?? '');
  const menuItems = $derived([
    { section: 'Sort' },
    ...SORTS.map((o) => ({ id: 'sort-' + o.value, label: o.label, type: 'radio', checked: rv.filter.sort === o.value, run: () => (rv.filter.sort = o.value) })),
    { id: 'reverse', label: 'Reverse order', type: 'checkbox', checked: rv.filter.dir < 0, run: () => (rv.filter.dir = -rv.filter.dir) },
    { separator: true },
    { section: 'Check' },
    { id: 'scope-active', label: 'Active axis', type: 'radio', checked: rv.scope === 'active', run: () => rv.setScope('active') },
    { id: 'scope-all', label: 'All axes', type: 'radio', checked: rv.scope === 'all', run: () => rv.setScope('all') },
  ]);

  function toggleSev(s, on) { rv.filter.severities = on ? [...rv.filter.severities, s] : rv.filter.severities.filter((x) => x !== s); }
  // keep the selected row in view when the selection changes from elsewhere (F8, the timeline)
  $effect(() => { const i = selIndex; if (i >= 0) list?.scrollToIndex(i); });
  // ponytail: the kit's windowRange does not clamp its start to the row count, so a list that shrinks while scrolled
  // past its new end would render a negative window. Pull the scroll back first (drop once the kit clamps).
  $effect.pre(() => {
    const n = rows.length, vp = root?.querySelector('.plist .k-scroll-viewport');
    if (n && vp && vp.scrollTop > (n - 1) * rowH) untrack(() => list?.scrollToIndex(n - 1));
  });

  // Row actions are rendered for the selected and the hovered row only: rows stay cheap while scrolling 100 000
  // actions' worth of problems, and Tab from the list lands on the selected row's buttons.
  let hoverIndex = $state(-1);
  const onHover = (e) => { const r = e.target.closest?.('[data-index]'); hoverIndex = r ? +r.dataset.index : -1; };

  const dur = (p) => (p.t1 - p.t0 >= 100 ? `${((p.t1 - p.t0) / 1000).toFixed(1)} s` : '');
  // the row unmounts once its problem is fixed or ignored: hand focus back to the list so arrows and Tab keep working
  async function act(fn) { fn(); await tick(); (root?.querySelector('[role=listbox]') ?? root?.querySelector('input'))?.focus(); }
  // row buttons act on their own row: keep their clicks and keys from selecting / activating the row
  const own = (fn) => (e) => { e.stopPropagation(); fn(); };
  const keep = (e) => e.stopPropagation();
</script>

<div class="rv kit-root" bind:this={root}>
  <div class="rv-head">
    <div class="rv-row">
      <TextField class="rv-grow" full icon="search" clearable placeholder="Search problems" label="Search problems" bind:value={rv.filter.q} />
      <div class="sevs" role="group" aria-label="Severity filter">
        {#each SEVERITIES as s (s)}
          <ToggleButton variant="default" class="sev" pressed={rv.filter.severities.includes(s)} onchange={(on) => toggleSev(s, on)}
            aria-label="{SEV[s].label}, {rv.counts[s]}" tip="{SEV[s].label}: show or hide">
            <Icon name={SEV[s].icon} size={16} class="sev-{s}" /><span class="k-num">{rv.counts[s]}</span>
          </ToggleButton>
        {/each}
      </div>
    </div>
    <div class="rv-row">
      <Select class="rv-grow" full label="Kind" options={kindOptions} value={rv.filter.kinds[0] ?? ''} onchange={(v) => (rv.filter.kinds = v ? [v] : [])} />
      <IconButton variant="default" icon={rv.filter.dir > 0 ? 'arrow-up' : 'arrow-down'} label="Sort and scope" aria-haspopup="menu" aria-expanded={menuOpen}
        tip="Sort and scope: {sortLabel.toLowerCase()}{rv.filter.dir < 0 ? ', reversed' : ''}, {rv.scope === 'all' ? 'all axes' : 'active axis'}"
        onclick={(e) => { menuAnchor = e.currentTarget; menuOpen = !menuOpen; }} />
      <Menu bind:open={menuOpen} anchor={menuAnchor} placement="bottom-end" label="Sort and scope" items={menuItems} />
    </div>
  </div>

  <div class="rv-body list" aria-busy={rv.busy}>
    {#if !rows.length}
      {#if !rv.problems.length}
        <EmptyState icon="success" title="No problems" description={app.script.length ? `The script fits ${rv.profile.name}.` : 'Nothing to check yet.'} />
      {:else}
        <EmptyState icon="filter" title="Nothing matches" description="{rv.problems.length} hidden by filters{ignoredCount ? ` or ignored (${ignoredCount})` : ''}.">
          {#snippet actions()}
            {#if filtered}<Button size="sm" icon="close" onclick={clearFilters}>Clear filters</Button>{/if}
            {#if ignoredCount && !rv.filter.showIgnored}<Button size="sm" variant="ghost" icon="eye" onclick={() => (rv.filter.showIgnored = true)}>Show ignored</Button>{/if}
          {/snippet}
        </EmptyState>
      {/if}
    {:else}
      <VirtualList bind:this={list} items={rows} rowHeight={rowH} label="Problems" class="plist"
        bind:selected={() => selIndex, () => {}} onselect={(p) => rv.jump(p)} onactivate={(p) => rv.jump(p)}
        onpointerover={onHover} onpointerleave={() => (hoverIndex = -1)}>
        {#snippet row(p, i)}
          {@const sel = i === selIndex}
          {@const ign = rv.isIgnored(p)}
          <div class="prow" class:ign>
            <div class="l1">
              <Icon name={SEV[p.severity].icon} size={14} class="sev-{p.severity}" label={p.severity} />
              <span class="k-num t">{fmtTime(p.t0)}</span>
              <span class="k">{kindLabel(p.kind)}{#if rv.scope === 'all'} · {p.axis}{/if}</span>
              {#if dur(p)}<span class="k-num d">{dur(p)}</span>{/if}
              <span class="rv-sp"></span>
              {#if sel || i === hoverIndex}<span class="acts">
                {#if rv.canFix(p)}
                  <Button size="sm" icon="wand" onclick={own(() => act(() => rv.fixAndAdvance(p)))} onkeydown={keep} tip="{rv.fixText(p)} (one undo step)" shortcut={sel ? 'Ctrl+F8' : ''}>Fix</Button>
                {/if}
                <IconButton size="sm" icon={ign ? 'eye' : 'eye-off'} label={ign ? 'Stop ignoring this problem' : 'Ignore this problem'} shortcut={sel && !ign ? 'Alt+F8' : ''}
                  onclick={own(() => act(() => (ign ? rv.toggleIgnore(p, false) : rv.ignoreAndAdvance(p))))} onkeydown={keep} />
              </span>{/if}
            </div>
            <div class="l2" {@attach tooltip(p.message)}>{p.message}</div>
          </div>
        {/snippet}
      </VirtualList>
    {/if}
  </div>

  <div class="rv-foot">
    <span {@attach tooltip(rv.busy ? '' : `Last check took ${rv.lastMs.toFixed(0)} ms`)}>{#if rv.busy}checking…{:else}<span class="k-num">{rv.counts.total}</span> problem{rv.counts.total === 1 ? '' : 's'}{/if}{#if ignoredCount} · <span class="k-num">{ignoredCount}</span> ignored{/if}</span>
    <!-- the profile name takes the free space and ellipsizes there, so selecting a problem does not wrap the footer -->
    <span class="prof"><Button size="sm" variant="ghost" icon="device" onclick={() => app.showPanel?.('review.device')}
      tip="Checked against the {rv.profile.name} profile: open Device and heatmap">{rv.profile.name}</Button></span>
    {#if selKind}
      <Button size="sm" icon="wand" disabled={!selKindFixable} onclick={() => rv.fixKind(selKind)} tip="Apply the fix to every {kindLabel(selKind).toLowerCase()} problem (one undo step)" shortcut="Ctrl+Shift+F8">Fix all ({selKindFixable})</Button>
      <Button size="sm" variant="ghost" onclick={() => rv.toggleIgnoreKind(selKind, !rv.ignore.kinds.includes(selKind))} tip="{rv.ignore.kinds.includes(selKind) ? 'Show' : 'Hide'} every {kindLabel(selKind).toLowerCase()} problem">{rv.ignore.kinds.includes(selKind) ? 'Unignore' : 'Ignore'} kind</Button>
    {/if}
    {#if rv.ignore.ids.length || rv.ignore.kinds.length}
      <ToggleButton size="sm" icon="eye" bind:pressed={rv.filter.showIgnored} tip="List ignored problems too">Ignored</ToggleButton>
    {/if}
  </div>
</div>

<style>
  .sevs { display: flex; gap: var(--space-2); flex: none; }
  .sevs :global(.sev > .k-button-label) { display: inline-flex; align-items: center; gap: var(--space-2); }
  /* narrow panels: the severity toggles take their own row instead of squeezing the search field */
  @container (max-width: 290px) { .sevs { flex-basis: 100%; } .sevs :global(.sev) { flex: 1; } }
  .rv :global(.sev-error) { color: var(--bad-ink); }
  .rv :global(.sev-warn) { color: var(--warn-ink); }
  .rv :global(.sev-info) { color: var(--info-ink); }
  .list { display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); }
  .list > :global(.plist) { min-height: 0; }

  .prow { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: var(--space-1); }
  .l1 { display: flex; align-items: center; gap: var(--space-3); min-width: 0; height: var(--ctl-h-sm); }
  .t { color: var(--tx-hi); }
  .k { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: var(--fs-1); font-weight: 500; text-transform: uppercase; letter-spacing: var(--caps-track); color: var(--tx-mut); }
  .d { color: var(--tx-mut); font-size: var(--fs-2); }
  .l2 { padding-left: calc(14px + var(--space-3)); color: var(--tx-val); font-size: var(--fs-2); overflow: hidden; text-overflow: ellipsis; }
  .ign .t, .ign .l2 { color: var(--tx-mut); }
  .ign .k { text-decoration: line-through; }
  .acts { display: flex; gap: var(--space-1); flex: none; }
  .prof { flex: 1 1 0; min-width: var(--ctl-h-sm); display: flex; overflow: hidden; }
  .prof :global(.k-button) { color: var(--tx-mut); }
</style>
