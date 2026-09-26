'use strict';

// What the Recycle Bin does on a drive plugged in from outside (A4).
//
//   npx electron scripts/verify-external-drive.js -- --drive F:
//
// A4 lets the app act on an external disk as on an internal one, and keeps a
// removable drive read only, on the strength of what this measures: a file of
// the harness's own on that drive, sent to the Recycle Bin by the same call
// the app makes (Electron's shell.trashItem), and afterwards -- is it still
// where it was, is there a Recycle Bin record naming it on that drive, and is
// the data half of that record there. Then what the app's own vetting says
// about the drive.
//
// It touches only X:\cleandrive-harness-<hex>\ and its own Recycle Bin
// records, and removes both. It refuses to run without --drive, on the drive
// Windows is on, and on any drive Windows does not list as ready.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { app, shell } = require('electron');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-verify-external-')));

const volumes = require('../src/main/lib/volumes');
const { planTrash } = require('../src/main/lib/trash');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
};
const note = (label, detail = '') => console.log(`  ----  ${label}${detail ? `  -- ${detail}` : ''}`);

const arg = process.argv.indexOf('--drive');
const wanted = arg > 0 ? String(process.argv[arg + 1] || '').toUpperCase().replace(/[:\\]+$/, '') : '';

const SYS32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms))]);

/** $I records on a drive's bin for this user: { name, size, original }. */
function binRecords(binDir) {
  const out = [];
  let names = [];
  try {
    names = fs.readdirSync(binDir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.startsWith('$I')) continue;
    try {
      const buf = fs.readFileSync(path.join(binDir, name));
      const version = buf.readBigUInt64LE(0);
      const size = Number(buf.readBigUInt64LE(8));
      const start = version === 2n ? 28 : 24;
      const len = version === 2n ? buf.readUInt32LE(24) : 260;
      out.push({ name, size, original: buf.toString('utf16le', start, start + len * 2).replace(/\0.*$/, '') });
    } catch {}
  }
  return out;
}

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  let dir = null;
  let binDir = null;
  let tag = null;
  try {
    if (!/^[A-Z]$/.test(wanted)) throw new Error('say which drive: --drive F:');
    const systemDrive = (process.env.SystemDrive || 'C:').slice(0, 1).toUpperCase();
    if (wanted === systemDrive) throw new Error(`${wanted}: is the drive Windows is on; this is for a drive plugged in from outside`);

    const listing = await volumes.list({ fresh: true });
    const drive = listing.drives.find((d) => d.letter === wanted);
    if (!drive || !drive.fileSystem) throw new Error(`${wanted}: is not a ready drive Windows lists (${listing.drives.map((d) => d.letter).join(', ')})`);
    const info = volumes.describe(`${wanted}:\\`, listing.drives);

    console.log(`\nThe drive, as Windows lists it:`);
    note(`${wanted}: type ${drive.type}, file system ${drive.fileSystem}, bus ${drive.bus}, label ${drive.label || '(none)'}`,
      `${(drive.freeBytes / 1e9).toFixed(1)} GB free of ${(drive.totalBytes / 1e9).toFixed(1)} GB`);
    note(`the app calls it: kind ${info.kind}, external ${info.external}, read only ${info.readOnly || 'no'}`);
    if (drive.freeBytes < 16 * 1024 * 1024) throw new Error('less than 16 MB free; nothing written');

    tag = crypto.randomBytes(4).toString('hex');
    dir = `${wanted}:\\cleandrive-harness-${tag}`;
    fs.mkdirSync(dir);
    const file = path.join(dir, `probe-${tag}.bin`);
    const body = crypto.randomBytes(1024 * 1024);
    fs.writeFileSync(file, body);
    const sid = execFileSync(path.join(SYS32, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' }).trim().split(',').pop().replace(/"/g, '');
    binDir = `${wanted}:\\$Recycle.Bin\\${sid}`;

    console.log('\nThe Recycle Bin, asked the way the app asks it:');
    const t0 = Date.now();
    let outcome;
    try {
      await withTimeout(shell.trashItem(file), 30000);
      outcome = 'resolved';
    } catch (err) {
      outcome = `rejected: ${err.message}`;
    }
    const ms = Date.now() - t0;
    const stillThere = fs.existsSync(file);
    const mine = binRecords(binDir).filter((r) => r.original.toLowerCase() === file.toLowerCase());
    const dataHalf = mine.length === 1 && fs.existsSync(path.join(binDir, `$R${mine[0].name.slice(2)}`));
    const sameBytes = dataHalf && crypto.createHash('sha256').update(fs.readFileSync(path.join(binDir, `$R${mine[0].name.slice(2)}`))).digest('hex')
      === crypto.createHash('sha256').update(body).digest('hex');
    note(`shell.trashItem ${outcome} in ${ms} ms`);
    note(`the file is still where it was: ${stillThere}`);
    note(`bin records on ${wanted}: naming it: ${mine.length}${mine.map((r) => ` [${r.name}, ${r.size} B]`).join('')}; data half there: ${dataHalf}; same bytes: ${sameBytes}`);

    const verdict = outcome === 'resolved' && !stillThere && dataHalf && sameBytes
      ? 'recycled'
      : !stillThere && mine.length === 0
        ? 'DELETED PERMANENTLY'
        : stillThere
          ? 'refused, nothing changed'
          : 'unclear';
    console.log(`\nResult on ${wanted}: (${drive.fileSystem}, ${drive.type}, ${drive.bus}): ${verdict}`);

    console.log('\nWhat the app does with it now:');
    const again = path.join(dir, `again-${tag}.bin`);
    fs.writeFileSync(again, crypto.randomBytes(4096));
    const planned = await planTrash([again], {});
    const allowed = planned.plan.length === 1;
    note(`its vetting ${allowed ? 'allows a delete there' : `refuses it: ${planned.failed[0] && planned.failed[0].error}`}`);
    if (verdict === 'recycled') {
      check('the bin keeps what is sent to it here, so allowing it is right', allowed === (info.readOnly === null) && info.readOnly === null,
        info.readOnly ? `the app keeps a ${info.readOnly} drive read only although the bin works here` : '');
    } else {
      check('the bin does not keep it here, so the app must not offer it', !allowed, allowed ? 'the app would offer a delete that is not undoable' : '');
    }
  } catch (err) {
    failures++;
    console.log(`\n  FAIL  ${err.message}`);
  } finally {
    if (binDir && tag) {
      for (const r of binRecords(binDir).filter((x) => x.original.toLowerCase().includes(tag))) {
        for (const f of [r.name, `$R${r.name.slice(2)}`]) {
          try {
            fs.rmSync(path.join(binDir, f), { recursive: true, force: true });
          } catch (err) {
            console.log(`    could not remove ${f}: ${err.message}`);
          }
        }
      }
    }
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    if (dir) console.log(`\ncleaned: folder gone ${!fs.existsSync(dir)}, bin records left ${binDir ? binRecords(binDir).filter((x) => x.original.toLowerCase().includes(tag)).length : 0}`);
  }
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  app.exit(failures === 0 ? 0 : 1);
});
