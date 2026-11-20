// kit.svelte.js -- the gallery's late-binding view of the kit: every src/ui/kit/*.svelte that exists, loaded
// one by one so a family that is mid-edit (or broken) cannot take the gallery down. `kit.Button` is the
// component once its file has loaded, undefined before (callers render a placeholder).
// ponytail: gallery-only indirection while families land in parallel; real app code imports by path.
const mods = import.meta.glob('../*.svelte');

export const kit = $state({});
export const failed = $state({});

for (const [path, load] of Object.entries(mods)) {
  const name = path.slice(3, -7);
  load().then(
    (m) => { kit[name] = m.default; },
    (e) => { failed[name] = String(e?.message || e); console.warn('[gallery] kit component failed:', name, e); },
  );
}
