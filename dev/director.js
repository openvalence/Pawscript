// dev/director.js -- harness for src/features/director: the whole shell on the in-memory mock backend, the 60 s
// synthetic clip, the director's fake sidecar world (test/director-fake-sidecar.mjs: six trace-2 style scenes, the
// director commands) and a scripted brain (test/director-mock-brain.mjs) as `rules`. Headless only, its own port:
//   npx vite --port 5197 --strictPort   then /dev/director.html
// Query: ?brain=good (default) | unsure (directions below tau: queued for you, the run escalates to assist)
//        ?redo=track (the agent asks for one track redo per span; needs ?agent=mock)
//        ?agent=mock (a scripted agent brain) | cdp (the real agent brain, answered through window.app.director)
//        ?mailbox (agent root /mailbox in the mock file system)   ?preset=rules|rules+vlm|rules+vlm+agent|ask
//        ?delay=ms per 30 tracked frames (default 2)   ?theme=light   ?mode=track|script|review
// window.H = { app, D (draft), DIR (director), FAKE, requests, brain, agent } for Playwright.
import '../src/ui/kit/theme.css';
import '../src/style.css';
import { mount } from 'svelte';
import Shell from '../src/app/Shell.svelte';
import { bootApp } from '../src/app/boot.js';
import { mockBackend, sampleDoc } from './mock-app.js';
import { draftFor } from '../src/features/draft/draft.svelte.js';
import { directorFor } from '../src/features/director/director.svelte.js';
import { applyLook } from '../src/app/core-commands.js';
import { makeFakeSidecar, WORLD } from '../test/director-fake-sidecar.mjs';
import { makeMockBrain } from '../test/director-mock-brain.mjs';

const q = new URLSearchParams(location.search);
const base = mockBackend();
const FAKE = makeFakeSidecar({ delay: +(q.get('delay') ?? 2), write: (p, b64) => base.writeText(p, b64) });
const backend = { ...base, mediaUrl: (p) => p, cancelSidecar: async () => FAKE.cancel(), sidecar: (req, h) => FAKE.sidecar(req, h) };

const app = bootApp({ backend, storage: null });
if (q.get('theme')) { app.settings.set('ui.theme', q.get('theme')); applyLook(app); }
const d = sampleDoc({ minutes: 1, fps: 29.97 });
d.media = { path: '/dev/assets/cfr2997.mp4', name: 'cfr2997.mp4', durationMs: WORLD.media.duration_ms, fps: WORLD.media.fps, isVfr: false, width: 640, height: 360 };
d.axes = { stroke: [] }; d.plan = []; d.loops = []; d.ghosts = d.ghosts.filter((g) => g.pinned);
app.load(d);
mount(Shell, { target: document.getElementById('app'), props: { app } });

const DIR = directorFor(app);
const brain = makeMockBrain({ unsure: q.get('brain') === 'unsure' ? ['direction'] : [] });
const agentMode = q.get('agent');
const agent = agentMode === 'mock' ? makeMockBrain({ id: 'agent', redoOnce: q.get('redo') ? [q.get('redo')] : [], abstain: q.get('brain') === 'unsure' ? ['direction'] : [] }) : null;
DIR.useBrains({ rules: brain, ...(agent ? { agent } : {}) });
DIR.setSettings({ preset: q.get('preset') || (agentMode ? 'rules+vlm+agent' : 'rules'), askUser: true, cdp: agentMode === 'cdp', agentRoot: q.has('mailbox') ? '/mailbox' : null, deadlineMs: 60000 });
app.history.markClean?.();
if (q.get('mode')) app.setMode(q.get('mode'));
app.showPanel('director');
window.H = { app, D: draftFor(app), DIR, FAKE, requests: FAKE.requests, brain, agent };
window.app = app;
