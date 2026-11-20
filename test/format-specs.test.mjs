// paw-rv74: the published format specs (docs/formats/*.md) are exactly true against the code. Each spec's JSON examples
// are parsed here (they cannot drift into something that is not JSON, or not what the reader takes), and minimal files
// built only from the specs' field lists (the bytes written out here by hand) open in Pawscript's readers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { decodeRuns, verifyRuns } from '../src/lib/runs-file.js';
import { parse as parseProject, toJSON, serialize } from '../src/lib/io/project.js';
import { projectDoc, appDocFrom, AUTOSAVE_OF } from '../src/app/project-logic.js';
import { checkPackManifest, buildManifest, packNames } from '../src/app/pack.js';
import { readProvenance, actionsHash, stamp } from '../src/lib/provenance.js';

const doc = (f) => readFileSync(new URL(`../docs/formats/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const jsonBlocks = (text) => [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
const raw = (text) => [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1].trim());
const documented = (text, key) => text.includes('`' + key + '`');
const ascii = (s) => Buffer.from(s, 'latin1');
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const name = (b) => createHash('sha256').update(b).digest('hex').slice(0, 32);

test('every ```json block in docs/formats parses', () => {
  for (const f of readdirSync(new URL('../docs/formats/', import.meta.url)).filter((x) => x.endsWith('.md'))) {
    assert.doesNotThrow(() => jsonBlocks(doc(f)), f);
  }
});

// the example's frame section, written from the spec's table: per frame u32 t, f32 value (NaN = none), u16 k
// (0xFFFF = no overlay), then k x (i16 x * 10000, i16 y * 10000, i8 visible, i8 label (-128 = none))
function exampleSection() {
  const b = Buffer.alloc(32);
  let o = 0;
  b.writeUInt32LE(0, o); b.writeFloatLE(0.5, o + 4); b.writeUInt16LE(2, o + 8); o += 10;
  b.writeInt16LE(2500, o); b.writeInt16LE(5000, o + 2); b.writeInt8(1, o + 4); b.writeInt8(-128, o + 5); o += 6;
  b.writeInt16LE(7500, o); b.writeInt16LE(5000, o + 2); b.writeInt8(0, o + 4); b.writeInt8(3, o + 5); o += 6;
  b.writeUInt32LE(33, o); b.writeFloatLE(NaN, o + 4); b.writeUInt16LE(0xffff, o + 8);
  return b;
}
const v1File = (manifest, blob) => { const m = Buffer.from(JSON.stringify(manifest)); return new Uint8Array(Buffer.concat([ascii('PAWRUNS1'), u32(m.length), m, blob])); };
const checkRun = (r) => {
  assert.equal(r.id, 'run1');
  assert.deepEqual([...r.points.at], [0, 500]); assert.deepEqual([...r.points.pos], [100, 0]);
  assert.deepEqual(r.frames.t, [0, 33]);
  assert.equal(r.frames.v[0], 0.5); assert.ok(Number.isNaN(r.frames.v[1]));
  assert.deepEqual(r.frames.ov[0].pts, [[0.25, 0.5, 1], [0.75, 0.5, 0, 3]]);
  assert.deepEqual(r.frames.ov[0].points, [[0.25, 0.5]]);
  assert.deepEqual(r.frames.ov[0].boxes, [[0.744, 0.494, 0.012, 0.012]]);
  assert.equal(r.frames.ov[1], null);
  assert.equal(r.visible, true); assert.equal(r.channel, 'primary'); assert.deepEqual(r.scenes, []);
};

test('pawruns.md version 1: the example, built from the field list, opens; n, id, range are required as it says', () => {
  const text = doc('pawruns.md'), [man] = jsonBlocks(text), sec = exampleSection();
  assert.equal(sec.toString('hex'), /The section, in hex:\s*`([0-9a-f]+)`/.exec(text)[1], 'the spec quotes the same bytes');
  assert.equal(man.format, 'pawruns'); assert.equal(man.version, 1);
  const runs = decodeRuns(v1File(man, sec));
  assert.equal(runs.length, 1);
  checkRun(runs[0]);
  assert.deepEqual([...runs[0].samples.t], [0, 33]);
  const without = (k, f) => { const m = structuredClone(man); f(m.runs[0]); return () => decodeRuns(v1File(m, sec)); };
  assert.throws(without('n', (r) => delete r.frames.n), /frame section out of range/);
  assert.throws(without('id', (r) => delete r.id), /incomplete/);
  assert.throws(without('range', (r) => delete r.range), /incomplete/);
  assert.throws(without('len', (r) => { r.frames.len = 31; }), /truncated|trailing|out of range/);
  for (const k of ['id', 'range', 'points', 'off', 'len', 'n', 'ovx', 'ext', 'points0', 'points0Primary', 'samples', 'confidence', 'channels', 'masksOmitted']) assert.ok(documented(text, k), k);
});

