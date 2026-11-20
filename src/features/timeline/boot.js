// boot.js -- the timeline's project blocks ('timeline', 'transitions') registered at boot (app/plugins.js 'boot'), not when a
// lane first mounts: a tab opened in the background (paw-shgb: restored at start, never shown) loads and writes them too.
import { bindApp } from './state.svelte.js';
import { bindTransitions } from './transitions.svelte.js';

export default (app) => { bindApp(app); bindTransitions(app); };
