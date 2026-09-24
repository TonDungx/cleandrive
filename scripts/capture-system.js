#!/usr/bin/env node
'use strict';

// Measure the system drive the way A1 will, for real, once -- and keep what the
// Windows tools printed as test fixtures.
//
//   npm run capture:system            raises one UAC prompt; takes a few minutes
//
// What it does, in order:
//
//   1. Starts the elevated helper (the UAC prompt appears straight away).
//   2. Asks it, in the background, for vssadmin, fsutil and DISM output. DISM
//      is the slow one; it runs while step 3 does.
//   3. Walks the whole system drive *unelevated*, the way the app will when
//      the user presses "Measure", and notes every folder it may not read.
//   4. Asks the helper to measure exactly those folders.
//   5. Writes:
//        scripts/fixtures/system/*.txt   the tools' output, with volume GUIDs
//                                        and serial numbers blanked -- these
//                                        are what `test-system.js` parses
//        %TEMP%\cleandrive-capture-system\report.json
//                                        the sums (never a file name below the
//                                        top-level folders) -- read to propose
//                                        the "not explained" threshold
//
// Reads only. Nothing is deleted, moved or changed; DISM writes its own log.
// userData is a temporary folder, checked before anything runs.

process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { app } = require('electron');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-capture-'));
app.setName(require('../package.json').name);
app.setPath('userData', SANDBOX);

const { HelperClient, appLauncher } = require('../src/main/helper/client');
const { measureTree } = require('../src/main/system/walk');
const { pathKey } = require('../src/main/lib/util');

const ROOT = path.join(__dirname, '..');
// `--unelevated` is a dry run of this script itself: no prompt, the helper
// started directly, nothing written into the repository.
const unelevated = process.argv.includes('--unelevated');
const FIXTURES = unelevated ? path.join(SANDBOX, 'fixtures') : path.join(__dirname, 'fixtures', 'system');
const REPORT_DIR = path.join(os.tmpdir(), unelevated ? 'cleandrive-capture-system-dry' : 'cleandrive-capture-system');
const DRIVE = /^[A-Za-z]:$/.test(process.env.SystemDrive || '') ? process.env.SystemDrive.toUpperCase() : 'C:';
const skipDism = process.argv.includes('--no-dism') || unelevated;

function directLauncher(name, nonce) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  require('node:child_process').spawn(process.execPath, [ROOT, '--helper', '--pipe', name, '--nonce', nonce], { env, stdio: 'ignore' });
  return Promise.resolve();
}

/** Blank what identifies this machine's volumes, keep everything a parser reads. */
function redact(text) {
  return String(text)
    .replace(/\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}/g, '{00000000-0000-0000-0000-000000000000}')
    .replace(/(Serial Number\s*:\s*)0x[0-9A-Fa-f]+/gi, '$10x0000000000000000')
    .replace(/(Serial Number is )[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}/gi, '$10000-0000')
    .replace(/\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\b/g, '00000000-0000-0000-0000-000000000000');
}

const gb = (n) => +(n / 1e9).toFixed(2);

