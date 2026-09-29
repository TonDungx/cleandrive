#!/usr/bin/env node
'use strict';

// The chat apps (D3): where Zalo puts what it downloads, which conversation
// each piece came from, what Telegram keeps, and the rows both become.
//
//   node scripts/test-chat.js
//
// Everything here runs against a tree this file builds. That is on purpose
// and it is not the usual trade-off: the shape being tested was *measured* on
// this machine -- 57 conversation folders, kind folders inside each of them,
// file names carrying three ids and a timestamp, a Telegram account called
// `user_data#2` -- and `smoke.js` runs the same code against the real Zalo
// and Telegram afterwards. What is built here is the shape, so the harness
// can also produce the cases this machine does not have: no chat app at all,
// an update older than what is installed, a process list that cannot be read.
//
// Nothing in this file reads, opens, copies or deletes a real chat file.

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');

const zalo = require('../src/main/chat/zalo');
const telegram = require('../src/main/chat/telegram');
const chatMeasure = require('../src/main/chat/measure');
const chatKnown = require('../src/main/chat/known');
const chatAnalyzer = require('../src/main/analyzers/chat');
const analyzers = require('../src/main/analyzers');
const format = require('../src/main/lib/media/format');
const mediaRoots = require('../src/main/lib/media/roots');
const { validateCandidate } = require('../src/main/analyzers/contract');
const { isAllowedUnattended } = require('../src/main/automatic/allowed-categories');
const { can } = require('../src/main/license/entitlements');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const ACCOUNT = '254377760481765028';

/** A real JPEG head, so the magic-byte checks are checking real magic bytes. */
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

/** A real JPEG XL codestream head -- `FF 0A`, which is what Zalo's `.jxl` are. */
const JXL_HEAD = Buffer.from([0xff, 0x0a, 0x42, 0x3b, 0xa8, 0x6b, 0x0c, 0x00, 0x13, 0x08, 0x00, 0xe8]);

async function write(file, head, bytes) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const buf = Buffer.alloc(bytes);
  head.copy(buf, 0);
  await fsp.writeFile(file, buf);
}

/**
 * A Zalo tree with the shape this machine's really has.
 *
 * Two conversations -- one group (`g…`) and one direct -- each with a
 * `picture` folder of `.jxl` and a `Cache` folder of extensionless JPEG, two
 * of which pair with a `.jxl` by the first three fields of the name and one of
 * which does not. Plus the flat folders that belong to no conversation, the
 * nested `sticker` tree, and a `.rescache` in every folder.
 */
async function buildZalo(appData) {
  const downloads = path.join(appData, 'ZaloData', 'media', ACCOUNT, 'ZaloDownloads');
  const rescache = async (dir) => write(path.join(dir, '.rescache'), Buffer.alloc(0), 32);

  // Never read, never listed: the message store, at a size that would dominate
  // every total on the screen if anything here counted it.
  await write(path.join(appData, 'ZaloData', 'Database', '_production', 'messages.db'), Buffer.alloc(0), 4096);
  await write(path.join(appData, 'ZaloData', 'Local Storage', 'leveldb', '000003.log'), Buffer.alloc(0), 512);

  for (const [id, stamps] of [
    ['g4247325580991211986', ['1788935538538', '1788937273379', '1788944518423']],
    ['13410346471542028', ['1788935538538', '1788937273379']],
  ]) {
    const dir = path.join(downloads, 'resource', id);
    await rescache(dir);
    for (let i = 0; i < stamps.length; i++) {
      const stem = `${stamps[i]}_${ACCOUNT}_${id}`;
      // Every one gets the full-size JPEG; only the first two also get the
      // re-encoded `.jxl`, so the third is "in Cache only".
      await write(path.join(dir, 'Cache', `${stem}_n`), JPEG_HEAD, 91405);
      await write(path.join(dir, 'Cache', `${stem}_t`), JPEG_HEAD, 9800);
      if (i < 2) await write(path.join(dir, 'picture', `${stem}_${'a'.repeat(32)}.jxl`), JXL_HEAD, 41323);
    }
    await rescache(path.join(dir, 'Cache'));
    await rescache(path.join(dir, 'picture'));
    await write(path.join(dir, 'video', `${stamps[0]}_${ACCOUNT}_${id}_n`), Buffer.alloc(0), 5_000_000);
  }

  // The kinds that are flat: a single empty `group` folder and the files
  // beside it, exactly as measured.
  for (const kind of ['video', 'richThumb', 'zinstant']) {
    await fsp.mkdir(path.join(downloads, kind, 'group'), { recursive: true });
    await rescache(path.join(downloads, kind, 'group'));
    await rescache(path.join(downloads, kind));
    await write(path.join(downloads, kind, `shared-1.${kind === 'video' ? 'mp4' : 'jpg'}`), Buffer.alloc(0), 120_000);
  }
  // Empty on this machine, and it has to stay out of the totals rather than
  // becoming a row with nothing in it.
  await fsp.mkdir(path.join(downloads, 'picture'), { recursive: true });

  // Stickers: three levels down, beside ZaloDownloads rather than inside it.
  await write(path.join(appData, 'ZaloData', 'media', ACCOUNT, 'sticker', '10032', '1', 'a.png'), Buffer.alloc(0), 40_000);
  await write(path.join(appData, 'ZaloData', 'media', ACCOUNT, 'sticker', '10047', '2', 'b.gif'), Buffer.alloc(0), 60_000);

  // Beside the accounts, and not accounts: these must not be walked as one.
  for (const name of ['action', 'qos', 'temp', 'update']) {
    await fsp.mkdir(path.join(appData, 'ZaloData', 'media', name), { recursive: true });
  }
}

