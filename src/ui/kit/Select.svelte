<!--
  Select: a field-styled button (role=combobox) and a listbox popover. Options, or groups of them.
  Focus stays on the button; the keyboard's option is aria-activedescendant. Typing while closed changes
  the value like a native select; while open it moves the active option.

  <Select options={[{ value: 'linear', label: 'Linear' }, …]} bind:value label="Interpolation" />
-->
<script>
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { float, dismiss } from './position.js';
  import { nextIndex, createTypeahead, nextId } from './focus.js';
  import { flatOptions, on, reveal } from './menus.js';

  let {
    options = [],
    value = $bindable(),
    placeholder = 'Select…',
    size = 'md',
    label = undefined,
    disabled = false,
    invalid = false,
    full = false,
    onchange,
    class: cls = '',
    ...rest
  } = $props();

  const lid = nextId('k-sel');
  const flat = $derived(flatOptions(options));
  const ids = $derived(flat.map(() => nextId('k-opt')));
  const grouped = $derived(options.some((o) => Array.isArray(o?.options)));
  const sections = $derived(grouped
    ? options.map((g) => (Array.isArray(g?.options) ? g : { options: [g] }))
    : [{ options }]);
  const sel = $derived(flat.findIndex((o) => o.value === value));
  const current = $derived(flat[sel]);
  const hasIcons = $derived(flat.some((o) => o.icon));
  const indexOf = (o) => flat.indexOf(o);
  const off = (i) => !!flat[i]?.disabled;

  let open = $state(false), active = $state(-1), btn = $state(), list = $state();
  const rowEl = (i) => (i >= 0 ? document.getElementById(ids[i]) : null);
  const typeahead = createTypeahead();

  function show(key) {
    if (disabled || open) return;
    active = sel >= 0 && !off(sel) ? sel : (nextIndex(flat.length, -1, key === 'ArrowUp' ? 'End' : 'Home', { disabled: off }) ?? -1);
    open = true;
  }
  function hide(refocus = true) {
    open = false;
    if (refocus) btn?.focus({ preventScroll: true });
  }
  function commit(i, e) {
    const o = flat[i];
    if (!o || o.disabled || o.value === value) return;
    value = o.value;
    onchange?.(o.value, e);
  }
  function choose(i, e) {
    if (off(i)) return;
    hide();
    commit(i, e);
  }

  function onkey(e) {
    const k = e.key, plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    const labels = flat.map((o) => o.label);
    if (!open) {
      if (plain && k.length === 1) {
        const t = typeahead(k, labels, sel, off);
        if (t != null) { stop(); commit(t, e); return; }
      }
      if (k === 'Enter' || k === ' ' || k === 'ArrowDown' || k === 'ArrowUp') { stop(); show(k); }
      return;
    }
    const page = Math.max(1, Math.floor((list?.clientHeight ?? 240) / (rowEl(0)?.offsetHeight || 24)) - 1);
    const to = nextIndex(flat.length, active, k, { disabled: off, page, loop: false });
    if (to != null) { stop(); active = to; reveal(list, rowEl(to)); return; }
    if (plain && k.length === 1) {
      const t = typeahead(k, labels, active, off);
      if (t != null) { stop(); active = t; reveal(list, rowEl(t)); return; }
    }
    if (k === 'Enter' || k === ' ') { stop(); choose(active, e); }
    else if (k === 'Escape') { stop(); hide(); }
    else if (k === 'Tab') { open = false; commit(active, e); }   // APG: Tab takes the active option and moves on
  }

  function pop(node) {
    return untrack(() => {
      const f = float(node, btn, { placement: 'bottom-start', offset: 2, matchWidth: true });
      reveal(node, node.querySelector('[data-active]'), true);
      const undismiss = dismiss(node, () => hide(false), [btn]);
      return () => { undismiss(); f.destroy(); };
    });
  }
</script>

<button
  bind:this={btn}
  type="button"
  class="k-select {cls}"
  role="combobox"
  aria-haspopup="listbox"
  aria-expanded={open}
  aria-controls={open ? lid : undefined}
  aria-activedescendant={open && active >= 0 ? ids[active] : undefined}
  aria-label={label}
  aria-invalid={invalid || undefined}
  data-size={size}
  data-full={full || undefined}
  data-placeholder={current ? undefined : ''}
  {disabled}
  onclick={() => (open ? hide() : show())}
  {...rest}
  {@attach on('keydown', onkey)}
