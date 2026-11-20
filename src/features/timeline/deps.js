// deps.js -- other areas this feature uses only when present (import.meta.glob of a missing file is just {}),
// so the timeline never breaks while they land or if a feature is removed. Browser/Vite only: pure modules
// must not import this (node tests have no import.meta.glob).
const first = (mods, name) => Object.values(mods).map((m) => m?.[name]).find((v) => v != null);

// gen: plan compiler and loop tiling.
export * as gen from '../../lib/gen/index.js';

// review: problem markers + heatmap colour settings (features/review/markers.svelte.js, state).
const reviewMods = import.meta.glob(['../review/markers.svelte.js', '../review/state.svelte.js'], { eager: true });
export const reviewMarkers = first(reviewMods, 'reviewMarkers') ?? null;
export const heatmapSettings = first(reviewMods, 'heatmapSettings') ?? ((app) => ({ scale: app.settings?.get?.('review.heatmapScale') || 'heat', max: app.settings?.get?.('review.heatmapMax') || 400 }));

// video: hover thumbnails and audio waveform (features/video/preview.js, waveform.js).
const videoMods = import.meta.glob(['../video/preview.js', '../video/waveform.js'], { eager: true });
export const createPreview = first(videoMods, 'createPreview') ?? null;
export const loadWaveform = first(videoMods, 'loadWaveform') ?? null;
export const wavePeaks = first(videoMods, 'peaks') ?? null;

// tracking: the store (app.tracking once the shell sets it; until then the feature's own accessor) for the scene
// quick bar. Optional members (sceneLink, linkScene) are called with ?. so either side can land first.
const trackingMods = import.meta.glob('../tracking/tracking.svelte.js', { eager: true });
export const trackingOf = (app) => app.tracking ?? first(trackingMods, 'trackingFor')?.(app) ?? null;
// tracking: the Groups actions for a repeated frame's tick (groups.svelte.js repeatGroupsMenu(app, t) -> menu items), paw-8yip.
const groupsMods = import.meta.glob('../tracking/groups.svelte.js', { eager: true });
export const repeatGroupsMenu = first(groupsMods, 'repeatGroupsMenu') ?? null;
// tracking: the Groups tool's best frame to paint in its take ({t, covers, repeats, loop} | null), paw-8mf4.
export const bestPaintMark = first(groupsMods, 'bestPaintMark') ?? null;
// tracking: the Groups tool's store if it exists (never creates one), paw-46du (its keys win Shift+[ / Shift+] while it is open).
export const peekGroups = first(groupsMods, 'peekGroups') ?? null;
// machine: the Machine panel's simulated knot timing for Knotting effects (machine/lane-events.svelte.js machineKnots:
// ready / verdict / text / fit), when present and published.
const machineMods = import.meta.glob('../machine/lane-events.svelte.js', { eager: true });
export const machineKnots = first(machineMods, 'machineKnots') ?? null;
// usage counters (app/usage.svelte.js noteUsage(app, kind)), when present.
const usageMods = import.meta.glob('../../app/usage.svelte.js', { eager: true });
export const noteUsage = (app, kind) => { try { first(usageMods, 'noteUsage')?.(app, kind); } catch { /* counters are best-effort */ } };
// review: the active device profile (range, speed) for Autorange (commands-range.js).
const profileMods = import.meta.glob('../review/logic/profiles.js', { eager: true });
export const activeProfile = first(profileMods, 'activeProfile') ?? null;
// tracking: accepting a ghost into an axis (Autorange gap fills).
const acceptMods = import.meta.glob('../tracking/accept.js', { eager: true });
export const acceptGhost = first(acceptMods, 'acceptGhost') ?? ((script) => ({ script, ats: [] }));
// feedback: the note store (features/feedback/feedback.svelte.js) for the note dots on the Chapters row.
const feedbackMods = import.meta.glob('../feedback/feedback.svelte.js', { eager: true });
export const feedbackOf = (app) => first(feedbackMods, 'feedbackOf')?.(app) ?? null;
