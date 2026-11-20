<script>
  import { tooltip } from '../ui/kit/tooltip.js';
  // The timeline stack: rows from src/features/*/lane.js, sorted by order, full width (so lib/lane.js view math
  // lines up pixel for pixel across rows), each with a resizable height and a hide chip on hover; a hidden row leaves the
  // stack (paw-idb5: no strip at its foot; the bottom tray's Rows tab and any row chip's right-click bring it back).
  // Until features/lanes provides the editor, one fallback row per axis stands in.
  import Splitter from '../ui/kit/Splitter.svelte';
  import Button from '../ui/kit/Button.svelte';
  import { showContextMenu } from '../ui/kit/index.js';
  import FallbackLane from './FallbackLane.svelte';
  import { lanes } from './plugins.js';
  import { share, roomOf, fit } from './areas.js';
  import { rowsIn } from './layout.svelte.js';

  let { app, grow = null } = $props();   // grow(px): the section's bottom edge (Areas), -> px applied; null when it cannot move
  let stackEl = $state();
  $effect(() => { app.mode; if (stackEl) stackEl.scrollTop = 0; });   // another tab: its rows from the top (not the last tab's scroll)
  // paw-ky2g: toasts (ToastHost, bottom right) sit above the timeline when it is at the bottom and the room over it holds one or
  // two; the stack is cut to that room (the newest show). paw-p8o2: and above the transport when the stack's column (360 px at
  // the right edge) reaches over it, so a toast never covers the transport or the timeline
  $effect(() => {
    const el = stackEl, root = document.documentElement;
    if (!el) return;
    let mine = '';
    const put = () => {
      const r = el.getBoundingClientRect(), H = innerHeight, W = innerWidth;
      const tx = document.querySelector('[role=toolbar][aria-label="Transport"]')?.getBoundingClientRect();
      const left = W - 16 - Math.min(360, W - 32);   // ToastHost's column: --space-6 from the right, 360 px wide
      const top = tx?.height && tx.right > left && tx.top < r.top && tx.top > 160 ? tx.top : r.top;
      const on = r.height && r.bottom > H - 120 && top > 160;
      root.style.setProperty('--toast-bottom', (mine = on ? `${Math.round(H - top + 8)}px` : ''));
      root.style.setProperty('--toast-room', on ? `${Math.round(top - 56)}px` : '');
    };
    const ro = new ResizeObserver(put);
    ro.observe(el); addEventListener('resize', put); put();
    return () => {
      ro.disconnect(); removeEventListener('resize', put);
      if (root.style.getPropertyValue('--toast-bottom') === mine) { root.style.removeProperty('--toast-bottom'); root.style.removeProperty('--toast-room'); }   // another tab's timeline may have set it since
    };
  });
  const layout = $derived(app.layout);
  const hasEditor = lanes.some((l) => l.feature === 'lanes');
  const axes = $derived(Object.keys(app.doc.axes).length ? Object.keys(app.doc.axes) : ['stroke']);
  const rows = $derived(rowsIn([
    ...lanes,
    ...(hasEditor ? [] : axes.map((a, i) => ({ id: 'fallback:' + a, title: a, order: 50 + i / 100, height: a === app.doc.activeAxis ? 'fill' : 64, fallback: a }))),
  ], app));

  const measured = $state({});   // px of 'fill' rows, so every lane gets a numeric height
  const heightOf = (r) => layout.row(r.id).height ?? r.height;
  /** px a row asks for on top of its height for now (lane.js `extra`: the Actions strip's secondary layers); never stored. */
  const extraOf = (r) => { try { return Math.max(0, Math.round(r.extra?.(app) ?? 0)); } catch { return 0; } };
  // hidden rows leave the stack (the bottom tray's Rows tab, a row chip's right-click: Show)
  const isFolded = (r) => r.height !== 'fill' && !r.fallback && layout.row(r.id).collapsed;
  const shown = $derived(rows.filter((r) => !isFolded(r)));
  const folded = $derived(rows.filter(isFolded));
  // The section's height is set by its borders (Areas); inside it the rows share it (paw-3lmy): fixed rows keep their px, the fill
  // row (the lanes, the filmstrip) takes the rest, and when that is not enough the fixed rows give way (areas.js fit); a splitter
  // moves height between its neighbours (areas.js share). So no resize makes the stack scroll: it scrolls only when the rows'
  // minimums alone do not fit.
  const MIN_ROW = 16;
  let stackH = $state(0), snap = $state(null);   // snap: {i, s} the sizes when a splitter drag started
  const prefs = $derived(shown.map((r) => { const h = heightOf(r); return h === 'fill' ? null : (typeof h === 'number' ? h : 60) + extraOf(r); }));
  const mins = $derived(shown.map((r) => (heightOf(r) === 'fill' ? r.minHeight ?? 180 : MIN_ROW)));
  const avail = $derived(stackH - prefs.filter((p) => p != null).length);   // less the 1 px splitters
  const sizes = $derived(stackH ? fit(prefs, mins, avail) : prefs.map((p, k) => p ?? mins[k]));
  /** The fixed rows stored as `out` shows them (only those that differ), so the next gesture starts from what the owner sees. */
  function keep(out) {
    const patch = {};
    shown.forEach((r, k) => { if (prefs[k] != null && out[k] !== prefs[k]) patch[r.id] = { height: Math.max(MIN_ROW, out[k] - extraOf(r)) }; });
    layout.setRows(patch);
  }
  function drag(i, v) {
    if (snap?.i !== i) snap = { i, s: sizes, done: 0 };
    if (i < snap.s.length - 1) keep(share(snap.s, mins, i, v - snap.s[i]));
    else snap.done += growEdge(i, v - snap.s[i] - snap.done);
  }
  // Row i's bottom edge d px down (the fill row's: the lanes' last grip, Ctrl+wheel over a lane): it trades with the rows under it;
  // under the last row it is the section's bottom edge (grow: the open dock, else the video). -> the px row i changed.
  function growEdge(i, d) {
    const s = sizes;
    d = Math.max(Math.round(d), mins[i] - s[i]);
    if (i < s.length - 1) { const out = share(s, mins, i, d); keep(out); return out[i] - s[i]; }
    if (!grow || !d) return 0;
    const over = Math.max(0, s.reduce((a, b) => a + b, 0) - avail);   // minimums that did not fit: those px come first
    const got = d < 0 ? grow(d) : Math.max(0, grow(d + over) - over), out = [...s];
    out[i] += got;
    keep(out);   // the other rows hold what they show: the section's change is row i's
    return got;
  }

  // a row chip's menu (right-click): hide / show it, its height back, every row back to the mode's default
  const chipMenu = (e, r) => {
    e.preventDefault();
    showContextMenu(e, [
      { section: r.title },
      layout.row(r.id).collapsed ? { label: `Show ${r.title}`, run: () => layout.setRow(r.id, { collapsed: false }) } : { label: `Hide ${r.title}`, run: () => layout.setRow(r.id, { collapsed: true }) },
      { label: 'Reset its height', disabled: layout.row(r.id).height == null, run: () => layout.setRow(r.id, { height: null }) },
      ...(folded.length ? [{ separator: true }, { section: 'Hidden rows' }, ...folded.map((f) => ({ label: `Show ${f.title}`, run: () => layout.setRow(f.id, { collapsed: false }) }))] : []),
      { separator: true },
      { label: 'Reset rows to this tab’s default', run: () => layout.resetRows() },
    ]);
  };
