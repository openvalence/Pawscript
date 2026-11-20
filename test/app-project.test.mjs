import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/app/project-logic.js';
import { BUILTIN_PRESETS, parse, serialize } from '../src/lib/io/index.js';

const VIDEO = 'C:/v/clip.mp4', STROKE = 'C:/v/clip.funscript', ROLL = 'C:/v/clip.roll.funscript';

// In-memory app.backend with the src-tauri/API.md semantics project-logic.js relies on (same as dev/mock-app.js).
function memBackend(init = {}, { failWrite = null, listDir = false } = {}) {
  const files = new Map(Object.entries(init)), written = new Map(), autosaves = new Map();
  const sha = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(16); };
  const fail = (code, msg) => Object.assign(new Error(msg), { code });
  const be = {
    files, sha,
    async exists(p) { return files.has(p); },
    async readText(p) { if (!files.has(p)) throw fail('not_found', 'not found: ' + p); return files.get(p); },
    async readFile(p) { const text = await this.readText(p); return { text, sha256: sha(text), size: text.length }; },
    async writeText(p, s) { files.set(p, s); },
    async writeWithBackup(p, text, { expectedSha256 } = {}) {
      if (failWrite && failWrite(p)) throw fail('disk_full', 'disk full: ' + p);
      const had = files.has(p), old = files.get(p);
      if (expectedSha256 && had && sha(old) !== expectedSha256) throw fail('conflict', 'changed on disk: ' + p);
      let first = null;
      if (had && written.get(p) !== sha(old) && old !== text) {
        first = p + '.bak';
        for (let n = 2; files.has(first) && files.get(first) !== old; n++) first = p + '.' + n + '.bak';
        files.set(first, old);
      }
      const unchanged = had && old === text;
      files.set(p, text); written.set(p, sha(text));
      return { path: p, sha256: sha(text), first_backup: first, rolling_backup: had && !first && !unchanged ? 'appdata' : null, unchanged };
    },
    async autosaveWrite({ projectPath = null, session, title = '', content }) {
      const id = projectPath ? 'p-' + sha(projectPath) : 'u-' + session, saved_ms = Date.now();
      const c = autosaves.get(id) || { id, project_path: projectPath, session, title, snapshots: [] };
      Object.assign(c, { session, title, updated_ms: saved_ms });
      c.snapshots = [{ id, path: `autosave/${id}/${saved_ms}-${c.snapshots.length}.pawproj`, saved_ms }, ...c.snapshots];
      files.set(c.snapshots[0].path, content); autosaves.set(id, c);
      return c.snapshots[0];
    },
    async autosaveList() { return [...autosaves.values()].map((c) => ({ ...c, unsaved_work: true })); },
    async autosaveClear(id) { autosaves.delete(id); },
  };
  if (listDir) be.listDir = async (dir, { stem = '', ext = '' } = {}) => [...files.keys()].filter((p) => L.dirName(p) === dir)
    .map((p) => ({ name: L.fileName(p), path: p })).filter((e) => e.name.toLowerCase().startsWith(stem.toLowerCase()) && e.name.toLowerCase().endsWith(ext));
  return be;
}

const foreign = {
  version: '1.0', inverted: false, range: 100, custom: { keep: 'me' },
  metadata: { creator: 'someone', tags: ['x'], chapters: [{ name: 'Intro', startTime: '00:00:00.000', endTime: '00:00:05.000', extra: 1 }] },
  actions: [{ at: 0, pos: 10 }, { at: 500, pos: 90 }, { at: 1000, pos: 10 }],
};
const rollFile = { version: '1.0', actions: [{ at: 0, pos: 50 }, { at: 700, pos: 60 }] };

