<!--
  Field: a label, the control, a hint or an error, wired for assistive tech. The control comes as a snippet that
  receives { id, describedby, labelledby }: put `id` and `aria-describedby` on the control (native inputs are
  then labelled by <label for>; custom ones such as Slider or RadioGroup also take aria-labelledby).

  <Field label="Offset" hint="Shifts every action">
    {#snippet children({ id, describedby })}<NumberField {id} aria-describedby={describedby} bind:value unit="ms" />{/snippet}
  </Field>

  `inline`: label in a fixed left column (--field-label-w, default 96 px) so stacked inline fields align.
-->
<script>
  import Icon from './Icon.svelte';
  import { nextId } from './focus.js';

  let {
    label = '', hint = '', error = '', inline = false, required = false, for: forId, children, class: cls = '', ...rest
  } = $props();

  const base = nextId('k-field');
  const id = $derived(forId || base);
  const hintId = `${base}-hint`, errorId = `${base}-error`, labelId = `${base}-label`;
  const describedby = $derived([error && errorId, hint && hintId].filter(Boolean).join(' ') || undefined);

  // <label for> focuses native controls; a custom control (role=slider, radiogroup) is focused here instead.
  function labelClick(e) {
    const t = document.getElementById(id);
    if (!t || 'labels' in t) return;
    e.preventDefault();
    (t.matches('[tabindex], [role=slider]') ? t : t.querySelector('input:checked, [aria-checked="true"], [tabindex="0"], input, [tabindex]'))?.focus();
  }
</script>

<div class="k-field {cls}" class:kit-field-inline={inline} {...rest}>
  {#if label}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions (a label click; keys reach the control itself) -->
    <label class="kit-field-label" id={labelId} for={id} onclick={labelClick}>
      <span class="kit-field-label-text">{label}</span>
      {#if required}<span class="kit-field-req" aria-hidden="true">*</span><span class="k-sr">(required)</span>{/if}
    </label>
  {/if}
  <div class="kit-field-body">
    {@render children?.({ id, describedby, labelledby: label ? labelId : undefined })}
    {#if error}
      <div class="kit-field-msg kit-field-error" id={errorId}><Icon name="warning" size={14} /><span>{error}</span></div>
    {/if}
    {#if hint}<div class="kit-field-msg" id={hintId}>{hint}</div>{/if}
  </div>
</div>

<style>
  .k-field { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
  .kit-field-inline {
    display: grid; grid-template-columns: var(--field-label-w) minmax(0, 1fr);
    column-gap: var(--space-4); row-gap: 0; align-items: start;
  }
  .kit-field-label {
    display: flex; align-items: baseline; gap: var(--space-1); min-width: 0;
    font-size: var(--fs-2); font-weight: 500; line-height: var(--lh-tight); color: var(--tx-mut);
    text-transform: var(--label-case); letter-spacing: .04em; cursor: default;
  }
  .kit-field-inline > .kit-field-label { align-items: center; min-height: var(--ctl-h); }
  .kit-field-label-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kit-field-req { color: var(--tx-mut); }
  .kit-field-body { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); min-width: 0; }
  .kit-field-body > :global(*) { max-width: 100%; }
  .kit-field-msg { font-size: var(--fs-2); line-height: var(--lh-tight); color: var(--tx-mut); }
  .kit-field-error { display: flex; align-items: center; gap: var(--space-2); color: var(--bad-ink); }
  .kit-field-error > :global(svg) { flex: none; }
</style>
