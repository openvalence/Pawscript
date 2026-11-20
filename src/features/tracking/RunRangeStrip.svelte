<script module>
  import { fmtTime } from '../../lib/funscript.js';
  /** A range's words: its run's title and where it plays. */
  export const rangeTip = (tr, r) => `${tr.ghost(r.run)?.name || r.run}: ${fmtTime(r.t0)} to ${fmtTime(r.t1)}`;
  const covering = (tr, t0, t1) => tr.ghosts.filter((g) => g.source?.kind === 'tracker' && !tr.run(g.id)?.tag).filter((g) => { const x = tr.runExtent(g.id); return x && x.t0 <= t0 + 1 && x.t1 >= t1 - 1; });
  /** Use <run> here: the runs that tracked all of t0..t1 (but `except`). */
  export function useItems(tr, t0, t1, except = '') {
    const gs = covering(tr, t0, t1).filter((g) => g.id !== except);
    return gs.length ? gs.map((g) => ({ label: `Use ${g.name}`, run: () => tr.useRun(g.id, t0, t1, `Use ${g.name} here`) })) : [{ label: 'No other run tracked all of it', disabled: true }];
  }
  /** A range's menu (its right-click here, and the run chip's in the lane toolbar: paw-k8pe). */
  export function rangeItems(tr, r) {
    return [
      { section: rangeTip(tr, r) },
      { label: 'Use another run here', items: useItems(tr, r.t0, r.t1, r.run) },
      { label: 'Invert this range', run: () => tr.invertRange(r.id) },
      { label: 'Bake this range', run: () => tr.bake({ range: { t0: r.t0, t1: r.t1 } }) },
      { label: 'Remove (the run stays)', run: () => tr.removeRange(r.id) },
    ];
  }
</script>

