// acts.js -- scene tags: the vocabulary (TAG_CATEGORIES + ALIASES), describe (trackers/pawtrack/describe.py) -> tags, and
// the scene helpers. Pure. A scene's tags = the ones its describe maps to, then the user's diff `scene.tags`: 'id' or
// {id, t0?, t1?} = added (t0 / t1 = ms, absolute, clipped to the scene; missing = the scene's edge), '-id' = removed. A
// diff, not a full set, so "the describe said anal, the user removed it" survives a re-describe and lib code
// (scenes-continue.js) can add 'offscreen' without knowing the describe.
// An act is composed the way e621 composes it: where (the receiving part) x what (the action): anal_fingering = anal +
// fingering, rimming = anal + licking, fellatio = oral + penetration, double_penetration = anal + vaginal + penetration.
// Names: 'x*' = prefix, '*x' = suffix, else exact (Hydra 3.5 / e621 tag names).
import { kindOf } from './kinds.js';
import { addSpan } from '../../lib/runs.js';
import { tagShown } from '../../lib/content.js';

/** Tag score a describe tag needs to count (and, without a summary, any act tag). */
export const MIN_SCORE = 0.5;

// Cum / orgasm tags: the eval's CUM_TAGS (trackers/eval/av_climax.py). Not in describe.py ACTS: always from describe.tags.
export const CUM_TAGS = ['cum', 'cumshot', 'ejaculation', 'orgasm', 'cum_inside', 'cum_spurt', 'cum_from_penis',
  'cum_explosion', 'cum_overflow', 'cum_drip', 'leaking_cum', 'excessive_cum', 'orgasm_face', 'ahegao',
  'cum_while_penetrated', 'hands-free', 'cum_inflation', 'cum_string', 'cum_splatter'];
/** Internal-view (x-ray / cross-section) names. An internal view shows the act itself: not a cutaway. */
export const VIEW_TAGS = ['internal*', 'x-ray*', 'cross_section', 'cutaway_view'];   // describe.py names it x-ray_view

/**
 * The vocabulary, in display order; within `what` the order is also primaryAct's priority. A tag: {id, label, tip?,
 * names (e621 names that give it), umbrella? (names that only count when no tag of the same category hit through its
 * own names: e621 implications put anal / oral / sex / penetration on rimming, tongue and fingering shots too; with
 * fallback? only when no other tag of the category hit at all, umbrellas included), from? (also the umbrella's pool)
 * ('tags' = describe.tags >= MIN_SCORE; 'view' = summary views + tags; default = summary acts + positions, or the tags
 * without a summary), kind? (kinds.js id: the colour; `penetration` takes its where's), icon? (16x16 path: the marker a
 * modifier draws on the scene bar), implies? (tags toggling it on also turns on; turning one of them off turns it off),
 * needsWhere? (with no where on the scene the quick bar asks for one: never guessed), hides? (tags of the category this one
 * removes when it hits: e621 implies anal_penetration on tail_in_ass, but no penis is in it)}.
 * `one`: at most one tag of the category (view: none = external, visible; camera: none = not detected; angle: none = unknown; structure: none =
 * part of the story). Their tags carry no time span. Camera tags come from the scene's `camera` segments
 * (trackers/pawtrack/camera.py, Detect scenes): the kind covering most of the scene; the user's pick replaces it through
 * the same diff. 'blank' comes from Detect scenes too (scene.kind 'blank', trackers/pawtrack/scenes.py: a black / white
 * stretch with its fades). Structure tags come from the list (structureAuto, applied by withStructure as scene.structure).
 */
