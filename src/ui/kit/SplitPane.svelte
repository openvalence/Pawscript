<!--
  SplitPane: two panes and a Splitter. `size` is the px size of the primary pane (the first unless
  primary="second"); the other pane takes the rest. Both keep their minimums (clampSplit), `size` keeps
  what the person asked for, so a pane grows back when the window does.
  <SplitPane direction="horizontal" bind:size defaultSize={260} min={160} collapsible bind:collapsed
             onresize={(px) => localStorage.setItem('side', px)}>
    {#snippet first()}…{/snippet}
    {#snippet second()}…{/snippet}
  </SplitPane>
  Double-click the splitter resets to defaultSize; Enter toggles collapse; dragging a collapsible pane
  under half its minimum collapses it.
-->
<script>
  import Splitter from './Splitter.svelte';
  import { clampSplit } from './math.js';

  let {
    direction = 'horizontal',   // 'horizontal' = side by side, 'vertical' = stacked
    defaultSize = 240,
    size = $bindable(defaultSize),
    min = 80,
    max = Infinity,
    minOther = 80,
    primary = 'first',
    collapsible = false,
    collapsed = $bindable(false),
    label = 'Resize',
    onresize,
    oncommit,
    first,
    second,
    class: cls = '',
    ...rest
  } = $props();

  const horiz = $derived(direction === 'horizontal');
  let total = $state(0);
  let anim = $state(false);

  // What is drawn: the asked size held inside both minimums (total unknown before the first layout).
  const shown = $derived(clampSplit(size, { min, max, minOther, total: total || Infinity }));
  const now = $derived(collapsed ? 0 : shown);

  const measure = (node) => {
    const ro = new ResizeObserver(([e]) => {
      const b = e.contentBoxSize?.[0];
      total = Math.max(0, (horiz ? b?.inlineSize ?? node.clientWidth : b?.blockSize ?? node.clientHeight) - 1);
    });
    ro.observe(node);
    return () => ro.disconnect();
  };

  // A key from collapsed reopens and a key under the minimum closes; a drag closes under half the
  // minimum and reopens past it. Only the snap between open and closed animates.
  function resize(v, e) {
    const keyed = e?.type === 'keydown', was = collapsed;
    if (collapsible && keyed && was) collapsed = false;
    else if (collapsible) collapsed = v < (keyed ? min : min / 2);
    if (!collapsed && !(keyed && was)) size = clampSplit(v, { min, max, minOther, total: total || Infinity });
    anim = collapsed !== was;
    onresize?.(size, e);
  }
  function reset() {
    anim = true;
    collapsed = false;
    size = defaultSize;
    onresize?.(size);
    oncommit?.(size);
  }
  function toggle() {
    anim = true;
    collapsed = !collapsed;
    onresize?.(size);
    oncommit?.(size);
  }

  const pane = (which) => (which === primary ? 'primary' : 'other');
</script>

{#snippet slot(which, content)}
  {@const p = which === primary}
  <div
    class="kit-split-pane-pane"
    data-pane={pane(which)}
    data-collapsed={(p && collapsed) || undefined}
    inert={p && collapsed}
    style:flex-basis={p ? `${now}px` : undefined}
    style:--k-inner={p ? `${shown}px` : undefined}
  >
    {@render content?.()}
  </div>
{/snippet}

<div
  class="k-split-pane {cls}"
  data-dir={horiz ? 'h' : 'v'}
  data-primary={primary}
  data-anim={anim || undefined}
  {@attach measure}
  {...rest}
>
  {@render slot('first', first)}
  <!-- A read-only binding: the splitter always shows what is drawn, not its own last drag value. -->
  <Splitter
    orientation={horiz ? 'vertical' : 'horizontal'}
    bind:value={() => now, () => {}}
    min={collapsible ? 0 : min}
    max={Math.max(min, Math.min(max, (total || Infinity) - minOther))}
    reverse={primary === 'second'}
    {label}
    onresize={resize}
    oncommit={() => oncommit?.(size)}
    onreset={reset}
    ontoggle={collapsible ? toggle : undefined}
  />
  {@render slot('second', second)}
</div>

<style>
  .k-split-pane { display: flex; min-width: 0; min-height: 0; width: 100%; height: 100%; overflow: hidden; }
  .k-split-pane[data-dir='v'] { flex-direction: column; }
  .kit-split-pane-pane {
    position: relative; display: grid; min-width: 0; min-height: 0; overflow: hidden;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  }
  .kit-split-pane-pane[data-pane='other'] { flex: 1 1 0; }
  .kit-split-pane-pane[data-pane='primary'] { flex-grow: 0; flex-shrink: 0; }
  /* The primary pane's content keeps its width while the pane closes, so collapsing clips it, anchored to
     the outer edge, instead of reflowing it. */
  [data-dir='h'] > .kit-split-pane-pane[data-pane='primary'] { grid-template-columns: var(--k-inner); }
  [data-dir='v'] > .kit-split-pane-pane[data-pane='primary'] { grid-template-rows: var(--k-inner); }
  [data-primary='second'] > .kit-split-pane-pane[data-pane='primary'] { justify-content: end; align-content: end; }
  [data-anim] > .kit-split-pane-pane[data-pane='primary'] { transition: flex-basis var(--t-move) var(--ease-out); }
</style>
