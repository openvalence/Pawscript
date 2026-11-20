<script>
  // The seeder dataset picker (paw-855t): at the top of the labelling workspace. Shows the active dataset and its count ("v2 · 37 labelled"),
  // switches (the image list marks, counter, next unlabelled, shuffle order and Suggest follow it), makes a new one (its name typed inline in
  // the menu: no dialog), renames, hides ("archive": nothing is ever removed from disk) and sets whether the dataset also learns from the
  // painted groups of .pawproj projects (off for a new one, on for v1). Logic: workspace.svelte.js / datasets.js.
  import Button from '../../ui/kit/Button.svelte';
  import Checkbox from '../../ui/kit/Checkbox.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { listed, archivedOf, pickerText } from './datasets.js';

  let { ws } = $props();
  let open = $state(false), name = $state(''), renaming = $state(''), rename = $state('');
  const reg = $derived(ws.ds.reg), act = $derived(ws.ds.active);
  const rows = $derived(listed(reg)), hidden = $derived(archivedOf(reg));
  const count = (d) => (d.id === reg?.active ? ws.labelled.size : ws.others.get(d.id)?.size);
  async function create() { const n = name.trim(); if (!n) return; name = ''; const id = await ws.createDataset(n); if (id) open = false; }
  async function pick(id) { open = false; await ws.switchDataset(id); }
  async function commitRename() { const id = renaming; renaming = ''; if (id) await ws.ds.rename(id, rename); }
  const key = (e) => { if (e.key === 'Escape') { open = false; renaming = ''; e.stopPropagation(); } };
</script>

{#if act}
  <div class="dsp" data-testid="dataset-picker" onkeydown={key} role="presentation">
    <Button size="sm" icon="folder" pressed={open} onclick={() => (open = !open)} data-testid="dataset-button"
      tip="Dataset: image labels with their own seeder and score">{pickerText(act, ws.counts.labelled)}</Button>
    {#if open}
      <div class="menu" data-testid="dataset-menu">
        {#each rows as d (d.id)}
          <div class="row" class:on={d.id === reg.active}>
            {#if renaming === d.id}
              <input class="nm" bind:value={rename} onkeydown={(e) => { if (e.key === 'Enter') commitRename(); }} onblur={commitRename} aria-label="Dataset name" data-testid="dataset-rename-input" />
            {:else}
              <button type="button" class="pk" onclick={() => pick(d.id)} data-testid="dataset-row-{d.id}" aria-pressed={d.id === reg.active}>
                <span class="chk">{d.id === reg.active ? '✓' : ''}</span>{d.name}<span class="k-hint num">{count(d) != null ? ` · ${count(d).toLocaleString('en-US')} labels` : ''}{d.legacy ? ' · not moved yet' : ''}</span>
              </button>
              <button type="button" class="mini" onclick={() => { renaming = d.id; rename = d.name; }} {@attach tooltip('Rename')}>rename</button>
              {#if d.id !== reg.active}<button type="button" class="mini" onclick={() => ws.ds.archive(d.id, true)} {@attach tooltip('Hide from this list, nothing is deleted')}>hide</button>{/if}
            {/if}
          </div>
        {/each}
        <div class="row proj">
          <span {@attach tooltip('Also learn from the groups painted in your projects')}><Checkbox size="sm" checked={act.projects} onchange={(v) => ws.ds.setProjects(act.id, v)} label="also learn from projects" /></span>
        </div>
        <div class="row new">
          <input class="nm" bind:value={name} placeholder="new dataset name" onkeydown={(e) => { if (e.key === 'Enter') create(); }} aria-label="New dataset name" data-testid="dataset-new-input" />
          <Button size="sm" disabled={!name.trim() || !!reg.error} onclick={create} data-testid="dataset-create" tip="Make an empty dataset and switch to it">New</Button>
        </div>
        {#if hidden.length}
          <div class="row hid"><span class="k-hint">hidden:</span>{#each hidden as d (d.id)}<button type="button" class="mini" onclick={() => ws.ds.archive(d.id, false)} {@attach tooltip('Show it in the list again')}>{d.name} (show)</button>{/each}</div>
        {/if}
        {#if reg.error}<div class="row"><span class="k-hint">The old labels could not be moved into v1 ({reg.error}); they are used where they are.</span></div>{/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .dsp { position: relative; display: inline-flex; }
  .menu { position: absolute; top: calc(100% + 4px); left: 0; z-index: 70; min-width: 300px; display: flex; flex-direction: column; gap: 2px; padding: 6px; background: var(--bg-card); border: 1px solid var(--line-2); border-radius: var(--radius); box-shadow: var(--shadow-2); font-size: var(--fs-1); }
  .row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .row.on .pk { color: var(--tx-hi); font-weight: 600; }
  .pk { flex: 1; text-align: left; background: none; border: 0; color: var(--tx); font: inherit; padding: 3px 4px; cursor: pointer; border-radius: var(--radius); }
  .pk:hover { background: color-mix(in srgb, var(--tx) 10%, transparent); }
  .chk { display: inline-block; width: 1.2em; color: var(--ok, var(--series-green)); }
  .mini { background: none; border: 0; color: var(--tx-mut); font: inherit; text-decoration: underline dotted; cursor: pointer; padding: 0 2px; }
  .nm { flex: 1; min-width: 0; font: inherit; color: var(--tx-hi); background: var(--bg-sunken); border: 1px solid var(--line-1); border-radius: var(--radius); padding: 2px 6px; }
  .proj, .new, .hid { padding-top: 4px; border-top: 1px solid var(--line-1); margin-top: 2px; }
</style>
