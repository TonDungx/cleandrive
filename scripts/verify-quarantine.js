#!/usr/bin/env node
'use strict';

// Moving files to another drive (B1) against a real drive that fills up and
// is pulled out part way through: a small virtual disk (VHDX) this harness
// makes, uses as the quarantine drive, and deletes again.
//
//   node scripts/verify-quarantine.js              says what it would do, and does nothing
//   node scripts/verify-quarantine.js --elevated   raises one UAC prompt and runs it
//
// Making, attaching and detaching a virtual disk needs an administrator, so
// the run happens in a second, elevated copy of this script (`--child`),
// which writes what it found to a file this one prints. The elevated copy
// calls one Windows program, `%SystemRoot%\System32\diskpart.exe /s <script>`,
// by its absolute path; each script is written by the harness itself and
// names only its own VHDX file and a drive letter no drive is using.
//
// What it touches: a work folder in %TEMP% (its source files, the VHDX, the
// journal) and the virtual disk. Originals go to a stand-in Recycle Bin
// inside the work folder. Everything is detached and deleted at the end,
// whatever happened.
//
// Seen when it ran: Windows Explorer notices the new drive, and when the
// harness detaches it on purpose, Explorer says "Z:\ is unavailable" in a
// dialog of its own. That is Explorer, not the app; OK closes it.
//
// It checks, on the real drive:
//   1. a file bigger than the drive's room is refused before anything is copied
//   2. the drive filling up part way through a copy: that copy is removed, its
//      original is untouched, and the batch stops
//   3. the drive detached part way through a copy: the same, and the batch
//      stops rather than trying the next file
//   4. while it is detached, what is already there reads as "not connected",
//      and once it is back, as there -- and it can be put back

const { spawnSync, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DISKPART = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'diskpart.exe');
const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const MB = 1024 * 1024;

const childAt = process.argv.indexOf('--child');

