// Nothing an agent runs may open a window on the owner's desktop (paw-nrm: it pulls them out of a fullscreen game).
// The real app only ever starts through dev/test-app.mjs on the hidden desktop; every Playwright browser is headless.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const scripts = ['dev', 'test', 'tools'].flatMap((d) => readdirSync(d, { recursive: true }).filter((f) => /\.(mjs|js|cjs)$/.test(f)).map((f) => join(d, f)));

test('every chromium.launch is headless: true', () => {
  for (const f of scripts) for (const m of readFileSync(f, 'utf8').matchAll(/chromium\.launch(?:PersistentContext)?\(([^)]*)\)/g)) {
    assert.match(m[1], /headless:\s*true/, `${f}: ${m[0]}`);
  }
});

test('only dev/test-app.mjs starts the app, and only through the hidden-desktop launcher', () => {
  const tauriDev = /['"]tauri['"],\s*['"]dev['"]|tauri(\.js|\))["'`}\s]{0,4}dev|tauri dev --/;
  const starters = scripts.filter((f) => !f.endsWith('no-focus-steal.test.mjs') && tauriDev.test(readFileSync(f, 'utf8')));
  assert.deepEqual(starters, [join('dev', 'test-app.mjs')]);
  const src = readFileSync('dev/test-app.mjs', 'utf8');
  assert.match(src, /onHiddenDesktop\(`[^`]*\$\{q\(tauri\)\} dev /);
  assert.doesNotMatch(src, /shell:\s*true/);
});

test('the hidden-desktop launcher compiles with the in-box C# compiler', { skip: process.platform !== 'win32' }, () => {
  const csc = join(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const d = mkdtempSync(join(tmpdir(), 'hd-')), out = join(d, 'hidden-desktop.exe');
  try {
    const r = spawnSync(csc, ['/nologo', '/target:winexe', '/out:' + out, resolve('dev/hidden-desktop.cs')], { encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(existsSync(out));
  } finally { rmSync(d, { recursive: true, force: true }); }
});
