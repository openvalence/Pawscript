<!--
  Transport: the one-row bar under the video, composed from the kit. <Transport {app} />
  Buttons run the registered command (rebinding and toasts apply) and fall back to the player; tooltips show the
  live binding. The row is a kit Toolbar (one tab stop, arrows rove for keyboard users), but a mouse press on a
  plain button does not take focus, so after clicking Play the arrow keys still step frames.
  Readouts sit in fixed ch widths, so nothing moves while values change; the row collapses with container
  queries (fps, frame count, start/end, total time go first). Height follows the density (--ctl-h).
  focusTimeField(text?) in transport.js (or the exported focusTime) opens the time field for typing.
-->
<script>
  import { tick } from 'svelte';
  import { IconButton, Button, Select, Menu, TextField, NumberField, Slider, Badge, Toolbar, tooltip, float } from '../../ui/kit/index.js';
  import { RATES, STEPPED_BELOW, LETTERBOX as LB, LETTERBOX_BLACK } from './player.svelte.js';
  import { fmtTime, fmtMs } from './frames.js';
  import { rotateView } from './view.js';
  import { TIME_FMTS, nextFmt, fmtNum, fmtRate, fmtFps, loopInfo, resolveTime, setTimeFieldHook } from './transport.js';
  import { lookKey, lookOf } from './posbar.js';
  import { peekTracking } from '../tracking/tracking.svelte.js';
  import { metaOf } from '../../app/settings.svelte.js';

  let { app } = $props();
  const p = $derived(app.player);

  // ---- commands: run the registered one when it exists, else the player directly ----
  const has = (id) => !!app.commands?.get?.(id);
  const keyOf = (id) => app.commands?.keysFor?.(id)?.[0] || '';
  const run = (id, fallback) => { if (has(id)) app.commands.run(id); else fallback?.(); };

  // ---- readouts ----
  const fmt = $derived(p.ui.timeFmt || 'ms');
  const fmtShort = $derived(TIME_FMTS.find((f) => f.id === fmt)?.short ?? fmt);
  const clock = $derived((p.frameMs, p.frameCount, p.durationMs, p.clock));   // clock is plain; these change with it
  const timeText = $derived(fmtTime(fmt, p.displayMs, clock));
  const totalText = $derived(fmt === 'frames' ? String(p.frameCount || p.last + 1) : fmtTime(fmt, p.durationMs, clock));
  const timeW = $derived(Math.max(totalText.length, fmtTime(fmt, 0, clock).length));
  const shownFrame = $derived(clock.frameAt(p.displayMs));
  const loop = $derived(loopInfo(p.loop, p.frameMs));
  const stepped = $derived(p.shuttle > 0 || p.rate < STEPPED_BELOW);

  const playTip = $derived(!p.playing ? 'Play' : p.shuttle < 0 ? `Pause (reverse ${fmtNum(-p.shuttle)}×)` : p.shuttle > 0 ? `Pause (frame by frame ${fmtNum(p.shuttle)}×)` : 'Pause');
  const posTip = $derived(`Position bar over the video: click ${p.ui.posBar ? 'hides' : 'shows'} it · double-click puts it back in its default place`);
  // paw-4c48.8: the bar on the shaft: its mode (settings) and whether the shot under the playhead reads a shaft (the tracking store)
  const lk = $derived(lookKey(app.doc.media?.path));
  const shaftOn = $derived((app.settings.values, lk ? lookOf(app.settings.get(lk, null)).on : false));
  const railWhy = $derived.by(() => { const R = peekTracking(app)?.railFor?.(p.displayMs); return R?.ctx?.G ? '' : R?.ctx?.why || R?.why || 'no shaft read in this shot'; });
  const shaftTip = $derived(shaftOn ? `Position bar on the shaft: on (click: back to where you placed it)${railWhy ? ` · ${railWhy}: the bar stays where you placed it` : ''}` : `Position bar on the shaft: lay it along the tracked shaft, 0 at the hilt, 100 at the tip, with the measured entry on it${railWhy ? ` · ${railWhy}` : ''}`);
  const loopTip = $derived(loop ? `Loop on: ${fmtMs(p.loop.t0)} – ${fmtMs(p.loop.t1)}\n${loop.frames} frames · ${Math.round(loop.ms)} ms\nClick to turn off` : 'Loop playback (the loop under the playhead, or the I/O range)');

  // a mouse press on a plain button keeps focus where it was (arrows keep stepping frames); keyboard focus is unchanged
  function keepFocus(e) { if (e.target.closest?.('button:not([aria-haspopup]):not([role=combobox])')) e.preventDefault(); }

  // ---- time field (kit TextField): shows the clock; focus = edit ----
  let editing = $state(false), text = $state(''), bad = $state(false), timeEl = $state(), badT = 0;
  export function focusTime(prefill) {
    text = prefill ?? fmtTime(fmt, p.timeMs, clock);
    editing = true; bad = false;
    tick().then(() => { timeEl?.focus(); if (prefill == null) timeEl?.select(); else timeEl?.setSelectionRange(text.length, text.length); });
  }
  $effect(() => setTimeFieldHook(focusTime));
  function onTimeFocus() { if (!editing) { text = timeText; editing = true; } }
  // TextField owns onfocus / onblur on its input, so listen natively. Focus selects all; the click that focused
  // the field must not then drop a caret into it (its mouseup is swallowed).
  const focusWatch = (node) => {
    let byMouse = false;
    const down = () => { byMouse = document.activeElement !== node; };
    const focus = () => { onTimeFocus(); node.select(); };
    const up = (e) => { if (byMouse) { e.preventDefault(); byMouse = false; } };
    const blur = () => { editing = false; bad = false; };
    const L = [['mousedown', down], ['focus', focus], ['mouseup', up], ['blur', blur]];
    for (const [t, f] of L) node.addEventListener(t, f);
    return () => { for (const [t, f] of L) node.removeEventListener(t, f); };
  };
  function commit() {
    // in frame format a bare number is a frame
    const t = fmt === 'frames' && /^\s*[+-]?\s*\d+\s*$/.test(text) ? text.trim() + 'f' : text;
    const r = resolveTime(t, { timeMs: p.timeMs, frame: p.frame, fps: p.fps, durationMs: p.durationMs, last: p.last });
    if (!r) { bad = false; requestAnimationFrame(() => (bad = true)); clearTimeout(badT); badT = setTimeout(() => (bad = false), 900); return; }
    if (r.frame != null) p.seekFrame(r.frame); else p.seek(r.ms);
    timeEl?.blur();
  }
  function timeKey(e) {
    e.stopPropagation();   // the field owns its keys (Esc must not also clear the selection)
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); timeEl?.blur(); }
  }
  // the frame field: Esc with nothing typed leaves the field instead of clearing the editor's selection
  function frameKey(e) { if (e.key === 'Escape') { e.stopPropagation(); e.currentTarget.blur(); } }

  // ---- speed (kit Select) ----
  const rateOpt = (r) => ({ value: r, label: fmtNum(r) + '×', hint: r < STEPPED_BELOW ? 'steps' : '' });
  const speedOptions = [
    { label: 'Speed', options: [...RATES].reverse().filter((r) => r >= STEPPED_BELOW).map(rateOpt) },
    { label: 'Frame by frame', options: [...RATES].reverse().filter((r) => r < STEPPED_BELOW).map(rateOpt) },
  ];
  const speedValue = $derived(p.shuttle || !RATES.includes(p.rate) ? null : p.rate);

  // ---- volume: slider pops up on hover / focus ----
  let volOpen = $state(false), volBtn = $state(), volPop = $state(), volT = 0;
  const volShow = () => { clearTimeout(volT); if (p.hasAudio) volOpen = true; };
  const volHide = (ms = 220) => { clearTimeout(volT); volT = setTimeout(() => (volOpen = false), ms); };
  $effect(() => { if (!volOpen || !volPop || !volBtn) return; const f = float(volPop, volBtn, { placement: 'top', offset: 6 }); return () => f.destroy(); });
  const volPct = $derived(Math.round((p.muted ? 0 : p.volume) * 100));
  const volTip = $derived(volOpen ? '' : p.hasAudio ? `${p.muted ? 'Unmute' : 'Mute'} · volume ${volPct}%` : 'No audio track');
  function volWheel(e) { if (!p.hasAudio) return; e.preventDefault(); p.setVolume(p.volume - Math.sign(e.deltaY) * 0.05); }

  // ---- view and more menus (kit Menu) ----
  let viewOpen = $state(false), moreOpen = $state(false), viewBtn = $state(), moreBtn = $state(), colorEl = $state();
  const v = $derived(p.view);
  const zoomLabel = $derived(v.mode === 'fit' ? 'Fit' : v.mode === 'fill' ? 'Fill' : v.mode === '1:1' ? '100%' : Math.round(v.zoom * 100) + '%');
  const viewOn = $derived(v.mode !== 'fit' || !!v.rot || v.flipH || v.flipV);
  const setView = (patch) => (p.view = { ...p.view, ...patch });
  const lb = $derived(p.ui.letterbox || LETTERBOX_BLACK);
  const radio = (label, checked, runFn, shortcut) => ({ label, type: 'radio', checked, run: runFn, shortcut });
  const TRAILS = metaOf('tracking.trails').options;   // a run's overlay on the video (paw-57dw: was the Tracker panel's Trails row)
  const trails = $derived(app.settings?.get?.('tracking.trails') ?? 'groups');
  const viewItems = $derived([
    { section: 'Zoom' },
    radio('Fit', v.mode === 'fit', () => run('video.fit', () => setView({ mode: 'fit', panX: 0, panY: 0 })), keyOf('video.fit')),
    radio('Fill', v.mode === 'fill', () => run('video.fill', () => setView({ mode: 'fill', panX: 0, panY: 0 })), keyOf('video.fill')),
    radio('100% (pixel exact)', v.mode === '1:1', () => run('video.zoom100', () => setView({ mode: '1:1', panX: 0, panY: 0 })), keyOf('video.zoom100')),
    radio('200%', v.mode === 'custom' && Math.abs(v.zoom - 2) < 1e-6, () => setView({ mode: 'custom', zoom: 2, panX: 0, panY: 0 })),
    ...(v.mode === 'custom' && Math.abs(v.zoom - 2) > 1e-6 ? [radio(`Custom ${Math.round(v.zoom * 100)}% (wheel)`, true, () => {})] : []),
    { separator: true },
    { label: 'Orientation', icon: 'refresh', items: [
      { label: 'Rotate left', icon: 'undo', shortcut: keyOf('video.rotateLeft'), run: () => run('video.rotateLeft', () => (p.view = rotateView(p.view, -1))) },
      { label: 'Rotate right', icon: 'redo', shortcut: keyOf('video.rotateRight'), run: () => run('video.rotateRight', () => (p.view = rotateView(p.view, 1))) },
      { separator: true },
      { label: 'Flip horizontal', icon: 'flip-h', type: 'checkbox', checked: v.flipH, shortcut: keyOf('video.flipH'), run: () => run('video.flipH', () => setView({ flipH: !v.flipH })) },
      { label: 'Flip vertical', icon: 'flip', type: 'checkbox', checked: v.flipV, shortcut: keyOf('video.flipV'), run: () => run('video.flipV', () => setView({ flipV: !v.flipV })) },
    ] },
    { label: 'Guides', icon: 'grid', items: [['off', 'Off'], ['thirds', 'Rule of thirds'], ['safe', 'Safe areas'], ['both', 'Thirds + safe areas']]
      .map(([g, l]) => radio(l, (p.ui.guides || 'off') === g, () => p.setUi({ guides: g }))) },
    { label: 'Letterbox', icon: 'contrast', items: [
      ...LB.map(([l, c]) => radio(l, lb === c, () => p.setUi({ letterbox: c }))),
      radio('Custom colour…', !LB.some(([, c]) => c === lb), () => (colorEl?.showPicker ? colorEl.showPicker() : colorEl?.click())),
    ] },
    { separator: true },
    { label: 'On-video readouts', icon: 'eye', type: 'checkbox', checked: p.ui.hud !== false, shortcut: keyOf('video.hud'), run: () => run('video.hud', () => p.setUi({ hud: p.ui.hud === false })) },
    ...(app.settings?.set ? [{ label: 'Trails', icon: 'heatmap', tip: 'What a tracker run draws over the video', items: TRAILS.map((o) => radio(o.label, trails === o.value, () => app.settings.set('tracking.trails', o.value))) }] : []),
  ]);
  // ---- proxy (paw-nydn): play the original or a proxy of it; make one at a size (the status bar shows the progress) ----
  let proxyOpen = $state(false), proxyBtn = $state();
  const canProxy = $derived(!!app.doc.media?.path && !!app.backend?.transcodePreview);
  const pj = $derived(p.proxyJob);
  const proxyLabel = $derived(pj ? `${Math.round(pj.fraction * 100)}%` : p.proxyH ? `${p.proxyH}p` : 'Original');
  const proxyTip = $derived(`${p.proxyH ? `Playing a ${p.proxyH}p proxy of the video` : 'Playing the original video'}${pj ? ` · making the ${pj.h}p proxy (${Math.round(pj.fraction * 100)} %)` : ''}`
    + `${p.proxyLost && !p.proxyH ? ` · the ${p.proxyLost}p proxy you chose is no longer in the cache: make it again here` : ''}\nProxy: a light H.264 copy for smoother playback and scrubbing, every frame at its own time. Tracking always reads the original.`);
  const proxyItems = $derived.by(() => {
    const sizes = p.proxySizes, made = sizes.filter((h) => p.proxies[h]), H = app.doc.media?.height;
    return [
      { section: 'Play' },
      radio(`Original${H ? ` (${H}p)` : ''}`, !p.proxyH, () => p.useProxy(0)),
      ...made.map((h) => radio(`Proxy ${h}p`, p.proxyH === h, () => p.useProxy(h))),
      { separator: true },
      { section: 'Make a proxy' },
      ...sizes.filter((h) => !p.proxies[h]).map((h) => pj?.h === h
        ? { label: `Making the ${h}p proxy… ${Math.round(pj.fraction * 100)} %`, icon: 'film', disabled: true }
        : { label: `${h}p${p.proxyLost === h ? ' (again: gone from the cache)' : ''}`, icon: 'film', tip: 'Made in the background, kept in the media cache', run: () => p.makeProxy(h) }),
      ...(pj ? [{ label: `Cancel the ${pj.h}p proxy`, icon: 'close', run: () => p.cancelProxy() }] : []),
    ];
  });

  const moreItems = $derived([
    { label: 'Go to time or frame…', icon: 'clock', shortcut: keyOf('video.goto'), run: () => focusTime() },
    { label: 'Go to start', icon: 'skip-back', shortcut: keyOf('player.start'), run: () => run('player.start', () => p.seek(0)) },
    { label: 'Go to end', icon: 'skip-forward', shortcut: keyOf('player.end'), run: () => run('player.end', () => p.seek(p.durationMs)) },
    { label: 'Play around playhead', icon: 'play', shortcut: keyOf('video.playAround'), disabled: !p.hasVideo, run: () => run('video.playAround', () => p.playAround()) },
    { separator: true },
    { label: 'Copy frame', icon: 'copy', disabled: !p.hasVideo, shortcut: keyOf('video.copyFrame'), run: () => run('video.copyFrame', () => p.copyFrame()) },
    { label: 'Save frame as PNG', icon: 'image', disabled: !p.hasVideo, shortcut: keyOf('video.saveFrame'), run: () => run('video.saveFrame', () => p.saveFrame()) },
    { separator: true },
    { label: 'Time format', icon: 'clock', items: TIME_FMTS.map((f) => radio(`${f.label}   ${fmtTime(f.id, p.timeMs, clock)}`, fmt === f.id, () => p.setUi({ timeFmt: f.id }))) },
  ]);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions (mousedown only keeps focus where it was) -->
