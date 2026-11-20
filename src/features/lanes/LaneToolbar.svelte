<script>
  // The lanes' toolbar. It never clips a control: as the panel narrows, Rec/Tap lose their words (< 680 px), the
  // Snap menu and the view toggles fold into one "View options" menu (< 560 px), the latency field goes (< 420 px),
  // then Add axis (< 300 px; it stays in the Edit menu), and the axis chips become a Select once they no longer fit.
  // Between the axis chips and Snap: the Scene, Shot and Tracker chips (timeline SceneChips, when that feature is there:
  // one-line summaries, each opening a popover with its controls; paw-hmn). The toolbar stays one line.
  import { onMount } from 'svelte';
  import Toolbar from '../../ui/kit/Toolbar.svelte';
  import Chip from '../../ui/kit/Chip.svelte';
  import Button from '../../ui/kit/Button.svelte';
  import IconButton from '../../ui/kit/IconButton.svelte';
  import ToggleButton from '../../ui/kit/ToggleButton.svelte';
  import Prop from '../../app/Prop.svelte';
  import Select from '../../ui/kit/Select.svelte';
  import Menu from '../../ui/kit/Menu.svelte';
  import Icon from '../../ui/kit/Icon.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { fmtKeys } from '../../app/keymap.js';
  import { lanes, KNOWN_AXES } from './state.svelte.js';
  import { axisSeries } from './render.js';
  import { MODES, MODE_LABEL } from './elements.js';
  const QuickBar = Object.values(import.meta.glob('../timeline/SceneChips.svelte', { eager: true }))[0]?.default ?? null;
  // paw-k8pe: the run's tool settings (tracking RunBar) sit after the Track cog inside the chips; with no scenes (no chips) here
  const RunBar = Object.values(import.meta.glob('../tracking/RunBar.svelte', { eager: true }))[0]?.default ?? null;

  let { app } = $props();
  const L = $derived(lanes(app));
  const ids = $derived(L.ids());
  const rec = $derived(L.rec);
  const snap = $derived(L.snap);

  // ---- width levels (px of the toolbar) ----
  let w = $state(0), restW = $state(0), chipsEl = $state(), chipsW = $state(0);
  const wordyRec = $derived(w >= 680);
  const fold = $derived(w > 0 && w < 560);
  const showLat = $derived(w === 0 || w >= 420);
  const showAdd = $derived(w === 0 || w >= 300);   // below that Add axis stays in the Edit menu and the palette
  // paw-5zpf: the selection mode and pivot controls only on a wide toolbar (they would push the Scene / Shot chips and the run's
  // controls out); narrower, the keys (1-4, .), the Edit menu and the lane menu still pick them
  const showModes = $derived(w === 0 || w >= 1300);
  // chips' natural width, measured while they are shown (re-measured when the axes change or the fonts arrive)
  const idKey = $derived(ids.join());
  $effect(() => { idKey; chipsW = 0; });
  onMount(() => { document.fonts?.ready.then(() => (chipsW = 0)); });
  $effect(() => { if (chipsEl && !chipsW) chipsW = chipsEl.scrollWidth; });
  const chipSelect = $derived(chipsW > 0 && w > 0 && chipsW > w - restW - 64);

  // ---- menus (one kit Menu, three item lists) ----
  let menu = $state(null), anchor = $state(null);   // menu: 'add' | 'snap' | 'view' | null
  const keys = (id) => fmtKeys(app.commands.keysFor?.(id)?.[0] || '');
  const run = (id) => app.commands.run(id);
  const check = (id, label, on) => ({ id, label, type: 'checkbox', checked: !!on, shortcut: keys(id) || undefined, run: () => run(id) });
  const snapItems = $derived([
    check('lanes.toggleSnap', 'Snap to frames', snap.frames),
    check('lanes.toggleSnapGhosts', 'Snap to ghost extremes', snap.ghosts),
    check('lanes.toggleSnapCuts', 'Snap to scene cuts', snap.cuts),
    check('lanes.toggleDragScrub', 'Scrub while dragging a point', L.dragScrub),
    check('lanes.toggleHoverScrub', 'Scrub on hover (playhead follows the mouse)', L.hoverScrub),
  ]);
  const viewItems = $derived([
    check('lanes.toggleSpeedColors', 'Speed colours on the focused lane', L.speedColors),
    check('lanes.toggleGhosts', 'Show ghosts', L.showGhosts),
    check('lanes.toggleHoverThumb', 'Frame thumbnail on hover', L.hoverThumb),
    check('lanes.togglePush', 'Push: dragging moves the following points', L.push),
    check('view.follow', 'Follow playhead', app.follow),
    { id: 'clean', label: 'Clean joins (micro glitches at accepts and stitches)', type: 'checkbox', checked: cleanOn, run: () => S.set('edit.cleanMicro', !cleanOn) },
  ]);
  const addItems = $derived.by(() => {
    const free = KNOWN_AXES.filter((a) => !(a in app.doc.axes));
    return free.length
      ? free.map((a) => ({ id: a, label: a, run: () => app.commands.run('lanes.addAxis', { axis: a }) }))
      : [{ label: 'All axes added', disabled: true }];
  });
  const items = $derived(menu === 'add' ? addItems : menu === 'snap' ? snapItems
    : [{ section: 'Snap' }, ...snapItems, { section: 'View' }, ...viewItems]);
  const LABELS = { add: 'Add axis', snap: 'Snap', view: 'View options' };
  function toggleMenu(kind, e) { anchor = e.currentTarget; menu = menu === kind ? null : kind; }
  // a button's tooltip stays off while its menu is open (it would sit under the menu)
  const tipFor = (kind, text) => (menu === kind ? '' : text);
  const anySnap = $derived(snap.frames || snap.ghosts || snap.cuts);
  // join cleanup (settings edit.cleanMicro*, core/script.js cleanMicro): a toggle and, while on, its two thresholds as scrub pills
  const S = $derived(app.settings);
  const cleanOn = $derived(S.get('edit.cleanMicro') !== false);
  const CLEAN_TIP = 'Clean joins: after a stitch, a live run joining the points around it or a modifiers bake, wiggles near the join smaller than the two pills go';
  // paw-5zpf: the selection mode (setting lanes.selectMode) as Blender's header buttons; a pick runs its command (the selection converts)
  const MODE_ICON = { point: 'dot', segment: 'minus', stroke: 'stroke', cycle: 'wave' };
  const modeOpts = $derived(MODES.map((m) => ({ value: m, label: `${MODE_LABEL[m]} select`, icon: MODE_ICON[m], command: 'lanes.mode.' + m,
    tip: `${MODE_LABEL[m]} select: ${(app.commands.get('lanes.mode.' + m)?.tip || '').replace(/^A click/, 'a click')}`, shortcut: keys('lanes.mode.' + m) })));
