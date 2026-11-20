# features/video — video pane, player controller, overlays, simulator, previews

The shell builds `app.player` from `player.svelte.js` (`PlayerClass` in `src/app/boot.js`) and mounts
`VideoPane.svelte` (`{app}`) in the main area. Everything else here is reached through `app.player`.

## app.player (Player)

Reactive (`$state`):

| field | meaning |
|---|---|
| `timeMs` | media time (ms, float) of the frame **on screen**, from `requestVideoFrameCallback` |
| `frame`, `frameCount`, `exact` | its index; `exact` = indices are trustworthy (probe fps on CFR, or a VFR frame table) |
| `displayMs`, `pendingMs`, `seeking` | latest requested seek target while seeking (show this while scrubbing) |
| `fps`, `frameMs`, `isVfr`, `durationMs`, `vw`, `vh`, `ready`, `hasAudio`, `url` | media facts |
| `playing`, `rate`, `shuttle` | rate 0.025..4 (below 0.1 = frame-by-frame slow shuttle); `shuttle` < 0 = reverse |
| `loop` | `{t0, t1}` or null: playback wraps (frames with pts in [t0, t1)) |
| `volume`, `muted`, `error` (`{message, canProxy, busy?, cancel?}`), `stats` | |
| `view` | `{mode:'fit'|'fill'|'1:1'|'custom', zoom, panX, panY, rot, flipH, flipV}` (assign a new object) |
| `ui` | persisted pane settings (`sim`, `simSide`, `simWidth`, `simFold`, `simLead`, `simLimit`, `guides`, `letterbox`, `timeFmt`, `hud`, `preroll`, `postroll`); change with `setUi(patch)` |

Methods: `seek(ms)` → Promise (shows the frame containing ms; rapid calls coalesce, resolves when the latest
is on screen), `seekFrame(k)`, `step(n)` (exact frames; pauses), `play() pause() toggle() stop()`,
`setRate(r) faster() slower() resetRate()`, `jkl('j'|'k'|'l')`, `setLoop(l)`, `playRange(t0, t1, returnTo?)`,
`playAround(pre?, post?)`, `setVolume(v) toggleMute()`, `now()` (interpolated media ms between frames for smooth
drawing; exact when paused), `frameAt(ms)`, `timeOfFrame(k)`, `snap(ms)`, `on(type, fn)` → off
(`'frame' | 'seeked' | 'play' | 'pause' | 'source' | 'loop'`), `getFrame(ms, h, {tolMs})` → ImageBitmap|null
(hover thumbnails; `tolMs` > 0 accepts the backend strip tile that close), `still(n, h)` → ImageBitmap|null
(frame index n exactly, asked at its middle: its own decoder on the scrub cache, else the hidden `<video>`; the
filmstrip's cut tiles; one at a time), `waveform()` → pyramid|{error}
(`waveform.js` `peaks(pyr, t0, t1, cols)` for drawing), `copyFrame() saveFrame() makeProxy(h?) cancelProxy() useProxy(h)` (see Proxies).
Without a video it runs a timer clock (script-only editing).

Frame times: an action at `Math.round(timeMs)` maps back to its frame (`frameAt` accepts 0.6 ms early).

## Hover scrub (`scrub.js`)

`player.scrub(ms)` (called by the lanes when `lanes.hoverScrub` is on) shows every frame without seeking the
`<video>`: a WebCodecs `VideoDecoder` is kept positioned (forward inside a GOP = one chunk per frame step), the
last `video.scrubRingS` seconds (default 3, capped at 384 MB) of decoded frames sit in a ring (backward = instant),
anything else decodes from the keyframe at or before the target (non-reference pictures far from the target are
skipped). Frames are drawn on a canvas with the video's box and matrix; `timeMs`/`frame` follow them (`scrubbing`
is true), so overlays and readouts track the scrub. ~120 ms after the last move, or when the pointer leaves the
lanes, one real `seek()` lands the video there and the canvas drops once it presents the frame. Any other seek or
`play()` ends the scrub. MP4/MOV is demuxed with `mp4box` over ranged `fetch` of the `<video>` URL (Tauri's asset
protocol answers at most 1000 KiB per range); other containers are stream-copied by `backend.remuxMp4` (cached).
paw-b88b: `framePlan` decides per source from the probed codec: H.264 / HEVC / VP9 / AV1 are copied; VP8, Theora,
MPEG-2 ... (no MP4 tag, or no WebCodecs decoder) are never copied. When a source cannot be read as it is, the reader
tries the MP4s already in the media cache with the same frames (`player.frameFiles()`: the ready scrub cache, the
proxies; both H.264, frame N at the source's time from the first frame), then asks the shell for an H.264 transcode
(`remuxMp4({h264})`, status-bar task "Frame copy"; shells before paw-b88b cannot, and copy again). One job per video is
shared by every reader. Nothing works: `UNREADABLE` ("Frames of this video cannot be read yet: make a proxy"), once per
video as a toast with "Make a proxy" (`player.framesUnreadable`) and in Copy from's strip; the reasons, ffmpeg's own
words among them, only in the console and the usage log. The player's own hover scrubber does not start a transcode
while its scrub cache is being made (it replaces the scrubber when ready).
Software decoding first (frames in RAM); `video.scrubHw: true` tries the hardware decoder first (frames copied to
ImageBitmaps: a hardware decoder stalls while its dozen output frames are held). HEVC has no software decoder in
WebView2, so it always goes hardware. No step of the plan could read it: the warning once per video
(`UNREADABLE`, with Make a proxy); the webview refused the reads themselves (a fetch that rejects: a release build's
CSP without `http://asset.localhost` in `connect-src`, paw-e3tu): the plan stops at once (no transcode) and says
`BLOCKED` (no proxy button: a proxy is read the same way); otherwise (no WebCodecs, the scrub cache on its way) a quiet
"Hover scrub: video seeks"; the reasons go to the console; the old seek per move either way. paw-trxk: mp4box reads box types outside printable ASCII (`allowInvalidBoxTypes`): an editor's `udta/©TIM` in an `mp42` file used to make it drop the whole moov, so such a video had no frame decoder at all (no hover scrub on the source, no Copy from search, no crop / loop links); the shot links and Copy from now fall back to `player.still` when a file has no decoder. `player.scrubStats` = counters or the reason.

paw-o60v.8: dragging the playhead (the ruler, a lane's playhead drag, an action region's edge: `player.dragTo(ms, {snap})`)
and a held frame-step key (a step within 150 ms of the last, or while it still lands) go the same way while paused, once
the scrub cache's decoder is up at full size (`scrub(ms, {frame})`: that frame exactly, no hold; the release / rest lands
one `seek` / `seekFrame`). Its decoder is made as soon as the cache is ready. paw-o60v.8.1: what shows where the script /
machine is at the picture (PosBar, Simulator, Sr6View, the Machine panel paused) reads `player.shownMs`, the frame on screen
(= `timeMs`, set wherever a frame is shown: a presented frame, a decoded scrub frame), never the playhead's requested time
(`displayMs` / `scrubTime`), which runs ahead of the picture while a frame is fetched; the playhead line and the time readouts
stay on the playhead. While the canvas shows decoded frames, a
`<video>` seek still landing does not move `timeMs` (the overlays stay on the frame drawn). No cache yet, cache off,
made smaller or refused, or playing: a seek per move / step, as before. Checked by `dev/ruler-scrub-check.mjs`.

