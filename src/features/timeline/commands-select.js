// commands-select.js -- paw-qbvj, Blender's B (box select) and C (circle / brush select) on every timeline editor with a
// multi-selection: the points of an axis lane, the Modifiers row, the Plan row, the shots (Actions and shots row, Shots strip).
// The modes are lib/selmodal.js; each editor's own box hit does the selecting (LaneView, CanvasLane `select`). A toggles all /
// none in each editor's own command file. Not here: the Groups tool (its own keys: A assign, C copy from a frame) and the
// node graph (C connect): another editor holding the keyboard keeps its keys.
import { run } from '../../lib/selmodal.js';
import { peekGroups } from './deps.js';
import { guard } from '../../app/commands.js';

export const RADIUS_KEY = 'timeline.circleRadius';
/** Another editor holds the keyboard (the node graph: role=application that is not a timeline row). */
const otherEditor = () => { const a = globalThis.document?.activeElement?.closest?.('[role=application]'); return !!a && !a.matches?.('[data-tl-lane]'); };
const groupsOpen = (app) => app.mode === 'track' && !!peekGroups?.(app)?.on;
const can = guard((app) => app.durationMs > 0 && !otherEditor() && !groupsOpen(app),
  (app) => (!(app?.durationMs > 0) ? 'Open a video or script first' : groupsOpen(app) ? 'The Groups tool has its own keys: close it first (Tab)' : 'Click the timeline first'));
const start = (kind) => (app) => run(kind, { app, radius: app.settings.get(RADIUS_KEY, 24), setRadius: (r) => app.settings.set(RADIUS_KEY, r) });

export default [
  { id: 'timeline.select.box', title: 'Box select (drag; Shift or middle drag removes)', keys: ['B'], menu: 'Edit', group: 'select', when: can, repeat: false, run: start('box') },
  { id: 'timeline.select.circle', title: 'Circle select (drag paints; wheel or [ ] sizes the brush)', keys: ['C'], menu: 'Edit', group: 'select', when: can, repeat: false,
    aliases: ['brush select', 'paint select'], run: start('circle') },
];
