import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse, fromRing, report, load } from '../dev/usage-report.mjs';

const FIX = new URL('./fixtures/usage-sample.jsonl', import.meta.url);

test('usage report: sessions, undo after a command, tracker funnel, effects churn, dwell, sequences', () => {
  const recs = parse(fs.readFileSync(FIX, 'utf8'));
  assert.equal(recs.length, 34);   // the torn line skipped
  const r = report(recs);
  const sec = (title) => r.split(/^== /m).find((s) => s.startsWith(title)) || '';
  assert.match(sec('Sessions'), /aa\s+2026-11-09 10:00\s+3\s+2\s+1\s+31/);   // 3 min, 2 active heartbeats, 1 idle
  assert.match(sec('Commands by count'), /track\.run\s+2\s+key 1, palette 1/);
  assert.match(sec('Undo'), /2 undos/);
  assert.match(sec('Undo'), /1 with nothing to undo/);
  assert.match(sec('Undo'), /Accept Run 1 \(replace\)\s+1/);
  assert.match(sec('Undo'), /track\.accept\s+1\s+1\s+100%/);
  // started 2, done 1, cancelled 1, re-run 1 (overlapping range), accepted 1, discarded 1, override 1, finish->accept 20.1 s
  assert.match(sec('Tracker runs'), /tapnext_points\s+2\s+1\s+1\s+0\s+1\s+1\s+1\s+1\s+29\.9 s\s+20\.1 s/);
  assert.match(sec('Effects'), /orgasm\s+1\s+1\s+1\s+100%\s+12/);
  assert.match(sec('Effects'), /spurt\s+1\s+0\s+0\s+0%\s+0/);
  assert.match(sec('Scene tags'), /\+ modifier\/knotting\s+1/);
  assert.match(sec('Top toasts'), /warn: Run # has nothing new inside the range\s+2/);
  assert.match(sec('Panels by dwell'), /track right\/tracking\s+3 min/);   // 10:00:06 -> 10:02:40 (mode switch)
  assert.match(sec('Dialogs'), /Command palette\s+1\s+3\.0 s/);
  assert.match(sec('Settings changed'), /player\.rate\s+1/);
  assert.match(sec('Playback'), /play:seek\s+1\s+40/);
  assert.match(sec('Top command sequences'), /track\.run -> track\.accept\s+1/);
});

test('usage report: a ring export reads like the log; folders read their usage-*.jsonl', () => {
  const recs = fromRing([{ t: 1, kind: 'edit.undo', detail: '{"src":"key"}' }, { t: 2, kind: 'tracking:describe', detail: '3' }, { t: 3, kind: 'x.y' }]);
  assert.deepEqual(recs.map((r) => [r.k, r.src, r.d]), [['edit.undo', 'key', undefined], ['tracking:describe', undefined, '3'], ['x.y', undefined, undefined]]);
  assert.match(report(recs), /edit\.undo\s+1\s+key 1/);
  const dir = fs.mkdtempSync(new URL('./fixtures/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') + 'usage-dir-');
  try {
    fs.copyFileSync(FIX, dir + '/usage-2026-11-09.jsonl');
    fs.writeFileSync(dir + '/other.txt', 'ignored');
    assert.equal(load([dir]).length, 34);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
