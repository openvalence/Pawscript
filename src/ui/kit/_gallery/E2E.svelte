<script>
  // E2E.svelte -- fixtures for test/kit-e2e.test.mjs (dev/kit.html#e2e/full). Each block is one component with
  // stable data-testids and an <output> that logs what the component reported, so tests assert on callbacks,
  // not on internals. A block shows "not landed" until its component file exists.
  import { kit } from './kit.svelte.js';
  import { tooltip } from '../tooltip.js';
  import Section from '../Section.svelte';
  import Button from '../Button.svelte';
  import Menu from '../Menu.svelte';

  let log = $state([]);
  const say = (s) => (log = [...log, s]);

  const menuItems = [
    { id: 'new', label: 'New', shortcut: 'Ctrl+N' },
    { id: 'open', label: 'Open…' },
    { label: 'Recent', items: [{ id: 'r1', label: 'alpha.funscript' }, { id: 'r2', label: 'beta.funscript' }] },
    { separator: true },
    { id: 'dis', label: 'Disabled', disabled: true },
    { id: 'save', label: 'Save' },
  ];
  const menus = [
    { label: 'File', items: menuItems },
    { label: 'Edit', items: [{ id: 'undo', label: 'Undo' }, { id: 'redo', label: 'Redo' }] },
    { label: 'View', items: [{ id: 'heat', label: 'Heatmap', type: 'checkbox', checked: true }] },
  ];
  let menuOpen = $state(false);
  let menuBtn = $state();

  let tab = $state('a');
  const ovTabs = [{ id: 'alpha', label: 'Alpha' }, { id: 'beta', label: 'Beta', badge: 3 }, { id: 'off', label: 'Off', disabled: true },
    { id: 'gamma', label: 'Gamma' }, { id: 'delta', label: 'Delta' }, { id: 'omega', label: 'Omega' }];
  let ovTab = $state('alpha');
  let slider = $state(50);
  let dlgOpen = $state(false);
  let num = $state(10), numCommits = $state(0), numChanges = $state(0);
  let split = $state(200), splitEvents = $state(0);
  let tipSelf = $state(true), tipKeyed = $state(true);
  let gapMenuOpen = $state(false), gapMenuBtn = $state();
  const gapItems = [{ id: 'kind', label: 'Custom glyph', icon: { path: 'M2.75 8h10.5M8 2.75v10.5' } }, { id: 'named', label: 'Kit glyph', icon: 'play' }];
  const rows = Array.from({ length: 100_000 }, (_, i) => ({ id: i, label: `Row ${i}` }));
</script>

