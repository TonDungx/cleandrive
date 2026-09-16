#!/usr/bin/env node
'use strict';

// Duplicate-finder harness -- runs without Electron.
//   node scripts/test-duplicate.js --fixture        self-check on generated files
//   node scripts/test-duplicate.js "C:\path\to\dir" real run

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { findDuplicates } = require('../src/main/lib/duplicate');
const { formatBytes } = require('../src/main/lib/util');

async function buildFixture() {
  const dir = path.join(os.tmpdir(), 'cleandrive-fixture');
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(path.join(dir, 'nested'), { recursive: true });

  const text = 'x'.repeat(2048);
  await fsp.writeFile(path.join(dir, 'a.txt'), text);
  await fsp.writeFile(path.join(dir, 'nested', 'b.txt'), text); // dup of a.txt
  await fsp.writeFile(path.join(dir, 'c.txt'), 'y'.repeat(2048)); // same size, different bytes

  // 200 KB: big1 == big2. big3 shares the first 64 KB with them but differs at
  // the tail -- it must survive the partial pass and then be rejected by the
  // full hash.
  const head = Buffer.alloc(200 * 1024, 1);
  const tailDiff = Buffer.from(head);
  tailDiff[tailDiff.length - 1] = 2;
  await fsp.writeFile(path.join(dir, 'big1.bin'), head);
  await fsp.writeFile(path.join(dir, 'big2.bin'), head);
  await fsp.writeFile(path.join(dir, 'big3.bin'), tailDiff);

  await fsp.writeFile(path.join(dir, 'tiny.txt'), 'too small'); // under minSize

  return dir;
}

function assert(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
  return ok;
}

(async () => {
  const fixtureMode = process.argv[2] === '--fixture';
  const target = fixtureMode ? await buildFixture() : process.argv[2] || path.join(os.homedir(), 'Downloads');

  console.log(`Scanning for duplicates: ${target}\n`);

  const result = await findDuplicates([target], fixtureMode ? { useCache: false } : {}, {
    onProgress: (p) => {
      process.stdout.write(`\r  ${p.phase.padEnd(16)} indexed=${p.files ?? p.indexedFiles ?? 0} hashed=${p.filesHashed ?? 0}   `);
    },
  });

  process.stdout.write('\r' + ' '.repeat(70) + '\r');

  console.log(`Indexed:        ${result.indexedFiles}`);
  console.log(`Same-size:      ${result.candidatesBySize}`);
  console.log(`After partial:  ${result.candidatesAfterPartial}`);
  console.log(`Files hashed:   ${result.filesHashed} (${formatBytes(result.bytesHashed)})`);
  console.log(`Cache hits:     ${result.cacheHits}`);
  console.log(`Groups:         ${result.totalGroups}`);
  console.log(`Reclaimable:    ${formatBytes(result.reclaimableBytes)}`);
  console.log(`Duration:       ${(result.durationMs / 1000).toFixed(2)}s`);
  console.log(`Errors:         ${result.errorCount}`);

  console.log('\nGroups:');
  for (const g of result.groups.slice(0, 10)) {
    console.log(`  ${formatBytes(g.size)} x${g.count}  waste ${formatBytes(g.wastedBytes)}  [${g.hash.slice(0, 12)}]`);
    for (const f of g.files) console.log(`      ${f.keeper ? 'KEEP' : 'dup '}  ${f.path}`);
  }

  if (fixtureMode) {
    console.log('\nAssertions:');
    const names = result.groups
      .map((g) => g.files.map((f) => path.basename(f.path)).sort())
      .sort((a, b) => a[0].localeCompare(b[0]));
    let ok = true;
    ok &= assert('two groups found', result.totalGroups, 2);
    ok &= assert('group members', names, [['a.txt', 'b.txt'], ['big1.bin', 'big2.bin']]);
    ok &= assert('duplicate file count', result.totalDuplicateFiles, 2);
    ok &= assert('reclaimable bytes', result.reclaimableBytes, 2048 + 200 * 1024);
    ok &= assert('tiny.txt excluded by minSize', result.indexedFiles, 6);
    console.log(ok ? '\nALL PASS' : '\nFAILURES PRESENT');
    process.exit(ok ? 0 : 1);
  }
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
