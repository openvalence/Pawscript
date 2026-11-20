// here.js -- the top section of F1's shortcut overlay (paw-idb5): the keys for what you are doing right now. The hint line
// under the Scenes timeline and the tips on the project page went away; their keys are listed here, from the same commands
// (a rebinding shows), so nothing is lost. Pure (test/palette-here.test.mjs).
//
// An entry is [ids, what]: ids = one command id or several (shown side by side, 'merge left / right'), or {keys} for a key
// that is not a command (the project page's arrows; {keys, when: id}: off unless that command is enabled). Each tab lists its own; an entry whose commands are all unknown or
// unbound is left out, and one that does not apply right now (its `when`, e.g. no selection, no tool open) is `off`.

const HOME = [
  [{ keys: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] }, 'move between the projects'],
  [{ keys: ['Enter'] }, 'open the project'],
  [{ keys: [] }, 'type a letter or digit: filter the list'],
  [['tabs.next', 'tabs.prev'], 'next / previous tab'],
  ['file.open', 'open a video, script or project'],
  ['palette.open', 'every command'],
];
// the old Scenes hint line, in its order (src/features/timeline/HintLine.svelte until paw-idb5)
const SCENES = [
  ['timeline.key.cut', 'cut here'],
  [['timeline.key.mergePrev', 'timeline.key.mergeNext'], 'merge left / right'],
  ['timeline.key.newScene', 'new scene'],
  ['timeline.shot.cutaway', 'cutaway'],
  [['timeline.select.box', 'timeline.select.circle'], 'box / circle select shots'],
  [['timeline.key.prevCut', 'timeline.key.nextCut'], 'cuts'],
  [['timeline.key.prevScene', 'timeline.key.nextScene'], 'scenes'],
  [['timeline.key.nudgeEarlier', 'timeline.key.nudgeLater'], 'move the cut a frame'],
  ['timeline.zoom.frames', 'frames'],
];
const TRACK = [
  ['track.run', 'track the range'],
  ['track.plan', 'track the tagged scenes'],
  ['track.cancel', 'cancel the tracker job'],
  ['track.flipAtPlayhead', 'flip the scene at the playhead'],
  ['tracking.bake', 'bake: make the live points permanent'],
  ['tracking.groups', 'Groups: paint the tracked parts'],
  // the Groups tool's peek (a raw listener, no command): on while the tool is open (its brush key's `when`), off otherwise
  [{ keys: ['Space'], when: 'tracking.groupsSmaller' }, 'hold Space: scrub (move the mouse sideways; in the Groups tool Space does not play)'],
  ['tracking.groupsCopyFrom', 'Groups: copy from a similar frame'],
  ['tracking.groupsCircle', 'Groups: circle to fill'],
  ['tracking.groupsGrow', 'Groups: grow a dab into the part'],
  ['tracking.groupsLabels', 'Groups: labels smart / all / none'],
  ['tracking.groupsFill', 'Groups: fill dither / hatch / gradient / flat'],
  ['tracking.groupsDepth', 'Groups: measure the part’s depth on the next Track'],
  ['tracking.groupsPulse', 'Groups: the part’s contractions as spurt cues'],
  [['timeline.key.prevSeed', 'timeline.key.nextSeed'], 'previous / next seed frame (painted or seeded, round the video)'],
  ['tracking.axisDraw', 'draw the stroke axis'],
  [['tracking.shaftOut', 'tracking.shaftHilt'], 'shaft fully out / hilted here'],
  ['assist.open', 'answer the open questions'],
];
const REFINE = [
  // paw-5zpf: the selection modes and the clicks (Alt+click loop, Ctrl+click path: gestures, no command)
  [['lanes.mode.point', 'lanes.mode.segment', 'lanes.mode.stroke', 'lanes.mode.cycle'], 'select points / segments / strokes / cycles'],
  [{ keys: ['Alt'] }, 'Alt+click: the loop (every peak, stroke or cycle of the passage); Ctrl+click: the path from the active one'],
  ['lanes.selectToggle', 'select all / none (toggle)'],
  ['lanes.selectNone', 'select none'],
  ['timeline.select.box', 'box select'],
  ['timeline.select.circle', 'circle select: paint with the brush, the wheel sizes it'],
  ['lanes.grab', 'grab the selection'],
  ['lanes.scale', 'scale time and level (X time, Y level)'],
  ['lanes.rotate', 'rotate: tilt the levels about the pivot'],
  ['lanes.pivotMenu', 'the pivot: start, middle, end, playhead, active, individual'],
  ['lanes.extrude', 'extrude: a new point out of the active one (again: chain)'],
  ['lanes.duplicateGrab', 'duplicate and grab'],
  ['lanes.deleteSelected', 'delete the selected points'],
  [['lanes.prevPoint', 'lanes.nextPoint'], 'previous / next point'],
  ['lanes.addPoint', 'a point on the line at the playhead'],
  ['lanes.repeatStroke', 'repeat the last stroke'],
  ['lanes.record', 'record live'],
  ['lanes.zoomSelection', 'zoom to the selection'],
  ['tool.repeat', 'repeat the last transform'],
];
const REVIEW = [
  [['review.prevProblem', 'review.nextProblem'], 'previous / next problem'],
  ['review.fixProblem', 'fix this problem'],
  ['review.fixAllOfKind', 'fix every problem of this kind'],
  ['review.ignoreProblem', 'ignore this problem'],
  ['review.loopProblem', 'loop around it'],
  ['review.playFromPrevious', 'play from before the previous one'],
  ['review.stepWhilePlaying', 'step through problems while playing'],
];
export const HERE = { home: HOME, scenes: SCENES, track: TRACK, refine: REFINE, review: REVIEW };
const NAMES = { home: 'Projects', scenes: 'Scenes', track: 'Track', refine: 'Refine', review: 'Review' };

/** Where F1 was pressed: 'home' (the project page is shown) or the editor's stage tab. */
export const placeOf = (app) => (app.tabs?.home ? 'home' : app.mode);

/**
 * -> {place, title, items: [{keys: [binding], what, off, ids?}]} for F1's top section and the palette's Here. reg: the command registry (keysFor, get,
 * enabled); keys are the first binding of each command (as the help list shows them).
 */
export function hereFor(app, reg = app.commands) {
  const place = placeOf(app), out = [];
  for (const [ids, what] of HERE[place] || []) {
    if (!Array.isArray(ids) && typeof ids === 'object') { out.push({ keys: ids.keys, what, off: !!ids.when && !reg.enabled(ids.when) }); continue; }   // a key that is no command
    const list = [ids].flat().filter((id) => reg.get(id) && reg.keysFor(id).length);
    if (!list.length) continue;
    out.push({ keys: list.map((id) => reg.keysFor(id)[0]), what, off: !list.some((id) => reg.enabled(id)), ids: list });   // ids: the palette's Here section (paw-m3b6)
  }
  return { place, title: 'Here: ' + (NAMES[place] || place), items: out };
}
