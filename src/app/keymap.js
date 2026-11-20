// keymap.js -- key chords: parse, normalise, match events and sequences, find conflicts. Pure (test/app-keymap.test.mjs).
//
// A chord is 'Ctrl+Alt+Shift+Meta+Key' with modifiers in that order and one canonical key name; a binding is
// one chord or a space-separated sequence ('G G'). Digits and punctuation are read from the physical key
// (event.code) so Shift+1 is 'Shift+1', not '!'; '?' is written 'Shift+/' (shown as '?').

const MODS = ['Ctrl', 'Alt', 'Shift', 'Meta'];
const ALIAS = {
  esc: 'Escape', escape: 'Escape', del: 'Delete', delete: 'Delete', ins: 'Insert', insert: 'Insert', space: 'Space', ' ': 'Space',
  spacebar: 'Space', enter: 'Enter', return: 'Enter', tab: 'Tab', backspace: 'Backspace', home: 'Home', end: 'End',
  pageup: 'PageUp', pagedown: 'PageDown', pgup: 'PageUp', pgdn: 'PageDown',
  left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown',
  arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown',
  '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown',
  control: 'Ctrl', ctrl: 'Ctrl', cmd: 'Meta', meta: 'Meta', win: 'Meta', super: 'Meta', option: 'Alt', alt: 'Alt', shift: 'Shift',
};
// keys typed with Shift on a US layout -> the physical key + Shift
const SHIFTED = { '?': '/', '<': ',', '>': '.', ':': ';', '"': "'", '{': '[', '}': ']', '|': '\\', '_': '-', '+': '=', '~': '`',
  '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0' };
const CODE = { Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', NumpadEnter: 'Enter', NumpadDecimal: '.', NumpadAdd: '=',
  NumpadSubtract: '-', NumpadMultiply: '8', NumpadDivide: '/' };

function keyName(k) {
  const a = ALIAS[k.toLowerCase()];
  if (a) return a;
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(k)) return k.toUpperCase();
  if (k.length === 1) return k.toUpperCase();
  return k[0].toUpperCase() + k.slice(1);
}

/** One chord string -> canonical form, or null if it is not a chord. 'ctrl+shift+z' -> 'Ctrl+Shift+Z', '?' -> 'Shift+/'. */
export function parseChord(s) {
  s = String(s).trim();
  if (!s) return null;
  let parts = s.split('+');
  if (s.endsWith('++')) parts = [...s.slice(0, -2).split('+').filter(Boolean), '+'];
  else if (s === '+') parts = ['+'];
  const mods = new Set();
  let key = null;
  for (const raw of parts) {
    if (!raw) return null;
    const n = keyName(raw);
    if (MODS.includes(n)) { mods.add(n); continue; }
    if (key) return null;
    key = n;
  }
  if (!key) return null;
  if (SHIFTED[key]) { mods.add('Shift'); key = SHIFTED[key]; }
  return [...MODS.filter((m) => mods.has(m)), key].join('+');
}

/** A binding ('G G', 'Ctrl+K Ctrl+S') -> canonical string, or null. */
export function parseKeys(s) {
  const chords = String(s).trim().split(/\s+/).map(parseChord);
  return chords.length && chords.every(Boolean) ? chords.join(' ') : null;
}

/** A keydown event -> canonical chord, or null for a lone modifier. */
export function eventChord(e) {
  const c = e.code || '';
  let key;
  if (/^Key[A-Z]$/.test(c)) key = /^[a-z]$/i.test(e.key) ? e.key.toUpperCase() : c[3];
  else if (/^Digit\d$/.test(c)) key = c[5];
  else if (/^Numpad\d$/.test(c)) key = c[6];
  else if (CODE[c]) key = CODE[c];
  else {
    if (!e.key || ['Control', 'Shift', 'Alt', 'Meta', 'OS', 'AltGraph', 'Dead', 'Unidentified', 'Process'].includes(e.key)) return null;
    key = keyName(e.key);
    if (SHIFTED[key]) key = SHIFTED[key];
  }
  const m = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean);
  return [...m, key].join('+');
}

/** paw-5zpf: a NumPad digit's own chord ('Num5', 'Ctrl+Num5'), or null for any other key. eventChord reads it as the plain digit;
 *  the registry tries this one first, so a binding on 'Num5' (the Blender keymap's point placement) beats the number row's '5'. */
