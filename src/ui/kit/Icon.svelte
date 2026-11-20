<!--
  Icon: one glyph from icons.js. Decorative (aria-hidden) unless `label` is given.
  <Icon name="play" />  <Icon name="warning" size={12} label="Warning" />
  A custom glyph anywhere an icon name is accepted (Button, Menu items, Select options…): an object
  { path } (stroked like the set), { fill } (filled), both, and optional viewBox (default '0 0 16 16').
  <Icon name={{ path: 'M2 8h12M8 2v12' }} />
-->
<script>
  import { iconPaths } from './icons.js';

  let { name, size = 16, label = '', class: cls = '', ...rest } = $props();
  const custom = $derived(name && typeof name === 'object');
  const p = $derived(custom ? { s: name.path ?? name.s ?? '', f: name.fill ?? name.f ?? '' } : iconPaths(name));
</script>

<svg
  class="k-icon {cls}"
  viewBox={(custom && name.viewBox) || '0 0 16 16'}
  width={size}
  height={size}
  role={label ? 'img' : undefined}
  aria-label={label || undefined}
  aria-hidden={label ? undefined : 'true'}
  focusable="false"
  {...rest}
>
  {#if p.f}<path class="kit-icon-f" d={p.f} />{/if}
  {#if p.s}<path class="kit-icon-s" d={p.s} />{/if}
</svg>

<style>
  .k-icon { flex: none; display: block; overflow: visible; }
  .kit-icon-f { fill: currentColor; }
  /* --icon-stroke (public): the stroke in viewBox units, e.g. 1 to keep a 32 px glyph at the 16 px weight. */
  .kit-icon-s { fill: none; stroke: currentColor; stroke-width: var(--icon-stroke, 1.5); stroke-linecap: round; stroke-linejoin: round; }
</style>
