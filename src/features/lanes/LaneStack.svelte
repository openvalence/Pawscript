<script>
  // The lane editor: a toolbar, then one canvas per axis (paw-g56v: no header bar; its controls sit over the canvas, LaneHeader),
  // all spanning the full row width so every timeline row shares one x-axis. Lanes never scroll: when preferred heights exceed the
  // space they shrink in proportion (geom.js laneHeights: down to MIN_H, or SHORT_MIN_H when space is short; below that the stack
  // scrolls); spare space goes to the first expanded lane. A collapsed lane is a COLLAPSED_H strip.
  import { onMount } from 'svelte';
  import { lanes, MIN_H, COLLAPSED_H, defaultHeight } from './state.svelte.js';
  import { laneHeights } from './geom.js';
  import { share, roomOf } from '../../app/areas.js';
  import { xToMs } from '../../lib/lane.js';
  import LaneView from './LaneView.svelte';
  import LaneHeader from './LaneHeader.svelte';
  import LaneToolbar from './LaneToolbar.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import PointPopover from './PointPopover.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  // paw-unuy: on the Track tab the stroke lane IS the tracker lane (the tracking feature's TrackingLane wraps it: the runs' traces
  // under its points, the range overrides / direction strips and the shot's inspector band under it). No tracking feature: plain.
  const TrackLane = Object.values(import.meta.glob('../tracking/TrackingLane.svelte', { eager: true }))[0]?.default ?? null;

  let { app, height = undefined, grow = undefined } = $props();   // grow(px): this row's bottom edge (Timeline), -> px applied
  const st = lanes(app);
  // the toolbar's height follows the kit's density tokens: measured, not assumed
  let boxH = $state(0), barH = $state(34), root = $state(null);

  const ids = $derived(st.ids());
  const trackAxis = $derived(TrackLane && app.mode === 'track' ? (ids.includes('stroke') ? 'stroke' : ids[0]) : null);   // the axis the runs are made for
  const nShut = $derived(ids.filter((id) => st.flag('collapsed', id)).length);
  // less the toolbar, the collapsed strips and each row's 1 px top border
  const avail = $derived(Math.max(0, (typeof height === 'number' ? height : boxH) - barH - nShut * COLLAPSED_H - ids.length));
  const heights = $derived(laneHeights(ids.map((id) => (st.flag('collapsed', id) ? 0 : st.height(id))), avail));
  // reorder: drag a lane's gutter (or a collapsed strip) onto another lane row; the drop line shows above / below it
  let over = $state(null);   // {id, where: 'before' | 'after'}
  const isLane = (e) => e.dataTransfer?.types.includes('text/x-pawscript-lane');
  function dragover(e, id) {
    if (!isLane(e)) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    over = { id, where: e.clientY < r.top + r.height / 2 ? 'before' : 'after' };
  }
  function drop(e, id) {
    if (!isLane(e)) return;
    e.preventDefault();
    const from = e.dataTransfer.getData('text/x-pawscript-lane'), where = over?.where;
    over = null;
    if (from === id) return;
    const next = ids.filter((x) => x !== from);
    next.splice(next.indexOf(id) + (where === 'after' ? 1 : 0), 0, from);
    st.setLayout({ order: next });
  }

  // The grip under a lane moves that lane's bottom edge (paw-3lmy). Between two lanes the height goes from one to the other (a split
  // pane: areas.js share); under the last open lane the edge is the lanes row's own (grow: the rows below, else the timeline section),
  // so the stack never outgrows its row. No grow, no grip there. Ctrl+wheel over a lane and a double-click (its default height) too.
  const open = $derived(ids.map((_, k) => k).filter((k) => heights[k] > 0));
  const lastOpen = $derived(open.at(-1));
  /** Lane k's bottom edge d px down from where `hs` (the open lanes' px) has it; done: px the row already grew this gesture. -> px grown. */
  function edge(k, d, hs = open.map((j) => heights[j]), done = 0) {
    const at = open.indexOf(k), mins = hs.map(() => MIN_H);
    if (at < 0) return done;
    let out;
    if (at < open.length - 1) out = share(hs, mins, at, d);
    else {
      if (!grow) return done;
      done += grow(Math.max(d, -roomOf(hs, mins, 0, hs.length)) - done);
      out = share([...hs, Infinity], [...mins, 0], at, done).slice(0, -1);
    }
    st.setLayout({ h: { ...st.layout.h, ...Object.fromEntries(open.map((j, x) => [ids[j], out[x]])) } });
    return done;
  }
  let split = null;
  function splitDown(e, k) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    split = { k, y0: e.clientY, hs: open.map((j) => heights[j]), done: 0 };
  }
  function splitMove(e) { if (split) split.done = edge(split.k, e.clientY - split.y0, split.hs, split.done); }
  function splitUp() { split = null; }
  $effect(() => { st.resizeLane = (axis, d) => edge(ids.indexOf(axis), d); return () => (st.resizeLane = null); });
  // hover scrub: the playhead follows the mouse over the lanes (no button held, not while playing or Space-panning; not while
  // the Groups tool is open: player.hoverHold, paw-iwb7)
  function hoverMove(e) {
    if (!st.hoverScrub || e.buttons || st.spaceHeld || app.player.playing || app.player.hoverHold || e.pointerType === 'touch') return;
    const c = e.target.closest?.('.lane'); if (!c) return;   // the lane itself (paw-unuy: not the strips / inspector band under the combined lane)
    const r = c.getBoundingClientRect(), t = xToMs(app.view, r.width, e.clientX - r.left);
    if (!Number.isFinite(t)) return;
    const p = app.player;
    const c0 = Math.max(0, Math.min(app.durationMs, t));   // out of range (paw-g56v): the nearest end
    p.scrubPxMs = app.view.span / r.width; p.scrubTime = c0;   // the unsnapped time, for views that follow the script
    p.scrub ? p.scrub(c0) : p.seek(c0, { exact: true });   // scrub: decoded frames over the video, one seek at rest (smooth: paw-ef73.14)
  }

  onMount(() => {
    // observe (never handle) Space so Space-drag pans; the keymap still owns the key itself
    const kd = (e) => { if (e.code === 'Space' && !e.repeat) st.spaceHeld = true; };
    const ku = (e) => { if (e.code === 'Space') st.spaceHeld = false; };
    const bl = () => (st.spaceHeld = false);
    window.addEventListener('keydown', kd, true); window.addEventListener('keyup', ku, true); window.addEventListener('blur', bl);
    return () => { window.removeEventListener('keydown', kd, true); window.removeEventListener('keyup', ku, true); window.removeEventListener('blur', bl); };
  });
