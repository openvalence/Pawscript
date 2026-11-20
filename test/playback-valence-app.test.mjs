// The Playback store (playback.svelte.js, compiled for the server so runes are plain fields) with a Valence hub as
// the output: settings (address, identity, paired token), routing ahead of buttplug, the hub-planned config, video ->
// segments, panic = hub PAUSE, a dropped link turns playback off and a reconnect never resumes it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileModule } from 'svelte/compiler';
import { fakeBridge } from '../src/features/playback/bridge.js';
import { createFakeHub } from './valence-fake-hub.mjs';

const srcUrl = new URL('../src/features/playback/playback.svelte.js', import.meta.url);
const code = compileModule(readFileSync(srcUrl, 'utf8'), { filename: 'playback.svelte.js', generate: 'server' }).js.code
  .replace(/from '(\.{1,2}\/[^']+)'/g, (_, s) => `from '${new URL(s, srcUrl).href}'`)
  .replace(/from 'svelte\/internal\/server'/, `from '${import.meta.resolve('svelte/internal/server')}'`);
const { playbackFor } = await import('data:text/javascript,' + encodeURIComponent(code));

const wait = async (cond, ms = 3000, what = '') => {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timed out ' + what); await new Promise((r) => setTimeout(r, 5)); }
};
const script = Array.from({ length: 40 }, (_, i) => ({ at: i * 100, pos: i % 2 ? 80 : 20 }));
function mockApp(values) {
  const v = { ...values }, toasts = [];
  const player = { timeMs: 0, playing: false, rate: 1, t0: 0,
    now() { return this.playing ? performance.now() - this.t0 : this.timeMs; },
    play() { this.t0 = performance.now() - this.timeMs; this.playing = true; }, pause() { this.timeMs = this.now(); this.playing = false; }, seek(ms) { this.timeMs = ms; } };
  return { v, toasts, player, settings: { get values() { return v; }, get: (k, d) => (k in v ? v[k] : d), set: (k, x) => { v[k] = x; } },
    toast: (m, kind) => toasts.push([m, kind]), doc: { axes: { stroke: script }, activeAxis: 'stroke', range: null, selection: null }, backend: { isTauri: false } };
}

test('Playback with a Valence hub: pair, play, panic, drop, reconnect, goodbye', async (ctx) => {
  const hub = createFakeHub(), app = mockApp({ 'playback.valence.host': 'fake', 'playback.valence.port': 1 });
  const P = playbackFor(app, { bridge: fakeBridge(), WebSocketImpl: hub.WebSocket });
  ctx.after(() => P.destroy());
  P.connectValence();
  await wait(() => P.valence?.phase === 'live', 3000, 'live');
  assert.equal(hub.blobRequests, 1, 'cold start: the catalog is fetched and verified');
  assert.match(app.v['playback.valence.instanceId'], /^[0-9a-f]{16}$/, 'install identity persisted');
  assert.equal(P.ready, false, 'watch tier cannot play');
  P.setEnabled(true);
  assert.equal(P.enabled, false);

  P.pairValence();
  await wait(() => P.valenceReady, 3000, 'control + grant');
  assert.equal(app.v['playback.valence.tokens']['fake:1'], '000102030405060708090a0b0c0d0e0f', 'paired token persisted per host:port');
  assert.equal(P.outputName, 'Fake hub');
  const c = P.config;
  assert.equal(c.maxSpeed, 0, 'the hub limits, not the client');
  assert.equal(c.minIntervalMs, 20, 'one command per 50 Hz grant slot');
  assert.equal(c.latencyMs, P.valence.latencyMs);

  P.setEnabled(true);
  app.player.play();
  await wait(() => hub.segments.length >= 8, 3000, 'segments while playing');
  assert.equal(P.error, '');
  assert.ok(hub.segments.every((s) => s.channel === 0x2101));
  const targets = new Set(hub.segments.slice(1).map((s) => s.rec.target_norm));
  assert.ok([...targets].every((x) => x === 0.2 || x === 0.8), 'script positions, pos/100, pos 0 = window 0');

  await P.panic();
  await wait(() => P.valence.paused, 2000, 'hub paused');
  assert.deepEqual(hub.echoes, [4], 'panic latched PAUSE on the hub');
  assert.equal(P.enabled, false);
  assert.equal(app.player.playing, false);
  await P.valenceOp('resume');
  await wait(() => P.valenceReady, 2000, 'resumed');

  P.setEnabled(true);
  app.player.play();
  await wait(() => hub.segments.length > 12, 3000);
  hub.drop();
  await wait(() => !P.enabled, 2000, 'a dropped link turns playback off');
  assert.ok(app.toasts.some(([m]) => /Valence hub disconnected/.test(m)));
  await wait(() => P.valenceReady, 3000, 'reconnected with the stored token');
  const n = hub.segments.length;
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(hub.segments.length, n, 'reconnecting never resumes motion');
  assert.ok(hub.hellos.at(-1).has(5), 'token in the reconnect HELLO');

  P.disconnectValence();
  await wait(() => hub.goodbyes === 1, 2000, 'GOODBYE');
  assert.equal(P.valence, null);
  assert.equal(P.ready, false);
});
