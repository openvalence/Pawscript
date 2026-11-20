<!--
  Prop: one setting (app/settings.svelte.js SCHEMA) as its control, the same everywhere (Blender's RNA property, paw-m3b6):
    <Prop {app} key="lanes.latencyMs" />            the schema's widget (features/settings/logic.js controlOf): a switch, a
                                                    segmented control or select, a number field, a text field
    <Prop {app} key="machine.height" slider value={height} default={ownHeight} format={cmFt} />
  Tooltip: the label (or `tip`), the doc and the default. data-prop={key}. Right click (kit contextmenu.js property()): Reset to
  default (<default>) (the key leaves the settings file), Copy value, Paste value, Show in Settings (the Settings panel opened
  at the row, as the palette's "Setting: …" row does), Add to / Remove from Quick menu (features/palette/quick.js: a boolean's
  row toggles it, any other opens Settings at the row). A number writes once per gesture (drag, typed Enter, key hold); while
  dragging `onpreview(v)` gets the live value. Every write: settings.accepts, settings.set, applySetting, `oncommit(v)`.
  Call-site overrides (the schema stays the truth for the key): value (what to show, e.g. a derived value while the stored one
  is null), default (the value a reset leads to, shown in the menu), options, min / max / step / unit, format, slider (a number
  drawn as a Slider: Blender's layout.prop(slider=True)), expand (choices as a segmented row: expand=True), icon (a boolean drawn as an icon toggle, as in Blender headers),
  store(v) (what is written: a rounding, null for "the derived one"), label (aria), caption (a switch's visible text), size, full, disabled; rest props go to
  the control.
-->
<script>
  import NumberField from '../ui/kit/NumberField.svelte';
  import Slider from '../ui/kit/Slider.svelte';
  import Switch from '../ui/kit/Switch.svelte';
  import ToggleButton from '../ui/kit/ToggleButton.svelte';
  import SegmentedControl from '../ui/kit/SegmentedControl.svelte';
  import Select from '../ui/kit/Select.svelte';
  import TextField from '../ui/kit/TextField.svelte';
  import { property } from '../ui/kit/contextmenu.js';
  import { tooltip } from '../ui/kit/tooltip.js';
  import { formatNumber } from '../ui/kit/math.js';
  import { metaOf } from './settings.svelte.js';
  import { controlOf, dynamicOptions, applySetting, isChanged, openSettingAt } from '../features/settings/logic.js';
  import { valueText } from '../features/palette/logic.js';
  import { quickHas, quickToggle } from '../features/palette/quick.js';

  let {
    app, key, value: shown, default: dflt, options, min, max, step, unit, format, slider = false, expand = false, icon, store = (v) => v,
    label, caption, tip, size = 'sm', full = false, disabled = false, onpreview, oncommit, class: cls = '', ...rest
  } = $props();

  const S = $derived(app.settings);
  const m = $derived(metaOf(key) || { key, label: key, type: typeof shown });
  const opts = $derived(options || m.options || dynamicOptions(app, key));
  const kind = $derived(icon && m.type === 'boolean' ? 'toggle' : slider && m.type === 'number' ? 'slider' : expand && opts ? 'segmented' : controlOf(m, opts));
  const lo = $derived(min ?? m.min), hi = $derived(max ?? m.max), st = $derived(step ?? m.step ?? 1), un = $derived(unit ?? m.unit ?? '');
  let draft = $state(null);   // a number mid-drag
  const stored = $derived((S.values, S.get(key)));
  const cur = $derived(draft ?? (shown !== undefined ? shown : stored));
  const def = $derived(dflt !== undefined ? dflt : m.default);
  const fmt = (v) => (format && Number.isFinite(v) ? format(v) : typeof v === 'number' ? formatNumber(v, { step: st }) + (un ? ' ' + un : '') : valueText({ ...m, options: opts }, v));
  const text = $derived([tip || m.label, tip ? '' : m.doc, def != null && def !== '' ? `Default: ${fmt(def)}` : ''].filter(Boolean).join('\n'));

  function write(v) {
    draft = null;
    v = store(v);
    if (!S.accepts(key, v)) return;
    S.set(key, v);
    applySetting(app, key);
    oncommit?.(v);
  }
  function reset() {
    draft = null;
    S.reset(key);
    applySetting(app, key);
    oncommit?.(S.get(key));
  }
  const preview = (v) => { draft = v; onpreview?.(v); };

  let el = $state();
  const asProperty = property(() => ({
    value: cur, default: def, disabled, set: write, reset, format: fmt,
    more: () => [
      ...(el?.closest('[data-testid="settings-panel"]') ? [] : [{ label: 'Show in Settings', run: () => openSettingAt(app, key) }]),
      ...(m.internal ? [] : [{ label: quickHas(app, key) ? 'Remove from Quick menu' : 'Add to Quick menu', run: () => quickToggle(app, key) }]),
    ],
  }));
  // the reset entry is off at the default: a derived (null) default counts as unchanged however it shows
  const atDefault = $derived((S.values, !isChanged(S, key)));
</script>

<span bind:this={el} class="k-prop {cls}" class:k-prop-full={full} data-prop={key} data-default={atDefault || undefined}
  {@attach asProperty} {@attach kind === 'toggle' ? undefined : tooltip(text)}>
  {#if kind === 'toggle'}
    <ToggleButton {size} {icon} label={label || m.label} tip={text} {disabled} pressed={cur === true} onchange={(v) => write(v)} {...rest} />
  {:else if kind === 'switch'}
    <Switch {size} checked={cur === true} {disabled} label={caption} aria-label={caption ? undefined : label || m.label} onchange={(v) => write(v)} {...rest} />
  {:else if kind === 'segmented'}
    <SegmentedControl {size} {full} options={opts} value={cur} label={label || m.label} {disabled} onchange={(v) => write(v)} {...rest} />
  {:else if kind === 'select'}
    <Select {size} {full} options={opts} value={cur} label={label || m.label} {disabled} onchange={(v) => write(v)} {...rest} />
  {:else if kind === 'slider'}
    <Slider {size} {full} value={cur ?? lo} min={lo} max={hi} step={st} showValue format={format || ((v) => formatNumber(v, { step: st }) + (un ? ' ' + un : ''))}
      label={label || m.label} {disabled} onchange={preview} oncommit={write} {...rest} />
  {:else if kind === 'number'}
    <NumberField {size} {full} value={cur ?? NaN} min={lo} max={hi} step={st} unit={un} label={label || m.label} {disabled}
      placeholder={cur == null ? 'Auto' : undefined} onchange={preview} oncommit={write} {...rest} />
  {:else if kind === 'text' || kind === 'folder'}
    <TextField {size} {full} value={cur || ''} label={label || m.label} {disabled} onchange={(v) => write(v)} {...rest} />
  {/if}
</span>

<style>
  .k-prop { display: inline-flex; align-items: center; min-width: 0; max-width: 100%; vertical-align: middle; }
  .k-prop-full { display: flex; width: 100%; }
  .k-prop-full > :global(*) { flex: 1 1 auto; min-width: 0; }
</style>
