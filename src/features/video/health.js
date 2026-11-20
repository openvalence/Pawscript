// paw-wfd2.3: the video's conditions for the status bar's health slot (lib/health.js)
const DROP_PCT = 2;   // sustained drops above this (% of frames over the last 10 s of playing) are said
export default [
  { id: 'video.frames', pri: 2, read: (app) => {
    const p = app.player, b = p?.framesBad;
    if (!b || b.url !== p.url) return null;
    const fix = app.backend?.transcodePreview;
    return { tone: 'warn', text: 'Video frames unreadable', tip: b.text, ...(fix ? { action: { label: 'Make a proxy', run: () => p.makeProxy() } } : {}) };
  } },
  // the decoder keeps up with a proxy (smaller, all-intra); never while paused or shuttling
  { id: 'video.drops', pri: 2.5, read: (app) => {
    const p = app.player;
    if (!p?.playing || p.shuttle || !(p.dropPct > DROP_PCT)) return null;
    const fix = app.backend?.transcodePreview;
    return { tone: 'warn', text: `Dropping frames, ${p.dropPct} %`, tip: 'The decoder cannot keep up at this size and rate', ...(fix ? { action: { label: 'Make a proxy', run: () => p.makeProxy() } } : {}) };
  } },
];
