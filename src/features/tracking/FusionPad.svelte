<script>
  // The standing fusion pad (paw-439e): the same value as the Tracker row's pad chip (derive.fuse.pad of the shot, or of
  // the range override the row edits: tr.fuseControls), as a square the owner sees and grabs. Press anywhere = the handle
  // jumps there and follows the pointer (Shift = fine: a quarter speed from where it was); the trace re-fuses per animation
  // frame (only the weighting re-runs), the release is one undo step, Esc / a cancelled pointer = back, nothing written.
  // Double-click = centre (the automatic choice), arrows nudge (Shift fine), 0 / Home = centre. The faint ring is where the
  // automatic choice sits; the edges say what each side means. In the fusion panel and as the floating pad (TrackingLane).
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { editorItem } from '../../ui/kit/editor-item.svelte.js';
  import { partList } from '../../lib/content.js';
  import { trackingFor } from './tracking.svelte.js';

  let { app, shot, span = null, run, auto = null, size = 132 } = $props();
  // svelte-ignore state_referenced_locally
  const tr = trackingFor(app);
  const stored = $derived.by(() => { const p = shot >= 0 && run ? tr.fuseControls(shot, span, run).pad : null; return { x: p?.x || 0, y: p?.y || 0 }; });
  let drag = $state(null), raf = 0, box = $state();
  const cur = $derived(drag?.cur || stored);
  const FINE = 0.25;
  const r2 = (v) => Math.round(v * 100) / 100, c1 = (v) => r2(Math.max(-1, Math.min(1, v)));
  const at = (v) => `${((v + 1) / 2) * 100}%`, top = (v) => `${((1 - v) / 2) * 100}%`;
  const text = (p) => (p.x || p.y ? `${p.x < 0 ? 'relative' : 'absolute'} ${Math.abs(p.x).toFixed(2)} · ${p.y < 0 ? 'core' : 'extremities'} ${Math.abs(p.y).toFixed(2)}` : 'centre: the automatic choice');
  const set = (p, label, commit = true) => tr.setFuse(shot, { pad: p && (p.x || p.y) ? { x: c1(p.x), y: c1(p.y) } : null }, { span, run, label, commit });
  /** Pointer -> pad value (the box: x -1..1 left to right, y -1..1 bottom to top). */
  const valueAt = (e) => { const b = box.getBoundingClientRect(); return { x: c1(((e.clientX - b.left) / b.width) * 2 - 1), y: c1(1 - ((e.clientY - b.top) / b.height) * 2) }; };
  function down(e) {
    if (e.button !== 0 || shot < 0 || !run) return;
    e.preventDefault();
    box.setPointerCapture(e.pointerId); box.focus({ preventScroll: true });
    const v = e.shiftKey ? { ...stored } : valueAt(e);
    drag = { cur: v, from: v, x0: e.clientX, y0: e.clientY, fine: e.shiftKey, shot, span, run };
    live();
  }
  function move(e) {
    const d = drag;
    if (!d) return;
    const fine = e.shiftKey;
    if (fine !== d.fine) { d.from = { ...d.cur }; d.x0 = e.clientX; d.y0 = e.clientY; d.fine = fine; }   // a gain change re-anchors: no jump
    const b = box.getBoundingClientRect();
    const v = fine ? { x: c1(d.from.x + ((e.clientX - d.x0) / b.width) * 2 * FINE), y: c1(d.from.y - ((e.clientY - d.y0) / b.height) * 2 * FINE) } : valueAt(e);
    drag = { ...d, cur: v };
    live();
  }
  function live() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; const q = drag; if (q) tr.setFuse(q.shot, { pad: q.cur }, { commit: false, span: q.span, run: q.run }); }); }
  function end(e) {
    const d = drag;
    drag = null; cancelAnimationFrame(raf); raf = 0;
    if (!d) return;
    if (e.type === 'pointerup') tr.setFuse(d.shot, { pad: d.cur.x || d.cur.y ? d.cur : null }, { span: d.span, run: d.run, label: 'Fusion: pad' });
    else { tr.derivePreview = null; tr.signalPreview = null; }   // cancelled: the preview goes, nothing written
  }
  function key(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape' && drag) { e.preventDefault(); e.stopPropagation(); end({ type: 'cancel' }); return; }
    if (e.key === '0' || e.key === 'Home') { e.preventDefault(); e.stopPropagation(); set(null, 'Fusion: pad back to centre'); }
  }
  // paw-5z78: the arrows come through the key map (the pad focused is the editor selection): 0.1, Shift 0.02
  const padItem = () => ({ nudge: (dx, dy, fine) => { if (shot >= 0 && run) set({ x: stored.x + dx * (fine ? 0.02 : 0.1), y: stored.y + dy * (fine ? 0.02 : 0.1) }, 'Fusion: pad'); } });
  const TIP = $derived(`Fusion pad: press anywhere and drag; the trace re-fuses as you move. Left = relative (the two bodies against each other: camera moves cancel), right = absolute (a body against the camera); up = extremities (hands, head, ${partList(['paws'])}), down = core (hips, thighs, torso). The centre is the automatic choice (scene type + phase); the faint ring is where that choice sits. Nothing is switched off, only weighted (x4 at an edge). Shift = fine, arrows nudge, double-click or 0 = centre. One undo step per drag. The same value as the pad chip on the Tracker row`);   // paw-43vn: the part examples follow furry items (lib/content.js)