/**
 * A Telegram tree with two accounts and an unpacked update.
 *
 * The version strings are put where a real `VS_VERSIONINFO` puts them --
 * `FileVersion`, NULs, the value -- because that parse is the part that broke
 * twice before it worked, and a test that mocked it would have proved nothing.
 */
function fakeExe(version) {
  const key = Buffer.from('FileVersion', 'utf16le');
  const value = Buffer.from(`${version}\0`, 'utf16le');
  const head = Buffer.alloc(4096);
  const tail = Buffer.concat([Buffer.alloc(8), key, Buffer.alloc(4), value, Buffer.alloc(64)]);
  return Buffer.concat([head, tail]);
}

async function buildTelegram(appData, { staged = '7.2.5.0', installed = '7.1.3.0' } = {}) {
  const root = path.join(appData, 'Telegram Desktop');
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, 'Telegram.exe'), fakeExe(installed));

  for (const [account, files] of [['user_data', 1], ['user_data#2', 4]]) {
    for (const kind of ['cache', 'media_cache']) {
      for (let i = 0; i < files; i++) {
        await write(path.join(root, 'tdata', account, kind, `${i}`, `blob${i}`), Buffer.alloc(0), 10_000);
      }
    }
  }
  // Not an account, and next to two that are.
  await fsp.mkdir(path.join(root, 'tdata', 'emoji'), { recursive: true });

  if (staged) {
    const temp = path.join(root, 'tupdates', 'temp');
    await fsp.mkdir(temp, { recursive: true });
    await fsp.writeFile(path.join(temp, 'Telegram.exe'), fakeExe(staged));
    await write(path.join(temp, 'modules', 'x64', 'd3d', 'd3dcompiler_47.dll'), Buffer.alloc(0), 4_900_000);
    await fsp.writeFile(path.join(temp, 'ready'), '');
  }
}

const bytesOf = (groups) => groups.reduce((sum, g) => sum + g.bytes, 0);