if (childAt === -1) {
  /* ---- the parent: explain, or raise the prompt ------------------------- */
  if (!process.argv.includes('--elevated')) {
    console.log(
      [
        '',
        'verify-quarantine: B1 against a real drive that fills up and is pulled out.',
        '',
        'It makes a 64 MB virtual disk in %TEMP%, gives it a free drive letter, uses it',
        'as the quarantine drive for a few files of its own, fills it, detaches it part',
        'way through a copy, attaches it again, and deletes it. That needs an',
        'administrator: run with --elevated, and answer the UAC prompt.',
        '',
      ].join('\n')
    );
    process.exit(0);
  }
  if (process.platform !== 'win32') {
    console.log('Windows only.');
    process.exit(0);
  }
  const result = path.join(os.tmpdir(), `cleandrive-verify-quarantine-${crypto.randomBytes(4).toString('hex')}.json`);
  const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const command = `Start-Process -FilePath ${quote(process.execPath)} -ArgumentList ${[__filename, '--child', result].map((a) => quote(`"${a}"`)).join(',')} -Verb RunAs -Wait -WindowStyle Hidden`;
  console.log('\nAsking Windows for an administrator (a UAC prompt)...');
  try {
    execFileSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', command], { stdio: 'inherit' });
  } catch (err) {
    console.error(`The elevated run did not start: ${err.message}`);
    process.exit(1);
  }
  let report;
  try {
    report = JSON.parse(fs.readFileSync(result, 'utf8'));
  } catch {
    console.error('The elevated run left no result -- the prompt was refused, or it crashed before writing one.');
    process.exit(1);
  }
  fs.rmSync(result, { force: true });
  console.log(`\nelevated: ${report.elevated} · drive ${report.letter || '-'}:`);
  for (const line of report.notes) console.log(`    ${line}`);
  let failed = 0;
  for (const c of report.checks) {
    if (!c.pass) failed += 1;
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.label}${c.detail ? `  -- ${c.detail}` : ''}`);
  }
  if (report.error) {
    failed += 1;
    console.log(`\n  THREW  ${report.error}`);
  }
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
  process.exit(failed ? 1 : 0);
}

/* ---- the elevated child ------------------------------------------------------ */

const resultFile = process.argv[childAt + 1];
const checks = [];
const notes = [];
const check = (label, pass, detail = '') => checks.push({ label, pass: Boolean(pass), detail: String(detail || '') });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function whoIsAdmin() {
  // Opening the first disk for reading is granted to an administrator only,
  // and reads nothing and writes nothing.
  try {
    fs.closeSync(fs.openSync('\\\\.\\PhysicalDrive0', 'r'));
    return true;
  } catch {
    return false;
  }
}

function diskpart(work, name, lines) {
  const script = path.join(work, `${name}.txt`);
  fs.writeFileSync(script, `${lines.join('\r\n')}\r\n`);
  const out = spawnSync(DISKPART, ['/s', script], { encoding: 'utf8', timeout: 120000, windowsHide: true });
  notes.push(`diskpart ${name}: exit ${out.status}`);
  return out;
}

(async () => {
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-vhdx-'));
  const vhdx = path.join(work, 'zone.vhdx');
  const letter = [...'ZYXWVUTSRQPONM'].find((l) => !fs.existsSync(`${l}:\\`));
  let attached = false;
  const report = { elevated: whoIsAdmin(), letter, checks, notes, error: null };

  try {
    if (!report.elevated) throw new Error('not elevated');
    if (!letter) throw new Error('no free drive letter');

    const zones = require(path.join(ROOT, 'src/main/lib/quarantine-zone'));
    const quarantine = require(path.join(ROOT, 'src/main/actions/quarantine'));
    const restore = require(path.join(ROOT, 'src/main/actions/restore'));
    const { execute } = require(path.join(ROOT, 'src/main/actions/execute'));
    const { ActionJournal } = require(path.join(ROOT, 'src/main/journal/journal'));

    const made = diskpart(work, 'create', [
      `create vdisk file="${vhdx}" maximum=64 type=expandable`,
      `select vdisk file="${vhdx}"`,
      'attach vdisk',
      'create partition primary',
      'format fs=ntfs quick label=CDQTEST',
      `assign letter=${letter}`,
    ]);
    attached = made.status === 0;
    for (let i = 0; i < 40 && !fs.existsSync(`${letter}:\\`); i++) await sleep(250);
    check(`a 64 MB virtual disk, attached as ${letter}:`, attached && fs.existsSync(`${letter}:\\`), made.stdout.split(/\r?\n/).filter(Boolean).slice(-2).join(' / '));
    if (!fs.existsSync(`${letter}:\\`)) throw new Error('the virtual disk did not appear');

    const journal = new ActionJournal(path.join(work, 'journal'));
    const bin = path.join(work, 'bin');
    const shell = {
      trashItem: async (p) => {
        await fsp.mkdir(bin, { recursive: true });
        await fsp.rename(p, path.join(bin, `${Date.now()}-${path.basename(p)}`));
      },
    };
    const prepared = await zones.prepare(`${letter}:\\`, {});
    const zone = prepared.zone;
    const status = await zones.check(zone, {});
    check('it is a zone: a local drive, its own volume, with its real room', prepared.ok && status.ok && status.type === 'Fixed' &&
      status.freeBytes > 40 * MB && status.freeBytes < 64 * MB, `${status.type} · ${(status.freeBytes / MB).toFixed(1)} MB free`);
    notes.push(`free on ${letter}: after format: ${(status.freeBytes / MB).toFixed(1)} MB`);

    const src = path.join(work, 'src');
    await fsp.mkdir(src);
    const make = (name, bytes) => {
      const p = path.join(src, name);
      const body = crypto.randomBytes(bytes);
      fs.writeFileSync(p, body);
      return { p, hash: sha(body) };
    };
    // Checked before a batch starts: room for all of it and a gigabyte. That
    // check is what (1) proves; for (2) and (3) it is told there is room --
    // a gigabyte and 128 MB more than the drive really has -- so that what
    // runs out part way through is the drive itself, not the check.
    const noMargin = { statfs: async (p) => {
      const real = await fsp.statfs(p);
      return { ...real, bavail: Number(real.bavail) + Math.ceil((zones.MARGIN_BYTES + 128 * MB) / Number(real.bsize)) };
    } };
    const deps = (extra = {}) => ({ zone, shell, appCacheEnv: {}, ...extra });

    // 1. Bigger than the drive: refused, before anything.
    const huge = make('huge.bin', 80 * MB);
    const refused = await execute({ kind: 'quarantine', items: [huge.p] }, { journal, can: () => true, deps: deps() });
    check('a file bigger than the drive\u2019s room is refused before anything is copied',
      refused.moved.length === 0 && /gigabyte/.test((refused.failed[0] || {}).error || '') && fs.existsSync(huge.p) &&
        fs.readdirSync(zone).length === 1, (refused.failed[0] || {}).error);
    fs.rmSync(huge.p);

    // 2. Full part way through: A fits, B does not.
    const a = make('a.bin', 20 * MB);
    const b = make('b.bin', 40 * MB);
    const full = await execute({ kind: 'quarantine', items: [a.p, b.p] }, { journal, can: () => true, deps: deps(noMargin) });
    const afterFull = await zones.check(zone, {});
    check('the drive filling up part way through: the first file moved, the second stopped with the drive full',
      full.moved.length === 1 && full.failed.length === 1 && full.failed[0].code === 'ENOSPC',
      JSON.stringify(full.failed.map((f) => [f.code, f.error])));
    check('its half-written copy is gone, and the room it took is back', afterFull.ok && afterFull.freeBytes > status.freeBytes - 21 * MB &&
      Boolean(full.session) && fs.readdirSync(path.join(zone, full.session)).filter((n) => n !== zones.MANIFEST).length === 1,
      `${(afterFull.freeBytes / MB).toFixed(1)} MB free`);
    check('and its original is untouched', fs.existsSync(b.p) && sha(fs.readFileSync(b.p)) === b.hash);
    const firstSession = full.session;
    if (!firstSession) throw new Error('the first copy did not happen, so the rest cannot be checked');

    // 3. Pulled out part way through a copy.
    const c = make('c.bin', 12 * MB);
    let chunks = 0;
    let detached = null;
    const pulled = await execute({ kind: 'quarantine', items: [c.p, b.p] }, {
      journal,
      can: () => true,
      deps: deps({
        ...noMargin,
        write: async (handle, chunk) => {
          chunks += 1;
          if (chunks === 4 && detached === null) {
            const out = diskpart(work, 'detach', [`select vdisk file="${vhdx}"`, 'detach vdisk']);
            detached = out.status === 0;
            attached = !detached;
            for (let i = 0; i < 20 && fs.existsSync(`${letter}:\\`); i++) await sleep(250);
          }
          await sleep(10);
          return handle.write(chunk);
        },
      }),
    });
    notes.push(`detached part way: ${detached}; failures: ${JSON.stringify(pulled.failed.map((f) => f.code))}`);
    check('the drive detached part way through a copy: nothing moved, and the batch stopped there rather than trying the next file',
      detached && pulled.moved.length === 0 && pulled.failed.length === 1 && pulled.failed[0].code === 'EZONELOST' && pulled.remaining === 1,
      JSON.stringify(pulled.failed.map((f) => [f.code, f.error])));
    check('both originals are untouched', sha(fs.readFileSync(c.p)) === c.hash && sha(fs.readFileSync(b.p)) === b.hash);

    // 4. What the Restore Center says while it is gone, and once it is back.
    const away = await restore.listItems(journal, firstSession);
    check('while it is detached, the file already there reads as "not connected", and its record is kept',
      away.length === 1 && away[0].state === 'unavailable', away.map((x) => x.state).join(','));
    const back = diskpart(work, 'attach', [
      `select vdisk file="${vhdx}"`,
      'attach vdisk',
      'select partition 1',
      'remove all noerr',
      `assign letter=${letter}`,
    ]);
    attached = back.status === 0;
    for (let i = 0; i < 40 && !fs.existsSync(`${letter}:\\`); i++) await sleep(250);
    const again = await restore.listItems(journal, firstSession);
    check('attached again, it reads as in quarantine', again.length === 1 && again[0].state === 'inQuarantine', again.map((x) => x.state).join(','));
    const putBack = await execute({ kind: 'restore', items: [`${firstSession}:0`] }, { journal, deps: { journal } });
    check('and it can be put back, checked, byte for byte, and its copy taken out of the zone',
      putBack.moved.length === 1 && sha(fs.readFileSync(a.p)) === a.hash && !fs.existsSync(again[0].stored));

    // The copy that was being written when the drive went is still on it now
    // that it is back (measured the first time this ran). It must never look
    // like a copy, and the next batch must take it out.
    const pulledDir = path.join(zone, pulled.session || '-');
    const leftover = fs.existsSync(pulledDir) ? fs.readdirSync(pulledDir) : [];
    notes.push(`the pulled session's folder after re-attaching: ${leftover.length ? leftover.map((n) => `${n} ${fs.statSync(path.join(pulledDir, n)).size}`).join(', ') : 'empty or gone'}`);
    check('what the pulled copy left behind is only ever an unfinished ".partial", never a copy',
      leftover.every((n) => n.endsWith(zones.PARTIAL)), leftover.join(', ') || 'nothing left');
    const d = make('d.bin', 2 * MB);
    const next = await execute({ kind: 'quarantine', items: [d.p] }, { journal, can: () => true, deps: deps(noMargin) });
    const afterNext = fs.existsSync(pulledDir) ? fs.readdirSync(pulledDir) : [];
    check('and the next batch takes it out, then moves its own file',
      next.moved.length === 1 && !afterNext.some((n) => n.endsWith(zones.PARTIAL)), afterNext.join(', ') || 'empty');
  } catch (err) {
    report.error = err && err.stack ? err.stack : String(err);
  } finally {
    if (attached) diskpart(work, 'cleanup', [`select vdisk file="${vhdx}"`, 'detach vdisk noerr']);
    await sleep(500);
    try {
      fs.rmSync(work, { recursive: true, force: true });
      notes.push('work folder and VHDX removed');
    } catch (err) {
      notes.push(`could not remove the work folder: ${err.message}`);
    }
    fs.writeFileSync(resultFile, JSON.stringify(report, null, 2));
  }
})();