async function open(be, mode = 'edit') {
  const disc = await L.discover(be, VIDEO);
  const doc = L.buildOpenDoc({ media: L.mediaFrom(VIDEO, null), found: disc.found, mode });
  return { doc, shas: mode === 'edit' ? L.shasFrom(disc.found) : {}, disc };
}
// what project.svelte.js #recordWritten does after a save
function record(doc, written) {
  for (const it of written) if (it.axis) doc.files = { ...doc.files, [it.axis]: { ...doc.files[it.axis], path: it.path, raw: it.raw, script: it.script, ...(it.axis === 'stroke' ? { chapters: doc.chapters, bookmarks: doc.bookmarks } : {}), foreign: false, backedUp: true } };
}
async function save(be, doc, shas, ask = async () => { throw new Error('unexpected conflict prompt'); }) {
  const { items, empty } = L.saveItems(doc, VIDEO);
  const res = await L.writeFiles({ backend: be, items, shas, ask });
  if (!res.cancelled) record(doc, res.written);
  return { ...res, empty };
}

test('first save over a foreign file keeps the original as .bak, unknown keys + chapters survive (untouched: paw-1w0x); second save makes no new .bak', async () => {
  const orig = JSON.stringify(foreign);
  const be = memBackend({ [VIDEO]: 'video', [STROKE]: orig, [ROLL]: JSON.stringify(rollFile) });
  const { doc, shas } = await open(be);
  assert.deepEqual(doc.axes.stroke.map((a) => a.at), [0, 500, 1000]);
  assert.equal(doc.chapters[0].name, 'Intro');
  assert.equal(doc.ghosts[0].pinned, true); assert.equal(doc.ghosts[0].visible, false); assert.equal(doc.ghosts[0].source.path, STROKE);

  doc.axes = { ...doc.axes, stroke: [...doc.axes.stroke, { at: 1500, pos: 80 }] };
  doc.bookmarks = [{ id: 'b1', at: 700, note: 'look' }];
  const r1 = await save(be, doc, shas);
  assert.equal(r1.failed, null);
  assert.deepEqual(r1.written.map((w) => w.path), [STROKE]);          // roll untouched: unchanged
  assert.equal(r1.plan.find((p) => p.path === STROKE).expected, be.sha(orig));   // the loaded sha is passed as expectedSha256
  assert.deepEqual(r1.backups, [STROKE + '.bak']);
  assert.equal(be.files.get(STROKE + '.bak'), orig);
  const out = JSON.parse(be.files.get(STROKE));
  assert.deepEqual(out.custom, { keep: 'me' });
  assert.equal(out.metadata.creator, 'someone'); assert.deepEqual(out.metadata.tags, ['x']);
  assert.deepEqual(out.metadata.chapters, foreign.metadata.chapters, 'the imported chapters, exactly as the other tool wrote them');
  assert.equal(out.metadata.bookmarks[0].name, 'look');
  assert.equal(out.actions.length, 4);
  assert.equal(be.files.get(ROLL), JSON.stringify(rollFile));          // not rewritten
  assert.equal(shas[L.pathKey(STROKE)], be.sha(be.files.get(STROKE))); // sha from the SaveResult

  doc.axes = { ...doc.axes, stroke: [...doc.axes.stroke, { at: 2000, pos: 20 }] };
  const r2 = await save(be, doc, shas);
  assert.equal(r2.plan.find((p) => p.path === STROKE).action, 'write');
  assert.deepEqual(r2.backups, []);
  assert.equal(be.files.get(STROKE + '.bak'), orig);
  assert.deepEqual(JSON.parse(be.files.get(STROKE)).custom, { keep: 'me' });
});

