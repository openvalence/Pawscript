<!--
  ScrollArea: a scroller with thin scrollbars and Phosphor's scroll recesses: a shade on each edge it
  can scroll toward (content fades into --shade-surface, default --bg; set it to the pane's surface).
  <ScrollArea style="height: 240px" bind:el>…</ScrollArea>
  The root does not scroll; `el` is the scrolling element. `viewport` = attributes for it (role,
  tabindex, aria-*, onkeydown) when the scroller itself must carry them (VirtualList, DataTable).
  --k-shade-top: an inset for the top shade (below a sticky header).
-->
<script>
  let {
    orientation = 'vertical', // 'vertical' | 'horizontal' | 'both'
    shadows = true,
    el = $bindable(),
    viewport = {},
    children,
    class: cls = '',
    ...rest
  } = $props();

  let top = $state(false), bottom = $state(false), left = $state(false), right = $state(false);

  // Hysteresis as Phosphor's scrollshade.js: on past 2 px, off under 0.5 px, so the last pixel never flickers.
  const hold = (was, px) => px > 2 || (px >= 0.5 && was);
  function update() {
    if (!el || !shadows) return;
    const { scrollTop: t, scrollLeft: l, clientHeight: h, clientWidth: w, scrollHeight: sh, scrollWidth: sw } = el;
    top = hold(top, t);
    bottom = hold(bottom, sh - t - h);
    left = hold(left, l);
    right = hold(right, sw - l - w);
  }

  const watch = (node) => {
    let raf = 0;
    const queue = () => { raf ||= requestAnimationFrame(() => { raf = 0; update(); }); };
    const ro = new ResizeObserver(queue);
    const observe = () => {
      ro.disconnect();
      ro.observe(node);
      for (const c of node.children) ro.observe(c);
      queue();
    };
    const mo = new MutationObserver(observe);
    mo.observe(node, { childList: true });
    node.addEventListener('scroll', update, { passive: true });
    observe();
    return () => {
      node.removeEventListener('scroll', update);
      mo.disconnect();
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  };
</script>

<div
  class="k-scroll-area {cls}"
  data-orient={orientation}
  data-shade-top={(shadows && top) || undefined}
  data-shade-bottom={(shadows && bottom) || undefined}
  data-shade-left={(shadows && left) || undefined}
  data-shade-right={(shadows && right) || undefined}
  {...rest}
>
  <div class="k-scroll k-scroll-viewport" bind:this={el} {@attach watch} {...viewport}>
    {@render children?.()}
  </div>
  {#if shadows}
    {#if orientation !== 'horizontal'}<i class="kit-scroll-area-shade" data-edge="top"></i><i class="kit-scroll-area-shade" data-edge="bottom"></i>{/if}
    {#if orientation !== 'vertical'}<i class="kit-scroll-area-shade" data-edge="left"></i><i class="kit-scroll-area-shade" data-edge="right"></i>{/if}
  {/if}
</div>

<style>
  .k-scroll-area {
    --shade-surface: var(--bg);
    --shade-size: 20px;
    position: relative; display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    min-width: 0; min-height: 0; overflow: hidden;
  }
  .k-scroll-viewport { min-width: 0; min-height: 0; outline: none; }
  [data-orient='vertical'] > .k-scroll-viewport { overflow: hidden auto; }
  [data-orient='horizontal'] > .k-scroll-viewport { overflow: auto hidden; }
  .k-scroll-viewport:focus-visible { box-shadow: inset 0 0 0 1px var(--focus); }

  /* Zero layout size; the content fades into the surface (Phosphor's recess), never a drawn line. */
  .kit-scroll-area-shade {
    position: absolute; pointer-events: none; opacity: 0; z-index: var(--z-sticky);
    --ink: color-mix(in srgb, var(--shade-surface) 85%, transparent);
    --mid: color-mix(in srgb, var(--shade-surface) 35%, transparent);
    --none: color-mix(in srgb, var(--shade-surface) 0%, transparent);
    transition: opacity var(--t-move) var(--ease-out);
  }
  .kit-scroll-area-shade[data-edge='top'] { top: var(--k-shade-top, 0px); left: 0; right: 0; height: var(--shade-size); background: linear-gradient(var(--ink), var(--mid) 40%, var(--none)); }
  .kit-scroll-area-shade[data-edge='bottom'] { bottom: 0; left: 0; right: 0; height: var(--shade-size); background: linear-gradient(0deg, var(--ink), var(--mid) 40%, var(--none)); }
  .kit-scroll-area-shade[data-edge='left'] { left: 0; top: var(--k-shade-top, 0px); bottom: 0; width: var(--shade-size); background: linear-gradient(90deg, var(--ink), var(--mid) 40%, var(--none)); }
  .kit-scroll-area-shade[data-edge='right'] { right: 0; top: var(--k-shade-top, 0px); bottom: 0; width: var(--shade-size); background: linear-gradient(270deg, var(--ink), var(--mid) 40%, var(--none)); }
  [data-shade-top] > [data-edge='top'], [data-shade-bottom] > [data-edge='bottom'],
  [data-shade-left] > [data-edge='left'], [data-shade-right] > [data-edge='right'] { opacity: 1; }
</style>
