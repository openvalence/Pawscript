<!-- DevicePanel: connect the embedded device server, pick a stroker, or connect a Valence hub, and tune how the script
     plays on it (offset, range, invert, profile, stroke window). Live: the commanded position and a 2 s stroke meter
     (plus the hub's reported position when a Valence hub reports one). -->
<script>
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { cmd } from '../../app/cmd.js';
  import { Button, Switch, NumberField, TextField, RangeSlider, Slider, Select, Field, Section, Badge, Kbd } from '../../ui/kit/index.js';
  import { playbackFor, rangeOf } from './playback.svelte.js';
  import Prop from '../../app/Prop.svelte';
  import { limitsMode, effectiveMaxSpeed } from '../../lib/analyze/profiles.js';

  let { app } = $props();
  const P = playbackFor(app);
  const S = app.settings;

  const prof = $derived((S.values, P.profile));
  const planner = $derived(limitsMode(prof) === 'planner');
  const strokeRange = $derived(prof.kinematics?.strokeRange ?? null);
  const range = $derived((S.values, rangeOf(S)));
  const offset = $derived((S.values, +S.get('playback.offsetMs', 0) || 0));
  const invert = $derived((S.values, !!S.get('playback.invert', false)));
  const scrub = $derived((S.values, S.get('playback.scrub', true) !== false));
  const profileOptions = $derived((S.values, P.profiles.map((p) => ({ value: p.id, label: p.name }))));
  const statusText = $derived(P.status === 'starting' ? 'Starting…' : P.connected ? (P.scanning ? 'Scanning…' : `${P.devices.length} device${P.devices.length === 1 ? '' : 's'}`) : 'Not connected');
  const pct = (v) => (v == null ? '–' : Math.round(v * 100));
  const keys = (id) => app.commands?.keysFor?.(id)?.[0] ?? '';

  // Valence (RENDERING.md): only hub-sent values are shown, '–' otherwise (law 9); stale telemetry is dimmed (law 8);
  // SYNCING reads differently from LIVE (SPEC §2.2); each safety pair is ONE control (law 14); the stop control is
  // labelled from the hub's estop_cuts_power (law 15) and releases on a 3 s hold.
  const V = $derived(P.valence);
  const vHost = $derived((S.values, S.get('playback.valence.host', '')));
  const TIER = ['watch', 'control', 'configure'];
  const PHASE = { closed: 'Not connected', connecting: 'Connecting…', syncing: 'Syncing…', reconnecting: 'Reconnecting…', live: 'Live' };
  const mm = (v) => (v == null ? '–' : (Math.round(v * 10) / 10).toString());
  const RELEASE_HOLD_MS = 3000;
  let holdTimer = 0, holding = $state(false);
  function holdStart(e) {
    if (e.repeat || !V?.estop || holdTimer) return;
    holding = true;
    holdTimer = setTimeout(() => { holdTimer = 0; holding = false; P.valenceOp('release'); }, RELEASE_HOLD_MS);
  }
  function holdEnd() { clearTimeout(holdTimer); holdTimer = 0; holding = false; }
  function stopPress() { if (!V?.estop) P.valenceOp('estop'); }
</script>

<div class="pb kit-root">
  <div class="pb-body k-scroll">
    <Section title="Device">
      <div class="row">
        <Button size="sm" variant={P.connected ? 'default' : 'primary'} icon={P.connected ? 'unlink' : 'bluetooth'} disabled={P.status === 'starting'}
          onclick={() => P.toggleConnection()} tip={P.connected ? 'Stop every device and close the device server' : 'Start the device server and scan (Bluetooth, serial, HID)'}>
          {P.connected ? 'Disconnect' : 'Connect'}
        </Button>
        <Button size="sm" icon="refresh" {...cmd(app, 'playback.scan', undefined, { tip: 'Look for devices' })} pressed={undefined}>{P.scanning ? 'Stop scan' : 'Scan'}</Button>
        <span class="sp"></span>
        <span class="k-hint">{statusText}</span>
      </div>
      {#if P.error}<div class="err">{P.error}</div>{/if}
      {#if P.connected}
        <div class="list" role="listbox" aria-label="Devices">
          {#each P.devices as d (d.index)}
            <button type="button" role="option" class="dev" class:on={d.index === P.deviceIndex} aria-selected={d.index === P.deviceIndex}
              disabled={!d.linear.length} onclick={() => P.select(d.index)}>
              <span class="name">{d.name}</span>
              {#if d.linear.length}<Badge tone="ok">position</Badge>{:else}<Badge>{d.other.join(', ') || 'no outputs'}</Badge>{/if}
            </button>
          {:else}
            <div class="k-hint">{P.scanning ? 'Scanning… switch the device on.' : 'No devices. Scan with the device on.'} A device held by Intiface Central is not visible here: close Intiface first.</div>
          {/each}
        </div>
      {/if}
    </Section>

    <Section title="Valence hub">
      <div class="row">
        <!-- the settings themselves (app/Prop.svelte): reset, copy, paste and Show in Settings on right click -->
        <Prop {app} key="playback.valence.host" class="host" full placeholder="hub address" label="Valence hub address" disabled={!!V}
          store={(v) => String(v).trim()} onenter={() => P.connectValence()} />
        <Prop {app} key="playback.valence.port" class="port" full label="Valence hub port" scrub={false} disabled={!!V} store={(v) => Math.round(v)} />
        <Button size="sm" variant={V ? 'default' : 'primary'} icon={V ? 'unlink' : 'wifi'}
          {...cmd(app, 'playback.valence', undefined, { tip: V ? 'Disconnect from the hub' : 'Connect to the Valence hub (WebSocket)' })}>{V ? 'Disconnect' : 'Connect'}</Button>
      </div>
      {#if V}
        <div class="kv vkv">
          <span>Link</span><span class:warn={V.phase !== 'live'}>{PHASE[V.phase]}</span>
          <span>Hub</span><span class="clip">{V.hubName ?? '–'}{#if V.product} · {V.product} {V.fw ?? ''}{/if}</span>
          <span>Access</span><span>{V.roles == null ? '–' : TIER[V.roles] ?? V.roles}</span>
          <span>Position</span><span class="k-num" class:stale={V.stale}>{mm(V.positionMm)} {V.positionMm != null ? V.unit : ''}{#if V.position != null} · {pct(V.position)}%{/if}</span>
          <span>Window</span><span class="k-num">{V.window ? `${mm(V.window[0])}–${mm(V.window[1])} ${V.unit}` : '–'}</span>
          <span>Stream</span><span class="k-num">{V.rateHz ? `${Math.round(V.rateHz)} Hz · lead ${Math.round(V.latencyMs)} ms` : '–'}</span>
          {#if V.lastNack}<span>Refused</span><span class="clip" {@attach tooltip(V.lastNack.detail || '')}>{V.lastNack.name}{V.lastNack.detail ? `: ${V.lastNack.detail}` : ''}</span>{/if}
        </div>
        {#if V.why}<div class="k-hint">Not playing: {V.why}.</div>{/if}
        {#if V.phase === 'live' && V.roles === 0}
          <div class="row acts">
            <Button size="sm" icon="lock" onclick={() => P.pairValence()} tip="Ask the hub for control, approve it on the hub">Request control</Button>
          </div>
        {/if}
        {#if V.hasSafety}
          <div class="row acts">
            <Button size="sm" icon={V.paused ? 'play' : 'pause'} disabled={V.phase !== 'live' || (V.paused && (V.roles ?? 0) < 1)}
              onclick={() => P.valenceOp(V.paused ? 'resume' : 'pause')}
              tip={V.paused ? ((V.roles ?? 0) < 1 ? 'Resume needs control' : 'Resume the hub') : 'Pause the hub: it stops and holds'}>{V.paused ? 'Resume' : 'Pause'}</Button>
            <Button size="sm" variant="danger" icon="stop-circle" class={holding ? 'holding' : ''}
              onclick={stopPress} onpointerdown={holdStart} onpointerup={holdEnd} onpointerleave={holdEnd} onkeydown={(e) => (e.key === ' ' || e.key === 'Enter') && holdStart(e)} onkeyup={holdEnd}
              tip={V.estop ? `Halted: hold ${RELEASE_HOLD_MS / 1000} s to release into pause` : V.estopCutsPower ? 'E-Stop: cuts motor power' : 'Halt: stop as fast as possible'}>
              {V.estop ? (holding ? 'Releasing…' : 'Halted') : V.estopCutsPower ? 'E-Stop' : 'Halt'}
            </Button>
          </div>
        {/if}
      {/if}
      <div class="k-hint">pos 0 (deepest) plays at the window's 0 end; use Invert if your machine is mounted the other way.</div>
    </Section>

    <Section title="Playback">
      <div class="form">
        <Switch label="Play on device with the video" checked={P.enabled} disabled={!P.ready} onchange={(on) => P.setEnabled(on)} />
        <Switch label="Follow scrubbing while paused" checked={scrub} onchange={(on) => P.set('scrub', on)} />
        <Field inline label="Latency offset" hint="+ = the device moves later. Added to the profile's {prof.latencyMs || 0} ms.">
          {#snippet children({ id, describedby })}
            <NumberField {id} aria-describedby={describedby} full value={offset} min={-500} max={500} step={5} unit="ms" onchange={(v) => P.set('offsetMs', Math.round(v))} />
          {/snippet}
        </Field>
        <Field inline label="Range" hint="The share of the device's stroke the script uses.">
          {#snippet children({ id, describedby, labelledby })}
            <RangeSlider {id} aria-labelledby={labelledby} aria-describedby={describedby} full min={0} max={100} step={1} minGap={5} value={range} showValue format={(v) => `${v}%`} onchange={(v) => P.set('range', [Math.round(v[0]), Math.round(v[1])])} />
          {/snippet}
        </Field>
        <Switch label="Invert" checked={invert} onchange={(on) => P.set('invert', on)} />
      </div>
    </Section>

    <Section title="Profile">
      <div class="form">
        <Select full label="Device profile" options={profileOptions} value={prof.id} onchange={(v) => P.setProfile(v)} />
        {#if strokeRange}
          <Field inline label="Stroke window">
            {#snippet children({ id, describedby, labelledby })}
              <Slider {id} aria-labelledby={labelledby} aria-describedby={describedby} full min={strokeRange[0]} max={strokeRange[1]} step={5} value={prof.kinematics.strokeMm} showValue format={(v) => `${v} mm`} onchange={(v) => P.setStrokeMm(v)} />
            {/snippet}
          </Field>
        {/if}
        <div class="k-hint">
          {#if planner}The device's planner reshapes fast moves itself: speed is not limited here.
          {:else}Moves are held to <span class="k-num">{Math.round(effectiveMaxSpeed(prof))}</span> u/s and <span class="k-num">{prof.minIntervalMs}</span> ms between commands.{/if}
          Shared with Review (problems, machine preview).
        </div>
      </div>
    </Section>

    <Section title="Live">
      <div class="live">
        <div class="meter" aria-hidden="true">
          {#if P.meter[0] != null}<div class="band" style:bottom="{P.meter[0] * 100}%" style:height="{(P.meter[1] - P.meter[0]) * 100}%"></div>{/if}
          {#if P.pos != null}<div class="mark" style:bottom="{P.pos * 100}%"></div>{/if}
          {#if V?.position != null}<div class="actual" class:stale={V.stale} style:bottom="{V.position * 100}%" {@attach tooltip("hub's reported position")}></div>{/if}
        </div>
        <div class="kv">
          <span>Position</span><span class="k-num">{pct(P.pos)}%</span>
          <span>Stroke (2 s)</span><span class="k-num">{P.meter[0] == null ? '–' : `${pct(P.meter[0])}–${pct(P.meter[1])}%`}</span>
          <span>Lead</span><span class="k-num">{P.leadMs} ms</span>
          <span>Output</span><span class="clip">{P.outputName || '–'}</span>
          <span>State</span><span>{P.previewing ? 'previewing' : P.active ? (app.player.playing ? 'playing' : 'following') : P.ready ? 'off' : 'no device'}</span>
        </div>
      </div>
      <div class="row acts">
        <Button size="sm" icon="play" disabled={!P.ready || !P.previewSpan()} onclick={() => P.preview()} tip="Play the range or selection once on the device">Preview range</Button>
        <Button size="sm" variant="danger" icon="stop-circle" {...cmd(app, 'playback.panic', undefined, { tip: 'Stop the device and pause' })}>Stop</Button>
      </div>
      <div class="k-hint">{V?.position != null ? 'Commanded position; the thin mark is what the hub reports.' : 'Commanded position (the device reports none).'} Panic stop: <Kbd keys={keys('playback.panic') || 'Shift+Escape'} />{V?.phase === 'live' ? ' (also pauses the hub)' : ''}</div>
    </Section>
  </div>
</div>

<style>
  .pb { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; }
  .pb-body { flex: 1 1 auto; min-height: 0; }
  .row { display: flex; align-items: center; gap: var(--gap); flex-wrap: wrap; min-width: 0; }
  .sp { flex: 1 1 0; }
  .acts { margin-top: var(--space-4); }
  .err { margin-top: var(--space-3); color: var(--bad-ink); font-size: var(--fs-2); }
  .form { display: flex; flex-direction: column; gap: var(--space-4); --field-label-w: 104px; }
  .list { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-4); }
  .dev { display: flex; align-items: center; gap: var(--gap); min-width: 0; padding: var(--space-2) var(--space-3); border: var(--bw) solid var(--line-1);
    border-radius: var(--radius); background: var(--bg-sunken); color: var(--tx); text-align: left; cursor: pointer; font: inherit; }
  .dev:disabled { cursor: default; color: var(--tx-mut); }
  .dev.on { border-color: var(--accent); }
  .dev:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .live { display: flex; gap: var(--space-5); align-items: stretch; }
  .meter { position: relative; flex: none; width: 14px; height: 72px; background: var(--bg-sunken); border: var(--bw) solid var(--line-1); border-radius: var(--radius); overflow: hidden; }
  .band { position: absolute; left: 0; right: 0; background: var(--line-3); }
  .mark { position: absolute; left: 0; right: 0; height: 3px; margin-bottom: -1px; background: var(--accent); }
  .actual { position: absolute; left: 3px; right: 3px; height: 1px; background: var(--tx); }
  .stale { opacity: 0.4; }
  .warn { color: var(--warn-ink, var(--tx-mut)); }
  .clip { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .vkv { margin-top: var(--space-4); }
  .pb :global(.host) { flex: 1 1 120px; min-width: 0; }
  .pb :global(.port) { flex: 0 0 72px; }
  .pb :global(.holding) { outline: 2px solid var(--bad-ink); }
  .kv { flex: 1 1 auto; display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: var(--space-5); align-content: start; font-size: var(--fs-2); }
  .kv > :nth-child(odd) { color: var(--tx-mut); }
  .kv > :nth-child(even) { color: var(--tx-val); text-align: right; }
</style>
