<script>
  // The Actions panel (left dock, the Scenes tab's own; paw-2lp7.5: it was the Scenes panel; the owner: "the idea being you set up
  // your scenes completely before tracking with little need to go back and adjust"): Detect / Describe all with the running
  // job's progress; "Accept N proposals" while the strip shows dashed ones; the recent actions (the 1-9 keys) as numbered chips;
  // then one row per action region in time order (its colour, words, layer, time, shots covered, tracked coverage) and one row
  // per gap ("no action · 0:42–0:51"). A row selects its region (or a gap's shots) and brings the timeline to it, a region
  // selected on the strip opens its row; the open row has the region's tag chips (RegionChips) and its shots, one line each
  // (number, time, cut / camera move, camera glyph, view, status; click = that shot), and the current shot's Describe and boxes.
  // Scene options (cut_*, loop incl. loop_min_confidence, describe) in one closed group at the bottom. State: trackingFor(app).
  import Icon from '../../ui/kit/Icon.svelte';
  import { taggerShown } from '../../lib/content.js';
  import Button from '../../ui/kit/Button.svelte';
  import { cmd } from '../../app/cmd.js';
  import Section from '../../ui/kit/Section.svelte';
  import ParamForm from '../../ui/kit/ParamForm.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { paramSchema } from '../../lib/protocol.js';
  import { fmtSpanTime, fmtDuration } from '../../lib/time-format.js';
  import { runForScene } from '../../lib/runs.js';
  import { tl, scenesOf, durOf, sceneSelected, selOf } from '../timeline/state.svelte.js';
  import { sceneTags, sceneCamera, tagLabel, tagColor, TAG } from '../timeline/acts.js';
  import { shotLabel, sameTake, selShot, selExtend, selToggle } from '../timeline/shots.js';
  import { applySel } from '../timeline/commands-scenes.js';
  import { sceneStatus } from '../timeline/scenes.js';
  import { kindOf } from '../timeline/kinds.js';
  import { gapsOf, regionWords } from '../timeline/regions.js';
  import { regionKind } from '../timeline/actions-strip.js';
  import { selectAct, acceptAllActs, mruOf, shotsUnder } from '../timeline/acts-edit.js';
  import { acts as actCmds } from '../timeline/commands-acts.js';
  import RegionChips from '../timeline/RegionChips.svelte';
  import { trackingFor } from './tracking.svelte.js';

  let { app } = $props();
  // svelte-ignore state_referenced_locally
  const tr = trackingFor(app);   // app never changes for a mounted panel
  tr.ensureListed();

  const list = $derived(scenesOf(app));
  const key = (id) => app.commands.keysFor(id)?.[0] || '';
  const short = fmtSpanTime;   // a span's end, m:ss.d
  const pct = (x) => Math.round(x * 100) + ' %';
  const cur = $derived(tr.currentScene);
  // the running job: a bar and '43 % · 1:20 left · 0:12' (a hung describe must be visible)
  const working = $derived(['scenes', 'describe', 'loop'].includes(tr.busy));
  const frac = $derived(tr.progress.total ? tr.progress.done / tr.progress.total : null);
  let now = $state(Date.now());
  $effect(() => { if (!tr.startedAt) return; now = Date.now(); const iv = setInterval(() => (now = Date.now()), 1000); return () => clearInterval(iv); });
  const elapsed = $derived(tr.startedAt ? Math.max(0, Math.round((now - tr.startedAt) / 1000)) : 0);
  const mmss = (s) => fmtDuration(s * 1000);
  const BUSY = { scenes: 'Detecting shots', describe: 'Describing', loop: 'Looking for a loop' };

  const acts = $derived(app.doc.acts || []);
  const proposals = $derived(acts.filter((r) => r.auto).length);
  const mru = $derived(mruOf(app));
  /** The regions and the gaps, in time order (a region before the ones above it). */
  const rows = $derived([
    ...acts.map((r) => ({ r, t0: r.t0, t1: r.t1, k: r.kind === 'positioning' ? 0.5 : r.layer, shots: shotsUnder(app, r), st: sceneStatus({ start_ms: r.t0, end_ms: r.t1 }, app.script, null) })),
    ...(list.length ? gapsOf(acts, durOf(app), 50).map((g) => ({ gap: true, t0: g.t0, t1: g.t1, k: 0 })) : []),
  ].sort((a, b) => a.t0 - b.t0 || a.k - b.k));
  // the open row: the selected region, kept open while one of its shots is picked
  let openId = $state(null), listEl = $state(null);
  $effect(() => { if (tl.act) openId = tl.act; });
  $effect(() => { const id = tl.act; if (id && listEl) listEl.querySelector(`[data-act="${id}"]`)?.scrollIntoView?.({ block: 'nearest' }); });
  const where = (r) => (r.kind === 'positioning' ? 'eased, out of range' :r.layer ? `layer ${r.layer}${r.kind === 'act' ? ` · ${r.mix ?? 'mix'}` : ''}` : '');
  /** Per shot: its view chip, camera, run status. */
  const shotRow = (i) => {
    const s = list[i], view = sceneTags(s).find((t) => TAG[t].cat === 'view') ?? null;
    return { s, i, view, cam: sceneCamera(s), st: sceneStatus(s, app.doc.axes[app.doc.activeAxis] || [], tr.ghost(runForScene(s, tr.links, tr.ghosts))), take: sameTake(s) };
  };
  const STATUS_TIP = { none: 'Not tracked yet (the active axis has no points over half of it)', accepted: 'Baked: the active axis has permanent points over it', ghost: 'A tracker run covers it: it plays live (Bake makes it permanent)' };
  const STATUS_WORD = { none: 'not tracked', accepted: 'baked', ghost: 'live' };   // paw-x7w7: the words; the state ids stay
  /** A gap: its shots selected (N or 1-9 then put an action over them), the playhead to its start. */
  function pickGap(g) {
    const sh = list.flatMap((s, i) => (Math.min(s.end_ms, g.t1) - Math.max(s.start_ms, g.t0) > (s.end_ms - s.start_ms) / 2 ? [i] : []));
    selectAct(app, null);
    openId = null;
    if (sh.length) applySel(app, { active: sh[0], shots: sh }, 'panel-gap');
    else app.player.seek(g.t0);
  }
  /** A shot line: like a click on the Shots strip (Shift = the run from the active shot, Ctrl = in / out). */
  function pickShot(i, e) {
    tl.act = null;
    if (e?.shiftKey) return applySel(app, selExtend(list, selOf(), i), 'panel-shift', { seek: false });
    if (e?.ctrlKey || e?.metaKey) return applySel(app, selToggle(list, selOf(), i), 'panel-ctrl', { seek: false });
    applySel(app, selShot(i), 'panel-shot');
  }
  const detailShot = (sh) => (sh.includes(cur) ? cur : sh[0]);
