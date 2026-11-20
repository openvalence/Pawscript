// player.svelte.js -- the player controller the whole app synchronises to (the shell exposes it as app.player).
// One <video> (attached by VideoPane). Time comes from requestVideoFrameCallback: timeMs is always the media
// time of the frame actually on screen. Seeks are coalesced (one in flight, newest pending), land mid-frame so
// container rounding can't show a neighbour, and resolve when the latest request's frame is presented.
// Stepping is exact: by frame index for CFR files with a known rate or with a frame-time table, by provably
// safe probing (frames.js) for VFR files without one.

import { convertFileSrc } from '@tauri-apps/api/core';
import { holdFrame, holdMargin, settleInside, askTime } from './frame-hold.js';
import { makeClock, seekTimeOf, probeForward, probeBack, loopShouldWrap, stopLookahead, loopStart, interpolate, snapFps, frameMsFrom, offGridTable, TOL_MS } from './frames.js';
import { SeekQueue } from './seek.js';
import { createScrubber, UNREADABLE, DETACHED } from './scrub.js';
import { DEFAULT_VIEW } from './view.js';
import { dropRate } from './drops.js';
import { Overlays, drawGuides } from './overlays.svelte.js';
import { createPreview } from './preview.js';
import { loadWaveform } from './waveform.js';
import { mediaError, noPicture, proxySizes, proxyKey, defaultProxy } from './transport.js';

