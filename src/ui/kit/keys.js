/**
 * keys.js -- shortcut strings as the command registry writes them ('Ctrl+Shift+Z', 'Shift+ArrowLeft',
 * 'Ctrl+K Ctrl+S' for a chord) turned into display parts per platform. Pure.
 *
 * On macOS 'Ctrl' and 'Mod' mean Command (⌘), as in every cross-platform editor; write 'Control' for the
 * physical Control key (⌃). Modifiers are put in platform order: Ctrl Shift Alt Win, or ⌃ ⌥ ⇧ ⌘.
 */

const MOD_ORDER = { pc: ['Ctrl', 'Control', 'Shift', 'Alt', 'Meta'], mac: ['Control', 'Alt', 'Shift', 'Ctrl', 'Meta'] };
const ALIAS = {
  ctrl: 'Ctrl', mod: 'Ctrl', cmd: 'Ctrl', command: 'Ctrl', cmdorctrl: 'Ctrl', commandorcontrol: 'Ctrl',
  control: 'Control', shift: 'Shift', alt: 'Alt', option: 'Alt', opt: 'Alt', meta: 'Meta', win: 'Meta', super: 'Meta',
};
const MAC = { Ctrl: '⌘', Control: '⌃', Shift: '⇧', Alt: '⌥', Meta: '⌘' };
const PC = { Ctrl: 'Ctrl', Control: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Meta: 'Win' };
const KEYS = {
  arrowleft: ['←', '←'], arrowright: ['→', '→'], arrowup: ['↑', '↑'], arrowdown: ['↓', '↓'],
  left: ['←', '←'], right: ['→', '→'], up: ['↑', '↑'], down: ['↓', '↓'],
  escape: ['Esc', '⎋'], esc: ['Esc', '⎋'], enter: ['Enter', '↩'], return: ['Enter', '↩'],
  backspace: ['Backspace', '⌫'], delete: ['Del', '⌦'], del: ['Del', '⌦'], tab: ['Tab', '⇥'],
  space: ['Space', 'Space'], ' ': ['Space', 'Space'], pageup: ['PgUp', 'PgUp'], pagedown: ['PgDn', 'PgDn'],
  home: ['Home', 'Home'], end: ['End', 'End'], insert: ['Ins', 'Ins'], plus: ['+', '+'], minus: ['−', '−'],
};

export const isMac = () => typeof navigator !== 'undefined'
  && /mac|iphone|ipad/i.test(navigator.userAgentData?.platform || navigator.platform || '');

/** 'Ctrl+Shift+Z' -> [{mods:['Ctrl','Shift'], key:'Z'}]; chords are space-separated. */
export function parseShortcut(s) {
  return String(s).trim().split(/\s+/).filter(Boolean).map((combo) => {
    // A trailing '+' is the plus key itself: 'Ctrl++'.
    const parts = combo.endsWith('++') ? [...combo.slice(0, -2).split('+'), '+'] : combo === '+' ? ['+'] : combo.split('+');
    const mods = [], keys = [];
    for (const p of parts.filter((x) => x !== '')) {
      const m = ALIAS[p.toLowerCase()];
      if (m && !mods.includes(m)) mods.push(m); else if (!m) keys.push(p);
    }
    return { mods, key: keys.join('+') };
  });
}

/**
 * Display parts for a shortcut: an array of chords, each an array of key caps.
 * formatShortcut('Ctrl+Shift+Z', 'pc')  -> [['Ctrl', 'Shift', 'Z']]
 * formatShortcut('Ctrl+Shift+Z', 'mac') -> [['⇧', '⌘', 'Z']]
 */
export function formatShortcut(s, platform = isMac() ? 'mac' : 'pc') {
  const mac = platform === 'mac';
  return parseShortcut(s).map(({ mods, key }) => {
    const order = MOD_ORDER[mac ? 'mac' : 'pc'];
    const caps = [...mods].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((m) => (mac ? MAC : PC)[m]);
    if (key) {
      const k = KEYS[key.toLowerCase()];
      caps.push(k ? k[mac ? 1 : 0] : key.length === 1 ? key.toUpperCase() : key);
    }
    return caps;
  });
}

/** One string for menus and tooltips: 'Ctrl+Shift+Z' on a PC, '⇧⌘Z' on a Mac. */
export function shortcutText(s, platform = isMac() ? 'mac' : 'pc') {
  return formatShortcut(s, platform).map((c) => c.join(platform === 'mac' ? '' : '+')).join(' ');
}
