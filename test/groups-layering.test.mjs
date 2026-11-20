// paw-noy2: a part that lives on another part (a knot on the penis) is not clipped against it by any painting aid; Ctrl paints over
// whatever is under the stroke; unrelated groups keep the exclusion; both shapes stay whole; the topmost (smallest) group is hit first
// and a second Alt+click goes to the one beneath.
import { test } from 'node:test';
import assert from 'node:assert/strict';

async function tool() {
  const { fileURLToPath } = await import('node:url');
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const M = await server.ssrLoadModule('/dev/mock-app.js'), GS = await server.ssrLoadModule('/src/features/tracking/groups.svelte.js');
  const T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js'), GJ = await server.ssrLoadModule('/src/features/tracking/groups.js');
  const doc = { ...M.sampleDoc(), scenes: [{ start_ms: 0, end_ms: 30000 }], ghosts: [] };
  doc.media = { ...(doc.media || {}), path: 'C:\clip.mp4' };
  const app = M.createMockApp({ doc, keys: false, backend: M.mockBackend() });
  const tr = app.tracking = T.trackingFor(app); app.mode = 'track'; app.player.timeMs = 1000;
  const G = GS.groupsFor(app);
  app.toast = () => {};
  G.toggle(true);
  const { w, h } = G.size;
  const disc = (cx, cy, r) => { const a = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r ? 1 : 0; return GJ.encodeMask({ w, h, a }); };
  let answer = null;
  tr.job = () => Promise.resolve({ result: { mask_wh: [w, h], masks: answer() } });
  const dab = async (nx, ny, { erase = false, force = false } = {}) => { const ok = G.begin(nx, ny, erase, 1, force); if (ok) { G.end(); await new Promise((r) => setTimeout(r, 5)); } return ok; };
  const count = (g, ref) => { const a = G.maskFor(g).a, b = ref ? G.maskFor(ref).a : null; let n = 0; for (let i = 0; i < a.length; i++) if (a[i] >= 0.5 && (!b || b[i] >= 0.5)) n++; return n; };
  return { server, app, G, w, h, disc, dab, count, setAnswer: (f) => { answer = f; }, GJ };
}

test('a knot grown on top of the penis is not clipped by it (once it is a knot); unassigned it is; the parent keeps its shape', async () => {
  const t = await tool();
  try {
    const { G, w, h, disc, dab, count } = t;
    G.app.settings.set('tracking.groups.grow', false);
    assert.ok(await dab(0.5, 0.5));   // hand painted
    G.assign(0, { who: 'c1', part: 'penis', side: null });
    const pm = G.maskFor(G.groups[0]).a.slice();
    G.app.settings.set('tracking.groups.grow', true);
    // SAM answers a disc that holds the dab and covers part of the penis
    t.setAnswer(() => [{ mask: disc(w * 0.5, h * 0.56, 0.2 * h), score: 0.9, area: 0 }]);
    assert.ok(await dab(0.5, 0.64));   // off the penis: a new unassigned group
    let g = G.groups.at(-1);
    assert.equal(G.groups.length, 2);
    assert.equal(count(g, G.groups[0]), 0, 'unassigned: nothing is known about it, the penis is excluded');
    G.assign(1, { who: 'c1', part: 'knot', side: null }); G.pick(1);
    assert.ok(await dab(0.5, 0.64));   // another dab on the group, now a knot
    g = G.groups.find((x) => x.name === 'c1_knot');
    const over = count(g, G.groups.find((x) => x.name === 'c1_penis'));
    assert.ok(over > 100, `the knot overlaps the penis: ${over} px (not clipped)`);
    assert.deepEqual(Array.from(G.maskFor(G.groups.find((x) => x.name === 'c1_penis')).a), Array.from(pm), 'the parent is exactly as it was: not cut by the child');
  } finally { await t.server.close(); }
});

test('the exclusion between unrelated groups stays; Ctrl lifts it for the stroke', async () => {
  const t = await tool();
  try {
    const { G, w, h, disc, dab, count } = t;
    G.app.settings.set('tracking.groups.grow', false);
    assert.ok(await dab(0.5, 0.5)); G.assign(0, { who: 'c1', part: 'penis', side: null });
    G.app.settings.set('tracking.groups.grow', true);
    const penis = G.groups[0];
    // SAM's mask for a dab at (0.52, 0.5): a disc centred there, half over the penis
    t.setAnswer(() => [{ mask: disc(w * 0.52, h * 0.5, 30), score: 0.9, area: 0 }]);
    assert.ok(await dab(0.62, 0.5, { force: false }));   // off the penis (a new unassigned group)
    const a = G.groups.find((g) => g !== penis);
    if (a) assert.equal(count(a, penis), 0, 'an unrelated new group is cut away from the penis');
    G.active = -1;
    t.setAnswer(() => [{ mask: disc(w * 0.6, h * 0.5, 40), score: 0.9, area: 0 }]);
    assert.ok(await dab(0.6, 0.5, { force: true }));   // Ctrl: a new group painted over
    const b = G.groups.filter((g) => g !== penis).at(-1);
    assert.ok(count(b, penis) > 50, `Ctrl+dab overlaps the penis: ${count(b, penis)} px`);
  } finally { await t.server.close(); }
});

test('hit test: the smallest group in an overlap is hit first; Alt+click again picks the one beneath', async () => {
  const t = await tool();
  try {
    const { G, dab } = t;
    G.app.settings.set('tracking.groups.grow', false);
    assert.ok(await dab(0.5, 0.5)); G.assign(0, { who: 'c1', part: 'penis', side: null });
    G.app.settings.set('tracking.groups.brush', 0.02);
    assert.ok(await dab(0.5, 0.5, { force: true })); const k = G.groups.length - 1; G.assign(k, { who: 'c1', part: 'knot', side: null });
    G.active = -1;
    assert.equal(G.groups[G.hitAt(0.5, 0.5)].name, 'c1_knot', 'the topmost (smallest) is hit');
    G.pickAt(0.5, 0.5); const first = G.groups[G.active].name;
    G.pickAt(0.5, 0.5); const second = G.groups[G.active].name;
    assert.deepEqual([first, second].sort(), ['c1_knot', 'c1_penis'], 'the two clicks pick both, one after the other');
    assert.notEqual(first, second);
  } finally { await t.server.close(); }
});
