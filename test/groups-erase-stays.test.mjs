// paw-yx6q: an erased area stays erased. The owner's "if I erase a section, it pretty much needs to be erased from that section, sam
// loves growing back when an area is similar". The fake SAM here answers like the real one did on a similar-looking area: the
// whole disc again, whatever the negatives. The erase record is a hard cut through every regrow / refinement / dial / stroke until
// a paint stroke of the group goes over it; it is saved on the group and sent to Track.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextErased, clipErased, withErased, erasedOf, erasedPolys, encodeMask, decodeMask, trackGroups, inPoly } from '../src/features/tracking/groups.js';

test('nextErased / clipErased / withErased: the record grows with an erase, shrinks under paint, cuts any mask', () => {
  const n = 10, swept = new Float32Array(n), painted = new Float32Array(n);
  swept[2] = swept[3] = 1; painted[3] = 1;
  const e1 = nextErased(null, n, { swept });
  assert.deepEqual([...e1], [0, 0, 1, 1, 0, 0, 0, 0, 0, 0]);
  const e2 = nextErased(e1, n, { painted });
  assert.deepEqual([...e2], [0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(nextErased(e2, n, { painted: Float32Array.from({ length: n }, () => 1) }), null, 'all painted over: no record');
  const m = { w: 5, h: 2, a: new Float32Array(n).fill(1) }, c = clipErased(m, e2);
  assert.equal(c.a[2], 0); assert.equal(c.a[3], 1); assert.equal(m.a[2], 1, 'the input is not mutated');
  const g = withErased({ name: 'c1_penis' }, e2, { w: 5, h: 2 });
  assert.deepEqual([...erasedOf(g, { w: 5, h: 2 })], [...e2]);
  assert.equal(withErased(g, null, { w: 5, h: 2 }).erased, undefined);
});

async function tool() {
  const { fileURLToPath } = await import('node:url');
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const M = await server.ssrLoadModule('/dev/mock-app.js'), GS = await server.ssrLoadModule('/src/features/tracking/groups.svelte.js');
  const T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js'), GJ = await server.ssrLoadModule('/src/features/tracking/groups.js');
  const doc = { ...M.sampleDoc(), scenes: [{ start_ms: 0, end_ms: 30000 }], ghosts: [] };
  doc.media = { ...(doc.media || {}), path: 'C:\\clip.mp4' };
  const app = M.createMockApp({ doc, keys: false, backend: M.mockBackend() });
  const tr = app.tracking = T.trackingFor(app); app.mode = 'track';
  app.player.timeMs = 1000;
  const G = GS.groupsFor(app);
  app.toast = () => {};
  G.toggle(true);
  const { w, h } = G.size, reqs = [];
  const disc = (cx, cy, r) => { const a = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r ? 1 : 0; return { mask: GJ.encodeMask({ w, h, a }), score: 0.9 }; };
  // SAM on a similar-looking area: the same big disc whatever it is told
  tr.job = (label, req) => { reqs.push(req); return Promise.resolve({ result: { mask_wh: [w, h], cached: true, ms: {}, masks: [disc(w * 0.45, h * 0.5, 40)] } }); };
  const settle = () => new Promise((r) => setTimeout(r, 5));
  const dab = async (nx, ny, erase = false) => { const ok = G.begin(nx, ny, erase); if (ok) { G.end(); await settle(); } return ok; };
  const at = (nx, ny) => G.maskFor(G.groups[0]).a[Math.floor(ny * h) * w + Math.floor(nx * w)];
  return { server, app, G, GJ, reqs, w, h, dab, at, settle };
}

test('an erased spot stays erased through SAM regrows, refinements, the dial and other strokes; a paint stroke over it brings it back', async () => {
  const t = await tool();
  try {
    const { G, reqs, w, h, dab, at } = t;
    G.app.settings.set('tracking.groups.grow', true);
    assert.ok(await dab(0.42, 0.5));
    assert.equal(G.groups.length, 1); assert.ok(at(0.5, 0.5) >= 0.5, 'SAM took the spot in');
    // Shift: the SAM erase on the spot. SAM answers the whole disc again: the spot must still go
    assert.ok(await dab(0.5, 0.5, true));
    assert.equal(at(0.5, 0.5), 0, 'erased, though SAM answered it back');
    const er = reqs.at(-1);
    assert.ok(er.neg?.length >= 1, 'negatives sent');
    const inSpot = ([x, y]) => Math.hypot(x * w - 0.5 * w, y * h - 0.5 * h) < G.radius * h;
    assert.ok(!er.pos.some(inSpot), 'no positive inside what is erased');
    assert.ok(G.groups[0].erased?.rle?.length, 'the record is kept on the group');
    // another dab elsewhere on the group: a refinement from the mask SAM made; the mask prompt has the spot at 0, SAM regrows it anyway
    assert.ok(await dab(0.38, 0.5));
    const rq = reqs.at(-1), pm = t.GJ.decodeMask(rq.mask);
    assert.equal(pm.a[Math.floor(0.5 * h) * w + Math.floor(0.5 * w)], 0, 'the mask SAM refines has the spot at 0');
    assert.ok(rq.neg.some(inSpot), 'the erased area is SAM\'s negative evidence');
    assert.equal(at(0.5, 0.5), 0, 'still erased after the regrow');
    // the dial (looser): SAM's answer is the same disc: still cut
    assert.ok(G.dialNotch(1, [0.4, 0.5]));
    for (let i = 0; i < 400 && (G.dial?.busy || G.dial?.pend); i++) await t.settle();
    G.commitDial();
    assert.equal(at(0.5, 0.5), 0, 'still erased after the dial');
    // a hand stroke (grow off) elsewhere on the group, then SAM again: still erased
    G.app.settings.set('tracking.groups.grow', false);
    assert.ok(await dab(0.35, 0.45));
    G.app.settings.set('tracking.groups.grow', true);
    assert.ok(await dab(0.4, 0.55));
    assert.equal(at(0.5, 0.5), 0, 'still erased after a hand stroke and a fresh SAM grow');
    // Track gets it: the spot is inside an erased outline
    const tg = trackGroups(t.app.doc.scenes, 0, 30000);
    assert.equal(tg.length, 0, 'unassigned groups are not tracked');
    const named = t.app.doc.scenes.map((s) => ({ ...s, groups: (s.groups || []).map((g) => ({ ...g, name: 'c1_penis', who: 'c1', part: 'penis' })) }));
    const sent = trackGroups(named, 0, 30000);
    assert.equal(sent.length, 1); assert.ok(sent[0].erased?.some((q) => inPoly(q, 0.5, 0.5)), 'Track is told the spot is erased');
    // a paint stroke of the group over the spot brings it back and lifts the record there
    G.app.settings.set('tracking.groups.grow', false);
    const n = G.groups.length;
    assert.ok(G.begin(0.4, 0.5, false)); G.move(0.45, 0.5); G.move(0.5, 0.5); G.end(); await t.settle();   // from inside the group onto the spot
    assert.equal(G.groups.length, n, 'the same group');
    assert.ok(at(0.5, 0.5) >= 0.5, 'painted over: back');
    const left = erasedOf(G.groups[0], { w, h });
    assert.ok(!left || !left[Math.floor(0.5 * h) * w + Math.floor(0.5 * w)], 'the record no longer holds the repainted spot');
    G.app.settings.set('tracking.groups.grow', true);
    assert.ok(await dab(0.4, 0.5));
    assert.ok(at(0.5, 0.5) >= 0.5, 'and SAM may take it again');
  } finally { await t.server.close(); }
});

test('a plain erase (grow off) on a SAM group, then a grow dab: the erased spot does not come back', async () => {
  const t = await tool();
  try {
    const { G, dab, at } = t;
    G.app.settings.set('tracking.groups.grow', true);
    assert.ok(await dab(0.42, 0.5));
    G.app.settings.set('tracking.groups.grow', false);
    assert.ok(await dab(0.5, 0.5, true));
    assert.equal(at(0.5, 0.5), 0);
    G.app.settings.set('tracking.groups.grow', true);
    assert.ok(await dab(0.4, 0.5));
    assert.equal(at(0.5, 0.5), 0, 'the grow dab did not bring it back');
    // undo brings the state before the dab back exactly; the record is part of the group
    t.app.undo();
    assert.equal(at(0.5, 0.5), 0);
    assert.ok(t.G.groups[0].erased);
  } finally { await t.server.close(); }
});

test('erasedPolys: a hole erased inside a group is an outline Track can cut out', () => {
  const w = 40, h = 20, a = new Float32Array(w * h);
  for (let y = 8; y < 12; y++) for (let x = 18; x < 22; x++) a[y * w + x] = 1;
  const g = { name: 'c1_penis', erased: encodeMask({ w, h, a }) };
  const p = erasedPolys(g);
  assert.equal(p.length, 1); assert.ok(inPoly(p[0], 0.5, 0.5)); assert.ok(!inPoly(p[0], 0.2, 0.5));
  assert.deepEqual(erasedPolys({ name: 'x' }), []);
  assert.equal(decodeMask(g.erased).a[10 * w + 20], 1);
});
