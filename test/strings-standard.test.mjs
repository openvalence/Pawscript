// The mechanical half of the OpenValence string standard on Pawscript's user-visible literals (docs/copy.md points to
// the rules: Nucleus .claude/rules/strings.md, governance.md C-11, Phosphor docs/COPY.md). Static: it reads src/ as
// text, like Phosphor's test/copy-lint.mjs, so a literal is checked wherever it sits.
//
// Constraints:
// - Only string LITERALS are checked; a template's static chunks one by one, so a chunk's length is a floor on the
//   rendered length. Text bound from a variable is checked where it is written, if it is written as a tip / toast.
// - A literal with no space and no letters run (an id, a key, a CSS value) is not text and is skipped.
// - '\n' splits a tip into lines (a readout's detail, one fragment a line: COPY.md rule 11); each line is checked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Folders left out of the scan while their strings are being rebuilt (none now). Remove an entry once its strings pass.
const PENDING_DIRS = [];
// Legitimate exceptions, by file and the literal's text (a substring is enough).
const ALLOW = [
  ['src/features/video/Transport.svelte', '#120 or 120f = frame'],        // a syntax cheat sheet, not a sentence
];

function walk(d, out = []) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) { if (!/^(vendor|_demo|_gallery|fonts|docs)$/.test(n)) walk(p, out); }
    else if (/\.(svelte|js)$/.test(n)) out.push(p);
  }
  return out;
}
function skipString(s, i) {
  const q = s[i];
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (q === '`' && s[j] === '$' && s[j + 1] === '{') { j = scan(s, j + 2).end; continue; }
    if (s[j] === q) return j;
  }
  return s.length;
}
/** The literals of the expression starting at i, up to a depth-0 `,` `;` or closing bracket. */
function scan(s, i) {
  const lits = [];
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '/' && s[j + 1] === '/') { j = s.indexOf('\n', j); if (j < 0) return { lits, end: s.length }; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const e = skipString(s, j), body = s.slice(j + 1, e);
      if (c === '`') lits.push(...body.split(/\$\{(?:[^{}]|\{[^{}]*\})*\}/));
      else lits.push(body.replace(/\\(['"\\])/g, '$1'));
      j = e; continue;
    }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { if (depth-- === 0) return { lits, end: j }; }
    else if (depth === 0 && (c === ',' || c === ';')) return { lits, end: j };
  }
  return { lits, end: s.length };
}
const isText = (t) => / /.test(t.trim()) || /^[A-Z][a-z]{2,}/.test(t.trim());

/** Every user-visible literal: {file, line, kind: 'tip' | 'title' | 'toast', text}. */
function collect() {
  const out = [];
  for (const f of walk(join(ROOT, 'src'))) {
    const rel = relative(ROOT, f).replace(/\\/g, '/');
    if (PENDING_DIRS.some((d) => rel.startsWith(d))) continue;
    const s = readFileSync(f, 'utf8');
    const registry = /(^|\/)(core-)?commands(-[a-z]+)?\.js$/.test(rel);
    const pats = [
      ['tip', /tooltip\(/g, 'call'], ['tip', /\btip:\s*/g, 'val'], ['tip', /\stip=/g, 'attr'], ['tip', /\splaceholder=/g, 'attr'],
      ['toast', /\btoast\(/g, 'call'],
      ...(registry ? [['title', /\btitle:\s*/g, 'val']] : []),
    ];
    for (const [kind, re, how] of pats) {
      for (let m; (m = re.exec(s));) {
        const at = m.index + m[0].length;
        let lits;
        if (how === 'attr') {
          if (s[at] === '"') lits = s.slice(at + 1, s.indexOf('"', at + 1)).split(/\{[^}]*\}/);
          else if (s[at] === '{') lits = scan(s, at + 1).lits;
          else continue;
        } else lits = scan(s, at).lits;
        const line = s.slice(0, m.index).split('\n').length;
        for (const l of lits) for (const t of l.split(/\\n|\n/)) {
          if (!isText(t) || ALLOW.some(([af, at2]) => af === rel && t.includes(at2))) continue;
          out.push({ file: rel, line, kind, text: t.trim() });
        }
      }
    }
  }
  return out;
}
const ITEMS = collect();
const where = (i) => `${i.file}:${i.line} [${i.kind}] "${i.text}"`;
const fail = (bad, rule) => assert.ok(!bad.length, `${bad.length} string(s) break ${rule}:\n${bad.map(where).join('\n')}`);

test('the scan finds the registry, the tips and the toasts', () => {
  for (const k of ['tip', 'title', 'toast']) assert.ok(ITEMS.filter((i) => i.kind === k).length > 50, k);
});

// Phosphor docs/COPY.md rule 10: over 60 characters fails. Command titles are menu and palette labels: same bar.
test('COPY.md 10: a tooltip, placeholder or command title is at most 60 characters', () => {
  fail(ITEMS.filter((i) => i.kind !== 'toast' && i.text.length > 60), 'COPY.md rule 10 (60 characters)');
});

// COPY.md rules 2 and 10: one fragment, no second sentence ('. ').
test('COPY.md 2/10: a tooltip, placeholder or command title has no second sentence', () => {
  fail(ITEMS.filter((i) => i.kind !== 'toast' && /[a-z)]\. \S/.test(i.text)), 'COPY.md rules 2 and 10 (". ")');
});

// COPY.md rule 3: no trailing period.
test('COPY.md 3: a tooltip or command title has no trailing period', () => {
  fail(ITEMS.filter((i) => i.kind !== 'toast' && /[a-z)]\.$/.test(i.text)), 'COPY.md rule 3 (trailing period)');
});

// COPY.md rule 10's story words, and strings.md "Everywhere": no filler ("successfully", "please", "simply", "just").
test('COPY.md 10 / strings.md Everywhere: no story or filler words', () => {
  const re = /\b(so that|allows you|in order to|simply|just|please|successfully)\b/i;
  fail(ITEMS.filter((i) => re.test(i.text)), 'COPY.md rule 10 / strings.md Everywhere (story and filler words)');
});

// strings.md "Everywhere": no em dashes; never the word "AI".
test('strings.md Everywhere: no em dash, never the word "AI"', () => {
  fail(ITEMS.filter((i) => /\u2014|\bAI\b/.test(i.text)), 'strings.md Everywhere (em dash, "AI")');
});

// strings.md "Everywhere": plain words over internal names; code-internal words and records never reach a user.
test('strings.md Everywhere: no internal names, issue ids or owner quotes', () => {
  const re = /\b(sidecar|pawtrack|paw-[a-z0-9]{3,}(\.\d+)?)\b|\bowner\b/i;
  fail(ITEMS.filter((i) => re.test(i.text)), 'strings.md Everywhere (internal names)');
});

// governance.md C-11: American spellings in UI strings.
test('C-11: American spelling', () => {
  const re = /\b(colou?rs?\b(?<=colours?)|colourway|behaviour|neighbour|centre[ds]?|grey(ed)?|licence|cancell(ed|ing)|labell(ed|ing)|unlabelled|travell(ed|ing)|modell(ed|ing)|favourites?|catalogue|honour|metres?|[a-z]*(is(e|ed|es|ing|ation))\b(?<=(normal|initial|optim|maxim|minim|recogn|organ|summar|synchron|visual|prioriti|custom|serial|stabil|real|util|analy|categor|capital|special|author|emphas|finali|neutral|random)is(e|ed|es|ing|ation)))/i;
  fail(ITEMS.filter((i) => re.test(i.text)), 'governance.md C-11 (American English)');
});
