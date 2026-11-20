<script>
  // The image-labelling workspace (paw-714j): a full-window page over the shell while it is on (the project underneath is
  // not touched: its video, document and history stay as they were). The picture is shown where the video normally is
  // and the Groups tool (GroupsOverlay.svelte, unchanged brush / part picker / snap / keys) paints on it through a
  // frame-source facade (workspace.svelte.js); under it a thin strip of thumbnails (only a window around the current image
  // is mounted: a folder of 3,500 files costs nothing), a header with the counter and the walk-through buttons.
  import { untrack } from 'svelte';
  import GroupsOverlay from '../tracking/GroupsOverlay.svelte';
  import Button from '../../ui/kit/Button.svelte';
  import Spinner from '../../ui/kit/Spinner.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { cmd } from '../../app/cmd.js';
  import { viewMatrix, toNorm, fromNorm, zoomAround, panView } from '../video/view.js';
  import { windowOf, agreementText } from './labels.js';
  import { labellingFor } from './workspace.svelte.js';
  import { partLabel, splitName, youngNote } from '../tracking/groups.js';
  import { groupColor } from '../tracking/colors.js';
  import { usedParts, groupsFor } from '../tracking/groups.svelte.js';
  import DatasetPicker from './DatasetPicker.svelte';
  import { scoreLine, scoreChange, scoreTip, weakestLine, featuresLine, overviewLine, crossLine, namerLine, namerTip } from '../tracking/seed-score.js';

  let { app } = $props();
  // svelte-ignore state_referenced_locally
  const ws = labellingFor(app), p = ws.player, fa = ws.app;

  let stage = $state(), picCv = $state(), canvas = $state();
  let cw = $state(0), ch = $state(0), dpr = $state(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  $effect(() => { ws.stage = stage || null; });

  const vw = $derived(p.vw), vh = $derived(p.vh);
  const M = $derived(viewMatrix(p.view, cw, ch, vw, vh, dpr));
  const crisp = $derived(M.s * dpr >= 0.999);
  const picStyle = $derived(`width:${vw}px;height:${vh}px;transform:matrix(${M.a},${M.b},${M.c},${M.d},${M.e},${M.f})`);
  // the picture: the decoded bitmap on a canvas of its own pixels (the same bitmap serves the edge snap)
  $effect(() => {
    const cv = picCv, b = p.bmp;
    if (!cv || !b) return;
    cv.width = b.width; cv.height = b.height;
    cv.getContext('2d').drawImage(b, 0, 0);
  });

  // ---- overlay painting (as VideoPane: the drawers' reads are tracked here) ----
  const env = { app: null, w: 0, h: 0, dpr: 1, vw: 0, vh: 0, scale: 1, timeMs: 0, frame: 0, playing: false, map: null, unmap: null };
  $effect(() => {
    if (!canvas) return;
    const d = dpr, w = cw, h = ch, m = M, W = vw, H = vh, drawers = p.overlays.drawers;
    p.overlays.version; p.view;
    const bw = Math.round(w * d), bh = Math.round(h * d);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!W || !H) return;
    Object.assign(env, { app: fa, w, h, dpr: d, vw: W, vh: H, scale: m.s, timeMs: 0, frame: 0, playing: false,
      map: (nx, ny) => fromNorm(m, W, H, nx, ny), unmap: (x, y) => toNorm(m, W, H, x, y) });
    for (const dr of drawers) { try { ctx.save(); dr.draw(ctx, env); } catch (e) { console.error('[label overlay]', dr.id, e); } finally { ctx.restore(); } }
  });

  // ---- pointer: the Groups tool paints; the middle button pans; Ctrl + wheel zooms; double-click toggles fit / 100 % ----
  const local = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const pt = (e) => { const [x, y] = local(e), [rx, ry] = toNorm(M, vw, vh, x, y); return { x, y, rx, ry, nx: Math.min(1, Math.max(0, rx)), ny: Math.min(1, Math.max(0, ry)) }; };
  let drag = null;
  function down(e) {
    if (e.target !== canvas || !ws.ready) return;
    const tool = p.overlays.activeTool;
    if (e.button === 0 && tool?.down?.(pt(e), e)) { drag = { kind: 'tool' }; canvas.setPointerCapture(e.pointerId); e.preventDefault(); return; }
    if (e.button === 1) { const [x, y] = local(e); drag = { kind: 'pan', x, y }; canvas.setPointerCapture(e.pointerId); e.preventDefault(); }
  }
  function move(e) {
    if (!drag) return;
    if (drag.kind === 'tool') { p.overlays.activeTool?.move?.(pt(e), e); return; }
    const [x, y] = local(e);
    p.view = panView(p.view, cw, ch, vw, vh, x - drag.x, y - drag.y, dpr);
    drag.x = x; drag.y = y;
  }
  function up(e) { if (drag?.kind === 'tool') p.overlays.activeTool?.up?.(pt(e), e); drag = null; }
  function context(e) { const tool = p.overlays.activeTool; if (tool?.context) { e.preventDefault(); tool.context(pt(e), e); } }
  function wheel(e) {   // the overlay swallows plain wheel (brush size); Ctrl + wheel gets here
    if (!vw) return;
    e.preventDefault();
    const [x, y] = local(e), dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    p.view = zoomAround(p.view, cw, ch, vw, vh, x, y, Math.pow(1.0018, -dy), dpr);
  }
  function dbl(e) { if (e.target === canvas && !drag) p.view = p.view.mode === 'fit' ? { ...p.view, mode: '1:1', panX: 0, panY: 0 } : { ...p.view, mode: 'fit', panX: 0, panY: 0 }; }
  $effect(() => { const s = stage; if (!s) return; s.addEventListener('wheel', wheel, { passive: false }); return () => s.removeEventListener('wheel', wheel); });
  const hint = $derived(p.overlays.activeTool?.hint?.() || '');

  // ---- the thumbnail strip: a window of images around the current one, marks for the labelled ----
  const SPAN = 31;
  const win = $derived(ws.images.length ? windowOf(ws.images.length, Math.max(0, ws.index), SPAN) : [0, 0]);
  const shown = $derived(ws.images.slice(win[0], win[1]));
  $effect(() => { const s = shown, ready = ws.labelled; untrack(() => { for (const im of s) if (ready.has(im.key)) ws.markOf(im); }); });
  // thumbnails: small local files made once by the backend for the tiles on screen; a neutral tile until one exists
  $effect(() => { const s = shown; untrack(() => ws.wantThumbs(s)); });
  const markOf = (im) => (ws.labelled.has(im.key) ? ws.marks.get(im.key) || { n: 0 } : null);
  $effect(() => { const i = ws.index; if (i >= 0) untrack(() => document.querySelector('.lw .th.on')?.scrollIntoView?.({ block: 'nearest', inline: 'center' })); });

  const seedLine = $derived.by(() => { const s = ws.seeder; return s?.frames ? `learned from ${s.frames} painted frame${s.frames === 1 ? '' : 's'} · ${s.videos} source${s.videos === 1 ? '' : 's'}${s.images ? ` (${s.images} image${s.images === 1 ? '' : 's'})` : ''}${usedParts(s)}` : 'not trained yet'; });
  const featText = $derived(featuresLine(ws.seeder));
  const scoreText = $derived(scoreLine(ws.seeder?.score)), scoreChg = $derived(scoreChange(ws.seeder?.score)), scoreWeak = $derived(weakestLine(ws.seeder?.score, partLabel));
  const cmp = $derived(ws.compare), nSug = $derived(ws.suggestionCount);
  const names = $derived(ws.queue);
  const sugLine = $derived(cmp ? agreementText(cmp.rows, partLabel) : '');
  const young = $derived(youngNote(ws.seeder, ws.ds.active?.name));
  const learnedLine = $derived(cmp ? (cmp.learned ? `learned head: ${cmp.learned} part${cmp.learned === 1 ? '' : 's'}${cmp.tagger ? `, tagger: ${cmp.tagger}` : ''}` : 'tagger only') : '');
  const have = $derived(new Set(ws.groups.map((g) => g.name)));
  const gs = groupsFor(app), dsName = $derived(ws.ds.active?.name || '');
  const ovLine = $derived(overviewLine(gs.overview)), nTrained = $derived(gs.overview.filter((o) => o.trained).length);
  const nameOf = (id) => ws.ds.reg?.datasets.find((d) => d.id === id)?.name || id;
  const crossText = $derived(crossLine(gs.cross, nameOf));
  const namerText = $derived(namerLine(gs.namer, ws.ds.active?.id, dsName, partLabel));
  const starts = $derived(ws.current && ws.ready && !ws.groups.length && !ws.labelled.has(ws.current.key) ? ws.otherLabelled(ws.current) : []);
  const folderName = $derived(ws.folder.split(/[\\/]/).filter(Boolean).pop() || ws.folder);
