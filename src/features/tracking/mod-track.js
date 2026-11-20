// mod-track.js -- a modifier's own runs, the actions (paw-ef73.26; the pure parts: timeline/mod-runs.js). One modifier:
//   paintSeed(app, id, tracker)   the playhead to the frame to paint on (the best frame inside it, else its middle; the owner
//                                 scrubs to choose), the Groups tool open in its modifier mode with the reacting part armed
//                                 (all the painting aids: brush, circle, SAM grow, magnet); T then tracks it
//   trackMod(app, id, tracker, {replace})   an EXTRA run over just its range, both ways from its seed frame, through the
//                                 sidecar's normal job path; assigned to the modifier (its src), selected (its masks on
//                                 the video); replace = a run of it to drop once the new one is made (re-track)
//   correctHere(app, runId)       a correction of a SAM run on the frame on screen: a new seed entry of its modifier,
//                                 started from the run's tracked masks there, painted with the same tools; T re-tracks
//   setSource(app, id, src)       the after-the-fact assignment ({run, ch} | 'none' | null = the default), one undo step
import { trackingFor } from './tracking.svelte.js';
import { groupsFor } from './groups.svelte.js';
import { ARM, SAM, modTrackPlan, seedFrameFor, seedsOf, seedAt, trackerWord, maskAt, ownRuns, hasSeed } from '../timeline/mod-runs.js';
import { sourcesOf } from '../timeline/mods-tracked.js';
import { modLabel } from '../timeline/mods.js';
import { sceneAtPlayhead } from '../timeline/scenes.js';
import { scenesOf } from '../timeline/state.svelte.js';
import { partLabel, rasterPoly, encodeMask, maskSize } from './groups.js';

const modOf = (app, id) => (app.doc.fx || []).find((e) => e.id === id) ?? null;
const putMod = (app, label, id, patch) => app.transact(label, () => { app.doc.fx = (app.doc.fx || []).map((e) => (e.id === id ? patch(e) : e)); });

/** The tracker the modifier's T uses: the one it was opened for, else its last run's, else SAM. */
export function trackerFor(app, m) {
  const g = groupsFor(app);
  return (g.on && g.mod?.id === m.id && g.mod.tracker) || ownRuns(trackingFor(app).runs, m).at(-1)?.tracker || SAM;
}

/** Open the Groups tool on the modifier's seed (k: which entry; a new entry: the frame on screen). */
function openTool(app, m, k, tracker, seek) {
  const g = groupsFor(app);
  if (app.mode !== 'track') app.setMode?.('track');   // the Groups tool paints in the Track tab
  if (seek != null) app.player.seek(seek, { exact: true });
  if (g.on) g.toggle(false);
  g.mod = { id: m.id, k, tracker };
  g.toggle(true);
  if (!g.on) return false;
  const [who, part] = (ARM[m.kind] || [])[0] || [];
  if (part && !g.groups.length) { g.setWho(who); g.pickPart(part); }
  return true;
}

export function paintSeed(app, id, tracker = null) {
  const m = modOf(app, id);
  if (!m) return false;
  if (!app.doc.media) { app.toast('Open the video first: the part is painted on its frame', 'quiet'); return false; }
  const seed = seedsOf(m)[0], l = scenesOf(app);
  const t = seed ? seed.t_ms : seedFrameFor(m, l, sceneAtPlayhead(l, app.player), (x) => (app.player.snap ? app.player.snap(x) : x));
  if (t == null) { app.toast(`No shot inside this ${modLabel(m.kind).toLowerCase()} shows the act: nothing to paint on`, 'quiet'); return false; }
  const tk = tracker || trackerFor(app, m);
  if (!openTool(app, m, 0, tk, t)) return false;
  const rest = (ARM[m.kind] || []).slice(1).map(([w, p]) => `${w === 'c1' ? 'Bottom' : 'Top'} ${p}`).join(', ');
  app.toast(`${modLabel(m.kind)}: paint its ${partLabel((ARM[m.kind] || [])[0]?.join('_') || 'other')}${rest ? ` and ${rest}` : ''} on a frame inside it, then T tracks it (${trackerWord(tk)})`, 'info');
  app.usage?.note?.('mods:paintSeed', { kind: m.kind, tracker: tk });
  return true;
}

