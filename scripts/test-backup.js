#!/usr/bin/env node
'use strict';

// Backing up before deleting (E2).
//   node scripts/test-backup.js
//
// Everything here is real except the Recycle Bin. The copies are written to a
// real folder on a real second volume, hashed with the real hasher, read back
// off the disk, and checked byte for byte; the manifest is a real file that is
// parsed again after it is written. `shell.trashItem` is replaced with a move
// into a folder of the harness's own, the same substitution
// `test-quarantine.js` and `test-relocate.js` make and for the same reason: a
// test suite has no business putting anybody's files in their bin.
//
// The fixture is built on **D:**, not under `os.tmpdir()`. `os.tmpdir()` is
// inside AppData on this machine, which is on C:, and the destination of a
// backup is meant to be a different drive. A fixture that was all on one
// volume would make the per-volume folder layout look right for the wrong
// reason. The harness checks it got two volumes before it starts, and the fake
// bin is put on the *source* volume because that is where a real bin is --
// one on the other drive turns every trashItem into a cross-device rename.

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const backup = require('../src/main/lib/backup');
const recycle = require('../src/main/actions/recycle');
const { execute } = require('../src/main/actions/execute');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

/** A Recycle Bin of the harness's own. */
function fakeShell(bin) {
  return {
    async trashItem(target) {
      await fsp.rename(target, path.join(bin, `${Date.now()}-${crypto.randomUUID()}-${path.basename(target)}`));
    },
  };
}

/** Two volumes, or this file cannot test what it is for. */
function secondVolume() {
  const home = path.parse(os.homedir()).root;
  for (const letter of 'DEFGH') {
    const root = `${letter}:\\`;
    try {
      if (fs.statSync(root).dev !== fs.statSync(home).dev) return root;
    } catch {
      // not there
    }
  }
  return null;
}

