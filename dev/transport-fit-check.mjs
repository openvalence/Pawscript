// dev/transport-fit-check.mjs -- paw-ec2a: the transport row fits its container at every width from 360 px up (each container
// query step starts where what is left fits), and focusing its last control never scrolls the row (the first button was cut
// off at the 900 x 600 window). In YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env), a video open:
//   node dev/transport-fit-check.mjs        exits 1 when a check fails
import { connectTestApp } from './cdp-connect.mjs';
const { browser: b, page } = await connectTestApp();
const r = await page.evaluate(async () => {
  const row = document.querySelector('.tx .row'), tx = row.closest('.tx'), old = tx.style.cssText, frame = () => new Promise((f) => requestAnimationFrame(() => requestAnimationFrame(f)));
  const over = [];
  for (let w = 360; w <= 1300; w += 10) {
    tx.style.width = tx.style.maxWidth = tx.style.minWidth = w + 'px';
    await frame();
    if (row.scrollWidth > row.clientWidth + 0.5) over.push([w, row.scrollWidth - row.clientWidth]);
  }
  tx.style.width = tx.style.maxWidth = tx.style.minWidth = '460px';
  await frame();
  const btns = [...row.querySelectorAll('button')].filter((x) => x.getBoundingClientRect().width > 0);
  btns.at(-1).focus();
  await frame();
  const scrolled = row.scrollLeft;
  btns.at(-1).blur(); tx.style.cssText = old;
  return { over, scrolled };
});
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
ok(!r.over.length, `the row fits from 360 to 1300 px${r.over.length ? `: overflows at ${JSON.stringify(r.over)}` : ''}`);
ok(r.scrolled === 0, `focusing the last control does not scroll the row (scrollLeft ${r.scrolled})`);
await b.close();
process.exit(fails ? 1 : 0);