<div class="e2e">
  <output data-testid="log">{log.join('|')}</output>

  <section data-testid="tip-block">
    <h3 class="k-caps">Tooltip lifetime</h3>
    <!-- a close button that removes itself (the video HUD's case), by pointer and by keyboard -->
    <!-- fixed slots, so nothing else slides under the pointer when a trigger goes -->
    <div class="slot">{#if tipSelf}<button type="button" class="b" data-testid="tip-self" {@attach tooltip('Close', 'Esc')} onclick={() => (tipSelf = false)}>Close me</button>{/if}</div>
    <div class="slot">{#if tipKeyed}<button type="button" class="b" data-testid="tip-keyed" {@attach tooltip('Close by key', 'Esc')} onclick={() => (tipKeyed = false)}>Close me by key</button>{/if}</div>
    <!-- a trigger whose parent is hidden under a still pointer (no pointerleave, no teardown) -->
    <div class="slot"><div data-testid="tip-parent"><button type="button" class="b" data-testid="tip-hidden" {@attach tooltip('Hidden by parent')}>Parent hides</button></div></div>
    <button type="button" class="b" data-testid="tip-plain" {@attach tooltip('Plain', 'P')}>Plain</button>
    <button type="button" class="b" data-testid="tip-reset" onclick={() => { tipSelf = true; tipKeyed = true; }}>Reset</button>
  </section>

  <section data-testid="gaps-block">
    <h3 class="k-caps">Kit gaps (sections, grow, custom glyphs, tip on open menu)</h3>
    <div class="narrow" data-testid="sec-wrap">
      <Section title="Wide content" data-testid="sec-wide">
        {#snippet actions()}<button type="button" class="b" data-testid="sec-act">Act</button>{/snippet}
        <div style="width: 900px; height: 8px"></div>
        <button type="button" class="b" data-testid="sec-inner">Inner</button>
      </Section>
      <Section title="Always" actionsVisible="always" data-testid="sec-always">
        {#snippet actions()}<button type="button" class="b" data-testid="sec-act-always">Act</button>{/snippet}
        <p>body</p>
      </Section>
    </div>
    <div class="row300" data-testid="grow-row"><Button grow data-testid="grow-btn">Grow</Button><Button data-testid="fixed-btn">Fixed</Button></div>
    <button type="button" class="b" bind:this={gapMenuBtn} data-testid="gap-menu-btn" {@attach tooltip('Kinds')} onclick={() => (gapMenuOpen = !gapMenuOpen)}>Kinds</button>
    <Menu bind:open={gapMenuOpen} anchor={gapMenuBtn} items={gapItems} label="Kinds" onselect={(it) => say('gap:' + it.id)} />
  </section>

  <section data-testid="menu-block">
    <h3 class="k-caps">Menu</h3>
    {#if kit.Menu}
      <button type="button" class="b" bind:this={menuBtn} data-testid="menu-btn" onclick={() => (menuOpen = !menuOpen)}>Open menu</button>
      <kit.Menu items={menuItems} bind:open={menuOpen} anchor={menuBtn} onselect={(it) => say('menu:' + it.id)} onclose={() => say('menu:close')} />
    {:else}<p class="k-hint">Menu not landed</p>{/if}
  </section>

  <section data-testid="menubar-block">
    <h3 class="k-caps">MenuBar</h3>
    <button type="button" class="b" data-testid="before-menubar">before</button>
    {#if kit.MenuBar}<kit.MenuBar {menus} onselect={(it) => say('bar:' + it.id)} />{:else}<p class="k-hint">MenuBar not landed</p>{/if}
  </section>

  <section data-testid="tabs-block">
    <h3 class="k-caps">Tabs</h3>
    {#if kit.Tabs}
      <kit.Tabs label="Fixture tabs" tabs={[{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'x', label: 'Off', disabled: true }, { id: 'c', label: 'Gamma' }]} bind:value={tab}>
        {#snippet children(id)}<p data-testid="tab-panel">panel {id}</p>{/snippet}
      </kit.Tabs>
    {:else}<p class="k-hint">Tabs not landed</p>{/if}
    <output data-testid="tab-value">{tab}</output>
  </section>

  <section data-testid="tabs-ov-block">
    <h3 class="k-caps">Tabs overflow (180 px)</h3>
    {#if kit.Tabs}
      <div style="width: 180px" data-testid="tabs-ov">
        <kit.Tabs label="Overflow tabs" tabs={ovTabs} bind:value={ovTab} onchange={(id) => say('tabs-ov:' + id)} />
      </div>
    {:else}<p class="k-hint">Tabs not landed</p>{/if}
    <output data-testid="tab-ov-value">{ovTab}</output>
  </section>

  <section data-testid="slider-block">
    <h3 class="k-caps">Slider</h3>
    {#if kit.Slider}<kit.Slider label="Fixture slider" min={0} max={100} step={1} bind:value={slider} />{:else}<p class="k-hint">Slider not landed</p>{/if}
    <output data-testid="slider-value">{slider}</output>
  </section>

  <section data-testid="dialog-block">
    <h3 class="k-caps">Dialog</h3>
    <button type="button" class="b" data-testid="dlg-open" onclick={() => (dlgOpen = true)}>Open dialog</button>
    {#if kit.Dialog}
      <kit.Dialog bind:open={dlgOpen} title="Fixture dialog" onclose={(r) => say('dlg:' + r)}>
        <input data-testid="dlg-first" aria-label="first" />
        <input data-testid="dlg-second" aria-label="second" />
        {#snippet footer({ close })}
          <button type="button" class="b" data-testid="dlg-cancel" onclick={() => close('cancel')}>Cancel</button>
          <button type="button" class="b" data-testid="dlg-ok" onclick={() => close('ok')}>OK</button>
        {/snippet}
      </kit.Dialog>
    {:else}<p class="k-hint">Dialog not landed</p>{/if}
  </section>

  <section data-testid="number-block">
    <h3 class="k-caps">NumberField</h3>
    {#if kit.NumberField}
      <kit.NumberField label="Fixture number" min={0} max={1000} step={1} bind:value={num} onchange={() => numChanges++} oncommit={() => numCommits++} data-testid="num" />
    {:else}<p class="k-hint">NumberField not landed</p>{/if}
    <output data-testid="num-value">{num}</output> <output data-testid="num-commits">{numCommits}</output> <output data-testid="num-changes">{numChanges}</output>
  </section>

  <section data-testid="split-block">
    <h3 class="k-caps">SplitPane (600 px, min 100, minOther 150)</h3>
    <div class="split" data-testid="split">
      {#if kit.SplitPane}
        <kit.SplitPane direction="horizontal" defaultSize={200} min={100} minOther={150} bind:size={split} onresize={() => splitEvents++}>
          {#snippet first()}<div class="pane" data-testid="split-first">first</div>{/snippet}
          {#snippet second()}<div class="pane">second</div>{/snippet}
        </kit.SplitPane>
      {:else}<p class="k-hint">SplitPane not landed</p>{/if}
    </div>
    <output data-testid="split-size">{split}</output>
  </section>

  <section data-testid="vlist-block">
    <h3 class="k-caps">VirtualList (100 000 rows)</h3>
    <div class="vlist" data-testid="vlist">
      {#if kit.VirtualList}
        <kit.VirtualList items={rows} label="Fixture rows">
          {#snippet row(r)}<span data-testid="vrow">{r.label}</span>{/snippet}
        </kit.VirtualList>
      {:else}<p class="k-hint">VirtualList not landed</p>{/if}
    </div>
  </section>
</div>

<style>
  .e2e { padding: var(--space-6); display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: var(--space-6); align-items: start; }
  output[data-testid='log'] { grid-column: 1 / -1; font: var(--fs-2) var(--mono); color: var(--tx-mut); min-height: 1em; }
  section { display: flex; flex-direction: column; gap: var(--space-3); align-items: flex-start; }
  .b { height: var(--ctl-h); padding: 0 var(--pad-x); background: var(--bg-card); color: var(--tx); border: var(--bw) solid var(--line-2); border-radius: var(--radius); }
  .b:focus-visible { outline: var(--ring-w) solid var(--focus); }
  .narrow { width: 240px; display: grid; grid-template-columns: 1fr; overflow: auto; border: var(--bw) solid var(--line-1); }
  .row300 { width: 300px; display: flex; gap: var(--gap); }
  .slot { width: 160px; height: var(--ctl-h); }
  section[data-testid='split-block'] { grid-column: 1 / -1; }
  .split { width: 600px; height: 120px; display: flex; flex-direction: column; border: var(--bw) solid var(--line-1); }
  .pane { height: 100%; padding: var(--space-3); }
  .vlist { width: 300px; height: 240px; display: flex; flex-direction: column; border: var(--bw) solid var(--line-1); }
  output { font: var(--fs-2) var(--mono); }
</style>
