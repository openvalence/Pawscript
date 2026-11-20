// commands-acts.js -- paw-2lp7.5: the action regions' commands (owner: "shots, which are marked as cuts, actions which are what
// is happening at any moment, not bound to cuts"). One undo step each, structure on frame starts. The plain keys work in the
// Scenes tab (no point lanes there: the digits are free, paw-ef73.6) or while the Scenes row has the keyboard; with a region
// selected they act on it, and this file registers before commands-scenes.js, so S / K / M / [ / ] / Delete reach the region
// first and the shot / cut keys otherwise:
//   N              a region over the selected shots (else the shot at the playhead) with the last-used action
//   1 ... 9        the recent actions: on the selected region, else a region with it over the selected shots
//   S / K          split the selected region at the playhead       M / Shift+M   merge it with the same action right / left
//   [ / ]          its start / end to the playhead                  Delete        remove it (a proposal: dismiss)
//   Enter          a proposal: accept; else its tag chips in place E             extend the action to the end of this shot /
//                                                                                 through the next cut
import { tl, scenesOf, targetShots, selectedShots } from './state.svelte.js';
import { selHull, selText } from './shots.js';
import { actsAt, addRegion, splitRegionAt, mergeRegion, mergeAllSame, proposeFromShots, regionWords } from './regions.js';
import { regionOverShots, edgeTo, extendRegion } from './actions-strip.js';
import { selectedAct, targetAct, mruOf, noteMru, commitActs, selectAct, setTags, removeAct, acceptAct, acceptAllActs, actLabel, shotsUnder } from './acts-edit.js';
import { applySel, scenesTab, KEYS_WHY } from './commands-scenes.js';
import { playheadFrameStart } from '../../lib/lane.js';
import { guard, whyOf } from '../../app/commands.js';

