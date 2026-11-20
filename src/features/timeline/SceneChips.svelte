<script>
  // The lane toolbar's three chips (paw-hmn, owner: "the tracker chip has grown too big"): one line, each a summary that
  // opens a kit popover with its controls (SceneQuickBar's sections: one implementation, the Inspector shows them all).
  //   Scene: 'Scene 3 · anal penetration · knotting' ('untagged' dashed); popover: where / what / modifiers /
  //     structure with the suggestions, Fill, the modifier chips, offers, new scene / merge.
  //   Shot: 'Shot 3.2 · pan · internal' (a selection: 'Shots 3.1 to 3.3', '5 shots'); popover: view and camera, the cut
  //     before it (cut / camera move), cut here / merge, Stabilise, re-found groups to accept.
  //   Tracker (paw-unuy: no chip of its own any more): the tracker, its points, the picked signal, the progress are the ▾'s tooltip
  //     beside Track; the ▾ and a right-click on Track / Track ROI open its settings (tracking/TrackMenu.svelte: the tracker,
  //     Track's grid points, the tracker's params, Cancel, the Tracker panel; Groups / Track ROI too when the row is narrow).
  // Hints that used to be extra lines ('needs a where', 'cannot fill: ...', offers, groups to confirm, a busy tracker)
  // are a dot on their chip, the words in its tooltip and popover. paw-rw84: beside the Tracker chip, in the order of the
  // work: Groups (the painting tool on the shot, pressed while it is open, the take's painted groups counted), Track (the
  // point grid over the whole frame: THE Track, T) and Track ROI (one painted part: SAM, its size;
  // Ctrl+T), while there is room; narrower, Groups and Track ROI lose their words; narrower still, the Tracker popover
  // only; while the Tracker popover is open the inline buttons hide (paw-t8z: one Track on screen).
  // Popovers close on Esc, an outside press, or when the selection moves to another scene. Tag keys and commands work
  // without opening anything. The Scenes tab (paw-ef73.1) shows only the Scene and Shot chips: tracking is the Track tab's.
  import { untrack } from 'svelte';
  import Popover from '../../ui/kit/Popover.svelte';
  import Button from '../../ui/kit/Button.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import SceneQuickBar from './SceneQuickBar.svelte';
  import { tl, scenesOf, durOf, selOf } from './state.svelte.js';
  import { currentSpan, chipTexts, signalOf, runFor, gridBlock, groupsButton, tracksRange } from './quickbar.js';
  import { cmd } from '../../app/cmd.js';
  import { groupsFor } from '../tracking/groups.svelte.js';
  import { sceneRange } from './shots.js';
  import { fillHint } from './commands-scenes.js';
  import { trackingOf, noteUsage } from './deps.js';
  import { ctlLog } from '../../app/ctl-log.js';
  import IconButton from '../../ui/kit/IconButton.svelte';
  import TrackMenu, { trackTip } from '../tracking/TrackMenu.svelte';
  import RunBar from '../tracking/RunBar.svelte';

  let { app } = $props();
  let w = $state(0), open = $state(''), els = $state({}), trackAnchor = $state(null);
  const gridPts = $derived(Math.round(+app.settings.get('tracking.gridPoints', 512)) || 512);
  /** Right-click on Track / Track ROI: the tracker's settings, next to that button. */
  function menuAt(e) { e.preventDefault(); trackAnchor = e.currentTarget; if (open !== 'tracker') toggle('tracker'); }
  const list = $derived(scenesOf(app));
  const span = $derived(currentSpan(list, selOf(), app.doc.range, app.player.timeMs, durOf(app)));
  const tr = $derived(span ? trackingOf(app) : null);
  const fillNow = $derived(tr && span ? tr.fills?.find((f) => f.lo <= span.hi && f.hi >= span.lo) ?? null : null);
  const tx = $derived(chipTexts(list, span, { fillNeed: fillNow?.need ? fillHint(fillNow, list) : '' }));
  const run = $derived(tr && span ? runFor(tr, span.shot) : null);
  const sig = $derived(run ? signalOf(tr, span.shot, run) : '');
  const tracker = $derived(tr?.trackers?.find((t) => t.id === tr.trackerId) ?? null);
  const pts = $derived(tr?.params?.box_points ?? tr?.params?.max_points ?? null);
  const busy = $derived(!!tr?.busyRange && tr.busyRange.t0 < span?.t1 && tr.busyRange.t1 > span?.t0);
  const trackText = $derived([tracker?.name || (tr?.listed ? 'No tracker' : 'Tracker'), ...(pts ? [`${pts} pts`] : []), ...(sig ? [`signal ${sig}`] : []), ...(busy ? [tr.progressLabel] : [])].join(' · '));
  const trackNotes = $derived([...(tr?.error ? [String(tr.error).split(/\r?\n/)[0]] : []), ...(!tr?.canTrack && tr?.trackBlock ? [tr.trackBlock] : [])]);
  // the inline buttons only while the toolbar has room (never a second line); their words from `worded` px up. paw-k8pe: the room is
  // the slot less what the run's controls cannot fold (their chip, direction and …: RunBar, right of the cog)
  let runMin = $state(0);
  const room = $derived(w - runMin);
  const inline = $derived(room >= 360), worded = $derived(room >= 560);   // px of the chips' slot
  const G = $derived(trackerOn && app.doc.media ? groupsFor(app) : null);   // made here, so `pressed` follows the tool from the start
  const gb = $derived(span ? groupsButton(list, span.shot, { media: app.doc.media, mode: app.mode, on: G?.on }) : null);
  const key = (id) => app.commands.keysFor?.(id)?.[0] || '';
  // narrower still: each chip keeps only its first part ('Scene 4', 'Shot 4.2', the tracker's name), the rest in its tooltip
  const compact = $derived(w > 0 && room < 300);
  const trackerOn = $derived(app.mode !== 'scenes');
  const short = (t) => (compact ? String(t).split(' · ')[0] : t);
  const sceneKey = $derived(span ? sceneRange(list, span.shot)?.[0] : -1);
  let lastKey = -1;
  $effect(() => { const k = sceneKey; if (k !== lastKey) { lastKey = k; open = ''; } });   // another scene: the popover closes
  // paw-r73w: a popover's time to its first action (chips:firstAction {chip, ms, c}; c null = closed with none)
  let shown = { chip: '', t: 0, acted: false };
  const first = (c) => { if (shown.chip && !shown.acted) { shown.acted = true; app.usage?.note?.('chips:firstAction', { chip: shown.chip, ms: Math.round(performance.now() - shown.t), c }); } };
  $effect(() => { const o = open; untrack(() => { first(null); shown = { chip: o, t: performance.now(), acted: false }; }); });

  function toggle(which) {
    open = open === which ? '' : which;
    if (open) { noteUsage(app, `chips.${which}`); app.usage?.note?.('chips:open', { chip: which, shots: span?.shots.length ?? 0 }); tr?.ensureListed?.(); }
  }
  /** The chip's tooltip: its summary, then its notes. */
  const tipOf = (text, notes, what) => [text, ...notes, `Click: the ${what} controls`].join(' · ');
  // paw-yt8q: Track / Track ROI are T / Ctrl+T (the commands take the span: the selection, else the scene at the playhead)
  function groups() {
    noteUsage(app, 'chips.groups');
    groupsFor(app).toggle();
  }
  const groupsTip = $derived(!gb ? '' : !gb.enabled ? (app.doc.media ? 'Groups: paint the parts the tracker pins (the Track tab)' : 'Open a video first')
    : gb.pressed ? 'Groups tool open: click to close it (Esc)' : `Groups: paint the parts the tracker pins, on the shot under the playhead${gb.count ? ` (${gb.count} painted in this take)` : ''}`);
