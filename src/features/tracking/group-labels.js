// group-labels.js -- the Groups tool's name labels on the picture (paw-6m6o), pure (test/group-labels.test.mjs). With a dozen
// groups on one character every name drawn at once piled up on each other and on the masks. The label mode (setting
// tracking.groups.labels, Shift+H cycles it) says which labels are full names:
//   smart  full names for the active group, the one under the pointer and the ones that want an answer ('?': unconfirmed,
//          unassigned, suggested); every other group a short tag (shortTag: 'RS', 'LT2')
//   all    every full name (where it fits)
//   none   no labels; the name of the group under the pointer as a tip
// paw-c1m1: a label is drawn INSIDE its part (group-look.js maskStats' spot / fitLabel; GroupsOverlay drawLabels), never a hit target.
import { splitName, isUnassigned, isIgnore, whoName, whoShort, partWord } from './groups.js';

export const LABEL_MODES = ['smart', 'all', 'none'];
export const LABEL_MODE_NAMES = { smart: 'Smart', all: 'All', none: 'None' };
export const nextLabelMode = (m) => LABEL_MODES[(LABEL_MODES.indexOf(m) + 1) % LABEL_MODES.length];

// a part's tag: one or two letters, unique among the parts (with the side letter L / R in front of a paired one: 'RS' right
// shoulder, 'LT2' the second left thigh). test/group-labels.test.mjs: no two names of a character share a tag
// (no lowercase l: in Chakra Petch 'Tl' reads 'TI')
const TAG = { penis: 'P', sheath: 'Sh', balls: 'B', knot: 'K', slit: 'St', anus: 'A', hips: 'Hp', head: 'Hd', shoulder: 'S', forearm: 'F', hand: 'H',
  thighs: 'T', shin: 'Sn', paws: 'Pw', tail: 'Ta', torso: 'To', tongue: 'Tg', stomachbulge: 'Sb', neckbulge: 'Nb', body: 'Bd', other: 'O' };
/** A group name's short tag: side + part (+ its repeat number); withWho: the character's letter first (more than one painted).
 *  'unassigned_3' -> '?3', 'ignore2' -> 'Ig2'. */
export function shortTag(name, withWho = false) {
  const s = String(name || ''), rep = /\d+$/.exec(s)?.[0] || '';
  if (isUnassigned(s)) return '?' + s.slice(11);
  if (isIgnore(s)) return 'Ig' + rep;
  const { who, part, side } = splitName(s);
  const t = part === 'paws' && partWord('paws') !== 'paws' ? 'Ft' : TAG[part] || (part.slice(0, 1).toUpperCase() + part.slice(1, 2));
  return `${withWho && who ? whoShort(who) : ''}${side ? side.toUpperCase() : ''}${t}${rep}`;
}

/** A toolbar chip's tag: the character's letter, a dash, the part's tag ('c1_hand_l' -> 'B-LH'; no character: 'LH'). */
export const chipTag = (name) => { const w = splitName(name).who; return (w ? whoShort(w) + '-' : '') + shortTag(name); };

/** The one character every assigned group belongs to (its id), or null (two characters, or a group without one). */
export function sharedWho(names) {
  let w = null;
  for (const n of names) {
    if (isUnassigned(n) || isIgnore(n)) continue;
    const s = splitName(n).who;
    if (!s || (w && s !== w)) return null;
    w = s;
  }
  return w;
}
/** A label without the character's name in front ('Bottom R shoulder' -> 'R shoulder') when who is the shared one. */
export const dropWho = (text, who) => { const p = who ? whoName(who) + ' ' : ''; return p && text.startsWith(p) ? text.slice(p.length) : text; };
