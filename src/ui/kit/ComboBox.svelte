<!--
  ComboBox: a text field that filters a listbox of options as you type. Focus stays in the input; the
  keyboard's option is aria-activedescendant. Matched text is emphasised.

  <ComboBox options={commands} bind:value placeholder="Run command…" label="Command" />
-->
<script>
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { float, dismiss } from './position.js';
  import { nextIndex, nextId } from './focus.js';
  import { filterOptions, splitMatch, on, reveal } from './menus.js';

  let {
    options = [],
    value = $bindable(),
    placeholder = '',
    allowCustom = false,
    filter = undefined,
    size = 'md',
    label = undefined,
    disabled = false,
    invalid = false,
    full = false,
    onchange,
    class: cls = '',
    ...rest
  } = $props();

  const lid = nextId('k-cb');
  const labelOf = (v) => options.find((o) => o.value === v)?.label ?? (allowCustom && v != null ? String(v) : '');

  let root = $state(), input = $state(), list = $state();
  let open = $state(false), active = $state(-1);
  let query = $state('');          // what the person typed since the list last opened ('' = show all)
  let text = $state(untrack(() => labelOf(value)));
  let editing = false;

  const shown = $derived(filterOptions(options, query, filter));
  const ids = $derived(shown.map(() => nextId('k-opt')));
  const off = (i) => !!shown[i]?.disabled;
  const first = () => nextIndex(shown.length, -1, 'Home', { disabled: off }) ?? -1;

  // An outside change of value (or of the options) shows its label, unless the person is typing.
  $effect(() => {
    const t = labelOf(value);
    untrack(() => { if (!editing) text = t; });
  });

  function openAll(key) {
    if (disabled) return;
    query = '';
    const s = shown.findIndex((o) => o.value === value);
    active = key === 'keep' ? -1 : s >= 0 ? s : key === 'ArrowUp' ? (nextIndex(shown.length, -1, 'End', { disabled: off }) ?? -1) : first();
    open = true;
  }
  function close() {
    open = false;
    query = '';
  }
  function set(v, e) {
    if (v === value) return;
    value = v;
    onchange?.(v, e);
  }
  function choose(o, e) {
    if (!o || o.disabled) return;
    editing = false;
    text = o.label;
    close();
    set(o.value, e);
  }

  /** allowCustom: typed text becomes the value (an option's value when it names one). */
  function commitText(e) {
    const t = text.trim();
    editing = false;
    if (!t) return;
    const o = options.find((x) => String(x.label).toLowerCase() === t.toLowerCase());
    set(o ? o.value : t, e);
    text = o ? o.label : t;
  }

  function oninput(e) {
    editing = true;
    text = e.currentTarget.value;
    query = text;
    open = true;
    active = text.trim() ? first() : -1;
  }
  function onblur() {
    if (allowCustom && editing) commitText();
    editing = false;
    close();
    text = labelOf(value);
  }

  function onkey(e) {
    const k = e.key;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (!open) {
      if (k === 'ArrowDown' || k === 'ArrowUp') { stop(); openAll(e.altKey ? 'keep' : k); }
      else if (k === 'Enter' && allowCustom && editing) { stop(); commitText(e); }
      else if (k === 'Escape' && text) {
        stop();
        editing = false;
        text = '';
        set(allowCustom ? '' : null, e);
      }
      return;
    }
    if (k !== 'Home' && k !== 'End') {   // Home / End stay with the caret
      const page = Math.max(1, Math.floor((list?.clientHeight ?? 240) / 24) - 1);
      const to = nextIndex(shown.length, active, k, { disabled: off, page });
      if (to != null) { stop(); active = to; reveal(list, list?.querySelector('#' + ids[to])); return; }
    }
    if (k === 'Enter') {
      stop();
      if (active >= 0) choose(shown[active], e);
      else if (allowCustom) { close(); commitText(e); }
    } else if (k === 'Escape') {
      stop();
      editing = false;
      close();
      text = labelOf(value);
    } else if (k === 'Tab') close();
  }

  function pop(node) {
    return untrack(() => {
      const f = float(node, root, { placement: 'bottom-start', offset: 2, matchWidth: true });
      reveal(node, node.querySelector('[data-active]'), true);
      const undismiss = dismiss(node, close, [root]);
      return () => { undismiss(); f.destroy(); };
    });
  }
</script>

<div
  bind:this={root}
  class="k-combobox {cls}"
  data-size={size}
  data-full={full || undefined}
  data-disabled={disabled || undefined}
  data-invalid={invalid || undefined}
