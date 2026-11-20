// bridge.js -- the device backend: the embedded buttplug server (src-tauri/src/buttplug.rs, bp_* commands) or a
// fake with the same surface (harness, node tests). Pure apart from the Tauri calls.
//
//   start() / shutdown()                  the in-process server (nothing listens on a port)
//   scan(on)                              BLE / serial / HID discovery
//   devices() -> Device[]                 {index, name, gap_ms, linear: [{feature, range: [a, b] steps, ms: [a, b] | null}], other: [type]}
//   linear(index, feature, position, ms)  one position command, `position` in the feature's steps
//   stopAll()                             every device's stop set
//   onDevices(cb) / onScanning(cb)        -> unlisten
//
// toSteps() is the one place a 0..1 position becomes a wire value: clamped to the feature's range, never NaN.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** 0..1 -> the feature's integer steps (clamped); ms -> its duration range (clamped, >= 1). */
export function toSteps(lin, pos01, ms) {
  const [a, b] = lin.range, p = Number.isFinite(pos01) ? Math.min(1, Math.max(0, pos01)) : 0;
  const [m0, m1] = lin.ms || [1, 65535];
  return { position: Math.min(b, Math.max(a, Math.round(a + p * (b - a)))), ms: Math.min(m1, Math.max(Math.max(1, m0), Math.round(ms) || 1)) };
}

const sub = (name, cb) => { let off = null, dead = false; listen(name, (e) => cb(e.payload)).then((f) => (dead ? f() : (off = f))); return () => { dead = true; off?.(); }; };

export function tauriBridge() {
  return {
    kind: 'embedded',
    start: () => invoke('bp_start'),
    shutdown: () => invoke('bp_shutdown'),
    scan: (on) => invoke('bp_scan', { on }),
    devices: () => invoke('bp_devices'),
    linear: (index, feature, position, ms) => invoke('bp_linear', { index, feature, position, ms }),
    stopAll: () => invoke('bp_stop_all'),
    onDevices: (cb) => sub('bp://devices', cb),
    onScanning: (cb) => sub('bp://scanning', cb),
  };
}

/** Outside the desktop app: every call refuses with one clear reason. */
export function noBridge() {
  const no = () => Promise.reject(new Error('device playback needs the desktop app'));
  return { kind: 'none', start: no, shutdown: async () => {}, scan: no, devices: async () => [], linear: no, stopAll: async () => {}, onDevices: () => () => {}, onScanning: () => () => {} };
}

/**
 * A fake backend: `devices` appear `scanDelayMs` after scan(true). Every linear() is logged {t, index, feature,
 * position, ms}; a position outside the feature's range is refused as upstream does. F.drop(index) simulates a
 * disconnect. F.now() is the clock the log uses (performance.now by default).
 */
export function fakeBridge({ devices = FAKE_DEVICES, scanDelayMs = 300, now = () => performance.now() } = {}) {
  const ls = { devices: new Set(), scanning: new Set() };
  const F = { kind: 'fake', running: false, list: [], log: [], stops: 0, now };
  const set = (l) => { F.list = l; for (const cb of ls.devices) cb(l); };
  F.start = async () => { F.running = true; };
  F.shutdown = async () => { F.running = false; set([]); };
  F.scan = async (on) => {
    if (!F.running) throw new Error('the device server is not running');
    for (const cb of ls.scanning) cb(on);
    if (on) setTimeout(() => { if (F.running) { set(devices.map((d) => ({ ...d }))); for (const cb of ls.scanning) cb(false); } }, scanDelayMs);
  };
  F.devices = async () => F.list;
  F.linear = async (index, feature, position, ms) => {
    const d = F.list.find((x) => x.index === index), lin = d?.linear.find((l) => l.feature === feature);
    if (!lin) throw new Error(`no device ${index} feature ${feature}`);
    if (!(position >= lin.range[0] && position <= lin.range[1]) || !Number.isInteger(position)) throw new Error(`position ${position} out of range`);
    F.log.push({ t: F.now(), index, feature, position, ms });
  };
  F.stopAll = async () => { F.stops++; };
  F.onDevices = (cb) => { ls.devices.add(cb); return () => ls.devices.delete(cb); };
  F.onScanning = (cb) => { ls.scanning.add(cb); return () => ls.scanning.delete(cb); };
  F.drop = (index) => set(F.list.filter((d) => d.index !== index));
  return F;
}

export const FAKE_DEVICES = Object.freeze([
  { index: 0, name: 'Fake stroker', gap_ms: 0, linear: [{ feature: 0, range: [0, 10000], ms: [0, 65535] }], other: [] },
  { index: 1, name: 'Fake vibrator', gap_ms: 0, linear: [], other: ['Vibrate'] },
]);
