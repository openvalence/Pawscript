<script>
  // The body of the window as Blender areas (layout.svelte.js holds the tree per mode, areas.js lays it out).
  // Everything is absolutely placed from one pixel layout and keyed by id, so a split, a join or a dock elsewhere
  // only moves boxes: the video element, the timeline and every open panel stay the same nodes.
  //   resize: drag a border · border right-click: split / join / swap · drag a tab or an area's empty header onto
  //   another area: edge = dock there, middle = add as tab (an area: swap) · drag an area corner inward: split,
  //   outward onto a neighbour: join (Ctrl+drag a corner: move the area) · Esc or right-click cancels a drag.
  import Area from './Area.svelte';
  import Timeline from './Timeline.svelte';
  import VideoArea from './VideoArea.svelte';
  import Splitter from '../ui/kit/Splitter.svelte';
  import EmptyState from '../ui/kit/EmptyState.svelte';
  import Button from '../ui/kit/Button.svelte';
  import { showContextMenu } from '../ui/kit/contextmenu.js';
  import { placeTray, leaves, at, neighbour, inside, hitZone, zoneRect, find, dockTake, GAP } from './areas.js';

  let { app } = $props();
  let root = $state(), W = $state(0), H = $state(0);
  const L = $derived(app.layout);
  const tree = $derived(L.tree);
  const placed = $derived(L.placed);
  const all = $derived(Object.values(placed).flat());
  const max = $derived(L.maximized);
  const full = $derived({ x: 0, y: 0, w: W, h: H });
  // the open bottom tray takes its px from the timeline, never the video (areas.js placeTray, paw-idb5)
  const geo = $derived(placeTray(tree, full, { hidden: (l) => L.hidden(l, placed), activeOf: (l) => L.active(l, placed)?.id }));
  const give = $derived(geo.give);
  const shown = $derived(leaves(tree).filter((l) => geo.rects[l.id]));   // maximised: the others stay mounted, undrawn
  const rectOf = (id) => (max ? (id === max ? full : null) : geo.rects[id]);
  const kindLeaf = (k) => leaves(tree).find((l) => l.kind === k);
  // the open panel of every unfolded area, in registration order (a stable DOM order: nothing is ever moved)
  const bodies = $derived.by(() => {
    const where = new Map();
    for (const l of shown) if (!l.kind && !l.collapsed) { const p = L.active(l, placed); if (p) where.set(p.id, l.id); }
    return (app.panels || []).filter((p) => where.has(p.id)).map((p) => ({ p, leaf: where.get(p.id) }));
  });
  const pos = (r) => (r ? `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px` : 'display:none');
  const bodyPos = (r) => (r ? `left:${r.x}px;top:calc(${r.y}px + var(--ctl-h));width:${r.w}px;height:calc(${r.h}px - var(--ctl-h))` : 'display:none');

  // The timeline's top border: past the video's minimum it takes the room from the open bottom dock (no more dead end), and a
  // double-click gives it the default size back.
  const tlFound = $derived(find(tree, 'timeline')), dockLeaf = $derived(leaves(tree).find((l) => l.home === 'bottom'));
  const dockFound = $derived(dockLeaf && !dockLeaf.collapsed && geo.rects[dockLeaf.id] ? find(tree, dockLeaf.id) : null);
  const parentOf = (p) => p.slice(0, Math.max(0, p.lastIndexOf('.')));
  const tlPath = $derived(tlFound ? parentOf(tlFound.path) : null);
  const dockH = $derived(dockFound && dockFound.parent.kids[dockFound.parent.pin] === dockFound.leaf ? geo.rects[dockLeaf.id].h : 0);
  const dockPath = $derived(dockFound ? parentOf(dockFound.path) : '');
  const tlPinned = $derived(!!tlFound?.parent && tlFound.parent.kids[tlFound.parent.pin] === tlFound.leaf);
  const isTl = (b) => tlPinned && b.path === tlPath;
  function resizeBorder(b, v) {
    const g = give;   // read before the tray changes (a derived re-reads its new height)
    if (isTl(b) && v > b.max && dockH) {
      const { size, take } = dockTake(v, b.max, dockH);
      if (take) L.resize(dockPath, dockH - take);
      L.resize(b.path, size + (g ? g - take : 0));
      return;
    }
    L.resize(b.path, isTl(b) ? v + g : v);
  }
  // The timeline's bottom edge (its last lane's grip, paw-3lmy): d px more (or less) timeline, traded with the open bottom dock (never
  // under its 120 px minimum) first, then with the video above it (the top border moves). -> the px applied.
  function growTimeline(d) {
    const b = geo.borders.find(isTl);
    if (!b) return 0;
    const dk = dockH ? Math.max(0, Math.min(d, dockH - 120)) : 0;
    const k = Math.round(Math.max(b.min - b.value, Math.min(d, dk + b.max - b.value)));
    if (!k) return 0;
    let nd = dockH;
    if (dockH && (k < 0 || dk)) L.resize(dockPath, (nd = dockH - (k < 0 ? k : Math.min(k, dk))));
    L.resize(b.path, b.value + k + (give ? nd + GAP : 0));   // the timeline split keeps timeline + tray (give)
    return k;
  }

  // ---- gestures: pointer events, captured once the pointer travels (a press alone stays a click) ----
  let g = $state(null);      // {kind: 'tab'|'area'|'corner'|'pick', id, from, corner, dir, x0, y0, live}
  let drop = $state(null);   // {op, ok, rect, line?, ...} what releasing here does
  const local = (e) => { const b = root.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  const leafAt = (x, y) => shown.find((l) => inside(rectOf(l.id), x, y));

  function grab(e, what) {
    if (e.button !== 0 || g?.kind === 'pick') return;
    const [x, y] = local(e);
    g = { ...what, kind: what.kind === 'corner' && e.ctrlKey ? 'area' : what.kind, x0: x, y0: y, live: false, pid: e.pointerId };
    if (g.kind === 'corner' || g.kind === 'area' && what.kind === 'corner') e.preventDefault();
    addEventListener('pointermove', move, true);
    addEventListener('pointerup', up, true);
    addEventListener('pointercancel', end, true);
  }
  function move(e) {
    if (!g) return;
    if (e.buttons & 2) { end(); return; }   // right button while dragging: cancel (Blender)
    const [x, y] = local(e);
    if (!g.live) {
      if (Math.hypot(x - g.x0, y - g.y0) < 6) return;
      g.live = true;
      try { root.setPointerCapture(e.pointerId); } catch { /* the pointer is gone */ }
      addEventListener('keydown', key, true);
      addEventListener('contextmenu', ctx, true);
    }
    e.preventDefault();
    drop = target(x, y);
  }
  // where a drop at (x, y) lands, and whether it may
  function target(x, y) {
    if (g.kind === 'corner') return cornerTarget(x, y);
    const l = leafAt(x, y), r = l && rectOf(l.id);
    if (!l) return null;
    if (g.kind === 'pick') return splitAt(l, r, g.dir === 'row' ? 'right' : 'bottom', x, y);
    const zone = hitZone(r, x, y);
    let ok = true;
    if (g.kind === 'tab') ok = !(zone === 'center' && (l.kind || l.id === g.from)) && !(l.id === g.from && (placed[g.from] || []).length < 2);
    else ok = l.id !== g.from;
    return { op: g.kind, to: l.id, zone, ok, rect: zoneRect(r, zone), size: zone === 'left' || zone === 'right' ? r.w / 2 : r.h / 2 };
  }
  // a new area on `side` of leaf l, its border at the pointer
  function splitAt(l, r, side, x, y) {
    const size = { left: x - r.x, right: r.x + r.w - x, top: y - r.y, bottom: r.y + r.h - y }[side];
    const row = side === 'left' || side === 'right';
    const rect = { left: { ...r, w: size }, right: { ...r, x: x, w: size }, top: { ...r, h: size }, bottom: { ...r, y: y, h: size } }[side];
    return { op: 'split', to: l.id, side, size, ok: size >= 40 && (row ? r.w : r.h) - size >= 40, rect, line: row ? { x, y: r.y, w: 1, h: r.h } : { x: r.x, y, w: r.w, h: 1 } };
  }
  // Blender's corner action zone: inward splits this area, outward onto a neighbour joins it
  function cornerTarget(x, y) {
    const r = rectOf(g.from);
    if (!r) return null;
    if (inside(r, x, y)) {
      const row = Math.abs(x - g.x0) >= Math.abs(y - g.y0);
      const side = row ? (g.corner.includes('l') ? 'left' : 'right') : (g.corner.includes('t') ? 'top' : 'bottom');
      return splitAt({ id: g.from }, r, side, x, y);
    }
    const over = { left: r.x - x, right: x - (r.x + r.w), top: r.y - y, bottom: y - (r.y + r.h) };
    const edge = Object.keys(over).reduce((m, k) => (over[k] > over[m] ? k : m));
    const nb = neighbour(tree, g.from, edge), nr = nb && rectOf(nb.id);
    return { op: 'join', gone: nb?.id, ok: !!nr && L.canJoin(g.from, nb.id), rect: nr || null };
  }
  function up(e) {
    if (!g) return;
    if (g.live && drop?.ok) {
      const d = drop, what = g;
      if (d.op === 'tab') L.moveTab(what.id, d.to, d.zone, d.size);
      else if (d.op === 'area') L.moveArea(what.id, d.to, d.zone, d.size);
      else if (d.op === 'split') L.split(d.to, d.side, d.size);
      else if (d.op === 'join') L.join(what.from, d.gone);
    }
    if (g.live) { e.preventDefault(); e.stopPropagation(); swallowClick(); }
    end();
  }
  function end() {
    if (g?.live) try { root.releasePointerCapture(g.pid); } catch { /* released already */ }
    g = null; drop = null;
    removeEventListener('pointermove', move, true);
    removeEventListener('pointerup', up, true);
    removeEventListener('pointercancel', end, true);
    removeEventListener('keydown', key, true);
    removeEventListener('contextmenu', ctx, true);
  }
  function key(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); end(); } }
  function ctx(e) { e.preventDefault(); e.stopImmediatePropagation(); end(); }
  // the click that ends a drag must not also press the tab / button it ends on
  function swallowClick() {
    const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
    addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => removeEventListener('click', stop, { capture: true }), 0);
  }

  // ---- Blender's border menu (right-click a border): split / join / swap ----
  function pick(dir) {   // the split line follows the pointer over any area; click places it, Esc / right-click cancels
    g = { kind: 'pick', dir, live: true };
    addEventListener('keydown', key, true);
    addEventListener('contextmenu', ctx, true);
  }
  function pickMove(e) { if (g?.kind === 'pick') { const [x, y] = local(e); drop = target(x, y); } }
  function pickDown(e) {
    if (g?.kind !== 'pick') return;
    e.preventDefault(); e.stopPropagation();
    if (e.button === 0 && drop?.ok) L.split(drop.to, drop.side, drop.size);
    end();
  }
  function borderMenu(e, b) {
    const n = at(tree, b.path), [a, c] = n.kids, row = n.dir === 'row', [sa, sc] = row ? ['left', 'right'] : ['top', 'bottom'];
    const leaf = (k) => !k.kids;
    showContextMenu(e, [
      { section: 'Area options' },
      { label: 'Vertical split', icon: 'panel-right', run: () => pick('row') },
      { label: 'Horizontal split', icon: 'panel-bottom', run: () => pick('col') },
      { separator: true },
      { label: `Join: keep the ${sa} area`, disabled: !(leaf(a) && leaf(c) && L.canJoin(a.id, c.id)), run: () => L.join(a.id, c.id) },
      { label: `Join: keep the ${sc} area`, disabled: !(leaf(a) && leaf(c) && L.canJoin(c.id, a.id)), run: () => L.join(c.id, a.id) },
      { label: 'Swap areas', run: () => L.swapSides(b.path) },
    ]);
  }
  function split(id, side) { const r = rectOf(id); if (r) L.split(id, side, (side === 'right' ? r.w : r.h) / 2); }
  // paw-m3b6: the area.split* commands split at half of what is drawn here
  $effect(() => { L.splitHalf = split; });
  function hover(e) { if (!g) { const [x, y] = local(e); L.hover = leafAt(x, y)?.id || null; } }
  const CORNERS = ['tl', 'tr', 'bl', 'br'];