</script>

{#snippet chip(which, label, text, notes, extra = '', tipText = text)}
  <button bind:this={els[which]} type="button" class="chip {extra}" class:on={open === which} aria-haspopup="dialog" aria-expanded={open === which}
    data-chip={which} data-ctl="{which} chip" onclick={() => toggle(which)} {@attach tooltip(tipOf(tipText, notes, label.toLowerCase()))}>
    {#if notes.length}<i class="note" aria-label="{notes.length} note{notes.length > 1 ? 's' : ''}"></i>{/if}
    <span class="txt">{short(text)}</span>
  </button>
{/snippet}

{#snippet groupsLabel()}{#if worded}Groups{/if}{#if gb.count}<span class="cnt k-num">{gb.count}</span>{/if}{/snippet}

{#if span && tx && tr}
  <div class="chips" bind:clientWidth={w} {@attach ctlLog(app, 'chips')} role="group" aria-label="Scene, shot and tracker: {span.text}" data-target={span.text}>
    {@render chip('scene', 'Scene', tx.scene.text, tx.scene.notes, tx.scene.untagged ? 'untagged' : '', tx.scene.text)}
    {@render chip('shot', 'Shot', tx.shot.text, tx.shot.notes, '', tx.shot.tip || tx.shot.text)}
    {#if trackerOn}
      <!-- paw-unuy: no tracker chip; its summary is Track's tooltip, its settings the cog / a right-click on Track or Track ROI -->
      <span class="inl">
        {#if inline}<Button size="sm" icon="brush" data-btn="groups" pressed={gb.pressed} disabled={!gb.enabled} onclick={groups} tip={groupsTip} shortcut={key('tracking.groups')} aria-label="Groups{gb.count ? ` (${gb.count})` : ''}"
          children={worded || gb.count ? groupsLabel : undefined} />{/if}
        <Button size="sm" variant="primary" icon="grid" data-btn="track" {...cmd(app, 'track.gridFrame', undefined, { tip: gridBlock(tr) || trackTip(tr, gridPts, tracksRange(span, app.doc.range, selOf()) ? 'the I-O range' : span.text.toLowerCase()), before: () => noteUsage(app, 'chips.grid') })}
          oncontextmenu={menuAt} loading={tr.busy === 'track' || tr.queued === 'grid'}>Track</Button>
        {#if inline}<Button size="sm" icon="crosshair" data-btn="track-roi" {...cmd(app, 'track.run', undefined, { tip: 'Track ROI: one painted part; several: pick one', before: () => noteUsage(app, 'chips.track') })}
          oncontextmenu={menuAt} aria-label="Track ROI" label={worded ? 'Track ROI' : ''} />{/if}
        <!-- owner: "remove the dropdown, this is a group of controls, add a cog and use a vertical bar like on the footer to separate them" -->
        <span class="mw">
          <IconButton size="sm" icon="gear" data-btn="track-menu" class={busy ? 'busy' : ''} aria-haspopup="dialog" aria-expanded={open === 'tracker'}
            label="Tracker settings" tip={open === 'tracker' ? '' : tipOf(trackText, trackNotes, "tracker's settings")} onclick={(e) => { trackAnchor = e.currentTarget; toggle('tracker'); }} />
          {#if trackNotes.length}<i class="note" aria-label="{trackNotes.length} note{trackNotes.length > 1 ? 's' : ''}"></i>{/if}
        </span>
      </span>
      <!-- paw-k8pe: the run's tool settings, right of the cog (the run under the playhead or the picked one; no run: nothing) -->
      <RunBar {app} bind:minW={runMin} />
    {/if}
  </div>
  {#each [['scene', 'Scene', tx.scene.notes, tx.scene.text], ['shot', 'Shot', tx.shot.notes, tx.shot.tip || tx.shot.text]] as [which, title, notes, head] (which)}
    <Popover open={open === which} onclose={() => { if (open === which) open = ''; }} anchor={els[which]} placement="bottom-start" label="{title} controls" title={head}>
      <div class="pop" {@attach ctlLog(app, 'pop.' + which, first)}>
        {#each notes as n (n)}<p class="pnote" role="status">{n}</p>{/each}
        <SceneQuickBar {app} section={which} current />
      </div>
    </Popover>
  {/each}
  {#if trackerOn}
    <Popover open={open === 'tracker'} onclose={() => { if (open === 'tracker') open = ''; }} anchor={trackAnchor} placement="bottom-start" label="The tracker's settings" title="Tracker · {trackText}">
      <div class="pop" {@attach ctlLog(app, 'pop.tracker', first)}>
        {#each trackNotes as n (n)}<p class="pnote" role="status">{n}</p>{/each}
        <TrackMenu {app} {tr} {sig} {busy} compact={!inline} onroi={() => noteUsage(app, 'chips.track')} ongroups={groups} {groupsTip} />
      </div>
    </Popover>
  {/if}
{/if}

<style>
  .chips { display: flex; align-items: center; gap: var(--space-1); min-width: 0; flex: 1 1 0; width: 100%; overflow: hidden; white-space: nowrap; }   /* fills the slot: its width is the room there, not its content (no compact/full feedback loop) */
  .chip { position: relative; display: inline-flex; align-items: center; gap: var(--space-1); min-width: 2.5rem; max-width: 22rem; flex: 0 1 auto; height: var(--ctl-h-sm, 22px);
    padding: 0 var(--space-3); font: inherit; font-size: var(--fs-1); color: var(--tx-val); background: var(--bg-sunken); border: var(--bw) solid var(--line-2); border-radius: var(--radius); cursor: pointer; }
  .chip:hover { border-color: var(--line-4); color: var(--tx-hi); }
  .chip.on { border-color: var(--sel-line); color: var(--tx-hi); background: var(--bg-raised); }
  .chip.untagged { border-style: dashed; color: var(--tx-mut); }
  .chip.busy { border-color: var(--reality); }
  .chip .txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .note { position: absolute; top: 2px; right: 2px; width: 6px; height: 6px; border-radius: 50%; background: var(--warn); }
  /* one group of controls, set off by a bar each side like the footer's trays */
  .inl { display: inline-flex; align-items: center; gap: var(--space-1); flex: none; margin: 0 var(--space-1); padding: 0 var(--space-3); border-left: 1px solid var(--line-1); border-right: 1px solid var(--line-1); }
  .mw { position: relative; display: inline-flex; }
  .mw > :global(button.busy) { box-shadow: inset 0 0 0 1px var(--reality); }
  .cnt { display: inline-block; min-width: 1.2em; padding: 0 3px; margin-left: 2px; border-radius: var(--radius); background: var(--bg-active); color: var(--tx-val); font-size: var(--fs-1); line-height: 1.4; text-align: center; }
  .pop { display: grid; gap: var(--space-2); max-width: min(46rem, 90vw); }
  .pop :global(.qb) { padding: 0; }
  .pnote { margin: 0; font-size: var(--fs-1); color: var(--warn, var(--tx-val)); }
</style>
