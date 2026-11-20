// link.js -- Pawscript's Valence client: one hub session cut to what a funscript player needs. Pure (no Svelte, no
// app); test/playback-valence.test.mjs drives it against a fake hub, test/playback-valence-live.test.mjs against
// Nucleus's neutrino-sim.
//
// The wire is the Valence JS reference client, vendored unchanged in ./vendor (MIT, Valence 56de58b, see
// THIRD-PARTY.md): HELLO/WELCOME, the catalog (blob namespace 0, SHA-256 etag, cached per host), CLOCK, PING,
// reconnect with backoff, GOODBYE. This file only decides what to ask for and what to send:
// - Motion rides the hub's c2h `segments` STREAM (SPEC §9.6), found by class, direction, stream_kind and the
//   `input.target` role, never by id or name, never in the user space (CHANNEL-GRID). One segment per scheduler
//   command {target, duration, end_velocity}; the hub plans, clamps and limits (SPEC §9.6 clause 2), the client
//   pre-adapts nothing. The publish grant is asked for once LIVE at control tier.
// - A segment is stamped LEAD_MS ahead of hub-now (network jitter room, half the default 250 ms horizon at most,
//   SPEC §5.4); it executes at stamp + the grant's schedule_latency_us, so status.latencyMs = LEAD_MS + that and the
//   caller leads its media by it.
// - Truth shown is the hub's: the `safety` snapshot (PAUSE / ESTOP latches) and `telemetry.position` against the
//   reported `window.min`/`window.max`, found by role. A value the wire never sent stays null (RENDERING law 9);
//   telemetry older than STALE_MS is `stale` (law 8).
// - Tier: tokenless HELLO is watch. pair() knocks (SPEC §12.3 a/c); a PAIR_GRANT's token goes to onToken for the
//   caller to persist against this instance id and presents it in every later HELLO.
// - Safety ops: pause is role-exempt and may always be sent; resume and release only when the caller says so
//   (operator acts, SPEC §11.1); estop uses the reference client's op-then-raw-frame path.

import { createSession, SESSION_STATE } from './vendor/session.js';
import {
  CH_SAFETY, PRIORITY, ACCESS, SAFETY_OP, CHANNEL_CLASS, STREAM_KIND, UNIT_ID, LIMITS, PACKED, FIELD_ROLE,
} from './vendor/frames.js';

export const STALE_MS = 1000;
// ponytail: fixed stamp lead; a measured one (Phosphor's lag meter / CLOCK RTT) if WiFi jitter beats it.
export const LEAD_MS = 100;
const TELEMETRY_HZ = 20;
const TIME_SCALE = { [UNIT_ID.ms]: 1, [UNIT_ID.s]: 1e-3, [UNIT_ID.us]: 1e3 };
const SIGNED_MIN = { [PACKED.i8]: -128, [PACKED.i16]: LIMITS.segment_end_vel_unspecified, [PACKED.i32]: -(2 ** 31) };
const TYPE_MAX = { [PACKED.u8]: 255, [PACKED.i8]: 127, [PACKED.u16]: 65535, [PACKED.i16]: 32767, [PACKED.u32]: 2 ** 32 - 1, [PACKED.i32]: 2 ** 31 - 1 };
const isUserSpace = (ch) => ch >= 0x8000 && ch <= 0xbfff;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** SPEC §5.4 / RFC-058: the value a field takes when the sender has none (signed type minimum), else 0. */
const unspecified = (f) => (f.type in SIGNED_MIN ? SIGNED_MIN[f.type] / (f.scale || 1) : 0);
const topOf = (f) => (f.type in TYPE_MAX ? TYPE_MAX[f.type] / (f.scale || 1) : Infinity);

/**
 * The hub's motion-input segments STREAM (SPEC §9.6, RFC-071), or null: its target must be in unit normalized and
 * it must carry input.duration in a time unit, else it is not motion.
 */
export function motionStream(entries) {
  const e = (entries || []).find((x) => x.cls === CHANNEL_CLASS.STREAM && x.dirName === 'c2h' && x.streamKind === STREAM_KIND.segments
    && !isUserSpace(x.id) && (x.layout || []).some((f) => f.role === FIELD_ROLE.input_target));
  if (!e) return null;
  const L = e.layout, target = L.find((f) => f.role === FIELD_ROLE.input_target);
  const dur = L.find((f) => f.role === FIELD_ROLE.input_duration && f.unitId in TIME_SCALE);
  const vel = L.find((f) => f.role === FIELD_ROLE.input_end_velocity);
  if (target.unitId !== UNIT_ID.normalized || !dur) return null;
  return {
    id: e.id, maxRateHz: e.maxRateHz, target: target.name, blank: Object.fromEntries(L.map((f) => [f.name, unspecified(f)])),
    dName: dur.name, dTop: topOf(dur), dScale: TIME_SCALE[dur.unitId], vName: vel?.name ?? null, vTop: vel ? topOf(vel) : 0,
  };
}

