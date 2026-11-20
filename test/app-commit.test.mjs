// paw-up1r stage 2: Commit (Ctrl+S, its dialog lists the changes since the last commit by section, a section-scoped commit
// restores that section alone), the history (never-pruned commits, linear restore, compare ghost, notes, delete) and
// Publish (the only write of the funscripts beside the video, versioned in metadata.pawscript.publish, a 'publish' entry
// per version; an old Ctrl+S funscript adopted as v1). project.svelte.js through vite's SSR transform, history-diff.js pure.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, P, D, H, K;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  P = await server.ssrLoadModule('/src/app/project.svelte.js');
  D = await server.ssrLoadModule('/src/app/history-diff.js');
  H = await server.ssrLoadModule('/src/app/project-history.js');
  K = await server.ssrLoadModule('/src/app/pack.js');
});
after(() => server?.close());

const VIDEO = 'C:/clips/gen.mp4', PROJ = 'C:/clips/gen.pawproj', HIST = 'C:/clips/gen.pawhistory', FUN = 'C:/clips/gen.funscript';
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
// two scenes: shots [0, 2000) [2000, 4000) joined, then [4000, 8000)
const SCENES = [{ start_ms: 0, end_ms: 4000, shots: [{ start_ms: 0, end_ms: 2000 }, { start_ms: 2000, end_ms: 4000 }] }, { start_ms: 4000, end_ms: 8000, shots: [{ start_ms: 4000, end_ms: 8000 }] }];
const projectText = (o = {}) => JSON.stringify({ format: 'pawproj', version: 3, media: { path: VIDEO, name: 'gen.mp4', durationMs: 8000, fps: 30 },
  axes: { stroke: [[500, 0], [1000, 100], [2500, 0], [3000, 100], [5000, 0], [6000, 100]] }, ...o }, null, 2);
function start(be, storage = memStorage()) {
  const app = M.createMockApp({ backend: be, storage, doc: {}, keys: false });
  const toasts = [];
  app.toast = (msg, kind = 'info', opts = {}) => { toasts.push({ msg, kind, opts }); };
  let asked = 0;
  app.choose = async () => { asked++; return null; };
  app.confirm = async () => { asked++; return false; };
  app.project = P.createProject(app);
  return { app, project: app.project, toasts, asked: () => asked };
}
const add = (app, at, pos = 50) => app.edit('Add point', 'stroke', [...(app.doc.axes.stroke || []), { at, pos }].sort((a, b) => a.at - b.at));
const ats = (app) => app.doc.axes.stroke.map((p) => p.at);
const fresh = (o) => { const be = M.mockBackend(); be.files.set(VIDEO, 'v'); be.files.set(PROJ, projectText(o)); return be; };
const index = (be) => JSON.parse(be.files.get(`${HIST}/index.json`)).checkpoints;

