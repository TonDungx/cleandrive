#!/usr/bin/env node
'use strict';

// Moving files to another drive (B1): the zone, the plan, each step of the
// copy and what makes it stop, the journal, the ledger, and the way back.
//
//   node scripts/test-quarantine.js
//
// The files are the harness's own: sources in a temp folder on the system
// drive, the zone in a folder of its own on D: (agreed 2026-09-25), both
// removed at the end. The Recycle Bin is stood in for -- a folder the
// originals are moved into -- so this never touches the real one;
// `verify-quarantine.js` is the run against the real bin, and against a
// virtual disk that fills up and is pulled out part way through.
//
// Without a second drive the cross-drive checks cannot run and say so.

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');

const zones = require('../src/main/lib/quarantine-zone');
const quarantine = require('../src/main/actions/quarantine');
const restore = require('../src/main/actions/restore');
const { execute } = require('../src/main/actions/execute');
const { ActionJournal } = require('../src/main/journal/journal');
const { TrashLedger } = require('../src/main/lib/ledger');
const { noteExpired } = require('../src/main/lib/quarantine-notice');
const cloud = require('../src/main/lib/media/cloud');
const cs = require('../src/main/lib/cloud-state');
const analyzers = require('../src/main/analyzers');
const { CancelToken } = require('../src/main/lib/util');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const exists = (p) => fsp.lstat(p).then(() => true, () => false);

async function make(p, bytes) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  const body = crypto.randomBytes(bytes);
  await fsp.writeFile(p, body);
  const old = Date.now() - 90 * 86400000;
  await fsp.utimes(p, old / 1000, old / 1000);
  return body;
}

/** The Recycle Bin, stood in for: originals are moved into a folder. */
function fakeShell(bin, { fail = false } = {}) {
  let n = 0;
  const calls = [];
  return {
    calls,
    async trashItem(p) {
      calls.push(p);
      if (fail) throw new Error('The Recycle Bin said no');
      await fsp.mkdir(bin, { recursive: true });
      await fsp.rename(p, path.join(bin, `${(n += 1)}-${path.basename(p)}`));
    },
  };
}

function secondDrive() {
  if (process.platform !== 'win32') return null;
  const system = path.parse(os.tmpdir()).root.toUpperCase();
  for (const letter of 'DEFGH') {
    const root = `${letter}:\\`;
    if (root === system) continue;
    try {
      if (fs.statSync(root).dev !== fs.statSync(system).dev) return root;
    } catch {
      // not there
    }
  }
  return null;
}

