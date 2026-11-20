// The shared build's setup screen (src/app/setup-screen.js, paw-i7s): its words, and that a dev build starts at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupText, setupDone } from '../src/app/setup-screen.js';

test('setup words: the runtime step says it takes about a minute; a refusal shows the shell message', () => {
  assert.match(setupText({ state: 'unpacking', what: 'runtime' }), /one time.*about a minute/);
  assert.match(setupText({ state: 'unpacking', what: 'checking' }), /one time/);
  assert.match(setupText({ state: 'unpacking', what: 'whatever' }), /one time/);
  assert.equal(setupText({ state: 'refused', message: 'Copy this folder to your own drive first: x' }), 'Copy this folder to your own drive first: x');
});

test('a dev build (ready) and a shell without the command start the app at once, without touching the page', async () => {
  assert.equal(await setupDone(async () => ({ state: 'ready' }), null), true);
  assert.equal(await setupDone(async () => { throw new Error('unknown command'); }, null), true);
});

test('paw-mn92: a later start checking its files for a moment starts the app without flashing the setup screen', async () => {
  const seq = [{ state: 'unpacking', what: 'checking' }, { state: 'unpacking', what: 'checking' }, { state: 'ready' }];
  let i = 0;
  // target null: touching the page would throw
  assert.equal(await setupDone(async () => seq[Math.min(i++, seq.length - 1)], null, 1000), true);
  assert.equal(i, 3);
});