<script>
  // paw-1ysd: the run strip, the top row of the Track lane's bottom band: which run plays where.
  //   a range = a clean bar in its run's colour (paw-k8pe: no name and no ± here any more: the run's chip and its direction are
  //     the lane toolbar's, at a readable size; the full title in the tooltip), its flipped stretches (hatched: click = select,
  //     Delete removes, an end drags to trim, right-click = Remove / to the range's ends)
  //   click = select the range (and its run); an end = shorten / lengthen (frame-snapped, Shift free; never past what the run
  //     tracked: shown faint while selected); a drag along a range or the empty strip = a span, then Invert this stretch or Use
  //     <run> (the runs that tracked all of it); Delete removes the selected range (the run stays); right-click = the menu
  //     (Invert this range is there)
  // Every write is one undo step in the store (useRun / moveRangeEnd / removeRange / invertRange / setRunFlips).
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { contextMenu, showContextMenu } from '../../ui/kit/contextmenu.js';
  import { xToMs } from '../../lib/lane.js';
  import { xorFlips } from '../../lib/polarity.js';

  let { app, tr, height = 10 } = $props();
  let el = $state(null), w = $state(0), draft = $state(null), rubber = $state(null), polSel = $state(null), polDraft = $state(null), swallow = false;
  const ranges = $derived(tr.runRanges);
  const shown = $derived(draft ? ranges.map((r) => (r.id === draft.id ? { ...r, t0: draft.t0, t1: draft.t1 } : r)) : ranges);
  const sel = $derived(ranges.find((r) => r.id === tr.rangeSel) || null);
  const ext = $derived(sel ? tr.runExtent(sel.run) : null);
  const msAt = (e, free) => { const t = xToMs(app.view, w, e.clientX - el.getBoundingClientRect().left); return free ? Math.round(t) : app.player.snap(t); };
  const swallowClick = () => { swallow = true; setTimeout(() => (swallow = false), 0); };

  const tipOf = (r) => rangeTip(tr, r);

  // ---- direction: a range's flipped stretches inside it ----
  const runOf = (r) => tr.run(r.run);
  // a stretch over all of the range is the range's own direction (its ±), not drawn as a stretch
  const stretchesIn = (r) => { const run = runOf(r); return run ? tr.flipsOf(run).filter(([a, b]) => b > r.t0 && a < r.t1 && !(a <= r.t0 && b >= r.t1)).map(([a, b]) => [Math.max(a, r.t0), Math.min(b, r.t1), a, b]) : []; };
  function setFlips(run, list, label) { tr.setRunFlips(run.id, list, { label }); }
  function polRemove(run, st) { setFlips(run, xorFlips(tr.flipsOf(run), st[2], st[3]), 'Remove a flipped stretch'); polSel = null; }
  function polItems(r, st) {
    const run = runOf(r);
    return [
      { section: `Flipped ${fmtTime(st[2])} to ${fmtTime(st[3])}` },
      { label: 'To the start of the range', run: () => setFlips(run, xorFlips(tr.flipsOf(run), r.t0, st[2]), 'Flip to the range start') },
      { label: 'To the end of the range', run: () => setFlips(run, xorFlips(tr.flipsOf(run), st[3], r.t1), 'Flip to the range end') },
      { label: 'Remove', run: () => polRemove(run, st) },
    ];
  }
  // a stretch's end: trim / grow it (a preview while dragged, one undo step on release). paw-zvos: the strip itself holds the
  // pointer (a stretch's element goes and comes as the preview moves its bounds); a lost capture, Escape, a cancel or the strip
  // going away (a tab switch) drops the preview: it feeds the live script, so it must never outlive the drag.
  let polEnd = null;
  function polEdgeDown(e, r, st, end) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    polEnd?.();
    const run = runOf(r), base = tr.flipsOf(run).filter(([a, b]) => !(a === st[2] && b === st[3])), id = e.pointerId;
    el.setPointerCapture(id);
    const mv = (ev) => {
      const t = Math.max(r.t0, Math.min(r.t1, msAt(ev, ev.shiftKey))), a = end ? st[2] : Math.min(t, st[3] - 1), b = end ? Math.max(t, st[2] + 1) : st[3];
      polDraft = [...base, [a, b]];
      tr.setRunFlips(run.id, polDraft, { commit: false });
    };
    const key = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); finish(null); } };
    const finish = (ev) => {
      polEnd = null;
      el?.removeEventListener('pointermove', mv); el?.removeEventListener('pointerup', finish); el?.removeEventListener('pointercancel', finish); el?.removeEventListener('lostpointercapture', finish);
      window.removeEventListener('keydown', key, true);
      if (el?.hasPointerCapture?.(id)) el.releasePointerCapture(id);
      const d = polDraft; polDraft = null;
      if (ev?.type === 'pointerup' && d) setFlips(run, d, 'Resize a flipped stretch');
      else if (tr.flipPreview?.run === run.id) tr.flipPreview = null;
    };
    polEnd = () => finish(null);
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', finish); el.addEventListener('pointercancel', finish); el.addEventListener('lostpointercapture', finish);
    window.addEventListener('keydown', key, true);
  }
  $effect(() => () => polEnd?.());

  // ---- ranges ----
  function pick(r) { tr.rangeSel = tr.rangeSel === r.id ? '' : r.id; polSel = null; if (tr.rangeSel) tr.select(r.run); el?.focus({ preventScroll: true }); }
  // a drag along a range or the empty strip: a span, then invert it (on a range) or the runs that can play it
  function spanDown(e, r = null, onClick = null) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const target = e.currentTarget, t0 = msAt(e, e.shiftKey), x0 = e.clientX;
    target.setPointerCapture(e.pointerId);
    let moved = false;
    const mv = (ev) => { if (!moved && Math.abs(ev.clientX - x0) < 4) return; moved = true; rubber = { t0, t1: msAt(ev, ev.shiftKey) }; };
    const done = (ev) => {
      target.removeEventListener('pointermove', mv); target.removeEventListener('pointerup', done); target.removeEventListener('pointercancel', done);
      const rb = rubber; rubber = null;
      if (ev.type !== 'pointerup') return;
      if (!moved) { if (onClick) onClick(); else if (r) pick(r); else app.player.seek(t0); return; }
      const a = Math.min(rb.t0, rb.t1), b = Math.max(rb.t0, rb.t1);
      if (b - a < 1) return;
      swallowClick();
      const inv = r ? [{ label: 'Invert this stretch', run: () => tr.invertRange(r.id, Math.max(a, r.t0), Math.min(b, r.t1)) }] : [];
      const at = { x: ev.clientX, y: ev.clientY }, list = [{ section: `${fmtTime(a)} to ${fmtTime(b)}` }, ...inv, ...useItems(tr, a, b)];
      setTimeout(() => showContextMenu(at, list, { source: el }), 0);   // after the click that ends this press (it would close it)
    };
    target.addEventListener('pointermove', mv); target.addEventListener('pointerup', done); target.addEventListener('pointercancel', done);
  }
  // an end: shorten / lengthen inside what the run tracked
  function endDown(e, r, end) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const target = e.currentTarget, x = tr.runExtent(r.run) || { t0: -Infinity, t1: Infinity };
    target.setPointerCapture(e.pointerId);
    tr.rangeSel = r.id;
    const mv = (ev) => { const t = Math.max(x.t0, Math.min(x.t1, msAt(ev, ev.shiftKey))); draft = end ? { id: r.id, t0: r.t0, t1: Math.max(r.t0 + 1, t) } : { id: r.id, t0: Math.min(r.t1 - 1, t), t1: r.t1 }; };
    const up = (ev) => {
      target.removeEventListener('pointermove', mv); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up);
      const d = draft; draft = null;
      if (ev.type === 'pointerup' && d) tr.moveRangeEnd(r.id, end, end ? d.t1 : d.t0);
    };
    target.addEventListener('pointermove', mv); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);
  }
  function key(e) {
    const del = (e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (del && polSel) { e.preventDefault(); e.stopPropagation(); const r = ranges.find((x) => x.id === polSel.rid), run = r && runOf(r); if (run) polRemove(run, polSel.st); }
    else if (del && sel) { e.preventDefault(); e.stopPropagation(); tr.removeRange(sel.id); }
    else if (e.key === 'Escape' && (sel || polSel)) { e.stopPropagation(); tr.rangeSel = ''; polSel = null; }
  }
  const L = (ms) => ((ms - app.view.start) / app.view.span) * 100 + '%';
  const W = (ms) => (Math.max(0, ms) / app.view.span) * 100 + '%';
</script>

<!-- tabindex -1: focused by a click on it, so Delete removes what it has selected and nothing else -->
<div class="rr" bind:this={el} bind:clientWidth={w} style:height="{height}px" role="group" tabindex="-1" aria-label="Run ranges" data-testid="run-strip"
  {@attach tooltip('Which run plays where; drag to pick a run for a stretch')} onpointerdown={(e) => { if (e.target === el) spanDown(e); }} onkeydown={key}>
  {#if ext}<i class="ext" style:left={L(ext.t0)} style:width={W(ext.t1 - ext.t0)}></i>{/if}
  {#each shown as r (r.id)}
    {@const g = tr.ghost(r.run)}
    <div class="rg" class:on={r.id === tr.rangeSel} style:left={L(r.t0)} style:width={W(r.t1 - r.t0)} style:--c={g?.color || 'var(--accent)'} data-testid="run-range" data-run={r.run}>
      <button class="body" aria-pressed={r.id === tr.rangeSel} aria-label={tipOf(r)} {@attach tooltip(tipOf(r))} {@attach contextMenu(() => rangeItems(tr, r))}
        onpointerdown={(e) => spanDown(e, r)} onclick={(e) => { if (swallow) e.preventDefault(); }}></button>
      {#each stretchesIn(r) as st, j (j)}
        {@const on = polSel?.rid === r.id && polSel.st[2] === st[2] && polSel.st[3] === st[3]}
        <span class="pol" class:on style:left="{((st[0] - r.t0) / (r.t1 - r.t0)) * 100}%" style:width="{((st[1] - st[0]) / (r.t1 - r.t0)) * 100}%" data-testid="flip-stretch">
          <button class="polb" aria-pressed={on} aria-label="Flipped stretch {fmtTime(st[2])} to {fmtTime(st[3])}" {@attach tooltip('Flipped here; Delete removes it')} {@attach contextMenu(() => polItems(r, st))}
            onpointerdown={(e) => spanDown(e, r, () => { polSel = on ? null : { rid: r.id, st }; tr.rangeSel = ''; el?.focus({ preventScroll: true }); })}></button>
          <span class="ph l" role="presentation" onpointerdown={(e) => polEdgeDown(e, r, st, 0)}></span>
          <span class="ph r" role="presentation" onpointerdown={(e) => polEdgeDown(e, r, st, 1)}></span>
        </span>
      {/each}
      <span class="h l" role="presentation" onpointerdown={(e) => endDown(e, r, 0)}></span>
      <span class="h r" role="presentation" onpointerdown={(e) => endDown(e, r, 1)}></span>
    </div>
  {/each}
  {#if rubber}<i class="rub" style:left={L(Math.min(rubber.t0, rubber.t1))} style:width={W(Math.abs(rubber.t1 - rubber.t0))}></i>{/if}
</div>

<style>
  .rr { position: relative; flex: none; overflow: hidden; outline: none; }
  .rr:focus-visible { box-shadow: inset 0 0 0 1px var(--focus, var(--accent)); }
  .ext { position: absolute; top: 2px; bottom: 2px; background: var(--line-2); opacity: .5; border-radius: var(--radius); pointer-events: none; }
  /* paw-k8pe: a clean 6 px bar in the run's colour (the strip's 10 px keep the lane's geometry; the 2 px above and below are
     its hit area too) */
  .rg { position: absolute; top: 2px; bottom: 2px; display: flex; min-width: 2px; }
  .body { flex: 1 1 auto; min-width: 0; height: 100%; padding: 0; border: 0; border-radius: var(--radius); background: color-mix(in srgb, var(--c) 85%, transparent); cursor: pointer; }
  .body::before { content: ''; position: absolute; inset: -2px 0; }   /* the full 10 px take the click */
  .rg.on .body { background: var(--c); box-shadow: 0 0 0 1px var(--tx-hi); }
  .pol { position: absolute; top: 0; bottom: 0; }
  .polb { position: absolute; inset: 0; padding: 0; border: 0; cursor: pointer;
    background: repeating-linear-gradient(135deg, rgba(var(--highlight-rgb), .55) 0 2px, transparent 2px 4px); }
  .pol.on .polb { box-shadow: inset 0 0 0 1px var(--highlight); }
  .ph { position: absolute; top: 0; bottom: 0; width: 3px; cursor: ew-resize; }
  .ph.l { left: 0; } .ph.r { right: 0; }
  .h { position: absolute; top: 0; bottom: 0; width: 4px; cursor: ew-resize; }
  .h.l { left: 0; } .h.r { right: 0; }   /* inside the range: at a shared edge each side has its own */
  .rub { position: absolute; top: 0; bottom: 0; background: rgba(var(--highlight-rgb), .3); pointer-events: none; }
</style>
