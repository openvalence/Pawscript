<script>
  import Button from '../Button.svelte';
  import IconButton from '../IconButton.svelte';
  import Switch from '../Switch.svelte';
  import Checkbox from '../Checkbox.svelte';
  import TextField from '../TextField.svelte';
  import SegmentedControl from '../SegmentedControl.svelte';
  import ProgressBar from '../ProgressBar.svelte';
  import Kbd from '../Kbd.svelte';
  import Popover from '../Popover.svelte';
  import Dialog from '../Dialog.svelte';
  import ToastHost from '../ToastHost.svelte';
  import { confirm } from '../dialog.js';
  import { toast } from '../toast.svelte.js';
  import { tooltip } from '../tooltip.js';

  // Popover
  let loop = $state({ on: true, mode: 'ab', start: '00:01:12.400', end: '00:01:18.050', snap: true });
  let snapOpen = $state(false);
  let snapTo = $state('frame');

  // Dialogs
  let dlg = $state({ sm: false, md: false, lg: false, long: false, busy: false });
  let lastClose = $state('');
  let answer = $state('');
  const closed = (reason) => (lastClose = reason);

  async function ask(kind) {
    answer = '…';
    const ok = kind === 'discard'
      ? await confirm({ title: 'Discard unsaved changes?', message: 'Edits made since the last save will be lost.', confirmLabel: 'Discard', danger: true })
      : await confirm({ title: 'Overwrite video.funscript?', message: 'A backup is kept.', confirmLabel: 'Overwrite' });
    answer = String(ok);
  }

  const shortcuts = [
    ['Play / pause', 'Space'], ['Add point at playhead', 'A'], ['Delete selection', 'Delete'], ['Undo', 'Ctrl+Z'],
    ['Redo', 'Ctrl+Shift+Z'], ['Step one frame back', 'ArrowLeft'], ['Step one frame forward', 'ArrowRight'],
    ['Zoom to fit', 'Shift+F'], ['Toggle snapping', 'S'], ['Save', 'Ctrl+S'],
  ];

  // Toasts
  const fire = {
    info: () => toast('Script loaded: 1 284 actions'),
    ok: () => toast('Saved video.funscript', { kind: 'ok' }),
    warn: () => toast('Video is VFR — frame snapping is approximate', { kind: 'warn' }),
    bad: () => toast('Tracker crashed', { kind: 'bad', action: { label: 'Show log', run: () => toast('Opened tracker.log') } }),
    neutral: () => toast('3 points pasted', { kind: 'neutral', action: { label: 'Undo', run: () => {} } }),
  };
  function burst() { for (const k of ['info', 'ok', 'warn', 'neutral', 'info']) fire[k](); }

  const pinned = [
    { id: 'p1', kind: 'info', message: 'Script loaded: 1 284 actions' },
    { id: 'p2', kind: 'ok', message: 'Saved video.funscript' },
    { id: 'p3', kind: 'warn', message: 'Video is VFR — frame snapping is approximate' },
    { id: 'p4', kind: 'bad', message: 'Tracker crashed', action: { label: 'Show log' } },
  ];
</script>

