// paw-njnf: the knot is a section of the penis group, not a group of its own. The owner's "you paint the penis, then the knot
// within that group, it won't need assigned, and it's not required, an absence means no knot". The knot brush (K) paints it
// inside the penis only; Track sends it on the penis entry (v4.54); old projects' knot groups on a penis are folded into it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldKnots, knotOf, withKnot, knotPolys, trackGroups, encodeMask, decodeMask, inPoly, PICK_PARTS, PARTS, chipParts } from '../src/features/tracking/groups.js';
import { GENITALS, TARGETS } from '../src/features/tracking/figure.js';
import { proposalOf } from '../src/features/tracking/autoname.js';
import { ARM } from '../src/features/timeline/mod-runs.js';

const W = 80, H = 45, size = { w: W, h: H };
const rect = (x0, y0, x1, y1) => { const a = new Float32Array(W * H); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[y * W + x] = 1; return a; };
const sq = (x0, y0, x1, y1) => [[x0 / W, y0 / H], [x1 / W, y0 / H], [x1 / W, y1 / H], [x0 / W, y1 / H]];
const grp = (name, who, part, r, t = 1000) => ({ name, who, part, poly: sq(...r), pinned: true, t_ms: t, source: 'user', mask: encodeMask({ w: W, h: H, a: rect(...r) }) });

test('the picker, its chips, auto-naming and the modifiers never offer a knot part', () => {
  assert.ok(PARTS.includes('knot'), 'the vocabulary keeps it (old projects, the seeder head)');
  assert.ok(!PICK_PARTS.includes('knot') && !GENITALS.includes('knot') && !TARGETS.some((t) => t.part === 'knot'));
  assert.ok(!chipParts(['knot']).some((c) => c.part === 'knot'));
  assert.deepEqual(proposalOf({ part: [{ part: 'knot', p: 0.9 }, { part: 'penis', p: 0.1 }], conf: 0.9, auto: true }).parts.map((x) => x.part), ['penis']);
  assert.ok(!ARM.knotting.some(([, p]) => p === 'knot'));
});

test('foldKnots: a knot group on a penis of the same character and frame becomes its section; others stay as they are', () => {
  const pen = grp('c2_penis', 'c2', 'penis', [20, 10, 60, 20]), knot = grp('c2_knot', 'c2', 'knot', [22, 8, 30, 22]);   // a bulge a bit wider than the shaft
  const r = foldKnots([pen, knot]);
  assert.deepEqual(r.folded, ['c2_knot']); assert.equal(r.list.length, 1);
  const p = r.list[0], sec = knotOf(p, size), m = decodeMask(p.mask).a;
  assert.equal(p.name, 'c2_penis'); assert.ok(sec[15 * W + 25] >= 0.5 && sec[15 * W + 45] < 0.5, 'the section is the knot');
  assert.ok(m[9 * W + 25] >= 0.5, "the penis took the knot's pixels"); for (let i = 0; i < m.length; i++) if (sec[i] >= 0.5) assert.ok(m[i] >= 0.5, 'inside the penis');
  assert.equal(foldKnots([pen, grp('c1_knot', 'c1', 'knot', [22, 8, 30, 22])]), null, "another character's knot: left alone");
  assert.equal(foldKnots([pen, grp('c2_knot', 'c2', 'knot', [70, 30, 78, 40])]), null, 'far from the penis: left alone');
  assert.equal(foldKnots([pen, { ...knot, t_ms: 5000 }]), null, 'another frame: left alone');
  assert.equal(foldKnots([pen]), null);
  const touching = foldKnots([pen, grp('c2_knot', 'c2', 'knot', [61, 10, 66, 20])]);
  assert.ok(touching, 'abutting (within 2 px) folds too');
});

test('trackGroups: the penis carries its knot section (v4.54); an old knot group on it goes as the section; none: as before', () => {
  const pen = grp('c2_penis', 'c2', 'penis', [20, 10, 60, 20]), scenes = (gs) => [{ start_ms: 0, end_ms: 10000, groups: gs }];
  const plain = trackGroups(scenes([pen]), 0, 10000);
  assert.equal(plain.length, 1); assert.equal(plain[0].knot, undefined, 'no knot painted: no knot sent');
  const withSec = withKnot(pen, rect(20, 10, 30, 20), size), sent = trackGroups(scenes([withSec]), 0, 10000);
  assert.equal(sent.length, 1); assert.ok(sent[0].knot.some((q) => inPoly(q, 25 / W, 15 / H)) && !sent[0].knot.some((q) => inPoly(q, 45 / W, 15 / H)));
  assert.deepEqual(knotPolys(withSec), sent[0].knot);
  const old = trackGroups(scenes([pen, grp('c2_knot', 'c2', 'knot', [22, 10, 30, 20])]), 0, 10000);
  assert.deepEqual(old.map((g) => g.name), ['c2_penis'], 'no knot group of its own'); assert.ok(old[0].knot?.length);
  const apart = trackGroups(scenes([pen, grp('c2_knot', 'c2', 'knot', [70, 30, 78, 40])]), 0, 10000);
  assert.deepEqual(apart.map((g) => g.name), ['c2_penis', 'c2_knot'], 'a knot group not on a penis keeps working as before');
});

