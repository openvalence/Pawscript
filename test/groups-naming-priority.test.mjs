// paw-wzxu: the background part naming never blocks SAM. The owner's session: "Loosen / tighten: SAM is not available now" 327 times and
// "Grow: busy (name)" 79 times, all while a naming call ran; a naming call after every stroke (1,513 of them). The store with the REAL job
// queue (tracking.svelte.js job()) and a fake sidecar whose name_groups is slow: a grow dab / a dial notch during a naming call waits for it
// and gets SAM's answer (no refusal), the stale naming answer is dropped, rapid strokes make at most one naming call, never while painting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAME_MS = 300;

async function tool() {
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const M = await server.ssrLoadModule('/dev/mock-app.js'), GS = await server.ssrLoadModule('/src/features/tracking/groups.svelte.js');
  const T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js'), GJ = await server.ssrLoadModule('/src/features/tracking/groups.js');
  const log = [];   // [cmd, start, end] per sidecar request, in the order they ran
  let segFail = null;
  const be = Object.assign(M.mockBackend(), {
    async appPaths() { return { data_dir: 'C:\\data' }; },
    async fileFingerprint(p) { return { fingerprint: 'fp-' + p.length, size: 1 }; },
  });
  const doc = { ...M.sampleDoc(), scenes: [{ start_ms: 0, end_ms: 30000 }], ghosts: [] };
  doc.media = { ...(doc.media || {}), path: 'C:\\clip.mp4' };
  const app = M.createMockApp({ doc, keys: false, backend: be });
  const tr = app.tracking = T.trackingFor(app); app.mode = 'track';
  app.player.timeMs = 1000;
  const G = GS.groupsFor(app), toasts = [];
  app.toast = (m) => toasts.push(String(m));
  G.toggle(true);
  const { w, h } = G.size;
  const disc = (cx, cy, r) => { const a = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r ? 1 : 0; return GJ.encodeMask({ w, h, a }); };
  let running = 0;
  be.sidecar = async (req) => {
    assert.equal(running, 0, 'the queue never runs two requests at once'); running++;
    const row = [req.cmd, performance.now(), 0]; log.push(row);
    try {
      if (req.cmd === 'name_groups') { await sleep(NAME_MS); return { result: { blobs: req.masks.map((m) => (m.part ? { part: [] } : { part: [{ part: 'thighs', p: 0.97 }], conf: 0.97, auto: true })) }, error: null, cancelled: false }; }
      if (req.cmd === 'segment') {
        await sleep(5);
        if (segFail) return { result: null, error: segFail, cancelled: false };
        const [px, py] = req.pos?.[0] || [0.5, 0.5], grow = req.mask ? 1.3 : 1;   // a mask prompt (a dial notch): a bigger disc
        let r = 12 * grow;
        if (req.mask) { const m = GJ.decodeMask(req.mask); let n = 0; for (const v of m.a) if (v >= 0.5) n++; r = Math.sqrt(n / Math.PI) * 1.3; }
        return { result: { mask_wh: [w, h], cached: true, ms: {}, masks: [{ mask: disc(px * w, py * h, r), score: 0.9 }] }, error: null, cancelled: false };
      }
      return { result: null, error: 'no ' + req.cmd, cancelled: false };
    } finally { row[2] = performance.now(); running--; }
  };
  const names = () => log.filter((r) => r[0] === 'name_groups');
  const stroke = (x, y) => { assert.ok(G.begin(x, y, false)); G.move(x + 0.03, y); G.end(); };
  const settled = async () => { for (let i = 0; i < 400 && (G.growBusy || G.draft || G.dial || G.naming); i++) await sleep(10); };
  return { server, app, G, tr, log, toasts, names, stroke, settled, setSegFail: (e) => { segFail = e; } };
}

