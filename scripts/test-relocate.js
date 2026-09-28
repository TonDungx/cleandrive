#!/usr/bin/env node
'use strict';

// Moving a folder to another drive (B2).
//   node scripts/test-relocate.js
//
// The tree, the copies, the hashes, the streams, the long paths and the
// junction are all real and all on disk. Two things are stood in for: the
// Recycle Bin, which is `shell.trashItem` replaced by a move into a folder of
// the harness's own -- the same substitution `test-quarantine.js` makes, and
// for the same reason, that a test suite has no business putting things in the
// person's bin -- and nothing else.
//
// The fixture is built on **D:**, not under `os.tmpdir()`. That is not a
// preference: `os.tmpdir()` is inside AppData on this machine, which is on C:,
// and the whole point of this feature is moving a folder from one volume to
// another. A fixture on one drive would make "refuses the same volume" pass
// for the wrong reason. The harness checks it got two volumes before starting.

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const relocate = require('../src/main/actions/relocate');
const treeCopy = require('../src/main/lib/tree-copy');
const ads = require('../src/main/lib/ads');
const { execute } = require('../src/main/actions/execute');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const LONG = '\\\\?\\';
const exists = (p) => fs.existsSync(p.length > 240 ? LONG + p : p);

/** A Recycle Bin of the harness's own: whole folders move into it, intact. */
function fakeShell(bin, { fail = false } = {}) {
  return {
    async trashItem(target) {
      if (fail) throw new Error('the bin refused it');
      await fsp.rename(target, path.join(bin, `${Date.now()}-${path.basename(target)}`));
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
  console.log('\nrelocate: the fixture\n');

  const other = secondVolume();
  check('there are two volumes to move between', other !== null, other || 'only one');
  if (!other) {
    console.log('\n1 FAILURE(S) -- this machine cannot test a cross-drive move\n');
    process.exit(1);
  }

  const onC = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-relocate-src-'));
  const onD = await fsp.mkdtemp(path.join(other, 'cleandrive-relocate-'));
  const dest = path.join(onD, 'destination');
  // On the source volume, because the real Recycle Bin always is: a bin on
  // another drive turns every move into a cross-device rename and fails with
  // EXDEV, which is a fact about this harness and not about the feature.
  const bin = path.join(onC, 'bin');
  await fsp.mkdir(dest);
  await fsp.mkdir(bin);

  check('the source is not on the destination volume',
    fs.statSync(onC).dev !== fs.statSync(onD).dev, `${onC} vs ${onD}`);
  check('and os.tmpdir() really is on the other one, as assumed',
    path.parse(os.tmpdir()).root.toLowerCase() !== other.toLowerCase(), os.tmpdir());

  /* -- a folder worth moving --------------------------------------------- */
  const source = path.join(onC, 'Videos 2019');
  await fsp.mkdir(path.join(source, 'trip', 'day one'), { recursive: true });
  await fsp.mkdir(path.join(source, 'nothing in here'), { recursive: true });

  const bodies = new Map();
  const put = async (rel, bytes) => {
    const full = path.join(source, rel);
    const body = crypto.randomBytes(bytes);
    await fsp.writeFile(full, body);
    bodies.set(rel, crypto.createHash('sha256').update(body).digest('hex'));
    return full;
  };
  const marked = await put('clip.mp4', 40000);
  await put(path.join('trip', 'photo.jpg'), 9000);
  await put(path.join('trip', 'day one', 'ảnh tiếng việt.jpg'), 1200);

  // The zone mark, which is the stream that changes how Windows treats a file.
  await fsp.writeFile(`${marked}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://example.com/clip.mp4\r\n');
  const oldTime = new Date('2019-08-17T09:30:00Z');
  await fsp.utimes(marked, oldTime, oldTime);

  // A path past MAX_PATH, built with the prefix Windows needs for one.
  const seg = 'D'.repeat(90);
  const deepDir = path.join(source, seg, seg);
  await fsp.mkdir(LONG + deepDir, { recursive: true });
  await fsp.writeFile(LONG + path.join(deepDir, 'far.txt'), 'far away');

  // A junction, which must be stepped over rather than followed or recreated.
  execFileSync('cmd', ['/c', 'mklink', '/J', path.join(source, 'elsewhere'), onD], { stdio: 'ignore' });

  console.log('\nrelocate: reading the tree\n');

  const tree = await treeCopy.walk(source);
  check('every file is found, including the one past 260 characters',
    tree.files.length === 4, `${tree.files.length} files`);
  check('the empty folder is found too, so it can be kept',
    tree.dirs.includes('nothing in here'));
  check('the junction is recorded and not walked into',
    tree.skipped.some((s) => s.reason === 'link' && s.rel === 'elsewhere'), JSON.stringify(tree.skipped));
  check('nothing from the other side of the junction came back',
    !tree.files.some((f) => f.rel.startsWith('elsewhere')));

  console.log('\nrelocate: what it refuses, before anything is copied\n');

  const deps = { shell: fakeShell(bin) };
  const plan = (items, options = {}, extra = {}) =>
    relocate.plan(items, { destination: dest, ...options }, { deps: { ...deps, ...extra } });

  const noDest = await relocate.plan([source], {}, { deps });
  check('a move with no destination is refused', noDest.failed[0] && noDest.failed[0].code === 'ENODEST');

  const aFile = await plan([marked]);
  check('a file is refused: this moves folders', aFile.failed[0] && aFile.failed[0].code === 'ENOTDIR');

  const gone = await plan([path.join(onC, 'not here at all')]);
  check('a folder that is not there is refused', gone.failed[0] && gone.failed[0].code === 'ENOENT');

  const sameDriveDest = path.join(onC, 'elsewhere-on-c');
  await fsp.mkdir(sameDriveDest, { recursive: true });
  const sameDrive = await relocate.plan([source], { destination: sameDriveDest }, { deps });
  check('a destination on the same drive is refused, since nothing would be freed',
    sameDrive.failed[0] && sameDrive.failed[0].code === 'ESAMEVOLUME',
    sameDrive.failed[0] ? sameDrive.failed[0].code : 'none');

  const intoItself = await relocate.plan([source], { destination: path.join(source, 'trip') }, { deps });
  check('a destination inside the folder being moved is refused',
    intoItself.failed[0] && intoItself.failed[0].code === 'ENESTED',
    intoItself.failed[0] ? intoItself.failed[0].code : 'none');

  const root = await plan([path.parse(onC).root]);
  check('a drive root is refused', root.failed[0] && root.failed[0].code === 'EROOT');

  const occupied = path.join(dest, 'Videos 2019');
  await fsp.mkdir(occupied);
  const taken = await plan([source]);
  check('a name already taken in the destination is refused rather than merged',
    taken.failed[0] && taken.failed[0].code === 'EOCCUPIED');
  await fsp.rmdir(occupied);

  console.log('\nrelocate: the folders somebody else owns\n');

  const steamish = path.join(onC, 'Steam', 'steamapps', 'common', 'Some Game');
  await fsp.mkdir(steamish, { recursive: true });
  await fsp.writeFile(path.join(steamish, 'game.dat'), 'x');
  const steam = await plan([steamish]);
  check('a Steam game is handed off rather than moved',
    steam.failed[0] && steam.failed[0].code === 'EHANDOFF', steam.failed[0] ? steam.failed[0].code : 'none');
  check('and the reason names Steam’s own way of doing it',
    steam.handoffs[0] && steam.handoffs[0].kind === 'steam' && /Move install folder/i.test(steam.handoffs[0].message),
    steam.handoffs[0] ? steam.handoffs[0].message : '');

  const documents = path.join(onC, 'Documents');
  await fsp.mkdir(documents, { recursive: true });
  await fsp.writeFile(path.join(documents, 'note.txt'), 'x');
  const shell = await plan([documents], {}, { knownFolders: [{ name: 'Documents', path: documents }] });
  check('a folder Windows has a registered location for is handed off',
    shell.handoffs[0] && shell.handoffs[0].kind === 'shell', JSON.stringify(shell.handoffs[0] || {}));
  check('and the reason names Properties → Location, not an error',
    shell.handoffs[0] && /Location/.test(shell.handoffs[0].message));

  const inCloud = path.join(onC, 'OneDrive-ish');
  await fsp.mkdir(inCloud, { recursive: true });
  await fsp.writeFile(path.join(inCloud, 'doc.txt'), 'x');
  const cloudy = await plan([inCloud], {}, { cloud: { serviceForPath: (p) => (p === inCloud ? 'OneDrive' : null) } });
  check('a folder inside OneDrive is handed off, because binning it deletes it everywhere',
    cloudy.handoffs[0] && cloudy.handoffs[0].kind === 'onedrive', JSON.stringify(cloudy.handoffs[0] || {}));

  console.log('\nrelocate: what the confirmation would say\n');

  const good = await plan([source]);
  check('the folder is planned', good.plan.length === 1, JSON.stringify(good.failed));
  const described = relocate.describe(good);
  check('it counts the files, not just the folder', described.files === 4, String(described.files));
  check('it carries the destination the person chose', described.destination === dest);
  check('it says the link inside was stepped over', described.skippedLinks === 1, String(described.skippedLinks));
  check('binning the original frees nothing yet, and it says so',
    described.freesOnVolume === false && described.reversible === 'bin');
  const deleting = relocate.describe(await plan([source], { deleteOriginal: true }));
  check('deleting the original is the only way it frees anything',
    deleting.freesOnVolume === true && deleting.reversible === 'none');

  console.log('\nrelocate: the move itself\n');

  const before = await ads.list([marked]);
  check('the original carries the zone mark to begin with',
    before.ok && before.streams.has(marked),
    before.ok ? JSON.stringify(before.streams.get(marked) || null) : String(before.error));

  const moved = await relocate.apply(good, {}, { deps });
  check('the folder moved', moved.moved.length === 1, JSON.stringify(moved.failed));
  check('and nothing failed', moved.failed.length === 0, JSON.stringify(moved.failed));

  const landed = path.join(dest, 'Videos 2019');
  check('it is where the person asked for it', exists(landed));
  check('the original is gone from where it was', !exists(source));
  check('the original is in the bin, whole, not file by file',
    fs.readdirSync(bin).length === 1 && fs.statSync(path.join(bin, fs.readdirSync(bin)[0])).isDirectory());

  check('the empty folder came too', exists(path.join(landed, 'nothing in here')));
  check('the file past 260 characters came too',
    exists(path.join(landed, seg, seg, 'far.txt')), String(path.join(landed, seg, seg, 'far.txt').length));
  check('the Vietnamese name survived', exists(path.join(landed, 'trip', 'day one', 'ảnh tiếng việt.jpg')));
  check('the junction was not recreated on the other drive', !exists(path.join(landed, 'elsewhere')));

  for (const [rel, sha] of bodies) {
    const there = path.join(landed, rel);
    const got = crypto.createHash('sha256').update(await fsp.readFile(there)).digest('hex');
    check(`${rel} arrived byte for byte`, got === sha, got === sha ? '' : `${sha} -> ${got}`);
  }

  const zone = await fsp.readFile(`${path.join(landed, 'clip.mp4')}:Zone.Identifier`, 'utf8').catch(() => null);
  check('the "downloaded from the internet" mark came with it',
    zone !== null && zone.includes('ZoneId=3'), zone === null ? 'no stream' : zone.trim());
  check('the move reports how many streams it carried', moved.streams.copied >= 1, String(moved.streams.copied));
  check('and reports that it was able to ask at all', moved.streams.known === true);

  const kept = await fsp.stat(path.join(landed, 'clip.mp4'));
  check('the modification time is the file’s own, not the time it was copied',
    Math.abs(kept.mtime.getTime() - oldTime.getTime()) < 2000, kept.mtime.toISOString());

  check('the manifest names every file with its hash',
    moved.moved[0].manifest.length === 4 && moved.moved[0].manifest.every((m) => /^[0-9a-f]{64}$/.test(m.sha256)),
    String(moved.moved[0].manifest.length));

  console.log('\nrelocate: leaving a shortcut, and never a junction\n');

  const second = path.join(onC, 'Photos 2018');
  await fsp.mkdir(second, { recursive: true });
  await fsp.writeFile(path.join(second, 'one.jpg'), crypto.randomBytes(500));
  const withLink = await plan([second], { leaveShortcut: true });
  const linked = await relocate.apply({ ...withLink, leaveShortcut: true }, {}, { deps });
  check('the second folder moved', linked.moved.length === 1, JSON.stringify(linked.failed));
  const link = `${second}.lnk`;
  check('a .lnk is left where it was', exists(link), link);
  check('and it is a shortcut file, not a junction',
    exists(link) && fs.readFileSync(link)[0] === 0x4c && !fs.lstatSync(link).isSymbolicLink());
  check('the folder itself is not still there as a link',
    !exists(second), second);

  console.log('\nrelocate: when something goes wrong, nothing is half done\n');

  const third = path.join(onC, 'Music');
  await fsp.mkdir(third, { recursive: true });
  await fsp.writeFile(path.join(third, 'song.mp3'), crypto.randomBytes(2000));
  const willFail = await plan([third]);
  const broken = await relocate.apply(willFail, {}, {
    deps: { ...deps, write: async () => ({ bytesWritten: 0 }) },
  });
  check('a copy that cannot be written fails the folder', broken.failed.length === 1, JSON.stringify(broken.moved));
  check('the original is still exactly where it was', exists(path.join(third, 'song.mp3')));
  check('and the half-made copy was taken back out', !exists(path.join(dest, 'Music')));

  const binRefuses = await plan([third]);
  const stuck = await relocate.apply(binRefuses, {}, { deps: { shell: fakeShell(bin, { fail: true }) } });
  check('a bin that refuses the original leaves the folder alone', stuck.failed.length === 1, JSON.stringify(stuck.failed));
  check('and does not leave a second copy behind on the other drive',
    !exists(path.join(dest, 'Music')), 'two copies and no word about it is the worst outcome');
  check('the original survived that too', exists(path.join(third, 'song.mp3')));

  console.log('\nrelocate: the pipeline, not just the handler\n');

  const fourth = path.join(onC, 'Books');
  await fsp.mkdir(fourth, { recursive: true });
  await fsp.writeFile(path.join(fourth, 'a.pdf'), crypto.randomBytes(800));

  const locked = await execute(
    { kind: 'relocate', items: [fourth], options: { destination: dest } },
    { can: (f) => f !== 'pro.relocate', deps }
  );
  check('without the licence it is refused out loud, not quietly skipped',
    locked.refused === 'locked' && locked.feature === 'pro.relocate', JSON.stringify(locked.refused));

  const folderToRecycle = await execute({ kind: 'recycle', items: [fourth] }, { can: () => true, deps });
  check('a handler that has not declared allowsFolders never sees a folder',
    folderToRecycle.refused === 'folders', String(folderToRecycle.refused));
  check('and the folder is untouched by that refusal', exists(path.join(fourth, 'a.pdf')));

  const through = await execute(
    { kind: 'relocate', items: [fourth], options: { destination: dest } },
    { can: () => true, deps, confirm: async () => true }
  );
  check('and relocate goes all the way through the pipeline',
    through.moved.length === 1 && exists(path.join(dest, 'Books', 'a.pdf')), JSON.stringify(through.failed));
  check('the pipeline reports it moved bytes but freed none',
    through.movedBytes > 0 && through.freedBytes === 0, `${through.movedBytes} / ${through.freedBytes}`);

  /* -- clean up ----------------------------------------------------------- */
  await fsp.rm(LONG + onC, { recursive: true, force: true }).catch(() => {});
  await fsp.rm(LONG + onD, { recursive: true, force: true }).catch(() => {});
  console.log(`\n  (fixtures removed: ${!fs.existsSync(onC) && !fs.existsSync(onD)})`);

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
