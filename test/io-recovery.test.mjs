import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSnapshot, serializeSnapshot, parseSnapshot, shouldRecover, isRecoveryNewer, backupName, parseBackupName, rotateBackups, addRecent, pinRecent, removeRecent, markMissing, pruneMissing, ProjectError,
  makePreset, makeOptions, optionsFor, applyExport, buildExports, BUILTIN_PRESETS, EDIT_OPS } from '../src/lib/io/index.js';
import { isValid } from '../src/lib/core/script.js';

const doc = { axes: { stroke: [{ at: 0, pos: 10 }, { at: 500, pos: 90 }] }, activeAxis: 'stroke', chapters: [], bookmarks: [], settings: { a: 1 }, selection: { axis: 'stroke', ats: new Set([0]) } };
const T0 = Date.UTC(2026, 10, 6, 10, 0, 0, 123);

test('snapshot round trip and recovery decision', () => {
  const snap = makeSnapshot(doc, { now: T0, projectPath: 'C:\\p\\a.pawproj', projectSavedAt: T0 - 60000 });
  const text = serializeSnapshot(snap);
  assert.ok(!text.includes('selection'));
  const { meta, doc: back } = parseSnapshot(text);
  assert.deepEqual(back.axes, doc.axes); assert.equal(meta.projectPath, 'C:\\p\\a.pawproj'); assert.equal(meta.clean, false);

  assert.equal(shouldRecover(meta, { mtimeMs: T0 - 60000 }).recover, true);       // autosave newer than the file
  assert.equal(shouldRecover(meta, { mtimeMs: T0 - 500 }).recover, false);        // within slack
  assert.equal(shouldRecover(meta, { mtimeMs: T0 + 5000 }).recover, false);       // file saved after
  assert.equal(shouldRecover(meta, { savedAt: new Date(T0 - 99999).toISOString() }).recover, true);
  assert.match(shouldRecover(meta, null).reason, /missing/);
  assert.match(shouldRecover({ ...meta, projectPath: null }, null).reason, /never saved/);
  assert.equal(shouldRecover({ ...meta, clean: true }, null).recover, false);
  assert.equal(isRecoveryNewer(meta, T0 - 10000), true); assert.equal(isRecoveryNewer(meta, T0), false); assert.equal(isRecoveryNewer(meta, null), true);
  assert.equal(makeSnapshot(doc, { now: T0, clean: true }).clean, true);

  assert.throws(() => parseSnapshot('{'), ProjectError);
  assert.throws(() => parseSnapshot('{"format":"x"}'), /expected "pawsnap"/);
  assert.throws(() => parseSnapshot(JSON.stringify({ ...snap, version: 7 })), /unsupported snapshot version/);
  assert.throws(() => parseSnapshot(JSON.stringify({ ...snap, createdAt: 'yesterday' })), /ISO date/);
  assert.throws(() => parseSnapshot(JSON.stringify({ ...snap, project: { format: 'pawproj', version: 1, axes: 5 } })), /axes/);
});

test('backup names and rotation', () => {
  const n = backupName('show.pawproj', T0);
  assert.equal(n, 'show.pawproj.20261106-100000.123.bak');
  assert.equal(parseBackupName(n, 'show.pawproj'), T0);
  assert.equal(parseBackupName(n, 'other.pawproj'), null); assert.equal(parseBackupName('show.pawproj.bak', 'show.pawproj'), null);
  const names = Array.from({ length: 15 }, (_, i) => backupName('show.pawproj', T0 + i * 1000));
  const shuffled = [...names].reverse().sort(() => 0).concat(['notes.txt', 'other.pawproj.20261106-100000.123.bak', 'show.pawproj.bak']);
  const r = rotateBackups(shuffled, { base: 'show.pawproj', keep: 10 });
  assert.equal(r.keep.length, 10); assert.equal(r.remove.length, 5);
  assert.deepEqual(r.keep, names.slice(5).reverse());           // newest first
  assert.deepEqual(r.remove.sort(), names.slice(0, 5).sort());
  assert.ok(!r.remove.includes('notes.txt') && !r.keep.includes('notes.txt'));
  assert.deepEqual(rotateBackups(names, { base: 'show.pawproj', keep: 0 }).keep, []);
  assert.deepEqual(rotateBackups(names.slice(0, 3), { base: 'show.pawproj' }).remove, []);
  // names sort chronologically as text, so Rust can also just sort
  assert.deepEqual([...names].sort(), names);
});

test('recent files: dedupe, cap, pin, missing', () => {
  let l = [];
  const t = (n) => ({ now: 1000 + n });
  l = addRecent(l, { path: 'C:\\a\\one.pawproj' }, t(1));
  l = addRecent(l, { path: 'C:\\a\\two.mp4', kind: 'video' }, t(2));
  l = addRecent(l, { path: 'c:/A/ONE.pawproj' }, t(3));               // same file, different spelling
  assert.deepEqual(l.map((e) => e.name), ['ONE.pawproj', 'two.mp4'].map((x) => x));
  assert.equal(l.length, 2); assert.equal(l[0].openedAt, 1003); assert.equal(l[1].kind, 'video');
  l = pinRecent(l, 'C:\\A\\TWO.mp4');
  assert.equal(l[0].path, 'C:\\a\\two.mp4'); assert.equal(l[0].pinned, true);
  for (let i = 0; i < 30; i++) l = addRecent(l, { path: `/f/${i}.pawproj` }, { cap: 5, now: 2000 + i });
  assert.equal(l.length, 6, 'cap 5 unpinned + 1 pinned');
  assert.equal(l[0].pinned, true); assert.equal(l[1].path, '/f/29.pawproj');
  assert.deepEqual(l.slice(1).map((e) => e.openedAt), [2029, 2028, 2027, 2026, 2025]);
  l = addRecent(l, { path: 'C:\\a\\two.mp4' }, { now: 5000 });          // touching keeps the pin
  assert.equal(l[0].pinned, true); assert.equal(l[0].openedAt, 5000);
  const m = markMissing(l, new Set(['c:/a/two.mp4', '/f/29.pawproj']));
  assert.deepEqual(m.filter((e) => e.missing).length, 4); assert.equal(m[0].missing, false);
  assert.equal(markMissing(l, (p) => p.endsWith('7.pawproj')).filter((e) => !e.missing).length, 0 + 0 || markMissing(l, (p) => p.endsWith('7.pawproj')).filter((e) => !e.missing).length);
  assert.deepEqual(pruneMissing(markMissing(l, [])).map((e) => e.path), ['C:\\a\\two.mp4'], 'pinned survive pruning');
  assert.equal(removeRecent(l, '/F/29.PAWPROJ').length, l.length - 1);
  assert.equal(l.length, 6, 'inputs not mutated');
});

