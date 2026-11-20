<script module>
  // Which loop's options are open (null = closed). Set by the lane (double-click) and the loops.open command (Enter).
  export const loopPop = $state({ id: null });
</script>

<script>
  // Loop options, anchored on the loop's block in the lane (kit Popover: Esc / outside press closes, focus returns).
  import Popover from '../../ui/kit/Popover.svelte';
  import Button from '../../ui/kit/Button.svelte';
  import Checkbox from '../../ui/kit/Checkbox.svelte';
  import Switch from '../../ui/kit/Switch.svelte';
  import NumberField from '../../ui/kit/NumberField.svelte';
  import Kbd from '../../ui/kit/Kbd.svelte';
  import { fmtMs } from '../../lib/video.js';
  import { tl, scenesOf, durOf } from './state.svelte.js';
  import * as L from './loops.js';
  import * as A from './loop-actions.js';
  import { trackingOf } from './deps.js';
  import { repeatsOf } from './repeats.svelte.js';
  import { loopStates } from '../../lib/loop-average.js';

  let { app, anchor } = $props();

  const loop = $derived(A.getLoop(app, loopPop.id));
  const fm = $derived(A.fmOf(app));
  const info = $derived(loop ? L.loopInfo(loop, fm) : null);
  const P = $derived(loop ? L.periodOf(loop, fm) : 0);
  const script = $derived(loop ? A.scriptOf(app, loop) : []);
  const tiled = $derived(!!loop && L.isTiled(loop));
  const reps = $derived(tiled ? Math.round((loop.tiledTo - loop.t0) / P * 10) / 10 : 0);
  const stale = $derived(!!loop && L.needsRetile(script, loop, P));
  const warn = $derived(loop ? L.seamWarning(L.cycleOf(script, loop, P), P) : null);
  const points = $derived(loop ? L.cycleOf(script, loop, P).length : 0);
  const sug = $derived(loop ? A.detectedFor(app, loop) : null);
  const sugP = $derived(sug ? L.sugPeriod(sug, fm) : 0);
  const sugDiff = $derived(!!sug && Math.abs(sugP - P) > 0.5);
  const target = $derived(loop ? L.tileTarget(loop, { range: app.doc.range, scenes: scenesOf(app), loops: app.doc.loops, dur: durOf(app) }) : null);
  const vary = $derived(loop?.variation ?? null);
  const looping = $derived(!!loop && A.isLooping(app, loop));
  // paw-ef73.5: averaging the passes on the tracker run over the loop (the selected one if it covers it)
  const avg = $derived.by(() => {
    const tr = trackingOf(app), runs = (tr?.runs || []).filter((r) => !r.ref && r.range), sel = tr?.selected;
    if (!loop || !runs.length) return null;
    const ix = repeatsOf(app);
    for (const r of sel && runs.includes(sel) ? [sel, ...runs] : runs) { const s = loopStates(r, [loop], ix, fm)[0]; if (s) return s; }
    return null;
  });

  // variation fields: edited locally, committed as one option change
  let amp = $state(8), timeMs = $state(0), seed = $state(1);
  $effect(() => { if (vary) { amp = Math.round((vary.amp ?? 0.08) * 100); timeMs = vary.timeMs ?? 0; seed = vary.seed ?? 1; } });
  const setVary = (on) => A.setOptions(app, loop.id, { variation: on ? { amp: amp / 100, timeMs, seed } : null });
  const commitVary = () => { if (vary) setVary(true); };

  const close = () => { loopPop.id = null; };
  const key = (id) => app.commands.keysFor?.(id)?.[0] ?? '';
  // 'Alt+ArrowLeft' + 'Alt+ArrowRight' -> 'Alt' (one cap group + arrows), else '' (show both chords)
  const pair = (a, b) => { const m = /^(.+)\+ArrowLeft$/.exec(a); return m && b === m[1] + '+ArrowRight' ? m[1] : ''; };
  const act = (fn) => () => { fn(app, loop.id); };
