// deps.js -- optional links to other features, guarded: lanes work without them.
import { effectiveMaxSpeed, limitsMode, getProfile, toUnits } from '../../lib/analyze/profiles.js';
const review = import.meta.glob(['../review/markers.svelte.js', '../review/state.svelte.js'], { eager: true });
const markers = Object.values(review).find((m) => m.reviewMarkers)?.reviewMarkers;
const heat = Object.values(review).find((m) => m.heatmapSettings)?.heatmapSettings;
const trk = Object.values(import.meta.glob('../tracking/tracking.svelte.js', { eager: true }))[0];
const grp = Object.values(import.meta.glob('../tracking/groups.svelte.js', { eager: true }))[0];
/** paw-qbvj: the Groups tool is open (the Track tab): its own modal keys (A assign, C copy) win, the select keys do not apply. */
export function groupsOpen(app) {
  try { return app.mode === 'track' && !!grp?.peekGroups?.(app)?.on; } catch { return false; }
}
/** Why the tracker's run made the point at `at` (paw-izk: a turn, the midpoint, a hold ...), '' when unknown. */
export function pointWhy(app, at) {
  try { return trk?.peekTracking?.(app)?.pointWhyText?.(at) || ''; } catch { return ''; }
}

/** The review problem the user last jumped to, if it is on this axis: {t0, t1, severity} | null. */
export function problemFor(axis) {
  if (!markers?.selectedId) return null;
  const p = markers.items.find((x) => x.id === markers.selectedId);
  return p && (p.axis ?? 'stroke') === axis ? p : null;
}
/** Speed colour scale name from the review heatmap settings (default 'heat'). */
export function heatScaleOf(app) {
  try { return heat?.(app)?.scale || 'heat'; } catch { return 'heat'; }
}
/** The speed (pos units/s) at the top of the heat scale, from the review heatmap settings; null if not set. */
export function heatMaxOf(app) {
  try { return +heat?.(app)?.max || null; } catch { return null; }
}

/** The active device profile: the review feature's (app.review.profile), else the persisted choice. */
export function profileOf(app) {
  return app.review?.profile ?? app.devicePreview?.profile ?? getProfile(app.settings.get('review.profile', 'generic'), app.settings.get('review.profiles', []));
}
/** Reach limits of the active profile in pos units: {v, a, j} for a kinematic profile, {v} (slope cone) otherwise. */
export function limitsOf(app) {
  try { const p = profileOf(app); return p.kinematics ? toUnits(p) : { v: effectiveMaxSpeed(p) }; } catch { return { v: 400 }; }
}
/** {max (pos units/s), mode: 'hard'|'planner'} for over-limit readouts. */
export function speedLimit(app) {
  try { const p = profileOf(app); return { max: effectiveMaxSpeed(p), mode: limitsMode(p) }; } catch { return null; }
}

const machine = Object.values(import.meta.glob('../machine/lane-events.svelte.js', { eager: true }))[0];
/** The Machine panel's simulated knot / bend events as a marks-only ghost for the stroke lane (paw-i86), or null. */
export function machineGhost(app) {
  try { return machine?.machineEventsGhost?.(app) || null; } catch { return null; }
}

const tracking = import.meta.glob(['../tracking/api.js', '../tracking/tracking.svelte.js'], { eager: true });
/** Id of the ghost selected in the tracking feature, if it is loaded and has one. */
export function trackedGhostId(app) {
  try {
    const api = Object.values(tracking).find((m) => m.trackingApi)?.trackingApi?.(app);
    const viaApi = typeof api?.selectedId === 'function' ? api.selectedId() : api?.selectedId;
    if (viaApi) return viaApi;
    return Object.values(tracking).find((m) => m.trackingFor)?.trackingFor?.(app)?.selectedId || null;
  } catch { return null; }
}
