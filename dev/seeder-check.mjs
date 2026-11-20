// node dev/seeder-check.mjs [port] [shot.png]  -- the learned seeder in the Groups tool (paw-bn2, PROTOCOL v4.18) on
// dev/tracking.html?video=1 with the fake sidecar (FAKE.seeder on: two learned groups, the third candidate frame wins).
// Suggest in a take without groups near its start sends the seed folder and the candidate frames, the groups land on the
// picked frame without a seek and the toolbar offers Go there; every suggestion shows its confidence (a tentative one
// faint), ✓ accepts one (a painted group), ✕ deletes one, Enter accepts the rest; Retrain sends seed_train and the
// Seeder line reports it; a project save with new paint retrains in the background. Vite on the given port (default 5200).
import { chromium } from 'playwright';
const port = process.argv[2] || '5200', shot = process.argv[3] || 'seeder-check.png';
const b = await chromium.launch({ channel: 'msedge', headless: true });
const p = await b.newPage({ viewport: { width: 1500, height: 940 } });
let errors = 0, fails = 0;
p.on('console', (m) => { if (m.type() === 'error') { errors++; console.log('[console]', m.text()); } });
p.on('pageerror', (e) => { errors++; console.log('[pageerror]', e.message); });
await p.goto(`http://localhost:${port}/dev/tracking.html?video=1`);
await p.waitForTimeout(1500);
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const ev = (f, a) => p.evaluate(f, a);
const wait = (ms = 150) => p.waitForTimeout(ms);
const time = () => ev(() => window.H.app.player.timeMs);
const groups = () => ev(() => window.H.groups.groups.map((g) => ({ name: g.name, source: g.source, score: g.score, tentative: g.tentative, t: g.t_ms })));
const last = (cmd) => ev((c) => structuredClone(window.H.FAKE.requests.filter((r) => r.cmd === c).at(-1) || null), cmd);

