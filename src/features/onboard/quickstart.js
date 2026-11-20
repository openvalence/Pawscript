// quickstart.js -- the guide's quick start, bundled at build time (works offline, nothing fetched), parsed for QuickStart.svelte.
import QUICK_START from '../../../docs/guide/quick-start.md?raw';
import { parseMd } from './md.js';

export const quickStart = parseMd(QUICK_START);