export function numpadChord(e) {
  if (!/^Numpad\d$/.test(e.code || '')) return null;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta', 'Num' + e.code[6]].filter(Boolean).join('+');
}

const PRETTY = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', Delete: 'Del', PageUp: 'PgUp', PageDown: 'PgDn' };
const UNSHIFT = Object.fromEntries(Object.entries(SHIFTED).filter(([s]) => !/[!@#$%^&*()]/.test(s)).map(([s, k]) => [k, s]));
/** Display form: 'Shift+/' -> '?', 'Ctrl+ArrowLeft' -> 'Ctrl+←', sequences keep their space. */
export function fmtKeys(s) {
  return String(s).split(' ').map((ch) => {
    const p = ch.split('+'), k = p.pop();
    if (p.length === 1 && p[0] === 'Shift' && UNSHIFT[k]) return UNSHIFT[k];
    return [...p, PRETTY[k] || k].join('+');
  }).join(' ');
}

/** Chords a text field keeps for itself even though they carry a modifier. */
const TEXT_OWNED = new Set(['Ctrl+A', 'Ctrl+C', 'Ctrl+V', 'Ctrl+Shift+V', 'Ctrl+Alt+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z', 'Ctrl+Shift+Delete', 'Ctrl+ArrowLeft', 'Ctrl+ArrowRight',
  'Ctrl+Shift+ArrowLeft', 'Ctrl+Shift+ArrowRight', 'Ctrl+Backspace', 'Ctrl+Delete', 'Ctrl+Home', 'Ctrl+End', 'Ctrl+Shift+Home', 'Ctrl+Shift+End']);
/** May this chord fire a command while focus is in a text field? Esc always; F-keys; modifier chords the field does not own. */
export function allowedWhileTyping(chord) {
  if (chord === 'Escape' || /(^|\+)F\d+$/.test(chord)) return true;
  if (!/^(Ctrl|Alt|Meta)\+/.test(chord)) return false;
  return !TEXT_OWNED.has(chord);
}

/**
 * Matches chords against bindings. bindings: [[commandId, 'Keys'], ...] in priority order.
 * feed(chord, t) -> {ids} (complete; ids in priority order) | {pending, ids} (a prefix of a longer sequence;
 * ids = what this prefix alone would run if nothing follows) | null.
 */
export class Matcher {
  constructor(bindings = [], timeout = 1000) { this.timeout = timeout; this.buf = []; this.at = 0; this.set(bindings); }
  set(bindings) {
    this.exact = new Map(); this.prefix = new Set(); this.buf = [];
    for (const [id, keys] of bindings) {
      const k = parseKeys(keys);
      if (!k) continue;
      if (!this.exact.has(k)) this.exact.set(k, []);
      if (!this.exact.get(k).includes(id)) this.exact.get(k).push(id);
      const ch = k.split(' ');
      for (let i = 1; i < ch.length; i++) this.prefix.add(ch.slice(0, i).join(' '));
    }
  }
  reset() { this.buf = []; }
  feed(chord, t = Date.now()) {
    if (this.buf.length && t - this.at > this.timeout) this.buf = [];
    this.at = t;
    let seq = [...this.buf, chord].join(' ');
    if (this.buf.length && !this.exact.has(seq) && !this.prefix.has(seq)) { this.buf = []; seq = chord; }   // broken sequence: start over with this chord
    if (this.prefix.has(seq)) { this.buf = seq.split(' '); return { pending: true, ids: this.exact.get(seq) || [] }; }
    this.buf = [];
    const ids = this.exact.get(seq);
    return ids ? { ids } : null;
  }
}

/** Bindings that collide: the same keys on several commands, or keys that are a prefix of another binding. */
export function conflicts(bindings) {
  const by = new Map();
  for (const [id, keys] of bindings) { const k = parseKeys(keys); if (k) by.set(k, [...new Set([...(by.get(k) || []), id])]); }
  const out = [];
  for (const [k, ids] of by) if (ids.length > 1) out.push({ keys: k, ids, kind: 'same' });
  for (const [k, ids] of by) for (const [k2, ids2] of by) {
    if (k2 !== k && k2.startsWith(k + ' ')) out.push({ keys: k, ids: [...ids, ...ids2], kind: 'prefix', longer: k2 });
  }
  return out;
}
