<!--
  TextField: a recessed one-line text input. `oninput` on every keystroke, `onchange` on Enter or blur when
  the text changed, `onenter` on Enter. Clearable fields clear on the × button and on Escape (when not empty).
  <TextField bind:value placeholder="Search chapters" icon="search" clearable />
-->
<script>
  import Icon from './Icon.svelte';
  import { listen } from './fields.js';

  let {
    value = $bindable(''), placeholder = '', icon, clearable = false, type = 'text', invalid = false, size = 'md',
    disabled = false, readonly = false, label = '', full = false, inputEl = $bindable(),
    oninput, onchange, onenter, class: cls = '', ...rest
  } = $props();

  let committed = value;
  const commit = (e) => {
    if (value === committed) return;
    committed = value;
    onchange?.(value, e);
  };
  function key(e) {
    if (e.key === 'Enter' && !e.isComposing) { commit(e); onenter?.(value, e); }
    else if (e.key === 'Escape' && clearable && value && !readonly) { e.preventDefault(); e.stopPropagation(); clear(e); }
  }
  function clear(e) {
    value = '';
    oninput?.(value, e);
    commit(e);
    inputEl?.focus();
  }
</script>

<div class="k-text-field {cls}" data-size={size} class:kit-text-field-invalid={invalid} class:kit-text-field-disabled={disabled} class:kit-text-field-readonly={readonly} class:kit-text-field-full={full}>
  {#if icon}<Icon name={icon} size={size === 'sm' ? 14 : 16} class="kit-text-field-lead" />{/if}
  <input
    bind:this={inputEl}
    bind:value
    {type}
    {placeholder}
    {disabled}
    {readonly}
    aria-label={label || undefined}
    aria-invalid={invalid || undefined}
    spellcheck="false"
    autocomplete="off"
    {...rest}
    oninput={(e) => oninput?.(value, e)}
    {@attach listen('keydown', key)}
    onfocus={() => (committed = value)}
    onblur={commit}
  />
  {#if clearable && value && !disabled && !readonly}
    <button type="button" class="kit-text-field-clear" tabindex="-1" aria-label="Clear" onpointerdown={(e) => e.preventDefault()} onclick={clear}>
      <Icon name="close" size={size === 'sm' ? 12 : 14} />
    </button>
  {/if}
</div>

<style>
  .k-text-field {
    display: inline-flex; align-items: center; gap: var(--space-3); vertical-align: middle;
    width: calc(var(--space-8) * 6); min-width: 0; max-width: 100%; height: var(--ctl-h); padding: 0 var(--pad-x);
    background: var(--bg-sunken); border: var(--bw) solid var(--line-ctl); border-radius: var(--radius);
    box-shadow: var(--recess); color: var(--tx-val); font-size: var(--fs-ui); cursor: text;
    transition: border-color var(--t-quick) var(--ease-out), box-shadow var(--t-quick) var(--ease-out), color var(--t-quick) var(--ease-out);
  }
  .k-text-field[data-size='sm'] { height: var(--ctl-h-sm); font-size: var(--fs-2); gap: var(--space-2); }
  .k-text-field[data-size='lg'] { height: var(--ctl-h-lg); }
  .kit-text-field-full { display: flex; width: 100%; }
  .k-text-field:hover { border-color: var(--line-ctl-hover); }
  .k-text-field:focus-within { border-color: var(--focus); box-shadow: var(--recess), 0 0 0 1px var(--focus); color: var(--tx-hi); }
  .kit-text-field-invalid, .kit-text-field-invalid:hover { border-color: var(--bad-ink); }
  .kit-text-field-readonly, .kit-text-field-readonly:hover { border-color: var(--line-2); }
  .kit-text-field-disabled { opacity: .45; cursor: not-allowed; }
  .kit-text-field-disabled:hover { border-color: var(--line-ctl); }
  input {
    flex: 1; min-width: 0; height: 100%; margin: 0; padding: 0;
    background: none; border: 0; outline: none; color: inherit; font: inherit; line-height: normal;
    text-overflow: ellipsis;
  }
  input::placeholder { color: var(--tx-mut); opacity: 1; }
  input:disabled { cursor: not-allowed; }
  input[type='search']::-webkit-search-cancel-button { display: none; }
  .k-text-field > :global(.kit-text-field-lead) { color: var(--tx-mut); }
  .kit-text-field-clear {
    flex: none; display: grid; place-items: center; margin-right: calc(-1 * var(--space-2)); padding: var(--space-1);
    background: none; border: 0; border-radius: var(--radius); color: var(--tx-mut); cursor: pointer;
    transition: color var(--t-quick) var(--ease-out);
  }
  .kit-text-field-clear:hover { color: var(--tx-hi); background: var(--bg-hover); }
  .kit-text-field-clear:active { color: var(--highlight); }
</style>
