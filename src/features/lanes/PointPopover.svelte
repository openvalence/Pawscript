<script>
  // Numeric point editor (double-click a point, or Enter with one point selected): a kit Popover beside the
  // point. Enter (or Apply) writes time/pos as one undo entry, clamped between the neighbours; Esc closes.
  // On a locked lane the fields are disabled and focus starts on Unlock.
  import Popover from '../../ui/kit/Popover.svelte';
  import NumberField from '../../ui/kit/NumberField.svelte';
  import Field from '../../ui/kit/Field.svelte';
  import Button from '../../ui/kit/Button.svelte';
  import Icon from '../../ui/kit/Icon.svelte';
  import Kbd from '../../ui/kit/Kbd.svelte';
  import { lanes } from './state.svelte.js';
  import { gridOf, frameAt, frameTime } from '../../lib/lane.js';
  import { scriptOf } from '../../lib/script-of.js';   // paw-x7w7: baked + live

  let { app } = $props();
  const L = $derived(lanes(app));
  const p = $derived(L.popover);
  const act = $derived(p ? scriptOf(app, p.axis).find((a) => a.at === p.at) : null);
  const editable = $derived(p ? L.editable(p.axis) : false);
  const grid = $derived(gridOf(app.player) || 1000 / 30);   // the frame grid (lane.js: the player's clock; paw-kxz4)
  let anchor = $state(), at = $state(null), posInput = $state();
  let time = $state(0), frame = $state(0), val = $state(0);

  function close() {
    if (!L.popover) return;
    const el = L.els[L.popover.axis];
    L.popover = null;
    el?.focus({ preventScroll: true }); // keys keep working on the lane (the popover's content is going away)
  }

  $effect(() => {
    if (p && !act) { close(); return; }
    if (!p) return;
    time = act.at; frame = frameAt(act.at, grid); val = act.pos;
    at = L.screenPoint(p.axis, act.at, act.pos) ?? { x: innerWidth / 2, y: innerHeight / 2 };
    if (L.editable(p.axis)) requestAnimationFrame(() => posInput?.select());
  });

  function unlock() {
    app.commands.run('lanes.toggleLock', { axis: p.axis });
    requestAnimationFrame(() => { posInput?.focus(); posInput?.select(); });   // the Unlock button is gone: edit on
  }

  function submit(e) {
    e.preventDefault();
    if (!editable || !act) return close();
    const rest = scriptOf(app, p.axis).filter((a) => a.at !== act.at);
    let i = rest.findIndex((a) => a.at > act.at);
    if (i < 0) i = rest.length;
    const prev = rest[i - 1], next = rest[i];
    const lo = prev ? prev.at + 1 : 0, hi = next ? next.at - 1 : Infinity;
    const t = Math.max(lo, Math.min(hi, Math.round(time)));
    const pp = Math.max(0, Math.min(100, Math.round(val)));
    const axis = p.axis, changed = t !== act.at || pp !== act.pos;
    close();
    if (changed) {
      // the new slot is between the same neighbours, so index i is still right
      const out = [...rest]; out.splice(i, 0, { at: t, pos: pp });
      app.edit('Edit point', axis, out);
    }
    app.select([t], axis);
  }
</script>

<span class="anchor" bind:this={anchor} style:left="{at?.x ?? 0}px" style:top="{at?.y ?? 0}px"></span>
<Popover bind:open={() => !!(p && act), (v) => { if (!v) close(); }} {anchor} placement="right" offset={12}
  title="Edit point">
  {#if p && act}
    <form onsubmit={submit} aria-label="Edit point on {p.axis}">
      <Field label="Time" inline>
        {#snippet children({ id })}<NumberField {id} bind:value={time} min={0} unit="ms" disabled={!editable} full
          onchange={(v) => (frame = frameAt(v, grid))} />{/snippet}
      </Field>
      <Field label="Frame" inline>
        {#snippet children({ id })}<NumberField {id} bind:value={frame} min={0} unit="f" disabled={!editable} full
          onchange={(v) => (time = frameTime(v, grid))} />{/snippet}
      </Field>
      <Field label="Position" inline>
        {#snippet children({ id })}<NumberField {id} bind:value={val} min={0} max={100} unit="%" disabled={!editable} full
          bind:inputEl={posInput} data-autofocus={editable || undefined} />{/snippet}
      </Field>
      <div class="foot">
        {#if editable}
          <span class="k-hint"><Kbd keys="Escape" /> close</span>
          <Button type="submit" variant="primary" size="sm" tip="Apply" shortcut="Enter">Apply</Button>
        {:else}
          {#if L.flag('locked', p.axis)}
            <span class="locked"><Icon name="lock" size={14} />{p.axis} is locked</span>
            <Button variant="ghost" size="sm" icon="unlock" data-autofocus onclick={unlock}>Unlock</Button>
          {:else}
            <span class="locked"><Icon name="lock" size={14} />Solo {L.solo}: not editable</span>
          {/if}
        {/if}
      </div>
    </form>
  {/if}
</Popover>

<style>
  .anchor { position: fixed; width: 0; height: 0; pointer-events: none; }
  form { display: grid; gap: var(--space-3); width: 15rem; --field-label-w: 4.5rem; }
  .foot { display: flex; align-items: center; justify-content: space-between; gap: var(--gap); margin-top: var(--space-2); }
  .k-hint { display: inline-flex; align-items: center; gap: var(--space-2); }
  .locked { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--warn-ink); font-size: var(--fs-2); }
</style>
