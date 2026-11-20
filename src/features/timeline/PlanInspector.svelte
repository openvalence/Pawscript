<script>
  // PlanInspector {app, id}: edits one plan segment -- or every selected one when `id` is in the selection.
  // Body of the plan lane's popover and of the Plan panel. Every change is ONE undoable app.transact on
  // app.doc.plan (slider and number scrubs coalesce into one entry); the logic is generate-logic.js / generate.js.
  // Chrome is the kit's; the kind row stays local (a radiogroup of kinds.js glyphs, which are not kit icons).
  import { Icon, Button, IconButton, ToggleButton, TextField, Badge, ParamForm, Section, tooltip } from '../../ui/kit/index.js';
  import { recipesFor, RECIPES } from '../../lib/gen/recipes.js';
  import { tl, listOf } from './state.svelte.js';
  import { KINDS, kindOf } from './kinds.js';
  import { setKind, setRecipe, setParams, segState, recipeLabel, intensityOf, schemaOf } from './plan.js';
  import { liveSel } from './plan-edit.js';
  import { fmtMs } from '../../lib/video.js';
  import { formSchema, formValues, paramPatch, trackerRuns, chooseRun, runLabel } from './generate-logic.js';
  import { generate, detach, toggleLock, deleteSegments, editPlan, onCompile, ensurePreview } from './generate.js';

  let { app, id } = $props();
  const RECIPE = '__recipe', SOURCE = '__source';
  // svelte-ignore state_referenced_locally
  ensurePreview(app);

  const plan = $derived(listOf(app, 'plan'));
  const seg = $derived(plan.find((s) => s.id === id) ?? null);
  const ids = $derived.by(() => { const sel = liveSel(plan, tl.segs); return sel.includes(id) ? sel : [id]; });
  const many = $derived(ids.length > 1);
  const k = $derived(seg ? kindOf(seg.kind) : null);
  const state = $derived(seg ? segState(seg) : 'new');
  const schema = $derived(seg ? formSchema(seg.recipe) : []);
  const values = $derived(seg ? formValues(seg, schema) : {});
  const main = $derived(schema.filter((p) => !p.group));
  const shaping = $derived(schema.filter((p) => p.group).map(({ group, ...p }) => p));
  const shapingChanged = $derived(shaping.filter((p) => seg?.params?.[p.key] !== undefined).length);
  const hasIntensity = $derived(!!seg && schemaOf(seg.recipe).some((p) => p.key === 'intensity'));
  // which tracker run the segment follows (only for recipes that use turns): 'auto' = the visible run that best
  // covers it (generate-logic chooseRun), or an explicit run, listed even when hidden
  const follows = $derived(!!seg && ['follow', 'knot'].includes(RECIPES[seg.recipe]?.gen));
  const axis = $derived(app.doc.activeAxis ?? 'stroke');
  const runsVis = $derived(trackerRuns(app.doc.ghosts, axis));
  const runsAll = $derived(trackerRuns(app.doc.ghosts, axis, true));
  const autoRun = $derived(seg ? chooseRun({ t0: seg.t0, t1: seg.t1 }, runsVis, runsAll) : null);
  const sourceChoices = $derived([
    { value: 'auto', label: 'Auto' + (autoRun ? ' · ' + runLabel(autoRun) : ' · no run covers it') },
    ...runsAll.map((g) => ({ value: g.id, label: (g.name || g.id) + (g.visible === false ? ' (hidden)' : '') })),
    ...(seg?.source && seg.source !== 'auto' && !runsAll.some((g) => g.id === seg.source) ? [{ value: seg.source, label: 'Missing run (' + seg.source + ')' }] : []),
  ]);
  // recipe and intensity ride in the same kit form as the params (one label column, reset dots for free)
  const head = $derived(!seg ? [] : [
    { key: RECIPE, label: 'Recipe', type: 'choice', control: 'select', default: k.recipe,
      choices: recipesFor(seg.kind).map((r) => ({ value: r, label: recipeLabel(r) })) },
    ...(follows ? [{ key: SOURCE, label: 'Follows', type: 'choice', control: 'select', default: 'auto', choices: sourceChoices,
      hint: 'Run this segment follows (Auto: the visible run covering most)' }] : []),
    ...(hasIntensity ? [{ key: 'intensity', label: 'Intensity', type: 'number', control: 'slider', min: 0, max: 1, step: 0.05, default: 1 }] : []),
  ]);
  const formVals = $derived(seg ? { ...values, [RECIPE]: seg.recipe, [SOURCE]: seg.source ?? 'auto', intensity: intensityOf(seg) } : {});
  const keyOf = (cmd) => app.commands.keysFor(cmd)?.[0] || '';

  let shapingOpen = $state(false);
  let issues = $state.raw([]);
  $effect(() => onCompile((l) => { issues = l.issues.filter((i) => i.id === id); }));

  const STATE = {
    new: ['New', 'Never generated: Generate writes it'],
    fresh: ['Fresh', 'The script holds what this segment generates'],
    stale: ['Stale', 'Edited since it was generated: Generate rewrites it'],
    locked: ['Locked', 'Generate skips it; its points are yours'],
  };
  const TONE = { new: 'info', fresh: 'ok', stale: 'warn', locked: 'neutral' };

  // every form change (each scrub step too) is applied live; same-label repeats coalesce into one undo entry
  function onParam(v, key) {
    if (!seg) return;
    if (key === RECIPE) return pickRecipe(v[RECIPE]);
    if (key === SOURCE) return pickSource(v[SOURCE]);
    if (key === 'intensity') return setIntensity(v.intensity);
    const patch = paramPatch(schema, v, values, seg);
    if (!Object.keys(patch).length) return;
    const label = schema.find((p) => p.key === key)?.label ?? 'params';
    editPlan(app, `Segment ${label.toLowerCase()}`, (p) => setParams(p, ids, patch), { coalesce: true });
  }

  const setIntensity = (v) => editPlan(app, 'Segment intensity', (p) => setParams(p, ids, { intensity: v >= 1 ? undefined : Math.round(v * 100) / 100 }), { coalesce: true });
  const pickKind = (kind) => seg && kind !== seg.kind && editPlan(app, 'Segment kind', (p) => setKind(p, ids, kind));
  const pickRecipe = (r) => seg && r !== seg.recipe && editPlan(app, 'Segment recipe', (p) => setRecipe(p, ids, r));
  const pickSource = (v) => seg && v !== (seg.source ?? 'auto') && editPlan(app, 'Segment run', (p) => p.map((s) =>
    (!ids.includes(s.id) ? s : v === 'auto' ? (({ source: _, ...r }) => r)(s) : { ...s, source: v })));
  function rename(v) {
    const name = String(v ?? '').trim();
    if (!seg || name === (seg.name ?? '')) return;
    editPlan(app, 'Rename segment', (p) => p.map((s) => (s.id !== id ? s : name ? { ...s, name } : (({ name: _, ...r }) => r)(s))));
  }
  const closePopover = (gone) => { if (tl.inspector && gone.includes(tl.inspector.id)) tl.inspector = null; };
