// scenes-menu.js -- the Scenes row's right-click (paw-ef73.11, owner: "this menu is insane"). Pure: what the click hit
// and the actions in, kit MenuItems out (test/scenes-menu.test.mjs). Structure only: scenes, shots, cuts, cutaways. One
// short label per item, the explanation in its tip, its key when it has one; an item that cannot apply to what was
// clicked is left out, not greyed -- except inside the one "Modifier" submenu (paw-ef73.20, owner: "grey em out and say
// used to modify existing strokes"): every modifier kind once, the Refine-only ones greyed with that reason outside
// Refine, so the list of kinds is the same everywhere. What used to be here lives on its own home:
//   tags (view / where / what): the Scene and Shot chips, the Inspector, the Scenes panel rows (SceneQuickBar);
//   modifiers: that submenu and the Modifiers row; Stabilise: the Shot popover, Track
//   menu; Spurts from balls: the balls row; Detect cumshots: CumBar and an orgasm's menu; guide lines: View menu;
//   Group shots into scenes and merge offers: the palette, the Scene popover and the Scenes panel.
// paw-2lp7.5: scenes are gone from the timeline (action regions, on the Actions strip with their own right-click): no new
// scene / merge scenes / own scene here; 'select' = the shots under the action, 'join' = one action over the selection.

/**
 * m: {
 *   tab: 'scenes' | 'track' | 'refine' | 'review',
 *   target: 'scene' | 'shot' | 'cutaway' | 'multi' (a right-click on a block / shot) | 'cut' | 'move' | 'boundary'
 *     (a right-click on a cut, a camera move, a scene boundary),
 *   title: the section heading ('Scene 3', 'Shot 3.2', 'Shots 2.1–3.2', 'Cut'),
 *   can: {fadeIn, fadeOut (the shot has none: add one), removeIn, removeOut (it has one), select, zoom, newScene, mergeNext, mergePrev, cut, shotNext, shotPrev, describe, described, cutaway, join,
 *     mergeShots, own, oneScene, proposal, merge (a boundary's merge)} booleans,
 *   n: selected shots, scenes: scenes the selection touches, cutaway: {kind: 'cutaway' | 'offscreen' | '' (every selected shot's
 *     mark), timing (the bridge's timing option on all of them), extend (marked, no action over it: the action next to it can
 *     be drawn across)} (paw-2lp7.4), fx: MenuItem[] (the Modifier submenu: fxmenu.js modItems) | null,
 *   accept: {label, tip} (paw-x7w7: Bake, the shot plays live points) | null,
 *   keys: (commandId) => the key text | undefined,
 * }
 * act: {itemId: () => void}. -> MenuItem[] (each row carries its id and the command it mirrors as `cmd`).
 */