## Proxies (paw-nydn, `backend.transcodePreview`)

Any video can play from a proxy: the transport's film button (label: `Original` / `480p` / the progress) lists the
sizes (the source's height, 1080, 720, 480, none above the source: `transport.js proxySizes`), which ones are in the
media cache, and plays the original or one of them; File › "Make a proxy of this video" / "Play the proxy" / "Play the
original" too. `makeProxy(h)` runs in the background (status-bar task, Cancel; `proxyJob = {h, fraction}`; the error
card shows it too when the original cannot play), then `useProxy(h)` swaps the `<video>` and lands on the frame that was
showing. The choice is kept per video in settings `video.proxy:<path>` = `{use, of: 'size:mtime_ms' of the source, made:
{h: path}}`; opening the video plays the chosen proxy again without re-encoding when its cache entry is still complete
(`done`) and the source unchanged, else the original plays and the button turns amber with "make it again"
(`proxyLost`). Usage log `video:proxy {act: made|use|cancelled|failed, h, s, cached, codec}`.

What reads what: the `<video>`, hover scrub, the scrub cache and `still()` on it (paw-mh1a: a proxy playing gets its
own scrub cache, made from the proxy), and the frame readers built on `app.player.url` (shot / loop links, Copy from)
read the proxy; the thumbnail strip, the waveform, copy / save frame, and everything on the sidecar (tracking, groups, describe, cuts, loops: they take
`app.doc.media.path`) read the original. The clock is always the source's frame table (`proxyOf`; the proxy's video
starts at 0, `#proxyStart`), so frame numbers, times and normalised coordinates are the same on both:
`dev/proxy-frames-probe.mjs` (CFR, NTSC with B-frames, VFR, late-starting MP4 / TS, AVI) finds every frame at its
time and with its own picture.

## Scrub cache (all-intra copy, `backend.scrubCache`)

