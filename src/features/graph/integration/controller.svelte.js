// controller.svelte.js -- graphController(app): the runes wrapper around GraphCore (core.js). One per app.
// Reactivity: every core getter reads a $state counter (`track`), every core change bumps it (`bump`); an
// $effect reads the document values a graph can depend on and calls core.syncDoc() when any of them changes.
// Sibling code is found with import.meta.glob, so a feature that has not landed (or was removed) degrades
// instead of breaking the app (same pattern as features/timeline/deps.js).

import { untrack } from 'svelte';
import { GraphCore } from './core.js';
import { pyramidToEnvelope, readDeps } from './snapshot.js';
import { seriesColor } from '../../../ui/kit/tokens.js';

const libMods = import.meta.glob(['../../../lib/graph/model.js', '../../../lib/graph/eval.js', '../../../lib/graph/serialize.js',
  '../../../lib/graph/types.js', '../../../lib/graph/nodes/index.js', '../../../lib/graph/presets.js', '../../../lib/gen/plan.js'], { eager: true });
const trackMods = import.meta.glob(['../../tracking/tracking.svelte.js'], { eager: true });
const videoMods = import.meta.glob(['../../video/waveform.js'], { eager: true });

const first = (mods, name) => Object.values(mods).map((m) => m?.[name]).find((v) => v != null);
const NEEDED = ['compile', 'withGraph', 'evaluate', 'createCache', 'createHistory', 'emptyGraph', 'newId', 'applyPreset', 'setParams',
  'addNode', 'connect', 'disconnect', 'insertOnLink', 'parseGraph', 'parseGraphs', 'serializeGraphs', 'parseGraphFile', 'stringifyGraphFile', 'createCatalogue'];

/** The lib/graph exports the controller uses, merged from whichever files have landed. */
export function graphEngine() {
  const E = {};
  for (const m of Object.values(libMods)) for (const [k, v] of Object.entries(m || {})) if (!(k in E)) E[k] = v;
  const missing = NEEDED.filter((k) => typeof E[k] !== 'function');
  return { engine: E, missing };
}

const peekTracking = first(trackMods, 'peekTracking') ?? (() => null);
const loadWaveform = first(videoMods, 'loadWaveform') ?? null;

// theme.css dark values: used when the CSS variables are not reachable (a bare harness page)
const FALLBACK = { sky: '#1FC3FA', orange: '#F5A733', green: '#3CEBC0', yellow: '#D9E82E', blue: '#6E84F0', vermilion: '#EE5340', pink: '#CC5CBC', grey: '#A0A3A8', violet: '#A98BFF', lime: '#8CE05A' };
const colorOf = (key) => { try { return seriesColor(key) || FALLBACK[key] || key; } catch { return FALLBACK[key] || key; } };

async function loadAudio(app) {
  const path = app.doc.media?.path;
  if (!loadWaveform || !path) return null;
  const pyr = await loadWaveform({ url: app.backend?.mediaUrl?.(path) ?? path, path, backend: app.backend });
  return pyr?.levels ? pyramidToEnvelope(pyr, 10) : null;
}

const controllers = new WeakMap();

/** The graph controller of this app (created on first call). Throws if lib/graph has not landed. */
export function graphController(app) {
  let c = controllers.get(app);
  if (c) return c;
  const { engine, missing } = graphEngine();
  if (missing.length) throw new Error('graph engine not available (missing ' + missing.join(', ') + ')');
  let v = $state(0), hover = $state(null);
  c = new GraphCore({
    app, engine,
    registry: engine.createCatalogue({ compilePlan: engine.compilePlan }),
    presets: engine.PRESETS || [],
    track: () => v,
    bump: () => { v++; },
    tracking: peekTracking,
    colors: colorOf,
    raf: typeof requestAnimationFrame === 'function' ? (f) => requestAnimationFrame(f) : (f) => setTimeout(f, 16),   // never pass the bare global: called as a method it throws 'Illegal invocation'
    loadAudio,
  });
  Object.defineProperty(c, 'hoverTime', { get: () => hover, set: (t) => { hover = Number.isFinite(t) ? t : null; }, enumerable: true });
  const core = c;
  const stop = $effect.root(() => {
    $effect(() => { readDeps(app, peekTracking(app), core.undoMode); untrack(() => core.syncDoc()); });
  });
  const dispose = core.dispose.bind(core);
  core.dispose = () => { stop(); dispose(); controllers.delete(app); };
  controllers.set(app, core);
  (app.cleanups ??= []).push(() => core.dispose());   // paw-shgb: a closed tab's effect ends with it
  return core;
}

/** The controller if one exists (commands use it so they never create one as a side effect). */
export const peekGraphController = (app) => controllers.get(app) || null;