<div class="tx" onmousedown={keepFocus}>
  <Toolbar label="Transport" class="row">
    <IconButton size="sm" icon="skip-back" label="Go to start" shortcut={keyOf('player.start')} class="wide-only" data-command="player.start" onclick={() => run('player.start', () => p.seek(0))} />
    <IconButton size="sm" icon="step-back" label="Previous frame" shortcut={keyOf('player.stepBack')} data-command="player.stepBack" onclick={() => run('player.stepBack', () => p.step(-1))} />
    <IconButton size="sm" icon={p.playing ? 'pause' : 'play'} label={playTip} shortcut={keyOf('player.toggle')} variant="primary" class="play"
      data-dir={p.playing && p.shuttle < 0 ? 'rev' : p.playing && stepped ? 'step' : undefined} data-command="player.toggle" onclick={() => run('player.toggle', () => p.toggle())} />
    <IconButton size="sm" icon="step-forward" label="Next frame" shortcut={keyOf('player.stepFwd')} data-command="player.stepFwd" onclick={() => run('player.stepFwd', () => p.step(1))} />
    <IconButton size="sm" icon="skip-forward" label="Go to end" shortcut={keyOf('player.end')} class="wide-only" data-command="player.end" onclick={() => run('player.end', () => p.seek(p.durationMs))} />
    <span class="k-sep"></span>
    <IconButton size="sm" icon="loop" label="Loop playback" tip={loopTip} shortcut={keyOf('loop.playToggle')} pressed={!!p.loop}
      data-command="loop.playToggle" onclick={() => (p.loop ? p.setLoop(null) : run('loop.playToggle'))} />
    <Select label="Playback speed" size="sm" class="speed" options={speedOptions} value={speedValue} placeholder={fmtRate(p.rate, p.shuttle)}
      onchange={(r) => p.setRate(r)} />
    <span class="k-sep"></span>

    <Button variant="ghost" size="sm" class="fmt k-num" tip="Time format (click to cycle)" shortcut={keyOf('video.timeFormat')}
      aria-label="Time format {fmtShort}, click to cycle" data-command="video.timeFormat" onclick={() => run('video.timeFormat', () => p.setUi({ timeFmt: nextFmt(fmt) }))}>{fmtShort}</Button>
    <span class="clock">
      <TextField size="sm" class="tx-time k-num {bad ? 'shake' : ''}" label="Current time: type a time or frame to go there" bind:inputEl={timeEl} invalid={bad}
        value={editing ? text : timeText} oninput={(t) => (text = t)} style="--w: {timeW}ch"
        onkeydown={timeKey} {@attach focusWatch}
        {@attach tooltip({ text: editing ? '1:23.456 · 83.4s · 1200ms\n#120 or 120f = frame · hh:mm:ss:ff\n+10f / -2s = relative · Enter go · Esc cancel' : 'Go to time or frame: click and type', shortcut: keyOf('video.goto'), placement: 'top' })} />
      <span class="total k-num narrow-hide" style:--w="{timeW + 2}ch">/ {totalText}</span>
    </span>

    <span class="k-sep tiny-hide"></span>
    <span class="frames tiny-hide">
      <span class="lbl k-num" {@attach tooltip(p.exact ? 'Frame on screen: type, drag sideways or ↑ / ↓ to move' : 'Frame numbers are estimated (variable or unknown frame rate)')}>{p.exact ? 'f' : 'f~'}</span>
      <NumberField size="sm" label="Frame" value={shownFrame} min={0} max={p.last} step={1} class="frame"
        unit={p.frameCount ? `/ ${p.frameCount}` : ''} onchange={(k) => p.seekFrame(k)} onkeydown={frameKey} />
    </span>
    <span class="fps k-num wide-hide" {@attach tooltip(p.isVfr ? 'Variable frame rate, average shown' : 'Frame rate')}>
      <span class="num">{fmtFps(p.fps)}</span><span class="lbl">fps</span>
      <span class="vfr" class:show={p.isVfr}><Badge tone="warn" variant="outline">VFR</Badge></span>
    </span>

    <span class="grow"></span>

    <!-- svelte-ignore a11y_no_static_element_interactions (hover reveals the slider; the button and slider are the controls) -->
    <span class="vol" onpointerenter={volShow} onpointerleave={() => volHide()} onfocusin={volShow} onfocusout={() => volHide(0)} bind:this={volBtn}>
      <IconButton size="sm" icon={p.muted || p.volume === 0 || !p.hasAudio ? 'mute' : 'volume'} label={p.muted ? 'Unmute' : 'Mute'} tip={volTip}
        shortcut={keyOf('video.mute')} pressed={p.muted} disabled={!p.hasAudio} data-command="video.mute" onclick={() => run('video.mute', () => p.toggleMute())} onwheel={volWheel} />
      {#if volOpen}
        <div bind:this={volPop} class="k-pop volpop" role="presentation" onpointerenter={volShow} onpointerleave={() => volHide()}>
          <Slider label="Volume" size="sm" min={0} max={1} step={0.01} value={p.muted ? 0 : p.volume} showValue
            format={(x) => String(Math.round(x * 100))} onchange={(x) => p.setVolume(x)} />
        </div>
      {/if}
    </span>

    <span bind:this={viewBtn} class="menu-anchor">
      <Button size="sm" variant="ghost" icon="zoom-fit" class="view {viewOn ? 'on' : ''}" tip="View: zoom, orientation, guides, letterbox, trails"
        aria-haspopup="menu" aria-expanded={viewOpen} onclick={() => (viewOpen = !viewOpen)}><span class="k-num zl">{zoomLabel}</span></Button>
    </span>
    <Menu bind:open={viewOpen} anchor={viewBtn?.firstElementChild} placement="top-end" label="View" items={viewItems} />

    {#if canProxy}
      <span bind:this={proxyBtn} class="menu-anchor">
        <Button size="sm" variant="ghost" icon="film" class="proxy {p.proxyH ? 'on' : ''} {pj ? 'busy' : ''} {p.proxyLost && !p.proxyH ? 'lost' : ''}" tip={proxyTip} data-testid="proxy-menu"
          aria-label="Proxy: {proxyLabel}" aria-haspopup="menu" aria-expanded={proxyOpen} onclick={() => (proxyOpen = !proxyOpen)}><span class="k-num pl {p.proxyH || pj ? '' : 'wide-hide'}">{proxyLabel}</span></Button>
      </span>
      <Menu bind:open={proxyOpen} anchor={proxyBtn?.firstElementChild} placement="top-end" label="Proxy" items={proxyItems} />
    {/if}

    <IconButton size="sm" icon="ruler" class="sim" label="Position bar" tip={posTip} shortcut={keyOf('video.posBar')} pressed={!!p.ui.posBar}
      data-command="video.posBar" onclick={() => run('video.posBar', () => p.setUi({ posBar: !p.ui.posBar }))} ondblclick={() => run('video.posBarReset')} />
    <IconButton size="sm" icon="magnet" class="sim" label="Position bar on the shaft" tip={shaftTip} shortcut={keyOf('video.posBarShaft')} pressed={shaftOn && !!p.ui.posBar} data-testid="posbar-shaft-toggle"
      data-command="video.posBarShaft" onclick={() => run('video.posBarShaft')} ondblclick={() => run('video.posBarReset')} />
    <IconButton size="sm" icon="move" class="sim" label="Six-axis view" tip="Six-axis preview over the video (double-click resets it)" shortcut={keyOf('video.sr6')} pressed={!!p.ui.sr6}
      data-command="video.sr6" onclick={() => run('video.sr6', () => p.setUi({ sr6: !p.ui.sr6 }))} ondblclick={() => run('video.sr6Reset')} />
    <IconButton size="sm" icon="stroke" class="sim" label="Device simulator" shortcut={keyOf('video.sim')} pressed={!!p.ui.sim} data-command="video.sim" onclick={() => run('video.sim', () => p.setUi({ sim: !p.ui.sim }))} />
    <span bind:this={moreBtn} class="menu-anchor">
      <IconButton size="sm" icon="more-v" label="More" tip="More: frames, time format" aria-haspopup="menu" aria-expanded={moreOpen} onclick={() => (moreOpen = !moreOpen)} />
    </span>
    <Menu bind:open={moreOpen} anchor={moreBtn?.firstElementChild} placement="top-end" label="More" items={moreItems} />
  </Toolbar>
  <!-- the letterbox "Custom colour…" picker (opened from the view menu) -->
  <input bind:this={colorEl} class="k-sr" type="color" tabindex="-1" aria-hidden="true" value={lb.startsWith('#') ? lb : LETTERBOX_BLACK}
    oninput={(e) => p.setUi({ letterbox: e.currentTarget.value })} />
</div>

<style>
  .tx {
    container-type: inline-size;
    flex: none;
    padding: var(--space-2) var(--space-3);
    background: var(--bg-raised);
    border-top: var(--bw) solid var(--line-1);
    color: var(--tx);
    user-select: none;
  }
  /* paw-ec2a: clip, not hidden: a hidden overflow still scrolls to a focused control at the right, cutting off the first button */
  .tx :global(.row) { overflow: clip; }
  .tx :global(.row > *) { flex: none; }
  .grow { flex: 1 1 0; min-width: var(--space-4); }
  .menu-anchor, .vol, .clock, .frames { display: inline-flex; align-items: center; }

  /* play: the kit primary button; reverse shuttle adds a left notch, frame-by-frame a dotted underline */
  .tx :global(.play) { position: relative; }
  .tx :global(.play[data-dir='rev'])::after { content: ''; position: absolute; left: 3px; bottom: 3px; border: 3px solid transparent; border-right: 4px solid currentColor; border-left: 0; }
  .tx :global(.play[data-dir='step'])::after { content: ''; position: absolute; left: 25%; right: 25%; bottom: 3px; height: 2px; background: repeating-linear-gradient(90deg, currentColor 0 2px, transparent 2px 4px); }

  .tx :global(.speed) { margin-left: var(--space-2); }

  /* time */
  .tx :global(.fmt) { padding: 0 var(--space-2); min-width: 0; color: var(--tx-mut); font-size: var(--fs-1); text-transform: uppercase; }
  .tx :global(.tx-time) { width: auto; margin-left: var(--space-1); }
  .tx :global(.tx-time input) { flex: none; width: calc(var(--w) + 1px); text-align: right; color: var(--tx-hi); font-size: var(--fs-4); }
  .tx :global(.tx-time input:focus) { text-align: left; }
  .tx :global(.tx-time.shake) { animation: shake var(--t-slow) var(--ease-out); }
  .tx :global(.tx-time input[aria-invalid='true']) { color: var(--bad-ink); }
  @keyframes shake { 20% { translate: -4px 0; } 40% { translate: 4px 0; } 60% { translate: -3px 0; } 80% { translate: 2px 0; } }
  .total { min-width: var(--w); padding-left: var(--space-3); color: var(--tx-mut); font-size: var(--fs-2); white-space: nowrap; }

  .frames { gap: var(--space-2); }
  .tx :global(.frame input) { text-align: right; }
  .lbl { color: var(--tx-mut); font-size: var(--fs-2); }
  .frames > .lbl { min-width: 2ch; text-align: right; }   /* 'f' and 'f~' take the same room */
  .fps { display: inline-flex; align-items: center; gap: .5ch; margin-left: var(--space-5); font-size: var(--fs-2); white-space: nowrap; }
  .fps .num { min-width: 6ch; text-align: right; color: var(--tx-val); }
  .vfr { visibility: hidden; margin-left: var(--space-2); }
  .vfr.show { visibility: visible; }

  .tx :global(.view) { padding: 0 var(--space-3); }
  .tx :global(.view.on) { color: var(--accent-ink); }
  .zl { display: inline-block; min-width: 5ch; text-align: left; font-size: var(--fs-2); }
  .tx :global(.proxy) { padding: 0 var(--space-3); color: var(--tx-mut); }
  .tx :global(.proxy.on) { color: var(--accent-ink); }
  .tx :global(.proxy.busy) { color: var(--intent); }
  .tx :global(.proxy.lost) { color: var(--warn-ink); }
  .pl { font-size: var(--fs-2); }
  .volpop { min-width: 0; padding: var(--space-3) var(--space-4); }

  /* priority, last to go: time > frame > total time > start/end buttons > frame count > fps. paw-ec2a: each step starts where
     what is left still fits (they overflowed by up to 88 px between the old steps: the 900 x 600 window's Refine, 1100 x 700's
     Track). Re-measured with every control at sm (paw-hdxk), a 1 px sweep of the real row: each state's least width 842, 794,
     711, 566 px with the 12 px padding (dev/transport-fit-check.mjs) */
  @container (max-width: 1080px) { .tx :global(.wide-hide) { display: none; } }
  @container (max-width: 829px) { .tx :global(.wide-only) { display: none; } }
  @container (max-width: 781px) { .tx :global(.narrow-hide) { display: none; } }
  @container (max-width: 698px) { .tx :global(.tiny-hide), .tx :global(.fmt) { display: none; } }
  @container (max-width: 553px) { .tx :global(.row > .k-sep), .zl { display: none; } }
  @container (max-width: 505px) { .tx :global(.speed), .tx :global(.sim) { display: none; } }
</style>
