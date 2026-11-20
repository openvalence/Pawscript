// The top bar's tabs, stage 1 (paw-shgb): the home tab (project page) and the one open document. View state only:
// switching pauses the player and never loads or closes anything; close lands on home; opening the open document again
// only switches to it; while home hides the document only the home commands run (Space never plays the hidden video).
// The real createApp, so the wiring (app.load -> tabs, the command scope) is what is tested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileModule } from 'svelte/compiler';

registerHooks({
  load(url, ctx, next) {
    if (!url.startsWith('file:') || url.includes('node_modules')) return next(url, ctx);
    if (url.endsWith('.svelte.js')) return { format: 'module', shortCircuit: true, source: compileModule(readFileSync(fileURLToPath(url), 'utf8'), { filename: fileURLToPath(url), generate: 'server' }).js.code };
    if (url.endsWith('.svelte')) return { format: 'module', shortCircuit: true, source: 'export default function Stub() {}' };
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' };
    return next(url, ctx);
  },
});

const src = new URL('../src/', import.meta.url);
const { createApp } = await import(new URL('app/app.svelte.js', src));
const { homeAllows, HOME } = await import(new URL('app/tabs.svelte.js', src));
const { default: CORE } = await import(new URL('app/core-commands.js', src));
const { default: projectCommands } = await import(new URL('app/project-commands.js', src));

/** A booted-enough app: core + File commands, a fake project layer that counts opens / closes. */
function make() {
  const app = createApp({ storage: null, commands: [] });
  app.commands.register(projectCommands, 'project');
  app.commands.register(CORE, 'app');
  const calls = [];
  app.project = {
    busy: '', get hasDoc() { return !!app.doc.media || Object.values(app.doc.axes).some((s) => s.length); },
    get path() { return app.doc.project?.path ?? null; }, get name() { return 'clip.mp4'; },
    async openPaths(paths) { calls.push(['open', paths]); app.load({ media: { path: paths[0], name: 'b.mp4', durationMs: 10000 }, axes: { stroke: [] } }); return true; },
    async close() { calls.push(['close']); app.load({}); return true; },
  };
  return { app, calls };
}
const openClip = (app) => { app.load({ media: { path: 'C:\\v\\clip.mp4', name: 'clip.mp4', durationMs: 10000 }, axes: { stroke: [] } }); app.player.setDuration?.(10000); };
const key = (code, k, mods = {}) => ({ code, key: k, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: false, metaKey: false, target: null, timeStamp: Date.now(), preventDefault() { this.prevented = true; } });

test('no document: only the home tab, shown; a load shows the document', () => {
  const { app } = make();
  assert.deepEqual(app.tabs.list, []);
  assert.equal(app.tabs.active, HOME);
  assert.ok(app.tabs.home && !app.tabs.hidden);
  assert.equal(app.tabs.show('doc'), false, 'nothing to show');
  openClip(app);
  assert.equal(app.tabs.list.length, 1);
  assert.equal(app.tabs.list[0].app, app, 'stage 2 shape: an entry carries its app');
  assert.equal(app.tabs.active, 'doc');
});

test('home <-> document is view state only: the document, its undo history and the playhead stay; home pauses', () => {
  const { app } = make();
  openClip(app);
  app.edit('Add point', 'stroke', [{ at: 500, pos: 50 }]);
  app.edit('Add point', 'stroke', [{ at: 500, pos: 50 }, { at: 900, pos: 10 }]);
  app.setView({ start: 1000, span: 3000 });
  app.setMode('track');
  app.player.seek(2500);
  app.player.play?.();
  const before = { axes: app.doc.axes, view: app.view, mode: app.mode, t: app.player.timeMs, undo: app.history.entries.length };
  assert.ok(app.tabs.show(HOME));
  assert.ok(app.tabs.hidden);
  assert.equal(app.player.playing, false, 'the player paused');
  assert.ok(app.tabs.show('doc'));
  assert.deepEqual({ axes: app.doc.axes, view: app.view, mode: app.mode, t: app.player.timeMs, undo: app.history.entries.length }, before);
  app.undo();
  assert.deepEqual(app.doc.axes.stroke, [{ at: 500, pos: 50 }], 'undo still undoes the last point');
});

test('hidden editor is quiet: only the home commands run; Space does not play, arrows do not seek, Ctrl+Z does not undo', () => {
  const { app } = make();
  openClip(app);
  app.edit('Add point', 'stroke', [{ at: 500, pos: 50 }]);
  app.player.seek(2000);
  app.tabs.show(HOME);
  const t = app.player.timeMs;
  for (const id of ['player.toggle', 'player.stepFwd', 'edit.undo', 'edit.point5', 'mode.refine', 'view.zoomIn']) assert.equal(app.commands.enabled(id), false, id + ' off on home');
  assert.equal(app.commands.handleKey(key('Space', ' ')), false);
  app.commands.handleKeyUp(key('Space', ' '));
  assert.equal(app.commands.handleKey(key('ArrowRight', 'ArrowRight')), false);
  assert.equal(app.commands.handleKey(key('KeyZ', 'z', { ctrl: true })), false);
  assert.equal(app.player.playing, false);
  assert.equal(app.player.timeMs, t, 'the playhead did not move');
  assert.equal(app.doc.axes.stroke.length, 1, 'nothing undone');
  for (const id of ['file.save', 'file.open', 'file.close', 'help.about', 'tabs.next', 'tabs.doc']) assert.equal(app.commands.enabled(id), true, id + ' on on home');
  app.tabs.show('doc');
  assert.equal(app.commands.enabled('player.toggle'), true, 'back on the document: its keys again');
});