// A chip's tip says what the tag is (one fragment, docs/copy.md). What the tags do beyond that: internal views track with
// SAM area; off-screen and blank are not tracked (blank holds the level before it, off-screen is bridged); a cutaway is an
// intermission unless an action region covers it, then bridged like off-screen; exposed tracks the penis / balls scale and
// "+ Throb" adds the heartbeat; orgasm is where Detect cumshots looks, one spurt (U) per cumshot. Camera: reciprocal keeps
// the camera path (cam x / y are stroke candidates, no camera removal); pan, zoom and handheld default the signal to
// proj_cam; orbit turns camera removal off and defaults to pair, else g1; POV defaults to proj with no camera removal and
// is a property of the whole shot. Angles: the axes not named as measured are estimated. Structure tags are not tracked;
// idle is also a stretch inside a scene as an Idle modifier.
export const TAG_CATEGORIES = [  { id: 'view', label: 'View', one: true, tags: [
    { id: 'internal', label: 'Internal', tip: 'X-ray or cross-section view, tracked with SAM', names: VIEW_TAGS, from: 'view' },
    { id: 'offscreen', label: 'Off-screen', tip: 'Action goes on unseen, bridged from the shots around', names: [] },
    // paw-2lp7.4, the owner: "cutaway is to something not action". By itself nothing is carried (an intermission); an action
    // region drawn across it says the action goes on there: then it is bridged exactly like off-screen (the shim's `carried`)
    { id: 'cutaway', label: 'Cutaway', tip: 'Not the action: a break, unless an action region covers it', names: [] },
    { id: 'blank', label: 'Blank', tip: 'Black or white screen and its fades, holds the level before', names: [] },
  ] },
  { id: 'where', label: 'Where', tags: [
    { id: 'anal', label: 'anal', kind: 'penetration', names: ['anal_*', 'rimming', 'anilingus', 'tongue_in_ass', 'double_penetration'], umbrella: ['anal'] },
    { id: 'vaginal', label: 'vaginal', kind: 'penetration', names: ['vaginal_*', 'cunnilingus', 'tongue_in_pussy', 'double_penetration'], umbrella: ['vaginal'] },
    { id: 'oral', label: 'oral', kind: 'oral', names: ['fellatio', 'irrumatio', 'deep_throat', 'spitroast', 'oral_knotting'], umbrella: ['oral', 'oral_penetration'] },
    // a genital slit / cloaca, and a sheath (docking, sheath play): wheres of their own
    { id: 'slit', label: 'slit', kind: 'penetration', names: ['slit_*', 'cloacal_*', 'tongue_in_slit', 'tongue_in_cloaca'], umbrella: ['slit', 'cloacal'] },
    { id: 'sheath', label: 'sheath', kind: 'penetration', names: ['sheath_*', 'docking', 'tongue_in_sheath'], umbrella: [] },
  ] },
  { id: 'what', label: 'What', tags: [
    { id: 'penetration', label: 'penetration', names: ['anal_penetration', 'vaginal_penetration', 'double_penetration', 'fellatio', 'irrumatio', 'deep_throat', 'spitroast', 'anal_knotting', 'vaginal_knotting', 'oral_knotting'], umbrella: ['sex', 'penetration', 'thrusting', 'oral_penetration'] },
    { id: 'tonguefucking', label: 'tonguefucking', kind: 'oral', needsWhere: true, names: ['tongue_in_ass', 'tongue_in_pussy', 'tongue_in_cloaca', 'tongue_penetration', 'tongue_fuck*', 'tonguefuck*'] },
    { id: 'licking', label: 'licking', kind: 'oral', names: ['licking', '*_lick', '*_licking', 'rimming', 'anilingus', 'cunnilingus'] },
    { id: 'fisting', label: 'fisting', kind: 'penetration', needsWhere: true, names: ['fisting', '*_fisting'] },
    { id: 'toy', label: 'toy', kind: 'penetration', needsWhere: true, names: ['dildo_insertion', 'sex_toy_insertion', 'anal_dildo', 'vaginal_dildo', 'dildo_in_*', 'anal_beads'] },
    // paw-210e (owner: "tail penetration too, but the tail is doing the penetrating"): the Top's tail in the Bottom, or one's own
    // tail in oneself (not in fusion's TWO_ACTS). Hides penetration (no penis: no shaft reading, no penis rows). Not in
    // describe.py ACTS: from describe.tags; names checked against Hydra 3.5's label list (no tail_penetration / tail_in_pussy)
    { id: 'tailpen', label: 'tail penetration', kind: 'penetration', needsWhere: true, from: 'tags', hides: ['penetration'], tip: 'A tail penetrates, fusion follows it against the Bottom hips', names: ['tail_insertion', 'tail_in_ass', 'tail_in_vagina'] },
    // one character's own penis in its own opening: implies penetration (the shaft reading, the ladder); fusion follows the
    // penis against its own opening / hips (lib/fusion.js ACT_ROWS; not in TWO_ACTS). Chip only (no e621 name checked)
    { id: 'selfpen', label: 'self penetration', kind: 'penetration', needsWhere: true, implies: ['penetration'], tip: 'Its own penis in itself, fusion follows penis vs opening', names: [] },
    { id: 'fingering', label: 'fingering', kind: 'foreplay', needsWhere: true, names: ['*fingering'] },
    { id: 'grinding', label: 'grinding', kind: 'penetration', names: ['grinding', 'frottage', 'thigh_sex', 'humping', 'tribadism'] },
    { id: 'handjob', label: 'handjob', kind: 'foreplay', names: ['handjob'] },   // a partner's hand on the shaft: two characters
    { id: 'masturbation', label: 'masturbation', kind: 'foreplay', names: ['masturbation'] },   // their own hand: can be solo. Its own type because the character count is a signal for the tracker and fusion (owner, 2026-11-12)
    // paw-210e: a tail on a penis, a partner's or its own (can be solo); was one of handjob's names. tail_around_penis is not in
    // describe.py ACTS: from describe.tags (tail_masturbation left out: own tail on the shaft or in oneself, e621 does not say)
    { id: 'tailjob', label: 'tailjob', kind: 'foreplay', from: 'tags', tip: 'Tail on a penis, can be solo, fusion follows the tail', names: ['tailjob', 'tail_around_penis'] },
    { id: 'footjob', label: 'footjob', kind: 'foreplay', names: ['footjob'] },
    { id: 'titfuck', label: 'titfuck', kind: 'foreplay', names: ['titfuck'] },
    { id: 'kissing', label: 'kissing', kind: 'foreplay', names: ['kissing', 'french_kiss*', 'tongue_in_mouth'] },
    // paw-210e (owner: "facesitting, which instead uses hip side to side"): one character's hips on the other's face (either
    // sits); no stroke axis: fusion reads the sitter's hips against the head along the way they rock. Foreplay range (owner 2026-11-15: no depth here; was oral: the face
    // receives; licking / rimming usually come with it: one ladder for the run). From describe.tags (Hydra 3.5 names; no
    // face_sitting / sitting_on_face / queening there; smothering is breasts too)
    { id: 'facesitting', label: 'facesitting', kind: 'foreplay', from: 'tags', tip: 'One sits on the other\'s face, fusion follows the sitter hips', names: ['facesitting', 'butt_smother'] },
    // paw-n00h (owner: "dancing, which would prioritize tracking hips"): can be solo (not in fusion's TWO_ACTS); fusion leads with
    // the hips against the frame (ACT_ROWS). Not in describe.py ACTS, so read from describe.tags; names checked against Hydra 3.5's
    // label list (no lap_dance / hip_sway / swaying_hips there)
    { id: 'dancing', label: 'dancing', kind: 'foreplay', from: 'tags', tip: 'Twerking, pole dance, shaking butt: fusion follows the hips', names: ['dancing', 'pole_dancing', 'twerking', 'shaking_butt'] },
    // dick out, no act: only when no other what hit (umbrellas included: `fallback`), so a penetration scene never gets it too.
    // Not busy for structureAuto (an intro / idle may be exposed); tracked for the throb (track-plan: grid, seeded groups)
    { id: 'exposed', label: 'exposed', kind: 'exposed', from: 'tags', fallback: true, tip: 'Penis out, no act: tracked for the throb, rests at 85–100',
      names: [], umbrella: ['erection', 'penis', 'genitals', 'exposed_*', 'presenting', 'presenting_penis', 'knot', 'erect_*'] },
  ] },
  // the event modifiers (timeline/mods.js, lib/fx.js EVENT_KINDS) as the scene-level consumers read them: made as modifiers
  // (doc.fx), never a scene's own tag (paw-8b4h, owner: "marking the scene as having orgasm or knotting just adds the
  // modifier and the scene remains action only"): sceneTags counts only the {id, t0, t1} entries mods.js withMods writes
  // in for the readers. The tagger's detection (names) is a suggestion on the Modifiers row (detectedMods), never a tag
  { id: 'modifier', label: 'Modifiers', tags: [
    { id: 'knotting', label: 'knotting', kind: 'knotting', implies: ['penetration'], needsWhere: true, tip: 'Knotting modifier, implies penetration', names: ['*knotting', 'knot_sitting'], icon: 'M1 8H4.5M11.5 8H15M8 4.5A3.5 3.5 0 1 1 7.99 4.5Z' },
    { id: 'throbbing', label: 'throbbing', kind: 'climax', tip: 'Throbbing modifier', names: [], icon: 'M8 2L12 8L8 14L4 8Z' },
    { id: 'orgasm', label: 'orgasm', kind: 'orgasm', tip: 'Orgasm modifier: where the cumshots happen', names: CUM_TAGS, from: 'tags', icon: 'M8 1.5C8 1.5 3.5 7.5 3.5 10.5A4.5 4.5 0 0 0 12.5 10.5C12.5 7.5 8 1.5 8 1.5Z' },
    { id: 'insertion', label: 'insertion', kind: 'penetration', tip: 'Insertion modifier: one slow push', names: [] },
    { id: 'pullout', label: 'pull-out', kind: 'penetration', tip: 'Pull-out modifier: one slow pull out', names: [] },
  ] },
  // camera: icon = the lane glyph at the scene's left end (none for static)
  { id: 'camera', label: 'Camera', one: true, tags: [
    { id: 'static', label: 'static', tip: 'Static camera', names: [] },
    { id: 'reciprocal', label: 'rides the stroke', tip: 'Camera bobs with the stroke, its path carries the stroke', names: [], icon: 'M2 5.5Q5 2.5 8 5.5T14 5.5M2 10.5Q5 7.5 8 10.5T14 10.5' },
    { id: 'pan', label: 'pan', tip: 'Camera pans or tilts inside one take, tracked through', names: [], icon: 'M1.5 8H14.5M11.5 5L14.5 8L11.5 11M4.5 5L1.5 8L4.5 11' },
    { id: 'zoom', label: 'zoom', tip: 'Camera zooms or dollies inside one take, tracked through', names: [], icon: 'M7 2.5A4.5 4.5 0 1 1 6.99 2.5ZM10.2 10.2L14.5 14.5M5 7H9M7 5V9' },
    { id: 'orbit', label: 'turntable', tip: 'Camera orbits the action, rolling stroke axis', names: [], icon: 'M2 8A6 3 0 1 0 14 8A6 3 0 0 0 4 5.5M4 2.5V5.5H7' },
    { id: 'handheld', label: 'handheld', tip: 'Shaky camera inside one take, tracked through', names: [], icon: 'M1.5 8L3.5 5L5.5 11L7.5 4L9.5 12L11.5 6L13.5 9L14.5 8' },
    // paw-2vd5: from Describe (Hydra's first_person_view; every *_pov label implies it), never from camera.py; beats the
    // detected motion kind (detect), which stays in scene.camera for the soft cuts and the seed window
    { id: 'pov', label: 'POV', tip: 'First-person view: camera motion is part of the action', names: ['first_person_view', '*_pov'], from: 'tags', icon: 'M1.5 8Q8 2 14.5 8Q8 14 1.5 8ZM8 6A2 2 0 1 1 7.99 6Z' },
  ] },
  // paw-2pcf: the angle the shot is seen from (lib/six-axis.js maps picture motion to the secondary axes by it). From Describe's
  // summary views (side_view, rear_view ...), settable by hand (hand-set wins, one per shot). POV stays the camera tag above
  // (one source of truth): a POV shot without an angle is read as 'top' (six-axis.js viewFor).
  { id: 'angle', label: 'Angle', one: true, tags: [
    { id: 'side', label: 'side', tip: 'Seen from the side: surge and pitch measured', names: ['side_view'], from: 'view' },
    { id: 'rear', label: 'rear', tip: 'Seen from behind the Bottom: sway, surge, twist measured', names: ['rear_view'], from: 'view' },
    { id: 'front', label: 'front', tip: 'Seen from the Bottom\'s front: sway, surge, twist measured', names: ['front_view'], from: 'view' },
    { id: 'top', label: 'top', tip: 'Seen from above: sway and roll measured', names: ['high-angle_view'], from: 'view' },
  ] },
  // structure: where a scene with nothing happening sits in the story (the old plan kinds idle / outro / afterglow and
  // fade-in's place; their colours). Not tracked: a generated ghost instead (lib/scenes-continue.js holdScript / afterScript).
  { id: 'structure', label: 'Structure', one: true, tags: [
    { id: 'intro', label: 'intro', kind: 'fade-in', tip: 'Opening before the first act, not tracked: eases into it', names: [] },
    // idle is also a span kind (SPAN_KINDS): an idle span over a whole shot makes it idle (sceneTags), so a whole idle scene
    // and a stretch marked idle inside a scene are one concept (a span over [t0, t1]); a part of a shot is a sidecar hold (tagSpans)
    { id: 'idle', label: 'idle', kind: 'idle', tip: 'Nothing happening, not tracked: holds at rest', names: [], icon: 'M5 3V13M11 3V13' },
    { id: 'after', label: 'after', kind: 'afterglow', tip: 'After the orgasm, not tracked: a slow ending to rest', names: [] },
    { id: 'outro', label: 'outro', kind: 'outro', tip: 'Credits or end card, not tracked: eases to rest', names: [] },
  ] },
];
/** Words for a where + what combination. Not stored: picking one toggles its components, and when all its components are on
 *  the label and the chips say the word. A string value = a synonym of that alias (menu / palette only). Order = display priority. */
