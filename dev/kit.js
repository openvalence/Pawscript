// dev/kit.js -- the kit gallery. Query: ?demo=<name> mounts src/ui/kit/_demo/<Name>Demo.svelte alone
// (each component family's own page); no demo mounts the full gallery (src/ui/kit/_gallery/Gallery.svelte).
// &theme=dark|light|contrast  &density=compact|default|comfortable  &motion=reduce
import '../src/ui/kit/theme.css';
import { mount } from 'svelte';
import { setTheme, setDensity } from '../src/ui/kit/tokens.js';

const q = new URLSearchParams(location.search);
setTheme(q.get('theme') || 'dark');
setDensity(q.get('density') || 'default');
if (q.get('motion')) document.documentElement.dataset.motion = q.get('motion');

const demos = import.meta.glob('../src/ui/kit/_demo/*Demo.svelte');
const gallery = import.meta.glob('../src/ui/kit/_gallery/Gallery.svelte');
const target = document.getElementById('app');
const want = q.get('demo');
const key = want && Object.keys(demos).find((k) => k.toLowerCase().endsWith('/' + want.toLowerCase() + 'demo.svelte'));

const ready = () => { window.__kitReady = true; };
if (key) demos[key]().then((m) => { mount(m.default, { target }); ready(); });
else if (Object.keys(gallery).length) Object.values(gallery)[0]().then((m) => { mount(m.default, { target, props: { demos } }); ready(); });
else target.innerHTML = '<ul style="padding:16px">' + Object.keys(demos).map((k) => {
  const n = k.split('/').pop().replace('Demo.svelte', '');
  return `<li><a style="color:var(--accent-ink)" href="?demo=${n.toLowerCase()}">${n}</a></li>`;
}).join('') + '</ul>';
if (!key && !Object.keys(gallery).length) ready();