await ev(() => { const H = window.H; H.FAKE.seeder = true; H.app.doc.scenes = [{ start_ms: 0, end_ms: 10010.01 }, { start_ms: 10010.01, end_ms: 20020.02 }, { start_ms: 20020.02, end_ms: 40040.04, join: true }, { start_ms: 40040.04, end_ms: 60027 }]; H.tr.selectTracker('fake.pinned'); H.app.player.seek(20520); });
await wait(400);
// every suggestion shown: the shown-confidence setting (tracking.suggest.confidence, default 0.8, groups.js SUGGEST_CONF) at its
// minimum, so the 0.55 tail and the 0.64 hips are listed as before it existed
await ev(() => window.H.app.settings.set('tracking.suggest.confidence', 0.3));
await p.keyboard.press('Tab'); await wait(300);
const t0 = await time();
await p.getByRole('button', { name: 'Suggest' }).click(); await wait(600);
const req = await last('suggest_groups');
ok(req?.seed?.dir === 'C:\\mock-data\\seeder', `Suggest sends the seeder's folder (${req?.seed?.dir})`);
ok(req?.candidates?.[0] === Math.round(req.t_ms) && req.candidates.length >= 5 && req.candidates.slice(1).every((c) => c >= 20020 && c < 22021), `in the take's first 2 s: the frame on screen first, then the take's start every 400 ms (${req?.candidates})`);
// paw-o74b: groups belong to their seed frame; H.groups.groups is the frame on screen's, .all the take's
const gs = await ev(() => window.H.groups.all.map((g) => ({ name: g.name, source: g.source, score: g.score, tentative: g.tentative, t: g.t_ms }))), picked = req.candidates[2];
ok(gs.length === 5 && gs.every((g) => Math.abs(g.t - picked) <= 1), `the suggestions land on the picked frame ${picked} (${gs.map((g) => g.name + '@' + g.t)})`);
ok(Math.abs((await time()) - t0) < 0.5, 'no seek: the playhead stays where it was');
// 6543984: the frame notice lives in the notes card beside the bar (it opens by itself off the groups' frame)
const notice = await p.locator('[data-testid="groups-notes-card"]').innerText().catch(() => '');
ok(/Suggest picked/.test(notice) && /5 parts vs 3/.test(notice), `the toolbar says which frame and why: "${notice.replace(/\s+/g, ' ')}"`);
await p.locator('[data-testid="groups-notes-card"]').getByRole('button', { name: 'Go there' }).first().click(); await wait(300);
ok(Math.abs((await time()) - picked) < 40 && await ev(() => window.H.groups.onFrame), 'Go there: the playhead to the picked frame, on the owner\'s click');
// paw-o74b: the list shows the frame on screen's groups (the picked frame's now); 6543984: it is a popover on the bar
await p.click('[data-testid="groups-list-open"]'); await wait(300);
ok(await p.locator('[data-testid="groups-list"] .grp.sug').count() === 5 && await p.locator('[data-testid="groups-list"] .conf').count() === 5, 'every suggestion in the list with a confidence bar');
ok(await p.locator('[data-testid="groups-list"] .conf.tent').count() === 1 && gs.find((g) => g.name === 'c2_tail')?.tentative, 'the low-confidence learned one is tentative');
await p.screenshot({ path: shot });
await p.keyboard.press('Escape'); await wait();
// 6543984: the Seeder line is in the bar's options popover
const seederLine = async () => { await p.click('[data-testid="groups-options"]'); await wait(300); const s = await p.locator('[data-testid="groups-seeder"]').innerText(); return s; };
const sl0 = await seederLine();   // the line's copy since the datasets (paw-855t): "Seeder <dataset> · N frames"
ok(/\b29 frames\b/.test(sl0), 'the Seeder line reports what Suggest\'s head was trained on: ' + sl0);
await p.keyboard.press('Escape'); await wait();
await p.click('[data-testid="groups-list-open"]'); await wait(300);
await p.getByRole('button', { name: 'Accept Bottom head' }).click(); await wait();
let g2 = await groups();
const head = g2.find((g) => g.name === 'c1_head');
ok(head?.source === 'user' && head.score === undefined && g2.filter((g) => g.source !== 'user').length === 4, '✓ accepts one: it is a painted group now (a training label)');
await p.getByRole('button', { name: 'Delete Top tail' }).click(); await wait();
g2 = await groups();
ok(!g2.some((g) => g.name === 'c2_tail') && g2.length === 4, '✕ deletes one');
await p.keyboard.press('Escape'); await wait();   // the list popover
await ev(() => document.activeElement?.blur?.());
await p.mouse.move(5, 5);
await p.keyboard.press('Enter'); await wait();
g2 = await groups();
ok(g2.every((g) => g.source === 'user'), `Enter accepts every remaining suggestion (${g2.map((g) => g.name + ':' + g.source)})`);
await ev(() => window.H.app.undo()); await wait();
ok((await groups()).some((g) => g.source !== 'user'), 'one undo step brings the suggestions back');
await ev(() => window.H.app.redo()); await wait();
const retrain = async () => { if (!(await p.locator('[data-testid="groups-seeder"]').count())) { await p.click('[data-testid="groups-options"]'); await wait(300); } await p.getByRole('button', { name: /Retrain the seeder/ }).click(); };   // 6543984: in the options popover
await retrain(); await wait(300);
ok(await ev(() => !window.H.FAKE.requests.some((r) => r.cmd === 'seed_train')), 'no library (no recent projects, no project file): nothing is sent (a toast says so)');
await ev(() => window.H.app.settings.set('tracking.seeder.folders', ['C:/clips']));
// paw-855t: a fresh dataset (v2) does not learn from projects; the owner's "also learn from projects" on, as before datasets
await ev(async () => { const D = window.H.groups.datasets; await D.ready(); await D.setProjects(D.reg.active, true); });
await retrain(); await wait(500);
const tr = await last('seed_train');
ok(tr?.dir === 'C:\\mock-data\\seeder' && Array.isArray(tr.folders), `Retrain sends seed_train (${JSON.stringify(tr)})`);
const sl1 = await p.locator('[data-testid="groups-seeder"]').innerText();
ok(/\b31 frames\b/.test(sl1), 'the Seeder line shows the new training: ' + sl1);
const n0 = await ev(() => window.H.FAKE.requests.filter((r) => r.cmd === 'seed_train').length);
await ev(() => window.H.app.blocksSaved('C:\\clips\\cfr2997.pawproj')); await wait(600);
const n1 = await ev(() => window.H.FAKE.requests.filter((r) => r.cmd === 'seed_train').length);
ok(n1 === n0 + 1, 'a save with new paint retrains in the background');
await ev(() => window.H.app.blocksSaved('C:\\clips\\cfr2997.pawproj')); await wait(400);
ok(await ev(() => window.H.FAKE.requests.filter((r) => r.cmd === 'seed_train').length) === n1, 'a save without new paint does not');
ok(errors === 0, `no console errors (${errors})`);
await b.close();
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