</script>

<div class="pi" data-plan-inspector={id}>
  {#if !seg}
    <p class="hint">This segment no longer exists.</p>
  {:else}
    <header class="head">
      <svg class="kicon" viewBox="0 0 16 16" aria-hidden="true" style:--kc={k.css}><path d={k.icon} stroke-dasharray={k.dash ? '3 2.5' : undefined} /></svg>
      <TextField class="name" size="sm" full value={seg.name ?? ''} placeholder={k.label} label="Segment name" spellcheck="false" onchange={rename} />
      <span class="state" {@attach tooltip(STATE[state][1])}><Badge tone={TONE[state]} variant="outline">{STATE[state][0]}</Badge></span>
    </header>
    <div class="sub k-num">
      <span>{fmtMs(seg.t0)} – {fmtMs(seg.t1)}</span><span class="dim">{((seg.t1 - seg.t0) / 1000).toFixed(1)} s</span>
      {#if many}<span class="many">{ids.length} selected: edits apply to all</span>{/if}
    </div>
    <div class="kinds" role="radiogroup" aria-label="Kind">
      {#each KINDS as kd (kd.id)}
        <button type="button" class="kind" role="radio" aria-checked={kd.id === seg.kind} aria-label={kd.label}
          style:--kc={kd.css} onclick={() => pickKind(kd.id)} {@attach tooltip(kd.label, kd.key ?? undefined)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d={kd.icon} stroke-dasharray={kd.dash ? '3 2.5' : undefined} /></svg>
          {#if kd.key}<span class="digit">{kd.key}</span>{/if}
        </button>
      {/each}
    </div>

    <ParamForm schema={[...head, ...main]} values={formVals} collapsible={false} onchange={onParam} />
    {#if shaping.length}
      <Section title="More" count={shapingChanged || ''} bind:open={shapingOpen} class="shaping">
        <ParamForm schema={shaping} {values} collapsible={false} onchange={onParam} />
      </Section>
    {/if}

    {#if issues.length}
      <ul class="issues">
        {#each issues as i, n (n)}<li class={i.level}><Icon name={i.level === 'error' ? 'error' : 'warning'} size={14} />{i.msg}</li>{/each}
      </ul>
    {/if}

    <footer class="acts">
      <Button size="sm" variant="primary" icon="wand" disabled={state === 'locked' && !many} tip={many ? 'Generate the selected segments' : 'Generate this segment into the active axis'}
        onclick={() => generate(app, 'selected', ids)}>Generate{many ? ` ${ids.length}` : ''}</Button>
      <ToggleButton size="sm" icon={seg.locked ? 'lock' : 'unlock'} pressed={!!seg.locked} label={seg.locked ? 'Locked: Generate skips it' : 'Lock (Generate skips it)'} shortcut={keyOf('timeline.plan.lock')}
        onclick={() => toggleLock(app, ids)} />
      <span class="grow"></span>
      <IconButton size="sm" icon="unlink" label="Detach: keep the points, drop the segment" onclick={() => { closePopover(ids); detach(app, ids); }} />
      <IconButton size="sm" icon="delete" variant="ghost" label="Delete segment (points stay)" onclick={() => { closePopover(ids); deleteSegments(app, ids); }} />
    </footer>
  {/if}
</div>

<style>
  /* The kit ParamForm insets its rows like a Section body (--space-4); everything else here takes the same
     inset so the inspector reads as one column, flush in a panel or a popover. */
  .pi { min-width: 0; display: flex; flex-direction: column; gap: var(--gap); padding-bottom: var(--space-3); }
  .head, .sub, .kinds, .issues, .acts, .hint { margin-inline: var(--space-4); }
  .pi :global(.shaping .k-param-form-loose) { padding-inline: 0; }
  .hint { font-size: var(--fs-2); color: var(--tx-mut); margin-block: 0; }

  .head { display: flex; align-items: center; gap: var(--space-3); min-height: var(--ctl-h); }
  .kicon { width: 18px; height: 18px; flex: none; fill: none; stroke: var(--kc); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .head :global(.name) { flex: 1 1 auto; min-width: 0; }
  .state { flex: none; display: inline-flex; cursor: default; }

  .sub { display: flex; gap: var(--space-3); align-items: baseline; font-size: var(--fs-1); color: var(--tx-val); padding-left: calc(18px + var(--space-3) + var(--space-2)); flex-wrap: wrap; }
  .sub .dim { color: var(--tx-mut); }
  .many { color: var(--accent-ink); font-family: var(--font); }

  /* kind chips: icon-only, one full-width row (11 x ~25 px in a 300 px popover); the header names the kind */
  .kinds { display: grid; grid-template-columns: repeat(11, minmax(0, 1fr)); gap: 2px; }
  .kind {
    position: relative; height: var(--ctl-h); min-width: 0; padding: 0;
    display: grid; place-items: center; cursor: pointer;
    background: var(--bg-sunken); border: var(--bw) solid var(--line-2); border-radius: var(--radius);
    color: var(--kc);
    transition: border-color var(--t-quick) var(--ease-out), background-color var(--t-quick) var(--ease-out);
  }
  .kind svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; opacity: .7; }
  .kind:hover { border-color: var(--line-4); }
  .kind:hover svg { opacity: 1; }
  .kind[aria-checked='true'] { border-color: var(--kc); background: color-mix(in srgb, var(--kc) 16%, var(--bg-sunken)); }
  .kind[aria-checked='true'] svg { opacity: 1; }
  .kind:focus-visible { outline: var(--ring-w) solid var(--focus); outline-offset: var(--ring-offset); }
  .digit { position: absolute; right: 1px; bottom: 0; font-family: var(--mono); font-size: calc(var(--fs-1) - 2px); line-height: 1; color: var(--tx-mut); pointer-events: none; }

  .issues { list-style: none; margin-block: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--fs-1); }
  .issues li { display: flex; gap: var(--space-2); align-items: flex-start; color: var(--warn-ink); }
  .issues li.error { color: var(--bad-ink); }
  .issues :global(svg) { flex: none; margin-top: 1px; }

  .acts { display: flex; align-items: center; gap: var(--space-1); padding-top: var(--space-2); border-top: var(--bw) solid var(--line-1); }
  .grow { flex: 1; }
</style>