// ---- the store
async function tool() {
  const { fileURLToPath } = await import('node:url');
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const M = await server.ssrLoadModule('/dev/mock-app.js'), GS = await server.ssrLoadModule('/src/features/tracking/groups.svelte.js');
  const T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js'), GJ = await server.ssrLoadModule('/src/features/tracking/groups.js');
  const doc = { ...M.sampleDoc(), scenes: [{ start_ms: 0, end_ms: 30000 }], ghosts: [] };
  doc.media = { ...(doc.media || {}), path: 'C:\\clip.mp4' };
  const app = M.createMockApp({ doc, keys: false, backend: M.mockBackend() });
  app.tracking = T.trackingFor(app); app.mode = 'track';
  app.player.timeMs = 1000;
  const G = GS.groupsFor(app), toasts = [];
  app.toast = (m) => toasts.push(m);
  G.toggle(true);
  return { server, app, G, GJ, toasts };
}
const line = (G, x0, x1, y, erase = false) => { if (!G.begin(x0, y, erase)) return false; for (let i = 1; i <= 20; i++) G.move(x0 + ((x1 - x0) * i) / 20, y); G.end(); return true; };

test('the knot brush paints a section inside the penis: no new group, never outside it, Shift erases it, undo takes it back', async () => {
  const t = await tool();
  try {
    const { G, app, GJ } = t, { w, h } = G.size, at = (a, nx, ny) => a[Math.floor(ny * h) * w + Math.floor(nx * w)];
    assert.ok(line(G, 0.3, 0.6, 0.5));   // a stroke: a group
    const k0 = G.groups.length - 1;
    G.assign(k0, { who: 'c2', part: 'penis' });
    assert.equal(G.groups[k0].name, 'c2_penis');
    const n = G.groups.length, steps = app._history.entries.length;
    G.toggleKnot(true);
    assert.ok(line(G, 0.25, 0.4, 0.5));   // starts off the penis' end, runs onto it
    assert.equal(G.groups.length, n, 'no new group'); assert.equal(app._history.entries.length, steps + 1, 'one undo step');
    const p = G.groups[k0], sec = GJ.knotOf(p, G.size), pen = G.maskFor(p).a;
    assert.ok(at(sec, 0.35, 0.5) >= 0.5, 'the knot is painted'); assert.ok(at(sec, 0.55, 0.5) < 0.5, 'only where the brush went');
    for (let i = 0; i < sec.length; i++) if (sec[i] > 0) assert.ok(pen[i] >= 0.5, 'never outside the penis');
    assert.equal(p.name, 'c2_penis'); assert.ok(!G.groups.some((g) => /knot/.test(g.name)), 'never a knot group');
    assert.ok(GJ.trackGroups(app.doc.scenes, 0, 30000)[0].knot?.length, 'Track gets the section');
    assert.ok(line(G, 0.3, 0.38, 0.5, true), 'Shift erases the knot');
    assert.ok(at(GJ.knotOf(G.groups[k0], G.size) || new Float32Array(w * h), 0.34, 0.5) < 0.5);
    assert.ok(G.maskFor(G.groups[k0]).a[Math.floor(0.5 * h) * w + Math.floor(0.34 * w)] >= 0.5, 'the penis itself untouched');
    app.undo();
    assert.ok(at(GJ.knotOf(G.groups[k0], G.size), 0.34, 0.5) >= 0.5, 'undo: back');
    // with another part active, a knot stroke off any penis: nothing, said why
    G.toggleKnot(false);
    assert.ok(line(G, 0.8, 0.9, 0.15));   // another group, active now
    const n2 = G.groups.length;
    G.toggleKnot(true);
    assert.equal(G.begin(0.85, 0.15, false), false, 'not on a penis: no stroke'); assert.equal(G.groups.length, n2);
    assert.ok(t.toasts.some((m) => /start on one/.test(m)));
    G.pick(k0);
    // the plain brush erasing the penis takes the section with it there
    G.toggleKnot(false);
    assert.ok(line(G, 0.3, 0.38, 0.5, true));
    const sec2 = GJ.knotOf(G.groups[k0], G.size);
    assert.ok(!sec2 || at(sec2, 0.34, 0.5) < 0.5, 'the section stays inside the penis');
  } finally { await t.server.close(); }
});

test('the tool folds an old knot group on the penis into its section once (one undo step, said)', async () => {
  const t = await tool();
  try {
    const { G, app, GJ, toasts } = t, { w, h } = G.size;
    const r = (x0, y0, x1, y1) => { const a = new Float32Array(w * h); for (let y = Math.round(y0 * h); y < Math.round(y1 * h); y++) for (let x = Math.round(x0 * w); x < Math.round(x1 * w); x++) a[y * w + x] = 1; return a; };
    const mk = (name, part, box) => ({ name, who: 'c2', part, poly: [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]], pinned: true, t_ms: 1000, source: 'user', mask: GJ.encodeMask({ w, h, a: r(...box) }) });
    G.toggle(false);
    app.doc.scenes = [{ start_ms: 0, end_ms: 30000, groups: [mk('c2_penis', 'penis', [0.3, 0.45, 0.6, 0.55]), mk('c2_knot', 'knot', [0.32, 0.43, 0.38, 0.57])] }];
    G.toggle(true);
    assert.deepEqual(G.groups.map((g) => g.name), ['c2_penis']);
    assert.ok(GJ.knotOf(G.groups[0], G.size), 'the section');
    assert.ok(toasts.some((m) => /section of the penis/.test(m)));
    app.undo();
    assert.deepEqual(app.doc.scenes[0].groups.map((g) => g.name), ['c2_penis', 'c2_knot'], 'Ctrl+Z: the old groups back');
  } finally { await t.server.close(); }
});
