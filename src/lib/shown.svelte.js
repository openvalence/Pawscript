// shown.svelte.js -- the app whose editor is on screen (paw-shgb: one app per tab, only the shown one mounted). Module
// state that the components and key commands reach without an app in hand (the timeline's `tl`) follows it; anything
// that runs for a document in the background (a track landing, a load, a write) asks for that app's own state instead.
class Shown { app = $state.raw(null); }
export const shown = new Shown();
