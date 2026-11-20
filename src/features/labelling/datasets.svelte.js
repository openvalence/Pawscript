// datasets.svelte.js -- the seeder datasets' state (paw-855t): the registry (datasets.js), which one is active, switching / creating /
// renaming / archiving. One per app; the Groups tool (Track tab: which head Suggest uses, which labels Train reads) and the labelling
// workspace (the picker) share it, so a switch in the workspace is a switch for Suggest everywhere.
import { rooted } from '../../lib/rooted.svelte.js';
import { createRegistryStore, activeOf, datasetDir, labelsDirOf, withActive, withCreated, withRenamed, withArchived, withProjects } from './datasets.js';

export class Datasets {
  reg = $state.raw(null);   // {active, datasets: [{id, name, projects, archived?, legacy?}], error?} once loaded
  version = $state(0);      // bumped on every switch (what follows the active dataset re-reads)
  #seedDir; #store = null; #loading = null; #seed = null;
  constructor(app, seedDir) { this.app = app; this.#seedDir = seedDir; }
  /** Load (once) -> the registry, or null outside the app (no data folder). */
  ready() {
    return (this.#loading ||= (async () => {
      const seed = await this.#seedDir();
      if (!seed || !this.app.backend) return null;
      this.#seed = seed;
      this.#store = createRegistryStore(this.app.backend, seed);
      this.reg = await this.#store.load();
      return this.reg;
    })());
  }
  get active() { return activeOf(this.reg); }
  /** The active dataset as the callers need it: {id, name, projects, dir (its folder), labels, seed (the shared seeder folder), legacy?}. */
  info() {
    const ds = this.active;
    return ds ? { id: ds.id, name: ds.name, projects: ds.projects, legacy: !!ds.legacy, seed: this.#seed, dir: datasetDir(this.#seed, ds), labels: labelsDirOf(this.#seed, ds) } : null;
  }
  infoOf(id) { const ds = this.reg?.datasets.find((d) => d.id === id); return ds ? { id: ds.id, name: ds.name, projects: ds.projects, seed: this.#seed, dir: datasetDir(this.#seed, ds), labels: labelsDirOf(this.#seed, ds) } : null; }
  async #apply(reg, switched) {
    if (reg === this.reg) return;
    this.reg = reg;
    if (switched) this.version++;
    try { await this.#store.save(reg); } catch (e) { this.app.toast?.('Could not save the dataset list: ' + (e?.message || e), 'error'); }
  }
  async switchTo(id) { await this.ready(); if (!this.reg || id === this.reg.active || !this.reg.datasets.some((d) => d.id === id)) return false; await this.#apply(withActive(this.reg, id), true); return true; }
  /** A new empty dataset (its name inline in the picker), active at once. -> its id, or null. */
  async create(name) { await this.ready(); if (!this.reg || this.reg.error) return null; const { reg, id } = withCreated(this.reg, name); if (!id) return null; await this.#apply(reg, true); return id; }
  async rename(id, name) { await this.ready(); if (this.reg) await this.#apply(withRenamed(this.reg, id, name), false); }
  async archive(id, on = true) { await this.ready(); if (this.reg) await this.#apply(withArchived(this.reg, id, on), false); }
  async setProjects(id, on) { await this.ready(); if (this.reg) await this.#apply(withProjects(this.reg, id, on), false); }
}

const stores = new WeakMap();
export function datasetsFor(app, seedDir) {
  let s = stores.get(app);
  if (!s) { s = rooted(() => new Datasets(app, seedDir), app); stores.set(app, s); }   // paw-b7da: its own root, never the asking component's
  return s;
}
