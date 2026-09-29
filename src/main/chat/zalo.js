'use strict';

/**
 * Where Zalo puts what it downloads, and which conversation each piece came
 * from (D3, Level 3).
 *
 * ## Nothing here opens a database
 *
 * The privacy decision in the roadmap is absolute and this file is where it
 * would be broken if it were going to be: `%APPDATA%\ZaloData\Database` is
 * 1,239.8 MB on this machine and it is never opened, never read, never
 * listed as something to remove. Neither is `ftsm_<account>.db`, nor the
 * `.rescache` index Zalo keeps in every folder. What is read is the shape of
 * the folder tree and the names of the files in it -- nothing else.
 *
 * That is also why conversations are identified by a raw id. The id is in the
 * folder name and in every file name; the human name for it is in the
 * database, and the app does not open the database. The screen says so.
 *
 * ## The layout, as measured on this machine
 *
 *   %APPDATA%\ZaloData\
 *     media\<account id>\
 *       ZaloDownloads\
 *         resource\<conversation id>\{Cache,picture,richThumb,video,voice,file,fileNoise}\
 *         video\ voice\ file\ fileNoise\ richThumb\ zinstant\    (flat, not per conversation)
 *         picture\ fileThumb\                                    (empty here)
 *       sticker\                                                 (39.1 MB, shared)
 *
 * **Only `resource` splits by conversation**, and it splits one level deeper
 * than it first appears: the conversation folder holds *kind* folders, and the
 * files are inside those. The other kinds each hold a single `group` folder
 * that is empty, with their files sitting flat alongside it.
 *
 * ## The two copies
 *
 * Zalo keeps a photo twice, and this is the largest single fact D3 has to
 * report. For one picture on this machine:
 *
 *   resource\<conv>\Cache\1788935538538_<acct>_<conv>_n            91,405 bytes, JPEG
 *   resource\<conv>\picture\1788935538538_<acct>_<conv>_<md5>.jxl  41,323 bytes, JPEG XL
 *
 * Across all 57 conversations: 2,194 pictures exist in both, and the `Cache`
 * side of those alone is 272.3 MB -- 26% of the whole download tree.
 *
 * **And the smaller copy is the one nothing can display.** Measured with the
 * two decoders `lib/media/thumbs.js` uses, on Electron 33.4.11 / Chromium 130:
 * the `.jxl` comes back empty from Chromium and throws from the Windows shell,
 * while the extensionless `Cache` file decodes to 862x1897. So the obvious
 * advice -- "delete the duplicate" -- points at the wrong file, and this
 * module reports the pairing as evidence rather than as a recommendation.
 *
 * ## File names carry both ids and the time
 *
 *   1788935538538_254377760481765028_13410346471542028_n
 *   <epoch ms>____<account id>_______<conversation id>___<n full | t thumb>
 *
 * The timestamp in the name is what the histogram is built from where it is
 * there, because it is when the message was sent rather than when this
 * machine happened to write the file.
 *
 * Only reads.
 */

const path = require('node:path');

const { fsp } = require('../lib/real-fs');

/** The folder under the account that holds everything downloaded. */
const DOWNLOADS = 'ZaloDownloads';

/** The one folder under `ZaloDownloads` that splits by conversation. */
const BY_CONVERSATION = 'resource';

/**
 * The kinds of thing Zalo downloads, in the order a person would rank them.
 *
 * `Cache` is in here deliberately, and named as what it is rather than as
 * junk: it holds the original JPEG, which is the copy this machine can
 * actually open.
 */
const KINDS = Object.freeze(['picture', 'Cache', 'video', 'voice', 'file', 'fileNoise', 'richThumb', 'zinstant', 'fileThumb']);

/** A lowercase index of the above, because the disk's casing is not promised. */
const KIND_BY_LOWER = new Map(KINDS.map((k) => [k.toLowerCase(), k]));

/**
 * Names that are Zalo's own bookkeeping and are never touched or counted.
 *
 * `.rescache` sits in nearly every folder here. It is small, it is plainly an
 * index, and removing it is Zalo's business rather than this app's.
 */