</script>

<div class="stack kit-root" bind:this={root} bind:clientHeight={boxH} style:height={typeof height === 'number' ? height + 'px' : '100%'} onpointermove={hoverMove} onpointerleave={() => { app.player.scrubTime = null; app.player.scrubEnd?.(); }}>
  <div class="bar" bind:offsetHeight={barH}><LaneToolbar {app} /></div>
  {#each ids as id, i (id)}
    <div class="lrow" class:collapsed={!heights[i]} class:over-before={over?.id === id && over.where === 'before'} class:over-after={over?.id === id && over.where === 'after'}
      role="group" aria-label="{id} lane" ondragover={(e) => dragover(e, id)} ondragleave={() => (over = null)} ondrop={(e) => drop(e, id)}>
      {#if !heights[i]}
        <div style:height={COLLAPSED_H + 'px'}><LaneHeader {app} axis={id} /></div>
      {:else}
        <div class="canvas" style:height={heights[i] + 'px'}>
          {#if id === trackAxis}
            <TrackLane {app}>{#snippet lane(under, claim, band)}<LaneView {app} axis={id} {under} {claim} edge={band} /><LaneHeader {app} axis={id} />{/snippet}</TrackLane>
          {:else}<LaneView {app} axis={id} /><LaneHeader {app} axis={id} />{/if}
        </div>
        {#if i !== lastOpen || grow}
          <div class="split" role="separator" aria-orientation="horizontal" aria-label="Resize {id} lane"
            {@attach tooltip(i === lastOpen ? 'Drag to resize this lane and the timeline' : 'Drag to resize (double-click: default height)')}
            onpointerdown={(e) => splitDown(e, i)} onpointermove={splitMove} onpointerup={splitUp} onpointercancel={splitUp} ondblclick={() => edge(i, defaultHeight(id) - heights[i])}></div>
        {/if}
      {/if}
    </div>
  {/each}
</div>
<ContextMenu {app} source={root} />
<PointPopover {app} />

<style>
  .bar { flex: none; }
  .stack { display: flex; flex-direction: column; min-height: 0; overflow: hidden auto; background: var(--bg); user-select: none; }
  .lrow { position: relative; flex: none; border-top: var(--bw) solid var(--line-1); }
  .bar + .lrow { border-top: none; }
  .canvas { position: relative; }
  .split { position: absolute; left: 0; right: 0; bottom: -3px; height: 6px; cursor: ns-resize; z-index: 2; }
  /* inside the stack: overhanging it would make it scroll. paw-s3ex: the section's bottom edge is an area border (Areas .border,
     z-index 2) whose hit band reaches 4 px up over this grip: above it, the press is the grip's (it sizes the lane, the border
     would hand the room to the squeezed rows first and its double-click resets the section) */
  .lrow:last-child .split { bottom: 0; z-index: 3; }
  .split:hover { background: linear-gradient(transparent 2px, var(--line-3) 2px, var(--line-3) 4px, transparent 4px); }
  .lrow.over-before::after, .lrow.over-after::after { content: ''; position: absolute; left: 0; right: 0; height: 2px; background: var(--highlight); z-index: 3; pointer-events: none; }
  .lrow.over-before::after { top: 0; }
  .lrow.over-after::after { bottom: 0; }
</style>
