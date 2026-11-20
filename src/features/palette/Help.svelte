<script>
  // Shortcut help (F1, ?): on top "Here: <tab>", the keys for what you are doing now (here.js: the old Scenes hint line, the
  // project page's tips; paw-idb5), then every command that has keys, grouped by menu and group, in columns, filterable.
  // Conflicts are flagged: amber when a user binding is involved, muted when two defaults share a key (their
  // `when` decides which runs).
  import { ui, hide, modal, fence } from './state.svelte.js';
  import { match } from './fuzzy.js';
  import { groupByMenu, conflictsById, describeConflict } from './logic.js';
  import { fmtKeys } from '../../app/keymap.js';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import Icon from '../../ui/kit/Icon.svelte';
  import Keys from './Keys.svelte';
  import { hereFor } from './here.js';
  import QuickStart from '../onboard/QuickStart.svelte';
  import { helpPage } from '../onboard/steps.js';
  import './palette.css';

  let { app } = $props();
  let q = $state('');
  let body = $state();

  $effect(() => { if (ui.open === 'help') q = ''; });

  const all = $derived(ui.open === 'help' ? app.commands.list({ enabled: false }).filter((c) => !c.hidden) : []);
  const titles = $derived(new Map(all.map((c) => [c.id, c.title])));
  const conf = $derived(ui.open === 'help' ? conflictsById(app.commands.conflicts({ all: true })) : new Map());
  // for a shared key: which command it runs in the context the help was opened from (the overlays' own commands aside)
  const OWN = ['palette.close', 'palette.open', 'palette.help', 'palette.keys'];
  const winner = (keys) => app.commands.winner?.(keys, OWN);
  const groups = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    const list = all.filter((c) => c.keys.length && (!needle || match(needle, [c.title, c.menu, c.id]) || c.keys.some((k) => fmtKeys(k).toLowerCase().includes(needle))));
    return groupByMenu(list);
  });
  const total = $derived(groups.reduce((n, g) => n + g.items.length, 0));
  // read when the overlay opens: what applied in the place it was opened from
  const here = $derived(ui.open === 'help' ? hereFor(app) : null);
  // paw-kxwz: two pages, the quick start (docs/guide/quick-start.md) and the shortcuts; the last one picked is kept
  const page = $derived(helpPage(app.settings));
  const pick = (p) => app.settings.set('help.page', p);

  function notes(c) {
    const list = conf.get(c.id);
    if (!list) return null;
    const user = list.some((x) => x.ids.some((id) => app.commands.isOverridden(id)));
    const lines = list.map((x) => {
      const t = describeConflict(x, c.id, c.keys, (id) => titles.get(id) || id);
      if (x.kind === 'prefix') return t;
      const w = winner(x.keys);
      return t + (w === c.id ? ' — right now this one runs' : w ? ` — right now: ${titles.get(w) || w}` : ' — right now: none applies');
    });
    return { user, text: lines.join('\n') };
  }

  function onkeydown(e) {
    if (e.isComposing) return;
    const step = { ArrowDown: 40, ArrowUp: -40, PageDown: body?.clientHeight * 0.9, PageUp: -body?.clientHeight * 0.9 }[e.key];
    if (step && !e.altKey) body?.scrollBy({ top: step });
    else if (e.key === 'Escape') hide();
    else if (e.key === 'Tab') return e.stopPropagation();
    else return fence(app, e);
    e.preventDefault();
    e.stopPropagation();
  }
</script>