/** One segment record by layout name: every field at its sentinel, then target, duration and (if given) endVel. */
export function segmentRecord(st, norm, durMs, endVel) {
  const r = { ...st.blank };
  r[st.target] = clamp(Number.isFinite(norm) ? norm : 0, 0, 1);
  r[st.dName] = clamp(Math.max(0, durMs || 0) * st.dScale, 0, st.dTop);
  // Clamped inside the field's range so a real velocity never packs as the sentinel.
  if (st.vName && Number.isFinite(endVel)) r[st.vName] = clamp(endVel, -st.vTop, st.vTop);
  return r;
}

/** The first STATE field carrying `role` (catalog order, outside the user space): {channel, name, unit}, or null. */
export function roleField(entries, role) {
  for (const e of entries || []) {
    if (e.cls !== CHANNEL_CLASS.STATE || isUserSpace(e.id)) continue;
    const f = (e.layout || []).find((x) => x.role === role);
    if (f) return { channel: e.id, name: f.name, unit: f.unit || f.unitIdName || '' };
  }
  return null;
}

/**
 * opts: {host, port, token?: Uint8Array, instanceId?: Uint8Array, clientName?, WebSocketImpl?, catalogStore?,
 * onChange?(status), onToken?(token: Uint8Array), log?, now?}. Nothing connects until connect().
 */
