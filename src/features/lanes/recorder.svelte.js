// recorder.svelte.js -- recording mode. LIVE: one sample per animation frame while playing from the mouse over the
// lane, plus one sample per number key (after a key the mouse is ignored until it moves, so a key press is not
// smeared into a hold); the samples are RDP-fitted. TAP: number keys / ArrowUp / ArrowDown drop points at the playhead.
// State is lanes(app).rec (see state.svelte.js); the lane overlay reads rec.samples every frame.
import { replaceRange } from '../../lib/core/script.js';
import { lanes } from './state.svelte.js';
import { yToPos } from './geom.js';
import { gridOf } from '../../lib/lane.js';
import { recordingToScript } from './cmdlogic.js';
import { pushSample } from './record.js';
import { scriptOf } from '../../lib/script-of.js';   // paw-x7w7: baked + live

const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(() => f(performance.now()), 16);
const caf = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;
const running = new WeakMap();   // app -> { dispose, frame, lastHover }

const now = (app) => app.player.timeMs - lanes(app).latency;

/** Start recording on the focused lane. mode 'live' | 'tap'. Returns false if refused. */
export function startRecording(app, mode = 'live') {
  const L = lanes(app), axis = app.doc.activeAxis;
  if (L.rec) stopRecording(app, { commit: false });
  if (!L.editable(axis)) { app.toast(axis + ' is not editable (locked or another lane is solo)', 'quiet'); return false; }
  const r = { dispose: null, frame: 0, lastHover: L.hover };
  running.set(app, r);
  L.rec = { mode, axis, t0: Math.round(app.player.timeMs), samples: [], keyPos: null };
  if (!app.player.playing) app.player.play();

  // stop (and commit) when playback pauses or ends
  let was = app.player.playing;
  r.dispose = $effect.root(() => {
    $effect(() => {
      const p = app.player.playing;
      if (was && !p) queueMicrotask(() => { if (running.get(app) === r) stopRecording(app); });   // outside the effect
      was = p;
    });
  });

  if (mode === 'live') {
    const tick = () => {
      const rec = L.rec;
      if (!rec || running.get(app) !== r) return;
      if (app.player.playing) {
        const h = L.hover;
        if (h !== r.lastHover) { r.lastHover = h; if (h?.axis === rec.axis) rec.keyPos = null; }   // the mouse moved: it drives again
        if (typeof rec.keyPos !== 'number' && h?.axis === rec.axis && h.h > 0) pushSample(rec.samples, { t: now(app), pos: Math.max(0, Math.min(100, yToPos(h.h, h.y))) });
      }
      r.frame = raf(tick);
    };
    r.frame = raf(tick);
  }
  app.toast(mode === 'tap' ? `Tap recording on ${axis}: number keys, Up = 100, Down = 0, R or pause finishes, Esc discards` : `Recording ${axis}: mouse over the lane or number keys, R or pause finishes, Esc discards`, 'quiet', { timeout: 3000 });
  return true;
}

/** A number key (or Up/Down in tap mode) while recording: a sample at the playhead now. Live: the mouse pauses until it moves. */
export function recordKey(app, pos) {
  const L = lanes(app), rec = L.rec;
  if (!rec) return;
  pushSample(rec.samples, { t: now(app), pos });
  if (rec.mode === 'tap') return;
  rec.keyPos = pos;
  const r = running.get(app);
  if (r) r.lastHover = L.hover;
}

/** End recording. commit: replace the recorded span on the axis with the result (one undo step) and select it. */
export function stopRecording(app, { commit = true } = {}) {
  const L = lanes(app), rec = L.rec, r = running.get(app);
  if (r) { caf(r.frame); r.dispose?.(); running.delete(app); }
  if (!rec) return;
  L.rec = null;
  if (!commit) { app.toast('Recording discarded', 'quiet'); return; }
  const pts = recordingToScript(rec, { eps: +app.settings.get('lanes.recEps', 4) || 4, frameMs: L.snap.frames ? gridOf(app.player) : 0 });
  if (!pts.length) { app.toast('Nothing recorded', 'quiet'); return; }
  if (!L.editable(rec.axis)) { app.toast(rec.axis + ' is locked, recording discarded', 'warn'); return; }
  const s = scriptOf(app, rec.axis);
  app.transact('Record', () => { app.edit('Record', rec.axis, replaceRange(s, pts[0].at, pts[pts.length - 1].at, pts)); app.select(pts.map((a) => a.at), rec.axis); });
  app.toast(`Recorded ${pts.length} point${pts.length === 1 ? '' : 's'}`, 'quiet');
}
