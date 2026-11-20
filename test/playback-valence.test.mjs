// Valence playback: the vendored wire against golden bytes, the device catalog fixture (etag, role resolution), the
// link against an in-process fake hub (connect -> pair -> grant -> segment -> pause/resume ECHO -> telemetry), and the
// scheduler -> segments cadence. The real-hub run is playback-valence-live.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cbUint, cbF32, cbTstr, cbBstr, cbArray, cbMap } from '../src/lib/valence/vendor/cbor.js';
import { FRAME, K, PRIORITY, ACCESS, CH_SAFETY, encodeFrame, encodeBundle } from '../src/lib/valence/vendor/frames.js';
import { decodeCatalog, encodePacked, decodePacked } from '../src/lib/valence/vendor/catalog.js';
import { catalogEtag, toHex as hex8 } from '../src/lib/valence/vendor/sha256.js';
import { createValenceLink, motionStream, segmentRecord, roleField, toHex, fromHex, LEAD_MS } from '../src/lib/valence/link.js';
import { createScheduler, knotVel, GAP_MS } from '../src/features/playback/scheduler.js';
import { createFakeHub, catalogStore, CATALOG } from './valence-fake-hub.mjs';

const H = (b) => Buffer.from(b).toString('hex').toUpperCase();
const wait = async (cond, ms = 2000) => {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 5)); }
};

test('wire: vendored codec reproduces the reference goldens (clients/js valence-wire, WireSelfTest.cs)', () => {
  const inst = Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7);
  const hello = cbMap([[K.proto_ver, cbUint(1)], [K.client_kind, cbTstr('probe')], [K.client_name, cbTstr('valence_probe.py')],
    [K.instance_id, cbBstr(inst)], [K.publishes, cbArray([cbMap([[K.rate_hz, cbF32(100)], [K.channel_id, cbUint(0x2100)]])])]]);
  assert.equal(H(encodeFrame(FRAME.HELLO, 0, hello, 0)),
    '0000000000003300A50101026570726F6265037076616C656E63655F70726F62652E7079044800010203040506070B81A20CFA42C800000F192100');
  const sub = cbMap([[K.subscriptions, cbArray([[0x0003, 0, PRIORITY.critical], [0x1100, 20, PRIORITY.elevated]]
    .map(([ch, r, p]) => cbMap([[K.rate_hz, cbF32(r)], [K.priority, cbUint(p)], [K.channel_id, cbUint(ch)]])))]]);
  assert.equal(H(sub), 'A10A82A30CFA000000000D030F03A30CFA41A000000D020F191100');
  assert.equal(H(encodeFrame(FRAME.PING, 0, new Uint8Array(0), 0)), '0300000000000000');
});

test('catalog fixture: etag is the SHA-256 prefix (SPEC §8.3); motion and telemetry resolve by role', () => {
  const etag = readFileSync(new URL('./fixtures/valence/neutrino-catalog.etag', import.meta.url), 'utf8').trim();
  assert.equal(hex8(catalogEtag(CATALOG, 8)), etag);
  const entries = decodeCatalog(CATALOG), st = motionStream(entries);
  assert.ok(st, 'segments stream found');
  const e = entries.find((x) => x.id === st.id);
  assert.equal(e.dirName, 'c2h');
  assert.equal(st.target, 'target_norm');
  assert.equal(st.dName, 'duration_ms');
  assert.equal(st.vName, 'end_vel_norm');
  assert.equal(st.blank.end_vel_norm, -32.768, 'unspecified = i16 minimum (SPEC §5.4)');
  assert.equal(roleField(entries, 'telemetry.position').unit, 'mm');
  assert.ok(roleField(entries, 'window.min') && roleField(entries, 'window.max'));
  assert.equal(motionStream(entries.filter((x) => x.id !== st.id)), null, 'no stream is ever guessed');
});

