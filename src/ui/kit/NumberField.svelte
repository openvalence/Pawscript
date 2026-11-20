<!--
  NumberField: a recessed numeral field that types, nudges and scrubs.
  <NumberField bind:value min={0} max={4} step={0.05} unit="×" label="Speed" oncommit={pushUndo} />

  Pointer: at rest the field scrubs (ew-resize). Press and drag sideways past 3 px: the value follows (no pointer
  lock: the webview banners it, "press Esc to show your cursor"; Shift fine, Ctrl snaps to round values), `onchange` live, one `oncommit` at release. A press
  without a drag focuses and selects the text. Wheel does nothing (it belongs to the timeline).
  Keys: ArrowUp/Down ±step (Shift ×0.1, Ctrl to the next round value), PageUp/Down ×10, one `oncommit` when the key is released.
  Enter commits the typed text (parse, clamp, snap; unparseable text reverts) and keeps focus with the text
  selected. Escape reverts typed text and keeps focus; with nothing typed it passes through (a dialog closes).
  `default`: right click offers Reset to default (<default>), Copy value, Paste value (contextmenu.js property()).
-->
<script>
  import { tick } from 'svelte';
  import { snap, nudge, scrub as scrubBy, parseNumber, formatNumber } from './math.js';
  import { numberChars, displayDecimals, tidy, listen } from './fields.js';
  import { property } from './contextmenu.js';

  let {
    value = $bindable(0), min = -Infinity, max = Infinity, step = 1, decimals, unit = '', scrub = true, pxPerStep = 4,
    size = 'md', disabled = false, readonly = false, invalid = false, label = '', full = false, inputEl = $bindable(),
    default: dflt, onchange, oncommit, class: cls = '', ...rest
  } = $props();

  const THRESHOLD = 3; // px of travel before a press becomes a scrub
  const fmt = (v) => formatNumber(v, { decimals: displayDecimals(v, step, decimals) });
  const chars = $derived(numberChars({ min, max, step, decimals }));
  const bounds = $derived({ min, max, step });

  let root;
  let text = $state('');
  let dirty = $state(false);
  let focused = $state(false);
  let scrubbing = $state(false);
  const bad = $derived(dirty && !Number.isFinite(parseNumber(text)));
  const canScrub = $derived(scrub && !disabled && !readonly && !focused);

  // Follow the value whenever the person is not mid-typing.
  $effect(() => { const t = fmt(value); if (!dirty) text = t; });

  function set(v, e) {
    if (!Number.isFinite(v) || v === value) return;
    value = v;
    onchange?.(v, e);
  }
  const selectAll = () => tick().then(() => inputEl?.select());

  function commitText(e) {
    if (!dirty) return;
    const n = parseNumber(text), from = value;
    dirty = false;
    if (!Number.isFinite(n)) return; // reverts: the effect puts the value back
    set(snap(n, bounds), e);
    if (value !== from) oncommit?.(value);
  }

  // ---- keys -----------------------------------------------------------------
  let held = null; // { from } while a nudge key is down: one commit per hold
  const NUDGE = { ArrowUp: 1, ArrowDown: -1, PageUp: 1, PageDown: -1 };
  function keydown(e) {
    if (disabled || readonly) return;
    const dir = NUDGE[e.key];
    if (dir) {
      e.preventDefault();
      const typed = parseNumber(text);
      const base = dirty && Number.isFinite(typed) ? snap(typed, { min, max }) : value;
      held ??= { from: value };
      dirty = false;
      set(tidy(nudge(base, dir, bounds, e.key.startsWith('Page') ? { coarse: true } : e), bounds), e);
      selectAll();
    } else if (e.key === 'Enter' && !e.isComposing) {
      commitText(e);
      selectAll();
    } else if (e.key === 'Escape' && dirty) {
      e.preventDefault();
      e.stopPropagation();
      dirty = false;
      selectAll();
    }
  }
  function endHold() {
    if (held && value !== held.from) oncommit?.(value);
    held = null;
  }
  const keyup = (e) => { if (NUDGE[e.key]) endHold(); };

  // ---- the property's right click (with a default) -----------------------------
  /** One whole gesture to v (reset, paste): clamped and snapped, onchange then oncommit. */
  function gesture(v) {
    const from = value;
    dirty = false;
    set(snap(v, bounds));
    if (value !== from) oncommit?.(value);
  }
  const asProperty = (node) => (dflt === undefined ? undefined : property(() => ({
    value, default: dflt, disabled: disabled || readonly, set: gesture, parse: parseNumber,
    format: (v) => (Number.isFinite(v) ? fmt(v) + (unit ? ' ' + unit : '') : String(v)),
  }))(node));

  // ---- scrub ----------------------------------------------------------------
  let g = null; // the press: { id, from, base, acc, lastX, on, shift, ctrl }
  function pointerdown(e) {
    if (!canScrub || g || e.button !== 0) return;
    e.preventDefault(); // no caret, no focus, no text selection until we know it is a click
    g = { id: e.pointerId, from: value, base: value, acc: 0, lastX: e.clientX, on: false, shift: e.shiftKey, ctrl: e.ctrlKey };
    try { root.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    window.addEventListener('pointermove', pointermove);
    window.addEventListener('pointerup', pointerup);
    window.addEventListener('pointercancel', pointerup);
  }
  function pointermove(e) {
    if (!g || e.pointerId !== g.id) return;
    g.acc += e.clientX - g.lastX; g.lastX = e.clientX;
    if (!g.on) {
      if (Math.abs(g.acc) <= THRESHOLD) return;
      g.on = scrubbing = true;
      g.acc -= Math.sign(g.acc) * THRESHOLD;
    }
    if (e.shiftKey !== g.shift || e.ctrlKey !== g.ctrl) { // a modifier changed: continue from here at the new rate
      Object.assign(g, { base: value, acc: 0, shift: e.shiftKey, ctrl: e.ctrlKey });
      return;
    }
    const o = { step, pxPerStep };
    const raw = scrubBy(g.base, g.acc, o, e);
    // Past an end, the end becomes the new start: turning back moves the value at once.
    if (raw > max || raw < min) { set(raw > max ? max : min, e); Object.assign(g, { base: value, acc: 0 }); return; }
    set(tidy(scrubBy(g.base, g.acc, { ...o, min, max }, e), bounds), e);
  }
  function pointerup(e) {
    if (!g || e.pointerId !== g.id) return;
    const { on, from } = g;
    g = null;
    window.removeEventListener('pointermove', pointermove);
    window.removeEventListener('pointerup', pointerup);
    window.removeEventListener('pointercancel', pointerup);
    if (on) {
      scrubbing = false;
      if (value !== from) oncommit?.(value);
    } else if (e.type === 'pointerup') {
      inputEl.focus();
      inputEl.select();
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions (the pointer surface; the input inside is the control) -->
<div
  bind:this={root}
  class="k-number-field {cls}"
  data-size={size}
  class:kit-number-field-full={full}
  class:kit-number-field-invalid={invalid || bad}
  class:kit-number-field-disabled={disabled}
  class:kit-number-field-readonly={readonly}
  class:kit-number-field-scrub={canScrub}
  data-scrubbing={scrubbing || undefined}
  style:--chars={chars}
  onpointerdown={pointerdown}
  onmousedown={(e) => { if (canScrub) e.preventDefault(); }}
  {@attach asProperty}
>
  <input
    bind:this={inputEl}
    bind:value={text}
    class="k-num"
    type="text"
    inputmode="decimal"
    role="spinbutton"
    spellcheck="false"
    autocomplete="off"
    {disabled}
    {readonly}
    aria-label={label || undefined}
    aria-valuenow={Number.isFinite(value) ? value : undefined}
    aria-valuemin={Number.isFinite(min) ? min : undefined}
    aria-valuemax={Number.isFinite(max) ? max : undefined}
    aria-valuetext={unit ? `${fmt(value)} ${unit}` : undefined}
    aria-invalid={invalid || bad || undefined}
    {...rest}
    oninput={() => (dirty = true)}
    {@attach listen('keydown', keydown)}
    onkeyup={keyup}
    onfocus={() => (focused = true)}
    onblur={(e) => { focused = false; endHold(); commitText(e); }}
  />
  {#if unit}<span class="k-number-field-unit" aria-hidden="true">{unit}</span>{/if}
</div>

<style>
  .k-number-field {
    display: inline-flex; align-items: center; gap: var(--space-2); vertical-align: middle;
    min-width: 0; max-width: 100%; height: var(--ctl-h); padding: 0 var(--pad-x);
    background: var(--bg-sunken); border: var(--bw) solid var(--line-ctl); border-radius: var(--radius);
    box-shadow: var(--recess); color: var(--tx-val); font-size: var(--fs-ui); cursor: text;
    transition: border-color var(--t-quick) var(--ease-out), box-shadow var(--t-quick) var(--ease-out), color var(--t-quick) var(--ease-out);
  }
  .k-number-field[data-size='sm'] { height: var(--ctl-h-sm); font-size: var(--fs-2); }
  .k-number-field[data-size='lg'] { height: var(--ctl-h-lg); }
  .kit-number-field-full { display: flex; width: 100%; }
  .kit-number-field-scrub { cursor: ew-resize; touch-action: pan-y; user-select: none; }
  .kit-number-field-scrub input { cursor: ew-resize; }
  .k-number-field:hover { border-color: var(--line-ctl-hover); }
  .k-number-field:focus-within { border-color: var(--focus); box-shadow: var(--recess), 0 0 0 1px var(--focus); color: var(--tx-hi); }
  [data-scrubbing], [data-scrubbing]:hover { border-color: var(--highlight); color: var(--tx-hi); }
  .kit-number-field-invalid, .kit-number-field-invalid:hover, .kit-number-field-invalid:focus-within { border-color: var(--bad-ink); }
  .kit-number-field-invalid:focus-within { box-shadow: var(--recess), 0 0 0 1px var(--bad-ink); }
  .kit-number-field-readonly, .kit-number-field-readonly:hover { border-color: var(--line-2); }
  .kit-number-field-disabled { opacity: .45; cursor: not-allowed; }
  .kit-number-field-disabled:hover { border-color: var(--line-ctl); }
  input {
    flex: 1 1 auto; width: calc(var(--chars) * 1ch + 1px); min-width: 0; height: 100%; margin: 0; padding: 0;
    background: none; border: 0; outline: none; color: inherit; font-size: inherit; line-height: normal;
  }
  input:disabled { cursor: not-allowed; }
  .k-number-field-unit { flex: none; margin-left: auto; color: var(--tx-mut); font-size: var(--fs-2); white-space: nowrap; }
  [data-size='sm'] .k-number-field-unit { font-size: var(--fs-1); }
</style>
