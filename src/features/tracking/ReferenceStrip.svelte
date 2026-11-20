<script>
  // The reference strip (paw-qynw): on the Tracker row, over the stretch the owner picked (Tracker row right-click › Use as
  // a reference…: a shot, or the I-O range, of ONE run). Drag across it = strike that region out (bad tracking, or the
  // script not right yet); click a struck region = bring it back. Enter saves the record (lib/references.js) to the app's
  // data folder, Esc cancels; Space stays play / pause. Not a dialog: the strip is on the timeline. "saved ▾" lists this
  // video's records (go there / remove).
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { showContextMenu } from '../../ui/kit/contextmenu.js';
  import { fmtTime } from '../../lib/funscript.js';
  import { trackingFor } from './tracking.svelte.js';
  import { keptOf } from '../../lib/references.js';

  let { app, w } = $props();
  // svelte-ignore state_referenced_locally
  const tr = trackingFor(app);
  const e = $derived(tr.refEdit);
  const x = (t) => ((t - app.view.start) / app.view.span) * w;
  const tAt = (px) => app.view.start + (px / w) * app.view.span;
  let el = $state(), rub = $state(null);
  const clip = (t) => Math.max(e.t0, Math.min(e.t1, t));
  function down(ev) {
    if (ev.button !== 0 || !e) return;
    ev.preventDefault(); ev.stopPropagation();
    el.setPointerCapture(ev.pointerId);
    const t = clip(app.player.snap(tAt(ev.clientX - el.parentElement.getBoundingClientRect().left)));
    rub = { a: t, b: t, x0: ev.clientX, moved: false };
  }
  function move(ev) {
    if (!rub) return;
    const t = clip(app.player.snap(tAt(ev.clientX - el.parentElement.getBoundingClientRect().left)));
    rub = { ...rub, b: t, moved: rub.moved || Math.abs(ev.clientX - rub.x0) > 3 };
  }
  function up(ev) {
    const r = rub;
    rub = null;
    if (!r) return;
    if (ev.type !== 'pointerup') return;
    if (r.moved && r.b !== r.a) tr.strikeRef(r.a, r.b);
    else tr.unstrikeRef(r.a);
  }
  function key(ev) {
    if (!tr.refEdit || app.tabs?.hidden || ev.ctrlKey || ev.metaKey || ev.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target?.tagName || '') || ev.target?.isContentEditable) return;
    if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); tr.saveReference(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); if (rub) rub = null; else tr.cancelReference(); }
  }
  const savedItems = () => tr.refList.length ? tr.refList.map(({ path, rec }) => ({ label: `${fmtTime(rec.t0)}–${fmtTime(rec.t1)} · run ${tr.run(rec.run)?.n != null ? '#' + tr.run(rec.run).n : rec.run} · ${rec.struck.length} struck · ${rec.savedAt.slice(0, 10)}`,
    items: [{ label: 'Go there', run: () => app.player.seek(rec.t0) }, { label: 'Remove this reference', run: () => tr.removeReference(path) }] })) : [{ label: 'No reference saved for this video yet', disabled: true }];
  const kept = $derived(e ? Math.round(keptOf(e.t0, e.t1, e.struck) / 100) / 10 : 0);
</script>

<svelte:window onkeydowncapture={key} />
{#if e}
  <div class="dim" style:left="0" style:width="{Math.max(0, x(e.t0))}px"></div>
  <div class="dim" style:left="{x(e.t1)}px" style:right="0"></div>
  <div bind:this={el} class="ref" data-testid="ref-strip" style:left="{x(e.t0)}px" style:width="{Math.max(2, x(e.t1) - x(e.t0))}px" role="slider" tabindex="-1"
    aria-label="Reference stretch {fmtTime(e.t0)}–{fmtTime(e.t1)}: drag to strike out a bad region" aria-valuenow={kept}
    onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
    {#each e.struck as [a, b] (a)}<i class="cut" style:left="{x(a) - x(e.t0)}px" style:width="{Math.max(1, x(b) - x(a))}px"></i>{/each}
    {#if rub?.moved}<i class="cut live" style:left="{x(Math.min(rub.a, rub.b)) - x(e.t0)}px" style:width="{Math.abs(x(rub.b) - x(rub.a))}px"></i>{/if}
  </div>
  <div class="bar" style:left="{Math.max(0, Math.min(w - 420, x(e.t0)))}px">
    <span class="tx" {@attach tooltip('A stretch of a run you vouch for, saved in app data')}>Reference · run #{tr.run(e.runId)?.n ?? '?'} · {fmtTime(e.t0)}–{fmtTime(e.t1)} · {kept} s kept · drag = strike out · Enter saves · Esc cancels</span>
    <button class="chip" data-testid="ref-saved" onclick={(ev) => showContextMenu(ev.currentTarget, savedItems())} {@attach tooltip('The references saved for this video: go to one, or remove it')}>saved {tr.refList.length} ▾</button>
    <button class="chip on" onclick={() => tr.saveReference()} {@attach tooltip('Save the reference (Enter)')}>save</button>
    <button class="chip" onclick={() => tr.cancelReference()} {@attach tooltip('Cancel (Esc)')}>×</button>
  </div>
{/if}

<style>
  .dim { position: absolute; top: 0; bottom: 0; z-index: 3; background: color-mix(in srgb, var(--media-bg) 45%, transparent); pointer-events: none; }
  .ref { position: absolute; top: 0; bottom: 0; z-index: 3; box-shadow: inset 0 0 0 2px var(--highlight); cursor: col-resize; touch-action: none; outline: none; }
  .cut { position: absolute; top: 0; bottom: 0; background: repeating-linear-gradient(135deg, rgba(var(--danger-rgb, 220, 60, 60), .55) 0 4px, rgba(var(--danger-rgb, 220, 60, 60), .2) 4px 8px); pointer-events: none; }
  .cut.live { opacity: .7; }
  .bar { position: absolute; top: 2px; z-index: 4; display: flex; gap: 3px; align-items: center; max-width: 420px; padding: 0 4px; font: var(--fs-1)/16px var(--mono); color: var(--tx-hi); background: var(--bg-card); border: 1px solid var(--highlight); border-radius: var(--radius); white-space: nowrap; }
  .tx { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .chip { display: inline-flex; align-items: center; padding: 0 5px; border-radius: var(--radius); color: var(--tx-mut); background: var(--line-0); font: inherit; }
  .chip:hover { background: var(--line-3); color: var(--tx-hi); }
  .chip.on { background: rgba(var(--highlight-rgb), .22); color: var(--highlight); }
</style>
