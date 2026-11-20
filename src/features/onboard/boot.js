// Decides once per profile whether the first-run hints show (steps.js initHints: a profile with no recent projects).
import { initHints } from './steps.js';

export default (app) => { initHints(app.settings); };
