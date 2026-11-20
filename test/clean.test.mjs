// Clean project (paw-zkvc): what it may remove, what it must never list, and what it says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanFiles, mayRemove, freedText, byKind, cleanTip } from '../src/app/clean.js';

const DATA = 'C:\\Users\\Ann\\AppData\\Local\\app.pawscript';
const STILL = DATA + '\\thumbs\\q1-abc-12000.jpg';

test('Clean lists the project page still (the app\'s own, under thumbs) and, only when asked, the .pawruns', () => {
  assert.deepEqual(cleanFiles({ still: STILL, dataDir: DATA, runsFile: 'W:/p/clip.pawruns' }), [{ kind: 'still', path: STILL }]);
  assert.deepEqual(cleanFiles({ still: STILL, dataDir: DATA, runsFile: 'W:/p/clip.pawruns', runs: true }).map((f) => f.kind), ['still', 'runs']);
});

test('Clean never lists the video, the project, a funscript, a backup, an autosave or a checkpoint, whatever it is handed', () => {
  const video = 'W:/p/clip.mp4', proj = 'W:/p/clip.pawproj';
  const bad = [video, proj, 'W:/p/clip.funscript', 'W:/p/clip.roll.funscript', 'W:/p/clip.pawproj.bak', DATA + '\\autosave\\x\\1.pawproj', DATA + '\\backups\\a.funscript',
    'W:/p/history/1.pawproj', 'W:/p/checkpoints/a.jpg', 'W:/p/clip.pawhistory/undo.json', 'W:/p/clip.pawhistory/k1.pawproj', 'W:/p/clip.pawhistory', DATA + '\\history\\k\\a.jpg', 'W:/p/thumbs/clip.jpg', 'W:/p/clip.pawpack'];
  for (const p of bad) {
    assert.deepEqual(cleanFiles({ still: p, dataDir: DATA, runsFile: p, runs: true, keep: [video, proj] }), [], p);
    assert.equal(mayRemove(p, { runs: true }), false, p);
  }
  // a still outside the app's own thumbs folder (a user's picture) is not ours
  assert.deepEqual(cleanFiles({ still: 'W:/p/thumbs/x.jpg', dataDir: DATA }), []);
  // the runs: only with the runs command
  assert.equal(mayRemove('W:/p/clip.pawruns'), false);
  assert.equal(mayRemove('W:/p/clip.pawruns', { runs: true }), true);
  assert.equal(mayRemove(STILL, { dataDir: DATA }), true);
});

test('paw-y2br: a user folder named Projects / History / Backups / Checkpoints / Autosave does not stop the runs command', () => {
  for (const runsFile of ['D:/Projects/clip/clip.pawruns', 'D:/History/clip.pawruns', 'E:\\Backups\\x\\clip.pawruns', 'D:/checkpoints/clip.pawruns', 'D:/Autosave/clip.pawruns', DATA + '\\projects\\Untitled-1a2b.pawruns']) {
    assert.deepEqual(cleanFiles({ dataDir: DATA, runsFile, runs: true }), [{ kind: 'runs', path: runsFile }], runsFile);
  }
  // the app's own folders stay refused
  for (const p of [DATA + '\\autosave\\p-1\\runs.pawruns', DATA + '\\backups\\k\\1-clip.pawruns', DATA + '\\history\\k\\clip.pawruns', DATA + '\\checkpoints\\clip.pawruns', 'D:/Projects/clip.pawhistory/x.pawruns']) {
    assert.deepEqual(cleanFiles({ dataDir: DATA, runsFile: p, runs: true }), [], p);
  }
});

test('what it says: per kind, biggest first, before and after', () => {
  const items = [{ kind: 'scrub', bytes: 2.6 * 2 ** 30 }, { kind: 'proxy', bytes: 540 * 2 ** 20 }, { kind: 'peaks', bytes: 120 * 1024 }, { kind: 'proxy', bytes: 0 }];
  assert.deepEqual(byKind(items).map((x) => x.kind), ['scrub', 'proxy', 'peaks']);
  assert.equal(freedText(items), 'Freed 3.1 GB: scrub cache 2.6 GB, proxy 540 MB, waveform 120 KB');
  assert.equal(freedText([]), 'Nothing to free');
  assert.match(cleanTip({ shell: true, items, runsBytes: 50 * 2 ** 20 }), /^Would free 3\.1 GB: scrub cache/);
  const runs = cleanTip({ shell: true, items, runsBytes: 50 * 2 ** 20 }, { runs: true });
  assert.match(runs, /tracker run frames 50 MB/);   // paw-lacf: what goes is the frame data, the runs stay
  assert.match(runs, /accepted script points stay/);
  assert.match(runs, /needs re-tracking/);
  assert.match(cleanTip({ shell: false }), /app restart \/ update/);
});
