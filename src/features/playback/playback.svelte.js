// playback.svelte.js -- the one Playback instance per app (playbackFor(app), also app.playback): the device bridge's
// reactive mirror (server status, scan, devices, the selected one), the Valence hub link, the 5 ms timer that feeds
// the scheduler from app.player, the range preview, the live readout and panic stop. Pure parts: scheduler.js,
// bridge.js, src/lib/valence/link.js.
//
// Settings (app.settings, never the .pawproj): playback.offsetMs (-500..500), playback.range ([lo, hi] %),
// playback.invert, playback.scrub (follow paused seeks), playback.device (name of the last device picked).
// The device profile and the stroke window are the app's shared ones (review.profile, review.strokeMm), so
// Review's problems, the machine preview and the device all run one profile.
// Valence (playback.valence.host / .port, .instanceId = this install's 8-byte identity, .tokens = {host:port: hex}
// paired tokens): a LIVE link with a granted segments stream is the output, ahead of a buttplug device. The hub plans
// and limits (SPEC §9.6): no client speed clamp, one command per grant slot, lead = the link's latencyMs (its stamp
// lead + the grant's schedule_latency_us), the user offset trims on top. A link that drops turns playback off; a
// reconnect never resumes motion (SPEC §6.8). Panic also latches the hub's PAUSE (role-exempt); resume is the user's.
// Not persisted on purpose: connected and enabled. A launch never moves a toy until the user connects and turns
// playback on.
// Safety: every position goes through scheduler.js toDevice (clamped) and bridge.js toSteps (clamped to the
// feature's range); disable / pause / panic send a stop segment and StopAll; a device that disappears turns
// playback off; window unload sends StopAll (Rust also stops every device when the window is destroyed).

import { rooted } from '../../lib/rooted.svelte.js';
import { createScheduler } from './scheduler.js';
import { tauriBridge, noBridge, toSteps } from './bridge.js';
import { configFor } from './config.js';
import { activeProfile } from '../review/logic/profiles.js';
import { listProfiles } from '../../lib/analyze/profiles.js';
import { createValenceLink, toHex, fromHex } from '../../lib/valence/link.js';
import { finalOf } from '../../lib/finish.js';
import { scriptOf } from '../../lib/script-of.js';   // paw-x7w7: baked + live

export { rangeOf } from './config.js';

const instances = new WeakMap();
const TICK_MS = 5, READOUT_MS = 33, METER_MS = 2000;

/** opts.bridge: a fakeBridge() for harnesses; otherwise the embedded server in Tauri, else noBridge(). opts.WebSocketImpl:
 *  the Valence link's socket (tests). */
// paw-shgb: ONE per window (keyed by the tabs every tab's app shares): one device link, driven by the shown tab's player and
// script (a hidden tab is paused and never moves the device)
const keyOf = (app) => app.tabs ?? app;
export function playbackFor(app, opts = {}) {
  let p = instances.get(keyOf(app));
  // under its own root (paw-b7da): made by a component, its effects and deriveds would die with that component
  if (!p) { p = rooted(() => new Playback(app, opts.bridge, opts.WebSocketImpl)); instances.set(keyOf(app), p); }
  if (app.playback !== p) { try { app.playback = p; } catch { /* frozen app */ } }
  return p;
}
export const peekPlayback = (app) => instances.get(keyOf(app)) || null;

class Playback {
  status = $state('off');         // off | starting | on
  error = $state('');
  lost = $state('');              // paw-wfd2.3: the device that was linked left or stopped answering (its name, or the error); '' = fine. The health slot's "Device not responding"
  scanning = $state(false);
  devices = $state.raw([]);
  deviceIndex = $state(null);
  enabled = $state(false);
  previewing = $state(false);
  pos = $state(null);             // commanded position now, 0..1 (the live readout)
  meter = $state.raw([null, null]);   // [min, max] commanded over the last 2 s
  valence = $state.raw(null);         // the Valence link's status (link.js), null with no link
  sent = 0;
  #root; #bridge; #sched; #timer = 0; #lastReadout = 0; #samples = []; #preview = null; #off = []; #link = null; #ws;

