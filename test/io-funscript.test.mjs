import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFunscript, serializeFunscript, stringifyFunscript, formatClock, parseClock, readMarks, axisName, axisPath, axisPaths, parseAxisFile, discoverAxes, exportTargets } from '../src/lib/io/index.js';
import { funscriptDoc, exportTarget } from '../src/lib/runs.js';
import { parseFunscript as legacyParse, marksOf } from '../src/lib/funscript.js';
import { isValid } from '../src/lib/core/script.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('parse: tolerant of real-world mess, every repair noted', () => {
  const f = parseFunscript(JSON.stringify({
    version: '1.0', actions: [
      { at: 300.4, pos: 20.6 }, { at: 100, pos: 0 }, { at: 100, pos: 10 }, { at: '500', pos: '70' }, { at: -4, pos: 1 },
      { at: 700 }, null, { at: 800, pos: 130 }, 'x',
    ],
  }));
  assert.deepEqual(f.script, [{ at: 100, pos: 10 }, { at: 300, pos: 21 }, { at: 500, pos: 70 }, { at: 800, pos: 100 }]);
  assert.ok(isValid(f.script));
  const n = f.notes.join(' | ');
  for (const w of ['without a numeric', 'before time 0', 'sorted', 'duplicate', 'fractional', 'clamped']) assert.ok(n.includes(w), w + ' in ' + n);
});

test('parse: BOM, objects, rejects non-funscripts', () => {
  assert.equal(parseFunscript('\ufeff{"actions":[{"at":1,"pos":2}]}').script.length, 1);
  const obj = { actions: [{ at: 1, pos: 2 }] };
  const f = parseFunscript(obj);
  f.raw.actions.push({ at: 9, pos: 9 });
  assert.equal(obj.actions.length, 1, 'input object not mutated');
  assert.throws(() => parseFunscript('nope'), /invalid JSON/);
  assert.throws(() => parseFunscript('[1]'), /top level/);
  assert.throws(() => parseFunscript('{"a":1}'), /actions/);
  assert.deepEqual(parseFunscript('{"actions":[]}').script, []);
});

test('inverted and range: consistent with funscript.js and runs.js funscriptDoc', () => {
  const doc = { version: '1.0', inverted: true, range: 90, actions: [{ at: 0, pos: 10 }, { at: 500, pos: 90 }] };
  const f = parseFunscript(doc);
  assert.deepEqual(f.script, [{ at: 0, pos: 90 }, { at: 500, pos: 10 }]);
  const legacy = legacyParse(doc);
  assert.deepEqual(Array.from(legacy.pos, (p) => Math.round(p * 100)), f.script.map((a) => a.pos));
  assert.equal(f.meta.range, 90); assert.equal(f.meta.inverted, true);
  const out = serializeFunscript(f);
  assert.deepEqual(out, doc);
  // identical to what the shell exports today for the same input
  const pts = { at: f.script.map((a) => a.at), pos: f.script.map((a) => a.pos) };
  assert.deepEqual(serializeFunscript({ script: [{ at: 0, pos: 50 }, { at: 99, pos: 3 }], raw: doc }), funscriptDoc(doc, { at: [0, 99], pos: [50, 3] }));
  assert.deepEqual(serializeFunscript({ script: f.script, raw: null }), funscriptDoc(null, pts));
  // toggling the flag keeps the on-screen meaning
  const flipped = serializeFunscript({ script: f.script, meta: { inverted: false }, raw: doc });
  assert.equal(flipped.inverted, false); assert.deepEqual(flipped.actions, [{ at: 0, pos: 90 }, { at: 500, pos: 10 }]);
});

test('channels.stroke layout is read and written in place', () => {
  const doc = { version: '2.0', channels: { stroke: { actions: [{ at: 0, pos: 5 }, { at: 100, pos: 95 }], note: 'keep' }, roll: { actions: [{ at: 0, pos: 1 }] } } };
  const f = parseFunscript(doc);
  assert.equal(f.meta.source, 'channels.stroke');
  const out = serializeFunscript({ script: [{ at: 0, pos: 7 }], meta: f.meta, raw: f.raw });
  assert.deepEqual(f.embedded.roll, [{ at: 0, pos: 1 }]);   // paw-2pcf: an embedded axis is loaded, so the file drops its copy
  assert.equal(out.channels.roll, undefined);
  assert.deepEqual(serializeFunscript({ script: [{ at: 0, pos: 7 }], raw: f.raw }).channels.roll, doc.channels.roll, 'kept when the open did not take it');
  assert.equal(out.channels.stroke.note, 'keep');
  assert.deepEqual(out.channels.stroke.actions, [{ at: 0, pos: 7 }]);
  assert.equal(out.actions, undefined);
});