</script>

<div class="fpad" style:--sz="{size}px" data-testid="fuse-standing-pad">
  <span class="t">extremities</span>
  <span class="l">relative</span>
  <div bind:this={box} class="box" class:on={!!drag} role="slider" tabindex="0" aria-label="Fusion pad: {text(cur)}{span ? ' (range override)' : ''}" aria-valuetext={text(cur)}
    aria-valuenow={cur.x} aria-valuemin={-1} aria-valuemax={1} {@attach tooltip(TIP + (span ? ' · Editing the range override' : ''))}
    onpointerdown={down} onpointermove={move} onpointerup={end} onpointercancel={end} onlostpointercapture={(e) => drag && end(e)}
    ondblclick={() => set(null, 'Fusion: pad back to centre')} onkeydown={key} {@attach editorItem(padItem)}>
    {#if auto}<i class="auto" style:left={at(auto.x)} style:top={top(auto.y)}></i>{/if}
    <i class="dot" style:left={at(cur.x)} style:top={top(cur.y)}></i>
  </div>
  <span class="r">absolute</span>
  <span class="b">core</span>
  <span class="v num">{text(cur)}</span>
</div>

<style>
  .fpad { display: grid; grid-template-columns: auto var(--sz) auto; grid-template-rows: auto var(--sz) auto auto; align-items: center; justify-content: center; gap: 2px 4px; font: var(--fs-1)/1.2 var(--mono); color: var(--tx-mut); user-select: none; }
  .box { position: relative; grid-column: 2; grid-row: 2; width: var(--sz); height: var(--sz); border: 1px solid var(--line-3); border-radius: var(--radius); cursor: crosshair; touch-action: none; outline: none;
    background: linear-gradient(var(--line-2), var(--line-2)) center / 1px 100% no-repeat, linear-gradient(var(--line-2), var(--line-2)) center / 100% 1px no-repeat, var(--bg-sunken); }
  .box:focus-visible { box-shadow: 0 0 0 var(--ring-w, 2px) var(--focus); }
  .box.on { border-color: var(--highlight); }
  .box i { position: absolute; border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none; }
  .dot { width: 12px; height: 12px; background: var(--highlight); box-shadow: 0 0 0 2px var(--bg-card); }
  .auto { width: 12px; height: 12px; border: 1.5px solid var(--tx-ghost); box-sizing: border-box; }
  .t { grid-column: 2; grid-row: 1; text-align: center; }
  .b { grid-column: 2; grid-row: 3; text-align: center; }
  .l { grid-column: 1; grid-row: 2; writing-mode: vertical-rl; transform: rotate(180deg); }
  .r { grid-column: 3; grid-row: 2; writing-mode: vertical-rl; }
  .v { grid-column: 1 / -1; grid-row: 4; text-align: center; color: var(--tx-val); }
</style>
