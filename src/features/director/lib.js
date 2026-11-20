// lib.js -- the director library the feature uses, in one place: BRAINS' src/lib/director/* and the brain registry
// (contract README §3–§6, §10), as one namespace (import * as L). Vite only (the JSON import); node tests import the
// same modules one by one.
import calib from '../../lib/director/calib.json';

export * from '../../lib/director/decisions.js';
export { digest, requestDigest } from '../../lib/director/digest.js';
export { calibrate } from '../../lib/director/calib.js';
export { decide } from '../../lib/director/decide.js';
export { toRecord, toTrace2, fromTrace2, STAGE_OF } from '../../lib/director/trace.js';
export { verifyChecks, planChecks } from '../../lib/director/checks.js';
export { makeBrains } from './brains/index.js';
export { calib };
