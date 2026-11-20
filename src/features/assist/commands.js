// commands.js -- the assist commands (menu Track). The answer keys only exist while the overlay is open (`when`), and
// this feature registers before lanes / tracking / the shell's core, so there they win over frame stepping, point keys
// and nudges; closed, those keys work as usual. Keys the overlay does not use but that would edit the script behind it
// (digits, Delete, Q, ...) are swallowed while it is open.
import { assistFor, peekAssist } from './assist.svelte.js';
import { guard } from '../../app/commands.js';

const isOpen = guard((app) => !!peekAssist(app)?.open, 'Open Assist first (F6)');
const KEYS = {
  ArrowLeft: 'left / first frame', ArrowRight: 'right / second frame', ArrowDown: "can't tell / skip", ArrowUp: 'previous question',
  1: 'choice 1', 2: 'choice 2', 3: 'choice 3', 4: 'choice 4', S: 'direction changes inside', Y: 'yes', N: 'no', C: 'orgasm (cum)', R: 're-track',
  Z: 'zoom to the region', Enter: 'confirm the suggestion', Tab: 'next pair', 'Shift+Tab': 'previous pair', Backspace: 'take back the last answer',
  Escape: 'leave', 'Shift+ArrowLeft': 'split: 5 back', 'Shift+ArrowRight': 'split: 5 on', Home: 'split: first', End: 'split: last',
  PageUp: 'previous question', PageDown: 'next question',
};
const SWALLOW = ['0', '5', '6', '7', '8', '9', 'Shift+0', 'Q', 'Delete', 'I', 'O', 'L', 'Shift+L', 'T', 'F', 'G', 'Shift+G', 'Space', ',', '.',
  'Shift+ArrowUp', 'Shift+ArrowDown', 'Ctrl+ArrowLeft', 'Ctrl+ArrowRight', 'Ctrl+X', 'Ctrl+V'];
const keyId = (k) => k.replace(/\+/g, '-').toLowerCase();

export default [
  { id: 'assist.open', title: 'Assist: answer the open questions', keys: ['F6'], menu: 'Track', group: 'assist', run: (app) => assistFor(app).toggle() },
  { id: 'assist.regenerate', title: 'Assist: regenerate questions', menu: 'Track', group: 'assist', run: (app) => { const a = assistFor(app); a.regenerate(); app.toast(`${a.openCount} open question${a.openCount === 1 ? '' : 's'}`, 'quiet'); } },
  { id: 'assist.next', title: 'Assist: next question', when: isOpen, run: (app) => assistFor(app).advance() },
  { id: 'assist.prev', title: 'Assist: previous question', when: isOpen, run: (app) => assistFor(app).step(-1) },
  { id: 'assist.reapply', title: 'Assist: apply recorded directions to the active axis', menu: 'Track', group: 'assist', run: (app) => assistFor(app).reapply() },
  { id: 'assist.orientGhosts', title: 'Assist: orient tracker ghosts by recorded directions', menu: 'Track', group: 'assist', run: (app) => assistFor(app).orientGhosts() },
  {
    id: 'assist.clearDecisions', title: 'Assist: forget recorded answers', menu: 'Track', group: 'assist',
    run: async (app) => { if (await app.confirm({ title: 'Forget the recorded answers?', message: 'The script keeps its edits, the questions come back', ok: 'Forget', danger: true })) assistFor(app).clearDecisions(); },
  },
  ...Object.entries(KEYS).map(([k, what]) => ({ id: 'assist.key.' + keyId(k), title: `Assist: ${what}`, keys: [k], hidden: true, when: isOpen, run: (app) => assistFor(app).press(k) })),
  { id: 'assist.swallow', title: 'Assist: (keys that would edit behind the overlay)', keys: SWALLOW, hidden: true, when: isOpen, run: () => {} },
];
