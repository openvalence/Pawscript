// editor-commands.js -- paw-5z78: the plain arrows nudge the selected editor item (ui/kit/editor-item.svelte.js: a curve
// handle, the fusion pad, a stroke-window grip, an anchor, the selected modifiers) one step, Shift a finer one; Escape drops
// it. Registered by createApp before every feature, so a selected editor item takes the arrows before the selected points and
// the frame step; with nothing selected (or setting keys.arrowsNudgeSelection off) these are off and the arrows do what they
// did. docs/guide/keys.md, "Arrows".
import { editorSelection } from '../ui/kit/editor-item.svelte.js';

const on = (app) => app.settings?.get?.('keys.arrowsNudgeSelection', true) !== false && !!editorSelection(app);
const nudge = (dx, dy, fine) => (app) => editorSelection(app)?.nudge(dx, dy, fine);
const DIRS = [['Left', -1, 0, 'left'], ['Right', 1, 0, 'right'], ['Up', 0, 1, 'up'], ['Down', 0, -1, 'down']];

export default [
  ...DIRS.flatMap(([k, dx, dy, w]) => [
    { id: `editor.nudge${k}`, title: `Nudge the selected editor item ${w}`, keys: [`Arrow${k}`], hidden: true, when: on, run: nudge(dx, dy, false) },
    { id: `editor.nudge${k}Fine`, title: `Nudge the selected editor item ${w} a little`, keys: [`Shift+Arrow${k}`], hidden: true, when: on, run: nudge(dx, dy, true) },
  ]),
  { id: 'editor.drop', title: 'Drop the editor selection (the arrows step frames again)', keys: ['Escape'], hidden: true, when: (app) => !!editorSelection(app), run: (app) => editorSelection(app)?.drop() },
];
