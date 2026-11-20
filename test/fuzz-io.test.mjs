// Fuzz tests for lib/io (.pawproj v1): save -> load -> save is byte-identical, unknown top-level blocks and nested keys
// survive, and corrupt input gives a clean ProjectError (never another exception, never a half-valid doc).
// Seeded (mulberry32). FUZZ_SEEDS=n scales the seed count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValid } from '../src/lib/core/script.js';
import { mulberry32, hashSeed } from '../src/lib/gen/util.js';
import { GENERATORS } from '../src/lib/gen/generators.js';
import { parse, serialize, getBlock, setBlock, ProjectError } from '../src/lib/io/index.js';

const SEEDS = Number(process.env.FUZZ_SEEDS) || 150;
const J = (x) => JSON.stringify(x);
const pick = (rng, a) => a[Math.floor(rng() * a.length)];
const AT = '2026-11-06T10:00:00.000Z', OPTS = { savedAt: AT, appVersion: '1.2.3' };
const STRINGS = ['', 'plain', 'a b', 'C:\\clips\\a b.mp4', 'tab\there', 'quote"s', 'new\nline', '\u{1F43E}', 'caf\u00e9', '\u2028\u2029', 'back\\slash', '</script>', '0', 'null'];

function randValue(rng, depth = 0) {
  const k = rng();
  if (depth > 2 || k < 0.35) return pick(rng, [null, true, false, 0, -1, 1.5, 1e21, 123456789, pick(rng, STRINGS)]);
  if (k < 0.65) return Array.from({ length: Math.floor(rng() * 4) }, () => randValue(rng, depth + 1));
  const o = {}; for (let i = 0; i < Math.floor(rng() * 4); i++) o['k' + i + pick(rng, ['', '_x', 'Y'])] = randValue(rng, depth + 1);
  return o;
}
const randObj = (rng) => ({ a: randValue(rng), b: randValue(rng) });
function randDoc(rng) {
  const mk = () => GENERATORS[pick(rng, ['strokes', 'smooth', 'ramp', 'tease'])].gen(0, Math.floor(rng() * 30000), {}, { seed: Math.floor(rng() * 1e6) });
  const axes = { stroke: rng() < 0.1 ? [] : mk() };
  if (rng() < 0.5) axes.roll = mk();
  const doc = {
    media: rng() < 0.8 ? { path: pick(rng, STRINGS) || 'x.mp4', name: pick(rng, STRINGS), size: rng() < 0.5 ? Math.floor(rng() * 1e10) : null, hash: null, durationMs: 1e5, fps: 29.97, isVfr: rng() < 0.5, width: 1920, height: 1080 } : null,
    axes, activeAxis: pick(rng, Object.keys(axes)),
    chapters: Array.from({ length: Math.floor(rng() * 4) }, (_, i) => ({ id: 'c' + i, t0: i * 100, t1: i * 100 + 90, name: pick(rng, STRINGS), color: null, ...(rng() < 0.3 ? { future: randValue(rng) } : {}) })),
    bookmarks: Array.from({ length: Math.floor(rng() * 3) }, (_, i) => ({ id: 'b' + i, at: i * 77, note: pick(rng, STRINGS) })),
    loops: [], plan: Array.from({ length: Math.floor(rng() * 3) }, (_, i) => ({ id: 'p' + i, t0: i * 1000, t1: i * 1000 + 900, kind: 'oral', recipe: 'oral', params: randObj(rng) })),
    ghosts: [], settings: randObj(rng), view: rng() < 0.5 ? { start: 0, span: 60000 } : null,
    profileId: rng() < 0.5 ? 'handy' : null, playheadMs: rng() < 0.5 ? Math.floor(rng() * 1e5) : null,
    meta: { app: { name: 'Pawscript', version: '1.2.3' }, createdAt: AT, savedAt: AT }, extra: {},
  };
  for (let i = 0; i < Math.floor(rng() * 4); i++) doc.extra['block' + i] = randValue(rng);
  if (rng() < 0.2) doc.extra.graphs = { v: 1, items: [{ id: 'g', nodes: [], links: [], future: randValue(rng) }] };
  return doc;
}

test('fuzz io: save -> load -> save is byte-identical (three generations); axes valid', () => {
  for (let seed = 0; seed < SEEDS; seed++) {
    const rng = mulberry32(hashSeed('io', seed)), doc = randDoc(rng);
    const t1 = serialize(doc, OPTS);
    const d2 = parse(t1), t2 = serialize(d2, OPTS);
    assert.equal(t2, t1, `seed ${seed}: second save differs`);
    const t3 = serialize(parse(t2), OPTS);
    assert.equal(t3, t1, `seed ${seed}: third save differs`);
    for (const s of Object.values(d2.axes)) assert.ok(isValid(s), `seed ${seed}`);
    assert.deepEqual(d2.extra, doc.extra, `seed ${seed}: extra blocks changed`);
    assert.deepEqual(d2.chapters, doc.chapters, `seed ${seed}: chapters (incl. unknown nested keys) changed`);
    assert.deepEqual(d2.plan, doc.plan, `seed ${seed}: plan changed`);
    assert.deepEqual(d2.axes, doc.axes, `seed ${seed}: axes changed`);
  }
});

