// paw-xn04: funscripts say where they came from (src/lib/provenance.js) and the save / export pipeline writes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stamp, readProvenance, actionsHash, originText, originLabel, howOf } from '../src/lib/provenance.js';
import { parseFunscript, serializeFunscript, BUILTIN_PRESETS } from '../src/lib/io/index.js';
import * as L from '../src/app/project-logic.js';

const NOW = new Date('2026-11-16T12:00:00Z');
const acts = [{ at: 0, pos: 10 }, { at: 500, pos: 90 }, { at: 1000, pos: 10 }];

test('a fresh file: the block, the tool fields, a hash of the actions as written; it reads back as Pawscript from this project', () => {
  const raw = stamp(serializeFunscript({ script: acts }), { version: '0.1.0', project: 'clip.pawproj', how: { tracked: 0.5 }, now: NOW });
  const p = raw.metadata.pawscript;
  assert.equal(p.app, 'Pawscript'); assert.equal(p.version, '0.1.0'); assert.equal(p.written, NOW.toISOString());
  assert.equal(p.project, 'clip.pawproj'); assert.deepEqual(p.how, { tracked: 0.5 }); assert.equal(p.hash, actionsHash(raw.actions));
  assert.equal(raw.metadata.creator_software, 'Pawscript');
  assert.equal(p.from, undefined);
  const info = readProvenance(JSON.parse(JSON.stringify(raw)));
  assert.equal(info.kind, 'pawscript');
  assert.match(originText(info, { project: 'CLIP.pawproj' }), /^Written by Pawscript 0\.1\.0 on .+ from this project$/);
  assert.match(originText(info, { project: 'other.pawproj' }), /from clip\.pawproj$/);
  assert.equal(originLabel(info), 'Pawscript');
  // still a valid funscript, actions untouched
  const back = parseFunscript(JSON.stringify(raw));
  assert.deepEqual(back.script, acts);
  assert.deepEqual(back.notes, []);
});

test('edited outside since: the hash no longer matches (or another tool signed it)', () => {
  const raw = stamp(serializeFunscript({ script: acts }), { project: 'clip.pawproj', now: NOW });
  const moved = JSON.parse(JSON.stringify(raw));
  moved.actions[1].pos = 80;
  const info = readProvenance(moved);
  assert.equal(info.kind, 'changed');
  assert.equal(originText(info), 'Written by Pawscript, changed outside since');
  assert.equal(originLabel(info), 'Pawscript (edited elsewhere since)');
  const resigned = JSON.parse(JSON.stringify(raw));
  resigned.metadata.creator_software = 'OpenFunscripter';
  assert.equal(readProvenance(resigned).kind, 'changed');
  assert.match(originText(readProvenance(resigned)), /last saved by OpenFunscripter/);
});

test('foreign and missing metadata', () => {
  const ofs = { version: '1.0', actions: acts, metadata: { title: 't', creator: 'Someone', creator_software: 'OpenFunscripter', creator_software_version: '3.2', license: 'x' } };
  const info = readProvenance(ofs);
  assert.deepEqual(info, { kind: 'foreign', tool: 'OpenFunscripter', version: '3.2', creator: 'Someone' });
  assert.equal(originText(info), 'From OpenFunscripter 3.2, by Someone');
  assert.equal(originLabel(info), 'OpenFunscripter');
  assert.equal(originText(readProvenance({ actions: acts, metadata: { creator: 'Bob' } })), 'By Bob');
  assert.deepEqual(readProvenance({ actions: acts }), { kind: 'unknown' });
  assert.equal(originText(readProvenance({ actions: acts, metadata: {} })), 'Unknown origin');
});

