// valence-fake-hub.mjs -- a minimal in-process Valence hub for the link tests (not a test file itself). It speaks the
// wire through createSession's WebSocketImpl seam, from SPEC.md: HELLO -> WELCOME (etag fast path, or the readiness gate:
// BLOB_REQ -> BLOB_CHUNKs of the catalog, CATALOG_READY), retained `safety`, SUBSCRIBE -> GRANT + retained STATE, CLOCK, PING,
// PUBLISH -> granted_publishes, STREAM bundles decoded against the catalog layout, the safety-intents pause / resume
// with their ECHO and the latched snapshot, PAIR_REQ -> PAIR_GRANT (control), GOODBYE. Tokenless HELLO is watch.
// Not a conformance double: no chunk repair, no rate limiting, no deadman, no source arbitration.
import { readFileSync } from 'node:fs';
import { cbUint, cbBstr, cbTstr, cbF32, cbArray, cbMap, cbDecodeFull } from '../src/lib/valence/vendor/cbor.js';
import { FRAME, K, ACCESS, CH_SAFETY, CH_SAFETY_INTENTS, CH_CATALOG, LIMITS, encodeFrame, parseFrames } from '../src/lib/valence/vendor/frames.js';
import { decodeCatalog, decodePacked, encodePacked } from '../src/lib/valence/vendor/catalog.js';
import { catalogEtag, bytesEqual } from '../src/lib/valence/vendor/sha256.js';

export const CATALOG = new Uint8Array(readFileSync(new URL('./fixtures/valence/neutrino-catalog.bin', import.meta.url)));
export const ETAG = catalogEtag(CATALOG, 8);
export const catalogStore = () => ({ load: () => ({ etag: ETAG, bytes: CATALOG }), save() {}, clear() {} });

const map = (pairs) => cbMap(pairs.slice().sort((a, b) => a[0] - b[0]));
const nowUs = () => Math.floor(performance.now() * 1000) >>> 0;