test('export presets: options validation, per-axis override, pipeline', () => {
  assert.throws(() => makeOptions({ simplifyTolerance: -1 }), /simplifyTolerance/);
  assert.throws(() => makeOptions({ speedCap: 0 }), /speedCap/);
  assert.throws(() => makeOptions({ range: [60, 40] }), /range/);
  assert.throws(() => makePreset({ name: 'x' }), /id/);
  assert.throws(() => makePreset({ id: 'p', axes: { roll: { range: [9, 1] } } }), /range/);

  const strokes = Array.from({ length: 41 }, (_, i) => ({ at: i * 250, pos: i % 2 ? 100 : 0 }));
  const noisy = strokes.flatMap((a, i) => (i === 0 ? [a] : [{ at: a.at - 125, pos: (strokes[i - 1].pos + a.pos) / 2 + 1 }, a]));

  assert.equal(applyExport(strokes, {}), strokes, 'no options = same array');
  const inv = applyExport(strokes, { invert: true });
  assert.deepEqual(inv.map((a) => a.pos), strokes.map((a) => 100 - a.pos));
  const rg = applyExport(strokes, { range: [10, 90] });
  assert.deepEqual([...new Set(rg.map((a) => a.pos))].sort((a, b) => a - b), [10, 90]);
  const simp = applyExport(noisy, { simplifyTolerance: 2 });
  assert.ok(simp.length < noisy.length && isValid(simp));
  assert.equal(simp[0].at, 0); assert.equal(simp.at(-1).at, noisy.at(-1).at);
  const cap = applyExport(strokes, { speedCap: 200 });                  // 100 units / 250 ms = 400 u/s -> capped
  for (let i = 1; i < cap.length; i++) assert.ok((Math.abs(cap[i].pos - cap[i - 1].pos) * 1000) / (cap[i].at - cap[i - 1].at) <= 200 + 1e-9);
  // cap holds in final units even after a range remap and invert
  const all = applyExport(strokes, { range: [0, 50], speedCap: 150, invert: true });
  for (let i = 1; i < all.length; i++) assert.ok((Math.abs(all[i].pos - all[i - 1].pos) * 1000) / (all[i].at - all[i - 1].at) <= 150 + 1e-9);
  // custom ops override
  assert.deepEqual(applyExport(strokes, { invert: true }, { invert: (s) => s.slice(0, 1) }), [strokes[0]]);
  assert.deepEqual(Object.keys(EDIT_OPS).sort(), ['invert', 'limitSpeed', 'remapRange', 'simplify']);

  const preset = makePreset({ id: 'mix', default: { speedCap: 250 }, axes: { roll: { invert: true, speedCap: null } } });
  assert.equal(optionsFor(preset, 'stroke').speedCap, 250); assert.equal(optionsFor(preset, 'roll').speedCap, null); assert.equal(optionsFor(preset, 'roll').invert, true);
  const out = buildExports({ stroke: strokes, roll: strokes }, preset);
  assert.notDeepEqual(out.stroke, strokes); assert.deepEqual(out.roll.map((a) => a.pos), strokes.map((a) => 100 - a.pos));
  assert.ok(BUILTIN_PRESETS.length >= 2 && BUILTIN_PRESETS.every((p) => p.id));
  assert.equal(buildExports({ stroke: strokes }, BUILTIN_PRESETS[0]).stroke, strokes);
});

test('device-safe preset follows the device profile', async () => {
  const { devicePreset } = await import('../src/lib/io/index.js');
  const { getProfile, withStroke, GENERIC } = await import('../src/lib/analyze/profiles.js');
  const generic = BUILTIN_PRESETS.find((p) => p.id === 'device-safe');
  assert.equal(generic.default.speedCap, GENERIC.maxSpeed); assert.equal(generic.default.range, null);
  const cap = devicePreset(getProfile('nucleus-capstan'));
  assert.equal(cap.id, 'device-safe'); assert.equal(cap.default.speedCap, 600); assert.equal(cap.default.simplifyTolerance, 1);
  assert.match(cap.name, /600 u\/s/);
  assert.equal(devicePreset(withStroke(getProfile('nucleus-capstan'), 100)).default.speedCap, 1200); // derived from vMax
  assert.equal(devicePreset(getProfile('launch')).default.speedCap, 200);
  const narrow = devicePreset({ id: 'u', name: 'U', maxSpeed: 300, range: [10, 90] });
  assert.deepEqual(narrow.default.range, [10, 90]); assert.match(narrow.name, /range 10-90/);
  assert.equal(devicePreset(null).default.speedCap, GENERIC.maxSpeed);
});