</script>

{#snippet failed(error, reset)}
  <EmptyState class="failed" title="This panel crashed" description="Your document is safe; details are in the console.">
    <pre>{error?.message || error}</pre>
    {#snippet actions()}<Button size="sm" onclick={reset}>Reload panel</Button>{/snippet}
  </EmptyState>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="areas" class:dragging={g?.live} bind:this={root} bind:clientWidth={W} bind:clientHeight={H} onpointermove={hover} onpointerleave={() => { if (!g) L.hover = null; }}>
  {#each shown as l (l.id)}
    {#if !l.kind}
      <div class="slot" style={pos(rectOf(l.id))} data-area={l.id}>
        <Area {app} leaf={l} panels={placed[l.id] || []} {all} edge={max ? '' : geo.edges[l.id]} maximized={max === l.id} ongrab={grab} onsplit={(side) => split(l.id, side)} />
      </div>
    {/if}
  {/each}
  {#each bodies as { p, leaf } (p.id)}
    <div class="slot body k-scroll" style={bodyPos(rectOf(leaf))} data-panel={p.id}>
      {#key p.id}
        <svelte:boundary {failed} onerror={(e) => { console.error('[panel ' + p.id + ']', e); app.toast(p.title + ' panel crashed: ' + (e?.message || e), 'error'); }}>
          <p.component {app} />
        </svelte:boundary>
      {/key}
    </div>
  {/each}
  <div class="slot" style={pos(rectOf(kindLeaf('video')?.id))} data-area="video"><VideoArea {app} /></div>
  <div class="slot" style={pos(rectOf(kindLeaf('timeline')?.id))} data-area="timeline"><Timeline {app} grow={max || !geo.borders.some(isTl) ? null : growTimeline} /></div>
  {#if !max}
    {#each geo.borders as b (b.path)}
      <div class="border {b.dir}" style={pos(b)} oncontextmenu={(e) => borderMenu(e, b)}>
        <Splitter orientation={b.dir === 'row' ? 'vertical' : 'horizontal'} value={b.value} min={b.min} max={isTl(b) ? b.max + Math.max(0, dockH - 120) : b.max} reverse={b.reverse}
          label="Resize areas (right-click: split, join, swap)" onresize={(v) => resizeBorder(b, v)} onreset={isTl(b) ? () => L.resetTimelineSize() : undefined} style="width:100%;height:100%" />
      </div>
    {/each}
    {#each shown as l (l.id)}
      {@const r = rectOf(l.id)}
      {#if !l.collapsed || l.kind}
        {#each CORNERS as c (c)}
          <div class="corner {c}" style="left:{c[1] === 'l' ? r.x : r.x + r.w - 9}px;top:{c[0] === 't' ? r.y : r.y + r.h - 9}px"
            onpointerdown={(e) => grab(e, { kind: 'corner', from: l.id, corner: c })}></div>
        {/each}
      {/if}
    {/each}
  {:else}
    <button class="restore" onclick={() => L.toggleMax()}>Restore layout <kbd>{app.commands.keysFor('layout.maximize')[0] || ''}</kbd></button>
  {/if}
  {#if g?.kind === 'pick'}
    <div class="catch" onpointermove={pickMove} onpointerdown={pickDown}></div>
  {/if}
  {#if drop?.rect}
    <div class="preview" class:bad={!drop.ok} class:join={drop.op === 'join'} style={pos(drop.rect)}></div>
    {#if drop.line}<div class="line" class:bad={!drop.ok} style={pos(drop.line)}></div>{/if}
  {/if}
</div>

<style>
  .areas { position: relative; flex: 1; min-height: 0; min-width: 0; overflow: hidden; }
  .areas.dragging, .areas.dragging * { cursor: grabbing !important; user-select: none; }
  .slot { position: absolute; min-width: 0; min-height: 0; overflow: hidden; }
  .body { overflow: auto; background: var(--bg); }
  .border { position: absolute; z-index: 2; display: flex; }
  .corner { position: absolute; width: 9px; height: 9px; z-index: 3; cursor: crosshair; }
  .corner:hover { background: linear-gradient(135deg, var(--highlight) 0 2px, transparent 2px); opacity: .7; }
  .corner.tr:hover { background: linear-gradient(225deg, var(--highlight) 0 2px, transparent 2px); }
  .corner.bl:hover { background: linear-gradient(45deg, var(--highlight) 0 2px, transparent 2px); }
  .corner.br:hover { background: linear-gradient(315deg, var(--highlight) 0 2px, transparent 2px); }
  .catch { position: absolute; inset: 0; z-index: 5; cursor: crosshair; }
  .preview { position: absolute; z-index: 6; pointer-events: none; background: color-mix(in srgb, var(--highlight) 22%, transparent); outline: 2px solid var(--highlight); outline-offset: -2px; }
  .preview.join { background: color-mix(in srgb, var(--bg) 55%, transparent); }
  .preview.bad { background: color-mix(in srgb, var(--bad-ink) 14%, transparent); outline-color: var(--bad-ink); }
  .line { position: absolute; z-index: 7; pointer-events: none; background: var(--highlight); outline: 1px solid var(--highlight); }
  .line.bad { background: var(--bad-ink); }
  .restore { position: absolute; right: var(--space-4); bottom: var(--space-4); z-index: 4; padding: var(--space-2) var(--space-4); border-radius: var(--radius-2, 4px); background: var(--bg-raised); color: var(--tx); border: 1px solid var(--line-1); font-size: var(--fs-2); opacity: .85; }
  .restore:hover { opacity: 1; color: var(--tx-hi); }
  .restore kbd { font: var(--fs-1) var(--mono); color: var(--tx-mut); margin-left: var(--space-2); }
  :global(.failed) pre { margin: 0; color: var(--bad-ink); font: var(--fs-1) var(--mono); white-space: pre-wrap; }
</style>
