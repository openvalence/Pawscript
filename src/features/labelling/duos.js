// duos.js -- "duos first" in the labelling workspace (paw-9p1h): the pure side. A count guess per picture from the Hydra tagger's scores
// (sidecar `tag_image`, PROTOCOL v4.40), the tiered order, and the lazy queue's pause / cancel rule. Nothing here touches the app.

/** Tiers, best first: exactly two characters, then other multi-character pictures, then solo, then not looked at (or no idea). */
export const TIERS = { duo: 0, multi: 1, solo: 2, unknown: 3 };
const MIN = 0.35;   // below this the tagger has no opinion on the count

/** scores: {tag: p} from tag_image -> {count: 'duo' | 'trio' | 'group' | 'solo' | 'unknown', conf, tags: [the few tags used]}.
 *  The count tags decide; a gender pairing (male/female ...) only tips an undecided picture towards a duo when no count tag claims solo. */
export function countGuess(scores) {
  const s = scores || {}, p = (t) => (Number.isFinite(s[t]) ? s[t] : 0);
  const counts = ['solo', 'duo', 'trio', 'group'].map((t) => [t, p(t)]).sort((a, b) => b[1] - a[1]);
  const pair = Object.keys(s).filter((t) => t.includes('/')).sort((a, b) => p(b) - p(a))[0];
  let [count, conf] = counts[0];
  if (conf < MIN) {
    if (pair && p(pair) >= 0.5 && p('solo') < MIN) { count = 'duo'; conf = p(pair) * 0.8; } else { count = 'unknown'; conf = counts[0][1]; }
  }
  const used = [...counts.filter(([, v]) => v >= 0.1).map(([t]) => t), ...(count === 'duo' && pair ? [pair] : [])];
  return { count, conf: Math.round(conf * 1000) / 1000, tags: used };
}

/** The tier of a guess (undefined: not looked at yet). */
export const tierOf = (g) => (!g ? TIERS.unknown : g.count === 'duo' ? TIERS.duo : g.count === 'trio' || g.count === 'group' ? TIERS.multi : g.count === 'solo' ? TIERS.solo : TIERS.unknown);

/** The order `base` (the shuffled / by-name order) with duos first, but ONLY AHEAD: the first `head` images (the one on screen and everything
 *  before it) stay exactly where they are; the rest are stable-sorted by tier (inside a tier the base order). guesses: Map key -> guess.
 *  `base` is the whole list in its own order; `current` is what the list is now (its first `head` entries are the pinned ones).
 *  -> a new array of the same images. Pure, stable. */
export function arrangeAhead(base, current, head, guesses, on = true) {
  const pinned = (current || []).slice(0, Math.max(0, head)), seen = new Set(pinned.map((im) => im.key));
  const tail = base.filter((im) => !seen.has(im.key));
  if (!on) return [...pinned, ...tail];
  const idx = new Map(tail.map((im, i) => [im.key, i]));
  return [...pinned, ...tail.slice().sort((a, b) => tierOf(guesses.get(a.key)) - tierOf(guesses.get(b.key)) || idx.get(a.key) - idx.get(b.key))];
}

/** Which pictures to look at next: up to `n` untagged ones after `index` (then, when the end is reached, nothing: the ones passed are not worth the GPU),
 *  skipping the ones already guessed, being asked or that failed. */
export function pickAhead(images, index, guesses, busyKeys, n = 3) {
  const out = [];
  for (let i = Math.max(0, index + 1); i < images.length && out.length < n; i++) {
    const k = images[i].key;
    if (!guesses.has(k) && !busyKeys.has(k)) out.push(images[i]);
  }
  return out;
}

/** May a tagging job start now? Never off, never while the workspace is closed, a Track / Suggest / any other sidecar job is running or
 *  queued, or the owner is painting (a stroke, a pending name pick, a suggest in flight). */
export const mayTag = ({ on, enabled, trackerBusy, painting, ready }) => !!(on && enabled && ready && !trackerBusy && !painting);

/** The tip of the toggle: '412 of 3,547 looked at'. */
export const progressTip = (done, total) => `${done.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} looked at`;

/** The cache file of a picture: { key, guess: {count, conf, tags}, savedAt }. */
export const parseTag = (text) => { try { const d = JSON.parse(text); return d && d.guess && typeof d.guess.count === 'string' ? d.guess : null; } catch { return null; } };
export const tagJson = (key, guess) => JSON.stringify({ key, guess, savedAt: new Date().toISOString() });
