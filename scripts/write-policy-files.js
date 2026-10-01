#!/usr/bin/env node
'use strict';

// Write the Group Policy files (H2) into policy/ from src/main/policy/admx.js.
//
//   npm run policy:files
//
// They are checked in so an administrator can take them from the repository
// or a release without installing anything, and scripts/test-policy.js fails
// when what is checked in differs by one byte from what the code would write
// -- run this after changing a policy's wording or its schema.

const fs = require('node:fs');
const path = require('node:path');

const { files } = require('../src/main/policy/admx');

const OUT = path.join(__dirname, '..', 'policy');

let changed = 0;
for (const [rel, text] of Object.entries(files())) {
  const file = path.join(OUT, ...rel.split('/'));
  const bytes = Buffer.from(text, 'utf8');
  const before = fs.existsSync(file) ? fs.readFileSync(file) : null;
  if (before && before.equals(bytes)) {
    console.log(`same     policy/${rel}`);
    continue;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  changed += 1;
  console.log(`written  policy/${rel}  (${bytes.length} bytes)`);
}
console.log(changed === 0 ? '\nNothing to change.' : `\n${changed} file(s) written.`);