export function scenesRowMenu(m, act) {
  const c = m.can || {}, key = (id) => (id && m.keys?.(id)) || undefined;
  // paw-ef73.18: in the Scenes tab an item shows the single key that does the same (commands-scenes.js timeline.key.*)
  const sk = (id, other) => (m.tab === 'scenes' ? id : other);
  const it = (on, id, label, tip, cmd, x) => (on ? [{ id, label, tip, cmd, shortcut: key(cmd), run: act[id], ...x }] : []);
  const select = it(c.select, 'select', 'Select the action\'s shots', 'Every shot under the main-line action here (Alt+click or double-click a shot)', 'timeline.scene.selectScene');
  const zoom = it(c.zoom, 'zoom', m.target === 'multi' ? 'Zoom to selection' : 'Zoom to scene', 'Fit it in the timeline', m.target === 'multi' ? 'lanes.zoomSelection' : 'timeline.zoom.scene');

  const shots = [
    ...it(c.shotNext, 'shotNext', 'Merge with next shot', 'The cut after this shot goes (the action regions stay)', sk('timeline.key.mergeNext', 'timeline.shot.merge')),
    ...it(c.shotPrev, 'shotPrev', 'Merge with previous shot', 'The cut before this shot goes (the action regions stay)', sk('timeline.key.mergePrev', 'timeline.scene.delete')),
  ];
  const cut = it(c.cut, 'cut', 'Cut here', 'Split the shot at this point (the action regions stay as they are)', sk('timeline.key.cut', 'timeline.shot.split'));
  // paw-2lp7.4: the owner's two marks ("cutaway is to something not action; off screen is not on screen but continuing"), one
  // click converts between them; the bridge's one option; the action drawn across a marked shot no action covers
  const kind = m.cutaway?.kind || '', marked = !!kind;
  const marks = [
    ...it(c.cutaway, 'offscreen', 'Off-screen', `The action goes on unseen (a face, a reaction): not tracked, bridged from the shots around it${kind === 'offscreen' ? '. Again: a plain shot (tracked)' : ''}`, 'timeline.shot.offscreen', { checked: kind === 'offscreen' }),
    ...it(c.cutaway, 'cutaway', 'Cutaway', `A shot of something that is not the action: not tracked; with an action region over it the action continues (bridged like off-screen), with none it is an intermission${kind === 'cutaway' ? '. Again: a plain shot (tracked)' : ''}`, 'timeline.shot.cutaway', { checked: kind === 'cutaway' }),
    ...it(marked && !!m.cutaway?.extend, 'extend', 'Carry the action across', 'Draw the action next to it across this shot (one action region over it): the action continues here, bridged'),
    ...it(marked, 'timing', 'Timing from this shot', 'The bridge takes its turn times from the shot\'s own tracked motion (a penis flapping keeps the beat); the depth from the shots around it. Off: carried from the shots around', 'timeline.shot.bridge.timing', { checked: !!m.cutaway?.timing }),
  ];
  // a plain shot: the two marks in one row (the menu stays short; C / Shift+C and the buttons on the shot are the quick way)
  const cutaway = marked ? marks : c.cutaway ? [{ id: 'mark', label: 'Not tracked', tip: 'Off-screen (bridged) or cutaway (a break)', items: marks }] : [];
  const describe = it(c.describe, 'describe', c.described ? 'Describe again' : 'Describe', 'Tags and boxes for this shot from the tagger', 'track.describeScene');
  const proposal = it(c.proposal, 'proposal', 'Take the proposed off-screen', 'The same footage or act on both sides of a different shot: the action goes on unseen there. One action across, that shot off-screen in it, bridged (or click its dashed card)');
  // paw-ef73.22: a fade is added here (and by the commands), then adjusted by its grip: one item per edge, only where the shot has none
  const both = !c.fadeIn && !c.fadeOut && c.removeIn && c.removeOut;
  const fades = [
    ...it(c.fadeIn, 'fadeIn', 'Fade in', 'A 0.3 s fade at the start of the shot; drag its grip to adjust', 'timeline.fade.addIn'),
    ...it(c.fadeOut, 'fadeOut', 'Fade out', 'A 0.3 s fade at the end of the shot; drag its grip to adjust', 'timeline.fade.addOut'),
    ...it(c.removeIn, 'removeIn', both ? 'Remove fade in' : 'Remove fade', 'The shot fades in no more (or drag the grip back onto its edge)'),
    ...it(c.removeOut, 'removeOut', both ? 'Remove fade out' : 'Remove fade', 'The shot fades out no more (or drag the grip back onto its edge)'),
  ];
  const accept = m.accept ? [{ id: 'accept', label: m.accept.label, tip: m.accept.tip, run: act.accept }] : [];
  const fx = m.fx?.length ? [{ id: 'fx', label: 'Modifier', tip: 'A modifier over what was clicked', items: m.fx }] : [];
  let groups;
  switch (m.target) {
    case 'shot': groups = [[...select, ...zoom], [...cut, ...shots], cutaway, fades, [...proposal, ...describe, ...accept, ...fx]]; break;
    case 'cutaway': groups = [cutaway, [...cut, ...shots], fades, [...zoom, ...describe, ...accept, ...fx]]; break;
    case 'multi': groups = [[
      ...it(c.join, 'join', 'One action over them', 'An action region over the selected shots with the last-used action (or press N; 1–9: a recent one)', 'timeline.acts.new'),
      ...it(c.mergeShots, 'mergeShots', `Merge ${m.n} shots`, 'One shot: the cuts between the selected shots go (the action regions stay)', 'timeline.scene.delete'),
      ...it(c.oneScene, 'oneScene', 'One action, off-screen between', 'The first and last shots are one action across; the shots between go off-screen in it (bridged)'),
    ], cutaway, [...zoom, ...fx]]; break;
    case 'cut': case 'move': groups = [[
      ...it(true, 'take', 'Camera move', 'Same take: tracked through, no reseed. Off: a cut, the tracker reseeds', 'timeline.shot.take', { checked: m.target === 'move' }),
      ...it(c.merge, 'merge', 'Merge the two shots', 'The cut goes (or double-click its grip; or click it and press Delete)', sk('timeline.scene.delete')),
    ]]; break;
    default: groups = [];
  }
  const out = [{ section: m.title }];
  for (const g of groups.filter((g) => g.length)) out.push(...(out.length > 1 ? [{ separator: true }] : []), ...g);
  return out;
}

/** The rows of a menu that do something (not sections / separators). */
export const menuRows = (items) => items.filter((x) => !x.section && !x.separator);
