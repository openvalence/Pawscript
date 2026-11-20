// commands.js -- the video feature's commands. The shell core already owns the basic transport (Space, ← / →,
// Shift+← / →, Home/End, [ ] \, L / Shift+L loops), all routed to app.player (this feature's Player), so these
// add what the core lacks. Arrow-key commands only fire with no points selected (lanes nudge them otherwise).

import { rotateView } from './view.js';
import { focusTimeField, nextFmt, defaultProxy } from './transport.js';
import { barKey, lookKey, lookOf } from './posbar.js';
import { guard, whyOf } from '../../app/commands.js';

const P = (app) => app.player;
const video = guard((app) => !!app.player?.hasVideo, 'Open a video first');
const noSel = guard((app) => !app.doc?.selection?.ats?.size, 'Deselect the points first');
const view = (app, patch) => { app.player.view = { ...app.player.view, ...patch }; };
const ui = (app, patch) => app.player.setUi?.(patch);
const GUIDES = ['off', 'thirds', 'safe', 'both'];

export default [
  // ---- transport extras ----
  { id: 'video.back5s', title: 'Jump back 5 s', keys: ['Ctrl+ArrowLeft'], menu: 'Play', group: 'step', when: noSel, run: (app) => P(app).seek(P(app).timeMs - 5000) },
  { id: 'video.fwd5s', title: 'Jump forward 5 s', keys: ['Ctrl+ArrowRight'], menu: 'Play', group: 'step', when: noSel, run: (app) => P(app).seek(P(app).timeMs + 5000) },
  { id: 'video.back10f', title: 'Back 10 frames', keys: ['PageUp'], menu: 'Play', group: 'step', when: video, run: (app) => P(app).step(-10) },
  { id: 'video.fwd10f', title: 'Forward 10 frames', keys: ['PageDown'], menu: 'Play', group: 'step', when: video, run: (app) => P(app).step(10) },
  { id: 'video.shuttleBack', title: 'Shuttle reverse (again: faster)', keys: ['J'], menu: 'Play', group: 'shuttle', when: video, run: (app) => P(app).jkl('j') },
  { id: 'video.shuttleStop', title: 'Shuttle stop', keys: ['K'], menu: 'Play', group: 'shuttle', when: video, run: (app) => P(app).jkl('k') },
  // L is the outline's loop key (core loop.mark): forward shuttle has no default key (Space plays, ] speeds up)
  { id: 'video.shuttleFwd', title: 'Shuttle forward (again: faster)', menu: 'Play', group: 'shuttle', when: video, run: (app) => P(app).jkl('l') },
  { id: 'video.playAround', title: 'Play around playhead (preroll)', keys: ['Shift+Space'], menu: 'Play', group: 'range', when: video, run: (app) => P(app).playAround() },
  { id: 'video.playRange', title: 'Play range', keys: ['Ctrl+Space'], menu: 'Play', group: 'range', when: guard((app) => video(app) && !!app.doc.range, (app) => whyOf(app, video) || 'Set a range first (I / O)'),
    run: (app) => P(app).playRange(app.doc.range.t0, app.doc.range.t1) },
  { id: 'video.replace', title: 'Replace the video… (same footage, keeps the project)', menu: 'File', group: 'media', when: guard((app) => !!app.doc, 'Open a project first'), run: (app) => P(app).relink() },
  { id: 'video.goto', title: 'Go to time or frame (video time field)', menu: 'Play', group: 'jump', run: () => focusTimeField() },
  { id: 'video.mute', title: 'Mute / unmute', keys: ['Ctrl+M'], menu: 'Play', group: 'audio', when: video, run: (app) => P(app).toggleMute() },
  { id: 'video.volumeUp', title: 'Volume up', menu: 'Play', group: 'audio', when: video, run: (app) => P(app).setVolume(P(app).volume + 0.1) },
  { id: 'video.volumeDown', title: 'Volume down', menu: 'Play', group: 'audio', when: video, run: (app) => P(app).setVolume(P(app).volume - 0.1) },

  // ---- view ----
  { id: 'video.fit', title: 'Video: fit', menu: 'View', group: 'video', run: (app) => view(app, { mode: 'fit', panX: 0, panY: 0 }) },
  { id: 'video.fill', title: 'Video: fill', menu: 'View', group: 'video', run: (app) => view(app, { mode: 'fill', panX: 0, panY: 0 }) },
  { id: 'video.zoom100', title: 'Video: 100 % (pixel exact)', menu: 'View', group: 'video', run: (app) => view(app, { mode: '1:1', panX: 0, panY: 0 }) },
  { id: 'video.rotateLeft', title: 'Video: rotate left', menu: 'View', group: 'video', run: (app) => (app.player.view = rotateView(app.player.view, -1)) },
  { id: 'video.rotateRight', title: 'Video: rotate right', menu: 'View', group: 'video', run: (app) => (app.player.view = rotateView(app.player.view, 1)) },
  { id: 'video.flipH', title: 'Video: flip horizontally', menu: 'View', group: 'video', run: (app) => view(app, { flipH: !app.player.view.flipH }) },
  { id: 'video.flipV', title: 'Video: flip vertically', menu: 'View', group: 'video', run: (app) => view(app, { flipV: !app.player.view.flipV }) },
  { id: 'video.guides', title: 'Video: cycle guides (thirds / safe)', menu: 'View', group: 'video', run: (app) => ui(app, { guides: GUIDES[(GUIDES.indexOf(app.player.ui.guides) + 1) % GUIDES.length] }) },
  { id: 'video.hud', title: 'Video: on-video readouts', menu: 'View', group: 'video', run: (app) => ui(app, { hud: app.player.ui.hud === false }) },
  { id: 'video.sim', title: 'Device simulator', keys: ['M'], menu: 'View', group: 'video', run: (app) => ui(app, { sim: !app.player.ui.sim }) },
  // the position bar over the video (paw-rtby, PosBar.svelte); no default keys (Space is play / pause)
  { id: 'video.posBar', title: 'Position bar over the video', menu: 'View', group: 'video', run: (app) => ui(app, { posBar: !app.player.ui.posBar }) },
  // paw-4c48.8: the bar on the shaft (PosBar.svelte; its look in settings 'video.posbar.shaft:<path>'), shown with it
  { id: 'video.posBarShaft', title: 'Position bar on the shaft', menu: 'View', group: 'video', run: (app) => {
    const k = lookKey(app.doc.media?.path);
    if (!k) return;
    const l = lookOf(app.settings.get(k, null)), on = !l.on;
    app.settings.set(k, { ...l, on });
    if (on) ui(app, { posBar: true });
  } },
  { id: 'video.posBarReset', title: 'Position bar: back to its default place', menu: 'View', group: 'video', run: (app) => {
    const k = barKey(app.doc.media?.path), lk = lookKey(app.doc.media?.path);
    if (k) app.settings.set(k, null);
    if (lk) app.settings.set(lk, { on: lookOf(app.settings.get(lk, null)).on });   // the shaft bar's look too (its mode kept)
    ui(app, { posBar: true });
  } },
  // the six-axis preview over the video (paw-jyde.2, Sr6View.svelte); its place, view and exaggeration in settings 'video.sr6view'
  { id: 'video.sr6', title: 'Six-axis preview over the video', menu: 'View', group: 'video', run: (app) => ui(app, { sr6: !app.player.ui.sr6 }) },
  { id: 'video.sr6Reset', title: 'Six-axis preview: back to its default place and view', menu: 'View', group: 'video', run: (app) => {
    app.settings.set('video.sr6view', null);
    ui(app, { sr6: true });
  } },
  { id: 'video.timeFormat', title: 'Cycle time format', menu: 'View', group: 'video', run: (app) => ui(app, { timeFmt: nextFmt(app.player.ui.timeFmt) }) },

  // ---- frames out ----
  { id: 'video.copyFrame', title: 'Copy frame to clipboard', keys: ['Ctrl+Shift+C'], menu: 'Edit', group: 'frame', when: video, run: (app) => P(app).copyFrame() },
  { id: 'video.saveFrame', title: 'Save frame as PNG', menu: 'File', group: 'frame', when: video, run: (app) => P(app).saveFrame() },
  { id: 'video.scrubCacheDialog', title: 'Scrub cache…', menu: 'File', group: 'frame', run: (app) => { P(app).cacheDialog = true; } },
  // paw-m3b6: the Scrub cache dialog's job as a command (its two settings are Settings › Video & cache, and Props in the dialog)
  { id: 'video.buildScrubCache', title: 'Build scrub cache now', menu: 'File', group: 'frame', aliases: ['all-intra', 'hover scrub'],
    when: guard((app) => { const p = P(app), src = p?.media?.path || ''; const st = p?.scrubCache?.src === src ? p.scrubCache.state : ''; return !!src && st !== 'ready' && st !== 'building'; },
      (app) => (!P(app)?.media?.path ? 'Open a video first' : P(app).scrubCache?.state === 'building' ? 'It is being built' : 'This video has one')),
    run: (app) => P(app).buildScrubCache(true) },
  // paw-nydn: any video, any time (sizes: the transport's proxy menu); the tracker and the detectors keep reading the original
  { id: 'video.proxy', title: 'Make a proxy of this video (smoother playback and scrubbing)', menu: 'File', group: 'frame', when: guard((app) => !!app.doc?.media?.path && !!app.backend?.transcodePreview, (app) => (!app.doc?.media?.path ? 'Open a video first' : 'Proxies need the desktop app')), run: (app) => P(app).makeProxy() },
  { id: 'video.playProxy', title: 'Play the proxy', menu: 'File', group: 'frame', when: guard((app) => !P(app)?.proxyH && Object.keys(P(app)?.proxies || {}).length > 0, (app) => (P(app)?.proxyH ? 'Already playing the proxy' : 'Make a proxy first')),
    run: (app) => P(app).useProxy(defaultProxy(Object.keys(P(app).proxies).map(Number).sort((a, b) => b - a), app.settings.get('video.proxyHeight'))) },
  { id: 'video.playOriginal', title: 'Play the original', menu: 'File', group: 'frame', when: guard((app) => !!P(app)?.proxyH, 'Already playing the original'), run: (app) => P(app).useProxy(0) },
];
