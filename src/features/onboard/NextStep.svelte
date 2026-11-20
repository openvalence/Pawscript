<script>
  // The first-run hint (paw-kxwz): one line at the top of the picture with the next step and its key, for the shot under
  // the playhead (steps.js). Only the Quick start link and the x take the pointer; x hides that step for good (Help ›
  // Show first-run hints brings them back). A profile that had projects before never sees it unless asked.
  import { tooltip } from '../../ui/kit/tooltip.js';
  import Icon from '../../ui/kit/Icon.svelte';
  import Keys from '../palette/Keys.svelte';
  import { peekTracking } from '../tracking/tracking.svelte.js';
  import { runForScene } from '../../lib/runs.js';
  import { factsOf, hintStep, lineOf, dismiss } from './steps.js';
  import { openQuickStart } from './open.js';

  let { app } = $props();
  const step = $derived.by(() => {
    const tr = peekTracking(app), list = app.doc.scenes || [], i = tr?.currentScene ?? -1;
    const ghost = tr && list[i] ? tr.ghost(runForScene(list[i], tr.links, tr.ghosts)) : null;
    return hintStep(app.settings, factsOf(list, i, app.script, ghost), { media: !!app.doc.media, busy: tr?.busy === 'track' });
  });
  const line = $derived(step ? lineOf(step, app.mode, (id) => app.commands.keysFor(id)) : null);
  const f1 = $derived(app.commands.keysFor('palette.help')[0] || '');
  // paw-q3ad: with the Groups tool open it sits at the foot of the stage right of the Groups bar, its height published there as
  // --ob-h: the bar's context line rises over it and the notes card at the top stops above it (GroupsOverlay.svelte)
  let el = $state(null), h = $state(0);
  $effect(() => {
    const st = el?.parentElement;
    if (!st) return;
    st.style.setProperty('--ob-h', 8 + h + 4 + 'px');
    return () => st.style.removeProperty('--ob-h');
  });
</script>

{#if line}
  <div class="ob" data-testid="onboard-hint" data-step={step} bind:this={el} bind:offsetHeight={h}>
    <span class="tx">{#each line as p, i (i)}{#if p.keys}<Keys keys={p.keys} />{:else}{p.t}{/if}{/each}</span>
    <button type="button" class="lk" onclick={() => openQuickStart(app)} {@attach tooltip('Every step from the first cut to the .funscript', f1)}>Quick start</button>
    <button type="button" class="x" aria-label="Hide this hint" onclick={() => dismiss(app.settings, step)} {@attach tooltip('Hide this hint')}><Icon name="close" size={12} /></button>
  </div>
{/if}

<style>
  .ob { position: absolute; top: 8px; left: 0; right: 0; margin-inline: auto; width: max-content; max-width: min(760px, calc(100% - 24px)); display: flex; align-items: center; gap: var(--space-4);
    padding: 3px 4px 3px 10px; border: var(--bw) solid var(--line-2); border-radius: var(--radius); background: var(--glass); backdrop-filter: var(--glass-blur);   /* the video's own hint's look (paw-p8o2) */
    color: var(--tx); font-size: var(--fs-2); line-height: 1.4; pointer-events: none; }
  /* paw-q3ad: the Groups tool open: at the foot of the stage, right of its bar (--gdock-w), clear of its notes card at the top */
  :global([data-testid="video-stage"]:has(> .gtools)) .ob { top: auto; bottom: 8px; left: calc(var(--gdock-w, 36px) + 4px); right: 4px; max-width: calc(100% - var(--gdock-w, 36px) - 8px); }
  /* one line there (a narrow stage would make it taller than the stage): what does not fit ends in an ellipsis, Quick start has it all */
  :global([data-testid="video-stage"]:has(> .gtools)) .ob .tx { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* paw-8ehz: on the video stage ([data-gcols]) the right column, off the picture; it wraps there (after the two rules above) */
  :global([data-testid="video-stage"][data-gcols]:has(> .gtools)) .ob { left: auto; right: 4px; width: auto; max-width: calc(var(--gcol-r, 250px) - 8px); max-height: calc(100% - 16px); overflow: hidden; flex-wrap: wrap; justify-content: flex-end; }
  :global([data-testid="video-stage"][data-gcols]:has(> .gtools)) .ob .tx { white-space: normal; flex: 1 1 100%; }   /* the text the column's width, Quick start and x under it */
  .tx { min-width: 0; }
  button { pointer-events: auto; flex: none; color: var(--tx-mut); border-radius: var(--radius); }
  button:hover { color: var(--tx-hi); background: var(--bg-raised); }
  .lk { padding: 1px 6px; text-decoration: underline; text-underline-offset: 2px; }
  .x { display: grid; place-items: center; width: 20px; height: 20px; }
</style>
