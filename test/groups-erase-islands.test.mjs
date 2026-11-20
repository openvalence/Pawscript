// paw-1co9: an erase on a group leaves each patch it cut as ONE piece (groups.js eraseIslands): the piece with the SAM
// prompts, else the largest; crumbs go; patches the erase did not touch stay; nothing erased comes back. The store applies
// it to every erase stroke (one undo step).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newMask, cloneMask, stroke, dab, fitPoly, eraseIslands, encodeMask } from '../src/features/tracking/groups.js';

const W = 160, H = 90;
const blobs = (m) => fitPoly(m).blobs;
const px = (m) => m.a.reduce((s, v) => s + (v >= 0.5 ? 1 : 0), 0);
const erase = (m, p, q, r) => { const o = cloneMask(m); stroke(o, p, q, r, { erase: true }); return o; };
const noneBack = (out, after) => { for (let i = 0; i < out.a.length; i++) assert.ok(out.a[i] <= after.a[i] + 1e-9, 'nothing erased comes back'); };
const bar = () => { const m = newMask({ w: W, h: H }); stroke(m, [30, 45], [130, 45], 10); return m; };
// the "grew too far" shape: a body and a spill joined by a thin neck
const spill = () => { const m = newMask({ w: W, h: H }); dab(m, 50, 45, 20); dab(m, 110, 45, 14); stroke(m, [50, 45], [110, 45], 2.5); return m; };

test('erase through the middle: the larger half stays, or the half holding the SAM prompts', () => {
  const before = bar(), after = erase(before, [60, 20], [60, 70], 5);
  assert.equal(blobs(after), 2, 'the raw erase cuts the bar in two');
  const out = eraseIslands(before, after);
  assert.equal(blobs(out), 1);
  assert.ok(px(out) > 0.6 * px(after), 'the larger (right) half');
  assert.ok(out.a[45 * W + 100] >= 0.5 && out.a[45 * W + 40] === 0, 'right kept, left gone with its soft rim');
  const kept = eraseIslands(before, after, [[40, 45]]);
  assert.equal(blobs(kept), 1);
  assert.ok(kept.a[45 * W + 40] >= 0.5 && kept.a[45 * W + 100] === 0, 'the half with the prompt stays even though it is smaller');
  noneBack(out, after); noneBack(kept, after);
});

test('erase the neck of a spill: the spill goes, the body stays whole', () => {
  const before = spill(), body = newMask({ w: W, h: H }); dab(body, 50, 45, 20);
  const after = erase(before, [80, 30], [80, 60], 4);
  assert.equal(blobs(after), 2);
  const out = eraseIslands(before, after, [[50, 45]]);
  assert.equal(blobs(out), 1);
  assert.equal(out.a[45 * W + 110], 0, 'the spill is gone');
  assert.ok(Math.abs(px(out) - px(body)) <= 0.05 * px(body), `the body keeps its size: ${px(out)} of ${px(body)} + neck stub`);
  noneBack(out, after);
});

test('a second patch painted on purpose stays when the erase does not touch it; touched, it stays one piece', () => {
  const before = bar(); dab(before, 80, 12, 6);   // a separate patch above the bar
  assert.equal(blobs(before), 2);
  const after = erase(before, [100, 30], [100, 60], 4);   // cuts the bar, away from the patch
  const out = eraseIslands(before, after);
  assert.equal(blobs(out), 2, 'the bar is one piece again, the patch is still there');
  assert.ok(out.a[12 * W + 80] >= 0.5);
  const nick = erase(before, [86, 4], [86, 8], 2);   // a nick on the patch only
  assert.equal(eraseIslands(before, nick), nick, 'nothing split: the mask as it is');
});

test('crumbs left along an erased edge go; an untouched mask comes back as it is', () => {
  const before = bar();
  const after = cloneMask(before);
  for (let y = 20; y <= 70; y++) for (let x = 55; x <= 70; x++) after.a[y * W + x] = 0;   // a clean cut ...
  after.a[45 * W + 62] = 1; after.a[45 * W + 63] = 1;   // ... with a 2 px crumb in the gap
  assert.equal(fitPoly(after).blobs, 2, 'the crumb is not a patch, but it is in the mask');
  const out = eraseIslands(before, after);
  assert.equal(out.a[45 * W + 62], 0, 'the crumb is gone');
  assert.equal(blobs(out), 1);
  assert.equal(eraseIslands(before, before), before);
  assert.equal(eraseIslands(before, newMask({ w: W, h: H })).a.every((v) => v === 0), true, 'erased away stays away');
});

// ---- the store: a plain erase stroke (grow off) through a spill's neck
async function tool() {
  const { fileURLToPath } = await import('node:url');
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const M = await server.ssrLoadModule('/dev/mock-app.js'), GS = await server.ssrLoadModule('/src/features/tracking/groups.svelte.js');
  const T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
  const doc = { ...M.sampleDoc(), scenes: [{ start_ms: 0, end_ms: 30000 }], ghosts: [] };
  const app = M.createMockApp({ doc, keys: false, backend: M.mockBackend() });
  app.tracking = T.trackingFor(app); app.mode = 'track'; app.player.timeMs = 1000;
  const G = GS.groupsFor(app);
  app.toast = () => {};
  G.toggle(true);
  return { server, app, G };
}

test('store: an erase stroke across a spill\'s neck leaves one piece, one undo step; undo brings the spill back', async () => {
  const { server, app, G } = await tool();
  try {
    G.app.settings.set('tracking.groups.grow', false);
    G.begin(0.3, 0.5, false); G.end();   // a group to replace with the spill shape
    const { w, h } = G.size, m = newMask({ w, h });
    dab(m, w * 0.3, h * 0.5, h * 0.12); dab(m, w * 0.6, h * 0.5, h * 0.08); stroke(m, [w * 0.3, h * 0.5], [w * 0.6, h * 0.5], 2.5);
    const g = { ...G.groups[0], mask: encodeMask(m), poly: fitPoly(m).poly };
    G.cache.set(g, m);
    app.transact('setup', () => { app.doc.scenes = [{ ...app.doc.scenes[0], groups: [g] }]; });
    const n0 = app._history.entries.length;
    G.begin(0.45, 0.3, true); for (let k = 1; k <= 10; k++) G.move(0.45, 0.3 + k * 0.04); G.end();
    const after = G.maskFor(G.groups[0]);
    assert.equal(fitPoly(after).blobs, 1, 'one piece');
    assert.equal(after.a[Math.round(h * 0.5) * w + Math.round(w * 0.6)], 0, 'the spill went (smaller, no prompts)');
    assert.ok(after.a[Math.round(h * 0.5) * w + Math.round(w * 0.3)] >= 0.5, 'the body stayed');
    assert.equal(app._history.entries.length, n0 + 1, 'one undo step');
    app.undo();
    assert.equal(G.groups[0], g, 'undo: the spill shape as it was');
  } finally { await server.close(); }
});
