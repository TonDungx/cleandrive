'use strict';

// A fast scan's table, through the helper the app really starts (A2).
//
//   npx electron scripts/verify-mft-pipe.js [--files N]
//
// Found while H1 was checked from an elevated terminal: `cleandrive scan D:\
// --mft` could not read D:'s catalogue, and no harness had ever sent a real
// table through a real helper. scripts/verify-mft.js reads the volume in its
// own process and only *simulates* the wire; scripts/shoot-fastscan.js hands
// the scan a fake client. So the path the window's Fast scan and the command
// line both take -- an Electron helper process, a named pipe, the table in
// pieces, put back together on the other side -- had never run end to end.
//
// This runs it, with the one step that needs administrator replaced: the
// helper (scripts/lib/helper-with-image.js) opens an NTFS image built here
// instead of `\\.\X:`. Everything else is the shipped code: HelperClient and
// its handshake, `mft.scan` and its pieces, `mft-read.readElevated`, and
// `sourceFor`. The client side runs in this process, which is Electron like
// the window and the command line; the helper runs under Electron (as the app
// starts it) and under plain Node (as verify-mft.js runs the reader), so a
// difference between the two is a finding rather than a guess.
//
// Nothing is opened but the image. It is written to a temporary folder and
// removed on exit.
//
//   npx electron scripts/verify-mft-pipe.js --real D     (from an ELEVATED terminal)
//
// The step the image replaces, run for real: the shipped helper -- started as
// the app starts it, `electron <repo> --helper`, and under plain Node --
// opens `\\.\D:` itself and sends its table down the pipe. Read-only. The two
// are compared with each other, so a difference between Electron's Node and
// the system's Node in opening a raw volume shows as exactly that, with the
// error each one gave in its own words.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app } = require('electron');

const { HelperClient } = require('../src/main/helper/client');
const mftRead = require('../src/main/system/mft-read');
const wire = require('../src/main/system/mft-wire');
const { MAX_CHUNK_BYTES } = require('../src/main/helper/protocol');
const { contiguousVolume } = require('./lib/ntfs-fixture');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? Number(process.argv[at + 1]) : fallback;
};
const FILES = arg('files', 40000);
const FOLDERS = Math.max(1, Math.round(FILES / 100));
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-mftpipe-'));
const IMAGE = path.join(WORK, 'volume.img');
const LAUNCHER = path.join(__dirname, 'lib', 'helper-with-image.js');
process.on('exit', () => {
  try {
    fs.rmSync(WORK, { recursive: true, force: true });
  } catch {
    /* a temp folder left behind is not a failure */
  }
});

// Long names and Vietnamese ones, so a piece's byte count is not just ASCII.
const nameOf = (i) =>
  i % 7 === 0 ? `Ảnh của tôi ${i} — bản sao (${i % 13}).jpg` : `report-${i}-final-version-${'x'.repeat(i % 60)}.docx`;

const realAt = process.argv.indexOf('--real');
const REAL = realAt >= 0 ? String(process.argv[realAt + 1] || '').replace(/[:\\]/g, '').toUpperCase() : null;
const REPO = path.join(__dirname, '..');

function runtimes() {
  const env = { ...process.env, CLEANDRIVE_MFT_IMAGE: IMAGE };
  delete env.ELECTRON_RUN_AS_NODE;
  const node = process.env.CLEANDRIVE_NODE || 'node';
  if (REAL) {
    // The shipped helper, untouched: no image, no launcher of this script's.
    delete env.CLEANDRIVE_MFT_IMAGE;
    return [
      { label: 'helper under Electron, as the app starts it', exe: process.execPath, args: [REPO, '--helper'], env },
      { label: 'helper under Node', exe: node, args: [path.join(REPO, 'src', 'main', 'helper', 'helper-process.js')], env },
    ];
  }
  return [
    { label: 'helper under Electron, as the app starts it', exe: process.execPath, args: [LAUNCHER], env },
    { label: 'helper under Node', exe: node, args: [LAUNCHER], env },
  ];
}

async function readThrough(runtime, drive = 'Z') {
  const client = new HelperClient({
    launch: (name, nonce) =>
      new Promise((resolve, reject) => {
        const child = spawn(runtime.exe, [...runtime.args, '--pipe', name, '--nonce', nonce], { env: runtime.env, stdio: 'ignore', windowsHide: true });
        child.once('spawn', resolve);
        child.once('error', reject);
      }),
  });
  const started = Date.now();
  await client.start();
  try {
    const ping = await client.request('ping');
    let progress = 0;
    const read = await mftRead.readElevated(client, drive, { onProgress: () => (progress += 1) });
    return { read, ping, progress, ms: Date.now() - started };
  } finally {
    client.stop();
  }
}

