<script>
  // The Tracker row of the timeline: the live signal while tracking, the visible runs' signals (the selected one
  // bright, its chosen channel), confidence, events / bands, loop cycle marks; under it the signal row of the current
  // scene's run (paw-9qm): the source (a picker: Fused, the parts, pairs, the other channels; the old motion groups g1..g4
  // at its bottom), Pair (a chip: click the moving part, then the part it moves against; or pick them on the video), what
  // it is measured against (the camera, none, a part; the camera removal's mode / strength / smooth), its baseline /
  // envelope; the selected run's direction per scene (click = flip; drag = flip a stretch, paw-57ve) -- or the detected scenes (click = range) -- and the
  // span labels. The pickers edit the range override under the playhead (or the segment clicked), else the shot's own
  // setting; the label says which ("range 1:30.1–1:34.8" / "shot 5"), × clears the override (paw-hiq5). A range override
  // (lib/signal-source.js) is drawn as a marked segment along the top: click = select, body drag = move, ends drag = resize,
  // X / Delete or its × removes it, right-click = its options (Whole shot, Remove). Draw one: drag in the thin band under
  // the top edge of the row (a press without a drag there is still click-to-seek). Click stays seek.
  // A scene whose link has a baseline draws it as a dashed curve with knot handles (runs-channel.js carriers): drag a knot
  // (half speed, Shift fine; the points follow live, one store write on release), double-click the curve = a knot,
  // right-click a knot (or click it, then Delete) = remove it. Ghost points are drawn by the lanes feature, not here.
  import OutOfRange from '../timeline/OutOfRange.svelte';
  import { drawLane, zoomAt, panBy, xToMs, msToX, laneY, lowerBound, gridOf, frameAt, frameTime, playheadFrameStart } from '../../lib/lane.js';
  import { layerOf, effSign, linkFor, sceneAt } from '../../lib/runs.js';
  import { xorFlips, matchText } from '../../lib/polarity.js';
  import { shotLabel, sceneNo } from '../timeline/shots.js';
  import { carriers, spline, pickerChannels, camWeak, camChannel, decisionsOf, candidateText, decisionLines, primaryHow, chipVariants, groupOfChannel, groupPresence, sceneGroups, labelOf, labelText, partsLeftOut, relParse, relId, relLabel, relChannels, relSuggestions, whoLabel, channelWord, channelHasData, VARIANT_WORDS } from '../../lib/runs-channel.js';
  import { contextMenu, showContextMenu } from '../../ui/kit/contextmenu.js';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { editorItem } from '../../ui/kit/editor-item.svelte.js';
  import { nearestHandle, GAIN, FINE } from '../../ui/kit/curve.js';
  import { trackingFor, ANCHOR_CMD } from './tracking.svelte.js';
  import { ANCHOR_WORD } from '../../lib/anchors.js';
  import { progressBand } from './direction.js';
  import { sceneCamera } from '../timeline/acts.js';
  import { chipTag } from './group-labels.js';
  import { KIND_COLOR, LIVE_COLOR, TAG_COLOR, GROUP_COLORS, PAIR_COLOR, partColor, semColor, semPaint, whoColor, paint as tok } from './colors.js';
  import { fmtTime } from '../../lib/funscript.js';
  import Icon from '../../ui/kit/Icon.svelte';
  import DetailChip, { detailMenu } from './DetailChip.svelte';
  import { renderScript } from '../../lib/stroke-shape.js';
  import Popover from '../../ui/kit/Popover.svelte';
  import { fusionGroups } from '../../lib/fusion.js';
  import { partLabel } from './groups.js';
  import { partList } from '../../lib/content.js';
  import { CAM_DEFAULT } from '../../lib/rederive.js';
  import { CAM_OPTIONS } from './DeriveStrip.svelte';
  import { onThemeChange } from '../../ui/kit/tokens.js';
  import { shaftDirection, directionText, shaftOf, partNames, partSource, partOf, partWord } from '../../lib/shaft.js';
  import { shaftChipText } from '../../lib/shaft-source.js';
  import ShaftStrip from './ShaftStrip.svelte';
  import ShaftData from './ShaftData.svelte';
  import { repeatsOf } from '../timeline/repeats.svelte.js';
  import { seedTimes, seedMarks } from './seed-marks.js';
  import FusionPad from './FusionPad.svelte';
  import ReferenceStrip from './ReferenceStrip.svelte';
  import RunRangeStrip, { rangeItems } from './RunRangeStrip.svelte';
  import Button from '../../ui/kit/Button.svelte';
  import { cmd } from '../../app/cmd.js';
  import { rangeAt } from '../../lib/run-ranges.js';
  import { modMeasure } from '../timeline/mod-runs.js';
  import { modLabel } from '../timeline/mods.js';
  import { rowControls, measureText } from './row-controls.js';
  import { correctHere, trackMod } from './mod-track.js';
  import { ctlLog } from '../../app/ctl-log.js';
  import { posToY, yToPos, GUTTER_W } from '../lanes/geom.js';
  import { thin } from '../timeline/lod.js';
  import DeriveStrip from './DeriveStrip.svelte';
  import { spanItems, seedHit } from './lane-layout.js';
  import { ANCHORS } from '../../lib/runs-channel.js';

  // paw-unuy, the owner: "combine the stroke and tracker bars and move all the fusion controls into the same area". `lane` (a
  // snippet(under, claim): lanes/LaneStack.svelte on the Track tab) = the combined lane: the axis lane is drawn here, the runs'
  // traces as a transparent layer between its background and its points (`under`, on the lane's own pos -> y), the canvas
  // gestures below go through the lane (`claim`: knots, seed marks, the hover words; the lane's points win), the range overrides
  // and the direction strip are thin strips under it, and the per-shot controls one inspector band (one row; expands in place:
  // fusion, depth, Smart stroke, camera, strokes, the shaft data). No shot-number strip, no span-label strip (their clicks: the
  // Shots strip, the lane's right-click). Without `lane`: the Tracker row of the Refine / Review tabs, as before.
  let { app, lane = null } = $props();
  // svelte-ignore state_referenced_locally
  const tr = trackingFor(app);   // app never changes for a mounted panel / lane / overlay
  // svelte-ignore state_referenced_locally
  const embedded = !!lane;
  /** y of a 0..1 value: the combined lane's (its points') mapping, else the row's own (lib/lane.js laneY). */
  const Y = (x) => (embedded ? posToY(ph, x * 100) : laneY(h, x));
  const unY = (y) => (embedded ? yToPos(ph, y) / 100 : 1 - (y - 14) / (h - 26));
  let canvas = $state(), w = $state(0), h = $state(0), themeTick = $state(0);
  $effect(() => onThemeChange(() => themeTick++));   // drawLane reads the theme's tokens at paint time: repaint on a switch

  const visibleRuns = () => tr.runs.filter((r) => tr.ghost(r.id)?.visible);
  const empty = $derived(!tr.live && !tr.runs.length);
  // ---- the signal picker: the scene's run (the selected one, else the run linked to the current scene) ----
  const pickRun = $derived(tr.selected || tr.run(tr.sceneLink(tr.currentScene)?.runId ?? '') || null);
  // the band's ▾ (the shot's Adjust strip, its only place since 145370e) opens whenever the shot has a run to adjust: the strip
  // edits the run whose RANGE plays there (tracking deriveRun, paw-1ysd), so a shot played by a range with nothing selected and
  // no link (a reopened project, a run strip pick) can be adjusted too; it was disabled there (the picker's run only)
  const bandRun = $derived(pickRun || tr.deriveRun(tr.currentScene));
  const pickScene = $derived(pickRun ? tr.sceneOf(pickRun) : -1);
  // paw-ef73.31: what applies to the picked run (row-controls.js): a modifier's own run gets its modifier, measure and actions only
  const ctl = $derived(new Set(rowControls(pickRun)));
  const pickMod = $derived(pickRun?.mod ? (app.doc.fx || []).find((e) => e.id === pickRun.mod) ?? null : null);
  const chips = $derived(pickRun ? pickerChannels(pickRun) : []);
  // paw-4c48: the shaft strip under the trace while the picked run has a shaft in any of its scenes (ShaftStrip.svelte)
  // paw-4c48.15: the shaft's data band under the strip (ShaftData.svelte): the owner's toggle, off by default (no room when off)
  const shaftData = $derived((app.settings.values, !!app.settings.get('tracking.shaftData', false)));
  const shaftOn = $derived(!!pickRun && !pickRun.mod && !pickRun.restored && (pickRun.scenes?.length ? pickRun.scenes : [null]).some((_, k) => !!shaftOf(pickRun, k, { points: true }) || partNames(pickRun).some((p) => !!shaftOf(pickRun, k, { points: true, part: p }))));   // paw-4c48.19: a depth part's strip / data too
  const weakCam = $derived(camWeak(pickRun));   // mean cam_conf < 0.3: the camera-removed channels are marked weak
  const sceneLink = $derived.by(() => { const s = tr.scenes[pickScene], l = s ? tr.links[linkFor(tr.links, s)] : null; return l && l.run === pickRun?.id ? l : null; });
  const bMode = $derived(sceneLink?.baseline?.mode || 'off');
  const pickRunScene = $derived.by(() => { const s = tr.scenes[pickScene]; return Math.max(0, sceneAt(pickRun?.scenes || [], s ? (s.start_ms + s.end_ms) / 2 : app.player.timeMs)); });
  const groups = $derived(pickRun ? sceneGroups(pickRun, pickRunScene) : {});
  // paw-9qm / paw-hiq5: where the row's pickers go: the override segment clicked, else the one under the playhead, else the shot's own
  const tgtSpan = $derived(pickRun ? tr.activeSpan : null);
  const target = $derived(tgtSpan ? { t0: tgtSpan.t0, t1: tgtSpan.t1 } : null);
  const tgtShot = $derived(tgtSpan ? sceneAt(tr.scenes, (tgtSpan.t0 + tgtSpan.t1) / 2) : pickScene);
  const shotD = $derived(pickScene >= 0 ? tr.shotDerive(pickScene, pickRun?.id) : null);
  const shotSrc = $derived(pickRun && pickScene >= 0 ? tr.shotSource(pickRun, pickScene) : pickRun?.channel || 'primary');
  const picked = $derived(tgtSpan?.source || shotSrc);
  const against = $derived(tgtSpan?.against || shotD?.against || 'camera');
  const camSt = $derived(pickRun && tgtShot >= 0 ? tr.camState(tgtShot, tgtSpan, pickRun.id) : { cam: { ...CAM_DEFAULT }, from: 'tracked', tag: null });   // paw-hiq5: override > Adjust > tag default
  const cam = $derived(camSt.cam);
  const camNote = $derived(camSt.from === 'tag' ? ` (${camSt.tag.label})` : '');
  // a baseline / envelope belongs to the shot's link (its channel), not to a range override: it checks the shot's source
  const carrierBlock = $derived(!pickRun ? '' : pickScene < 0 ? 'A baseline belongs to a scene: detect scenes first' : shotSrc === 'primary' || !pickRun.channels[shotSrc] ? 'Pick a channel first (the sidecar primary has no raw channel here): a baseline belongs to the whole shot\'s channel' : '');
  const chipColor = (c) => { const q = groupOfChannel(c), w = /^who_(c[12]|x)_/.exec(c); return c === 'fused' ? 'var(--tx-hi)' : q ? (q.sem ? semColor(q.sem) : q.part ? partColor(q.body) : GROUP_COLORS[q.body - 1]) : w ? whoColor(w[1]) : c === 'pair_proj' || relParse(c) || whoLabel(c) ? PAIR_COLOR : null; };
  const kindOf = (c) => { const q = groupOfChannel(c); return q && chipVariants(pickRun, c)[0] !== c ? ' · ' + (VARIANT_WORDS[q.kind] || q.kind).toLowerCase() : ''; };
  /** The source chip's face for a painted part or a pair of them: [{t: 'B-LH', col}] (the full words stay in the tooltip); null = its label. */
  const chipTags = (c) => {
    const r = relParse(c), nm = (k) => (k.startsWith('sem_') ? k.slice(4) : null), q = groupOfChannel(c);
    if (r && nm(r.a) && nm(r.b)) return [r.a, r.b].map((k) => ({ t: chipTag(nm(k)), col: semColor(nm(k)) }));
    return q?.sem ? [{ t: chipTag(q.sem) + kindOf(c), col: semColor(q.sem) }] : null;
  };
  const chipLabel = (c) => {
    const q = groupOfChannel(c), lb = labelOf(groups, c);
    if (c === 'shaft') return shaftChipText(pickRun?.shaftSrc?.[pickRunScene]);
    if (partOf(c)) return shaftChipText(pickRun?.partSrc?.[partOf(c)]?.[pickRunScene], partOf(c));   // paw-4c48.19
    if (relParse(c)) return relLabel(groups, c);
    // paw-u6s5: user words (lib/runs-channel.js channelWord); the channel id is in no label
    const kind = kindOf(c);
    if (q?.sem) return lb + kind;
    return (q && lb && lb !== 'body' ? `${lb[0].toUpperCase() + lb.slice(1)} (${channelWord(c).toLowerCase()})` : channelWord(c)) + kind;
  };
  /** Share of the pick scene's frames the chip's group is present on (its _n channel). */
  const presence = (c) => {
    const q = groupOfChannel(c), s = tr.scenes[pickScene];
    return q && pickRun ? groupPresence(pickRun, q.key, s ? s.start_ms : -Infinity, s ? s.end_ms : Infinity) : 1;
  };
  const SEM_VARIANT = { rel: 'its own motion in the frame of the body around it', scale: 'its own contraction (+ = bigger; balls: the spurts)', pulse: 'its contractions from detect cumshots (SAM mask; + = contracted, in noise units): the spurt cue', proj: 'its position on the stroke axis' };
  const VARIANT = { proj: 'its position on the stroke axis', rel: "its own motion in its body's frame (the default: the part's stroke)", scale: 'its size change (+ = bigger: toward the camera, or swelling)', rot: 'its rotation (+ = clockwise)' };
  // the sidecar's decision record for the run scene the pick goes to (PROTOCOL notes, code primary)
  const pickDec = $derived((pickRun ? decisionsOf(pickRun.notes) : [])[pickRunScene] || null);
  /** One line on what channel c is (the picker's item hints). */
  const chipTitle = (c) => {
    if (c === 'shaft') return SHAFT_TIP + shaftSrcNote(pickRun?.shaftSrc?.[pickRunScene]);
    if (partOf(c)) return partTip(partOf(c)) + shaftSrcNote(pickRun?.partSrc?.[partOf(c)]?.[pickRunScene], partOf(c));
    const ch = pickRun?.channels[c], id = c === 'primary' ? pickDec?.chosen : c, sq = groupOfChannel(c)?.sem;
    const cand = pickDec?.candidates?.[id] || (sq ? pickDec?.candidates?.[`sem_${sq}_proj`] : null);
    const recip = c.startsWith('cam_') && sceneCamera(tr.scenes[pickScene]) === 'reciprocal' ? 'camera is reciprocal: cam x / y are stroke candidates' : '';
    const nums = cand ? candidateText(cand) : c.startsWith('cam_') ? [decisionLines({ camera: pickDec?.camera })[0], recip].filter(Boolean).join(' · ') : '';
    const q = groupOfChannel(c), pr = presence(c);
    const extra = [q?.sem && !groups[q.key] && labelText({ source: 'cam' }), q && labelText(groups[q.key]), q && partsLeftOut(groups, c), q && pr < 1 && `present on ${Math.round(pr * 100)}% of the scene's frames`, weakCam && camChannel(c) && 'camera estimate weak'].filter(Boolean).join(' · ');
    return [c === 'primary' && id ? `picks ${chipLabel(id)}` : '', ch?.min != null ? `range ${+ch.min.toFixed(3)} … ${+ch.max.toFixed(3)}` : '', nums,
      primaryHow(id) || (q && VARIANT[q.kind] ? (q.sem && SEM_VARIANT[q.kind]) || VARIANT[q.kind] : ''), extra].filter(Boolean).join(' · ');
  };
  // paw-4c48.10: the shaft source (lib/shaft-source.js): the position bar's diamond as the stroke
  const SHAFT_TIP = "the shaft's reading of how much of it is out, the position bar's hollow diamond (on the shaft): pos 0 hilted, 100 fully out (your marks, if set). Read from the penis points still visible, or from SAM's outline where that repeats clearly better with the strokes; the diamond then draws that same reading. Where it is held or unsure the gap is filled from fusion seated on its level and size, joined without a jump. Not a default; it can read a shot upside down: F flips it";
  const READ_WORD = { points: 'the visible penis points', sam: "SAM's outline" };
  const readWord = (r, part) => (part && r === 'points' ? `the visible ${partWord(part)} points` : READ_WORD[r] || r);
  const shaftSrcNote = (i, part = null) => !i ? '' : !i.ok ? ` · not read in this shot (${i.why}): its own channel plays` : ` · read from ${readWord(i.reading, part)} (repeats with the strokes: ${i.q.toFixed(2)}${i.other ? `; ${readWord(i.other.reading, part)}: ${i.other.why ? 'none here' : i.other.q.toFixed(2)}` : ''}) · measured on ${Math.round(100 * i.share)} % of the run scene${i.how ? `, the rest filled ${i.how === 'fusion' ? 'from fusion' : `with straight lines (fusion does not move with the ${part ? partWord(part) : 'shaft'} here)`}` : ''}`;
  // paw-4c48.19: a depth part (the shaft pass on a part the owner turned on in the Groups tool): the same reading, by its name
  const partTip = (p) => `the ${partWord(p)}'s reading of how much of it is out (pos 0 deepest, 100 fully out; your marks, if set), the same way as the shaft's: from its points still visible, or from SAM's outline where that repeats clearly better with the strokes; held or unsure stretches filled from fusion. Not a default; it can read a shot upside down: F flips it`;
  const shaftHint = $derived(pickRun && pickScene >= 0 && !target && ctl.has('overrides') ? tr.shaftHint(pickRun, pickScene) : null);
  let peek = $state('');
  // ---- the source picker: the tracker's choice and Fused first, the shaft, the parts, pairs, bodies, everything else; the old
  // motion groups (g1..g4) last, in their own submenu. paw-u6s5: only what has data where the pick goes (the range override,
  // else the shot); the picked one always shows; one greyed row counts the rest ----
  const OLD = /^g[1-4](p[12])?_|^pair_proj$/;
  /** The picker's items, each applying through `put(channel)` (the row's target). */
  function sourceItems(put, cur = picked, span = target) {
    const r = pickRun;
    if (!r) return [];
    const so = tr.shaftOffer(r, pickScene), sWhy = span ? 'Shaft is a whole-shot source (its level is the measured depth): clear or leave the range override to pick it for the shot' : so.ok ? '' : so.why;
    // (the kit shows no tooltip on a disabled row: the reason is in its label)
    const shaft = { label: sWhy ? `Shaft — not here: ${sWhy}` : 'Shaft', type: 'radio', checked: cur === 'shaft', disabled: !!sWhy, tip: sWhy ? '' : `The script follows ${SHAFT_TIP}`, run: () => put('shaft') };
    // paw-4c48.19: each depth part of the run, by its name, offered by the same rules as Shaft
    const depthParts = partNames(r).map((p) => {
      const o = tr.shaftOffer(r, pickScene, p), w = span ? `${partWord(p)} is a whole-shot source: clear or leave the range override to pick it for the shot` : o.ok ? '' : o.why, nm = partWord(p);
      return { label: w ? `${nm[0].toUpperCase() + nm.slice(1)} — not here: ${w}` : nm[0].toUpperCase() + nm.slice(1), type: 'radio', checked: cur === partSource(p), disabled: !!w, tip: w ? '' : `The script follows ${partTip(p)}`, run: () => put(partSource(p)) };
    });
    const data = shaftOn ? [{ label: 'Shaft data under the lane', type: 'checkbox', checked: shaftData, tip: "The shaft's readings over the shot, under the lane", run: () => app.settings.set('tracking.shaftData', !shaftData) }] : [];
    const sc = tr.scenes[pickScene], t0 = span ? span.t0 : sc ? sc.start_ms : -Infinity, t1 = span ? span.t1 : sc ? sc.end_ms : Infinity;
    const vars = (c) => chipVariants(r, c).filter((v) => v === cur || channelHasData(r, v, t0, t1));
    let gone = 0;
    const here = (c) => vars(c).length > 0 || (gone++, false);   // (vars keeps the picked one)
    const radio = (c) => ({ label: chipLabel(c), type: 'radio', checked: cur === c, disabled: c !== 'primary' && c !== 'fused' && !r.channels[c] && !relParse(c), run: () => put(c) });
    const varLabel = (v) => { const g = groupOfChannel(v), d = (g.sem && SEM_VARIANT[g.kind]) || VARIANT[g.kind]; return (VARIANT_WORDS[g.kind] || g.kind) + (d ? ': ' + d : ''); };
    const entry = (c) => { const vs = vars(c); return vs.length < 2 ? radio(vs[0] ?? c) : { label: chipLabel(c), checked: vs.includes(cur) || undefined, items: vs.map((v) => ({ ...radio(v), label: varLabel(v) })) }; };
    const top = chips.filter((c) => c === 'fused' || c === 'primary'), parts = chips.filter((c) => groupOfChannel(c)?.sem && here(c));
    const pairs = [...new Set([...(relParse(cur) ? [cur] : []), ...relSuggestions(r, groups), ...chips.filter((c) => /^who_(pair|p1h2|p2h1)_proj$/.test(c))])].filter(here);
    const old = chips.filter((c) => OLD.test(c) && here(c)), all = chips.filter((c) => !top.includes(c) && !groupOfChannel(c)?.sem && !/^who_(pair|p1h2|p2h1)_proj$/.test(c) && !OLD.test(c) && here(c));
    const bodies = all.filter((c) => whoLabel(c)), rest = all.filter((c) => !whoLabel(c));
    const sect = (name, cs, f = entry) => (cs.length ? [{ section: name }, ...cs.map(f)] : []);
    return [...top.map(radio), shaft, ...depthParts, ...data, ...sect('Parts', parts), ...sect('Pairs', pairs, radio), ...sect('Bodies', bodies), ...sect('Other', rest),
      ...(old.length ? [{ separator: true }, { label: 'Old motion groups', checked: old.some((c) => vars(c).includes(cur)) || undefined, items: old.map(entry) }] : []),
      ...(gone ? [{ separator: true }, { label: `${gone} more with no data in this ${span ? 'range' : 'shot'}`, disabled: true }] : [])];
  }
  const putSource = (c) => tr.setSource(c, target, pickRun?.id, 'row');
  // ---- Pair: the run's parts (painted groups; a run without: its motion groups), click the moving one, then the other ----
  const parts = $derived.by(() => {
    const r = pickRun;
    if (!r) return [];
    const has = (k) => r.channels[k + '_x']?.v?.some((x) => x === x && x != null);   // a part with data (old runs keep empty ones)
    const sem = fusionGroups(r).filter((g) => has(g.key)).map((g) => ({ key: g.key, label: partLabel(g.name), color: semColor(g.name) }));
    if (sem.length) return sem;
    return Object.keys(r.channels).filter((k) => /^g[1-4](p[12])?_x$/.test(k) && r.channels[k.slice(0, -2) + '_y']).map((k) => k.slice(0, -2)).map((k) => ({ key: k, label: labelOf(groups, k + '_x') || k, color: chipColor(k + '_proj') }));
  });
  const pairNow = $derived(relParse(picked));
  let pairOpen = $state(false), pairA = $state(''), pairBtn = $state(null);
  const partName = (k) => parts.find((p) => p.key === k)?.label || k;
  function pairClick(k) {
    if (!pairA) { pairA = k; return; }
    if (k === pairA) { pairA = ''; return; }
    tr.setPair(pairA, k, target, 'row');
    pairA = ''; pairOpen = false; peek = '';
  }
  function pairOnVideo() { tr.pairPick = { first: pairA, span: target }; pairOpen = false; pairA = ''; app.toast('Pair: click the moving part on the video, then the part it moves against (Esc cancels)', 'info'); }
  const PAIR_TIP = "Pair: the script from two parts' relative motion (the first moves against the second: a's centre minus b's on the stroke axis; camera moves cancel). Click two parts here, or pick them on the video. One undo step";
  // ---- measured against: the camera (its removal: mode / strength / smooth), none, or a part ----
  const AGAINST_TIP = "What the signal is measured against. Camera (default): the camera's motion removed (mode / strength / smooth below). None: image positions. A part: the signal relative to it (a single part becomes the pair part ↔ it; fused: every part's centre minus it). No re-track";
  const agLabel = (a) => (a === 'camera' ? 'camera' : a === 'none' ? 'none' : a.startsWith('sem_') ? chipTag(a.slice(4)) : partName(a));
  /** The against picker's items for tg (a range; default: the row's target). */
  function againstItems(tg = target) {
    const sp = tg ? tr.spanOver(tg) : null, against = sp?.against || shotD?.against || 'camera', si = tg ? sceneAt(tr.scenes, (tg.t0 + tg.t1) / 2) : pickScene;
    const cs = si >= 0 ? tr.camState(si, sp, pickRun?.id) : { cam: { ...CAM_DEFAULT }, from: 'tracked', tag: null }, cam = cs.cam, explicit = cs.from === 'override' || cs.from === 'adjust';
    const put = (a) => tr.setAgainst(a, tg, pickRun?.id), c = (patch) => tr.setSignalCam(patch, tg);
    const dflt = cs.tag ? `${cs.tag.cam.mode} (${cs.tag.label})` : 'auto';
    return [
      { label: 'Camera — its motion removed (as set below)', type: 'radio', checked: against === 'camera', run: () => put('camera') },
      { label: 'None — image positions', type: 'radio', checked: against === 'none', run: () => put('none') },
      ...(parts.length ? [{ section: 'A part' }, ...parts.map((p) => ({ label: p.label, type: 'radio', checked: against === p.key, run: () => put(p.key) }))] : []),
      { section: 'Camera removal' + (tg ? ' (this range)' : ' (this shot)') },
      ...(cs.tag || explicit ? [{ label: `Default: ${dflt}`, type: 'radio', checked: cs.from === 'tag', run: () => c(null) }] : []),
      { label: `Mode: ${CAM_OPTIONS.find((o) => o.value === cam.mode)?.label || cam.mode}${cs.from === 'tag' ? ` (${cs.tag.label} default)` : ''}`, items: CAM_OPTIONS.map((o) => ({ label: `${o.label} — ${o.tip}`, type: 'radio', checked: cam.mode === o.value && cs.from !== 'tag', run: () => c({ mode: o.value }) })) },
      { label: `Strength: ${cam.strength} %`, items: [100, 75, 50, 25, 0].map((v) => ({ label: v + ' %', type: 'radio', checked: cam.strength === v, run: () => c({ strength: v }) })) },
      { label: `Smooth: ${cam.smoothMs} ms`, items: [0, 150, 300, 600, 1000, 2000].map((v) => ({ label: v ? v + ' ms' : 'off', type: 'radio', checked: cam.smoothMs === v, run: () => c({ smoothMs: v }) })) },
    ];
  }
  // ---- range override segments (tr.signalSpans over the pick run): click = select, ends drag, X / Delete / × remove ----
  const segStrip = $derived(!!pickRun && ctl.has('overrides'));   // paw-unuy: the combined lane's override strip
  // paw-unuy (the owner: "I'd layer this tbh rather than under"): the override row and the direction row are a band INSIDE the lane
  // along its bottom edge; the lane's pos scale ends above it (LaneView `edge`), so a point at pos 0 is never under it
  // paw-bg90: a range override narrower than this (px) has no × (X / Delete / right-click remove it); paw-k8pe: the combined lane's ×
  // is a kit small control wide (--ctl-h-sm), so a segment needs room for its words beside it
  const OVX_MIN = embedded ? 48 : 24;
  // paw-1ysd: the run strip (which run plays where, its flipped stretches) over the overrides. paw-k8pe (the owner: "this shit is
  // microscopic"): the overrides' words are the kit's small type (--fs-1, never 8 px), the strips one line of it plus a few px, and
  // their size follows the app's one size setting, ui.density (Settings / the View menu): compact | default | comfortable
  const STRIPS = { compact: [8, 14], default: [10, 14], comfortable: [12, 16] };   // [run strip, overrides] px (--fs-1 needs a 13 px line: less clips it)
  const strips = $derived(STRIPS[app.settings.get('ui.density')] || STRIPS.default);
  const RR_H = $derived(strips[0]), OV_H = $derived(strips[1]);
  // one height whenever there are runs: the points never jump when a run is picked or let go (its rows fill in, the band stays)
  const edge = $derived(embedded && tr.runs.length ? RR_H + OV_H : 0);   // paw-1ysd stage 4: the direction marks live on the run strip
  const ph = $derived(Math.max(0, h - edge));   // the lane's plot height (its points' 0..100), the edge band under it
  let shaftNotes = $state([]), shaftCells = $state([]);   // the layered shaft data's words (ShaftData): the band's note, the hover
  const shaftNow = $derived(shaftNotes.find((n) => app.player.timeMs >= n.t0 && app.player.timeMs < n.t1) ?? shaftNotes[0] ?? null);
  const segs = $derived(pickRun && ctl.has('overrides') ? tr.signalSpans.filter((sp) => sp.t1 > pickRun.range.start && sp.t0 < pickRun.range.end && sp.t1 > app.view.start && sp.t0 < app.view.start + app.view.span) : []);
  const segLabel = (sp) => [sp.source && chipLabel(sp.source), sp.against && 'vs ' + agLabel(sp.against), sp.cam && 'cam ' + sp.cam.mode + (sp.cam.strength !== 100 ? ' ' + sp.cam.strength + '%' : '') + (sp.cam.smoothMs ? ' ~' + sp.cam.smoothMs : '')].filter(Boolean).join(' · ');
  const segTip = (sp) => `Range override ${fmtTime(sp.t0)}–${fmtTime(sp.t1)}: ${segLabel(sp)}. Click = select (the row's pickers then act on it; X / Delete removes it); drag its body to move it, an end to resize; right-click = its options (Whole shot, Remove). Its joins cross-fade over 0.3 s`;
  function segItems(sp) {
    const put = (c) => tr.setSource(c, sp, pickRun?.id, 'override');
    return [{ label: 'Source', items: sourceItems(put, sp.source || shotSrc, sp) }, { label: 'Measured against', items: againstItems(sp) },
      { label: 'Back to the scene\'s source', run: () => tr.setSpan(sp, { source: undefined }) },
      { label: 'Whole shot', run: () => wholeShot(sp) }, { label: 'Remove the override', shortcut: 'X', run: () => removeSeg(sp) }];
  }
  function removeSeg(sp) { if (tr.sigSel?.t0 === sp.t0 && tr.sigSel?.t1 === sp.t1) tr.sigSel = null; tr.setSpan(sp, null, { label: 'Signal: remove a range override' }); }
  /** The override stretched over the whole shot it sits in (inside the run). */
  function wholeShot(sp) {
    const s = tr.scenes[sceneAt(tr.scenes, (sp.t0 + sp.t1) / 2)], r = pickRun?.range;
    if (s && r) tr.setSpan(sp, {}, { to: { t0: Math.max(s.start_ms, r.start), t1: Math.min(s.end_ms, r.end) }, label: 'Signal: range override over the whole shot' });
  }
  // body drag = move (kept inside the run, frame-snapped); a press that does not move stays a click (select)
  let swallow = false;
  function segBodyDown(e, sp) {
    if (e.button !== 0 || !pickRun) return;
    e.stopPropagation();
    const el = e.currentTarget, x0 = e.clientX, len = sp.t1 - sp.t0, start = sp.t0, r = pickRun.range, perPx = app.view.span / w;
    el.setPointerCapture(e.pointerId);
    let to = null;
    const mv = (ev) => {
      const dx = ev.clientX - x0;
      if (!to && Math.abs(dx) < 4) return;
      const a = Math.max(r.start, Math.min(r.end - len, app.player.snap(start + dx * perPx)));
      to = { t0: a, t1: a + len };
      tr.setSpan(sp, {}, { to, commit: false });
    };
    const done = (ev) => {
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', done); el.removeEventListener('pointercancel', done);
      if (to && ev.type === 'pointerup') { swallow = true; setTimeout(() => (swallow = false), 0); tr.setSpan(sp, {}, { to, label: 'Signal: move a range override' }); tr.sigSel = { t0: to.t0, t1: to.t1 }; }
      else tr.signalPreview = null;
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', done); el.addEventListener('pointercancel', done);
  }
  function segKey(e, sp) {
    if (['Delete', 'Backspace', 'x', 'X'].includes(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); removeSeg(sp); }
    else if (e.key === 'Escape' && tr.sigSel) { e.stopPropagation(); tr.sigSel = null; }
  }
  // paw-5z78: a selected range override (clicked: its button focused and on) is the editor selection: left / right move it a frame
  const segItem = (k) => () => ({
    active: () => { const sp = segs[k]; return !!sp && tr.sigSel?.t0 === sp.t0 && tr.sigSel?.t1 === sp.t1; },
    nudge: (dx) => {
      const sp = segs[k], g = gridOf(app.player), r = pickRun?.range;
      if (!sp || !dx || !g) return;
      const t0 = frameTime(frameAt(sp.t0, g) + dx, g), to = { t0, t1: sp.t1 + (t0 - sp.t0) };
      if (r && (to.t0 < r.t0 || to.t1 > r.t1)) return;
      tr.setSpan(sp, {}, { to, label: 'Signal: move a range override' }); tr.sigSel = { t0: to.t0, t1: to.t1 };
    },
  });
  let segDrag = null;
  function segDown(e, sp, side) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const el = e.currentTarget, x0 = canvas.getBoundingClientRect().left;
    // paw-j371: Escape / a cancel end the drag whole (its listeners too): a later move must not find segDrag gone
    const off = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', cancelSeg); };
    segDrag = { sp, side, to: null, off };
    const mv = (ev) => {
      if (!segDrag) return;
      const t = Math.round(xToMs(app.view, w, ev.clientX - x0)), MIN = 100;
      segDrag.to = side ? { t0: sp.t0, t1: Math.max(sp.t0 + MIN, t) } : { t0: Math.min(sp.t1 - MIN, t), t1: sp.t1 };
      tr.setSpan(sp, {}, { to: segDrag.to, commit: false });
    };
    const up = () => { off();
      const d = segDrag; segDrag = null; if (d?.to) tr.setSpan(d.sp, {}, { to: d.to, label: 'Signal: resize a range override' }); else tr.signalPreview = null; };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', cancelSeg);
  }
  function cancelSeg() { segDrag?.off(); segDrag = null; tr.signalPreview = null; }
  // paw-unuy: the combined lane's override strip (under the lane): a drag along its empty part draws a range override (frame-snapped;
  // the canvas takes focus, so X / Delete removes it once selected), a press without a drag seeks
  let railEl = $state(null);
  const railMs = (e) => app.player.snap(xToMs(app.view, w, e.clientX - railEl.getBoundingClientRect().left));
  function railDown(e) {
    if (e.button !== 0 || !pickRun || e.target !== railEl) return;
    const el = e.currentTarget, t0 = railMs(e), x0 = e.clientX;
    el.setPointerCapture(e.pointerId);
    canvas?.focus({ preventScroll: true });
    let moved = false;
    const mv = (ev) => { if (!moved && Math.abs(ev.clientX - x0) < 4) return; moved = true; rubber = { t0, t1: railMs(ev) }; };
    const off = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', done); el.removeEventListener('pointercancel', done); railCancel = null; };
    const done = (ev) => {
      off();
      const r = rubber; rubber = null;
      if (ev.type !== 'pointerup') return;
      if (moved && r && r.t1 !== r.t0) tr.addSignalSpan(r.t0, r.t1);
      else if (!moved) app.player.seek(xToMs(app.view, w, ev.clientX - railEl.getBoundingClientRect().left), { exact: true });
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', done); el.addEventListener('pointercancel', done);
    railCancel = () => { off(); rubber = null; };   // paw-k8rq: Escape ends the draw; the next move or the release writes nothing
  }
  let railCancel = null;
  function setMode(m) {
    const r = pickRun, old = sceneLink?.baseline;
    if (!r || carrierBlock) return;
    // off / auto keep the user's knots for later
    if (m !== 'knots' || old?.knots?.length) { tr.setCarrier(r.id, pickScene, { baseline: { ...old, mode: m } }); return; }
    const k = tr.setCarrier(r.id, pickScene, { baseline: { mode: 'auto' } });   // knots from nothing: the auto curve's
    const c = k >= 0 && carriers(tr.run(r.id), tr.links, tr.channelFit).find((x) => x.link === tr.links[k]);
    if (c?.mid?.length) tr.patchLink(k, { baseline: { mode: 'knots', knots: c.mid } });
  }
  // paw-2ntn: the anchor chips (tracking.svelte.js setAnchor; the envelope is its "full")
  const ANCHOR_TIP = {
    middle: 'A stroke shorter than the range sits round the middle (as fusion leaves it). One undo step',
    in: 'Every stroke reaches fully in (pos 0); a shorter one comes out less far. Its size stays true: half a stroke is half the range. One undo step',
    out: 'Every stroke returns fully out (pos 100); a shorter one goes in less far. Its size stays true. One undo step',
    full: 'Every stroke stretched to the full range (the envelope; like the baseline, not an undo step)',
  };
  // ---- paw-gy1r: where the fused strokes sit in the depth range and how big they are (lib/depth-seat.js; the shot's
  //      derive.fuse.depth): fusion's own, or seated on a signal that carries depth. The dashed line is the level used; the
  //      owner's baseline knots move it. Belongs to the whole shot, like the baseline; one undo step ----
  const DEPTHS = $derived(['fusion', 'pick', 'pair', 'shaft', ...(pickRun ? partNames(pickRun).map(partSource) : [])]);   // paw-4c48.19: + the run's depth parts
  const depthOn = $derived(!!pickRun && ctl.has('pad') && pickScene >= 0 && shotSrc === 'fused');
  const depthNow = $derived(depthOn ? tr.fuseControls(pickScene, null, pickRun.id).depth || 'fusion' : 'fusion');
  const depthInfo = $derived(depthOn ? tr.fuseInfo(pickScene, null)?.depth ?? null : null);
  const depthSeated = $derived(!!depthInfo?.used);
  const pickName = $derived(pickDec?.chosen ?? pickRun?.params?.primary ?? '');
  const DEPTH_WHAT = { fusion: "fusion's own level and size (every relationship is centred over two strokes and scaled by its own spread: a stretch of small strokes at depth comes out centred and full size)", pick: 'the sidecar pick', pair: "the two bodies' distance along the stroke", shaft: "the shaft's visible share (where it is read with confidence)" };
  const depthWhat = (m) => DEPTH_WHAT[m] || (partOf(m) ? `the ${partWord(partOf(m))}'s visible share (where it is read with confidence)` : m);
  const depthBlock = (m) => (!pickRun || m === 'fusion' ? '' : m === 'pick' ? (pickName && pickName !== 'fused' && pickRun.channels[pickName] ? '' : 'no sidecar pick channel in this run') : m === 'pair' ? (pickRun.channels.who_pair_proj || pickRun.channels.pair_proj ? '' : 'no pair tracked (two characters, or the motion groups)') : partOf(m) ? (shaftOf(pickRun, pickRunScene, { part: partOf(m) }) ? '' : `no ${partWord(partOf(m))} measured by SAM in this scene`) : shaftOf(pickRun, pickRunScene) ? '' : 'no shaft pass in this scene (paint the penis and re-track)');
  const depthTip = (m) => {
    if (m === 'fusion') return `Depth from ${DEPTH_WHAT.fusion}. The default. One undo step`;
    const b = depthBlock(m), now = depthNow === m && depthInfo ? (depthInfo.used ? ` · now: seated on ${Math.round(100 * depthInfo.used)} % of the shot (it moves with the stroke: r ${depthInfo.r})` : ` · now: not used, ${depthInfo.why}: fusion's own`) : '';
    return b ? `Depth from ${depthWhat(m)}: ${b}` : `Depth from ${depthWhat(m)}${m === 'pick' ? ` (${pickName})` : ''}: the fused strokes keep their timing and shape, and sit at its level with its size, read slowly over a few strokes (its spikes, clipped floor and jitter do not come through; where it is missing, fusion's own). The dashed line is the level used${now}. One undo step`;
  };
  const setDepth = (m) => { if (depthOn && !depthBlock(m) && m !== depthNow) tr.setFuse(pickScene, { depth: m === 'fusion' ? null : m }, { label: `Depth from ${m === 'fusion' ? 'fusion' : depthWhat(m).replace(/ \(.*$/, '')}`, run: pickRun.id }); };

  // ---- paw-iasp: the fusion pad, a DAW-style XY mod input beside the source chip while the signal is fused: press it and
  //      drag anywhere (relative motion, so the chip can stay small); the trace redraws per animation frame (only the
  //      fusion's weighting re-runs: lib/fusion.js caches the rest); release = one undo step; double-click / 0 = centre.
  //      x: relative (the bodies against each other) <-> absolute (a body against the camera); y: core <-> extremities.
  //      Inside a range override it edits the override, like the source / camera pickers. ----
  const padOn = $derived(!!pickRun && ctl.has('pad') && tgtShot >= 0 && picked === 'fused');
  const pad = $derived.by(() => { const p = padOn ? tr.fuseControls(tgtShot, target, pickRun.id).pad : null; return { x: p?.x || 0, y: p?.y || 0 }; });
  const padAuto = $derived(padOn ? tr.fuseInfo(tgtShot, target)?.auto ?? null : null);   // where the automatic choice sits (the override's own fusion inside one, paw-439e)
  const PAD_PX = 120, PAD_FINE = 0.25;   // px of pointer travel from the centre to an edge; Shift = a quarter of that speed
  const padAt = (v) => `${((v + 1) / 2) * 100}%`, padTop = (v) => `${((1 - v) / 2) * 100}%`;
  const r2 = (v) => Math.round(v * 100) / 100;
  const padText = (p) => (p.x || p.y ? `${p.x < 0 ? 'rel' : 'abs'} ${Math.abs(p.x).toFixed(1)} · ${p.y < 0 ? 'core' : 'ext'} ${Math.abs(p.y).toFixed(1)}` : 'nudge');
  const PAD_TIP = $derived(`Fusion pad (a mod input): press here and drag anywhere to nudge the fused signal while the trace redraws. Left = relative (the two bodies against each other: camera moves cancel), right = absolute (a body against the camera); up = extremities (hands, head, ${partList(['paws'])}), down = core (hips, thighs, torso). The centre is the automatic choice (scene type + phase); the faint ring is where that choice sits. Nothing is switched off, only weighted (x4 at an edge). Shift = fine, arrows nudge, double-click or 0 = back to centre. One undo step per drag`);   // paw-43vn: the part examples follow furry items (lib/content.js)
  let padDrag = $state(null), padRaf = 0;
  function padDown(e) {
    if (e.button !== 0 || !padOn) return;
    e.preventDefault();
    const el = e.currentTarget, b = el.getBoundingClientRect();
    el.setPointerCapture(e.pointerId); el.focus({ preventScroll: true });
    padDrag = { x0: e.clientX, y0: e.clientY, p0: { ...pad }, cur: { ...pad }, g: e.shiftKey ? PAD_FINE : 1, moved: false, shot: tgtShot, span: target, run: pickRun.id, left: b.left, top: b.top };
  }
  function padMove(e) {
    const d = padDrag;
    if (!d) return;
    const g = e.shiftKey ? PAD_FINE : 1;
    if (g !== d.g) { d.p0 = { ...d.cur }; d.x0 = e.clientX; d.y0 = e.clientY; d.g = g; }   // a gain change re-anchors: no jump
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 2) return;
    const c = (v) => r2(Math.max(-1, Math.min(1, v)));
    padDrag = { ...d, moved: true, cur: { x: c(d.p0.x + ((e.clientX - d.x0) / PAD_PX) * g), y: c(d.p0.y - ((e.clientY - d.y0) / PAD_PX) * g) } };
    if (!padRaf) padRaf = requestAnimationFrame(() => { padRaf = 0; const q = padDrag; if (q?.moved) tr.setFuse(q.shot, { pad: q.cur }, { commit: false, span: q.span, run: q.run }); });
  }
  function padEnd(e) {
    const d = padDrag;
    padDrag = null; cancelAnimationFrame(padRaf); padRaf = 0;
    if (!d) return;
    if (d.moved && e.type === 'pointerup') tr.setFuse(d.shot, { pad: d.cur.x || d.cur.y ? d.cur : null }, { span: d.span, run: d.run, label: 'Fusion: pad' });
    else if (d.moved) { tr.derivePreview = null; tr.signalPreview = null; }   // cancelled: the preview goes, nothing written
  }
  const padSet = (p, label) => tr.setFuse(tgtShot, { pad: p && (p.x || p.y) ? { x: r2(p.x), y: r2(p.y) } : null }, { span: target, run: pickRun.id, label });
  // paw-439e: the standing pad, pinned from the chip as a small floating pad (the same value); its title bar moves it
  function pinPad(e) {
    app.usage?.note('tracking:padPin', { on: !tr.fusePadPin });   // paw-r73w
    if (tr.fusePadPin) { tr.fusePadPin = null; return; }
    const b = e.currentTarget.getBoundingClientRect();
    tr.fusePadPin = { x: Math.max(4, Math.min(window.innerWidth - 200, b.left - 80)), y: Math.max(4, b.top - 236) };
  }
  function padMoveStart(e) {
    if (e.button !== 0 || !tr.fusePadPin) return;
    e.preventDefault();
    const el = e.currentTarget, x0 = e.clientX, y0 = e.clientY, p0 = { ...tr.fusePadPin };
    el.setPointerCapture(e.pointerId);
    const mv = (ev) => { tr.fusePadPin = { x: Math.max(0, Math.min(window.innerWidth - 60, p0.x + ev.clientX - x0)), y: Math.max(0, Math.min(window.innerHeight - 30, p0.y + ev.clientY - y0)) }; };
    const done = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', done); el.removeEventListener('pointercancel', done); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', done); el.addEventListener('pointercancel', done);
  }
  function padKey(e) {
    if (!padOn || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '0' || e.key === 'Home') { e.preventDefault(); e.stopPropagation(); padSet(null, 'Fusion: pad back to centre'); }
  }
  // paw-5z78: the arrows come through the key map (the pad focused is the editor selection): 0.1, Shift 0.02
  const padItem = () => ({ nudge: (dx, dy, fine) => {
    if (!padOn) return;
    const st = fine ? 0.02 : 0.1, c = (v) => Math.max(-1, Math.min(1, v));
    padSet({ x: c(pad.x + dx * st), y: c(pad.y + dy * st) }, 'Fusion: pad');
  } });

  // ---- carrier curves of the pick run (visible), and their knot handles ----
  const curves = $derived(pickRun && tr.ghost(pickRun.id)?.visible ? carriers(pickRun, tr.links, tr.channelFit).map((c) => {
    const ch = pickRun.channels[c.channel], lo = ch.min, span = ch.max - ch.min || 1;
    return { ...c, lo, span, fns: ['mid', 'top', 'bottom'].map((f) => (c[f]?.length ? spline(c[f]) : null)) };
  }) : []);
  const vY = (c, v) => Y((v - c.lo) / c.span);
  const yV = (c, y) => c.lo + c.span * unY(y);   // inverse of Y
  /** The knots a scene's baseline is edited from: the user's knots in knots mode, else the auto curve's. */
  const knotsOf = (c) => (c.link?.baseline?.mode === 'knots' && c.link.baseline.knots?.length ? c.link.baseline.knots : c.mid || []).map((p) => [...p]);
  function handles() {
    const out = [];
    curves.forEach((c, ci) => (c.mid || []).forEach(([t, v], j) => { const x = msToX(app.view, w, t); if (x >= -8 && x <= w + 8) out.push({ x, y: vY(c, v), ci, j }); }));
    return out;
  }
  function hitKnot(x, y) { const hs = handles(), i = nearestHandle(hs, x, y, 8); return i >= 0 ? hs[i] : null; }
  /** The baseline curve within 6 px of (x, y): {ci, t, v} or null. */
  function hitCurve(x, y) {
    const t = xToMs(app.view, w, x);
    for (let ci = 0; ci < curves.length; ci++) {
      const c = curves[ci];
      if (!c.fns[0] || t < c.t0 || t > c.t1) continue;
      const v = c.fns[0](t);
      if (Math.abs(vY(c, v) - y) <= 6) return { ci, t, v };
    }
    return null;
  }

  // ---- painting: effects only schedule; paint() reads current state once per animation frame ----
  // paw-unuy, raw vs script on the combined lane: the runs' traces (the tracked signal) are thin and faint under the lane's own
  // line; the line with points is the script there (the live result where a shot is not baked, the baked points where it is)
  const TRACE = { lw: 1, alpha: 0.55 };
  let raf = 0;
  $effect(() => {
    w; h; themeTick; tr.selectedId; tr.trackJob; tr.progress; tr.sceneInfo; tr.runs; tr.tick; tr.live; app.view; app.player.timeMs; app.doc.range; app.doc.ghosts;
    curves; peek; tr.knotSel; tr.laneFocused; repeatsOf(app); rubber; tr.sigSel;
    if (!raf) raf = requestAnimationFrame(paint);
  });
  $effect(() => () => { cancelAnimationFrame(raf); cancelAnimationFrame(knotRaf); });
  function paint() {
    raf = 0;
    if (!canvas || !w || !h) return;
    const d = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * d) || canvas.height !== Math.round(h * d)) { canvas.width = Math.round(w * d); canvas.height = Math.round(h * d); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const vis = visibleRuns(), sel = tr.selected;
    const layers = vis.map((r) => { if (r.mod) { const mm = modMeasure(r); return mm ? { id: r.id, color: r.color, t: mm.t, v: mm.v, lw: 1, alpha: sel && r.id !== sel.id ? 0.45 : 0.9 } : null; }   // paw-ef73.26: a modifier's own run: its measure, thin, over its range
      const { pat: _p, ppos: _q, ...L } = layerOf(r); return { ...L, dim: !!sel && r.id !== sel.id, ...(r.derived ? { dash: [6, 4] } : {}), ...(embedded ? TRACE : {}) }; }).filter(Boolean);   // paw-ef73.33: a derived run dashed
    const k = sel ? layers.findIndex((L) => L.id === sel.id) : -1;
    if (k >= 0) layers.push(layers.splice(k, 1)[0]);   // selected on top
    // a hovered pair chip (Pair): that channel in front, a preview of the pick
    const pc = peek && peek !== picked && pickRun ? (peek === 'primary' ? pickRun.samples : pickRun.channels[peek] || relChannels(pickRun, [peek], { aspect: tr.aspect })?.[peek]) : null;
    if (pc) layers.push({ color: tok(chipColor(peek) || 'var(--tx-hi)'), t: pc.t, v: pc.scaled || pc.v, lw: 1.5, alpha: 0.9 });
    // carrier curves: baseline dashed, envelope dotted (sampled every ~3 px of the scene's visible part)
    const a = app.view.start, b = a + app.view.span, line = tok('var(--tx-hi)');
    for (const c of curves) {
      const t0 = Math.max(a, c.t0), t1 = Math.min(b, c.t1);
      if (t1 <= t0) continue;
      const n = Math.max(8, Math.min(800, Math.ceil(((t1 - t0) / app.view.span) * w / 3)));
      c.fns.forEach((f, q) => {
        if (!f) return;
        const t = new Float64Array(n + 1), v = new Float32Array(n + 1);
        for (let i = 0; i <= n; i++) { t[i] = t0 + ((t1 - t0) * i) / n; v[i] = (f(t[i]) - c.lo) / c.span; }
        layers.push(q ? { color: line, t, v, lw: 1, alpha: 0.6, dash: [2, 3] } : { color: line, t, v, lw: 1.25, alpha: 0.85, dash: [6, 3] });
      });
    }
    // the selected run's stitches (runs-channel.js stitchPoints): each join between two scenes' points, dashed like a run ghost, in pos
    if (sel?.stitches?.length && vis.includes(sel)) for (const s of sel.stitches) layers.push({ color: sel.color, t: [s.t0, s.t1], v: [s.p0 / 100, s.p1 / 100], lw: 1.25, alpha: 0.9, dash: [4, 3] });
    const cc = tr.camCompare;   // a camera control is being dragged: the same signal with no camera removal, dashed (paw-a3n)
    if (cc) layers.push({ color: tok('var(--tx-mut)'), t: cc.t, v: cc.v, lw: 1.25, alpha: 0.9, dash: [4, 3] });
    if (tr.live) layers.push({ color: tok(LIVE_COLOR), t: tr.live.frames.t, v: tr.live.frames.v });
    const marks = [...vis.flatMap((r) => r.events.filter((e) => e.end_ms == null).map((e) => ({ t: e.t_ms, label: e.label, color: r.color }))), ...tr.cycleMarks, ...seeds()];
    const bands = (sel?.events || []).filter((e) => e.end_ms != null).map((e) => ({ t0: e.t_ms, t1: e.end_ms, label: e.label || e.kind, color: tok(KIND_COLOR[e.kind] || TAG_COLOR) }));
    for (const r of vis) if (r.derived) bands.push({ t0: r.range.start, t1: r.range.end, label: `${r.name} · ${r.derived.what}${tr.isLiveFill(r) ? '' : ' · detached'}`, color: r.color });   // paw-ef73.33: what it is, over it
    // paw-bh2: a one-way track grows from its seed (backward: leftward) by its progress; a one-way run marks its seed
    for (const l of pickRun?.low || []) bands.push({ t0: l.t0, t1: l.t1, label: 'low confidence: Fill', color: tok('var(--warn-ink)') });   // paw-e3i strokes.js
    const job = tr.trackJob, pb = progressBand(job, tr.progressFrac);
    if (pb) { bands.push({ t0: pb.t0, t1: pb.t1, label: job.dir === 'backward' ? '◀ tracking back' : 'tracking ▶', color: tok(LIVE_COLOR) }); marks.push({ t: job.seed, label: 'seed', color: tok(LIVE_COLOR), force: true }); }
    if (sel?.seedMs != null && vis.includes(sel)) marks.push({ t: sel.seedMs, label: `seed (${sel.direction})`, color: sel.color, force: true });
    const cr = sel && vis.includes(sel) && sel.confidence ? sel : vis.find((r) => r.confidence);
    const r = app.doc.range;
    if (pickRun && !embedded) { ctx.fillStyle = tok('var(--line-1)'); ctx.globalAlpha = 0.35; ctx.fillRect(0, BAND0, w, BAND1 - BAND0); ctx.globalAlpha = 1; }   // the drawing band (combined lane: its own strip)
    ctx.clearRect(0, 0, w, h);   // (the combined lane: drawLane clears its plot only; the edge band under it is drawn below)
    const lit = (L) => ({ ...L, color: tok(L.color) });   // a run's colour is a 'var(--series-x)' token: the canvas needs the literal
    drawLane(ctx, w, embedded ? ph : h, app.view, layers.map(lit), { dur: app.durationMs, playhead: app.player.timeMs, range: r ? { start: r.t0, end: r.t1 } : null, marks: marks.map(lit), bands: bands.map(lit),
      confidence: cr ? { ...cr.confidence, color: tok(cr.color) } : null, ...(embedded ? { bare: true, y: Y, left: GUTTER_W } : {}) });
    // paw-na9u: the Detail's points as the device draws them (stroke-shape.js renderScript, the generic smooth device: a move
    // from rest to rest is an S, a point inside a move is passed smoothly) over the trace, so a point shows why it is there
    const fit = renderFit();
    if (fit) {
      ctx.strokeStyle = tok('var(--tx-hi)'); ctx.globalAlpha = embedded ? 0.45 : 0.75; ctx.lineWidth = 1.25; ctx.setLineDash([]);
      ctx.beginPath(); fit.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.globalAlpha = 1;
    }
    canvas.dataset.renderFit = fit ? String(fit.length) : '0';
    // paw-e3i: why each point of a new-strokes scene exists: a detail point a small square, a speed-clamped one a triangle
    for (const m of whyMarks()) {
      ctx.fillStyle = m.why === 'clamped' ? tok('var(--warn-ink)') : tok('var(--tx-hi)');
      ctx.beginPath();
      if (m.why === 'clamped') { ctx.moveTo(m.x, m.y - 4); ctx.lineTo(m.x + 4, m.y + 3); ctx.lineTo(m.x - 4, m.y + 3); ctx.closePath(); ctx.fill(); }
      else if (m.why === 'detail' || m.why === 'mid' || m.why === 'shoulder') ctx.fillRect(m.x - 2, m.y - 2, 4, 4);
      else if (m.why === 'hold') ctx.fillRect(m.x - 4, m.y - 1, 8, 2);
      else { ctx.arc(m.x, m.y, 2.5, 0, 6.2832); ctx.fill(); }
    }
    if (rubber && !embedded) {
      const x0 = msToX(app.view, w, Math.min(rubber.t0, rubber.t1)), x1 = msToX(app.view, w, Math.max(rubber.t0, rubber.t1));
      ctx.fillStyle = tok('var(--highlight)'); ctx.globalAlpha = 0.3; ctx.fillRect(x0, BAND0, Math.max(1, x1 - x0), BAND1 - BAND0); ctx.globalAlpha = 1;
    }
    // paw-izk: where a shot or an area overrides its scene's Detail, a thin strip along the top
    ctx.fillStyle = tok('var(--series-yellow)');
    for (const o of tr.allDetailOverrides) { const x0 = Math.max(0, msToX(app.view, w, o.t0)), x1 = Math.min(w, msToX(app.view, w, o.t1)); if (x1 > x0) ctx.fillRect(x0, 0, Math.max(1, x1 - x0), 3); }
    // paw-e3i: a scene on the fused signal shows who carries it: a stacked strip of the parts' weights per 2 s window
    const fz = pickRun?.channels?.fused?.info;
    if (fz && pickRun.sceneChannels) pickRun.sceneChannels.forEach((c, k) => {
      const inf = c === 'fused' && fz[k];
      if (!inf) return;
      const col = Object.fromEntries(inf.candidates.map((x) => [x.id, semPaint(x.parts[0])]));
      for (const win of inf.windows) {
        const x0 = msToX(app.view, w, win.t), x1 = msToX(app.view, w, win.t1);
        if (x1 < 0 || x0 > w) continue;
        let y = (embedded ? ph : h) - 1;
        for (const [id, sh] of Object.entries(win.w).sort((a, b) => b[1] - a[1])) { const hh = 6 * sh, y0 = Math.round(y - hh), y1 = Math.round(y); ctx.fillStyle = col[id]; ctx.globalAlpha = 0.85; if (y1 > y0) ctx.fillRect(x0, y0, Math.max(1, x1 - x0), y1 - y0); y -= hh; }   // whole px: a share's rounding noise is no half-lit row
        ctx.globalAlpha = 1;
      }
    });
    // knot handles (the CurveEditor dot): hollow; the clicked one filled
    const ks = tr.knotSel;
    ctx.lineWidth = 1.5; ctx.strokeStyle = line;
    for (const hd of handles()) {
      const on = !!ks && tr.links[ks.k] === curves[hd.ci].link && ks.j === hd.j;
      ctx.beginPath(); ctx.arc(hd.x, hd.y, on ? 4.5 : 3.5, 0, 6.2832);
      ctx.fillStyle = on ? line : tok('var(--bg-card)'); ctx.fill(); ctx.stroke();
    }
  }

  // ---- interaction: wheel = zoom at cursor (shift / horizontal = pan), drag = pan, click = seek, double-click = fit;
  //      on a baseline: knot drag / double-click adds / right-click removes ----
  let press = null, knotDrag = null, knotRaf = 0, cursor = $state('crosshair');
  // the thin band (paw-hiq5): a horizontal drag here draws a range override. Nothing else is pressed at those heights except
  // knots (checked first) and click-to-seek (a press that does not move still seeks); Alt+drag was not needed.
  const BAND0 = 18, BAND1 = 31;
  let rubber = $state(null);   // {t0, t1} the range being drawn
  const at = (e) => { const b = canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  function down(e) {
    if (e.button === 1) { e.preventDefault(); canvas.setPointerCapture(e.pointerId); press = { x: e.clientX, view: app.view, moved: true }; return; }   // middle-drag pans, as on every row (paw-ef73.7)
    if (e.button !== 0) return;
    leave(); canvas.setPointerCapture(e.pointerId);
    const [x, y] = at(e), hk = hitKnot(x, y);
    if (hk) { startKnot(e, x, y, hk); return; }
    if (tr.knotSel) tr.knotSel = null;
    press = { x: e.clientX, view: app.view, moved: false };
    if (pickRun && y >= BAND0 && y <= BAND1) { press.create = app.player.snap(xToMs(app.view, w, x)); canvas.focus({ preventScroll: true }); }
  }
  /** A press on knot hk: it is selected (the canvas focused, so Delete is the knot's) and dragged. -> false when its link is gone. */
  function startKnot(e, x, y, hk) {
    const c = curves[hk.ci], k = tr.links.indexOf(c.link);
    if (k < 0) return false;
    canvas.focus({ preventScroll: true });
    tr.knotSel = { k, j: hk.j };
    knotDrag = { k, j: hk.j, c, knots0: knotsOf(c), orig: c.link.baseline, p0: { x, y }, h0: { x: hk.x, y: hk.y }, gain: e.shiftKey ? FINE : GAIN, moved: false, knots: null };
    cursor = 'grabbing';
    return true;
  }
  // paw-unuy: the combined lane's gestures of this layer (lanes/LaneView.svelte asks where none of its points / handles is). A knot:
  // drag it, double-click the curve = a knot, right-click a knot = remove it; a seed mark's label: click = its frame; the hover
  // words (why a point is there, a seed mark); right-click elsewhere: the lane's menu plus the run's Detail, Use as a reference…
  // and the span labels' ranges. Everything else (seek, box select, add a point, pan, zoom) is the lane's own.
  const claim = {
    down(e) {
      const [x, y] = at(e), hk = hitKnot(x, y);
      leave();
      if (hk) return startKnot(e, x, y, hk);
      if (tr.knotSel) tr.knotSel = null;
      const sm = seedHit(seeds(), x, y, (t) => msToX(app.view, w, t), { maxY: SEED_Y });
      if (sm) { press = { seed: sm }; return true; }
      return false;
    },
    move(e) { if (knotDrag) dragKnot(e); },
    up(e) {
      if (knotDrag) { up(e); return; }
      const p = press; press = null;
      if (p?.seed) app.player.seek(p.seed.t, { exact: true });
    },
    cancel() { press = null; cancel(); },
    hover(e) {
      hover(e);
      if (cursor === 'crosshair' && !whyTip && shaftOn && shaftData) {   // the layered shaft data's state strip (the lane's top): its frame in words
        const [x, y] = at(e), c = y <= SHAFT_Y ? shaftCells.find((q) => x >= q.x && x < q.x + 6) : null;
        if (c) { whyTip = { x, y: 48, text: c.text }; return 'help'; }
      }
      return cursor === 'crosshair' && !whyTip ? null : cursor;
    },
    leave,
    dbl(e) { const [x, y] = at(e); if (hitKnot(x, y) || !hitCurve(x, y)) return false; dbl(e); return true; },
    menu(e) {
      const [x, y] = at(e);
      if (hitKnot(x, y)) { menu(e); return true; }
      const t = xToMs(app.view, w, x);
      return [...runItems(t), ...spanItems(tr.spans, t, (a, b) => tr.setRange(a, b))];
    },
  };
  const SHAFT_Y = 9;   // the layered shaft data's state strip, in the lane's top padding (ShaftData `layered`)
  const SEED_Y = 30;   // a seed mark's label row (lib/lane.js drawLane: marks labelled at the top); below it the lane's own
  function move(e) {
    if (knotDrag) { dragKnot(e); return; }
    if (!press) { hover(e); return; }
    const dx = e.clientX - press.x;
    if (Math.abs(dx) > 3) press.moved = true;
    if (press.create != null) { if (press.moved) rubber = { t0: press.create, t1: app.player.snap(xToMs(app.view, w, at(e)[0])) }; return; }
    if (press.moved) app.setView(panBy(press.view, dx, w, app.durationMs));
  }
  function dragKnot(e) {
    const d = knotDrag, [x, y] = at(e), g = e.shiftKey ? FINE : GAIN;
    const pos = () => ({ x: d.h0.x + (x - d.p0.x) * d.gain, y: d.h0.y + (y - d.p0.y) * d.gain });
    if (!d.moved && Math.hypot(x - d.p0.x, y - d.p0.y) < 3) return;
    d.moved = true;
    if (g !== d.gain) { d.h0 = pos(); d.p0 = { x, y }; d.gain = g; }   // a gain change re-anchors: no jump
    const p = pos(), K = d.knots0, gap = 20;
    const t = Math.round(Math.min(d.j + 1 < K.length ? K[d.j + 1][0] - gap : d.c.t1, Math.max(d.j ? K[d.j - 1][0] + gap : d.c.t0, xToMs(app.view, w, p.x))));
    d.knots = K.map((q, j) => (j === d.j ? [t, +yV(d.c, Math.min(embedded ? ph : h, Math.max(0, p.y))).toPrecision(6)] : q));   // paw-3zfx: the plot, not the band under it
    if (!knotRaf) knotRaf = requestAnimationFrame(() => { knotRaf = 0; if (knotDrag?.knots) tr.patchLink(knotDrag.k, { baseline: { mode: 'knots', knots: knotDrag.knots } }, false); });
  }
  function up(e) {
    if (knotDrag) {
      const d = knotDrag; knotDrag = null; cancelAnimationFrame(knotRaf); knotRaf = 0; cursor = 'crosshair';
      if (d.knots) tr.patchLink(d.k, { baseline: { mode: 'knots', knots: d.knots } });   // the release: one write, the document dirty
      return;
    }
    if (press?.create != null && press.moved) {
      const t1 = app.player.snap(xToMs(app.view, w, at(e)[0])), t0 = press.create;
      rubber = null; press = null;
      if (t1 !== t0) tr.addSignalSpan(t0, t1);
      return;
    }
    if (press && !press.moved) { const x = e.clientX - canvas.getBoundingClientRect().left, sm = seedAt(x); app.player.seek(sm ? sm.t : xToMs(app.view, w, x), { exact: true }); }   // a click on a seed mark lands on its frame
    press = null;
  }
  function cancel() {
    if (!knotDrag) { press = null; rubber = null; return; }
    const d = knotDrag; knotDrag = null; cancelAnimationFrame(knotRaf); knotRaf = 0; cursor = 'crosshair';
    if (d.knots) tr.patchLink(d.k, { baseline: d.orig }, false);
  }
  function dbl(e) {
    const [x, y] = at(e), hc = hitKnot(x, y) ? null : hitCurve(x, y);
    if (!hc) { app.setView({ start: 0, span: app.durationMs }); return; }
    const c = curves[hc.ci], k = tr.links.indexOf(c.link);
    if (k < 0) return;
    const knots = [...knotsOf(c).filter((p) => Math.abs(p[0] - hc.t) > 20), [Math.round(hc.t), +hc.v.toPrecision(6)]].sort((p, q) => p[0] - q[0]);
    tr.patchLink(k, { baseline: { mode: 'knots', knots } });
    canvas.focus({ preventScroll: true });
    tr.knotSel = { k, j: knots.findIndex((p) => p[0] === Math.round(hc.t)) };
  }
  /** paw-e82: on the run at t, its Detail (the shot under the pointer); paw-qynw: Use as a reference… */
  function runItems(t) {
    const i = tr.scenes.findIndex((s) => t >= s.start_ms && t < s.end_ms), st = tr.referenceStretch(t);
    const ref = { label: 'Use as a reference…', disabled: !!st.why, tip: st.why ? st.why.replace(/^Use as a reference: /, '') : `${fmtTime(st.t0)}–${fmtTime(st.t1)} of run #${st.run.n}: strike out the bad regions, Enter saves`, run: () => tr.startReference(t) };
    return [...detailMenu(tr, i), ...(tr.runs.length ? [{ separator: true }, ref] : [])];
  }
  function menu(e) {
    const [x, y] = at(e), hk = hitKnot(x, y);
    if (!hk) {
      const items = runItems(xToMs(app.view, w, x));
      if (items.length) showContextMenu(e, items, { source: canvas });
      return;
    }
    e.preventDefault();
    const c = curves[hk.ci], k = tr.links.indexOf(c.link);
    if (k < 0) return;
    const rest = knotsOf(c).filter((_, j) => j !== hk.j);
    tr.knotSel = null;
    tr.patchLink(k, { baseline: rest.length ? { mode: 'knots', knots: rest } : { mode: 'auto' } });
  }
  // paw-e3i: the points of the picked run where the new strokes step made them, with why (lane coordinates)
  const WHY = { turn: 'a turn of the stroke (top or bottom)', mid: 'the midpoint of this half-stroke: the move is slow-then-fast or fast-then-slow (Detail)', shoulder: 'a shoulder: the move eases into or out of this turn without stopping, a slow transition (Detail by render)', hold: 'a hold: the motion pauses at this turn and resumes here (Detail)', detail: 'a Free detail point: the motion between two turns bends more than the tolerance here', clamped: 'a turn shortened in depth to stay under the max speed (its time kept)', end: 'the end of the signal (a gap or the scene edge)' };
  function whyMarks() {
    const r = pickRun, wy = r?.whys;
    if (!wy || !tr.ghost(r.id)?.visible) return [];
    const a = app.view.start, b = a + app.view.span, out = [];
    for (let k = 0; k < r.points.at.length; k++) {
      const t = r.points.at[k];
      if (t < a || t > b) continue;
      const j = wy.at.indexOf(t);
      if (j >= 0) out.push({ t, x: msToX(app.view, w, t), y: Y(r.points.pos[k] / 100), why: wy.why[j], pos: r.points.pos[k], by: wy.by?.[j] || '' });
    }
    return out;
  }
  /** paw-na9u: the shown run's points rendered by the generic device model over the view (one sample per 2 px), as [x, y]; null
   *  when its points carry no Detail (whyMarks shows nothing). */
  function renderFit() {
    const r = pickRun;
    if (!r?.whys || !tr.ghost(r.id)?.visible || r.points.at.length < 2) return null;
    const a = app.view.start, b = a + app.view.span, P = r.points, k0 = Math.max(0, lowerBound(P.at, a) - 1), k1 = Math.min(P.at.length, lowerBound(P.at, b) + 2);
    if (k1 - k0 < 2) return null;
    const pts = [];
    for (let k = k0; k < k1; k++) pts.push({ at: P.at[k], pos: P.pos[k] });
    const t0 = Math.max(a, pts[0].at), t1 = Math.min(b, pts[pts.length - 1].at), n = Math.max(2, Math.ceil(((t1 - t0) / app.view.span) * w / 2));
    if (!(t1 > t0)) return null;
    const ts = Array.from({ length: n + 1 }, (_, i) => t0 + ((t1 - t0) * i) / n), ys = renderScript(pts, ts);
    return ts.map((t, i) => [msToX(app.view, w, t), Y(ys[i] / 100)]);
  }
  let whyTip = $state(null);   // {x, y, text}: the point under the pointer and why it exists
  // the frame each visible run's painted groups were seeded on (seed-marks.js), and where its picture repeats inside the run
  const seeds = () => visibleRuns().flatMap((r) => seedMarks(seedTimes(r, tr.scenes).filter((t) => r.seedMs == null || Math.abs(t - r.seedMs) > 1), repeatsOf(app), gridOf(app.player), r.range, r.color, document.documentElement.dataset.theme === 'light'));
  const seedAt = (x) => seeds().find((m) => Math.abs(msToX(app.view, w, m.t) - x) <= 4) ?? null;
  function hover(e) {
    const [x, y] = at(e), hk = hitKnot(x, y);
    const inBand = !embedded && !hk && !!pickRun && y >= BAND0 && y <= BAND1;   // combined lane: the band is a strip of its own
    cursor = hk ? 'grab' : inBand ? 'cell' : 'crosshair';
    const m = whyMarks().find((q) => Math.hypot(q.x - x, q.y - y) <= 6), sm = !m && !hk ? (embedded ? seedHit(seeds(), x, y, (t) => msToX(app.view, w, t), { maxY: SEED_Y }) : seedAt(x)) : null;
    whyTip = m ? { x: m.x, y: m.y, text: `${(m.t / 1000).toFixed(2)} s · pos ${m.pos}: ${WHY[m.why] || m.why}${m.by ? ` (${m.by} agree)` : ''}` } : sm ? { x: msToX(app.view, w, sm.t), y: 14, text: sm.tip } : null;
    if (sm) cursor = 'pointer';
    else if (inBand && !whyTip) whyTip = { x, y: BAND1 + 14, text: 'Drag along this band to add a range override of the signal (its own source / pair / camera removal)' };
  }
  function leave() { whyTip = null; }
  $effect(() => {
    const c = canvas;
    if (!c) return;
    const wheel = (e) => {
      e.preventDefault();
      const x = e.clientX - c.getBoundingClientRect().left;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) app.setView(panBy(app.view, -(e.deltaX || e.deltaY), w, app.durationMs));
      else app.setView(zoomAt(app.view, xToMs(app.view, w, x), Math.exp(e.deltaY * 0.0015), app.durationMs));
    };
    c.addEventListener('wheel', wheel, { passive: false });
    return () => c.removeEventListener('wheel', wheel);
  });

  const L = (ms) => ((ms - app.view.start) / app.view.span) * 100 + '%';
  const W = (ms) => (ms / app.view.span) * 100 + '%';
  const sel = $derived(tr.selected);
  /** paw-bg90: which scenes' direction glyph shows: centred in its button, 7 px wide, thinned (lod.js thin, flipped scenes
   *  first); a hidden glyph's button keeps its fill and its press. */
  const signGlyphs = $derived.by(() => {
    if (!sel?.scenes || !w) return [];
    const xc = (sc) => (((sc.start_ms + sc.end_ms) / 2 - app.view.start) / app.view.span) * w;
    return thin(sel.scenes.map((sc, i) => ({ x0: xc(sc) - 3.5, x1: xc(sc) + 3.5, pri: sel.flips.includes(i) ? 1 : 0, skip: ((sc.end_ms - sc.start_ms) / app.view.span) * w < 6 })), 1);
  });
  const flipKey = $derived(app.commands.keysFor('track.flipAtPlayhead')?.[0] || 'F');
  // paw-azd: what the shaft (how much is inside) says about scene i of the run's direction
  const shaftNote = (r, i) => { const d = shaftDirection(r, i); return d ? ` · ${directionText(d, flipKey)}` : ''; };
  // paw-s80k: a shot on a signal of its own (Smart stroke, the source chip) plays the way up its scene's channel did
  const matchNote = (r, i) => { const t = matchText(r.match?.[i], flipKey); return t ? ` · ${t}` : ''; };

  // ---- paw-57ve: polarity stretches on the direction strip (lib/polarity.js; tr.flipsOf / setRunFlips). A drag along a
  //      scene = that stretch flipped (xor: over a flipped part it un-flips), a click still flips the scene. A stretch:
  //      click = select (Delete removes), body drag = move, ends drag = trim, double-click an end = to the shot's edge,
  //      right-click = its options. Live while dragged (the preview), one undo step on release. ----
  const stretches = $derived(sel && ctl.has('flips') ? tr.flipsOf(sel).filter(([u, v]) => v > app.view.start && u < app.view.start + app.view.span) : []);
  let polSel = $state(null), polDrag = null, polRaf = 0, stripEl = $state(null), stripSwallow = false;
  const toEndKey = $derived(app.commands.keysFor('track.flipToEnd')?.[0] || '');
  const stripMs = (e) => app.player.snap(xToMs(app.view, w, e.clientX - stripEl.getBoundingClientRect().left));
  /** The run scene of the selected run under t: its bounds inside the run. */
  const sceneSpan = (t) => { const k = sceneAt(sel.scenes, t), s = sel.scenes[k]; return s ? [Math.max(s.start_ms, sel.range.start), Math.min(s.end_ms, sel.range.end), k] : null; };
  const polSign = (st) => { const k = sceneAt(sel.scenes, (st[0] + st[1]) / 2); return k >= 0 ? -effSign(sel, k) : -1; };
  const polTip = (st) => `Flipped stretch ${fmtTime(st[0])}–${fmtTime(st[1])}: direction ${polSign(st) > 0 ? '+' : '−'} here, against the rest of its scene (mirrored about the scene's range, the joins kept smooth). Click = select (Delete removes it); drag its body to move it, an end to trim; double-click an end = to the shot's edge; right-click = its options. One undo step each`;
  /** A drag's preview step (once per animation frame). */
  function polPut(list) {
    polDrag.list = list;
    if (!polRaf) polRaf = requestAnimationFrame(() => { polRaf = 0; if (polDrag?.list) tr.setRunFlips(polDrag.run, polDrag.list, { commit: false }); });
  }
  function polEnd(e, label) {
    const d = polDrag;
    polDrag = null; cancelAnimationFrame(polRaf); polRaf = 0;
    if (!d) return;
    if (d.list && e?.type === 'pointerup') { stripSwallow = true; setTimeout(() => (stripSwallow = false), 0); tr.setRunFlips(d.run, d.list, { label }); if (d.to) polSel = d.to; }
    else if (d.list) tr.flipPreview = null;   // cancelled: nothing written
  }
  /** A press on a scene of the strip: a drag flips the stretch dragged over (frame-snapped, inside that scene). */
  function stripDown(e) {
    if (e.button !== 0 || !sel || !stripEl) return;
    const t0 = stripMs(e), sp = sceneSpan(t0), el = e.currentTarget, x0 = e.clientX;
    if (!sp) return;
    el.setPointerCapture(e.pointerId);
    polDrag = { run: sel.id, list0: tr.flipsOf(sel), list: null };
    const mv = (ev) => {
      if (!polDrag || (!polDrag.list && Math.abs(ev.clientX - x0) < 4)) return;
      const t1 = stripMs(ev), a = Math.max(sp[0], Math.min(t0, t1)), b = Math.min(sp[1], Math.max(t0, t1));
      if (b > a) polPut(xorFlips(polDrag.list0, a, b));
    };
    const done = (ev) => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', done); el.removeEventListener('pointercancel', done); polEnd(ev, 'Flip a stretch'); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', done); el.addEventListener('pointercancel', done);
  }
  const others = (st) => tr.flipsOf(sel).filter((x) => x[0] !== st[0] || x[1] !== st[1]);
  /** body drag = move (kept inside its scene); a press that does not move stays a click (select) */
  function polBodyDown(e, st) {
    if (e.button !== 0 || !sel) return;
    e.stopPropagation();
    const el = e.currentTarget, x0 = e.clientX, len = st[1] - st[0], sp = sceneSpan((st[0] + st[1]) / 2), perPx = app.view.span / w;
    if (!sp) return;
    el.setPointerCapture(e.pointerId);
    const rest = others(st);
    polDrag = { run: sel.id, list: null, to: null };
    const mv = (ev) => {
      if (!polDrag || (!polDrag.list && Math.abs(ev.clientX - x0) < 4)) return;
      const a = Math.max(sp[0], Math.min(sp[1] - len, app.player.snap(st[0] + (ev.clientX - x0) * perPx)));
      polDrag.to = { t0: a, t1: a + len };
      polPut([...rest, [a, a + len]]);
    };
    const done = (ev) => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', done); el.removeEventListener('pointercancel', done); polEnd(ev, 'Move a flipped stretch'); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', done); el.addEventListener('pointercancel', done);
  }
  /** an end dragged = trimmed (at least a frame long, inside its scene) */
  function polEdgeDown(e, st, side) {
    if (e.button !== 0 || !sel) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.currentTarget, sp = sceneSpan((st[0] + st[1]) / 2), fm = app.player.frameMs || 1000 / 30, x0 = e.clientX;
    if (!sp) return;
    el.setPointerCapture(e.pointerId);
    const rest = others(st);
    polDrag = { run: sel.id, list: null, to: null };
    const mv = (ev) => {
      if (!polDrag || (!polDrag.list && Math.abs(ev.clientX - x0) < 2)) return;
      const t = stripMs(ev), to = side ? [st[0], Math.min(sp[1], Math.max(st[0] + fm, t))] : [Math.max(sp[0], Math.min(st[1] - fm, t)), st[1]];
      polDrag.to = { t0: to[0], t1: to[1] };
      polPut([...rest, to]);
    };
    const done = (ev) => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', done); el.removeEventListener('pointercancel', done); polEnd(ev, 'Trim a flipped stretch'); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', done); el.addEventListener('pointercancel', done);
  }
  /** to the shot's edge on that side (the usual "from here to the end of the shot is upside down") */
  function polExtend(st, side) {
    const sp = sel && sceneSpan((st[0] + st[1]) / 2);
    if (!sp) return;
    const to = side ? [st[0], sp[1]] : [sp[0], st[1]];
    tr.setRunFlips(sel.id, [...others(st), to], { label: side ? 'Flipped stretch to the end of the shot' : 'Flipped stretch from the start of the shot' });
    polSel = { t0: to[0], t1: to[1] };
  }
  function polRemove(st) { if (polSel?.t0 === st[0] && polSel?.t1 === st[1]) polSel = null; tr.setRunFlips(sel.id, others(st), { label: 'Remove a flipped stretch' }); }
  function polKey(e, st) {
    if (['Delete', 'Backspace'].includes(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); polRemove(st); }
    else if (e.key === 'Escape' && polSel) { e.stopPropagation(); polSel = null; }
  }
  const polItems = (st) => [{ label: 'Extend to the start of the shot', run: () => polExtend(st, 0) }, { label: 'Extend to the end of the shot', run: () => polExtend(st, 1) }, { label: 'Remove', shortcut: 'Delete', run: () => polRemove(st) }];

  // ---- paw-wg2d: anchors (lib/anchors.js; Alt+0 / Alt+Shift+0 / Alt+M at the playhead): a mark per anchor at its frame, as high
  //      as its pos (fully out at the top, fully in at the bottom). Drag = move it frame by frame inside its shot (the fused
  //      trace follows live, one undo step on release); click = go to its frame (then Delete removes it, as a flipped stretch);
  //      right-click = its options ----
  const anchorMarks = $derived(tr.anchors.filter((a) => a.ms >= app.view.start && a.ms <= app.view.start + app.view.span));
  let anchorDrag = null, anchorRaf = 0;
  const anchorKey = (pos) => app.commands.keysFor(ANCHOR_CMD[pos])?.[0] || '';
  const anchorTip = (a) => `Anchor: ${ANCHOR_WORD[a.pos]} at ${fmtTime(a.ms)} (shot ${shotLabel(tr.scenes, a.shot)}). A fused shot is solved to its anchors: the script reads ${a.pos} here${a.pos === 50 ? '' : ' and its turn lands on this frame'}. Drag = move it frame by frame; click = go there (then Delete removes it); right-click = its options${anchorKey(a.pos) ? `; ${anchorKey(a.pos)} on its frame takes it off` : ''}`;
  const anchorTop = (pos) => (embedded ? `${posToY(ph, pos)}px` : `${6 + (1 - pos / 100) * Math.max(0, h - 12)}px`);   // combined lane: on the points' scale
  function anchorDown(e, a) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const el = e.currentTarget, x0 = e.clientX, left = canvas.getBoundingClientRect().left;
    el.setPointerCapture(e.pointerId);
    anchorDrag = { a, to: null };
    const mv = (ev) => {
      if (!anchorDrag || (anchorDrag.to == null && Math.abs(ev.clientX - x0) < 3)) return;
      anchorDrag.to = xToMs(app.view, w, ev.clientX - left);
      if (!anchorRaf) anchorRaf = requestAnimationFrame(() => { anchorRaf = 0; if (anchorDrag?.to != null) tr.moveAnchor(anchorDrag.a, anchorDrag.to, { commit: false }); });
    };
    const done = (ev) => {
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', done); el.removeEventListener('pointercancel', done);
      const d = anchorDrag;
      anchorDrag = null; cancelAnimationFrame(anchorRaf); anchorRaf = 0;
      if (!d) return;
      if (d.to != null && ev.type === 'pointerup') tr.moveAnchor(d.a, d.to);
      else if (d.to != null) tr.cancelDerive();
      else if (ev.type === 'pointerup') { el.focus(); app.player.seek(d.a.ms); }
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', done); el.addEventListener('pointercancel', done);
  }
  function anchorKeyDown(e, a) {
    if (['Delete', 'Backspace'].includes(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); tr.moveAnchor(a, null); }
    else if (e.key === 'Escape') { e.stopPropagation(); e.currentTarget.blur(); }
  }
  // paw-5z78: a focused anchor (clicked) is the editor selection: left / right move it a frame inside its shot (one undo step each)
  const anchorItem = (k) => () => ({ nudge: (dx) => { const a = anchorMarks[k], g = gridOf(app.player); if (a && dx && g) tr.moveAnchor(a, frameTime(frameAt(a.ms, g) + dx, g)); } });
  const anchorItems = (a) => [{ label: `Remove this anchor (${ANCHOR_WORD[a.pos]})`, shortcut: 'Delete', run: () => tr.moveAnchor(a, null) }, { label: `Remove every anchor of shot ${shotLabel(tr.scenes, a.shot)}`, run: () => tr.clearAnchors(a.shot) }];

  // ---- paw-k8pe (the owner: "this tapnext bar at the bottom with the microscopic polarity isn't great"): on the Track tab the run's
  //      controls are the lane toolbar's tool settings, after Track's cog (RunBar.svelte draws them; what does not fit folds into
  //      its one … popover, in this order): the run chip (bandRun: the picked run, else the one whose range plays at the shot;
  //      click = select it / the next run here, right-click = its range's menu), its direction (the F command, at a button's size),
  //      then the pickers exactly as the band had them. The band keeps ▾ (Adjust, the fusion panel), the shaft note and Detail ----
  const trackerWord = (r) => { const t = tr.trackers.find((x) => x.id === r.tracker); return (t?.name || r.name || r.tracker || '').split(/\s+/)[0]; };   // listed, else the name it was tracked with
  const barShot = $derived(pickRun ? pickScene : tr.currentScene);
  const chipText = $derived.by(() => {
    const r = bandRun;
    if (!r) return '';
    if (pickRun && ctl.has('modifier')) return `#${r.n} · ${pickMod ? `${modLabel(pickMod.kind)} ${fmtTime(pickMod.t0)}–${fmtTime(pickMod.t1)}` : 'its modifier is gone'}`;
    return [`#${r.n}`, target ? `${fmtTime(target.t0)}–${fmtTime(target.t1)}` : barShot >= 0 ? 'shot ' + shotLabel(tr.scenes, barShot) : 'run'].join(' · ');   // the tracker: in the tooltip
  });
  const chipTip = $derived(!bandRun ? '' : `${tr.ghost(bandRun.id)?.name || 'Run #' + bandRun.n}${trackerWord(bandRun) ? ` (${trackerWord(bandRun)})` : ''}${target ? `: editing the range override ${fmtTime(target.t0)}–${fmtTime(target.t1)}` : pickRun ? ": editing the shot's own setting" : ': plays here'}\nClick: ${tr.selectedId === bandRun.id ? 'the next run here' : 'select it'}; right-click: its menu (invert, bake, use another run)`);
  /** Click: the run shown is selected; selected already, the next run tracked at the playhead (else the next run). */
  function runChipClick() {
    const cur = bandRun;
    if (!cur) return;
    if (tr.selectedId !== cur.id) { tr.select(cur.id); return; }
    const t = app.player.timeMs, here = tr.runs.filter((r) => { const x = tr.runExtent(r.id); return x && t >= x.t0 && t <= x.t1; }), list = here.length > 1 ? here : tr.runs;
    if (list.length > 1) tr.select(list[(list.findIndex((r) => r.id === cur.id) + 1) % list.length].id);
  }
  /** Right-click: the menu of its range at the playhead (the run strip's), else the lane's run items there. */
  function runChipItems() {
    const t = app.player.timeMs, rs = (tr.runRanges || []).filter((x) => x.run === bandRun?.id), at = rs.find((x) => t >= x.t0 && t < x.t1) || rs[0];
    return at ? rangeItems(tr, at) : runItems(t);
  }
  // the direction where F acts (tracking flipAtPlayhead: the scene of the run whose range plays at the playhead), in words: normal
  // = as tracked; flipped = that scene flipped, or the playhead inside a flipped stretch (xor: what plays there)
  const playAt = $derived.by(() => { tr.runs; const t = playheadFrameStart(app.player), at = rangeAt(tr.runRanges, t), r = at && tr.run(at.run), i = r ? sceneAt(r.scenes, t) : -1; return i >= 0 ? { r, i, t } : null; });
  const inStretch = $derived(!!playAt && tr.flipsOf(playAt.r).some(([a, b]) => playAt.t >= a && playAt.t < b));
  const polFlipped = $derived(!!playAt && playAt.r.flips.includes(playAt.i) !== inStretch);
  const dirTip = $derived(!playAt ? 'Direction: no run plays at the playhead, nothing to flip' : `Direction at the playhead: ${polFlipped ? 'flipped' : 'normal (as tracked)'}, run #${playAt.r.n}, its scene ${playAt.i + 1}${inStretch ? ' (inside a flipped stretch)' : ''}\nClick flips that scene; the run strip under the lane: a drag flips a stretch, its right-click inverts a range`);
  const runGroups = $derived(!pickRun ? [{ key: 'hint', word: 'select a run', snip: gHint }]
    : ctl.has('modifier') ? [{ key: 'measure', word: 'what it measures', snip: gMeasure }, ...(ctl.has('correct') ? [{ key: 'correct', word: 'Correct its SAM mask', snip: gCorrect }] : []), { key: 'again', word: 'Track again', snip: gAgain }, { key: 'delete', word: 'Delete', snip: gDelete }]
    : [...(tgtSpan ? [{ key: 'clear', word: 'clear the range override', snip: gClear }] : []), { key: 'src', word: 'source', snip: gSrc }, { key: 'pair', word: 'Pair', snip: gPair }, { key: 'vs', word: 'measured against', snip: gVs },
      ...(padOn ? [{ key: 'pad', word: 'fusion pad', snip: gPad }, { key: 'pin', word: 'pin the pad', snip: gPin }] : []), ...(depthOn ? [{ key: 'depth', word: 'depth', snip: gDepth }] : []), { key: 'base', word: 'baseline', snip: gBase }, { key: 'anchor', word: 'anchor', snip: gAnchor }]);
  if (embedded) {
    const bar = { get on() { return !!bandRun; }, get groups() { return runGroups; }, get chip() { return runChip; }, get pol() { return polarity; } };
    $effect(() => { tr.runBar = bar; return () => { if (tr.runBar === bar) tr.runBar = null; }; });
  }
