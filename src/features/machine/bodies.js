// bodies.js -- the imported character models' assets (Vite only: URLs and the landmark json; tools/build-body-asset.mjs
// and tools/build-body-layers.mjs write them, meshbody.js reads them).
const files = import.meta.glob('./bodies/*.{bin,webp}', { eager: true, query: '?url', import: 'default' });
const infos = import.meta.glob('./bodies/*.json', { eager: true, import: 'default' });

/** {bin, tex, info, layers} for a model's id, or null (no asset in this checkout). A single-mesh model has `bin`; a
 *  layered one (json v2) has `layers`: [{id, name, on, urls}] (each layer in parts of under 65536 vertices). */
export function bodyAsset(id) {
  const info = infos[`./bodies/${id}.json`];
  if (!info) return null;
  if (info.layers) {
    const layers = info.layers.map((l) => ({ id: l.id, name: l.name, on: l.on, urls: l.parts.map((f) => files[`./bodies/${f}`]) }));
    return layers.every((l) => l.urls.every(Boolean)) ? { bin: null, tex: null, info, layers } : null;
  }
  const bin = files[`./bodies/${id}.bin`];
  return bin ? { bin, tex: files[`./bodies/${id}.tex.webp`] || null, info, layers: null } : null;
}

/** The ids of every model with an asset here (the shipped ones and any the owner keeps locally). */
export const bodyIds = () => Object.keys(infos).map((k) => k.slice(9, -5)).filter((id) => bodyAsset(id));