test('pawruns.md version 2: the example (head, blocks named by SHA-256, commit, PAWRTAIL + length + CRC-32) opens as written', async () => {
  const text = doc('pawruns.md'), [, record, commit] = jsonBlocks(text), [, recText, comText] = raw(text);
  const head = Buffer.concat([ascii('PAWRUNS1'), u32(32), ascii('{"format":"pawruns","version":2}')]);
  assert.equal(head.length, 44);
  const sec = exampleSection(), rec = Buffer.from(recText), com = Buffer.from(comText);
  assert.equal(rec.length, 129, 'the record as the spec gives it, 129 bytes');
  assert.equal(record.frames.sec, name(sec), 'the section block is named by its SHA-256');
  assert.equal(record.frames.n, 2);
  const recName = commit.runs[0];
  assert.equal(recName, name(rec), 'the record block is named by its SHA-256');
  assert.deepEqual(commit.blocks[record.frames.sec], [44, 32]);
  assert.deepEqual(commit.blocks[recName], [76, 129, [record.frames.sec]]);
  assert.equal(commit.v, 2);
  const trailer = Buffer.concat([ascii('PAWRTAIL'), u32(com.length), u32(crc32(com))]);
  const file = new Uint8Array(Buffer.concat([head, sec, rec, com, trailer]));
  const runs = decodeRuns(file);
  assert.equal(runs.length, 1);
  checkRun(runs[0]);
  assert.equal((await verifyRuns(runs)).size, 0, 'every block matches its name');
  // bytes after the newest commit (a write cut short) are ignored; a wrong CRC is not a commit
  assert.equal(decodeRuns(new Uint8Array(Buffer.concat([file, Buffer.from('PAWRTAIL\x01\x00')]))).length, 1);
  const bad = Buffer.from(file); bad[bad.length - 1] ^= 0xff;
  assert.throws(() => decodeRuns(new Uint8Array(bad)), /no complete version/);
});