export const ALIASES = {
  'double penetration': ['anal', 'vaginal', 'penetration'], rimming: ['anal', 'licking'], cunnilingus: ['vaginal', 'licking'],
  fellatio: ['oral', 'penetration'], anilingus: 'rimming', analingus: 'rimming', blowjob: 'fellatio',
};
/** An alias or synonym -> its components, else null. */
export const aliasParts = (w) => (typeof ALIASES[w] === 'string' ? ALIASES[ALIASES[w]] : ALIASES[w]) ?? null;
const MAIN_ALIASES = Object.keys(ALIASES).filter((w) => Array.isArray(ALIASES[w]));
const TAGS = TAG_CATEGORIES.flatMap((c) => c.tags.map((t) => ({ ...t, cat: c.id })));
/** id -> tag (with `cat`). */
export const TAG = Object.fromEntries(TAGS.map((t) => [t.id, t]));
/** Categories with at most one tag (view, camera, structure). */
const ONE = new Set(TAG_CATEGORIES.filter((c) => c.one).map((c) => c.id));
/** The categories that belong to the scene (the act); view and camera belong to the shot (shots.js). */
const ACT_CAT = new Set(['where', 'what', 'modifier', 'structure']);
const isAct = (id) => TAG[id]?.cat === 'where' || TAG[id]?.cat === 'what';
/** A diff entry's id ('-x' for a removal). */
const idOf = (e) => (typeof e === 'string' ? e : e?.id);

