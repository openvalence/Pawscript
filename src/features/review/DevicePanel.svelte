<script>
  import './review.css';
  import { Select, Button, Field, TextField, NumberField, SegmentedControl, Switch, Section, Slider } from '../../ui/kit/index.js';
  import Legend from './Legend.svelte';
  import Prop from '../../app/Prop.svelte';
  import { getReview } from './state.svelte.js';
  import { cmd } from '../../app/cmd.js';
  import { PROFILE_FIELDS, toForm, validateForm, duplicateProfile, newProfile, isBuiltin, strokeRangeOf } from './logic/profiles.js';

  let { app } = $props();
  const rv = getReview(app);
  const prof = $derived(rv.profile), builtin = $derived(isBuiltin(prof.id)), strokeRange = $derived(strokeRangeOf(prof));

  let form = $state({}), errors = $state({}), formFor = '';
  // the stroke window changes a derived max speed: refresh the form then too
  $effect(() => { const k = `${prof.id}|${prof.kinematics?.strokeMm ?? ''}`; if (k !== formFor || builtin) { formFor = k; form = toForm(prof); errors = {}; } });

  function edit(key, value) {
    form = { ...form, [key]: value };
    const r = validateForm(form, prof);
    errors = r.errors;
    // keep what the form does not edit (kinematics, limits); a typed max speed is no longer derived from the stroke window
    if (r.ok && !builtin) rv.saveProfile({ ...prof, ...r.value, id: prof.id, ...(key === 'maxSpeed' ? { maxSpeedDerived: false } : {}) }, false);
  }
  const dup = () => rv.saveProfile(duplicateProfile(prof, rv.profiles));
  const add = () => rv.saveProfile(newProfile(rv.profiles));
  async function remove() { if (await app.confirm({ title: 'Delete profile', message: `Delete "${prof.name}"?`, ok: 'Delete', danger: true })) rv.deleteProfile(prof.id); }

  const profileOptions = $derived(rv.profiles.map((p) => ({ value: p.id, label: p.name, hint: isBuiltin(p.id) ? '' : 'custom' })));
  const scale = $derived((app.settings.values, app.settings.get('review.heatmapScale', 'heat')));
  const hmax = $derived((app.settings.values, app.settings.get('review.heatmapMax', 0)));
</script>

<div class="rv kit-root">
  <div class="rv-body k-scroll">
    <Section title="Device profile">
      <div class="rv-row">
        <Select class="rv-grow" full label="Device profile" options={profileOptions} value={prof.id} onchange={(v) => rv.setProfile(v)} />
      </div>
      <div class="rv-row acts">
        <Button size="sm" icon="duplicate" onclick={dup} tip="Copy this profile so you can edit it">Duplicate</Button>
        <Button size="sm" icon="add" onclick={add} tip="A new custom profile">New</Button>
        <span class="rv-sp"></span>
        <Button size="sm" variant="danger" icon="delete" onclick={remove} disabled={builtin} tip={builtin ? 'Built-in profiles cannot be deleted' : 'Delete this custom profile'}>Delete</Button>
      </div>
      <div class="form">
        <Field inline label="Name" error={errors.name}>
          {#snippet children({ id, describedby })}
            <TextField {id} aria-describedby={describedby} full value={form.name ?? ''} readonly={builtin} invalid={!!errors.name} oninput={(v) => edit('name', v)} />
          {/snippet}
        </Field>
        <!-- step 1: NumberField snaps typed values to its step grid (anchored at min), and these are exact device figures; Shift+arrow nudges by 10 -->
        {#each PROFILE_FIELDS as f (f.key)}
          <Field inline label={f.label} error={errors[f.key]}>
            {#snippet children({ id, describedby })}
              <NumberField {id} aria-describedby={describedby} full value={form[f.key] ?? 0} min={f.min} max={f.max} step={1} unit={f.unit} readonly={builtin} invalid={!!errors[f.key]} onchange={(v) => edit(f.key, v)} />
            {/snippet}
          </Field>
        {/each}
        {#if strokeRange}
          <Field inline label="Stroke window" hint="The rail length you run. Sets max speed and the kinematic checks.">
            {#snippet children({ id, describedby, labelledby })}
              <Slider {id} aria-labelledby={labelledby} aria-describedby={describedby} full min={strokeRange[0]} max={strokeRange[1]} step={5} value={prof.kinematics.strokeMm} showValue format={(v) => `${v} mm`} onchange={(v) => rv.setStrokeMm(v)} />
            {/snippet}
          </Field>
        {/if}
      </div>
      <div class="k-hint note">
        {[builtin && 'Built-in profile: duplicate it to edit.', prof.verified === false && 'These figures are estimates, not datasheet values. Tune them to your device.', prof.note].filter(Boolean).join(' ')}
      </div>
      <div class="rv-row note">
        <Button variant="primary" icon="speed" {...cmd(app, 'review.limitSpeed', undefined, { tip: `Lower amplitudes so no segment exceeds ${prof.maxSpeed} u/s (one undo step)` })}>Limit speed to <span class="k-num">{prof.maxSpeed}</span> u/s</Button>
      </div>
      <div class="k-hint note">Drives the problem checks, this quick action and the simulator's warnings (setting <span class="k-num">review.profile</span>).</div>
    </Section>

    <Section title="Heatmap">
      <div class="form">
        <Prop {app} key="review.heatmapScale" size="md" full label="Color scale" />
        <Legend {app} />
        <Switch label="Follow the device speed limit" checked={!hmax} onchange={(on) => app.settings.set('review.heatmapMax', on ? 0 : Math.round(prof.maxSpeed))} />
        <Field inline label="Top of scale">
          {#snippet children({ id, describedby })}
            <Prop {app} key="review.heatmapMax" {id} aria-describedby={describedby} size="md" full value={hmax || prof.maxSpeed} min={50} unit="u/s" disabled={!hmax}
              store={(v) => Math.round(v)} />
          {/snippet}
        </Field>
        <div class="k-hint">The tick marks the device limit. Colours at or beyond the top of the scale mean "at least this fast".</div>
      </div>
    </Section>
  </div>
</div>

<style>
  .acts { margin-top: var(--gap); }
  .form { display: flex; flex-direction: column; gap: var(--space-4); margin-top: var(--space-5); --field-label-w: 104px; }
  .note { margin-top: var(--space-4); }
</style>