test('foreign keys survive byte-for-byte in value; only actions change (property)', () => {
  const r = rng(2024);
  const junk = () => ({ s: 'x' + Math.floor(r() * 99), n: r() * 1000, b: r() < 0.5, nul: null, arr: [1, 'two', { three: 3.5 }], deep: { a: { b: [r(), r()] } }, uni: 'caf\u00e9 \u{1F43E}' });
  for (let i = 0; i < 300; i++) {
    const doc = { version: '1.0', inverted: r() < 0.3, range: r() < 0.5 ? 100 : 90, metadata: { title: 'T' + i, creator: 'me', ...junk(), chapters: [{ name: 'a', startTime: '00:00:01.000', endTime: '00:00:05.000', extra: junk() }] }, zzz: junk(), actions: [] };
    let t = 0;
    for (let k = 0; k < Math.floor(r() * 40); k++) { t += 1 + Math.floor(r() * 500); doc.actions.push({ at: t, pos: Math.floor(r() * 101) }); }
    if (r() < 0.3) doc.actions.reverse();
    const text = JSON.stringify(doc);
    const f = parseFunscript(text);
    assert.deepEqual(f.raw, JSON.parse(text), 'raw is the file');
    const out = JSON.parse(stringifyFunscript(f));
    const { actions: oa, ...oRest } = out, { actions: da, ...dRest } = JSON.parse(text);
    assert.deepEqual(oRest, dRest, 'every other key identical');
    assert.deepEqual(Object.keys(out), Object.keys(JSON.parse(text)), 'key order kept');
    // parse . serialise = identity on semantics
    const g = parseFunscript(stringifyFunscript(f));
    assert.deepEqual(g.script, f.script);
    assert.equal(g.meta.inverted, f.meta.inverted);
    // serialise . parse is idempotent after the first normalisation
    assert.equal(stringifyFunscript(g), stringifyFunscript(f));
    // editing the script changes only actions
    const edited = f.script.map((a) => ({ at: a.at, pos: 100 - a.pos }));
    const e = JSON.parse(stringifyFunscript({ script: edited, meta: f.meta, raw: f.raw }));
    const { actions: ea, ...eRest } = e;
    assert.deepEqual(eRest, dRest);
    assert.equal(parseFunscript(e).script.length, edited.length);
    assert.deepEqual(parseFunscript(e).script, edited);
  }
});

test('chapters and bookmarks: OFS-style metadata read; bookmarks written, chapters pass through untouched (paw-1w0x)', () => {
  assert.equal(formatClock(3723456), '01:02:03.456'); assert.equal(parseClock('01:02:03.456'), 3723456);
  assert.equal(parseClock('02:03'), 123000); assert.ok(Number.isNaN(parseClock('x'))); assert.equal(parseClock(1500), 1500);
  const doc = { actions: [{ at: 0, pos: 0 }, { at: 60000, pos: 100 }], metadata: {
    duration: 61, chapters: [{ name: 'B', startTime: '00:00:30.000', endTime: '00:01:00.000', keep: 1 }, { name: 'A', startTime: '00:00:00.000', endTime: '00:00:30.000' }],
    bookmarks: [{ name: 'hi', time: '00:00:10.500', tag: 'z' }] } };
  const f = parseFunscript(doc);
  assert.deepEqual(f.meta.chapters.map((c) => [c.id, c.name, c.t0, c.t1]), [['ch1', 'A', 0, 30000], ['ch2', 'B', 30000, 60000]]);
  assert.deepEqual(f.meta.bookmarks, [{ id: 'bm1', at: 10500, note: 'hi' }]);
  assert.equal(f.meta.durationMs, 61000);
  assert.deepEqual(f.meta.chapters.map((c) => c.t0), marksOf(doc).slice(0, 2), 'agrees with funscript.js marksOf');
  // untouched metadata when no marks passed; extras on matching entries kept when passed
  assert.deepEqual(serializeFunscript(f).metadata, doc.metadata);
  const chapters = [...f.meta.chapters, { id: 'new', t0: 40000, t1: 50000, name: 'C', color: '#ff0' }];
  const out = serializeFunscript(f, { chapters, bookmarks: f.meta.bookmarks });
  assert.deepEqual(out.metadata.chapters, doc.metadata.chapters, "chapters are never rewritten: the file's own list, order and keys");
  assert.equal(out.metadata.bookmarks[0].tag, 'z'); assert.equal(out.metadata.duration, 61);
  assert.equal(readMarks(out.metadata).chapters.length, 2);
  // a chapter without an endTime, an odd entry, unsorted: still exactly as the other tool wrote them
  const odd = { actions: [{ at: 0, pos: 0 }], metadata: { chapters: [{ name: 'late', startTime: '00:00:20.000' }, 'junk', { name: 'early', startTime: '00:00:01.000', x: [1] }] } };
  assert.deepEqual(serializeFunscript(parseFunscript(odd), { chapters: [], bookmarks: [] }).metadata.chapters, odd.metadata.chapters);
  // creates metadata only when there is something to write
  assert.equal(serializeFunscript({ script: [], raw: { actions: [] } }, { chapters: [], bookmarks: [] }).metadata, undefined);
  assert.deepEqual(serializeFunscript({ script: [], raw: { actions: [] } }, { bookmarks: [{ id: 'b', at: 1000, note: 'n' }] }).metadata.bookmarks, [{ name: 'n', time: '00:00:01.000' }]);
});

