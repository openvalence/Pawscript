// dev/palette.js -- harness for src/features/palette: the real mock app with the shell's core commands plus ours,
// both modal components mounted at the top (as the shell does) and the Shortcuts panel in a fake bottom dock.
// window.app / window.H for Playwright. Port 5201.
import '../src/ui/kit/theme.css';
import '../src/style.css';
import { mount } from 'svelte';
import { createMockApp } from './mock-app.js';
import commands from '../src/features/palette/commands.js';
import modals from '../src/features/palette/modal.js';
import panel from '../src/features/palette/panel.js';
import { ui } from '../src/features/palette/state.svelte.js';
import { fmtMs } from '../src/lib/video.js';

const app = createMockApp({ commands });
app.showPanel = (id) => { console.log('[showPanel]', id); document.getElementById('dock').scrollIntoView(); };
const ran = [];
const run = app._registry.onRun;
app._registry.onRun = (c) => { ran.push(c.id); run(c); };

for (const m of modals) mount(m.component, { target: document.getElementById('modals'), props: { app } });
mount(panel.component, { target: document.getElementById('panel'), props: { app } });

document.getElementById('open').onclick = () => app.commands.run('palette.open');
document.getElementById('help').onclick = () => app.commands.run('palette.help');

const mid = document.getElementById('mid');
(function tick() {
  mid.innerHTML = `<div>playhead <b>${fmtMs(app.player.timeMs)}</b> · view ${fmtMs(app.view.start)} + ${fmtMs(app.view.span)} · mode <b>${app.mode}</b> · selected <b>${app.doc.selection.ats.size}</b> · overlay <b>${ui.open ?? 'none'}</b></div>
    <div>last commands: <b>${ran.slice(-6).join(', ') || '—'}</b></div>
    <div>overrides: <b>${JSON.stringify(app.settings.get('keys.overrides'))}</b></div>`;
  requestAnimationFrame(tick);
})();

window.H = { app, ui, ran };
document.getElementById('out').textContent = 'ready';
