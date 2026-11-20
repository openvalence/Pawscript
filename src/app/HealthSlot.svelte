<script>
  // paw-wfd2.3: the status bar's one health slot (lib/health.js): the most urgent degradation as a fact and one action; the
  // others are counted in its tip. Conditions: the app's own (a project write that fails) + features/*/health.js.
  import StatusItem from '../ui/kit/StatusItem.svelte';
  import { healths } from './plugins.js';
  import { healthStep } from '../lib/health.js';

  let { app } = $props();
  const core = [
    { id: 'project.write', pri: 0, read: (a) => (a.project?.writeError ? {
      tone: 'bad', text: 'Not written', tip: `${a.project.writeError}${a.project.keptIn ? `\nKept in app data (${a.project.keptIn})` : '\nNot kept in app data either: Save a copy to…'}`,
      action: { label: 'Retry', run: () => a.project.retryWrite() },
    } : null) },
    // storage full or blocked: the settings live in memory until a write lands (settings.svelte.js flush)
    { id: 'settings.write', pri: 0.5, read: (a) => (a.settings?.writeError ? {
      tone: 'warn', text: 'Settings not saved', tip: `${a.settings.writeError}\nThey are lost when the app closes`,
      action: { label: 'Retry', run: () => a.settings.flush() },
    } : null) },
  ];
  const all = [...core, ...healths];
  const active = $derived(all.flatMap((h) => {
    let c = null;
    try { c = h.read(app); } catch (e) { console.error('[health ' + h.id + ']', e); }
    return c ? [{ id: h.id, pri: h.pri ?? 50, tone: 'warn', ...c }] : [];
  }));
  const seen = new Map();
  let shown = $state([]);
  $effect(() => {
    const a = active;
    let t = 0;
    const step = () => { const r = healthStep(a, seen, performance.now()); shown = r.shown; if (r.next != null) t = setTimeout(step, r.next + 20); };
    step();
    return () => clearTimeout(t);
  });
  const top = $derived(shown[0] || null);
  const tip = $derived(!top ? '' : [top.tip, ...(shown.length > 1 ? [`Also: ${shown.slice(1).map((c) => c.text).join(', ')}`] : [])].filter(Boolean).join('\n'));
</script>

{#if top}
  <StatusItem icon={top.tone === 'bad' ? 'error' : 'warning'} tone={top.tone} {tip} data-testid="status-health" data-health={top.id}
    onclick={top.action ? () => top.action.run() : undefined}>{top.text}{top.action ? ` · ${top.action.label}` : ''}{shown.length > 1 ? ` (+${shown.length - 1})` : ''}</StatusItem>
{/if}
