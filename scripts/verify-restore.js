#!/usr/bin/env node
'use strict';

// The Restore Center against the real Recycle Bin, with throwaway files.
//
//   npm run verify:restore      (Electron; clear ELECTRON_RUN_AS_NODE first)
//
// smoke.js already puts files back from the real bin through the window. This
// covers what it cannot reach there: "replace", where the file in the way goes
// to the real Recycle Bin through shell.trashItem before the old one takes its
// place, and whether Windows' own view of the bin -- the one Explorer shows --
// agrees afterwards that the restored items are gone from it.
//
// Isolated: userData is a temporary folder, the journal lives inside it, and
// the harness checks both before it touches anything.

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { app, shell } = require('electron');

const SANDBOX = path.join(os.tmpdir(), `cleandrive-verify-restore-${process.pid}`);
app.setName(require('../package.json').name);
app.setPath('userData', SANDBOX);

const { ActionJournal } = require('../src/main/journal/journal');
const { execute } = require('../src/main/actions/execute');
const restore = require('../src/main/actions/restore');
const { findUserBins, listItems } = require('../src/main/lib/recyclebin');
const { pathKey } = require('../src/main/lib/util');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const read = (p) => fsp.readFile(p, 'utf8').catch(() => null);

/** The names Windows' own Recycle Bin view shows for items deleted from `folder`. */
function shellView(folder) {
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script =
    `$b=(New-Object -ComObject Shell.Application).Namespace(10);` +
    `$n=@();foreach($i in $b.Items()){if($i.ExtendedProperty('System.Recycle.DeletedFrom') -eq '${folder.replace(/'/g, "''")}'){$n+=$i.Name}};` +
    `ConvertTo-Json -InputObject @($n) -Compress`;
  return new Promise((resolve) => {
    execFile(ps, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 60000 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        resolve(JSON.parse(String(stdout).trim() || '[]'));
      } catch {
        resolve(null);
      }
    });
  });
}

app.whenReady().then(async () => {
  console.log('\nverify: the Restore Center against the real Recycle Bin\n');

  const journalDir = path.join(app.getPath('userData'), 'journal');
  check('isolated: userData is the sandbox, not the real profile', pathKey(app.getPath('userData')) === pathKey(SANDBOX),
    app.getPath('userData'));
  const journal = new ActionJournal(journalDir);

  // Not under AppData or Temp's own cleanup: a folder of its own in the home
  // directory, removed at the end.
  const base = path.join(os.homedir(), `cleandrive-verify-restore-${process.pid}`);
  await fsp.mkdir(base, { recursive: true });
  const files = ['plain.txt', 'in-the-way.txt'].map((name) => path.join(base, name));
  for (const f of files) await fsp.writeFile(f, `original ${path.basename(f)}\n`);

  // Recycled the way the app recycles: the pipeline, the real shell, journalled.
  const recycled = await execute({ kind: 'recycle', items: files }, { journal, deps: {} });
  check('both went to the real Recycle Bin', recycled.moved.length === 2, `${recycled.moved.length} moved`);
  const session = (await journal.sessions()).find((s) => s.kind === 'recycle');

  const before = await shellView(base);
  check('Windows\' own view of the bin lists them', Array.isArray(before) && before.length === 2, JSON.stringify(before));

  // A new file appears where one of them was.
  await fsp.writeFile(files[1], 'made since\n');

  const ids = session.items.map((_, i) => `${session.id}:${i}`);
  let asked = null;
  const out = await execute({ kind: 'restore', items: ids }, {
    journal,
    deps: { journal },
    confirm: async (description) => {
      asked = description;
      return { approved: true, options: { onConflict: 'replace' } };
    },
  });
  check('the confirmation was told one of them has something in its way', asked && asked.count === 2 && asked.conflicts === 1,
    JSON.stringify(asked && { count: asked.count, conflicts: asked.conflicts }));
  check('both are back where they were', out.moved.length === 2 &&
    (await read(files[0])) === 'original plain.txt\n' && (await read(files[1])) === 'original in-the-way.txt\n',
    JSON.stringify(out.failed));

  const bins = await findUserBins([base]);
  const binNow = (await listItems(bins)).filter((i) => pathKey(path.dirname(i.originalPath)) === pathKey(base));
  check('the file that was in the way is in the real Recycle Bin, not deleted',
    binNow.length === 1 && (await read(binNow[0].dataPath)) === 'made since\n', `${binNow.length} in the bin`);

  const displaced = (await journal.sessions()).find((s) => s.kind === 'recycle' && s.source === 'restore');
  check('and the journal has it as a recycle session of its own', displaced && displaced.items.length === 1);
  const states = displaced ? await restore.listItems(journal, displaced.id) : [];
  check('which the Restore Center offers to put back', states.length === 1 && states[0].state === 'inBin',
    states[0] && states[0].state);

  const after = await shellView(base);
  check('Windows\' own view agrees: only the displaced file is left in the bin',
    Array.isArray(after) && after.length === 1 && after[0] === 'in-the-way.txt', JSON.stringify(after));

  // Tidy: the displaced file out of the bin, the folder and the sandbox gone.
  for (const item of binNow) {
    await fsp.rm(item.dataPath, { force: true });
    await fsp.rm(item.metaPath, { force: true });
  }
  await fsp.rm(base, { recursive: true, force: true });
  await fsp.rm(SANDBOX, { recursive: true, force: true });

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  app.exit(failures === 0 ? 0 : 1);
}).catch((err) => {
  console.error('FAILED:', err);
  app.exit(1);
});
