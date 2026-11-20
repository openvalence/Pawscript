<script>
  // The fusion panel (paw-iasp stage 3): the full parameters behind the Tracker row's pad, in the Adjust strip where the
  // "Fused from" list was. lib/fusion.js info of the shot's run scene drawn as it is: per body its parts (phase dial: the
  // part's lag as a share of the stroke period, a half turn = the other side of the stroke; coherence; its say in the
  // fused signal, the same number the Fusion view rings show on the video), the relationships with their weights (drag a
  // bar sideways = that row's own multiplier, live; release = one undo step), what the scene type contributed and its
  // strength, the pad. Pin / exclude stay hard overrides. Every value the owner changed is marked and has its own reset.
  // paw-439e: like the strip's other controls (paw-hiq5), inside a range override (the selected one, else the one under
  // the playhead: tr.fuseSpan) every control here reads and writes THAT override's fuse settings and the override's own
  // fusion record is drawn; the header says which ("range 1:30.1–1:34.8" / "shot 5") with the same × clear. The scene
  // type: the shot's act chips, each on / off for this shot and run only (fuse.actsOff), and what the scene type did
  // here (a tag whose relationship is not carrying the stroke is said to be ignored). The standing pad (FusionPad).
  // paw-0sn8: the Signal chips (fuse.jit: smoothing on by default, one stroke direction off by default) and, per part, what it
  // is read against (relative to the other side, or the frame) and how much of that motion runs along the stroke direction.
  import Button from '../../ui/kit/Button.svelte';
  import Slider from '../../ui/kit/Slider.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { trackingFor } from './tracking.svelte.js';
  import { semColor } from './colors.js';
  import { partLabel } from './groups.js';
  import { partList } from '../../lib/content.js';
  import FusionPad from './FusionPad.svelte';
  import Section from '../../ui/kit/Section.svelte';
  import { foldOpen, setFold } from './folds.js';
  import { fmtTime } from '../../lib/funscript.js';
  import { shotLabel } from '../timeline/shots.js';
  import { signAt } from '../../lib/polarity.js';
  import { holdFrac, HOW_HOLD } from '../../lib/stroke-shape.js';
  import { anchorsText, anchorLine, sectionText } from '../../lib/anchors.js';
  const anchorsTip = () => `Your anchors on this shot (${['In', 'Out', 'Mid'].map((k, j) => `${app.commands.keysFor(`tracking.anchor${k}`)?.[0] || 'no key'} ${['fully in', 'fully out', 'middle'][j]}`).join(', ')}; marks on the Tracker row, as many of each as you like): each tells fusion to look elsewhere for the motion THERE. Per section of the shot: where the automatic mix already puts the anchored turns on those frames nothing changes; where it does not, the section takes the relationships that do (either way up, its own shift), only as far as the automatic mix keeps disagreeing with them; sections without anchors stay exactly as they were. "reads" = what the fused signal reads on that frame (0 = deepest .. 100 = out over the shot), "was" = without the anchors. Remove every anchor = the automatic mix exactly`;

  let { app, i, fz: fzShot } = $props();
  // svelte-ignore state_referenced_locally
  const tr = trackingFor(app);
  const span = $derived(tr.fuseSpan(i));
  const sp = $derived(span ? { t0: span.t0, t1: span.t1 } : null);
  const fz = $derived((sp ? tr.fuseInfo(i, sp) : null) || fzShot);
  const runId = $derived(tr.deriveRun(i)?.id);
  const ctl = $derived(tr.fuseControls(i, sp, runId));
  const w = $derived(ctl.w || {});
  let more = $state(false), drag = $state(null), raf = 0;
  const TOP = 3;   // paw-r73w: the leading relationships listed; the rest behind 'n more' (a row the owner set is always listed)
  const put = (patch, label, commit = true) => tr.setFuse(i, patch, { commit, label, span: sp, run: runId });
  // paw-orm2: a tracked scene of several shots is fused as one: the settings are its, and the header names all its shots
  const together = $derived(tr.composedWith(i, runId)?.shots || [i]);
  const where = $derived(sp ? `range ${fmtTime(sp.t0)}–${fmtTime(sp.t1)}` : together.length > 1 ? `shots ${shotLabel(tr.scenes, together[0])}–${shotLabel(tr.scenes, together[together.length - 1])}` : `shot ${shotLabel(tr.scenes, i)}`);
  const clearSpan = () => { if (tr.sigSel?.t0 === sp.t0 && tr.sigSel?.t1 === sp.t1) tr.sigSel = null; tr.setSpan(sp, null, { label: 'Signal: remove a range override' }); };
  const resetAll = () => (sp ? tr.setSpan(sp, { fuse: undefined }, { label: 'Fusion: the range back to automatic' }) : tr.setDerive(i, { fuse: null }, { scope: tr.deriveScope, label: 'Fusion: all back to automatic' }));
  // paw-439e: the shot's act chips (scene tags), each on / off for this shot / run (fuse.actsOff)
  const tags = $derived(fz.scene.tags || fz.scene.acts);
  const offActs = $derived(ctl.actsOff || []);
  const toggleAct = (a) => { const off = offActs.includes(a) ? offActs.filter((x) => x !== a) : [...offActs, a]; put({ actsOff: off.length ? off : null }, `Fusion: ${offActs.includes(a) ? 'use' : 'ignore'} the ${a} tag here`); };
  const pct = (x) => `${Math.round(100 * x)} %`;
  // paw-0sn8: the Signal chips; a click writes only what differs from the defaults (null = back to default)
  const jit = $derived(fz.jit || { refine: 0.15, dir: false });
  const putJit = (k, v, label) => { const next = { ...(ctl.jit || {}) }; if (v === null) delete next[k]; else next[k] = v; put({ jit: Object.keys(next).length ? next : null }, label); };
  const DIRS = { axis: 'the stroke axis tool', scene: 'the scene (every relationship read along it)', lead: 'the leading relationship' };
  const SMOOTH_TIP = 'Smooth: a stroke-aware pass over the fused signal (a quadratic fit about half as wide as the shorter half-strokes) that takes out the wiggle between turns; near every turn the signal stays as it was, so turns, impacts and holds keep their place and shape. On by default. Off = the fused signal as weighed, for this shot / range. One undo step';
  const DIR_TIP = 'Direction: read every relationship along ONE stroke direction for the scene (the direction where the motion repeats) and give less say, window by window, to a relationship moving across it. Off by default: it cleaned the test scenes but was mixed on real shots. Try it on a shot whose bodies sway sideways. One undo step';
  // paw-0yfp: while a weight is dragged the list keeps its rows and order (a row re-sorting under the pointer loses its pointer
  // capture: the release never committed and the preview stayed); a row the owner set stays listed however small its share
  const rels = $derived.by(() => { if (drag?.order) return drag.order.map((id) => fz.relations.find((r) => r.id === id)).filter(Boolean); const all = fz.relations.filter((r) => r.share > 0.003 || r.excluded || r.pinned || r.id in w); return more ? all : [...all.slice(0, TOP), ...all.slice(TOP).filter((r) => r.excluded || r.pinned || r.id in w)]; });
  const hidden = $derived(fz.relations.filter((r) => r.share > 0.003 || r.excluded || r.pinned || r.id in w).length - rels.length);
  const maxShare = $derived(Math.max(0.05, ...fz.relations.map((r) => r.share)));
  const outParts = $derived((ctl.exclude || []).filter((id) => !id.includes('~')));
  const actRows = $derived(fz.scene.rows.filter((r) => r.gain > 1));
  /** The phase dial's needle: the lag as a share of the stroke period (a half turn = anti-phase). */
  const angle = (p) => ((fz.periodMs ? (p.lagMs / fz.periodMs) * 360 : 0) + (p.anti ? 180 : 0)) % 360;
  const dialTip = (p) => `${p.label}: ${p.anti ? 'the other side of the stroke (anti-phase)' : 'with the stroke'}${p.lagMs ? `, ${p.lagMs > 0 ? 'lagging' : 'leading'} by ${Math.abs(p.lagMs)} ms` : ', in phase'}${fz.periodMs ? ` (a stroke is ~${fz.periodMs} ms: the needle turns with the lag)` : ''} · coherence ${p.coh} · its say in its body ${pct(p.inBody)} · in the fused signal ${pct(p.say)}${p.vs ? ` · read ${p.rel ? `relative to ${p.vs}` : 'against the frame (absolute: camera residue stays in it)'}` : ''}${p.dirCoh != null ? ` · ${pct(p.dirCoh)} of that motion along the stroke direction (the bar)` : ''}`;
  const relTip = (r) => `${r.label}: ${pct(r.share)} of the fused signal · prior ${r.prior}${r.gain !== 1 ? ` x scene type ${r.gain} (${(r.acts || []).join(', ')})` : ''}${r.pad !== 1 ? ` x pad ${r.pad.toFixed(2)}` : ''}${r.user !== 1 ? ` x your weight ${r.user}` : ''} · rhythm ${r.rhythm} · present ${pct(r.present)} · ${r.lagMs ? `lags ${r.lagMs} ms (phase x${r.phase})` : 'in phase'} · coherence ${r.coh}. Drag the bar sideways to weigh it yourself (right = more); double-click = back`;
  function barDown(e, r) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag = { id: r.id, x0: e.clientX, w0: w[r.id] ?? 1, cur: w[r.id] ?? 1, moved: false, order: rels.map((x) => x.id) };
  }
  function barMove(e) {
    const d = drag;
    if (!d) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < 2) return;
    let v = Math.min(8, Math.max(d.w0 || 0.03, 0.03) * 2 ** (dx / 40));   // 40 px = twice / half; far left = off
    if (v < 0.04) v = 0;
    drag = { ...d, moved: true, cur: Math.round(v * 100) / 100 };
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (drag?.moved) put({ w: { ...w, [drag.id]: drag.cur } }, '', false); });
  }
  function barUp(e) {
    const d = drag;
    drag = null; cancelAnimationFrame(raf); raf = 0;
    if (d?.moved && e.type === 'pointerup') put({ w: { ...w, [d.id]: d.cur } }, 'Fusion: weight of a relationship');
    else if (d?.moved) tr.derivePreview = null;
  }
  const resetW = (id) => { const { [id]: _, ...rest } = w; put({ w: Object.keys(rest).length ? rest : null }, 'Fusion: weight back'); };   // eslint-disable-line no-unused-vars
  const pinX = (id, kind) => tr.toggleFusePart(i, id, kind, sp);
  // paw-t11b: HOW the strokes go (lib/fusion-how.js, info.how): a strip over the shot (a cell per half-stroke in its type's
  // colour, its conf as its strength; a tick per turn as tall as the parts' dwell there, a dot for an impact; the playhead)
  // and the read of the stroke under the playhead: why a hold or a midpoint was or was not placed
  const how = $derived(fz.how?.turns?.length ? fz.how : null);
  const span2 = $derived(sp || (tr.scenes[i] ? { t0: tr.scenes[i].start_ms, t1: tr.scenes[i].end_ms } : null));
  const INKS = ['--series-sky', '--series-orange', '--series-green', '--series-violet', '--series-pink', '--series-lime', '--series-vermilion', '--series-blue'];
  const ink = (id) => `var(${INKS[(+id || 0) % INKS.length]})`;
  const typeOf = (id) => how?.types.find((y) => y.id === id);
  const sens = $derived(tr.detailShown?.(i, 'shot')?.sens ?? 50), byRender = $derived(tr.detailShown?.(i, 'shot')?.shape === 'render');   // paw-na9u: By render has no hold score (a flat only where the trace is level)
  /** a turn kind of the fused signal (+1 = its top) as the script has it: 'out' or 'deep' (the scene's direction) */
  const where2 = (q) => { const r = tr.deriveRun(i); return q.kind * (r ? signAt(r, q.t) : 1) > 0 ? 'out' : 'deep'; };   // paw-vtec: the run's one direction map (scene sign, flips, stretches, Assist's spans)
  const holdScore = (q) => (q.dwell * (1 + HOW_HOLD.impact * q.impact)) / holdFrac(sens);
  const strip = $derived.by(() => {
    if (!how || !span2 || !(span2.t1 > span2.t0)) return null;
    const { t0, t1 } = span2, x = (ms) => (100 * (ms - t0)) / (t1 - t0);
    return { cells: how.halves.filter((h) => h.t1 > t0 && h.t0 < t1).map((h) => ({ h, x0: Math.max(0, x(h.t0)), x1: Math.min(100, x(h.t1)) })),
      turns: how.turns.filter((q) => q.t >= t0 && q.t < t1).map((q) => ({ q, x: x(q.t) })) };
  });
  const head = $derived(span2 && span2.t1 > span2.t0 ? (100 * (app.player.timeMs - span2.t0)) / (span2.t1 - span2.t0) : -1);   // (apart: playback moves only the line)
  const parts = (L) => L.map((p) => p.label.replace(/^(Bottom|Top|Extra) /, '')).join(', ');
  const turnText = (q) => q ? `${where2(q)} turn: ${q.dwell > 0 ? `rests ${pct(q.dwell)} of a half-stroke${q.by.length ? ` (${parts(q.by)})` : ''}` : 'no rest'}${q.impact >= 0.25 ? ` · impact ${q.impact.toFixed(1)}${q.ringBy.length ? ` (${parts(q.ringBy)} ring${q.ringBy.length > 1 ? '' : 's'}${q.strength ? `, ${pct(q.strength)} of ${q.ringBy.length > 1 ? 'their' : 'its'} stroke` : ''})` : ''}` : ''}${byRender ? '' : ` · hold score ${holdScore(q).toFixed(2)}${holdScore(q) >= 1.1 ? ' (a hold)' : holdScore(q) > 0.9 ? ' (borderline: the type decides)' : ' (no hold)'}`}` : '';
  const shapeText = (h) => (h.asym > 0.04 ? 'fast then slow' : h.asym < -0.04 ? 'slow then fast' : 'even');
  const now = $derived.by(() => {
    if (!how) return null;
    const ms = app.player.timeMs, h = how.halves.find((x) => x.t0 <= ms && x.t1 > ms);
    return h ? { h, y: typeOf(h.type), b: how.turns.find((q) => q.t === h.t1) } : null;
  });
  const cellTip = (h) => { const y = typeOf(h.type); return `Stroke type ${y?.label ?? '?'} (${y?.n ?? 1} like it in the scene) · ${shapeText(h)} · ${Math.round(h.t1 - h.t0)} ms · the parts' read conf ${h.conf}. Alike strokes of the whole scene share one type and one layout`; };
  const HOW_TIP = $derived(`How the strokes go, read from every tracked part (also the ones with no say in the signal: ${partList(['balls', 'tail', 'head'])}): a cell per half-stroke in its type's colour (alike strokes of the whole scene, one layout per type), a tick per turn as tall as the parts' rest there, a red dot where it lands with an impact (still speeding up into the stop, something swinging after it). The Detail places holds and midpoints from this`);   // paw-43vn: the part examples follow furry items (lib/content.js)
