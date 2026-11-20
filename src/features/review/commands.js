// Review commands. Default keys are F-keys and chords on purpose: they stay clear of the outline's starter map
// (Space , . 0-9 Q Del L T M) and of the point-editing keys.
import { getReview } from './state.svelte.js';
import { getCompare } from './compare.svelte.js';
import { statsAsText } from './logic/charts.js';
import { statistics } from '../../lib/analyze/index.js';
import { guard } from '../../app/commands.js';

const noProblems = (app) => (app?.doc?.media || Object.keys(app?.doc?.axes ?? {}).length ? 'No problems found' : 'Open a video or script first');
const has = guard((app) => getReview(app).navList.length > 0, noProblems);
const target = (app) => { const r = getReview(app); return r.current ?? r.navList.find((p) => p.t0 >= app.player.timeMs) ?? r.navList[0] ?? null; };

export default [
  { id: 'review.open', title: 'Review: go to the Review tab', menu: 'View', run: (app) => app.setMode('review') },
  { id: 'review.nextProblem', title: 'Review: next problem', keys: ['F8'], menu: 'Review', group: 'Problems', when: has, run: (app) => getReview(app).step(1) },
  { id: 'review.prevProblem', title: 'Review: previous problem', keys: ['Shift+F8'], menu: 'Review', group: 'Problems', when: has, run: (app) => getReview(app).step(-1) },
  { id: 'review.fixProblem', title: 'Review: fix this problem', keys: ['Ctrl+F8'], menu: 'Review', group: 'Problems',
    when: guard((app) => { const p = target(app); return !!p && getReview(app).canFix(p); }, (app) => (target(app) ? 'This problem has no automatic fix' : noProblems(app))),
    run: (app) => getReview(app).fixAndAdvance(target(app)) },
  { id: 'review.fixAllOfKind', title: 'Review: fix all problems of this kind', keys: ['Ctrl+Shift+F8'], menu: 'Review', group: 'Problems',
    when: guard((app) => { const p = target(app); return !!p && getReview(app).canFix(p); }, (app) => (target(app) ? 'This problem has no automatic fix' : noProblems(app))), run: (app) => { const p = target(app); if (p) getReview(app).fixKind(p.kind); } },
  { id: 'review.ignoreProblem', title: 'Review: ignore this problem', keys: ['Alt+F8'], menu: 'Review', group: 'Problems', when: has,
    run: (app) => getReview(app).ignoreAndAdvance(target(app)) },
  { id: 'review.ignoreKind', title: 'Review: ignore this kind of problem', menu: 'Review', group: 'Problems', when: has, run: (app) => { const p = target(app); if (p) getReview(app).toggleIgnoreKind(p.kind, true); } },
  { id: 'review.recheck', title: 'Review: re-check the script now', menu: 'Review', group: 'Problems', run: (app) => getReview(app).flush() },

  { id: 'review.playFromPrevious', title: 'Review: play from before the previous problem', keys: ['F9'], menu: 'Review', group: 'Playback', when: has, run: (app) => getReview(app).playFrom(-1) },
  { id: 'review.loopProblem', title: 'Review: loop around the current problem', keys: ['Shift+F9'], menu: 'Review', group: 'Playback', when: has, run: (app) => getReview(app).toggleLoop() },
  { id: 'review.stepWhilePlaying', title: 'Review: step through problems while playing', keys: ['Ctrl+F9'], menu: 'Review', group: 'Playback', when: has, run: (app) => getReview(app).toggleStepping() },

  { id: 'review.limitSpeed', title: 'Review: limit speed to the device maximum', menu: 'Review', group: 'Device', run: (app) => getReview(app).limitSpeed() },
  { id: 'review.nextProfile', title: 'Review: next device profile', menu: 'Review', group: 'Device',
    run: (app) => { const r = getReview(app), l = r.profiles, p = l[(l.findIndex((x) => x.id === r.profile.id) + 1) % l.length]; r.setProfile(p.id); app.toast(`Device profile: ${p.name}`, 'quiet'); } },
  { id: 'review.allAxes', title: 'Review: check all axes / only the active one', menu: 'Review', group: 'Device', run: (app) => { const r = getReview(app); r.setScope(r.scope === 'all' ? 'active' : 'all'); } },

  { id: 'review.copyStats', title: 'Review: copy statistics as text', menu: 'Review', group: 'Statistics',
    run: async (app) => {
      const s = app.script, rng = app.doc.range, t0 = rng?.t0 ?? s[0]?.at ?? 0, t1 = rng?.t1 ?? s.at(-1)?.at ?? 0;
      await navigator.clipboard?.writeText(statsAsText(`${app.doc.activeAxis} ${rng ? 'range' : 'whole script'}`, statistics(s, { t0, t1 })));
      app.toast('Statistics copied', 'ok');
    } },
  { id: 'review.compareAdoptRange', title: 'Review: adopt ghost over the selected range', menu: 'Review', group: 'Compare',
    when: guard((app) => !!app.doc.range && app.doc.ghosts.length > 0, (app) => (app?.doc?.range ? 'Run the tracker or load a reference first' : 'Set a range first (I / O)')), run: (app) => getCompare(app).adopt(app.doc.range.t0, app.doc.range.t1) },
  { id: 'review.compareClear', title: 'Review: clear difference markers', menu: 'Review', group: 'Compare', run: (app) => getCompare(app).clearMarkers() },
];