const has = guard((app) => scenesOf(app).length > 0, 'Detect scenes first');
const now = (app) => playheadFrameStart(app.player);
const focused = (app) => tl.focus === 'scenes' && has(app);
/** The plain keys' scope: the Scenes tab, or the Scenes row holding the keyboard. */
const keysOn = guard((app) => scenesTab(app) || focused(app), (app) => whyOf(app, has) || KEYS_WHY);
/** ... with a region selected. */
const onSel = guard((app) => keysOn(app) && !!selectedAct(app), (app) => whyOf(app, keysOn) || 'Select an action region first');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export const acts = {
  /** A region with `tags` over the selected shots (else the shot at the playhead): one per unbroken run. */
  overShots(app, tags, label = 'Action region') {
    const l = scenesOf(app), sh = targetShots(app), r = regionOverShots(app.doc.acts || [], l, sh, tags);
    if (!commitActs(app, label, r, 'No shot selected')) return;
    noteMru(app, tags);
    app.toast?.(`${selText(l, sh) || 'Shot'}: ${tags?.length ? regionWords({ kind: 'act', tags }) : 'an untagged action (tag it: double-click or Enter)'}`, 'quiet');
    app.usage?.note?.('acts:overShots', { shots: sh.length, tags: tags?.length || 0 });
  },
  /** Digit n: recent action n on the selected region, else over the selected shots. */
  mru(app, n) {
    const tags = mruOf(app)[n - 1];
    if (!tags) return app.toast?.(n === 1 ? 'No recent action yet: tag a region first (double-click it)' : `No recent action ${n} yet`, 'quiet');
    const r = selectedAct(app);
    if (r?.kind === 'act') { if (setTags(app, r.id, tags, `Action: ${regionWords({ kind: 'act', tags })}`)) app.usage?.note?.('acts:mru', { n, on: 'region' }); return; }
    acts.overShots(app, tags, `Action: ${regionWords({ kind: 'act', tags })}`);
    app.usage?.note?.('acts:mru', { n, on: 'shots' });
  },
  split(app, r = targetAct(app)) {
    const t = now(app);
    if (!r) return app.toast?.('No action region here', 'quiet');
    commitActs(app, 'Split action region', splitRegionAt(app.doc.acts, r.id, t), 'The playhead is not inside the action region');
  },
  merge(app, dir = 1, r = targetAct(app)) {
    if (!r) return app.toast?.('No action region here', 'quiet');
    commitActs(app, 'Merge action regions', mergeRegion(app.doc.acts, r.id, dir), `No ${dir > 0 ? 'next' : dir < 0 ? 'previous' : 'neighboring'} region with the same action on its line`);
  },
  edge(app, side) {
    const r = selectedAct(app);
    if (r) commitActs(app, side === 't0' ? 'Action starts here' : 'Action ends here', edgeTo(app.doc.acts, r.id, side, now(app)), side === 't0' ? 'Its start cannot pass its end' : 'Its end cannot pass its start');
  },
  extend(app) {
    const r = targetAct(app);
    if (!r) return app.toast?.('No action region here', 'quiet');
    if (commitActs(app, 'Extend action', extendRegion(app.doc.acts, scenesOf(app), r, app.player.timeMs), 'Nothing after it to extend over')) {
      const n = (app.doc.acts || []).find((x) => x.id === r.id);
      if (n) app.toast?.(`${actLabel(n)}`, 'quiet');
    }
  },
  /** Enter: accept a proposal, else open its chips. */
  enter(app) {
    const r = selectedAct(app);
    if (!r) return;
    if (r.auto) acceptAct(app, r.id); else tl.actPop = r.id;
  },
  propose(app) {
    const r = proposeFromShots(scenesOf(app), app.doc.acts || []);
    if (!r) return app.toast?.('Nothing to propose: no gap with described shots (Describe all first, or delete regions to see proposals there)', 'quiet');
    const n = r.filter((x) => x.auto).length;
    commitActs(app, 'Propose action regions', r);
    app.toast?.(`${plural(n, 'proposed action')} (dashed): click one or Enter to accept, Delete to dismiss, or "Accept ${n}" in the Actions panel`, 'info');
    app.usage?.note?.('acts:propose', { n });
  },
  /** Jump to the next / previous main-line action edge. */
  jump(app, dir) {
    const t = app.player.timeMs, e = [...new Set((app.doc.acts || []).filter((r) => r.layer === 0 && r.kind !== 'positioning').flatMap((r) => [r.t0, r.t1]))].sort((a, b) => a - b);
    const c = dir > 0 ? e.find((x) => x > t + 1) : [...e].reverse().find((x) => x < t - 1);
    if (c == null) return app.toast?.(dir > 0 ? 'No later action edge' : 'No earlier action edge', 'quiet');
    app.player.seek(c);
  },
  /** The region over the range (else the selection's hull) carrying the action of the region at its start. */
  overRange(app) {
    const l = scenesOf(app), rg = app.doc.range, h = rg ? [rg.t0, rg.t1] : selHull(l, selectedShots(l));
    if (!h) return app.toast?.('Set a range or select shots first', 'quiet');
    const b = actsAt(app.doc.acts, h[0]).find((r) => r.layer === 0 && r.kind !== 'positioning');
    commitActs(app, 'Action region over the range', addRegion(app.doc.acts || [], { kind: b?.kind ?? 'act', t0: h[0], t1: h[1], layer: 0, tags: b?.tags ?? [] }));
  },
  selectHere(app) { const r = targetAct(app); if (r) selectAct(app, r); else app.toast?.('No action region here', 'quiet'); },
  selectShots(app) {
    const r = targetAct(app);
    if (!r) return app.toast?.('No action region here', 'quiet');
    const sh = shotsUnder(app, r);
    tl.act = null;
    if (sh.length) applySel(app, { active: sh[0], shots: sh }, 'region', { seek: false });
  },
};

const digit = (n) => ({ id: `timeline.acts.mru${n}`, title: `Recent action ${n} on the selected region or shots`, keys: [String(n)], group: 'scenes', hidden: true,
  when: keysOn, run: (app) => acts.mru(app, n) });

