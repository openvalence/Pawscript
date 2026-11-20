<script>
  import { tooltip } from '../ui/kit/tooltip.js';
  // The top bar: logo, menus built from the command registry (menu/group on each command), the stage tabs,
  // the tabs (home + the open document), quick undo/redo and the palette button.
  import MenuBar from '../ui/kit/MenuBar.svelte';
  import SegmentedControl from '../ui/kit/SegmentedControl.svelte';
  import IconButton from '../ui/kit/IconButton.svelte';
  import Icon from '../ui/kit/Icon.svelte';
  import glyph from '../assets/brand/pawscript-glyph.svg?raw';
  import { fmtKeys } from './keymap.js';
  import { menuModel } from './menus.js';
  import { cmd } from './cmd.js';

  let { app } = $props();
  // the tabs, stages of the job (paw-ef73.1); keys from the registry so a rebinding shows
  const TABS = [['scenes', 'Scenes', 'detect, describe and fix cuts, shots, loops: a clean timeline'], ['track', 'Track', 'seed and track the shots, check the direction'],
    ['refine', 'Refine', 'hand editing, transforms and modifiers'], ['review', 'Review', 'problems, statistics, compare']];
  // paw-m3b6: each segment is its mode.* command (the click runs it, its key and the right-click contract from the registry)
  const MODES = $derived(TABS.map(([value, label, what]) => ({ value, label, tip: `${label}: ${what}`, shortcut: app.commands.keysFor('mode.' + value)[0] || '', command: 'mode.' + value })));

  // Items are rebuilt only when the registry or key bindings change: list({enabled:false}) evaluates no `when`,
  // and `disabled` is a getter, so predicates run only while a menu is open (never at playback rate).
  const menus = $derived.by(() => {
    const toItem = (c, label) => ({ id: c.id, command: c.id, label, get tip() { return (!app.commands.enabled(c.id) && app.commands.whyNot?.(c.id)) || c.tip; }, shortcut: c.keys[0] ? fmtKeys(c.keys[0]) : undefined, get disabled() { return !app.commands.enabled(c.id); }, run: () => app.commands.run(c.id) });
    return menuModel(app.commands.list({ enabled: false }), toItem, { dev: !!import.meta.env?.DEV }).map((m) => {
      if (m.label === 'File' && app.project?.recent?.length) {
        m.items.push({ separator: true }, { label: 'Open recent', items: app.project.recent.slice(0, 10).map((r) => ({ label: r.name + (r.missing ? ' (missing)' : ''), disabled: r.missing, run: () => app.commands.run('file.openRecent', { path: r.path }) })) });
      }
      return m;
    });
  });
  const ext = (n) => (/\.[^.]+$/.exec(n) || [''])[0];
  const stem = (n) => n.slice(0, n.length - ext(n).length);
  const name = $derived(app.project?.name || app.doc.media?.name || (Object.keys(app.doc.axes).length ? 'Untitled' : ''));
  // no unsaved mark: the project is written as it changes (paw-up1r)
  $effect(() => { app.backend.setTitle?.((name ? name + ' — ' : '') + 'Pawscript'); });

  // the tabs (paw-shgb): home (the project page) and one per open document, each its own app (t.app); tabs.svelte.js holds
  // which one shows. Click shows, middle-click or the x closes (no question: the project is written as it changes), a drag
  // along the strip reorders.
  const tabs = $derived(app.tabs);
  const k = (id) => fmtKeys(app.commands.keysFor(id)[0] || '');
  const undoTip = $derived(app.history.canUndo ? 'Undo ' + app.history.undoLabel : 'Nothing to undo');
  const redoTip = $derived(app.history.canRedo ? 'Redo ' + app.history.redoLabel : 'Nothing to redo');
  const docName = (a) => tabs.nameOf(a) || 'Untitled';
  /** The background work of a document (status bar tasks): {frac 0..1 | null (not known yet), label} or null. */
  const work = (a) => { const t = a.tasks.find((x) => x.total > 0) || a.tasks[0]; return t ? { frac: t.total > 0 ? Math.min(1, t.done / t.total) : null, label: t.label } : null; };
  const RING = 2 * Math.PI * 5;
  const close = (a) => tabs.close(a);
  // drag to reorder: pointer events (the webview's HTML drag and drop belongs to file drops)
  let drag = null;
  function pressTab(e, id) {
    if (e.button !== 0) return;
    drag = { id, x: e.clientX, moved: false };
  }
  function moveTab(e) {
    if (!drag || !(e.buttons & 1)) { drag = null; return; }
    if (!drag.moved && Math.abs(e.clientX - drag.x) < 6) return;
    drag.moved = true;
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-tab-id]'), id = over?.dataset.tabId;
    if (!id || id === drag.id) return;
    const r = over.getBoundingClientRect(), ids = tabs.list.map((t) => t.id);
    const before = e.clientX < r.left + r.width / 2 ? id : ids[ids.indexOf(id) + 1] ?? null;
    if (before !== drag.id && ids[ids.indexOf(drag.id) + 1] !== before) tabs.move(drag.id, before);
  }
  const endTab = (e) => { if (drag?.moved) e.preventDefault(); setTimeout(() => { drag = null; }, 0); };