test('segment record: packs {target u16 x10000, duration u16 ms, end_vel i16 x1000} with the sentinel', () => {
  const entries = decodeCatalog(CATALOG), st = motionStream(entries), L = entries.find((x) => x.id === st.id).layout;
  assert.equal(H(encodePacked(segmentRecord(st, 0.25, 300, -1.5), L)), 'C4092C0124FA');
  assert.equal(H(encodePacked(segmentRecord(st, 0.25, 300, null), L)), 'C4092C010080', 'null end velocity = unspecified');
  assert.equal(H(encodePacked(segmentRecord(st, 7, -5, 99), L)), '10270000FF7F', 'clamped, never the sentinel');
  const b = encodeBundle(0x01020304, [0], [encodePacked(segmentRecord(st, 1, 65, 0), L)], { unitUs: 100, spanCapUs: 250000 });
  assert.equal(H(b), '040302010100000010274100' + '0000');
  assert.deepEqual(decodePacked(encodePacked(segmentRecord(st, 0.5, 120, 2), L), L), { target_norm: 0.5, duration_ms: 120, end_vel_norm: 2 });
});

test('knotVel: PCHIP tangent through, rest at reversals, holds, ends and gaps; device units per wall second', () => {
  const sc = [{ at: 0, pos: 0 }, { at: 100, pos: 50 }, { at: 200, pos: 100 }, { at: 300, pos: 0 }, { at: 400, pos: 0 }, { at: 1400, pos: 50 }, { at: 1500, pos: 60 }];
  assert.equal(knotVel(sc, 0), 0);
  assert.equal(knotVel(sc, 1), 5, '50 pos per 100 ms both sides = 0.5 norm per 0.1 s = 5 /s');
  assert.equal(knotVel(sc, 1, 2), 10, 'twice the rate, twice the speed');
  assert.equal(knotVel(sc, 1, 1, { lo: 0, hi: 50, invert: true }), -2.5, 'range and invert map like toDevice');
  assert.equal(knotVel(sc, 2), 0, 'reversal');
  assert.equal(knotVel(sc, 3), 0, 'hold edge');
  assert.equal(knotVel(sc, 4), 0, `successor ${1000} ms away > GAP_MS ${GAP_MS}`);
  assert.equal(knotVel(sc, 6), 0, 'last knot');
  const s = knotVel([{ at: 0, pos: 0 }, { at: 100, pos: 10 }, { at: 400, pos: 100 }], 1);
  assert.ok(s > 1 && s < 3 * 1, 'uneven chords: inside the Fritsch-Carlson band [0, 3 min]');
});

test('link vs fake hub: watch -> pair -> grant -> segment -> pause/resume ECHO -> telemetry -> GOODBYE', async (ctx) => {
  const hub = createFakeHub({ values: { 0x1100: { pos_10um: 125 }, 0x1000: { window_min: 100, window_max: 200 } } });
  const tokens = [], seen = [];
  const link = createValenceLink({ host: 'fake', port: 1, instanceId: fromHex('0102030405060708'), WebSocketImpl: hub.WebSocket,
    catalogStore: catalogStore(), onToken: (t) => tokens.push(toHex(t)), onChange: (s) => seen.push(s.phase) });
  ctx.after(() => link.close());
  assert.equal(link.status.phase, 'closed');
  assert.equal(link.segment(0.5, 100).reason, 'not connected');
  link.connect();
  await wait(() => link.status.phase === 'live');
  assert.ok(seen.includes('connecting') || seen.includes('syncing'), 'SYNCING is distinct from LIVE');
  const hello = hub.hellos[0];
  assert.equal(hello.get(K.client_kind), 'pawscript');
  assert.equal(hello.get(K.client_name), 'Pawscript');
  assert.equal(toHex(hello.get(K.instance_id)), '0102030405060708');
  assert.ok(!hello.has(K.token), 'no token: watch');
  assert.equal(toHex(hello.get(K.catalog_etag)), toHex(catalogEtag(CATALOG, 8)), 'etag fast path');
  assert.equal(link.status.roles, ACCESS.watch);
  assert.equal(link.status.why, 'watch only: request control');
  assert.equal(link.segment(0.5, 100).ok, false);

  assert.ok(link.pair());
  await wait(() => link.status.canPlay);
  assert.deepEqual(tokens, ['000102030405060708090a0b0c0d0e0f']);
  assert.equal(link.status.rateHz, 50);
  assert.equal(link.status.latencyMs, LEAD_MS);
  const r = link.segment(0.25, 300, -1.5);
  assert.deepEqual(r, { ok: true });
  await wait(() => hub.segments.length === 1);
  const g = hub.segments[0];
  assert.equal(g.channel, 0x2101);
  assert.deepEqual(g.rec, { target_norm: 0.25, duration_ms: 300, end_vel_norm: -1.5 });
  const lead = ((g.tBase - g.atUs) | 0) / 1000;
  assert.ok(lead > LEAD_MS - 20 && lead <= LEAD_MS + 5, `stamped ~${LEAD_MS} ms ahead of hub time (got ${lead})`);

  await link.pause();
  await wait(() => link.status.paused);
  assert.deepEqual(hub.echoes, [4]);
  assert.equal(link.segment(0.5, 100).reason, 'paused on the hub');
  const echo = await link.resume();
  assert.equal(echo.applied[1], 5, 'ECHO carries the applied op');
  await wait(() => !link.status.paused);
  assert.equal(link.segment(0.5, 100).ok, true);

  await wait(() => link.status.positionMm != null && link.status.window);
  assert.equal(link.status.positionMm, 125, 'pos_10um decoded by the catalog scale (10 um steps -> mm)');
  assert.equal(link.status.unit, 'mm');
  assert.equal(link.status.position, 0.25, 'telemetry normalized against the reported window');
  hub.values[0x1100] = { pos_10um: 150 };
  hub.push(0x1100);
  await wait(() => link.status.positionMm === 150);
  assert.equal(link.status.position, 0.5);
  assert.equal(link.status.stale, false);

  link.close();
  await wait(() => hub.goodbyes === 1);
  assert.equal(link.status.phase, 'closed');
});

