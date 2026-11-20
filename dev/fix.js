// dev/fix.js -- harness for src/features/fix: the whole shell on the mock backend, the 60 s synthetic clip and the
// director's fake sidecar (test/director-fake-sidecar.mjs; no GPU). Driven by dev/fix-drive.mjs (vite :5720, headless).
// window.H = { app, FAKE } for Playwright.
import '../src/ui/kit/theme.css';
import '../src/style.css';
import { mount } from 'svelte';
import Shell from '../src/app/Shell.svelte';
import { bootApp } from '../src/app/boot.js';
import { mockBackend, sampleDoc } from './mock-app.js';
import { makeFakeSidecar, WORLD } from '../test/director-fake-sidecar.mjs';

const base = mockBackend();
const FAKE = makeFakeSidecar({ delay: 1 });
const backend = { ...base, mediaUrl: (p) => p, cancelSidecar: async () => FAKE.cancel(), sidecar: (req, h) => FAKE.sidecar(req, h) };
const app = bootApp({ backend, storage: null });
const d = sampleDoc({ minutes: 1, fps: 29.97 });
d.media = { path: '/dev/assets/cfr2997.mp4', name: 'cfr2997.mp4', durationMs: WORLD.media.duration_ms, fps: WORLD.media.fps, isVfr: false, width: 640, height: 360 };
app.load(d);
mount(Shell, { target: document.getElementById('app'), props: { app } });
app.showPanel('fix');
window.H = { app, FAKE };
