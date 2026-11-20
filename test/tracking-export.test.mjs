import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportFunscript } from '../src/features/tracking/export.js';

const VIDEO = 'C:/v/clip.mp4', ORIG = 'C:/v/clip.funscript', ALT = 'C:/v/clip.pawscript.funscript';
const mem = (init = {}) => { const files = new Map(Object.entries(init)); return { files, exists: async (p) => files.has(p), readText: async (p) => files.get(p), writeText: async (p, s) => void files.set(p, s) }; };
const S = [{ at: 0, pos: 0 }, { at: 500, pos: 100 }];
const actions = (be, p) => JSON.parse(be.files.get(p)).actions;

test('no funscript yet: writes <name>.funscript', async () => {
  const be = mem();
  const r = await exportFunscript(be, VIDEO, S);
  assert.equal(r.path, ORIG);
  assert.deepEqual(actions(be, ORIG), S);
  assert.equal(be.files.size, 1);
});

test('a funscript exists: writes .pawscript.funscript, the original untouched; repeats keep .bak, .bak2', async () => {
  const orig = JSON.stringify({ actions: [{ at: 1, pos: 1 }] });
  const be = mem({ [ORIG]: orig });
  assert.equal((await exportFunscript(be, VIDEO, S)).path, ALT);
  assert.equal(be.files.get(ORIG), orig);
  const first = be.files.get(ALT);
  await exportFunscript(be, VIDEO, [{ at: 9, pos: 9 }]);
  await exportFunscript(be, VIDEO, [{ at: 10, pos: 10 }]);
  assert.equal(be.files.get(ALT + '.bak'), first);
  assert.ok(be.files.has(ALT + '.bak2'));
  assert.equal(be.files.get(ORIG), orig);
});

test('overwrite: backs the original up first, keeps its unknown keys and its inverted flag', async () => {
  const orig = JSON.stringify({ version: '1.0', inverted: true, metadata: { creator: 'x' }, custom: 7, actions: [{ at: 1, pos: 1 }] });
  const be = mem({ [ORIG]: orig });
  const r = await exportFunscript(be, VIDEO, S, true);
  assert.equal(r.path, ORIG);
  assert.equal(be.files.get(ORIG + '.bak'), orig);
  const doc = JSON.parse(be.files.get(ORIG));
  assert.equal(doc.custom, 7); assert.equal(doc.metadata.creator, 'x');
  // paw-xn04: Pawscript wrote it (a run's own points), the original's creator kept in `from`
  assert.equal(doc.metadata.pawscript.app, 'Pawscript'); assert.deepEqual(doc.metadata.pawscript.how, { tracked: 1 }); assert.deepEqual(doc.metadata.pawscript.from, { creator: 'x' });
  assert.deepEqual(doc.actions, [{ at: 0, pos: 100 }, { at: 500, pos: 0 }]);   // inverted file: positions flipped
});

test('an invalid file is still backed up before it is replaced', async () => {
  const be = mem({ [ORIG]: 'not json' });
  const r = await exportFunscript(be, VIDEO, S, true);
  assert.equal(be.files.get(ORIG + '.bak'), 'not json');
  assert.match(r.note, /not valid JSON/);
  assert.deepEqual(actions(be, ORIG), S);
});
