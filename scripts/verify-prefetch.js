'use strict';

// D1's one claim that cannot be checked without administrator rights: that a
// prefetch file's modified time is when the program it belongs to last
// started.
//
//   npx electron scripts/verify-prefetch.js              reports what it can
//   npx electron scripts/verify-prefetch.js --elevated   raises one UAC prompt
//
// Unelevated, `C:\Windows\Prefetch` is refused outright (EPERM on this
// machine), which is the whole reason `prefetch.list` exists in the elevated
// helper. With --elevated it starts the helper, asks for the listing, and
// holds it against the launch times UserAssist recorded for the same
// programs -- two records of the same events, from different places.
//
// It reads. It starts no program to make a record of, so what it checks is
// what the machine already had.
//
// Throwaway userData and a suffixed task name, like every other harness here.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-prefetch-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'prefetch';

const ELEVATED = process.argv.includes('--elevated');
const DAY = 86400000;

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated');
  try {
    const { OPS, integrityLevel } = require('../src/main/helper/ops');
    const lastused = require('../src/main/apps/lastused');
    const measure = require('../src/main/apps/measure');
    const { HelperClient, appLauncher } = require('../src/main/helper/client');

    console.log('\nprefetch: what a normal process can see\n');

    const dir = path.join(process.env.SystemRoot || 'C:\\Windows', 'Prefetch');

    // This half cannot be measured from here when the harness itself was
    // started from an administrator terminal -- and `--elevated` means it
    // was. The whole process, Electron and all, inherits High integrity, so
    // "what a normal process can see" would be answered by a process that is
    // not one. Asked anyway, it reported 494 files and failed a check that
    // was right about the world and wrong about where it was standing.
    //
    // Measured properly in `scripts/test-helper.js`, which runs unelevated:
    // at Medium integrity `prefetch.list` comes back EPERM.
    const mine = await integrityLevel();
    if (mine === 'medium' || mine === 'low') {
      const unelevated = await OPS['prefetch.list']();
      check('the folder is refused to a normal process, so the screen needs the helper for it',
        unelevated.available === false, unelevated.available ? `${unelevated.files.length} files` : String(unelevated.reason));
    } else {
      console.log(`  ....  this terminal is ${mine} integrity, so a normal process cannot be sampled from here`);
      console.log('        (test-helper.js measures it unelevated: EPERM)');
    }

    // Windows can be told not to keep these at all.
    const { exportKey } = require('../src/main/apps/registry');
    const prefetcher = await exportKey(
      'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters'
    );
    const enable = prefetcher
      ? Object.values(prefetcher)[0] && Object.values(prefetcher)[0].EnablePrefetcher
      : undefined;
    console.log(`    EnablePrefetcher = ${enable === undefined ? 'not set' : enable} (3 = applications and boot)`);

    if (!ELEVATED) {
      console.log('\n  Run again with --elevated to check the listing itself. One UAC prompt.\n');
      console.log(failures === 0 ? 'ALL PASS (the elevated half was not run)\n' : `${failures} FAILURE(S)\n`);
      app.exit(failures === 0 ? 0 : 1);
      return;
    }

    console.log('\nprefetch: the listing, with administrator rights\n');

    // The client does not know how to start the helper -- the app hands it a
    // launcher that goes through UAC, and so does this. `verify-helper.js`
    // builds the same one; a bare `new HelperClient()` is refused.
    const launch = appLauncher({
      execPath: process.execPath,
      appPath: path.join(__dirname, '..'),
      isPackaged: false,
    });
    const listing = await measure.elevate({
      client: new HelperClient({ launch }),
      onProgress: (p) => console.log(`    ${p.phase}…`),
    });
    if (listing.declined) {
      console.log('\n  The administrator prompt was declined; nothing was read.\n');
      app.exit(1);
      return;
    }

    check('the helper could read the folder', listing.available === true, String(listing.reason || ''));
    check('and it came back with prefetch files', Array.isArray(listing.files) && listing.files.length > 0,
      `${listing.files.length} files in ${listing.ms} ms`);
    check('nothing but a name, a time and a size left the elevated process',
      listing.files.every((f) => Object.keys(f).sort().join(',') === 'mtimeMs,name,size'),
      JSON.stringify(listing.files[0] || {}));
    check('every entry is a prefetch file', listing.files.every((f) => /\.pf$/i.test(f.name)));

    const records = lastused.fromPrefetchListing(listing.files);
    check('the names give the programs they belong to', records.byExe.size > 0,
      `${records.byExe.size} programs, oldest ${Math.round((Date.now() - records.oldestMs) / DAY)} days`);
    check('no record is in the future', [...records.byExe.values()].every((r) => r.lastRunMs <= Date.now() + 60000));

    /* ---- the claim itself --------------------------------------------- */
    //
    // The comparison: for every program both sources know about, how far apart
    // do they put its last start? UserAssist writes a launch the moment
    // Explorer starts something; Windows rewrites the .pf a few seconds after.
    // If the modified time meant something else -- when the file was created,
    // when the folder was tidied -- the two would not track each other.

    console.log('\nprefetch: does the modified time mean "last started"?\n');

    const ua = await lastused.readUserAssist();
    const pairs = [];
    for (const entry of ua.entries) {
      if (entry.kind !== 'exe') continue;
      const base = (entry.fullPath ? path.win32.basename(entry.fullPath) : entry.name.split('\\').pop() || '').toLowerCase();
      const exe = base.replace(/\.exe(\.\d+)?$/, '.exe');
      const record = records.byExe.get(exe);
      if (!record) continue;
      pairs.push({ exe, prefetch: record.lastRunMs, userAssist: entry.lastRunMs, diffDays: (record.lastRunMs - entry.lastRunMs) / DAY });
    }

    check('both sources know about some of the same programs', pairs.length >= 3, `${pairs.length} programs in both`);
    if (pairs.length) {
      pairs.sort((a, b) => Math.abs(a.diffDays) - Math.abs(b.diffDays));
      const median = pairs[Math.floor(pairs.length / 2)];
      const within = (days) => pairs.filter((p) => Math.abs(p.diffDays) <= days).length;
      console.log(`    of ${pairs.length}: ${within(1)} agree within a day, ${within(7)} within a week`);
      console.log(`    median gap ${median.diffDays.toFixed(2)} days`);
      for (const p of pairs.slice(0, 6)) {
        console.log(`      ${p.exe.padEnd(28)} prefetch ${new Date(p.prefetch).toISOString().slice(0, 16)}  userassist ${new Date(p.userAssist).toISOString().slice(0, 16)}  ${p.diffDays >= 0 ? '+' : ''}${p.diffDays.toFixed(2)}d`);
      }
      // What the two sources actually are, which is what decides what may be
      // asserted about them:
      //
      //   prefetch    every process start, whoever began it -- a click, a
      //               command line, a scheduled task, another program
      //   UserAssist  only what Explorer and the Start menu began, and it
      //               records the *launch*, not the start: a click on a
      //               shortcut to a program that then fails to run still
      //               counts here and leaves no prefetch file behind
      //
      // So UserAssist is a lower bound on the last start, and prefetch being
      // newer is the expected case, not a disagreement. An earlier version of
      // this demanded that most pairs land on the same day, which would only
      // be true if UserAssist saw every start; it does not, and that check
      // failed on a machine where nothing was wrong. What can be asserted is
      // the direction.
      // Each pair where prefetch is the older of the two, explained before it
      // is judged. One explanation clears the modified time completely: the
      // program is not on disk any more, so the launch UserAssist counted
      // cannot have started anything and cannot have written a prefetch file.
      // A launch UserAssist counted is a *click*, not a start.
      const older = pairs.filter((p) => p.diffDays <= -1).map((p) => {
        const entry = ua.entries.find((e) => e.kind === 'exe' && e.lastRunMs === p.userAssist
          && (e.fullPath || e.name).toLowerCase().endsWith(p.exe));
        const full = entry && entry.fullPath;
        return { ...p, entry, full, gone: full ? !fs.existsSync(full) : null };
      });
      for (const p of older) {
        console.log(`    ${p.exe}: ${p.diffDays.toFixed(1)}d older`
          + `  ·  ${records.byExe.has(p.exe) ? records.byExe.get(p.exe).files : '?'} prefetch file(s)`
          + `  ·  ${p.full ? (p.gone ? 'the program is no longer on disk' : `still there: ${p.full}`) : 'UserAssist gave no path'}`
          + (p.entry ? `  ·  UserAssist counted ${p.entry.runs} launch(es)` : ''));
      }

      // What a click proves, and what it does not. UserAssist counts the
      // click; the process may never have started. Three ways that happens,
      // none of which says anything about the modified time:
      //
      //   the program was already running, and the click raised its window
      //   it started and exited before the prefetcher wrote its trace
      //   it failed to start
      //
      // None can be told apart from the registry alone, so a handful of pairs
      // in the wrong direction is expected. What would mean the modified time
      // is not the last start is a *pattern* of them, and that is what is
      // asserted: the direction has to hold for all but a few.
      //
      // Measured here 2026-09-27: 67 of 68, the one exception being
      // CheckPoint's TrGUI.exe, clicked exactly once and 32 days behind.
      const rightWay = pairs.length - older.length;
      const allowed = Math.max(2, Math.ceil(pairs.length * 0.05));
      check('prefetch keeps up with the launches UserAssist counted, bar a few clicks that started nothing',
        older.length <= allowed,
        `${rightWay} of ${pairs.length} same-day or newer; ${older.length} older, ${allowed} tolerated`);

      // And the shape of the gap, reported rather than asserted: a number
      // nobody has a right to predict is a number that belongs in the log.
      const ahead = pairs.filter((p) => p.diffDays > 1).length;
      console.log(`    ${within(1)} same-day, ${ahead} where prefetch is newer, ${older.length} where it is older`);
      check('and the two agree exactly on programs the user starts by clicking',
        within(1) >= 3, `${within(1)} of ${pairs.length} land on the same day`);
    }

    console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}\n`);
    app.exit(failures === 0 ? 0 : 1);
  } catch (err) {
    console.error(err);
    app.exit(1);
  } finally {
    try {
      fs.rmSync(SANDBOX, { recursive: true, force: true });
    } catch {
      /* Chromium may still hold it; temp is cleared by the OS */
    }
  }
});