test('a file that appeared (or changed) on disk since open is never silently replaced', async () => {
  const be = memBackend({ [VIDEO]: 'video' });
  const { doc, shas } = await open(be);
  doc.axes = { roll: [{ at: 0, pos: 10 }, { at: 400, pos: 70 }] };
  const theirs = JSON.stringify(rollFile);
  be.files.set(ROLL, theirs);                                          // someone else wrote it meanwhile

  let asked = null;
  const r = await save(be, doc, shas, async (c) => { asked = c.map((x) => x.path); return 'cancel'; });
  assert.equal(r.cancelled, true); assert.deepEqual(asked, [ROLL]);
  assert.equal(be.files.get(ROLL), theirs);

  const alt = await save(be, doc, shas, async () => 'alt');
  assert.deepEqual(alt.written.map((w) => w.path), ['C:/v/clip.pawscript.roll.funscript']);
  assert.equal(be.files.get(ROLL), theirs);
  assert.equal(doc.files.roll.path, 'C:/v/clip.pawscript.roll.funscript');

  // replace: the native side keeps the original as .bak; the sha the user saw is still checked
  const be2 = memBackend({ [VIDEO]: 'video' });
  const o2 = await open(be2);
  o2.doc.axes = { roll: [{ at: 0, pos: 10 }] };
  be2.files.set(ROLL, theirs);
  const rep = await save(be2, o2.doc, o2.shas, async () => 'replace');
  assert.equal(rep.failed, null);
  assert.equal(rep.plan[0].expected, be2.sha(theirs));
  assert.equal(be2.files.get(ROLL + '.bak'), theirs);

  // changed by another program after we loaded it
  const be3 = memBackend({ [VIDEO]: 'video', [STROKE]: JSON.stringify(foreign) });
  const o3 = await open(be3);
  o3.doc.axes = { ...o3.doc.axes, stroke: [{ at: 0, pos: 0 }] };
  be3.files.set(STROKE, JSON.stringify({ ...foreign, actions: [] }));
  let n = 0;
  assert.equal((await save(be3, o3.doc, o3.shas, async () => { n++; return 'cancel'; })).cancelled, true);
  assert.equal(n, 1);

  // changed again between the prompt and the write: the native conflict stops it
  const be5 = memBackend({ [VIDEO]: 'video', [STROKE]: JSON.stringify(foreign) });
  const o5 = await open(be5);
  o5.doc.axes = { stroke: [{ at: 0, pos: 0 }] };
  be5.files.set(STROKE, 'x1');
  const r5 = await save(be5, o5.doc, o5.shas, async () => { be5.files.set(STROKE, 'x2'); return 'replace'; });
  assert.equal(r5.failed.code, 'conflict'); assert.equal(be5.files.get(STROKE), 'x2');

  // reference mode registers nothing: saving over the referenced file asks
  const be4 = memBackend({ [VIDEO]: 'video', [STROKE]: JSON.stringify(foreign) });
  const o4 = await open(be4, 'reference');
  assert.deepEqual(o4.doc.axes, {}); assert.equal(o4.doc.ghosts[0].visible, true);
  o4.doc.axes = { stroke: [{ at: 0, pos: 0 }] };
  let asked4 = 0;
  await save(be4, o4.doc, o4.shas, async () => { asked4++; return 'cancel'; });
  assert.equal(asked4, 1);
});

test('empty axes are not written, an emptied loaded file is left alone', async () => {
  const orig = JSON.stringify(foreign);
  const be = memBackend({ [VIDEO]: 'video', [STROKE]: orig });
  const { doc, shas } = await open(be);
  doc.axes = { stroke: [], pitch: [], roll: [{ at: 0, pos: 5 }] };
  const r = await save(be, doc, shas);
  assert.deepEqual(r.written.map((w) => w.path), [ROLL]);
  assert.deepEqual(r.empty, [STROKE]);
  assert.equal(be.files.get(STROKE), orig);
  assert.equal(be.files.has('C:/v/clip.pitch.funscript'), false);
  be.files.set('C:/v/clip.twist.funscript', '');                       // an empty file counts as absent
  doc.axes = { ...doc.axes, twist: [{ at: 0, pos: 1 }] };
  assert.equal((await save(be, doc, shas)).plan.find((p) => p.axis === 'twist').action, 'create');
});

