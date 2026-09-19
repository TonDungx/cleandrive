#!/usr/bin/env node
'use strict';

// Fixture test for the deletion advisor. Builds a tree with one file per rule,
// scans it, and checks each landed in the right bucket.
//   node scripts/test-advisor.js

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { scan } = require('../src/main/lib/scanner');
const { formatBytes } = require('../src/main/lib/util');
const { DAY } = require('../src/main/lib/advisor');
const { render } = require('../src/i18n');

const MB = 1024 * 1024;
const now = Date.now();

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

/** Write a file, optionally sparse, and back-date its timestamps. */
async function make(file, { bytes = 64, ageDays = 0, content = 'x' } = {}) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content);
  if (bytes > content.length) {
    // Sparse -- reports the full size without consuming it on NTFS.
    const handle = await fsp.open(file, 'r+');
    await handle.truncate(bytes);
    await handle.close();
  }
  if (ageDays > 0) {
    const when = new Date(now - ageDays * DAY);
    await fsp.utimes(file, when, when);
  }
}

async function buildFixture() {
  const dir = path.join(os.tmpdir(), 'cleandrive-advisor-fixture');
  await fsp.rm(dir, { recursive: true, force: true });

  await make(path.join(dir, 'Temp', 'leftover.dat'), { bytes: 5 * MB });
  await make(path.join(dir, 'AppData', 'Cache', 'blob.bin'), { bytes: 7 * MB });
  await make(path.join(dir, 'CrashDumps', 'app.dmp'), { bytes: 3 * MB });
  await make(path.join(dir, 'logs', 'old.log'), { bytes: 2 * MB, ageDays: 40 });
  await make(path.join(dir, 'logs', 'today.log'), { bytes: 1 * MB, ageDays: 0 });
  // A real project: the marker file makes obj/ disposable build output.
  await make(path.join(dir, 'project', 'package.json'), { content: '{}' });
  await make(path.join(dir, 'project', 'obj', 'compiled.o'), { bytes: 4 * MB });
  await make(path.join(dir, 'project', 'src', 'main.c'), { bytes: 1 * MB });

  // An installed program, not a project. Its bin/ holds the actual executable
  // and must never be suggested for deletion.
  await make(path.join(dir, 'InstalledApp', 'bin', 'clang.exe'), { bytes: 120 * MB, ageDays: 400 });
  await make(path.join(dir, 'InstalledApp', 'readme.txt'), { bytes: 1024 });

  await make(path.join(dir, 'Downloads', 'setup.exe'), { bytes: 80 * MB, ageDays: 90 });
  await make(path.join(dir, 'Downloads', 'just-grabbed.exe'), { bytes: 80 * MB, ageDays: 2 });
  await make(path.join(dir, 'Downloads', 'notes.txt'), { bytes: 1 * MB, ageDays: 400 });

  await make(path.join(dir, 'backup.iso'), { bytes: 60 * MB, ageDays: 300 });
  await make(path.join(dir, 'forgotten.bin'), { bytes: 150 * MB, ageDays: 200 });
  await make(path.join(dir, 'recent-big.bin'), { bytes: 150 * MB, ageDays: 3 });
  await make(path.join(dir, '~$report.docx'), { bytes: 1024 });
  await make(path.join(dir, 'important.docx'), { bytes: 2 * MB });

  return dir;
}

(async () => {
  const dir = await buildFixture();
  console.log(`Fixture: ${dir}\n`);

  const result = await scan(dir);
  const { cleanup, accessTimes } = result;
  const byCategory = Object.fromEntries(cleanup.groups.map((g) => [g.category, g]));
  const names = (cat) =>
    (byCategory[cat] ? byCategory[cat].files.map((f) => path.basename(f.path)) : []).sort();

  console.log(`Access times tracked: ${accessTimes.tracked}  (${accessTimes.detail})`);
  console.log(`Safe to delete:   ${formatBytes(cleanup.safeBytes)}`);
  console.log(`Worth reviewing:  ${formatBytes(cleanup.reviewBytes)}\n`);

  for (const g of cleanup.groups) {
    console.log(`  [${g.verdict}] ${g.label}: ${formatBytes(g.bytes)} in ${g.count} file(s)`);
    for (const f of g.files) {
      console.log(`        ${path.basename(f.path)} -- ${render(f.reason)}`);
    }
  }

  console.log('\nAssertions:');
  check('temp folder contents flagged', names('temp').includes('leftover.dat'));
  check('editor lock file flagged', names('temp').includes('~$report.docx'));
  check('cache folder flagged', names('cache').includes('blob.bin'));
  check('crash dump flagged', names('crashdump').includes('app.dmp'));
  check('build output flagged next to a project marker', names('buildoutput').includes('compiled.o'));
  check(
    'installed program bin/ NOT called build output',
    !names('buildoutput').includes('clang.exe'),
    names('buildoutput').join(', ')
  );
  check('old log flagged', names('log').includes('old.log'));
  check("today's log NOT flagged", !names('log').includes('today.log'));
  check('stale installer flagged', names('installer').includes('setup.exe'));
  check('fresh installer NOT flagged', !names('installer').includes('just-grabbed.exe'));
  check('large old archive flagged', names('archive').includes('backup.iso'));
  check('large untouched file flagged', names('stale').includes('forgotten.bin'));
  check('large recent file NOT flagged', !names('stale').includes('recent-big.bin'));

  const everything = cleanup.groups.flatMap((g) => g.files.map((f) => path.basename(f.path)));
  check('source file never suggested', !everything.includes('main.c'));
  check('document never suggested', !everything.includes('important.docx'));
  check('small old text file never suggested', !everything.includes('notes.txt'));

  // temp(5MB leftover + 1KB lock) + cache 7 + dump 3 + log 2 + build 4
  check(
    'safe bytes exclude review categories',
    cleanup.safeBytes === (5 + 7 + 3 + 2 + 4) * MB + 1024,
    `${cleanup.safeBytes} bytes`
  );
  check('verdicts ordered safe before review', cleanup.groups[0].verdict === 'safe');
  check(
    'largest-files rows carry a verdict',
    result.largestFiles.every((f) => typeof f.verdict === 'string')
  );
  check(
    'largest-files rows carry an access time',
    result.largestFiles.every((f) => typeof f.atimeMs === 'number')
  );

  await fsp.rm(dir, { recursive: true, force: true });
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
