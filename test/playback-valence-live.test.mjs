// Valence link against a real hub: Nucleus's device twin neutrino-sim (real catalog, real Kinetic planner, real
// arbiter). Skipped unless PAWSCRIPT_NEUTRINO_EXE names the exe (copy it out of Nucleus/sim/neutrino/build first; it
// writes only its --state files, here under the OS temp dir). Runs the twin on random 127.0.0.1 ports, no discovery,
// no ESTOP datagrams, its window hidden; the run ends with the test (stdin pipe + --duration).
// Covers: cold connect with a real catalog transfer (blob ns 0, SHA-256, CATALOG_READY), watch -> knock in the
// push-to-pair window -> token, the publish grant, segments that move the carriage (telemetry.position against the
// window), a sine played through the scheduler (tracking RMS), pause / resume ECHO and latch, halt -> release -> PAUSE,
// and a second back-to-back session presenting the stored token (etag fast
// path, source released by the first session: SPEC §6.9's mandatory verification pattern).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createValenceLink, toHex } from '../src/lib/valence/link.js';
import { ACCESS } from '../src/lib/valence/vendor/frames.js';
import { createScheduler, toDevice } from '../src/features/playback/scheduler.js';
import { posAt } from '../src/lib/core/script.js';

const EXE = process.env.PAWSCRIPT_NEUTRINO_EXE;
const skip = !EXE || !existsSync(EXE) ? 'set PAWSCRIPT_NEUTRINO_EXE to a neutrino-sim.exe copy' : false;

const freePort = () => new Promise((res) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const wait = async (cond, ms, what) => {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timed out: ' + what); await new Promise((r) => setTimeout(r, 10)); }
};
const memStore = () => { const m = new Map(); return { load: (h) => m.get(h) || null, save: (h, etag, bytes) => m.set(h, { etag, bytes }), clear: (h) => m.delete(h), m }; };

test('live: Pawscript link drives neutrino-sim', { skip, timeout: 60000 }, async (ctx) => {
  const [port, http] = [await freePort(), await freePort()];
  const dir = mkdtempSync(join(tmpdir(), 'paw-valence-'));
  const hub = spawn(EXE, ['--port', String(port), '--bind', '127.0.0.1', '--http', String(http), '--homed', '--pairing-window',
    '--no-discovery', '--no-estop-udp', '--state', join(dir, 'nsim'), '--duration', '90', '--exit-with-stdin'],
  { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let log = '';
  hub.stdout.on('data', (d) => { log += d; });
  hub.stderr.on('data', (d) => { log += d; });
  const links = [];
  ctx.after(() => { for (const l of links) l.close(); hub.stdin.end(); hub.kill(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* the exe may still hold it */ } });
  await wait(() => /listening on/.test(log), 10000, 'neutrino listening');

  const store = memStore(), iid = Uint8Array.of(9, 8, 7, 6, 5, 4, 3, 2);
  let token = null;
  const A = createValenceLink({ host: '127.0.0.1', port, instanceId: iid, catalogStore: store, WebSocketImpl: WebSocket, onToken: (t) => { token = t; } });
  links.push(A);
  A.connect();
  await wait(() => A.status.phase === 'live', 15000, 'LIVE after a cold catalog transfer');
  assert.equal(store.m.size, 1, 'catalog fetched, verified and cached');
  assert.equal(A.status.roles, ACCESS.watch, 'tokenless HELLO is watch');
  assert.ok(A.status.stream != null, 'segments stream found by role');
  assert.match(A.status.hubName || '', /\S/);
  assert.equal(A.segment(0.5, 300).ok, false);

  assert.ok(A.pair());
  await wait(() => token && A.status.canPlay, 5000, 'pair grant + publish grant');
  assert.equal(token.length, 16);
  assert.ok(A.status.roles >= ACCESS.control);
  await wait(() => A.status.window && A.status.position != null && !A.status.stale, 5000, 'telemetry and window');

  const moveTo = async (L, norm) => {
    assert.deepEqual(L.segment(norm, 700, 0), { ok: true });
    await wait(() => Math.abs(L.status.position - norm) < 0.04, 5000, `carriage at ${norm} (now ${L.status.position})`);
  };
  await moveTo(A, 0.8);
  await moveTo(A, 0.2);

  // The playback path: a 1 Hz sine (knots every 125 ms) through the scheduler in real time; the carriage follows.
  const script = Array.from({ length: 33 }, (_, i) => ({ at: i * 125, pos: Math.round(50 + 30 * Math.sin(2 * Math.PI * i / 8)) }));
  const st = A.status, sched = createScheduler({ send: (c) => assert.equal(A.segment(c.pos, c.durMs, c.endVel).ok, true) });
  sched.configure({ latencyMs: st.latencyMs, minIntervalMs: 1000 / st.rateHz });
  const t0 = performance.now() + 1200, rec = [];
  await new Promise((done) => {
    const iv = setInterval(() => {
      const now = performance.now(), m = now - t0;
      sched.tick(now, { script, playing: true, rate: 1, mediaMs: m });
      if (m > 1000 && m < 3800 && !A.status.stale) rec.push([m, A.status.position]);
      if (m > 4100) { clearInterval(iv); done(); }
    }, 5);
  });
  let best = Infinity;   // RMS at the best lag 0..150 ms (telemetry is a 20 Hz STATE plus transport)
  for (let lag = 0; lag <= 150; lag += 5) best = Math.min(best, Math.sqrt(rec.reduce((e, [m, p]) => e + (p - toDevice(posAt(script, m - lag))) ** 2, 0) / rec.length));
  const amp = Math.max(...rec.map((r) => r[1])) - Math.min(...rec.map((r) => r[1]));
  assert.ok(rec.length > 30 && best < 0.05, `tracking RMS ${best.toFixed(3)} of the window`);
  assert.ok(amp > 0.5, `stroke ${amp.toFixed(2)} of the scripted 0.6`);

  const p = await A.pause();
  assert.equal(p.applied[1], 4, 'pause ECHO');
  await wait(() => A.status.paused, 2000, 'PAUSE latched in the safety snapshot');
  assert.equal(A.segment(0.6, 300).reason, 'paused on the hub');
  const r = await A.resume();
  assert.equal(r.applied[1], 5, 'resume ECHO');
  await wait(() => !A.status.paused && A.status.canPlay, 2000, 'PAUSE cleared');

  await A.estop();
  await wait(() => A.status.estop, 2000, 'ESTOP latched');
  assert.equal(A.status.estopCutsPower, false, 'the twin without --motor-switch halts: the control reads Halt');
  assert.equal(A.segment(0.6, 300).reason, 'halted on the hub');
  await new Promise((r) => setTimeout(r, 300));   // release needs zero velocity (SPEC §11.2)
  await A.release();
  await wait(() => !A.status.estop && A.status.paused, 2000, 'release lands in PAUSE');
  await A.resume();
  await wait(() => A.status.canPlay, 2000, 'resumed');
  A.close();

  const B = createValenceLink({ host: '127.0.0.1', port, instanceId: iid, token, catalogStore: store, WebSocketImpl: WebSocket });
  links.push(B);
  B.connect();
  await wait(() => B.status.canPlay, 5000, 'second session: token at HELLO, grant');
  assert.ok(B.status.roles >= ACCESS.control, 'stored token presented: ' + toHex(token));
  await wait(() => B.status.position != null && !B.status.stale, 5000, 'telemetry');
  await moveTo(B, 0.7);
  B.close();
});
