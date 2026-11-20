// dev/project.js -- drives app.project (src/app/project.svelte.js) on the real shell store with the in-memory backend.
// Open http://localhost:5202/dev/project.html: it runs open -> edit -> autosave -> save -> crash -> restore ->
// discard -> save as -> reopen project, and prints PASS/FAIL per check (window.results for scripts).
import { createMockApp, mockBackend } from './mock-app.js';
import { createProject } from '../src/app/project.svelte.js';
import projectCommands from '../src/app/project-commands.js';

const out = document.getElementById('out');
const results = (window.results = []);
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok, extra }); out.textContent = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.extra ? ' -- ' + r.extra : ''}`).join('\n'); };

const be = mockBackend();
const foreign = { version: '1.0', inverted: false, range: 100, custom: { keep: 1 }, metadata: { creator: 'x', chapters: [{ name: 'Intro', startTime: '00:00:00.000', endTime: '00:00:02.000' }] },
  actions: [{ at: 0, pos: 10 }, { at: 500, pos: 90 }, { at: 1000, pos: 10 }] };
be.files.set('C:/v/clip.mp4', 'video');
be.files.set('C:/v/clip.funscript', JSON.stringify(foreign));
be.files.set('C:/v/clip.roll.funscript', JSON.stringify({ actions: [{ at: 0, pos: 50 }, { at: 700, pos: 60 }] }));

function make() {
  const app = createMockApp({ doc: {}, commands: projectCommands, keys: false, backend: be });
  app.project = createProject(app);
  const asked = [];
  app.answers = [];
  app.choose = async (o) => { asked.push(o.title); return app.answers.shift() ?? null; };
  app.confirm = async () => app.answers.shift() === 'ok';
  app.asked = asked;
  return app;
}
const baks = (of) => [...be.files.keys()].filter((p) => p.startsWith(of + '.') && p.endsWith('.bak'));
const cands = async () => (await be.autosaveList()).filter((c) => c.unsaved_work);

async function run() {
  let app = make();
  check('commands registered', app.commands.get('file.save') && app.commands.keysFor('file.save').includes('Ctrl+S'));
  check('save disabled with no document', !app.commands.enabled('file.save'));

  app.answers = ['edit'];
  check('openVideo resolves true', await app.project.openVideo('C:/v/clip.mp4'));
  check('asked about the found scripts', app.asked[0]?.startsWith('Found clip.funscript (+ roll)'), app.asked[0]);
  check('stroke + roll loaded', app.doc.axes.stroke?.length === 3 && app.doc.axes.roll?.length === 2);
  check('chapters from metadata', app.doc.chapters.length === 1 && app.doc.chapters[0].name === 'Intro');
  check('hidden pinned reference ghost', app.doc.ghosts[0]?.pinned && !app.doc.ghosts[0].visible);
  check('name / base', app.project.name === 'clip.mp4' && app.project.base === 'C:/v/clip.mp4', app.project.name);
  check('recent has the video', app.project.recent[0]?.path === 'C:/v/clip.mp4' && app.project.recent[0].kind === 'video');
  check('not dirty after open', !app.doc.dirty);
  check('save enabled', app.commands.enabled('file.save'));

  app.edit('Add point', 'stroke', [...app.doc.axes.stroke, { at: 1500, pos: 70 }]);
  check('dirty after edit', app.doc.dirty);
  check('autosave written', await app.project.flushAutosave() && (await cands()).length === 1 && app.project.lastAutosave > 0);
  check('nothing written next to the video by autosave', ![...be.files.keys()].some((p) => p.startsWith('C:/v/') && /autosave/.test(p)));

  check('save resolves true', await app.project.save());
  check('stroke original kept as clip.funscript.bak, none of roll', be.files.get('C:/v/clip.funscript.bak') === JSON.stringify(foreign) && baks('C:/v/clip.roll.funscript').length === 0);
  const saved = JSON.parse(be.files.get('C:/v/clip.funscript'));
  check('saved file keeps unknown keys + chapters', saved.custom?.keep === 1 && saved.metadata.creator === 'x' && saved.metadata.chapters.length === 1 && saved.actions.length === 4);
  check('clean after save, autosave cleared', !app.doc.dirty && (await cands()).length === 0);

  app.edit('Add point', 'stroke', [...app.doc.axes.stroke, { at: 2000, pos: 30 }]);
  await app.project.save();
  check('second save: no new backup', baks('C:/v/clip.funscript').length === 1);

  // crash: dirty edit, autosave, the app dies without saving
  app.edit('Add point', 'roll', [...app.doc.axes.roll, { at: 900, pos: 5 }]);
  await app.project.flushAutosave();
  app.destroy();
  app = make();
  app.answers = ['restore'];
  check('reopen after crash resolves true', await app.project.openVideo('C:/v/clip.mp4'));
  check('asked to recover', app.asked[0] === 'Recover unsaved work?', app.asked.join(' | '));
  check('restored roll has the unsaved point', app.doc.axes.roll?.length === 3);
  check('restored doc is dirty', app.doc.dirty);
  check('reference ghost rehydrated', app.doc.ghosts.find((g) => g.id === 'ref')?.script.length > 0);
  app.undo();
  check('still dirty after undo (unsaved restore)', app.doc.dirty);

  check('restored doc re-autosaved under one candidate', (await cands()).length === 1);
  // close: discard -> autosave cleared
  app.answers = ['discard'];
  check('close resolves true', await app.project.close());
  check('autosave cleared on discard', (await cands()).length === 0);
  check('document closed', !app.project.hasDoc && app.project.name === '');

  // no recovery offered now; dismissing the found dialog cancels the open
  app.answers = [null];
  check('dismissed found-dialog cancels open', (await app.project.openVideo('C:/v/clip.mp4')) === false && !app.project.hasDoc);

  // save as project, then reopen it
  app.answers = ['edit'];
  await app.project.openVideo('C:/v/clip.mp4');
  app.edit('Add point', 'pitch', [{ at: 0, pos: 50 }, { at: 300, pos: 20 }]);
  check('saveAs resolves true', await app.project.saveAs());
  check('project written', be.files.has('C:/v/clip.pawproj') && app.project.path === 'C:/v/clip.pawproj' && app.project.name === 'clip.pawproj');
  check('pitch funscript written', be.files.has('C:/v/clip.pitch.funscript'));
  app.answers = [];
  check('openProject resolves true', await app.project.openProject('C:/v/clip.pawproj'));
  check('project axes back', app.doc.axes.pitch?.length === 2 && app.doc.axes.stroke?.length === 5);
  check('recent: project first', app.project.recent[0]?.kind === 'project');

  // a file that appears on disk is not silently replaced
  be.files.set('C:/v/clip.twist.funscript', JSON.stringify({ actions: [{ at: 0, pos: 1 }] }));
  app.edit('Add point', 'twist', [{ at: 0, pos: 99 }]);
  app.answers = ['cancel'];
  check('save with a conflict -> cancelled', (await app.project.save()) === false && app.asked.at(-1) === 'Replace files on disk?');
  check('appeared file intact', JSON.parse(be.files.get('C:/v/clip.twist.funscript')).actions[0].pos === 1);

  // import into an axis that has points: replace / ghost
  be.files.set('C:/x/other.roll.funscript', JSON.stringify({ actions: [{ at: 0, pos: 0 }, { at: 100, pos: 100 }] }));
  app.answers = ['ghost'];
  await app.project.importFile('C:/x/other.roll.funscript');
  check('import as ghost', app.doc.ghosts.some((g) => g.source?.path === 'C:/x/other.roll.funscript' && g.pinned));
  app.answers = ['axis'];
  await app.project.importFile('C:/x/other.roll.funscript');
  check('import replaces roll (undoable)', app.doc.axes.roll.length === 2 && app.history.undoLabel === 'Import other.roll.funscript');

  // export to a folder through the device-safe preset
  check('exportTo resolves true', await app.project.exportTo({ axes: ['stroke'], dir: 'D:/out', preset: 'device-safe' }));
  check('export written', be.files.has('D:/out/clip.funscript'));

  // launch-time recovery: an untitled funscript-only doc autosaved, app dies, checkRecovery restores it
  app.answers = [];
  be.files.set('C:/w/solo.funscript', JSON.stringify({ actions: [{ at: 0, pos: 0 }, { at: 100, pos: 100 }] }));
  app.answers = ['discard'];
  await app.project.close();
  await app.project.openPaths(['C:/w/solo.funscript']);
  check('funscript without video opens', app.doc.axes.stroke?.length === 2 && !app.doc.media && app.project.name === 'solo.funscript', app.project.name);
  app.edit('Add point', 'stroke', [...app.doc.axes.stroke, { at: 300, pos: 40 }]);
  await app.project.flushAutosave();
  app.destroy();
  app = make();
  app.answers = ['restore'];
  check('checkRecovery restores the newest', await app.project.checkRecovery());
  check('restored funscript doc', app.doc.axes.stroke?.length === 3 && app.doc.dirty && app.project.base === 'C:/w/solo.funscript', app.project.base);
  check('save of restored doc writes next to the funscript', await app.project.save() && JSON.parse(be.files.get('C:/w/solo.funscript')).actions.length === 3 && (await cands()).length === 0);
  const off = app.project.armCloseGuard();
  check('armCloseGuard returns a disarm function', typeof off === 'function');
  off();

  console.log('[project harness]', results.filter((r) => !r.ok).length ? 'FAILURES' : 'all passed');
  window.done = true;
}
run().catch((e) => { check('harness threw', false, e.stack || String(e)); window.done = true; });