const hit = (pat, n) => (pat.endsWith('*') ? n.startsWith(pat.slice(0, -1)) : pat.startsWith('*') ? n.endsWith(pat.slice(1)) : n === pat);
const inTable = (set) => TAGS.filter((t) => set.has(t.id)).map((t) => t.id);

/** Camera segments [{t0, t1, kind}] (pawtrack camera.py) -> the camera tag id of the kind covering most time, or null. */
export function cameraKind(segs) {
  const tot = {};
  for (const g of Array.isArray(segs) ? segs : []) if (TAG[g?.kind]?.cat === 'camera' && g.t1 > g.t0) tot[g.kind] = (tot[g.kind] || 0) + g.t1 - g.t0;
  return Object.keys(tot).sort((a, b) => tot[b] - tot[a])[0] ?? null;
}
/** describe {tags:[{tag,score}], summary:{acts, positions, views}} (+ the scene's camera segments) -> tag ids (table order).
 *  Never a modifier (detectedMods). */
export const tagsOf = (describe, camera) => detect(describe, camera).filter((t) => TAG[t].cat !== 'modifier');
/** The modifier kinds the tagger saw in the scene ('orgasm', 'knotting'): the Modifiers row's dashed suggestion. */
export const detectedMods = (scene) => detect(scene?.scene_describe ?? scene?.describe).filter((t) => TAG[t].cat === 'modifier');
function detect(describe, camera) {
  const cam = cameraKind(camera);
  if (!describe) return cam ? [cam] : [];
  const s = describe.summary, tags = (describe.tags || []).filter((t) => t && t.score >= MIN_SCORE).map((t) => t.tag);
  const pools = { acts: s ? [...(s.acts || []), ...(s.positions || [])] : tags, tags, view: [...(s?.views || []), ...tags] };
  const any = (names, pool) => !!names?.some((p) => pool.some((n) => hit(p, n)));
  const out = new Set(TAGS.filter((t) => any(t.names, pools[t.from || 'acts'])).map((t) => t.id));
  for (const t of TAGS) if (out.has(t.id)) for (const h of t.hides || []) out.delete(h);
  const none = (c) => !TAGS.some((t) => t.cat === c && out.has(t.id));
  for (const c of ['where', 'what']) {
    if (none(c)) for (const t of TAGS) if (t.cat === c && !t.fallback && any(t.umbrella, pools[t.from || 'acts'])) out.add(t.id);
    if (none(c)) for (const t of TAGS) if (t.cat === c && t.fallback && any(t.umbrella, pools[t.from || 'acts'])) out.add(t.id);
  }
  if (cam && !out.has('pov')) out.add(cam);   // a POV shot that also moves is POV (the motion kind stays in scene.camera)
  return inTable(out);
}

/** The scene's detected tags: its describe's and camera's, 'blank' (scene.kind from Detect scenes; it replaces a
 *  describe view) and its structure (scene.structure, set by withStructure). Table order. */
export function autoTags(scene) {
  // a shot of a multi-shot scene (features/timeline/shots.js): the act tags are the scene's (its scene_describe), the view
  // and camera the shot's own
  const sd = scene?.scene_describe, own = tagsOf(scene?.describe, scene?.camera);
  const set = new Set(sd ? [...tagsOf(sd).filter((t) => ACT_CAT.has(TAG[t].cat)), ...own.filter((t) => !ACT_CAT.has(TAG[t].cat))] : own);
  if (scene?.kind === 'blank') { for (const t of [...set]) if (TAG[t].cat === 'view') set.delete(t); set.add('blank'); }
  if (TAG[scene?.structure]?.cat === 'structure') set.add(scene.structure);
  return inTable(set);
}
/** The tags a scene has: autoTags, the user's view / camera / structure replacing the detected one, then the user's
 *  diff. Table order. */