export function createValenceLink(opts) {
  const now = opts.now || (() => performance.now());
  let token = opts.token || null;   // asked per HELLO, so a PAIR_GRANT's token rides every reconnect
  const s = createSession({
    host: opts.host, port: opts.port, token: () => token, instanceId: opts.instanceId,
    clientKind: 'pawscript', clientName: opts.clientName || 'Pawscript',
    subscriptions: [[CH_SAFETY, 0, PRIORITY.critical]],
    WebSocketImpl: opts.WebSocketImpl, catalogStore: opts.catalogStore, log: opts.log,
  });
  let st = null, pos = null, win = null;       // catalog-resolved: motion stream, telemetry fields
  const tel = { mm: null, at: 0, lo: null, hi: null };
  let lastNack = null, closed = true, reconnecting = false, asked = '';
  const changed = () => opts.onChange?.(link.status);

  function askGrant() {
    const ss = s.state;
    if (!st || !s.isLive || (ss.roles | 0) < ACCESS.control || ss.grantedPublishes.has(st.id)) return;
    const key = ss.sessionId + ':' + st.id;
    if (asked === key) return;
    asked = key;
    const rate = st.maxRateHz || 50;
    // A 2 s bucket (SPEC §10.5 burst) like Phosphor's player: a seek right after a start sends a burst.
    s.publish([[st.id, rate, 2 * rate]]).then(changed, (e) => { lastNack = { name: 'PUBLISH', detail: e.message }; changed(); });
  }

  s.on('catalog', (entries) => {
    st = motionStream(entries);
    pos = roleField(entries, FIELD_ROLE.telemetry_position);
    const lo = roleField(entries, FIELD_ROLE.window_min), hi = roleField(entries, FIELD_ROLE.window_max);
    win = lo && hi && lo.unit === pos?.unit && hi.unit === pos?.unit ? { lo, hi } : null;
    changed();
  });
  s.on('live', () => {
    reconnecting = false;
    const subs = new Map();
    if (pos) subs.set(pos.channel, [pos.channel, TELEMETRY_HZ, PRIORITY.elevated]);
    for (const f of win ? [win.lo, win.hi] : []) if (!subs.has(f.channel)) subs.set(f.channel, [f.channel, 0, PRIORITY.normal]);
    if (subs.size) s.subscribe([...subs.values()]);
    askGrant();
    changed();
  });
  s.on('state', (ch, sample) => {
    let hit = false;
    if (pos && ch === pos.channel && Number.isFinite(sample[pos.name])) { tel.mm = sample[pos.name]; tel.at = now(); hit = true; }
    if (win && ch === win.lo.channel && Number.isFinite(sample[win.lo.name])) { tel.lo = sample[win.lo.name]; hit = true; }
    if (win && ch === win.hi.channel && Number.isFinite(sample[win.hi.name])) { tel.hi = sample[win.hi.name]; hit = true; }
    if (hit) changed();
  });
  s.on('safety', changed);
  s.on('publishGrant', changed);
  // SPEC §6.8: a new session rebuilds its shadow from the hub's pushes; nothing of the last one is shown as current.
  s.on('welcome', () => { Object.assign(tel, { mm: null, at: 0, lo: null, hi: null }); lastNack = null; changed(); });
  s.on('nack', (n) => { lastNack = { name: n.name, detail: n.detail, channel: n.channel, at: now() }; changed(); });
  s.on('pairGrant', (g) => {
    if (g.token) { token = g.token; opts.onToken?.(g.token); }
    askGrant();
    changed();
  });
  s.on('close', (c) => { reconnecting = !!c?.willReconnect && !closed; asked = ''; changed(); });

  /** Why playback cannot send now, '' when it can. */
  function why() {
    const ss = s.state;
    if (closed) return 'not connected';
    if (!s.isLive) return reconnecting ? 'reconnecting' : 'syncing';
    if (!st) return 'this hub has no segments stream';
    if ((ss.roles | 0) < ACCESS.control) return 'watch only: request control';
    if (ss.safety?.estopLatched) return 'halted on the hub';
    if (ss.safety?.paused) return 'paused on the hub';
    if (!ss.grantedPublishes.has(st.id)) return 'waiting for the stream grant';
    return '';
  }

  const link = {
    connect() { closed = false; s.connect(); changed(); },
    close() { closed = true; reconnecting = false; s.close(); changed(); },
    /** One segment starting status.latencyMs from now: norm 0..1 of the window, durMs, endVel norm/s (null = hub's). */
    segment(norm, durMs, endVel = null) {
      const r = why();
      if (r) return { ok: false, reason: r };
      try {
        s.publishSegment(st.id, [segmentRecord(st, norm, durMs, endVel)], { anchor: (s.hubNowUs() + LEAD_MS * 1000) >>> 0 });
        return { ok: true };
      } catch (e) { return { ok: false, reason: e.code || e.message }; }
    },
    pair() { return s.sendPairReq({ role: ACCESS.control }); },
    pause() { return s.sendSafetyIntent(SAFETY_OP.pause); },
    resume() { return s.sendSafetyIntent(SAFETY_OP.resume); },
    estop() { return s.assertEstop(); },
    release() { return s.sendSafetyIntent(SAFETY_OP.release); },
    get session() { return s; },
    get status() {
      const ss = s.state, id = ss.identity, g = st && ss.grantedPublishes.get(st.id);
      const span = tel.hi - tel.lo, fresh = tel.at > 0 && now() - tel.at < STALE_MS;
      return {
        phase: closed ? 'closed' : s.isLive ? 'live' : reconnecting ? 'reconnecting' : ss.welcomed ? 'syncing' : 'connecting',
        hubName: id?.hub_name ?? null, product: id?.product ?? null, fw: id?.fw_version ?? null,
        estopCutsPower: !!id?.estop_cuts_power,
        roles: ss.welcomed ? ss.roles | 0 : null,
        estop: !!ss.safety?.estopLatched, paused: !!ss.safety?.paused, homeRequired: !!ss.safety?.homeRequired,
        hasSafety: !!ss.safety,
        stream: st ? st.id : null,
        rateHz: g ? g.rate : null, latencyMs: LEAD_MS + (g ? (g.scheduleLatencyUs || 0) / 1000 : 0),
        positionMm: tel.mm, unit: pos?.unit ?? '', window: tel.lo != null && tel.hi != null ? [tel.lo, tel.hi] : null,
        position: tel.mm != null && span > 0 ? clamp((tel.mm - tel.lo) / span, 0, 1) : null,
        stale: !fresh,
        lastNack,
        why: why(), canPlay: !why(),
      };
    },
  };
  return link;
}

/** Hex helpers for persisting tokens / instance ids in settings. */
export const toHex = (b) => Array.from(b || [], (x) => x.toString(16).padStart(2, '0')).join('');
export const fromHex = (h) => (typeof h === 'string' && /^([0-9a-f]{2})+$/i.test(h) ? Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16)) : null);