const NEVER_TOUCH = new Set(['.rescache']);

/**
 * Folders under `ZaloData` that hold the messages themselves.
 *
 * Listed so that the check is written down rather than implied by the fact
 * that no code walks into them.
 */
const NEVER_READ = Object.freeze(['Database', 'databases', 'Local Storage', 'Session Storage', 'WebStorage']);

/** A conversation id that begins with a lowercase `g`. */
const isGroupId = (id) => /^g[0-9]+$/.test(id);

/** A conversation id: all digits, or `g` and digits. Case matters. */
const isConversationId = (id) => /^g?[0-9]{5,}$/.test(id);

/**
 * A number in a file name is only a time if it lands in a plausible one.
 *
 * Found by a screenshot, and it is the kind of thing only a screenshot finds:
 * "the largest of them" listed two videos dated **30 November 2185** and **15
 * May 2187**. Their names begin `6813644617565` and `6859456940133`, which are
 * thirteen digits and therefore passed a length test, and which as epoch
 * milliseconds are a hundred and sixty years from now. They are ids, not times.
 *
 * So the test is the range rather than the digit count. Zalo did not exist
 * before 2012 and a message cannot have been sent next year.
 */
const EARLIEST_PLAUSIBLE = Date.UTC(2010, 0, 1);
const plausibleTime = (ms) => Number.isFinite(ms) && ms >= EARLIEST_PLAUSIBLE && ms <= Date.now() + 365 * 86400000;

/**
 * `<epoch ms>_<account>_<conversation>_<rest>` -- as much of it as is there.
 *
 * Returns nulls rather than throwing, because a file that does not follow the
 * pattern still has a size and still belongs to the folder it is in.
 */
function parseName(name) {
  const parts = name.split('_');
  const first = /^[0-9]{10,14}$/.test(parts[0]) ? Number(parts[0]) : null;
  const sentAt = plausibleTime(first) ? first : null;
  const account = parts.length > 1 && /^[0-9]{5,}$/.test(parts[1]) ? parts[1] : null;
  const conversation = parts.length > 2 && isConversationId(parts[2]) ? parts[2] : null;
  // What is left after the three ids: `n`, `t`, or a hash with an extension.
  const tail = parts.length > 3 ? parts.slice(3).join('_') : null;
  const variant = tail === 'n' ? 'full' : tail === 't' ? 'thumb' : null;
  return { sentAt, account, conversation, variant };
}

/**
 * The key that says "this is the same picture" across `Cache` and `picture`.
 *
 * The first three fields only: the fourth is `n`/`t` on one side and a hash
 * plus `.jxl` on the other, so including it would never match anything.
 */
function pairKey(name) {
  const parts = name.split('_');
  if (parts.length < 3) return null;
  if (!/^[0-9]{10,14}$/.test(parts[0])) return null;
  return `${parts[0]}_${parts[1]}_${parts[2]}`;
}

/* -------------------------------------------------------------------------- */
/* finding it                                                                  */
/* -------------------------------------------------------------------------- */

const exists = async (target) => {
  try {
    await fsp.stat(target);
    return true;
  } catch {
    return false;
  }
};

/**
 * Where Zalo keeps its data, or null.
 *
 * One fixed location. Zalo writes no registry key naming its data folder that
 * this machine could confirm, so rather than guess at one, the folder is
 * looked for where it is -- and if it is not there, the screen says Zalo was
 * not found instead of inventing a path.
 */
function dataRoot(env = process.env) {
  const appData = env.APPDATA;
  if (!appData) return null;
  return path.join(appData, 'ZaloData');
}

/**
 * The account folders under `media`.
 *
 * An account is a folder whose name is all digits and which holds a
 * `ZaloDownloads`. `action`, `qos`, `temp` and `update` sit beside them and
 * are not accounts.
 */
