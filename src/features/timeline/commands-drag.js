// Esc while dragging on any timeline lane: cancel the gesture (pre-drag state back, no undo entry).
// Sorted first among the timeline's command files, so it wins Escape over lane-level Escape commands mid-drag.
import { dragActive, cancelDrag } from './interact.js';

export default [
  { id: 'timeline.drag.cancel', title: 'Cancel drag', keys: ['Escape'], hidden: true, when: dragActive, run: () => { cancelDrag(); } },
];