test('a grow dab while a naming call runs waits for it and gets SAM\'s answer; the stale naming answer is dropped', async () => {
  const t = await tool();
  try {
    const { G, log, toasts, names } = t;
    G.app.settings.set('tracking.groups.grow', false);
    t.stroke(0.2, 0.2);
    await sleep(1100);   // the pen rested 1 s: the naming call goes out
    assert.equal(names().length, 1, 'one naming call after the strokes stopped');
    assert.equal(t.tr.busy, 'name', 'it is running');
    G.app.settings.set('tracking.groups.grow', true);
    const n0 = G.groups.length, tDab = performance.now();
    assert.ok(G.begin(0.6, 0.6, false)); G.end();   // a grow dab, now
    await t.settled();
    assert.equal(G.groups.length, n0 + 1, 'SAM\'s mask made the new group');
    assert.ok(G.lastGrow, 'it came from SAM, not "painted as usual"');
    assert.ok(!toasts.some((m) => /busy|not available/.test(m)), 'no refusal: ' + toasts.join(' | '));
    const seg = log.find((r) => r[0] === 'segment'), first = names()[0];
    assert.ok(seg[1] >= first[2] - 1, 'the prompt ran the moment the naming call returned');
    // paw-g8k1: the dab waits for the naming call's rest and no longer, and is the very next request. (Dab -> mask in wall time
    // also counts the mask decode / pick / clean on this thread: a cold process on a loaded machine took 550-4400 ms at bc1e46d
    // too; the real-window groups-naming check times the dabs in the app.)
    const waited = seg[1] - tDab, rest = Math.max(0, first[2] - tDab);
    assert.ok(waited <= rest + 50, `the dab waited ${Math.round(waited)} ms for the naming call's rest (${Math.round(rest)} ms), no longer (dab -> mask ${G.lastGrow.ms} ms)`);
    assert.equal(log.indexOf(seg), log.indexOf(first) + 1, 'the prompt is the next request after the naming call');
    await t.settled();
    assert.equal(names().length, 2, 'the groups changed: one more round once the pen rested');
    assert.ok(G.groups.every((g) => G.proposalFor(g)?.parts[0].part === 'thighs'), 'the fresh round proposes every blob');
  } finally { await t.server.close(); }
});

test('rapid strokes make at most one naming call, never while painting; a stroke during a naming call drops its answer and asks again after', async () => {
  const t = await tool();
  try {
    const { G, names } = t;
    G.app.settings.set('tracking.groups.grow', false);
    for (let i = 0; i < 6; i++) { t.stroke(0.1 + i * 0.13, 0.3); await sleep(250); }
    assert.equal(names().length, 0, 'none while painting');
    await t.settled();
    assert.equal(names().length, 1, 'one call for six strokes');
    assert.equal(G.unassigned.length, 6);
    assert.ok(G.groups.every((g) => G.proposalFor(g)), 'all six proposed');
    // a stroke while a round is out: its answer is stale (dropped), the next round asks for the groups as they are
    t.stroke(0.5, 0.8); await sleep(1100);
    assert.equal(t.tr.busy, 'name');
    const before = new Map(G.proposals);
    t.stroke(0.5, 0.9);
    await sleep(NAME_MS + 50);
    assert.equal(G.proposals.size, before.size, 'the answer for the old groups was not applied');
    await t.settled();
    assert.equal(names().length, 3);
    assert.equal(G.unassigned.length, 8); assert.ok(G.groups.every((g) => G.proposalFor(g)), 'the next round named all eight');
    // Enter right after a stroke (no proposal yet) still names at once: proposalsSettled asks now
    t.stroke(0.9, 0.9);
    assert.ok(G.naming);
    await G.proposalsSettled();
    assert.ok(G.proposalFor(G.groups.at(-1)), 'proposal without waiting for the idle second');
  } finally { await t.server.close(); }
});

test('the loosen dial during a naming call asks SAM (no edge fallback, no toast); SAM really failing says why, once', async () => {
  const t = await tool();
  try {
    const { G, toasts } = t;
    G.app.settings.set('tracking.groups.grow', true);
    assert.ok(G.begin(0.5, 0.5, false)); G.end(); await t.settled();
    const g = G.groups[0];
    G.app.settings.set('tracking.groups.grow', false);
    t.stroke(0.15, 0.15); await sleep(1100);
    assert.equal(t.tr.busy, 'name');
    const c = g.poly.reduce((s, q, _, a) => [s[0] + q[0] / a.length, s[1] + q[1] / a.length], [0, 0]);   // the SAM group's middle
    assert.ok(G.dialNotch(1, c));
    await t.settled();
    assert.ok(!toasts.some((m) => /not available|busy/.test(m)), 'no refusal: ' + toasts.join(' | '));
    // SAM missing: the edge fallback, and the reason, once over two gestures
    t.setSegFail('RuntimeError: segment needs SAM 2 (the sam2 extra, its checkpoint on disk and a CUDA GPU)');
    assert.ok(G.dialNotch(1, c)); await t.settled();
    assert.ok(G.dialNotch(-1, c)); await t.settled();
    const said = toasts.filter((m) => /Loosen \/ tighten: SAM is not available/.test(m));
    assert.equal(said.length, 1, 'once: ' + said.join(' | '));
    assert.match(said[0], /needs SAM 2/, 'with the reason');
  } finally { await t.server.close(); }
});
