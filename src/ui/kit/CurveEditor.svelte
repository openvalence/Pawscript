<!--
  CurveEditor: direct manipulation of a few numbers drawn as a curve (curve.js has the pure half).
  <CurveEditor {lines} {handles} {twins} onpreview={(key, v) => draft} oncommit={(key) => write} oncancel={(key) => drop} />
  lines:   [{ pts: [[x, y], ...], kind?: 'curve' | 'guide' | 'ghost', color? }]   viewBox units (W x H); color = a CSS colour
  handles: [{ key, label, x, y, shape: 'dot' | 'vpill' | 'hpill' | 'diamond', axis: 'x' | 'y' | 'xy', text,
              value, min, max, step, toValue(x, y) -> number, color? }]
  twins:   [{ key, label, value, min, max, step, unit }]   numeric fields, shown on request (showInputs)
  A handle's shape is its drag axis (dot any way, vpill left-right, hpill up-down, diamond = a tangent marker that
  slides). Drags are relative to the grab at half gain, Shift fine; every move previews, the release commits once,
  Esc cancels. Handles are sliders: PageUp/Down 20 steps, Home/End (the key-up commits); a focused (clicked) handle is the app's
  editor selection (editor-item.svelte.js, paw-5z78): the arrows nudge it 5 steps (Shift 1) through the key map, each press one
  commit; Escape drops it.
