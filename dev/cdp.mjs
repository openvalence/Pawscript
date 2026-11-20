// dev/cdp.mjs -- drive YOUR running Tauri test app (node dev/test-app.mjs start ...; then set the CDP_* env it prints).
//   node dev/cdp.mjs shot out.png            screenshot
//   node dev/cdp.mjs eval "<js expression>"  evaluate (awaited) in the page, print JSON
//   node dev/cdp.mjs keys "Control+z" ...    press keys (Playwright key names), then print nothing
import { connectTestApp } from './cdp-connect.mjs';

const [cmd, ...args] = process.argv.slice(2);
const { browser: b, page } = await connectTestApp();   // refuses unless this is provably your own test instance
page.on('console', (m) => { if (process.env.CDP_LOG) console.log('[console]', m.type(), m.text()); });
if (cmd === 'shot') await page.screenshot({ path: args[0] });
else if (cmd === 'eval') console.log(JSON.stringify(await page.evaluate(`(async () => (${args[0]}))()`), null, 1));
else if (cmd === 'keys') for (const k of args) { await page.keyboard.press(k); await page.waitForTimeout(120); }
else if (cmd === 'click') await page.mouse.click(+args[0], +args[1]);
await b.close().catch(() => {});
