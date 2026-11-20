<!--
  Tabs: a line-style tab list (WAI-ARIA tabs, automatic activation, roving tabindex) and, when `children` is
  given, the one tabpanel it controls. Too many tabs for the width: the list scrolls (wheel too), fades at
  the clipped edge, keeps the active tab in view, and (overflow='menu', the default) a trailing "More tabs"
  button opens a menu of every tab.
  <Tabs label="Side panel" tabs={[{ id: 'insp', label: 'Inspector', icon: 'settings' },
        { id: 'prob', label: 'Problems', badge: 12, badgeTone: 'warn' }]} bind:value>
    {#snippet children(id)}{#if id === 'insp'}…{/if}{/snippet}
  </Tabs>
  Internal classes carry a `kit-` prefix so a host stylesheet's bare `.label` / `.tab` cannot reach them.
-->
<script>
  import Icon from './Icon.svelte';
  import Badge from './Badge.svelte';
  import IconButton from './IconButton.svelte';
  import Menu from './Menu.svelte';
  import { nextIndex, nextId } from './focus.js';

  let {
    tabs = [], value = $bindable(), size = 'md', label, overflow = 'menu', onchange, children, class: cls = '', ...rest
  } = $props();

  const uid = nextId('k-tabs');
  const active = $derived(tabs.some((t) => t.id === value) ? value : tabs.find((t) => !t.disabled)?.id);
  const activeIdx = $derived(tabs.findIndex((t) => t.id === active));
  let list = $state(null);
  let over = $state(false);      // the tabs are wider than the bar: show the overflow button
  let menuOpen = $state(false);
  let moreBtn = $state(null);
  const hasBadge = (t) => t.badge != null && t.badge !== '';
  const menuItems = $derived(tabs.map((t) => ({
    id: t.id, icon: t.icon, type: 'radio', checked: t.id === active, disabled: t.disabled,
    label: hasBadge(t) ? `${t.label} (${t.badge})` : t.label,
  })));

  function select(i, e) {
    const t = tabs[i];
    if (!t || t.disabled) return;
    reveal(i);
    if (t.id === active) return;
    value = t.id;
    onchange?.(t.id, e);
  }

  // From the overflow menu: same as a click, then focus the tab (the menu already put focus on its button).
  function pick(item, e) {
    const i = tabs.findIndex((t) => t.id === item.id);
    select(i, e);
    list?.children[i]?.focus();
  }

  // Scroll the list (never the page) so tab i is in view, clear of the edge fade.
  function reveal(i) {
    const b = list?.children[i];
    if (!b || list.scrollWidth <= list.clientWidth) return;
    const pad = 24;
    if (b.offsetLeft - pad < list.scrollLeft) list.scrollLeft = b.offsetLeft - pad;
    else if (b.offsetLeft + b.offsetWidth + pad > list.scrollLeft + list.clientWidth)
      list.scrollLeft = b.offsetLeft + b.offsetWidth + pad - list.clientWidth;
  }

  function onkeydown(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const cur = [...list.children].indexOf(document.activeElement);
    const i = nextIndex(tabs.length, cur < 0 ? activeIdx : cur, e.key, { orientation: 'horizontal', disabled: (k) => !!tabs[k].disabled });
    if (i == null) return;
    e.preventDefault();
    select(i, e);
    list.children[i].focus();
  }

  function fades() {
    list.toggleAttribute('data-ov-s', list.scrollLeft > 1);
    list.toggleAttribute('data-ov-e', list.scrollLeft + list.clientWidth < list.scrollWidth - 1);
  }

  // Overflow is the tabs' total width against the whole bar's. Neither changes when the button comes or
  // goes, so the strip cannot flip back and forth at the threshold.
  $effect(() => {
    void tabs, overflow;   // re-observe the tab elements when the tabs change
    const node = list;
    if (!node) return;
    const ro = new ResizeObserver(() => {
      over = overflow === 'menu' && node.scrollWidth > node.parentElement.clientWidth;
      if (!over) menuOpen = false;
      fades();
      reveal(activeIdx);
    });
    ro.observe(node.parentElement);
    ro.observe(node);
    for (const c of node.children) ro.observe(c);
    return () => ro.disconnect();
  });
  $effect(() => reveal(activeIdx));   // a value set from outside comes into view too

  // A vertical wheel scrolls the list sideways.
  function scroller(node) {
    const wheel = (e) => {
      if (node.scrollWidth <= node.clientWidth || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      node.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    node.addEventListener('scroll', fades, { passive: true });
    node.addEventListener('wheel', wheel, { passive: false });
    return () => { node.removeEventListener('scroll', fades); node.removeEventListener('wheel', wheel); };
  }
</script>

<div class="k-tabs kit-tabs-{size} {cls}" {...rest}>
  <div class="kit-tab-bar">
    <!-- svelte-ignore a11y_interactive_supports_focus (focus lives on the tabs: roving tabindex) -->
    <div class="kit-tab-list" role="tablist" aria-label={label} bind:this={list} {onkeydown} {@attach scroller}>
      {#each tabs as t, i (t.id)}
        <button
          type="button"
          role="tab"
          class="kit-tab"
          id="{uid}-{i}"
          aria-selected={t.id === active}
          aria-controls={children && t.id === active ? `${uid}-p` : undefined}
          tabindex={t.id === active ? 0 : -1}
          disabled={t.disabled}
          onclick={(e) => select(i, e)}
        >
          {#if t.icon}<Icon name={t.icon} size={size === 'sm' ? 14 : 16} />{/if}
          <span class="kit-tab-label">{t.label}</span>
          {#if hasBadge(t)}
            <Badge tone={t.badgeTone ?? 'neutral'} num={typeof t.badge === 'number'}>{t.badge}</Badge>
          {/if}
        </button>
      {/each}
    </div>
    {#if over}
      <div class="kit-tab-more">
        <IconButton
          icon="chevron-down"
          label="More tabs"
          {size}
          tip={menuOpen ? '' : undefined}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onclick={() => (menuOpen = !menuOpen)}
          {@attach (n) => { moreBtn = n; }}
        />
        <Menu bind:open={menuOpen} anchor={moreBtn} placement="bottom-end" label={label ?? 'Tabs'} items={menuItems} onselect={pick} />
      </div>
    {/if}
  </div>
  {#if children}
    <div class="kit-tab-panel" role="tabpanel" id="{uid}-p" aria-labelledby="{uid}-{activeIdx}" tabindex="0">
      {@render children(active)}
    </div>
  {/if}
</div>

<style>
  .k-tabs { --tab-h: var(--ctl-h); display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .kit-tabs-sm { --tab-h: var(--ctl-h-sm); }
  .kit-tabs-lg { --tab-h: var(--ctl-h-lg); }

  /* The bar's bottom hairline is an inset shadow, so the active tab's indicator paints over it, flush. */
  .kit-tab-bar { flex: none; display: flex; min-width: 0; height: var(--tab-h); box-shadow: inset 0 -1px var(--line-1); }
  .kit-tab-list {
    --fade: var(--space-7);
    position: relative; flex: 0 1 auto; display: flex; min-width: 0;
    overflow-x: auto; overflow-y: hidden; scrollbar-width: none; overscroll-behavior-x: contain;
  }
  .kit-tab-list::-webkit-scrollbar { display: none; }
  .kit-tab-list[data-ov-s] { mask-image: linear-gradient(to right, transparent, currentColor var(--fade)); }
  .kit-tab-list[data-ov-e] { mask-image: linear-gradient(to left, transparent, currentColor var(--fade)); }
  .kit-tab-list[data-ov-s][data-ov-e] {
    mask-image: linear-gradient(to right, transparent, currentColor var(--fade), currentColor calc(100% - var(--fade)), transparent);
  }

  .kit-tab {
    position: relative; flex: none; display: inline-flex; align-items: center; gap: var(--space-3);
    height: 100%; padding: 0 var(--space-4); margin: 0;
    border: 0; border-radius: 0; background: none;
    color: var(--tx-mut); font-size: var(--fs-ui); line-height: 1; white-space: nowrap;
    transition: color var(--t-quick) var(--ease-out);
  }
  .kit-tabs-sm .kit-tab { font-size: var(--fs-2); gap: var(--space-2); padding: 0 var(--space-3); }
  .kit-tab::after {
    content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 2px;
    background: var(--reality); opacity: 0; transition: opacity var(--t-quick) var(--ease-out);
  }
  .kit-tab:hover:not(:disabled) { color: var(--tx); }
  .kit-tab:active:not(:disabled) { color: var(--highlight); }
  .kit-tab[aria-selected='true'] { color: var(--tx-hi); }
  .kit-tab[aria-selected='true']::after { opacity: 1; }
  .kit-tab:disabled { opacity: .45; cursor: not-allowed; }
  /* Inset: the list clips anything drawn outside a tab. */
  .kit-tab:focus-visible { outline: var(--ring-w) solid var(--focus); outline-offset: calc(var(--ring-w) * -1); }

  /* The overflow button: flush square at the bar's end. Its left hairline and the bar's bottom one are drawn
     over it, so its hover fill never hides either. */
  .kit-tab-more { position: relative; flex: none; display: flex; }
  .kit-tab-more::after {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    box-shadow: inset 1px 0 var(--line-1), inset 0 -1px var(--line-1);
  }
  .kit-tab-more :global(.k-button) { border-radius: 0; }
  .kit-tab-more :global(.k-button[aria-expanded='true']) { background-color: var(--bg-hover); color: var(--tx-hi); }
  .kit-tab-more :global(.k-button:focus-visible) { outline-offset: calc(var(--ring-w) * -1); }

  .kit-tab-panel { flex: 1 1 auto; min-width: 0; min-height: 0; }
  .kit-tab-panel:focus-visible { outline: var(--ring-w) solid var(--focus); outline-offset: calc(var(--ring-w) * -1); }
</style>
