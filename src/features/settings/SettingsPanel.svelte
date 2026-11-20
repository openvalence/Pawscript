<!-- SettingsPanel: every preference, generated from the settings schema (app/settings.svelte.js; logic.js picks the rows and
     their controls), so a new setting shows here by being in the schema. Grouped, searchable by name / description / key;
     a changed one is marked and has its own reset; a change applies at once (no Apply). Internal state (layouts, recent
     lists, the tracker view's own options) only under Show advanced. Export / import a settings file and Reset all in the ⋯
     menu. Settings are one object for every tab (paw-shgb); they have no undo. Each control is the setting's Prop (app/Prop.svelte,
     paw-m3b6): the same widget, tooltip and right click (reset, copy, paste, Quick menu) as wherever else the setting shows. -->
<script>
  import { Switch, TextField, IconButton, Button, Menu, EmptyState, Section } from '../../ui/kit/index.js';
  import Prop from '../../app/Prop.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { resetProperty } from '../../ui/kit/contextmenu.js';
  import { fmtKeys } from '../../app/keymap.js';
  import { schemaEntries } from '../../app/settings.svelte.js';
  import { visibleEntries, grouped, withGroup, controlOf, dynamicOptions, isChanged, summary, applySetting } from './logic.js';
  import { exportSettings, importSettings, resetAll } from './files.js';
  import { sheet } from './sheet.svelte.js';
  import { tick } from 'svelte';
  import ModelsList from '../models/ModelsList.svelte';
  import UpdatesGroup from '../updates/UpdatesGroup.svelte';

  let { app } = $props();
  const S = $derived(app.settings);
  let query = $state(''), advanced = $state(false), menuOpen = $state(false), menuBtn = $state();
  const all = schemaEntries();
  const rows = $derived(visibleEntries({ query, advanced, entries: all }));
  // paw-cdot: the Models group is a list of its own (features/models), shown with or without schema rows
  const groups = $derived(withGroup(grouped(rows), 'Models', !query.trim() || /model|download|licen|runtime|folder/i.test(query)));
  const hiddenHits = $derived(!advanced && query.trim() ? visibleEntries({ query, advanced: true, entries: all }).length - rows.length : 0);
  const panic = $derived((app.commands.keysFor('playback.panic') || []).map(fmtKeys).join(' / '));
  // paw-m3b6: the palette's "Setting: …" row opens this panel searched to that setting (its own search, as typed)
  let listEl = $state();
  $effect(() => {
    const f = sheet.find;
    if (!f || f.app !== app) return;
    sheet.find = null;
    if (f.group) {
      query = '';
      tick().then(() => listEl?.querySelector(`[data-group="${f.group}"]`)?.scrollIntoView({ block: 'start' }));
      return;
    }
    const e = all.find((x) => x.key === f.key);
    if (!e) return;
    query = e.label;
    if (e.internal) advanced = true;
    tick().then(() => listEl?.querySelector(`[data-key="${f.key}"]`)?.scrollIntoView({ block: 'nearest' }));
  });

  const value = (key) => (S.values, S.get(key));
  const changed = (key) => (S.values, isChanged(S, key));
  function set(key, v) { if (S.accepts(key, v)) { S.set(key, v); applySetting(app, key); } }
  function reset(key) { S.reset(key); applySetting(app, key); }
  // the row's reset button and its control's right-click Reset to default are one reset (the Prop's); a row without a Prop
  // (folders, read-only summaries) resets here
  const resetRow = (ev, key) => resetProperty(ev.currentTarget.closest('[data-testid="setting"]')?.querySelector('[data-prop]')) || reset(key);
  async function browse(e, list = false) {
    const dir = await app.backend.openDialog?.({ title: e.label, directory: true, multiple: false });
    if (typeof dir !== 'string' || !dir) return;
    set(e.key, list ? [...new Set([...(value(e.key) || []), dir])] : dir);
  }
  const menuItems = [
    { label: 'Export settings…', icon: 'export', run: () => exportSettings(app) },
    { label: 'Import settings…', icon: 'import', run: () => importSettings(app) },
    { separator: true },
    { label: 'Reset all to defaults…', icon: 'refresh', run: () => resetAll(app) },
  ];
</script>

