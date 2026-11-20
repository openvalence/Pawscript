<script>
  // Scene quick bar: lives in the lane toolbar row (`bar`: always the current scene, quickbar.js currentSpan: the
  // selection, else the scene at the playhead; it wraps onto more lines of that toolbar, never a popover) and in the
  // Inspector (while the selection is live, barSpan), so tracking a scene rarely needs the tracker panel:
  // tracker, Track (the point grid, paw-rw84: the default) / Track ROI on exactly the span (each sets the range to it first
  // when the bar shows the scene at the playhead; Track ROI honours the Scenes mode setting), motion-group chips with their share
  // over the scene, the signal, the scene's tags (acts.js) as chips by category: view | acts (+ menu) | camera | structure, click
  // toggles; a where with no what (or a what with no where) offers ghost chips (dashed: acts.js suggestWhat /
  // suggestWhere, click = add, one undo step); the modifier chips (paw-ef73.20: the six event kinds, one modifier each,
  // the same command as the Modifiers row's: over the range, else from the playhead) and the scene's modifiers (click =
  // select it and go there, × = delete). It never takes keyboard focus from
  // the lanes: presses don't focus, and a Select pick hands focus back. `tagsOnly`: just the tag chips (the Scenes panel's
  // selected row; paw-t8z: no Fill or Stabilise there, they are in the Scene / Shot popovers, the Inspector and the
  // Scenes row's right-click; paw-r73w: Stabilise only in the Shot popover, the Inspector's copy went).
  // Scenes contain shots (shots.js): the where / what / modifier / structure chips act on the scene, the view
  // and camera chips on one shot (span.shot: the selected shot, else the one under the playhead in the scene). paw-2lp7.4:
  // the view chips mark a shot Off-screen or Cutaway (one click converts); a marked shot gets what it does (bridged, action
  // continues, intermission), the bridge's one option (timing from this shot), "carry the action across" when no action
  // covers it, and Accept.
  // paw-hmn: `section` = 'scene' | 'shot' | 'tracker' shows one part (the lane toolbar's Scene / Shot / Tracker chip
  // popovers, SceneChips.svelte), 'all' (default) everything (the Inspector, the Scenes panel). `current`: the span is
  // the selection or the scene at the playhead (like `bar`) without the toolbar look.
  import { untrack } from 'svelte';
  import Button from '../../ui/kit/Button.svelte';
  import Select from '../../ui/kit/Select.svelte';
  import SegmentedControl from '../../ui/kit/SegmentedControl.svelte';
  import Slider from '../../ui/kit/Slider.svelte';
  import { showContextMenu } from '../../ui/kit/contextmenu.js';
  import { tl, scenesOf, durOf, setSceneTags, toggleSceneTag, toggleTagOnShots, tagOnAll, selOf } from './state.svelte.js';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { FX_KINDS, EVENT_KINDS } from '../../lib/fx.js';
  import { modsOf } from './mods.js';
  import { MARK_KEYS } from './commands-mods.js';
  import { commitFx } from './commands-fx.js';
  import { withInner } from './fx-edit.js';
  import { barSpan, currentSpan, runFor, signalOf, trackerOptions, tagItems, gridBlock, tracksRange } from './quickbar.js';
  import { cmd } from '../../app/cmd.js';
  import { shownTags } from '../../lib/content.js';
  import { TAG_CATEGORIES, ALIASES, sceneTags, actWords, needsWhere, partial, tagLabel, tagColor, suggestWhat, suggestWhere, TAG, isOffscreen } from './acts.js';
  import { trackingOf, noteUsage } from './deps.js';
  import { fillHint } from './commands-scenes.js';
  import { carryAcross } from './regions.js';
  import { groupsFor } from '../tracking/groups.svelte.js';
  import { sceneNo, shotLabel, sceneRange, sameTake, cutawayMode } from './shots.js';
  import { structure } from './commands-scenes.js';
  import { setScenes, scenesOf as scenesNow } from './state.svelte.js';
  import { confirmGroup } from '../tracking/groups.js';
  import { camOptionsFor } from '../tracking/DeriveStrip.svelte';
  import AxesLine from '../tracking/AxesLine.svelte';   // paw-2pcf: the shot's secondary axes
  import { fmtSpan } from '../../lib/time-format.js';

  let { app, bar = false, tagsOnly = false, section = 'all', current = false } = $props();
  /** Does this instance show part `name` ('scene' | 'shot' | 'tracker')? */
  const S = (name) => section === 'all' || section === name;
  // the Scenes tab (paw-ef73.1) keeps to timeline hygiene: no tracker, Stabilise or camera removal (Track / Refine)
  const scenesTab = $derived(app.mode === 'scenes');
  let el = $state(null), prev = null;
  const list = $derived(scenesOf(app));
  const span = $derived(bar || current ? currentSpan(list, selOf(), app.doc.range, app.player.timeMs, durOf(app)) : barSpan(list, selOf(), app.doc.range, durOf(app)));
  const shown = $derived(!!span);
  const tr = $derived(shown ? trackingOf(app) : null);
  const scene = $derived(span ? list[span.shot] : null);   // the shot the chips read: its scene's tags + its own view / camera
  const many = $derived(!!span && (span.shots.length > 1 || (() => { const r = sceneRange(list, span.shot); return r[1] > r[0]; })()));
  /** The chip's pressed state over the selection: every target has it (one shot: its tags). */
  const has = (id) => (span?.shots.length > 1 ? tagOnAll(list, span.shots, id) : tags.includes(id));
  /** What the view / camera chips hit: 'shot 2.3' or '3 shots'. */
  const shotWord = $derived(!span ? '' : span.shots.length > 1 ? `${span.shots.length} shots` : `shot ${shotLabel(list, span.shot)}`);
  const run = $derived(tr && span ? runFor(tr, span.shot) : null);
  const sig = $derived(run && span ? signalOf(tr, span.shot, run) : '');
  /** What the bar acts on, in words (shots.js selText): 'Scene 2', 'Scene 2 · shots 2.1 to 2.3', '3 shots in Scene 2', 'Scenes 2 to 4'. */
  const label = $derived(span?.text ?? '');
  /** What Track acts on, in words (paw-yt8q: an I-O range you set with nothing selected is tracked as it is). */
  const trackWhat = $derived(tracksRange(span, app.doc.range, selOf()) ? 'the I-O range' : label.toLowerCase());
  const tags = $derived(scene ? sceneTags(scene) : []);
  const words = $derived(scene ? actWords(scene) : { aliases: [], whats: [] });
  const pick = $derived(!!scene && needsWhere(scene));
  const sugWhat = $derived(scene ? suggestWhat(scene, list) : []);
  const sugWhere = $derived(scene ? suggestWhere(scene, list)[0] ?? null : null);   // the where chips are always there: the best one is dashed
  const [VIEW, WHERES] = TAG_CATEGORIES.map((c) => c.tags), CAM = TAG_CATEGORIES.find((c) => c.id === 'camera').tags, ANGLE = TAG_CATEGORIES.find((c) => c.id === 'angle').tags, STRUCT = TAG_CATEGORIES.find((c) => c.id === 'structure').tags;
  const WHERE = $derived(shownTags(WHERES, has));   // paw-43vn: furry items off offers no slit / sheath (one the scene has stays)
  /** The what an alias chip's span menu moves (rimming -> licking). */
  const whatOf = (w) => ALIASES[w].find((p) => TAG[p].cat === 'what');

  // the tracker list (a sidecar start) only once a scene is really picked, or the pointer comes to the bar
  const listNow = () => untrack(() => trackingOf(app)?.ensureListed?.());
  $effect(() => { if (el && shown && !tagsOnly && span.live !== false) listNow(); });

  const note = (what) => noteUsage(app, 'quickbar.' + what);
  /** Hand keyboard focus back to the lane that had it (the Select refocuses its own button on a pick). */
  const back = () => setTimeout(() => { if (el?.contains(document.activeElement)) (prev?.isConnected ? prev : el.parentElement)?.focus({ preventScroll: true }); });
  // paw-yt8q: Track / Track ROI are T / Ctrl+T: the commands work on the bar's span (the scene at the playhead becomes the range;
  // a set of shots: exactly those, paw-k2u)
  function tag(id) {
    note('tag');
    toggleTagOnShots(app, span.shots.length > 1 ? span.shots : [span.shot], id);   // scene tags: every scene with a selected shot; view / camera: every selected shot
  }
  function suggested(id) {
    note('suggest');
    toggleTagOnShots(app, span.shots.length > 1 ? span.shots : [span.shot], id);
  }
  function whatMenu(e) {
    note('what');
    const i = span.shot;
    showContextMenu(e.currentTarget, tagItems(scene, (id) => (id ? toggleSceneTag(app, i, id) : setSceneTags(app, i, null)), ['what']), { source: e.currentTarget });
  }
  /** Right-click on a tag chip: its span inside the scene (the timeline.scene.tagStart / tagEnd / tagWhole commands). */
  function chipMenu(e, id) {
    e.preventDefault();
    tl.sceneTag = id;
    const run = (c) => app.commands.run(`timeline.scene.${c}`);
    showContextMenu(e, [{ section: tagLabel(id) },
      { label: 'Starts at the playhead', run: () => run('tagStart') }, { label: 'Ends at the playhead', run: () => run('tagEnd') },
      { label: 'Whole scene', disabled: !partial(scene, id), run: () => run('tagWhole') },
      { separator: true }, { label: 'Remove', run: () => tag(id) }], { source: e.currentTarget });
  }

  /** paw-b26: a bridged shot with tracked motion (a run) suggests the timing option */
  const suggests = (ks) => !!tr && ks.some((k) => isOffscreen(list[k]) && tr.deriveRun(k));
  const fillsOver = (ks) => (tr && ks.length ? tr.fills?.find((f) => ks.some((k) => f.lo <= k && f.hi >= k)) ?? null : null);
  const CARD_HINT = { offscreen: 'not tracked · bridged', carried: 'not tracked · the action continues (bridged)', intermission: 'not tracked · an intermission: nothing carried' };
  /** Shot section: the cut-kind toggle (selected shots with a cut before them inside their scene), groups to confirm. */
  const takeable = $derived(!!span && span.shots.some((k) => list[k]?.join === true));
  const takeOn = $derived(!!span && span.shots.filter((k) => list[k]?.join === true).every((k) => sameTake(list[k])));
  const unconf = $derived(!span ? 0 : span.shots.reduce((n, k) => n + (list[k]?.groups || []).filter((g) => g.unconfirmed && g.t_ms >= list[k].start_ms && g.t_ms < list[k].end_ms).length, 0));
  function acceptRefound() {
    note('acceptRefound');
    const l = scenesNow(app), inSel = (g) => span.shots.some((k) => g.t_ms >= l[k].start_ms && g.t_ms < l[k].end_ms);
    const r = l.map((s) => (s.groups?.some((g) => g.unconfirmed && inSel(g)) ? { ...s, groups: s.groups.map((g) => (g.unconfirmed && inSel(g) ? confirmGroup(g) : g)) } : s));
    app.transact('Accept re-found groups', () => setScenes(app, r));
    app.usage?.note?.('tracking:groupsAccept', { chip: true, n: unconf });
  }
  /** Shot section, paw-t8z: the shot's camera removal (mode + strength), a mirror of Runs > Adjust (the same setDerive,
   *  the same reach), while the shot has a run to adjust and needs no re-track. */
  const camI = $derived(span && tr?.deriveRun?.(span.shot) && !tr.deriveBlockFor(span.shot) ? span.shot : -1);
  const cam = $derived(camI < 0 ? null : tr.camState(camI).cam);   // paw-hiq5: Adjust's choice, else the camera tag's default
  const camOpts = $derived(camI < 0 ? [] : camOptionsFor(tr.deriveBlockFor(camI, true)));
  const camPut = (patch, label, commit = true) => tr.setDerive(camI, patch, { commit, scope: tr.deriveScope, label });
  function camStrength(v, commit) { tr.camPeek = !commit; camPut({ cam: { mode: cam.mode, strength: v } }, 'Camera removal strength', commit); }
  const offerText = (o) => [o.tags?.length ? o.tags.map((q) => tagLabel(String(q?.id ?? q).replace(/^-/, ''))).join(' + ') : '', o.groups?.length ? `${o.groups.length} group${o.groups.length > 1 ? 's' : ''}` : '', o.fill ? `fill ${o.fill}` : ''].filter(Boolean).join(', ') || 'settings';
  /** The modifiers over the scene (or the span the bar shows), in time order. */
  const modSpans = $derived(span ? modsOf(app.doc.fx).filter((e) => e.t0 < span.t1 && e.t1 > span.t0) : []);
  const fxColor = (k) => FX_KINDS[k]?.color;
  const spanTip = (id) => (partial(scene, id) ? ' · part of the scene (right-click: its span)' : ' · right-click: start / end at the playhead');