test('axes: names both ways, discovery, export targets', () => {
  assert.equal(axisName('R1'), 'roll'); assert.equal(axisName('Roll'), 'roll'); assert.equal(axisName(''), 'stroke'); assert.equal(axisName('L0'), 'stroke'); assert.equal(axisName('bogus'), null);
  assert.equal(axisPath('C:\\v\\clip.mp4', 'stroke'), 'C:\\v\\clip.funscript');
  assert.equal(axisPath('C:\\v\\clip.mp4', 'R1'), 'C:\\v\\clip.roll.funscript');
  assert.equal(axisPath('/v/my.clip.mkv', 'pitch', { alt: true }), '/v/my.clip.pawscript.pitch.funscript');
  assert.throws(() => axisPath('a.mp4', 'nope'), /unknown axis/);
  assert.deepEqual(axisPaths('a.mp4', ['stroke', 'twist']), { stroke: 'a.funscript', twist: 'a.twist.funscript' });
  assert.deepEqual(parseAxisFile('/v/clip.roll.funscript'), { base: '/v/clip', axis: 'roll', alt: false });
  assert.deepEqual(parseAxisFile('clip.pawscript.funscript'), { base: 'clip', axis: 'stroke', alt: true });
  assert.equal(parseAxisFile('clip.mp4'), null);
  for (const ax of ['stroke', 'roll', 'pitch', 'twist', 'surge', 'sway', 'vib']) assert.equal(parseAxisFile(axisPath('/d/x.mp4', ax)).axis, ax);

  const listing = ['/v/Clip.funscript', '/v/clip.roll.funscript', '/v/clip.pawscript.funscript', '/v/clip.pawscript.pitch.funscript', '/v/other.funscript', '/w/clip.twist.funscript', '/v/clip.mp4'];
  const d = discoverAxes('/v/clip.mp4', listing);
  assert.deepEqual(Object.keys(d.found).sort(), ['pitch', 'roll', 'stroke']);
  assert.equal(d.found.stroke.path, '/v/Clip.funscript'); assert.equal(d.found.stroke.alt, false);
  assert.deepEqual(d.alternates.stroke, [{ path: '/v/clip.pawscript.funscript', alt: true }]);
  assert.equal(d.found.pitch.alt, true);
  assert.deepEqual(d.other.sort(), ['/v/other.funscript', '/w/clip.twist.funscript']);
  assert.deepEqual(discoverAxes('clip.mp4', ['clip.funscript', 'clip.sway.funscript']).found.sway, { path: 'clip.sway.funscript', alt: false });

  // same policy as runs.js exportTarget for the stroke axis
  for (const [exists, over] of [[false, false], [true, false], [true, true]]) {
    const mine = exportTargets('C:\\v\\clip.mp4', ['stroke'], exists ? ['c:/v/CLIP.funscript'] : [], over).stroke;
    const theirs = exportTarget('C:\\v\\clip.mp4', exists, over);
    assert.deepEqual(mine, theirs);
  }
  assert.equal(exportTargets('/v/clip.mp4', ['roll'], ['/v/clip.roll.funscript']).roll.script, '/v/clip.pawscript.roll.funscript');
});