/** Speeds for the menu and [ / ]. Below 0.1 the player steps frame by frame (slow shuttle) instead of playing. */
export const RATES = [0.025, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
export const STEPPED_BELOW = 0.1;
const UNKNOWN_DELTA = 1000 / 120;   // probing step when no frame length is known: safe up to 120 fps

// The letterbox choices the View menu offers; a stored value is one of these hexes, 'checker', or a picked color.
export const LETTERBOX_BLACK = '#000000';
export const LETTERBOX = [['Black', LETTERBOX_BLACK], ['Grey', '#3a3d42'], ['Checker', 'checker']];

const UI_DEFAULTS = { sim: true, simSide: 'right', simWidth: 168, simLead: 1000, simLimit: 400,
  guides: 'off', letterbox: LETTERBOX_BLACK, timeFmt: 'ms', preroll: 1500, postroll: 1500, hud: true };

const toUrl = (path) => (typeof window !== 'undefined' && window.__TAURI_INTERNALS__ ? convertFileSrc(path) : path);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
/** The probe's rate, exact: its rational (69480/2317) when the media has it, else the number. */
const rateOf = (m) => (m?.fpsRational?.num > 0 && m.fpsRational.den > 0 ? `${m.fpsRational.num}/${m.fpsRational.den}` : m?.fps);

export class Player {
  // ---- reactive state ----
  timeMs = $state(0);           // media time (ms) of the frame on screen
  // paw-ef73.14: where the playhead rests after a smooth scrub / an exact seek, between frames (the frame on screen is the
  // one containing it, timeMs that frame's time); null = on timeMs. Points use it (playheadMs); structure uses timeMs.
  restMs = $state(null);
  heldFrame = $state(-1);       // the frame a smooth scrub shows (frame-hold.js hysteresis), -1 outside a scrub
  scrubPxMs = 0;                // one pixel's worth of time at the scrubbing view's zoom (the scrubbing view sets it)
  frame = $state(0);            // its index (exact when `exact`)
  playing = $state(false);      // native playback or the stepped shuttle
  rate = $state(1);
  shuttle = $state(0);          // stepped shuttle speed (negative = reverse), 0 = off
  fps = $state(30);
  frameMs = $state(1000 / 30);
  isVfr = $state(false);
  exact = $state(false);        // frame numbers are exact (probe fps for CFR, or a frame table)
  frameCount = $state(0);
  durationMs = $state(0);
  vw = $state(0); vh = $state(0);
  ready = $state(false);        // metadata loaded
  stab = $state.raw(null);      // stabilised preview (paw-2zy): t -> {x, y} camera drift (frame units) | null; VideoPane shifts the picture by minus it
  hasAudio = $state(false);
  seeking = $state(false);
  pendingMs = $state(null);     // latest requested seek target while seeking
  scrubTime = $state(null);     // the unsnapped time under the pointer during a scrub drag (null otherwise): views that
                                // follow the script, not the video (Machine, simulator), read it; the seek stays frame-snapped
  loop = $state(null);          // {t0, t1} | null: playback wraps inside it
  volume = $state(1);
  muted = $state(false);
  error = $state(null);         // {code, message, canProxy}
  missing = $state(false);      // paw-xfg6: the document's video file is not there (what plays, if anything, is the webview's cached copy)
  dropPct = $state(0);          // paw-wfd2.3: % of frames the decoder dropped over the last 10 s of playing (drops.js), 0 = none / paused
  #dropWin = [];
  stats = $state({ dropped: 0, total: 0, seekMs: 0, seekAvgMs: 0, seeks: 0, coalesced: 0, wraps: 0 });
  view = $state({ ...DEFAULT_VIEW });
  ui = $state({ ...UI_DEFAULTS });
  inset = $state(null);   // paw-8ehz: {l, r, t, b} css px the fitted picture leaves free for tools on the stage (the Groups tool's columns)
  url = $state('');
  scrubbing = $state(false);    // hover scrub overlay up: timeMs is the decoded frame drawn over the (unmoved) <video>
  framed = $state(false);       // paw-osat: playing, the frame on screen is drawn on scrubCanvas with the overlays (#paintFrame)
  scrubCache = $state(null);    // {src, state: 'building'|'ready'|'too_large'|'cancelled'|'failed', fraction?, path?, message?}
  cacheDialog = $state(false);  // the "Scrub cache…" dialog (ScrubCacheDialog.svelte)
  // paw-nydn: proxies of any video. media.proxyOf / media.proxyH while one plays (the source's path / its height)
  proxyH = $state(0);           // the proxy height playing (media.proxyH), 0 = the original
  proxies = $state({});         // {height: path}: this video's proxies in the media cache (checked when the video opens)
  proxyJob = $state(null);      // {h, fraction} while one is being made
  proxyLost = $state(0);        // the height chosen last time whose proxy is gone from the cache (the original plays; offer it again)
  overlays = new Overlays();
  scrubCanvas = null;           // VideoPane's canvas over the <video> (same box and matrix)

  // ---- plain state ----
  media = null;
  el = null;
  clock = $state.raw(makeClock({ fps: 30 }));
  frameTimes = null;            // VFR presentation table (ms) from the backend
  learnedMs = null;             // smallest frame delta seen (rVFC / probing)
  anchor = null;                // {ms, perf, rate, playing} of the last presented frame
  q = new SeekQueue();
  waiters = [];
  targetFrame = null;           // frame the pending seek will show (stepping chains from it)
  #seeked = false; #fallback = 0; #reqAt = 0; #issueAt = 0; #prevMd = null; #rvfc = 0;
  #probe = 0; #probing = false; #wrapping = false; #stopAt = null; #noSnap = false;
  #vsync = 1000 / 60;   // display refresh interval (ms), measured on play()
  #shuttleRaf = 0; #timer = 0; #listeners = {}; #preview = null; #wave = null; #off = [];
  #scrubber = null; #scrubInit = null; #scrubFail = null; #scrubAbort = null; #scrubIdle = 0; #scrubT = null; #scrubGen = 0; #scrubEnding = false; #hiddenMs = null; #lastStep = -1e9; #scrubNext = null; #scrubBusy = null; #scrubLive = 0;
  #scrubFile = null; #scJob = null;   // the all-intra scrub cache in use / the build running
  #still = null;                      // paw-3fal: {file, p: Promise<Scrubber | null>}: still()'s own decoder on the scrub cache
  #want = 0; #pjob = null; #times = Promise.resolve();   // the proxy height chosen for this video / the proxy job running / the frame table's arrival

  constructor(app = null) {
    this.app = app;
    const s = app?.settings;
    const saved = s?.get?.('video.ui');
    if (saved && typeof saved === 'object') Object.assign(this.ui, saved);
    this.volume = s?.get?.('video.volume') ?? 1;
    this.muted = !!s?.get?.('video.muted');
    this.overlays.add({ id: 'video.guides', order: -100, draw: (ctx, env) => drawGuides(ctx, env, this.ui.guides) });
    this.setCacheLimit(s?.get?.('media.cacheGb') ?? 2);
  }

  // ---- events for other surfaces ('frame', 'seeked', 'play', 'pause', 'source', 'loop') ----
  on(type, fn) { (this.#listeners[type] ??= new Set()).add(fn); return () => this.#listeners[type].delete(fn); }
  #emit(type, x) { const s = this.#listeners[type]; if (s) for (const f of s) f(x); }

  setUi(patch) { Object.assign(this.ui, patch); this.app?.settings?.set?.('video.ui', $state.snapshot(this.ui)); }

  /** Interpolated media ms for smooth consumers (simulator, playheads): exact while paused. */
  now() { return interpolate(this.anchor, performance.now(), this.frameMs * Math.max(1, this.rate) * 1.5); }
  get last() { return Math.max(0, this.clock.count === Infinity ? Math.floor(this.durationMs / this.frameMs) - 1 : this.clock.count - 1); }
  frameAt(ms) { return this.clock.frameAt(ms); }
  timeOfFrame(k) { return this.clock.timeOf(k); }
  /** Seconds-free readouts for the HUD: presented or (while seeking) requested. */
  get displayMs() { return !this.playing && this.restMs != null ? this.restMs : this.pendingMs ?? this.timeMs; }
  /** paw-o60v.8.1: the time of the frame ON SCREEN, the one value for everything that shows where the script / machine is at
   *  the picture (the position bar, the simulator, the 6-axis view, the Machine panel paused): playing, the frame the video
   *  presented; paused, the frame the <video> shows (a seek still landing: still the old one); scrubbing (hover, a drag, a
   *  held step), the decoded frame drawn. Every path sets it through #present. Paused, the playhead's rest time when it lies
   *  in that frame (a smooth scrub / an exact seek: the same value as before at rest), else the nearest time inside the frame:
   *  never the playhead's requested time (displayMs / scrubTime) ahead of the picture while a frame is being fetched. */
  get shownMs() { return !this.playing && this.restMs != null && this.direct ? settleInside(this.restMs, this.frame, this.clock) : this.timeMs; }
  /** The playhead's own time: the rest time between frames (a smooth scrub), else the frame's. */
  get playheadMs() {
    if (this.playing) return this.timeMs;
    if (this.restMs != null) return this.restMs;
    return this.clock ? Math.round(this.clock.timeOf(this.clock.frameAt(this.timeMs))) : this.timeMs;   // paw-ef73.22: on the frame's start (timeMs is the video's presentation time, a hair off it)
  }

  // ---- shell compatibility (src/app/player.svelte.js API) ----
  /** Probe result / doc media changed. */
  setMedia(media) { this.load(media); }
  /** Script-only editing: the timeline's length when no video is loaded. */
  setDuration(ms) { if (!this.url) { this.durationMs = ms; this.ready = ms > 0; this.#rebuild(); } }
  /** Start (int ms) of the frame nearest ms, for snapping new points to frames. */
  snap(ms) { return Math.round(this.clock.timeOf(this.clock.frameAt(ms + this.frameMs / 2))); }
  get hasVideo() { return !!(this.el && this.url); }
  /** Seeks move a timer clock: no video, or it failed to load (no seeked event will come). */
  get #timerClock() { return !this.hasVideo || !!this.el.error; }

  // ---- source ----
  /** media = app.doc.media shape {path, name, durationMs, fps, isVfr, width, height} (+ url in harnesses). */
  load(media) {
    const was = this.media?.proxyOf || this.media?.path;
    // paw-nydn: the document's media again (the pane re-mounting, a re-probe) while its chosen proxy plays: stay on the proxy
    if (media && !media.proxyOf && this.#want && media.path === this.media?.proxyOf) media = { ...media, url: undefined, path: this.media.path, proxyOf: media.path, proxyH: this.media.proxyH };
    const url = media ? media.url || toUrl(media.path) : '';
    const same = url === this.url;
    this.media = media || null;
    this.proxyH = media?.proxyH || 0;
    if (same) { this.#rebuild(); this.buildScrubCache(); this.#checkMissing(media, url); return; }   // the same file opened again: it may have gone since
    this.#reset();
    this.url = url;
    this.durationMs = media?.durationMs || 0;
    this.#rebuild();
    if (this.el) { if (url) this.el.src = url; else this.el.removeAttribute('src'); this.el.load(); }
    const be = this.app?.backend;
    // the file's own frame table: the clock for VFR, and (paw-kxz4) for a CFR file whose frames are not where its probed rate
    // puts them (an owner clip: first frame 66 ms in, a dropped frame, 29.987 "fps": pictures up to 3 frames off n x 1000 / fps)
    // The table is the SOURCE's (the frames the sidecar, the repeats and a funscript player see); a proxy starts its video at 0
    // (media.rs proxy_args setpts), so its pictures sit the source's first frame time earlier: that is its start offset.
    if (media?.path && be?.frameTimes) {
      this.#times = Promise.resolve().then(() => be.frameTimes(media.proxyOf || media.path)).then((times) => {
        if (this.url !== url || !times?.length) return;
        if (media.proxyOf) this.#proxyStart = -times[0];
        const t = media.isVfr ? times : offGridTable(times, makeClock({ fps: rateOf(media) }));
        if (t) { this.frameTimes = t; this.#rebuild(); this.#emit('clock', this.clock); }
        else if (media.proxyOf && times[0]) this.#emit('clock', this.clock);
      }, () => {});
    } else this.#times = Promise.resolve();
    this.#emit('source', media);
    this.#checkMissing(media, url);
    // paw-mh1a: the media cache never evicts the entries of the files open now (the video, the proxy playing)
    Promise.resolve().then(() => be?.mediaCacheOpen?.([...new Set([media?.proxyOf, media?.path].filter(Boolean))])).catch(() => {});
    this.buildScrubCache();
    if (media?.path && !media.proxyOf && media.path !== was) this.#findProxies(media);
  }

  /** paw-zo60: is the file there now? (the drive may have come back since the load) -> missing */
  async recheckMissing() {
    const be = this.app?.backend, src = this.media?.proxyOf || this.media?.path, url = this.url;
    if (!src || !be?.stat) return this.missing;
    try { const s = await be.stat(src); if (this.url === url) this.missing = s?.exists === false; } catch { /* unknown: as it was */ }
    return this.missing;
  }
  /** paw-xfg6: is the file there? (the webview may still play it from its cache) */
  #checkMissing(media, url) {
    const be = this.app?.backend, src = media?.proxyOf || media?.path;
    if (src && be?.stat) Promise.resolve().then(() => be.stat(src)).then((s) => { if (this.url === url) this.missing = s?.exists === false; }, () => {});
    else this.missing = false;
  }

  #reset() {
    this.#stopShuttle(); this.q.reset(); this.#resolveWaiters();
    clearTimeout(this.#fallback);
    // paw-33zi: the previous video's rest / scrub time goes too (displayMs and playheadMs read restMs before timeMs)
    Object.assign(this, { ready: false, error: null, missing: false, timeMs: 0, restMs: null, scrubTime: null, heldFrame: -1, frame: 0, playing: false, framed: false, seeking: false, pendingMs: null,
      vw: 0, vh: 0, hasAudio: false, frameTimes: null, learnedMs: null, anchor: null, targetFrame: null, loop: null });
    this.#prevMd = null; this.#stopAt = null; this.#probe = 0; this.#proxyStart = 0;
    this.stats = { dropped: 0, total: 0, seekMs: 0, seekAvgMs: 0, seeks: 0, coalesced: 0, wraps: 0 };
    this.#dropWin = []; this.dropPct = 0;
    this.view = { ...DEFAULT_VIEW, rot: this.view.rot, flipH: this.view.flipH, flipV: this.view.flipV };
    this.#preview?.dispose(); this.#preview = null; this.#wave = null; this.#dropStill();
    this.#scrubStop(); this.#scrubAbort?.abort(); this.#scrubber?.dispose();
    this.#scrubber = this.#scrubInit = this.#scrubFail = this.#scrubAbort = this.#scrubFile = null;
  }

  /** Rebuild the frame clock from what is known: backend table > probe fps (CFR) > learned > nominal. */
  #rebuild() {
    const m = this.media, dur = this.durationMs || m?.durationMs || NaN;
    this.isVfr = !!m?.isVfr;
    if (this.frameTimes) this.clock = makeClock({ times: this.frameTimes, durationMs: dur });
    else if (m?.fps && !m.isVfr) this.clock = makeClock({ fps: rateOf(m), durationMs: dur });
    else if (this.learnedMs && !m?.isVfr) this.clock = makeClock({ fps: snapFps(1000 / this.learnedMs), durationMs: dur });
    else this.clock = makeClock({ fps: m?.fps || 30, durationMs: dur });
    this.exact = !!this.frameTimes || !!(m?.fps && !m.isVfr);
    this.frameMs = this.clock.frameMs; this.fps = 1000 / this.frameMs;
    this.frameCount = this.clock.count === Infinity ? 0 : this.clock.count;
    this.frame = this.clock.frameAt(this.timeMs);
  }
  /** Stepping by index is safe (CFR known/learned, or a table); otherwise probe. */
  /** paw-ef73.16: where the file's first frame sits on the <video>'s own timeline (ms, 0 for most files): the app counts from 0,
   *  the element honours the start, so every element time is the app time + this. */
  get startMs() { return this.media?.proxyOf ? this.#proxyStart : this.media?.startMs || 0; }
  #proxyStart = 0;   // paw-kxz4: a proxy's start offset: minus the source's first frame time (see load)
  get direct() { return !!this.frameTimes || (!this.isVfr && (!!this.media?.fps || !!this.learnedMs)); }

  // ---- element ----
  attach(el) {
    this.detach();
    this.el = el;
    // paw-shgb: one settings object for every tab; a tab's player made earlier takes the volume set in another since
    const s = this.app?.settings;
    if (s?.get) { this.volume = s.get('video.volume') ?? this.volume; this.muted = !!s.get('video.muted'); }
    el.preservesPitch = true;
    el.volume = this.volume; el.muted = this.muted; el.playbackRate = this.rate >= STEPPED_BELOW ? this.rate : 1;
    const L = (t, f) => { el.addEventListener(t, f); this.#off.push(() => el.removeEventListener(t, f)); };
    L('loadedmetadata', () => {
      this.vw = el.videoWidth; this.vh = el.videoHeight;
      if (!this.media?.durationMs && Number.isFinite(el.duration)) this.durationMs = Math.round(el.duration * 1000);
      this.hasAudio = this.media?.hasAudio ?? true;   // from the probe (media_probe has_audio); unknown = assume yes
      this.#rebuild();
      this.ready = true;
      if (!this.vw) { const m = this.media; this.error = noPicture({ path: m?.path || '', probed: !!(m?.width || m?.fps), proxy: !!this.app?.backend?.transcodePreview }); }
      el.playbackRate = this.rate >= STEPPED_BELOW ? this.rate : 1;
    });
    L('play', () => { this.framed = false; if (!this.shuttle) { this.playing = true; this.#emit('play'); } });   // framed: the first frame it plays is drawn over the old one
    L('pause', () => {
      this.framed = false;   // paused: the <video>'s own frame shows again
      if (this.shuttle) return;
      this.playing = false; this.#emit('pause');
      // land exactly on the frame the user saw (the last presented one: rVFC hands a frame over while currentTime
      // can still be inside the previous one), so the screen, timeMs and the next step all agree. The compositor
      // may still present one queued frame after pause(): snap after it had its chance, or we would flick back.
      if (!this.#noSnap && this.direct && !this.q.busy) {
        this.seeking = true;
        const url = this.url, snap = () => {
          if (this.el === el && this.url === url && el.paused && !this.q.busy && !this.shuttle) this.seekFrame(this.frame);
          else if (!this.q.busy) this.seeking = false;
        };
        if (document.hidden) snap(); else requestAnimationFrame(() => requestAnimationFrame(snap));
      }
      this.#noSnap = false;
    });
    L('ended', () => { this.playing = false; this.framed = false; });
    L('seeked', () => this.#onSeeked());
    L('error', () => this.#onError());
    L('timeupdate', () => {   // hidden tab: no rVFC, keep loops going off the media clock
      if (document.hidden && this.playing && !this.shuttle) this.#checkStops(el.currentTime * 1000 - this.startMs);
    });
    const vis = () => {
      if (!document.hidden && this.q.busy && this.#seeked) this.#settle();
      if (!document.hidden && el.paused) { this.timeMs = this.clock.timeOf(this.clock.frameAt(el.currentTime * 1000 - this.startMs)); }
    };
    document.addEventListener('visibilitychange', vis); this.#off.push(() => document.removeEventListener('visibilitychange', vis));
    if (typeof el.requestVideoFrameCallback === 'function') {
      this.#rvfc = el.requestVideoFrameCallback(this.#onFrame);
      this.#off.push(() => el.cancelVideoFrameCallback(this.#rvfc));
    }
    if (this.url) {
      el.src = this.url; el.load();
      // paw-shgb: the pane mounted again (its tab shown) or for the first time after a resume in the background: the picture
      // where the playhead is, not the file's first frame (the element starts there: its default playback start position)
      if (this.timeMs > 0) el.currentTime = ((this.direct ? seekTimeOf(this.clock, this.frame) : this.timeMs) + this.startMs) / 1000;
      if (this.#scrubFile && !this.#scrubInit) this.#startScrubber();   // the scrub cache's decoder, released while hidden
    }
  }
  detach() {
    for (const f of this.#off) f(); this.#off = []; this.#stopShuttle();
    // paw-shgb: the element goes with its pane (a tab hidden) before its 'pause' event can arrive: not playing from here
    if (this.el && this.playing) { this.el.pause(); this.playing = false; this.framed = false; this.#emit('pause'); }
    this.el = null; this.#release();
  }
  /** paw-shgb: the pane unmounted (its tab hidden, the document closed): the decoders it used go (the hover scrubber with its
   *  frame ring, the still decoder, the filmstrip's hidden <video>); made again on the next use once shown. */
  #release() {
    this.#scrubStop(); this.#scrubAbort?.abort(DETACHED); this.#scrubber?.dispose(); this.#dropStill();   // paw-56pz: a frame copy goes on
    this.#preview?.dispose(); this.#preview = null;
    this.#scrubber = this.#scrubInit = this.#scrubFail = this.#scrubAbort = null;
  }

  #onError() {
    const e = this.el?.error;
    if (!e || !this.url) return;
    // no 'seeked' will ever come: settle every pending seek (later seeks move the timer clock, see #seekRaw)
    this.#stopShuttle(); clearTimeout(this.#fallback);
    this.q.reset(); this.seeking = false; this.pendingMs = null; this.targetFrame = null; this.#resolveWaiters();
    this.playing = false;
    const be = this.app?.backend, m = this.media, url = this.url, path = m?.path || '';
    const o = { path, probed: !path || !!(m?.width || m?.fps), proxy: !!be?.transcodePreview, locate: !!be?.openDialog, detail: e.message };
    const show = (stat) => { if (this.url === url && this.el?.error) this.error = mediaError(e.code, { ...o, stat }); };
    if (path && be?.stat) Promise.resolve().then(() => be.stat(path)).then(show, () => show(null));
    else show(null);
  }

  /** Point the document at another file for a missing or unplayable video (the edits stay). */
  async relink() {
    const app = this.app, be = app?.backend;
    if (!be?.openDialog || !app.doc) return;
    const { VIDEO_EXT, mediaFrom } = await import('../../app/project-logic.js');
    let path = await be.openDialog({ title: 'Locate the video', multiple: false, filters: [{ name: 'Video', extensions: VIDEO_EXT }] });
    if (Array.isArray(path)) path = path[0];
    if (!path) return;
    const probe = await Promise.resolve().then(() => be.mediaProbe?.(path)).catch(() => null);
    const media = mediaFrom(path, probe);
    app.doc.media = media;
    app.history?.markDirty?.();
    this.load(media);
  }

  // ---- proxies (paw-nydn): an H.264 copy of any video in the media cache, made on request, chosen per video ----
  // transcode_preview (media.rs proxy) keeps every frame at its own time, starting the video at 0 (#proxyStart): the clock is the
  // source's frame table either way, so frame numbers, times and normalised coordinates mean the same on both. The <video>, hover
  // scrub and the frame readers that take app.player.url read the proxy; the sidecar (tracking, detectors) reads app.doc.media.path.
  /** Sizes to offer for this video (tallest first, none above the source). */
  get proxySizes() { return proxySizes(this.app?.doc?.media?.height || this.media?.height); }

  /**
   * Make the proxy h px tall (default 720, or the largest size below it) in the background, then play it. Instant when the cache
   * has it. Progress: the status bar's task (Cancel there or cancelProxy()), and the error card when the original cannot play.
   */
  async makeProxy(h) {
    const app = this.app, be = app?.backend, m = this.media;
    if (!be?.transcodePreview || !m?.path) return;
    const src = m.proxyOf || m.path;
    h = +h || defaultProxy(this.proxySizes, this.app?.settings?.get?.('video.proxyHeight'));
    if (this.proxyJob?.h === h) return;
    this.#pjob?.cancel();
    const card = !!this.error && !this.error.busy && !m.proxyOf;   // the original cannot play: the card shows the progress
    const base = { code: this.error?.code ?? -1, canProxy: false, busy: true };
    const t0 = performance.now();
    let task = null, job = null;
    job = this.#pjob = be.transcodePreview(src, { height: h, onProgress: (f) => {
      if (!job || this.#pjob !== job) return;
      task ??= app?.task?.(`Proxy ${h}p`, { cancel: () => job.cancel() });   // none for a cached proxy (no progress)
      task?.update(Math.round(f * 100), 100);
      this.proxyJob = { h, fraction: f };
      if (card && this.error?.busy) this.error = { ...base, cancel: job.cancel, message: `Making a playable proxy… ${Math.round(f * 100)} %` };
    } });
    this.proxyJob = { h, fraction: 0 };
    if (card) this.error = { ...base, cancel: job.cancel, message: 'Making a playable proxy…' };
    const here = () => this.#pjob === job && (this.media?.proxyOf || this.media?.path) === src;
    try {
      const p = await job.promise;
      if (!here()) return;
      this.proxies = { ...this.proxies, [h]: p };
      const s = await Promise.resolve().then(() => be.stat?.(src)).catch(() => null);
      this.#remember(src, { of: s?.exists ? `${s.size}:${s.mtime_ms}` : '', made: $state.snapshot(this.proxies) });
      this.#note('made', h, src, { s: Math.round((performance.now() - t0) / 100) / 10, cached: !task });
      this.#pjob = null; this.proxyJob = null;
      this.#evicted();
      await this.useProxy(h);
    } catch (e) {
      if (!here()) return;
      const cancelled = e?.code === 'cancelled';
      this.#note(cancelled ? 'cancelled' : 'failed', h, src, { s: Math.round((performance.now() - t0) / 100) / 10 });
      this.#pjob = null; this.proxyJob = null;
      if (card) this.error = { code: -1, canProxy: true, message: cancelled ? 'Proxy canceled: Pawscript cannot play this file' : 'Proxy failed: ' + (e?.message || e) };
      else if (!cancelled) app?.toast?.(`The ${h}p proxy failed: ${e?.message || e}`, 'error');
    } finally { task?.end(); }
  }
  cancelProxy() { this.#pjob?.cancel(); }

  /** Play the proxy h px tall (0 = the original), remembered for this video; one not made yet is made first. The frame on screen stays. */
  async useProxy(h = 0) {
    const m = this.media, src = m?.proxyOf || m?.path;
    h = +h || 0;
    if (!src) return;
    if (h && !this.proxies[h]) return this.makeProxy(h);
    this.#want = h; this.proxyLost = 0;
    this.#remember(src, { use: h });
    if (this.proxyH === h) return;
    const doc = this.app?.doc?.media, orig = doc?.path === src ? doc : { ...m, url: undefined, path: src, proxyOf: undefined, proxyH: undefined };
    const k = this.frame, play = this.playing;
    this.load(h ? { ...orig, url: undefined, path: this.proxies[h], proxyOf: src, proxyH: h } : orig);
    this.#note('use', h, src);
    // back on the frame that was showing once the new file has its metadata and the source's frame table (the proxy's start offset)
    const url = this.url, t = performance.now();
    await this.#times;
    while (this.el && this.url === url && !this.ready && !this.error && performance.now() - t < 30000) await new Promise((r) => setTimeout(r, 30));
    if (!this.el || this.url !== url || !this.ready || this.error) return;
    await this.seekFrame(k);
    if (play && this.url === url) this.play();
  }

  /** A video opened: which of its proxies are still in the cache (the source unchanged since), and play the one chosen last time. */
  async #findProxies(media) {
    const be = this.app?.backend, src = media.path, rec = this.app?.settings?.get?.(proxyKey(src), null);
    this.#pjob?.cancel(); this.#pjob = null; this.proxyJob = null;
    this.proxies = {}; this.proxyLost = 0; this.#want = 0;
    if (!rec?.made || !be?.stat) return;
    const stat = (p) => Promise.resolve().then(() => be.stat(p)).catch(() => null);
    const s = await stat(src), made = {};
    if (s?.exists && rec.of === `${s.size}:${s.mtime_ms}`) {   // a replaced or edited video: its old proxies are not its frames
      for (const [h, p] of Object.entries(rec.made)) if ((await stat(String(p).replace(/[^\\/]+$/, 'done')))?.exists) made[h] = p;   // media cache: an entry is complete once 'done' exists
    }
    if ((this.media?.proxyOf || this.media?.path) !== src) return;
    this.proxies = made;
    if (Object.keys(made).length !== Object.keys(rec.made).length) this.#remember(src, { made });
    const h = +rec.use || 0;
    if (h && made[h]) {   // the choice made last time, no re-encoding: asked through the cache (a hit marks it used, paw-mh1a), never made here
      let job = null;
      job = be.transcodePreview?.(src, { height: h, onProgress: () => job?.cancel() });
      const p = job && await job.promise.catch(() => null);
      if ((this.media?.proxyOf || this.media?.path) !== src) return;
      if (p && p !== made[h]) this.proxies = { ...made, [h]: p };
      if (!job || p) await this.useProxy(h);
      else this.proxyLost = h;   // not in the cache after all (progress means a build: cancelled)
    }
    else if (h) this.proxyLost = h;            // evicted / cleared: the original plays, the control offers to make it again
  }
  #remember(src, patch) {
    const st = this.app?.settings, k = proxyKey(src);
    if (k && st?.set) st.set(k, { ...(st.get?.(k, null) || {}), ...patch });
  }
  /** Usage log: one line per proxy made / chosen / cancelled / failed (height, seconds, the source's codec; no paths). */
  #note(act, h, src, extra = {}) {
    const u = this.app?.usage, be = this.app?.backend;
    if (!u) return;
    Promise.resolve().then(() => be?.mediaProbe?.(src)).then((p) => p?.video?.codec || '', () => '')
      .then((codec) => u.note('video:proxy', { act, h, ...extra, codec }));
  }

  // ---- the frame clock ----
  #onFrame = (_now, md) => {
    const el = this.el;
    if (!el) return;
    this.#rvfc = el.requestVideoFrameCallback(this.#onFrame);
    if (!this.ready) return;   // paw-33zi: a frame of the previous source presented before the swap, not this one's (its frames follow its metadata)
    const raw = md.mediaTime * 1000, ms = raw - this.startMs;
    const adv = this.#prevMd ? raw - this.#prevMd.mediaTime * 1000 : 0;   // media advance since the last callback
    if (!this.direct || !this.media?.fps) {   // no probe rate: learn the frame length from consecutive frames
      const f = frameMsFrom(this.#prevMd, md, this.learnedMs);
      if (f != null && f !== this.learnedMs) { this.learnedMs = f; this.#rebuild(); }
    }
    this.#prevMd = md;
    // paw-o60v.8: scrubbing, the canvas shows the decoded frame and timeMs is that frame's (the overlays draw for it): a seek of
    // the hidden <video> still landing (a step before a held key went to the decoded path) must not move them
    if (this.scrubbing) this.#hiddenMs = ms;
    else {
      this.anchor = { ms, perf: md.expectedDisplayTime, rate: el.playbackRate, playing: !el.paused && !this.shuttle };
      if (this.anchor.playing) this.#paintFrame(el);
      this.#present(ms);
    }
    if (this.q.busy && this.#seeked) this.#settle();
    if (this.playing && !this.shuttle && !el.paused) this.#checkStops(ms, adv, this.#vsync);
    if ((md.presentedFrames & 15) === 0) this.#sampleQuality();
    this.#emit('frame', ms);
  };

  /** paw-osat: while it plays, the <video> shows its frames from the compositor's own thread, a display frame or more before the
   *  overlays this callback paints for them reach the screen (measured: the overlay a frame behind the picture on 20-90 % of the
   *  screen updates, more the faster the frames come). So the picture is drawn here too, the frame this callback reports (drawImage
   *  in a video frame callback draws that frame), on the canvas over the <video> (the hover scrub's): picture and overlays go to
   *  the screen in the same main-thread frame. Paused, seeking or scrubbing the <video> shows its frame as before. */
  #paintFrame(el) {
    const c = this.scrubCanvas;
    if (!c || !this.vw || this.scrubbing) return;
    if (c.width !== this.vw || c.height !== this.vh) { c.width = this.vw; c.height = this.vh; }
    c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
    if (!this.framed) this.framed = true;
  }

  /** paw-p52k: the frame on screen is the one containing the element's reported media time (ms, app timeline), and timeMs is that
   *  frame's START on the ms grid cuts and shots are stored on (rounded), never the reported time itself: that sits a hair under
   *  a frame start (float seconds, 1/3 ms frames), so a lookup "which shot is at timeMs" picked the shot before a cut. Idempotent. */
  #present(ms) {
    this.frame = this.clock.frameAt(ms);
    this.timeMs = this.direct ? Math.round(this.clock.timeOf(this.frame)) : ms;
  }

  #sampleQuality() {
    const q = this.el?.getVideoPlaybackQuality?.();
    if (q) { this.stats.dropped = q.droppedVideoFrames; this.stats.total = q.totalVideoFrames; const r = dropRate(this.#dropWin, performance.now(), q.droppedVideoFrames, q.totalVideoFrames); this.dropPct = r; }
  }

  /** Loop wrap and play-range stop, checked on every presented frame (pre-seek on the last frame). */
  #checkStops(ms, adv = 0, lead = 0) {
    const s = this.#stopAt, ahead = stopLookahead(this.clock, this.clock.frameAt(ms), ms, adv, this.rate, lead);
    if (s) {
      if (ms + ahead >= s.t1 - TOL_MS) {
        this.#stopAt = null; this.#noSnap = true; this.el.pause();
        this.seekFrame(this.clock.frameAt(s.t1 - 2 * TOL_MS));   // the range's last frame (pts < t1 - TOL_MS)
        if (s.returnTo != null) this.seek(s.returnTo);
      }
      return;
    }
    if (this.loop && !this.#wrapping && loopShouldWrap(ms, ahead, this.loop)) {
      this.#wrapping = true; this.stats.wraps++;
      this.seek(this.loop.t0).then(() => { this.#wrapping = false; });
      this.#emit('loop', this.loop);
    }
  }

  // ---- seeking ----
  #issue(ms) {
    this.#seeked = false; this.#issueAt = performance.now();
    this.el.currentTime = (ms + this.startMs) / 1000;
  }
  #onSeeked() {
    if (!this.q.busy) return;
    this.#seeked = true;
    // the frame normally arrives through rVFC right after; if it never does (same frame, hidden tab), settle anyway
    clearTimeout(this.#fallback);
    const settle = () => { if (this.q.busy && this.#seeked) this.#settle(true); };
    this.#fallback = setTimeout(settle, 120);
    if (!document.hidden) requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(settle)));
  }
  #settle(noFrame = false) {
    clearTimeout(this.#fallback);
    const now = performance.now(), d = now - this.#issueAt;
    this.stats.seeks++; this.stats.seekMs = d; this.stats.seekAvgMs += (d - this.stats.seekAvgMs) / Math.min(this.stats.seeks, 20);
    if (noFrame && this.el && this.direct && !this.scrubbing) {   // no rVFC for this seek: trust the element's clock
      const k = this.clock.frameAt(this.el.currentTime * 1000 - this.startMs);
      if (k !== this.frame) this.#present(this.clock.timeOf(k));
    }
    const next = this.q.settle();
    if (next != null) { this.#issue(next); return; }
    this.stats.coalesced = this.q.dropped;
    this.stats.latencyMs = now - this.#reqAt;
    this.seeking = false; this.pendingMs = null; this.targetFrame = null;
    this.#resolveWaiters();
    this.#emit('seeked', this.timeMs);
  }
  #resolveWaiters() { const w = this.waiters; this.waiters = []; for (const r of w) r(this.timeMs); }

  /** Raw coalesced seek to a media time (ms). Resolves with the presented frame's time once the latest lands. */
  #seekRaw(ms) {
    if ((this.scrubbing || this.#scrubT) && !this.#scrubEnding) this.#scrubStop();   // any other seek (step, click, Esc) takes over from a scrub, even one whose first frame is still decoding
    if (this.#timerClock) {   // timer clock (no video, or it failed to load: no seeked event comes): move at once
      ms = clamp(ms, 0, this.durationMs || Infinity);
      this.timeMs = ms; this.frame = this.clock.frameAt(ms); this.anchor = { ms, perf: performance.now(), rate: this.rate, playing: this.playing };
      this.#emit('seeked', ms);
      return Promise.resolve(ms);
    }
    ms = clamp(ms, 0, Math.max(0, (this.durationMs || Infinity) - 0.5));
    this.pendingMs = ms; this.seeking = true; this.#reqAt = performance.now();
    const p = new Promise((r) => this.waiters.push(r));
    const now = this.q.request(ms);
    if (now != null) this.#issue(now);
    return p;
  }

  /** Show the frame containing ms (exact). Rapid calls coalesce; resolves when the latest one's frame is shown. */
  /** Go to ms. exact: the playhead rests at ms (restMs) and the video shows the frame containing it; else it is that
   *  frame's time (frame steps, jumps, structure). */
  seek(ms, { exact = false } = {}) {
    if (!Number.isFinite(ms)) return Promise.resolve(this.timeMs);
    const at = ms, keep = exact ? this.scrubTime : null, n = exact ? this.#held(ms) : -1;   // the frame to show (hysteresis), the exact ms for the playhead
    if (exact && n !== this.clock.frameAt(ms)) ms = this.clock.timeOf(n) + this.clock.frameMs / 2;
    // paw-ef73.22: any move that is not a scrub drops the scrub's pointer time (it kept the pink line where the pointer last hovered)
    const p = this.direct ? this.seekFrame(this.clock.frameAt(ms)) : this.#seekRaw(ms + TOL_MS + 0.01);   // no clock: same TOL_MS-early semantics as frameAt
    this.restMs = exact ? clamp(at, 0, this.durationMs || Infinity) : null;
    this.scrubTime = keep; this.heldFrame = n;
    return p;
  }
  /** The frame a scrub shows for ms: the frame holding ms, kept while ms is within the hold margin of the one showing. */
  #held(ms) { return holdFrame(this.heldFrame, ms, this.clock, holdMargin(this.scrubPxMs, this.clock.frameMs)); }
  /** A scrub is released: the frame showing stays, the stored playhead is nudged inside it when it sat past its edge by the margin. */
  settle() {
    if (this.heldFrame < 0) return;
    if (this.restMs != null) this.restMs = settleInside(this.restMs, this.heldFrame, this.clock);
    this.heldFrame = -1;
  }
  /** Show frame k. */
  seekFrame(k) {
    this.restMs = null; this.scrubTime = null; this.heldFrame = -1;
    k = clamp(Math.round(k), 0, this.last);
    if (this.#timerClock) return this.#seekRaw(this.clock.timeOf(k));
    this.targetFrame = k;
    return this.#seekRaw(seekTimeOf(this.clock, k));
  }

  // ---- hover scrub (scrub.js: WebCodecs frames drawn over the video, no <video> seek per move) ----
  /**
   * Show the frame at ms while the pointer scrubs. Frames are decoded in the webview and drawn on scrubCanvas;
   * timeMs follows them. ~120 ms after the last call (or on scrubEnd()) one real seek lands the <video> there and
   * the overlay drops once it presents that frame. Files WebCodecs can't take fall back to seek() per call.
   */
  scrub(ms, { frame = null } = {}) {
    if (!Number.isFinite(ms) || !this.hasVideo || this.playing || this.el.error) return;
    ms = clamp(ms, 0, Math.max(0, (this.durationMs || Infinity) - 0.5));
    // paw-o60v.8: frame = show that frame and land on its start (a held step key, a Shift drag, a cut edge), no hysteresis
    const n = frame ?? this.#held(ms), shown = askTime(n, this.clock);   // the frame shown (hysteresis), asked for at its middle
    this.#scrubT = { ms, n, smooth: frame == null };
    this.restMs = frame == null ? ms : null;   // a scrub is smooth: the playhead where the pointer is
    this.heldFrame = frame == null ? n : -1;
    if (frame != null) this.scrubTime = null;   // on a frame, as a step / seekFrame
    clearTimeout(this.#scrubIdle);
    this.#scrubIdle = setTimeout(() => this.scrubEnd(), 120);
    const s = this.#scrubber;
    if (!s || s.error) { if (!this.#scrubFail && !s) this.#startScrubber(); this.#scrubEnding = true; this.#land(this.#scrubT); this.#scrubEnding = false; return; }
    ++this.#scrubGen;
    this.#scrubNext = { n, shown, at: performance.now(), live: this.#scrubLive };
    const b = this.#scrubBusy;
    if (!b || b.s !== s || performance.now() - b.t > 500) this.#scrubPump(s);   // a decode that never answers does not stall the scrub
  }
  /** paw-o60v.8: one decode at a time. The newest request waits for the one in flight, which is still drawn (a frame the
   *  playhead was on), instead of superseding it: with moves faster than the decoder (2160p, 20+ ms a frame) superseding
   *  left nothing drawn at all. A scrub ended or stopped (#scrubLive) draws nothing more. */
  #scrubPump(s) {
    const j = this.#scrubNext;
    this.#scrubNext = null;
    if (!j || j.live !== this.#scrubLive || s !== this.#scrubber) return;
    const busy = (this.#scrubBusy = { s, t: performance.now() });
    s.frameAt(j.shown).then((f) => {
      if (this.#scrubBusy !== busy) return;   // superseded by the watchdog: that newer request draws
      this.#scrubBusy = null;
      const c = this.scrubCanvas;
      if (f && c && j.live === this.#scrubLive) {
        if (c.width !== this.vw || c.height !== this.vh) { c.width = this.vw; c.height = this.vh; }
        c.getContext('2d').drawImage(f, 0, 0, c.width, c.height);
        const t = this.clock.timeOf(j.n);   // the clock's time of the frame drawn (the table's own, rounded to its timescale, can read as the frame before)
        this.#present(t);
        this.anchor = { ms: t, perf: performance.now(), rate: this.rate, playing: false };
        this.scrubbing = true;
        globalThis.__pawScrubLog?.({ t, ms: performance.now() - j.at });   // dev instrumentation (measurement scripts)
      }
      this.#scrubPump(s);
    });
  }
  /** Pointer left / stopped: one real seek to the scrubbed time; the overlay drops when the video shows it. */
  scrubEnd() {
    clearTimeout(this.#scrubIdle);
    const t = this.#scrubT;
    if (t == null) return;
    this.#scrubT = null; this.#scrubNext = null; this.#scrubLive++;
    const gen = ++this.#scrubGen;
    if (!this.scrubbing) {   // nothing drawn yet (the decode outlasted the pause) -> seek; the fallback path already did
      if (this.#scrubber && !this.#scrubber.error) { this.#land(t); this.settle(); }
      return;
    }
    this.#scrubEnding = true;
    const done = this.#land(t);
    this.#scrubEnding = false;
    this.settle();
    done.then(() => {
      if (gen !== this.#scrubGen) return;
      this.scrubbing = false;
      // the frame the <video> landed on: the last decode, dropped at release, left an earlier frame drawn and timed (paw-yhif)
      if (this.direct && this.el) { const k = this.clock.frameAt(this.el.currentTime * 1000 - this.startMs); if (k !== this.frame) this.#present(this.clock.timeOf(k)); }
      else if (this.#hiddenMs != null) this.#present(this.#hiddenMs);   // no exact clock: the time the <video> reported
      this.#hiddenMs = null;
    });
  }
  /** The <video> to a scrub's rest: the smooth time (exact), or the frame's start. */
  #land(t) { return t.smooth ? this.seek(t.ms, { exact: true }) : this.seekFrame(t.n); }
  /** paw-o60v.8: a drag of the playhead (the ruler, a lane's playhead, a cut edge): paused, the decoded frames (scrub, one
   *  <video> seek at rest: scrubEnd on release); playing, a seek as before. snap: on the frame containing ms, else smooth. */
  dragTo(ms, { snap = false } = {}) {
    if (!Number.isFinite(ms)) return;
    if (!this.playing && this.hasVideo && !this.el.error && this.#fast()) return this.scrub(ms, snap ? { frame: this.clock.frameAt(ms) } : undefined);
    if (snap) this.seek(ms); else this.seek(ms, { exact: true });
  }
  /** The scrub cache's decoder is up, at full size: any frame is one decode (dragTo, held steps). Else (cache building, off,
   *  made smaller, refused, no WebCodecs) they seek as before; a cache that is ready gets its decoder started. */
  #fast() {
    const s = this.#scrubber;
    if (!s && this.#scrubFile && !this.#scrubFail) this.#startScrubber();
    return !!s && !s.error && s.intra && !this.scrubCache?.h;
  }
  /** Diagnostics: the scrubber's counters, or why hover scrub uses seeks (null before the first hover scrub). */
  get scrubStats() {
    const s = this.#scrubber, e = this.#scrubFail || s?.error;
    return e ? { error: String(e?.message || e) } : s && { ...s.stats, ring: s.ring.map.size, ringCap: s.ring.cap, codec: s.codec, hardware: s.hardware, width: s.width, height: s.height, intra: !!s.intra };
  }
  /** paw-b88b: MP4 files in the media cache with this video's frames (the same frames at the same times from the first one):
   *  the scrub cache once ready (the original's, or the proxy's while one plays), then the proxies, tallest first. src: the
   *  original's path (a reader asking for another video gets none). For readers the source cannot feed (scrub.js alts). */
  frameFiles(src = null) {
    const m = this.media, sc = this.scrubCache;
    if (!m?.path || (src && src !== (m.proxyOf || m.path))) return [];
    return [sc?.state === 'ready' && sc.src === m.path ? sc.path : null, ...Object.entries(this.proxies).sort((a, b) => b[0] - a[0]).map((e) => e[1])].filter(Boolean);
  }
  /** paw-b88b: no reader could read this video's frames (scrub.js UNREADABLE): said once per video, with the fix (a proxy is H.264).
   *  paw-e3tu: plain = the reader's own line (scrub.js BLOCKED: no file reachable, a proxy would not help: no button). */
  framesUnreadable(plain = UNREADABLE) {
    if (this.#unreadable === this.url) return;
    this.#unreadable = this.url;
    this.framesBad = { url: this.url, text: plain };   // paw-wfd2.3: the health slot (features/video/health.js) while this video plays
    const be = this.app?.backend;
    this.app?.toast?.(plain, 'warn', { timeout: 9000, ...(plain === UNREADABLE && be?.transcodePreview ? { action: { label: 'Make a proxy', run: () => this.makeProxy() } } : {}) });
  }
  #unreadable = '';
  framesBad = $state(null);   // {url, text}: this video's frames could not be read (framesUnreadable)
  #scrubStop() { clearTimeout(this.#scrubIdle); this.#scrubT = this.#hiddenMs = this.#scrubNext = null; this.#scrubGen++; this.#scrubLive++; this.scrubbing = false; }
  /** Scrubber for the current media (on the scrub cache once it exists), built once on first hover scrub;
   *  unsupported -> quiet note, seek path. */
  #startScrubber() {
    if (this.#scrubInit) return;
    const st = this.app?.settings, be = this.app?.backend, url = this.url, file = this.#scrubFile, ac = (this.#scrubAbort = new AbortController());
    const ringS = +st?.get?.('video.scrubRingS', 3) || 3, hw = st?.get?.('video.scrubHw', false) === true;
    // paw-b88b: a source the reader cannot take as it is (WebM / VP8, Theora, ...) reads a proxy, else a transcode, unless the
    // scrub cache is on its way (it replaces this scrubber when ready): hover scrub seeks until then
    const sc = this.scrubCache, coming = !file && sc?.src === this.media?.path && (sc.state === 'building' || sc.state === 'ready');
    const src = file ? { url: be?.mediaUrl ? be.mediaUrl(file) : toUrl(file), path: file } : { url, path: this.media?.path, alts: this.frameFiles(), transcode: !coming, task: (l, o) => this.app?.task?.(l, o) };
    this.#scrubInit = createScrubber({ ...src, fps: this.fps, ringS, hw, backend: be, signal: ac.signal }).then(
      (s) => {
        if (this.url !== url || ac.signal.aborted) return s.dispose();
        s.intra = !!file;
        this.#scrubber?.dispose(); this.#scrubber = s;   // the scrub cache's scrubber replaces the source one
        // paw-bf4o: the clock stays the probe's (one grid with the lanes, lane.js frameAt); the scrubber is asked mid-frame (askTime)
      },
      (e) => {
        if (this.url !== url || ac.signal.aborted) return;
        if (file && this.#scrubber) { console.info('[video] scrub cache not usable:', e?.message || e); return; }   // keep the source scrubber
        this.#scrubFail = e;
        console.info('[video] hover scrub uses video seeks:', e?.message || e);
        // paw-e3tu: the plan ran out (scrub.js plain; not while the scrub cache is on its way: it replaces this one): the warning,
        // once per video, with its fix; else (no WebCodecs, the cache coming ...) a quiet note, the reason in the console only.
        // Never "codec not decodable" for what was not a codec (a release build's blocked reads said that).
        if (e?.plain && !coming) this.framesUnreadable(e.plain);
        else this.app?.toast?.('Hover scrub: video seeks', 'quiet');
      });
  }

  // ---- scrub cache (backend.scrubCache: all-intra copy in the media cache, so any jump decodes one frame) ----
  /** Start (or fetch from the media cache) the scrub cache of the file playing in the background; force = even with
   *  setting video.scrubCache off. One build at a time: a build for another file is cancelled. paw-mh1a: a proxy playing
   *  gets its own, from the proxy (its size, lighter on heavy files); the media cache keys entries by file, so the original's
   *  and each proxy's stay side by side and switching back and forth fetches, never rebuilds. */
  buildScrubCache(force = false) {
    const app = this.app, be = app?.backend, m = this.media, src = m?.path, sc = this.scrubCache;
    if (!be?.scrubCache || !src) return;
    if (sc?.src === src && sc.state === 'building') return;
    const had = sc?.src === src && sc.state === 'ready';   // asked again: instant while cached, rebuilt if evicted
    if (!force && !had && (app.settings?.get?.('video.scrubCache') === false || (sc?.src === src && sc.state === 'too_large'))) return;
    this.#scJob?.cancel();
    let task = null;
    const job = (this.#scJob = be.scrubCache(src, { onProgress: (f) => {
      if (this.#scJob !== job) return;
      task ??= app.task?.('Scrub cache', { cancel: () => job.cancel() });   // not for a cached result (no progress)
      task?.update(Math.round(f * 100), 100);
      this.scrubCache = { src, state: 'building', fraction: f };
    } }));
    this.scrubCache = { src, state: 'building', fraction: 0 };
    job.promise.then((path) => {
      if (this.#scJob !== job) return;
      // paw-mh1a: 'scrub-720.mp4': the full size alone would pass the cache limit, so the backend made it smaller
      const h = +(/scrub-(\d+)\.mp4$/.exec(path)?.[1] || 0);
      this.scrubCache = { src, state: 'ready', path, ...(h ? { h } : {}) };
      if (h && task) app?.toast?.(`Scrub cache made at ${h} lines: the full size would pass the cache limit (File › Scrub cache…)`, 'quiet');
      if (this.media?.path === src) this.#useScrubFile(path);
      this.#evicted();
    }, (e) => {
      if (this.#scJob !== job) return;
      const state = e?.code === 'too_large' || e?.code === 'cancelled' ? e.code : 'failed';
      this.scrubCache = { src, state, message: e?.message || String(e) };
      if (state === 'too_large') app?.toast?.('Scrub cache: this video is larger than the cache limit, even made smaller (File › Scrub cache…)', 'warn');
      else if (state === 'failed') console.info('[video] scrub cache failed:', e?.message || e);
    }).finally(() => { task?.end(); if (this.#scJob === job) this.#scJob = null; });
  }
  /** Hover scrub moves to the scrub cache; the current scrubber serves until the new one is up. paw-o60v.8: made now even
   *  before any hover scrub, so a ruler drag's or a held key's first frame is decoded too (one decoder, frames on demand). */
  #useScrubFile(path) {
    if (this.#scrubFile === path) return;
    this.#scrubFile = path;
    if (!this.el) return;   // no pane (a tab in the background): attach makes it
    if (!this.#scrubInit) return this.#startScrubber();
    if (!this.#scrubber) this.#scrubAbort?.abort();   // a source scrubber still being made (or failed): drop it
    this.#scrubInit = null; this.#scrubFail = null;
    this.#startScrubber();
  }
  /** The media cache was cleared: back to the source for hover scrub. */
  scrubCacheCleared() {
    if (this.scrubCache?.state === 'building') return;   // clearing skips the entry being built
    this.scrubCache = null;
    if (!this.#scrubFile) return;
    this.#scrubFile = null; this.#scrubAbort?.abort(); this.#scrubber?.dispose(); this.#dropStill();
    this.#scrubber = this.#scrubInit = this.#scrubFail = null;
  }
  /** Media cache limit (setting media.cacheGb, GiB) -> backend; resolves {path, bytes, entries, limit} | null. */
  setCacheLimit(gb) {
    const be = this.app?.backend;
    return Promise.resolve(be?.mediaCacheLimit?.(gb * 2 ** 30)).then((i) => { this.#evicted(); return i ?? null; }, () => null);
  }
  /** paw-mh1a: one usage line per media-cache entry evicted (least recently used first; never the open video's): kind, size, age. */
  #evicted() {
    const be = this.app?.backend, u = this.app?.usage;
    if (!be?.mediaCacheEvicted || !u) return;
    Promise.resolve().then(() => be.mediaCacheEvicted()).then((list) => {
      for (const e of list || []) u.note('media:evicted', { what: e.kind, mb: Math.round(e.bytes / 2 ** 20 * 10) / 10, ageH: Math.round(e.age_s / 360) / 10 });
    }, () => {});
  }

  /** Step n frames (negative = back), landing on exact frames. Pauses playback. */
  async step(n = 1) {
    this.restMs = null; this.scrubTime = null;   // a frame step lands on a frame start
    if (this.#timerClock) { this.pause(); return this.#seekRaw(this.clock.timeOf(this.clock.frameAt(this.timeMs) + n)); }
    if (!this.ready || !n) return this.timeMs;
    if (this.shuttle) this.#stopShuttle();
    // paw-o60v.8: a held key (a step within 150 ms of the last, or while it still lands): that frame decoded now, one <video>
    // seek once the key rests; a single step seeks as before
    const now = performance.now(), held = this.el.paused && !this.playing && (this.seeking || this.#scrubT || now - this.#lastStep < 150) && this.#fast();
    this.#lastStep = now;
    if (!this.el.paused) { this.#noSnap = true; this.el.pause(); this.targetFrame = this.frame; }   // from the frame on screen
    if (this.direct && held) {
      const k = clamp((this.#scrubT?.n ?? this.targetFrame ?? this.frame) + n, 0, this.last);
      this.scrub(this.clock.timeOf(k), { frame: k });
      return this.clock.timeOf(k);
    }
    if (this.direct) return this.seekFrame((this.targetFrame ?? this.frame) + n);
    this.#probe += n;
    if (this.#probing) return this.timeMs;
    this.#probing = true;
    try {
      while (this.#probe && this.el) {
        const dir = Math.sign(this.#probe); this.#probe -= dir;
        const cur = this.timeMs, delta = this.isVfr ? Math.min(this.learnedMs ?? UNKNOWN_DELTA, UNKNOWN_DELTA) : (this.learnedMs ?? UNKNOWN_DELTA);
        if (dir < 0) {
          if (cur <= TOL_MS) { this.#probe = 0; break; }
          await this.#seekRaw(probeBack(cur, delta));
        } else {
          for (let i = 1; i < 2000; i++) {
            const t = probeForward(cur, delta, i);
            if (t >= this.durationMs - 0.5) { this.#probe = 0; break; }
            await this.#seekRaw(t);
            if (this.timeMs > cur + 0.01) break;
          }
        }
        const d = Math.abs(this.timeMs - cur);
        if (d > 1 && (this.learnedMs == null || d < this.learnedMs)) { this.learnedMs = d; this.#rebuild(); }
      }
    } finally { this.#probing = false; }
    return this.timeMs;
  }

  // ---- transport ----
  play() {
    this.restMs = null; this.scrubTime = null; this.heldFrame = -1;   // paw-somq: a held frame (a lane click) would pin the frame cursor
    const el = this.el;
    if (!el || !this.url) return this.#timerPlay();
    if (this.error) return;
    if (this.scrubbing) { const t = this.timeMs; this.#scrubStop(); this.seek(t); }   // play from the scrubbed frame
    this.#stopAt = null;
    if (this.rate < STEPPED_BELOW) { this.#startShuttle(this.rate); return; }
    if (this.shuttle) this.#stopShuttle();
    const start = loopStart(this.timeMs, this.loop);
    if (start !== this.timeMs) this.seek(start);
    else if (this.frame >= this.last) this.seekFrame(0);
    el.playbackRate = this.rate;
    this.#measureVsync();
    el.play().catch((e) => { if (e?.name !== 'AbortError') this.error = { code: -1, message: 'Playback failed: ' + e.message, canProxy: false }; });
  }
  /** Refresh interval = smallest of 3 rAF deltas (a skipped frame only makes one larger). Loop/stop lookahead. */
  #measureVsync() {
    let last = 0, n = 0, best = 50;
    const tick = (t) => { if (last) best = Math.min(best, t - last); last = t; if (++n < 4) requestAnimationFrame(tick); else this.#vsync = Math.max(4, best); };
    requestAnimationFrame(tick);
  }
  pause() {
    this.#stopAt = null;
    if (!this.hasVideo) { this.playing = false; cancelAnimationFrame(this.#timer); return; }
    if (this.shuttle) { this.#stopShuttle(); return; }
    this.el?.pause();
  }
  toggle() { this.playing ? this.pause() : this.play(); }

  /** No video (script-only editing): a clock advancing on animation frames, honouring rate and loop. */
  #timerPlay() {
    if (this.playing || !this.durationMs) return;
    if (this.timeMs >= this.durationMs) this.timeMs = this.loop ? this.loop.t0 : 0;
    this.timeMs = loopStart(this.timeMs, this.loop);
    this.playing = true;
    let last = performance.now();
    const tick = (now) => {
      if (!this.playing || this.hasVideo) return;
      let t = this.timeMs + (now - last) * this.rate; last = now;
      if (this.loop && t >= this.loop.t1) t = this.loop.t0;
      if (t >= this.durationMs) { t = this.durationMs; this.playing = false; }
      this.anchor = { ms: t, perf: now, rate: this.rate, playing: this.playing };
      this.timeMs = t; this.frame = this.clock.frameAt(t);
      this.#emit('frame', t);
      if (this.playing) this.#timer = requestAnimationFrame(tick);
    };
    this.#timer = requestAnimationFrame(tick);
  }
  /** Back to the frame on screen and stopped, whatever was playing. */
  stop() { this.pause(); }

  setRate(r) {
    r = clamp(r, RATES[0], 4);
    const wasStepped = this.shuttle > 0;
    this.rate = r;
    if (this.el && r >= STEPPED_BELOW) this.el.playbackRate = r;
    if (wasStepped || (this.playing && r < STEPPED_BELOW)) { this.#stopShuttle(); this.play(); }
  }
  faster() { this.setRate(RATES.find((r) => r > this.rate + 1e-9) ?? 4); }
  slower() { this.setRate([...RATES].reverse().find((r) => r < this.rate - 1e-9) ?? RATES[0]); }
  resetRate() { this.setRate(1); }

  /** JKL shuttle. j: reverse (again = faster, to -4x), k: stop, l: forward (again = faster, to 4x). */
  jkl(key) {
    if (key === 'k') return this.pause();
    if (key === 'l') {
      if (this.playing && !this.shuttle) return this.setRate(Math.min(4, Math.max(1, this.rate * 2)));
      if (this.shuttle > 0) return this.#startShuttle(Math.min(4, this.shuttle * 2));
      if (this.shuttle) this.#stopShuttle();
      return this.play();
    }
    if (key === 'j') this.#startShuttle(this.shuttle < 0 ? Math.max(-4, this.shuttle * 2) : -1);
  }

  /** Stepped shuttle: frame-accurate seeks paced by wall time (reverse play, and forward below 0.1x). */
  #startShuttle(speed) {
    const el = this.el;
    if (!el) return;
    if (!el.paused) { this.#noSnap = true; el.pause(); }
    cancelAnimationFrame(this.#shuttleRaf);
    this.shuttle = speed; this.playing = true;
    let t0 = this.timeMs, p0 = performance.now(), lastK = this.frame;
    const tick = () => {
      if (!this.shuttle) return;
      let t = t0 + (performance.now() - p0) * this.shuttle;
      const lp = this.loop;
      if (lp && this.shuttle > 0 && t >= lp.t1) { t0 = t = lp.t0; p0 = performance.now(); }
      if (lp && this.shuttle < 0 && t < lp.t0 && t0 >= lp.t0) { t0 = t = lp.t1 - this.frameMs / 2; p0 = performance.now(); }
      if (t <= 0 || t >= this.durationMs) { this.seek(clamp(t, 0, this.durationMs)); this.#stopShuttle(); return; }
      const k = this.clock.frameAt(t);
      if (k !== lastK && !this.q.pending) { lastK = k; this.seek(t); }
      this.#shuttleRaf = requestAnimationFrame(tick);
    };
    this.#shuttleRaf = requestAnimationFrame(tick);
  }
  #stopShuttle() {
    cancelAnimationFrame(this.#shuttleRaf); this.#shuttleRaf = 0;
    if (this.shuttle) { this.shuttle = 0; this.playing = !!this.el && !this.el.paused; }
  }

  /** Loop playback over {t0, t1} (null = off). */
  setLoop(loop) { this.loop = loop && loop.t1 > loop.t0 ? { t0: loop.t0, t1: loop.t1 } : null; }

  /** Play [t0, t1) once and stop on its last frame; returnTo = where to park afterwards. */
  playRange(t0, t1, returnTo = null) {
    if (!(t1 > t0) || !this.el) return;
    this.#stopShuttle();
    const go = () => { this.#stopAt = { t1, returnTo }; this.el.playbackRate = Math.max(STEPPED_BELOW, this.rate); this.#measureVsync(); this.el.play().catch(() => {}); };
    this.seek(t0).then(go);
  }
  /** Preroll: play from `pre` ms before the playhead to `post` after, then come back. */
  playAround(pre = this.ui.preroll, post = this.ui.postroll) {
    const t = this.timeMs;
    this.playRange(Math.max(0, t - pre), Math.min(this.durationMs, t + post), t);
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1); this.muted = this.volume === 0 ? this.muted : false;
    if (this.el) { this.el.volume = this.volume; this.el.muted = this.muted; }
    this.app?.settings?.set?.('video.volume', this.volume); this.app?.settings?.set?.('video.muted', this.muted);
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.el) this.el.muted = this.muted;
    this.app?.settings?.set?.('video.muted', this.muted);
  }

  // ---- frames out: hover previews, waveform, still frames ----
  /**
   * Thumbnail of the frame at ms, h px tall: ImageBitmap | null (superseded / failed). Exact frames come from a
   * hidden second <video> (LRU cached); opts.tolMs > 0 accepts the backend's thumbnail strip tile within that
   * distance (instant, once the strip is built).
   */
  getFrame(ms, h = 90, opts = {}) {
    if (!this.url) return Promise.resolve(null);
    if (!this.#preview) {
      const be = this.app?.backend, url = this.url;
      this.#preview = createPreview({ url, frameMs: this.frameMs, sheetUrl: (p) => (be?.mediaUrl ? be.mediaUrl(p) : toUrl(p)) });
      if (be?.thumbnailStrip && this.media?.path) {
        const pv = this.#preview;
        // one strip per video, proxy or not
        be.thumbnailStrip(this.media.proxyOf || this.media.path, { height: 90 }).promise.then((strip) => { if (this.#preview === pv) pv.setStrip(strip); }, () => {});
      }
    }
    return this.#preview.getFrame(ms, h, opts);
  }
  /**
   * paw-3fal: frame n (the clock's index) exactly, h px tall: ImageBitmap | null (superseded by a newer still, or failed).
   * Asked at the frame's middle (askTime), never its start, which the file's rounded sample times can put in the frame
   * before. Its own WebCodecs decoder on the scrub cache (all-intra: any frame is one decode), never the hover scrub's; no
   * scrub cache (building, off, too large) or no WebCodecs: the hidden <video> (getFrame, exact). One at a time: await each.
   */
  async still(n, h) {
    const t = askTime(n, this.clock), s = await this.#stillSrc();
    if (!s || s.error) return this.getFrame(t, h);
    const f = await s.frameAt(t);
    if (!f) return null;
    return createImageBitmap(f, { resizeWidth: Math.max(1, Math.round((h * f.displayWidth) / f.displayHeight)), resizeHeight: h, resizeQuality: 'high' });
  }
  #stillSrc() {
    const file = this.#scrubFile, be = this.app?.backend;
    if (!file) return null;
    if (this.#still?.file !== file) {
      this.#dropStill();
      this.#still = { file, p: createScrubber({ url: be?.mediaUrl ? be.mediaUrl(file) : toUrl(file), path: file, fps: this.fps, ringS: 0, backend: be }).catch(() => null) };
    }
    return this.#still.p;
  }
  #dropStill() { this.#still?.p.then((s) => s?.dispose()); this.#still = null; }
  /** Audio min/max pyramid for the waveform lane (waveform.js); cached per source. */
  waveform() {
    if (!this.url) return Promise.resolve({ error: 'No media.' });
    return (this.#wave ??= loadWaveform({ url: this.url, path: this.media?.proxyOf || this.media?.path, backend: this.app?.backend }));   // the original's sound (a proxy's is re-encoded)
  }
  /** The frame on screen as a PNG blob at full resolution (null if the canvas is tainted). */
  async frameBlob() {
    const el = this.el;
    if (!el || !this.vw) return null;
    const c = Object.assign(document.createElement('canvas'), { width: this.vw, height: this.vh });
    c.getContext('2d').drawImage(el, 0, 0);
    try { return await new Promise((r) => c.toBlob(r, 'image/png')); } catch { return null; }
  }
  /** Media time to hand the backend for "this frame": its middle, so rounding can't pick a neighbour. */
  #frameTime() { return this.direct ? seekTimeOf(this.clock, this.frame) : this.timeMs + 0.1; }
  async copyFrame() {
    const be = this.app?.backend;
    try {
      let blob = await this.frameBlob();   // same-origin video (harness); in Tauri the canvas is tainted
      if (!blob && be?.extractFrame && this.media?.path) blob = new Blob([await be.extractFrame(this.media.proxyOf || this.media.path, this.#frameTime(), { format: 'png' })], { type: 'image/png' });
      if (!blob) throw new Error('no frame');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      this.app?.toast?.(`Frame ${this.frame} copied`, 'ok');
    } catch (e) { this.app?.toast?.('Could not copy the frame: ' + (e?.message || e), 'error'); }
  }
  async saveFrame() {
    const be = this.app?.backend, name = (this.media?.name || 'frame').replace(/\.[^.]+$/, '') + `_f${String(this.frame).padStart(5, '0')}.png`;
    if (be?.saveFrame && be.saveDialog && this.media?.path) {
      try {
        const dir = this.media.path.replace(/[^\/]*$/, '');
        const dest = await be.saveDialog({ defaultPath: dir + name, filters: [{ name: 'Image', extensions: ['png', 'jpg'] }] });
        if (!dest) return;
        const r = await be.saveFrame(this.media.proxyOf || this.media.path, this.#frameTime(), dest);
        const saved = r?.path || dest;
        this.app?.toast?.('Saved ' + saved.split(/[\\/]/).pop(), 'ok', { tip: saved });   // the name; the full path in its tooltip (paw-p8o2)
      } catch (e) { this.app?.toast?.('Save failed: ' + (e?.message || e), 'error'); }
      return;
    }
    const blob = await this.frameBlob();
    if (!blob) { this.app?.toast?.('Could not read the frame.', 'error'); return; }
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
}
