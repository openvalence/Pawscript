<script>
  import './inspector.css';
  import Section from '../../ui/kit/Section.svelte';
  import Field from '../../ui/kit/Field.svelte';
  import TextField from '../../ui/kit/TextField.svelte';
  import Slider from '../../ui/kit/Slider.svelte';
  import Switch from '../../ui/kit/Switch.svelte';
  import SegmentedControl from '../../ui/kit/SegmentedControl.svelte';
  import Button from '../../ui/kit/Button.svelte';
  import IconButton from '../../ui/kit/IconButton.svelte';
  import Menu from '../../ui/kit/Menu.svelte';
  import Dialog from '../../ui/kit/Dialog.svelte';
  import EmptyState from '../../ui/kit/EmptyState.svelte';
  import { contextMenu } from '../../ui/kit/contextmenu.js';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import Thumb from './Thumb.svelte';
  import { inspector as insp } from './state.svelte.js';
  import { snippetFromSelection, snippetFromRange, serializeSnippets, parseSnippets, fmtTime } from './logic.js';
  import { pasteSnippet } from './actions.js';
  import { scriptOf } from '../../lib/script-of.js';   // paw-x7w7: baked + live
  let { app } = $props();
  (() => insp.init(app))(); // the app object never changes for a mounted panel

  let name = $state(''), timeScale = $state(100), posScale = $state(100), fit = $state(false), mode = $state('merge');
  let renaming = $state(''), importOpen = $state(false), importText = $state('');
  let menu = $state({ open: false, anchor: null, s: null });
  const doc = $derived(app.doc);
  const selCount = $derived(doc.selection?.axis === doc.activeAxis ? doc.selection.ats.size : 0);
  const canSave = $derived(selCount > 0 || !!doc.range);
  const source = $derived(selCount ? `From ${selCount} selected point${selCount === 1 ? '' : 's'}.` : doc.range ? 'From the points in the range.' : 'Select points or set a range (I / O) first.');
  // the dock runs 200-680 px: below 300 px the option labels stack over their controls
  let pw = $state(330);
  const narrow = $derived(pw < 300);

  function save() {
    if (!canSave) return;
    const script = scriptOf(app, doc.activeAxis);
    const nm = name.trim() || `Snippet ${insp.snippets.length + 1}`;
    const s = selCount ? snippetFromSelection(script, doc.selection.ats, nm) : doc.range ? snippetFromRange(script, doc.range.t0, doc.range.t1, nm) : null;
    if (!s) return app.toast?.('Nothing to save: select points or set a range', 'warn');
    insp.setSnippets([s, ...insp.snippets]); name = '';
    app.toast?.(`Saved "${s.name}" (${s.actions.length} points)`, 'ok');
  }
  const paste = (s) => pasteSnippet(app, s, { timeScale: timeScale / 100, posScale: posScale / 100, fit: fit && !!doc.range, mode });
  async function del(s) { if (await app.confirm({ title: `Delete "${s.name}"?`, ok: 'Delete', danger: true })) insp.setSnippets(insp.snippets.filter((x) => x.id !== s.id)); }
  const rename = (s, v) => { renaming = ''; if (v.trim()) insp.setSnippets(insp.snippets.map((x) => (x.id === s.id ? { ...x, name: v.trim() } : x))); };
  async function exportAll() {
    try { await navigator.clipboard.writeText(serializeSnippets(insp.snippets)); app.toast?.('Snippets copied as JSON', 'ok'); }
    catch { importText = serializeSnippets(insp.snippets); importOpen = true; }
  }
  function doImport() {
    const list = parseSnippets(importText);
    if (!list.length) { app.toast?.('No valid snippets found in that text', 'warn'); return false; }
    const ids = new Set(insp.snippets.map((s) => s.id));
    insp.setSnippets([...list.map((s) => (ids.has(s.id) ? { ...s, id: s.id + 'i' } : s)), ...insp.snippets]);
    importText = ''; app.toast?.(`Imported ${list.length} snippet${list.length === 1 ? '' : 's'}`, 'ok');
    return true;
  }
  const itemsFor = (s) => [
    { id: 'paste', label: 'Paste at playhead', icon: 'paste', run: () => paste(s) },
    { id: 'rename', label: 'Rename', icon: 'pen', run: () => (renaming = s.id) },
    { separator: true },
    { id: 'delete', label: 'Delete', icon: 'delete', run: () => del(s) },
  ];
  const focusOnMount = (el) => { el.focus(); el.select(); };
</script>

