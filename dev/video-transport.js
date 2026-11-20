// dev/video-transport.js -- scratch harness for Transport + Hud. ?clip=cfr2997 (dev/assets/<clip>.mp4) | none (timer clock)
//   &theme=dark|light|contrast &density=compact|default|comfortable
import '../src/ui/kit/theme.css';
import { mount } from 'svelte';
import { setTheme, setDensity } from '../src/ui/kit/tokens.js';
import { createMockApp } from './mock-app.js';
import { Player } from '../src/features/video/player.svelte.js';
import Transport from '../src/features/video/Transport.svelte';
import Hud from '../src/features/video/Hud.svelte';

const FPS = { cfr24: 24, cfr25: 25, cfr2997: 30000 / 1001, cfr30: 30, cfr60: 60, twos24: 24 };
const q = new URLSearchParams(location.search);
setTheme(q.get('theme') || 'dark'); setDensity(q.get('density') || 'default');
const clip = q.get('clip') ?? 'cfr2997';
const app = createMockApp();
app.player = new Player(app);
const video = document.querySelector('video');
if (clip !== 'none') {
  app.player.attach(video);
  app.player.load({ url: `/dev/assets/${clip}.mp4`, path: `${clip}.mp4`, name: `${clip}.mp4`, fps: FPS[clip], isVfr: clip === 'vfr' });
} else {
  video.remove();
  app.player.setDuration(app.durationMs);
}
mount(Hud, { target: document.getElementById('stage'), props: { app } });
mount(Transport, { target: document.getElementById('bar'), props: { app } });
window.app = app;