(async () => {
  console.log('\nbackup: where a file lands\n');

  /* -- the layout, which needs no disk ------------------------------------ */
  check('a local path keeps its volume as the first folder',
    backup.relativeFor('C:\\Users\\me\\Pictures\\a.jpg') === path.join('C', 'Users', 'me', 'Pictures', 'a.jpg'),
    backup.relativeFor('C:\\Users\\me\\Pictures\\a.jpg'));

  check('a lower-case drive letter is normalised',
    backup.relativeFor('d:\\photos\\b.jpg') === path.join('D', 'photos', 'b.jpg'),
    backup.relativeFor('d:\\photos\\b.jpg'));

  // Without the volume folder these two are the same destination, and a backup
  // that silently kept one of the two would be the worst possible bug here.
  check('the same path on two drives does not collide',
    backup.relativeFor('C:\\photos\\a.jpg') !== backup.relativeFor('D:\\photos\\a.jpg'),
    `${backup.relativeFor('C:\\photos\\a.jpg')} vs ${backup.relativeFor('D:\\photos\\a.jpg')}`);

  check('a UNC path keeps its server and share',
    backup.relativeFor('\\\\nas\\photos\\2019\\b.jpg') === path.join('UNC', 'nas', 'photos', '2019', 'b.jpg'),
    backup.relativeFor('\\\\nas\\photos\\2019\\b.jpg'));

  check('a drive root alone has nowhere to go', backup.relativeFor('C:\\') === null);
  // Not a detail. `path.resolve('')` is the working directory, so a version of
  // this that resolved before checking turned an empty path into a real folder
  // and would have backed up the app's own directory.
  check('a relative path is refused', backup.relativeFor('photos\\a.jpg') === null,
    String(backup.relativeFor('photos\\a.jpg')));
  check('rubbish is refused',
    backup.relativeFor('') === null && backup.relativeFor(null) === null && backup.relativeFor(7) === null);

  /* -- the fixture -------------------------------------------------------- */
  console.log('\nbackup: the fixture\n');

  const other = secondVolume();
  check('there are two volumes to back up between', other !== null, other || 'only one');
  if (!other) {
    console.log('\n1 FAILURE(S) -- this machine cannot test a backup to another drive\n');
    process.exit(1);
  }

  const onC = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-backup-src-'));
  const onD = await fsp.mkdtemp(path.join(other, 'cleandrive-backup-'));
  const dest = path.join(onD, 'destination');
  const bin = path.join(onC, 'bin');
  await fsp.mkdir(dest);
  await fsp.mkdir(bin);

  check('the source is not on the destination volume',
    fs.statSync(onC).dev !== fs.statSync(onD).dev, `${onC} vs ${onD}`);
  check('and os.tmpdir() really is on the other one, as assumed',
    path.parse(os.tmpdir()).root.toLowerCase() !== other.toLowerCase(), os.tmpdir());

  const photos = path.join(onC, 'Pictures', 'trip');
  await fsp.mkdir(photos, { recursive: true });

  const bodies = new Map();
  const put = async (dir, name, bytes) => {
    const full = path.join(dir, name);
    const body = crypto.randomBytes(bytes);
    await fsp.writeFile(full, body);
    bodies.set(full, crypto.createHash('sha256').update(body).digest('hex'));
    return full;
  };

  const one = await put(photos, 'a.jpg', 40000);
  const two = await put(photos, 'ảnh tiếng việt.jpg', 9000);
  const three = await put(photos, 'c.jpg', 1200);

  // The zone mark, which is the stream that changes how Windows treats a file.
  // B2 decided these are kept; E2 keeps them for the same reason, so a photo
  // restored from a backup still carries the warning it came with.
  await fsp.writeFile(`${one}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://example.com/a.jpg\r\n');
  const oldTime = new Date('2019-08-17T09:30:00Z');
  await fsp.utimes(one, oldTime, oldTime);

  const items = [one, two, three].map((p) => ({ path: p, size: fs.statSync(p).size }));

  /* -- the copy ----------------------------------------------------------- */
  console.log('\nbackup: the copies, and proving they arrived\n');

  const first = await backup.backupAll(items, dest, {});
  check('every file was copied', first.saved.length === 3, `${first.saved.length} saved, ${first.failed.length} failed`);
  check('and none of them failed', first.failed.length === 0,
    first.failed.map((f) => `${path.basename(f.path)}: ${f.error}`).join('; '));

  const copyOf = (src) => path.join(dest, backup.relativeFor(src));
  check('the copy is byte for byte the original', [one, two, three].every((p) => sha(copyOf(p)) === bodies.get(p)));
  check('a Vietnamese filename survives', fs.existsSync(copyOf(two)), path.basename(copyOf(two)));

  check('the hash in the result is the real hash of the file on disk',
    first.saved.every((s) => s.sha256 === sha(s.target)));

  check('the original is still where it was', [one, two, three].every((p) => fs.existsSync(p)));

  // The layout, on a real disk rather than in the string test above.
  const volume = path.parse(onC).root[0].toUpperCase();
  check('the copies sit under a folder named after the source volume',
    fs.existsSync(path.join(dest, volume)), path.join(dest, volume));

  /* -- the streams and the times ------------------------------------------ */
  let zone = null;
  try {
    zone = fs.readFileSync(`${copyOf(one)}:Zone.Identifier`, 'utf8');
  } catch {
    zone = null;
  }
  check('the zone mark came with it', zone !== null && zone.includes('ZoneId=3'), zone ? 'copied' : 'missing');
  check('and it is recorded as copied', first.saved.some((s) => (s.streams || []).includes('Zone.Identifier')));

  check('the modification time is the original one',
    Math.abs(fs.statSync(copyOf(one)).mtimeMs - oldTime.getTime()) < 2000,
    new Date(fs.statSync(copyOf(one)).mtimeMs).toISOString());

  /* -- the manifest ------------------------------------------------------- */
  console.log('\nbackup: the manifest\n');

  check('a manifest.json was written', first.manifestPath === path.join(dest, 'manifest.json'), first.manifestPath || 'none');
  check('and nothing went wrong writing it', !first.manifestError, first.manifestError || '');

  const manifest = JSON.parse(fs.readFileSync(path.join(dest, 'manifest.json'), 'utf8'));
  check('it says which app wrote it', manifest.app === 'CleanDrive', manifest.app);
  check('it holds one run', manifest.backups.length === 1, String(manifest.backups.length));
  check('naming every file', manifest.backups[0].files.length === 3, String(manifest.backups[0].files.length));
  check('with the hash that was measured',
    manifest.backups[0].files.every((f) => f.sha256 === sha(path.join(dest, f.to))));
  check('and where each one came from',
    manifest.backups[0].files.some((f) => f.from === one), manifest.backups[0].files[0].from);
  check('the destination is written relative, so the folder can be moved',
    manifest.backups[0].files.every((f) => !path.isAbsolute(f.to) && !f.to.includes('\\')),
    manifest.backups[0].files[0].to);

  /* -- a second run into the same folder ---------------------------------- */
  console.log('\nbackup: backing up to the same folder again\n');

  const again = await backup.backupAll(items, dest, {});
  check('the files already there are recognised, not copied again',
    again.saved.every((s) => s.already), again.saved.map((s) => String(s.already)).join(','));
  check('and they still count as backed up', again.saved.length === 3, String(again.saved.length));

  const manifest2 = JSON.parse(fs.readFileSync(path.join(dest, 'manifest.json'), 'utf8'));
  check('the manifest gained a run rather than losing one', manifest2.backups.length === 2,
    String(manifest2.backups.length));
  check('the first run is still in it', manifest2.backups[0].files.length === 3);

  // Same name, different contents: nothing may be overwritten.
  const collide = await put(path.join(onC, 'Pictures', 'trip'), 'a.jpg.tmp', 500);
  await fsp.rename(collide, path.join(onC, 'Pictures', 'trip', 'a.jpg'));
  const third = await backup.backupAll(
    [{ path: one, size: fs.statSync(one).size }], dest, {}
  );
  check('a different file of the same name gets its own name, and the old copy survives',
    third.saved.length === 1 && path.basename(third.saved[0].target) === 'a (2).jpg' &&
      sha(copyOf(one)) === bodies.get(one),
    path.basename(third.saved[0].target));

  /* -- a copy that cannot be trusted -------------------------------------- */
  console.log('\nbackup: a copy that does not match\n');

  const badDest = path.join(onD, 'bad-destination');
  await fsp.mkdir(badDest);
  // A drive that accepts a write and stores something else. This is the whole
  // reason the copy is read back off the disk rather than trusted.
  const corrupting = async (handle, part, position) => {
    const flipped = Buffer.from(part);
    if (position === 0 && flipped.length > 0) flipped[0] = flipped[0] ^ 0xff;
    return handle.write(flipped);
  };
  const bad = await backup.backupAll(items, badDest, { write: corrupting });
  check('a copy whose hash does not match is refused', bad.failed.length === 3,
    `${bad.saved.length} saved, ${bad.failed.length} failed`);
  check('and the failure says so', bad.failed.every((f) => f.code === 'EVERIFY'),
    bad.failed.map((f) => f.code).join(','));
  check('the half-written copy is not left behind',
    !fs.existsSync(path.join(badDest, backup.relativeFor(one))));
  check('and no manifest claims anything was saved', !fs.existsSync(path.join(badDest, 'manifest.json')));

  /* -- through the action, which is where it matters ----------------------- */
  console.log('\nbackup: the delete that waits for it (E2 through the pipeline)\n');

  const throughDest = path.join(onD, 'through');
  await fsp.mkdir(throughDest);

  const result = await execute(
    { kind: 'recycle', items: [one, two, three], options: { backupTo: throughDest } },
    { deps: { shell: fakeShell(bin) }, can: () => true }
  );

  check('the originals went to the bin', result.moved.length === 3,
    `${result.moved.length} moved, ${result.failed.length} failed`);
  check('and they really are gone from where they were',
    [one, two, three].every((p) => !fs.existsSync(p)));
  check('a copy of each is at the destination',
    [one, two, three].every((p) => fs.existsSync(path.join(throughDest, backup.relativeFor(p)))));
  check('the receipt says how many were copied', result.backup && result.backup.saved === 3,
    result.backup ? String(result.backup.saved) : 'no backup in the result');
  check('and where they went', result.backup && result.backup.destination === throughDest,
    result.backup ? result.backup.destination : '');
  check('the manifest was written before the delete, and is on disk now',
    fs.existsSync(path.join(throughDest, 'manifest.json')));

  /* -- and the rule that makes the feature worth having -------------------- */
  console.log('\nbackup: a file whose copy fails is not deleted\n');

  const restored = path.join(onC, 'Pictures', 'trip2');
  await fsp.mkdir(restored, { recursive: true });
  const keepMe = await put(restored, 'keep.jpg', 3000);
  const alsoKeep = await put(restored, 'keep2.jpg', 2500);

  const refusingDest = path.join(onD, 'refusing');
  await fsp.mkdir(refusingDest);

  const refused = await execute(
    { kind: 'recycle', items: [keepMe, alsoKeep], options: { backupTo: refusingDest } },
    { deps: { shell: fakeShell(bin), write: corrupting }, can: () => true }
  );

  check('nothing was deleted', refused.moved.length === 0, String(refused.moved.length));
  check('both files are still exactly where they were',
    fs.existsSync(keepMe) && fs.existsSync(alsoKeep));
  check('and both are named in the failures, so the receipt can list them',
    refused.failed.length === 2, refused.failed.map((f) => path.basename(f.path)).join(', '));

  /* -- turning it off ----------------------------------------------------- */
  const noBackup = await execute(
    { kind: 'recycle', items: [keepMe], options: {} },
    { deps: { shell: fakeShell(bin) }, can: () => true }
  );
  check('with no destination it is an ordinary delete', noBackup.moved.length === 1 && !noBackup.backup,
    `${noBackup.moved.length} moved`);

  /* -- what the dialog is told -------------------------------------------- */
  const planned = await recycle.plan([alsoKeep], {}, { token: { cancelled: false }, onProgress: () => {} });
  const withDest = recycle.describe(planned, { backupTo: throughDest });
  const without = recycle.describe(planned, {});
  check('the confirmation is told where the backup goes', withDest.backupTo === throughDest, withDest.backupTo || '');
  check('and is told nothing when there is none', without.backupTo === null, String(without.backupTo));

  /* -- clean up ----------------------------------------------------------- */
  await fsp.rm(onC, { recursive: true, force: true }).catch(() => {});
  await fsp.rm(onD, { recursive: true, force: true }).catch(() => {});

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