test('the home rule: tabs, File, palette / help, the look', () => {
  for (const id of ['tabs.home', 'tabs.prev', 'file.open', 'file.import', 'file.save', 'file.close', 'palette.open', 'palette.close', 'palette.help', 'palette.keys', 'help.about', 'view.theme.dark', 'view.density.compact']) assert.ok(homeAllows(id), id);
  for (const id of ['player.toggle', 'edit.undo', 'lanes.grab', 'mode.track', 'view.zoomIn', 'tracking.track', 'layout.toggleLeft', 'layout.toggleBottom']) assert.ok(!homeAllows(id), id);
});

test("Ctrl+W on home does nothing to the hidden document; the tab's x (the command, not the key) still closes it (paw-idb5)", async () => {
  const { app, calls } = make();
  openClip(app);
  app.tabs.show(HOME);
  const e = key('KeyW', 'w', { ctrl: true });
  assert.equal(app.commands.handleKey(e), true, 'the key is taken (the window never closes) ...');
  await Promise.resolve();
  assert.deepEqual(calls, [], '... and nothing closes');
  assert.equal(app.tabs.list.length, 1, 'the document is still open');
  app.tabs.show('doc');
  assert.equal(app.commands.handleKey(key('KeyW', 'w', { ctrl: true })), true);
  await Promise.resolve();
  assert.deepEqual(calls.at(-1), ['close'], 'on the document Ctrl+W closes as before');
  openClip(app);
  app.tabs.show(HOME);
  app.commands.run('file.close');   // the tab's x, File > Close
  await Promise.resolve();
  assert.equal(calls.filter((c) => c[0] === 'close').length, 2, 'the x closes from home');
});

test('Ctrl+Tab / Ctrl+Shift+Tab switch home <-> document, both ways', () => {
  const { app } = make();
  assert.equal(app.commands.enabled('tabs.next'), false, 'one tab: nothing to switch to');
  openClip(app);
  assert.ok(app.commands.handleKey(key('Tab', 'Tab', { ctrl: true })));
  assert.equal(app.tabs.active, HOME);
  assert.ok(app.commands.handleKey(key('Tab', 'Tab', { ctrl: true })));
  assert.equal(app.tabs.active, 'doc');
  assert.ok(app.commands.handleKey(key('Tab', 'Tab', { ctrl: true, shift: true })));
  assert.equal(app.tabs.active, HOME);
  assert.ok(app.commands.handleKey(key('Tab', 'Tab', { ctrl: true, shift: true })));
  assert.equal(app.tabs.active, 'doc');
  assert.equal(app.commands.get('tabs.doc').title, 'Back to clip.mp4');
  assert.equal(app.commands.list().find((c) => c.id === 'tabs.doc').title, 'Back to clip.mp4', 'the palette sees the live title');
  assert.deepEqual(app.commands.conflicts().filter((c) => /Tab/.test(c.keys)), []);
});

test('close lands on home; opening the open document only switches; another one replaces it and shows', async () => {
  const { app, calls } = make();
  openClip(app);
  app.tabs.show(HOME);
  assert.ok(app.tabs.isOpen('c:/v/CLIP.mp4'), 'path match ignores case and slashes');
  assert.ok(await app.tabs.open(['C:\\v\\clip.mp4']));
  assert.equal(app.tabs.active, 'doc');
  assert.deepEqual(calls, [], 'no reload, no question');
  app.tabs.show(HOME);
  assert.ok(await app.tabs.open(['C:\\v\\b.mp4']));
  assert.deepEqual(calls, [['open', ['C:\\v\\b.mp4']]]);
  assert.equal(app.tabs.active, 'doc', 'the opened document shows');
  app.commands.run('file.close');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls.at(-1), ['close']);
  assert.deepEqual(app.tabs.list, []);
  assert.equal(app.tabs.active, HOME, 'closed: home');
});

test('opening from the home tab by any path (a dialog, a restore) shows the new document: app.load decides', () => {
  const { app } = make();
  openClip(app);
  app.tabs.show(HOME);
  app.load({ media: { path: 'C:\\v\\other.mp4', name: 'other.mp4', durationMs: 5000 }, axes: {} });
  assert.equal(app.tabs.active, 'doc');
});
