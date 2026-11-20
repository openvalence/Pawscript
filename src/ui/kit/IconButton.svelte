<!--
  IconButton: a square Button holding one icon. `label` is required: it becomes aria-label and the tooltip.
  <IconButton icon="undo" label="Undo" shortcut="Ctrl+Z" onclick={undo} />
-->
<script>
  import Button from './Button.svelte';

  let { icon, label, variant = 'ghost', tip = undefined, class: cls = '', ...rest } = $props();
</script>

<Button {icon} {variant} aria-label={label} tip={tip ?? label} class="k-icon-button {cls}" {...rest} />