</script>

<!-- paw-r73w: open by default only what is used: the pad, the smoothing / direction chips and the leading relationships (their
     weight, pin, x); the scene type, the act tags, How and the parts are one fold (remembered: folds.js) -->
<div class="fp" data-testid="fuse-panel" data-surface="panel.fusion">
  <div class="row head">
    <span class="lbl k-caps grow" {@attach tooltip('Fused from every part (pin: only these, ×: leave out)')}>Fusion · conf {fz.conf}{fz.solo ? ` · one character: ${fz.solo.label}` : ''}</span>
    <Button size="sm" variant="ghost" disabled={!Object.keys(ctl).length} onclick={resetAll} tip="Every fusion setting of this {sp ? 'range override' : 'shot'} back to auto">Reset</Button>
  </div>
  <div class="row"><span class="where num" class:range={!!sp} data-testid="fuse-where" {@attach tooltip(sp ? `Editing the range override ${where}` : "Editing the shot's own fusion")}>{where}</span>
    {#if sp}<button class="chip" data-testid="fuse-clear" aria-label="Clear this range override" {@attach tooltip('Clear this range override (X)')} onclick={clearSpan}>× clear</button>{/if}</div>
  {#if fz.anchors}<!-- paw-wg2d: the shot solved backwards to the owner's anchors (lib/anchors.js): how well it reads them -->
    <div class="row" data-testid="fuse-anchors"><span class="lbl k-caps" {@attach tooltip(anchorsTip())}>Anchors</span><span class="k-hint grow">{anchorsText(fz.anchors)}</span></div>
    {#each fz.anchors.sections as sc, j (j)}<!-- paw-ze8n: per section, what it did and why; its anchors' residuals under it -->
      <p class="k-hint note num" data-testid="fuse-anchor-section">{sectionText(sc, fmtTime)}</p>
      {#each fz.anchors.list.filter((a) => a.section === j) as a (a.ms)}<p class="k-hint note num sub" data-testid="fuse-anchor">{fmtTime(a.ms)} {anchorLine(a)}</p>{/each}
    {/each}
  {/if}
  <FusionPad {app} shot={i} span={sp} run={runId} auto={fz.auto} />
  {#if ctl.pad}
    <div class="row changed"><span class="k-hint grow">Pad moved off the automatic choice</span>
      <button class="reset" aria-label="Pad back to center" {@attach tooltip('Pad back to center (auto)')} onclick={() => put({ pad: null }, 'Fusion: pad back to center')}>↺</button></div>
  {/if}
  <div class="row acts" data-testid="fuse-signal">
    <span class="lbl k-caps" {@attach tooltip(`Stroke direction: ${fz.dir ? `from ${DIRS[fz.dir.from]}${fz.dir.label ? ` (${fz.dir.label})` : ''}` : 'none'}\nTop ${partList(['sheath', 'balls'], ' / ')} / knot read against the Bottom`)}>Signal</span>
    <button class="chip" class:on={jit.refine > 0} class:changed={ctl.jit?.refine === 0} aria-pressed={jit.refine > 0} data-testid="fuse-smooth" {@attach tooltip(SMOOTH_TIP)} onclick={() => putJit('refine', jit.refine > 0 ? 0 : null, `Fusion: smoothing ${jit.refine > 0 ? 'off' : 'on'}`)}>smooth</button>
    <button class="chip" class:on={jit.dir} class:changed={ctl.jit?.dir === true} aria-pressed={!!jit.dir} data-testid="fuse-direction" {@attach tooltip(DIR_TIP)} onclick={() => putJit('dir', jit.dir ? null : true, `Fusion: one direction ${jit.dir ? 'off' : 'on'}`)}>direction</button>
  </div>
  <span class="lbl k-caps" {@attach tooltip('What the signal is made of, drag a bar to weigh it')}>Relationships</span>
  <!-- paw-0yfp: a control at its extreme never takes the panel away: said here instead -->
  {#if fz.none}<p class="k-hint note" data-testid="fuse-none">Nothing is contributing: every relationship you kept is left out or at ×0, so the fused signal falls back to the automatic mix (the shares below). Drag a weight back up, or ↺ / × to bring one back.</p>
  {:else if fz.pinsOff}<p class="k-hint note" data-testid="fuse-pins-off">Your pinned relationships are all off (×0 or left out): the pins no longer narrow the mix, every other relationship counts.</p>{/if}
  {#each rels as r (r.id)}
    {@const uw = drag?.id === r.id ? drag.cur : w[r.id]}
    <div class="row rel" class:off={r.excluded || uw === 0} class:lag={r.phase < 0.5} data-testid="fuse-rel" {@attach tooltip(relTip(r))}>
      <span class="grow ell">{r.label}{r.gain > 1 ? ' ★' : ''}</span>
      <span class="wt" data-ctl="Weight" class:changed={uw != null} role="slider" tabindex="-1" aria-label="Weight of {r.label}" aria-valuenow={uw ?? 1} aria-valuemin={0} aria-valuemax={8}
        onpointerdown={(e) => barDown(e, r)} onpointermove={barMove} onpointerup={barUp} onpointercancel={barUp} onlostpointercapture={(e) => drag && barUp(e)} ondblclick={() => resetW(r.id)}><i style:width="{(100 * r.share) / maxShare}%"></i>{#if uw != null}<em>×{uw}</em>{/if}</span>
      <span class="num pct">{r.excluded || uw === 0 ? 'out' : pct(r.share)}</span>
      <Button size="sm" variant={r.pinned ? 'primary' : 'ghost'} pressed={!!r.pinned} data-ctl="relationship pin" onclick={() => pinX(r.id, 'pin')} tip="Pin: the fused signal uses only the pinned relationships">pin</Button>
      <Button size="sm" variant={r.excluded ? 'primary' : 'ghost'} pressed={!!r.excluded} data-ctl="relationship out" onclick={() => pinX(r.id, 'exclude')} tip="Leave this relationship out">×</Button>
      {#if w[r.id] != null}<button class="reset" aria-label="Weight of {r.label} back" {@attach tooltip('Its weight back to automatic')} onclick={() => resetW(r.id)}>↺</button>{/if}
    </div>
  {/each}
  {#if hidden > 0 || more}<button class="more k-hint" onclick={() => (more = !more)}>{more ? 'fewer' : `${hidden} more`}</button>{/if}
  {#if outParts.length}
    <div class="row"><span class="k-hint grow">Left out: {outParts.map(partLabel).join(', ')}</span>
      {#each outParts as id (id)}<Button size="sm" variant="ghost" onclick={() => pinX(id, 'exclude')} tip="Bring {partLabel(id)} back">{partLabel(id)} ↺</Button>{/each}</div>
  {/if}
  <Section title="Fusion details" level={4} data-fold="fusion" open={foldOpen(app, 'fusion')} onchange={(v) => setFold(app, 'fusion', v)}>
    <div class="fold">
      <div class="row" class:changed={ctl.prior != null}>
        <span class="lbl k-caps" {@attach tooltip(`How much the act tags (${fz.scene.acts.join(', ') || 'none'}) lead\n${actRows.length ? 'They raise: ' + actRows.map((r) => `${r.label} ×${r.gain}`).join(', ') : 'Nothing painted matches them'}`)}>Scene type</span>
        <Slider size="sm" full label="Scene type strength" min={0} max={100} step={5} value={Math.round(100 * (ctl.prior ?? 1))} showValue format={(v) => v + ' %'}
          onchange={(v) => put({ prior: v / 100 }, '', false)} oncommit={(v) => put({ prior: v === 100 ? null : v / 100 }, 'Fusion: scene type strength')} />
        {#if ctl.prior != null}<button class="reset" aria-label="Scene type strength back to 100 %" {@attach tooltip('Back to 100 %')} onclick={() => put({ prior: null }, 'Fusion: scene type strength back')}>↺</button>{/if}
      </div>
      {#if tags.length}
        <div class="row acts" data-testid="fuse-acts">
          {#each tags as a (a)}
            {@const off = offActs.includes(a)}
            <button class="chip" class:on={!off} class:changed={off} aria-pressed={!off} {@attach tooltip(off ? `${a}: ignored for this ${sp ? 'range' : 'shot'}, click to use it` : `${a}: used here, click to ignore it for this ${sp ? 'range' : 'shot'}`)} onclick={() => toggleAct(a)}>{a}</button>
          {/each}
        </div>
      {/if}
      <p class="k-hint">{fz.scene.acts.length ? `${fz.scene.acts.join(' + ')}: ${actRows.map((r) => `${r.label} ×${r.gain}${r.limit != null && r.limit < 0.995 ? ` (keeps ${Math.round(100 * r.limit)} %)` : ''}`).join(', ') || 'no painted part it names'}` : tags.length ? 'Every act tag ignored here: the parts alone decide' : 'No act tags on this shot: the parts alone decide'}</p>
      {#each fz.scene.notes || [] as n (n.id)}<p class="k-hint note" data-testid="fuse-tag-note">{n.text}</p>{/each}
      {#if how && strip}
        <div class="row"><span class="lbl k-caps grow" {@attach tooltip(HOW_TIP)}>How{how.used ? '' : ' · not used here'}</span>
          <span class="k-hint num">{how.types.length} type{how.types.length === 1 ? '' : 's'}</span></div>
        <svg class="how" viewBox="0 0 100 14" preserveAspectRatio="none" data-testid="fuse-how" aria-hidden="true">
          {#each strip.cells as c (c.h.t0)}<rect x={c.x0} y="0" width={Math.max(0.2, c.x1 - c.x0 - 0.15)} height="14" style:fill={ink(c.h.type)} style:opacity={0.18 + 0.4 * c.h.conf} {@attach tooltip(cellTip(c.h))} />{/each}
          {#each strip.turns as k (k.q.t)}<rect class="dw" x={k.x - 0.25} y={14 - 13 * Math.min(1, k.q.dwell)} width="0.5" height={13 * Math.min(1, k.q.dwell)} />{#if k.q.impact >= 0.25}<circle class="hit" cx={k.x} cy="2.5" r="1.6" style:opacity={k.q.impact} />{/if}{/each}
          <line class="head" x1={head} x2={head} y1="0" y2="14" />
        </svg>
        <p class="k-hint" data-testid="fuse-how-now">{#if !how.used}No part here with next to no say in the signal ({partList(['balls', 'tail', 'head'])}): the Detail reads the signal alone.{:else if now}Type {now.y?.label ?? '?'} ({now.y?.n ?? 1}) · {shapeText(now.h)}{now.b ? ` · ${turnText(now.b)}` : ''}{:else}Move the playhead onto a stroke to read it.{/if}</p>
      {/if}
      {#each fz.bodies as b (b.who)}
        <div class="body">
          <span class="lbl k-caps">{b.label}</span>
          {#each b.parts as p (p.id)}
            {@const pinned = (ctl.pin || []).includes(p.id)}
            <div class="row part" {@attach tooltip(dialTip(p))}>
              <i class="dot" style:background={semColor(p.names[0])}></i>
              <span class="grow ell">{p.label.replace(/^(Bottom|Top|Extra) /, '')}{p.names.length > 1 ? ` (${p.names.length} pieces)` : ''}</span>
              {#if p.vs}<span class="vs" class:abs={!p.rel} data-testid="fuse-part-vs">{p.rel ? '↔ ' + p.vs.replace(/^(Bottom|Top|Extra) /, '') : 'abs'}</span>{/if}
              {#if p.dirCoh != null}<i class="dc" aria-hidden="true"><i style:width="{100 * p.dirCoh}%"></i></i>{/if}
              <svg class="dial" viewBox="-6 -6 12 12" aria-hidden="true"><circle r="5" /><line x1="0" y1="0" x2={4.5 * Math.sin((angle(p) * Math.PI) / 180)} y2={-4.5 * Math.cos((angle(p) * Math.PI) / 180)} style:opacity={0.35 + 0.65 * p.coh} /></svg>
              <span class="num lag">{p.lagMs ? (p.lagMs > 0 ? '+' : '') + p.lagMs + ' ms' : 'in'}</span>
              <span class="num pct">{pct(p.say)}</span>
              <Button size="sm" variant={pinned ? 'primary' : 'ghost'} pressed={pinned} data-ctl="part pin" onclick={() => pinX(p.id, 'pin')} tip="Use only the pinned parts">pin</Button>
              <Button size="sm" variant="ghost" data-ctl="part out" onclick={() => pinX(p.id, 'exclude')} tip="Leave this part out of every relationship">×</Button>
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </Section>
</div>

<style>
  .fp { display: grid; gap: 2px; min-width: 0; font-size: var(--fs-1); }
  .row { display: flex; gap: var(--space-2); align-items: center; min-width: 0; }
  .grow { flex: 1; min-width: 0; }
  .ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lbl { color: var(--tx-mut); cursor: help; white-space: nowrap; }
  .row > .lbl { min-width: 5.5em; }
  .row > .lbl:not(.grow) { flex: none; }   /* "SCENE TYPE" is wider than 5.5em: never under the slider */
  .head .lbl { white-space: normal; overflow-wrap: anywhere; }   /* paw-r73w: wraps, never cut */
  .body { display: grid; gap: 1px; margin-top: 2px; }
  .k-hint { margin: 0; }
  .num { font-family: var(--mono); font-variant-numeric: tabular-nums; color: var(--tx-val); }
  .pct { min-width: 3.2em; text-align: right; }
  .lag { min-width: 4em; text-align: right; color: var(--tx-mut); }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .dial { width: 13px; height: 13px; flex: none; }
  .dial circle { fill: none; stroke: var(--line-3); stroke-width: 1; }
  .dial line { stroke: var(--highlight); stroke-width: 1.6; stroke-linecap: round; }
  .rel { flex-wrap: wrap; row-gap: 0; }   /* the label on its own line: the side panel is narrow */
  .rel > .grow { flex-basis: 100%; }
  .rel .wt { flex: 1; width: auto; min-width: 48px; }
  .rel.off { opacity: .5; }
  .rel.lag .grow { color: var(--tx-mut); }
  .wt { position: relative; flex: none; width: 64px; height: 10px; border-radius: var(--radius); background: var(--line-1); cursor: ew-resize; touch-action: none; overflow: hidden; }
  .wt i { position: absolute; inset: 0 auto 0 0; background: var(--highlight); opacity: .75; }
  .wt em { position: absolute; right: 2px; top: -2px; font: var(--fs-1)/14px var(--mono); font-style: normal; color: var(--tx-hi); }
  .changed { box-shadow: inset 2px 0 0 var(--series-yellow); }
  .wt.changed { box-shadow: 0 0 0 1px var(--series-yellow); }
  .reset { flex: none; padding: 0 3px; color: var(--series-yellow); font: inherit; }
  .reset:hover { color: var(--tx-hi); }
  .more { justify-self: start; padding: 0; color: var(--tx-mut); }
  .where { color: var(--tx-mut); font-size: var(--fs-1); }
  .where.range { color: var(--highlight); }
  .chip { display: inline-flex; align-items: center; padding: 0 5px; border-radius: var(--radius); color: var(--tx-mut); background: var(--line-0); font: var(--fs-1)/16px var(--mono); }
  .chip:hover { background: var(--line-3); color: var(--tx-hi); }
  .chip.on { background: rgba(var(--highlight-rgb), .22); color: var(--highlight); }
  .chip.changed { box-shadow: inset 0 0 0 1px var(--series-yellow); text-decoration: line-through; }
  .acts { flex-wrap: wrap; gap: 3px; }
  .fold { display: grid; gap: 2px; min-width: 0; }
  .note { color: var(--warn-ink, var(--tx-mut)); }
  .note.sub { padding-left: 10px; }
  .vs { flex: none; max-width: 6.5em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--tx-mut); font: var(--fs-1)/14px var(--mono); }
  .vs.abs { color: var(--series-yellow); }
  .dc { position: relative; flex: none; width: 14px; height: 4px; border-radius: var(--radius); background: var(--line-1); overflow: hidden; }
  .dc i { position: absolute; inset: 0 auto 0 0; background: var(--tx-mut); }
  .how { width: 100%; height: 14px; display: block; border-radius: var(--radius); background: var(--line-0); }
  .how .dw { fill: var(--tx-mut); }
  .how .hit { fill: var(--series-vermilion); }
  .how .head { stroke: var(--highlight); stroke-width: 0.4; vector-effect: non-scaling-stroke; }
</style>
