// paw-r6t0: Suggest returns every candidate with its score; the app shows only those at or above the confidence the owner sets, live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normScenes } from '../src/features/timeline/shots.js';
import { takeGroups, setTakeGroups, splitByConfidence, shownAt, shownLine, youngNote, isSuggested, SUGGEST_CONF, YOUNG_PICTURES } from '../src/features/tracking/groups.js';

const sq = [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]];
const sug = (name, score, x = {}) => ({ name, poly: sq, source: 'seeder', score, t_ms: 0, ...x });

test('the split: painted, re-found and scoreless groups always show; the rest by score; the default is 0.8', () => {
  assert.equal(SUGGEST_CONF, 0.8);
  const list = [sug('c1_hips', 0.97), sug('c1_hand_l', 0.79), sug('c1_tail', 0.8), { name: 'c1_head', source: 'user' }, sug('c2_tail', 0.3, { unconfirmed: true }), sug('c2_head', undefined)];
  const { shown, hidden } = splitByConfidence(list, 0.8);
  assert.deepEqual(shown.map((g) => g.name), ['c1_hips', 'c1_tail', 'c1_head', 'c2_tail', 'c2_head']);
  assert.deepEqual(hidden.map((g) => g.name), ['c1_hand_l']);
  assert.ok(shownAt(sug('a', 0.7999999999999999), 0.8), 'float noise of a 0.8 score is not hidden');
  assert.equal(shownLine(9, 6, 0.8), '9 shown · 6 more below 80 %');
  assert.equal(shownLine(3, 0, 0.8), '3 shown');
});

test('the young-seeder note names the dataset and the picture count; nothing at 30 or more or without a head', () => {
  assert.equal(youngNote({ frames: 9 }, 'v2'), 'v2 has 9 labeled pictures: suggestions will be rough until about 30+');
  assert.equal(youngNote({ frames: 1 }, ''), 'This dataset has 1 labeled picture: suggestions will be rough until about 30+');
  assert.equal(youngNote({ frames: YOUNG_PICTURES }, 'v1'), '');
  assert.equal(youngNote(null, 'v1'), '');
});

async function tool() {
  const { fileURLToPath } = await import('node:url');
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const M = await server.ssrLoadModule('/dev/mock-app.js'), GS = await server.ssrLoadModule('/src/features/tracking/groups.svelte.js');
  const T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
  const doc = { ...M.sampleDoc(), scenes: normScenes([{ start_ms: 0, end_ms: 10000 }]), ghosts: [] };
  const app = M.createMockApp({ doc, keys: false, backend: M.mockBackend() });
  app.tracking = T.trackingFor(app); app.mode = 'track';
  const G = GS.groupsFor(app);
  G.toggle(true);
  return { server, app, G };
}

test('the live filter in the store: lowering the confidence shows held ones, raising hides them, Accept all applies to what is shown', async () => {
  const { server, app, G } = await tool();
  try {
    const all = [sug('c1_hips', 0.97), sug('c1_penis', 0.9), sug('c1_hand_l', 0.75), sug('c2_head', 0.6), sug('c2_tail', 0.4)];
    const { shown, hidden } = splitByConfidence(all, G.suggestConf);
    assert.equal(G.suggestConf, 0.8);
    G.holdSuggestions(hidden);
    app.doc.scenes = setTakeGroups(app.doc.scenes, 0, shown);
    const names = () => takeGroups(app.doc.scenes, 0).map((g) => g.name);
    assert.deepEqual(names(), ['c1_hips', 'c1_penis']); assert.equal(G.heldCount, 3);
    G.setSuggestConf(0.65);
    assert.deepEqual(names(), ['c1_hips', 'c1_penis', 'c1_hand_l']); assert.equal(G.heldCount, 2);
    G.setSuggestConf(0.3);
    assert.equal(names().length, 5); assert.equal(G.heldCount, 0);
    G.setSuggestConf(0.95);
    assert.deepEqual(names(), ['c1_hips']); assert.equal(G.heldCount, 4);
    assert.equal(G.suggestConf, 0.95, 'remembered (setting)');
    // the owner deletes the shown one: it is gone, not held; the held ones come back as the confidence goes down
    G.remove(0);
    assert.deepEqual(names(), []); G.setSuggestConf(0.85);
    assert.deepEqual(names(), ['c1_penis'], 'the deleted one is not resurrected');
    // Accept all: only what is shown becomes painted; the held ones stay held (not painted)
    G.accept();
    const g = takeGroups(app.doc.scenes, 0);
    assert.deepEqual(g.map((x) => [x.name, x.source]), [['c1_penis', 'user']]);
    assert.equal(G.heldCount, 3);
    G.setSuggestConf(0.3);
    assert.equal(takeGroups(app.doc.scenes, 0).filter(isSuggested).length, 3, 'the lowered control shows the held ones as suggestions; the accepted one stays painted');
    // Decline all clears what is held too
    G.declineAll();
    assert.equal(G.heldCount, 0); G.setSuggestConf(0.3);
    assert.deepEqual(takeGroups(app.doc.scenes, 0).map((x) => x.name), ['c1_penis']);
  } finally { await server.close(); }
});

test('a name taken meanwhile does not collide when a held one is shown', async () => {
  const { server, app, G } = await tool();
  try {
    G.holdSuggestions([sug('c1_hips', 0.5)]);
    app.doc.scenes = setTakeGroups(app.doc.scenes, 0, [{ name: 'c1_hips', poly: sq, t_ms: 0, source: 'user' }]);
    G.setSuggestConf(0.4);
    assert.deepEqual(takeGroups(app.doc.scenes, 0).map((g) => g.name), ['c1_hips', 'c1_hips2']);
  } finally { await server.close(); }
});
