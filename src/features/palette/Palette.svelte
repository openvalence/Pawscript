<script>
  // The command palette (Ctrl+K). Fuzzy search over every non-hidden command; prefix ':' goes to a time.
  // Enter closes first, then runs, so the command sees the app without us.
  import { ui, hide, modal, fence } from './state.svelte.js';
  import { segments } from './fuzzy.js';
  import { groupByMenu, splitMode, parseTime, resolveTime, paletteContext, settingItems, panelItems, rankResults } from './logic.js';
  import { hereFor } from './here.js';
  import { schemaEntries } from '../../app/settings.svelte.js';
  import { openSettingAt, toggleSetting } from '../settings/logic.js';
  import { nextIndex } from '../../ui/kit/focus.js';
  import { fmtMs } from '../../lib/video.js';
  import Icon from '../../ui/kit/Icon.svelte';
  import Keys from './Keys.svelte';
  import { quickList } from './quick.js';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import './palette.css';

  let { app } = $props();
  let active = $state(-1);
  let listEl = $state();

  const parsed = $derived(splitMode(ui.query));

  function seek(t) {
    app.player.seek(t);
    const v = app.view;
    if (t < v.start || t > v.start + v.span) app.setView({ start: t - v.span * 0.1, span: v.span });
  }

  // rows: {key, head} section headings, or {key, title, hits, hint, keys, disabled, icon, run}
  const rows = $derived.by(() => {
    if (ui.open !== 'palette') return [];
    const { mode, text } = parsed;
    if (mode === 'time') {
      const p = text ? parseTime(text) : null;
      if (!p) return [{ key: 'help', head: text ? `"${text}" is not a time` : 'Type a time: 1:23.5 · 83s · 500ms · +5 · -2s' }];
      const t = resolveTime(p, app.player.timeMs, app.durationMs);
      return [{ key: 'time', title: 'Go to ' + fmtMs(t), hits: [], hint: p.rel ? `${p.rel > 0 ? '+' : '−'}${fmtMs(p.ms)} from ${fmtMs(app.player.timeMs)}` : 'now ' + fmtMs(app.player.timeMs), icon: 'clock', run: () => seek(t) }];
    }
    const all = app.commands.list();
    const list = all.filter((c) => !c.hidden);
    const quick = new Set(quickList(app));   // a bolt on the rows in this tab's Quick menu (Shift+Q)
    const row = (c, hits = [], hint = '') => { const why = c.enabled ? '' : app.commands.whyNot?.(c.id) || '';   // a disabled command's reason replaces the hint
      return { key: c.id, id: c.id, title: c.title, hits, hint: why || hint, why, keys: c.keys.slice(0, 2), disabled: !c.enabled, quick: quick.has(c.id), run: () => app.commands.run(c.id) }; };
    if (!text) {
      // paw-m3b6: what applies here (F1's Here list for this tab) first, then the recent ones, then every menu
      const byId = new Map(all.map((c) => [c.id, c]));
      const here = (hereFor(app).items || []).flatMap((it) => (it.ids || []).filter((id) => byId.has(id)).map((id) => { const c = byId.get(id), what = c.title.toLowerCase().includes(it.what.toLowerCase()) ? '' : it.what;   // a hint that only repeats the title goes
        return { ...row(c, [], what), key: 'here-' + id, dup: true }; }));
      const recent = app.commands.recent.filter((id) => byId.has(id) && !byId.get(id).hidden && id !== 'palette.open').slice(0, 5);
      const out = here.length ? [{ key: 'h-here', head: 'Here' }, ...here] : [];
      if (recent.length) out.push({ key: 'h-recent', head: 'Recently used' }, ...recent.map((id) => ({ ...row(byId.get(id), [], byId.get(id).menu || ''), key: 'r-' + id, dup: true })));
      for (const g of groupByMenu(list)) out.push({ key: 'h-' + g.menu, head: g.menu }, ...g.items.map((c) => row(c)));
      return out;
    }
    // paw-m3b6: settings and panels are results too, under the commands at equal score
    app.settings.values;   // a setting's shown value follows a change
    const extra = [...settingItems(schemaEntries(), (k) => app.settings.get(k)), ...panelItems(app.panels || [])];
    const found = rankResults([...list, ...extra], text, { recent: app.commands.recent, ctx: ui.ctx ?? paletteContext(app) });
    if (!found.length) return [{ key: 'none', head: `No command, setting or panel matches "${text}"` }];
    return found.map(({ item: c, hits }) => (c.kind ? { key: c.id, title: c.title, hits: hits[0], hint: c.kind === 'setting' ? (c.toggle ? 'Enter toggles' : 'Settings') : 'show', icon: c.kind === 'setting' ? 'settings' : c.icon, run: () => (c.kind === 'panel' ? showPanel(c.panel) : openSetting(c)) }
      : row(c, hits[0], c.menu || '')));
  });

  // a panel: brought into view (from the Projects page, the document's tab first, as Settings does)
  function showPanel(id) {
    if (app.tabs?.home && app.tabs.hidden) app.tabs.show(app.tabId);
    app.showPanel(id);
  }
  // a setting: a switch toggles at once; any other opens the Settings panel searched to that row
  // (settings/logic.js: the same as a Prop's Show in Settings and a Quick menu row)
  const openSetting = (c) => (c.toggle ? toggleSetting(app, c.key) : openSettingAt(app, c.key));

  const selectable = (i) => rows[i] && !rows[i].head;
  const at = $derived(selectable(active) ? active : rows.findIndex((r) => !r.head));
  const count = $derived(rows.filter((r) => !r.head && r.id && !r.dup).length);

  $effect(() => {
    at;
    listEl?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' });
  });

  async function pick(r) {
    if (!r || r.head) return;
    if (r.disabled) { app.toast(r.why ? `${r.title}: ${r.why}` : `${r.title} is not available right now`, r.why ? 'info' : 'quiet'); return; }
    await hide();
    r.run();
  }

  function onkeydown(e) {
    if (e.isComposing) return;
    const nav = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(e.key) && !e.altKey;
    if (nav) {
      const n = nextIndex(rows.length, at, e.key, { disabled: (i) => !selectable(i), page: 8, loop: e.key === 'ArrowDown' || e.key === 'ArrowUp' });
      if (n != null) active = n;
    } else if (e.key === 'Enter') pick(rows[at]);
    else if (e.key === 'Escape') hide();
    else if (e.key === 'Tab') { /* focus stays in the field */ }
    else return fence(app, e);
    e.preventDefault();
    e.stopPropagation();
  }
