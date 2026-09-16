#!/usr/bin/env node
'use strict';

// Standalone scanner harness -- runs without Electron.
//   node scripts/test-scanner.js "C:\Users\me\Desktop"

const os = require('node:os');
const path = require('node:path');
const { scan } = require('../src/main/lib/scanner');
const { formatBytes } = require('../src/main/lib/util');

const target = process.argv[2] || path.join(os.homedir(), 'Desktop');

(async () => {
  console.log(`Scanning: ${target}\n`);

  const result = await scan(
    target,
    {},
    {
      onProgress: (p) => {
        process.stdout.write(
          `\r  ${p.files.toLocaleString()} files  ${formatBytes(p.bytes).padEnd(10)} ${(p.elapsedMs / 1000).toFixed(1)}s   `
        );
      },
    }
  );

  process.stdout.write('\r' + ' '.repeat(60) + '\r');

  console.log(`Total:    ${formatBytes(result.totalSize)}`);
  console.log(`Files:    ${result.totalFiles.toLocaleString()}`);
  console.log(`Folders:  ${result.totalDirs.toLocaleString()}`);
  console.log(`Duration: ${(result.durationMs / 1000).toFixed(2)}s`);
  console.log(`Errors:   ${result.errorCount}`);

  console.log('\nTop folders:');
  for (const f of result.topFolders.slice(0, 10)) {
    console.log(`  ${formatBytes(f.size).padStart(10)}  ${f.percent.toFixed(1).padStart(5)}%  ${f.name}`);
  }

  console.log('\nBy type:');
  for (const t of result.byType.slice(0, 8)) {
    console.log(`  ${formatBytes(t.size).padStart(10)}  ${String(t.count).padStart(6)} files  .${t.ext}`);
  }

  console.log('\nLargest files:');
  for (const f of result.largestFiles.slice(0, 5)) {
    console.log(`  ${formatBytes(f.size).padStart(10)}  ${f.path}`);
  }

  const { cleanup, accessTimes } = result;
  console.log(`\nAccess times: ${accessTimes.tracked} — ${accessTimes.detail}`);
  console.log(`Safe to delete:  ${formatBytes(cleanup.safeBytes)}`);
  console.log(`Worth reviewing: ${formatBytes(cleanup.reviewBytes)}`);

  for (const g of cleanup.groups) {
    console.log(`\n  [${g.verdict}] ${g.label} — ${formatBytes(g.bytes)} in ${g.count} file(s)`);
    console.log(`      ${g.hint}`);
    for (const f of g.files.slice(0, 4)) {
      console.log(`      ${formatBytes(f.size).padStart(9)}  ${path.basename(f.path)}  — ${f.reason}`);
    }
  }

  if (cleanup.protectedPaths.length) {
    console.log(`\nNever deleted (${cleanup.protectedPaths.length} locations):`);
    for (const p of cleanup.protectedPaths.slice(0, 6)) console.log(`      ${p.path}  — ${p.reason}`);
  }

  if (result.errorCount) {
    console.log('\nFirst errors:');
    for (const e of result.errors.slice(0, 3)) console.log(`  [${e.code}] ${e.path}`);
  }
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
