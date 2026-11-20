// Regression tests for the editor's pointer and key rules (editor/gestures.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDown, pressSelect, releaseSelect, canvasKey } from '../src/features/graph/editor/gestures.js';

/** A click (press + release, no drag) on node `id` with modifiers, as GraphEditor runs it. */
function click(sel, id, mods = {}) {
  assert.equal(classifyDown({ on: 'node', ...mods }), 'move', 'a press on a node moves / selects, never knifes');
  const was = sel.has(id);
  const pressed = pressSelect(sel, id, mods);
  return releaseSelect(pressed, id, { ...mods, was });
}

test('Shift+click and Ctrl+click add a node to the selection, and a second one takes it out', () => {
  let s = click(new Set(), 'a');
  assert.deepEqual([...s], ['a']);
  s = click(s, 'b', { shift: true });
  assert.deepEqual([...s].sort(), ['a', 'b']);
  s = click(s, 'c', { ctrl: true });
  assert.deepEqual([...s].sort(), ['a', 'b', 'c']);
  s = click(s, 'b', { ctrl: true });
  assert.deepEqual([...s].sort(), ['a', 'c']);
  s = click(s, 'a', { shift: true });
  assert.deepEqual([...s], ['c']);
  s = click(s, 'a');
  assert.deepEqual([...s], ['a'], 'a plain click selects only that node');
});

test('Ctrl+drag still knifes on the canvas and on wires', () => {
  assert.equal(classifyDown({ on: 'canvas', ctrl: true }), 'knife');
  assert.equal(classifyDown({ on: 'wire', ctrl: true }), 'knife');
  assert.equal(classifyDown({ on: 'frame', ctrl: true }), 'move');
});

test('canvasKey: keys any command claims go to the registry; the canvas never swallows them', () => {
  // arrows, End, punctuation, letters bound to app commands (player, range in/out, loop)
  for (const [chord, winner] of [['ArrowLeft', 'player.stepBack'], ['End', 'player.end'], ['PageDown', 'video.next10'], [',', 'lanes.prevPoint'], ['I', 'range.in'], ['L', 'loop.toggle'], ['M', 'graph.mute']])
    assert.equal(canvasKey({ chord, winner }), 'pass', chord);
  // unclaimed: a letter searches, anything else plain is swallowed, modified chords pass
  assert.equal(canvasKey({ chord: 'K', winner: null }), 'search');
  assert.equal(canvasKey({ chord: 'Shift+K', winner: null }), 'search');
  assert.equal(canvasKey({ chord: '7', winner: null }), 'swallow');
  assert.equal(canvasKey({ chord: 'ArrowUp', winner: null }), 'swallow');
  assert.equal(canvasKey({ chord: 'Ctrl+K', winner: null }), 'pass');
  assert.equal(canvasKey({ chord: 'F8', winner: null }), 'pass');
  assert.equal(canvasKey({ chord: 'Enter', winner: null }), 'pass', 'Enter activates the focused button');
});

test('canvasKey: Space is only noted (never prevented, never replayed by the canvas)', () => {
  assert.equal(canvasKey({ chord: 'Space', winner: 'player.toggle' }), 'space');
  assert.equal(canvasKey({ chord: 'Space', winner: 'my.rebound' }), 'space');
  assert.equal(canvasKey({ chord: 'Space', winner: null }), 'space');
});

test('canvasKey: Escape in a card field returns to the card; other field keys are the field\'s', () => {
  assert.equal(canvasKey({ chord: 'Escape', inField: true, onCardControl: true }), 'card');
  assert.equal(canvasKey({ chord: 'Escape', inField: true, onCardControl: true, prevented: true }), 'pass', 'a dirty NumberField consumed it (revert)');
  assert.equal(canvasKey({ chord: 'Escape', inField: true, onCardControl: false }), 'pass', 'palette, frame title, inspector fields');
  assert.equal(canvasKey({ chord: 'K', inField: true, onCardControl: true }), 'pass');
});