test('link: a transport drop reconnects with the stored token, and nothing is sent until asked', async (ctx) => {
  const hub = createFakeHub();
  const link = createValenceLink({ host: 'fake', port: 1, token: fromHex('000102030405060708090a0b0c0d0e0f'), WebSocketImpl: hub.WebSocket, catalogStore: catalogStore() });
  ctx.after(() => link.close());
  link.connect();
  await wait(() => link.status.canPlay);
  assert.equal(link.status.roles, ACCESS.control);
  hub.drop();
  await wait(() => link.status.phase === 'reconnecting');
  assert.equal(link.segment(0.5, 100).reason, 'reconnecting');
  await wait(() => link.status.canPlay, 3000);
  assert.equal(hub.hellos.length, 2);
  assert.ok(hub.hellos[1].has(K.token));
  assert.equal(hub.segments.length, 0, 'a reconnect never sends motion by itself');
  link.close();
});

test('scheduler -> link: one segment per knot, sent latencyMs ahead, durations tile the script', async (ctx) => {
  const hub = createFakeHub();
  const link = createValenceLink({ host: 'fake', port: 1, token: new Uint8Array(16), WebSocketImpl: hub.WebSocket, catalogStore: catalogStore() });
  ctx.after(() => link.close());
  link.connect();
  await wait(() => link.status.canPlay);
  const st = link.status, out = [];
  const sched = createScheduler({ send: (c) => { out.push({ t, ...c }); assert.equal(link.segment(c.pos, c.durMs, c.endVel).ok, true); } });
  sched.configure({ latencyMs: st.latencyMs, minIntervalMs: 1000 / st.rateHz });
  const script = Array.from({ length: 9 }, (_, i) => ({ at: 1000 + i * 250, pos: i % 2 ? 90 : 10 }));
  let t = 0;
  const M0 = -500;   // media at t = 0: the first (slow, 1 s) transition lands before knot 0
  for (t = 0; t <= 3600; t += 5) sched.tick(t, { script, playing: true, rate: 1, mediaMs: M0 + t });
  await wait(() => hub.segments.length === out.length);
  const spans = out.filter((c) => c.why === 'span');
  assert.equal(out[0].why, 'transition');
  assert.equal(spans.length, script.length, 'every knot, once');
  for (const c of spans) {
    const k = script.findIndex((a) => Math.abs(a.at - (M0 + c.t + st.latencyMs + c.durMs)) <= 5);
    assert.ok(k >= 0, `span at ${c.t} ends on a knot`);
    if (k > 0) assert.ok(Math.abs(M0 + c.t + st.latencyMs - script[k - 1].at) <= 5, 'sent latencyMs before its start knot');
    assert.equal(c.pos, script[k].pos / 100);
    assert.equal(c.endVel, 0, 'zig-zag: every knot is a reversal');
  }
  const recs = hub.segments.map((s) => s.rec);
  assert.deepEqual(recs.slice(1).map((r) => r.target_norm), spans.map((c) => c.pos));
  link.close();
});