test('a failed write stops the save and names the file; the original is untouched', async () => {
  const orig = JSON.stringify(foreign);
  const be = memBackend({ [VIDEO]: 'video', [STROKE]: orig, [ROLL]: JSON.stringify(rollFile) }, { failWrite: (p) => p === ROLL });
  const { doc, shas } = await open(be);
  doc.axes = { roll: [{ at: 0, pos: 2 }], stroke: [{ at: 0, pos: 1 }] };
  const r = await save(be, doc, shas);
  assert.equal(r.failed.path, ROLL); assert.equal(r.failed.code, 'disk_full');
  assert.equal(r.written.length, 0);                                    // stopped: stroke not attempted after the failure
  assert.equal(be.files.get(STROKE), orig);
});

test('paw-qbvj: bookmarks have no UI any more: a funscript and a .pawproj that have them open without error and save them back exactly', async () => {
  const marks = [{ name: 'drop', time: '00:00:00.700', tag: 'z' }, { name: '', time: '00:00:01.250' }];
  const file = { ...foreign, metadata: { ...foreign.metadata, bookmarks: marks } };
  const be = memBackend({ [VIDEO]: 'video', [STROKE]: JSON.stringify(file) });
  const { doc, shas } = await open(be);
  assert.deepEqual(doc.bookmarks.map((b) => [b.at, b.note]), [[700, 'drop'], [1250, '']], 'read into the document (no UI shows them)');
  doc.axes = { ...doc.axes, stroke: [...doc.axes.stroke, { at: 1500, pos: 80 }] };   // an edit: the stroke file is written again
  const r = await save(be, doc, shas);
  assert.equal(r.failed, null);
  const out = JSON.parse(be.files.get(STROKE));
  assert.equal(out.actions.length, 4, 'the edit is written');
  assert.deepEqual(out.metadata.bookmarks, marks, 'the bookmarks exactly as the file had them (their extra keys too)');
  assert.deepEqual(out.metadata.chapters, foreign.metadata.chapters, 'and the chapters');
  // the project file: loaded and saved back unchanged
  const pd = parse(serialize(L.projectDoc(doc)));
  assert.deepEqual(pd.bookmarks, doc.bookmarks);
  assert.deepEqual(L.appDocFrom(parse(serialize(L.projectDoc(L.appDocFrom(pd))))).bookmarks, doc.bookmarks, 'a second round trip too');
});

test('paw-1w0x: a .pawproj with chapters (saved before Chapters went) loads and saves them back exactly, overlaps included', () => {
  const chapters = [{ id: 'ch1', t0: 0, t1: 5000, name: 'Intro', color: '#4DA6FF' }, { id: 'ch2', t0: 4000, t1: 9000, name: 'Overlaps', color: null }];
  const text = serialize({ axes: { stroke: [{ at: 0, pos: 10 }, { at: 400, pos: 90 }] }, chapters, bookmarks: [{ id: 'bm1', at: 700, note: 'n' }] });
  const d = L.appDocFrom(parse(text));
  assert.deepEqual(d.chapters, chapters, 'loaded as stored');
  const again = parse(serialize(L.projectDoc(d)));
  assert.deepEqual(again.chapters, chapters, 'saved back untouched');
  assert.deepEqual(again.bookmarks, [{ id: 'bm1', at: 700, note: 'n' }]);
});