test('commit: Ctrl+S lists the changes since the last commit by section; one shot only = a commit for that shot; nothing new = nothing to commit', async () => {
  const be = fresh({ scenes: SCENES });
  const { app, project, asked } = start(be);
  await project.openProject(PROJ);
  add(app, 2600); add(app, 2700);
  await project.askCommit();
  const dr = project.commitDraft;
  assert.equal(dr.scope.kind, 'shot');
  assert.equal(dr.scope.label, 'Shot 2');
  assert.deepEqual(dr.groups.map((g) => [D.scopeLabel(g.scope), g.lines]), [['Shot 2', ['+2 points on stroke']]]);
  const c = await project.commit({ note: 'shot two pass', diff: dr });
  assert.equal(project.commitDraft, null);
  assert.equal(c.kind, 'commit');
  assert.equal(c.note, 'shot two pass');
  assert.equal(c.scope.label, 'Shot 2');
  assert.equal(index(be).at(-1).kind, 'commit');
  assert.equal(be.files.has(`${HIST}/${c.id}.pawproj`), true);
  await project.askCommit();
  assert.equal(project.commitDraft.empty, true, 'nothing changed since that commit');
  project.cancelCommit();
  // a change in two scenes: a project commit
  add(app, 1500); add(app, 7000);
  const p = await project.pendingChanges();
  assert.equal(p.scope.kind, 'project');
  assert.deepEqual(p.groups.map((g) => D.scopeLabel(g.scope)), ['Shot 1', 'Shot 3']);
  // two shots of one scene: a commit for the scene
  const q = D.diffDocs({ axes: { stroke: [] }, scenes: project_shots() }, { axes: { stroke: [{ at: 100, pos: 1 }, { at: 2100, pos: 2 }] }, scenes: project_shots() });
  assert.equal(q.scope.kind, 'scene');
  assert.equal(q.scope.label, 'Scene 1');
  assert.equal(asked(), 0, 'no choice dialog');
});
test('paw-es11: a commit that takes over the newest automatic entry gets its own scope: none when its changes span shots (no "Project" section, no dead section restore)', async () => {
  const be = fresh({ scenes: SCENES });
  const { app, project } = start(be);
  await project.openProject(PROJ);
  add(app, 2600);
  await project.commit({ note: 'base' });
  add(app, 1500);
  await project.checkpoint('Before clean');
  add(app, 7000);
  const auto = await project.checkpoint('Before clean');
  assert.equal(auto.scope?.label, 'Shot 3', 'the automatic entry: what changed since the entry before it');
  const dr = await project.pendingChanges();
  assert.equal(dr.scope.kind, 'project', 'since the commit: shots 1 and 3');
  const c = await project.commit({ diff: dr });
  assert.equal(c.id, auto.id, 'the same document: the automatic entry became the commit');
  assert.equal(c.scope, undefined);
  assert.equal(index(be).at(-1).scope, undefined);
  // and one whose changes fall in one shot keeps that shot
  add(app, 7100);
  await project.checkpoint('Before clean');
  const s = await project.commit({ diff: await project.pendingChanges() });
  assert.equal(s.scope?.label, 'Shot 3');
});
const project_shots = () => [{ start_ms: 0, end_ms: 2000 }, { start_ms: 2000, end_ms: 4000, join: true }, { start_ms: 4000, end_ms: 8000 }];

test('commits survive pruning; automatic checkpoints are still pruned', async () => {
  const be = fresh();
  const { app, project } = start(be);
  await project.openProject(PROJ);
  add(app, 7100);
  const c = await project.commit({ note: 'keep me' });
  for (let i = 0; i < 30; i++) { add(app, 7200 + i); await project.checkpoint('Before clean'); }
  const idx = index(be);
  assert.ok(idx.some((x) => x.id === c.id && x.kind === 'commit'), 'the commit is still there');
  assert.ok(be.files.has(`${HIST}/${c.id}.pawproj`));
  assert.ok(idx.filter((x) => H.kindOf(x) === 'auto').length <= 21, `automatic ones pruned (${idx.length})`);
  // pure: a commit or publish is never dropped
  const { drop } = H.pruneCheckpoints([{ id: 'c', at: 1, auto: false, kind: 'commit' }, { id: 'p', at: 2, auto: false, kind: 'publish' }, ...Array.from({ length: 40 }, (_, i) => ({ id: 'a' + i, at: 10 + i, auto: true }))]);
  assert.ok(!drop.some((x) => x.id === 'c' || x.id === 'p'));
});