test('an imported script edited and written: Pawscript wrote it, the original creator / tool kept in `from`, every other key untouched', () => {
  const ofs = { version: '1.0', inverted: false, range: 100, custom: { keep: 'me' }, actions: acts,
    metadata: { title: 'T', creator: 'Someone', creator_software: 'OpenFunscripter', creator_software_version: '3.2', tags: ['a'], chapters: [] } };
  const parsed = parseFunscript(JSON.stringify(ofs));
  const edited = [...parsed.script, { at: 1500, pos: 70 }];
  const raw = stamp(serializeFunscript({ script: edited, meta: parsed.meta, raw: parsed.raw }), { project: 'p.pawproj', now: NOW });
  assert.equal(raw.metadata.creator, 'Someone', 'the creator name is never overwritten');
  assert.equal(raw.metadata.title, 'T'); assert.deepEqual(raw.metadata.tags, ['a']); assert.deepEqual(raw.custom, { keep: 'me' });
  assert.deepEqual(raw.metadata.pawscript.from, { tool: 'OpenFunscripter', version: '3.2', creator: 'Someone' });
  assert.equal(readProvenance(raw).kind, 'pawscript');
  // written again after another edit: still `from` the original, not from Pawscript
  const again = stamp({ ...raw, actions: [...raw.actions, { at: 2000, pos: 5 }] }, { project: 'p.pawproj', now: new Date('2026-11-17T00:00:00Z') });
  assert.deepEqual(again.metadata.pawscript.from, raw.metadata.pawscript.from);
  assert.equal(again.metadata.pawscript.written, '2026-11-17T00:00:00.000Z');
});

test('same actions rewritten: the block is kept as is (same text, so the write is skipped)', () => {
  const raw = stamp(serializeFunscript({ script: acts }), { project: 'clip.pawproj', now: NOW });
  assert.equal(stamp(raw, { project: 'clip.pawproj', now: new Date() }), raw);
  assert.notEqual(stamp(raw, { project: 'other.pawproj', now: new Date() }), raw);
});

test('an inverted file: the hash is of the actions as written (flipped), and reads back as ours', () => {
  const raw = stamp(serializeFunscript({ script: acts, meta: { inverted: true } }), { now: NOW });
  assert.equal(raw.actions[0].pos, 90);
  assert.equal(readProvenance(raw).kind, 'pawscript');
});

test('howOf: tracked = equal to a run point, imported = equal to the reference copy, modifiers = live kinds; unknown shares left out', () => {
  const base = [{ at: 0, pos: 10 }, { at: 100, pos: 50 }, { at: 200, pos: 90 }, { at: 300, pos: 20 }];
  const ghosts = [
    { id: 'r1', script: [{ at: 0, pos: 10 }, { at: 100, pos: 50 }], source: { kind: 'tracker' } },
    { id: 'ref', script: [{ at: 200, pos: 90 }, { at: 100, pos: 50 }], source: { kind: 'reference' } },
    { id: 'roll', axis: 'roll', script: [{ at: 300, pos: 20 }], source: { kind: 'axes' } },
  ];
  assert.deepEqual(howOf({ base, ghosts, fx: [{ kind: 'spurt' }, { kind: 'spurt' }, { kind: 'throbbing', muted: true }] }), { tracked: 0.5, imported: 0.25, modifiers: ['spurt'] });
  assert.deepEqual(howOf({ base, ghosts: [] }), {});
  assert.deepEqual(howOf({ base, ghosts, axis: 'roll' }), { tracked: 0.25 });
});

test('saveItems / exportItems stamp every axis file when given prov; without it nothing changes', () => {
  const doc = { axes: { stroke: acts, roll: [{ at: 0, pos: 50 }, { at: 400, pos: 60 }] }, chapters: [], bookmarks: [], files: {} };
  const plain = L.saveItems(doc, 'C:/v/clip.mp4');
  assert.ok(plain.items.every((it) => !it.raw.metadata?.pawscript));
  const prov = { project: 'clip.pawproj', how: { stroke: { tracked: 1 } }, now: NOW, version: '9.9' };
  const s = L.saveItems({ ...doc, prov }, 'C:/v/clip.mp4');
  assert.deepEqual(s.items.map((it) => it.raw.metadata.pawscript.project), ['clip.pawproj', 'clip.pawproj']);
  assert.deepEqual(s.items[0].raw.metadata.pawscript.how, { tracked: 1 });
  assert.equal(s.items[1].raw.metadata.pawscript.how, undefined);
  assert.equal(JSON.parse(s.items[0].text).metadata.pawscript.version, '9.9');
  const e = L.exportItems({ ...doc, prov }, { axes: ['stroke', 'roll'], base: 'C:/v/clip.mp4', preset: BUILTIN_PRESETS[0] });
  assert.ok(e.every((it) => readProvenance(it.raw).kind === 'pawscript'));
});
