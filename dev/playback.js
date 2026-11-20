// dev/playback.js -- harness for src/features/playback: the whole shell on the in-memory mock backend, a 60 s
// synthetic clip and a fake device bridge (src/features/playback/bridge.js fakeBridge: one stroker, one vibrator).
// Vite on port 5680:  npx vite --port 5680 --strictPort   then /dev/playback.html
// Query: ?theme=light   ?scan=ms (fake scan delay, default 300)
// window.H = { app, P (the Playback store), F (the fake bridge: F.log = every linear command {t, index, feature,
// position, ms}, F.stops, F.drop(index)) } for dev/playback-drive.mjs.
import '../src/ui/kit/theme.css';
import '../src/style.css';
import { mount } from 'svelte';
import Shell from '../src/app/Shell.svelte';
import { bootApp } from '../src/app/boot.js';
import { mockBackend, sampleDoc } from './mock-app.js';
import { applyLook } from '../src/app/core-commands.js';
import { playbackFor } from '../src/features/playback/playback.svelte.js';
import { fakeBridge } from '../src/features/playback/bridge.js';

const q = new URLSearchParams(location.search);
const F = fakeBridge({ scanDelayMs: +(q.get('scan') ?? 300) });
const app = bootApp({ backend: { ...mockBackend(), mediaUrl: (p) => p }, storage: null });
const P = playbackFor(app, { bridge: F });   // before mount: the status chip would make the real one
if (q.get('theme')) { app.settings.set('ui.theme', q.get('theme')); applyLook(app); }
const d = sampleDoc({ minutes: 1, fps: 29.97 });
d.media = { path: '/dev/assets/cfr2997.mp4', name: 'cfr2997.mp4', durationMs: 60027, fps: 29.97, isVfr: false, width: 640, height: 360 };
app.load(d);
mount(Shell, { target: document.getElementById('app'), props: { app } });
window.H = { app, P, F };
window.app = app;