>
  {#if current?.icon}<Icon name={current.icon} size={size === 'sm' ? 14 : 16} />{/if}
  <!-- every label stacked in one grid cell: the button is as wide as its widest option, like a native select -->
  <span class="k-select-value">
    <span class="k-select-text">{current ? current.label : placeholder}</span>
    {#if !full}{#each [placeholder, ...flat.slice(0, 200).map((o) => o.label)] as l}<span class="k-select-sizer" aria-hidden="true">{l}</span>{/each}{/if}
  </span>
  <Icon name="chevron-down" size={size === 'sm' ? 12 : 14} class="k-select-chev" />
</button>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_interactive_supports_focus (focus stays on the field: aria-activedescendant) -->
  <div
    bind:this={list}
    id={lid}
    class="k-pop k-select-list"
    role="listbox"
    aria-label={label}
    popover="manual"
    data-icons={hasIcons || undefined}
    data-size={size}
    onmousedown={(e) => e.preventDefault()}
    {@attach pop}
  >
    {#each sections as g}
      <div role={g.label ? 'group' : 'presentation'} aria-label={g.label}>
        {#if g.label}<div class="k-menu-sec k-caps" role="presentation">{g.label}</div>{/if}
        {#each g.options as o}
          {@const i = indexOf(o)}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
          <div
            class="k-item"
            id={ids[i]}
            role="option"
            aria-selected={i === sel}
            aria-disabled={o.disabled ? 'true' : undefined}
            data-active={i === active || undefined}
            onpointermove={() => { if (!o.disabled) active = i; }}
            onclick={(e) => choose(i, e)}
          >
            <span class="k-item-check">{#if i === sel}<Icon name="check" />{/if}</span>
            {#if hasIcons}<span class="k-item-icon">{#if o.icon}<Icon name={o.icon} />{/if}</span>{/if}
            <span class="k-item-label">{o.label}</span>
            <span class="k-item-hint">{o.hint ?? ''}</span>
          </div>
        {/each}
      </div>
    {/each}
  </div>
{/if}

<style>
  .k-select {
    display: inline-flex; align-items: center; gap: var(--space-3);
    min-width: calc(var(--ctl-h) * 2); max-width: 100%; width: auto; height: var(--ctl-h); vertical-align: middle; padding: 0 var(--space-3) 0 var(--pad-x);
    font: inherit; font-size: var(--fs-ui); line-height: 1; text-align: left;
    color: var(--tx-val); background: var(--bg-sunken);
    border: var(--bw) solid var(--line-ctl); border-radius: var(--radius); box-shadow: var(--recess);
    cursor: pointer; outline: none;
    transition: color var(--t-quick) var(--ease-out), border-color var(--t-quick) var(--ease-out), box-shadow var(--t-quick) var(--ease-out);
  }
  .k-select[data-size='sm'] { height: var(--ctl-h-sm); font-size: var(--fs-2); padding-left: var(--space-3); }
  .k-select[data-size='lg'] { height: var(--ctl-h-lg); }
  .k-select[data-full] { width: 100%; }
  .k-select:hover:not(:disabled) { border-color: var(--line-ctl-hover); }
  .k-select:focus-visible, .k-select[aria-expanded='true'] {
    color: var(--tx-hi); border-color: var(--focus); box-shadow: var(--recess), 0 0 0 1px var(--focus);
  }
  .k-select[aria-invalid='true'] { border-color: var(--bad-ink); }
  .k-select:disabled { opacity: .45; cursor: not-allowed; }
  .k-select[data-placeholder] .k-select-value { color: var(--tx-mut); }
  .k-select-value { flex: 1 1 auto; display: grid; line-height: normal; min-width: 0; }
  .k-select-value > span { grid-area: 1 / 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .k-select-sizer { visibility: hidden; height: 0; }
  .k-select :global(.k-select-chev) { color: var(--tx-mut); margin-left: auto; }

  .k-select-list { max-height: calc(var(--row-h) * 12 + var(--space-2) * 2 + 2px); }
  .k-select-list[data-size='sm'] { font-size: var(--fs-2); }
  .k-select-list .k-item { grid-template-columns: 16px minmax(0, 1fr) auto; }
  .k-select-list[data-icons] .k-item { grid-template-columns: 16px 16px minmax(0, 1fr) auto; }
  .k-item-check, .k-item-icon { display: grid; place-items: center; }
  .k-item-check { color: var(--accent-ink); }
  .k-item-hint:empty { padding: 0; }
  .k-item[aria-disabled='true'] .k-item-check { color: var(--tx-ghost); }
</style>
