// settings.svelte.js -- persisted settings with a schema of defaults. One documented place: the storage key
// 'pawscript.settings', which main.js maps to the native settings file (src-tauri settings_get / settings_set:
// %APPDATA%\app.pawscript\settings.json); outside Tauri it is localStorage. Unknown keys are kept (a newer build's
// settings survive). One Settings object is shared by every open tab (paw-shgb).

/** Every setting, its default and what it does. Features may use their own keys ('<feature>.<name>'); they
 *  default to whatever the caller passes to get(key, fallback). A key listed here ignores that fallback: its
 *  `default` is today's behaviour, and test/settings-schema.test.mjs checks every literal fallback in src/ against it.
 *
 *  The Settings panel (features/settings) is generated from this table, so each entry also says how it is shown:
 *    group     one of GROUPS (the panel's sections, in that order)
 *    label     the row's name; doc the one-line description (docs/copy.md: at most 60 characters, one fragment,
 *              sentence case, no trailing period). Long rationale lives in the comment above an entry, never in doc.
 *    choices   [[value, label], ...] for an enum (also its validity); min / max / step / unit for a number: the panel's
 *              field only (the features clamp what they read, as before; valid() is what the store refuses); the field
 *              snaps to min + k * step, so the default must sit on that grid; type when the default is null; folder: a folder path (or a list of them)
 *    internal  state rather than a preference (layout blobs, MRU lists, display toggles with their own popover):
 *              only under the panel's "Show advanced"
 *    private   personal (a body size, folder paths): the usage log records the key only, never the value
 *    restart   read once when a tab opens: the change applies to new tabs and after a restart
 *    readonly  shown, not edited in the panel (it has its own editor elsewhere; doc says where)
 *    auto      the app sets it itself (a first-start decision): never marked as changed, no reset */
export const GROUPS = ['General', 'Keyboard', 'Playback & device', 'Video & cache', 'Tracking', 'Models', 'Timeline & lanes', 'Machine & Stroker', 'Projects & tabs', 'Content', 'Updates', 'Advanced'];

const PCT = { min: 0, max: 100, step: 5, unit: '%' };
const ONOFF_BLOB = (label, doc, d = true) => ({ default: d, group: 'Tracking', internal: true, label: 'Tracker view: ' + label, doc });
const OPACITY_BLOB = (label, d) => ({ default: d, ...PCT, group: 'Tracking', internal: true, label: 'Tracker view: ' + label, doc: 'Opacity of this layer' });

