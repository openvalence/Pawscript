<!--
  Tree: WAI-ARIA tree, single selection that follows focus, roving tabindex.
  nodes: { id, label, icon?, children? }[]; `expanded` a Set of ids (bindable, replaced on change);
  `selected` an id (bindable).
  <Tree {nodes} bind:expanded bind:selected label="Project" onactivate={(n) => open(n)}>
    {#snippet row(node, { level, open, expandable })}{node.label} <span class="k-hint">3</span>{/snippet}
  </Tree>
  Keys: Up / Down, Home / End, PageUp / PageDown, Right opens or enters, Left closes or goes to the
  parent, Enter activates, typing jumps to a label. Click selects, the chevron toggles, double-click
  activates (and toggles a branch).
-->
<script>
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { flattenTree } from './data.js';
  import { nextIndex, createTypeahead } from './focus.js';

  let {
    nodes = [],
    expanded = $bindable(new Set()),
    selected = $bindable(null),
    label,
    row,
    onselect,
    onactivate,
    ontoggle,
    class: cls = '',
    ...rest
  } = $props();

  let root;
  const flat = $derived(flattenTree(nodes, expanded));
  const sel = $derived(flat.findIndex((r) => r.node.id === selected));
  const tabbable = $derived(sel >= 0 ? sel : 0);
  const typeahead = createTypeahead();

  function toggle(r, open = !r.open) {
    if (!r.expandable || open === r.open) return;
    const next = new Set(expanded);
    if (open) next.add(r.node.id); else next.delete(r.node.id);
    expanded = next;
    ontoggle?.(r.node, open);
  }

  async function go(i, e, focus = true) {
    const r = flat[i];
    if (!r) return;
    if (r.node.id !== selected) { selected = r.node.id; onselect?.(r.node, e); }
    if (!focus) return;
    await tick();
    root?.querySelector(`[data-index="${i}"]`)?.focus();
  }

  function key(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const i = sel, r = flat[i];
    if (e.key === 'Enter' && r) { e.preventDefault(); onactivate?.(r.node, e); return; }
    if (e.key === 'ArrowRight' && r) {
      e.preventDefault();
      if (r.expandable && !r.open) toggle(r, true); else if (r.open) go(i + 1, e);
      return;
    }
    if (e.key === 'ArrowLeft' && r) {
      e.preventDefault();
      if (r.open) toggle(r, false); else if (r.parent >= 0) go(r.parent, e);
      return;
    }
    let n = nextIndex(flat.length, i, e.key, { loop: false });
    if (n === null && e.key.length === 1 && e.key !== ' ') n = typeahead(e.key, flat.map((x) => x.node.label), i);
    if (n === null) return;
    e.preventDefault();
    go(n, e);
  }
</script>

<div class="k-tree {cls}" role="tree" aria-label={label} bind:this={root} onkeydown={key} {...rest}>
  {#each flat as r, i (r.node.id)}
    <!-- keys live on the tree (roving focus) -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="kit-tree-item"
      role="treeitem"
      tabindex={i === tabbable ? 0 : -1}
      aria-level={r.level}
      aria-setsize={r.setsize}
      aria-posinset={r.posinset}
      aria-expanded={r.expandable ? r.open : undefined}
      aria-selected={i === sel}
      data-index={i}
      style:--level={r.level}
      onclick={(e) => go(i, e)}
      ondblclick={(e) => { toggle(r); onactivate?.(r.node, e); }}
    >
      {#if r.level > 1}<span class="kit-tree-guides" aria-hidden="true"></span>{/if}
      <span
        class="kit-tree-twist"
        data-open={r.open || undefined}
        aria-hidden="true"
        onclick={(e) => { e.stopPropagation(); toggle(r); go(i, e); }}
        ondblclick={(e) => e.stopPropagation()}
      >{#if r.expandable}<Icon name="chevron-right" size={12} />{/if}</span>
      {#if row}
        {@render row(r.node, r)}
      {:else}
        {#if r.node.icon}<Icon name={r.node.icon} size={14} />{/if}
        <span class="kit-tree-label">{r.node.label}</span>
      {/if}
    </div>
  {/each}
</div>

<style>
  .k-tree { --indent: 16px; display: flex; flex-direction: column; min-width: 0; padding: var(--space-1) 0; }
  .kit-tree-item {
    position: relative; display: flex; align-items: center; gap: var(--space-3);
    height: var(--row-h); padding: 0 var(--space-4) 0 calc((var(--level) - 1) * var(--indent) + var(--space-2));
    color: var(--tx); white-space: nowrap; cursor: default; user-select: none; outline: none;
  }
  .kit-tree-item:hover { background: var(--bg-hover); }
  .kit-tree-item[aria-selected='true'] { background: var(--sel-bg); color: var(--tx-hi); }
  .kit-tree-item[aria-selected='true']:hover { background: var(--sel-bg-hover); }
  .kit-tree-item:focus-visible::before {
    content: ''; position: absolute; left: 0; top: 2px; bottom: 2px; width: 2px; background: var(--focus);
  }
  .kit-tree-item :global(.k-icon) { color: var(--tx-mut); }
  .kit-tree-item[aria-selected='true'] :global(.k-icon) { color: var(--tx); }
  /* One faint guide per ancestor, under that ancestor's chevron. */
  .kit-tree-guides {
    position: absolute; top: 0; bottom: 0; left: var(--space-2); width: calc((var(--level) - 1) * var(--indent));
    background: linear-gradient(90deg, transparent 7px, var(--line-1) 7px 8px, transparent 8px) 0 0 / var(--indent) 100% repeat-x;
    pointer-events: none;
  }
  .kit-tree-twist { flex: none; display: grid; place-items: center; width: 16px; height: 16px; color: var(--tx-mut); }
  .kit-tree-twist :global(.k-icon) { transition: transform var(--t-move) var(--ease-out); }
  .kit-tree-twist[data-open] :global(.k-icon) { transform: rotate(90deg); }
  .kit-tree-twist:hover { color: var(--tx-hi); }
  .kit-tree-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
</style>
