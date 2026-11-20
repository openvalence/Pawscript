<script>
  // One panel area of the Blender-style layout (Areas.svelte places it): the header (panel picker, tabs, empty
  // space to grab the area by, options, fold) or, folded, a rail of its tabs. The panel bodies are drawn by Areas
  // over this frame, so moving a panel between areas never remounts it.
  import { tooltip } from '../ui/kit/tooltip.js';
  import Tabs from '../ui/kit/Tabs.svelte';
  import IconButton from '../ui/kit/IconButton.svelte';
  import Menu from '../ui/kit/Menu.svelte';

  let { app, leaf, panels, all, edge = '', maximized = false, ongrab, onsplit } = $props();
  const L = $derived(app.layout);
  const active = $derived(panels.find((p) => p.id === leaf.tab) || panels[0]);
  const cmd = $derived(leaf.home ? 'layout.toggle' + leaf.home[0].toUpperCase() + leaf.home.slice(1) : '');
  const keyOf = (id) => (id ? app.commands.keysFor(id)[0] : undefined);
  const badge = (p) => { try { const b = p.badge?.(app); return b === 0 || b == null || b === '' ? undefined : b; } catch { return undefined; } };
  const tabs = $derived(panels.map((p) => ({ id: p.id, label: p.title, icon: p.icon, badge: badge(p), badgeTone: p.badgeTone })));
  let menuOpen = $state(false), menuBtn = $state(), pickOpen = $state(false), pickBtn = $state();
  const foldIcon = $derived(edge === 'left' ? 'panel-left' : edge === 'right' ? 'panel-right' : 'panel-bottom');
  // Blender's editor-type menu: every panel of this mode; picking one moves it here
  const pickItems = $derived([{ section: 'Show in this area' }, ...all.map((p) => ({ label: p.title, icon: p.icon, type: 'radio', checked: p.id === active?.id,
    run: () => (panels.includes(p) ? L.tab(leaf.id, p.id) : L.moveTab(p.id, leaf.id, 'center')) }))]);
  const menuItems = $derived([
    { section: active?.title || 'Area' },
    // paw-m3b6: the area.* commands (searchable, right click: Quick menu / shortcut), on this area
    { label: 'Split left / right', icon: 'panel-right', command: 'area.splitRight', shortcut: keyOf('area.splitRight'), run: () => app.commands.run('area.splitRight', { id: leaf.id }) },
    { label: 'Split top / bottom', icon: 'panel-bottom', command: 'area.splitBottom', shortcut: keyOf('area.splitBottom'), run: () => app.commands.run('area.splitBottom', { id: leaf.id }) },
    { label: maximized ? 'Restore area' : 'Maximize area', shortcut: keyOf('layout.maximize'), run: () => L.toggleMax(leaf.id) },
    { label: 'Close area (tabs move to its neighbor)', command: 'area.close', shortcut: keyOf('area.close'), run: () => app.commands.run('area.close', { id: leaf.id }) },
    ...(edge ? [{ label: 'Fold area', shortcut: keyOf(cmd), run: () => L.toggle(leaf.id, false) }] : []),
    { separator: true },
    { label: 'Reset layout for this tab', command: 'layout.reset', run: () => app.commands.run('layout.reset') },
    ...(panels.length > 1 ? [{ separator: true }, { section: 'Panels' }, ...panels.map((p) => ({ label: p.title, icon: p.icon, type: 'radio', checked: p.id === active?.id, run: () => L.tab(leaf.id, p.id) }))] : []),
  ]);
  // a tab pressed: Areas turns it into a drag once the pointer travels
  function tabDown(e) {
    const b = e.target.closest?.('[role=tab]');
    if (!b) return;
    const i = [...b.parentElement.children].indexOf(b);
    if (tabs[i]) ongrab?.(e, { kind: 'tab', id: tabs[i].id, from: leaf.id });
  }
</script>