{#snippet libActions()}
  <IconButton icon="export" size="sm" label="Copy all snippets as JSON" disabled={!insp.snippets.length} onclick={exportAll} />
  <IconButton icon="import" size="sm" label="Import snippets" onclick={() => (importOpen = true)} />
{/snippet}

<div class="pi" bind:clientWidth={pw}>
  <div class="pi-scroll k-scroll">
    <Section title="Save snippet" count={selCount || undefined}>
      <div class="save">
        <TextField full placeholder="Name (optional)" label="Snippet name" bind:value={name} onenter={save} />
        <Button variant="primary" icon="save" disabled={!canSave} tip={canSave ? '' : 'Select points or set a range first'} onclick={save}>Save</Button>
      </div>
      <p class="pi-note">{source}</p>
    </Section>
    <Section title="Paste options">
      <div class="opts">
        <Field inline={!narrow} label="Time">
          {#snippet children(f)}
            <Slider id={f.id} full aria-labelledby={f.labelledby} min={10} max={400} bind:value={timeScale} disabled={fit && !!doc.range} showValue format={(v) => `${v} %`} default={100} />
          {/snippet}
        </Field>
        <Field inline={!narrow} label="Position">
          {#snippet children(f)}
            <Slider id={f.id} full aria-labelledby={f.labelledby} min={0} max={200} bind:value={posScale} showValue format={(v) => `${v} %`} default={100} />
          {/snippet}
        </Field>
        <Field inline label="Fit to range" hint={doc.range ? `Stretch to ${fmtTime(doc.range.t1 - doc.range.t0)}` : 'Set a range (I / O) first'}>
          {#snippet children(f)}<Switch id={f.id} aria-describedby={f.describedby} bind:checked={fit} disabled={!doc.range} />{/snippet}
        </Field>
        <Field inline={!narrow} label="Mode">
          {#snippet children(f)}
            <SegmentedControl full size="md" aria-labelledby={f.labelledby} bind:value={mode}
              options={[{ value: 'merge', label: 'Merge', tip: 'Add the points, keep the others' }, { value: 'replace', label: 'Replace', tip: 'Clear the pasted span first' }]} />
          {/snippet}
        </Field>
      </div>
    </Section>
    <Section title="Library" count={insp.snippets.length} actions={libActions}>
      {#each insp.snippets as s (s.id)}
        <div class="snip" role="group" aria-label={s.name} {@attach contextMenu(() => itemsFor(s))} data-testid="snip">
          <Thumb actions={s.actions} duration={s.duration} h={38} />
          <div class="pi-row nrow">
            {#if renaming === s.id}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="grow" onkeydown={(e) => { if (e.key === 'Escape') { renaming = ''; e.stopPropagation(); } }}>
                <TextField full value={s.name} label="Snippet name" onchange={(v) => rename(s, v)} onenter={(v) => rename(s, v)} bind:inputEl={() => null, (el) => el && focusOnMount(el)} />
              </div>
            {:else}
              <button class="name grow" ondblclick={() => (renaming = s.id)} {@attach tooltip('Double-click to rename')}>{s.name}</button>
            {/if}
            <span class="k-num k-hint meta">{s.actions.length} pts · {fmtTime(s.duration)}</span>
          </div>
          <div class="pi-row">
            <Button class="grow" size="sm" icon="paste" tip="Paste at the playhead" onclick={() => paste(s)}>Paste</Button>
            <IconButton icon="more" size="sm" variant="default" label="More actions for {s.name}" aria-haspopup="menu"
              onclick={(e) => (menu = { open: !menu.open || menu.s !== s, anchor: e.currentTarget, s })} />
          </div>
        </div>
      {:else}
        <EmptyState icon="bookmark" title="No snippets yet" description="Select a stroke you like, name it, and reuse it anywhere.">
          {#snippet actions()}<Button size="sm" variant="ghost" icon="import" onclick={() => (importOpen = true)}>Import…</Button>{/snippet}
        </EmptyState>
      {/each}
    </Section>
  </div>
  <Menu bind:open={menu.open} anchor={menu.anchor} placement="bottom-end" items={menu.s ? itemsFor(menu.s) : []} label="Snippet actions" />
  <Dialog bind:open={importOpen} title="Import snippets" size="md">
    <textarea class="json k-num k-scroll" rows="8" placeholder="Paste exported snippet JSON…" aria-label="Snippet JSON" bind:value={importText} spellcheck="false"></textarea>
    {#snippet footer({ close })}
      <Button onclick={() => close('cancel')}>Cancel</Button>
      <Button variant="primary" icon="import" disabled={!importText.trim()} onclick={() => { if (doImport()) close('import'); }}>Import</Button>
    {/snippet}
  </Dialog>
</div>

<style>
  .opts { display: flex; flex-direction: column; gap: var(--gap); }
  .save { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--gap); }
  /* min-width 0 here, width 0 on .name and the canvas sized by CSS (Thumb): no content can widen a card */
  .snip { min-width: 0; display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-3); background: var(--bg-card); border: var(--bw) solid var(--line-2); border-radius: var(--radius); }
  .snip + .snip { margin-top: var(--space-3); }
  .snip > :global(.pi-row) { margin-top: 0; }
  .meta { flex: none; white-space: nowrap; }
  /* narrow: the name keeps the whole line, the meta goes under it */
  @container (width < 300px) {
    .nrow { flex-wrap: wrap; row-gap: 0; }
    .nrow > .name { flex-basis: 100%; }
  }
  .name {
    width: 0; min-width: 0; height: var(--ctl-h); padding: 0; margin: 0; border: 0; background: none; text-align: left;
    color: var(--tx-hi); font: 500 var(--fs-ui) / var(--lh-tight) var(--font); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; cursor: pointer;
  }
  .name:hover { color: var(--accent-ink); }
  .name:focus-visible { outline: var(--ring-w) solid var(--focus); outline-offset: var(--ring-offset); }
  /* the kit has no multi-line field: a textarea in the kit's field voice */
  .json {
    display: block; width: 100%; min-height: calc(var(--row-h) * 6); resize: vertical; padding: var(--space-3) var(--pad-x);
    background: var(--bg-sunken); color: var(--tx-val); border: var(--bw) solid var(--line-ctl); border-radius: var(--radius);
    box-shadow: var(--recess); font-size: var(--fs-2); outline: none;
    transition: border-color var(--t-quick) var(--ease-out), box-shadow var(--t-quick) var(--ease-out);
  }
  .json:hover { border-color: var(--line-ctl-hover); }
  .json:focus { border-color: var(--focus); box-shadow: var(--recess), 0 0 0 1px var(--focus); color: var(--tx-hi); }
  .json::placeholder { color: var(--tx-mut); }
</style>