</script>

<svelte:window onkeydowncapture={(e) => { if (e.key !== 'Escape') return; if (tr.pairPick) { tr.pairPick = null; e.preventDefault(); e.stopPropagation(); } else if (segDrag) { cancelSeg(); e.preventDefault(); e.stopPropagation(); } else if (rubber) { railCancel?.(); rubber = null; press = null; e.preventDefault(); e.stopPropagation(); } else if (polDrag) { if (polDrag.list) tr.flipPreview = null; polDrag = null; e.preventDefault(); e.stopPropagation(); } else if (anchorDrag) { if (anchorDrag.to != null) tr.cancelDerive(); anchorDrag = null; e.preventDefault(); e.stopPropagation(); } }} />
{#snippet under()}
  <!-- the combined lane: the traces between the lane's background and its points; never hit by the pointer (the lane's claim) -->
  <canvas bind:this={canvas} class="under" tabindex="-1" aria-label="Tracker signals" data-pad-t="10" data-pad-b={10 + edge} onfocus={() => (tr.laneFocused = true)} onblur={() => (tr.laneFocused = false)}></canvas>
  {#if shaftOn && shaftData}<ShaftData {app} run={pickRun} layered bottom={edge} bind:notes={shaftNotes} bind:cells={shaftCells} />{/if}
{/snippet}
{#snippet overrides()}
  {#each segs as sg, k (k)}<!-- by index: a segment keeps its element (and its pointer capture) while an end is dragged -->
    {@const on = tr.sigSel?.t0 === sg.t0 && tr.sigSel?.t1 === sg.t1}
    {@const px = ((sg.t1 - sg.t0) / app.view.span) * w}
    <div class="ovr" class:on class:narrow={px < OVX_MIN} style:left={L(sg.t0)} style:width={W(sg.t1 - sg.t0)}>
      <button class="ovb num" aria-pressed={on} aria-label="Range override {segLabel(sg)}" {@attach tooltip(segTip(sg))} {@attach contextMenu(() => segItems(sg))}
        onpointerdown={(e) => segBodyDown(e, sg)} onclick={() => { if (!swallow) tr.sigSel = on ? null : { t0: sg.t0, t1: sg.t1 }; }} onkeydown={(e) => segKey(e, sg)} {@attach editorItem(segItem(k))}>{segLabel(sg)}</button>
      {#if px >= OVX_MIN}<button class="ovx" aria-label="Remove this range override" {@attach tooltip('Remove this range override (X / Delete when it is selected)')} onclick={() => removeSeg(sg)}>×</button>{/if}
      <span class="ovh l" role="presentation" onpointerdown={(e) => segDown(e, sg, 0)}></span>
      <span class="ovh r" role="presentation" onpointerdown={(e) => segDown(e, sg, 1)}></span>
    </div>
  {/each}
{/snippet}
<div class="tl" class:emb={embedded} class:picker={tr.runs.length > 0} class:shaft={shaftOn} class:sdata={shaftOn && shaftData} data-tracklane={embedded ? 'combined' : undefined} {@attach ctlLog(app, 'row')}>
  <div class="cv" bind:clientWidth={w} bind:clientHeight={h}>
    {#if embedded}
      {@render lane(under, claim, edge)}
      {#if edge}
        <!-- the edge band: inside the lane, under its pos 0; the run strip (which run plays where, its ± and flipped stretches: paw-1ysd), the overrides -->
        <div class="edge" style:height="{edge}px" data-testid="lane-edge">
          <RunRangeStrip {app} {tr} height={RR_H} />
          {#if segStrip}
            <div class="strip ovstrip" style:height="{OV_H}px" style:--ov-h="{OV_H}px" bind:this={railEl} role="group" aria-label="Range overrides: drag along to add one" data-testid="override-strip"
              {@attach tooltip('Range overrides: drag along this edge to add one')}
              onpointerdown={railDown}>
              {@render overrides()}
              {#if rubber}<i class="rub" style:left={L(Math.min(rubber.t0, rubber.t1))} style:width={W(Math.abs(rubber.t1 - rubber.t0))}></i>{/if}
            </div>
          {/if}
          {#if !segStrip}<div style:height="{OV_H}px"></div>{/if}
          <i class="eph" style:left={L(app.player.timeMs)}></i>
        </div>
      {/if}
    {:else}
      <!-- tabindex -1: focused only by a knot click, so Delete (tracking.knotDelete) removes that knot and nothing else -->
      <canvas bind:this={canvas} tabindex="-1" style:cursor={cursor} aria-label="Tracker signals" data-pad-t="14" data-pad-b="12"
        onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={cancel} onlostpointercapture={() => knotDrag && cancel()} onpointerleave={leave}
        ondblclick={dbl} oncontextmenu={menu} onfocus={() => (tr.laneFocused = true)} onblur={() => (tr.laneFocused = false)}></canvas>
      <OutOfRange {app} />
      <DetailChip {app} {w} />
    {/if}
    <ReferenceStrip {app} {w} />
    <!-- paw-1ysd stage 5: the shaft strip is layered over the lane's foot (just above the band), no row of its own -->
    {#if shaftOn && embedded}<ShaftStrip {app} run={pickRun} layered bottom={edge} />{/if}
    {#if whyTip}<div class="whytip num" role="tooltip" style:left="{Math.min(w - 260, Math.max(0, whyTip.x - 120))}px" style:top="{Math.max(0, whyTip.y - 34)}px">{whyTip.text}</div>{/if}
    {#if !embedded}{@render overrides()}{/if}
    {#each anchorMarks as a, k (k)}<!-- by index: a mark keeps its element (and its pointer capture) while it is dragged -->
      <button class="anc" data-pos={a.pos} data-testid="anchor-mark" style:left={L(a.ms)} style:top={anchorTop(a.pos)} aria-label="Anchor {ANCHOR_WORD[a.pos]} at {fmtTime(a.ms)}"
        {@attach tooltip(anchorTip(a))} {@attach contextMenu(() => anchorItems(a))} onpointerdown={(e) => anchorDown(e, a)} onkeydown={(e) => anchorKeyDown(e, a)} {@attach editorItem(anchorItem(k))}></button>
    {/each}
    {#if empty && !embedded}
      <p class="empty">{app.mode === 'track' ? `Tracker signals show here: press ${app.commands.keysFor('track.gridFrame')?.[0] || 'Track'} (Track: a point grid over the whole frame)` : 'Tracker runs show here (Track tab)'}</p>
    {/if}
  </div>
  {#if shaftOn && !embedded}<ShaftStrip {app} run={pickRun} />{/if}
  {#if shaftOn && shaftData && !embedded}<ShaftData {app} run={pickRun} />{/if}
  {#if tr.runs.length && !embedded}{@render pickRow()}{/if}
  {#if !embedded}{@render dirStrip()}{/if}
  {#if tr.fusePadPin && padOn}
    <div class="padfloat" data-testid="fuse-pad-float" style:left="{tr.fusePadPin.x}px" style:top="{tr.fusePadPin.y}px">
      <div class="pfh" role="presentation" onpointerdown={padMoveStart}><span class="grow">Fusion pad · {target ? `range ${fmtTime(target.t0)}–${fmtTime(target.t1)}` : 'shot ' + shotLabel(tr.scenes, tgtShot)}</span>
        <button class="pfx" aria-label="Unpin the standing pad" {@attach tooltip('Unpin (close) the standing pad')} onclick={() => { app.usage?.note('tracking:padPin', { on: false }); tr.fusePadPin = null; }} onpointerdown={(e) => e.stopPropagation()}>×</button></div>
      <FusionPad {app} shot={tgtShot} span={target} run={pickRun.id} auto={padAuto} size={120} />
    </div>
  {/if}
  {#if padDrag?.moved}
    {@const pv = padDrag.cur}
    <div class="padview" aria-hidden="true" style:left="{Math.max(4, padDrag.left - 60)}px" style:top="{Math.max(4, padDrag.top - 112)}px">
      <span class="t">extremities</span><span class="l">relative</span>
      <span class="box">{#if padAuto}<i class="auto" style:left={padAt(padAuto.x)} style:top={padTop(padAuto.y)}></i>{/if}<i class="dot" style:left={padAt(pv.x)} style:top={padTop(pv.y)}></i></span>
      <span class="r">absolute</span><span class="b">core</span>
    </div>
  {/if}
  {#if !embedded}
    <div class="strip spans" aria-label="Span labels">
      {#each tr.spans as sp}
        <button class="seg span" data-ctl="span label" data-state={sp.state} style:left={L(sp.start_ms)} style:width={W(sp.end_ms - sp.start_ms)} {@attach tooltip(`${sp.state}: click to set the range to it`)}
          onclick={() => tr.setRange(sp.start_ms, sp.end_ms)}>{sp.state}</button>
      {/each}
    </div>
  {:else if tr.runs.length}
    <!-- paw-unuy: the inspector band of the shot: one row (paw-k8pe: its signal, pair, camera, pad, depth and baseline are the lane
         toolbar's now; here ▾, the shaft note, Detail); ▾ = everything else of the shot in place (fusion, depth range and its
         compressor, Smart stroke, camera removal, strokes, the shaft data) -->
    <div class="band" class:open={tr.bandOpen && !!bandRun} data-testid="inspector-band">
      <div class="bandrow">
        <button class="more" aria-expanded={tr.bandOpen} aria-label="{tr.bandOpen ? 'Fold' : 'Unfold'} the shot's controls" data-testid="inspector-more" disabled={!bandRun}
          {@attach tooltip(tr.bandOpen ? "Fold the shot's controls back to one row" : "Unfold all of the shot's controls")}
          onclick={() => (tr.bandOpen = !tr.bandOpen)}><Icon name={tr.bandOpen ? 'chevron-down' : 'chevron-right'} size={12} /></button>
        {#if shaftOn && shaftData && shaftNow}<span class="bnote num" class:warn={shaftNow.unsure} data-testid="shaft-note" {@attach tooltip(`Shaft data on the lane's scale: out 100, hilted 0`)}>{shaftNow.text}</span>{/if}
        {#if pickRun && !pickRun.mod}<DetailChip {app} inline />{/if}
      </div>
      {#if tr.bandOpen && bandRun}
        <div class="bandmore k-scroll" data-testid="inspector-more-body">
          {#if shaftOn}<button class="chip" class:on={shaftData} aria-pressed={shaftData} data-testid="shaft-data-toggle" {@attach tooltip("The shaft's readings over the shot, under the lane")} onclick={() => app.settings.set('tracking.shaftData', !shaftData)}>shaft data</button>{/if}
          <DeriveStrip {app} />
        </div>
      {/if}
    </div>
  {/if}
</div>

{#snippet pickRow()}
    <div class="pick" role="group" aria-label="Signal of the scene">
      {#if pickRun && ctl.has('modifier')}
        <span class="lbl" {@attach tooltip("A modifier's own run, from its own seed frame")}>#{pickRun.n} · {pickMod ? `${modLabel(pickMod.kind)} ${fmtTime(pickMod.t0)}–${fmtTime(pickMod.t1)}` : 'its modifier is gone'}</span>
      {:else if pickRun}
        <span class="lbl" class:range={!!target} {@attach tooltip(target ? `Editing the range override ${fmtTime(target.t0)}–${fmtTime(target.t1)}` : "Editing the shot's own setting")}>#{pickRun.n} · {target ? `range ${fmtTime(target.t0)}–${fmtTime(target.t1)}` : pickScene >= 0 ? 'shot ' + shotLabel(tr.scenes, pickScene) : 'run'}</span>
      {/if}
      {#each runGroups as g (g.key)}{@render g.snip()}{/each}
    </div>
{/snippet}

<!-- paw-k8pe: the row's controls one group each (runGroups, in this order): the Tracker row above draws them in a row, the Track tab's
     lane toolbar (RunBar.svelte) after its run chip and direction, folding the tail into its … popover. A group is one unit there. -->
{#snippet gHint()}<span class="grp"><span class="lbl">Select a run to pick its signal per scene</span></span>{/snippet}
{#snippet gMeasure()}<span class="grp"><span class="lbl" {@attach tooltip('What this run measures: inside, area or scale')}>{measureText(pickRun)}</span></span>{/snippet}
{#snippet gCorrect()}<span class="grp"><button class="chip" disabled={!pickMod} {@attach tooltip("Repaint the run's mask on this frame, T re-tracks")} onclick={() => correctHere(app, pickRun.id)}>Correct its SAM mask here</button></span>{/snippet}
{#snippet gAgain()}<span class="grp"><button class="chip" disabled={!pickMod} {@attach tooltip('Track it again from its seeds, replacing this run')} onclick={() => trackMod(app, pickRun.mod, pickRun.tracker, { replace: pickRun.id })}>Track again</button></span>{/snippet}
{#snippet gDelete()}<span class="grp"><button class="chip" {@attach tooltip('Delete this run')} onclick={() => tr.remove(pickRun.id)}>Delete</button></span>{/snippet}
{#snippet gClear()}<span class="grp"><button class="chip" aria-label="Clear this range override" {@attach tooltip('Clear this range override (X)')} onclick={() => removeSeg(tgtSpan)}>× clear</button></span>{/snippet}
{#snippet gSrc()}
  {@const col = chipColor(picked)}
  <span class="grp">
    <button class="chip on src" class:sem={!!groupOfChannel(picked)?.sem} style:--chip={col} aria-haspopup="menu" aria-label="Signal source: {chipLabel(picked)}"
      {@attach tooltip(`Signal${target ? ' of the range' : ''}: ${chipLabel(picked)}${chipTitle(picked) ? ` (${chipTitle(picked)})` : ''}, click to change`)}
      {@attach contextMenu(() => sourceItems(putSource))} onclick={(e) => showContextMenu(e.currentTarget, sourceItems(putSource))}>{#if chipTags(picked)}{#each chipTags(picked) as x, k (k)}{#if k}<span>↔</span>{/if}<i style:--chip={x.col}></i><span class="tx">{x.t}</span>{/each}{:else}{#if col}<i></i>{/if}<span class="tx">{chipLabel(picked)}</span>{/if} ▾</button>
    {#if shaftHint}<span class="shint" data-testid="shaft-hint" role="note" aria-label="The shaft reads this shot differently: worth a look" {@attach tooltip(`The shaft (${READ_WORD[shaftHint.reading]}) differs from ${chipLabel(picked)}: r ${shaftHint.r.toFixed(2)}, ${shaftHint.size}× the size\nPick Shaft as the source to follow it`)}>◆</span>{/if}
  </span>
{/snippet}
{#snippet gPair()}
  <span class="grp">
    <button bind:this={pairBtn} class="chip" class:on={!!pairNow || pairOpen || !!tr.pairPick} disabled={parts.length < 2} aria-haspopup="dialog" aria-expanded={pairOpen}
      {@attach tooltip(parts.length < 2 ? 'Pair needs two tracked parts (paint groups and track them)' : tr.pairPick ? 'Pair: click two trackers on the video (Esc cancels)' : pairNow ? `Pair: ${partName(pairNow.a)} ↔ ${partName(pairNow.b)}
${PAIR_TIP}` : PAIR_TIP)}
      onclick={() => { pairOpen = !pairOpen; pairA = ''; }}>⇄ Pair</button>
    <Popover bind:open={pairOpen} anchor={pairBtn} placement="top-start" label="Pair" onclose={() => { pairA = ''; peek = ''; }}>
      <div class="pairpop">
        <p>{pairA ? `${partName(pairA)} moves against… (click the second part)` : 'Click the part that moves, then the part it moves against'}</p>
        <div class="parts">
          {#each parts as p (p.key)}
            <button class="chip" class:armA={pairA === p.key} class:on={!pairA && !!pairNow && (pairNow.a === p.key || pairNow.b === p.key)} style:--chip={p.color}
              onclick={() => pairClick(p.key)} onpointerenter={() => (peek = pairA && pairA !== p.key ? relId(pairA, p.key) : '')} onpointerleave={() => (peek = '')}><i></i>{p.label}</button>
          {/each}
        </div>
        <button class="chip" onclick={pairOnVideo} {@attach tooltip('Pick the two parts by clicking their trackers on the video')}>on video…</button>
      </div>
    </Popover>
  </span>
{/snippet}
{#snippet gVs()}
  <span class="grp">
    <button class="chip" class:on={against !== 'camera' || camSt.from === 'override' || camSt.from === 'adjust' || camSt.from === 'tag'} aria-haspopup="menu" aria-label="Measured against: {agLabel(against)}"
      {@attach tooltip(AGAINST_TIP)} {@attach contextMenu(() => againstItems())} onclick={(e) => showContextMenu(e.currentTarget, againstItems())}>vs {agLabel(against)}{against === 'camera' && cam.mode !== 'auto' ? ' ' + (cam.mode === 'full' ? 'rot' : cam.mode) + camNote : ''}{against === 'camera' && cam.strength !== 100 ? ' ' + cam.strength + '%' : ''} ▾</button>
  </span>
{/snippet}
{#snippet gPad()}
  {@const pv = padDrag?.cur || pad}
  <span class="grp">
    <button class="chip pad" class:on={!!(pv.x || pv.y)} data-testid="fuse-pad" aria-label="Fusion pad: {padText(pv)}{target ? ' (range override)' : ''}. Arrows nudge, 0 = centre"
      {@attach tooltip(PAD_TIP + (target ? ' · Editing the range override' : ''))} onpointerdown={padDown} onpointermove={padMove} onpointerup={padEnd} onpointercancel={padEnd}
      ondblclick={() => padSet(null, 'Fusion: pad back to centre')} onkeydown={padKey} {@attach editorItem(padItem)}><span class="padbox">{#if padAuto}<i class="auto" style:left={padAt(padAuto.x)} style:top={padTop(padAuto.y)}></i>{/if}<i class="dot" style:left={padAt(pv.x)} style:top={padTop(pv.y)}></i></span><span class="tx">{padText(pv)}</span></button>
  </span>
{/snippet}
{#snippet gPin()}
  <span class="grp">
    <button class="chip" class:on={!!tr.fusePadPin} data-testid="fuse-pad-pin" aria-pressed={!!tr.fusePadPin} aria-label="{tr.fusePadPin ? 'Unpin' : 'Pin'} the standing fusion pad"
      {@attach tooltip(tr.fusePadPin ? 'Unpin the pad' : 'Pin the pad open')} onclick={pinPad}><Icon name="pin" size={9} /></button>
  </span>
{/snippet}
{#snippet gDepth()}
  <span class="grp">
    <span class="sep"></span>
    <span class="lbl" {@attach tooltip('Depth level and size of the strokes (drag the dashed line)')}>depth{tgtSpan ? ' (shot)' : ''}</span>
    {#each DEPTHS as m (m)}
      <button class="chip" class:on={depthNow === m} aria-pressed={depthNow === m} data-testid="fuse-depth-{m}" disabled={!!depthBlock(m)} {@attach tooltip(depthTip(m))} onclick={() => setDepth(m)}>{partOf(m) ? partWord(partOf(m)) : m}</button>
    {/each}
  </span>
{/snippet}
{#snippet gBase()}
  <span class="grp">
    <span class="sep"></span>
    <span class="lbl" {@attach tooltip(carrierBlock || (depthSeated ? 'The level the strokes ride on, for the whole shot' : 'The slow motion under the strokes, for the whole shot'))}>baseline{tgtSpan ? ' (shot)' : ''}</span>
    {#each ['off', 'auto', 'knots'] as m (m)}
      {@const lock = m === 'auto' && depthSeated}
      <button class="chip" class:on={!carrierBlock && bMode === m && !lock} disabled={!!carrierBlock || lock} {@attach tooltip(carrierBlock || (lock ? 'The depth chip sets the level now' : `Baseline ${m}`))} onclick={() => setMode(m)}>{m}</button>
    {/each}
  </span>
{/snippet}
<!-- paw-2ntn: where a stroke shorter than the range sits (the old env toggle is its "full"); the label cycles (tracking.cycleStrokeAnchor) -->
{#snippet gAnchor()}
  {@const anchorNow = tr.anchorOf(pickScene, pickRun.id)}
  <span class="grp">
    <span class="sep"></span>
    <Button size="sm" variant="ghost" data-testid="anchor-cycle" {...cmd(app, 'tracking.cycleStrokeAnchor')}>anchor{tgtSpan ? ' (shot)' : ''}</Button>
    {#each ANCHORS as m (m)}
      {@const ab = carrierBlock || tr.anchorBlock(pickScene, pickRun.id, m)}
      <button class="chip" class:on={!carrierBlock && anchorNow === m} aria-pressed={anchorNow === m} disabled={!!ab} data-testid="anchor-{m}"
        {@attach tooltip(ab || ANCHOR_TIP[m])} onclick={() => tr.setAnchor(pickScene, m, pickRun.id)}>{m}</button>
    {/each}
  </span>
{/snippet}
<!-- paw-k8pe: the toolbar's two that never fold: the run chip and its direction (the F command) -->
{#snippet runChip()}
  {#if bandRun}
    <Button size="sm" class="runchip{target ? ' range' : ''}" data-testid="run-chip" aria-label="Run {chipText}" tip={chipTip} onclick={runChipClick}
      {@attach contextMenu(runChipItems)}><i class="rcdot" style:--chip={tr.ghost(bandRun.id)?.color || bandRun.color}></i>{chipText}</Button>
  {/if}
{/snippet}
{#snippet polarity(tight = false)}
  {@const c = cmd(app, 'track.flipAtPlayhead', undefined, { tip: dirTip })}
  {#if tight}<!-- the narrowest toolbar (RunBar tight): the icon and its pressed state, the words in its name and tooltip -->
    <Button size="sm" icon="flip" class="runpol" data-testid="run-polarity" aria-label="Direction: {polFlipped ? 'flipped' : 'normal'}" {...c} disabled={c.disabled || !playAt} pressed={polFlipped} />
  {:else}
    <Button size="sm" icon="flip" class="runpol" data-testid="run-polarity" {...c} disabled={c.disabled || !playAt} pressed={polFlipped}>{polFlipped ? 'flipped' : 'normal'}</Button>
  {/if}
{/snippet}

{#snippet dirStrip()}
  <div class="strip" role="group" aria-label={sel ? 'Direction per scene' : 'Scenes'} bind:this={stripEl}>
    {#if sel && ctl.has('flips')}
      {#each sel.scenes as sc, i}
        {@const sg = effSign(sel, i)}
        {@const glyph = signGlyphs[i]}
        <button class="seg sign" data-ctl="flip strip" class:flipped={sel.flips.includes(i)} style:left={L(sc.start_ms)} style:width={W(sc.end_ms - sc.start_ms)}
          {@attach tooltip(`Run scene ${i + 1}: direction ${sg > 0 ? '+' : '−'}${sc.auto_sign != null ? ' (auto ' + (sc.auto_sign > 0 ? '+' : '−') + ')' : ''}${shaftNote(sel, i)}${matchNote(sel, i)}\nClick or ${flipKey} flips it, drag flips a stretch`)}
          onpointerdown={stripDown} onclick={() => { if (!stripSwallow) tr.flipScene(i); }}>{glyph ? (sg > 0 ? '+' : '−') : ''}</button>
      {/each}
      {#each stretches as st, j (j)}<!-- by index: a stretch keeps its element (and its pointer capture) while it is dragged -->
        {@const on = polSel?.t0 === st[0] && polSel?.t1 === st[1]}
        <div class="pol" class:on style:left={L(st[0])} style:width={W(st[1] - st[0])} data-testid="flip-stretch">
          <button class="polb" aria-pressed={on} aria-label="Flipped stretch {fmtTime(st[0])}–{fmtTime(st[1])}" {@attach tooltip(polTip(st))} {@attach contextMenu(() => polItems(st))}
            onpointerdown={(e) => polBodyDown(e, st)} onclick={() => { if (!stripSwallow) polSel = on ? null : { t0: st[0], t1: st[1] }; }} onkeydown={(e) => polKey(e, st)}>{polSign(st) > 0 ? '+' : '−'}</button>
          <span class="polh l" role="presentation" onpointerdown={(e) => polEdgeDown(e, st, 0)} ondblclick={() => polExtend(st, 0)}></span>
          <span class="polh r" role="presentation" onpointerdown={(e) => polEdgeDown(e, st, 1)} ondblclick={() => polExtend(st, 1)}></span>
        </div>
      {/each}
    {:else}
      {#each tr.scenes as s, i}
        <button class="seg scene" data-ctl="shot strip" class:alt={i % 2} style:left={L(s.start_ms)} style:width={W(s.end_ms - s.start_ms)} {@attach tooltip(`Shot ${shotLabel(tr.scenes, i)} (scene ${sceneNo(tr.scenes, i) + 1}): set the range`)} onclick={() => tr.rangeToScene(s)}><span class="lb">{shotLabel(tr.scenes, i)}</span></button>
      {/each}
    {/if}
  </div>
{/snippet}

<style>
  .tl { position: absolute; inset: 0; display: grid; grid-template-rows: minmax(0, 1fr) 14px 11px; gap: 1px; background: var(--bg-sunken); }
  .tl.picker { grid-template-rows: minmax(0, 1fr) 16px 14px 11px; }
  .tl.picker.shaft { grid-template-rows: minmax(0, 1fr) 26px 16px 14px 11px; }   /* paw-4c48: the shaft strip under the trace */
  .tl.picker.shaft.sdata { grid-template-rows: minmax(0, 1fr) 26px 52px 16px 14px 11px; }   /* paw-4c48.15: + the shaft's data (taken from the trace: the lane keeps its height) */
  .cv { position: relative; min-height: 0; overflow: hidden; }
  /* paw-unuy: the combined lane (Track tab): the axis lane fills, the strips under it take height only while they have something */
  .tl.emb { display: flex; flex-direction: column; gap: 0; background: var(--bg); }
  .tl.emb > .cv { flex: 1 1 0; }
  .tl.emb > :global(*:not(.cv)) { flex: none; }
  .tl.emb > :global(.shs) { height: 26px; }
  canvas.under { pointer-events: none; cursor: default; }
  /* the edge band: inside the lane (its background), under the plot; a hairline of the grid's colour above it */
  .edge { position: absolute; left: 0; right: 0; bottom: 0; z-index: 1; display: flex; flex-direction: column; background: var(--bg-sunken); box-shadow: inset 0 1px 0 var(--line-1); }
  .edge .strip { flex: none; background: none; }
  .ovstrip { cursor: cell; }
  .edge .ovr { top: 1px; bottom: 0; height: auto; border-width: 0 1px; border-radius: 0; }
  /* paw-k8pe: one line of the kit's small type in the strip's height (its top px is the hairline); the × a small control wide */
  .edge .ovb { font: var(--fs-1) / calc(var(--ov-h) - 1px) var(--font); }
  .edge .ovx { width: var(--ctl-h-sm, 22px); font: var(--fs-2) / calc(var(--ov-h) - 1px) var(--font); text-align: center; }
  .dirrow { flex: none; }
  .dirrow > .strip { height: 100%; }
  .edge .seg { font-size: 7px; /* micro, below --fs-1: its box is fixed */ line-height: 8px; }
  .edge .sign { background: none; color: var(--tx-ghost); }
  .edge .sign.flipped { background: rgba(var(--highlight-rgb), .18); color: var(--highlight); }
  .edge .polb { font-size: 7px; /* micro, below --fs-1: its box is fixed */ line-height: 8px; }
  .eph { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--highlight); pointer-events: none; }
  .bnote { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--tx-mut); font-size: var(--fs-1); }
  .bnote.warn { color: var(--warn-ink); }
  .rub { position: absolute; top: 0; bottom: 0; background: rgba(var(--highlight-rgb), .3); pointer-events: none; }
  .band { display: flex; flex-direction: column; min-height: 0; max-height: 60%; background: var(--bg-raised); border-top: var(--bw) solid var(--line-1); }
  .bandrow { flex: none; display: flex; align-items: center; gap: var(--space-1); height: 22px; padding-right: var(--space-2); overflow: hidden; }
  /* paw-p8o2: the band in the kit's voice: words in the UI face, chips framed like the kit's Chip, on = the kit's selected state */
  .bandmore > .chip { height: 18px; border: var(--bw) solid var(--line-2); background: var(--bg-sunken); color: var(--tx-val); }
  .bandmore > .chip:hover:not(:disabled) { border-color: var(--line-4); background: var(--bg-sunken); color: var(--tx-hi); }
  .bandmore > .chip.on { border-color: var(--reality); background: var(--sel-bg); color: var(--accent-ink); }
  .more { flex: none; display: grid; place-items: center; width: 20px; height: 22px; padding: 0; color: var(--tx-mut); }
  .more:hover:not(:disabled) { color: var(--tx-hi); }
  .more:disabled { opacity: .4; }
  .more:focus-visible { outline: var(--ring-w, 2px) solid var(--focus); outline-offset: -2px; }
  .bandmore { flex: 1 1 auto; min-height: 0; overflow: auto; padding: var(--space-2) var(--space-3) var(--space-3); border-top: var(--bw) solid var(--line-1); }
  /* the Adjust strip laid out across the band's width, not one tall panel column */
  .bandmore :global([data-testid='derive-strip']) { display: block; columns: 300px auto; column-gap: var(--space-5); border: 0; padding: 0; background: none; }
  .bandmore :global([data-testid='derive-strip'] > *) { break-inside: avoid; margin-bottom: var(--space-2); }
  .bandmore > .chip { margin-bottom: var(--space-2); height: 18px; font-size: var(--fs-1); }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; touch-action: none; outline: none; }
  canvas:focus-visible { box-shadow: inset 0 0 0 var(--ring-w, 2px) var(--focus); }
  .empty { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; color: var(--tx-ghost); font: var(--fs-1) var(--mono); }
  .whytip { position: absolute; z-index: 2; max-width: 260px; padding: 2px 6px; pointer-events: none; font-size: var(--fs-1); line-height: 1.3; color: var(--tx-hi); background: var(--bg-card); border: 1px solid var(--line-2); border-radius: var(--radius); }
  .pick { display: flex; align-items: stretch; gap: 2px; padding: 0 4px; overflow: hidden; white-space: nowrap; background: var(--bg); font: var(--fs-1)/16px var(--mono); }
  .pick .lbl { color: var(--tx-ghost); padding-right: 2px; overflow: hidden; text-overflow: ellipsis; }
  .pick .sep { width: var(--bw); margin: 3px 4px; background: var(--line-1); }   /* the one separator (theme.css .k-sep) */
  .chip { display: inline-flex; align-items: center; gap: 3px; padding: 0 5px; border-radius: var(--radius); color: var(--tx-mut); background: var(--line-0); font: inherit; }
  .chip i { width: 6px; height: 6px; border-radius: 50%; background: var(--chip); }
  .chip:hover:not(:disabled) { background: var(--line-3); color: var(--tx-hi); }
  .chip.on { background: rgba(var(--highlight-rgb), .22); color: var(--highlight); }
  .chip:disabled { opacity: .45; cursor: default; }
  .chip.sem :global(.k-icon) { color: var(--chip); flex: none; }   /* a pinned group (seeded from the tagger): a pin in its colour */
  .chip.armA { background: rgba(var(--highlight-rgb), .22); color: var(--highlight); }
  .pick .lbl.range { color: var(--highlight); }   /* the pickers act on a range override */
  .src { max-width: 16ch; }   /* the label ellipsised, the ▾ always shown (an inline-flex box clips its text without one) */
  .src .tx { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .shint { margin-left: -3px; padding: 0 2px; color: var(--warn-ink); font-size: var(--fs-1); cursor: default; }   /* paw-4c48.10: the shaft reads this shot differently */
  .pairpop { display: flex; flex-direction: column; gap: 6px; padding: 6px; max-width: 320px; font: var(--fs-1) var(--mono); white-space: normal; }   /* inside .pick: its nowrap would clip the hint */
  .pairpop p { margin: 0; color: var(--tx-mut); }
  .pairpop .parts { display: flex; flex-wrap: wrap; gap: 3px; }
  .pairpop .chip { padding: 2px 6px; }
  /* range overrides (paw-9qm): a marked segment near the top of the lane (under the Detail chip), its ends draggable */
  .ovr { position: absolute; top: 18px; height: 13px; z-index: 1; display: flex; min-width: 6px; border: 1px solid var(--highlight); border-radius: var(--radius); background: rgba(var(--highlight-rgb), .14); }
  .ovr.on { background: rgba(var(--highlight-rgb), .32); box-shadow: 0 0 0 1px var(--highlight); }
  .ovb { flex: 1; min-width: 0; padding: 0 3px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-align: left; color: var(--highlight); font: var(--fs-1)/11px var(--mono); }
  .ovx { flex: none; width: 11px; padding: 0; color: var(--highlight); font: var(--fs-1)/11px var(--mono); }
  .ovx:hover, .ovb:hover { color: var(--tx-hi); }
  .ovb:focus-visible, .ovx:focus-visible { outline: var(--ring-w, 2px) solid var(--focus); outline-offset: -1px; }
  /* paw-bg90: the ends are inside the box (hit where they are drawn), a bar on hover; a narrow box keeps its body between them */
  .ovh { position: absolute; top: 0; bottom: 0; width: 4px; cursor: ew-resize; touch-action: none; }
  .ovh.l { left: 0; }
  .ovh.r { right: 0; }
  .ovr.narrow .ovh { width: 2px; }
  .ovh:hover, .ovr:hover .ovh { background: rgba(var(--highlight-rgb), .55); }
  .chip:focus-visible { outline: var(--ring-w, 2px) solid var(--focus); outline-offset: -1px; }
  /* paw-k8pe: a group of the row's controls (gSrc .. gBase): the Tracker row's own flex items, as before; in the lane toolbar
     (RunBar.svelte, .k-runbar) one unit at the toolbar's height, in the kit's voice (framed, on = the kit's selected state) */
  .grp { display: contents; }
  :global(.k-runbar) .grp { display: inline-flex; align-items: center; gap: var(--space-1); }
  :global(.k-runbar) .chip { height: var(--ctl-h-sm, 22px); padding: 0 var(--space-2); border: var(--bw) solid var(--line-2); background: var(--bg-sunken); color: var(--tx-val); white-space: nowrap; }
  :global(.k-runbar) .chip:hover:not(:disabled) { border-color: var(--line-4); background: var(--bg-sunken); color: var(--tx-hi); }
  :global(.k-runbar) :is(.chip.on, .chip.armA) { border-color: var(--reality); background: var(--sel-bg); color: var(--accent-ink); }
  :global(.k-runbar) .lbl { color: var(--tx-mut); white-space: nowrap; }
  :global(.k-runbar) .sep { align-self: stretch; width: var(--bw); margin: 3px var(--space-1); background: var(--line-1); }
  :global(.k-runbar .runchip) { flex: 0 1 auto; min-width: 3rem; max-width: 12rem; }
  :global(.k-runbar .runchip.range) { border-color: var(--highlight); color: var(--highlight); }   /* the pickers act on a range override */
  .rcdot { display: inline-block; width: 8px; height: 8px; margin-right: var(--space-1); border-radius: 50%; background: var(--chip); vertical-align: middle; }
  /* paw-iasp: the fusion pad (chip) and its large view while dragged (fixed: the row clips its children) */
  .pad { cursor: move; touch-action: none; }
  .padbox, .padview .box { position: relative; flex: none; border: 1px solid var(--line-3); border-radius: var(--radius); background: linear-gradient(var(--line-2), var(--line-2)) center / 1px 100% no-repeat, linear-gradient(var(--line-2), var(--line-2)) center / 100% 1px no-repeat; }
  .padbox { width: 24px; height: 12px; }
  .padbox i, .padview i { position: absolute; border-radius: 50%; transform: translate(-50%, -50%); }
  .padbox .dot { width: 5px; height: 5px; background: var(--highlight); }
  .padbox .auto { width: 5px; height: 5px; border: 1px solid var(--tx-ghost); box-sizing: border-box; }
  .padview { position: fixed; z-index: 30; width: 150px; padding: 4px 6px; pointer-events: none; display: grid; grid-template-columns: auto 1fr auto; grid-template-rows: auto 64px auto; align-items: center; gap: 2px 4px;
    font: var(--fs-1)/1.2 var(--mono); color: var(--tx-mut); background: var(--bg-card); border: var(--bw) solid var(--line-2); border-radius: var(--radius); box-shadow: var(--shadow-1); }
  .padview .box { grid-column: 2; grid-row: 2; height: 100%; }
  .padview .t { grid-column: 2; grid-row: 1; text-align: center; }
  .padview .b { grid-column: 2; grid-row: 3; text-align: center; }
  .padview .l { grid-column: 1; grid-row: 2; writing-mode: vertical-rl; transform: rotate(180deg); }
  .padview .r { grid-column: 3; grid-row: 2; writing-mode: vertical-rl; }
  .padview .dot { width: 9px; height: 9px; background: var(--highlight); }
  .padview .auto { width: 9px; height: 9px; border: 1.5px solid var(--tx-ghost); box-sizing: border-box; }
  /* paw-439e: the standing pad pinned from the chip (fixed: the row clips its children) */
  .padfloat { position: fixed; z-index: 30; padding: 0 6px 6px; background: var(--bg-card); border: var(--bw) solid var(--line-2); border-radius: var(--radius); box-shadow: var(--shadow-1); }
  .pfh { display: flex; align-items: center; gap: 4px; margin: 0 -6px 4px; padding: 0 2px 0 6px; font: var(--fs-1)/16px var(--mono); color: var(--tx-mut); background: var(--line-0); cursor: move; touch-action: none; white-space: nowrap; }
  .pfh .grow { flex: 1; }
  .pfx { padding: 0 4px; color: var(--tx-mut); font: var(--fs-1)/14px var(--mono); }
  .pfx:hover { color: var(--tx-hi); }
  .strip { position: relative; overflow: hidden; background: var(--bg); }
  .seg { position: absolute; top: 0; bottom: 0; padding: 0; font: var(--fs-1)/14px var(--mono); text-align: center; overflow: hidden; white-space: nowrap; border-right: 1px solid var(--bg-sunken); }
  .sign { background: var(--line-1); color: var(--tx-val); }
  .sign.flipped { background: rgba(var(--highlight-rgb), .22); color: var(--highlight); }
  .sign:hover, .scene:hover { background: var(--line-3); color: var(--tx-hi); }
  .sign { cursor: cell; }   /* paw-57ve: click flips the scene, a drag flips a stretch */
  /* paw-57ve: a flipped stretch, in the flipped look; ends trim, the body moves */
  .pol { position: absolute; top: 0; bottom: 0; z-index: 1; min-width: 4px; display: flex; background: rgba(var(--highlight-rgb), .22); box-shadow: inset 0 0 0 1px rgba(var(--highlight-rgb), .6); }
  .pol.on { background: rgba(var(--highlight-rgb), .4); box-shadow: inset 0 0 0 1px var(--highlight); }
  .polb { flex: 1; min-width: 0; padding: 0; overflow: hidden; color: var(--highlight); font: var(--fs-1)/14px var(--mono); text-align: center; cursor: grab; touch-action: none; }
  .polb:active { cursor: grabbing; }
  .polb:hover { color: var(--tx-hi); }
  .polb:focus-visible { outline: var(--ring-w, 2px) solid var(--focus); outline-offset: -1px; }
  /* paw-wg2d: an anchor: a diamond at its frame, as high as its pos; in / out / middle by colour */
  .anc { position: absolute; z-index: 2; width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px; padding: 0; transform: rotate(45deg); border: 1px solid var(--bg-sunken); background: var(--series-sky); cursor: ew-resize; touch-action: none; }
  .anc[data-pos='0'] { background: var(--series-vermilion); }
  .anc[data-pos='50'] { background: var(--series-lime); }
  .anc:hover { box-shadow: 0 0 0 1px var(--tx-hi); }
  .anc:focus-visible, .anc:focus { outline: var(--ring-w, 2px) solid var(--focus); outline-offset: 1px; }
  .polh { position: absolute; top: 0; bottom: 0; width: 6px; cursor: ew-resize; touch-action: none; }
  .polh.l { left: -3px; }
  .polh.r { right: -3px; }
  .scene { background: var(--line-0); color: var(--tx-ghost); }
  .scene.alt { background: var(--line-1); }
  /* a shot narrower than its number shows no number (clipped halves of neighbouring labels read as '77.37.7 7.6') */
  .scene { container-type: inline-size; }
  @container (max-width: 22px) { .scene .lb { visibility: hidden; } }
  .spans .seg { line-height: 11px; color: var(--bg); opacity: .85; }
  .span:hover { opacity: 1; }
  .span[data-state='idle'] { background: var(--series-grey); }
  .span[data-state='carry'] { background: var(--series-blue); }
  .span[data-state='climax'] { background: var(--series-vermilion); }
  .span[data-state='orgasm'] { background: var(--series-pink); }
  .span[data-state='active'] { background: var(--series-green); }
</style>
