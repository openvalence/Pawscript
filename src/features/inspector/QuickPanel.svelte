<script>
  import './inspector.css';
  import Scope from './Scope.svelte';
  import Section from '../../ui/kit/Section.svelte';
  import Select from '../../ui/kit/Select.svelte';
  import Button from '../../ui/kit/Button.svelte';
  import IconButton from '../../ui/kit/IconButton.svelte';
  import ToggleButton from '../../ui/kit/ToggleButton.svelte';
  import EmptyState from '../../ui/kit/EmptyState.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { shortcutText } from '../../ui/kit/keys.js';
  import { inspector as insp } from './state.svelte.js';
  import { OPS } from './catalog.js';
  import { groupTitle } from './logic.js';
  let { app } = $props();
  (() => insp.init(app))(); // the app object never changes for a mounted panel
  let edit = $state(false), adding = $state('');
  const keyOf = (q) => app.commands?.keysFor?.(`quick.${q.id}`)?.[0] ?? '';
  const items = $derived(insp.quick.map((q) => ({ q, op: insp.quickOp(q) })));
  const toolOptions = $derived.by(() => {
    const by = new Map();
    for (const o of OPS) { const g = groupTitle(o.group); if (!by.has(g)) by.set(g, []); by.get(g).push({ value: o.id, label: o.title }); }
    return [...by].map(([label, options]) => ({ label, options }));
  });
  function add() {
    const op = OPS.find((o) => o.id === adding);
    if (op) { insp.addQuick(op, insp.paramsFor(op)); adding = ''; }
  }
</script>

<div class="pi">
  <div class="pi-bar">
    <Scope />
  </div>
  <div class="pi-scroll k-scroll">
    {#if items.length}
      <!-- while customising, a click on a row does not run it: the rows are being edited, not used -->
      <ul class="list" class:editing={edit} aria-label="Quick actions">
        {#each items as { q, op } (q.id)}
          <li class="qrow">
            <button class="pi-item" disabled={!op} aria-disabled={edit || undefined} onclick={() => { if (!edit) insp.runQuick(q); }} data-testid="quick-{q.id}"
              {@attach tooltip(edit ? '' : op ? op.title : 'No matching tool', edit ? '' : keyOf(q))}>
              <span class="lab">{q.label}</span>{#if keyOf(q)}<span class="keys k-num">{shortcutText(keyOf(q))}</span>{/if}
            </button>
            {#if edit}<IconButton icon="close" size="sm" label="Remove {q.label}" onclick={() => insp.removeQuick(q.id)} />{/if}
          </li>
        {/each}
      </ul>
    {:else}
      <EmptyState icon="bolt" title="No quick actions" description="Add tools you use often, with the settings you like." />
    {/if}
    <div class="pi-row end pad">
      <ToggleButton size="sm" icon="settings" bind:pressed={edit} tip="Add, remove or reset quick actions">Customise</ToggleButton>
    </div>
    {#if edit}
      <Section title="Add a tool">
        <div class="pi-row">
          <Select class="grow" full label="Tool to add" placeholder="Choose a tool…" options={toolOptions} bind:value={adding} />
          <Button variant="primary" icon="add" disabled={!adding} onclick={add}>Add</Button>
        </div>
        <div class="pi-row">
          <Button size="sm" variant="ghost" icon="refresh" onclick={() => insp.resetQuick()}>Restore defaults</Button>
        </div>
        <p class="pi-note">Added actions use the tool's remembered settings. Set a shortcut in Keyboard shortcuts.</p>
      </Section>
    {/if}
  </div>
</div>

<style>
  .list { list-style: none; margin: 0; padding: var(--space-3) var(--space-2); }
  .qrow { display: flex; align-items: center; gap: var(--space-1); }
  .pad { padding: 0 var(--space-4) var(--space-4); }
  .editing .pi-item:not(:disabled) { cursor: default; background: none; color: var(--tx); }
</style>
