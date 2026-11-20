// The tool catalogue: edit-lib's OPS (src/lib/edit/index.js), the single source for the Transform panel and commands.
import { OPS } from '../../lib/edit/index.js';

export { OPS };
export const opById = (id) => OPS.find((o) => o.id === id);
