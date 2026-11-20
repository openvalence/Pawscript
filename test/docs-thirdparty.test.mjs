// Root docs stay in sync with the manifests and the About dialog (README "Privacy", THIRD-PARTY.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(root + p, 'utf8');

test('THIRD-PARTY.md names every package.json dependency', () => {
  const pkg = JSON.parse(read('package.json'));
  const doc = read('THIRD-PARTY.md');
  const names = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})];
  assert.ok(names.length > 0);
  for (const n of names) assert.ok(doc.includes('`' + n + '`'), `THIRD-PARTY.md is missing npm package ${n}`);
});

test('THIRD-PARTY.md names every src-tauri/Cargo.toml dependency', () => {
  const toml = read('src-tauri/Cargo.toml');
  const doc = read('THIRD-PARTY.md');
  // crate names at the start of a line inside [dependencies] / [build-dependencies] tables
  const names = [];
  let inDeps = false;
  for (const line of toml.split('\n')) {
    const sec = line.match(/^\[([^\]]+)\]/);
    if (sec) { inDeps = /dependencies$/.test(sec[1]); continue; }
    const m = inDeps && line.match(/^([A-Za-z0-9_-]+)\s*=/);
    if (m) names.push(m[1]);
  }
  assert.ok(names.includes('tauri') && names.includes('tauri-build'));
  for (const n of names) assert.ok(doc.includes('`' + n + '`'), `THIRD-PARTY.md is missing crate ${n}`);
});

test('README privacy section matches the About dialog', () => {
  const about = read('src/app/core-commands.js').match(/No telemetry: online only when you ask, to download models or check for an update\./);
  assert.ok(about, 'About dialog sentence moved: update this test and README.md');
  const readme = read('README.md');
  const privacy = readme.slice(readme.indexOf('## Privacy'));
  assert.ok(privacy.includes(about[0]), 'README "Privacy" must quote the About dialog sentence');
  // The "Where the app writes" table in API.md is the source of truth; README must carry every row of it.
  const api = read('src-tauri/API.md');
  const table = api.slice(api.indexOf('## Where the app writes'));
  const rows = table.split('\n').filter((l) => /^\| .* \| `/.test(l) && !l.startsWith('| What'));
  assert.ok(rows.length >= 8, 'API.md table shape changed');
  for (const r of rows) {
    const what = r.split('|')[1].trim();
    assert.ok(privacy.includes('| ' + what + ' |'), `README is missing the "${what}" row from API.md`);
  }
});
