// paw-frhy / paw-90gd: Help › Copy bug report carries nothing from the user's files (no paths, no file, project or tag
// names), says so and where to send it; Ctrl+C with page text selected is the browser's copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scrub, reportText, privateNames, keepConsoleErrors, keptErrors, CONTACT, buildLine } from '../src/app/bug-report.js';
import { Registry } from '../src/app/commands.js';

const app = { doc: { media: { path: 'W:\\Videos\\My Secret Clip (2024).mp4', name: 'My Secret Clip (2024).mp4' }, project: { path: 'W:/Videos/My Secret Clip (2024).pawproj' },
  scenes: [{ describe: { tags: [{ tag: 'knotted_penis', score: 0.9 }] } }] } };

test('the report: version, machine, errors and the sidecar error with no path, file, project or tag name left', () => {
  const con = { error: () => {} };
  keepConsoleErrors(con);
  con.error('[pawscript] Unexpected error', new Error('Could not open W:\\Videos\\My Secret Clip (2024).mp4: denied'));
  con.error('[project]', 'read failed for "/home/x/other take.funscript"', { path: 'C:/Users/x/a.pawproj' });
  con.error('each_key_duplicate in scene My Secret Clip (2024) tagged knotted_penis, see https://svelte.dev/e/each_key_duplicate');
  for (let i = 0; i < 40; i++) con.error('filler', i);
  const errs = keptErrors();
  assert.equal(errs.length, 30, 'the last 30 only');
  const text = reportText({
    m: { windows: 'Microsoft Windows [Version 10.0.26300.7171]', gpus: ['NVIDIA GeForce RTX 4070, 12282 MiB VRAM, driver 581.57'], runtime: 'runtime 2026-11-17, code 2026-11-18' },
    errs: ['10:00:00 [pawscript] Unexpected error Error: Could not open W:\\Videos\\My Secret Clip (2024).mp4: denied', '10:00:01 read failed for "/home/x/other take.funscript" {"path":"C:/Users/x/a.pawproj"}',
      '10:00:02 each_key_duplicate in scene My Secret Clip (2024) tagged knotted_penis, see https://svelte.dev/e/each_key_duplicate', ...errs],
    sidecar: { at: Date.now(), cmd: 'track', message: 'cannot read C:\\clips\\My Secret Clip (2024).mp4\n  File "C:\\py\\pawtrack\\cli.py", line 3' },
    names: privateNames(app),
  });
  const body = text.split('\n').filter((l) => l !== CONTACT).join('\n');
  assert.doesNotMatch(body, /[\\/]/, 'no path separator anywhere');
  assert.doesNotMatch(text, /secret clip|knotted_penis|other take|Videos|\.mp4|\.funscript|\.pawproj|Users/i);
  assert.match(text, /contains no file names/);
  assert.ok(text.split('\n').includes(CONTACT));
  assert.match(text, new RegExp(buildLine().replace(/[()]/g, '.')));
  assert.match(text, /GPU: NVIDIA GeForce RTX 4070, 12282 MiB VRAM, driver 581\.57/);
  assert.match(text, /Tracker runtime: runtime 2026-11-17, code 2026-11-18/);
  assert.match(text, /each_key_duplicate in scene <name>/, 'the error itself stays readable');
  assert.match(text, /Last sidecar error: \d\d:\d\d:\d\d track: cannot read <path>/);
});

test('privateNames covers every open tab and the parked ones, not only the shown document', () => {
  const other = { doc: { media: { path: 'D:/x/Hidden Tab Clip.mp4' }, scenes: [{ tags: ['tag_in_hidden_tab'] }] } };
  const tabs = { apps: [app, other], parked: { doc3: { key: 'E:/y/Parked One.pawproj', name: 'Parked One.pawproj' } } };
  const names = privateNames({ ...app, tabs });
  for (const n of ['My Secret Clip (2024)', 'Hidden Tab Clip', 'tag_in_hidden_tab', 'Parked One']) assert.ok(names.includes(n), n);
});

test('scrub keeps ordinary words and apostrophes', () => {
  assert.equal(scrub("The webview can't play this file and it doesn't say why"), "The webview can't play this file and it doesn't say why");
  assert.equal(scrub("Cannot read properties of undefined (reading 'foo')"), 'Cannot read properties of undefined (reading "…")');
});

test('paw-90gd: Ctrl+C with page text selected goes to the browser; with nothing selected the command runs', () => {
  let ran = 0;
  const r = new Registry({ app: {} });
  r.register([{ id: 'x.copy', title: 'Copy points', keys: ['Ctrl+C'], run: () => { ran++; } }], 'x');
  const key = () => ({ key: 'c', code: 'KeyC', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, target: { closest: () => null }, preventDefault() {}, timeStamp: Date.now() });
  const had = globalThis.getSelection;
  try {
    globalThis.getSelection = () => ({ toString: () => 'TypeError: x is undefined' });
    assert.equal(r.handleKey(key()), false);
    assert.equal(ran, 0);
    globalThis.getSelection = () => ({ toString: () => '' });
    assert.equal(r.handleKey(key()), true);
    assert.equal(ran, 1);
  } finally { globalThis.getSelection = had; }
});