</script>

<Popover open={!!loop} {anchor} placement="bottom-start" label="Loop options" onclose={close} class="lp-pop">
  {#if loop}
  <div class="body">
    <div class="head">
      <span class="ttl">Loop</span>
      <span class="num big">{info.frames}<i>f</i></span>
      <span class="num">{P.toFixed(1)}<i>ms</i></span>
      {#if !info.exact}<span class="grow"></span><Button size="sm" variant="ghost" icon="warning" class="lp-warn" onclick={act(A.snapLoop)}
        tip="The cycle is not a whole number of frames, tiles would drift">Snap the loop to frames</Button>{/if}
    </div>

    <div class="grid">
      <span class="lbl">in</span>
      <Button size="sm" onclick={() => A.nudgeLoop(app, loop.id, 't0', -1)} shortcut={key('loops.inMinus')} aria-label="Loop in one frame earlier">−1f</Button>
      <span class="num t">{fmtMs(loop.t0)}</span>
      <Button size="sm" onclick={() => A.nudgeLoop(app, loop.id, 't0', 1)} shortcut={key('loops.inPlus')} aria-label="Loop in one frame later">+1f</Button>
      <span class="lbl">out</span>
      <Button size="sm" onclick={() => A.nudgeLoop(app, loop.id, 't1', -1)} shortcut={key('loops.outMinus')} aria-label="Loop out one frame earlier">−1f</Button>
      <span class="num t">{fmtMs(loop.t1)}</span>
      <Button size="sm" onclick={() => A.nudgeLoop(app, loop.id, 't1', 1)} shortcut={key('loops.outPlus')} aria-label="Loop out one frame later">+1f</Button>
    </div>
    {#if key('loops.outPlus')}
      <div class="hint">±1 frame
        {#each [['out', 'loops.outMinus', 'loops.outPlus'], ['in', 'loops.inMinus', 'loops.inPlus']] as [what, minus, plus] (what)}
          {@const mod = pair(key(minus), key(plus))}
          {#if key(plus)}<span class="gap">{what}</span>{#if mod}<Kbd keys={mod} /><span>+ ← →</span>{:else}<Kbd keys={key(minus)} /><Kbd keys={key(plus)} />{/if}{/if}
        {/each}
      </div>
    {/if}

    {#if sug}
      <div class="row">
        <span class="muted">detected {sug.frames ? sug.frames + ' f' : ''} {sugP.toFixed(1)} ms · {sug.kind ?? 'motion'} {Math.round((sug.confidence ?? 0) * 100)}%</span>
        <Button size="sm" variant="ghost" disabled={!sugDiff} onclick={act(A.useDetected)}>{sugDiff ? 'Use' : 'in use'}</Button>
      </div>
    {/if}

    <div class="sep"></div>
    <div class="row">
      {#if tiled}
        <span class="muted">tiled <b class="num">×{reps}</b> to <b class="num">{fmtMs(loop.tiledTo)}</b>{#if loop.axis} · {loop.axis}{/if}</span>
      {:else}
        <span class="muted">{points < 2 ? 'script the cycle, then tile it' : 'not tiled'}</span>
      {/if}
    </div>
    {#if stale}<div class="note warn">The cycle changed since it was tiled.</div>{/if}
    {#if warn}<div class="note warn">Seam jumps {warn.dpos} in {Math.round(warn.dt)} ms ({Math.round(warn.speed)} pos/s, cycle peak {Math.round(warn.peak)}).</div>{/if}
    <div class="btns">
      <Button size="sm" variant={tiled ? 'default' : 'primary'} disabled={points < 2} onclick={act(A.tileLoop)} shortcut={key('loops.tile')}
        tip={target ? `Tile to the ${target.why} end (${fmtMs(target.end)})` : 'Tile: asks how far'}>Tile {target ? `to ${target.why}` : '…'}</Button>
      {#if tiled}
        <Button size="sm" variant={stale ? 'primary' : 'default'} shortcut={key('loops.retile')} onclick={act(A.retileLoop)}>Re-tile</Button>
        <Button size="sm" variant="ghost" onclick={act(A.removeTiles)}>Remove tiles</Button>
      {/if}
    </div>

    <div class="sep"></div>
    <Checkbox size="sm" checked={loop.join === 'meet'} onchange={(on) => A.setOptions(app, loop.id, { join: on ? 'meet' : undefined })}
      label="Close the join (last point meets the first)" />
    <div class="row">
      <Switch size="sm" checked={!!vary} onchange={setVary} label="Variation" />
      <span class="muted small">seeded, per repeat</span>
    </div>
    {#if vary}
      <div class="vary">
        <label>depth <NumberField size="sm" bind:value={amp} min={0} max={50} step={1} unit="%" oncommit={commitVary} /></label>
        <label>timing <NumberField size="sm" bind:value={timeMs} min={0} max={200} step={5} unit="ms" oncommit={commitVary} /></label>
        <label>seed <NumberField size="sm" bind:value={seed} min={0} max={99999} step={1} oncommit={commitVary} /></label>
      </div>
    {/if}

    {#if avg}
      <div class="row">
        <Switch size="sm" checked={avg.on} onchange={(on) => A.setLoopAvg(app, loop.id, on)} label="Average passes" />
        <span class="muted small" class:lp-warn={!avg.on && /differ/.test(avg.why)}>{avg.why}</span>
      </div>
    {/if}

    <div class="sep"></div>
    <div class="btns">
      <Button size="sm" variant="ghost" icon="loop" pressed={looping} shortcut={key('loop.playToggle')} onclick={act(A.togglePlayback)}>Loop playback</Button>
      <span class="grow"></span>
      <Button size="sm" variant="danger" icon="delete" shortcut={key('loops.delete')} onclick={() => { const id = loop.id; close(); A.deleteLoop(app, id); }}>Delete</Button>
    </div>
  </div>
  {/if}
</Popover>

<style>
  :global(.lp-pop) { width: 360px; padding: 8px 10px !important; font-size: var(--fs-2); color: var(--tx); }
  .body { display: grid; gap: 6px; }
  .head { display: flex; align-items: baseline; gap: 8px; }
  .ttl { font-size: var(--fs-1); text-transform: uppercase; letter-spacing: var(--caps-track); color: var(--tx-mut); margin-right: 2px; }
  .num { font-family: var(--mono); font-variant-numeric: tabular-nums; color: var(--tx-hi); font-weight: var(--num-wght); }
  .num i { font-style: normal; color: var(--tx-mut); margin-left: 2px; font-size: var(--fs-1); }
  .big { font-size: var(--fs-5); }
  .grid { display: grid; grid-template-columns: 28px 48px 1fr 48px; gap: 4px 6px; align-items: center; }
  .grid :global(.k-button) { width: 100%; }
  .hint { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; font-size: var(--fs-1); color: var(--tx-mut); }
  .hint .gap { margin-left: 8px; }
  .grid .t { text-align: center; }
  .lbl { color: var(--tx-mut); font-size: var(--fs-1); }
  .row { display: flex; align-items: center; gap: 8px; justify-content: space-between; min-height: var(--ctl-h-sm); }
  .muted { color: var(--tx-mut); }
  .muted b { color: var(--tx-hi); font-weight: 400; }
  .small { font-size: var(--fs-1); }
  .note { font-size: var(--fs-1); line-height: 1.35; }
  .warn { color: var(--warn-ink); }
  :global(.lp-warn) { color: var(--warn-ink) !important; }
  .sep { height: 1px; background: var(--line-1); margin: 2px -10px; }
  .btns { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .grow { flex: 1; }
  .vary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .vary label { display: grid; gap: 2px; font-size: var(--fs-1); color: var(--tx-mut); }
</style>
