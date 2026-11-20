// paw-rxr3: while a track's shaft pass runs (sidecar v4.44: stage "shaft" progress with t_ms + outline) the video shows
// the frame being worked on through the player's scrub path, the lanes' band sits at that frame, the label counts the
// pass, and the playhead goes back to where it was when the stage ends (or the job does: cancel, error).
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('stageFollow: scrubs to each shown frame (rate-capped), slower without a scrubber, and puts the playhead back', async () => {
  const { fileURLToPath } = await import('node:url');
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  try {
    const { stageFollow } = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
    let clock = 0;
    const calls = [], player = { playing: false, timeMs: 4200, scrubStats: null, scrub: (ms) => calls.push(ms) };
    const f = stageFollow(player, { now: () => clock });
    const sh = (t) => ({ type: 'progress', stage: 'shaft', done: 1, total: 1000, t_ms: t, outline: [[0, 0], [1, 0], [1, 1]] });
    f.event({ type: 'progress', stage: 'points', done: 9, total: 9 });   // before the pass: nothing
    f.event(sh(100)); clock += 30; f.event(sh(133)); clock += 40; f.event(sh(166));   // 15 a second at most
    f.event({ type: 'progress', stage: 'shaft', done: 500, total: 1000 });   // a fraction without a frame: still the pass
    assert.deepEqual(calls, [100, 166]);
    f.event({ type: 'progress', stage: 'points', done: 9, total: 9 });
    assert.deepEqual(calls, [100, 166, 4200], 'the stage ended: back to where the playhead was');
    f.end(); assert.equal(calls.length, 3, 'once');
    player.scrubStats = { error: 'no WebCodecs' }; clock += 1000;
    f.event(sh(300)); clock += 100; f.event(sh(333)); clock += 200; f.event(sh(366));
    assert.deepEqual(calls.slice(3), [300, 366], 'each call would seek the <video>: a few a second');
    f.end(); assert.equal(calls.at(-1), 4200, 'a cancel puts it back too');
    player.playing = true; f.event(sh(500)); assert.equal(calls.at(-1), 4200, 'never while playing');
  } finally { await server.close(); }
});

test('the store: a track\'s shaft pass drives the label, the band and the outline, and the playhead comes back', async () => {
  const { fileURLToPath } = await import('node:url');
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  try {
    const M = await server.ssrLoadModule('/dev/mock-app.js'), T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
    const app = M.createMockApp({ doc: { ...M.sampleDoc(), ghosts: [], scenes: [] }, keys: false }), tr = T.trackingFor(app);
    tr.path = tr.videoPath;
    const scrubs = [], seen = [];
    app.player.scrub = (ms) => scrubs.push(ms);
    const t = Array.from({ length: 90 }, (_, i) => Math.round((i * 1000) / 30));
    app.backend.sidecar = async (q, h) => {
      if (q.cmd !== 'track') return { result: null, error: null, cancelled: true };
      h.onFrames(t.map((ms) => ({ t_ms: ms, value: 0.5, overlay: null })));
      const home = app.player.timeMs;
      h.onEvent({ type: 'progress', done: 90, total: 90, stage: 'points' });
      for (const [k, ms] of [[0, 1000], [1, 1500], [2, 2000]]) {
        h.onEvent({ type: 'progress', done: 250 * (k + 1), total: 1000, stage: 'shaft', t_ms: ms, outline: [[0.4, 0.4], [0.5, 0.4], [0.5, 0.6]] });
        seen.push({ label: tr.progressLabel, frac: tr.progressFrac, at: tr.progress.at, outline: tr.progress.outline?.length });
        await new Promise((r) => setTimeout(r, 80));   // past the 15 / s cap
      }
      h.onEvent({ type: 'progress', done: 90, total: 90, stage: 'points' });
      seen.push({ label: tr.progressLabel, at: tr.progress.at, outline: tr.progress.outline, home });
      const result = { type: 'result', samples: t.map((ms) => [ms, 0.5]), points: [{ at: 0, pos: 10 }, { at: 2900, pos: 90 }], scenes: [{ start_ms: 0, end_ms: 3000, sign: 1 }], notes: [], channels: {} };
      h.onEvent(result);
      return { result, error: null, cancelled: false };
    };
    const r = await tr.runTrack({ id: 'fake.box', name: 'Fake box', params: [] }, { start: 0, end: 3000 }, {}, { kind: 'box', x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, [], { check: false });
    assert.ok(r.run);
    assert.deepEqual(seen.slice(0, 3).map((s) => s.label), ['25 % · shaft pass', '50 % · shaft pass', '75 % · shaft pass']);
    assert.deepEqual(seen.slice(0, 3).map((s) => [s.frac, s.at, s.outline]), [[1000 / 3000, 1000, 3], [0.5, 1500, 3], [2000 / 3000, 2000, 3]], 'the band sits at the frame shown');
    assert.deepEqual(seen[3].at, null); assert.equal(seen[3].outline, null);
    assert.deepEqual(scrubs, [1000, 1500, 2000, seen[3].home], 'the frames, then back to the playhead before the pass');
  } finally { await server.close(); }
});
