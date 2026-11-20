<!--
  StrokeWindow: the machine's stroke as a window on the toy, beside the Machine view. The track is "how much of the
  toy is inside" in mm (0 = the tip at the opening, up to the hilt = the usable length), with the toy's own profile
  drawn along it and the tip, the knot's widest point and the hilt marked. The deep end may go up to `over` mm past
  the hilt (hatched: the base pressing into the body, physics.js); the hilt still snaps, so going past it is deliberate. The window's lower grip = inside at pos 100
  (fully out; below 0 = the tip held outside), the upper grip = inside at pos 0 (deepest). Drag a grip to move that end,
  the middle to slide the whole window; double-click resets to the default; it snaps to tip / knot / hilt (Shift: no
  snap); the arrows nudge a focused grip (Shift x10: the app's editor selection, paw-5z78). A filled marker shows the real depth now, a hollow one where a
  rigid toy would be. One settings write per drag end (onchange); live while dragging (onpreview).
  Depth from video (paw-8x1, video.js): when the tracked shaft has trusted readings (src non-null) the header picks what
  drives the Machine (script / video / both: onsrc); `v` = the video's mm inside now (NaN: no trusted reading), drawn
  as a second marker (an orange bar across the track) in "both".
  The hilt mark (the toy's usable length) moves with Alt+drag (the owner's correction: onhilt(fraction of the length),
  one write on release); Alt+double-click on it gives back the library's (onhilt(null)). Plain drags never move it.
-->
<script>
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { editorItem } from '../../ui/kit/editor-item.svelte.js';
  import { SegmentedControl } from '../../ui/kit/index.js';
  import { radiusAt, maxRadius } from './toys.js';

  let { toy, knot = null, rig, d = NaN, dc = NaN, over = 40, onpreview, onchange, onreset, src = null, v = NaN, onsrc, onhilt } = $props();
  const SRC = [{ value: 'script', label: 'S', tip: 'Depth from the script (what the device gets)' },
    { value: 'video', label: 'V', tip: 'Depth from the video where trusted, else the script' },
    { value: 'both', label: 'S+V', tip: 'The script drives, the video depth shows in orange' }];
  let cv = $state(), box = $state(), h = $state(0), w = $state(0), drag = null, live = $state(null), focusGrip = $state('');
  let liveHilt = $state(null);
  const hilt0 = $derived(Math.min(toy.length_mm, toy.usable_mm || toy.length_mm)), hilt = $derived(liveHilt ?? hilt0);
  const win = $derived(live || valid(rig.offsetMm, rig.offsetMm + rig.strokeMm));   // as the physics clamps it
  const lo = $derived(Math.min(-40, Math.floor((Math.min(win.out, 0) - 15) / 10) * 10)), hi = $derived(hilt0 + over + 8);   // the scale stays put while the hilt mark is dragged
  const PAD = 10;
  const yOf = (mm) => PAD + (1 - (mm - lo) / (hi - lo)) * (h - 2 * PAD);
  const mmOf = (y) => lo + (1 - (y - PAD) / (h - 2 * PAD)) * (hi - lo);
  const snaps = $derived([0, hilt, ...(knot ? [knot.peak_mm] : [])]);
  const snap = (mm, free) => { if (free) return mm; const near = snaps.find((s) => Math.abs(s - mm) <= 4); return near ?? mm; };
  /** A window made valid: out < deep - 10, deep at most `over` past the hilt, out at least minus the toy's length. */
  function valid(out, deep) {
    deep = Math.min(hilt + over, Math.round(deep)); out = Math.max(-toy.length_mm, Math.round(out));
    if (out > deep - 10) out = deep - 10;
    return { out, deep };
  }
  const rigOf = ({ out, deep }) => ({ offsetMm: out, strokeMm: deep - out });

  $effect(() => {
    if (!cv || !w || !h) return;
    win; toy; knot; d; dc; focusGrip; v; src; hilt;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d'), css = (n) => getComputedStyle(cv).getPropertyValue(n).trim();
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = 20, R = maxRadius(toy) || 1, k = Math.min(1, 14 / R), lx = cx + 21, nx = cx + 50;
    // mm ticks
    g.strokeStyle = css('--line-3'); g.fillStyle = css('--tx-faint'); g.font = `9px ${css('--mono') || 'monospace'}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.lineWidth = 1;
    for (let mm = Math.ceil(lo / 10) * 10; mm <= hi; mm += 10) {
      const y = Math.round(yOf(mm)) + 0.5, big = mm % 50 === 0;
      g.beginPath(); g.moveTo(nx - 7, y); g.lineTo(nx - 7 + (big ? 5 : 3), y); g.stroke();
      if (big && !snaps.some((s) => Math.abs(yOf(s) - y) < 9)) g.fillText(String(mm), nx, y);
    }
    // the toy's profile along the track: tip at 0, base at its length
    g.fillStyle = css('--series-violet'); g.globalAlpha = 0.55;
    g.beginPath();
    for (let s = 0; s <= toy.length_mm; s += 2) { const r = radiusAt(toy, s) * k; s ? g.lineTo(cx - r, yOf(s)) : g.moveTo(cx - r, yOf(s)); }
    for (let s = toy.length_mm; s >= 0; s -= 2) g.lineTo(cx + radiusAt(toy, s) * k, yOf(s));
    g.closePath(); g.fill(); g.globalAlpha = 1;
    // tip, knot, hilt
    const mark = (mm, label, col) => { const y = Math.round(yOf(mm)) + 0.5; g.strokeStyle = col; g.beginPath(); g.moveTo(cx - 17, y); g.lineTo(nx - 8, y); g.stroke(); g.fillStyle = col; g.font = `9px ${css('--font') || 'sans-serif'}`; g.fillText(label, nx - 4, y); };
    mark(0, 'tip', css('--tx-mut'));
    if (knot) mark(knot.peak_mm, 'knot', css('--accent'));
    mark(hilt, 'hilt', css('--tx-mut'));
    // past the hilt: hatched (the base pressing into the body)
    { const ya = yOf(hilt + over), yb = yOf(hilt); g.save(); g.beginPath(); g.rect(cx - 18, ya, 36, yb - ya); g.clip(); g.strokeStyle = css('--line-3'); g.lineWidth = 1;
      for (let x = -40; x < 80; x += 6) { g.beginPath(); g.moveTo(cx - 18 + x, yb); g.lineTo(cx - 18 + x + (yb - ya), ya); g.stroke(); } g.restore(); }
    // the window
    const y0 = yOf(win.deep), y1 = yOf(win.out);
    g.fillStyle = css('--accent'); g.globalAlpha = 0.18; g.fillRect(cx - 18, y0, 36, y1 - y0); g.globalAlpha = 1;
    g.strokeStyle = css('--accent'); g.lineWidth = 1.5; g.strokeRect(cx - 18 + 0.5, y0 + 0.5, 35, y1 - y0 - 1);
    for (const [y, key] of [[y0, 'deep'], [y1, 'out']]) {
      g.fillStyle = focusGrip === key ? css('--accent') : css('--bg-raised'); g.strokeStyle = css('--accent');
      g.beginPath(); g.roundRect(cx - 20, y - 3.5, 40, 7, 3); g.fill(); g.stroke();
    }
    // the real depth now (filled) and where a rigid toy would be (hollow)
    const dot = (mm, fill) => { if (!Number.isFinite(mm)) return; const y = yOf(Math.max(lo, Math.min(hi, mm))); g.beginPath(); g.moveTo(lx, y); g.lineTo(lx + 7, y - 4); g.lineTo(lx + 7, y + 4); g.closePath(); g.fillStyle = css('--tx'); g.strokeStyle = css('--tx'); if (fill) g.fill(); else g.stroke(); };
    dot(dc, false); dot(d, true);
    if (src === 'both' && Number.isFinite(v)) {   // the video's depth: an orange bar across the track
      const y = Math.round(yOf(Math.max(lo, Math.min(hi, v))));
      g.fillStyle = css('--series-orange'); g.fillRect(cx - 19, y - 1, 38, 2); g.fillRect(lx, y - 1, 9, 2);
    }
  });

  const at = (e) => e.clientY - cv.getBoundingClientRect().top;
  function which(y) { const a = yOf(win.deep), b = yOf(win.out); return Math.abs(y - a) <= 7 ? 'deep' : Math.abs(y - b) <= 7 ? 'out' : y > a && y < b ? 'mid' : null; }
  /** The hilt mark: Alt+drag moves it (from just past the knot, or a third of the toy, to its end). */
  const nearHilt = (y) => Math.abs(y - yOf(hilt)) <= 6;
  const hiltLo = () => (knot ? knot.to_mm + 2 : 0.3 * toy.length_mm);
  function down(e) {
    if (e.button !== 0) return;
    const y = at(e);
    if (e.altKey && onhilt && nearHilt(y)) {
      // a second Alt+click on it within 400 ms (a double-click: the captured pointer swallows dblclick) gives the library's back
      if (performance.now() - altClick < 400) { altClick = 0; onhilt(null); return; }
      e.preventDefault(); cv.setPointerCapture(e.pointerId); drag = { part: 'hilt', from: hilt }; liveHilt = hilt; return;
    }
    const part = which(y);
    if (!part) return;
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    drag = { part, y, win: { ...win } };
    if (part !== 'mid') box?.querySelector(`.grip[data-part="${part}"]`)?.focus({ preventScroll: true });   // paw-5z78: pressed = selected (the arrows nudge it)
  }
  function move(e) {
    if (!drag) { cv.style.cursor = e.altKey && onhilt && nearHilt(at(e)) ? 'ns-resize' : which(at(e)) ? (which(at(e)) === 'mid' ? 'grab' : 'ns-resize') : ''; return; }
    if (drag.part === 'hilt') { liveHilt = Math.round(Math.max(hiltLo(), Math.min(toy.length_mm, mmOf(at(e))))); return; }
    const dm = mmOf(at(e)) - mmOf(drag.y), w0 = drag.win, free = e.shiftKey;
    let next;
    if (drag.part === 'deep') next = valid(w0.out, snap(w0.deep + dm, free));
    else if (drag.part === 'out') next = valid(snap(w0.out + dm, free), w0.deep);
    else { const len = w0.deep - w0.out, deep = Math.min(hilt + over, snap(w0.deep + dm, free)); next = valid(deep - len, deep); }
    live = next; onpreview?.(rigOf(next));
  }
  function up() {
    if (!drag) return;
    const was = drag;
    drag = null;
    if (was.part === 'hilt') { if (liveHilt != null && liveHilt !== was.from) onhilt?.(liveHilt / toy.length_mm); else altClick = performance.now(); liveHilt = null; return; }
    if (live) { onchange?.(rigOf(live)); live = null; }
  }
  let altClick = 0;
  function dbl(e) { if (!(e.altKey && nearHilt(at(e)))) onreset?.(); }
  // paw-5z78: a focused grip is the editor selection: the arrows (through the key map) nudge it 1 mm, Shift 10
  const gripItem = (part) => () => ({ nudge: (dx, dy, fine) => {
    const dir = dx || dy, st = fine ? 10 : 1;
    if (!dir) return;
    const next = part === 'deep' ? valid(win.out, win.deep + dir * st) : valid(win.out + dir * st, win.deep);
    onchange?.(rigOf(next));
  } });
  const sized = (node) => { const o = new ResizeObserver(([e]) => { w = e.contentRect.width; h = e.contentRect.height; }); o.observe(node); return () => o.disconnect(); };
</script>

<div class="sw" bind:this={box}>
  {#if src}<div class="src"><SegmentedControl size="sm" full label="Depth from" options={SRC} value={src} onchange={(x) => onsrc?.(x)} /></div>{/if}
  <div class="track" {@attach sized}>
    <canvas bind:this={cv} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} ondblclick={dbl}
      aria-label="Stroke window" {@attach tooltip('Stroke window: drag an end or the middle (Shift: no snap)')}></canvas>
    {#each [['deep', win.deep, 'Deepest: mm of the toy inside at pos 0'], ['out', win.out, 'Fully out: mm of the toy inside at pos 100']] as [part, mm, label] (part)}
      <div class="grip" role="slider" tabindex="0" data-part={part} aria-label={label} aria-valuenow={mm} aria-valuemin={part === 'out' ? -toy.length_mm : win.out + 10} aria-valuemax={part === 'deep' ? hilt + over : win.deep - 10}
        style:top="{yOf(mm) - 6}px" onfocus={() => (focusGrip = part)} onblur={() => (focusGrip = '')} {@attach editorItem(gripItem(part))} onpointerdown={down} onpointermove={move} onpointerup={up}></div>
    {/each}
  </div>
  <div class="swro k-num">
    <span>out</span><span>{win.out}</span>
    <span>deep</span><span {@attach tooltip(win.deep > hilt ? `Deepest: ${Math.round(win.deep - hilt)} mm past the hilt, base pressing in` : 'Deepest: mm of the toy inside')}>{win.deep > hilt ? `H+${Math.round(win.deep - hilt)}` : win.deep}</span>
    <span>stroke</span><span>{win.deep - win.out}</span>
    <span class="u">mm in</span>
  </div>
</div>

<style>
  .sw { flex: none; width: 84px; display: flex; flex-direction: column; border-right: var(--bw) solid var(--line-1); background: var(--bg); min-height: 0; }
  .src { flex: none; padding: var(--space-1); }
  .src :global(.kit-segmented-control-seg) { flex: 1; min-width: 0; padding-inline: 0; justify-content: center; }   /* three short labels in 84 px */
  .track { flex: 1; position: relative; min-height: 90px; }   /* 120 cut the readout's last line ("mm in") in the 180 px view row */
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
  .grip { position: absolute; left: 2px; width: 40px; height: 12px; cursor: ns-resize; }
  .grip:focus-visible { outline: var(--ring-w, 2px) solid var(--focus); outline-offset: 1px; border-radius: var(--radius); }
  /* a two-column table: label left, value right, one line each */
  .swro { flex: none; display: grid; grid-template-columns: auto 1fr; gap: 1px var(--space-1); padding: var(--space-2) var(--space-2) var(--space-3); font-size: var(--fs-1); color: var(--tx-mut); white-space: nowrap; }
  .swro > span:nth-child(2n) { text-align: right; color: var(--tx-val); }
  .swro .u { grid-column: 1 / -1; color: var(--tx-faint); text-align: left; }
</style>