<div class="k-overlays-demo">
  <section>
    <h3 class="k-caps">Popover</h3>
    <div class="row">
      <Popover title="Loop settings">
        {#snippet trigger({ props })}<Button {...props} icon="loop">Loop settings</Button>{/snippet}
        <div class="form">
          <Switch bind:checked={loop.on} label="Loop playback" />
          <SegmentedControl label="Loop range" size="sm" bind:value={loop.mode} full
            options={[{ value: 'ab', label: 'A–B' }, { value: 'chapter', label: 'Chapter' }, { value: 'sel', label: 'Selection' }]} />
          <div class="pair">
            <label class="k-caps" for="loop-a">Start</label>
            <TextField id="loop-a" size="sm" full bind:value={loop.start} class="k-num" />
            <label class="k-caps" for="loop-b">End</label>
            <TextField id="loop-b" size="sm" full bind:value={loop.end} class="k-num" />
          </div>
          <Checkbox bind:checked={loop.snap} label="Snap loop ends to frames" />
        </div>
      </Popover>
      <IconButton icon="magnet" label="Snapping" variant="default" pressed={snapOpen}
        onclick={() => (snapOpen = !snapOpen)} aria-expanded={snapOpen} aria-controls="snap-pop" />
      <Popover bind:open={snapOpen} placement="bottom" label="Snapping" id="snap-pop">
        <SegmentedControl label="Snap to" size="sm" bind:value={snapTo}
          options={[{ value: 'frame', label: 'Frame' }, { value: 'beat', label: 'Beat' }, { value: 'off', label: 'Off' }]} />
      </Popover>
      <span class="k-hint">Loop: {loop.on ? loop.mode : 'off'} · snap {snapTo}</span>
    </div>
  </section>

  <section>
    <h3 class="k-caps">Dialog</h3>
    <div class="row">
      <Button onclick={() => (dlg.sm = true)}>Small</Button>
      <Button onclick={() => (dlg.md = true)}>Medium</Button>
      <Button onclick={() => (dlg.lg = true)}>Large</Button>
      <Button onclick={() => (dlg.long = true)}>Long body</Button>
      <Button onclick={() => (dlg.busy = true)}>Not dismissible</Button>
      <span class="k-hint">onclose: {lastClose || '—'}</span>
    </div>
    <div class="row">
      <Button variant="danger" onclick={() => ask('discard')}>confirm(): discard</Button>
      <Button onclick={() => ask('overwrite')}>confirm(): overwrite</Button>
      <span class="k-hint" data-testid="answer">answer: {answer || '—'}</span>
    </div>
  </section>

  <section>
    <h3 class="k-caps">Toasts</h3>
    <div class="row">
      <Button onclick={fire.info}>Info</Button>
      <Button onclick={fire.ok}>OK</Button>
      <Button onclick={fire.warn}>Warn</Button>
      <Button onclick={fire.bad}>Bad (persistent)</Button>
      <Button onclick={fire.neutral}>Neutral + action</Button>
      <Button onclick={burst}>Burst ×5</Button>
    </div>
  </section>

  <section>
    <h3 class="k-caps">Tooltips</h3>
    <div class="row">
      {#each ['top', 'right', 'bottom', 'left'] as p}
        <Button {@attach tooltip({ text: 'Placed ' + p, placement: p })}>{p}</Button>
      {/each}
      <span class="k-sep"></span>
      {#each ['top', 'right', 'bottom', 'left'] as p}
        <button type="button" class="chip" {@attach tooltip({ text: 'Toggle snapping', shortcut: 'S', placement: p })}>{p} + key</button>
      {/each}
      <span class="k-sep"></span>
      <IconButton icon="undo" label="Undo" shortcut="Ctrl+Z" />
      <IconButton icon="redo" label="Redo" shortcut="Ctrl+Shift+Z" />
      <button type="button" class="chip" {@attach tooltip('A longer tip wraps at 280px so a sentence about how the\nselected points snap to beats stays readable.')}>multi-line</button>
    </div>
    <div class="row edge">
      <IconButton icon="panel-left" label="Left edge, placed left (flips right)" {@attach tooltip({ text: 'Left edge, placed left (flips right)', placement: 'left' })} tip="" />
      <IconButton icon="arrow-up" label="Placed top near the edge" tip="" {@attach tooltip({ text: 'Placed top, shifted inside the viewport', placement: 'top' })} />
      <span class="grow"></span>
      <IconButton icon="arrow-up" label="Placed top near the right edge" tip="" {@attach tooltip({ text: 'Placed top, shifted inside the viewport', shortcut: 'Ctrl+K Ctrl+S', placement: 'top' })} />
      <IconButton icon="panel-right" label="Right edge, placed right (flips left)" tip="" {@attach tooltip({ text: 'Right edge, placed right (flips left)', placement: 'right' })} />
    </div>
  </section>

  <section>
    <h3 class="k-caps">Pinned open (static, for screenshots)</h3>
    <div class="pinned">
      <Dialog open modal={false} title="Overwrite video.funscript?" size="sm" class="pin-dialog"
        message="A backup is kept next to the file as video.funscript.bak."
        actions={[{ label: 'Cancel', value: 'cancel' }, { label: 'Overwrite', value: 'confirm', variant: 'primary' }]} />
      <ToastHost inline items={pinned} aria-label="Notifications preview" />
    </div>
  </section>
</div>

<Dialog bind:open={dlg.sm} title="Rename chapter" size="sm" onclose={closed}>
  <TextField value="Intro" label="Chapter name" full data-autofocus />
  {#snippet footer({ close })}
    <Button onclick={() => close('cancel')}>Cancel</Button>
    <Button variant="primary" onclick={() => close('rename')}>Rename</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={dlg.md} title="Export funscript" onclose={closed}>
  <div class="form">
    <TextField value="video.funscript" label="File name" full />
    <SegmentedControl label="Range" size="sm" value="all" full
      options={[{ value: 'all', label: 'Whole script' }, { value: 'sel', label: 'Selection' }, { value: 'loop', label: 'Loop region' }]} />
    <Checkbox checked label="Include metadata" />
    <Checkbox checked label="Round positions to integers" />
  </div>
  {#snippet footer({ close })}
    <Popover title="Advanced" placement="top-start">
      {#snippet trigger({ props })}<Button {...props} variant="ghost" iconRight="chevron-up">Advanced</Button>{/snippet}
      <Checkbox checked label="Write chapters" />
    </Popover>
    <span class="grow"></span>
    <Button onclick={() => close('cancel')}>Cancel</Button>
    <Button variant="primary" icon="export" onclick={() => close('export')}>Export</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={dlg.lg} title="Keyboard shortcuts" size="lg" onclose={closed}>
  <dl class="keys">
    {#each shortcuts as [what, keys]}<dt>{what}</dt><dd><Kbd {keys} /></dd>{/each}
  </dl>
  {#snippet footer({ close })}
    <Button variant="primary" onclick={() => close('done')}>Done</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={dlg.long} title="What's new in 0.4" onclose={closed}>
  {#each Array(14) as _, i}
    <p class="para">
      {i + 1}. The timeline now draws heat on the lane itself, and selection handles stay crisp at every zoom.
      Snapping respects variable frame rate sources, and the tracker reports its progress per chunk.
    </p>
  {/each}
  {#snippet footer({ close })}
    <Button onclick={() => close('later')}>Later</Button>
    <Button variant="primary" onclick={() => close('ok')}>Got it</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={dlg.busy} title="Rendering preview" size="sm" dismissible={false} onclose={closed}>
  <div class="form">
    <span class="k-hint">Escape and the backdrop do nothing here.</span>
    <ProgressBar value={0.42} label="Rendering" showValue />
  </div>
  {#snippet footer({ close })}
    <Button onclick={() => close('cancel')}>Cancel render</Button>
  {/snippet}
</Dialog>

<ToastHost />

<style>
  .k-overlays-demo { padding: var(--space-6); display: flex; flex-direction: column; gap: var(--space-7); }
  section { display: flex; flex-direction: column; gap: var(--space-4); }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--gap); }
  .edge { margin-inline: calc(var(--space-3) - var(--space-6)); }
  .grow { flex: 1; }
  .form { display: flex; flex-direction: column; gap: var(--space-5); min-width: 16rem; }
  .pair { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: var(--space-3) var(--space-4); }
  .chip {
    display: inline-flex; align-items: center; height: var(--ctl-h); padding: 0 var(--pad-x);
    border: var(--bw) dashed var(--line-3); border-radius: var(--radius); background: none; color: var(--tx-mut); font: var(--fs-2) var(--font);
  }
  .chip:focus-visible { outline: var(--ring-w) solid var(--focus); outline-offset: var(--ring-offset); }
  .pinned { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--space-7); }
  .pinned :global(.pin-dialog) { position: static; margin: 0; }
  .keys { display: grid; grid-template-columns: 1fr auto; gap: var(--space-3) var(--space-7); margin: 0; }
  .keys dt { color: var(--tx); }
  .keys dd { margin: 0; text-align: right; }
  .para { margin: 0 0 var(--space-5); color: var(--tx); }
  .para:last-child { margin-bottom: 0; }
</style>