app.whenReady().then(async () => {
  if (pathKey(app.getPath('userData')) !== pathKey(SANDBOX)) {
    console.error('refusing to run: userData is not the sandbox');
    app.exit(1);
    return;
  }
  fs.mkdirSync(FIXTURES, { recursive: true });
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  console.log(`\ncapture: ${DRIVE}\\ -- the UAC prompt is for CleanDrive's read-only helper\n`);

  const client = new HelperClient({
    launch: unelevated ? directLauncher : appLauncher({ execPath: process.execPath, appPath: ROOT, isPackaged: false }),
  });
  try {
    await client.start();
  } catch (err) {
    console.error(`the helper did not start: ${err.code} ${err.message}`);
    app.exit(1);
    return;
  }
  const ping = await client.request('ping');
  console.log(`  helper: pid ${ping.pid}, integrity ${ping.integrity}`);
  if (!ping.elevated && !unelevated) {
    console.error('the helper is not elevated; nothing measured');
    client.stop();
    app.exit(1);
    return;
  }

  const tools = {};
  const ask = (op, file, timeoutMs) =>
    client
      .request(op, {}, { timeoutMs })
      .then((out) => {
        tools[op] = { exitCode: out.exitCode, ms: out.ms, timedOut: out.timedOut, bytes: out.text.length };
        fs.writeFileSync(path.join(FIXTURES, file), redact(out.text));
        console.log(`  ${op}: exit ${out.exitCode}, ${out.ms} ms -> fixtures/system/${file}`);
      })
      .catch((err) => {
        tools[op] = { error: err.message };
        console.log(`  ${op}: ${err.message}`);
      });

  const pending = [
    ask('shadowstorage.query', 'vssadmin-list-shadowstorage.en.txt', 120000),
    ask('ntfs.info', 'fsutil-fsinfo-ntfsinfo.en.txt', 120000),
    ask('storagereserve.query', 'fsutil-storagereserve-query.en.txt', 120000),
  ];
  if (!skipDism) pending.push(ask('dism.analyze', 'dism-analyzecomponentstore.en.txt', 25 * 60000));

  /* ---- the unelevated walk, as the app will do it ------------------------ */
  console.log('  walking the drive unelevated (about two minutes on this machine) ...');
  let last = 0;
  const walk = await measureTree(`${DRIVE}\\`, {
    bucketOf: (parts) => (parts.length === 0 ? '(files at the top)' : parts[0]),
    onProgress: (p) => {
      if (p.elapsedMs - last > 10000) {
        last = p.elapsedMs;
        console.log(`    ${p.files.toLocaleString('en-US')} files, ${p.dirs.toLocaleString('en-US')} folders, ${Math.round(p.elapsedMs / 1000)} s`);
      }
    },
  });
  console.log(`  walked ${walk.files.toLocaleString('en-US')} files in ${(walk.durationMs / 1000).toFixed(1)} s; ${walk.deniedCount} folders refused`);

  /* ---- the refused folders, measured elevated ---------------------------- */
  let elevatedSums = null;
  try {
    const out = await client.request('system.breakdown', { dirs: walk.denied }, { timeoutMs: 20 * 60000 });
    elevatedSums = out;
    console.log(`  the ${walk.denied.length} refused folders, measured elevated: ${gb(out.sums.reduce((n, s) => n + s.allocated, 0))} GB in ${out.ms} ms`);
  } catch (err) {
    console.log(`  system.breakdown: ${err.message}`);
  }

  console.log(skipDism ? '' : '  waiting for DISM ...');
  await Promise.all(pending);
  client.stop();

  /* ---- the system files and the volume ---------------------------------- */
  const dirOut = (() => {
    try {
      return execFileSync(path.join(process.env.SystemRoot, 'System32', 'cmd.exe'),
        ['/d', '/c', 'dir', '/a', '/-c', `${DRIVE}\\hiberfil.sys`, `${DRIVE}\\pagefile.sys`, `${DRIVE}\\swapfile.sys`],
        { encoding: 'latin1', windowsHide: true });
    } catch (err) {
      return String(err.stdout || '');
    }
  })();
  fs.writeFileSync(path.join(FIXTURES, 'cmd-dir-system-files.txt'), redact(dirOut));
  const statfs = fs.statfsSync(`${DRIVE}\\`);
  const total = statfs.blocks * statfs.bsize;
  const free = statfs.bavail * statfs.bsize;

  const deniedByTop = {};
  for (const [i, dir] of walk.denied.entries()) {
    const top = dir.slice(3).split('\\')[0] || '(top)';
    const add = elevatedSums ? elevatedSums.sums[i] : null;
    const b = deniedByTop[top] || (deniedByTop[top] = { folders: 0, allocatedGB: 0, stillRefused: 0 });
    b.folders += 1;
    if (add) {
      b.allocatedGB = +(b.allocatedGB + add.allocated / 1e9).toFixed(2);
      b.stillRefused += add.denied;
    }
  }

  const walked = Object.values(walk.buckets).reduce((n, b) => n + b.allocated, 0);
  const elevatedExtra = elevatedSums ? elevatedSums.sums.reduce((n, s) => n + s.allocated, 0) : 0;
  const report = {
    capturedAt: new Date().toISOString(),
    drive: DRIVE,
    volume: { totalGB: gb(total), freeGB: gb(free), usedGB: gb(total - free) },
    walk: {
      seconds: +(walk.durationMs / 1000).toFixed(1), files: walk.files, dirs: walk.dirs, refused: walk.deniedCount,
      hardlinkRepeats: walk.hardlinkRepeats, links: walk.links, unreadableFiles: walk.unreadableFiles.length,
      allocatedGB: gb(walked),
    },
    top: Object.entries(walk.buckets).map(([k, b]) => ({ k, allocatedGB: gb(b.allocated), files: b.files }))
      .sort((a, b) => b.allocatedGB - a.allocatedGB),
    elevated: elevatedSums ? { ms: elevatedSums.ms, allocatedGB: gb(elevatedExtra), byTop: deniedByTop } : null,
    tools,
    systemFiles: dirOut.split(/\r?\n/).filter((l) => /\.sys\s*$/i.test(l)).map((l) => l.trim().split(/\s+/).slice(-2).join(' ')),
    unexplainedBeforeToolsGB: gb(total - free - walked - elevatedExtra),
  };
  fs.writeFileSync(path.join(REPORT_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n  used ${report.volume.usedGB} GB; walked ${report.walk.allocatedGB} GB; elevated folders ${gb(elevatedExtra)} GB`);
  console.log(`  still to explain before hiberfil, shadow copies, the MFT and reserved storage: ${report.unexplainedBeforeToolsGB} GB`);
  console.log(`\n  report: ${path.join(REPORT_DIR, 'report.json')}\n  fixtures: ${FIXTURES}\n`);

  fs.rmSync(SANDBOX, { recursive: true, force: true });
  app.exit(0);
}).catch((err) => {
  console.error('FAILED:', err);
  app.exit(1);
});
