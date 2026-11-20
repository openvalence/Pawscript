<script>
  // paw-k8pe (the owner circled the band's Adjust strip and the run strip's tiny name and ±, and drew an arrow up to the lane
  // toolbar, right of Track's cog): the run's tool settings in the lane toolbar row (Blender's tool-settings strip, paw-m3b6).
  // TrackingLane (the Track tab's combined lane) hands its controls over (tracking runBar: {on, chip, pol, groups}); this lays
  // them out: the run chip and its direction never fold; the groups keep their order and the tail that does not fit goes into
  // ONE … popover at the row's end (the same controls inside: nothing dropped). No run: nothing. One line, no second row.
  // Widths: each group's width while it was in the row (kept when it folds), so it comes back once there is room again. Only
  // when every group is folded and the row is still short does the chip's text give way (ellipsis, the full name in its
  // tooltip); at the very narrowest (a ~1000 px window) the chip shrinks to its number and the direction shows its icon and its
  // pressed state only (the words in its tooltip and name), at a button's size still.
  import Popover from '../../ui/kit/Popover.svelte';
  import IconButton from '../../ui/kit/IconButton.svelte';
  import { trackingFor } from './tracking.svelte.js';

  let { app, minW = $bindable(0) } = $props();
  // svelte-ignore state_referenced_locally
  const tr = trackingFor(app);
  const bar = $derived(tr.runBar?.on ? tr.runBar : null);
  const gs = $derived(bar ? bar.groups : []);
  let w = $state(0), cw = $state(0), cwNat = $state(0), pw = $state(0), pwNat = $state(0), ws = $state({}), open = $state(false), anchor = $state(null);
  // the … button (kit IconButton sm); the row's gap (--space-1); the chip squeezed (6rem), tight (3rem); the direction as an icon
  const MORE = 24, GAP = 4, CHIP_MIN = 96, CHIP_TIGHT = 48, ICON = 24;
  const n = $derived.by(() => {
    if (!w) return gs.length;
    const room = w - cwNat - pwNat - GAP, used = (k) => gs.slice(0, k).reduce((a, g) => a + (ws[g.key] || 0) + GAP, 0);
    if (used(gs.length) <= room) return gs.length;
    let k = gs.length;
    while (k > 0 && used(k) > room - MORE - GAP) k--;
    return k;
  });
  const squeeze = $derived(n === 0 && gs.length > 0);
  // the chip's own width: measured while it may not shrink; while squeezed only a longer text raises it
  $effect(() => { if (!squeeze || cw > cwNat) cwNat = cw; });
  const roomy = $derived(Math.min(cwNat, CHIP_MIN) + pwNat + MORE + 3 * GAP);   // squeezed, the direction in words
  const tight = $derived(squeeze && w > 0 && w < roomy);
  $effect(() => { if (!tight) pwNat = pw; });   // the direction's width in words (kept while it is an icon)
  const min = $derived(bar ? Math.min(cwNat, CHIP_TIGHT) + Math.min(pwNat || ICON, ICON) + MORE + 3 * GAP : 0);
  $effect(() => { minW = bar ? roomy : 0; });   // what the toolbar must leave it (SceneChips: Groups / Track ROI fold their words, then go, before it is cut)
  $effect(() => { if (n >= gs.length) open = false; });
</script>

{#if bar}
  <div class="rb k-runbar pick" class:squeeze class:tight bind:clientWidth={w} style:min-width="{min}px" role="group" aria-label="The run's controls" data-testid="run-bar">
    <span class="fix"><span class="cw" bind:offsetWidth={cw}>{@render bar.chip()}</span><span class="pw" bind:offsetWidth={pw}>{@render bar.pol(tight)}</span></span>
    {#each gs.slice(0, n) as g (g.key)}
      <span class="g" data-group={g.key} bind:offsetWidth={null, (v) => { if (v) ws[g.key] = v; }}>{@render g.snip()}</span>
    {/each}
    {#if n < gs.length}
      <IconButton size="sm" icon="more" label="More of the run's controls" data-testid="run-more" aria-haspopup="dialog" aria-expanded={open}
        tip={open ? '' : `${gs.length - n} more of the run's controls: ${gs.slice(n).map((g) => g.word).join(', ')}`} onclick={(e) => { anchor = e.currentTarget; open = !open; }} />
      <Popover bind:open {anchor} placement="bottom-end" label="More of the run's controls">
        <div class="over k-runbar pick" data-testid="run-more-body">
          {#each gs.slice(n) as g (g.key)}<span class="g" data-group={g.key}>{@render g.snip()}</span>{/each}
        </div>
      </Popover>
    {/if}
  </div>
{/if}

<style>
  .rb { flex: 1 1 0; display: flex; align-items: center; gap: var(--space-1); overflow: hidden; white-space: nowrap; font: var(--fs-1) / 1 var(--font); }
  .fix { display: contents; }
  .cw, .pw, .g { flex: none; display: inline-flex; align-items: center; }
  .cw { max-width: 20rem; }
  .squeeze .cw { flex: 0 1 auto; min-width: 6rem; overflow: hidden; }   /* the chip's text ellipsises (kit Button label) */
  .tight .cw { min-width: 3rem; }
  .over { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); max-width: min(34rem, 90vw); font: var(--fs-1) / 1 var(--font); }
</style>
