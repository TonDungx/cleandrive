#!/usr/bin/env node
'use strict';

// A1, the system breakdown: the parsers against what Windows really printed,
// the size-only walk, and the rules that decide what a folder entry is.
//
//   node scripts/test-system.js
//
// Every fixture in scripts/fixtures/system/ is real output from the machine
// this was built on -- captured by `npm run capture:system`, volume GUIDs and
// serial numbers blanked -- and nothing here was typed in to look like it.
// That machine reads English with Vietnamese number formats, so the numbers in
// the fixtures are `8,60 GB` and `995.551.231`, which is exactly the case a
// parser written from memory gets wrong.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const parse = require('../src/main/system/parse');
const { measureTree } = require('../src/main/system/walk');
const { entryKind } = require('../src/main/lib/real-fs');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const FIX = path.join(__dirname, 'fixtures', 'system');
const fixture = (name) => fs.readFileSync(path.join(FIX, name), 'latin1');
const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
const near = (a, b, tolerance) => a !== null && Math.abs(a - b) <= tolerance;

(async () => {
  console.log('\nsystem: numbers in whichever regional format\n');
  {
    const cases = [
      ['8,60', 8.6], ['16.56', 16.56], ['995.551.231', 995551231], ['124.443.903', 124443903],
      ['5.168', 5168], ['474,7', 474.7], ['1.234,5', 1234.5], ['1,234.5', 1234.5], ['0', 0], ['200,13', 200.13],
    ];
    const wrong = cases.filter(([text, want]) => parse.parseNumber(text) !== want);
    check('Vietnamese and English number formats read the same', wrong.length === 0,
      wrong.map(([t, w]) => `${t} -> ${parse.parseNumber(t)} (want ${w})`).join('; '));
    check('sizes are binary: 1 GB is 1024^3 bytes', parse.parseSize('1 GB') === GiB && parse.parseSize('0 bytes') === 0);
    check('something that is not a number is null, not zero', parse.parseNumber('abc') === null && parse.parseSize('GB') === null);
  }

  console.log('\nsystem: vssadmin list shadowstorage\n');
  {
    const out = parse.parseShadowStorage(fixture('vssadmin-list-shadowstorage.en.txt'));
    const a = out.associations[0];
    check('the real output: one association, for C: stored on C:', out.state === 'ok' && out.associations.length === 1 &&
      a.forVolume === 'C:' && a.storageVolume === 'C:', JSON.stringify(out.associations));
    check('used 8,60 GB, allocated 8,90 GB, maximum 9,49 GB -- in that order, with comma decimals',
      a && a.used === Math.round(8.6 * GiB) && a.allocated === Math.round(8.9 * GiB) && a.maximum === Math.round(9.49 * GiB));
    const denied = parse.parseShadowStorage(fixture('vssadmin-list-shadowstorage.unelevated.en.txt'), { exitCode: 2 });
    check('what it prints without administrator rights reads as "denied", not as "no restore points"',
      denied.state === 'denied' && denied.associations.length === 0);
    // The first lines of the real output with no association after them:
    // this machine has restore points, so "none" cannot be captured here.
    const none = parse.parseShadowStorage('vssadmin 1.1 - Volume Shadow Copy Service administrative command-line tool\r\n(C) Copyright 2001-2013 Microsoft Corp.\r\n\r\n', { exitCode: 0 });
    check('a clean exit with no association is "none" -- and the (C) of the copyright is not a volume',
      none.state === 'none' && none.associations.length === 0);
  }

  console.log('\nsystem: fsutil fsinfo ntfsinfo\n');
  {
    const out = parse.parseNtfsInfo(fixture('fsutil-fsinfo-ntfsinfo.en.txt'));
    check('the MFT is 1,81 GB', out.state === 'ok' && out.mftBytes === Math.round(1.81 * GiB), String(out.mftBytes));
    check('4 KB clusters, 124.443.903 of them, 16.246.899 free',
      out.bytesPerCluster === 4096 && out.totalClusters === 124443903 && out.freeClusters === 16246899, JSON.stringify(out));
    check('its own figure for the drive matches the cluster count: 474,7 GiB',
      near(out.totalClusters * out.bytesPerCluster / GiB, 474.7, 0.05));
    check('5.168 clusters reserved by NTFS, none for the storage reserve', out.reservedClusters === 5168 && out.storageReserveClusters === 0);
    const denied = parse.parseNtfsInfo(fixture('fsutil-fsinfo-ntfsinfo.unelevated.en.txt'), { exitCode: 1 });
    check('unelevated it is "denied", with no numbers made up', denied.state === 'denied' && denied.mftBytes === null);
  }

  console.log('\nsystem: fsutil storagereserve query\n');
  {
    const out = parse.parseStorageReserve(fixture('fsutil-storagereserve-query.en.txt'));
    check('three reserve areas, read from the exact hexadecimal byte counts', out.state === 'ok' && out.areas.length === 3 &&
      out.areas[0].guarantee === 0x1407b1000 && out.areas[0].used === 0x239af4000 && out.areas[1].used === 0x30dc51000,
      JSON.stringify(out.areas));
    check('files have overflowed both guarantees, so nothing is held back empty', out.heldBack === 0, String(out.heldBack));
    // Constructed, not captured: this machine's reserves are both overfull,
    // so the other branch has no real output to be tested against.
    const synthetic = parse.parseStorageReserve('Reserve ID:       1\nFlags:            0x00000001\nSpace Guarantee:  0x80000000        (2048 MB)\nSpace Used:       0x40000000        (1024 MB)\n');
    check('where a guarantee is not filled, the empty part is what is held back', synthetic.heldBack === 1024 * MiB);
    const denied = parse.parseStorageReserve(fixture('fsutil-storagereserve-query.unelevated.en.txt'), { exitCode: 1 });
    check('unelevated it is "denied"', denied.state === 'denied' && denied.heldBack === null);
  }

  console.log('\nsystem: DISM /AnalyzeComponentStore /English\n');
  {
    const out = parse.parseDism(fixture('dism-analyzecomponentstore.en.txt'));
    check('the actual size of WinSxS: 16.56 GB', out.state === 'ok' && out.actualSize === Math.round(16.56 * GiB));
    check('7.90 GB of it shared with Windows, 8.65 GB backups, cache empty',
      out.sharedWithWindows === Math.round(7.9 * GiB) && out.backups === Math.round(8.65 * GiB) && out.cache === 0);
    check('Explorer would say 17.86 GB, which is why the app shows DISM\'s figure', out.explorerSize === Math.round(17.86 * GiB));
    check('cleanup recommended, five reclaimable packages, last cleanup dated',
      out.cleanupRecommended === true && out.reclaimablePackages === 5 && /^2026-09-24/.test(out.lastCleanup || ''), JSON.stringify(out));
    check('the progress bars DISM prints are not mistaken for anything', out.actualSize !== null);
    const denied = parse.parseDism(fixture('dism-analyzecomponentstore.unelevated.en.txt'), { exitCode: 740 });
    check('what it prints without administrator rights (Error: 740) is "denied"', denied.state === 'denied' && denied.actualSize === null);
  }

  console.log('\nsystem: the size of hiberfil.sys, from a directory listing\n');
  {
    const out = parse.parseSystemFiles(fixture('cmd-dir-system-files.txt'));
    check('hiberfil.sys 6749417472 bytes, swapfile.sys 268435456, no pagefile on this drive',
      out.hiberfil === 6749417472 && out.swapfile === 268435456 && out.pagefile === null, JSON.stringify(out));
    check('the Vietnamese "CH" in the date is not read as part of anything', /CH\s+6749417472 hiberfil/.test(fixture('cmd-dir-system-files.txt')));
  }

  console.log('\nsystem: what a folder entry really is\n');
  {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-system-'));
    const real = path.join(dir, 'real');
    await fsp.mkdir(real);
    await fsp.writeFile(path.join(real, 'a.bin'), Buffer.alloc(10000, 1));
    const junction = path.join(dir, 'junction');
    await fsp.symlink(real, junction, 'junction');
    // What readdir reports for OneDrive's folder: a "symbolic link" that is not
    // a directory. Only lstat can say what it is.
    const liar = { isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true, name: 'real' };
    check('an entry that says "link" but is a folder is a folder (OneDrive\'s root, measured)', (await entryKind(liar, real)) === 'dir');
    const junctionEntry = (await fsp.readdir(dir, { withFileTypes: true })).find((e) => e.name === 'junction');
    check('a junction is still a link, and is never entered', (await entryKind(junctionEntry, junction)) === 'link');
    const walked = await measureTree(dir);
    check('the walk counts the file once, not again through the junction',
      walked.buckets.all.files === 1 && walked.buckets.all.logical === 10000 && walked.links === 1, JSON.stringify(walked.buckets.all));

    const linked = path.join(real, 'a-hardlink.bin');
    await fsp.link(path.join(real, 'a.bin'), linked);
    const again = await measureTree(dir);
    check('two names for one file are counted once', again.buckets.all.files === 1 && again.hardlinkRepeats === 1);
    check('and it adds up allocation, not only sizes', again.buckets.all.allocated >= 10000 && Number.isFinite(again.buckets.all.allocated));
    await fsp.rm(dir, { recursive: true, force: true });
  }

  console.log('\nsystem: every byte in exactly one row\n');
  const breakdown = require('../src/main/system/breakdown');
  const GB = 1e9;
  const walk = {
    drive: 'C:\\', profileParts: ['users', 'me'], profile: 'C:\\Users\\Me', at: Date.now(),
    buckets: {
      profile: { allocated: 100 * GB, files: 1000 },
      'skipped:.ollama': { allocated: 15 * GB, files: 29 },
      'skipped:work\\app\\node_modules': { allocated: 2 * GB, files: 40000 },
      programs: { allocated: 50 * GB, files: 200000 },
      programData: { allocated: 30 * GB, files: 20000 },
      winsxs: { allocated: 12 * GB, files: 90000 },
      windows: { allocated: 34 * GB, files: 50000 },
      installer: { allocated: 12 * GB, files: 2000 },
      'folder:Vmware': { allocated: 11 * GB, files: 19 },
      'folder:': { allocated: 0.01 * GB, files: 7 },
      recycleBin: { allocated: 5 * GB, files: 42000 },
      'account:Public': { allocated: 0.5 * GB, files: 100 },
    },
    denied: ['C:\\Program Files\\WindowsApps', 'C:\\System Volume Information', 'C:\\Windows\\ServiceProfiles\\NetworkService'],
    deniedCount: 3, files: 1, dirs: 1, links: 2, hardlinkRepeats: 3, unreadableFiles: ['C:\\hiberfil.sys'], cancelled: false, durationMs: 1000,
  };
  const volume = { totalBytes: 500 * GB, freeBytes: 60 * GB, usedBytes: 440 * GB };
  const systemFiles = { hiberfil: 6.75 * GB, pagefile: null, swapfile: 0.27 * GB };

  {
    const model = breakdown.build({ walk, volume, systemFiles, appInBin: 1 * GB });
    const byKey = Object.fromEntries(model.rows.map((r) => [r.key, r]));
    const sum = model.rows.reduce((n, r) => n + r.bytes, 0);
    check('explained plus not explained is exactly what the drive says is used', sum + model.unexplainedBytes === volume.usedBytes,
      `${sum / GB} + ${model.unexplainedBytes / GB} vs ${volume.usedBytes / GB}`);
    check('the folders the other scans skip are their own row, largest part first',
      byKey.profileSkipped.bytes === 17 * GB && byKey.profileSkipped.parts[0].name === '.ollama', JSON.stringify(byKey.profileSkipped.parts));
    check('top-level folders nobody put there by default are named', byKey.otherFolders.parts[0].name === 'Vmware');
    check('a refused folder makes its row "at least this much"', byKey.programs.refused === 1 && byKey.windows.refused === 1);
    check('before administrator rights, restore points and the MFT are rows that say they need them',
      byKey.restorePoints.needsAdmin && byKey.ntfsMetadata.needsAdmin && byKey.systemHidden.needsAdmin);
    check('hiberfil.sys is in, sized from the listing; there is no pagefile on this drive',
      byKey.hiberfil.bytes === 6.75 * GB && byKey.hiberfil.source === 'listing' && !byKey.pagefile);
    check('the Recycle Bin knows how much of it the app put there', byKey.recycleBin.appBytes === 1 * GB);
    check('three groups, free, and the rest', Math.round(model.groups.yours + model.groups.programs + model.groups.windows) === Math.round(sum) &&
      model.groups.free === 60 * GB);

    const { collect, get } = require('../src/main/analyzers');
    check('the System analyzer is registered, free, and never elevated itself', get('system') && get('system').feature === 'free' && !get('system').requiresElevation);
    const out = await collect('system', { model }, { strict: true });
    check('every row is a valid candidate, with evidence and a confidence', out.candidates.length === model.rows.length &&
      out.candidates.every((c) => c.evidence.length > 0 && c.confidence && c.unattendedEligible === false));
    const cands = Object.fromEntries(out.candidates.map((c) => [c.meta.key, c]));
    check('a partly refused row is only "likely"; one that needs admin and has no figure is "a guess"',
      cands.programs.confidence === 'likely' && cands.restorePoints.confidence === 'guess' && cands.restorePoints.bytes === 0);
    check('nothing is ever an action of the app\'s own: only handoff or none',
      out.candidates.every((c) => c.actions.every((a) => a === 'handoff' || a === 'none')));
    check('hibernation offers its commands to copy, and opens Power Options', cands.hiberfil.meta.handoff === 'powerOptions' &&
      cands.hiberfil.meta.commands.includes('powercfg /hibernate off'));
    check('the summary names the rows by id, in the screen\'s order', out.summary.rows.length === out.candidates.length && out.summary.rows[0] === cands.profile.id);
  }

  {
    // The elevated pass, with the real tool output from the fixtures.
    const elevated = {
      at: Date.now(),
      sums: [
        { dir: 'C:\\Program Files\\WindowsApps', allocated: 16 * GB, files: 5000, denied: 0 },
        { dir: 'C:\\System Volume Information', allocated: 0, files: 0, denied: 1 },
        { dir: 'C:\\Windows\\ServiceProfiles\\NetworkService', allocated: 2 * GB, files: 300, denied: 0 },
        { dir: 'C:\\Windows\\ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization', allocated: 1.5 * GB, files: 90, denied: 0 },
      ],
      targets: breakdown.elevatedRequest(walk).targets,
      shadow: parse.parseShadowStorage(fixture('vssadmin-list-shadowstorage.en.txt')),
      ntfs: parse.parseNtfsInfo(fixture('fsutil-fsinfo-ntfsinfo.en.txt')),
      reserve: parse.parseStorageReserve(fixture('fsutil-storagereserve-query.en.txt')),
      dism: parse.parseDism(fixture('dism-analyzecomponentstore.en.txt')),
    };
    const before = breakdown.build({ walk, volume, systemFiles });
    const model = breakdown.build({ walk, volume, systemFiles, elevated });
    const byKey = Object.fromEntries(model.rows.map((r) => [r.key, r]));
    check('a refused folder\'s size lands in its own row', byKey.programs.bytes === 66 * GB && byKey.programs.refused === 0);
    // Windows (34) + WinSxS (12) as walked, plus the refused NetworkService
    // folder (2), which holds the Delivery Optimization cache (1.5).
    check('a named target inside a refused folder is moved into its own row, not counted twice',
      byKey.deliveryOptimization.bytes === 1.5 * GB &&
        Math.round(byKey.windows.bytes + byKey.winsxs.bytes + byKey.deliveryOptimization.bytes) === 48 * GB &&
        before.rows.find((r) => r.key === 'deliveryOptimization').needsAdmin === true,
      `${byKey.windows.bytes / GB} + ${byKey.winsxs.bytes / GB} + ${byKey.deliveryOptimization.bytes / GB}`);
    check('restore points are what vssadmin says is set aside for this drive', byKey.restorePoints.bytes === Math.round(8.9 * GiB) &&
      byKey.restorePoints.source === 'tool');
    check('the MFT is its own row', byKey.ntfsMetadata.bytes === Math.round(1.81 * GiB));
    check('no reserved-storage row when nothing is held back empty', !byKey.reservedStorage);
    check('WinSxS takes DISM\'s figure, and the rest of Windows gives up the difference: the total is unchanged',
      byKey.winsxs.bytes === Math.round(16.56 * GiB) &&
        Math.round(byKey.winsxs.bytes + byKey.windows.bytes) === Math.round(12 * GB + 34 * GB + 0.5 * GB));
    const sum = model.rows.reduce((n, r) => n + r.bytes, 0);
    check('and still, explained plus not explained is what is used', Math.round(sum + model.unexplainedBytes) === volume.usedBytes);
    check('System Volume Information stays refused even elevated, and says so', byKey.systemHidden.refused === 1);
    check('the model says what the elevated pass added', model.elevated && Math.round(model.elevated.addedBytes) === Math.round(18 * GB),
      String(model.elevated && model.elevated.addedBytes / GB));
    const { collect } = require('../src/main/analyzers');
    const out = await collect('system', { model }, { strict: true });
    const winsxs = out.candidates.find((c) => c.meta.key === 'winsxs');
    check('with DISM recommending a cleanup, WinSxS becomes "review" and carries the command to run',
      winsxs.verdict === 'review' && winsxs.meta.commands[0].includes('StartComponentCleanup'));
  }

  console.log('\nsystem: handing over to Windows\n');
  {
    const { execute } = require('../src/main/actions/execute');
    const { ActionJournal } = require('../src/main/journal/journal');
    const restore = require('../src/main/actions/restore');
    const jdir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-handoff-'));
    const journal = new ActionJournal(jdir);
    const opened = [];
    const deps = { openExternal: async (uri) => opened.push(uri), spawn: (exe, args) => opened.push([exe, ...args].join(' ')) };
    const out = await execute({ kind: 'handoff', items: ['storage', 'systemProtection', 'ms-settings:privacy', 'C:\\evil.exe'] }, { journal, deps });
    check('only keys from the fixed table open anything', out.moved.length === 2 &&
      opened[0] === 'ms-settings:storagesense' && /System32\\SystemPropertiesProtection\.exe$/i.test(opened[1]), JSON.stringify(opened));
    check('a URI or a path from the window opens nothing', out.failed.length === 2 && !opened.some((o) => /privacy|evil/.test(o)));
    const sessions = await journal.sessions();
    check('the handoff is in the journal, as what was opened', sessions.length === 1 && sessions[0].kind === 'handoff' &&
      sessions[0].items[0].from === 'ms-settings:storagesense');
    check('and the Restore Center leaves it out: there is nothing to put back', (await restore.listSessions(journal)).length === 0);
    check('it frees nothing and says so', out.freedBytes === 0 && out.freesOnVolume === false);
    await fsp.rm(jdir, { recursive: true, force: true });
  }

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
