// dev/shell.js -- the whole app (every discovered feature) in a plain browser, on the in-memory mock backend
// with sampleDoc() loaded. ?empty shows the welcome screen; ?mode=track|review|script picks a mode.
// Visual QA: node dev/shot.mjs http://localhost:5173/dev/shell.html out.png
import '../src/ui/kit/theme.css';
import '../src/style.css';
import { mount } from 'svelte';
import Shell from '../src/app/Shell.svelte';
import { bootApp } from '../src/app/boot.js';
import { mockBackend, sampleDoc } from './mock-app.js';

const q = new URLSearchParams(location.search);
const app = bootApp({ backend: mockBackend(), storage: null });
if (q.get('mode')) app.setMode(q.get('mode'));
if (!q.has('empty')) {
  const d = sampleDoc();
  if (q.get('video')) d.media = { ...d.media, path: q.get('video'), name: q.get('video').split('/').pop() };
  app.load(d);
}
mount(Shell, { target: document.getElementById('app'), props: { app } });
Object.defineProperty(window, 'app', { get: () => app.tabs.current, configurable: true });   // the shown tab's app (paw-shgb)
