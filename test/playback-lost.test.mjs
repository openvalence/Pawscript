// paw-wfd2.3: Playback.lost, the health slot's "Device not responding": set when a linked device leaves, never before
// one was linked, cleared by a reconnect.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileModule } from 'svelte/compiler';
import { fakeBridge } from '../src/features/playback/bridge.js';

const srcUrl = new URL('../src/features/playback/playback.svelte.js', import.meta.url);
const code = compileModule(readFileSync(srcUrl, 'utf8'), { filename: 'playback.svelte.js', generate: 'server' }).js.code
  .replace(/from '(\.{1,2}\/[^']+)'/g, (_, s) => `from '${new URL(s, srcUrl).href}'`)
  .replace(/from 'svelte\/internal\/server'/, `from '${import.meta.resolve('svelte/internal/server')}'`);
const { playbackFor } = await import('data:text/javascript,' + encodeURIComponent(code));

test('playback: lost is set when the linked device leaves and cleared by a reconnect', async (ctx) => {
  const v = {}, app = { settings: { values: v, get: (k, d) => (k in v ? v[k] : d), set: (k, x) => { v[k] = x; } }, toast() {}, player: {}, doc: { axes: {} }, backend: { isTauri: false } };
  const bridge = fakeBridge({ scanDelayMs: 5 }), P = playbackFor(app, { bridge });
  ctx.after(() => P.destroy());
  assert.equal(P.lost, '', 'none ever started');
  await P.connect();
  assert.equal(P.lost, '', 'connected, still scanning');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(P.device?.name, 'Fake stroker');
  bridge.drop(0);
  assert.equal(P.lost, 'Fake stroker');
  await P.reconnect();
  assert.equal(P.lost, '');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(P.lost, '', 'the device is back');
});
