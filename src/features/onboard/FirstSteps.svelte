<script>
  // The empty Projects page's first-run card (paw-a0eg, paw-kxwz): five steps with their keys, the Quick start, an x that
  // hides it for good. Props: {app}.
  import Button from '../../ui/kit/Button.svelte';
  import IconButton from '../../ui/kit/IconButton.svelte';
  import Keys from '../palette/Keys.svelte';
  import { fmtKeys } from '../../app/keymap.js';
  import { CARD, partsOf, cardOn } from './steps.js';

  let { app } = $props();
  const kf = (id) => app.commands.keysFor(id);
  const fur = $derived(app.settings.get('content.furry') !== false);   // paw-43vn: the one line offering View › Furry items
</script>

{#if cardOn(app.settings)}
  <section class="card" data-testid="home-first-run" aria-label="First steps">
    <header><b>Your first script, in five steps</b><IconButton icon="close" size="sm" label="Hide these steps" onclick={() => app.settings.set('onboard.card', false)} /></header>
    <ol>{#each CARD as line, i (i)}<li>{#each partsOf(line, kf) as p, j (j)}{#if p.keys}<Keys keys={p.keys} />{:else}{p.t}{/if}{/each}</li>{/each}</ol>
    <div class="acts">
      <!-- paw-ys3x: a finished example (generated clip, tracked, published) copied to Videos, opened on the Track tab -->
      <Button variant="primary" icon="play" data-testid="home-sample" data-command="help.sample" onclick={() => app.commands.run('help.sample')}>Open the sample project</Button>
      <Button icon="info" shortcut={fmtKeys(kf('palette.help')[0] || '')} data-command="help.quickStart" onclick={() => app.commands.run('help.quickStart')}>Quick start: each step and its usual mistake</Button>
    </div>
    <p class="fur" data-testid="home-furry">{fur ? 'Not scripting furry animation? Hide the tails, sheaths and animal bodies (paws then read as feet; the knot stays).' : 'Furry items are hidden: human parts and bodies (the knot stays).'} <Button size="sm" variant="ghost" data-command="view.furry" onclick={() => app.commands.run('view.furry')}>{fur ? 'Hide furry items' : 'Show furry items'}</Button></p>
  </section>
{/if}

<style>
  .card { width: min(560px, 100%); display: grid; gap: var(--space-4); padding: var(--space-5) var(--space-6); border: 1px solid var(--line-2); border-radius: var(--radius); background: var(--bg-raised); color: var(--tx); text-align: left; }
  header { display: flex; align-items: center; justify-content: space-between; color: var(--tx-hi); }
  ol { margin: 0; padding-left: 1.4em; display: grid; gap: var(--space-2); line-height: 1.5; }
  .acts { display: flex; flex-wrap: wrap; gap: var(--space-3); }
  .fur { margin: 0; color: var(--tx-mut); }
</style>
