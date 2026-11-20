// An undeclared name in a Svelte template (or script) compiles and only throws when that branch renders: 145370e left
// `secs(...)` in SceneQuickBar's modifier chips, so adding a modifier from the Scene chip crashed the chips row
// ("[lane timeline.chips] ReferenceError: secs is not defined", dev/scene-mods-check.mjs). Every component under src/ is
// compiled and each identifier it reads must be declared somewhere in its module (crude: scopes are not followed) or be a
// browser / JS global.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';
import { parse } from 'acorn';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const files = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? files(p) : n.endsWith('.svelte') ? [p] : []; });
const GLOBALS = new Set([...Object.getOwnPropertyNames(globalThis), 'window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'getComputedStyle',
  'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver', 'MutationObserver', 'HTMLElement', 'Element', 'Node', 'CSS', 'matchMedia',
  'devicePixelRatio', 'innerWidth', 'innerHeight', 'addEventListener', 'removeEventListener', 'getSelection', 'Image', 'ImageData', 'OffscreenCanvas', 'Path2D',
  'DOMRect', 'DOMMatrix', 'KeyboardEvent', 'PointerEvent', 'MouseEvent', 'WheelEvent', 'DragEvent', 'FileReader', 'createImageBitmap', 'HTMLCanvasElement',
  'HTMLVideoElement', 'HTMLInputElement', 'CanvasRenderingContext2D', 'screen', 'scrollX', 'scrollY', 'open', 'alert', 'confirm', 'prompt', 'getAnimations',
  'VideoFrame', 'VideoDecoder', 'EncodedVideoChunk', 'AudioContext', 'OfflineAudioContext', 'Worker', 'Blob', 'URL', 'indexedDB', 'caches', 'self',
  'ClipboardItem', 'DataTransfer', 'Notification', 'customElements', 'visualViewport', 'outerWidth', 'outerHeight', 'history', 'arguments', 'undefined', 'NaN', 'Infinity']);

/** Identifiers read by `code` that nothing in it declares. */
function undeclared(code) {
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  const decl = new Set(), used = new Map();
  const bind = (p) => { if (!p) return; if (p.type === 'Identifier') decl.add(p.name); else if (p.type === 'ObjectPattern') p.properties.forEach((q) => bind(q.type === 'RestElement' ? q.argument : q.value)); else if (p.type === 'ArrayPattern') p.elements.forEach(bind); else if (p.type === 'AssignmentPattern') bind(p.left); else if (p.type === 'RestElement') bind(p.argument); };
  const walk = (n, parent, key) => {
    if (!n || typeof n.type !== 'string' || n.type === 'MetaProperty') return;   // import.meta
    switch (n.type) {
      case 'VariableDeclarator': bind(n.id); break;
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': if (n.id) decl.add(n.id.name); n.params.forEach(bind); break;
      case 'ClassDeclaration': case 'ClassExpression': if (n.id) decl.add(n.id.name); break;
      case 'ImportSpecifier': case 'ImportDefaultSpecifier': case 'ImportNamespaceSpecifier': decl.add(n.local.name); break;
      case 'CatchClause': bind(n.param); break;
      case 'LabeledStatement': decl.add(n.label.name); break;
      case 'Identifier': {
        const prop = (parent?.type === 'MemberExpression' && key === 'property' && !parent.computed) || ((parent?.type === 'Property' || parent?.type === 'MethodDefinition' || parent?.type === 'PropertyDefinition') && key === 'key' && !parent.computed)
          || parent?.type === 'BreakStatement' || parent?.type === 'ContinueStatement' || parent?.type === 'ExportSpecifier' || (parent?.type === 'ImportSpecifier' && key === 'imported');
        if (!prop && !used.has(n.name)) used.set(n.name, n.start);
        break;
      }
    }
    for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach((c) => walk(c, n, k)); else if (v && typeof v.type === 'string') walk(v, n, k); }
  };
  walk(ast, null, null);
  return [...used.keys()].filter((k) => !decl.has(k) && !GLOBALS.has(k) && !k.startsWith('$'));
}

test('every Svelte component under src/ reads only names it declares (or globals)', () => {
  const bad = [];
  for (const f of files(SRC)) {
    const { js } = compile(readFileSync(f, 'utf8'), { filename: f, generate: 'client', dev: false });
    const u = undeclared(js.code);
    if (u.length) bad.push(`${f.slice(SRC.length + 1)}: ${u.join(', ')}`);
  }
  assert.deepEqual(bad, []);
});
