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
    const { OPS } = require('../src/main/helper/ops');
    const lastused = require('../src/main/apps/lastused');
    const measure = require('../src/main/apps/measure');
    const { HelperClient, appLauncher } = require('../src/main/helper/client');

    console.log('\nprefetch: what a normal process can see\n');

    const dir = path.join(process.env.SystemRoot || 'C:\\Windows', 'Prefetch');
    const unelevated = await OPS['prefetch.list']();
    check('the folder is refused to a normal process, so the screen needs the helper for it',
      unelevated.available === false, unelevated.available ? `${unelevated.files.length} files` : String(unelevated.reason));
    if (unelevated.available) {
      console.log(`    (this account can read ${dir}; the rest of this still holds)`);
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
      // Prefetch sees every start; UserAssist sees only what Explorer and the
      // Start menu began. So prefetch should be the same or newer, never
      // meaningfully older -- a program started since from anywhere else
      // moves only the prefetch time.
      check('prefetch is never meaningfully older than the launch UserAssist recorded',
        pairs.every((p) => p.diffDays > -1), pairs.filter((p) => p.diffDays <= -1).map((p) => `${p.exe} ${p.diffDays.toFixed(1)}d`).join(', '));
      check('and for most of them the two land on the same day, which is what makes the modified time usable',
        within(1) >= Math.ceil(pairs.length / 2), `${within(1)} of ${pairs.length}`);
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
