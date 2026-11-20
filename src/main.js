import './ui/kit/theme.css';
import './style.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { bootApp } from './app/boot.js';
import { tauriBackend } from './app/backend.js';
import { setupDone } from './app/setup-screen.js';
import { firstStartDone } from './features/models/first-start.js';
import { trackInputModality } from './ui/kit/focus.js';

trackInputModality();   // paw-hdxk: no focus ring after a pointer press (theme.css)

// Settings live in the native settings blob (src-tauri API.md settings_get/settings_set); this adapter gives
// the Settings store its Storage-like shape. A corrupt settings file is reported once it is mounted.
async function nativeStorage(backend) {
  try {
    const { value, warning } = await backend.settingsGet();
    const blob = value && typeof value === 'object' ? value : {};
    // only the settings key is the native blob: the usage ring / counts (same storage object) stay in localStorage,
    // else every usage flush overwrote the settings file with its counters
    const native = (k) => k === 'pawscript.settings';
    return { storage: {
      getItem: (k) => (native(k) ? JSON.stringify(blob) : localStorage.getItem(k)),
      setItem: (k, s) => (native(k) ? backend.settingsSet(JSON.parse(s)).catch((e) => console.warn('[settings]', e)) : localStorage.setItem(k, s)),
    }, warning };
  } catch (e) {
    console.warn('[settings] native settings unavailable, using localStorage:', e);
    return { storage: localStorage, warning: null };
  }
}

(async () => {
  // Outside Tauri (index.html opened in a plain browser) every native call would throw: run on the in-memory
  // backend instead, settings in localStorage. Harness pages use dev/shell.html, which does the same.
  const inTauri = !!window.__TAURI_INTERNALS__;
  if (inTauri && !(await setupDone())) return;   // the shared build's first start unpacks its runtime first (paw-i7s)
  const backend = inTauri ? tauriBackend() : (await import('../dev/mock-app.js')).mockBackend();
  const { storage, warning } = inTauri ? await nativeStorage(backend) : { storage: localStorage, warning: null };
  if (inTauri && !(await firstStartDone({ backend, storage }))) return;   // paw-cdot: the runtime / models to download first
  const app = bootApp({ backend, storage });
  mount(App, { target: document.getElementById('app'), props: { app } });
  if (warning) app.toast(warning, 'warn');
  // Dev only: poke the state from the webview console / a CDP script.
  // paw-shgb: the shown tab's app (each tab is its own app); window.appTabs the tabs themselves
  if (import.meta.env.DEV || import.meta.env.VITE_EXPOSE_APP) { Object.defineProperty(window, 'app', { get: () => app.tabs.current, configurable: true }); window.appTabs = app.tabs; }
  if (import.meta.env.VITE_EXPOSE_APP) Promise.all([import('./lib/runs.js'), import('./lib/runs-channel.js'), import('./features/tracking/tracking.svelte.js'), import('./features/tracking/groups.svelte.js'), import('./features/timeline/state.svelte.js'), import('./features/video/scrub.js'), import('./features/video/simdraw.js')]).then(([r, c, t, g, s, v, sd]) => (window.__pawDev = { ...r, ...c, trackingFor: t.trackingFor, groupsFor: g.groupsFor, tl: s.tl, tlFor: s.tlFor, createScrubber: v.createScrubber, simDebug: sd.simDebug }));   // dev/runsel-check.mjs builds runs in the real window; dev/loops-ui-check.mjs reads the timeline's state; paw-trxk: dev/ scripts make a frame decoder; paw-gwmd: dev/sim-rail-check.mjs reads the machine preview's last frame
  if (import.meta.env.VITE_TEST_ID) window.__pawscriptTestId = import.meta.env.VITE_TEST_ID;   // dev/cdp-connect.mjs asserts it
})();