async function accountsIn(root) {
  const mediaDir = path.join(root, 'media');
  let entries;
  try {
    entries = await fsp.readdir(mediaDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[0-9]{5,}$/.test(entry.name)) continue;
    const dir = path.join(mediaDir, entry.name);
    if (!(await exists(path.join(dir, DOWNLOADS)))) continue;
    out.push({ id: entry.name, path: dir, downloads: path.join(dir, DOWNLOADS) });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* reading one folder of files                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Every file directly in one folder, with its size and the time in its name.
 *
 * Not recursive on purpose. Each place this is called is a leaf in the layout
 * above, and a recursive read would silently fold a conversation's files into
 * the flat totals if Zalo ever nested one deeper.
 */
async function filesIn(dir, token) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (token && token.cancelled) break;
    if (!entry.isFile()) continue;
    if (NEVER_TOUCH.has(entry.name.toLowerCase())) continue;
    const full = path.join(dir, entry.name);
    let stats;
    try {
      stats = await fsp.stat(full);
    } catch {
      continue;
    }
    const parsed = parseName(entry.name);
    out.push({
      path: full,
      name: entry.name,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      // The time in the name where there is one: it is when the message was
      // sent, and the file's own mtime is when this machine wrote it.
      sentAt: parsed.sentAt,
      variant: parsed.variant,
    });
  }
  return out;
}

/**
 * Every file below a folder, to a fixed depth.
 *
 * Used for one place only: `sticker`, which is the single part of this layout
 * that nests. Measured here: 172 pack folders, each holding numbered folders,
 * and every one of the 962 files sits exactly three levels down. Everywhere
 * else `filesIn` is used instead, because a recursive read there would fold a
 * conversation's files into the flat totals if Zalo ever nested one.
 */
const STICKER_DEPTH = 4;

async function filesUnder(dir, token, depth = 0, out = []) {
  if (depth > STICKER_DEPTH) return out;
  if (token && token.cancelled) return out;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (token && token.cancelled) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await filesUnder(full, token, depth + 1, out);
      continue;
    }
    if (!entry.isFile() || NEVER_TOUCH.has(entry.name.toLowerCase())) continue;
    let stats;
    try {
      stats = await fsp.stat(full);
    } catch {
      continue;
    }
    out.push({ path: full, name: entry.name, size: stats.size, mtimeMs: stats.mtimeMs, sentAt: null, variant: null });
  }
  return out;
}

/** Sum of a file list. */
const bytesOf = (files) => files.reduce((sum, f) => sum + f.size, 0);

/* -------------------------------------------------------------------------- */
/* the scan                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Read one account's downloads.
 *
 * @returns {Promise<{conversations: object[], shared: object[]}>}
 */
async function readAccount(account, token, onProgress) {
  const conversations = [];
  const shared = [];

  /* -- the flat kinds, which belong to no conversation -------------------- */

  let topEntries;
  try {
    topEntries = await fsp.readdir(account.downloads, { withFileTypes: true });
  } catch {
    topEntries = [];
  }

  for (const entry of topEntries) {
    if (token && token.cancelled) break;
    if (!entry.isDirectory()) continue;
    const kind = KIND_BY_LOWER.get(entry.name.toLowerCase());
    if (!kind) continue;
    const files = await filesIn(path.join(account.downloads, entry.name), token);
    if (files.length === 0) continue;
    shared.push({ kind, path: path.join(account.downloads, entry.name), files, bytes: bytesOf(files) });
  }

  // Stickers sit beside `ZaloDownloads`, not inside it, and belong to nobody
  // in particular: 960 files and 39.1 MB here, all of it re-fetchable.
  const stickers = path.join(account.path, 'sticker');
  if (await exists(stickers)) {
    const files = await filesUnder(stickers, token);
    if (files.length > 0) {
      shared.push({ kind: 'sticker', path: stickers, files, bytes: bytesOf(files) });
    }
  }

  /* -- the conversations --------------------------------------------------- */

  const resourceDir = path.join(account.downloads, BY_CONVERSATION);
  let convEntries;
  try {
    convEntries = await fsp.readdir(resourceDir, { withFileTypes: true });
  } catch {
    convEntries = [];
  }

  let done = 0;
  const total = convEntries.filter((e) => e.isDirectory()).length;

  for (const entry of convEntries) {
    if (token && token.cancelled) break;
    if (!entry.isDirectory()) continue;

    const convPath = path.join(resourceDir, entry.name);
    const byKind = [];

    let kindEntries;
    try {
      kindEntries = await fsp.readdir(convPath, { withFileTypes: true });
    } catch {
      kindEntries = [];
    }

    for (const kindEntry of kindEntries) {
      if (token && token.cancelled) break;
      if (!kindEntry.isDirectory()) continue;
      const kind = KIND_BY_LOWER.get(kindEntry.name.toLowerCase());
      if (!kind) continue;
      const files = await filesIn(path.join(convPath, kindEntry.name), token);
      if (files.length === 0) continue;
      byKind.push({ kind, path: path.join(convPath, kindEntry.name), files, bytes: bytesOf(files) });
    }

    done += 1;
    if (onProgress && done % 5 === 0) onProgress({ phase: 'conversations', done, total });

    if (byKind.length === 0) continue;

    conversations.push({
      id: entry.name,
      path: convPath,
      group: isGroupId(entry.name),
      byKind,
      ...summarise(byKind),
    });
  }

  if (onProgress) onProgress({ phase: 'conversations', done: total, total });

  return { conversations, shared };
}