</script>

{#snippet tog(on, icon, label, id)}
  <ToggleButton size="sm" {icon} {label} shortcut={keys(id)} data-command={id} bind:pressed={() => !!on, () => run(id)} />
{/snippet}
{#snippet recBtn(mode, icon, text, tip, id)}
  {#if wordyRec}
    <ToggleButton size="sm" {icon} class="rec" {tip} shortcut={keys(id)} data-command={id} bind:pressed={() => rec?.mode === mode, () => run(id)}>{text}</ToggleButton>
  {:else}
    <ToggleButton size="sm" {icon} class="rec" label={tip} shortcut={keys(id)} data-command={id} bind:pressed={() => rec?.mode === mode, () => run(id)} />
  {/if}
{/snippet}

<div class="tb" bind:clientWidth={w}>
  <Toolbar label="Lanes" class="lt">
    {#if chipSelect}
      <Select size="sm" label="Lane" options={ids.map((id) => ({ value: id, label: id }))}
        bind:value={() => app.doc.activeAxis, (v) => app.setActiveAxis(v)} />
    {:else}
      <span class="chips" bind:this={chipsEl}>
        {#each ids as id, i (id)}
          <Chip color={axisSeries(id)} bind:selected={() => app.doc.activeAxis === id, () => app.setActiveAxis(id)}
            {@attach tooltip(`Focus ${id} lane`, i < 9 ? keys('lanes.focusLane' + (i + 1)) : '')}>{id}</Chip>
        {/each}
      </span>
    {/if}
    {#if showAdd}
      <IconButton size="sm" icon="add" label="Add axis" tip={tipFor('add', 'Add axis')} aria-haspopup="menu" aria-expanded={menu === 'add'}
        onclick={(e) => toggleMenu('add', e)} />
    {/if}
    {#if showModes}
    <span class="k-sep"></span>
    <Prop {app} key="lanes.selectMode" expand iconOnly options={modeOpts} label="Select mode" data-testid="lanes-selmode"
      store={(v) => { run('lanes.mode.' + v); return v; }} />
    <Prop {app} key="lanes.pivot" label="Pivot" data-testid="lanes-pivot"
      tip={`Pivot: what scale (S) and rotate (R) work about${keys('lanes.pivotMenu') ? ` · ${keys('lanes.pivotMenu')} opens the choices at the pointer` : ''}`} />
    {/if}
    {#if QuickBar && app.doc.scenes?.length}<span class="k-sep"></span><span class="qbw"><QuickBar {app} /></span>
    {:else if RunBar}<span class="rbw"><RunBar {app} /></span>{/if}
    <span class="sp"></span>
    <span class="rest" bind:offsetWidth={restW}>
      {#if fold}
        <IconButton size="sm" icon="sliders" label="View options" tip={tipFor('view', 'Snapping, speed colors, ghosts, push, follow')}
          aria-haspopup="menu" aria-expanded={menu === 'view'} onclick={(e) => toggleMenu('view', e)} />
      {:else}
        <Button size="sm" variant="ghost" icon={anySnap ? 'magnet' : 'magnet-off'} iconRight="chevron-down" tip={tipFor('snap', 'Snap: frames, ghost extremes, scene cuts')}
          aria-haspopup="menu" aria-expanded={menu === 'snap'} onclick={(e) => toggleMenu('snap', e)}>Snap</Button>
        <span class="k-sep"></span>
        {@render tog(L.speedColors, 'heatmap', 'Speed colours on the focused lane', 'lanes.toggleSpeedColors')}
        {@render tog(L.showGhosts, 'layers', 'Show ghosts', 'lanes.toggleGhosts')}
        {@render tog(L.push, 'move', 'Push: dragging moves the following points', 'lanes.togglePush')}
        {@render tog(app.follow, 'target', 'Follow playhead', 'view.follow')}
        <span class="k-sep"></span>
        <!-- the settings themselves (app/Prop.svelte): the widget, tooltip and right click they have in Settings too -->
        <Prop {app} key="edit.cleanMicro" icon="wand" label="Clean joins" tip={CLEAN_TIP} />
        {#if cleanOn}
          <span class="clean">
            <Prop {app} key="edit.cleanMicroMs" label="Clean joins: wiggles shorter than" tip="Clean joins: wiggles closer than this are glitches" />
            <Prop {app} key="edit.cleanMicroPos" unit="pos" label="Clean joins: wiggles smaller than" tip="Clean joins: wiggles smaller than this are glitches" />
          </span>
        {/if}
      {/if}
      {#if showAdd}<span class="k-sep"></span>{/if}
      {@render recBtn('live', 'record', 'Rec', 'Record live (mouse or the point keys)', 'lanes.record')}
      {@render recBtn('tap', 'keyboard', 'Tap', 'Record by tapping the extremes', 'lanes.recordTap')}
      {#if showLat}
        <span class="lat"><Icon name="timer" size={14} />
          <Prop {app} key="lanes.latencyMs" label="Recording latency" tip="Recording latency offset" /></span>
      {/if}
    </span>
  </Toolbar>
</div>
<Menu bind:open={() => !!menu, (v) => { if (!v) menu = null; }} {anchor} {items} label={LABELS[menu] || 'Menu'} />

<style>
  .tb {
    display: flex; align-items: center; padding: var(--space-2) var(--space-3);
    background: var(--bg-raised); border-bottom: var(--bw) solid var(--line-1); overflow: hidden;
  }
  .tb > :global(*) { flex: 1; min-width: 0; }
  .tb :global(.lt) { flex-wrap: nowrap; }   /* one line: the scene chips shrink (their text elides), the rest folds by width */
  .qbw { flex: 999 1 0; min-width: 120px; display: flex; overflow: hidden; }   /* takes the free width from the spacer */
  .rbw { flex: 999 1 0; min-width: 0; display: flex; overflow: hidden; }
  .chips, .rest { display: flex; align-items: center; gap: var(--space-1); }
  .chips { flex: 0 1 auto; min-width: 0; overflow: hidden; }
  .rest { flex: none; }
  .sp { flex: 1; min-width: var(--gap); }
  .clean { display: inline-flex; align-items: center; gap: var(--space-1); }
  .lat { display: inline-flex; align-items: center; gap: var(--space-1); margin-left: var(--space-1); color: var(--tx-mut); }
  /* recording is live: the record glyph takes the playhead's colour and pulses */
  .tb :global(.rec[aria-pressed='true'] svg) { color: var(--highlight); animation: pulse calc(var(--t-slow) * 3) ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .35; } }
</style>
