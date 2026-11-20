// paw-wfd2.3: the device's condition for the status bar's health slot (lib/health.js)
import { playbackFor } from './playback.svelte.js';

export default [
  // a linked device left or stopped answering (never when none was ever started)
  { id: 'playback.lost', pri: 1.5, read: (app) => {
    const P = playbackFor(app);
    return P.lost ? { tone: 'bad', text: 'Device not responding', tip: P.lost, action: { label: 'Reconnect', run: () => P.reconnect() } } : null;
  } },
];