With `video.scrubCache` on (default), opening a video starts `scrub_cache` in the background (status-bar task
"Scrub cache", cancellable; a cached copy comes back at once, no task). It is an H.264 copy of the video track in
the media cache with **every frame a keyframe**, the source's timestamps and size (≤2160 lines), 8-bit 4:2:0. Once
it is ready the hover scrubber is rebuilt on it (the source scrubber serves meanwhile), so any jump is one frame
decode (`scrubStats.intra`). Frame N of the copy is frame N of the source (timestamps kept): ffmpeg PSNR copy-vs-source
54.9 dB aligned, 30.1 dB one frame off, over all 1800 frames of `dev/assets/assist60.mp4`. paw-mh1a: the copy is
of the file PLAYING: with a proxy, of the proxy (its size: 480 lines is about a fifth of 1080's pixels); the media cache
keys entries by file, so the original's and each proxy's sit side by side and switching fetches, never rebuilds.
Budget (paw-mh1a, with the shell's media-cache patch): one limit for every kind of entry (setting `media.cacheGb`,
default 2 GB), evicted least recently USED first after every new entry, never an entry of the files open now
(`backend.mediaCacheOpen([source, proxy])`, sent on every load); each eviction is a usage line
`media:evicted {what, mb, ageH}`. A copy whose full size alone would pass the limit is made smaller
(`scrub-<height>.mp4`: `scrubCache.h`, said in the dialog and a quiet toast) instead of refused. Encoder: libx264 CRF 18 `-tune fastdecode` first, h264_nvenc QP 19
(`-g 0`) only when x264 is missing or fails: on the 32-thread dev machine, 60 s of Big Buck Bunny 1080p30 took
3.2 s / 258 MB with x264 and 5.3 s / 633 MB with NVENC, and NVENC's bigger frames decoded slower (20 s jumps
30 ms vs 13 ms).

| 60 s clip | build (open → ready) | size | GB / hour | 20 s jumps without → with (mean / p95 ms) |
|---|---|---|---|---|
| assist60 360p | 0.35 s | 5.8 MB | 0.35 | 3.0 / 4.7 → 0.9 / 1.4 |
| synthetic 1080p, 8 s GOP | 1.9 s | 29.5 MB | 1.8 | 109 / 180 → 5.7 / 10.4 |
| Big Buck Bunny 1080p | 3.3 s | 258 MB | 15.5 | 162 / 416 → 13 / 22 |

It is an ordinary cache entry (LRU with the rest). The cache limit is the setting `media.cacheGb` (GiB, default 2,
0.5–512), pushed to the backend with `media_cache_limit` at startup and when changed. A copy that alone would exceed
the limit is stopped as soon as it does, deleted, and reported (`too_large`: a warning toast and the dialog say so;
not retried for that video until "Build now"). File › **Scrub cache…** (`video.scrubCacheDialog`,
`ScrubCacheDialog.svelte`): the switch, the limit, usage, Build now (current video, when not cached), Clear cache.
`player.scrubCache` = `{src, state: 'building'|'ready'|'too_large'|'cancelled'|'failed', fraction?, path?}`;
`player.buildScrubCache(force)`.

## Overlays (`app.player.overlays`, `overlays.svelte.js`)

```js
const off = app.player.overlays.add({ id: 'tracking.runs', order: 10, draw(ctx, env) { /* normalised 0..1 coords via env.map */ } });
app.player.overlays.addTool({ id: 'tracking.roi', cursor: 'crosshair', hint: () => '…', down(p, e) { return true }, move(p, e), up(p, e), context(p, e) });
app.player.overlays.tool = 'tracking.roi';   // null = drag pans
```
`draw` runs inside an effect (reactive reads repaint automatically; else `invalidate()`). `env = {w, h, dpr, vw,
vh, scale, map(nx, ny), unmap(x, y), timeMs, frame, playing, app}`; drawings follow zoom, pan, rotation, flips.
`roi.js` has the ported drawers (`drawRoi`, `drawFrameOverlay`, `drawTagBox`).
`src/features/*/overlay.js` components still work (hosted over the picture's bounding box, so `fitRect` maths
holds under zoom/pan) but not under rotation/flip — prefer the API above.

## Files

`player.svelte.js` controller · `frames.js` frame clock / timecode / loop maths · `seek.js` coalescer · `scrub.js` hover-scrub decoder · `ScrubCacheDialog.svelte` + `modal.js` ·
`view.js` transform maths · `overlays.svelte.js`, `roi.js` · `sim.js`, `simdraw.js`, `Simulator.svelte` ·
`Transport.svelte`, `Hud.svelte`, `transport.js` · `preview.js` · `waveform.js` · `commands.js` · `VideoPane.svelte`.
Harness: `dev/video.html?clip=cfr24|cfr25|cfr2997|cfr30|cfr60|twos24|vfr&probe=0|1&table=0|1` (clips from
`bash dev/assets/make-clips.sh`, every frame's index burned in as a 12-bit code; `window.V.code()` reads it).
Tests: `test/video-*.test.mjs`.