test('autosave content round trip restores axes, chapters, bookmarks, loops, ghost scripts; candidates matched by base / project', async () => {
  const doc = {
    media: L.mediaFrom(VIDEO, { duration_ms: 60000, video: { fps: 30, is_vfr: false, display_width: 1280, display_height: 720, rotation: 0 } }),
    axes: { stroke: [{ at: 0, pos: 10 }, { at: 400, pos: 90 }], roll: [{ at: 100, pos: 40 }] }, activeAxis: 'roll',
    chapters: [{ id: 'ch1', t0: 0, t1: 3000, name: 'A', color: '#4DA6FF' }], bookmarks: [{ id: 'bm1', at: 1200, note: 'n' }],
    loops: [{ id: 'lp1', t0: 1000, t1: 3400 }], plan: [],
    ghosts: [{ id: 'run1', name: 'Run 1', color: '#1FE59A', script: [{ at: 0, pos: 1 }, { at: 50, pos: 9 }], visible: true, source: { kind: 'tracker' } }],
    project: { path: null, extra: { other: { g: 1 } } },
  };
  const text = L.autosaveContent(doc, { base: VIDEO, view: { start: 0, span: 5000 }, playheadMs: 1234.5 });
  const { pd, base } = L.parseAutosave(text);
  assert.equal(base, VIDEO);
  const back = L.appDocFrom(pd);
  assert.deepEqual(back.axes, doc.axes); assert.deepEqual(back.chapters, doc.chapters); assert.deepEqual(back.bookmarks, doc.bookmarks);
  assert.deepEqual(back.loops, doc.loops); assert.equal(back.activeAxis, 'roll'); assert.equal(back.media.durationMs, 60000);
  assert.deepEqual(back.project.extra, { other: { g: 1 } });         // the autosave-only key is stripped
  assert.deepEqual(back.ghosts[0].script, doc.ghosts[0].script);      // tracker runs survive a crash

  const be = memBackend();
  await be.autosaveWrite({ session: 's1', title: 'clip.mp4', content: text });
  await be.autosaveWrite({ session: 's2', title: 'other', content: L.autosaveContent(doc, { base: 'C:/v/other.mp4' }) });
  await be.autosaveWrite({ projectPath: 'C:/p/show.pawproj', session: 's3', title: 'show', content: L.autosaveContent(doc, { projectPath: 'C:/p/show.pawproj' }) });
  assert.equal((await L.findCandidate(be, { base: 'c:\\v\\clip.mp4' })).cand.session, 's1');
  assert.equal((await L.findCandidate(be, { projectPath: 'C:/p/show.pawproj' })).cand.session, 's3');
  assert.equal(await L.findCandidate(be, { base: 'C:/v/none.mp4' }), null);
  await be.autosaveClear('u-s1');
  assert.equal(await L.findCandidate(be, { base: VIDEO }), null);     // cleared = not offered
});

test('rehydrateGhosts reloads emptied reference ghosts and drops other emptied ones', async () => {
  const be = memBackend({ [STROKE]: JSON.stringify(foreign) });
  const g = await L.rehydrateGhosts(be, [
    { id: 'ref', script: [], source: { kind: 'reference', path: STROKE } },
    { id: 'run1', script: [], source: { kind: 'tracker' } },
    { id: 'gone', script: [], source: { kind: 'reference', path: 'C:/v/missing.funscript' } },
    { id: 'kept', script: [{ at: 0, pos: 0 }], source: { kind: 'tracker' } },
  ]);
  assert.deepEqual(g.map((x) => x.id), ['ref', 'kept']);
  assert.equal(g[0].script.length, 3);
});

