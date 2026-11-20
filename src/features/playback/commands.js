// commands.js -- device playback (menu Play, group 'device'). Shift+Esc / Pause = panic stop: `anywhere` (paw-pj8l), so it
// runs from any context: text fields, an open modal dialog, the project page; no other command shares those keys.
import { playbackFor, peekPlayback } from './playback.svelte.js';
import { guard } from '../../app/commands.js';

const P = (app) => playbackFor(app);
export default [
  { id: 'playback.toggle', title: 'Device playback on / off', keys: ['Ctrl+Alt+D'], menu: 'Play', group: 'device', run: (app) => P(app).toggle() },
  { id: 'playback.preview', title: 'Preview range on device', keys: ['Ctrl+Shift+Space'], menu: 'Play', group: 'device',
    when: guard((app) => !!peekPlayback(app)?.ready && !!P(app).previewSpan(), (app) => (!peekPlayback(app)?.ready ? 'Connect a device first' : 'Set a range or select points first')),
    run: (app) => P(app).preview() },
  { id: 'playback.panic', title: 'Panic stop (device)', keys: ['Shift+Escape', 'Pause'], menu: 'Play', group: 'device', anywhere: true, run: (app) => P(app).panic() },
  { id: 'playback.connect', title: 'Connect device / disconnect', menu: 'Play', group: 'device', run: (app) => P(app).toggleConnection() },
  // paw-m3b6: a toggle, as the Device panel's Scan / Stop scan button always was
  { id: 'playback.scan', title: 'Scan for devices / stop scanning', menu: 'Play', group: 'device', when: guard((app) => !!peekPlayback(app)?.connected, 'Connect a device first'), checked: (app) => !!peekPlayback(app)?.scanning, run: (app) => P(app).scan() },
  { id: 'playback.valence', title: 'Connect Valence hub / disconnect', menu: 'Play', group: 'device', when: guard((app) => !!peekPlayback(app)?.valence || !!app.settings.get('playback.valence.host', ''), 'Set the hub address in the Device panel first'), run: (app) => P(app).toggleValence() },
];