/** values: {channelId: {fieldName: value}} retained STATE beyond the zeroed defaults. */
export function createFakeHub({ values = {} } = {}) {
  const entries = decodeCatalog(CATALOG), byId = new Map(entries.map((e) => [e.id, e]));
  const hub = { sockets: [], segments: [], hellos: [], echoes: [], goodbyes: 0, word: 0, values };
  let cfgGen = 1, sid = 0x5e551d00;

  const send = (ws, type, ch, payload, seq = 0) => {
    if (ws.readyState !== 1) return;
    const f = encodeFrame(type, ch, payload, seq);
    queueMicrotask(() => ws.onmessage?.({ data: f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) }));
  };
  const stateOf = (ch) => {
    if (ch === CH_SAFETY) { const b = new Uint8Array(9); b[0] = hub.word; return b; }
    const e = byId.get(ch);
    const v = Object.fromEntries((e.layout || []).map((f) => [f.name, 0]));
    return encodePacked({ ...v, ...(hub.values[ch] || {}) }, e.layout);
  };
  hub.push = (ch) => { for (const ws of hub.sockets) if (ws.subs?.has(ch)) send(ws, FRAME.STATE, ch, stateOf(ch)); };

  function onFrame(ws, h, p) {
    switch (h.type) {
      case FRAME.HELLO: {
        const m = cbDecodeFull(p);
        hub.hellos.push(m);
        ws.roles = m.has(K.token) ? ACCESS.control : ACCESS.watch;
        ws.subs = new Set([CH_SAFETY]);
        ws.ready = m.has(K.catalog_etag) && bytesEqual(m.get(K.catalog_etag), ETAG);
        const grants = [map([[K.channel_id, cbUint(CH_SAFETY)], [K.granted_rate_hz, cbF32(0)], [K.priority, cbUint(3)]])];
        send(ws, FRAME.WELCOME, 0, map([
          [K.proto_ver, cbUint(1)], [K.session_id, cbUint(++sid)], [K.boot_id, cbUint(0xb007cafe)],
          [K.catalog_etag, cbBstr(ETAG)], [K.cfg_gen, cbUint(cfgGen)], [K.roles, cbUint(ws.roles)],
          [K.limits, map([[1, cbUint(4096)], [3, cbUint(1)]])], [K.deadman_ms, cbUint(2000)],
          [K.grants, cbArray(grants)],
          [K.identity, map([[1, cbTstr('Fake')], [2, cbTstr('1.0')], [3, cbTstr('Fake hub')]])],
        ]));
        if (ws.ready) send(ws, FRAME.STATE, CH_SAFETY, stateOf(CH_SAFETY));
        break;
      }
      case FRAME.BLOB_REQ: {   // the whole catalog, every chunk (SPEC §8.4)
        const C = LIMITS.catalog_chunk_payload, n = Math.ceil(CATALOG.length / C);
        hub.blobRequests = (hub.blobRequests || 0) + 1;
        for (let i = 0; i < n; i++) {
          const body = CATALOG.subarray(i * C, (i + 1) * C), out = new Uint8Array(14 + body.length), dv = new DataView(out.buffer);
          dv.setUint16(6, i, true); dv.setUint16(8, n, true); dv.setUint32(10, CATALOG.length, true); out.set(body, 14);
          send(ws, FRAME.BLOB_CHUNK, CH_CATALOG, out);
        }
        break;
      }
      case FRAME.CATALOG_READY: {
        if (ws.ready || !bytesEqual(p, ETAG)) break;
        ws.ready = true;
        for (const ch of ws.subs) send(ws, FRAME.STATE, ch, stateOf(ch));
        break;
      }
      case FRAME.SUBSCRIBE: {
        const wishes = cbDecodeFull(p).get(K.subscriptions) || [];
        const ok = wishes.map((w) => w.get(K.channel_id)).filter((ch) => byId.has(ch));
        send(ws, FRAME.GRANT, 0, map([[K.grants, cbArray(ok.map((ch) => map([[K.channel_id, cbUint(ch)], [K.granted_rate_hz, cbF32(20)], [K.priority, cbUint(1)]])))]]));
        for (const ch of ok) { ws.subs.add(ch); if (ws.ready) send(ws, FRAME.STATE, ch, stateOf(ch)); }
        break;
      }
      case FRAME.CLOCK: {
        const t0 = new DataView(p.buffer, p.byteOffset, 4).getUint32(0, true), out = new Uint8Array(12), dv = new DataView(out.buffer);
        dv.setUint32(0, t0, true); dv.setUint32(4, nowUs(), true); dv.setUint32(8, nowUs(), true);
        send(ws, FRAME.CLOCK, 0, out);
        break;
      }
      case FRAME.PING: send(ws, FRAME.PONG, 0, p); break;
      case FRAME.PUBLISH: {
        const wishes = cbDecodeFull(p).get(K.publishes) || [];
        const ok = ws.roles >= ACCESS.control ? wishes.filter((w) => byId.get(w.get(K.channel_id))?.dirName === 'c2h') : [];
        send(ws, FRAME.GRANT, 0, map([[K.grants, cbArray([])], [K.granted_publishes, cbArray(ok.map((w) => map([
          [K.channel_id, cbUint(w.get(K.channel_id))], [K.granted_rate_hz, cbF32(Math.min(w.get(K.rate_hz), byId.get(w.get(K.channel_id)).maxRateHz || 50))],
          ...(w.has(K.burst) ? [[K.burst, cbF32(w.get(K.burst))]] : []),
        ])))]]));
        break;
      }
      case FRAME.STREAM: {
        const e = byId.get(h.channel), dv = new DataView(p.buffer, p.byteOffset, p.byteLength), n = p[4];
        const size = (p.length - 6 - 2 * n) / n;
        for (let i = 0; i < n; i++) {
          const rec = decodePacked(p.subarray(6 + 2 * n + i * size, 6 + 2 * n + (i + 1) * size), e.layout);
          hub.segments.push({ channel: h.channel, tBase: dv.getUint32(0, true), tOff: dv.getUint16(6 + 2 * i, true), atUs: nowUs(), rec, word: hub.word });
        }
        break;
      }
      case FRAME.INTENT: {
        const m = cbDecodeFull(p), id = m.get(K.intent_id), value = m.get(K.value), op = value?.get(1);
        if (h.channel !== CH_SAFETY_INTENTS || ![4, 5].includes(op) || (op === 5 && ws.roles < ACCESS.control)) {
          send(ws, FRAME.NACK, 0, map([[K.code, cbUint(0x0300)], [K.channel_id, cbUint(h.channel)], [K.intent_id, cbUint(id)]]));
          break;
        }
        hub.word = op === 4 ? hub.word | 0x08 : hub.word & ~0x08;
        hub.echoes.push(op);
        send(ws, FRAME.ECHO, h.channel, map([[K.cfg_gen, cbUint(cfgGen)], [K.intent_id, cbUint(id)], [K.applied, map([[1, cbUint(op)]])]]), h.seq);
        hub.push(CH_SAFETY);
        break;
      }
      case FRAME.PAIR_REQ: {
        ws.roles = ACCESS.control;
        send(ws, FRAME.PAIR_GRANT, 0, map([[K.token, cbBstr(Uint8Array.from({ length: 16 }, (_, i) => i))], [K.roles, cbUint(ACCESS.control)]]));
        break;
      }
      case FRAME.GOODBYE: hub.goodbyes++; ws.close(); break;
      default: break;
    }
  }

  hub.WebSocket = class FakeWS {
    constructor(url, protocols) {
      this.url = url; this.protocol = protocols?.[0] || ''; this.readyState = 0;
      hub.sockets.push(this);
      setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 1);
    }
    send(bytes) {
      if (this.readyState !== 1) return;
      const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      for (const { header, payload } of parseFrames(b)) onFrame(this, header, payload);
    }
    close() {
      if (this.readyState >= 2) return;
      this.readyState = 3;
      queueMicrotask(() => this.onclose?.({ code: 1000, reason: '' }));
    }
  };
  /** The transport dies under the client (no GOODBYE). */
  hub.drop = () => { for (const ws of hub.sockets) ws.close(); };
  return hub;
}