</script>

{#snippet opts(title, schema, vals)}
  {#if schema?.length}
    <p class="k-caps sub">{title}</p>
    <ParamForm schema={paramSchema(schema)} values={vals} onchange={(v) => Object.assign(vals, v)} />
  {/if}
{/snippet}

<div class="scp k-scroll">
  <section class="top">
    <div class="acts">
      <Button size="sm" grow {...cmd(app, 'track.detectScenes', undefined, { tip: tr.listed ? 'Find the cuts (replaces the shots)' : 'The tracker is not available' })}>Detect</Button>
      <Button size="sm" grow {...cmd(app, 'track.describeAll', undefined, { tip: tr.describeParams ? 'Describe every shot: tags and boxes' : tr.listed ? 'Describe is not installed' : 'The tracker is not available' })}>Describe all</Button>
    </div>
    {#if working}
      <div class="bar" role="progressbar" aria-valuenow={frac == null ? undefined : Math.round(frac * 100)} aria-valuemin="0" aria-valuemax="100"><i style:width={(frac ?? 0) * 100 + '%'}></i></div>
      <p class="k-hint num">{BUSY[tr.busy]}{tr.batch ? ` shot ${Math.min(tr.batch.done + 1, tr.batch.total)} of ${tr.batch.total}` : tr.busyScene >= 0 && tr.busy !== 'scenes' ? ` shot ${tr.busyScene + 1}` : ''} · {tr.progressLabel} · {mmss(elapsed)} ({key('track.cancel') || 'Esc'} stops)</p>
    {/if}
    {#if tr.listed && !tr.describeParams}<p class="k-hint">Describe is not installed (needs the describe extra and a CUDA GPU).</p>{/if}
    {#if proposals}
      <Button size="sm" variant="primary" icon="check" onclick={() => acceptAllActs(app)} tip="Accept every proposed action region">Accept {proposals} proposal{proposals === 1 ? '' : 's'}</Button>
    {/if}
    {#if mru.length}
      <div class="mru" role="group" aria-label="Recent actions">
        {#each mru as t, k (k)}
          <button type="button" class="m" onclick={() => actCmds.mru(app, k + 1)} {@attach tooltip(`${regionWords({ kind: 'act', tags: t })} on the selection`, String(k + 1))}>
            <b class="num">{k + 1}</b><i style:background={regionKind({ kind: 'act', tags: t }) ? kindOf(regionKind({ kind: 'act', tags: t })).color : 'var(--tx-ghost)'}></i>{regionWords({ kind: 'act', tags: t })}
          </button>
        {/each}
      </div>
    {/if}
  </section>

  <div class="list" bind:this={listEl}>
    {#each rows as row (row.gap ? `g${row.t0}` : row.r.id)}
      {#if row.gap}
        <button type="button" class="gap num" onclick={() => pickGap(row)} {@attach tooltip(`No action here, click to select its shots (${key('timeline.acts.new') || 'N'} or 1–9 tag them)`)}>no action · {short(row.t0)}–{short(row.t1)}</button>
      {:else}
        {@const r = row.r}
        {@const open = openId === r.id}
        {@const kid = regionKind(r)}
        <div class="act" class:sel={tl.act === r.id} class:open class:layered={r.layer > 0 || r.kind === 'positioning'} class:prop={r.auto} data-act={r.id}>
          <button class="head" onclick={() => { selectAct(app, r, { seek: true }); openId = r.id; }} aria-expanded={open} aria-label="Action {regionWords(r)}">
            <span class="l1">
              <i class="sw" class:hatch={r.kind === 'positioning'} style:background={kid ? kindOf(kid).color : null}></i>
              <b class="w" class:untagged={r.kind === 'act' && !r.tags.length}>{regionWords(r)}{r.auto ? '?' : ''}</b>
              {#if where(r)}<span class="k-hint d">{where(r)}</span>{/if}
              <span class="st st-{row.st.state} num" {@attach tooltip(STATUS_TIP[row.st.state])}>{STATUS_WORD[row.st.state]} {pct(row.st.cover)}</span>
            </span>
            <span class="l2 num k-hint">{short(r.t0)}–{short(r.t1)} · {row.shots.length} shot{row.shots.length === 1 ? '' : 's'}{row.shots.length ? ` (${shotLabel(list, row.shots[0])}${row.shots.length > 1 ? `–${shotLabel(list, row.shots.at(-1))}` : ''})` : ''}{r.auto ? ' · proposed' : ''}</span>
          </button>
          {#if open}
            {@const d = detailShot(row.shots)}
            {@const ds = list[d]}
            {@const inf = tr.sceneInfo[d] || {}}
            <div class="body">
              <RegionChips {app} id={r.id} compact />
              {#if row.shots.length}
                <div class="shots">
                  {#each row.shots.map(shotRow) as sh (sh.s.start_ms)}
                    <button class="shot" class:on={sceneSelected(sh.i)} class:act={tl.scene === sh.i && sceneSelected(sh.i)} class:cur={sh.i === d} onclick={(e) => pickShot(sh.i, e)} aria-label="Shot {shotLabel(list, sh.i)}">
                      <b class="num">{shotLabel(list, sh.i)}</b>
                      <span class="num t">{short(sh.s.start_ms)}–{short(sh.s.end_ms)}</span>
                      {#if sh.i > 0}<span class="k-hint d" {@attach tooltip(sh.take ? 'Camera move before it, tracked through' : 'Cut before it, reseeded')}>{sh.take ? 'camera move' : 'cut'}</span>{/if}
                      {#if sh.cam && TAG[sh.cam].icon}<svg class="cam" viewBox="0 0 16 16" width="12" height="12" role="img" aria-label="camera: {tagLabel(sh.cam)}" {@attach tooltip(`Camera: ${tagLabel(sh.cam)}`)}><path d={TAG[sh.cam].icon} /></svg>{/if}
                      {#if sh.view}<span class="chip"><i style:background={tagColor(sh.view)}></i>{tagLabel(sh.view)}</span>{/if}
                      {#if tr.sceneInfo[sh.i]?.error}<span class="k-hint err" {@attach tooltip(tr.sceneInfo[sh.i].error)}>error</span>{/if}
                      <span class="st st-{sh.st.state} num">{sh.st.state === 'none' ? 'none' : STATUS_WORD[sh.st.state]}{sh.st.state !== 'none' ? ' ' + pct(sh.st.cover) : ''}</span>
                    </button>
                  {/each}
                </div>
              {/if}
              {#if inf.error}<p class="err-line" {@attach tooltip(inf.error)}><Icon name="error" size={14} /><span class="grow ell2">{inf.error}</span></p>{/if}
              {#if ds}
                <div class="row">
                  <span class="k-hint num">shot {shotLabel(list, d)}</span>
                  {#if inf.busy}<span class="k-hint num">{inf.busy === 'describe' ? 'describing' : 'looping'}{tr.busy === inf.busy && tr.busyScene === d ? '' : ' · queued'}</span>{/if}
                  {#if tr.describeParams}<Button size="sm" variant="ghost" onclick={() => tr.describeScene(d)} disabled={inf.busy === 'describe'} tip={tr.locked ? 'Queued after the running job' : 'Tags and boxes for this shot'}>{ds.describe ? 'Describe again' : 'Describe'}</Button>{/if}
                </div>
                {#if app.settings.get('content.taggerTags') !== false && ds.describe?.tags?.some((t) => t.box && taggerShown(t.tag))}
                  <div class="tags">
                    {#each ds.describe.tags.filter((t) => t.box && taggerShown(t.tag)).slice(0, 8) as tg (tg.tag)}
                      <span class="tag">
                        <span>{tg.tag} <i class="num">{tg.score.toFixed(2)}</i></span>
                        <Button size="sm" variant="ghost" pressed={!!tr.shownBoxes[d + ':' + tg.tag]} onclick={() => tr.toggleBox(d, tg.tag)} tip="Draw this box on the video">Show</Button>                      </span>
                    {/each}
                  </div>
                {/if}
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    {:else}
      <p class="k-hint empty">Detect the shots, then mark what happens: drag on the Actions strip, or select shots and press {key('timeline.acts.new') || 'N'} (1–9: a recent action).</p>
    {/each}
  </div>

  <Section title="Shot options" open={false} class="opts">
    {@render opts('Shot detection', tr.sceneParams, tr.sceneVals)}
    {@render opts('Loop (also sent with Track: loop_fold auto)', tr.loopParams, tr.loopVals)}
    {@render opts('Describe', tr.describeParams, tr.describeVals)}
    {#if !tr.sceneParams.length && !tr.loopParams.length && !tr.describeParams}<p class="k-hint">{tr.listed ? 'No options.' : 'The tracker sidecar is not listed yet.'}</p>{/if}
  </Section>
</div>

<style>
  .scp { height: 100%; overflow-y: auto; display: flex; flex-direction: column; font-size: var(--fs-2); }
  section.top { display: grid; gap: var(--space-3); padding: var(--space-5); border-bottom: 1px solid var(--line-1); }
  .acts, .row { display: flex; gap: var(--space-3); align-items: center; }
  .grow { flex: 1; min-width: 0; }
  .num { font-family: var(--mono); font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
  .bar { height: 2px; background: var(--line-2); overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--reality); box-shadow: var(--glow-reality); transition: width var(--t-quick) linear; }
  .mru { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-2); }
  .m { display: inline-flex; align-items: center; gap: var(--space-2); font-size: var(--fs-1); color: var(--tx-val); padding: 0 var(--space-2); border: var(--bw) solid var(--line-2); border-radius: var(--radius); height: var(--ctl-h-sm, 22px); }
  .m:hover { color: var(--tx-hi); border-color: var(--line-4); }
  .m b { color: var(--tx-mut); font-weight: 500; }
  .m i { width: 7px; height: 7px; border-radius: var(--radius); flex: none; }
  .list { display: grid; gap: var(--space-1); padding: var(--space-3) var(--space-4); align-content: start; }
  .empty { padding: var(--space-3) var(--space-1); }
  .gap { text-align: left; font-size: var(--fs-1); color: var(--tx-ghost); padding: var(--space-1) var(--space-3); border: var(--bw) dashed var(--line-1); border-radius: var(--radius); }
  .gap:hover { color: var(--tx-val); border-color: var(--line-3, var(--line-2)); }
  .act { border: 1px solid var(--line-1); border-radius: var(--radius); background: var(--bg); }
  .act.layered { margin-left: var(--space-5); }
  .act.prop { border-style: dashed; }
  .act.sel { border-color: var(--sel-line); background: var(--bg-card); }
  .head { display: grid; gap: 0; width: 100%; text-align: left; padding: var(--space-2) var(--space-3); color: inherit; }
  .l1 { display: flex; align-items: center; gap: var(--space-1) var(--space-3); min-width: 0; overflow: hidden; }
  .l1 > * { white-space: nowrap; }
  .l2 { font-size: var(--fs-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sw { width: 9px; height: 9px; border-radius: var(--radius); flex: none; background: var(--tx-ghost); }
  .sw.hatch { background: repeating-linear-gradient(135deg, var(--tx-mut) 0 1px, transparent 1px 3px); }
  .w { color: var(--tx-hi); font-weight: 500; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .act:not(.sel) .w { color: var(--tx-val); }
  .w.untagged { color: var(--tx-mut); font-weight: 400; }
  .t { color: var(--tx-val); }
  .d { font-size: var(--fs-1); }
  .cam { flex: none; fill: none; stroke: var(--tx-mut); stroke-width: 1.6; }
  .st { flex: none; margin-left: auto; font-size: var(--fs-1); white-space: nowrap; padding: 0 var(--space-2); border-radius: var(--radius); color: var(--tx-ghost); border: var(--bw) solid var(--line-1); }
  .st-ghost { color: var(--tx-val); border-style: dashed; border-color: var(--line-3, var(--line-2)); }
  .st-accepted { color: var(--tx-hi); border-color: var(--sel-line); }
  .chip { display: inline-flex; align-items: center; gap: var(--space-1); white-space: nowrap; }
  .chip i { width: 7px; height: 7px; border-radius: var(--radius); flex: none; }
  .body { display: grid; gap: var(--space-3); padding: var(--space-2) 0 var(--space-3); border-top: 1px solid var(--line-1); }
  .body > .row, .body > .tags { margin: 0 var(--space-3); }
  .tags { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .tag { display: inline-flex; gap: var(--space-2); align-items: center; font-size: var(--fs-1); border: 1px solid var(--line-2); border-radius: var(--radius); padding: 0 var(--space-2); }
  .tag i { font-style: normal; color: var(--tx-mut); }
  .err-line { display: flex; gap: var(--space-3); align-items: flex-start; color: var(--bad-ink); font-size: var(--fs-2); line-height: var(--lh); margin: 0 var(--space-3) var(--space-2); }
  .ell2 { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
  .scp :global(.opts) { margin-top: auto; border-top: 1px solid var(--line-1); }
  .sub { margin: var(--space-3) 0 0; color: var(--tx-mut); }
  .shots { display: grid; gap: 1px; margin: 0 var(--space-3); }
  .shot { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-3); padding: var(--space-1) var(--space-2); border-radius: var(--radius); text-align: left; color: inherit; font-size: var(--fs-1); border: var(--bw) solid transparent; }
  .shot:hover { background: var(--bg-raised); }
  .shot.cur { border-color: var(--line-2); }
  .shot.on { border-color: var(--sel-line); background: var(--bg-raised); }
  .shot.act { box-shadow: inset 2px 0 0 var(--reality); }
  .shot b { color: var(--tx-val); font-weight: 500; min-width: 2.4em; }
  .shot .err { color: var(--bad-ink); }
</style>