export const SCHEMA = {
  // ---------------- General ----------------
  'ui.theme':            { default: 'dark', group: 'General', label: 'Theme', doc: 'Also in the View menu', choices: [['dark', 'Dark'], ['light', 'Light'], ['contrast', 'High contrast']] },
  'ui.density':          { default: 'default', group: 'General', label: 'Density', doc: 'Control, row and lane strip size, also in the View menu', choices: [['compact', 'Compact'], ['default', 'Default'], ['comfortable', 'Comfortable']] },
  // app.svelte.js toast(): an error toast's timeout (it was 9 s, hard-coded); info / ok / warn keep 4 s, quiet 1.4 s
  'ui.toastErrorS':      { default: 9, min: 2, max: 60, step: 1, unit: 's', group: 'General', label: 'Error messages stay', doc: 'Seconds an error toast stays on screen' },
  // onboard/steps.js initHints: a profile with no recent projects gets the hints once; null = not decided yet (so the
  // default must stay null, not false: false would mean "decided off" and a new profile would never see them)
  'onboard.hints':       { default: null, type: 'boolean', auto: true, valid: (v) => typeof v === 'boolean', group: 'General', label: 'First-run hints', doc: 'The next step over the picture, also in the Help menu' },
  'onboard.card':        { default: true, group: 'General', label: 'First steps card', doc: 'The five-step card on an empty Projects page' },
  // what you do (commands, undo, tracker runs, modifiers, tags, settings, toasts, panels, playback) goes to one JSONL file
  // per day, usage-YYYY-MM-DD.jsonl in the local data folder (data_dir in Help > About), and to the Help > Usage report
  // ring. Local only, never uploaded; dev/usage-report.mjs summarises it. The fix log (fixes.jsonl) follows it.
  'usage.log':           { default: true, group: 'General', label: 'Usage log', doc: 'What you do, kept in a daily file on this PC' },
  // onboard/steps.js helpPage: null = decided by the hints (start) or not (keys)
  'help.page':           { default: null, type: 'string', group: 'General', internal: true, label: 'Help page', doc: 'The Help panel’s last page' },
  'onboard.dismissed':   { default: [], group: 'General', internal: true, label: 'Dismissed hints', doc: 'The next-step hints you closed' },

  // ---------------- Keyboard ----------------
  // paw-5z78: how Space, Tab and the arrows behave (app/commands.js keyRoute; docs/guide/keys.md). Never a setting: nothing
  // behind a modal dialog acts on a key, and the panic stop works everywhere.
  // on: the arrows nudge what you selected in an editor (a curve handle, the fusion pad, an anchor, modifiers); off: they
  // always step frames
  'keys.arrowsNudgeSelection': { default: true, group: 'Keyboard', label: 'Arrows nudge the selection', doc: 'Off: the arrows always step frames' },
  // play: play or pause the video (Enter picks); pick: pick the highlighted item, as most apps do
  'keys.spaceInMenus':   { default: 'play', group: 'Keyboard', valid: (v) => v === 'play' || v === 'pick', label: 'Space in menus', doc: 'With a menu or list open: play the video or pick', choices: [['play', 'Play'], ['pick', 'Pick']] },
  // Tab and the arrows move between controls and Space presses the focused one, for working without a mouse; off: they always
  // go to the video and the timeline
  'keys.uiNavigation':   { default: false, group: 'Keyboard', label: 'Keyboard navigation of the interface', doc: 'Tab and arrows move between controls, Space presses' },
  'edit.posStep':        { default: 5, min: 1, max: 50, step: 1, group: 'Keyboard', label: 'Position nudge step', doc: 'How far Shift+Up / Down moves a point' },
  'view.seekStepMs':     { default: 1000, min: 100, max: 60000, step: 100, unit: 'ms', group: 'Keyboard', label: 'Shift+arrow jump', doc: 'How far Shift+Left / Right moves the playhead' },
  // paw-5zpf (app/commands.js PRESETS): which default keys the commands have. blender: the number row picks the lane's selection
  // mode (1 point, 2 segment, 3 stroke, 4 cycle), E extrudes, R rotates, F fills (Refine), . the pivot; points are placed with E,
  // Insert, the pointer or the NumPad digits. ofs: OpenFunscripter's number row places points, R records, , / . step points.
  // Your own rebound keys (keys.overrides) win over either; switching keeps them. An old settings file has none: blender.
  'keys.preset':         { default: 'blender', group: 'Keyboard', valid: (v) => v === 'blender' || v === 'ofs', label: 'Keymap', doc: 'Number row: selection modes (Blender) or points (OFS)', choices: [['blender', 'Blender'], ['ofs', 'OFS']] },
  'keys.overrides':      { default: {}, group: 'Keyboard', internal: true, label: 'Key bindings', doc: 'Your rebound keys, edited in the Shortcuts panel' },
  // features/palette/quick.js: {scenes|track|refine|review|home: [command ids]}, edited by right-clicking a button or menu item
  'quick.lists':         { default: {}, group: 'Keyboard', internal: true, label: 'Quick menus', doc: 'The commands in the Quick menu (Shift+Q) of each tab' },

  // ---------------- Playback & device ----------------
  'player.follow':       { default: true, group: 'Playback & device', label: 'Follow the playhead', doc: 'The timeline scrolls along while playing' },
  'player.rate':         { default: 1, valid: (v) => v >= 0.05 && v <= 16, min: 0.05, max: 16, step: 0.05, unit: '×', group: 'Playback & device', internal: true, label: 'Playback rate', doc: 'The last playback rate' },
  // app/device-preview.svelte.js: what the device profile's kinematics can play, drawn as a ghost (View menu too)
  'view.machinePreview': { default: false, group: 'Playback & device', label: 'Device preview', doc: 'What the device can play, as a ghost on the lane' },
  // the device profile carries the speed limit and range (review/logic/profiles.js); its choices come from the profile
  // list (built in + your own: the panel asks features/review). Device panel and Review › Device and heatmap set it too.
  'review.profile':      { default: 'generic', type: 'string', group: 'Playback & device', label: 'Device profile', doc: 'Speed limit and range of your device' },
  'playback.scrub':      { default: true, group: 'Playback & device', label: 'Device follows scrubbing', doc: 'The device moves while you scrub the video' },
  'playback.invert':     { default: false, group: 'Playback & device', label: 'Invert on the device', doc: 'The device plays 100 as 0 and 0 as 100' },
  'playback.offsetMs':   { default: 0, min: -500, max: 500, step: 5, unit: 'ms', group: 'Playback & device', label: 'Device offset', doc: 'Moves what the device plays earlier or later' },
  'playback.range':      { default: [0, 100], group: 'Playback & device', internal: true, label: 'Device range', doc: 'Part of the stroke the device uses, Device panel' },
  'playback.device':     { default: '', group: 'Playback & device', internal: true, label: 'Last device', doc: 'The device connected last' },
  'review.profiles':     { default: [], group: 'Playback & device', internal: true, label: 'Your device profiles', doc: 'Profiles you made in the Review tab' },
  'video.volume':        { default: 1, min: 0, max: 1, step: 0.05, group: 'Playback & device', internal: true, label: 'Volume', doc: 'The video volume' },
  'video.muted':         { default: false, group: 'Playback & device', internal: true, label: 'Muted', doc: 'The video sound is off' },
  // playback/DevicePanel.svelte: the Valence hub (a WebSocket device server); host and port are an address on your network
  'playback.valence.host': { default: '', type: 'string', private: true, group: 'Playback & device', label: 'Valence hub address', doc: 'Host of the Valence hub, Device panel' },
  'playback.valence.port': { default: 82, min: 1, max: 65535, step: 1, group: 'Playback & device', label: 'Valence hub port', doc: 'Port of the Valence hub, Device panel' },
  'playback.valence.tokens': { default: {}, private: true, group: 'Playback & device', internal: true, label: 'Valence pairing', doc: 'The pairing the hub gave this PC' },
  'playback.valence.instanceId': { default: '', type: 'string', private: true, group: 'Playback & device', internal: true, label: 'Valence instance', doc: 'This PC’s name to the hub' },
  // review/DevicePanel.svelte › Heatmap: the overview heatmap's color scale and its top (0 = the device profile's speed limit)
  'review.heatmapScale': { default: 'heat', group: 'Playback & device', label: 'Heatmap colors', doc: 'Color scale of the speed heatmap', choices: [['heat', 'Heat'], ['viridis', 'Viridis'], ['cividis', 'Cividis'], ['grey', 'Gray']] },
  'review.heatmapMax':   { default: 0, min: 0, max: 2000, step: 10, unit: '/s', group: 'Playback & device', label: 'Heatmap top speed', doc: '0: the device profile’s speed limit' },
  'review.scope':        { default: 'active', group: 'Playback & device', internal: true, label: 'Review checks', doc: 'Problems of the focused lane or of every lane', choices: [['active', 'Focused lane'], ['all', 'Every lane']] },
  'review.strokeMm':     { default: {}, group: 'Playback & device', internal: true, label: 'Stroke window per device', doc: 'The stroke length set for each device profile' },

  // ---------------- Video & cache ----------------
  // probes, peaks, thumbnails, proxies, scrub caches; least recently used entries go first (the open video's never)
  'media.cacheGb':       { default: 2, valid: (v) => v >= 0.5 && v <= 512, min: 0.5, max: 512, step: 0.5, unit: 'GiB', group: 'Video & cache', label: 'Media cache size', doc: 'The oldest entries go first when it is full' },
  // paw-tprc: read by the shell itself from settings.json (commands.rs media_cache_dir) at every cache use: an absolute
  // folder, made if missing; empty or anything else = <app cache>\media-cache. The old folder's entries stay where they are.
  // A shell before paw-shell5 ignores it.
  'media.cacheDir':      { default: '', type: 'string', folder: true, private: true, valid: (v) => typeof v === 'string', group: 'Video & cache', label: 'Media cache folder', doc: 'Empty: in the app data folder' },
  // an all-intra copy of every opened video (hover-scrub jumps decode one frame); features/video/ScrubCacheDialog too
  'video.scrubCache':    { default: true, group: 'Video & cache', label: 'Build a scrub cache', doc: 'Every opened video, for instant hover scrubbing' },
  // features/video/transport.js defaultProxy: the size made when none is picked (was 720, hard-coded), else the largest below it
  'video.proxyHeight':   { default: 720, group: 'Video & cache', label: 'Proxy height', doc: 'Size of a playable copy when none is picked', choices: [[1080, '1080p'], [720, '720p'], [480, '480p']] },
  'video.ui':            { default: null, type: 'object', group: 'Video & cache', internal: true, label: 'Video pane options', doc: 'Guides and the pane options of the video' },
  // video/Sr6View.svelte (paw-jyde.2): the six-axis preview's box, view and exaggeration
  'video.sr6view':       { default: null, type: 'object', group: 'Video & cache', internal: true, label: 'Six-axis preview', doc: 'Its place, view and exaggeration' },

  // ---------------- Tracking ----------------
  // tracking.svelte.js: the tracker a new session starts on (the one picked last; a pick that is not installed, or a
  // greyed one, falls back to TAPNext++ with one note). The panel lists the trackers the tracker sent.
  'tracking.lastTracker': { default: '', type: 'string', group: 'Tracking', label: 'Tracker', doc: 'The tracker Track uses, the one picked last' },
  // tracking.svelte.js listing: a default for each tracker's own 'model' / 'box_points' param where it has one (TAPNext++
  // model: auto = 256, or 512 for a small painted part; 512 is 3.6x slower with twice the VRAM). The run's param still wins.
  'tracking.model':      { default: 'auto', group: 'Tracking', label: 'Model input size', doc: 'TAPNext++: 512 helps small parts, 3.6× slower', choices: [['auto', 'Auto'], ['256', '256'], ['512', '512']] },
  'tracking.boxPoints':  { default: 64, min: 4, max: 4096, step: 4, group: 'Tracking', label: 'Points in the box', doc: 'Points a box or click track seeds' },
  // min / step 16: what the Track menu and the Tracker panel always stepped (one widget, app/Prop.svelte, in both)
  'tracking.gridPoints': { default: 512, valid: (v) => v >= 4 && v <= 4096, min: 16, max: 4096, step: 16, group: 'Tracking', label: 'Grid points', doc: 'Points of Track over the whole picture (T)' },
  // tracking.svelte.js #arrive / lib/rederive.js arrivalShots (paw-lji3): a new run arrives with Smart stroke on where it can
  // fuse; off = it arrives off (a re-track still carries the earlier run's shot settings)
  'tracking.smartStroke': { default: true, group: 'Tracking', label: 'Smart stroke on new runs', doc: 'A new run fuses its parts where it can' },
  // tracking.svelte.js runTrack (paw-l3ec): Track over the span of an earlier run of the same tracker family discards it once
  // the new one took its range; on = the earlier run stays in the list (Track as a new run never replaces either way)
  'tracking.retrackKeep': { default: false, group: 'Tracking', label: 'Re-track keeps the earlier run', doc: 'Off: a re-track replaces the run it covers' },
  // one way from a shot's first (or last) half second goes on into the take beyond its cut, to the next hard cut (paw-bh2)
  'tracking.direction':  { default: 'both', valid: (v) => ['both', 'forward', 'backward'].includes(v), group: 'Tracking', label: 'Track direction', doc: 'From the seed frame: both ways, forward or backward', choices: [['both', 'Both'], ['forward', 'Forward'], ['backward', 'Backward']] },
  'tracking.scenes':     { default: 'document', group: 'Tracking', label: 'Cuts while tracking', doc: 'The timeline’s cuts, found while tracking, or none', choices: [['document', 'Timeline'], ['detect', 'Detect'], ['one', 'None']] },
  // per-point overlays: trails by motion group or direction, the tracker view (value blobs, its options tracking.blobs.*), dots
  'tracking.trails':     { default: 'groups', valid: (v) => ['groups', 'direction', 'blobs', 'off'].includes(v), group: 'Tracking', label: 'Run overlay', doc: 'What a run draws over the video', choices: [['groups', 'Groups'], ['direction', 'Direction'], ['blobs', 'Tracker view'], ['off', 'Dots']] },
  // tracking.svelte.js: a job with no progress this long fails (x4 on the CPU)
  'tracking.stallTimeoutS': { default: 600, min: 30, max: 7200, step: 30, unit: 's', group: 'Tracking', label: 'Stall timeout', doc: 'A track with no progress this long fails' },
  'tracking.shaftData':  { default: false, group: 'Tracking', label: 'Shaft data on the lane', doc: 'The shaft’s own trace on the Track lane' },
  // seed library (paw-bn2): folders whose .pawproj files (not in subfolders) the learned seeder trains on; their painted groups
  // (and accepted / fixed suggestions) are its labels. Empty = the folders of the recently opened videos and projects; the
  // current project is always included.
  'tracking.seeder.folders': { default: [], valid: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'), folder: true, private: true, group: 'Tracking', label: 'Seed library folders', doc: 'Projects the seeder learns from, empty = recent ones' },
  // paw-26iv, PROTOCOL v4.28: auto = taggerine when its optional pack is installed (trackers/.cache/taggerine) and a GPU is
  // there, else Hydra (built in). Changing it makes the next Train retrain the head (it is only used with its own features).
  'tracking.seeder.features': { default: 'auto', valid: (v) => ['auto', 'hydra'].includes(v), group: 'Tracking', label: 'Seeder features', doc: 'Auto: taggerine when installed, else Hydra', choices: [['auto', 'Auto'], ['hydra', 'Hydra']] },
  // paw-26iv / paw-r6t0 (PROTOCOL v4.34): the seeder locates a part and SAM 2 draws it from the seeder's peak (needs SAM;
  // where SAM disagrees the seeder's blob is used, cleaned and smoothed); off = the seeder's blob, cleaned and smoothed.
  'tracking.seeder.sam': { default: true, group: 'Tracking', label: 'SAM 2 draws found parts', doc: 'Off: the seeder’s own outline, cleaned' },
  'tracking.groups.collapsed': { default: false, group: 'Tracking', label: 'Groups bar folded', doc: 'Also the fold button at the top of the bar' },
  'tracking.groups.brush': { default: 0.04, min: 0.005, max: 0.25, step: 0.005, group: 'Tracking', label: 'Brush size', doc: 'Brush radius as a share of the frame height' },
  // GroupsOverlay.svelte .gdock: the bar's background over the picture (was 48 %, hard-coded); its icons stay solid
  'tracking.groups.barOpacity': { default: 48, min: 10, max: 100, step: 2, unit: '%', group: 'Tracking', label: 'Groups bar opacity', doc: 'How solid the bar’s background is over the picture' },
  'tracking.groups.askAfter': { default: false, group: 'Tracking', label: 'Name a group after painting', doc: 'The part picker opens after each new group' },
  // paw-iwb7: asked for by the owner ("move my cursor to the paint area"): Tab over the timeline (hover scrub on) puts the OS pointer
  // on the picture, where the take was last painted, else its middle. The frame under the pointer is taken either way.
  'tracking.groups.tabPointer': { default: true, group: 'Tracking', label: 'Tab moves the pointer to the picture', doc: 'Tab over the timeline: the pointer jumps onto the picture' },
  'tracking.groups.autoFromRepeats': { default: true, group: 'Tracking', label: 'Fill takes from repeats', doc: 'An empty take gets the groups of a repeated frame' },
  'tracking.groups.circle': { default: false, group: 'Tracking', label: 'Circle to fill', doc: 'Loop a part with the brush to fill it' },
  'tracking.groups.grow': { default: false, group: 'Tracking', label: 'Grow', doc: 'Dab a part, SAM finds its outline' },
  'tracking.groups.snap': { default: false, group: 'Tracking', label: 'Edge snap', doc: 'Brush strokes snap to the part’s edges' },
  'tracking.groups.snapStrength': { default: 50, min: 0, max: 100, step: 5, unit: '%', group: 'Tracking', label: 'Edge snap strength', doc: 'How hard a stroke is pulled to an edge' },
  // features/tracking/snap.js MARGIN_DEFAULT: about 0.45 mask px on a large part, just off the dark outline pixels
  'tracking.groups.margin': { default: 15, min: 0, max: 100, step: 5, unit: '%', group: 'Tracking', label: 'Edge margin', doc: 'How far inside a snapped edge the paint stops' },
  'tracking.groups.pulse': { default: true, group: 'Tracking', label: 'Pulse the active group', doc: 'Off: its outline stays still' },
  // GroupsOverlay.svelte / group-labels.js (paw-6m6o, asked for by the owner: a dozen names piled up): smart = full names for the
  // active, hovered and '?' groups, a short tag ('RS', 'LT2') for the rest; all = every name; none = the hovered one's as a tip.
  // Every label sits clear of the others. Shift+H (tracking.groupsLabels) cycles it
  'tracking.groups.labels': { default: 'smart', group: 'Tracking', label: 'Group labels', doc: 'Smart: names for the active, hovered and unsure', choices: [['smart', 'Smart'], ['all', 'All'], ['none', 'None']] },
  // paw-c1m1: how painted parts look (features/tracking/group-look.js); a look only, nothing stored or tracked changes
  'tracking.groups.ditherCell': { default: 4, min: 2, max: 16, step: 1, unit: 'px', group: 'Tracking', label: 'Dither cell size', doc: 'One cell size for every part' },
  'tracking.groups.ditherDot': { default: 100, min: 30, max: 100, step: 5, unit: '%', group: 'Tracking', label: 'Dot size', doc: 'The filled share of each cell; less leaves gaps' },
  'tracking.groups.ditherOpacity': { default: 92, min: 10, max: 100, step: 2, unit: '%', group: 'Tracking', label: 'Fill opacity', doc: 'How solid the dither dots are over the picture' },
  'tracking.groups.fill': { default: 'dither', group: 'Tracking', label: 'Group fill', doc: 'Dither: dots thinning along each limb; Hatch: lines', choices: [['dither', 'Dither'], ['hatch', 'Hatch'], ['gradient', 'Gradient'], ['flat', 'Flat']] },
  'tracking.suggest.confidence': { default: 0.8, min: 0.3, max: 1, step: 0.05, group: 'Tracking', label: 'Suggest confidence', doc: 'Suggested groups below this are hidden' },
  // channel fit overrides (lib/runs-channel.js CHANNEL_FIT: fit run | scene | rolling, sigmaMs, minProminence, maxGapMs)
  'tracking.channelFit': { default: {}, valid: (v) => !!v && typeof v === 'object', group: 'Tracking', internal: true, label: 'Channel fit', doc: 'How a lane channel pick becomes points' },
  // retired (paw-9qm): the Tracker lane no longer draws the motion-group traces; kept so saved settings load
  'tracking.laneGroups': { default: true, group: 'Tracking', internal: true, label: 'Lane group traces', doc: 'Retired, kept so older settings load' },
  'tracking.dock.hidden': { default: [], valid: (v) => Array.isArray(v), group: 'Tracking', internal: true, label: 'Tracker dock hidden', doc: 'Channels whose points the tracker dock hides' },
  // tracking/folds.js: which folds of the Tracker panel are open ({fold id: true})
  'tracking.panel.open': { default: {}, group: 'Tracking', internal: true, label: 'Tracker panel folds', doc: 'Which folds of the Tracker panel are open' },
  'tracking.dock.collapsed': { default: false, group: 'Tracking', internal: true, label: 'Tracker dock icons only', doc: 'The tracker dock as a narrow strip' },
  // blobs view display options (features/tracking/blobs.js BLOB_SCHEMA; the overlay's options button); display only.
  // follow: selection = only the selected shots' trackers (none selected: the playhead's); playhead = every scene's as the video
  // plays through it (command tracking.followPlayhead)
  'tracking.blobs.follow': { default: 'selection', valid: (v) => ['selection', 'playhead'].includes(v), group: 'Tracking', internal: true, label: 'Tracker view: follow', doc: 'The selected shots’ trackers, or the playhead’s', choices: [['selection', 'Selection'], ['playhead', 'Playhead']] },
  'tracking.blobs.opacity': { default: 100, valid: (v) => v >= 0 && v <= 100, ...PCT, group: 'Tracking', internal: true, label: 'Tracker view: opacity', doc: 'The whole overlay’s opacity' },
  // a heatmap over each group's area in its colour: the glow grows with the group's point spacing (a dense grid blobs into one surface)
  'tracking.blobs.heat': ONOFF_BLOB('heatmap', 'A glow over each group’s area in its color'),
  'tracking.blobs.heatOpacity': { ...OPACITY_BLOB('heatmap opacity', 70), valid: (v) => v >= 0 && v <= 100 },
  // a multiple of each group's typical point spacing (1.5 to 8 % of the frame height)
  'tracking.blobs.heatSize': { default: 1.6, valid: (v) => v >= 0.5 && v <= 4, min: 0.5, max: 4, step: 0.1, unit: '×', group: 'Tracking', internal: true, label: 'Tracker view: heat size', doc: 'Heat blob size, bigger merges more' },
  'tracking.blobs.heatShows': { default: 'both', valid: (v) => ['density', 'speed', 'both'].includes(v), group: 'Tracking', internal: true, label: 'Tracker view: heat shows', doc: 'Where the points are, what moves, or both', choices: [['density', 'Density'], ['speed', 'Speed'], ['both', 'Both']] },
  // a part's lighter, static grey, unassigned white; pinned members ringed; a just-occluded point hollow for a few frames
  'tracking.blobs.points': ONOFF_BLOB('points', 'Every visible point as a dot in its group’s color'),
  'tracking.blobs.pointsOpacity': { ...OPACITY_BLOB('points opacity', 90), valid: (v) => v >= 0 && v <= 100 },
  // the pinned parts seeded from the tagger (PROTOCOL v4.6): dash-dot outlines, point count, anchored centre, _proj gauge
  'tracking.blobs.seeded': ONOFF_BLOB('parts', 'Pinned parts as outlines with their centers'),
  'tracking.blobs.seededOpacity': { ...OPACITY_BLOB('parts opacity', 100), valid: (v) => v >= 0 && v <= 100 },
  // per moving group: anchored centre crosshair, label (g1..g4, name, members, share, speed), 0.25 s velocity arrow
  'tracking.blobs.bodies': ONOFF_BLOB('bodies', 'Each moving group’s center, label and arrow'),
  'tracking.blobs.bodiesOpacity': { ...OPACITY_BLOB('bodies opacity', 100), valid: (v) => v >= 0 && v <= 100 },
  // cam_x / cam_y as an arrow (0.5 s of travel), the camera kind, a grid glued to the background
  'tracking.blobs.camera': ONOFF_BLOB('camera', 'The camera’s motion as an arrow and a grid'),
  'tracking.blobs.cameraOpacity': { ...OPACITY_BLOB('camera opacity', 80), valid: (v) => v >= 0 && v <= 100 },
  'tracking.blobs.primary': ONOFF_BLOB('primary', 'What the tracker picked as primary, outlined'),
  // custom axis, else the reported direction, else a PCA estimate; the two largest groups joined with pair_dist
  'tracking.blobs.axis': ONOFF_BLOB('axis', 'The run’s stroke axis through the frame'),
  // off: only the hovered, soloed, lane-selected or primary thing keeps one; hold Alt to see every label in full
  'tracking.blobs.labels': { default: 'short', valid: (v) => ['off', 'short', 'full'].includes(v), group: 'Tracking', internal: true, label: 'Tracker view: labels', doc: 'Labels over the video: off, short or full', choices: [['off', 'Off'], ['short', 'Short'], ['full', 'Full']] },
  'tracking.blobs.trails': ONOFF_BLOB('center paths', 'Each group’s center path, 2 s back and ahead'),
  'tracking.blobs.hulls': ONOFF_BLOB('hulls', 'A filled hull per moving group', false),
  'tracking.blobs.hullsOpacity': { ...OPACITY_BLOB('hulls opacity', 40), valid: (v) => v >= 0 && v <= 100 },
  'tracking.blobs.affine': ONOFF_BLOB('3D trackers', 'Per-group scale and rotation as a ring'),
  'tracking.blobs.occluded': ONOFF_BLOB('occluded points', 'Every occluded point as a small square', false),
  'tracking.blobs.extra': ONOFF_BLOB('extra flags', 'A ring per extra point flag, colored by value'),
  'tracking.blobs.decimate': { default: 'all', valid: (v) => ['all', '1 in 4', '1 in 9'].includes(v), group: 'Tracking', internal: true, label: 'Tracker view: points shown', doc: 'Every point, or 1 in 4 or 9 on a coarse lattice', choices: [['all', 'All'], ['1 in 4', '1 in 4'], ['1 in 9', '1 in 9']] },
  'tracking.blobs.smooth': { default: 'off', valid: (v) => ['off', '0.2 s', '0.5 s', '1 s'].includes(v), group: 'Tracking', internal: true, label: 'Tracker view: smoothing', doc: 'Moving average of hulls and centers, display only', choices: [['off', 'Off'], ['0.2 s', '0.2 s'], ['0.5 s', '0.5 s'], ['1 s', '1 s']] },
  // while the shot uses the fused signal (lib/fusion.js): a ring and share per part, the pairs used, the fused result
  'tracking.blobs.fusion': ONOFF_BLOB('fusion view', 'How each part feeds the fused signal'),
  'tracking.blobs.hud': ONOFF_BLOB('info card', 'The run’s numbers beside the tracker dock', false),
  'tracking.blobs.spark': ONOFF_BLOB('sparkline', 'A 3 s sparkline of the signals in the card'),

  // ---------------- Timeline & lanes ----------------
  // the grey frame cursor: the frame that contains the playhead, drawn at its start (the pink playhead stays smooth)
  'timeline.frameCursor': { default: 'full', valid: (v) => v === 'off' || v === 'ruler' || v === 'full', group: 'Timeline & lanes', label: 'Frame cursor', doc: 'The gray playhead frame: on the ruler, every row, or off', choices: [['off', 'Off'], ['ruler', 'Ruler'], ['full', 'Every row']] },
  // repeated frames as coloured ticks on the ruler's top edge, one colour per picture; worked out once per video in the
  // background (media cache). Off: no strip and no pass.
  'timeline.repeats':    { default: true, group: 'Timeline & lanes', label: 'Repeated frames on the ruler', doc: 'A colored tick per repeated picture' },
  'timeline.transitions': { default: true, group: 'Timeline & lanes', label: 'Fades on the ruler', doc: 'Fades and dissolves marked on the ruler' },
  'timeline.sceneGuides': { default: true, group: 'Timeline & lanes', label: 'Scene guide lines', doc: 'A line through the lanes at each scene boundary' },
  'timeline.overviewMetric': { default: 'mean', group: 'Timeline & lanes', label: 'Overview shows', doc: 'The overview strip’s speed: mean or peak', choices: [['mean', 'Mean'], ['peak', 'Peak']] },
  'timeline.planPreview': { default: true, group: 'Timeline & lanes', label: 'Plan preview', doc: 'A plan segment’s points as a ghost before Generate' },
  'timeline.fxInputs':   { default: false, group: 'Timeline & lanes', label: 'Effect number fields', doc: 'Number fields under an effect’s curve' },
  // LaneView.svelte (the Track-lane merge changed what a plain drag does there): a plain drag on empty space or an unselected
  // segment box-selects (as always) or pans; with Shift / Ctrl / Alt it box-selects either way, middle drag always pans
  // paw-5zpf (features/lanes/elements.js): what a click, B, C, A, Alt+click and Ctrl+click take on a lane; the lane toolbar's
  // four buttons and the number row (Blender keymap) switch it
  'lanes.selectMode':    { default: 'point', group: 'Timeline & lanes', valid: (v) => ['point', 'segment', 'stroke', 'cycle'].includes(v), label: 'Select mode', doc: 'What a click takes: point, segment, stroke or cycle', choices: [['point', 'Point'], ['segment', 'Segment'], ['stroke', 'Stroke'], ['cycle', 'Cycle']] },
  // paw-5zpf (features/lanes/pivot.js): what S and R work about; the lane toolbar and . (Blender keymap) pick it
  'lanes.pivot':         { default: 'middle', group: 'Timeline & lanes', valid: (v) => ['start', 'middle', 'end', 'playhead', 'active', 'individual'].includes(v), label: 'Pivot', doc: 'What scale (S) and rotate (R) work about', choices: [['start', 'Start'], ['middle', 'Middle'], ['end', 'End'], ['playhead', 'Playhead'], ['active', 'Active element'], ['individual', 'Individual origins']] },
  'lanes.dragAction':    { default: 'box', group: 'Timeline & lanes', label: 'Drag on the stroke lane', doc: 'Plain drag on empty space: box select or pan', choices: [['box', 'Box select'], ['pan', 'Pan']] },
  // lib/selmodal.js (C, circle select on the timeline): the brush radius; the wheel and [ / ] change it while C is on
  'timeline.circleRadius': { default: 24, min: 4, max: 200, step: 1, unit: 'px', group: 'Timeline & lanes', label: 'Circle select radius', doc: 'Brush size for C; the wheel or [ ] change it while C is on' },
  // LaneView.svelte onDbl: a double-click on empty lane space adds a point there (as always) or zooms to fit
  'lanes.dblClick':      { default: 'add', group: 'Timeline & lanes', label: 'Double-click on empty lane', doc: 'Add a point there, or fit the whole video', choices: [['add', 'Add a point'], ['fit', 'Fit the view']] },
  'edit.snapFrames':     { default: true, group: 'Timeline & lanes', label: 'Snap to frames', doc: 'New and moved points snap to video frames (N)' },
  'lanes.snapCuts':      { default: true, group: 'Timeline & lanes', label: 'Snap to cuts', doc: 'Moved points snap to shot cuts' },
  'lanes.snapGhosts':    { default: false, group: 'Timeline & lanes', label: 'Snap to ghosts', doc: 'Moved points snap to ghost points' },
  'lanes.speedColors':   { default: true, group: 'Timeline & lanes', label: 'Speed colors', doc: 'Lane lines colored by speed' },
  'lanes.speedMax':      { default: 400, min: 50, max: 2000, step: 10, unit: '/s', group: 'Timeline & lanes', label: 'Speed color top', doc: 'The speed that reads full red' },
  'lanes.ghosts':        { default: true, group: 'Timeline & lanes', label: 'Show ghosts', doc: 'Runs and references drawn over the lanes' },
  'lanes.dragScrub':     { default: true, group: 'Timeline & lanes', label: 'Scrub while dragging', doc: 'The video follows a dragged point' },
  'lanes.hoverScrub':    { default: false, group: 'Timeline & lanes', label: 'Scrub on hover', doc: 'The video follows the pointer over the lanes' },
  'lanes.hoverThumb':    { default: true, group: 'Timeline & lanes', label: 'Frame thumbnail on hover', doc: 'A frame above the hover readout' },
  'lanes.latencyMs':     { default: 0, min: -500, max: 500, step: 5, unit: 'ms', group: 'Timeline & lanes', label: 'Recording latency', doc: 'Offset for points recorded live' },
  'lanes.recEps':        { default: 4, min: 0, max: 30, step: 1, group: 'Timeline & lanes', label: 'Recording detail', doc: 'Recorded motion smaller than this is dropped' },
  'lanes.simplifyTol':   { default: 2, min: 0.5, max: 20, step: 0.5, group: 'Timeline & lanes', label: 'Simplify tolerance', doc: 'How far Simplify may move the line' },
  // joins clean themselves: after a cut stitch, where a live run / fill / bridge joins the points around it (paw-x7w7), a
  // modifiers bake or a lane ghost copy, micro glitches near the join (blips, back-steps, stalls) go (core/script.js cleanMicro)
  'edit.cleanMicro':     { default: true, group: 'Timeline & lanes', label: 'Clean joins', doc: 'Glitches where new points meet old ones go' },
  'edit.cleanMicroMs':   { default: 60, valid: (v) => v >= 0 && v <= 500, min: 0, max: 500, step: 5, unit: 'ms', group: 'Timeline & lanes', label: 'Join glitch time', doc: 'A wiggle with points closer than this is a glitch' },
  // bigger ones are real turns and stay
  'edit.cleanMicroPos':  { default: 6, valid: (v) => v >= 0 && v <= 50, min: 0, max: 50, step: 1, group: 'Timeline & lanes', label: 'Join glitch size', doc: 'A wiggle smaller than this is a glitch' },
  // read when a tab opens (History is built then): restart
  'history.coalesceMs':  { default: 1000, valid: (v) => v >= 0, min: 0, max: 600000, step: 100, unit: 'ms', restart: true, group: 'Timeline & lanes', label: 'Merge repeated nudges', doc: 'Nudges this close are one undo step, after a restart' },
  'history.capActions':  { default: 4_000_000, valid: (v) => v > 0, min: 100000, max: 100_000_000, step: 100000, restart: true, group: 'Timeline & lanes', label: 'Undo memory', doc: 'Points the undo history holds, after a restart' },
  'lanes.layout':        { default: null, type: 'object', group: 'Timeline & lanes', internal: true, label: 'Lane layout', doc: 'Lane order, heights and flags' },

  // ---------------- Machine & Stroker ----------------
  'machine.units':       { default: 'both', group: 'Machine & Stroker', label: 'Machine units', doc: 'Lengths in the Machine panel', choices: [['both', 'mm + in'], ['mm', 'mm'], ['in', 'in']] },
  'stroker.units':       { default: 'cm', group: 'Machine & Stroker', label: 'Stroker units', doc: 'Lengths in Stroker mode', choices: [['cm', 'cm'], ['in', 'in']] },
  // the owner's size, Machine panel Stroker mode (StrokerView.svelte); personal: never logged (app.svelte.js UNLOGGED), never
  // in a project, pack or bug report (test/machine-stroker.test.mjs)
  'stroker.body':        { default: null, type: 'object', private: true, readonly: true, group: 'Machine & Stroker', label: 'Your size', doc: 'Set in Stroker mode, it never leaves this PC' },
  'machine.laneEvents':  { default: false, group: 'Machine & Stroker', label: 'Knot events on the timeline', doc: 'The Machine’s knot events as marks on the lane' },
  'machine.prostate':    { default: true, group: 'Machine & Stroker', label: 'Track prostate stimulation', doc: 'For a body with a modeled prostate' },
  // features/machine (MachinePanel.svelte, StrokerView.svelte): the defaults are what the panels used before they were listed here
  // (paw-m3b6); a null default is derived (the machine's own force limit, the character's own height)
  'machine.mode':        { default: 'machine', group: 'Machine & Stroker', label: 'Machine panel mode', doc: 'A thrust machine and a body, or a stroker sleeve', choices: [['machine', 'Machine'], ['stroker', 'Stroker']] },
  // machines.js MACHINES (test/settings-schema.test.mjs keeps these the same)
  'machine.machine':     { default: 'capstan', group: 'Machine & Stroker', label: 'Machine', doc: 'The thrust machine whose force limit applies', choices: [['capstan', 'Capstan (60 lbf)'], ['custom', 'Custom']] },
  'machine.forceLbf':    { default: null, type: 'number', min: 5, max: 150, step: 1, unit: 'lbf', group: 'Machine & Stroker', label: 'Force limit', doc: 'Thrust limit, empty: the machine’s own' },
  'machine.experience':  { default: 'some', group: 'Machine & Stroker', label: 'Experience', doc: 'The body’s preset, from new to very experienced', choices: [['beginner', 'Beginner'], ['some', 'Some experience'], ['experienced', 'Experienced'], ['very', 'Very experienced']] },
  'machine.warmup':      { default: 'none', group: 'Machine & Stroker', label: 'Warmed start', doc: 'How warmed up the body is at the start', choices: [['none', 'None'], ['light', 'Light'], ['full', 'Full']] },
  'machine.height':      { default: null, type: 'number', min: 140, max: 210, step: 1, unit: 'cm', group: 'Machine & Stroker', label: 'Receiver height', doc: 'Empty: the character’s own height' },
  'machine.weight':      { default: 0.25, min: 0, max: 1, step: 0.05, group: 'Machine & Stroker', label: 'Build', doc: 'From slim (0) to chubby (1), drawn bodies only' },
  'machine.genitals':    { default: 'male', group: 'Machine & Stroker', label: 'Anatomy', doc: 'Schematic male genitals or smooth, drawn bodies only', choices: [['male', 'Male'], ['neutral', 'Neutral']] },
  // physics.js PARAMS.bodyGive
  'machine.bodyGive':    { default: 0.3, min: 0, max: 1, step: 0.05, group: 'Machine & Stroker', label: 'Body give', doc: 'Fixed (0) to loose: how far a push moves the hips' },
  'machine.depthSrc':    { default: 'script', group: 'Machine & Stroker', label: 'Depth from', doc: 'With a video track: the script, the video or both', choices: [['script', 'Script'], ['video', 'Video'], ['both', 'Both']] },
  'machine.char':        { default: 'generic', type: 'string', group: 'Machine & Stroker', internal: true, label: 'Character', doc: 'The body the Machine shows, its own picker' },
  // characters.js: set once per install when the character list changed (an earlier user keeps their model)
  'machine.charV':       { default: 0, min: 0, max: 100, step: 1, auto: true, group: 'Machine & Stroker', internal: true, label: 'Character list version', doc: 'Set once by the app' },
  'machine.toy':         { default: null, type: 'string', group: 'Machine & Stroker', internal: true, label: 'Toy', doc: 'The toy picked last, its own picker' },
  'machine.size':        { default: 'medium', type: 'string', group: 'Machine & Stroker', internal: true, label: 'Toy size', doc: 'The size of a toy that comes in sizes' },
  'machine.toys':        { default: [], group: 'Machine & Stroker', internal: true, label: 'Imported toys', doc: 'Toys made from a picture' },
  'machine.params':      { default: {}, group: 'Machine & Stroker', internal: true, label: 'Tuning', doc: 'Your changes to the experience preset' },
  'machine.firmness':    { default: {}, group: 'Machine & Stroker', internal: true, label: 'Toy firmness', doc: 'The firmness picked for each toy' },
  'machine.hilt':        { default: {}, group: 'Machine & Stroker', internal: true, label: 'Toy hilts', doc: 'Where each toy’s hilt mark sits' },
  'machine.theme':       { default: {}, group: 'Machine & Stroker', internal: true, label: 'Toy colorways', doc: 'The colorway picked for each toy' },
  'machine.roll':        { default: {}, group: 'Machine & Stroker', internal: true, label: 'Toy turn', doc: 'How far each toy is turned' },
  'machine.rig':         { default: {}, group: 'Machine & Stroker', internal: true, label: 'Machine stroke window', doc: 'Where pos 0 and 100 sit on the toy' },
  'machine.layers':      { default: {}, group: 'Machine & Stroker', internal: true, label: 'Body layers', doc: 'Layer opacities of a layered model' },
  'machine.bodyFit':     { default: {}, group: 'Machine & Stroker', internal: true, label: 'Model fit', doc: 'Your nudges of a model’s opening and angle' },
  'machine.cam':         { default: null, type: 'object', group: 'Machine & Stroker', internal: true, label: 'Machine camera', doc: 'The 3D view’s camera' },
  'machine.readouts':    { default: true, group: 'Machine & Stroker', internal: true, label: 'Machine readouts open', doc: 'The Readouts fold' },
  'stroker.style':       { default: 'clean', group: 'Machine & Stroker', label: 'Stroker style', doc: 'Flat with the heat painted on, or skin and sleeve', choices: [['clean', 'Clean'], ['realistic', 'Realistic']] },
  'stroker.heatOverlay': { default: false, group: 'Machine & Stroker', label: 'Heat on the skin', doc: 'The stimulation painted on, realistic style' },
  'stroker.grip':        { default: 0, min: 0, max: 1, step: 0.05, group: 'Machine & Stroker', label: 'Grip', doc: 'How hard the hand squeezes the sleeve' },
  'stroker.skinTone':    { default: 0.3, min: 0, max: 1, step: 0.01, group: 'Machine & Stroker', label: 'Skin tone', doc: 'From light (0) to dark (1), realistic style' },
  'stroker.sleeveTint':  { default: 'clear', group: 'Machine & Stroker', label: 'Sleeve tint', doc: 'The sleeve’s color, realistic style', choices: [['clear', 'Clear'], ['frosted', 'Frosted'], ['pink', 'Pink'], ['blue', 'Blue'], ['smoke', 'Smoke']] },
  'stroker.orientation': { default: 'up', group: 'Machine & Stroker', label: 'Stroker orientation', doc: 'Upright, or lying on its side', choices: [['up', 'Upright'], ['side', 'Lying']] },
  'stroker.case':        { default: true, group: 'Machine & Stroker', label: 'Sleeve case', doc: 'A product’s hard case drawn around the sleeve' },
  'stroker.scrotum':     { default: true, group: 'Machine & Stroker', label: 'Scrotum', doc: 'Drawn in the realistic style' },
  'stroker.cut2d':       { default: false, group: 'Machine & Stroker', label: 'Flat cutaway', doc: 'The flat drawing instead of the 3D view' },
  'stroker.sleeve':      { default: 'closed-long', type: 'string', group: 'Machine & Stroker', internal: true, label: 'Sleeve', doc: 'The sleeve picked last, its own picker' },
  'stroker.sleeves':     { default: {}, group: 'Machine & Stroker', internal: true, label: 'Sleeve edits', doc: 'Your changes to each sleeve' },
  'stroker.imported':    { default: [], group: 'Machine & Stroker', internal: true, label: 'Imported sleeves', doc: 'Sleeves made from a picture' },
  'stroker.weights':     { default: {}, group: 'Machine & Stroker', internal: true, label: 'Zone sensitivity', doc: 'How much each zone counts' },
  // personal like stroker.body (app.svelte.js UNLOGGED): drawn from your size
  'stroker.rig':         { default: null, type: 'object', private: true, group: 'Machine & Stroker', internal: true, label: 'Stroker window', doc: 'Where pos 0 and 100 sit on your length' },
  'stroker.cam':         { default: null, type: 'object', private: true, group: 'Machine & Stroker', internal: true, label: 'Stroker camera, lying', doc: 'The 3D view’s camera' },
  'stroker.camUp':       { default: null, type: 'object', private: true, group: 'Machine & Stroker', internal: true, label: 'Stroker camera, upright', doc: 'The 3D view’s camera' },
  'stroker.readouts':    { default: true, group: 'Machine & Stroker', internal: true, label: 'Stroker readouts open', doc: 'The Stimulation fold' },

  // ---------------- Projects & tabs ----------------
  // project.svelte.js #places / save(): a document that never had a place gets <video stem>.pawproj beside its video (as
  // before), else <data_dir>/projects/<name>-<id>.pawproj; 'appData' goes straight to the projects folder
  'project.newIn':       { default: 'beside', group: 'Projects & tabs', label: 'New projects go', doc: 'Where a document with no project is first kept', choices: [['beside', 'Beside the video'], ['appData', 'Projects folder']] },
  // tabs.svelte.js restore() (paw-bztd / paw-shgb): every tab open at quit comes back, the shown one opened, the others parked
  'tabs.reopen':         { default: true, group: 'Projects & tabs', label: 'Reopen tabs at start', doc: 'The documents open at quit come back' },
  // tabs.svelte.js budget(): hidden tabs past this are parked (unloaded, opened from disk again when shown), oldest first
  'tabs.memoryMB':       { default: 1200, min: 100, max: 65536, step: 100, unit: 'MB', group: 'Projects & tabs', label: 'Hidden tabs memory', doc: 'Past this, the oldest hidden tab is unloaded' },
  // project-history.js pruneCheckpoints: the newest N automatic checkpoints stay, then the newest of each calendar day;
  // commits, publishes and kept entries are never pruned
  'project.checkpoints': { default: 20, min: 1, max: 1000, step: 1, group: 'Projects & tabs', label: 'Automatic checkpoints kept', doc: 'Plus the newest of each day, commits always stay' },
  // project.svelte.js askCommit: Ctrl+S with nothing changed since the last commit shows the dialog saying so (as before), or
  // only a quiet toast
  'project.unchangedSave': { default: 'dialog', group: 'Projects & tabs', label: 'Ctrl+S with no changes', doc: 'Show the commit dialog, or a quiet note', choices: [['dialog', 'Dialog'], ['toast', 'Quiet note']] },
  // project.svelte.js askCommit: off = Ctrl+S commits at once, no dialog and no note (a note can be added in Commits later)
  'project.commitAsk':   { default: true, group: 'Projects & tabs', label: 'Ask for a commit note', doc: 'Off: Ctrl+S commits at once, without a note' },
  'autosave.seconds':    { default: 30, valid: (v) => v >= 0, min: 0, max: 86400, step: 5, unit: 's', group: 'Projects & tabs', label: 'Autosave every', doc: '0 turns autosave off' },
  // rolling backups in the app data folder per file Pawscript last wrote (not the .bak siblings)
  'backup.keep':         { default: 10, valid: (v) => v >= 0, min: 0, max: 100, step: 1, group: 'Projects & tabs', label: 'Backups per file', doc: 'Rolling copies kept of each file you save' },
  'recent':              { default: [], private: true, group: 'Projects & tabs', internal: true, label: 'Recent list', doc: 'Recently opened videos and projects' },
  'palette.recent':      { default: [], group: 'Projects & tabs', internal: true, label: 'Recent commands', doc: 'Palette ordering' },
  // a stored "script", from before the stage tabs, opens as refine
  'mode':                { default: 'scenes', group: 'Projects & tabs', internal: true, label: 'Last stage tab', doc: 'Scenes, Track, Refine or Review' },
  'layout':              { default: null, type: 'object', group: 'Projects & tabs', internal: true, label: 'Area layout', doc: 'The areas and timeline rows of each tab' },
  // panels moved to another dock before areas (v3): {panelId: dock}; where a panel no area lists goes
  'layout.docks':        { default: {}, group: 'Projects & tabs', internal: true, label: 'Panel docks', doc: 'Where a panel no area lists goes' },
  'layout.v':            { default: 1, min: 1, max: 100, step: 1, group: 'Projects & tabs', internal: true, label: 'Layout version', doc: 'The area layout’s format' },

  // ---------------- Content ----------------
  // paw-43vn: off = the paint tool offers no tail or sheath, paws read as feet and slit as vulva, the animal-only scene tags,
  // animal tagger tags, species words and the animal Machine bodies are not offered (the Human is). The knot stays. Display
  // only (lib/content.js): projects, group names and tags are the same on disk; a part a project already has keeps showing.
  'content.furry':       { default: true, group: 'Content', label: 'Furry items', doc: 'Off: no tails, sheaths or animal tags, paws read as feet' },
  // ScenesPanel.svelte: the tagger's own boxed tags under each described shot (up to 8)
  'content.taggerTags':  { default: true, group: 'Content', label: 'Tagger tags on shots', doc: 'The tagger’s boxed tags under each shot' },

  // ---------------- Advanced ----------------
  'tracking.startTimeoutS': { default: 180, min: 30, max: 3600, step: 30, unit: 's', group: 'Advanced', label: 'Tracker start timeout', doc: 'A job that prints nothing this long fails' },
  // describe with no progress this long fails (a busy GPU can hang it); also the cum detector's describe
  'tracking.describeTimeoutS': { default: 180, min: 30, max: 3600, step: 30, unit: 's', group: 'Advanced', label: 'Describe timeout', doc: 'Describe with no progress this long fails' },
  'graph.cacheMB':       { default: 64, min: 8, max: 4096, step: 8, unit: 'MB', group: 'Advanced', label: 'Graph cache', doc: 'Memory the node graph keeps results in' },
  // feedback notes (` opens the one-line field) were dots on the Chapters row until that row was removed (paw-1w0x); the notes
  // themselves are in feedback.jsonl in the local data folder
  'feedback.markers':    { default: true, group: 'Advanced', internal: true, label: 'Feedback markers', doc: 'Retired with the Chapters row' },
  // features/labelling: the image-labelling workspace's folder and options
  'labelling.folder':    { default: '', type: 'string', folder: true, private: true, group: 'Advanced', internal: true, label: 'Labeling folder', doc: 'The folder the labeling workspace opened last' },
  'labelling.shuffle':   { default: true, group: 'Advanced', internal: true, label: 'Labeling: shuffle', doc: 'Pictures in a random order' },
  'labelling.duos':      { default: false, group: 'Advanced', internal: true, label: 'Labeling: duos first', doc: 'Two-character pictures first' },

  // ---------------- Models, Updates (paw-cdot) ----------------
  // the models folder (.cache\ and .models\ inside): read by the shell at every tracker start (models.rs folder(), passed as
  // PAWTRACK_MODELS); empty = <app folder>\trackers, where the shared build has them. Changed from Settings > Models (its own
  // folder row); a change moves and deletes nothing, the old folder is just no longer looked in.
  'models.dir':          { default: '', type: 'string', folder: true, private: true, internal: true, valid: (v) => typeof v === 'string', group: 'Models', label: 'Models folder', doc: 'Empty: next to the app (Settings > Models)' },
  // the models server (features/models/logic.js MODELS_BASE_URL when empty); PAWSCRIPT_MODELS_URL wins over both. Another
  // folder on https://dl.openvalence.org/, or this PC (dev/models-window-check.mjs): the hosts the shell allows (models.rs)
  'models.baseUrl':      { default: '', type: 'string', internal: true, valid: (v) => typeof v === 'string' && (v === '' || /^(https:\/\/dl\.openvalence\.org|https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?)\/(\S*\/)?$/.test(v)), group: 'Models', label: 'Models server', doc: 'Empty: the Pawscript models server' },
  // the first-start screen was answered (Download or Not now): it does not come back by itself (Settings > Models does)
  'models.setupDone':    { default: false, auto: true, internal: true, group: 'Models', label: 'First-start download asked', doc: 'Settings > Models downloads later' },
  // update.rs: GitHub's latest.json, once per start, only when on
  'updates.checkAtStart': { default: false, group: 'Updates', label: 'Check for updates at start', doc: 'Asks GitHub once per start; off: only Help > Check' },
};

/** A schema entry with its panel metadata (group, label, choices as [{value, label}], type), or null. */
export function metaOf(key) {
  const sc = SCHEMA[key];
  if (!sc) return null;
  const m = { ...sc };
  m.group ||= 'Advanced';
  m.label ||= key;
  m.type ||= kind(sc.default);
  if (m.choices) m.options = m.choices.map((c) => (Array.isArray(c) ? { value: c[0], label: c[1] } : { value: c, label: String(c) }));
  return m;
}
/** Every setting in panel order: groups as GROUPS lists them, entries in schema order. */
export function schemaEntries() {
  const all = Object.keys(SCHEMA).map((key) => ({ key, ...metaOf(key) }));
  return GROUPS.flatMap((g) => all.filter((e) => e.group === g)).concat(all.filter((e) => !GROUPS.includes(e.group)));
}

const KEY = 'pawscript.settings';
const kind = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
function fits(v, sc) {
  const want = sc.type && sc.default === null ? (sc.type === 'object' ? 'any' : sc.type) : kind(sc.default);
  if (want !== 'null' && want !== 'any' && kind(v) !== want) return false;
  if (want === 'number' && !Number.isFinite(v)) return false;
  if (sc.choices && !sc.choices.some((c) => (Array.isArray(c) ? c[0] : c) === v)) return false;
  return !sc.valid || !!sc.valid(v);
}

export class Settings {
  values = $state.raw({});
  #timer = 0;

  /** storage: a Storage-like object (localStorage, or main.js's adapter over the native settings file) or null for in-memory
   *  only (the mock). */
  constructor(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
    this.storage = storage;
    try { this.values = JSON.parse(storage?.getItem(KEY) || '{}') || {}; } catch { this.values = {}; }
  }
  /** The stored value, unless it is missing, null, or does not fit the schema (wrong type, out of range, not a choice): then
   *  the default. A hand-edited or old settings file can never feed NaN rates or string sizes to the app. */
  get(key, fallback) {
    const v = this.values[key], sc = SCHEMA[key];
    if (!sc) return v !== undefined ? v : fallback;
    return v != null && fits(v, sc) ? v : sc.default;
  }
  /** Would this value be kept (it fits the schema; any value for a key the schema does not list)? */
  accepts(key, value) { const sc = SCHEMA[key]; return !sc || value == null || fits(value, sc); }
  onSet = null;   // (key, old, value) after every set and reset (app.svelte.js: the usage log)
  set(key, value) {
    const old = this.values[key];
    this.values = { ...this.values, [key]: value };
    try { this.onSet?.(key, old, value); } catch { /* observers never break a write */ }
    this.#soon();
  }
  /** Several keys in one write (an imported settings file): each one is reported to onSet. */
  setMany(obj) {
    const old = this.values;
    this.values = { ...old, ...obj };
    for (const k of Object.keys(obj)) { try { this.onSet?.(k, old[k], obj[k]); } catch { /* as set */ } }
    this.#soon();
  }
  /** Back to the default (the key leaves the file). keys: one key or several. */
  reset(keys) {
    const list = [].concat(keys), v = { ...this.values }, old = this.values;
    for (const k of list) delete v[k];
    this.values = v;
    for (const k of list) if (old[k] !== undefined) { try { this.onSet?.(k, old[k], undefined); } catch { /* as set */ } }
    this.flush();
  }
  #soon() {
    if (!this.storage) return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.flush(), 200);
  }
  writeError = $state('');   // why the last write failed ('' = stored): the health slot's "Settings not saved" (app/HealthSlot.svelte)
  flush() {
    clearTimeout(this.#timer);
    try { this.storage?.setItem(KEY, JSON.stringify(this.values)); this.writeError = ''; }
    catch (e) {
      console.warn('[settings] not saved:', e);
      this.writeError = e?.message || String(e);
    }
  }
}

/** The join cleanup's options from the settings (edit.cleanMicro*), or null when it is off. Missing settings: the defaults. */
export function cleanMicroOpts(settings) {
  const get = (k) => settings?.get?.(k) ?? SCHEMA[k].default;
  return get('edit.cleanMicro') === false ? null : { gapMs: get('edit.cleanMicroMs'), posTol: get('edit.cleanMicroPos') };
}