test('discovery: every axis, .pawscript variant as fallback, listDir when available, unreadable files reported', async () => {
  const init = { [VIDEO]: 'v', [STROKE]: JSON.stringify(foreign), 'C:/v/clip.pawscript.roll.funscript': JSON.stringify(rollFile),
    'C:/v/clip.pitch.funscript': '{not json', 'C:/v/clip.twist.funscript': '', 'C:/v/other.funscript': JSON.stringify(rollFile) };
  for (const listDir of [false, true]) {
    const d = await L.discover(memBackend(init, { listDir }), VIDEO);
    assert.deepEqual(Object.keys(d.found).sort(), ['roll', 'stroke']);
    assert.equal(d.found.roll.path, 'C:/v/clip.pawscript.roll.funscript');
    assert.deepEqual(d.unreadable.map((u) => u.path), ['C:/v/clip.pitch.funscript']);
    assert.ok(d.notes.some((n) => n.startsWith('clip.pitch.funscript')));
    assert.equal(Object.keys(L.shasFrom(d.found)).length, 2);   // the unreadable file is not "known"
  }
  // an unreadable sibling is never replaced silently: the save asks first, and Replace keeps it as .bak
  const be = memBackend(init);
  const d = await L.discover(be, VIDEO);
  const { items } = L.saveItems({ axes: { pitch: [{ at: 0, pos: 3 }] }, files: {} }, VIDEO);
  let asked = 0;
  const c = await L.writeFiles({ backend: be, items, shas: L.shasFrom(d.found), ask: async () => { asked++; return 'cancel'; } });
  assert.ok(c.cancelled && asked === 1);
  assert.equal(be.files.get('C:/v/clip.pitch.funscript'), '{not json');
  const r = await L.writeFiles({ backend: be, items, shas: L.shasFrom(d.found), ask: async () => 'replace' });
  assert.equal(r.written.length, 1);
  assert.equal(be.files.get('C:/v/clip.pitch.funscript.bak'), '{not json');
});

test('discovery: a saved clip.pawscript.funscript wins over the foreign clip.funscript it shadows (both found again)', async () => {
  const mine = { version: '1.0', actions: [{ at: 0, pos: 0 }, { at: 100, pos: 100 }] };
  const init = { [VIDEO]: 'v', [STROKE]: JSON.stringify(foreign), 'C:/v/clip.pawscript.funscript': JSON.stringify(mine), [ROLL]: JSON.stringify(rollFile) };
  for (const listDir of [false, true]) {
    const d = await L.discover(memBackend(init, { listDir }), VIDEO);
    assert.equal(d.found.stroke.path, 'C:/v/clip.pawscript.funscript');
    assert.equal(d.found.stroke.parsed.script.length, 2);
    assert.equal(d.shadowed.stroke, STROKE);
    assert.ok(d.notes.some((n) => n.startsWith('clip.funscript also exists')));
    assert.equal(d.found.roll.path, ROLL);
  }
});

test('project-only data: loops, plan, scenes, graphs, tracker runs and assist answers need a .pawproj', () => {
  const base = { loops: [], plan: [], scenes: [], graphs: [], ghosts: [{ id: 'ref', source: { kind: 'reference' } }, { id: 'device-preview', source: 'device-preview' }], project: null };
  assert.deepEqual(L.projectOnlyData(base), []);
  assert.deepEqual(L.projectOnlyData({ ...base, project: { extra: { assist: { v: 1, direction: [], splits: [] } } } }), []);
  assert.deepEqual(L.projectOnlyData({ ...base, loops: [{ t0: 0, t1: 1 }], ghosts: [{ id: 'run1', script: [], source: { kind: 'tracker' } }],
    project: { extra: { assist: { v: 1, direction: [{ t0: 0, t1: 5 }] } } } }), ['loops', 'tracker runs', 'assist answers']);
});

