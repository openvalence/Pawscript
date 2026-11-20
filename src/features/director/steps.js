// steps.js -- the director's steps for draft's runner (contract README §9.1): draft calls ext[id](draft, i, single) for
// every step id it does not own. The work is runner.js on the app's director.
import { directorFor } from './director.svelte.js';
import { RUNNERS } from './runner.js';
export { STEP_OF } from './runner.js';

export function directorSteps(app) {
  return Object.fromEntries(Object.entries(RUNNERS).map(([id, f]) => [id, (draft, i, single) => {
    const D = directorFor(app);
    if (!D.budget) D.begin({ poll: false });   // a single step from the draft dialog, outside director.run
    return f(D, draft, i, single);
  }]));
}