>
  <input
    bind:this={input}
    type="text"
    role="combobox"
    autocomplete="off"
    spellcheck="false"
    aria-autocomplete="list"
    aria-expanded={open}
    aria-controls={open ? lid : undefined}
    aria-activedescendant={open && active >= 0 ? ids[active] : undefined}
    aria-label={label}
    aria-invalid={invalid || undefined}
    {placeholder}
    {disabled}
    value={text}
    {oninput}
    {onblur}
    onclick={() => { if (!open) openAll('keep'); }}
    {...rest}
    {@attach on('keydown', onkey)}
  />
  <button
    type="button"
    class="k-combobox-toggle"
    tabindex="-1"
    aria-label="Show options"
    {disabled}
    onmousedown={(e) => e.preventDefault()}
    onclick={() => { if (open) close(); else { input.focus(); openAll(); } }}
  ><Icon name="chevron-down" size={size === 'sm' ? 12 : 14} /></button>
</div>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_interactive_supports_focus (focus stays on the field: aria-activedescendant) -->
  <div
    bind:this={list}
    id={lid}
    class="k-pop k-combobox-list"
    role="listbox"
    aria-label={label}
    popover="manual"
    data-size={size}
    onmousedown={(e) => e.preventDefault()}
    {@attach pop}
  >
    {#each shown as o, i}
      {@const [a, m, b] = splitMatch(o.label, query)}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
      <div
        class="k-item"
        id={ids[i]}
        role="option"
        aria-selected={o.value === value}
        aria-disabled={o.disabled ? 'true' : undefined}
        data-active={i === active || undefined}
        onpointermove={() => { if (!o.disabled) active = i; }}
        onclick={(e) => choose(o, e)}
      >
        <span class="k-item-check">{#if o.value === value}<Icon name="check" />{/if}</span>
        <span class="k-item-label">{a}{#if m}<mark>{m}</mark>{/if}{b}</span>
        <span class="k-item-hint">{o.hint ?? ''}</span>
      </div>
    {:else}
      <div class="k-combobox-empty">No matches</div>
    {/each}
  </div>
{/if}

<style>
  .k-combobox {
    display: inline-flex; align-items: stretch; position: relative;
    min-width: 0; max-width: 100%; width: calc(var(--space-8) * 6); height: var(--ctl-h); vertical-align: middle;
    background: var(--bg-sunken); border: var(--bw) solid var(--line-ctl); border-radius: var(--radius);
    box-shadow: var(--recess);
    transition: border-color var(--t-quick) var(--ease-out), box-shadow var(--t-quick) var(--ease-out);
  }
  .k-combobox[data-size='sm'] { height: var(--ctl-h-sm); }
  .k-combobox[data-size='lg'] { height: var(--ctl-h-lg); }
  .k-combobox[data-full] { width: 100%; }
  .k-combobox:hover:not([data-disabled]) { border-color: var(--line-ctl-hover); }
  .k-combobox:focus-within { border-color: var(--focus); box-shadow: var(--recess), 0 0 0 1px var(--focus); }
  .k-combobox[data-invalid] { border-color: var(--bad-ink); }
  .k-combobox[data-disabled] { opacity: .45; cursor: not-allowed; }

  input {
    flex: 1 1 auto; min-width: 0; height: 100%; margin: 0; padding: 0 0 0 var(--pad-x);
    font: inherit; font-size: var(--fs-ui); color: var(--tx-val);
    background: none; border: 0; outline: none;
  }
  input:focus { color: var(--tx-hi); }
  input::placeholder { color: var(--tx-mut); opacity: 1; }
  input:disabled { cursor: not-allowed; }
  .k-combobox[data-size='sm'] input { font-size: var(--fs-2); padding-left: var(--space-3); }

  .k-combobox-toggle {
    flex: none; display: grid; place-items: center; width: calc(var(--space-3) * 2 + 14px); padding: 0;
    color: var(--tx-mut); background: none; border: 0; cursor: pointer;
    transition: color var(--t-quick) var(--ease-out);
  }
  .k-combobox-toggle:hover:not(:disabled) { color: var(--tx-hi); }
  .k-combobox-toggle:disabled { cursor: not-allowed; }

  .k-combobox-list { max-height: calc(var(--row-h) * 12 + var(--space-2) * 2 + 2px); }
  .k-combobox-list[data-size='sm'] { font-size: var(--fs-2); }
  .k-combobox-list .k-item { grid-template-columns: 16px minmax(0, 1fr) auto; }
  .k-item-check { display: grid; place-items: center; color: var(--accent-ink); }
  .k-item-hint:empty { padding: 0; }
  mark { background: none; color: var(--tx-hi); font-weight: 500; }
  .k-combobox-empty { padding: 0 var(--space-4); line-height: var(--row-h); color: var(--tx-mut); }
</style>
