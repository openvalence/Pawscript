import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Usage, noteUsage, fileSink, noteFx, fromHotReload } from '../src/app/usage.svelte.js';

const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };

test('usage: ring capped, counts keep counting, persisted and reloaded, report, clear', () => {
  const s = store(), u = new Usage(s, 3);
  for (const k of ['edit.undo', 'edit.undo', 'track.run', 'edit.undo', 'tracking:pickGroup']) u.note(k, k === 'tracking:pickGroup' ? 'g2' : undefined);
  u.note('');   // ignored
  assert.deepEqual(u.log.map((e) => e.kind), ['track.run', 'edit.undo', 'tracking:pickGroup']);
  assert.equal(u.log[2].detail, 'g2');
  assert.ok(!('detail' in u.log[0]));
  assert.deepEqual(u.top(), [['edit.undo', 3], ['track.run', 1], ['tracking:pickGroup', 1]]);
  assert.deepEqual(u.top(1), [['edit.undo', 3]]);
  u.flush();
  const v = new Usage(s, 3);
  assert.deepEqual(v.counts, u.counts);
  assert.equal(v.log.length, 3);
  const rep = v.report().split('\n');
  assert.deepEqual(rep.slice(0, 5), ['kind\tcount', 'edit.undo\t3', 'track.run\t1', 'tracking:pickGroup\t1', '']);
  assert.match(rep[6], /^\d{4}-\d\d-\d\dT[^\t]+\ttrack\.run\t$/);
  assert.match(rep[8], /\ttracking:pickGroup\tg2$/);
  v.clear();
  assert.deepEqual(new Usage(s).counts, {});
  assert.deepEqual(new Usage(s).log, []);
  // a corrupt store starts empty; noteUsage is a no-op without app.usage
  s.setItem('usage.log', '{bad'); s.setItem('usage.counts', '[1]');
  const w = new Usage(s);
  assert.deepEqual([w.log, w.counts], [[], {}]);
  noteUsage({}, 'x'); noteUsage(null, 'x');
  const app = { usage: new Usage(null) }; noteUsage(app, 'timeline:selectScene', 4);
  assert.deepEqual(app.usage.log.map((e) => [e.kind, e.detail]), [['timeline:selectScene', '4']]);
});

test('usage: JSONL lines, file sink flush, bursts coalesce, off switch, never throws', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-09T10:00:00Z') });
  const wrote = [], sink = { append: (text, at) => { wrote.push([text, at]); } };
  let on = true;
  const u = new Usage(null, 100, { enabled: () => on, sink });
  u.note('edit.undo', { src: 'key', focus: 'lane:plan' });
  u.note('tracking:describe', 3);
  assert.equal(wrote.length, 0);   // buffered
  t.mock.timers.tick(5000);
  assert.equal(wrote.length, 1);
  const lines = wrote[0][0].trimEnd().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((r) => [r.k, r.s === u.sid, r.t]), [['edit.undo', true, '2026-11-09T10:00:00.000Z'], ['tracking:describe', true, '2026-11-09T10:00:00.000Z']]);
  assert.equal(lines[0].focus, 'lane:plan');
  assert.equal(lines[1].d, 3);
  assert.equal(u.log[0].detail, '{"src":"key","focus":"lane:plan"}');   // the ring keeps a string
  // a scrub: 30 seeks become one event at the first call's time, from the first call, to the last
  for (let i = 0; i < 30; i++) { u.burst('play:seek', { from: i * 10, to: i * 10 + 10 }); t.mock.timers.tick(50); }
  assert.equal(u.lines.length, 0);
  t.mock.timers.tick(800);
  const seek = JSON.parse(u.lines[0]);
  assert.deepEqual([seek.k, seek.n, seek.from, seek.to, seek.ms, seek.t], ['play:seek', 30, 0, 300, 29 * 50, '2026-11-09T10:00:05.000Z']);
  // bursts with their own keys stay apart; flushAll closes them and writes
  u.burst('settings:set', { key: 'a', from: 1, to: 2 }, { key: 'settings:a' });
  u.burst('settings:set', { key: 'b', from: 1, to: 2 }, { key: 'settings:b' });
  u.burst('settings:set', { key: 'a', from: 2, to: 3 }, { key: 'settings:a' });
  u.flushAll();
  const last = wrote.at(-1)[0].trimEnd().split('\n').map((l) => JSON.parse(l)).filter((r) => r.k === 'settings:set');
  assert.deepEqual(last.map((r) => [r.key, r.from, r.to, r.n]), [['a', 1, 3, 2], ['b', 1, 2, 1]]);
  // off: nothing logged anywhere
  on = false;
  u.note('x.y'); u.burst('view:zoom', {});
  assert.equal(u.lines.length, 0);
  assert.ok(!u.log.some((e) => e.kind === 'x.y'));
  on = true;
  // a throwing sink or enabled() never reaches the caller; no sink = lines kept in memory
  const bad = new Usage(null, 10, { enabled: () => { throw new Error('boom'); } });
  assert.doesNotThrow(() => bad.note('a.b'));
  const mem = new Usage(null, 10);
  mem.note('a.b', { x: 1 });
  assert.equal(JSON.parse(mem.lines[0]).x, 1);
  const thrower = new Usage(null, 10, { sink: { append() { throw new Error('disk'); } } });
  thrower.note('a.b');
  assert.doesNotThrow(() => thrower.flushFile());
});