test('fuzz io: unknown top-level blocks (as written by a newer/other build) survive load -> save', () => {
  for (let seed = 0; seed < SEEDS; seed++) {
    const rng = mulberry32(hashSeed('unk', seed)), doc = randDoc(rng);
    const o = JSON.parse(serialize(doc, OPTS));
    const unknown = {}; for (let i = 0; i < 1 + Math.floor(rng() * 3); i++) unknown['zz_future' + i] = randValue(rng);
    Object.assign(o, unknown);
    const back = JSON.parse(serialize(parse(J(o)), OPTS));
    for (const [k, v] of Object.entries(unknown)) assert.deepEqual(back[k], v, `seed ${seed} block ${k}`);
    // setBlock / getBlock round trip
    const v = randValue(rng), d = setBlock(parse(J(o)), 'myfeature', v), again = parse(serialize(d, OPTS));
    assert.deepEqual(getBlock(again, 'myfeature'), v, `seed ${seed} setBlock`);
    assert.equal(getBlock(setBlock(again, 'myfeature', undefined), 'myfeature', 'gone'), 'gone');
  }
});

const clean = (text, tag, opts) => {
  let d;
  try { d = parse(text, opts); } catch (e) {
    assert.ok(e instanceof ProjectError, `${tag}: threw non-ProjectError ${e && e.constructor.name}: ${e && e.message}`);
    assert.ok(Array.isArray(e.errors) && e.errors.length && typeof e.message === 'string' && e.message.length, `${tag}: ProjectError without details`);
    return null;
  }
  for (const s of Object.values(d.axes)) assert.ok(isValid(s), `${tag}: parse returned an invalid axis`);
  return d;
};

test('fuzz io: corrupt text (truncated, flipped, spliced, garbage) gives a clean ProjectError, never another throw', () => {
  for (let seed = 0; seed < SEEDS * 4; seed++) {
    const rng = mulberry32(hashSeed('corrupt', seed)), text = serialize(randDoc(rng), OPTS);
    const k = rng();
    let bad;
    if (k < 0.3) bad = text.slice(0, Math.floor(rng() * text.length));
    else if (k < 0.6) { const i = Math.floor(rng() * text.length); bad = text.slice(0, i) + pick(rng, ['}', '{', '"', ',', '[', ']', ':', '\u0000', 'x', '']) + text.slice(i + 1); }
    else if (k < 0.75) { const i = Math.floor(rng() * text.length), j = Math.floor(rng() * text.length); bad = text.slice(0, Math.min(i, j)) + text.slice(Math.max(i, j)); }
    else if (k < 0.85) bad = pick(rng, ['', ' ', 'null', '[]', '42', '"pawproj"', 'true', '{}', '{"format":"pawproj"}', '{"format":"pawproj","version":1}', '{"format":"pawproj","version":"1","axes":{}}', '{"format":"pawproj","version":99,"axes":{}}', '{"format":"other","version":1,"axes":{}}', '\ufeff{', 'NaN']);
    else bad = Array.from({ length: Math.floor(rng() * 40) }, () => String.fromCharCode(Math.floor(rng() * 0x10000))).join('');
    for (const opts of [{}, { lenient: true }]) clean(bad, `seed ${seed} kind ${k.toFixed(2)} opts ${J(opts)} text ${J(bad.slice(0, 120))}`, opts);
  }
});

test('fuzz io: structurally wrong field types give ProjectError (or a valid doc), never a TypeError', () => {
  const PATHS = [['axes'], ['axes', 'stroke'], ['media'], ['chapters'], ['bookmarks'], ['loops'], ['plan'], ['ghosts'], ['settings'], ['view'], ['version'], ['playheadMs'], ['activeAxis'], ['profileId'], ['axes', 'stroke', 0], ['chapters', 0], ['plan', 0], ['media', 'durationMs'], ['view', 'span']];
  const WRONG = [null, 0, -1, 'x', true, [], {}, [[1]], [['a', 'b']], [[1, 2, 3]], 'Infinity', [[-5, 200]], [[5, 1], [3, 1]], { a: 1 }, [null], [1, 2]];
  for (let seed = 0; seed < SEEDS * 4; seed++) {
    const rng = mulberry32(hashSeed('types', seed)), o = JSON.parse(serialize(randDoc(rng), OPTS));
    const path = pick(rng, PATHS), val = pick(rng, WRONG);
    let cur = o;
    for (let i = 0; i < path.length - 1; i++) { if (cur == null || typeof cur !== 'object') break; cur = cur[path[i]]; }
    if (cur && typeof cur === 'object') cur[path[path.length - 1]] = val;
    for (const opts of [{}, { lenient: true }]) clean(J(o), `seed ${seed} set ${path.join('.')} = ${J(val)} opts ${J(opts)}`, opts);
  }
});
