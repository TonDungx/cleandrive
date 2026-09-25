'use strict';

// A stand-in for System32\reg.exe, in memory, for the tests that must not
// write the real registry (test-contextmenu.js, test-explorer.js).
//
// It answers the three commands src/main/lib/context-menu.js uses -- import,
// export, query -- and writes an export the way the real one does:
// UTF-16 LE with a byte-order mark, a header line, each key in brackets, its
// values as "name"="value" with \\ and \" escaped, and the default value as @.
// That shape is taken from a real `reg export` of a harness key,
// scripts/fixtures/context-menu/export-directory.reg.txt, which
// test-contextmenu.js reads back through the same parser as this output.
//
// Constructed: this is not reg.exe. What real reg.exe does with the same
// files is verify-contextmenu.js's question.

const fs = require('node:fs');

const unescape = (s) => s.replace(/\\(.)/g, '$1');
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

function createFakeReg({ failImport = false } = {}) {
  /** key (as written, case kept) -> { name: value } ('' is the default) */
  const keys = new Map();
  const calls = [];
  const find = (key) => [...keys.keys()].find((k) => k.toLowerCase() === key.toLowerCase());

  function importText(text) {
    let current = null;
    for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
      const line = raw.trimEnd();
      const del = /^\[-(.+)\]$/.exec(line);
      if (del) {
        const prefix = del[1].toLowerCase();
        for (const k of [...keys.keys()]) {
          if (k.toLowerCase() === prefix || k.toLowerCase().startsWith(`${prefix}\\`)) keys.delete(k);
        }
        current = null;
        continue;
      }
      const head = /^\[(.+)\]$/.exec(line);
      if (head) {
        const existing = find(head[1]);
        current = existing || head[1];
        if (!existing) keys.set(current, {});
        continue;
      }
      const value = /^(@|"((?:[^"\\]|\\.)*)")="((?:[^"\\]|\\.)*)"$/.exec(line);
      if (value && current) keys.get(current)[value[1] === '@' ? '' : unescape(value[2])] = unescape(value[3]);
    }
  }

  function exportText(key) {
    const lower = key.toLowerCase();
    const mine = [...keys.keys()].filter((k) => k.toLowerCase() === lower || k.toLowerCase().startsWith(`${lower}\\`)).sort();
    if (!mine.length) return null;
    const lines = ['Windows Registry Editor Version 5.00', ''];
    for (const k of mine) {
      lines.push(`[${k}]`);
      const values = keys.get(k);
      if ('' in values) lines.push(`@="${esc(values[''])}"`);
      for (const [name, v] of Object.entries(values)) if (name !== '') lines.push(`"${name}"="${esc(v)}"`);
      lines.push('');
    }
    return `${lines.join('\r\n')}\r\n`;
  }

  async function run(args) {
    calls.push(args);
    const [verb] = args;
    if (verb === 'import') {
      if (failImport) return { ok: false, code: 1, stdout: '', stderr: 'ERROR: Access is denied.' };
      importText(fs.readFileSync(args[1]).toString('utf16le'));
      return { ok: true, code: 0, stdout: 'The operation completed successfully.', stderr: '' };
    }
    if (verb === 'export') {
      const text = exportText(args[1]);
      if (text === null) return { ok: false, code: 1, stdout: '', stderr: 'ERROR: The system was unable to find the specified registry key or value.' };
      fs.writeFileSync(args[2], Buffer.from(`﻿${text}`, 'utf16le'));
      return { ok: true, code: 0, stdout: 'The operation completed successfully.', stderr: '' };
    }
    if (verb === 'query') {
      return find(args[1]) ? { ok: true, code: 0, stdout: args[1], stderr: '' } : { ok: false, code: 1, stdout: '', stderr: 'ERROR' };
    }
    return { ok: false, code: 1, stdout: '', stderr: `fake reg: ${verb} is not a command the app uses` };
  }

  return { run, keys, calls };
}

module.exports = { createFakeReg };