</script>

<svelte:window onpointermove={moveTab} onpointerup={endTab} />

<header class="top">
  <div class="left">
    <span class="brand" role="img" aria-label="Pawscript" {@attach tooltip("Pawscript")}>{@html glyph}</span>
    <MenuBar {menus} label="Application menu" class="menus" />
    <!-- the stages mean nothing on the project page: hidden there, their place kept so nothing moves -->
    <div class="stages" class:off={tabs.home} inert={tabs.home}><SegmentedControl options={MODES} value={app.mode} size="sm" label="Stage" onchange={(m) => app.commands.run('mode.' + m)} /></div>
  </div>
  <div class="tabs" role="tablist" aria-label="Open">
    <button class="tab t-home" class:on={tabs.home} role="tab" aria-selected={tabs.home} data-testid="tab-home" onclick={() => tabs.show('home')}
      {@attach tooltip(tabs.home ? 'Projects' : `Projects: every project${k('tabs.next') ? ` (${k('tabs.next')})` : ''}`)}>
      <Icon name="grid" size={14} /><span class="lbl">Projects</span>
    </button>
    {#each tabs.list as t (t.id)}
      {@const a = t.app}
      {@const n = docName(a)}
      {@const w = t.parked?.loading ? { frac: null, label: 'Opening' } : tabs.active !== t.id ? work(a) : null}
      <div class="tab t-doc" class:on={tabs.active === t.id} class:parked={!!t.parked} data-testid="tab-doc" data-tab-id={t.id}>
        <button class="go" role="tab" aria-selected={tabs.active === t.id} onclick={() => { if (!drag?.moved) tabs.show(t.id); }}
          onpointerdown={(e) => pressTab(e, t.id)} onauxclick={(e) => { if (e.button === 1) { e.preventDefault(); close(a); } }} onmousedown={(e) => { if (e.button === 1) e.preventDefault(); }}
          {@attach tooltip([a.project?.path || a.doc.media?.path || t.parked?.key || n, w ? w.label : t.parked ? 'Not in memory: opens from disk when shown' : ''].filter(Boolean).join('\n'))}>
          {#if w}
            <svg class="ring" class:spin={w.frac == null} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" data-testid="tab-ring" data-frac={w.frac ?? ''}>
              <circle cx="6" cy="6" r="5" class="track" /><circle cx="6" cy="6" r="5" class="arc" transform="rotate(-90 6 6)" stroke-dasharray="{(w.frac ?? 0.3) * RING} {RING}" />
            </svg>
          {/if}
          <span class="nm">{stem(n)}<span class="ext">{ext(n)}</span></span>
        </button>
        <button class="x" aria-label="Close {n}" data-testid="tab-close" onclick={() => close(a)} {@attach tooltip('Close', k('file.close'))}><Icon name="close" size={12} /></button>
      </div>
    {/each}
  </div>
  <div class="acts">
    <IconButton icon="undo" size="sm" label={undoTip} {...cmd(app, 'edit.undo', undefined, { tip: undoTip })} />
    <IconButton icon="redo" size="sm" label={redoTip} {...cmd(app, 'edit.redo', undefined, { tip: redoTip })} />
    {#if app.commands.get('palette.open')}
      <IconButton icon="search" size="sm" label="Command palette" {...cmd(app, 'palette.open', undefined, { tip: 'Command palette' })} />
    {/if}
  </div>
</header>

<style>
  /* the middle column (the tabs) is the one that gives: the menus and mode switch never overlap themselves */
  .top { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--space-5); height: calc(var(--ctl-h) + 8px); padding: 0 var(--space-3) 0 var(--space-4); background: var(--bg-raised); border-bottom: 1px solid var(--line-1); user-select: none; }
  .left { display: flex; align-items: center; gap: var(--space-4); min-width: 0; }
  .brand { display: grid; place-items: center; color: var(--highlight); }
  .stages.off { visibility: hidden; }

  /* tabs: the shown one is cut out of the bar into the page below it (its colour, no bottom edge) */
  /* a tab runs from just under the bar's top to the page; its text sits on the menus' line (padding-bottom = the top gap) */
  .tabs { align-self: stretch; display: flex; justify-content: center; gap: var(--space-1); min-width: 0; padding-top: 4px; margin-bottom: -1px; font-size: var(--fs-3); }
  .tab { position: relative; display: flex; align-items: center; padding-bottom: 5px; border: 1px solid transparent; border-bottom: 0; border-radius: var(--radius) var(--radius) 0 0; color: var(--tx-mut); min-width: 0; }
  .tab:hover { color: var(--tx); background: var(--bg-hover); }
  .tab.on { color: var(--tx-hi); background: var(--bg); border-color: var(--line-1); }
  .tab.on::after { content: ''; position: absolute; left: 6px; right: 6px; top: -1px; height: 2px; border-radius: 0 0 2px 2px; background: var(--reality); }
  .t-home { flex: none; gap: var(--space-3); padding-inline: var(--space-5); }
  .t-home.on :global(svg) { color: var(--reality); }
  .t-doc { flex: 0 1 auto; max-width: 460px; }
  .go { display: flex; align-items: center; gap: var(--space-3); min-width: 0; height: 100%; padding: 0 var(--space-2) 0 var(--space-5); color: inherit; }
  .tab button:focus-visible { outline: var(--ring-w) solid var(--focus); outline-offset: -2px; border-radius: var(--radius); }
  .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .ext { color: var(--tx-mut); }
  .t-doc.parked .nm { font-style: italic; }   /* not in memory (tabs.svelte.js parking): opens from disk when shown */
  /* the close cross: on hover / focus / the shown tab, its room always kept so the name never jumps */
  .x { flex: none; display: grid; place-items: center; width: 18px; height: 18px; margin-right: var(--space-3); border-radius: var(--radius); color: var(--tx-mut); opacity: 0; }
  .tab:hover .x, .tab.on .x, .x:focus-visible { opacity: 1; }
  .x:hover { color: var(--tx-hi); background: var(--bg-active); }
  .ring { flex: none; color: var(--reality); }
  .ring circle { fill: none; stroke: currentColor; stroke-width: 2; }
  .ring .track { opacity: .25; }
  .ring .arc { stroke-linecap: round; transition: stroke-dasharray var(--t-quick); }
  .ring.spin { animation: spin calc(var(--t-slow) * 4) linear infinite; }
  @keyframes spin { to { rotate: 360deg; } }
  .acts { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-1); }
  @media (max-width: 1000px) { .left { gap: var(--space-3); } .t-home { padding-inline: var(--space-4); } .t-home .lbl { display: none; } }
</style>
