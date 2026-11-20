<!--
  MenuBar: the application menu row (File, Edit, View…). One tab stop; Left/Right move between the top
  items, Down/Enter/Space open, Up opens on the last row. While a menu is open, Left/Right move to the
  neighbouring menu and the pointer switches menus by hovering.

  <MenuBar menus={[{ label: 'File', items: [{ label: 'Open…', shortcut: 'Ctrl+O', run: openFile }] }]} />
-->
<script>
  import MenuList, { watchModality } from './MenuList.svelte';
  watchModality();
  import { nextIndex } from './focus.js';
  import { on } from './menus.js';

  let { menus = [], label = 'Menu bar', onselect, class: cls = '', ...rest } = $props();

  let bar = $state();
  const btns = $state([]);
  let open = $state(-1), roving = $state(0), how = $state('none'), gen = $state(0);

  function openMenu(i, initial) {
    roving = i;
    how = initial;
    open = i;
    gen++;
  }
  function move(dir) {
    openMenu((open + dir + menus.length) % menus.length, 'first');
  }
  function onkey(e) {
    const i = btns.indexOf(e.target);
    if (i < 0) return;   // keys from an open menu bubble through here
    const to = nextIndex(menus.length, i, e.key, { orientation: 'horizontal' });
    if (to != null) { e.preventDefault(); roving = to; btns[to].focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMenu(i, 'first'); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); openMenu(i, 'last'); }
  }
</script>

<div bind:this={bar} class="k-menu-bar {cls}" role="menubar" aria-label={label} {...rest} {@attach on('keydown', onkey)}>
  {#each menus as m, i}
    <button
      bind:this={btns[i]}
      type="button"
      class="k-menu-bar-item"
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={open === i}
      tabindex={i === roving ? 0 : -1}
      onclick={(e) => (open === i ? (open = -1) : openMenu(i, e.detail === 0 ? 'first' : 'none'))}
      onpointerenter={(e) => { if (open >= 0 && open !== i && e.pointerType !== 'touch') openMenu(i, 'none'); }}
    >{m.label}</button>
  {/each}
  {#if open >= 0 && menus[open]}
    {#key gen}
      <MenuList
        items={menus[open].items}
        anchor={btns[open]}
        offset={0}
        initial={how}
        inside={[bar]}
        label={menus[open].label}
        {onselect}
        onclose={() => (open = -1)}
        onnav={move}
      />
    {/key}
  {/if}
</div>

<style>
  .k-menu-bar { display: flex; align-items: stretch; height: var(--ctl-h); min-width: 0; }
  .k-menu-bar-item {
    flex: none; padding: 0 var(--pad-x); margin: 0;
    font: inherit; font-size: var(--fs-ui); line-height: 1; color: var(--tx);
    background: none; border: 0; border-radius: var(--radius); cursor: default;
    transition: color var(--t-quick) var(--ease-out), background-color var(--t-quick) var(--ease-out);
  }
  .k-menu-bar-item:hover, .k-menu-bar-item[aria-expanded='true'] { background: var(--bg-hover); color: var(--tx-hi); }
  .k-menu-bar-item:focus-visible { outline: var(--ring-w) solid var(--focus); outline-offset: calc(-1 * var(--ring-w)); }
</style>
