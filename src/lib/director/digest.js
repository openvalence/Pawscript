// digest.js -- stable content hashes for replay (README §5). No deps.

/** JSON with object keys sorted (undefined dropped, NaN -> null, as JSON does). */
export const stable = (x) => JSON.stringify(x, (k, v) =>
  (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]])) : v)) ?? 'null';

/** cyrb53 (public domain, bryc): 53-bit string hash. */
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Any JSON value -> 14 hex chars, equal for equal content whatever the key order. */
export const digest = (x) => cyrb53(stable(x)).toString(16).padStart(14, '0');

/** What a decision's answer depends on: not `evidence` or `round` (the agent loop grows those). */
export const requestDigest = (req, depValues = {}, brainVersion = '') => digest({
  kind: req.kind, scope: req.scope, attempt: req.attempt ?? 0, facts: req.facts ?? null, frames: req.frames ?? null,
  choices: req.choices ?? null, prior: req.prior ?? null, deps: depValues, v: brainVersion,
});
