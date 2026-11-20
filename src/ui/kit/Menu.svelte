<!--
  Menu: a dropdown menu beside an anchor element or at a point. Nested submenus, shortcut column,
  checkbox / radio items, sections, typeahead. Focus returns to the anchor on close.

  <button bind:this={btn} aria-haspopup="menu" aria-expanded={open} onclick={() => (open = !open)}>…</button>
  <Menu bind:open anchor={btn} items={[{ label: 'Cut', icon: 'cut', shortcut: 'Ctrl+X', run: cut }]} />
-->
<script>
  import MenuList, { watchModality } from './MenuList.svelte';
  watchModality(); // before the first open, so the opening key counts

  let {
    items = [],
    open = $bindable(false),
    anchor,
    placement = 'bottom-start',
    offset = 2,
    initial = 'auto',
    label = undefined,
    onselect,
    onclose,
    class: cls = '',
    ...rest
  } = $props();

  // An Element anchor reads as expanded while the menu is open (screen readers; tooltip.js suppresses the
  // anchor's tip). Only when the caller does not manage aria-expanded itself.
  $effect(() => {
    const a = anchor;
    if (!open || !(a instanceof Element) || a.hasAttribute('aria-expanded')) return;
    a.setAttribute('aria-expanded', 'true');
    return () => a.removeAttribute('aria-expanded');
  });

  function closed(reason) {
    open = false;
    onclose?.(reason);
  }
</script>

{#if open && anchor}
  <MenuList
    {items}
    {anchor}
    {placement}
    {offset}
    {initial}
    {label}
    inside={anchor instanceof Element ? [anchor] : []}
    {onselect}
    onclose={closed}
    class={cls}
    {...rest}
  />
{/if}
