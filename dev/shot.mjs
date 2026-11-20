// usage: node shot.mjs url out.png [waitMs] [w] [h]  -- prints page console + #out text
import { chromium } from 'playwright';
const [url, out, wait = '1500', w = '1600', h = '1000'] = process.argv.slice(2);
const b = await chromium.launch({ channel: 'msedge', headless: true });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
p.on('console', (m) => console.log('[console]', m.type(), m.text()));
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(url);
await p.waitForTimeout(+wait);
const t = await p.locator('#out').textContent().catch(() => '');
if (t) console.log(t);
if (out !== '-') await p.screenshot({ path: out });
await b.close();