test('restore: one undo step, the present checkpointed first; editing after it continues linearly and the newer entries stay restorable', async () => {
  const be = fresh();
  const { app, project, asked } = start(be);
  await project.openProject(PROJ);
  add(app, 7100);
  const c1 = await project.commit({ note: 'one' });
  add(app, 7200);
  const c2 = await project.commit({ note: 'two' });
  assert.deepEqual(ats(app).slice(-2), [7100, 7200]);
  assert.equal(await project.restoreCheckpoint(c1.id), true);
  assert.deepEqual(ats(app).slice(-1), [7100]);
  assert.ok(project.checkpoints[0].id === c2.id || /^Before going back to “one”/.test(project.checkpoints[0].label), 'the present is kept (commit "two" already held it)');
  assert.equal(app.history.undoLabel, 'Go back to “one”');
  app.undo();
  assert.deepEqual(ats(app).slice(-2), [7100, 7200], 'Ctrl+Z takes the restore back');
  app.redo();
  add(app, 7300);   // carries on from "one"
  const c3 = await project.commit({ note: 'three' });
  const ids = index(be).map((x) => x.id);
  for (const c of [c1, c2, c3]) assert.ok(ids.includes(c.id), c.note);
  assert.ok(ids.indexOf(c2.id) < ids.indexOf(c3.id), 'linear: newest last');
  assert.equal(await project.restoreCheckpoint(c2.id), true, 'the abandoned newer entry is still restorable');
  assert.deepEqual(ats(app).slice(-2), [7100, 7200]);
  assert.equal(asked(), 0);
});

test('a section commit restores that section alone: points outside it never move; one undo step', async () => {
  const be = fresh({ scenes: SCENES });
  const { app, project } = start(be);
  await project.openProject(PROJ);
  add(app, 2600);
  const c = await project.commit({ note: 'shot 2' });
  assert.equal(c.scope.label, 'Shot 2');
  // later: shot 2 changed again, and shots 1 and 3 too
  app.edit('Edit', 'stroke', app.doc.axes.stroke.filter((p) => p.at !== 2600).concat([{ at: 2800, pos: 9 }, { at: 1200, pos: 7 }, { at: 7500, pos: 3 }]).sort((a, b) => a.at - b.at));
  const outside = app.doc.axes.stroke.filter((p) => p.at < 2000 || p.at >= 4000);
  assert.equal(await project.restoreCheckpoint(c.id, { section: true }), true);
  assert.deepEqual(app.doc.axes.stroke.filter((p) => p.at < 2000 || p.at >= 4000), outside, 'outside the shot: untouched');
  assert.deepEqual(app.doc.axes.stroke.filter((p) => p.at >= 2000 && p.at < 4000).map((p) => p.at), [2500, 2600, 3000], 'the shot as committed');
  app.undo();
  assert.deepEqual(app.doc.axes.stroke.filter((p) => p.at >= 2000 && p.at < 4000).map((p) => p.at), [2500, 2800, 3000]);
});

test('publish: the funscripts get version n + 1 and the commit of a publish entry; unpublished edits never reach them', async () => {
  const be = fresh();
  const { app, project, asked } = start(be);
  await project.openProject(PROJ);
  project.startAutosave();
  try {
    add(app, 7100);
    assert.equal(await project.publish(), true);
    const f1 = JSON.parse(be.files.get(FUN));
    assert.equal(f1.metadata.pawscript.publish.version, 1);
    const e1 = index(be).find((x) => x.id === f1.metadata.pawscript.publish.commit);
    assert.equal(e1?.kind, 'publish');
    assert.equal(e1.version, 1);
    assert.deepEqual(f1.actions.map((a) => a.at).slice(-1), [7100]);
    assert.equal(project.published.version, 1);
    assert.equal(JSON.parse(be.files.get(PROJ)).published.version, 1, 'the project records it');
    // the publish entry is the state that was published: its snapshot has the point
    assert.ok(JSON.parse(be.files.get(`${HIST}/${e1.id}.pawproj`)).axes.stroke.some(([at]) => at === 7100));
    const text = be.files.get(FUN);
    add(app, 7300);
    await new Promise((r) => setTimeout(r, 1300));   // the continuous write
    assert.ok(JSON.parse(be.files.get(PROJ)).axes.stroke.some(([at]) => at === 7300), 'the project has it');
    assert.equal(be.files.get(FUN), text, 'the funscript does not');
    assert.equal(await project.publish(), true);
    const f2 = JSON.parse(be.files.get(FUN));
    assert.equal(f2.metadata.pawscript.publish.version, 2);
    assert.ok(index(be).some((x) => x.id === f2.metadata.pawscript.publish.commit && x.version === 2));
    // nothing changed since: said, nothing written
    const t2 = be.files.get(FUN);
    assert.equal(await project.publish(), true);
    assert.equal(be.files.get(FUN), t2);
    assert.equal(project.published.version, 2);
    assert.equal(asked(), 0);
  } finally { project.stopAutosave(); }
  // reopened: the version is known, the next publish is v3
  await project.close();
  const b = start(be);
  await b.project.openProject(PROJ);
  assert.equal(b.project.published.version, 2);
  add(b.app, 7400);
  await b.project.publish();
  assert.equal(JSON.parse(be.files.get(FUN)).metadata.pawscript.publish.version, 3);
});

