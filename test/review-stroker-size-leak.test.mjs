// [review] the user's size leaks into the usage log through the settings StrokerView derives from it: stroker.rig
// (pickSleeve / "Reset the stroke window" write rigFor(body, sleeve): upMm = length - 15 or - 25) and stroker.cam
// (frameAll's pan = length * 0.55). Both keys are logged; only stroker.body is UNLOGGED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileModule } from 'svelte/compiler';
import * as K from '../src/features/machine/stroker.js';

test('stroker: settings derived from the size do not put the size in the usage log', async () => {
  registerHooks({
    load(url, ctx, next) {
      if (!url.startsWith('file:') || url.includes('node_modules')) return next(url, ctx);
      if (url.endsWith('.svelte.js')) return { format: 'module', shortCircuit: true, source: compileModule(readFileSync(fileURLToPath(url), 'utf8'), { filename: fileURLToPath(url), generate: 'server' }).js.code };
      if (url.endsWith('.svelte')) return { format: 'module', shortCircuit: true, source: 'export default function Stub() {}' };
      if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' };
      return next(url, ctx);
    },
  });
  const { createApp } = await import('../src/app/app.svelte.js');
  const app = createApp({ storage: null, commands: [] });
  const body = K.validBody({ lengthMm: 173, girthMm: 141, glansMm: 37 });
  app.settings.set('stroker.body', body);
  // what StrokerView.pickSleeve does on picking the Quickshot, and frameAll's camera save
  app.settings.set('stroker.sleeve', 'fl-quickshot');
  app.settings.set('stroker.rig', K.rigFor(body, K.sleeveFor('fl-quickshot')));
  app.settings.set('stroker.cam', { az: 0, el: 0, zoom: 1, pan: [0, body.lengthMm * 0.55, 0], shift: 0 });
  app.settings.set('stroker.camUp', { az: 0, el: 0, zoom: 1, pan: [0, 0, body.lengthMm * 0.5], shift: 0 });   // the upright view's camera (paw-iaai)
  app.usage.flushAll?.();
  const logged = JSON.stringify([app.usage.log, app.usage.lines || []]);
  const rig = K.rigFor(body, K.sleeveFor('fl-quickshot'));
  assert.doesNotMatch(logged, new RegExp(`upMm\\W+${rig.upMm}\\b`), 'stroker.rig logged: upMm + 25 = the length');
  assert.doesNotMatch(logged, /95\.15/, 'stroker.cam logged: pan / 0.55 = the length');
  assert.doesNotMatch(logged, /86\.5/, 'stroker.camUp logged: pan / 0.5 = the length');
});