/**
 * The numbers one conversation's folders add up to, including the pairing.
 *
 * The pairing is counted here rather than guessed at: a picture is "held
 * twice" only when a file in `Cache` and a file in `picture` share the first
 * three fields of their names. On this machine that is 2,194 of the 2,448 in
 * `Cache`, so it is close to a rule but it is not one, and 254 are not paired.
 */
function summarise(byKind) {
  const cacheKeys = new Map();
  const pictureKeys = new Set();
  let bytes = 0;
  let files = 0;
  let earliest = null;
  let latest = null;

  for (const group of byKind) {
    bytes += group.bytes;
    files += group.files.length;
    for (const file of group.files) {
      const when = Number.isFinite(file.sentAt) ? file.sentAt : file.mtimeMs;
      if (Number.isFinite(when)) {
        if (earliest === null || when < earliest) earliest = when;
        if (latest === null || when > latest) latest = when;
      }
      const key = pairKey(file.name);
      if (!key) continue;
      if (group.kind === 'Cache') cacheKeys.set(key, (cacheKeys.get(key) || 0) + file.size);
      else if (group.kind === 'picture') pictureKeys.add(key);
    }
  }

  let pairedCount = 0;
  let pairedCacheBytes = 0;
  for (const [key, size] of cacheKeys) {
    if (!pictureKeys.has(key)) continue;
    pairedCount += 1;
    pairedCacheBytes += size;
  }

  return { bytes, files, earliest, latest, pairedCount, pairedCacheBytes };
}

/**
 * Everything Zalo has downloaded on this machine.
 *
 * @param {object} [options]
 * @param {object} [options.token]       CancelToken
 * @param {Function} [options.onProgress]
 * @param {object} [options.env]         for the harness
 */
async function scan({ token = null, onProgress = null, env = process.env } = {}) {
  const root = dataRoot(env);
  const model = {
    app: 'zalo',
    installed: false,
    root,
    accounts: [],
    conversations: [],
    shared: [],
    neverRead: NEVER_READ.slice(),
  };

  if (!root || !(await exists(root))) return model;
  model.installed = true;

  if (onProgress) onProgress({ phase: 'zalo' });

  for (const account of await accountsIn(root)) {
    if (token && token.cancelled) break;
    const { conversations, shared } = await readAccount(account, token, onProgress);
    model.accounts.push({ id: account.id, path: account.path, conversations: conversations.length });
    for (const conversation of conversations) model.conversations.push({ ...conversation, account: account.id });
    for (const group of shared) model.shared.push({ ...group, account: account.id });
  }

  return model;
}

module.exports = {
  scan,
  dataRoot,
  accountsIn,
  readAccount,
  filesIn,
  filesUnder,
  summarise,
  parseName,
  pairKey,
  isGroupId,
  isConversationId,
  plausibleTime,
  KINDS,
  NEVER_TOUCH,
  NEVER_READ,
  DOWNLOADS,
  BY_CONVERSATION,
};