test('an old project whose funscript is what Pawscript last wrote adopts it as v1; one changed outside does not', async () => {
  const be = fresh();
  const a = start(be);
  await a.project.openProject(PROJ);
  add(a.app, 7100);
  assert.equal(await a.project.save(), true);   // the old Ctrl+S: project + funscript, no publish
  await a.project.close();
  const raw = JSON.parse(be.files.get(PROJ));
  delete raw.published;
  be.files.set(PROJ, JSON.stringify(raw, null, 2));
  const b = start(be);
  await b.project.openProject(PROJ);
  assert.deepEqual({ v: b.project.published?.version, adopted: b.project.published?.adopted }, { v: 1, adopted: true });
  add(b.app, 7200);
  await b.project.publish();
  assert.equal(JSON.parse(be.files.get(FUN)).metadata.pawscript.publish.version, 2);
  // changed outside: not adopted
  const be2 = fresh();
  const c = start(be2);
  await c.project.openProject(PROJ);
  add(c.app, 7100);
  await c.project.save();
  await c.project.close();
  be2.files.set(FUN, JSON.stringify({ version: '1.0', actions: [{ at: 1, pos: 2 }] }));
  const r2 = JSON.parse(be2.files.get(PROJ)); delete r2.published; be2.files.set(PROJ, JSON.stringify(r2));
  const d = start(be2);
  await d.project.openProject(PROJ);
  assert.equal(d.project.published, null);
});

test('compare: an entry\'s script as a ghost over the current one, never saved; again = off', async () => {
  const be = fresh();
  const { app, project } = start(be);
  await project.openProject(PROJ);
  const c = await project.commit({ note: 'base' });
  add(app, 7100);
  assert.equal(await project.compareCheckpoint(c.id), true);
  const g = app.doc.ghosts.find((x) => x.source?.kind === 'checkpoint');
  assert.equal(g.axis, 'stroke');
  assert.deepEqual(g.script.map((p) => p.at), [500, 1000, 2500, 3000, 5000, 6000]);
  assert.equal(project.comparing, c.id);
  await project.flush();
  assert.ok(!(JSON.parse(be.files.get(PROJ)).ghosts || []).some((x) => x.source?.kind === 'checkpoint'), 'not in the project');
  assert.equal(await project.compareCheckpoint(c.id), false);
  assert.equal(project.comparing, null);
  // note and delete
  await project.annotateCheckpoint(c.id, 'the base');
  assert.equal(index(be).find((x) => x.id === c.id).note, 'the base');
  await project.deleteCheckpoint(c.id);
  assert.ok(!index(be).some((x) => x.id === c.id));
  assert.equal(be.files.has(`${HIST}/${c.id}.pawproj`), false);
});