/** A real drive, through each helper, compared with each other. */
async function real() {
  console.log(`\n$MFT of ${REAL}: through the shipped helper and a real pipe\n`);
  const answers = [];
  for (const runtime of runtimes()) {
    console.log(`\n${runtime.label}\n`);
    try {
      const { read, ping, ms } = await readThrough(runtime, REAL);
      if (!ping || !ping.elevated) {
        check('the helper is elevated', false, `integrity ${ping && ping.integrity}: run this from an elevated terminal`);
        continue;
      }
      let bytes = 0;
      for (let i = 0; i < read.files.length; i++) bytes += read.files.size[i];
      const built = mftRead.sourceFor(read, `${REAL}:\\`);
      check('the table came back', read.files.length > 0, `${read.files.length.toLocaleString('en-US')} files, ${read.folders.size.toLocaleString('en-US')} folders, ${(bytes / 2 ** 30).toFixed(2)} GiB, ${(ms / 1000).toFixed(1)} s`);
      check('it agrees with the helper\'s own count', read.summary.fileCount === read.files.length, `${read.summary.fileCount} counted, ${read.summary.torn} torn`);
      check('every folder has a path', built.orphaned === 0 && built.looped === 0, `${built.orphaned} orphaned, ${built.looped} looped`);
      answers.push({ label: runtime.label, files: read.files.length, folders: read.folders.size, bytes });
    } catch (err) {
      // The point of this mode: the words the read failed with.
      check('the table came back', false, `${err.code || ''} ${err.message}`.trim());
    }
  }
  if (answers.length === 2) {
    const [a, b] = answers;
    check('both helpers read the same table', a.files === b.files && a.folders === b.folders && a.bytes === b.bytes,
      `${a.files} / ${b.files} files`);
  }
}

app.whenReady().then(async () => {
  if (REAL) {
    try {
      if (!/^[A-Z]$/.test(REAL)) throw new Error('--real takes a drive letter');
      await real();
    } catch (err) {
      console.error(err);
      failures += 1;
    }
    console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}\n`);
    app.exit(failures === 0 ? 0 : 1);
    return;
  }
  try {
    console.log(`\n$MFT through the real helper and a real pipe: ${FILES.toLocaleString('en-US')} files in ${FOLDERS} folders\n`);
    const { volume, expected } = contiguousVolume({ folders: FOLDERS, files: FILES, nameOf });
    fs.writeFileSync(IMAGE, volume);
    console.log(`  image: ${(volume.length / 1024 / 1024).toFixed(1)} MB at ${IMAGE}`);

    // How many pieces the table needs, by the same rule the helper cuts by.
    let pieces = 0;
    {
      const names = Array.from({ length: FILES }, (_, i) => nameOf(i));
      const fake = { length: FILES, name: names };
      for (const column of wire.NUMERIC) fake[column] = new Float64Array(FILES);
      for (const chunk of wire.chunksOf(new Map(), fake, { maxBytes: MAX_CHUNK_BYTES, maxRecords: 8192 })) if (chunk.kind === 'files') pieces += 1;
    }
    check('the table is big enough to go in several pieces', pieces > 3, `${pieces} pieces of files`);

    for (const runtime of runtimes()) {
      console.log(`\n${runtime.label}\n`);
      let result;
      try {
        result = await readThrough(runtime);
      } catch (err) {
        check('the read came back', false, `${err.code || ''} ${err.message}`);
        continue;
      }
      const { read, ping, ms } = result;
      check('the helper answered, through the handshake', Boolean(ping) && typeof ping.integrity === 'string', `integrity ${ping && ping.integrity}`);
      check('every file arrived', read.files.length === expected.files, `${read.files.length.toLocaleString('en-US')} of ${expected.files.toLocaleString('en-US')}`);
      check('every folder arrived, and the root', read.folders.size === expected.folders + 1, String(read.folders.size));
      let bytes = 0;
      for (let i = 0; i < read.files.length; i++) bytes += read.files.size[i];
      check('and the sizes add up to the byte', bytes === expected.bytes, `${bytes} vs ${expected.bytes}`);
      check('the helper\'s own count agrees', read.summary.fileCount === expected.files && read.summary.torn === 0, `${read.summary.fileCount} files, ${read.summary.torn} torn`);

      const built = mftRead.sourceFor(read, 'Z:\\');
      check('every folder has a path, none orphaned or looped', built.orphaned === 0 && built.looped === 0, `${built.orphaned} orphaned, ${built.looped} looped`);
      let found = 0;
      for (const [rel, size] of expected.paths) {
        const name = rel.slice(rel.lastIndexOf('\\') + 1);
        for (let i = 0; i < read.files.length; i++) {
          if (read.files.name[i] !== name) continue;
          if (`${built.paths.get(read.files.parent[i])}\\${name}` === `Z:\\${rel}` && read.files.size[i] === size) found += 1;
          break;
        }
      }
      check('named files land at their paths, Vietnamese names included', found === expected.paths.size, `${found} of ${expected.paths.size}`);
      console.log(`  ${(ms / 1000).toFixed(1)} s from start to the last piece`);
    }

    // And the one step the image stands in for, as far as it goes without
    // administrator: the shipped helper, under Electron, asks Windows for the
    // volume device itself. Unelevated that is refused (EPERM); elevated it is
    // read. What it must never be is EISDIR -- the drive's root folder opened
    // instead, which is what Electron 33's Node made of `\\.\D:` until the
    // path went in as a Buffer (`system/mft.js`).
    console.log('\nthe shipped helper, under Electron, opening the real D: device\n');
    {
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.CLEANDRIVE_MFT_IMAGE;
      let outcome;
      try {
        const { read } = await readThrough({ exe: process.execPath, args: [REPO, '--helper'], env }, 'D');
        outcome = `read ${read.files.length} files`;
      } catch (err) {
        outcome = err.message;
      }
      check('it reaches the volume, not a folder: never EISDIR', !/EISDIR/.test(outcome) && (/EPERM/.test(outcome) || /^read \d+ files$/.test(outcome)), outcome);
    }
  } catch (err) {
    console.error(err);
    failures += 1;
  }
  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}\n`);
  app.exit(failures === 0 ? 0 : 1);
});
