// plugins.js -- feature discovery. Adding a feature never edits a shared file: drop
// src/features/<name>/{panel,lane,commands,overlay}.js and the shell picks it up (ARCHITECTURE.md).
// A module that fails to load (a syntax error, a missing export, a throw at its top level), or exports something
// malformed, is skipped with a warning listed in `problems` (shown in Help > About), so one broken feature never
// takes the app down. Modules load in parallel, each on its own (top-level await: ready before the shell boots).

export const problems = [];
const feature = (path) => path.split('/').at(-2);
async function settle(globs) {
  const out = {};
  await Promise.all(Object.entries(globs).map(async ([path, load]) => {
    try { out[path] = await load(); }
    catch (e) { problems.push(`${feature(path)}/${path.split('/').pop()}: failed to load (${e?.message || e})`); console.error('[plugins]', path, e); }
  }));
  return Object.fromEntries(Object.keys(globs).filter((p) => p in out).map((p) => [p, out[p]]));   // discovery order, failures dropped
}
const globs = {
  panel: import.meta.glob('../features/*/panel.js'),
  lane: import.meta.glob('../features/*/lane.js'),
  commands: import.meta.glob('../features/*/commands.js'),
  overlay: import.meta.glob('../features/*/overlay.js'),
  modal: import.meta.glob('../features/*/modal.js'),
  status: import.meta.glob('../features/*/status.js'),
  // a feature's long-lived store made once at boot (boot.js runs each default(app)), before the shell mounts: outside every
  // component, so its effects belong to none (paw-pq6b)
  boot: import.meta.glob('../features/*/boot.js'),
  // paw-wfd2.3: conditions for the status bar's one health slot (lib/health.js): [{id, pri, read(app)}]
  health: import.meta.glob('../features/*/health.js'),
  // the real video pane, player controller and transport, once features/video ships them (else the shell's fallbacks)
  video: import.meta.glob(['../features/video/VideoPane.svelte', '../features/video/Transport.svelte', '../features/video/player.svelte.js']),
};
const [panelMods, laneMods, commandMods, overlayMods, modalMods, statusMods, bootMods, healthMods, videoMods] = await Promise.all(Object.values(globs).map(settle));

function collect(mods, check, kind) {
  const out = [];
  for (const [path, m] of Object.entries(mods)) {
    const list = [m.default].flat();
    for (const x of list) {
      const why = check(x);
      if (why) { problems.push(`${feature(path)}/${kind}: ${why}`); console.warn('[plugins]', path, why); continue; }
      out.push({ ...x, feature: feature(path) });
    }
  }
  return out.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

const needComponent = (x) => (!x ? 'no default export' : !x.id ? 'missing id' : typeof x.component !== 'function' ? 'missing component' : '');

export const panels = collect(panelMods, (x) => needComponent(x) || (!['left', 'right', 'bottom'].includes(x.dock) ? `dock "${x.dock}" is not left/right/bottom` : ''), 'panel');
export const lanes = collect(laneMods, needComponent, 'lane');
export const overlays = collect(overlayMods, needComponent, 'overlay');
export const featureCommands = Object.entries(commandMods).map(([path, m]) => {
  if (!Array.isArray(m.default)) { problems.push(`${feature(path)}/commands: default export is not an array`); return []; }
  return m.default.map((c) => ({ ...c, feature: feature(path) }));
});
export const modals = collect(modalMods, needComponent, 'modal');
export const statuses = collect(statusMods, needComponent, 'status');
export const healths = Object.entries(healthMods).flatMap(([path, m]) => [m.default].flat().filter((x) => {
  const ok = !!x?.id && typeof x.read === 'function';
  if (!ok) problems.push(`${feature(path)}/health: needs {id, read(app)}`);
  return ok;
}).map((x) => ({ pri: 50, ...x, feature: feature(path) })));
export const boots = Object.entries(bootMods).flatMap(([path, m]) => {
  if (typeof m.default === 'function') return [{ feature: feature(path), run: m.default }];
  problems.push(`${feature(path)}/boot: default export is not a function`);
  return [];
});
const vid = (name) => Object.entries(videoMods).find(([p]) => p.endsWith(name))?.[1];
// all three or none: the video feature's pane, transport and controller are made for each other
const videoComplete = vid('VideoPane.svelte')?.default && vid('Transport.svelte')?.default && vid('player.svelte.js')?.Player;
export const VideoPane = videoComplete ? vid('VideoPane.svelte').default : null;
export const VideoTransport = videoComplete ? vid('Transport.svelte').default : null;
export const VideoPlayer = videoComplete ? vid('player.svelte.js').Player : null;
export const features = [...new Set(Object.entries(globs).filter(([k]) => k !== 'video').flatMap(([, g]) => Object.keys(g)).map(feature))].sort();