export function sceneTags(scene) {
  // an entry with times (a span: modifiers any number per scene, paw-8qb) counts only where it meets this scene / shot; a
  // one-tag category's span (idle) only where it covers it: a stretch of idle inside a shot does not make the shot idle
  const meets = (e) => {
    if (typeof e !== 'object' || !e || !Number.isFinite(scene?.start_ms)) return true;
    const a = e.t0 ?? scene.start_ms, b = e.t1 ?? scene.end_ms;
    return ONE.has(TAG[e.id]?.cat) ? a <= scene.start_ms && b >= scene.end_ms : b > scene.start_ms && a < scene.end_ms;
  };
  // a modifier counts only as a projected span (mods.js withMods): a bare 'orgasm' / '-knotting' is never the scene's
  const own = (scene?.tags || []).filter((e) => meets(e) && (typeof e === 'object' || TAG[idOf(e)?.replace(/^-/, '')]?.cat !== 'modifier')).map(idOf).filter((t) => typeof t === 'string'), set = new Set(autoTags(scene));
  for (const c of ONE) if (own.some((t) => TAG[t]?.cat === c)) for (const t of [...set]) if (TAG[t].cat === c) set.delete(t);
  for (const t of own) if (t[0] === '-') set.delete(t.slice(1)); else set.add(t);
  return inTable(set);
}
const ofCat = (scene, cat) => sceneTags(scene).filter((t) => TAG[t].cat === cat);
export const hasTag = (scene, id) => sceneTags(scene).includes(id);
/** The scene's view tag ('internal' | 'offscreen' | 'cutaway' | 'blank') or null (external, visible). paw-2lp7.4: a cutaway with
 *  an action region over it (`carried`, regions.js withCarried) reads 'offscreen' everywhere: the one bridging path. */
export const sceneView = (scene) => { const v = ofCat(scene, 'view')[0] ?? null; return v === 'cutaway' && scene?.carried ? 'offscreen' : v; };
/** A cutaway with no action over it: an intermission (nothing carried, not tracked). */
export const isIntermission = (scene) => sceneView(scene) === 'cutaway';
export const isInternal = (scene) => sceneView(scene) === 'internal';
export const isOffscreen = (scene) => sceneView(scene) === 'offscreen';
export const isBlank = (scene) => sceneView(scene) === 'blank';
/** The scene's structure tag ('intro' | 'idle' | 'after' | 'outro') or null. */
export const sceneStructure = (scene) => ofCat(scene, 'structure')[0] ?? null;
/** Why Track tagged scenes skips the scene ('' = it does not): off-screen (bridged; the timing option is tracked for its
 *  timing, paw-b26) or a cutaway under an action (the same: sceneView), a cutaway with none (an intermission, paw-2lp7.4),
 *  blank (held), a structure tag (generated) unless the scene is exposed (tracked for the throb). lib/track-plan.js `skip`. */
export function skipReason(scene) {
  const v = sceneView(scene), st = sceneStructure(scene);
  if (v === 'offscreen' && scene?.fill !== 'timing') return 'off-screen: bridged from the neighbors';
  if (v === 'cutaway') return 'cutaway: an intermission, nothing carried';
  if (v === 'blank') return 'blank: hold';
  return st && !hasTag(scene, 'exposed') ? `${st}: nothing to track, generated` : '';
}
/** Dick out, no act (the `exposed` what): tracked for the throb, rests high. */
export const isExposed = (scene) => hasTag(scene, 'exposed');
export const sceneWheres = (scene) => ofCat(scene, 'where');
export const sceneWhats = (scene) => ofCat(scene, 'what');
export const sceneMods = (scene) => ofCat(scene, 'modifier');
/** The scene's camera tag ('static' | 'reciprocal' | 'pan' | 'zoom' | 'orbit' | 'handheld' | 'pov') or null (not detected). */
export const sceneCamera = (scene) => ofCat(scene, 'camera')[0] ?? null;
/** The shot's angle tag ('side' | 'rear' | 'front' | 'top') or null (paw-2pcf). */
export const sceneAngle = (scene) => ofCat(scene, 'angle')[0] ?? null;
/** The act's main tag: its first what in table order, else its first where; null when it has neither. */
export const primaryAct = (scene) => sceneWhats(scene)[0] ?? sceneWheres(scene)[0] ?? null;
/** The act's colour family (kinds.js id): the first what's, penetration taking its where's (oral green, else yellow). */
export function actKind(scene) {
  const w = sceneWhats(scene)[0], h = sceneWheres(scene)[0];
  return TAG[w]?.kind ?? TAG[h]?.kind ?? (w ? 'penetration' : null);
}
/** tracking.svelte.js's name for the act family an internal-view run is matched on (lib/scenes-continue.js). */
export const sceneKind = actKind;
/** The kinds.js id a scene is tinted with: its act family, else its first modifier's, else its structure's; null when
 *  it has none. */
export const tintOf = (scene) => actKind(scene) ?? TAG[sceneMods(scene)[0]]?.kind ?? TAG[sceneStructure(scene)]?.kind ?? null;

// ---- structure: intro / after / outro from where a scene sits (idle is never detected: the user's call) ----
const SEX_WHATS = new Set(['penetration', 'tonguefucking', 'fisting', 'toy', 'tailpen']);
/** Nobody in the frame (describe saw no act, no character count, no species): a title, credits. */
const nobody = (s) => { const d = s?.describe?.summary; return !!d && !d.acts?.length && (!d.count || d.count === 'unknown') && !d.species?.length; };
/**
 * Per scene of the list: the structure tag its place implies, or null. Busy = an act (where / what; exposed is no act), orgasm, or an
 * off-screen / internal view; quiet = not busy and known to be empty (a still from Detect scenes, or described with no
 * act). intro = the quiet scenes before the first busy one (a blank among them stays only blank; an undescribed scene
 * stops the run). After the last busy one: a still or a nobody-in-frame scene = outro, a quiet scene with bodies = after
 * (when the video has a sex act or an orgasm; else outro). With no busy scene at all only stills at the ends count
 * (intro / outro). Blank scenes never get one; idle is never detected.
 */
