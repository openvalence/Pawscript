<!--
  ToggleButton: a Button with an on/off state (aria-pressed). Icon-only when it has no children: `label`
  is then its aria-label and default tooltip.
  <ToggleButton icon="magnet" label="Snap to frames" shortcut="S" bind:pressed={snap} />
  <ToggleButton variant="default" icon="loop" bind:pressed={loop}>Loop</ToggleButton>
-->
<script>
  import Button from './Button.svelte';

  let {
    pressed = $bindable(false),
    icon = '',
    label = '',
    variant = 'ghost',
    tip = undefined,
    onchange,
    onclick,
    children,
    class: cls = '',
    ...rest
  } = $props();

  const iconOnly = $derived(!children && !!icon);

  function click(e) {
    pressed = !pressed;
    onchange?.(pressed, e);
    onclick?.(e);
  }
</script>

<Button
  {icon}
  {variant}
  pressed={!!pressed}
  label={children || iconOnly ? '' : label}
  aria-label={iconOnly ? label : undefined}
  tip={tip ?? (iconOnly ? label : '')}
  class="k-toggle-button {cls}"
  onclick={click}
  {children}
  {...rest}
/>