test('pawpack.md: the example manifest is one a reader takes; the writer emits only documented keys', () => {
  const text = doc('pawpack.md'), [m] = jsonBlocks(text);
  assert.doesNotThrow(() => checkPackManifest(m));
  assert.throws(() => checkPackManifest({ ...m, version: '2.0' }), /newer Pawscript/);
  assert.throws(() => checkPackManifest({ ...m, files: [] }), /no files/);
  assert.throws(() => checkPackManifest({ ...m, files: [{ ...m.files[0], name: '../x.mp4' }] }), /outside its folder/);
  const built = buildManifest({ names: packNames({ video: 'C:/v/clip.mp4' }), media: { durationMs: 1, fps: 30, width: 2, height: 2, size: 3 }, published: { version: 2, at: 1 } });
  assert.deepEqual(Object.keys(built), Object.keys(m).filter((k) => k !== 'files'), 'the same keys in the same order as the example');
  assert.deepEqual(Object.keys(built.app), Object.keys(m.app));
  assert.deepEqual(Object.keys(built.video), Object.keys(m.video));
  assert.deepEqual(Object.keys(built.published), Object.keys(m.published));
  for (const k of Object.keys(m)) assert.ok(documented(text, k), k);
  assert.match(text, /always \[version 1\]\(pawruns\.md\)/, 'a pack carries runs version 1 (pack.js encodeRunsAsync)');
  assert.match(readFileSync(new URL('../src/app/pack.js', import.meta.url), 'utf8'), /await encodeRunsAsync\(/);
});

test('pawproj.md: the minimal example opens; unknown keys survive a load and a save; every key the writer emits is documented', () => {
  const text = doc('pawproj.md'), [min] = jsonBlocks(text);
  const pd = parseProject(JSON.stringify(min));
  assert.deepEqual(pd.axes.stroke, [{ at: 0, pos: 100 }, { at: 500, pos: 0 }, { at: 1000, pos: 100 }]);
  // a key Pawscript does not know, kept unchanged through load (appDocFrom) and save (projectDoc + serialize)
  const theirs = { a: [1, { b: 'c' }] };
  const d = appDocFrom(parseProject(JSON.stringify({ ...min, someoneElse: theirs })));
  const again = JSON.parse(serialize(projectDoc(d)));
  assert.deepEqual(again.someoneElse, theirs);
  // the core keys toJSON writes (a doc with every section set)
  const full = toJSON({ ...pd, media: { path: 'C:/v/clip.mp4', name: 'clip.mp4' }, playheadMs: 5, view: { start: 0, span: 10 } }, { projectPath: 'C:/v/clip.pawproj' });
  for (const k of Object.keys(full)) assert.ok(documented(text, k), 'core key ' + k);
  for (const k of ['path', 'relativePath', 'name', 'size', 'hash', 'durationMs', 'fps', 'isVfr', 'width', 'height', 'hasAudio', 'frameCount', 'fpsRational', 'startMs']) assert.match(text, new RegExp(`media\`[^\\n]*\\b${k}\\b`), 'media.' + k);
  // the blocks: every registered block that can save something, projectDoc's own keys, and the shell's
  const src = (p) => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8');
  const files = readdirSync(new URL('../src/', import.meta.url), { recursive: true }).map((p) => String(p).replace(/\\/g, '/')).filter((p) => /\.(js|svelte)$/.test(p) && !p.startsWith('app/app.svelte.js'));
  const blocks = files.flatMap((f) => [...src(f).matchAll(/registerBlock\??\.?\('(\w+)',\s*\{\s*(save: \(\) => null)?/g)].filter((m) => !m[2]).map((m) => m[1]));
  assert.ok(blocks.length >= 8 && !blocks.includes('runs'), 'the registered blocks that save (runs, seeder: none): ' + blocks);
  const own = /extra: \{ \.\.\.extra, \.\.\.\(blocks \|\| \{\}\), (.*?) \}, meta:/.exec(src('app/project-logic.js'))[1].match(/\b(\w+):/g).map((s) => s.slice(0, -1));
  assert.deepEqual(own, ['scenes', 'acts', 'modifiers', 'finish', 'repeats', 'runRanges', 'bakedEmpty']);
  const shell = /blockKeys: \[\.\.\.\(this\.app\.blocks\?\.keys\(\) \|\| \[\]\), '(\w+)', '(\w+)'\]/.exec(src('app/project.svelte.js')).slice(1);
  for (const k of [...blocks, ...own, ...shell, 'graphs', 'assist', AUTOSAVE_OF]) assert.ok(documented(text, k), 'block ' + k);
  assert.match(text, /keeps every key it does not know, unchanged/);
});

test('funscript-metadata.md: the example is read as a published Pawscript file; stamp() writes only documented keys', () => {
  const text = doc('funscript-metadata.md'), [f] = jsonBlocks(text), p = f.metadata.pawscript;
  assert.equal(actionsHash(f.actions), p.hash, 'the example hash is FNV-1a of "<at>:<pos>," of its actions');
  const info = readProvenance(f);
  assert.equal(info.kind, 'pawscript');
  assert.deepEqual(info.publish, p.publish);
  assert.deepEqual(Object.keys(p.publish), ['version', 'commit', 'date', 'build']);
  assert.equal(readProvenance({ ...f, actions: [...f.actions, { at: 1500, pos: 0 }] }).kind, 'changed');
  const out = stamp({ actions: f.actions, metadata: { creator: 'someone' } }, { version: '1.0.0', project: 'clip.pawproj', how: { tracked: 0.5, modifiers: ['throbbing'] }, publish: p.publish, now: new Date(p.written) });
  for (const k of Object.keys(out.metadata.pawscript)) assert.ok(documented(text, k), 'pawscript.' + k);
  for (const k of Object.keys(out.metadata)) assert.ok(documented(text, k), 'metadata.' + k);
  assert.ok(out.metadata.pawscript.from, 'an imported creator is kept in from');
  assert.deepEqual(Object.keys(out.metadata.pawscript).filter((k) => k !== 'from'), Object.keys(p), 'the example has the writer\'s keys in its order');
});