test('diffDocs speaks the app\'s terms: points per axis, runs, modifiers, cuts; summaries', () => {
  const shots = project_shots();
  const a = { axes: { stroke: [{ at: 100, pos: 0 }, { at: 4500, pos: 10 }] }, scenes: shots, ghosts: [], fx: [] };
  const b = { axes: { stroke: [{ at: 100, pos: 0 }, { at: 4500, pos: 20 }, { at: 4600, pos: 5 }], roll: [{ at: 5000, pos: 50 }] }, scenes: shots,
    ghosts: [{ id: 'r2', name: 'run 2', script: [{ at: 4100, pos: 1 }, { at: 7000, pos: 2 }], source: { kind: 'tracker' } }], fx: [{ id: 'f', kind: 'spurt', t0: 6000, t1: 6000 }] };
  const d = D.diffDocs(a, b);
  assert.equal(d.scope.label, 'Shot 3');
  assert.deepEqual(d.groups[0].lines, ['+1 point on stroke, 1 moved', '+1 point on roll', 'run 2 tracked', 'spurt marker added at 0:06.000']);
  const cut = D.diffDocs(a, { ...a, scenes: [...shots.slice(0, 2), { start_ms: 4000, end_ms: 6000 }, { start_ms: 6000, end_ms: 8000 }] });
  assert.equal(cut.scope.kind, 'project');
  assert.deepEqual(cut.groups[0].lines, ['Shots: 1 cut added']);
  assert.equal(D.summaryText(D.summaryOf(b)), '3 on stroke · 1 on roll · 1 run · 3 shots');
  assert.equal(D.diffDocs(a, a).empty, true);
});

test('paw-vhcd: the commit list in words: no field or channel names, a run by its number, across scenes said once; names never nest', () => {
  const shots = project_shots(), run = { id: 'r1', name: 'S1–S3 · 0:00.0–0:08.0 · #1', script: [{ at: 100, pos: 1 }, { at: 7900, pos: 2 }], source: { kind: 'tracker' } };
  const a = { axes: {}, scenes: shots, ghosts: [run], fx: [], project: { extra: {} } };
  const b = { ...a, scenes: shots.map((s, i) => (i === 2 ? { ...s, derives: { x: 1 }, tags: ['anal'] } : s)),
    runRanges: [{ id: 'g', run: 'r1', t0: 1000, t1: 7000, layer: 0 }], project: { extra: { links: { v: 1, scenes: [{ t0: 4000, t1: 8000, run: 'r1', channel: 'proj_cam' }] }, review: { ignore: [1] } } } };
  const lines = D.diffDocs(a, b).groups.flatMap((g) => g.lines);
  assert.ok(lines.includes('source, tags changed'), lines.join(' | '));
  assert.ok(lines.includes('run #1 plays here'));
  assert.ok(lines.includes('run #1 range added at 0:01.000 (shots 1–3)'), 'across scenes: by its shots, not "outside the shots" too');
  assert.ok(lines.includes('Review marks set aside changed'));
  assert.ok(!lines.some((l) => /derives|proj_cam|outside the shots|S1–S3/.test(l)), lines.join(' | '));
  assert.equal(H.bareName('Before going back to “Before going back to “As opened””'), 'As opened');
  assert.equal(H.bareName('Back to “Go back to “v2 final””'), 'v2 final');
  assert.equal(H.bareName('As opened'), 'As opened');
});

test('pack: the published scripts and version, not the unpublished work', async () => {
  const be = M.mockBackend();
  be.files.set(FUN, JSON.stringify({ actions: [{ at: 1, pos: 2 }], metadata: { pawscript: { app: 'Pawscript', publish: { version: 4 } } } }));
  const s = await K.publishedScripts(be, { stroke: { path: FUN } }, 'gen.mp4');
  assert.deepEqual(s.map((x) => [x.name, x.raw.actions.length]), [['gen.funscript', 1]]);
  const m = K.buildManifest({ names: K.packNames({ video: VIDEO }), published: { version: 4, at: Date.UTC(2026, 10, 18) } });
  assert.equal(m.published.version, 4);
});