</script>

{#if ui.open === 'palette'}
  <dialog class="pp-dialog" aria-label="Command palette" {@attach modal} {onkeydown}
          oncancel={(e) => { e.preventDefault(); hide(); }}
          onpointerdown={(e) => e.target === e.currentTarget && hide()}>
    <div class="pp-box pal">
      <div class="bar">
        <span class="mode" data-mode={parsed.mode}>{#if parsed.mode === 'time'}<Icon name="clock" size={14} />{:else}<Icon name="search" size={14} />{/if}</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input class="q" type="text" autofocus spellcheck="false" autocomplete="off" placeholder="Command, setting or panel · : time"
               role="combobox" aria-expanded="true" aria-controls="pp-list" aria-activedescendant={at >= 0 ? 'pp-o-' + at : undefined} aria-autocomplete="list"
               bind:value={ui.query} oninput={() => (active = -1)} />
      </div>
      <ul class="list k-scroll" id="pp-list" role="listbox" aria-label="Commands" bind:this={listEl}>
        {#each rows as r, i (r.key)}
          {#if r.head}
            <li class="sec k-caps" role="presentation">{r.head}</li>
          {:else}
            <!-- svelte-ignore a11y_click_events_have_key_events (the combobox input drives the keyboard) -->
            <li id={'pp-o-' + i} class="k-item row" role="option" aria-selected={i === at} aria-disabled={r.disabled ? 'true' : undefined}
                data-active={i === at || undefined} data-command={r.id} onpointermove={() => (active = i)} onclick={() => pick(r)}>
              <span class="ico">{#if r.icon}<Icon name={r.icon} size={14} />{:else if r.quick}<span class="quick" {@attach tooltip('In the Quick menu (right-click to remove)')}><Icon name="bolt" size={12} /></span>{/if}</span>
              <span class="k-item-label">{#each segments(r.title, r.hits) as s, j (j)}{#if s.on}<mark>{s.t}</mark>{:else}{s.t}{/if}{/each}{#if r.hint}<span class="hint">{r.hint}</span>{/if}</span>
              <span class="k-item-keys">{#each r.keys || [] as k, i (k)}{#if i}<span class="pp-or">/</span>{/if}<Keys keys={k} />{/each}</span>
            </li>
          {/if}
        {/each}
      </ul>
      <footer class="foot k-hint">
        <span><Keys keys="ArrowUp" /><Keys keys="ArrowDown" /> select</span>
        <span><Keys keys="Enter" /> run</span>
        <span><Keys keys="Escape" /> close</span>
        <span class="grow"></span>
        {#if parsed.mode === 'commands'}<span>{count} command{count === 1 ? '' : 's'}</span>{/if}
      </footer>
    </div>
  </dialog>
{/if}

<style>
  .pal { width: min(600px, calc(100vw - 32px)); max-height: min(520px, calc(100vh - 20vh)); margin-top: 12vh; }
  .bar { display: flex; align-items: center; gap: var(--space-4); height: 40px; padding: 0 var(--space-5); border-bottom: 1px solid var(--line-1); flex: none; }
  .mode { color: var(--tx-mut); display: grid; place-items: center; }
  .mode[data-mode='time'] { color: var(--accent-ink); }
  .q { flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; outline: none; background: transparent; color: var(--tx-hi); font: var(--fs-4) var(--font); }
  .q::placeholder { color: var(--tx-mut); }
  .list { list-style: none; margin: 0; padding: var(--space-2) 0; flex: 1 1 auto; min-height: 0; }
  .sec { padding: var(--space-4) var(--space-5) var(--space-2); user-select: none; }
  .sec:first-child { padding-top: var(--space-2); }
  .row { grid-template-columns: 16px minmax(0, 1fr) auto; min-height: 28px; padding: 0 var(--space-5) 0 var(--space-4); }
  .ico { color: var(--tx-mut); display: grid; place-items: center; }
  .quick { display: grid; color: var(--accent-ink); }
  .k-item-label mark { background: none; color: var(--accent-ink); font-weight: 500; text-decoration: underline; text-decoration-color: rgba(var(--reality-rgb), .45); text-underline-offset: 2px; }
  .row[aria-disabled='true'] mark { color: inherit; text-decoration-color: currentColor; }
  .hint { margin-left: var(--space-4); color: var(--tx-mut); font-size: var(--fs-2); }
  .row[aria-disabled='true'] .hint { color: var(--tx-ghost); }
  .row[aria-selected='true'] { color: var(--tx-hi); }   /* the kit inks aria-selected as "chosen"; here it is only the active row */
  .row[aria-selected='true'][aria-disabled='true'] { color: var(--tx-ghost); }
  .k-item-keys { display: inline-flex; align-items: center; gap: var(--space-2); }
  .foot { display: flex; align-items: center; gap: var(--space-5); padding: var(--space-3) var(--space-5); border-top: 1px solid var(--line-1); flex: none; }
  .foot span { display: inline-flex; align-items: center; gap: var(--space-2); }
  .grow { flex: 1; }
</style>
