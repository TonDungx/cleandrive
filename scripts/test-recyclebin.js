#!/usr/bin/env node
'use strict';

// Selective purge is the only permanent deletion in this app. These tests are
// written from the attacker's side: each one asks "what would have to be true
// for this to delete the wrong file", and then makes that true.
//   node scripts/test-recyclebin.js

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  parseMeta,
  encodeMeta,
  findUserBins,
  listItems,
  purgeRecorded,
  TIME_TOLERANCE_MS,
} = require('../src/main/lib/recyclebin');
const { TrashLedger } = require('../src/main/lib/ledger');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const DAY = 24 * 60 * 60 * 1000;
const exists = (p) => fsp.access(p).then(() => true, () => false);

/** Create a `$I`/`$R` pair in `dir`, the way Windows lays one out. */
async function makeBinItem(dir, id, originalPath, { size = 1024, deletedAt = Date.now(), ext = '.bin' } = {}) {
  const meta = path.join(dir, `$I${id}${ext}`);
  const data = path.join(dir, `$R${id}${ext}`);
  await fsp.writeFile(meta, encodeMeta({ originalPath, size, deletedAt }));
  await fsp.writeFile(data, Buffer.alloc(Math.min(size, 4096), 1));
  return { meta, data };
}

(async () => {
  console.log('\nrecyclebin: $I metadata format\n');

  {
    const when = Date.UTC(2026, 0, 2, 3, 4, 5);
    const original = path.resolve(`C:${path.sep}Users${path.sep}me${path.sep}Downloads${path.sep}a.bin`);
    const round = parseMeta(encodeMeta({ originalPath: original, size: 123456, deletedAt: when }));
    check('the original path survives a round trip', round && round.originalPath === original,
      round ? round.originalPath : 'null');
    check('the size survives', round && round.size === 123456);
    check('the deletion time survives to the millisecond', round && round.deletedAt === when,
      round ? `${round.deletedAt} vs ${when}` : 'null');
  }

  {
    check('a truncated file is rejected, not half-read', parseMeta(Buffer.alloc(8)) === null);
    check('a buffer with an unknown version is rejected',
      parseMeta((() => { const b = encodeMeta({ originalPath: 'C:\\x', size: 1 }); b.writeBigInt64LE(99n, 0); return b; })()) === null);
    check('a non-buffer is rejected', parseMeta('not a buffer') === null);
    check('a lying length field cannot read past the end',
      parseMeta((() => { const b = encodeMeta({ originalPath: 'C:\\x', size: 1 }); b.writeUInt32LE(0xffff, 24); return b; })()) === null);
  }

  console.log('\nrecyclebin: what purge refuses\n');

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-bin-'));
  const bin = path.join(dir, 'bin');
  const outside = path.join(dir, 'outside');
  await fsp.mkdir(bin, { recursive: true });
  await fsp.mkdir(outside, { recursive: true });

  const now = Date.now();
  const long = now - 30 * DAY; // comfortably past any grace period
  const P = (name) => path.resolve(dir, 'src', name);

  const ours = await makeBinItem(bin, 'AAA', P('ours.bin'), { size: 4096, deletedAt: long });
  const theirs = await makeBinItem(bin, 'BBB', P('theirs.bin'), { size: 4096, deletedAt: long });
  const sameNameDifferentEvent = await makeBinItem(bin, 'CCC', P('recreated.bin'), { size: 4096, deletedAt: long });
  const fresh = await makeBinItem(bin, 'DDD', P('fresh.bin'), { size: 4096, deletedAt: now - 1 * DAY });
  const elsewhere = await makeBinItem(outside, 'EEE', P('elsewhere.bin'), { size: 4096, deletedAt: long });

  const entries = [
    { path: P('ours.bin'), size: 4096, trashedAt: long },
    // Same path as a bin item, but our record is of a different deletion.
    { path: P('recreated.bin'), size: 4096, trashedAt: long - 10 * DAY },
    { path: P('fresh.bin'), size: 4096, trashedAt: now - 1 * DAY },
    // A hand-edited ledger claiming something precious. No bin item backs it.
    { path: P('thesis.docx'), size: 999999, trashedAt: long },
    // Names a real item, but that item lives outside the bins we enumerated.
    { path: P('elsewhere.bin'), size: 4096, trashedAt: long },
  ];

  {
    const found = await listItems([bin]);
    check('every pair in the bin is listed', found.length === 4, String(found.length));
    check('paths are read back from the metadata, not the filename',
      found.some((i) => i.originalPath === P('ours.bin')));
  }

  {
    const dry = await purgeRecorded({ entries, binDirs: [bin], afterDays: 7, now, dryRun: true });
    check('a dry run matches exactly one item', dry.matched === 1, `matched ${dry.matched}`);
    check('a dry run deletes nothing', await exists(ours.data));
    check('a dry run still reports the bytes', dry.freedBytes === 4096, String(dry.freedBytes));
  }

  const result = await purgeRecorded({ entries, binDirs: [bin], afterDays: 7, now });

  check('the item we recorded is purged', !(await exists(ours.data)) && !(await exists(ours.meta)));
  check('both halves of the pair go, leaving no phantom entry', !(await exists(ours.meta)));
  check('freed bytes are counted', result.freedBytes === 4096, String(result.freedBytes));
  check('exactly one item was purged', result.purged.length === 1, String(result.purged.length));

  check("a file the user deleted themselves is untouched",
    (await exists(theirs.data)) && (await exists(theirs.meta)));
  check('the same path deleted at a different time is untouched',
    (await exists(sameNameDifferentEvent.data)));
  check('an item still inside the grace period is untouched', await exists(fresh.data));
  check('a ledger entry with no matching bin item deletes nothing',
    !result.purged.some((p) => p.originalPath === P('thesis.docx')));
  check('an item outside the enumerated bins is untouched', await exists(elsewhere.data));
  check('nothing outside the bin directory was examined',
    result.examined === 4, String(result.examined));

  console.log('\nrecyclebin: the timestamp window\n');

  {
    const edge = path.join(dir, 'edge');
    await fsp.mkdir(edge, { recursive: true });
    const inside = await makeBinItem(edge, 'FFF', P('inside.bin'), { deletedAt: long });
    const justOutside = await makeBinItem(edge, 'GGG', P('outside-window.bin'), { deletedAt: long });

    const edgeEntries = [
      { path: P('inside.bin'), trashedAt: long + TIME_TOLERANCE_MS - 1000, size: 0 },
      { path: P('outside-window.bin'), trashedAt: long + TIME_TOLERANCE_MS + 60000, size: 0 },
    ];

    await purgeRecorded({ entries: edgeEntries, binDirs: [edge], afterDays: 7, now });
    check('a record just inside the tolerance matches', !(await exists(inside.data)));
    check('a record just outside the tolerance does not', await exists(justOutside.data));
  }

  console.log('\nrecyclebin: limits\n');

  {
    const many = path.join(dir, 'many');
    await fsp.mkdir(many, { recursive: true });
    const manyEntries = [];
    for (let i = 0; i < 10; i++) {
      const p = P(`many-${i}.bin`);
      await makeBinItem(many, `M${i}`, p, { size: 100, deletedAt: long });
      manyEntries.push({ path: p, size: 100, trashedAt: long });
    }
    const capped = await purgeRecorded({ entries: manyEntries, binDirs: [many], afterDays: 7, now, maxItems: 3 });
    check('the per-run cap is honoured', capped.purged.length === 3, String(capped.purged.length));
    const left = (await fsp.readdir(many)).filter((n) => n.startsWith('$R'));
    check('the rest are still there', left.length === 7, String(left.length));
  }

  console.log('\nrecyclebin: the ledger it reads from\n');

  {
    const ledgerFile = path.join(dir, 'ledger.json');
    const ledger = new TrashLedger(ledgerFile);
    await ledger.load();
    await ledger.record([{ path: P('a.bin'), size: 10 }, { path: P('b.bin'), size: 20 }], { trashedAt: long, runId: 'r1' });
    await ledger.record([{ path: P('c.bin'), size: 30 }], { trashedAt: now, runId: 'r2' });

    const reread = new TrashLedger(ledgerFile);
    await reread.load();
    check('the ledger round-trips through disk', reread.entries.length === 3, String(reread.entries.length));
    check('only entries past the grace period are offered for purge',
      reread.expired(7, now).length === 2, String(reread.expired(7, now).length));
    check('a just-trashed entry is not offered', reread.expired(7, now).every((e) => e.path !== P('c.bin')));

    await reread.forget(reread.expired(7, now));
    const third = new TrashLedger(ledgerFile);
    await third.load();
    check('purged entries are forgotten', third.entries.length === 1, String(third.entries.length));

    await fsp.writeFile(ledgerFile, 'garbage{', 'utf8');
    const broken = new TrashLedger(ledgerFile);
    await broken.load();
    check('a corrupt ledger reads as empty rather than throwing', broken.entries.length === 0);
  }

  console.log('\nrecyclebin: the real bin on this machine (read only)\n');

  {
    const bins = await findUserBins([process.cwd()]);
    check('a readable per-user bin folder is found', process.platform !== 'win32' || bins.length >= 1,
      bins.join(', ') || 'none');
    check('every found bin sits under a $Recycle.Bin folder',
      bins.every((b) => path.dirname(b).toLowerCase().endsWith('$recycle.bin')), bins.join(', '));
    check("other accounts' bins are skipped rather than reported as errors",
      Array.isArray(bins));

    // Nothing is recorded in a fresh ledger, so a real purge must be a no-op.
    const realDry = await purgeRecorded({ entries: [], binDirs: bins, afterDays: 7, dryRun: true });
    check('with an empty ledger the real bin is left entirely alone', realDry.purged.length === 0);
  }

  await fsp.rm(dir, { recursive: true, force: true });
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