test('projectDoc: a registered block whose save() returns null clears the loaded value; scenes are sanitized on load', () => {
  const d = { axes: {}, chapters: [], bookmarks: [], loops: [], plan: [], ghosts: [], scenes: [], project: { extra: { timeline: { v: 2, timeMode: 'frames' }, other: 1 } } };
  assert.equal(L.projectDoc(d, { blocks: {} }).extra.timeline.timeMode, 'frames');   // old behaviour without keys
  const pd = L.projectDoc(d, { blocks: {}, blockKeys: ['timeline'] });
  assert.equal(pd.extra.timeline, undefined);
  assert.equal(pd.extra.other, 1);
  const a = L.appDocFrom({ axes: {}, chapters: [], bookmarks: [], loops: [], plan: [], ghosts: [], extra: { scenes: [{ start_ms: 0, end_ms: 0 }, { start_ms: 5000, end_ms: 2000 }, { start_ms: 'x' }, null, { start_ms: 0, end_ms: 900 }] } });
  assert.deepEqual(a.scenes, [{ start_ms: 0, end_ms: 900 }]);
  // a scene's tags (timeline acts.js) survive a .pawproj save + open; the old kind + sub override becomes tags
  assert.deepEqual(L.appDocFrom(parse(serialize({ axes: { stroke: [] }, extra: { scenes: [{ start_ms: 0, end_ms: 900, tags: ['anal', '-oral'] }] } }))).scenes[0].tags, ['anal', '-oral'], 'scene tags load as they are');
  // paw-8b4h: a modifier left as a scene tag becomes the modifier over that scene (muted: it plays as before), once, with a note
  const k = L.appDocFrom(parse(serialize({ axes: { stroke: [] }, extra: { scenes: [{ start_ms: 0, end_ms: 900, tags: ['knotting', '-anal', '-orgasm'] }, { start_ms: 900, end_ms: 2000, tags: ['orgasm'] }], modifiers: [{ id: 'm1', kind: 'orgasm', t0: 1200, t1: 1500 }] } })));
  assert.deepEqual(k.scenes.map((s) => s.tags), [['-anal'], undefined], 'the modifier tags leave the scenes ("-orgasm" only silenced the detection)');
  assert.deepEqual(k.fx.map((e) => [e.kind, e.t0, e.t1, !!e.muted]), [['knotting', 0, 900, true], ['orgasm', 1200, 1500, false]], 'a modifier of the kind already over the scene is the tie: not doubled');
  assert.match(k.project.converted, /1 scene tag .*is a modifier/);
  const plain = L.appDocFrom(parse(serialize({ axes: { stroke: [] }, extra: { scenes: [{ start_ms: 0, end_ms: 900, tags: ['anal'] }] } })));
  assert.equal(plain.project.converted, undefined, 'nothing to convert: no note');
  assert.deepEqual(L.appDocFrom(parse(serialize({ axes: { stroke: [] }, extra: { scenes: [{ start_ms: 0, end_ms: 900, kind: 'oral', sub: 'licking' }] } }))).scenes[0], { start_ms: 0, end_ms: 900, tags: ['licking'] });
  assert.equal(L.scriptsDiffer([{ at: 0, pos: 1 }], [{ at: 0, pos: 1 }]), false);
  assert.equal(L.scriptsDiffer([{ at: 0, pos: 1 }], [{ at: 0, pos: 2 }]), true);
});

test('export: preset applied, folder target, keeps unknown keys, same safety', async () => {
  const be = memBackend({ [VIDEO]: 'v', [STROKE]: JSON.stringify(foreign) });
  const { doc, shas } = await open(be);
  const preset = BUILTIN_PRESETS.find((p) => p.id === 'as-is');
  const items = L.exportItems(doc, { axes: ['stroke', 'roll'], base: VIDEO, dir: 'D:\\out', preset });
  assert.deepEqual(items.map((i) => i.path), ['D:\\out\\clip.funscript']);   // roll has no points
  const r = await L.writeFiles({ backend: be, items, shas, ask: async () => 'cancel' });
  assert.equal(r.written.length, 1);
  assert.deepEqual(JSON.parse(be.files.get('D:\\out\\clip.funscript')).custom, { keep: 'me' });
  const r2 = await L.writeFiles({ backend: be, items: L.exportItems({ ...doc, axes: { stroke: [{ at: 0, pos: 0 }] } }, { axes: ['stroke'], base: VIDEO, preset }), shas, ask: async () => 'cancel' });
  assert.deepEqual(r2.backups, [STROKE + '.bak']);
});