{#if leaf.collapsed && edge}
  <nav class="rail {edge}" aria-label="{active?.title || 'Area'} (folded)">
    {#each tabs as t (t.id)}
      <button class="rtab" onclick={() => L.tab(leaf.id, t.id)} {@attach tooltip(`Show ${t.label}`)}>{t.label}{#if t.badge !== undefined}<i class="k-num">{t.badge}</i>{/if}</button>
    {/each}
  </nav>
{:else}
  <section class="area" aria-label="{active?.title || 'Empty'} area">
    <header>
      <span bind:this={pickBtn}><IconButton icon={active?.icon || 'layers'} label="Panel shown in this area" size="sm" onclick={() => (pickOpen = !pickOpen)} /></span>
      <Menu bind:open={pickOpen} anchor={pickBtn} placement="bottom-start" items={pickItems} />
      {#if tabs.length}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="tabs" onpointerdown={tabDown}>
          <Tabs {tabs} value={active.id} size="sm" label="Panels of this area" onchange={(id) => L.tab(leaf.id, id)} class="dtabs" />
        </div>
      {:else}
        <button class="pick" onclick={() => (pickOpen = !pickOpen)}>Choose a panel…</button>
      {/if}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="grab" onpointerdown={(e) => ongrab?.(e, { kind: 'area', id: leaf.id, from: leaf.id })}
        {@attach tooltip('Drag to dock on an edge, or onto a middle to swap')}></div>
      <span bind:this={menuBtn}><IconButton icon="more" label="Area options" size="sm" onclick={() => (menuOpen = !menuOpen)} /></span>
      <Menu bind:open={menuOpen} anchor={menuBtn} placement="bottom-end" items={menuItems} />
      {#if edge}
        <IconButton icon={foldIcon} label="Fold" size="sm" shortcut={keyOf(cmd)} onclick={() => L.toggle(leaf.id, false)} />
      {/if}
    </header>
    {#if !tabs.length}
      <p class="empty k-hint">Pick a panel for this area with the menu at the top left, or drag a tab here.</p>
    {/if}
  </section>
{/if}

<style>
  .area { display: flex; flex-direction: column; width: 100%; height: 100%; min-width: 0; min-height: 0; background: var(--bg); }
  header { display: flex; align-items: center; gap: var(--space-2); height: var(--ctl-h); flex: none; padding: 0 var(--space-2); background: var(--bg-raised); border-bottom: 1px solid var(--line-1); }
  .tabs { flex: 0 1 auto; min-width: 0; align-self: stretch; display: flex; }
  .tabs :global(.dtabs) { flex: 1; min-width: 0; }
  .grab { flex: 1 1 0; min-width: var(--space-6); align-self: stretch; cursor: grab; }
  .pick { font-size: var(--fs-2); color: var(--tx-mut); padding: 0 var(--space-3); }
  .pick:hover { color: var(--tx-hi); }
  .empty { margin: auto; padding: var(--space-6); text-align: center; max-width: 28ch; }
  .rail { display: flex; gap: 1px; width: 100%; height: 100%; background: var(--bg-raised); overflow: hidden; }
  .rail.left, .rail.right { flex-direction: column; padding-top: var(--space-2); }
  .rail.top, .rail.bottom { padding-left: var(--space-2); border-top: 1px solid var(--line-1); }
  .rtab { display: flex; align-items: center; gap: var(--space-2); font-size: var(--fs-1); font-weight: 500; text-transform: uppercase; letter-spacing: var(--caps-track); color: var(--tx-mut); padding: var(--space-4) 0; white-space: nowrap; }
  .rail.left .rtab, .rail.right .rtab { writing-mode: vertical-rl; }
  .rail.left .rtab { transform: rotate(180deg); }
  .rail.top .rtab, .rail.bottom .rtab { padding: 0 var(--space-5); }
  .rtab:hover { color: var(--tx-hi); background: var(--bg-hover); }
  .rtab i { font-style: normal; color: var(--warn-ink); }
</style>
