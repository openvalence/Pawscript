// folds.js -- paw-r73w: the Tracker panel's folded sections (setup, the rarely used details) remember open / closed in settings
// 'tracking.panel.open' ({id: true} while open); every fold starts closed.
const KEY = 'tracking.panel.open';
/** Is fold id open? */
export const foldOpen = (app, id) => !!app.settings.get(KEY, {})?.[id];
/** Remember fold id open / closed (the Section's onchange). */
export const setFold = (app, id, open) => app.settings.set(KEY, { ...(app.settings.get(KEY, {}) || {}), [id]: open });
