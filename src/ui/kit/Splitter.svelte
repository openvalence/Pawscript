<!--
  Splitter: the separator between two panes, for custom layouts (SplitPane uses it).
  `value` is the size in px of the pane it resizes; `reverse` when that pane comes after the splitter
  (a right sidebar, a bottom panel), so dragging toward it shrinks it.
  <Splitter orientation="vertical" bind:value={w} min={120} max={480} label="Resize sidebar"
            onresize={(v) => save(v)} onreset={() => (w = 240)} ontoggle={() => (hidden = !hidden)} />
  Keys: arrows ±8 px (Shift ±40), Home / End to min / max, Enter toggles (ontoggle). Double-click: onreset.
  paw-oben: a click selects it (ui/kit/editor-item.svelte.js; a resize drag does not): the plain arrows reach it through the key
  map (the key guard keeps them from its keydown), Esc drops it and the arrows step frames again.
-->
<script>
  import { clamp } from './math.js';
  import { editorItem } from './editor-item.svelte.js';

  let {
    orientation = 'vertical', // the line's direction: 'vertical' sits between columns (col-resize)
    value = $bindable(0),
    min = 0,
    max = Infinity,
    step = 8,
    bigStep = 40,
    reverse = false,
    label = 'Resize',
    disabled = false,
    onresize,
    oncommit,
    onreset,
    ontoggle,
    class: cls = '',
    ...rest
  } = $props();

  const vertical = $derived(orientation === 'vertical');
  let drag = $state(false);
  let from = 0, start = 0, moved = false;

  function set(v, e) {
    v = Math.round(clamp(v, min, max));
    if (v === value) return;
    value = v;
    onresize?.(v, e);
  }

  function down(e) {
    if (disabled || e.button !== 0) return;
    e.preventDefault(); // no text selection, no focus ring from a drag
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });   // the editor selection (prevented, the press would not focus it)
    drag = true;
    moved = false;
    from = vertical ? e.clientX : e.clientY;
    start = value;
  }
  function move(e) {
    if (!drag) return;
    const d = (vertical ? e.clientX : e.clientY) - from;
    if (!moved && Math.abs(d) < 1) return;
    moved = true;
    set(start + (reverse ? -d : d), e);
  }
  function up(e) {
    if (!drag) return;
    drag = false;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (moved) { oncommit?.(value); e.currentTarget.blur?.(); }   // a resize drag selects nothing: the arrows step frames again; a click selects
  }

  /** One arrow step toward +1 (right / down) or -1, Shift (big) a big one; the guard passes arrows here only with keyboard
   *  navigation on, else they come through nudge (the editor selection). */
  function stepBy(dir, big, e) {
    const s = big ? bigStep : step;
    set(value + (reverse ? -dir : dir) * s, e);
    oncommit?.(value);
  }
  // dx: -1 left / 1 right, dy: 1 up / -1 down (editor-commands.js); only the splitter's own axis moves it
  const nudge = () => ({ nudge: (dx, dy, big) => { const dir = vertical ? dx : -dy; if (!disabled && dir) stepBy(dir, big); } });

  function key(e) {
    if (disabled) return;
    const inc = vertical ? 'ArrowRight' : 'ArrowDown', dec = vertical ? 'ArrowLeft' : 'ArrowUp';
    let v = null;
    if (e.key === inc || e.key === dec) { e.preventDefault(); stepBy(e.key === inc ? 1 : -1, e.shiftKey, e); return; }
    if (e.key === 'Home') v = min;
    else if (e.key === 'End' && Number.isFinite(max)) v = max;
    else if (e.key === 'Enter' && ontoggle) { e.preventDefault(); ontoggle(e); return; }
    if (v === null) return;
    e.preventDefault();
    set(v, e);
    oncommit?.(value);
  }
</script>

<!-- A window splitter is a focusable separator (WAI-ARIA APG). -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="k-splitter {cls}"
  role="separator"
  tabindex={disabled ? -1 : 0}
  aria-orientation={orientation}
  aria-valuenow={Math.round(value)}
  aria-valuemin={min}
  aria-valuemax={Number.isFinite(max) ? max : undefined}
  aria-label={label}
  aria-disabled={disabled || undefined}
  data-orient={vertical ? 'v' : 'h'}
  data-drag={drag || undefined}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  onlostpointercapture={up}
  ondblclick={() => !disabled && onreset?.()}
  onkeydown={key}
  {@attach editorItem(nudge)}
  {...rest}
></div>

<style>
  /* One hairline in the layout; the hit area (::before) reaches 4 px past each side; the lit band
     (::after) is 3 px of --highlight on hover (after a beat, so passing over does not flash), drag, focus. */
  .k-splitter {
    --hit: 4px;
    position: relative; flex: none; z-index: var(--z-raised);
    background: var(--line-1); outline: none; touch-action: none;
  }
  .k-splitter[data-orient='v'] { width: 1px; align-self: stretch; cursor: col-resize; }
  .k-splitter[data-orient='h'] { height: 1px; justify-self: stretch; cursor: row-resize; }
  .k-splitter::before, .k-splitter::after { content: ''; position: absolute; }
  .k-splitter[data-orient='v']::before { inset: 0 calc(var(--hit) * -1); }
  .k-splitter[data-orient='h']::before { inset: calc(var(--hit) * -1) 0; }
  /* While dragging the hit area covers the window: the cursor holds and nothing else hovers. */
  .k-splitter[data-drag]::before { position: fixed; inset: 0; }
  .k-splitter[data-orient='v']::after { inset: 0 -1px; }
  .k-splitter[data-orient='h']::after { inset: -1px 0; }
  .k-splitter::after {
    background: var(--highlight); opacity: 0; pointer-events: none;
    transition: opacity var(--t-quick) var(--ease-out);
  }
  .k-splitter:hover::after { opacity: 1; transition-delay: var(--t-quick); }
  .k-splitter:is([data-drag], :focus-visible)::after { opacity: 1; transition-delay: 0s; }
  .k-splitter[aria-disabled='true'] { cursor: default; }
  .k-splitter[aria-disabled='true']::after { display: none; }
  @media (pointer: coarse) { .k-splitter { --hit: 10px; } }
</style>