export function structureAuto(list = []) {
  const n = list.length, out = new Array(n).fill(null);
  const view = list.map(sceneView), blank = (i) => view[i] === 'blank', still = (i) => list[i]?.kind === 'still';
  const busy = list.map((s, i) => !!(primaryAct(s) && primaryAct(s) !== 'exposed') || hasTag(s, 'orgasm') || view[i] === 'offscreen' || view[i] === 'internal');
  const quiet = (i) => !busy[i] && (still(i) || !!list[i].describe);
  const sex = list.some((s) => hasTag(s, 'orgasm') || sceneWheres(s).length || sceneWhats(s).some((t) => SEX_WHATS.has(t)));
  const first = busy.indexOf(true), last = busy.lastIndexOf(true);
  if (first < 0) {
    for (let i = 0; i < n && (blank(i) || still(i)); i++) if (!blank(i)) out[i] = 'intro';
    for (let i = n - 1; i >= 0 && (blank(i) || still(i)) && !out[i]; i--) if (!blank(i)) out[i] = 'outro';
    return out;
  }
  for (let i = 0; i < first; i++) { if (blank(i)) continue; if (!quiet(i)) break; out[i] = 'intro'; }
  for (let i = last + 1; i < n; i++) if (!blank(i) && quiet(i)) out[i] = still(i) || nobody(list[i]) || !sex ? 'outro' : 'after';
  return out;
}
const STRUCTURED = new WeakMap();
/** The list with each scene's `structure` = structureAuto's (derived, recomputed for every new list: a stored one is
 *  ignored; dropped when null). `by` = the same scenes as the readers see them (mods.js withMods: an orgasm modifier makes
 *  a scene busy) when `list` is the stored one. Same list when nothing changes; cached per (list, by). */
export function withStructure(list, by = list) {
  if (!Array.isArray(list) || !list.length) return list;
  const c = STRUCTURED.get(list);
  if (c && c.by === by) return c.r;
  const auto = structureAuto(by);
  const r = list.some((s, i) => (s.structure ?? null) !== auto[i]) ? list.map((s, i) => {
    if ((s.structure ?? null) === auto[i]) return s;
    const { structure, ...rest } = s;   // eslint-disable-line no-unused-vars
    return auto[i] ? { ...rest, structure: auto[i] } : rest;
  }) : list;
  STRUCTURED.set(list, { by, r });
  if (r !== list && by === list) STRUCTURED.set(r, { by: r, r });   // its own output, read the same way: as it is
  return r;
}
/** Does the scene have a tag that needs a where, and no where? (The quick bar asks; nothing guesses.) */
export const needsWhere = (scene) => !sceneWheres(scene).length && sceneTags(scene).some((t) => TAG[t].needsWhere);

/** The scene's acts as words: {aliases: [alias words whose components are all on, a where used once], wheres, whats: the
 *  rest}. A what may serve several aliases (anal + vaginal + oral + penetration = double penetration + fellatio). */
export function actWords(scene) {
  const on = new Set(sceneTags(scene)), usedWhere = new Set(), usedWhat = new Set(), aliases = [];
  for (const w of MAIN_ALIASES) {
    const parts = ALIASES[w];
    if (!parts.every((p) => on.has(p)) || parts.some((p) => TAG[p].cat === 'where' && usedWhere.has(p))) continue;
    aliases.push(w);
    for (const p of parts) (TAG[p].cat === 'where' ? usedWhere : usedWhat).add(p);
  }
  return { aliases, wheres: sceneWheres(scene).filter((t) => !usedWhere.has(t)), whats: sceneWhats(scene).filter((t) => !usedWhat.has(t)) };
}
/** The act as words: 'rimming', 'anal + vaginal licking', 'fellatio + anal penetration' ('' = none). A where left
 *  over after the aliases reads with every what. */
export function actText(scene) {
  const { aliases, wheres, whats } = actWords(scene);
  const rest = whats.length ? whats : wheres.length ? sceneWhats(scene) : [];
  const own = [wheres.map(tagLabel).join(' + '), rest.map(tagLabel).join(' + ')].filter(Boolean).join(' ');
  return [...aliases, ...(own ? [own] : [])].join(' + ');
}
export const tagLabel = (id) => TAG[id]?.label ?? id;
export const tagColor = (id) => kindOf(TAG[id]?.kind ?? (TAG[id] ? 'penetration' : 'custom')).color;

/** The scene.tags that toggling `id` (a tag, or an alias: its components) writes. A tag: '-id' when the scene has it,
 *  else 'id' (replacing the user's other tag of a one-tag category: one view, one camera); on adds what it implies, off drops the tags that
 *  imply it. An alias: on adds its missing components; off removes those no other shown alias uses. Always explicit, so
 *  the call survives a re-describe. */
export function toggleTag(scene, id) {
  const parts = aliasParts(id);
  if (parts) {
    const on = !parts.every((p) => hasTag(scene, p)), others = actWords(scene).aliases.filter((w) => w !== id && w !== ALIASES[id]).flatMap((w) => ALIASES[w]);
    let s = scene;
    for (const p of parts) if (hasTag(s, p) !== on && (on || !others.includes(p))) s = { ...s, tags: toggleTag(s, p) };
    return s?.tags;
  }
  if (!TAG[id] || TAG[id].cat === 'modifier') return scene?.tags;   // a modifier is made on the Modifiers row (commands-mods)
  const on = !hasTag(scene, id), one = on && ONE.has(TAG[id].cat);
  let s = { ...scene, tags: [...(scene?.tags || []).filter((t) => idOf(t).replace(/^-/, '') !== id && !(one && TAG[idOf(t)]?.cat === TAG[id].cat)), on ? id : '-' + id] };
  if (on) for (const p of TAG[id].implies || []) if (!hasTag(s, p)) s = { ...s, tags: toggleTag(s, p) };
  if (!on) for (const t of sceneTags(s)) if (TAG[t].implies?.includes(id)) s = { ...s, tags: toggleTag(s, t) };
  return s.tags;
}

// ---- time inside a scene: a tag may start / end within it ----
const clip = (scene, t) => Math.max(scene.start_ms, Math.min(scene.end_ms, t));
/** The span {t0, t1} (ms) a tag covers in the scene: its own entry's t0 / t1 clipped to the scene, else the whole scene;
 *  null when the scene does not have the tag. */
