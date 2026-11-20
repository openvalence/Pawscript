<!-- DeviceChip: status-bar item while the device server runs or a Valence hub is linked: connected / playing / the
     lead in ms. Click turns device playback on or off. -->
<script>
  import { StatusItem } from '../../ui/kit/index.js';
  import { playbackFor } from './playback.svelte.js';

  let { app } = $props();
  const P = playbackFor(app);   // created at boot here: no server starts until Connect
  const V = $derived(P.valence);
  const state = $derived(V && !P.valenceReady && !P.device ? (V.phase === 'live' ? V.why : V.phase)
    : !P.ready ? (P.connected ? 'no device' : 'starting') : P.previewing ? 'preview' : P.enabled ? (app.player.playing ? 'playing' : 'ready') : 'off');
  const tone = $derived(V?.estop || V?.paused ? 'warn' : P.active ? 'ok' : P.ready ? 'neutral' : 'warn');
</script>

{#if P.status !== 'off' || V}
  <StatusItem icon="device" {tone} tip={P.ready ? `${P.outputName}: click to turn playback ${P.enabled ? 'off' : 'on'}` : 'Device: no device selected'} onclick={() => P.toggle()}>
    {P.valenceReady ? 'Valence' : 'Device'} · {state}{#if P.active} · <span class="k-num">{P.leadMs} ms</span>{/if}
  </StatusItem>
{/if}
