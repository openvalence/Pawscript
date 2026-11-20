// Feedback notes (src/features/feedback/feedback.js, paw-dze): the tone prefix, reading feedback.jsonl back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNote, parseNotes, compactEvent } from '../src/features/feedback/feedback.js';

test('feedback: a leading ! / ? / + is the tone, nothing else is', () => {
  assert.deepEqual(parseNote('! source jumps at the cut'), { tone: 'bug', text: 'source jumps at the cut' });
  assert.deepEqual(parseNote('?why two runs'), { tone: 'confusing', text: 'why two runs' });
  assert.deepEqual(parseNote(' + nice fit '), { tone: 'like', text: 'nice fit' });
  assert.deepEqual(parseNote('plain, with ! inside'), { tone: 'note', text: 'plain, with ! inside' });
  assert.deepEqual(parseNote('   '), { tone: 'note', text: '' });
});

test('feedback: feedback.jsonl read back with deletions applied, torn lines skipped; compact context events', () => {
  const text = [{ k: 'note', id: 'a', text: '1' }, { k: 'note', id: 'b', text: '2' }, { k: 'delete', id: 'a' }].map((r) => JSON.stringify(r)).join('\n') + '\n{"k":"note","id":"c",';
  assert.deepEqual(parseNotes(text).map((n) => n.id), ['b']);
  assert.deepEqual(parseNotes(''), []);
  assert.deepEqual(compactEvent({ t: Date.parse('2026-11-11T10:00:01.5Z'), s: 'x', k: 'edit:undo', label: 'Merge shots' }), { t: '10:00:01.500', k: 'edit:undo', d: '{"label":"Merge shots"}' });
});