async function main() {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-chat-'));

  // The isolation this harness promises itself. Not a formality: every path
  // below is built from `env`, so if this were the real APPDATA the tests
  // would pass while reading somebody's messages.
  console.log('\nchat: isolation\n');
  const appData = path.join(base, 'Roaming');
  const env = { APPDATA: appData, LOCALAPPDATA: path.join(base, 'Local') };
  check('the fixture is not the real APPDATA',
    path.resolve(appData).toLowerCase() !== path.resolve(process.env.APPDATA || 'x').toLowerCase(), appData);
  check('and the real Zalo folder is out of reach of this env',
    !zalo.dataRoot(env).toLowerCase().startsWith(String(process.env.APPDATA || 'x').toLowerCase()));

  try {
    await buildZalo(appData);
    await buildTelegram(appData);

    /* ---- names -------------------------------------------------------- */

    console.log('\nchat: a Zalo file name carries two ids and the time it was sent\n');
    {
      const parsed = zalo.parseName(`1788935538538_${ACCOUNT}_g4247325580991211986_n`);
      check('the timestamp, the account and the conversation all come out',
        parsed.sentAt === 1788935538538 && parsed.account === ACCOUNT &&
          parsed.conversation === 'g4247325580991211986' && parsed.variant === 'full',
        JSON.stringify(parsed));
      check('the thumbnail variant is told apart from the full one',
        zalo.parseName(`1_${ACCOUNT}_g1_t`).variant === 'thumb');
      check('a name that follows no pattern yields nulls rather than throwing',
        zalo.parseName('IMG_0001.JPG').conversation === null);

      // Found by a screenshot: two videos dated 2185 and 2187. Their names
      // begin with thirteen digits that are an id, not a time, and a length
      // test could never tell the difference.
      check('thirteen digits that are an id, not a time, are not read as one',
        zalo.parseName('6813644617565_1_g1_n').sentAt === null &&
          zalo.parseName('6859456940133_1_g1_n').sentAt === null);
      check('and a real Zalo timestamp still is',
        zalo.parseName(`1788935538538_${ACCOUNT}_g1_n`).sentAt === 1788935538538);
      check('the window is a range, not a digit count',
        !zalo.plausibleTime(0) && !zalo.plausibleTime(Date.now() + 400 * 86400000) &&
          zalo.plausibleTime(Date.now()));

      // The pair key is the first three fields only: the fourth is `n`/`t` on
      // one side and a hash plus `.jxl` on the other, so including it would
      // never match anything.
      check('the pair key ignores everything after the two ids',
        zalo.pairKey(`1788935538538_${ACCOUNT}_g1_n`) === zalo.pairKey(`1788935538538_${ACCOUNT}_g1_abc.jxl`),
        zalo.pairKey(`1788935538538_${ACCOUNT}_g1_n`));

      // The `g` prefix is the only thing separating a group from a person, and
      // the check has to be case-sensitive to mean anything.
      check('a group id is the one that begins with a lowercase g',
        zalo.isGroupId('g4247325580991211986') && !zalo.isGroupId('13410346471542028') &&
          !zalo.isGroupId('G4247325580991211986'));
    }

    /* ---- the layout ---------------------------------------------------- */

    console.log('\nchat: Zalo, and the one folder that splits by conversation\n');
    const zaloModel = await zalo.scan({ env });
    {
      check('the account under `media` is found, and the folders beside it are not',
        zaloModel.accounts.length === 1 && zaloModel.accounts[0].id === ACCOUNT,
        zaloModel.accounts.map((a) => a.id).join(', '));
      check('both conversations are found', zaloModel.conversations.length === 2,
        zaloModel.conversations.map((c) => c.id).join(', '));
      check('one of them is a group and one is not',
        zaloModel.conversations.filter((c) => c.group).length === 1);

      const group = zaloModel.conversations.find((c) => c.group);
      const kinds = group.byKind.map((k) => k.kind).sort().join(',');
      check('the kind folders inside a conversation are read, not the conversation folder itself',
        kinds === 'Cache,picture,video', kinds);
      check('`.rescache` is never counted -- it is Zalo\u2019s own index',
        group.byKind.every((k) => k.files.every((f) => f.name !== '.rescache')));

      // The measurement this screen exists to report.
      check('a photo in both Cache and picture is counted as held twice',
        group.pairedCount === 2, `${group.pairedCount} of 3`);
      check('and the one with no re-encoded copy is not',
        group.pairedCount < group.byKind.find((k) => k.kind === 'Cache').files.length / 2 + 1);
      // Both Cache-side files for a photo -- the full one and the thumbnail --
      // share the pair key, so both count. They are both the copy as received.
      check('the bytes named are the Cache side, which is the copy anything can open',
        group.pairedCacheBytes === 2 * (91405 + 9800), String(group.pairedCacheBytes));

      const shared = zaloModel.shared.map((g) => g.kind).sort().join(',');
      check('the flat folders and the stickers are shared, not attached to a conversation',
        shared === 'richThumb,sticker,video,zinstant', shared);
      check('stickers are found three levels down',
        zaloModel.shared.find((g) => g.kind === 'sticker').files.length === 2);
      check('an empty folder does not become a row of nothing',
        !zaloModel.shared.some((g) => g.kind === 'picture'));

      check('the date range comes from the time in the name, not the file\u2019s mtime',
        group.earliest === 1788935538538 && group.latest === 1788944518423,
        `${group.earliest}..${group.latest}`);

      // The privacy rule, checked against paths rather than taken on trust.
      const every = [...zaloModel.conversations.flatMap((c) => c.byKind), ...zaloModel.shared]
        .flatMap((g) => g.files.map((f) => f.path));
      check('nothing read is inside the message database or local storage',
        every.every((p) => !/[\\/](Database|databases|Local Storage|Session Storage)[\\/]/i.test(p)),
        String(every.length) + ' files');
    }

    /* ---- the extensionless JPEG ---------------------------------------- */

    console.log('\nchat: the photos with no extension, and the ones nothing can read\n');
    {
      const group = zaloModel.conversations.find((c) => c.group);
      const cache = group.byKind.find((k) => k.kind === 'Cache').files[0];
      const jxl = group.byKind.find((k) => k.kind === 'picture').files[0];

      check('a Cache file has no extension at all', path.extname(cache.name) === '', cache.name);
      check('so the extension rule the photo scan uses would refuse it',
        format.kindOfExtension('') === null);
      check('but its own bytes say JPEG',
        (format.detectFormat(await fsp.readFile(cache.path)) || {}).format === 'jpeg');
      // What makes the loosening safe to do later (E5): an empty extension is
      // not a *contradiction* of the bytes, so nothing would be flagged as a
      // file pretending to be something it is not.
      check('and an empty extension is not reported as a mismatch',
        format.extensionMatches('', 'jpeg'));

      check('the re-encoded copy is JPEG XL, which is a picture by extension too',
        path.extname(jxl.name) === '.jxl' && format.kindOfExtension('jxl') === 'image');
      check('and its bytes agree',
        (format.detectFormat(await fsp.readFile(jxl.path)) || {}).format === 'jxl');
    }

    /* ---- Telegram ------------------------------------------------------ */

    console.log('\nchat: Telegram, both accounts, and the update nobody should assume is rubbish\n');
    const telegramModel = await telegram.scan({ env });
    {
      const ids = telegramModel.accounts.map((a) => a.id).sort().join(',');
      check('both accounts are found, including the one with the # suffix',
        ids === 'user_data,user_data#2', ids);
      check('and a folder that is not an account is left out', !ids.includes('emoji'));
      check('each account\u2019s caches are read', telegramModel.accounts.every((a) => a.caches.length === 2),
        telegramModel.accounts.map((a) => `${a.id}:${a.caches.length}`).join(' '));
      check('Telegram offers no conversation at all, and says so',
        telegramModel.conversationsAvailable === false);

      const update = telegramModel.update;
      check('the staged update is found', Boolean(update), update ? `${update.files.length} files` : 'none');
      check('and both version numbers are read out of the two executables',
        update.stagedVersion === '7.2.5.0' && update.installedVersion === '7.1.3.0',
        `${update.stagedVersion} over ${update.installedVersion}`);
      check('the one waiting is newer than the one running', update.newer > 0, String(update.newer));

      check('version comparison handles unequal lengths and a missing side',
        telegram.compareVersions('7.2', '7.2.0') === 0 && telegram.compareVersions('7.1.3.0', '7.2.5.0') < 0 &&
          telegram.compareVersions(null, '1.0') === null);
    }

    /* ---- what a machine with neither app says -------------------------- */

    console.log('\nchat: a machine with neither app\n');
    {
      const empty = path.join(base, 'empty');
      await fsp.mkdir(empty, { recursive: true });
      const model = await chatMeasure.scan({ env: { APPDATA: empty }, deps: { runningProcessNames: async () => new Set() } });
      check('neither app is reported installed', !model.zalo.installed && !model.telegram.installed);
      check('and the totals are zero rather than missing',
        model.zalo.bytes === 0 && model.telegram.bytes === 0 && model.zalo.byKind.length === 0);
    }

    /* ---- the three levels ---------------------------------------------- */

    console.log('\nchat: the three levels the roadmap asks for\n');
    const closed = async () => chatMeasure.scan({ env, deps: { runningProcessNames: async () => new Set(['explorer.exe']) } });
    const model = await closed();
    {
      const kinds = model.zalo.byKind.map((k) => k.kind);
      check('level 1: every kind Zalo holds is totalled', kinds.includes('picture') && kinds.includes('Cache') &&
        kinds.includes('sticker'), kinds.join(', '));
      check('level 1 is sorted largest first',
        model.zalo.byKind.every((k, i, all) => i === 0 || all[i - 1].bytes >= k.bytes));
      check('and the total matches the folders it came from',
        model.zalo.bytes === bytesOf([...model.zalo.conversations.flatMap((c) => c.byKind), ...model.zalo.shared]),
        String(model.zalo.bytes));

      check('level 2: the months are in order and carry both figures',
        model.zalo.histogram.months.length > 0 &&
          model.zalo.histogram.months.every((m) => /^\d{4}-\d{2}$/.test(m.month) && m.bytes > 0 && m.files > 0),
        model.zalo.histogram.months.map((m) => m.month).join(' '));
      check('and it says how much of it is the time a message was sent rather than an mtime',
        model.zalo.histogram.fromNames > 0 && model.zalo.histogram.fromNames <= model.zalo.histogram.totalFiles,
        `${model.zalo.histogram.fromNames} of ${model.zalo.histogram.totalFiles}`);
      check('Telegram\u2019s histogram claims none of it, because no Telegram name has a time in it',
        model.telegram.histogram.fromNames === 0);

      check('level 3: conversations, and only from Zalo',
        model.zalo.conversations.length === 2 && telegramModel.conversationsAvailable === false);
    }

    /* ---- the rows ------------------------------------------------------ */

    console.log('\nchat: the rows, and which of them a button can act on\n');
    {
      const { candidates, summary, locked } = await analyzers.collect(
        'chat', { model }, { can: () => true, strict: true }
      );
      check('every row passes the contract', candidates.length > 0 && locked === null, `${candidates.length} rows`);
      for (const candidate of candidates) validateCandidate(candidate);

      const folders = candidates.filter((c) => c.kind === 'folder');
      const files = candidates.filter((c) => c.kind === 'file');
      check('a folder row offers nothing -- both recycle and quarantine refuse a directory',
        folders.length > 0 && folders.every((c) => c.actions.length === 0), `${folders.length} folder rows`);
      check('a file row is what a button acts on',
        files.length > 0 && files.every((c) => c.actions.join() === 'recycle,quarantine'), `${files.length} file rows`);
      check('every file row names the folder row it belongs to',
        files.every((c) => folders.some((f) => f.id === c.meta.owner)));

      check('nothing a chat app downloaded is ever safe',
        candidates.every((c) => c.verdict !== 'safe'), [...new Set(candidates.map((c) => c.verdict))].join(', '));
      check('and none of it may run unattended',
        candidates.every((c) => !c.unattendedEligible) &&
          ['chat.conversation', 'chat.shared', 'chat.update', 'chat.file'].every((c) => !isAllowedUnattended(c)));

      check('no row is inside a message database',
        candidates.every((c) => !/[\\/](Database|databases|Local Storage|Session Storage)[\\/]/i.test(`${c.path}${path.sep}`)));

      const conv = candidates.filter((c) => c.category === 'chat.conversation');
      check('a conversation row says why it has a number for a name',
        conv.every((c) => c.evidence.some((e) => e.i18n === 'evidence.chat.noName')));
      check('and carries the removal sentence the roadmap asks for',
        conv.every((c) => c.evidence.some((e) => e.i18n === 'chat.removalNote')));
      check('its kinds travel as messages, not as English pasted into a parameter',
        conv.every((c) => c.meta.byKind.every((k) => k.label && k.label.i18n && k.label.en)));
      check('a group chat and a direct one lead with different evidence',
        conv.some((c) => c.evidence.some((e) => e.i18n === 'evidence.chat.group')) &&
          conv.some((c) => c.evidence.some((e) => e.i18n === 'evidence.chat.direct')));

      const update = candidates.find((c) => c.category === 'chat.update');
      check('the staged update says what it would cost to delete',
        update && update.evidence.some((e) => e.i18n === 'evidence.chat.updateCost'));
      check('and names both versions in its first real sentence',
        update.evidence.some((e) => e.i18n === 'evidence.chat.updatePending'));

      check('the summary refers to rows by id rather than repeating them',
        summary.rows.conversations.length === 2 && summary.rows.updates.length === 1 &&
          summary.zalo.conversations === undefined && summary.zalo.shared === undefined,
        `${summary.rows.conversations.length} + ${summary.rows.shared.length} + ${summary.rows.updates.length}`);
      // Level 2's other half. It is in the payload because the screen draws it;
      // a figure measured, sent over and drawn nowhere is the shape of bug that
      // `npm run test:dead` exists for.
      check('and it carries the largest files, which the screen has a list for',
        summary.zalo.histogram.biggest.length > 0 &&
          summary.zalo.histogram.biggest.every((f) => f.path && f.kind && f.size > 0) &&
          summary.zalo.histogram.biggest.every((f, i, all) => i === 0 || all[i - 1].size >= f.size),
        `${summary.zalo.histogram.biggest.length} files`);
    }

    /* ---- an update that is not waiting --------------------------------- */

    console.log('\nchat: an update that has already been applied\n');
    {
      const other = path.join(base, 'applied');
      await buildTelegram(other, { staged: '7.0.0.0', installed: '7.1.3.0' });
      const model2 = await telegram.scan({ env: { APPDATA: other } });
      check('an older staged version is reported as older, not as pending', model2.update.newer < 0,
        `${model2.update.stagedVersion} vs ${model2.update.installedVersion}`);
      const row = chatAnalyzer.updateCandidate(model2.update, { zalo: false, telegram: false });
      check('and the row says so rather than offering to apply it',
        row.evidence.some((e) => e.i18n === 'evidence.chat.updateApplied'),
        row.evidence.map((e) => e.i18n).join(', '));

      const bare = path.join(base, 'noversion');
      await fsp.mkdir(path.join(bare, 'Telegram Desktop', 'tupdates'), { recursive: true });
      await write(path.join(bare, 'Telegram Desktop', 'tupdates', 'blob'), Buffer.alloc(0), 1000);
      const model3 = await telegram.scan({ env: { APPDATA: bare } });
      const row3 = chatAnalyzer.updateCandidate(model3.update, { zalo: false, telegram: false });
      check('with no version to read, it says that instead of guessing',
        row3.evidence.some((e) => e.i18n === 'evidence.chat.updateUnknown'));
    }

    /* ---- the open-app gate --------------------------------------------- */

    console.log('\nchat: an app that is open holds everything back\n');
    {
      const open = await chatMeasure.scan({ env, deps: { runningProcessNames: async () => new Set(['zalo.exe']) } });
      const { candidates } = await analyzers.collect('chat', { model: open }, { can: () => true, strict: true });
      const zaloRows = candidates.filter((c) => c.meta.app === 'zalo');
      const tgRows = candidates.filter((c) => c.meta.app === 'telegram' && c.kind === 'file');
      check('with Zalo open, every row of its is keep and offers nothing',
        zaloRows.every((c) => c.verdict === 'keep') &&
          zaloRows.filter((c) => c.kind === 'file').every((c) => c.actions.join() === 'none'),
        `${zaloRows.length} rows`);
      check('and it says which app to close',
        zaloRows.every((c) => c.evidence[0].i18n === 'evidence.chat.appOpen'));
      check('Telegram, which is closed, is unaffected',
        tgRows.every((c) => c.verdict === 'review' && c.actions.includes('recycle')), `${tgRows.length} rows`);

      const blind = await chatMeasure.scan({ env, deps: { runningProcessNames: async () => null } });
      const out = await analyzers.collect('chat', { model: blind }, { can: () => true, strict: true });
      check('not being able to read the process list holds everything back too',
        out.candidates.every((c) => c.verdict === 'keep') &&
          out.candidates.filter((c) => c.kind === 'file').every((c) => c.actions.join() === 'none'));
      check('and it says that is what happened, rather than claiming nothing is running',
        out.candidates.every((c) => c.evidence[0].i18n === 'evidence.chat.processUnknown'));

      // ZaloCall and ZaloCap are separate executables of the same app; a check
      // that only knew `Zalo.exe` would let a call in progress be interrupted.
      const call = await chatMeasure.openApps({ runningProcessNames: async () => new Set(['zalocall.exe']) });
      check('a Zalo helper process counts as Zalo being open', call.zalo === true);
    }

    /* ---- recognising a chat file anywhere ------------------------------ */

    console.log('\nchat: the confirmation knows these files wherever they came from\n');
    {
      const inChat = path.join(appData, 'ZaloData', 'media', ACCOUNT, 'ZaloDownloads', 'resource', 'g1', 'Cache', 'x_1_g1_n');
      check('a Zalo download is recognised', chatKnown.ownsPath(inChat, env) === 'zalo');
      check('a Telegram one is too',
        chatKnown.ownsPath(path.join(appData, 'Telegram Desktop', 'tupdates', 'temp', 'Telegram.exe'), env) === 'telegram');
      check('the message database is not -- this answers for downloads only',
        chatKnown.ownsPath(path.join(appData, 'ZaloData', 'Database', 'messages.db'), env) === null);
      check('and an ordinary file is not', chatKnown.ownsPath('D:\\photos\\holiday.jpg', env) === null);
      // `…\media` must not claim `…\mediaplayer`.
      check('a folder that merely starts with the same letters is not claimed',
        chatKnown.ownsPath(path.join(appData, 'ZaloData', 'mediaplayer', 'x'), env) === null);

      const counts = chatKnown.countByApp([inChat, inChat, 'D:\\x.jpg'], env);
      check('and a list of paths is counted per app', counts.get('zalo') === 2 && counts.size === 1,
        [...counts].map(([k, v]) => `${k}:${v}`).join(', '));
    }

    /* ---- the Photos screen's Telegram root, which was the wrong folder -- */

    console.log('\nchat: the media root that could only ever see one account\n');
    {
      // Not a D3 feature -- a bug D3 found. The Photos screen has had Telegram
      // in its root list since the photo subsystem shipped, pointed at the
      // fixed path `tdata\user_data\media_cache`. On this machine that is one
      // file of 10 KB, while the second account's folder -- which the path
      // could never reach -- holds the rest.
      const list = (dir) => {
        try {
          return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
        } catch {
          return [];
        }
      };
      const before = process.env.APPDATA;
      process.env.APPDATA = appData;
      let found;
      try {
        found = mediaRoots
          .candidateRoots({ home: base, pictures: null, videos: null, downloads: null }, fs.existsSync, list)
          .filter((r) => r.name.startsWith('Telegram'));
      } finally {
        process.env.APPDATA = before;
      }

      check('both Telegram accounts become roots, not just the first',
        found.length === 2, found.map((r) => r.name).join(' | '));
      check('and each one says which account it is',
        found.some((r) => r.name.includes('user_data#2')), found.map((r) => r.name).join(' | '));
      check('the paths are the accounts’ own media caches',
        found.every((r) => r.path.endsWith(path.join('media_cache'))), found.map((r) => r.path).join(' | '));

      // A caller that does not hand over a lister gets no per-account roots
      // rather than an exception -- the two real callers both pass one.
      process.env.APPDATA = appData;
      let without;
      try {
        without = mediaRoots
          .candidateRoots({ home: base, pictures: null, videos: null, downloads: null }, fs.existsSync)
          .filter((r) => r.name.startsWith('Telegram'));
      } finally {
        process.env.APPDATA = before;
      }
      check('without a lister it degrades quietly instead of throwing', without.length === 0);
    }

    /* ---- the licence --------------------------------------------------- */

    console.log('\nchat: the feature key that had never been used\n');
    {
      check('the analyzer is behind pro.chat', analyzers.get('chat').feature === 'pro.chat');
      const { locked, candidates } = await analyzers.collect('chat', { model }, { can: (f) => f === 'free' });
      check('a licence without it yields "locked", not rows',
        locked === 'pro.chat' && candidates.length === 0, String(locked));
      check('and a Pro licence includes it', can({ state: 'active', tier: 'pro', addons: [] }, 'pro.chat'));
      check('while Free does not', !can({ state: 'none', tier: 'free', addons: [] }, 'pro.chat'));
    }
  } finally {
    await fsp.rm(base, { recursive: true, force: true }).catch(() => {});
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