export function tagSpan(scene, id) {
  return tagSpansIn(scene, id)[0] ?? null;
}
/** Every span {t0, t1} (ms, clipped to the scene) the tag covers there, in time order: its entries with times that meet
 *  the scene (a modifier may have several, paw-8qb), else the whole scene; [] when the scene does not have it. */
export function tagSpansIn(scene, id) {
  if (!hasTag(scene, id)) return [];
  const es = (scene.tags || []).filter((x) => typeof x === 'object' && x?.id === id);
  const out = es.map((e) => ({ t0: clip(scene, e.t0 ?? scene.start_ms), t1: clip(scene, e.t1 ?? scene.end_ms) })).filter((s) => s.t1 > s.t0).sort((a, b) => a.t0 - b.t0);
  return out.length ? out : es.length && !autoTags(scene).includes(id) ? [] : [{ t0: scene.start_ms, t1: scene.end_ms }];
}
/** Is the tag's span narrower than the scene? */
export const partial = (scene, id) => { const sp = tagSpan(scene, id); return !!sp && (sp.t0 > scene.start_ms || sp.t1 < scene.end_ms); };
/** The tags on at time t (ms) in the scene: its tags whose span covers t (t0 <= t < t1). */
export const tagsAt = (scene, t) => sceneTags(scene).filter((id) => { const sp = tagSpan(scene, id); return !!sp && t >= sp.t0 && t < sp.t1; });
function setEdge(scene, id, key, t) {
  if (!hasTag(scene, id) || ONE.has(TAG[id].cat)) return scene?.tags;
  const own = scene.tags || [], e = own.find((x) => typeof x === 'object' && x?.id === id) ?? { id };
  const edge = key === 't0' ? scene.start_ms : scene.end_ms, v = t == null ? edge : Math.round(clip(scene, t));
  const n = { ...e, [key]: v };
  if (v === edge) delete n[key];
  const sp = { t0: n.t0 ?? scene.start_ms, t1: n.t1 ?? scene.end_ms };
  if (!(sp.t1 > sp.t0)) return scene.tags;   // refused: the tag would be empty
  return [...own.filter((x) => idOf(x) !== id), n.t0 == null && n.t1 == null ? id : n];
}
/** The scene.tags with tag `id` starting / ending at t (null = the scene's edge); unchanged when that would empty it. */
export const setTagStart = (scene, id, t) => setEdge(scene, id, 't0', t);
export const setTagEnd = (scene, id, t) => setEdge(scene, id, 't1', t);

// ---- migration: the one-kind model ({kind, sub, view} overrides) and renamed tag ids -> tags ----
/** Saved tag ids that were renamed or split into where + what ('-id' expands to '-' each, a span goes to each). */
const RENAMED = { sex: ['penetration'], rimming: ['anal', 'licking'] };
const FROM_SUB = { anal: ['anal', 'penetration'], vaginal: ['vaginal', 'penetration'], oral: ['oral', 'penetration'], double: ['anal', 'vaginal', 'penetration'],
  penetration: ['oral', 'penetration'] };   // others: sub id = what id (masturbation is its own what)
const DEFAULT_ACT = { penetration: ['penetration'], oral: ['oral', 'penetration'] };
/** Detect scenes' scene.kind values (pawtrack scenes.py): not an old one-kind override. */
const SHOT_KINDS = new Set(['blank', 'still']);
const renamed = (e) => {
  const m = typeof e === 'string' && e[0] === '-' ? '-' : '', id = idOf(e).slice(m.length);
  return (RENAMED[id] ?? [id]).map((x) => (typeof e === 'string' ? m + x : { ...e, id: x }));
};
/** A scene with old ids or the old overrides -> the same scene with `tags` (same object when it has neither). kind knotting
 *  / orgasm / offscreen -> that tag; kind + sub -> where + what, the describe's other acts removed (the user said what it
 *  is); view 'internal' -> 'internal', '' -> '-internal'. `continues` stays; plain strings and spans pass through. */
export function migrateScene(s) {
  if (s?.tags?.some((e) => RENAMED[idOf(e)?.replace(/^-/, '')])) s = { ...s, tags: s.tags.flatMap(renamed).filter((e, i, a) => a.findIndex((x) => JSON.stringify(x) === JSON.stringify(e)) === i) };
  const oldKind = s?.kind != null && !SHOT_KINDS.has(s.kind);
  if (!s || (!oldKind && s.sub == null && s.view == null)) return s;
  const { kind: k0, sub, view, ...rest0 } = s, kind = oldKind ? k0 : null, rest = oldKind || k0 == null ? rest0 : { ...rest0, kind: k0 };
  const auto = tagsOf(s.describe), own = [...(s.tags || [])];
  if (TAG[kind]?.cat === 'modifier' || kind === 'offscreen') own.push(kind);
  let acts = sub ? (FROM_SUB[sub] ?? [sub]).filter(isAct) : [];
  if (!acts.length && kind && actKind({ describe: s.describe }) !== kind) acts = DEFAULT_ACT[kind] ?? [];
  if (acts.length) own.push(...acts, ...auto.filter((t) => isAct(t) && !acts.includes(t)).map((t) => '-' + t));
  if (view === 'internal') own.push('internal');
  else if (view === '') own.push('-internal');
  return own.length ? { ...rest, tags: [...new Set(own)] } : rest;
}