{#if ui.open === 'help'}
  <dialog class="pp-dialog" aria-labelledby="ph-title" {@attach modal} {onkeydown}
          oncancel={(e) => { e.preventDefault(); hide(); }}
          onpointerdown={(e) => e.target === e.currentTarget && hide()}>
    <div class="pp-box help">
      <header>
        <h2 id="ph-title" class="k-caps">{page === 'start' ? 'Quick start' : `Keyboard shortcuts · ${app.commands.preset === 'ofs' ? 'OFS' : 'Blender'} keymap`}</h2>
        <span class="pages" role="group" aria-label="Help page">
          <button class="pp-btn ghost" class:on={page === 'start'} aria-pressed={page === 'start'} data-testid="help-page-start" onclick={() => pick('start')}>Quick start</button>
          <button class="pp-btn ghost" class:on={page === 'keys'} aria-pressed={page === 'keys'} data-testid="help-page-keys" onclick={() => pick('keys')}>Shortcuts</button>
        </span>
        {#if page === 'keys'}
          <label class="pp-search find"><Icon name="search" size={12} />
            <!-- svelte-ignore a11y_autofocus -->
            <input type="text" autofocus spellcheck="false" placeholder="Filter by name or key" aria-label="Filter shortcuts" bind:value={q} /></label>
          <span class="k-hint">{total} shortcut{total === 1 ? '' : 's'}</span>
        {/if}
        <span class="grow"></span>
        <button class="pp-btn" data-command="palette.keys" onclick={() => app.commands.run('palette.keys')}>Edit shortcuts {#each app.commands.keysFor('palette.keys').slice(0, 1) as k (k)}<Keys keys={k} />{/each}</button>
        <button class="pp-btn ghost sq" aria-label="Close" {@attach tooltip('Close', 'Escape')} onclick={hide}><Icon name="close" size={14} /></button>
      </header>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="body k-scroll" bind:this={body} tabindex="0" aria-label={page === 'start' ? 'Quick start' : 'Shortcut list'}>
        {#if page === 'start'}<QuickStart />{:else}
        {#if here?.items.length && !q.trim()}
          <section class="here" data-testid="help-here" data-place={here.place}>
            <h3 class="k-caps">{here.title}</h3>
            <div class="here-list">
              {#each here.items as it, i (i)}
                <div class="row" class:off={it.off}>
                  <span class="keys">{#each it.keys as k, j (k + j)}{#if j}<span class="pp-or">/</span>{/if}<Keys keys={k} />{/each}</span>
                  <span class="t">{it.what}</span>
                </div>
              {/each}
            </div>
          </section>
        {/if}
        {#if !total}<p class="empty k-hint">No shortcut matches "{q}".</p>{/if}
        <div class="cols">
          {#each groups as g (g.menu)}
            <section>
              <h3 class="k-caps">{g.menu}</h3>
              {#each g.items as c, i (c.id)}
                {@const n = notes(c)}
                {#if i && (c.group || '') !== (g.items[i - 1].group || '')}<div class="gap"></div>{/if}
                <div class="row">
                  <span class="t">{c.title}</span>
                  <span class="keys" class:pp-warn={n?.user}>
                    {#if n}<span class="flag" class:pp-warn={n.user} class:pp-info={!n.user} {@attach tooltip(n.text)} aria-label={n.text}><Icon name={n.user ? 'warning' : 'info'} size={12} /></span>{/if}
                    {#each c.keys as k, j (k)}{#if j}<span class="pp-or">/</span>{/if}<Keys keys={k} />{/each}
                  </span>
                </div>
              {/each}
            </section>
          {/each}
        </div>
        {/if}
      </div>
      {#if page === 'keys'}
      <footer class="k-hint">
        <span><Icon name="warning" size={12} class="pp-warn" /> a binding you set collides with another</span>
        <span><Icon name="info" size={12} /> defaults share a key; the one that applies right now runs</span>
        <span class="grow"></span>
        <span>Typing in a field: only Esc, F-keys and Ctrl/Alt chords reach commands</span>
      </footer>
      {/if}
    </div>
  </dialog>
{/if}

<style>
  .help { width: min(1120px, calc(100vw - 48px)); height: min(760px, calc(100vh - 48px)); margin: auto; }
  header { display: flex; align-items: center; gap: var(--space-5); padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--line-1); flex: none; }
  h2 { color: var(--tx-val); font-size: var(--fs-2); }
  .find { width: 240px; }
  .pages { display: inline-flex; gap: 2px; }
  .pages .on { color: var(--tx-hi); background: var(--bg-raised); }
  .grow { flex: 1; }
  .sq { width: var(--ctl-h-sm); padding: 0; }
  .body { flex: 1; min-height: 0; padding: var(--space-5) var(--space-6); outline: none; }
  .body:focus-visible { box-shadow: inset 0 0 0 var(--ring-w) var(--focus); }
  .cols { columns: 260px; column-gap: var(--space-8); }
  section { margin-bottom: var(--space-6); }
  h3 { break-after: avoid; margin: 0 0 var(--space-3); padding-bottom: var(--space-2); border-bottom: 1px solid var(--line-1); color: var(--tx-val); }
  .gap { height: 1px; margin: var(--space-2) 0; background: var(--line-0); }
  .row { display: flex; align-items: center; gap: var(--space-4); min-height: 22px; break-inside: avoid; }
  .t { flex: 1; min-width: 0; color: var(--tx); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-2); }
  .keys { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--tx-val); flex: none; }
  .flag { display: grid; place-items: center; cursor: help; }
  .empty { padding: var(--space-6) 0; }
  .here { margin-bottom: var(--space-7); }
  .here-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 0 var(--space-8); }
  .here .row { gap: var(--space-4); }
  .here .keys { min-width: 96px; justify-content: flex-end; }
  .here .row.off { opacity: .45; }
  footer { display: flex; align-items: center; gap: var(--space-6); padding: var(--space-3) var(--space-5); border-top: 1px solid var(--line-1); flex: none; }
  footer span { display: inline-flex; align-items: center; gap: var(--space-2); }
  footer :global(.pp-warn) { color: var(--warn-ink); }
</style>
