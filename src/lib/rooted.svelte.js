// rooted.svelte.js -- paw-b7da: a long-lived per-app store made under its own effect root, never under the reaction that first
// asks for it (its deriveds belong to the effect running when they are made: made by a component, they die with it and return
// their last value forever, svelte derived_inert). The server build (node tests) has no effect roots, and a test that loads the
// module uncompiled has no runes: there it is made plainly.
// owner (an app): the root ends with it (app.destroy runs app.cleanups: a closed tab's stores let go of the shared settings, paw-shgb)
export function rooted(make, owner = null) {
  let v, stop = null;
  try { stop = $effect.root(() => { v = make(); }); } catch (e) { if (!(e instanceof ReferenceError)) throw e; }
  const out = v === undefined ? make() : v;
  // its own destroy too (a store's inner roots: they are not children of this one), so nothing of a closed tab stays subscribed
  if (owner && typeof owner === 'object') (owner.cleanups ??= []).push(() => { try { out?.destroy?.(); } finally { stop?.(); } });
  return out;
}
