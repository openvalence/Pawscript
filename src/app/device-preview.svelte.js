// device-preview.svelte.js -- "Machine preview": what the device does with the active axis's final script (lib/finish.js)
// (the script with its live runs / fills, lib/script-of.js; in the Track tab with a running track's trace, lib/follow.svelte.js)
// under the active device profile's kinematics: the owner's Kinetic2 planner when loaded, else the analytic tracker
// (lib/analyze planDevice). The WHOLE script is planned from its start, at the planner's 1 ms tick, because the planner
// carries history (an over-limit run keeps to the side of the rail it began on): a render started at the view's left
// edge showed the wrong half there. It runs in slices of a few ms between frames (never blocks playback or scrubbing)
// and is cached per stroke length; a new script or profile supersedes the run in flight and the last ghost stays up
// until the new plan lands. Published as a ghost {id:'device-preview', source:'device-preview'} with
//   samples {t0, dtMs, pos}  the plan at 1 ms (the lanes draw it at device-pixel resolution)
//   misses [{at, pos, got}]  script points the machine misses by > 2 units (limit hit: the planner trimmed the knot)
//   clamps [{t0, t1, edge}]  where the plan left the window and was held at the edge
//   script                   the plan as a core Script within ~1 unit (the video simulator's feed)
// planned(script, strokeMm) is the same plan for any stroke length (the Machine panel's own window).

import { untrack } from 'svelte';
import { planDevice, planMisses, planClamps, planScript, toUnits, withStroke, getProfile, loadKinetic, kineticLoaded } from '../lib/analyze/index.js';
import { followOf } from '../lib/follow.svelte.js';

const ID = 'device-preview', SLICE_MS = 6, KEEP = 3;

export class DevicePreview {
  ghost = $state.raw(null);
  engine = $state('');
  rev = $state(0);   // bumps when a plan lands: planned() readers re-run
  #app; #stop; #timer = 0; #jobs = new Map();   // strokeMm -> {script, lim, engine, it, plan}

  constructor(app) {
    this.#app = app;
    loadKinetic().then((v) => { if (v) { for (const j of this.#jobs.values()) j.it?.return(); this.#jobs.clear(); this.rev++; } }, () => null);   // planner in: re-plan with it
    this.#stop = $effect.root(() => {
      $effect(() => {
        // paw-upot: a hidden tab plans nothing (its script changing under a background track re-planned it); shown again, it plans
        if (app.tabs && app.tabs.current !== app) return;
        const on = this.on, p = this.profile, axis = app.doc.activeAxis, s = followOf(app, axis, { live: false }).script;   // the final (lib/finish.js); in the Track tab with the unapplied runs on show (lib/follow.js)
        if (!on || !p?.kinematics || !(s?.length >= 2)) { untrack(() => this.#publish(null)); return; }
        const plan = this.planned(s, p.kinematics.strokeMm, p);
        if (plan) untrack(() => this.#show(plan, s, p, axis));
      });
    });
  }
  /** The active device profile: the review feature's when it is there, else the persisted one. */
  get profile() {
    const app = this.#app;
    return app.review?.profile ?? getProfile(app.settings.get('review.profile', 'generic'), app.settings.get('review.profiles', []));
  }
  get available() { return !!this.profile?.kinematics; }
  /** On / off: the shared setting, read live (paw-upot: every tab follows a toggle in any of them). */
  get on() { return !!this.#app.settings.get('view.machinePreview', false); }
  toggle(on = !this.on) { this.#app.settings.set('view.machinePreview', !!on); }

  /**
   * The whole-script plan of `script` at a stroke length (mm) under the profile's limits (planDevice's result plus
   * misses / clamps). While it renders (scheduled; rev bumps when it lands): the same script's plan at another stroke
   * if there is one (a window being dragged does not flicker back to the raw script), else null; null without kinematics.
   */
  planned(script, strokeMm, profile = this.profile) {
    this.rev;
    if (!profile?.kinematics || !(script?.length >= 2) || !(strokeMm > 0)) return null;
    const lim = toUnits(withStroke(profile, strokeMm)), engine = kineticLoaded() ? 'kinetic' : 'scurve', j = this.#jobs.get(strokeMm);
    const near = () => { let p = null; for (const o of this.#jobs.values()) if (o.script === script && o.plan?.pos) p = o.plan; return p; };
    if (j && j.script === script && j.engine === engine && j.lim.v === lim.v && j.lim.a === lim.a && j.lim.j === lim.j) return j.plan?.pos ? j.plan : near();
    j?.it?.return();
    this.#jobs.delete(strokeMm);
    this.#jobs.set(strokeMm, { script, lim, engine, it: planDevice(script, lim, { engine }), plan: null });
    for (const [k, o] of this.#jobs) { if (this.#jobs.size <= KEEP) break; o.it?.return(); this.#jobs.delete(k); }
    if (!this.#timer) this.#timer = setTimeout(() => this.#pump(), 0);
    return near();
  }
  /** Run the pending plans for up to SLICE_MS, then yield to the page. */
  #pump() {
    this.#timer = 0;
    const end = performance.now() + SLICE_MS;
    for (const j of this.#jobs.values()) {
      while (!j.plan) {
        let r;
        try { r = j.it.next(); } catch (e) { console.warn('[device-preview]', e); j.plan = { failed: true }; break; }
        if (r.done) {
          const p = r.value;
          j.plan = { ...p, misses: planMisses(j.script, p), clamps: planClamps(p) };
          j.it = null;
          this.rev++;
        } else if (performance.now() > end) { this.#timer = setTimeout(() => this.#pump(), 0); return; }
      }
    }
  }
  #show(plan, script, profile, axis) {
    if (this.ghost?.samples === plan) return;
    this.engine = plan.engine;
    this.#publish({ id: ID, name: `Machine preview (${profile.name || profile.id}, ${plan.engine})`, color: '#FFC21F', visible: true, source: ID, axis,
      samples: plan, misses: plan.misses, clamps: plan.clamps, script: planScript(plan, 0.5, { ints: true, from: 0 }),
      range: { t0: plan.t0, t1: plan.t0 + (plan.pos.length - 1) * plan.dtMs } });
  }
  #publish(g) {
    const app = this.#app, rest = app.doc.ghosts.filter((x) => x.id !== ID);
    this.ghost = g;
    if (!g && rest.length === app.doc.ghosts.length) return;
    app.doc.ghosts = g ? [...rest, g] : rest;
  }
  destroy() { this.#stop?.(); clearTimeout(this.#timer); for (const j of this.#jobs.values()) j.it?.return(); }
}
