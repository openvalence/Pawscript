<!--
  MenuList (internal): one menu panel, and its open submenu (itself, recursively). Menu, MenuBar and
  contextmenu.js render it; the API is theirs (docs/menus.md).

  Focus stays on the panel (role=menu, tabindex=-1); the keyboard's row is aria-activedescendant +
  data-active, as in Select and ComboBox. A submenu is a top-layer popover nested in its parent's DOM, so
  the parent's outside-click rule covers it; its keys stop at its own panel.
-->
<script module>
  // Input modality: a menu opened from the keyboard starts on its first row; one opened by the pointer on none.
  // Installed on first use (not at import), so importing the kit has no side effects.
  let keyed = false, watching = false;
  export function watchModality() {
    if (watching) return;
    watching = true;
    document.addEventListener('keydown', () => { keyed = true; }, true);
    document.addEventListener('pointerdown', () => { keyed = false; }, true);
  }
</script>

<script>
  import { untrack } from 'svelte';
  watchModality();
  import Icon from './Icon.svelte';
  import MenuList from './MenuList.svelte';
  import { float, dismiss } from './position.js';
  import { nextIndex, createTypeahead, nextId } from './focus.js';
  import { shortcutText } from './keys.js';
  import { tooltip } from './tooltip.js';
  import { isRow, treeHas, autoAlign, reveal } from './menus.js';

  const GRACE_MS = 300;

  let {
    items = [],
    anchor,                  // level 0: Element | {x, y, width?, height?}; submenus: the opener row
    container = null,        // submenus: the parent panel
    placement = 'bottom-start',
    offset = 2,
    level = 0,
    initial = 'auto',        // 'first' | 'last' | 'none' | 'auto' (first when opened from the keyboard)
    icons = undefined,       // icon column; level 0 decides it for the whole tree so columns line up
    inside = [],             // level 0: elements a pointerdown on does not close it (the anchor, a menubar)
    label = undefined,
    onselect,                // (item, e) a leaf was chosen
    onclose,                 // (reason) 'select' | 'escape' | 'left' | 'tab' | 'outside'
    onnav,                   // (dir) ArrowRight on a leaf / ArrowLeft at level 0: MenuBar moves
    onenter,                 // submenus: the pointer reached this panel (the parent stops its grace timer)
    onactive,                // level 0: (item | null) the row the pointer / keys are on (a preview of what it would pick)
    class: cls = '',
    ...rest
  } = $props();

  let el = $state();
  let active = $state(-1);
  let sub = $state(-1);            // row whose submenu is open
  let subInitial = $state('none');
  let subGen = $state(0);
  let grace = 0, restore = null;
  const typeahead = createTypeahead();

  const hasIcons = $derived(icons ?? (treeHas(items, 'icon') || treeHas(items, 'color')));   // color: a swatch in the icon column
  $effect(() => { const it = rows[active]?.it ?? null; if (onactive) untrack(() => onactive(it)); });
  const model = $derived.by(() => {
    let r = 0;
    return items.map((it) => (isRow(it) ? { it, ri: r++, id: nextId('k-mi') } : { it }));
  });
  const rows = $derived(model.filter((m) => m.ri !== undefined));
  const off = (i) => !!rows[i]?.it.disabled;
  const hasSub = (i) => !!rows[i]?.it.items?.length && !off(i);
  const rowEl = (i) => (rows[i] ? document.getElementById(rows[i].id) : null);
  const role = (it) => it.type === 'radio' ? 'menuitemradio' : it.type === 'checkbox' || it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem';

  function setActive(i, scroll) {
    active = i;
    if (scroll && i >= 0) reveal(el, rowEl(i));
  }
  function openSub(i, how) {
    clearTimeout(grace);
    if (sub === i && how === 'none') return;
    sub = i;
    subInitial = how;
    subGen++;
  }
  function closeSub(refocus) {
    clearTimeout(grace);
    if (sub < 0) return;
    if (refocus) { active = sub; el.focus({ preventScroll: true }); }
    sub = -1;
  }
  function close(reason) {
    if (level === 0) restore?.();
    onclose?.(reason);
  }
  /** A leaf: level 0 closes the tree, then runs it. */
  function pick(it, e) {
    if (level > 0) return onselect?.(it, e);
    close('select');
    it.run?.();
    onselect?.(it, e);
  }
  function childClosed(reason) {
    if (reason === 'escape' || reason === 'left') closeSub(true);
    else close(reason);
  }

  function onkey(e) {
    if (e.target !== el) return;   // a submenu's keys bubble through this panel: not ours
    const k = e.key, n = rows.length;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    const page = Math.max(1, Math.floor(el.clientHeight / (rowEl(0)?.offsetHeight || 24)) - 1);
    const to = nextIndex(n, active, k, { disabled: off, page });
    if (to != null) {
      stop();
      if (sub >= 0 && to !== sub) closeSub();
      setActive(to, true);
      return;
    }
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (plain && k.length === 1) {
      const t = typeahead(k, rows.map((r) => r.it.label), active, off);
      if (t != null) { stop(); if (sub !== t) closeSub(); setActive(t, true); return; }
    }
    const it = rows[active]?.it;
    switch (k) {
      case 'Enter':
      case ' ':
        stop();
        if (it && !it.disabled) hasSub(active) ? openSub(active, 'first') : pick(it, e);
        return;
      case 'ArrowRight':
        stop();
        if (hasSub(active)) openSub(active, 'first');
        else onnav?.(1);
        return;
      case 'ArrowLeft':
        stop();
        if (level > 0) onclose?.('left');
        else onnav?.(-1);
        return;
      case 'Escape':
        stop();
        if (level > 0) onclose?.('escape'); else close('escape');
        return;
      case 'Tab':
        // No preventDefault: focus goes back to the anchor first, then Tab moves on from there.
        if (level > 0) onclose?.('tab'); else close('tab');
        return;
    }
    // An open menu is modal for the keyboard: no other key (5, Ctrl+2…) reaches app shortcuts behind it.
    e.stopPropagation();
  }

  function hover(i, e) {
    if (e.pointerType === 'touch') return;
    onenter?.();
    if (document.activeElement !== el) el.focus({ preventScroll: true });   // the keys follow the pointer
    const want = off(i) ? -1 : i;
    if (active === want) return;
    active = want;
    clearTimeout(grace);
    if (sub < 0) { if (hasSub(i)) openSub(i, 'none'); }
    else if (sub !== i) {
      // Wandering off the opener: the submenu waits, so a diagonal path into it keeps it open.
      grace = setTimeout(() => {
        closeSub();
        if (active >= 0 && hasSub(active)) openSub(active, 'none');
      }, GRACE_MS);
    }
  }
  function unhover(i) {
    if (sub !== i && active === i) active = -1;
  }
  function subEntered() {
    clearTimeout(grace);
    if (sub >= 0) active = sub;
  }
  function click(i, e) {
    const it = rows[i].it;
    if (it.disabled) return;
    if (hasSub(i)) { if (sub !== i) openSub(i, e.detail === 0 ? 'first' : 'none'); return; }
    pick(it, e);
  }

  function setup(node) {
    return untrack(() => {
      const before = document.activeElement;
      node.addEventListener('keydown', onkey);   // before dismiss(): this one handles Escape
      let pl = placement, at = anchor, gap = offset;
      if (level > 0) {
        // Beside the parent panel, the first row level with the opener.
        pl = 'right-start';
        gap = -1;   // the two frames share one hairline
        at = () => {
          const r = anchor.getBoundingClientRect(), m = container.getBoundingClientRect();
          const first = node.querySelector('.k-item');
          return { x: m.left, y: r.top - (first ? first.offsetTop : 0) - node.clientTop, width: m.width, height: r.height };
        };
      } else {
        node.showPopover();
        const a = anchor instanceof Element ? anchor.getBoundingClientRect() : { x: anchor.x, width: anchor.width ?? 0 };
        pl = autoAlign(placement, { x: a.x, width: a.width }, node.offsetWidth, document.documentElement.clientWidth);
      }
      const f = float(node, at, { placement: pl, offset: gap });
      const undismiss = level === 0 ? dismiss(node, () => close('outside'), inside) : null;

      let how = initial === 'auto' ? (keyed ? 'first' : 'none') : initial;
      if (how === 'first' || how === 'last') setActive(nextIndex(rows.length, -1, how === 'first' ? 'Home' : 'End', { disabled: off }) ?? -1, true);
      if (level === 0 || how !== 'none') node.focus({ preventScroll: true });

      if (level === 0) {
        let done = false;
        restore = () => {
          if (done) return;
          done = true;
          const a = document.activeElement;
          if (a && a !== document.body && !node.contains(a)) return;   // focus already went elsewhere
          const back = anchor instanceof Element ? anchor : before;
          if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
        };
      }
      return () => {
        clearTimeout(grace);
        node.removeEventListener('keydown', onkey);
        undismiss?.();
        f.destroy();
        restore?.();
      };
    });
  }
