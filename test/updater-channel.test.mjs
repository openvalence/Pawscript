// The update channel (paw-tlx6): releases on the public source repo, the passwordless signing key, versions bound to signatures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(root + p, 'utf8');
const REPO = 'openvalence/Pawscript';
// pawscript-updater-auto.key (no password); a new key strands every installed copy, so changing this is deliberate
const KEY_ID = 'F50432A65B3B54A6';

test('tauri.conf.json: the updater reads releases on the public source repo, with the auto key, versions bound', () => {
  const up = JSON.parse(read('src-tauri/tauri.conf.json')).plugins.updater;
  assert.deepEqual(up.endpoints, [`https://github.com/${REPO}/releases/latest/download/latest.json`]);
  assert.doesNotMatch(up.pubkey, /PLACEHOLDER/);
  const pub = Buffer.from(up.pubkey, 'base64').toString('utf8');
  assert.match(pub, new RegExp(`^untrusted comment: minisign public key: ${KEY_ID}\n`));
  assert.equal(up.requireSignedVersion, true);
});

test('build-nas -Release signs with that key, bound to the version, and points latest.json at the same repo', () => {
  const ps = read('dev/share/build-nas.ps1');
  assert.ok(ps.includes(String.raw`Join-Path $env:USERPROFILE '.tauri\pawscript-updater-auto.key'`));
  assert.match(ps, /signer sign @keyArgs --app-version \$Release/);
  assert.ok(ps.includes(`url = "https://github.com/${REPO}/releases/download/v$Release/`));
  assert.ok(read('dev/share/publish-release.ps1').includes(`$Repo = '${REPO}'`));
});
