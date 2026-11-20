<script>
  // RegionChips -- paw-2lp7.5: an action region's tag chips, the quick bar's where / what chips bound to the region (owner:
  // "regions are named on action"): its kind (action, positioning, or a no-action kind the owner marks: intro / idle / rest /
  // outro / after), where and what as chips, all of them (one action; an alias like rimming = its parts; no menu: one click
  // each, and a menu would take the focus out of the in-place popover), the recent actions as numbered chips (the
  // 1-9 keys), a secondary region's mix (mix / layer / ignore), Accept (a proposal) and Delete. Every press is one undo step.
  // In place over the region (the Actions strip: double-click / Enter), in the Inspector and in the Actions panel's selected row
  // (compact: only the whats it has, the rest behind "+ what", so the panel row stays short).
  // Space stays play / pause (the chips take focus, Space would press one).
  import Button from '../../ui/kit/Button.svelte';
  import SegmentedControl from '../../ui/kit/SegmentedControl.svelte';
  import { shownTags } from '../../lib/content.js';
  import { TAG_CATEGORIES, ALIASES, TAG, actWords, sceneTags, tagLabel, tagColor } from './acts.js';
  import { setRegionKind, setRegionMix, toggleRegionTag, regionWords } from './regions.js';
  import { regionKind } from './actions-strip.js';
  import { kindOf } from './kinds.js';
  import { commitActs, setTags, removeAct, acceptAct, mruOf, actLabel } from './acts-edit.js';

  let { app, id, compact = false } = $props();
  const r = $derived((app.doc.acts || []).find((x) => x.id === id) ?? null);
  const pseudo = $derived({ tags: r?.tags ?? [] });
  const on = $derived(sceneTags(pseudo));
  const words = $derived(actWords(pseudo));
  const WHERE = TAG_CATEGORIES.find((c) => c.id === 'where').tags, WHAT = TAG_CATEGORIES.find((c) => c.id === 'what').tags;
  const ALIAS = Object.entries(ALIASES).filter(([, p]) => Array.isArray(p)).map(([w]) => w);
  const mru = $derived(mruOf(app));
  let allWhats = $state(false);
  const shownWhats = $derived(!compact || allWhats ? shownTags(WHAT, (id) => on.includes(id)) : WHAT.filter((t) => on.includes(t.id)));
  const shownAliases = $derived(!compact || allWhats ? ALIAS : words.aliases);
  const KIND_OPTS = [
    { value: 'act', label: 'action', tip: 'An action, tag its where and what' },
    { value: 'positioning', label: 'positioning', tip: 'Characters changing position, the script eases through' },
    { value: 'intro', label: 'intro', tip: 'Intro: no action yet (generated, not tracked)' },
    { value: 'idle', label: 'idle', tip: 'Idle: nothing happening (held)' },
    { value: 'rest', label: 'rest', tip: 'A breather between rounds, read as idle' },
    { value: 'outro', label: 'outro', tip: 'Outro: the end, nothing more happens' },
    { value: 'after', label: 'after', tip: 'After: quiet bodies once the action is over' },
  ];
  const MIX_OPTS = [
    { value: 'mix', label: 'mix', tip: 'Mixed into the main line\'s motion' },
    { value: 'layer', label: 'layer', tip: 'Its own lane relative to the main action (mixes for now)' },
    { value: 'ignore', label: 'ignore', tip: 'Only marked, the main line drives the motion' },
  ];
  const note = (what) => app.usage?.note?.('regionChips', { what });
  function tag(t) { const x = r; if (!x) return; note('tag'); setTags(app, x.id, toggleRegionTag(x.tags, t), `Action tag: ${tagLabel(t)}`); }
  const keep = (e) => { if (e.code === 'Space') { e.preventDefault(); e.stopPropagation(); app.commands?.run?.('player.toggle'); } };
  const mruTip = (t, k) => `${k + 1}: ${regionWords({ kind: 'act', tags: t })} on this region (the key ${k + 1} does the same, in the Scenes tab, on the selected region or the selected shots)`;
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="rc" class:compact onkeydown={keep}>
  {#if r}
    {#if !compact}<p class="head"><i class="sw" style:background={regionKind(r) ? kindOf(regionKind(r)).color : 'var(--tx-ghost)'}></i><b>{regionWords(r)}</b><span class="k-num">{actLabel(r).slice(regionWords(r).length + 1)}</span>{#if r.auto}<span class="prop">proposed</span>{/if}</p>{/if}
    <div class="line">
      <SegmentedControl size="sm" label="Region kind" options={KIND_OPTS} value={r.kind} onchange={(v) => { note('kind'); commitActs(app, `Region: ${v}`, setRegionKind(app.doc.acts, id, v)); }} />
    </div>
    {#if r.kind === 'act'}
      <div class="line" role="group" aria-label="Where">
        {#each shownTags(WHERE, (id) => on.includes(id)) as t (t.id)}
          <Button size="sm" variant="ghost" pressed={on.includes(t.id)} onclick={() => tag(t.id)} tip={`Where: ${t.label} (the receiving part)`}>{t.label}</Button>
        {/each}
      </div>
      <div class="line" role="group" aria-label="What">
        {#each shownAliases as w (w)}
          <Button size="sm" variant="ghost" pressed={words.aliases.includes(w)} onclick={() => tag(w)} tip={`${w} = ${ALIASES[w].join(' + ')}${words.aliases.includes(w) ? ' (click to remove)' : ''}`}><i class="dot" style:background={tagColor(ALIASES[w].find((p) => TAG[p].cat === 'what'))}></i>{w}</Button>
        {/each}
        {#if shownAliases.length}<span class="k-sep"></span>{/if}
        {#each shownWhats as t (t.id)}
          <Button size="sm" variant="ghost" pressed={on.includes(t.id)} onclick={() => tag(t.id)} tip={`What: ${t.label}${t.needsWhere ? ' (needs a where)' : ''}`}><i class="dot" style:background={tagColor(t.id)}></i>{t.label}</Button>
        {/each}
        {#if compact}<Button size="sm" variant="ghost" icon={allWhats ? '' : 'plus'} onclick={() => (allWhats = !allWhats)} tip={allWhats ? 'Show only its whats' : 'Every what (rimming, fellatio … handjob, grinding)'}>{allWhats ? 'fewer' : 'what'}</Button>{/if}
      </div>
      {#if mru.length}
        <div class="line" role="group" aria-label="Recent actions">
          {#each mru as t, k (k)}
            <Button size="sm" variant="ghost" onclick={() => { note('mru'); setTags(app, id, t, `Action: ${regionWords({ kind: 'act', tags: t })}`); }} tip={mruTip(t, k)}><b class="n k-num">{k + 1}</b>{regionWords({ kind: 'act', tags: t })}</Button>
          {/each}
        </div>
      {/if}
    {/if}
    {#if r.layer > 0 && r.kind === 'act'}
      <div class="line"><span class="k-hint">secondary</span>
        <SegmentedControl size="sm" label="Mix" options={MIX_OPTS} value={r.mix ?? 'mix'} onchange={(v) => { note('mix'); commitActs(app, `Mix: ${v}`, setRegionMix(app.doc.acts, id, v)); }} />
      </div>
    {/if}
    <div class="line">
      {#if r.auto}<Button size="sm" variant="primary" icon="check" onclick={() => acceptAct(app, id)} tip="Accept this proposed action (Enter)">Accept</Button>{/if}
      <Button size="sm" variant="ghost" icon="delete" onclick={() => removeAct(app, id)} tip={r.auto ? 'Dismiss the proposal (Delete)' : 'Delete this action region (Delete)'}>{r.auto ? 'Dismiss' : 'Delete'}</Button>
    </div>
  {/if}
</div>

<style>
  .rc { display: grid; gap: var(--space-2); min-width: 0; padding: var(--space-2) var(--space-3); max-width: 34rem; }
  .rc.compact { padding: 0 var(--space-3); }
  .head { display: flex; align-items: baseline; gap: var(--space-3); margin: 0; font-size: var(--fs-ui); min-width: 0; }
  .head b { color: var(--tx-hi); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .head .k-num { font-size: var(--fs-1); color: var(--tx-mut); white-space: nowrap; }
  .prop { font-size: var(--fs-1); color: var(--reality); border: var(--bw) dashed var(--reality); border-radius: var(--radius); padding: 0 var(--space-2); }
  .sw { width: 8px; height: 8px; border-radius: var(--radius); flex: none; align-self: center; }
  .line { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: var(--radius); margin-right: var(--space-2); vertical-align: middle; }
  .n { color: var(--tx-mut); margin-right: var(--space-2); font-weight: 500; }
</style>