test('usage: fileSink appends to the day file, keeps what was there, never clobbers an unreadable file', async () => {
  const files = new Map([['C:\\data\\usage-2026-11-09.jsonl', '{"k":"old"}\n']]);
  const backend = { appPaths: async () => ({ data_dir: 'C:\\data' }), exists: async (p) => files.has(p), readText: async (p) => files.get(p), writeText: async (p, s) => { files.set(p, s); } };
  const s = fileSink(backend), at = new Date(2026, 10, 9, 12).getTime();
  await s.append('{"k":"a"}\n', at);
  await s.append('{"k":"b"}\n', at);
  assert.equal(files.get('C:\\data\\usage-2026-11-09.jsonl'), '{"k":"old"}\n{"k":"a"}\n{"k":"b"}\n');
  await s.append('{"k":"c"}\n', at + 86400000);   // the next day: its own file
  assert.equal(files.get('C:\\data\\usage-2026-11-10.jsonl'), '{"k":"c"}\n');
  const keep = new Map([['/d/usage-2026-11-09.jsonl', 'precious\n']]);
  const s2 = fileSink({ ...backend, appPaths: async () => ({ data_dir: '/d' }), exists: async () => true, readText: async () => { throw new Error('locked'); }, writeText: async (p, x) => keep.set(p, x) });
  await s2.append('x\n', at); await s2.append('y\n', at);
  assert.equal(keep.get('/d/usage-2026-11-09.jsonl'), 'precious\n');
});

test('usage: noteFx itemises effect adds, removes and edits', () => {
  const u = new Usage(null, 100);
  const a = { id: 'f1', kind: 'orgasm', t0: 0, t1: 2000, params: {} }, b = { id: 'f2', kind: 'spurt', t0: 500, t1: 500, params: { mode: 'x' } };
  noteFx(u, [], [a, b]);
  noteFx(u, [a, b], [{ ...a, params: { lo: 10 } }]);
  u.flushAll();
  const r = u.lines.map((l) => JSON.parse(l));
  assert.deepEqual(r.map((x) => [x.k, x.id]), [['fx:add', 'f1'], ['fx:add', 'f2'], ['fx:remove', 'f2'], ['fx:edit', 'f1']]);
  assert.deepEqual([r[0].ms, r[1].mode, r[3].what], [2000, 'x', 'lo']);
});

// paw-pq6b: the owner's log had "Cannot read properties of undefined (reading 'default')" x3 as an agent merged files into the
// live tree his dev server serves: Vite's client ran Svelte's hot-reload handler with the module that failed to load
// (module.default of undefined). Not the app's error: logged as app:hmr (and boot.js does not toast it).
test('usage: an error from the dev server hot reload is app:hmr, every other window error app:error', () => {
  const ls = {}, win = { addEventListener: (t, f) => { ls[t] = f; }, removeEventListener() {}, document: { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' } };
  const u = new Usage(null, 10);
  u.start(win);
  const hmr = Object.assign(new TypeError("Cannot read properties of undefined (reading 'default')"), { stack: "TypeError: Cannot read properties of undefined (reading 'default')\n    at http://localhost:5173/src/app/Shell.svelte?t=1:420:31\n    at http://localhost:5173/@vite/client:213:9" });
  const own = new TypeError("Cannot read properties of undefined (reading 'flatMap')");
  ls.unhandledrejection({ reason: hmr });
  ls.error({ message: 'Uncaught ' + hmr.message, error: hmr });
  ls.error({ message: 'Uncaught ' + own.message, error: own });
  ls.unhandledrejection({ reason: own });
  ls.unhandledrejection({ reason: 'plain string' });
  ls.error({ message: 'ResizeObserver loop completed with undelivered notifications.' });   // the browser's notice: not logged
  u.stop();
  assert.deepEqual(u.lines.map((l) => JSON.parse(l)).filter((r) => /^app:(hmr|error)$/.test(r.k)).map((r) => r.k), ['app:hmr', 'app:hmr', 'app:error', 'app:error', 'app:error']);
  assert.equal(fromHotReload(hmr), true);
  assert.equal(fromHotReload(own), false);
  assert.equal(fromHotReload(null), false);
  assert.equal(fromHotReload('x'), false);
});