(async () => {
  const drive = secondDrive();
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-quarantine-'));
  const far = drive ? await fsp.mkdtemp(path.join(drive, 'cleandrive-harness-')) : null;
  const stub = { driveTypeOf: async () => 'Fixed', appCacheEnv: {} };

  try {
    /* ------------------------------------------------------------------ */
    console.log('\nThe zone:');
    {
      const refused = async (picked) => (await zones.prepare(picked, stub)).reason;
      check('a relative folder is refused', (await refused('somewhere')) === 'notAbsolute');
      check('a network path is refused', (await refused('\\\\server\\share')) === 'network');
      check('Windows is refused', (await refused(path.join(process.env.SystemRoot || 'C:\\Windows', 'Temp'))) === 'system');
      check('a folder a cloud service syncs is refused', (await refused(path.join(base, 'Dropbox'))) === 'synced');
      check('a network drive is refused, whatever its letter', (await zones.prepare(base, { driveTypeOf: async () => 'Network' })).reason === 'network');

      const made = await zones.prepare(base, stub);
      const zone = path.join(base, zones.ZONE_NAME);
      check('picking a folder makes "CleanDrive Quarantine" in it, with its README',
        made.ok && made.zone.toLowerCase() === zone.toLowerCase() && /CleanDrive Quarantine/.test(await fsp.readFile(path.join(zone, zones.README), 'utf8')));
      await fsp.writeFile(path.join(zone, zones.README), 'somebody wrote here');
      const again = await zones.prepare(zone, stub);
      check('picking the zone itself means that zone, and its README is never overwritten',
        again.ok && again.zone.toLowerCase() === zone.toLowerCase() && (await fsp.readFile(path.join(zone, zones.README), 'utf8')) === 'somebody wrote here');

      const ok = await zones.check(zone, stub);
      check('a zone that is there says how much room it has, and which volume it is on',
        ok.ok && ok.freeBytes > 0 && ok.totalBytes >= ok.freeBytes && ok.dev === String((await fsp.stat(zone, { bigint: true })).dev));
      await fsp.rm(path.join(zone, zones.README));
      check('without its README it is not a zone', (await zones.check(zone, stub)).reason === 'notAZone');
      check('an ordinary folder is not a zone either', (await zones.check(base, stub)).reason === 'notAZone');
      check('a zone that is gone says so', (await zones.check(path.join(base, 'nope', zones.ZONE_NAME), stub)).reason === 'missing');
      check('and none at all is "none"', (await zones.check(null, stub)).reason === 'none');

      const elsewhere = path.join(base, 'elsewhere');
      await fsp.mkdir(elsewhere);
      const linked = path.join(base, 'linked');
      await fsp.mkdir(linked);
      await fsp.symlink(elsewhere, path.join(linked, zones.ZONE_NAME), 'junction');
      await fsp.writeFile(path.join(elsewhere, zones.README), zones.README_TEXT);
      check('a zone that has become a junction is refused', (await zones.check(path.join(linked, zones.ZONE_NAME), stub)).reason === 'moved');

      check('names are the app\u2019s own: a counter, and a plain extension or none',
        zones.storedName(1, 'C:\\x\\report.PDF') === '000001.pdf' && zones.storedName(12, 'C:\\x\\a.b.$$$') === '000012' &&
          zones.storedName(3, 'C:\\x\\noext') === '000003');
      let threw = false;
      try {
        zones.sessionDir(zone, '..\\..\\Windows');
      } catch {
        threw = true;
      }
      check('and a session folder is only ever a session id', threw);
      if (process.platform === 'win32') {
        check('the kind of drive comes from Windows, the same word in any language', (await zones.driveType(path.parse(os.tmpdir()).root)) === 'Fixed');
      }
    }

    if (!far) {
      console.log('\n  (no second drive: the cross-drive checks cannot run here)');
    } else {
      const made = await zones.prepare(far, stub);
      const zone = made.zone;
      const journalDir = path.join(base, 'journal');
      const journal = new ActionJournal(journalDir);
      const bin = path.join(base, 'bin');
      let src = path.join(base, 'src');
      const deps = (extra = {}) => ({ ...stub, zone, shell: fakeShell(bin), ...extra });
      const run = (items, extra = {}, ctx = {}) => execute({ kind: 'quarantine', items }, { journal, can: () => true, deps: deps(extra), ...ctx });

      /* ---------------------------------------------------------------- */
      console.log(`\nThe plan (sources on ${path.parse(base).root}, the zone on ${drive}):`);
      {
        const onZone = path.join(far, 'already-here.bin');
        await make(onZone, 1000);
        const inZone = path.join(zone, 'stray.bin');
        await make(inZone, 1000);
        const folder = path.join(src, 'a-folder');
        await fsp.mkdir(folder, { recursive: true });
        const plain = path.join(src, 'plain.iso');
        await make(plain, 5000);
        const planned = await quarantine.plan([onZone, inZone, folder, plain], {}, { deps: deps() });
        const code = (p) => (planned.failed.find((f) => f.path.toLowerCase() === p.toLowerCase()) || {}).code;
        check('a file already on the zone\u2019s drive is refused -- it would free nothing', code(onZone) === 'ESAMEVOLUME');
        check('a file in the zone is refused', code(inZone) === 'EINZONE');
        check('a folder is refused', /folder/i.test((planned.failed.find((f) => f.path === folder) || {}).error || ''));
        check('and a plain file on another drive is planned, with what identifies it', planned.plan.length === 1 &&
          planned.plan[0].path === plain && planned.plan[0].identity.ino.length > 0);
        await fsp.rm(onZone);
        await fsp.rm(inZone);

        const tight = await quarantine.plan([plain], {}, { deps: deps({ statfs: async () => ({ bavail: 10, bsize: 4096, blocks: 100 }) }) });
        check('not enough room for the batch and a gigabyte besides: all of it refused, before anything is copied',
          tight.plan.length === 0 && tight.zoneRefusal === 'full' && /gigabyte/.test(tight.failed[0].error));
        await make(path.join(zone, 's_00000001', '000001.bin'), 4000);
        const over = await quarantine.plan([plain], {}, { deps: deps({ maxBytes: 6000 }) });
        check('past the size set in Settings: refused', over.zoneRefusal === 'overLimit');
        await fsp.rm(path.join(zone, 's_00000001'), { recursive: true });
        const none = await quarantine.plan([plain], {}, { deps: deps({ zone: null }) });
        check('with no zone chosen: refused, and the reason says where to choose one', none.plan.length === 0 && /Settings/.test(none.failed[0].error));

        // OneDrive, by what Windows says about each file (decided 2026-09-25).
        const od = path.join(base, 'OneDrive');
        const online = path.join(od, 'online.mp4');
        const synced = path.join(od, 'synced.mp4');
        const unsynced = path.join(od, 'vm.vmdk');
        const dropbox = path.join(base, 'Dropbox', 'notes.zip');
        for (const f of [online, synced, unsynced, dropbox]) await make(f, 2000);
        const states = new Map([
          [online, cs.describe(0x401620, 0x39)],
          [synced, cs.describe(0x420, cs.STATE.PLACEHOLDER | cs.STATE.IN_SYNC)],
          [unsynced, cs.describe(0x420, cs.STATE.PLACEHOLDER)],
        ]);
        const saved = process.env.OneDrive;
        process.env.OneDrive = od;
        cloud.reset();
        const fakeCloud = { query: async (paths) => ({ ok: true, states: new Map(paths.map((p) => [p, states.get(p)])) }) };
        const byCloud = await quarantine.plan([online, synced, unsynced, dropbox], {}, { deps: deps({ cloud: fakeCloud }) });
        const d = quarantine.describe(byCloud);
        const planCloud = Object.fromEntries(byCloud.plan.map((e) => [path.basename(e.path), e.cloud]));
        check('OneDrive online-only: refused -- nothing on this drive, and reading it would download it',
          byCloud.failed.some((f) => f.path === online && f.code === 'EONLINEONLY') && d.onlineOnly === 1);
        check('OneDrive in sync, not in sync, and another service: all planned, each counted for the dialog',
          planCloud['synced.mp4'] === 'synced' && planCloud['vm.vmdk'] === 'unsynced' && planCloud['notes.zip'] === 'other' &&
            d.cloud.synced === 1 && d.cloud.unsynced === 1 && d.cloud.other === 1, JSON.stringify(d.cloud));
        const blind = await quarantine.plan([synced], {}, { deps: deps({ cloud: { query: async () => ({ ok: false }) } }) });
        check('when Windows cannot be asked, a OneDrive file is still planned, as "cannot tell"', blind.plan[0].cloud === 'unknown');
        if (saved === undefined) delete process.env.OneDrive;
        else process.env.OneDrive = saved;
        cloud.reset();

        const described = quarantine.describe(await quarantine.plan([plain], {}, { deps: deps({ deleteOriginal: true, retentionDays: 30 }) }));
        check('the description says whether the originals are deleted, which is what decides "frees"',
          described.deleteOriginal === true && described.freesOnVolume === true && described.zone.drive === drive.replace(/\\$/, '') && described.retentionDays === 30);
        check('without that setting it frees nothing', quarantine.describe(await quarantine.plan([plain], {}, { deps: deps() })).freesOnVolume === false);
        const locked = await execute({ kind: 'quarantine', items: [plain] }, { journal, can: (f) => f !== 'pro.quarantine', deps: deps() });
        check('it is behind its entitlement, and says which', locked.refused === 'locked' && locked.feature === 'pro.quarantine');
        await fsp.rm(src, { recursive: true, force: true });
      }

      /* ---------------------------------------------------------------- */
      console.log('\nMoving, originals to the bin:');
      let session = null;
      const bodies = new Map();
      {
        const files = [path.join(src, 'a.iso'), path.join(src, 'deep', 'b.zip'), path.join(src, 'c')];
        for (const [i, f] of files.entries()) bodies.set(f, await make(f, 300000 + i * 1000));
        const mtimes = new Map(files.map((f) => [f, fs.statSync(f).mtimeMs]));
        const progress = [];
        const result = await run(files, {}, { onProgress: (p) => progress.push(p) });
        session = result.session;
        const dir = path.join(zone, session);
        const stored = result.moved.map((m) => m.to);
        check('all three are copied into the session\u2019s folder, under names the app made',
          result.moved.length === 3 && stored.every((p) => path.dirname(p).toLowerCase() === dir.toLowerCase()) &&
            JSON.stringify(stored.map((p) => path.basename(p))) === JSON.stringify(['000001.iso', '000002.zip', '000003']));
        check('each copy is byte for byte its original, with its date', files.every((f, i) =>
          sha(fs.readFileSync(stored[i])) === sha(bodies.get(f)) && Math.abs(fs.statSync(stored[i]).mtimeMs - mtimes.get(f)) < 2000));
        check('the originals are in the bin, and nothing is freed', files.every((f) => !fs.existsSync(f)) &&
          fs.readdirSync(bin).length === 3 && result.freedBytes === 0 && result.movedBytes === 903000);
        const lines = (await journal.sessions()).find((s) => s.id === session);
        check('the journal has each one: where it went, its SHA-256, and that the original went to the bin',
          lines.kind === 'quarantine' && lines.items.length === 3 &&
            lines.items.every((line, i) => line.to === stored[i] && line.sha256 === sha(bodies.get(files[i])) && line.original === 'bin') &&
            lines.end.freedOnSource === 0);
        const manifest = fs.readFileSync(path.join(dir, zones.MANIFEST), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        check('and so does the drive itself, beside the copies', manifest.length === 3 &&
          manifest.every((m, i) => m.from === files[i] && m.sha256 === sha(bodies.get(files[i])) && m.file === path.basename(stored[i])));
        check('progress is in bytes, and ends at all of them', progress.some((p) => p.phase === 'copying') &&
          progress.filter((p) => p.phase === 'copying').pop().freedBytes === 903000);
        const ledger = new TrashLedger(path.join(base, 'ledger.json'), { journal });
        const entries = await ledger.load();
        check('the ledger counts the originals as the app\u2019s own in the bin, so the purge may empty them in time',
          files.every((f) => entries.some((e) => e.path === f)));
      }

      /* ---------------------------------------------------------------- */
      console.log('\nMoving, originals deleted (the setting):');
      {
        const f = path.join(src, 'big.iso');
        await make(f, 200000);
        const ro = path.join(src, 'read-only.iso');
        await make(ro, 1000);
        fs.chmodSync(ro, 0o444);
        const before = fs.readdirSync(bin).length;
        const result = await run([f, ro], { deleteOriginal: true });
        const lines = (await journal.sessions()).find((s) => s.id === result.session).items;
        check('the original is deleted, not binned, and exactly what was deleted is counted as freed',
          !fs.existsSync(f) && lines[0].original === 'deleted' && fs.readdirSync(bin).length === before,
          result.failed.map((x) => x.error).join('; '));
        // Measured: Node's unlink on Windows clears the read-only attribute
        // itself, so a read-only original is deleted like any other.
        check('a read-only original is deleted too -- Node clears the attribute -- and both sizes count',
          !fs.existsSync(ro) && lines[1].original === 'deleted' && result.freedBytes === 201000, String(result.freedBytes));
        const entries = await new TrashLedger(path.join(base, 'ledger2.json'), { journal }).load();
        check('and the ledger does not count a deleted original as being in the bin', !entries.some((e) => e.path === f || e.path === ro));
      }

      /* ---------------------------------------------------------------- */
      console.log('\nWhat stops a file, and what stops the batch:');
      {
        const files = [0, 1, 2].map((i) => path.join(src, `full-${i}.bin`));
        for (const f of files) await make(f, 3 << 20);
        // Full a megabyte into the second file.
        let written = 0;
        const result = await run(files, {
          write: async (handle, chunk) => {
            if (written >= (3 << 20) + (1 << 20)) throw Object.assign(new Error('There is not enough space on the disk'), { code: 'ENOSPC' });
            const out = await handle.write(chunk);
            written += out.bytesWritten;
            return out;
          },
        });
        const dir = result.session ? path.join(zone, result.session) : null;
        check('the drive filling up part way through a file: that file\u2019s copy is taken out, and the batch stops there',
          result.moved.length === 1 && result.failed.length === 1 && result.failed[0].code === 'ENOSPC' && result.remaining === 1 &&
            result.session && fs.readdirSync(dir).filter((n) => n !== zones.MANIFEST).length === 1,
          JSON.stringify(result.failed.map((x) => [x.code, x.error])));
        check('and the originals not moved are exactly where they were', fs.existsSync(files[1]) && fs.existsSync(files[2]) && !fs.existsSync(files[0]));

        let tried = 0;
        const eio = await run([files[1], files[2]], {
          write: async (handle, chunk, at) => {
            if (at === 0) tried += 1;
            throw Object.assign(new Error('I/O error'), { code: 'EIO' });
          },
        });
        check('a write that fails while the zone still answers: that file is left, and the next is tried',
          eio.failed.length === 2 && eio.failed.every((f) => f.code === 'EIO') && tried === 2 && fs.existsSync(files[1]) && fs.existsSync(files[2]),
          JSON.stringify(eio.failed.map((x) => x.code)));
        check('and a session that moved nothing leaves no empty folder on the drive', eio.session && !fs.existsSync(path.join(zone, eio.session)));

        const corrupt = await run([files[1]], {
          afterCopy: async ({ to }) => {
            const fd = fs.openSync(to, 'r+');
            fs.writeSync(fd, Buffer.from([0xff ^ fs.readFileSync(to)[0]]), 0, 1, 0);
            fs.closeSync(fd);
          },
        });
        check('a copy that reads back different: the copy goes, the original stays', corrupt.failed[0].code === 'EHASH' &&
          fs.existsSync(files[1]) && corrupt.moved.length === 0);

        // What a drive pulled out part way through leaves behind (measured on
        // a real VHDX): a half-written copy. It is written as `.partial`, so it
        // is never counted, and the next batch takes it out.
        const leftDir = path.join(zone, 's_0000cafe');
        const usedBefore = await zones.usage(zone);
        await make(path.join(leftDir, `000001.bin${zones.PARTIAL}`), 3 << 20);
        await make(path.join(leftDir, '000002.bin'), 1000);
        const usedAfter = await zones.usage(zone);
        check('an unfinished copy is not counted as something the zone holds',
          usedAfter.bytes - usedBefore.bytes === 1000 && usedAfter.files - usedBefore.files === 1,
          `${usedAfter.bytes - usedBefore.bytes} bytes, ${usedAfter.files - usedBefore.files} files`);
        const f = path.join(src, 'after-a-pull.bin');
        await make(f, 2000);
        const next = await run([f]);
        check('the next batch takes the unfinished copy out, and nothing else',
          next.moved.length === 1 && !fs.existsSync(path.join(leftDir, `000001.bin${zones.PARTIAL}`)) && fs.existsSync(path.join(leftDir, '000002.bin')));
        check('and a finished copy never keeps the unfinished name', !fs.readdirSync(path.join(zone, next.session)).some((n) => n.endsWith(zones.PARTIAL)));
        await fsp.rm(leftDir, { recursive: true });

        const changed = await run([files[1]], { afterCopy: async ({ from }) => fs.appendFileSync(from, 'more') });
        check('an original that changes while it is copied: left alone, and so is its new content',
          changed.failed[0].code === 'ECHANGED' && fs.readFileSync(files[1]).subarray(-4).toString() === 'more');

        // The folder the original sits in becomes a junction to a decoy
        // between the copy and the delete: the path now names another file.
        const inner = path.join(src, 'swap');
        const target = path.join(inner, 'report.docx');
        await make(target, 5000);
        const decoyDir = path.join(base, 'decoy');
        const decoy = path.join(decoyDir, 'report.docx');
        const decoyBody = await make(decoy, 5000);
        const swapped = await run([target], {
          beforeOriginal: async () => {
            await fsp.rename(inner, `${inner}.real`);
            await fsp.symlink(decoyDir, inner, 'junction');
          },
        });
        check('a folder swapped for a junction between the copy and the original: refused, nothing moved',
          swapped.failed[0].code === 'ECHANGED' && swapped.moved.length === 0);
        check('and neither the real file nor the one the junction points at was touched',
          fs.existsSync(path.join(`${inner}.real`, 'report.docx')) && sha(fs.readFileSync(decoy)) === sha(decoyBody));

        const stuck = await run([files[2]], { shell: fakeShell(bin, { fail: true }) });
        check('the bin refusing the original: the copy is taken back out, the original stays',
          stuck.failed[0].code === 'ESTUCK' && fs.existsSync(files[2]) && !fs.existsSync(path.join(zone, stuck.session)));

        const token = new CancelToken();
        const stopped = await execute(
          { kind: 'quarantine', items: [files[1], files[2]] },
          { journal, can: () => true, token, deps: deps({ write: async (h, c) => { token.cancel(); return h.write(c); } }) }
        );
        check('Stop part way through a copy: that copy is taken out, and nothing else is done',
          stopped.cancelled && stopped.moved.length === 0 && fs.existsSync(files[1]) && fs.existsSync(files[2]));

        // The zone planted with a junction under the session's name.
        const sid = 's_deadbeef';
        const aside = path.join(base, 'aside');
        await fsp.mkdir(aside);
        await fsp.symlink(aside, path.join(zone, sid), 'junction');
        const planned = await quarantine.plan([files[1]], {}, { deps: deps() });
        const out = await quarantine.apply(planned, {}, { deps: deps(), sessionId: sid });
        check('a junction planted in the zone where the session\u2019s folder goes: nothing is written through it',
          out.moved.length === 0 && out.failed[0].code === 'EZONE' && fs.readdirSync(aside).length === 0 && fs.existsSync(files[1]));
        await fsp.rm(path.join(zone, sid));

        await fsp.rename(zone, `${zone}.gone`);
        const gonePlan = { ...planned };
        const vanished = await quarantine.apply(gonePlan, {}, { deps: deps(), sessionId: 's_0000beef' });
        check('the zone gone between the dialog and the first copy: everything refused, nothing touched',
          vanished.failed.every((f) => f.code === 'EZONE') && /no longer there/.test(vanished.failed[0].error) && fs.existsSync(files[1]));
        await fsp.rename(`${zone}.gone`, zone);
      }

      /* ---------------------------------------------------------------- */
      console.log('\nThe way back:');
      {
        const ids = (await journal.sessions()).find((s) => s.id === session).items.map((_, i) => `${session}:${i}`);
        const { records, status } = await restore.inspect(journal, { only: new Set(ids) });
        check('each item of the first session is in quarantine, and says where', records.length === 3 &&
          records.every((r) => status.get(r.id).state === 'inQuarantine' && status.get(r.id).stored === r.stored));
        const listed = (await restore.listSessions(journal)).find((s) => s.id === session);
        check('the session can be put back, all of it', listed.restorable.count === 3 && listed.tally.inQuarantine === 3 &&
          listed.drive === drive.replace(/\\$/, ''));

        const originals = records.map((r) => r.path);
        await make(originals[1], 10); // something new where one of them was
        const back = await execute({ kind: 'restore', items: ids }, { journal, deps: { journal } });
        check('put back: copied home, checked against the hash the quarantine recorded, byte for byte',
          back.moved.length === 2 && sha(fs.readFileSync(originals[0])) === sha(bodies.get(originals[0])) &&
            sha(fs.readFileSync(originals[2])) === sha(bodies.get(originals[2])));
        check('with its date, and the copy taken out of the zone', Math.abs(fs.statSync(originals[0]).mtimeMs - records[0].mtimeMs) < 2000 &&
          !fs.existsSync(records[0].stored) && !fs.existsSync(records[2].stored));
        check('a file in the way is left alone, and so is its copy', back.failed.length === 1 && back.failed[0].code === 'EEXIST' &&
          fs.statSync(originals[1]).size === 10 && fs.existsSync(records[1].stored));
        const kept = await execute({ kind: 'restore', items: [ids[1]] }, { journal, deps: { journal }, confirm: async () => ({ approved: true, options: { onConflict: 'rename' } }) });
        check('"keep both" puts it beside the file in the way', kept.moved.length === 1 && /\(restored\)/.test(kept.moved[0].to) &&
          sha(fs.readFileSync(kept.moved[0].to)) === sha(bodies.get(originals[1])));
        const after = await restore.inspect(journal, { only: new Set(ids) });
        check('afterwards every one of them reads as put back', [...after.status.values()].every((s) => s.state === 'restored'));
        const ledger = await new TrashLedger(path.join(base, 'ledger3.json'), { journal }).load();
        check('and the originals in the bin are no longer the purge\u2019s to empty', !originals.some((p) => ledger.some((e) => e.path === p && e.trashedAt === records[0].trashedAt)));

        // A copy that changed on the other drive is not put back.
        const f = path.join(src, 'tampered.bin');
        const body = await make(f, 4000);
        const moved = await run([f]);
        const stored = moved.moved[0].to;
        const bad = Buffer.from(body);
        bad[0] ^= 0xff;
        fs.writeFileSync(stored, bad);
        const refusedBack = await execute({ kind: 'restore', items: [`${moved.session}:0`] }, { journal, deps: { journal } });
        check('a copy that no longer matches its hash is not put back, and nothing is left where it would have gone',
          refusedBack.moved.length === 0 && refusedBack.failed[0].code === 'EHASH' && !fs.existsSync(f) && fs.existsSync(stored));

        fs.rmSync(stored);
        const gone = await restore.listItems(journal, moved.session);
        check('a copy removed outside the app reads as gone from the folder, not from the bin', gone[0].state === 'gone');
        const plan = await restore.plan([`${moved.session}:0`], {}, { deps: { journal } });
        check('and the reason says the quarantine folder', /quarantine folder/.test(plan.failed[0].error));

        // A zone on a drive that is not connected.
        const letter = [...'QRSTUVWXYZ'].find((l) => !fs.existsSync(`${l}:\\`));
        const offline = await journal.appendSession('quarantine', [
          { path: path.join(src, 'offline.iso'), to: `${letter}:\\CleanDrive Quarantine\\s_12345678\\000001.iso`, size: 10, sha256: 'a'.repeat(64), original: 'bin' },
        ]);
        const unplugged = await restore.listItems(journal, offline.id);
        check('a zone on a drive that is not connected: "unavailable", and the record is kept', unplugged[0].state === 'unavailable');
      }

      /* ---------------------------------------------------------------- */
      console.log('\nExpired: said, never done:');
      {
        // A quarantine recorded forty days ago, its copy really on the drive.
        const stored = path.join(zone, 's_0000aaaa', '000001.iso');
        const body = await make(stored, 1000);
        const oldSession = await journal.appendSession(
          'quarantine',
          [{ path: path.join(src, 'old.iso'), to: stored, size: 1000, sha256: sha(body), original: 'bin', trashedAt: Date.now() - 40 * 86400000 }],
          { startedAt: Date.now() - 40 * 86400000 }
        );
        const moved = { session: oldSession.id, moved: [{ to: stored }] };
        const held = await restore.quarantined(journal, { retentionDays: 30 });
        check('a copy kept past the days set counts as expired', held.expired === 1 && held.kept >= 1, JSON.stringify(held));
        const listed = (await restore.listItems(journal, moved.session, { deps: { retentionDays: 30 } }))[0];
        check('its row says so', listed.state === 'inQuarantine' && listed.expired === true);
        check('and at 60 days it is not yet', (await restore.quarantined(journal, { retentionDays: 60 })).expired === 0);

        const stateFile = path.join(base, 'notice.json');
        const settings = { get: async () => ({ quarantine: { retentionDays: 30 } }) };
        const shown = [];
        const show = (n, days) => shown.push([n, days]);
        const first = await noteExpired({ journal, settings, stateFile, show });
        const second = await noteExpired({ journal, settings, stateFile, show });
        const later = await noteExpired({ journal, settings, stateFile, show, now: () => Date.now() + 25 * 3600000 });
        check('the notice is shown, then not again the same day, then again the next',
          first.shown && !second.shown && later.shown && shown.length === 2 && shown[0][0] === 1 && shown[0][1] === 30);
        check('and the copy is still there after all of it', fs.existsSync(moved.moved[0].to));

        const pruning = new ActionJournal(journalDir, { now: () => Date.now() + 3 * 365 * 86400000 });
        await pruning.prune();
        check('the journal keeps a month that holds a quarantine, however old', (await journal.sessions()).some((s) => s.id === moved.session));
      }

      /* ---------------------------------------------------------------- */
      console.log('\nWhat the screens offer it on:');
      {
        const scanDir = path.join(base, 'scan');
        await make(path.join(scanDir, 'Temp', 'x.tmp'), 2000);
        await make(path.join(scanDir, 'Downloads', 'setup-tool.exe'), 3 << 20);
        await make(path.join(scanDir, 'disk.iso'), 60 << 20);
        const collected = await analyzers.collect('scan', { root: scanDir, options: { appCacheEnv: {} }, deps: { runningProcessNames: async () => new Set() } }, { strict: true });
        const of = (name) => collected.candidates.find((c) => path.basename(c.path) === name);
        check('a temp file -- safe to delete -- is offered the bin only', JSON.stringify(of('x.tmp').actions) === '["recycle"]');
        check('a large disk image -- worth reviewing -- is offered another drive too', of('disk.iso').actions.includes('quarantine'));
      }
    }
  } finally {
    await fsp.rm(base, { recursive: true, force: true }).catch(() => {});
    if (far) await fsp.rm(far, { recursive: true, force: true }).catch(() => {});
  }

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  process.exitCode = failures ? 1 : 0;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
