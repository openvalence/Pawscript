// content.js -- the "Furry items" setting (paw-43vn; settings 'content.furry', default on: the app as built for anthro / feral
// animation). ONE table of what the UI offers only for animals and what it says instead with the setting off. Display only:
// stored ids (group names, scene tags, settings), what the sidecar is sent and learns and what the tagger computes never change,
// so a project is the same on disk either way and opens the same for a user with the setting on or off. Something animal-only a
// project already has (a group painted as tail, a scene tagged tailjob) keeps showing under its own name; it is only no longer
// OFFERED. Every reader goes through these functions, so the setting applies live (no restart).
export const FURRY = 'content.furry';

let S = null;
/** The app's settings (app.svelte.js, once). Reading the setting through them makes every label below reactive in Svelte
 *  (settings.values is $state). Unbound (pure tests, workers): furry items on. */
export const bindSettings = (s) => { S = s; };
/** Furry items shown (the default)? */
export const furryOn = () => S?.get?.(FURRY) !== false;

/** Body parts (tracking/groups.js PARTS ids) with the setting off: null = not offered, a string = its name then. In this app the
 *  fore limb ends in `hand` (shoulder - forearm - hand) and `paws` is the end of the leg (thighs - shin - paws): feet. `slit` (a
 *  genital slit / cloaca) is the only front opening part: a vulva. The knot (a section of the penis) is not here: it stays. */
export const PARTS_OFF = { tail: null, sheath: null, paws: 'feet', slit: 'vulva' };
/** The Groups picker's notes on a part (BodyFigure.svelte NOTE) with the setting off: a head has a face, not a muzzle; feet need
 *  no "(feet)". */
export const NOTES_OFF = { head: ' (face, mouth)', paws: '' };
/** Scene tags (timeline/acts.js ids) only animals have: not offered with the setting off. */
export const TAGS_OFF = ['tailpen', 'tailjob', 'slit', 'sheath'];
/** Machine panel bodies (machine/characters.js ids) with animal anatomy (each has a tail): not offered with the setting off. */
export const BODIES_OFF = ['generic', 'canine', 'feline', 'equine', 'dragon'];
/** Tagger (Hydra, e621 vocabulary) tags naming animal-only anatomy: not shown with the setting off. Knot tags stay. The boxed
 *  tags the app lists are describe.py LOCALIZABLE (acts + parts): a finite list, so this covers them. */
const TAGGER_OFF = /^(tail\w*|\w*_tail|\w*paw\w*|sheath\w*|cloaca\w*|genital_slit|hoof|hooves|(canine|equine|feline|tapering|flared|animal)_penis)$/;

/** Is part p offered (pickers, chips, the figure, auto-naming proposals, Suggest)? */
export const partShown = (p) => furryOn() || PARTS_OFF[p] !== null;
/** Part p as people read it: its own id, or what PARTS_OFF says with the setting off. */
export const partName = (p) => (!furryOn() && PARTS_OFF[p] ? PARTS_OFF[p] : p);
/** Part p's note in the picker (its own `note`, or NOTES_OFF's with the setting off). */
export const partNote = (p, note = '') => (!furryOn() && p in NOTES_OFF ? NOTES_OFF[p] : note);
/** The given parts that are offered, as read, joined ('penis, balls, hips'): example lists in tooltips. */
export const partList = (parts, sep = ', ') => parts.filter(partShown).map(partName).join(sep);
/** Is scene tag id offered (where / what chips, the tag menu, the palette, suggestions)? */
export const tagShown = (id) => furryOn() || !TAGS_OFF.includes(id);
/** Tags of a category to show: the offered ones, plus any `has` already (never hide what a scene carries). */
export const shownTags = (tags, has = () => false) => tags.filter((t) => tagShown(t.id) || has(t.id));
/** Is Machine panel body id offered? */
export const bodyShown = (id) => furryOn() || !BODIES_OFF.includes(id);
/** Is tagger tag n shown (the describe tag list)? */
export const taggerShown = (n) => furryOn() || !TAGGER_OFF.test(String(n || ''));
/** Are the tagger's species words shown (the scene's describe chip)? */
export const speciesShown = () => furryOn();
