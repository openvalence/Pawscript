// Fix a goofed section (menu Edit → Fix). Each works on the I/O range, else the selected points' span; one undo step each.
// Keys: the free Alt+Shift letters (checked against app.commands.conflicts() in dev/fix-drive.mjs).
import { fixUI, flip, scale, retime, regenerate, retrack } from './fix.svelte.js';
import { openDialog } from '../inspector/dialogs.js';
import { parseTime } from '../inspector/logic.js';

const fps = (app) => 1000 / (app.player?.frameMs || 1000 / 30);
const num = (s) => parseFloat(String(s).replace(',', '.'));
const ms = (app) => (s) => { const t = String(s).trim(), neg = /^[-−]/.test(t); const v = parseTime(t.replace(/^[-+−]/, ''), { fps: fps(app) }); return neg ? -v : v; };
let lastFactor = 0.8;

export default [
  { id: 'fix.panel', title: 'Fix section…', keys: ['Alt+Shift+X'], menu: 'Edit', group: 'fix', run: (app) => { app.showPanel?.('fix'); fixUI.focusPicker++; } },
  { id: 'fix.retrack', title: 'Fix: re-track the range', keys: ['Alt+Shift+T'], menu: 'Edit', group: 'fix', run: (app) => retrack(app) },
  { id: 'fix.regenerate', title: 'Fix: regenerate the range', keys: ['Alt+Shift+G'], menu: 'Edit', group: 'fix',
    // args {recipe}: run now. No args: with the panel in view, regenerate with its recipe; else show it with the picker focused
    run: (app, a) => {
      if (a?.recipe) return regenerate(app, a.recipe);
      if (fixUI.shown) return regenerate(app);
      app.showPanel?.('fix'); fixUI.focusPicker++;
      app.toast(`Pick a recipe, then press ${app.commands.keysFor('fix.regenerate')[0] || 'the key'} again`, 'quiet');
    } },
  { id: 'fix.flip', title: 'Fix: flip direction in the range', keys: ['Alt+Shift+F'], menu: 'Edit', group: 'fix', run: (app) => flip(app) },
  { id: 'fix.scale', title: 'Fix: scale depth in the range…', keys: ['Alt+Shift+D'], menu: 'Edit', group: 'fix',
    run: (app, a) => {
      if (Number.isFinite(a?.factor)) return scale(app, a.factor);
      openDialog({ title: 'Scale depth in the range', ok: 'Scale', note: 'About the out end (pos 100): below 1 = shallower, above 1 = deeper.',
        fields: [{ key: 'f', label: 'Factor', value: String(lastFactor), kind: 'factor', hint: '0.8 · 1.25', parse: num }],
        onsubmit: ({ f }) => { if (!(f > 0 && f <= 5)) return 'Factor must be between 0 and 5'; lastFactor = f; scale(app, f); } });
    } },
  { id: 'fix.retime', title: 'Fix: retime inside the range…', keys: ['Alt+Shift+E'], menu: 'Edit', group: 'fix',
    run: (app, a) => {
      if (a && (Number.isFinite(a.dt) || Number.isFinite(a.factor))) return retime(app, { dt: a.dt || 0, factor: a.factor || 1 });
      openDialog({ title: 'Retime inside the range', ok: 'Retime', note: 'The first and last points keep their times; nothing crosses them.',
        fields: [{ key: 'dt', label: 'Shift', value: '0', kind: 'time', hint: '+40 · -33 · f2', parse: ms(app) },
          { key: 'f', label: 'Stretch', value: '1', kind: 'factor', hint: '1 = none · 0.9 · 1.1', parse: num }],
        onsubmit: ({ dt, f }) => { if (!(f > 0 && f <= 5)) return 'Stretch must be between 0 and 5'; retime(app, { dt, factor: f }); } });
    } },
];
