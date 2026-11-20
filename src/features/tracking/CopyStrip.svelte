<script>
  // Copy from… (paw-lgtx): up to six frames of this video whose groups could seed the shot on screen, over the bottom of the
  // video. paw-55la: each tile is a pair: the source frame with its groups, what it is, and the frame of THIS shot it matches
  // ("→ f N", how far from the playhead). Hover = peek: the video shows that frame, the groups lined up on it (the overlay
  // draws G.copyPreview); leaving goes back. Click or 1..6 = go there and copy (one undo step); Esc / C closes. No candidates:
  // one line says so. paw-d2d5: a source in a shot crop-linked to this one (the same footage re-framed) carries a "crop ×s"
  // tag, its thumbnail outlines the part this shot shows, and the strip says how many parts are in this framing.
  // paw-trxk: each tile says why it is offered (linked ×s / same loop ×s / re-framed ×s / similar picture / not compared);
  // after the six numbered tiles the strip scrolls on through EVERY other painted frame of the video; a line above says
  // when the search could not look properly (the frame decoder not responding).
  import { groupPaint } from './colors.js';
  import { THUMB_W, sourceGroups } from './copy-from.js';
  import { shotLabel, sceneRange } from '../timeline/shots.js';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { cssVar } from '../../ui/kit/color.js';

  let { app, G } = $props();
  const items = $derived(G.copy?.items || []), busy = $derived(!!G.copy?.busy);
  const th = $derived(Math.max(1, Math.round(THUMB_W / (G.tr.aspect || 16 / 9))));
  const clock = (t) => { const s = t / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
  const where = (c) => { const l = app.doc.scenes || [], r = sceneRange(l, c.shot); return r && r[1] > r[0] ? `shot ${shotLabel(l, c.shot)}` : `scene ${shotLabel(l, c.shot)}`; };
  const what = (c) => (c.kind === 'here' ? 'tracked here' : c.kind === 'painted' ? `painted · ${where(c)}` : c.carry ? 'painted · tracked' : 'tracked');
  const off = (c) => { const n = c.k - (G.copy?.k ?? c.k); return n ? ` (${n > 0 ? '+' : '−'}${Math.abs(n)})` : ''; };
  const reOf = (c) => (G.copy?.re && c.key in G.copy.re ? G.copy.re[c.key] : c.crop ? { scale: c.crop.scale, box: c.crop.box, wideIsSrc: c.crop.wideIsSrc, via: 'link' } : undefined);   // the crop it is placed through: known from the link, or found on the hover; null = checked, not re-framed
  const reTip = (r) => (r ? ` Re-framed: the same footage at crop ×${r.scale.toFixed(1)} (${r.via === 'loops' ? 'the same loop: its whole cycle matched' : r.via === 'link' ? 'the crop link between the shots' : 'a crop match of the two frames'}), so the groups are ${r.wideIsSrc ? 'magnified' : 'shrunk'} and moved onto this framing; parts outside it are left out.` : r === null ? ' Not re-framed (no crop between the two frames): lined up by a small move / zoom.' : '');
  /** Why the tile is offered (the tag on its caption). */
  const why = (c) => { if (c.unread) return 'not compared'; const r = reOf(c); if (c.crop) return `${c.crop.via === 'loops' ? 'same loop' : 'linked'} ×${c.crop.scale.toFixed(1)}`; if (r) return `re-framed ×${r.scale.toFixed(1)}`; return c.kind === 'painted' ? 'similar picture' : ''; };
  const tip = (c, n) => ({ text: c.kind === 'here' ? 'From tracking: a finished run\'s points on this very frame, rebuilt as groups (nothing to line up; Track seeds exactly those points)'
    : `${c.kind === 'painted' ? `The groups painted in ${where(c)}` : c.carry ? 'The painted groups, carried by the run\'s points' : 'A run\'s points'} at ${clock(c.t)}${c.kind === 'tracked' && !c.carry ? ', rebuilt as groups' : ''}: the closest match is frame ${c.k} of this shot${off(c) ? `${off(c)} from the playhead` : ' (on screen)'}. Hover: the video shows that frame, the groups lined up on it. Copy: goes there, all the groups moved together as one set, each a dotted '?' to Accept, nudge or repaint.${c.unread ? ' This frame could not be read, so it was not compared: the groups come in where they were painted' + (c.crop ? ', through the link' : '') + '.' : ''}${reTip(reOf(c))}`, ...(n < 6 ? { shortcut: String(n + 1) } : {}) });
  const srcOf = new WeakMap();   // a run candidate's seeds -> its rebuilt groups (the tiles are new objects on every update)
  const groupsOf = (c) => { if (c.kind === 'painted') return c.groups; let g = srcOf.get(c.seeds); if (!g) { g = sourceGroups(c, G.size, (x) => G.maskFor(x)); srcOf.set(c.seeds, g); } return g; };
  /** The tile: its frame (dark when it could not be decoded) and its groups as filled outlines. */
  const paintTile = (c) => (cv) => {
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    ctx.fillStyle = cssVar('--media-bg', cv) || 'black'; ctx.fillRect(0, 0, W, H);   // the picture's well until its thumbnail draws
    if (c.thumb) ctx.drawImage(c.thumb, 0, 0, W, H);
    ctx.lineJoin = 'round';
    const r = reOf(c);
    if (r?.wideIsSrc && r.box) { ctx.setLineDash([3, 2]); ctx.lineWidth = 1; ctx.strokeStyle = cssVar('--on-media', cv) || 'white'; ctx.strokeRect(r.box.x * W, r.box.y * H, r.box.w * W, r.box.h * H); ctx.setLineDash([]); }   // paw-d2d5: what this shot shows of the wider source
    for (const g of groupsOf(c)) {
      if (!(g.poly?.length >= 3)) continue;
      ctx.beginPath(); g.poly.forEach(([x, y], k) => (k ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H))); ctx.closePath();
      const col = groupPaint(g.name);
      ctx.globalAlpha = 0.3; ctx.fillStyle = col; ctx.fill();
      ctx.globalAlpha = 1; ctx.lineWidth = 1.5; ctx.strokeStyle = col; ctx.stroke();
    }
  };
  $effect(() => G.copyRelink(G.tr.shotLinks));   // paw-d2d5: crop links arriving while the strip is open re-rank it
  const pv = $derived(G.copy?.hover ? G.copyPreview : null), fit = $derived(pv?.lost ? `${pv.of - pv.lost} of ${pv.of} parts are in this framing` : '');
  // 1..6 pick, Esc closes: capture phase while the strip is up, so the tool's 1 / 2 / 3 (characters) and Esc (close the tool) wait
  $effect(() => {
    const kd = (e) => {
      if (!G.copy || e.ctrlKey || e.altKey || e.metaKey || (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      const n = /^[1-6]$/.test(e.key) ? +e.key - 1 : -1;
      if (e.key === 'Escape') G.closeCopy();
      else if (n >= 0 && items[n]) G.copyPick(items[n].key);
      else return;
      e.preventDefault(); e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', kd, true);
    return () => window.removeEventListener('keydown', kd, true);
  });
</script>

<div class="cstrip" data-testid="groups-copy">
  {#if !items.length}
    <span class="line" data-testid="groups-copy-none">{busy ? 'Looking for frames like this shot…' : 'Nothing to copy from: no other shot of this video has painted groups or a run, and no run covers this frame'}</span>
  {:else}
    <div class="tiles">
      {#each items as c, n (c.key)}
        {#if c.more && !items[n - 1]?.more}<span class="sep dim" data-testid="groups-copy-more">all painted ›</span>{/if}
        <button type="button" class="tile" class:on={G.copy?.hover === c.key} class:unread={c.unread} data-testid="groups-copy-item" data-kind={c.kind} data-key={c.key} data-more={c.more ? '1' : null}
          onpointerenter={() => G.copyHover(c.key)} onpointerleave={() => G.copyHover('')} onclick={() => G.copyPick(c.key)} {@attach tooltip(tip(c, n))}>
          <canvas width={THUMB_W} height={th} {@attach paintTile(c)}></canvas>
          <span class="cap">{#if n < 6}<b class="num">{n + 1}</b> {/if}{#if why(c)}<span class="crop" class:re={!!(c.crop || reOf(c))} data-testid="groups-copy-crop">{why(c)}</span> {/if}{what(c)}</span>
          <span class="cap num dim" data-testid="groups-copy-at">{c.unread ? 'not read' : `→ f ${c.k}${off(c)}`}</span>
        </button>
      {/each}
    </div>
    <span class="k-hint keys">{busy ? 'closer frames coming… · ' : ''}1–6 · Esc</span>
  {/if}
  {#if G.copy?.warn || fit}<span class="fit" class:warn={!!G.copy?.warn} data-testid={G.copy?.warn ? 'groups-copy-warn' : 'groups-copy-fit'}>{G.copy?.warn || fit}</span>{/if}
</div>

<style>
  /* the stage is `contain: strict`: fixed = pinned to the stage */
  .cstrip { position: fixed; left: 50%; bottom: 44px; transform: translateX(-50%); z-index: 13; pointer-events: auto; max-width: calc(100% - 2 * var(--space-3));
    display: flex; align-items: flex-end; gap: 6px; padding: 6px; user-select: none; -webkit-user-select: none;
    background: var(--glass); backdrop-filter: var(--glass-blur); border: var(--bw) solid var(--line-2); border-radius: var(--radius); color: var(--tx); font-size: var(--fs-1); }
  .line { padding: 2px var(--space-2); white-space: nowrap; }
  .tiles { display: flex; align-items: flex-end; gap: 6px; min-width: 0; overflow-x: auto; scrollbar-width: thin; }
  .sep { align-self: center; white-space: nowrap; }
  .tile.unread canvas { opacity: 0.6; }
  .warn { color: var(--warn, var(--tx-hi)); }
  .tile { flex: 0 0 132px; min-width: 64px; display: flex; flex-direction: column; gap: 3px; padding: 3px; border: 1px solid transparent; border-radius: var(--radius); background: none; color: inherit; font: inherit; cursor: pointer; text-align: left; }
  .tile:hover, .tile.on { border-color: var(--tx-hi); background: color-mix(in srgb, var(--tx-hi) 8%, transparent); }
  .tile canvas { width: 100%; height: auto; display: block; border-radius: var(--radius); }
  .cap { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dim { color: var(--tx-mut); }
  .fit { position: absolute; left: 6px; bottom: 100%; margin-bottom: 3px; padding: 1px var(--space-2); white-space: nowrap; border-radius: var(--radius);
    background: var(--glass); backdrop-filter: var(--glass-blur); border: var(--bw) solid var(--line-2); }   /* above the strip: out of its flow, so the tiles never move under the pointer */
  .crop { padding: 0 3px; border-radius: var(--radius); background: color-mix(in srgb, var(--tx-mut) 16%, transparent); color: var(--tx-mut); }
  .crop.re { background: color-mix(in srgb, var(--tx-hi) 16%, transparent); color: var(--tx-hi); }
  .keys { white-space: nowrap; align-self: center; }
</style>
