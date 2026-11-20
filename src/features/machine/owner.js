// owner.js -- the owner's own toys (paw-p4r4): a local-only data file, toys/owner/*.json, never committed (.gitignore),
// picked up when it is there (library.js globs the folder; a checkout without it simply has none). Pure.
// A file: {toys: [{id, name, firmness ('3' soft / '5' medium, materials.js), note?, sizes: [{value, label, length_mm,
// usable_mm, profile: [[s_mm, r_mm], ...] tip -> base, knot: {from_mm, to_mm} | null, outline?: [[s, left, right]]
// (a non-round toy's visible half-extents; the profile is then the area-equivalent radius), centre?: [[dx, dz], ...]
// (a rest curve, centreline.js toyBend)}]}]}.

const num = (x) => Number.isFinite(+x);

/** One size made safe, or null. */
function cleanSize(z) {
  if (!z || !(+z.length_mm > 20) || !Array.isArray(z.profile)) return null;
  const profile = z.profile.filter((p) => Array.isArray(p) && num(p[0]) && num(p[1]) && p[1] >= 0).map(([s, r]) => [+s, +r]).sort((a, b) => a[0] - b[0]);
  if (profile.length < 2) return null;
  const L = +z.length_mm, knot = z.knot && num(z.knot.from_mm) && num(z.knot.to_mm) ? { from_mm: +z.knot.from_mm, to_mm: +z.knot.to_mm } : null;
  return { value: String(z.value || 'one'), label: String(z.label || z.value || 'One size'), length_mm: L, usable_mm: Math.min(L, +z.usable_mm || L), profile, knot,
    ...(Array.isArray(z.outline) && z.outline.length > 1 ? { outline: z.outline } : {}), ...(Array.isArray(z.centre) && z.centre.length > 1 ? { centre: z.centre } : {}) };
}

/** Every owner toy in the globbed files ({path: parsed json}), made safe; [] when there are none. */
export function ownerList(files = {}) {
  const out = [];
  for (const f of Object.values(files || {})) for (const t of Array.isArray(f?.toys) ? f.toys : []) {
    const sizes = (Array.isArray(t?.sizes) ? t.sizes : []).map(cleanSize).filter(Boolean);
    if (!t?.id || !sizes.length || out.some((o) => o.id === String(t.id))) continue;
    out.push({ id: String(t.id), name: String(t.name || t.id).slice(0, 60), firmness: ['2', '3', '5', '8'].includes(String(t.firmness)) ? String(t.firmness) : '5', sizes });
  }
  return out;
}

const pick = (t, size) => t.sizes.find((z) => z.value === size) || t.sizes[(t.sizes.length - 1) >> 1];

/** The toy (toys.js shape) for an owner key and size (unknown size: the middle one), or null when the key is not theirs. */
export function ownerToy(list, key, size) {
  const t = list.find((o) => o.id === key);
  if (!t) return null;
  const z = pick(t, size);
  return { id: `${t.id}:${z.value}`, name: t.name, length_mm: z.length_mm, usable_mm: z.usable_mm, profile: z.profile, knot: z.knot, firmness: [t.firmness], roll: -1, owner: true,
    ...(z.outline ? { outline: z.outline } : {}), ...(z.centre ? { centre: z.centre } : {}) };
}

/** A picker thumbnail drawn from the profile: the toy upright, tip up, in the library's purple (an SVG data URL). */
export function ownerThumb(z) {
  const L = z.length_mm, R = Math.max(1, ...z.profile.map((p) => p[1])), k = Math.min(88 / L, 40 / R), cx = 50, top = (100 - L * k) / 2;
  const pts = z.profile.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 60)) === 0 || i === a.length - 1);
  const side = (sgn) => pts.map(([s, r]) => `${(cx + sgn * r * k).toFixed(1)},${(top + s * k).toFixed(1)}`);
  const d = `M${side(1).join(' L')} L${side(-1).reverse().join(' L')}Z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#6d4fc4"/><stop offset=".45" stop-color="#a98cf0"/><stop offset="1" stop-color="#5a3fae"/></linearGradient></defs><path d="${d}" fill="url(#g)"/></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

/** Picker entries: {key, name, kind: 'owner', thumb, knot, sizes: [{value, label}] (none for a single size)}. */
export const ownerEntries = (list) => list.map((t) => ({ key: t.id, name: t.name, kind: 'owner', thumb: ownerThumb(pick(t)), knot: t.sizes.some((z) => z.knot),
  sizes: t.sizes.length > 1 ? t.sizes.map((z) => ({ value: z.value, label: z.label })) : [] }));