</script>

{#snippet failed(error, reset)}
  <div class="failed"><span class="k-caps">Lane crashed</span> <code>{error?.message || error}</code> <Button size="sm" onclick={reset}>Reload</Button></div>
{/snippet}

<div class="stack k-scroll" role="group" aria-label="Timeline" bind:this={stackEl} bind:clientHeight={stackH}>
  {#each shown as r, i (r.id)}
    {@const hh = heightOf(r)}
    <div class="row" data-row={r.id} class:fill={hh === 'fill'} class:active={r.fallback === app.doc.activeAxis || r.axis === app.doc.activeAxis}
      style:height={hh === 'fill' ? null : sizes[i] + 'px'} style:min-height={hh === 'fill' && r.minHeight ? r.minHeight + 'px' : null} bind:clientHeight={measured[r.id]}>
      <svelte:boundary {failed} onerror={(e) => console.error('[lane ' + r.id + ']', e)}>
        {#if r.fallback}<FallbackLane {app} axis={r.fallback} />{:else}<r.component {app} height={hh === 'fill' ? measured[r.id] || undefined : sizes[i]} grow={hh === 'fill' && (grow || i < shown.length - 1) ? (d) => growEdge(i, d) : undefined} />{/if}
      </svelte:boundary>
      {#if hh !== 'fill' && !r.fallback}
        <button class="fold" onclick={() => layout.setRow(r.id, { collapsed: true })} oncontextmenu={(e) => chipMenu(e, r)} {@attach tooltip(`Hide ${r.title} (right-click to show it again)`)}>{r.title} ‹</button>
      {/if}
    </div>
    {#if hh !== 'fill' && (grow || i < shown.length - 1)}
      {@const s0 = snap?.i === i ? snap.s : sizes}
      {@const last = i === shown.length - 1}
      <Splitter orientation="horizontal" value={sizes[i]} min={last ? mins[i] : s0[i] - roomOf(s0, mins, 0, i + 1)} max={last ? s0[i] + 4000 : s0[i] + roomOf(s0, mins, i + 1, s0.length)} label="Resize {r.title}" class="rowsplit"
        onresize={(v) => drag(i, v)} oncommit={() => (snap = null)} onreset={() => layout.setRow(r.id, { height: null })} />
    {/if}
  {/each}
</div>

<style>
  .stack { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow-y: auto; background: var(--bg-sunken); }
  .row { position: relative; flex: 0 1 auto; min-height: 16px; overflow: hidden; }   /* shrinks only by a rounding px: sizes fit the section */
  .stack > :global(.rowsplit:last-child::before), .stack > :global(.rowsplit:last-child::after) { bottom: 0; }   /* the section's bottom edge: no overhang (a 1-4 px scroll) */
  .row.fill { flex: 1 1 0; min-height: 180px; }
  .fold { position: absolute; top: 2px; right: 4px; z-index: 3; padding: 0 var(--space-3); height: 16px; border-radius: var(--radius); background: var(--bg-card); border: 1px solid var(--line-2); color: var(--tx-mut); font-size: var(--fs-1); opacity: 0; pointer-events: none; transition: opacity var(--t-quick) var(--ease-out); }
  /* paw-5nsv: hittable only while drawn (hidden, a press goes to the row under it); it shows at once, fades out */
  .row:hover .fold, .fold:focus-visible { opacity: 1; pointer-events: auto; transition: none; }
  .fold:hover { color: var(--tx-hi); border-color: var(--line-4); }
  .failed { padding: var(--space-3); display: flex; gap: var(--space-4); align-items: center; font-size: var(--fs-2); }
  .failed code { color: var(--bad-ink, var(--bad)); font: var(--fs-1) var(--mono); }
</style>