-->
<script>
  import NumberField from './NumberField.svelte';
  import { tooltip } from './tooltip.js';
  import { HIT, GAIN, FINE, snapTo, nearestHandle, placeLabels } from './curve.js';
  import { editorItem } from './editor-item.svelte.js';

  let { lines = [], handles = [], twins = [], W = 300, H = 140, height = 150, showInputs = $bindable(false),
    onpreview, oncommit, oncancel, label = 'Curve editor', class: cls = '' } = $props();

  let box = $state(), bw = $state(0), bh = $state(0), drag = null, active = $state(null);
  const px = (x, y) => ({ x: (x / W) * bw, y: (y / H) * bh });
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const local = (e) => { const r = box.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }; };

  function down(e) {
    if (e.button !== 0) return;
    const r = box.getBoundingClientRect();
    const i = nearestHandle(handles.map((h) => px(h.x, h.y)), e.clientX - r.left, e.clientY - r.top, HIT);
    if (i < 0) return;
    e.preventDefault();
    const h = handles[i];
    box.querySelector(`[data-key="${h.key}"]`)?.focus({ preventScroll: true });
    box.setPointerCapture?.(e.pointerId);
    drag = { key: h.key, h0: { x: h.x, y: h.y }, p0: local(e), gain: e.shiftKey ? FINE : GAIN };
    active = h.key;
  }
  function move(e) {
    if (!drag) return;
    const h = handles.find((x) => x.key === drag.key);
    if (!h) return;
    const p = local(e), gain = e.shiftKey ? FINE : GAIN;
    const at = () => ({ x: clamp(drag.h0.x + (p.x - drag.p0.x) * drag.gain, 0, W), y: clamp(drag.h0.y + (p.y - drag.p0.y) * drag.gain, 0, H) });
    if (gain !== drag.gain) { drag.h0 = at(); drag.p0 = p; drag.gain = gain; }   // a gain change re-anchors: no jump
    const q = at(), v = snapTo(h.toValue(h.axis === 'y' ? h.x : q.x, h.axis === 'x' ? h.y : q.y), h);
    if (Number.isFinite(v) && v !== h.value) onpreview?.(h.key, v);
  }
  function up() { const d = drag; drag = null; active = null; if (d) oncommit?.(d.key); }
  function cancel() { const d = drag; drag = null; active = null; if (d) oncancel?.(d.key); }

  const KEYS = { PageUp: 4, PageDown: -4, Home: 'min', End: 'max' };
  function key(e, h) {
    if (e.key === 'Escape' && drag) { e.preventDefault(); e.stopPropagation(); cancel(); return; }
    const k = KEYS[e.key];
    if (k === undefined) return;
    e.preventDefault(); e.stopPropagation();
    const st = h.step || 1;
    const v = k === 'min' ? h.min : k === 'max' ? h.max : (h.value ?? h.min) + k * st * (e.shiftKey ? 1 : 5);
    const s = snapTo(v, h);
    if (s !== h.value) onpreview?.(h.key, s);
  }
  const keyup = (e, h) => { if (e.key in KEYS) oncommit?.(h.key); };
  // the arrows (the key map's editor.nudge*): 5 steps, fine 1; previewed and committed at once
  const nudger = (key) => () => ({ nudge(dx, dy, fine) {
    const h = handles.find((x) => x.key === key), k = dx || dy;
    if (!h || !k) return;
    const s = snapTo((h.value ?? h.min) + k * (h.step || 1) * (fine ? 1 : 5), h);
    if (s !== h.value) { onpreview?.(h.key, s); oncommit?.(h.key); }
  } });

  // labels beside their handles, clear of the lines (px; the plot stretches)
  const tags = $derived.by(() => {
    if (!bw || !bh) return [];
    const items = handles.map((h) => { const p = px(h.x, h.y); return { x: p.x, y: p.y, w: String(h.text ?? '').length * 6.2 + 8, h: 14 }; });
    const pl = lines.filter((l) => l.kind !== 'ghost').map((l) => l.pts.map(([x, y]) => [(x / W) * bw, (y / H) * bh]));
    return placeLabels(items, pl, bw, bh).map((r, i) => ({ dx: r.x - items[i].x, dy: r.y - items[i].y, bg: r.bg }));
  });
  const poly = (pts) => pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="k-curve {cls}" bind:this={box} bind:clientWidth={bw} bind:clientHeight={bh} style:height="{height}px" aria-label={label}
  onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={cancel}>
  <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-hidden="true">
    {#each lines as l, i (i)}<polyline class={l.kind ?? 'curve'} points={poly(l.pts)} style:stroke={l.color} />{/each}
  </svg>
  {#each handles as h, i (h.key)}
    <div class="h" class:on={active === h.key} role="slider" tabindex="0" data-key={h.key} data-shape={h.shape ?? (h.axis === 'y' ? 'hpill' : h.axis === 'xy' ? 'dot' : 'vpill')}
      aria-label={h.label} aria-valuenow={h.value ?? undefined} aria-valuemin={h.min} aria-valuemax={h.max} aria-orientation={h.axis === 'y' ? 'vertical' : 'horizontal'}
      style:--hc={h.color} style:left="{(h.x / W) * 100}%" style:top="{(h.y / H) * 100}%" onkeydown={(e) => key(e, h)} onkeyup={(e) => keyup(e, h)} {@attach tooltip(h.label)} {@attach editorItem(nudger(h.key))}>
      {#if h.text && tags[i]}<span class="tag" class:bg={tags[i].bg} style:transform="translate({tags[i].dx}px, {tags[i].dy}px)">{h.text}</span>{/if}
    </div>
  {/each}
</div>
{#if showInputs && twins.length}
  <div class="k-curve-twins">
    {#each twins as t (t.key)}
      <label><span>{t.label}</span>
        <NumberField size="sm" value={t.value ?? t.min} min={t.min} max={t.max} step={t.step || 1} unit={t.unit || ''} label={t.label}
          onchange={(v) => onpreview?.(t.key, snapTo(v, t))} oncommit={() => oncommit?.(t.key)} /></label>
    {/each}
  </div>
{/if}

<style>
  .k-curve { position: relative; width: 100%; user-select: none; touch-action: none; background: var(--bg-sunken);
    border: var(--bw) solid var(--line-1); border-radius: var(--radius); }
  svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  polyline { fill: none; vector-effect: non-scaling-stroke; }
  .curve { stroke: var(--reality); stroke-width: 2; }
  .guide { stroke: var(--line-3); stroke-dasharray: 4 4; }
  .ghost { stroke: var(--tx-ghost); stroke-width: 1; stroke-dasharray: 2 3; }
  .h { position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; outline: none; cursor: grab; }
  .h::after { content: ''; position: absolute; left: 50%; top: 50%; width: 12px; height: 12px; translate: -50% -50%; box-sizing: border-box;
    border-radius: 50%; border: 2px solid var(--hc, var(--reality)); background: var(--bg-card); }
  .h[data-shape='vpill']::after { width: 8px; height: 18px; border-radius: var(--radius-pill); }
  .h[data-shape='hpill']::after { width: 18px; height: 8px; border-radius: var(--radius-pill); }
  .h[data-shape='diamond']::after { width: 10px; height: 10px; border-radius: var(--radius); transform: rotate(45deg); }
  .h:hover::after, .h.on::after { outline: 1px solid var(--highlight); outline-offset: 2px; }
  .h:focus-visible::after { outline: var(--ring-w, 2px) solid var(--focus); outline-offset: 2px; }
  .h.on { cursor: grabbing; }
  .tag { position: absolute; left: 50%; top: 50%; white-space: nowrap; pointer-events: none; padding: 0 3px; border-radius: var(--radius);
    font: 10px/14px var(--mono); color: var(--tx-val); }
  .tag.bg { background: color-mix(in srgb, var(--bg-card) 85%, transparent); }
  .k-curve-twins { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--space-1) var(--space-3); margin-top: var(--space-2); }
  .k-curve-twins label { display: flex; flex-direction: column; gap: 2px; font-size: var(--fs-1); color: var(--tx-mut); min-width: 0; }
  .k-curve-twins span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
