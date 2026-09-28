#!/usr/bin/env node
'use strict';

// Packing a folder into one archive, and getting it back (B5).
//   node scripts/test-archive.js
//
// The tree, the `.zip`, the compression decisions, the verification and the
// extraction are all real and all on disk. One thing is stood in for: the
// Recycle Bin, which is `shell.trashItem` replaced by a move into a folder of
// the harness's own -- the same substitution `test-quarantine.js` and
// `test-relocate.js` make, so a test suite never puts anything in the
// person's bin. The stand-in sits on the *source* volume, because the real
// Recycle Bin always does.
//
// The fixture is on D:, not under `os.tmpdir()`, which on this machine is
// inside AppData on C:. B5 allows the archive to sit on the same drive as the
// folder, and the "same drive" arithmetic is one of the things being checked,
// so both drives have to be available and told apart.

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const archive = require('../src/main/actions/archive');
const zip = require('../src/main/lib/archive-zip');
const { execute } = require('../src/main/actions/execute');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const LP = '\\\\?\\';
const exists = (p) => fs.existsSync(p.length > 240 ? LP + p : p);
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p.length > 240 ? LP + p : p)).digest('hex');

function fakeShell(bin, { fail = false } = {}) {
  return {
    async trashItem(target) {
      if (fail) throw new Error('the bin refused it');
      await fsp.rename(target, path.join(bin, `${Date.now()}-${path.basename(target)}`));
    },
  };
}

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
  console.log('\narchive: the format, on its own\n');

  const other = secondVolume();
  check('there are two volumes, so "same drive" can be told from "other drive"', other !== null, other || 'only one');
  if (!other) {
    console.log('\n1 FAILURE(S)\n');
    process.exit(1);
  }

  const base = await fsp.mkdtemp(path.join(other, 'cleandrive-archive-'));
  const keep = path.join(base, 'archives');
  const bin = path.join(base, 'bin');
  await fsp.mkdir(keep);
  await fsp.mkdir(bin);

  /* -- names and paths ---------------------------------------------------- */
  check('a Windows path becomes a ZIP name with forward slashes',
    zip.toZipName(path.join('a', 'b', 'c.txt')) === 'a/b/c.txt');
  check('and back again', zip.fromZipName('a/b/c.txt') === path.join('a', 'b', 'c.txt'));
  check('a name that climbs out of the folder is refused, not cleaned up quietly',
    zip.fromZipName('../../etc/passwd') === path.join('etc', 'passwd'), String(zip.fromZipName('../../etc/passwd')));
  check('an absolute-looking name keeps only its parts', zip.fromZipName('/x/y') === path.join('x', 'y'));
  check('a name of nothing but dots is refused outright', zip.fromZipName('../..') === null);

  const stamps = zip.toDosTime(new Date('2015-06-11T08:20:30'));
  check('a date becomes DOS time and date', Number.isInteger(stamps.time) && Number.isInteger(stamps.date));
  const ancient = zip.toDosTime(new Date('1970-01-01T00:00:00'));
  check('a date before 1980 is clamped rather than wrapped into the future',
    (ancient.date >> 9) === 0, `year offset ${ancient.date >> 9}`);

  /* -- a folder worth packing --------------------------------------------- */
  console.log('\narchive: what gets compressed, and what does not\n');

  const source = path.join(base, 'Dự án cũ');
  await fsp.mkdir(path.join(source, 'src', 'lib'), { recursive: true });
  await fsp.mkdir(path.join(source, 'nothing in here'), { recursive: true });

  const bodies = new Map();
  const put = async (rel, body) => {
    const full = path.join(source, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, body);
    bodies.set(zip.toZipName(rel), crypto.createHash('sha256').update(body).digest('hex'));
    return full;
  };

  const textFile = await put(path.join('src', 'app.js'), Buffer.from('const value = 1;\n'.repeat(5000)));
  await put(path.join('src', 'lib', 'tiếng việt.txt'), Buffer.from('xin chào '.repeat(4000)));
  await put('random.bin', crypto.randomBytes(1024 * 1024));
  await put('tiny.txt', Buffer.from('hi'));

  const old = new Date('2015-06-11T08:20:00Z');
  await fsp.utimes(textFile, old, old);

  const seg = 'A'.repeat(90);
  const deepDir = path.join(source, seg, seg);
  await fsp.mkdir(LP + deepDir, { recursive: true });
  await fsp.writeFile(LP + path.join(deepDir, 'far.txt'), 'far away');
  bodies.set(zip.toZipName(path.join(seg, seg, 'far.txt')), crypto.createHash('sha256').update('far away').digest('hex'));

  execFileSync('cmd', ['/c', 'mklink', '/J', path.join(source, 'elsewhere'), keep], { stdio: 'ignore' });

  const deps = { shell: fakeShell(bin) };
  const plan = (items, options = {}, extra = {}) =>
    archive.plan(items, { destination: keep, ...options }, { deps: { ...deps, ...extra } });

  const planned = await plan([source]);
  check('the folder is planned', planned.plan.length === 1, JSON.stringify(planned.failed));
  check('every file is counted, including the one past 260 characters',
    planned.totalFiles === 5, String(planned.totalFiles));
  check('the link inside is stepped over', planned.skippedLinks === 1, String(planned.skippedLinks));

  const described = archive.describe(planned);
  check('the estimate is made from a sample and is smaller than the folder',
    described.estimatedArchiveBytes > 0 && described.estimatedArchiveBytes < described.bytes,
    `${described.estimatedArchiveBytes} of ${described.bytes}`);
  check('it knows the archive is going to the same drive here',
    described.sameVolume === true);
  check('so what it says would be freed is the folder less the archive',
    described.estimatedFreedBytes < described.bytes, `${described.estimatedFreedBytes} of ${described.bytes}`);

  /* -- pack it ------------------------------------------------------------ */
  console.log('\narchive: packing, and reading it back\n');

  const packed = await archive.apply(planned, {}, { deps });
  check('the folder was packed', packed.moved.length === 1, JSON.stringify(packed.failed));
  check('and nothing failed', packed.failed.length === 0, JSON.stringify(packed.failed));

  const made = packed.moved[0].to;
  check('the archive is where it was asked for', exists(made), made);
  check('it is named after the folder', path.basename(made) === 'Dự án cũ.zip', path.basename(made));
  check('the original folder is gone', !exists(source));
  check('and it is in the bin, whole', fs.readdirSync(bin).length === 1 &&
    fs.statSync(path.join(bin, fs.readdirSync(bin)[0])).isDirectory());

  check('text was deflated and random bytes were stored, rather than both being deflated',
    packed.archive.deflated >= 2 && packed.archive.stored >= 1,
    `${packed.archive.deflated} deflated, ${packed.archive.stored} stored`);

  const index = await zip.index(made);
  const names = index.entries.map((e) => e.name);
  check('every file is inside, and so is the manifest',
    bodies.size === 5 && [...bodies.keys()].every((n) => names.includes(n)) && names.includes(archive.MANIFEST),
    `${names.length} entries`);
  check('the empty folder is inside too, so it comes back',
    names.includes('nothing in here/'), names.filter((n) => n.endsWith('/')).join(', '));
  check('the junction was not packed', !names.some((n) => n.startsWith('elsewhere')));

  const manifestEntry = index.entries.find((e) => e.name === archive.MANIFEST);
  check('the manifest is a real member with a length', manifestEntry && manifestEntry.size > 0);

  const verified = await zip.verify(made, {});
  check('every member reads back with the CRC and length it claims',
    verified.ok === true && verified.checked === 6, JSON.stringify(verified.bad));

  /* -- and it is really checked, not merely claimed to be ----------------- */
  console.log('\narchive: a damaged archive is not accepted\n');

  const damaged = path.join(base, 'damaged.zip');
  await fsp.copyFile(made, damaged);
  const handle = await fsp.open(damaged, 'r+');
  const at = Math.floor((await handle.stat()).size / 3);
  const one = Buffer.alloc(1);
  await handle.read(one, 0, 1, at);
  one[0] ^= 0xff;
  await handle.write(one, 0, 1, at);
  await handle.close();

  const caught = await zip.verify(damaged, {});
  check('one flipped byte is caught', caught.ok === false && caught.bad.length > 0, JSON.stringify(caught.bad.slice(0, 2)));

  // A folder of photos: the case where packing saves nothing and the value is
  // one file instead of many. Random bytes stand in for JPEGs, which is what
  // a JPEG looks like to a compressor.
  const photos = path.join(base, 'Ảnh 2015');
  await fsp.mkdir(photos, { recursive: true });
  for (let n = 0; n < 6; n++) await fsp.writeFile(path.join(photos, `DSC0${n}.jpg`), crypto.randomBytes(120000));
  const photoPlan = await plan([photos]);
  const photoDesc = archive.describe(photoPlan);
  check('a folder that will not compress is estimated as such, not promised a saving',
    photoDesc.estimatedArchiveBytes >= photoDesc.bytes * 0.95,
    `${photoDesc.estimatedArchiveBytes} of ${photoDesc.bytes}`);
  const photoPacked = await archive.apply(photoPlan, {}, { deps });
  check('and it packs anyway, because one file instead of six is the point',
    photoPacked.moved.length === 1, JSON.stringify(photoPacked.failed));
  check('every one of them was stored rather than deflated',
    photoPacked.archive.stored >= 6 && photoPacked.archive.deflated <= 1,
    `${photoPacked.archive.stored} stored, ${photoPacked.archive.deflated} deflated`);

  /* -- getting it back ---------------------------------------------------- */
  console.log('\narchive: putting the folder back\n');

  const located = await archive.undo.locate([{ path: source, stored: made }], {});
  const state = located.get([...located.keys()][0]);
  check('the Restore Center is told the folder is inside an archive',
    state.state === 'inArchive', JSON.stringify(state));
  check('and how many files that archive holds, without opening any of them',
    state.entries === 5, String(state.entries));
  check('an archive that is not there reads as gone, not as ready',
    (await archive.undo.locate([{ path: source, stored: path.join(base, 'no such.zip') }], {})).values().next().value.state === 'gone');
  check('a file that is not an archive at all reads as gone rather than throwing',
    (await archive.undo.locate([{ path: source, stored: path.join(source, '..', 'bin') }], {})).values().next().value.state === 'gone');

  check('it is ready to put back', (await archive.undo.ready(state)) === true);

  const back = await archive.undo.putBack(state, source);
  check('the folder came back', back.ok === true, JSON.stringify(back));
  check('with every file in it', back.files === 5, String(back.files));

  let same = 0;
  for (const [name, digest] of bodies) {
    const there = path.join(source, name.split('/').join(path.sep));
    if (exists(there) && sha(there) === digest) same += 1;
    else console.log(`    (mismatch or missing: ${name})`);
  }
  check('every file is byte for byte what went in', same === bodies.size, `${same} of ${bodies.size}`);
  check('the empty folder came back too', exists(path.join(source, 'nothing in here')));
  check('the file past 260 characters came back', exists(path.join(source, seg, seg, 'far.txt')));
  check('the Vietnamese name came back', exists(path.join(source, 'src', 'lib', 'tiếng việt.txt')));
  check('the manifest is not unpacked into the folder', !exists(path.join(source, archive.MANIFEST)));

  const when = fs.statSync(textFile).mtime;
  check('the modification time is the one the file had, not the time it was unpacked',
    Math.abs(when.getTime() - old.getTime()) <= 2000, `${when.toISOString()} vs ${old.toISOString()}`);

  check('putting it back a second time refuses rather than writing over what is there',
    (await archive.undo.putBack(state, source)).ok === false);

  /* -- what it refuses ---------------------------------------------------- */
  console.log('\narchive: what it refuses\n');

  const noDest = await archive.plan([source], {}, { deps });
  check('with nowhere to put the archive it is refused', noDest.failed[0] && noDest.failed[0].code === 'ENODEST');

  const aFile = await plan([textFile]);
  check('a file is refused: this packs folders', aFile.failed[0] && aFile.failed[0].code === 'ENOTDIR');

  const inside = await archive.plan([source], { destination: path.join(source, 'src') }, { deps });
  check('an archive that would be written inside the folder it packs is refused',
    inside.failed[0] && inside.failed[0].code === 'EINSIDE', inside.failed[0] ? inside.failed[0].code : 'none');

  const emptyDir = path.join(base, 'Rỗng');
  await fsp.mkdir(emptyDir, { recursive: true });
  const nothing = await plan([emptyDir]);
  check('a folder with no files in it is refused', nothing.failed[0] && nothing.failed[0].code === 'EEMPTY');

  const steamish = path.join(base, 'Steam', 'steamapps', 'common', 'A Game');
  await fsp.mkdir(steamish, { recursive: true });
  await fsp.writeFile(path.join(steamish, 'game.dat'), 'x');
  const handed = await plan([steamish]);
  check('a Steam game is handed off here too, by the same code B2 uses',
    handed.failed[0] && handed.failed[0].code === 'EHANDOFF', handed.failed[0] ? handed.failed[0].code : 'none');

  const taken = path.join(base, 'Taken');
  await fsp.mkdir(taken, { recursive: true });
  await fsp.writeFile(path.join(taken, 'a.txt'), 'x');
  await fsp.writeFile(path.join(keep, 'Taken.zip'), 'not really a zip');
  const occupied = await plan([taken]);
  check('a name already taken where the archive would go is refused rather than overwritten',
    occupied.plan.length === 1 && path.basename(occupied.plan[0].target) === 'Taken (2).zip',
    occupied.plan[0] ? path.basename(occupied.plan[0].target) : JSON.stringify(occupied.failed));

  /* -- rollbacks ---------------------------------------------------------- */
  console.log('\narchive: when something goes wrong, nothing is half done\n');

  const third = path.join(base, 'Nhạc');
  await fsp.mkdir(third, { recursive: true });
  await fsp.writeFile(path.join(third, 'song.mp3'), crypto.randomBytes(5000));
  const binRefuses = await plan([third]);
  const stuck = await archive.apply(binRefuses, {}, { deps: { shell: fakeShell(bin, { fail: true }) } });
  check('a bin that refuses the folder leaves the folder alone', stuck.failed.length === 1, JSON.stringify(stuck.failed));
  check('and the archive it had already written is removed, so there are not two of everything',
    !exists(binRefuses.plan[0].target), binRefuses.plan[0].target);
  check('the folder itself survived', exists(path.join(third, 'song.mp3')));

  /* -- the pipeline ------------------------------------------------------- */
  console.log('\narchive: through the pipeline, not just the handler\n');

  const fourth = path.join(base, 'Sách');
  await fsp.mkdir(fourth, { recursive: true });
  await fsp.writeFile(path.join(fourth, 'a.txt'), Buffer.from('text '.repeat(20000)));

  const locked = await execute(
    { kind: 'archive', items: [fourth], options: { destination: keep } },
    { can: (f) => f !== 'pro.archive', deps }
  );
  check('without the licence it is refused out loud', locked.refused === 'locked' && locked.feature === 'pro.archive');

  const through = await execute(
    { kind: 'archive', items: [fourth], options: { destination: keep } },
    { can: () => true, deps, confirm: async () => true }
  );
  check('and it goes all the way through', through.moved.length === 1, JSON.stringify(through.failed));
  check('the pipeline reports bytes moved but none freed, because the folder is in the bin',
    through.movedBytes > 0 && through.freedBytes === 0, `${through.movedBytes} / ${through.freedBytes}`);
  check('a text folder really does shrink, which is the case compression is for',
    through.moved[0].archiveBytes < through.moved[0].size / 2,
    `${through.moved[0].archiveBytes} from ${through.moved[0].size}`);

  /* -- Windows can open what this wrote ----------------------------------- */
  console.log('\narchive: Windows opens it too\n');
  try {
    const ps = `Add-Type -A System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead('${made}'); $n=$z.Entries.Count; $z.Dispose(); $n`;
    const n = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' }).trim();
    check('Windows’ own reader opens the archive and counts the same members',
      Number(n) === index.entries.length, `${n} vs ${index.entries.length}`);
  } catch (err) {
    check('Windows’ own reader opens the archive', false, err.message.split('\n')[0]);
  }

  await fsp.rm(LP + base, { recursive: true, force: true }).catch(() => {});
  console.log(`\n  (fixture removed: ${!fs.existsSync(base)})`);

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