// ---- suggestions: a where with no what (or a what that needs a where, with none) -> ghost chips in the quick bar ----
export const WHERE_WHATS = new Set(['penetration', 'tonguefucking', 'licking', 'fisting', 'toy', 'tailpen', 'fingering']);   // whats that happen *in* a where
const FALLBACK = { what: ['penetration', 'fingering', 'licking', 'toy'], where: ['anal', 'vaginal', 'oral', 'slit', 'sheath'] };
const MIN_HINT = 0.1;   // ponytail: tagger scores under this are noise for a hint; tune if hints miss obvious acts
const namesOf = (t) => [...(t?.names || []), ...(t?.umbrella || [])];
const gives = (t, n) => namesOf(t).some((p) => hit(p, n));
const realWhats = (s) => sceneWhats(s).filter((t) => t !== 'exposed');   // exposed = dick out, no act: not an answer to "what"
/** The describe's best score for tag `id` at any score (MIN_SCORE is what auto-tags; this is a hint): a label that gives
 *  it (its names / umbrella, an alias word with it as a part: rimming -> licking, a tag that implies it: anal_knotting ->
 *  penetration). With `where`, a label naming only another where (vaginal_fingering for anal) does not count. */
function confFor(describe, id, where) {
  let best = 0;
  for (const { tag: n, score } of describe?.tags || []) {
    if (!(score > best) || typeof n !== 'string') continue;
    const ok = gives(TAG[id], n) || (aliasParts(n.replace(/_/g, ' ')) ?? []).includes(id) || TAGS.some((t) => t.implies?.includes(id) && gives(t, n));
    const elsewhere = where && !gives(TAG[where], n) && TAGS.some((t) => t.cat === 'where' && t.id !== where && gives(t, n));
    if (ok && !elsewhere) best = score;
  }
  return best;
}
/** Ranked ids of category `cat` for scene: (a) the tagger's confidence (confFor), then (b) how many other scenes of the
 *  list pair one of `keys` with it, then (c) FALLBACK order. Ids without evidence and not in FALLBACK are left out. */
function rank(scene, all, describe, cat, keys, pairOf) {
  const others = (all || []).filter((s) => s !== scene && pairOf(s).some((k) => keys.includes(k)));
  const ids = TAGS.filter((t) => t.cat === cat && !t.fallback && tagShown(t.id)).map((t) => t.id), fb = FALLBACK[cat];   // paw-43vn: never suggests a tag furry items off does not offer
  return ids.map((id) => {
    const conf = Math.max(...(cat === 'what' ? keys : [undefined]).map((w) => confFor(describe, id, w)));
    const n = others.filter((s) => ofCat(s, cat).includes(id)).length, f = fb.indexOf(id);
    return { id, conf: conf >= MIN_HINT ? conf : 0, n, f: f < 0 ? Infinity : f };
  }).filter((x) => x.conf || x.n || x.f < Infinity)
    .sort((a, b) => b.conf - a.conf || b.n - a.n || a.f - b.f)
    .map(({ id, conf, n }) => ({ id, why: conf ? `tagger ${conf.toFixed(2)}` : n ? `${n} other scene${n === 1 ? '' : 's'}` : 'common' }));
}
/**
 * The "what" chips to offer for a scene with a where and no what (exposed does not count): up to 3 [{id, why}], best
 * first (rank: the describe's labels, then this project's other scenes with the same where, then penetration,
 * fingering, licking, toy). [] when the scene already has a what or has no where.
 */
export function suggestWhat(scene, allScenes = [], describe = scene?.describe) {
  const wh = sceneWheres(scene);
  if (!scene || !wh.length || realWhats(scene).length) return [];
  return rank(scene, allScenes, describe, 'what', wh, sceneWheres).slice(0, 3);
}
/** The other way: a what that happens in a where (penetration, licking, fingering, toy, fisting, tonguefucking; or any
 *  needsWhere tag) and no where -> up to 3 [{id, why}] wheres, same ranking (fallback anal, vaginal, oral). */
export function suggestWhere(scene, allScenes = [], describe = scene?.describe) {
  const wt = realWhats(scene);
  if (!scene || sceneWheres(scene).length || !(wt.some((t) => WHERE_WHATS.has(t)) || needsWhere(scene))) return [];
  return rank(scene, allScenes, describe, 'where', wt, realWhats).slice(0, 3);
}

// ---- span labels from the tags (the sidecar's track `spans`: idle holds, carry carries the rhythm, climax keeps the
// fast strokes; trackers/PROTOCOL.md) ----
/**
 * The spans Track sends, derived from the scenes' tags: a structure tag (intro / idle / after / outro) or a blank view
 * -> idle, an idle span over part of a shot -> idle there; off-screen on a scene that is part of a continuation (it continues, or is a cutaway inside one: `conts` =
 * lib/scenes-continue.js continuations) -> carry; the orgasm tag's span -> climax (over the scene's own state). Any
 * other scene gets no label: active, the sidecar's motion gate decides (a label would override it). `manual` spans
 * (the old Span labels, still in some projects) win where they overlap. -> [{start_ms, end_ms, state}] sorted.
 */
export function tagSpans(list = [], conts = [], manual = []) {
  const cut = new Set(conts.flatMap((c) => Array.from({ length: c.b1 - c.b0 + 1 }, (_, k) => c.b0 + k)));
  let out = [];
  list.forEach((s, i) => {
    const v = sceneView(s);
    const inScene = s.join === true || list[i + 1]?.join === true;   // an off-screen shot of a multi-shot scene: the act goes on
    const st = sceneStructure(s) || v === 'blank' ? 'idle' : v === 'offscreen' && (s.continues || cut.has(i) || inScene) ? 'carry' : '';
    if (st) out = addSpan(out, { start_ms: s.start_ms, end_ms: s.end_ms, state: st });
    for (const e of s.tags || []) if (e?.id === 'idle' && Number.isFinite(e.t0)) {   // an idle span over part of the shot (paw-d8u): held there
      const a = Math.max(s.start_ms, e.t0), b = Math.min(s.end_ms, e.t1);
      if (b > a) out = addSpan(out, { start_ms: a, end_ms: b, state: 'idle' });
    }
    for (const o of tagSpansIn(s, 'orgasm')) out = addSpan(out, { start_ms: o.t0, end_ms: o.t1, state: 'climax' });   // every orgasm span (paw-8qb)
  });
  for (const m of manual) out = addSpan(out, m);
  return out;
}