</script>

<!-- paw-2lp7.4: marked shots ks (off-screen / cutaway: the view chips): what they do, the bridge's timing option, the action
     carried across one no action covers, Bake, the hint -->
{#snippet cutRow(ks)}
  {@const ms = ks.map((k) => cutawayMode(list, k)).filter(Boolean)}
  {@const now = fillsOver(ks)}
  {@const sug = suggests(ks)}
  {@const tm = ks.every((k) => !cutawayMode(list, k) || list[k].fill === 'timing')}
  {@const ext = ks.length === 1 && !!carryAcross(app.doc.acts, list, ks[0])}
  {@const br = tr?.bridges?.find((b) => b.script.length && ks.some((k) => b.t0 < list[k].end_ms && b.t1 > list[k].start_ms))}
  <span class="k-sep"></span>
  <span class="k-hint">{ms.every((m) => m === ms[0]) ? CARD_HINT[ms[0]] : 'not tracked'}</span>
  {#if !ms.includes('intermission')}
    <Button size="sm" variant={sug && !tm ? 'default' : 'ghost'} pressed={tm} onclick={() => { note('cutawayTrack'); structure.timing(app, ks); back(); }}
      tip={'Bridge timing from this shot\'s own motion' + (sug ? ' (suggested)' : '')}>timing from this shot</Button>
  {/if}
  {#if ext}<Button size="sm" variant="ghost" onclick={() => { note('carryAcross'); const r = carryAcross(app.doc.acts, list, ks[0]); if (r) app.transact('Carry the action across', () => { app.doc.acts = r; }); back(); }}
    tip="Carry the neighboring action across this shot">carry the action across</Button>{/if}
  {#if br && ks.some((k) => tr.bakeState(k).state === 'live')}<Button size="sm" variant="ghost" {...cmd(app, 'tracking.bake', { shots: ks }, { tip: 'Make the live bridge permanent', before: () => { note('fillBake'); back(); } })}>Bake</Button>{/if}
  {#if now?.need}<span class="k-hint fillwarn" role="status">{fillHint(now)}</span>{/if}
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- in the lane toolbar a group (its buttons join that toolbar's arrow keys), elsewhere its own toolbar -->
<div bind:this={el} class="qb" class:bar role={bar ? 'group' : 'toolbar'} aria-label="Scene quick controls" tabindex="-1"
  onmousedown={(e) => e.preventDefault()} onfocusin={(e) => { if (e.relatedTarget && !el.contains(e.relatedTarget)) prev = e.relatedTarget; }}
  onpointerenter={() => shown && !tagsOnly && listNow()} onkeyup={(e) => e.key === 'Escape' && back()}>
  {#if bar && shown && section === 'all'}<span class="which k-num" {@attach tooltip(span.live ? 'What the chips and Track act on' : `${tl.shots.length ? 'The selection' : 'The scene at the playhead'}: ${tracksRange(span, app.doc.range, selOf()) ? 'Track takes the I-O range as it is' : 'Track sets the range to it'}`)}>{label}</span>{/if}
  {#if shown && tr && !tagsOnly && !scenesTab && S('tracker')}
    <Select size="sm" label="Tracker" placeholder={tr.listed ? 'Tracker' : 'Trackers…'} options={trackerOptions(tr.trackers, (t) => tr.gpuOff?.(t))} value={tr.trackerId}
      disabled={!!tr.busy} onchange={(v) => { tr.selectTracker(v); note('tracker'); back(); }} />
    <Button size="sm" variant="primary" icon="grid" {...cmd(app, 'track.gridFrame', undefined, { tip: gridBlock(tr) || `Track ${trackWhat}: a point grid over the frame`, before: () => note('grid') })}
      loading={tr.busy === 'track' || tr.queued === 'grid'}>Track</Button>
    <Button size="sm" icon="crosshair" {...cmd(app, 'track.run', undefined, { tip: `Track ROI ${trackWhat}: one painted part (several painted: pick one)`, before: () => note('track') })}>Track ROI</Button>
    <span class="k-sep"></span>
    <span class="sig k-hint" {@attach tooltip(run ? `Lane signal of ${run.name}` : 'No run for this scene yet')}>signal <b class="k-num">{sig || '–'}</b></span>
    {#if tr.busyRange && tr.busyRange.t0 < span.t1 && tr.busyRange.t1 > span.t0}<span class="sig k-hint num" aria-live="polite">{tr.progressLabel}</span>{/if}
    {#if section === 'tracker'}
      <span class="k-sep"></span>
      {#if tr.busy === 'track'}<Button size="sm" variant="ghost" icon="stop" {...cmd(app, 'track.cancel', undefined, { tip: 'Stop the running track', before: () => note('cancel') })}>Cancel</Button>{/if}
      <Button size="sm" variant="ghost" icon="brush" disabled={!app.doc.media || app.mode !== 'track'} onclick={() => { note('groups'); groupsFor(app).toggle(); }} tip="Paint the parts the tracker pins (Tab)">Groups</Button>
      <Button size="sm" variant="ghost" icon="sliders" onclick={() => { note('panel'); app.showPanel?.('tracking'); }} tip="Every tracker setting and the runs">Tracker panel</Button>
    {/if}
  {/if}
  {#if shown && tr && S('scene')}
    {#each WHERE as t (t.id)}
      <Button size="sm" variant={pick ? 'default' : 'ghost'} class={sugWhere?.id === t.id ? 'suggest' : ''} pressed={has(t.id)} onclick={() => (sugWhere?.id === t.id ? suggested(t.id) : tag(t.id))} oncontextmenu={(e) => tags.includes(t.id) && chipMenu(e, t.id)} onpointerenter={() => (tl.sceneTag = t.id)}
        tip={(pick ? `Pick where: ${tags.filter((x) => TAG[x].needsWhere).map(tagLabel).join(', ')} needs one` : `Where: ${t.label} (the receiving part; several allowed)`) + (sugWhere?.id === t.id ? ` · suggested (${sugWhere.why})` : '')}>{t.label}</Button>
    {/each}
    {#if pick}<span class="k-hint">pick where</span>{/if}
    <span class="k-sep"></span>
    {#each words.aliases as w (w)}
      <Button size="sm" variant="ghost" pressed onclick={() => tag(w)} oncontextmenu={(e) => chipMenu(e, whatOf(w))} onpointerenter={() => (tl.sceneTag = whatOf(w))}
        tip={`${w} = ${ALIASES[w].join(' + ')} (click to remove)${spanTip(whatOf(w))}`}><i class="dot" style:background={tagColor(whatOf(w))}></i>{w}</Button>
    {/each}
    {#each words.whats as id (id)}
      <Button size="sm" variant="ghost" pressed onclick={() => tag(id)} oncontextmenu={(e) => chipMenu(e, id)} onpointerenter={() => (tl.sceneTag = id)}
        tip={`What: ${tagLabel(id)} (click to remove)${spanTip(id)}`}><i class="dot" style:background={tagColor(id)}></i>{tagLabel(id)}</Button>
    {/each}
    {#each sugWhat as g (g.id)}
      <Button size="sm" variant="ghost" class="suggest" onclick={() => suggested(g.id)} tip={`Suggested: ${tagLabel(g.id)} (${g.why}), click to add`}><i class="dot" style:background={tagColor(g.id)}></i>{tagLabel(g.id)}?</Button>
    {/each}
    <Button size="sm" variant="ghost" icon="plus" onclick={whatMenu} tip="What is happening (several allowed)" aria-haspopup="menu">What</Button>
    <span class="k-sep"></span>
    <!-- the modifier chips (paw-ef73.20, paw-8b4h): one per event kind, a modifier over the scenes (commands-mods toggleModCmd) -->
    {#each EVENT_KINDS as k (k)}
      <Button size="sm" variant="ghost" data-mod={k} pressed={modSpans.some((m) => m.kind === k)} data-command={`timeline.mod.toggle.${k}`} onclick={() => { note('mod'); app.commands.run(`timeline.mod.toggle.${k}`); }}
        tip={`${FX_KINDS[k].tip}\nClick: over the scene or range, again: off${MARK_KEYS[k] ? `\n${MARK_KEYS[k]}: in at the playhead, again: out` : ''}`}><i class="dot" style:background={fxColor(k)}></i>{FX_KINDS[k].label.toLowerCase()}</Button>
    {/each}
    {#if modSpans.length}
      <span class="mods" role="list" aria-label="Modifiers over the scene">
        {#each modSpans as m (m.id)}
          <span class="modspan" class:on={tl.fx === m.id || tl.fxSel.includes(m.id)} role="listitem">
            <button type="button" onclick={() => { note('modPick'); tl.fx = m.id; tl.fxSel = []; app.player.seek(m.t0); }} {@attach tooltip(`${FX_KINDS[m.kind].label} ${fmtSpan(m.t0, m.t1)}: select it on the Modifiers row and go there`)}><i class="dot" style:background={fxColor(m.kind)}></i>{fmtSpan(m.t0, m.t1)}</button>
            <button type="button" class="x" aria-label="Delete this {FX_KINDS[m.kind].label}" onclick={() => { note('modRemove'); const all = app.doc.fx || [], gone = withInner(all, [m.id]); commitFx(app, `Delete ${FX_KINDS[m.kind].label}`, all.filter((e) => !gone.includes(e.id))); }}>×</button>
          </span>
        {/each}
      </span>
    {/if}
    {#if tags.includes('offscreen')}<span class="k-hint">not tracked · bridged</span>{/if}
    {#if tags.includes('blank')}<span class="k-hint">not tracked · holds</span>{/if}
    <span class="k-sep"></span>
    {#each STRUCT as t (t.id)}
      <Button size="sm" variant="ghost" pressed={has(t.id)} onclick={() => tag(t.id)} tip={t.tip}><i class="dot" style:background={tagColor(t.id)}></i>{t.label}</Button>
    {/each}
    {#if STRUCT.some((t) => tags.includes(t.id))}<span class="k-hint">not tracked · generated</span>{/if}
    {#if section === 'scene'}
      {#each scene?.offers || [] as o, k (k)}
        <span class="k-sep"></span>
        <span class="k-hint">Offered by a merge: {offerText(o)}</span>
        <Button size="sm" variant="ghost" onclick={() => { note('offerAccept'); structure.offer(app, span.shot, k, true); }} tip="Take its tags, groups and fill">Accept</Button>
        <Button size="sm" variant="ghost" onclick={() => { note('offerDrop'); structure.offer(app, span.shot, k, false); }} tip="Forget it (undo brings it back)">Drop</Button>
      {/each}
      <span class="k-sep"></span>
      <!-- paw-2lp7.5: scenes are action regions now: these act on the region at the playhead -->
      <Button size="sm" variant="ghost" {...cmd(app, 'timeline.scene.split', undefined, { tip: 'Split the action region at the playhead', before: () => note('newScene') })}>Split action here</Button>
      <Button size="sm" variant="ghost" {...cmd(app, 'timeline.scene.mergePrev', undefined, { tip: 'Merge with the action region before, if the same', before: () => note('mergeScenePrev') })}>Merge action ←</Button>
      <Button size="sm" variant="ghost" {...cmd(app, 'timeline.scene.merge', undefined, { tip: 'Merge with the action region after', before: () => note('mergeSceneNext') })}>Merge action →</Button>
    {/if}
  {/if}
  {#if shown && tr && S('shot')}
    <!-- the shot's own chips: its view and its camera; the cut before it; Stabilise; groups to confirm -->
    {#if many && section === 'all'}<span class="k-sep"></span><span class="k-hint num" {@attach tooltip('View and camera act on the selected shots')}>{shotWord}</span>{/if}
    {#each VIEW as t (t.id)}
      <Button size="sm" variant="ghost" pressed={has(t.id)} onclick={() => tag(t.id)} tip={t.tip + (many ? ` · ${shotWord}` : '')}>{t.label}</Button>
    {/each}
    <span class="k-sep"></span>
    {#each CAM as t (t.id)}
      <Button size="sm" variant="ghost" pressed={has(t.id)} onclick={() => tag(t.id)} tip={t.tip + (scene.split === 'camera' ? ' · a camera move before this shot, not a cut: tracked through' : '') + (many ? ` · ${shotWord}` : '')}>{t.label}</Button>
    {/each}
    <span class="k-sep"></span>
    {#each ANGLE as t (t.id)}
      <Button size="sm" variant="ghost" pressed={has(t.id)} onclick={() => tag(t.id)} tip={t.tip + (many ? ` · ${shotWord}` : '')}>{t.label}</Button>
    {/each}
    {#if !tagsOnly && !scenesTab}<span class="k-sep"></span><AxesLine {app} {tr} shot={span.shot} />{/if}
    {#if !tagsOnly && span.shots.some((k) => cutawayMode(list, k))}{@render cutRow(span.shots)}{/if}
    {#if section === 'shot'}
      <span class="k-sep"></span>
      {#if takeable}<Button size="sm" variant="ghost" pressed={takeOn} onclick={() => { note('take'); structure.takeSelected(app, span.shots); }} tip="Camera move before this shot, tracked through">Camera move before</Button>{/if}
      <Button size="sm" variant="ghost" {...cmd(app, 'timeline.shot.split', undefined, { tip: 'Cut the shot at the playhead', before: () => note('cut') })}>Cut here</Button>
      <Button size="sm" variant="ghost" {...cmd(app, 'timeline.shot.mergePrev', undefined, { tip: 'Merge with the shot before', before: () => note('mergeShotPrev') })}>Merge ←</Button>
      <Button size="sm" variant="ghost" {...cmd(app, 'timeline.shot.merge', undefined, { tip: 'Merge with the shot after', before: () => note('mergeShotNext') })}>Merge →</Button>
      {#if !scenesTab}
      <span class="k-sep"></span>
      <Button size="sm" variant="ghost" {...cmd(app, 'track.stabilise', undefined, { tip: 'Play with the camera motion removed', before: () => { note('stabilise'); back(); } })}>Stabilize</Button>
      {#if cam}
        <span class="k-sep"></span>
        <span class="k-hint" {@attach tooltip(`Camera removal of shot ${shotLabel(list, camI)}, as in the shot's Adjust under the stroke lane (reach: ${tr.deriveScope}); the ghost follows live, no re-track`)}>Camera removal</span>
        <SegmentedControl size="sm" label="Camera removal" options={camOpts} value={cam.mode} onchange={(v) => { note('camMode'); camPut({ cam: { mode: v } }, 'Camera mode'); }} />
        <Slider size="sm" label="Camera removal strength" min={0} max={100} step={5} value={cam.strength} disabled={cam.mode === 'off'} showValue format={(v) => v + ' %'}
          onchange={(v) => camStrength(v, false)} oncommit={(v) => { note('camStrength'); camStrength(v, true); }} />
      {/if}
      {#if tr.sceneLink?.(span.shot)}<Button size="sm" variant="ghost" icon="sliders" onclick={() => { note('adjust'); if (app.mode !== 'track') app.setMode('track'); tr.bandOpen = true; }} tip="This shot's camera, axis and strokes, under the lane">Adjust</Button>{/if}
      {#if unconf}<Button size="sm" variant="ghost" icon="check" onclick={acceptRefound} tip="Keep the groups found again after the cut">Accept {unconf} re-found group{unconf > 1 ? 's' : ''}</Button>{/if}
      {/if}
    {/if}
  {/if}
</div>

<style>
  .qb { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); min-width: 0; padding: 0 var(--space-4); }
  .qb.bar { padding: 0; gap: var(--space-1); }
  .which { font-size: var(--fs-1); color: var(--tx-mut); padding: 0 var(--space-2) 0 var(--space-1); white-space: nowrap; }
  /* a suggestion: dashed and lighter until it is picked */
  .qb :global(.suggest:not([aria-pressed='true'])) { border: var(--bw) dashed var(--line-3, var(--line-2)); opacity: .75; }
  .qb :global(.suggest:not([aria-pressed='true']):hover) { opacity: 1; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: var(--radius); margin-right: var(--space-2); vertical-align: middle; }
  .sig { white-space: nowrap; }
  .fillwarn { color: var(--warn, var(--tx-val)); }
  .mods { display: inline-flex; flex-wrap: wrap; gap: var(--space-1); }
  .modspan { display: inline-flex; align-items: center; border: var(--bw) solid var(--line-2); border-radius: var(--radius); font-size: var(--fs-1); }
  .modspan.on { border-color: var(--sel-line); }
  .modspan button { font: inherit; color: var(--tx-val); background: none; border: 0; padding: 0 var(--space-2); height: var(--ctl-h-sm, 22px); cursor: pointer; }
  .modspan button:hover { color: var(--tx-hi); }
  .modspan .x { padding: 0 var(--space-1); color: var(--tx-mut); }
  .sig b { color: var(--tx-val); font-weight: var(--num-wght, 500); }
</style>
