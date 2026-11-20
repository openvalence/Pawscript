<script>
  import './inspector.css';
  import ToolCard from './ToolCard.svelte';
  import TextField from '../../ui/kit/TextField.svelte';
  import { tick } from 'svelte';
  import Scope from './Scope.svelte';
  import Section from '../../ui/kit/Section.svelte';
  import IconButton from '../../ui/kit/IconButton.svelte';
  import Icon from '../../ui/kit/Icon.svelte';
  import EmptyState from '../../ui/kit/EmptyState.svelte';
  import { shortcutText } from '../../ui/kit/keys.js';
  import { inspector as insp } from './state.svelte.js';
  import { OPS } from './catalog.js';
  import { groupOps } from './logic.js';

  let { app } = $props();
  (() => insp.init(app))(); // the app object never changes for a mounted panel
  const view = $derived(groupOps(OPS, insp.query, insp.favs));
  const keyOf = (op) => app.commands?.keysFor?.(`tool.${op.id}.apply`)?.[0] ?? '';
  let collapsed = $state({});
  const searching = $derived(insp.query.trim().length > 0);
  const toggleOpen = (op) => (insp.openId = insp.openId === op.id ? '' : op.id);

  // ---- keyboard: the list is ONE tab stop (roving tabindex). Up / Down / Home / End move between rows,
  // Right opens a tool (again: into its card), Left closes it. Down from the search box enters the list,
  // Up from the first row returns to it. Enter in the search box opens the first match and focuses its card.
  let scroller = $state(), searchBox = $state(), cur = $state('');
  const visibleKeys = $derived(view.groups.filter((g) => !collapsed[g.group] || searching).flatMap((g) => g.ops.map((op) => g.group + op.id)));
  const stop = $derived(visibleKeys.includes(cur) ? cur : visibleKeys[0]);
  const rowEls = () => [...(scroller?.querySelectorAll('.tname') ?? [])].filter((el) => !el.closest('[inert]'));
  const focusRow = (el) => { if (el) { cur = el.dataset.key; el.focus(); } };
  async function focusCard(id) {
    await tick();
    const card = scroller?.querySelector(`[data-testid="tool-${id}"]`);
    card?.querySelector('input:not(:disabled), button:not(:disabled), [tabindex="0"]')?.focus();
  }
  function rowKey(e, op) {
    const els = rowEls(), i = els.indexOf(e.currentTarget);
    const go = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: els.length - 1 }[e.key];
    if (go !== undefined) {
      e.preventDefault();
      if (go < 0) searchBox?.querySelector('input')?.focus(); else focusRow(els[Math.min(go, els.length - 1)]);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (insp.openId === op.id) focusCard(op.id); else insp.openId = op.id;
    } else if (e.key === 'ArrowLeft' && insp.openId === op.id) { e.preventDefault(); insp.openId = ''; }
  }
  function searchKey(e) { if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(rowEls().find((el) => el.dataset.key === stop) ?? rowEls()[0]); } }
  function searchEnter() {
    if (!view.count) return;
    const op = view.groups[0].ops[0];
    insp.openId = op.id; cur = view.groups[0].group + op.id;
    focusCard(op.id);
  }
</script>

<div class="pi">
  <div class="pi-bar">
    <!-- svelte-ignore a11y_no_static_element_interactions (ArrowDown bubbles from the search field) -->
    <div bind:this={searchBox} onkeydown={searchKey}>
      <TextField full icon="search" clearable placeholder="Search tools" label="Search tools" bind:value={insp.query} onenter={searchEnter} data-testid="tool-search" />
    </div>
    <Scope />
  </div>
  <div class="pi-scroll k-scroll" bind:this={scroller}>
    {#each view.groups as g (g.group)}
      <Section title={g.group} count={g.ops.length} open={!collapsed[g.group] || searching} onchange={(o) => (collapsed = { ...collapsed, [g.group]: !o })}>
        <ul class="tools">
          {#each g.ops as op (g.group + op.id)}
            {@const open = insp.openId === op.id}
            {@const pinned = view.fav.has(op.id)}
            <li class="trow" data-open={open || undefined}>
              <!-- data-arrow-nav (paw-zbyd): the arrows walk the list (rowKey), never nudge the selected points behind it -->
              <button class="pi-item tname" aria-expanded={open} tabindex={stop === g.group + op.id ? 0 : -1} data-key={g.group + op.id} data-arrow-nav
                onclick={() => toggleOpen(op)} onfocus={() => (cur = g.group + op.id)} onkeydown={(e) => rowKey(e, op)} data-testid="tool-row-{op.id}">
                <span class="lab"><Icon name="chevron-right" size={14} class="chev" />{op.title}</span>
                {#if keyOf(op)}<span class="keys k-num">{shortcutText(keyOf(op))}</span>{/if}
              </button>
              <!-- pointer only: the keyboard pins from the open card's Pin toggle -->
              <IconButton class="star" icon="pin" size="sm" tabindex={-1} pressed={pinned} label="{pinned ? 'Unpin' : 'Pin'} {op.title}" tip={pinned ? 'Unpin from the top of the list' : 'Pin to the top of the list'} onclick={() => insp.toggleFav(op.id)} />
            </li>
            {#if open}<li class="card"><ToolCard {app} {op} /></li>{/if}
          {/each}
        </ul>
      </Section>
    {/each}
    {#if !view.count}<EmptyState icon="search" title="No matching tool" description="Nothing matches “{insp.query}”. Try a shorter word." />{/if}
  </div>
</div>

<style>
  .tools { list-style: none; margin: 0 calc(var(--space-2) * -1); padding: 0; }
  .trow { display: flex; align-items: center; gap: var(--space-1); border-radius: var(--radius); }
  .trow:hover, .trow[data-open] { background: var(--bg-hover); }
  .trow[data-open] .tname { color: var(--tx-hi); }
  .tname { flex: 1; min-width: 0; padding-left: var(--space-2); }
  .tname:hover:not(:disabled) { background: none; }
  .tname .lab { display: flex; align-items: center; gap: var(--space-2); }
  .tname :global(.chev) { flex: none; color: var(--tx-mut); transition: transform var(--t-move) var(--ease-out); }
  .tname[aria-expanded='true'] :global(.chev) { transform: rotate(90deg); }
  .trow :global(.star) { opacity: 0; }
  .trow:hover :global(.star), .trow :global(.star[aria-pressed='true']) { opacity: 1; }
  @media (hover: none) { .trow :global(.star) { opacity: 1; } }
  .card { padding: 0 var(--space-2); }
</style>