test('inverted files keep their flag; small helpers', async () => {
  const inv = JSON.stringify({ version: '1.0', inverted: true, actions: [{ at: 0, pos: 0 }, { at: 100, pos: 100 }] });
  const be = memBackend({ [VIDEO]: 'v', [STROKE]: inv });
  const { doc, shas } = await open(be);
  assert.deepEqual(doc.axes.stroke.map((a) => a.pos), [100, 0]);
  doc.axes = { stroke: [...doc.axes.stroke, { at: 200, pos: 100 }] };
  await save(be, doc, shas);
  const out = JSON.parse(be.files.get(STROKE));
  assert.equal(out.inverted, true); assert.deepEqual(out.actions.map((a) => a.pos), [0, 100, 0]);

  assert.deepEqual(L.classifyPaths(['a.MP4', 'b.pawproj', 'c.roll.funscript', 'd.txt']), { projects: ['b.pawproj'], videos: ['a.MP4'], funscripts: ['c.roll.funscript'], other: ['d.txt'] });
  assert.equal(L.altPathOf('C:\\v\\clip.roll.funscript'), 'C:\\v\\clip.pawscript.roll.funscript');
  assert.equal(L.altPathOf('C:/v/clip.funscript'), 'C:/v/clip.pawscript.funscript');
  assert.equal(L.altPathOf('C:/v/clip.pawscript.funscript'), null);
  assert.equal(L.joinPath('C:\\p\\sub', '..\\v\\clip.mp4'), 'C:\\p\\v\\clip.mp4');
  assert.equal(L.joinPath('C:/p', '../v/clip.mp4'), 'C:/v/clip.mp4');
  assert.deepEqual(L.mediaFrom('C:/v/a.mp4', { duration_ms: 1000.4, fps: 30, is_vfr: true, width: 10, height: 0 }), { path: 'C:/v/a.mp4', name: 'a.mp4', durationMs: 1000, fps: 30, isVfr: true, width: 10, height: null, hasAudio: null, frameCount: null, fpsRational: null });
  assert.deepEqual(L.mediaFrom('a.mp4', { duration_ms: 5000, video: { fps: 25, is_vfr: false, width: 1920, height: 1080, display_width: 1920, display_height: 1080, rotation: 90 } }),
    { path: 'a.mp4', name: 'a.mp4', durationMs: 5000, fps: 25, isVfr: false, width: 1080, height: 1920, hasAudio: null, frameCount: null, fpsRational: null });
  assert.equal(L.mediaFrom('a.mp4', null).durationMs, 0);
});

test('mediaFrom maps frame count and the exact frame rate from media_probe', () => {
  const m = L.mediaFrom('C:/v/b.mp4', { duration_ms: 10010, has_audio: false, video: { fps: 29.97, fps_rational: { num: 30000, den: 1001 }, frame_count: 300, is_vfr: false, width: 640, height: 360, rotation: 0 } });
  assert.deepEqual([m.frameCount, m.fpsRational, m.hasAudio], [300, { num: 30000, den: 1001 }, false]);
  assert.equal(L.mediaFrom('a.mp4', { video: { fps_rational: { num: 0, den: 1 } } }).fpsRational, null);
});


test('the loop frames picked (doc.repeats, paw-8yip) survive a .pawproj save + open; an odd value loads as none', () => {
  const d = { axes: { stroke: [] }, chapters: [], bookmarks: [], loops: [], plan: [], ghosts: [], scenes: [], repeats: { loops: { 3: 5 } } };
  const pd = L.projectDoc(d, { blocks: {}, blockKeys: [] });
  assert.deepEqual(pd.extra.repeats, { loops: { 3: 5 } });
  assert.deepEqual(L.appDocFrom(parse(serialize(pd))).repeats, { loops: { 3: 5 } });
  assert.equal(L.appDocFrom(parse(serialize(L.projectDoc({ ...d, repeats: null }, { blocks: {} })))).repeats, null);
  assert.equal(L.appDocFrom({ axes: {}, chapters: [], bookmarks: [], loops: [], plan: [], ghosts: [], extra: { repeats: [1] } }).repeats, null);
  assert.deepEqual(L.projectOnlyData({ ...d, scenes: [] }), ['loop frames']);
});