</script>

{#if ws.on}
  <div class="lw" data-testid="label-workspace">
    <div class="bar">
      <Button size="sm" icon="arrow-left" {...cmd(app, 'labelling.leave', undefined, { tip: 'Back to the project, the labels are saved' })}>Back to project</Button>
      <span class="k-caps">Label images</span>
      <DatasetPicker {ws} />
      <span class="k-hint folder" {@attach tooltip(ws.folder)}>{folderName}</span>
      <span class="count num" data-testid="label-counter" {@attach tooltip('Labeled · still to do · skipped for later')}>{ws.counter}{ws.listing ? ' · listing…' : ''}</span>
      {#if ws.current}<span class="k-hint num cur" data-testid="label-current">{ws.index + 1} / {ws.images.length} · {ws.current.name}{ws.complete ? ' · fully labeled' : ''}{ws.pendingCopy ? ` · started from ${nameOf(ws.copied)}: edit it, or Done keeps it` : ''}</span>{/if}
      {#each starts as o (o.id)}<Button size="sm" variant="ghost" icon="copy" onclick={() => ws.startFrom(o.id)} data-testid="label-start-from" tip="Copy the {o.name} label in as a starting point">Start from the {o.name} label</Button>{/each}
      <span class="grow"></span>
      <Button size="sm" variant="ghost" icon="chevron-left" {...cmd(app, 'labelling.prev', undefined, { tip: 'Previous image' })} aria-label="Previous image" />
      <Button size="sm" variant="ghost" icon="chevron-right" {...cmd(app, 'labelling.next', undefined, { tip: 'Next image' })} aria-label="Next image" />
      <Button size="sm" variant="primary" icon="check" {...cmd(app, 'labelling.doneNext', undefined, { tip: 'Done, go to the next image with no label' })}>Done, next</Button>
      <Button size="sm" variant="ghost" {...cmd(app, 'labelling.nextUnlabelled', undefined, { tip: 'Next image with no label' })}>Next unlabeled</Button>
      <Button size="sm" variant="ghost" icon="skip-forward" data-testid="label-skip" {...cmd(app, 'labelling.skip', undefined, { tip: 'Skip this image until the others are labeled' })}>Skip</Button>
      {#if ws.skipped.size}<Button size="sm" variant="ghost" icon="close" data-testid="label-clear-skips" {...cmd(app, 'labelling.clearSkips', undefined, { tip: 'Put every skipped image back in order' })}>Clear skips</Button>{/if}
      <Button size="sm" variant="ghost" icon="close" {...cmd(app, 'labelling.none', undefined, { tip: 'Nothing to label here, the seeder learns from it too' })}>Nothing here</Button>
      <Button size="sm" variant="ghost" icon="check" data-testid="label-complete" {...cmd(app, 'labelling.complete', undefined, { tip: 'Every part is painted, the rest of the picture is empty' })}>Fully labelled</Button>
      <Button size="sm" variant="ghost" icon="refresh" loading={ws.training} data-testid="label-train" {...cmd(app, 'labelling.train', undefined, { tip: 'Train the seeder on these labels (5 examples a part)' })}>Train the seeder</Button>
      <Button size="sm" variant="ghost" icon="shuffle" data-testid="label-shuffle" {...cmd(app, 'labelling.shuffle', undefined, { tip: "Shuffled order, or the folder's order by name" })}>Shuffle</Button>
      <Button size="sm" variant="ghost" icon="copy" data-testid="label-duos" {...cmd(app, 'labelling.duos', undefined, { tip: `Two-character pictures first (GPU, about 1.8 GB) ${ws.duoTip}` })}>Duos first</Button>
      {#if ws.shuffle}<Button size="sm" variant="ghost" icon="refresh" data-testid="label-reshuffle" {...cmd(app, 'labelling.reshuffle', undefined, { tip: 'A new random order (the picture on screen stays)' })}>Reshuffle</Button>{/if}
      <Button size="sm" variant="ghost" icon="copy" {...cmd(app, 'labelling.sameParts', undefined, { tip: 'Pre-select the part names of the last labeled image' })}>Same parts</Button>
    </div>
    <!-- one row (the owner: "all this info at the top of the window is taking up a lot of space"): each piece truncates, its full text is in its tip -->
    <div class="seedbar">
    <div class="seedline" data-testid="label-seeder"><span class="k-hint" data-testid="label-seeder-dataset" {@attach tooltip(`Suggest (Shift+S) uses this seeder\nLabeled images may be in its training set`)}>Seeder ({dsName}): {seedLine}</span></div>
    {#if featText}<div class="seedline" data-testid="label-seeder-features"><span class="k-hint" {@attach tooltip(featText)}>{featText.replace('seeder features: ', '').replace(' (optional pack installed)', '').replace(' (built in)', '')}</span></div>{/if}
    {#if scoreText}<div class="seedline" data-testid="label-seeder-score"><span class="k-hint" {@attach tooltip(scoreTip(ws.seeder?.score, partLabel))}>{scoreText}{scoreChg ? ` (${scoreChg.split(' since')[0]})` : ''}{scoreWeak ? ` · weakest ${scoreWeak}` : ''}</span></div>{/if}
    {#if namerText}<div class="seedline" data-testid="label-namer"><span class="k-hint" {@attach tooltip(namerTip(gs.namer, partLabel))}>{namerText}</span></div>{/if}
    {#if ovLine && nTrained > 1}<div class="seedline" data-testid="label-datasets"><span class="k-hint" {@attach tooltip('Each dataset scored on its own pictures, not comparable')}>datasets: {ovLine}</span></div>{/if}
    {#if crossText || nTrained > 1}<div class="seedline" data-testid="label-cross"><span class="k-hint" {@attach tooltip('Every head scored on this dataset, held-out pictures only')}>{crossText || ''}</span> <Button size="sm" variant="ghost" icon="refresh" onclick={() => gs.refreshCompare()} data-testid="label-compare-datasets" tip="Score every head on this dataset now (CPU, a few seconds)">Compare</Button></div>{/if}
    </div>
    {#if cmp}
      <div class="queue sug" data-testid="label-suggest">
        <span class="k-hint">Suggest ({learnedLine}, {cmp.ms} ms{cmp.who ? `, ${cmp.who}` : ''}{cmp.hidden ? `, ${cmp.hidden} held below ${Math.round(gs.suggestConf * 100)} %` : ''}){young ? ' · ' + young : ''}{cmp.hadLabels && sugLine ? ' vs your labels: ' + sugLine : ''}</span>
        <span class="grow"></span>
        {#if cmp.hadLabels}<Button size="sm" variant="ghost" pressed={!cmp.shown} onclick={() => ws.toggleSuggestions()} data-testid="label-compare" tip="Show or hide the suggestions to compare">{cmp.shown ? 'Hide suggestions' : 'Show suggestions'}</Button>{/if}
        {#if nSug}<Button size="sm" variant="ghost" icon="check" onclick={() => ws.G.accept()} tip="Accept every suggestion as a label">Accept all</Button>{/if}
        {#if nSug}<Button size="sm" variant="ghost" icon="close" data-testid="label-decline" {...cmd(app, 'tracking.groupsDecline', undefined, { tip: 'Remove every suggestion not accepted yet' })}>Decline all</Button>{/if}
        <Button size="sm" variant="ghost" icon="close" onclick={() => ws.dismissSuggestions()} tip="Dismiss the readout and pending suggestions">Dismiss</Button>
      </div>
    {/if}
    {#if names.length}
      <div class="queue" data-testid="label-queue">
        <span class="k-hint">to paint</span>
        {#each names as n (n)}
          {@const q = splitName(n)}
          <button type="button" class="qc" class:done={have.has(n)} class:on={fa && ws.G.armed && ws.G.nextName === n && !have.has(n)} style:--c={groupColor(n)} onclick={() => ws.arm(n)} {@attach tooltip(have.has(n) ? 'Painted' : 'Arm this part: strokes paint it')}><i></i>{partLabel(n)}</button>
        {/each}
      </div>
    {/if}
    <!-- paw-ls54: a row, so the Groups dock sits beside the stage (GroupsOverlay moves it here) and the picture fits what it leaves -->
    <div class="mid">
    <div class="stage" bind:this={stage} bind:clientWidth={cw} bind:clientHeight={ch} data-testid="label-stage">
      <canvas bind:this={picCv} class="pic" class:crisp class:hidden={!vw || !ws.ready} style={picStyle}></canvas>
      <canvas bind:this={canvas} class="ov" style:cursor={p.overlays.activeTool ? p.overlays.activeTool.cursor || 'crosshair' : 'default'}
        onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} oncontextmenu={context} ondblclick={dbl}></canvas>
      <GroupsOverlay app={fa} />
      {#if ws.placeholder && !ws.ready && !ws.failed}<img class="ph" src={ws.placeholder} alt="" data-testid="label-placeholder" />{/if}
      {#if ws.busy}<div class="msg"><Spinner size={20} />Reading the folder…</div>
      {:else if ws.note}<div class="msg">{ws.note}</div>
      {:else if ws.failed}<div class="msg bad" data-testid="label-failed"><span>Could not read this image ({ws.failed}). The arrow keys still move on.</span><span><Button size="sm" onclick={() => ws.retry()}>Retry</Button></span></div>
      {:else if !ws.ready}<div class="msg" data-testid="label-loading"><Spinner size={20} />Loading…</div>{/if}
      {#if hint && ws.ready}<span class="tip">{hint}</span>{/if}
    </div>
    </div>
    <div class="strip" data-testid="label-strip" role="listbox" aria-label="Images in the folder">
      {#each shown as im, n (im.key)}
        {@const i = win[0] + n}
        {@const mk = markOf(im)}
        <button type="button" class="th" class:on={i === ws.index} class:done={!!mk} class:none={!!mk?.none} class:full={!!mk?.complete} class:other={!mk && ws.otherNames(im).length > 0} class:skip={!mk && ws.skipped.has(im.key)} role="option" aria-selected={i === ws.index} aria-label={im.name + (mk ? (mk.none ? ', nothing here' : ', labeled') : ws.skipped.has(im.key) ? ', skipped' : '')}
          onclick={() => ws.show(i)} {@attach tooltip(im.name + (mk ? (mk.none ? ' · nothing to label' : ` · ${mk.n} group${mk.n === 1 ? '' : 's'}${mk.complete ? ' · fully labeled' : ''}`) : ws.skipped.has(im.key) ? ' · skipped for later' : ws.otherNames(im).length ? ` · labeled in ${ws.otherNames(im).join(', ')}, not in ${dsName}` : ''))}>
          {#if ws.thumbs.has(im.key)}<img src={ws.thumbUrl(im)} alt="" decoding="async" draggable="false" />{/if}
          {#if mk}<i class="mark">{mk.none ? '∅' : mk.complete ? '✓✓' : '✓'}</i>{:else if ws.skipped.has(im.key)}<i class="mark faint">»</i>{:else if ws.otherNames(im).length}<i class="mark faint">◌</i>{/if}{#if ws.duos && ws.isDuo(im)}<i class="duo" aria-label="guessed duo">2</i>{/if}
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .lw { position: fixed; inset: 0; z-index: 60; display: flex; flex-direction: column; background: var(--bg); color: var(--tx); }
  .bar { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line-2); flex-wrap: wrap; row-gap: 4px; }
  .grow { flex: 1; min-width: 0; }
  .folder { max-width: 22ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count { color: var(--tx-hi); font-weight: 600; }
  .cur { white-space: nowrap; max-width: 36ch; overflow: hidden; text-overflow: ellipsis; }
  .seedbar { display: flex; align-items: center; gap: var(--space-3); padding: 1px var(--space-3); border-bottom: 1px solid var(--line-1); min-width: 0; white-space: nowrap; overflow: hidden; }
  .seedline { flex: 0 1 auto; min-width: 3ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .seedline + .seedline::before { content: '·'; margin-right: var(--space-3); color: var(--tx-mut); }
  .seedline :global(button) { flex: none; }
  .queue { display: flex; align-items: center; gap: 4px; padding: 3px var(--space-3); border-bottom: 1px solid var(--line-1); flex-wrap: wrap; }
  .qc { background: none; border: 1px solid var(--line-2); border-radius: var(--radius-pill); color: var(--tx); font: inherit; padding: 0 8px; line-height: 18px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
  .qc i { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
  .qc.on { border-color: var(--c); background: color-mix(in srgb, var(--c) 28%, transparent); color: var(--tx-hi); }
  .qc.done { opacity: .45; text-decoration: line-through; }
  .mid { display: flex; flex: 1 1 auto; min-height: 0; }
  .stage { position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: hidden; contain: strict; background: var(--bg-sunken); }
  .pic { position: absolute; left: 0; top: 0; transform-origin: 0 0; max-width: none; pointer-events: none; }
  .pic.crisp { image-rendering: pixelated; }
  .pic.hidden { visibility: hidden; }
  .ov { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; }
  .msg { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 8px; color: var(--tx-mut); pointer-events: none; }
  .msg.bad { color: var(--bad-ink, var(--tx)); }
  .msg.bad :global(button) { pointer-events: auto; }
  .ph { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; filter: blur(8px); opacity: .7; pointer-events: none; }
  .tip { position: absolute; left: 12px; bottom: 12px; pointer-events: none; font-size: .72rem; color: var(--tx); background: color-mix(in srgb, var(--bg) 72%, transparent); border: 1px solid var(--line-2); border-radius: var(--radius); padding: 2px 8px; max-width: calc(100% - 24px); }
  .strip { display: flex; gap: 3px; padding: 4px var(--space-3); overflow-x: auto; border-top: 1px solid var(--line-2); background: var(--bg-card, var(--bg)); }
  .th { position: relative; flex: 0 0 auto; width: 72px; height: 48px; padding: 0; border: 1px solid var(--line-1); background: var(--media-bg); cursor: pointer; overflow: hidden; opacity: .75; }
  .th img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .th.on { opacity: 1; border-color: var(--tx-hi); box-shadow: 0 0 0 1px var(--tx-hi); }
  .th.done { border-color: var(--ok, var(--series-green)); opacity: 1; }
  .th.none { border-style: dashed; }
  .mark { position: absolute; right: 2px; top: 1px; font-style: normal; font-size: var(--fs-1); line-height: 1; color: var(--ok, var(--series-green)); text-shadow: 0 0 3px var(--media-bg), 0 0 3px var(--media-bg); }
  .th.none .mark { color: var(--tx-hi); }
  .th.other { border-color: color-mix(in srgb, var(--ok, var(--series-green)) 35%, var(--line-1)); border-style: dotted; opacity: .85; }
  .mark.faint { color: var(--tx-mut); opacity: .75; }
  .duo { position: absolute; left: 2px; bottom: 1px; font-style: normal; font-size: var(--fs-1); line-height: 1; color: var(--tx-hi); background: var(--accent); padding: 0 3px; border-radius: var(--radius); }
  .th.skip { opacity: .4; }
</style>