  /** The app it plays: the shown tab's (paw-shgb). */
  get #app() { return this.#root.tabs?.current ?? this.#root; }

  constructor(app, bridge, WebSocketImpl) {
    this.#root = app;
    this.#ws = WebSocketImpl;
    this.#bridge = bridge || (app.backend?.isTauri ? tauriBridge() : noBridge());
    this.#sched = createScheduler({ send: (c) => this.#send(c) });
    this.#off.push(this.#bridge.onDevices((l) => this.#setDevices(l)), this.#bridge.onScanning((s) => (this.scanning = !!s)));
    if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => this.#bridge.stopAll().catch(() => null));
  }

  get bridgeKind() { return this.#bridge.kind; }
  get settings() { return this.#app.settings; }
  get profile() { return activeProfile(this.#app.settings); }
  get profiles() { return listProfiles(this.#app.settings.get('review.profiles', [])); }
  get device() { return this.devices.find((d) => d.index === this.deviceIndex) || null; }
  /** Drops the link and makes it again (the health slot's Reconnect). */
  async reconnect() { await this.disconnect(); await this.connect(); }
  get connected() { return this.status === 'on'; }
  get valenceReady() { return !!this.valence?.canPlay; }
  get ready() { return this.valenceReady || (this.connected && !!this.device?.linear.length); }
  get active() { return this.ready && (this.enabled || this.previewing); }
  get outputName() { return this.valenceReady ? this.valence.hubName || 'Valence hub' : this.device?.name || ''; }
  get config() {
    const c = configFor(this.#app.settings, this.profile, this.device), v = this.valence;
    return this.valenceReady ? { ...c, maxSpeed: 0, minIntervalMs: v.rateHz > 0 ? 1000 / v.rateHz : 0, latencyMs: v.latencyMs } : c;
  }
  /** Effective lead (ms): the profile's latency less the user's offset. */
  get leadMs() { const c = this.config; return c.latencyMs - c.offsetMs; }

  set(key, value) { this.#app.settings.set('playback.' + key, value); }
  setProfile(id) { this.#app.settings.set('review.profile', id); }
  setStrokeMm(mm) {
    const id = this.profile.id;
    this.#app.settings.set('review.strokeMm', { ...this.#app.settings.get('review.strokeMm', {}), [id]: Math.round(mm) });
  }

  async connect() {
    if (this.status !== 'off') return;
    this.status = 'starting'; this.error = ''; this.lost = '';
    try {
      await this.#bridge.start();
      this.status = 'on';
      this.#setDevices(await this.#bridge.devices());
      this.#runTimer();
      await this.scan(true);
    } catch (e) {
      this.error = e?.message || String(e);
      this.status = 'off';
      this.#app.toast?.('Device: ' + this.error, 'warn');
    }
  }
  async disconnect() {
    await this.stop(false);
    this.status = 'off'; this.scanning = false; this.lost = '';
    if (!this.valenceReady) { this.enabled = false; this.previewing = false; }
    this.#runTimer();
    this.#setDevices([]);
    await this.#bridge.shutdown().catch(() => null);
  }
  toggleConnection() { return this.status === 'off' ? this.connect() : this.disconnect(); }

  get valenceLinked() { return !!this.#link; }
  /** Connect to the Valence hub at playback.valence.host:port (its paired token, if any, rides the HELLO). */
  connectValence() {
    if (this.#link) return;
    const S = this.#app.settings, host = String(S.get('playback.valence.host', '') || '').trim();
    const port = Math.round(+S.get('playback.valence.port', 82)) || 82;
    if (!host) { this.#app.toast?.('Valence: enter the hub address', 'warn'); return; }
    let iid = fromHex(S.get('playback.valence.instanceId', ''));
    if (iid?.length !== 8) { iid = crypto.getRandomValues(new Uint8Array(8)); S.set('playback.valence.instanceId', toHex(iid)); }
    const key = `${host}:${port}`;
    const link = createValenceLink({
      host, port, instanceId: iid, token: fromHex((S.get('playback.valence.tokens', {}) || {})[key]) || undefined,
      WebSocketImpl: this.#ws,
      onChange: (st) => { if (link === this.#link) this.#valenceChanged(st); },   // a closed link's last words are not news
      onToken: (t) => S.set('playback.valence.tokens', { ...(S.get('playback.valence.tokens', {}) || {}), [key]: toHex(t) }),
    });
    this.#link = link;
    this.valence = link.status;
    link.connect();
    this.#runTimer();
  }
  disconnectValence() {
    const l = this.#link;
    if (!l) return;
    if (this.valenceReady && this.active) this.#sched.tick(performance.now(), { script: this.#script(), playing: false, rate: 1, mediaMs: this.#app.player.timeMs });
    this.#link = null;
    l.close();
    this.valence = null;
    if (!this.ready) { this.enabled = false; this.previewing = false; this.#preview = null; }
    this.#sched.reset(true);
    this.#runTimer();
  }
  toggleValence() { return this.#link ? this.disconnectValence() : this.connectValence(); }
  /** Knock for control tier (SPEC §12.3): granted by the hub's owner, or at once in a push-to-pair window. */
  pairValence() {
    if (this.#link?.pair()) this.#app.toast?.('Valence: control requested. Approve it on the hub or its app.', 'info');
  }
  /** Safety ops on the hub. pause is role-exempt; resume and release are the user's acts, never sent unprompted. */
  valenceOp(op) {
    const l = this.#link;
    if (!l) return null;
    return Promise.resolve().then(() => l[op]()).catch((e) => { this.#app.toast?.(`Valence ${op}: ${e?.message || e}`, 'warn'); });
  }
  async scan(on = !this.scanning) {
    try { await this.#bridge.scan(on); this.scanning = on; } catch (e) { this.error = e?.message || String(e); }
  }
  select(index) {
    const d = this.devices.find((x) => x.index === index);
    if (!d?.linear.length) return;
    if (this.deviceIndex !== index) { this.stop(false); this.#sched.reset(true); }
    this.deviceIndex = index;
    this.set('device', d.name);
  }
  setEnabled(on) {
    if (on && !this.ready) { this.#app.toast?.(this.connected ? 'Pick a device with a position axis' : 'Connect a device first', 'warn'); return; }
    if (!on && this.enabled) this.stop(false);
    this.enabled = !!on;
  }
  toggle() { this.setEnabled(!this.enabled); }

  /** Stop the device: a stop segment, then StopAll; ends a preview. pausePlayer: also pause the video (panic). */
  async stop(pausePlayer = true) {
    const was = this.#preview;
    this.#preview = null; this.previewing = false;
    if (pausePlayer) this.#app.player.pause?.();
    if (this.#timer && (this.device || this.valenceReady)) this.#sched.tick(performance.now(), { script: this.#script(), playing: false, rate: 1, mediaMs: this.#app.player.timeMs });
    this.#sched.reset();
    if (was?.restore != null) this.enabled = was.restore;
    await this.#bridge.stopAll().catch(() => null);
  }
  /** Panic: playback off, video paused, device stopped. Works whatever the state. */
  panic() {
    this.enabled = false;
    if (this.valence?.phase === 'live') this.valenceOp('pause');
    const r = this.stop(true);
    this.#app.toast?.('Device stopped', 'warn');
    return r;
  }

  /** The span to preview: the I/O range, else the selected points' span; null when neither has length. */
  previewSpan() {
    const d = this.#app.doc;
    if (d.range && d.range.t1 > d.range.t0) return { t0: d.range.t0, t1: d.range.t1 };
    const ats = d.selection?.ats;
    if (!ats || ats.size < 2) return null;
    let t0 = Infinity, t1 = -Infinity;
    for (const t of ats) { if (t < t0) t0 = t; if (t > t1) t1 = t; }
    return t1 > t0 ? { t0, t1 } : null;
  }
  /** Play the span once on the device (playback forced on for it), then park the playhead where it was. */
  preview() {
    const s = this.previewSpan();
    if (!s || !this.ready) return false;
    const p = this.#app.player, back = p.timeMs;
    const native = typeof p.playRange === 'function' && !!p.el;
    this.#preview = { ...s, back, native, started: false, restore: this.enabled };
    this.previewing = true;
    if (native) p.playRange(s.t0, s.t1, back);
    else Promise.resolve(p.seek(s.t0)).then(() => p.play());
    return true;
  }

  #script() { const app = this.#app, d = app.doc; return finalOf(app, 'stroke' in d.axes || scriptOf(app, 'stroke').length ? 'stroke' : d.activeAxis); }   // the final (lib/finish.js over lib/script-of.js: baked + live, paw-x7w7): what exports
  #setDevices(list) {
    const was = this.device;
    this.devices = Array.isArray(list) ? list : [];
    if (was && !this.device) {   // the device left: never resume by itself when it comes back
      if (!this.valenceReady) { this.enabled = false; this.previewing = false; this.#preview = null; this.#sched.reset(true); }
      this.deviceIndex = null; this.lost = was.name || 'device';
    }
    if (this.deviceIndex == null) {   // the last device picked, else the first with a position axis
      const name = this.#app.settings.get('playback.device', '');
      const d = this.devices.find((x) => x.linear.length && x.name === name) || this.devices.find((x) => x.linear.length);
      if (d) { this.deviceIndex = d.index; this.lost = ''; }
    }
  }
  #send({ pos, durMs, endVel }) {
    if (this.valenceReady) {
      const r = this.#link.segment(pos, durMs, endVel);
      if (r.ok) this.sent++;
      const e = r.ok ? '' : 'Valence: ' + r.reason;
      if (e !== this.error) this.error = e;
      return;
    }
    const d = this.device, lin = d?.linear[0];
    if (!lin || !this.connected) return;
    const { position, ms } = toSteps(lin, pos, durMs);
    this.sent++;
    this.#bridge.linear(d.index, lin.feature, position, ms).then(() => { if (this.lost && this.deviceIndex === d.index) this.lost = ''; }).catch((e) => { this.error = this.lost = e?.message || String(e); });
  }
  #tick() {
    const app = this.#app, p = app.player, now = performance.now();
    if (this.active) {   // first, so the tick that sees the pause still sends the stop segment
      this.#sched.configure(this.config);
      const mediaMs = typeof p.now === 'function' ? p.now() : p.timeMs;
      this.#sched.tick(now, { script: this.#script(), playing: !!p.playing, rate: p.rate || 1, mediaMs });
    }
    const T = this.#preview;
    if (T) {   // the preview ends when its span has played (or the user stopped it)
      if (!T.started) T.started = !!p.playing;
      else if (!T.native && p.playing && p.timeMs >= T.t1) { p.pause(); p.seek(T.back); }
      else if (!p.playing) { this.#preview = null; this.previewing = false; this.enabled = T.restore; if (!T.restore) this.#sched.reset(); }
    }
    if (now - this.#lastReadout >= READOUT_MS) {
      this.#lastReadout = now;
      if (this.#link) this.valence = this.#link.status;   // staleness moves with the clock, not only with frames
      const v = this.#sched.posAt(now);
      if (v !== this.pos) this.pos = v;
      const S = this.#samples;
      if (v != null) S.push([now, v]);
      while (S.length && S[0][0] < now - METER_MS) S.shift();
      let lo = Infinity, hi = -Infinity;
      for (const [, x] of S) { if (x < lo) lo = x; if (x > hi) hi = x; }
      const m = S.length ? [lo, hi] : [null, null];
      if (m[0] !== this.meter[0] || m[1] !== this.meter[1]) this.meter = m;
    }
  }
  #valenceChanged(st) {
    const was = this.valence;
    this.valence = st;
    if (was?.canPlay && st.phase !== 'live' && this.enabled && !this.ready) {   // the hub went away: never resume by itself
      this.enabled = false; this.previewing = false; this.#preview = null; this.#sched.reset(true);
      this.#app.toast?.(`Valence hub disconnected: ${was.hubName || 'hub'}`, 'warn');
    }
  }
  #runTimer() {
    const want = this.status === 'on' || !!this.#link;
    if (want && !this.#timer) this.#timer = setInterval(() => this.#tick(), TICK_MS);
    if (!want && this.#timer) { clearInterval(this.#timer); this.#timer = 0; }
  }
  destroy() { clearInterval(this.#timer); this.#link?.close(); for (const f of this.#off) f(); }
}