export default [
  // with a region selected (before the shot / cut keys of commands-scenes.js)
  { id: 'timeline.acts.split', title: 'Split the selected action region at the playhead', keys: ['S', 'K'], group: 'scenes', when: onSel, run: (app) => acts.split(app) },
  { id: 'timeline.acts.mergeKey', title: 'Merge with the next region of the same action', keys: ['M'], group: 'scenes', hidden: true, when: onSel, run: (app) => acts.merge(app, 0) },
  { id: 'timeline.acts.mergeKeyPrev', title: 'Merge with the previous region of the same action', keys: ['Shift+M'], group: 'scenes', hidden: true, when: onSel, run: (app) => acts.merge(app, -1) },
  { id: 'timeline.acts.startHere', title: 'The selected action region starts at the playhead', keys: ['['], group: 'scenes', when: onSel, run: (app) => acts.edge(app, 't0') },
  { id: 'timeline.acts.endHere', title: 'The selected action region ends at the playhead', keys: [']'], group: 'scenes', when: onSel, run: (app) => acts.edge(app, 't1') },
  { id: 'timeline.acts.delete', title: 'Delete the selected action region (a proposal: dismiss it)', keys: ['Delete', 'Backspace', 'X'], group: 'scenes', when: onSel, run: (app) => removeAct(app, tl.act) },
  { id: 'timeline.acts.enter', title: 'Accept the action region, else show its tag chips', keys: ['Enter'], group: 'scenes', when: onSel, run: (app) => acts.enter(app) },
  // the keyboard path (owner: "the 1 2 assign method is baller and super rapid")
  { id: 'timeline.acts.new', title: 'Action region over the selected shots, last-used action', keys: ['N'], group: 'scenes', when: keysOn, run: (app) => acts.overShots(app, mruOf(app)[0] ?? []) },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(digit),
  { id: 'timeline.acts.extend', title: 'Extend the action to the shot end (again: past the next cut)', keys: ['E'], group: 'scenes', when: guard((app) => keysOn(app) && !!targetAct(app), (app) => whyOf(app, keysOn) || 'Put the playhead on an action region'), run: (app) => acts.extend(app) },
  // the scene commands, re-pointed at the action regions (paw-2lp7.5: scenes are gone from the timeline)
  { id: 'timeline.scene.select', title: 'Select the action region at the playhead', keys: ['Alt+Shift+S'], menu: 'Edit', group: 'scenes', when: has, run: (app) => acts.selectHere(app) },
  { id: 'timeline.scene.split', title: 'Split the action region at the playhead', keys: ['Alt+Shift+K'], menu: 'Edit', group: 'scenes', when: has, run: (app) => acts.split(app) },
  { id: 'timeline.scene.merge', title: 'Merge the action region with the next of the same action', keys: ['Alt+Shift+M'], menu: 'Edit', group: 'scenes', when: has, run: (app) => acts.merge(app, 1) },
  { id: 'timeline.scene.mergePrev', title: 'Merge the action region with the previous of the same action', group: 'scenes', when: has, run: (app) => acts.merge(app, -1) },
  { id: 'timeline.scene.mergeRange', title: 'One action region over the range (else the selected shots)', keys: ['Alt+Shift+J'], menu: 'Edit', group: 'scenes', when: has, run: (app) => acts.overRange(app) },
  { id: 'timeline.scene.group', title: 'Merge neighboring action regions with the same action', group: 'scenes', when: guard((app) => !!(app.doc.acts || []).length, 'Add an action region first'),
    run: (app) => { const r = mergeAllSame(app.doc.acts); if (commitActs(app, 'Merge the same actions', r, 'No neighboring regions with the same action')) app.toast?.(`${(app.doc.acts || []).length} action regions`, 'quiet'); } },
  { id: 'timeline.scene.selectScene', title: 'Select the shots under the action region', group: 'scenes', when: has, run: (app) => acts.selectShots(app) },
  { id: 'timeline.key.prevScene', title: 'Scenes tab: previous action edge', keys: ['Shift+['], group: 'scenes', when: scenesTab, run: (app) => acts.jump(app, -1) },
  { id: 'timeline.key.nextScene', title: 'Scenes tab: next action edge', keys: ['Shift+]'], group: 'scenes', when: scenesTab, run: (app) => acts.jump(app, 1) },
  // proposals (the stage-3 detector will make them; this simple rule until then)
  { id: 'timeline.acts.propose', title: 'Propose action regions from the shot descriptions', group: 'scenes', when: has, run: (app) => acts.propose(app) },
  { id: 'timeline.acts.acceptAll', title: 'Accept every proposed action region', group: 'scenes', when: guard((app) => (app.doc.acts || []).some((r) => r.auto), 'Propose action regions first'), run: (app) => acceptAllActs(app) },
];
