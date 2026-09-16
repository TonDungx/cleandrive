'use strict';

// Measures shell.trashItem throughput so the progress UI can show a real ETA.
// Creates its own throwaway files in temp, trashes them, then purges exactly
// those items from the Recycle Bin again.
//
//   npx electron scripts/bench-trash.js [countPerRun]

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, shell } = require('electron');

const N = Number(process.argv[2]) || 100;

function makeFiles(label, count) {
  const dir = path.join(os.tmpdir(), `cleandrive-bench-${label}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (let i = 0; i < count; i++) {
    const file = path.join(dir, `bench-${label}-${i}.bin`);
    fs.writeFileSync(file, 'x'.repeat(256));
    files.push(file);
  }
  return files;
}

async function sequential(files) {
  const started = Date.now();
  for (const file of files) await shell.trashItem(file);
  return Date.now() - started;
}

async function concurrent(files, limit) {
  const started = Date.now();
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (;;) {
        const i = next++;
        if (i >= files.length) return;
        await shell.trashItem(files[i]);
      }
    })
  );
  return Date.now() - started;
}

const rate = (ms, count) => (count / (ms / 1000)).toFixed(0);
const project = (ms, count, target) => {
  const seconds = (ms / count) * target / 1000;
  return seconds < 90 ? `${seconds.toFixed(0)}s` : `${(seconds / 60).toFixed(1)} min`;
};

app.whenReady().then(async () => {
  console.log(`\nshell.trashItem throughput (${N} files per run)\n`);
  const results = [];

  const seqMs = await sequential(makeFiles('seq', N));
  results.push(['sequential', seqMs]);
  console.log(`  sequential      ${String(seqMs).padStart(6)} ms   ${rate(seqMs, N).padStart(5)} files/s   200k would take ${project(seqMs, N, 200000)}`);

  for (const limit of [2, 4, 8]) {
    const ms = await concurrent(makeFiles(`c${limit}`, N), limit);
    results.push([`concurrent x${limit}`, ms]);
    console.log(`  concurrent x${limit}   ${String(ms).padStart(6)} ms   ${rate(ms, N).padStart(5)} files/s   200k would take ${project(ms, N, 200000)}`);
  }

  const best = results.reduce((a, b) => (b[1] < a[1] ? b : a));
  console.log(`\n  fastest: ${best[0]}\n`);

  // Purge exactly the benchmark items -- files this script created moments ago.
  //
  // This used to shell out to PowerShell and remove only the `$R` half of each
  // pair, which left the `$I` metadata behind as a phantom Recycle Bin entry;
  // thousands of them accumulated over earlier runs. recyclebin.js removes both
  // halves, and matches on the original path recorded in the metadata rather
  // than on a display name.
  try {
    const { findUserBins, listItems } = require('../src/main/lib/recyclebin');
    const fsp = require('node:fs/promises');

    const bins = await findUserBins([os.tmpdir()]);
    const mine = (await listItems(bins)).filter((item) =>
      item.originalPath.startsWith(path.join(os.tmpdir(), 'cleandrive-bench'))
    );

    for (const item of mine) {
      await fsp.rm(item.dataPath, { recursive: true, force: true });
      await fsp.rm(item.metaPath, { force: true });
    }

    console.log(`  ${mine.length} benchmark item(s) purged from the Recycle Bin, metadata included\n`);
  } catch (err) {
    console.log(`  NOTE: benchmark files are still in the Recycle Bin (${err.message})\n`);
  }

  app.exit(0);
});