export async function trackMod(app, id, tracker = null, { replace = null } = {}) {
  const tr = trackingFor(app), m = modOf(app, id);
  if (!m) return null;
  const tk = tracker || trackerFor(app, m);
  if (!hasSeed(m)) return paintSeed(app, id, tk) && null;
  if (!tr.listed) await tr.list();
  const t = tr.trackers.find((x) => x.id === tk);
  if (!t) { app.toast(`${tk} is not installed`, 'warn'); return null; }
  const plan = modTrackPlan(m, tk);
  if (plan.why) { app.toast(plan.why, 'quiet'); return null; }
  const g = groupsFor(app);
  if (g.on && g.mod?.id === id) g.toggle(false);
  app.usage?.note?.('mods:track', { kind: m.kind, tracker: tk, seeds: plan.seeds.length, replace: !!replace });
  const res = await tr.runTrack(t, plan.range, t.id === SAM ? { model: 'small' } : {}, plan.roi, [], { tag: 'mod', check: false, scenes: 'one', groups: plan.groups, name: `${modLabel(m.kind)} · ${trackerWord(t)}`,
    mod: { mod: id, seeds: plan.seeds, modGroups: plan.groups.map((q) => q.name) } });
  if (res.cancelled) { app.toast('Modifier track canceled', 'quiet'); return null; }
  if (res.error || !res.run) { app.toast(`Modifier track failed: ${String(res.error || 'no run').split('\n')[0]}`, 'error'); return null; }
  const run = res.run;
  if (replace && replace !== run.id && tr.run(replace)) tr.remove(replace);
  const now = modOf(app, id);
  if (now) {
    const src = sourcesOf(now, [run], null)[0];
    putMod(app, `Modifier: ${modLabel(now.kind)} tracked by its own run`, id, (e) => ({ ...e, src: { run: run.id, ...(src ? { ch: src.ch } : {}) } }));
  }
  tr.select(run.id);
  app.toast(`${modLabel(m.kind)}: its own ${trackerWord(t)} run over ${((plan.range.end - plan.range.start) / 1000).toFixed(1)} s${run.channels && sourcesOf(m, [run], null).length ? '' : ' (no signal of its part came back: it stays generated)'}`, 'ok');
  return run;
}

/** A correction of SAM run runId on the frame on screen: its modifier's seed entry there (made from the run's masks on
 *  that frame when there is none yet: one undo step), the Groups tool on it; T re-tracks the run with every seed. */
export function correctHere(app, runId) {
  const tr = trackingFor(app), run = tr.run(runId), m = run && modOf(app, run.mod);
  if (!m) { app.toast('Select a modifier\'s own run first', 'quiet'); return false; }
  const t = Math.round(app.player.snap ? app.player.snap(app.player.timeMs) : app.player.timeMs);
  if (t < m.t0 || t >= m.t1) { app.toast('The playhead is outside the modifier: correct a frame inside it', 'quiet'); return false; }
  let k = seedAt(m, t, Math.max(20, (app.player.frameMs || 33) * 0.75));
  if (k < 0) {
    const size = maskSize(tr.aspect), seed = seedsOf(m)[0], fm = app.player.frameMs || 1000 / 30;
    const groups = (seed?.groups || []).map((g) => { const poly = maskAt(run, t, g.name, fm); return poly ? { ...g, poly, mask: encodeMask(rasterPoly(poly, size)), t_ms: t, source: 'user' } : null; }).filter(Boolean);
    if (!groups.length) { app.toast('The run has no mask on this frame to start from: paint the part', 'info'); }
    k = seedsOf(m).length;
    if (groups.length) putMod(app, `Modifier: correct the mask at ${(t / 1000).toFixed(2)} s`, m.id, (e) => ({ ...e, seeds: [...seedsOf(e), { t_ms: t, groups }] }));
  }
  if (!openTool(app, modOf(app, m.id), k, run.tracker, null)) return false;
  groupsFor(app).mod = { ...groupsFor(app).mod, rerun: runId };
  app.toast('Correct the mask (brush, Shift erases, E grows with SAM, Alt + wheel loosens), then T re-tracks the run from every seed', 'info');
  app.usage?.note?.('mods:correct', { kind: m.kind, k });
  return true;
}

/** The T key while a modifier's seed is being painted (the Groups tool in its modifier mode): track it (a correction:
 *  re-track that run). -> true when it acted. */
export function modTrackKey(app) {
  const g = groupsFor(app);
  if (!g.on || !g.mod) return false;
  const { id, tracker, rerun } = g.mod;
  trackMod(app, id, tracker, { replace: rerun || null });
  return true;
}

export function setSource(app, id, src) {
  const m = modOf(app, id);
  if (!m) return;
  putMod(app, src === 'none' ? `Modifier: ${modLabel(m.kind)} generated` : src ? `Modifier: ${modLabel(m.kind)} source` : `Modifier: ${modLabel(m.kind)} source back to the default`, id, (e) => {
    const { src: _s, ...rest } = e;   // eslint-disable-line no-unused-vars
    return src ? { ...rest, src } : rest;
  });
  app.usage?.note?.('mods:source', { kind: m.kind, src: src === 'none' ? 'none' : src ? (src.own ? 'own' : 'shot') : 'default' });
}