</script>

<div
  bind:this={el}
  class="k-pop k-menu {cls}"
  role="menu"
  tabindex="-1"
  popover="manual"
  aria-label={label}
  aria-activedescendant={rows[active]?.id}
  data-icons={hasIcons || undefined}
  data-level={level}
  {...rest}
  {@attach setup}
>
  {#each model as m}
    {#if m.it.separator}
      <div class="k-menu-sep" role="separator"></div>
    {:else if m.ri === undefined}
      <div class="k-menu-sec k-caps" role="presentation">{m.it.section}</div>
    {:else}
      {@const it = m.it}
      {@const ri = m.ri}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
      <div
        class="k-item"
        id={m.id}
        role={role(it)}
        aria-checked={role(it) === 'menuitem' ? undefined : !!it.checked}
        aria-disabled={it.disabled ? 'true' : undefined}
        aria-haspopup={it.items ? 'menu' : undefined}
        aria-expanded={it.items ? sub === ri : undefined}
        aria-keyshortcuts={it.shortcut || undefined}
        data-active={active === ri || undefined}
        data-command={it.command}
        onpointermove={(e) => hover(ri, e)}
        onpointerleave={() => unhover(ri)}
        onclick={(e) => click(ri, e)}
        {@attach tooltip({ text: it.tip, placement: 'right' })}
      >
        <span class="k-item-check">{#if it.checked}<Icon name={it.type === 'radio' ? 'dot' : 'check'} />{/if}</span>
        {#if hasIcons}<span class="k-item-icon">{#if it.icon}<Icon name={it.icon} />{:else if it.color}<span class="k-item-swatch" style:background={it.color}></span>{/if}</span>{/if}
        <span class="k-item-label">{it.label}</span>
        <span class="k-item-keys">{it.shortcut ? shortcutText(it.shortcut) : ''}</span>
        <span class="k-item-chev">{#if it.items}<Icon name="chevron-right" size={12} />{/if}</span>
      </div>
      {#if sub === ri}
        {#key subGen}
          <MenuList
            items={it.items}
            anchor={rowEl(ri)}
            container={el}
            level={level + 1}
            initial={subInitial}
            icons={hasIcons}
            label={it.label}
            onselect={pick}
            onclose={childClosed}
            {onnav}
            onenter={subEntered}
          />
        {/key}
      {/if}
    {/if}
  {/each}
</div>

<style>
  .k-menu { min-width: 12rem; }
  .k-menu:not([data-icons]) .k-item { grid-template-columns: 16px minmax(0, 1fr) auto 12px; }
  .k-item-check, .k-item-icon, .k-item-chev { display: grid; place-items: center; }
  .k-item-check { color: var(--accent-ink); }
  .k-item-swatch { width: 10px; height: 10px; border-radius: 50%; }
  .k-item-chev { color: var(--tx-mut); }
  .k-item[aria-expanded='true'] { background: var(--bg-hover); color: var(--tx-hi); }
  .k-item[aria-disabled='true'] :is(.k-item-check, .k-item-chev) { color: var(--tx-ghost); }
  /* The keyboard's bar only in the panel that has focus; an ancestor's opener keeps just its fill. */
  .k-menu:not(:focus) > .k-item[data-active]::before { content: none; }
  .k-menu-sec { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; user-select: none; }
  /* Section titles start on the label column (theme.css places them for menus without the icon column). */
  .k-menu[data-icons] > .k-menu-sec { padding-left: calc(var(--space-3) * 3 + 32px); }
</style>
