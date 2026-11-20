<script>
  // "Apply to": the scope that Transform tools and quick actions act on. One setting (insp.scope), shown in
  // both panels, so the tooltip says it is shared. Too narrow for five segments: the same choice as a Select.
  import Field from '../../ui/kit/Field.svelte';
  import SegmentedControl from '../../ui/kit/SegmentedControl.svelte';
  import Select from '../../ui/kit/Select.svelte';
  import { inspector as insp } from './state.svelte.js';
  import { scopeOptions } from './logic.js';
  const options = scopeOptions().map((o) => ({ ...o, tip: `${o.tip} (shared by Transform and Quick actions)` }));
  let w = $state(320);
</script>

<div class="scope" bind:clientWidth={w}>
  <Field label="Apply to">
    {#snippet children(f)}
      {#if w < 270}
        <Select full size="sm" aria-labelledby={f.labelledby} value={insp.scope} onchange={(v) => insp.setScope(v)} options={scopeOptions()} />
      {:else}
        <SegmentedControl full size="sm" aria-labelledby={f.labelledby} value={insp.scope} onchange={(v) => insp.setScope(v)} {options} />
      {/if}
    {/snippet}
  </Field>
</div>

<style>
  .scope { min-width: 0; }
</style>
