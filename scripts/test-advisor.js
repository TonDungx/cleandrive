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
  // A real project. What makes obj/ disposable build output is the project's
  // own .gitignore naming it -- a marker file beside it is not enough, and
  // the vendored library below is why.
  await make(path.join(dir, 'project', 'package.json'), { content: '{}' });
  await make(path.join(dir, 'project', '.gitignore'), { content: ['node_modules/', 'obj', '*.pyc'].join('\n') });
  await make(path.join(dir, 'project', 'obj', 'compiled.o'), { bytes: 4 * MB });
  await make(path.join(dir, 'project', 'src', 'main.c'), { bytes: 1 * MB });

  // A vendored library inside that same project: a `dist` with a
  // `package.json` beside it, exactly like the folder the old rule read, and
  // committed to the repository rather than produced by it. Measured on this
  // machine before the rule changed: 774 files, 43.7 MB of Bootstrap, echarts
  // and Chart.js in a real project's `static\vendors` were called build
  // output, and an unattended run with build output enabled would have taken
  // 400 of them.
  await make(path.join(dir, 'project', 'vendors', 'bootstrap', 'package.json'), { content: '{}' });
  await make(path.join(dir, 'project', 'vendors', 'bootstrap', 'dist', 'bootstrap.min.css'), { bytes: 6 * MB });

  // A project whose only marker is a requirements.txt, which is not on the
  // marker list, and whose .gitignore says plainly what dist/ is. This is
  // `D:\work\tow_tool` on the machine this was written on: 222 MB of
  // PyInstaller output, with a comment above the line explaining it.
  await make(path.join(dir, 'pyproject', 'requirements.txt'), { content: 'requests' });
  await make(path.join(dir, 'pyproject', '.gitignore'), { content: ['# PyInstaller', 'dist/', '*.mat-khau.yaml'].join('\n') });
  await make(path.join(dir, 'pyproject', 'dist', 'app.exe'), { bytes: 9 * MB });
  // Ignored, precious, and not a build-output name: it must stay untouched.
  await make(path.join(dir, 'pyproject', 'secrets.mat-khau.yaml'), { bytes: 2048 });

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
  /** Every file the advisor suggested at all, in any category. */
  const all = () => cleanup.groups.flatMap((g) => g.files.map((f) => path.basename(f.path)));

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
  check('build output flagged when the project .gitignore names the folder', names('buildoutput').includes('compiled.o'));
  check(
    'a vendored library dist/ is NOT build output, though a package.json sits beside it',
    !names('buildoutput').includes('bootstrap.min.css'),
    names('buildoutput').join(', ')
  );
  check(
    'build output found with no marker file at all, because .gitignore says so',
    names('buildoutput').includes('app.exe'),
    names('buildoutput').join(', ')
  );
  check(
    'an ignored file that is not a build folder is never suggested',
    !all().includes('secrets.mat-khau.yaml'),
    'a .gitignore lists secrets precisely because they are not committed'
  );
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

  // temp(5MB leftover + 1KB lock) + cache 7 + dump 3 + log 2 + the two build
  // folders a .gitignore declares: project/obj 4, pyproject/dist 9. Bootstrap's
  // vendored dist/ is 6 MB and is deliberately not among them.
  check(
    'safe bytes exclude review categories',
    cleanup.safeBytes === (5 + 7 + 3 + 2 + 4 + 9) * MB + 1024,
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