<div class="sp" data-testid="settings-panel">
  <div class="bar">
    <TextField size="sm" bind:value={query} icon="search" clearable placeholder="Search settings" full data-testid="settings-search" />
    <Switch size="sm" checked={advanced} onchange={(v) => (advanced = v)} label="Show advanced" data-testid="settings-advanced" />
    <IconButton icon="more" size="sm" label="Export, import, reset all" aria-haspopup="menu" onclick={(e) => { menuBtn = e.currentTarget; menuOpen = !menuOpen; }} data-testid="settings-menu" />
    <Menu bind:open={menuOpen} anchor={menuBtn} items={menuItems} placement="bottom-end" />
  </div>
  <div class="list" bind:this={listEl}>
    {#each groups as g (g.group)}
      <Section title={g.group} count={g.items.filter((e) => changed(e.key)).length || undefined} data-testid="settings-group" data-group={g.group}>
        {#each g.items as e (e.key)}
          {@const opts = e.options || dynamicOptions(app, e.key)}
          {@const ctl = controlOf(e, opts)}
          {@const ch = changed(e.key)}
          <div class="row" class:changed={ch} class:wide={ctl === 'select' || ctl === 'text' || ctl === 'folder' || ctl === 'folders' || (ctl === 'segmented' && opts.reduce((n, o) => n + String(o.label).length, 0) > 14)} data-testid="setting" data-key={e.key} data-control={ctl}>
            <div class="what">
              <span class="lbl" {@attach tooltip(e.key)}>{e.label}</span>
              <span class="doc k-hint">{e.doc}</span>
            </div>
            <div class="ctl">
              {#if ctl === 'switch' || ctl === 'segmented' || ctl === 'select' || ctl === 'number' || ctl === 'text'}
                <Prop {app} key={e.key} options={opts} full={ctl === 'select' || ctl === 'text'} />
              {:else if ctl === 'folder'}
                <TextField size="sm" full value={value(e.key) || ''} label={e.label} onchange={(v) => set(e.key, v)} />
                {#if ctl === 'folder'}<IconButton icon="folder-open" size="sm" label="Choose a folder" onclick={() => browse(e)} />{/if}
              {:else if ctl === 'folders'}
                <div class="paths">
                  {#each value(e.key) || [] as p (p)}
                    <span class="path"><span class="pt" {@attach tooltip(p)}>{p}</span><IconButton icon="close" size="sm" label="Remove" onclick={() => set(e.key, value(e.key).filter((x) => x !== p))} /></span>
                  {/each}
                  <Button size="sm" icon="folder-open" onclick={() => browse(e, true)}>Add folder…</Button>
                </div>
              {:else}
                <span class="ro k-num">{e.private ? (value(e.key) == null ? 'Not set' : 'Set') : summary(value(e.key))}</span>
              {/if}
            </div>
            <span class="rs">{#if ch}<IconButton icon="refresh" size="sm" label="Reset to default" onclick={(ev) => resetRow(ev, e.key)} data-testid="setting-reset" />{/if}</span>
          </div>
        {/each}
        {#if g.group === 'Models'}<ModelsList {app} />{/if}
        {#if g.group === 'Updates'}<UpdatesGroup {app} />{/if}
        {#if g.group === 'Playback & device' && !query.trim()}
          <div class="row" data-testid="setting" data-key="panic">
            <div class="what"><span class="lbl">Panic stop</span><span class="doc k-hint">Stops the device at once, from anywhere</span></div>
            <div class="ctl"><span class="ro k-num">{panic || 'Not bound'}</span></div><span class="rs"></span>
          </div>
        {/if}
      </Section>
    {:else}
      <EmptyState icon="search" title="No setting matches" description={hiddenHits ? `${hiddenHits} more with Show advanced` : 'Try a shorter word or the key name'} />
    {/each}
    {#if groups.length && hiddenHits}<p class="more k-hint">{hiddenHits} more with Show advanced</p>{/if}
  </div>
</div>

<style>
  .sp { display: flex; flex-direction: column; min-height: 0; height: 100%; container-type: inline-size; }
  .bar { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--line-1); }
  .bar :global(.k-switch) { flex: none; }
  .list { overflow: auto; flex: 1; min-height: 0; padding-bottom: var(--space-4); }
  /* label + description on the left, the control on the right, the reset in its own fixed column so controls line up */
  .row { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto 24px; align-items: center; gap: var(--space-2) var(--space-3);
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4); min-height: var(--row-h, 28px); }
  .row + .row { border-top: 1px solid var(--line-0, transparent); }
  .row.changed::before { content: ''; position: absolute; left: 0; top: 4px; bottom: 4px; width: 2px; border-radius: var(--radius); background: var(--accent); }
  .row.changed .lbl { color: var(--tx-hi); }
  .what { display: grid; gap: 1px; min-width: 0; }
  .lbl { color: var(--tx); font-size: var(--fs-2); overflow-wrap: anywhere; }
  .doc { font-size: var(--fs-1); line-height: 1.3; overflow-wrap: anywhere; }
  .ctl { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-1); min-width: 0; }
  .ctl :global(.k-number-field) { width: 112px; }
  .rs { display: grid; place-items: center; }
  /* selects, text and folders take a line of their own under the label */
  .row.wide { grid-template-columns: minmax(0, 1fr) 24px; }
  .row.wide .ctl { grid-column: 1; justify-content: flex-start; }
  .row.wide .rs { grid-row: 1; grid-column: 2; }
  .paths { display: grid; gap: var(--space-1); width: 100%; justify-items: start; }
  .path { display: flex; align-items: center; gap: var(--space-1); max-width: 100%; }
  .pt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--tx-val); font-size: var(--fs-1); }
  .ro { color: var(--tx-val); font-size: var(--fs-1); }
  .more { margin: var(--space-3) var(--space-4); }
  /* a narrow dock: every control under its label */
  @container (max-width: 300px) {
    .row { grid-template-columns: minmax(0, 1fr) 24px; }
    .row .ctl { grid-column: 1; justify-content: flex-start; }
    .row .rs { grid-row: 1; grid-column: 2; }
  }
</style>
