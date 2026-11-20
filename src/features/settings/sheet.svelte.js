// sheet.svelte.js -- the Settings panel over the Projects page while no document is open (no dock to show it in).
// find: {key, app} the palette asks the Settings panel of that app to search to (paw-m3b6), taken once; {group, app}: that
// group, unfiltered, scrolled to (paw-cdot: Models, Updates).
export const sheet = $state({ open: false, find: null });
