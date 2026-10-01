'use strict';

/**
 * Two names for one file, and the way back (F4).
 *
 * This is the riskiest thing in the app, and the reason is not that linking is
 * hard -- `fs.link` is one call -- but that a hard link is *invisible*. Nothing
 * in Explorer, in a file's properties, or in the size column says that two
 * paths are one file. So every mistake made here is a mistake nobody can see
 * they are living with, which is why almost all of this module is refusing to
 * do it rather than doing it.
 *
 * ## What was measured on this machine before any of it was written
 *
 * The roadmap said Office "usually saves by replacing the file, breaking the
 * hard link silently" and marked it `[Unverified]`. It is verified now, and it
 * is worse than the sentence suggests. A `.docx` written by Word itself, hard
 * linked to a second name, then opened in Word, edited and saved once:
 *
 *   before   report.docx       nlink=2  ino=562949954013800  sha f0ca0c9a…
 *            report-link.docx  nlink=2  ino=562949954013800  sha f0ca0c9a…
 *   after    report.docx       nlink=1  ino=281474977303146  sha 8323fa9c…  13,540 B
 *            report-link.docx  nlink=1  ino=562949954013800  sha f0ca0c9a…  13,457 B
 *
 * Excel behaves identically (ino …147 -> …148). The second name keeps the old
 * bytes, the old size and the old modified time. No error is raised anywhere.
 *
 * That matters twice over. The space the feature promised comes back silently,
 * which is bad. But it also makes the warning everyone is shown -- "edit one
 * copy and you edit all of them" -- *false* for these files, and a warning
 * that is wrong in the reassuring direction is worse than no warning.
 *
 * ## The real rule, and why the exclusion list is only a proxy for it
 *
 * Four ways of saving the same file were measured on a linked pair:
 *
 *   write over it in place    nlink stays 2   the other name sees the edit
 *   append                    nlink stays 2   the other name sees the edit
 *   temp file + rename        nlink drops 1   the other name is frozen
 *   delete + recreate         nlink drops 1   the other name is frozen
 *
 * So the rule is not "Office". It is "any program that saves by replacing the
 * file", which includes every editor doing an atomic save -- this app's own
 * `lib/atomic.js` among them. There is no way to know which program will open
 * a file later, so the list below is a proxy for a rule it cannot express. It
 * is deliberately not padded out with guesses: the honest answer is to exclude
 * the documents people most often keep editing, and to *say in the dialog*
 * that the app cannot know how every program saves. A list that looked
 * complete would be the lie.
 *
 * ## Hard links need no administrator
 *
 * Measured: `fs.link` succeeds as an ordinary user on this machine. Symbolic
 * links need either Developer Mode or elevation; hard links never have. So
 * nothing here raises a UAC prompt, and nothing here should start to.
 */

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');

const { longPath, copyMetadata } = require('./verified-copy');
const ads = require('./ads');

/* -------------------------------------------------------------------------- */
/* what a file is, as the filesystem sees it                                   */
/* -------------------------------------------------------------------------- */

/**
 * The identity of a file, rather than of a name.
 *
 * `{ dev, ino }` is the pair that answers "are these two names the same file",
 * and `nlink` is how many names it has. The read is `bigint` on purpose: an
 * NTFS file id is 64 bits and the top half is a sequence number, so the
 * ordinary `Number` form can lose precision on a volume that has been in use
 * for a long time. It happens to be exact on this machine today, which is
 * exactly the kind of fact that stops being true without telling anybody.
 *
 * @returns {Promise<{dev: bigint, ino: bigint, nlink: number, size: number,
 *   mtimeMs: number, file: boolean}|null>} null when the path is not there
 */
async function identify(target) {
  try {
    const st = await fsp.lstat(longPath(target), { bigint: true });
    return {
      dev: st.dev,
      ino: st.ino,
      nlink: Number(st.nlink),
      size: Number(st.size),
      mtimeMs: Number(st.mtimeMs),
      file: st.isFile() && !st.isSymbolicLink(),
    };
  } catch {
    return null;
  }
}

/** A string that is equal for two names of one file, and for nothing else. */
const fileKey = (id) => (id ? `${id.dev}:${id.ino}` : null);

/** True when both names lead to the same file. */
const sameFile = (a, b) => Boolean(a && b && a.dev === b.dev && a.ino === b.ino);

/**
 * `identify` for a list, with one read per path and no read repeated.
 * @returns {Promise<Map<string, object|null>>} keyed by the path as given
 */
async function identifyAll(paths) {
  const out = new Map();
  for (const p of paths) {
    if (out.has(p)) continue;
    out.set(p, await identify(p));
  }
  return out;
}

/**
 * Group a list of paths by the file they actually name.
 *
 * This is the whole answer to "how much would deleting these copies give
 * back": names that already share a file give back nothing.
 *
 * @returns {Map<string, string[]>} file key -> the names pointing at it
 */
function groupByFile(identities) {
  const out = new Map();
  for (const [p, id] of identities) {
    const key = fileKey(id);
    if (!key) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(p);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* what must never be linked                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Documents whose programs save by replacing the file.
 *
 * Word and Excel are measured (see the header). The rest of the Office family
 * is the same product doing the same thing, and OpenDocument is here because
 * LibreOffice saves the same way. Nothing is added on suspicion: see the
 * header for why a longer list would be a worse one.
 */
const REPLACED_ON_SAVE = Object.freeze(
  new Set([
    // Word
    '.doc', '.docx', '.docm', '.dot', '.dotx', '.dotm', '.rtf',
    // Excel
    '.xls', '.xlsx', '.xlsm', '.xlsb', '.xlt', '.xltx', '.xltm', '.csv',
    // PowerPoint
    '.ppt', '.pptx', '.pptm', '.pot', '.potx', '.potm', '.pps', '.ppsx', '.ppsm',
    // Access, Publisher, Visio, OneNote
    '.accdb', '.mdb', '.pub', '.vsd', '.vsdx', '.vsdm', '.one',
    // OpenDocument, saved the same way by LibreOffice
    '.odt', '.ods', '.odp', '.odg', '.odf',
  ])
);

/** True when this is a document whose program was measured to break the link. */
function replacedOnSave(filePath) {
  return REPLACED_ON_SAVE.has(path.extname(String(filePath || '')).toLowerCase());
}

/* -------------------------------------------------------------------------- */
/* making the link                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Give `keeper` a second name at `copyPath`, which must already exist and
 * already hold the same bytes.
 *
 * The existing file is removed and the link put in its place, in that order,
 * because `fs.link` refuses a name that is taken and there is no atomic
 * "link over". That leaves a window in which the copy's name has nothing
 * behind it -- so the caller must have verified, immediately before, that the
 * keeper holds identical bytes. It does: `actions/hardlink.js` re-hashes both
 * files inside the same pass, and the hash it trusts is never the one the
 * window sent.
 *
 * @returns {Promise<{ok: true}|{ok: false, code: string, error: string}>}
 */
async function link(copyPath, keeperPath) {
  try {
    await fsp.unlink(longPath(copyPath));
  } catch (err) {
    return { ok: false, code: err.code || 'EUNLINK', error: err.message };
  }
  try {
    await fsp.link(longPath(keeperPath), longPath(copyPath));
    return { ok: true };
  } catch (err) {
    return { ok: false, code: err.code || 'ELINK', error: err.message };
  }
}

/* -------------------------------------------------------------------------- */
/* taking it apart again                                                       */
/* -------------------------------------------------------------------------- */

const hashOf = (p) =>
  new Promise((resolve, reject) => {
    const sum = crypto.createHash('sha256');
    const stream = fs.createReadStream(longPath(p));
    stream.on('error', reject);
    stream.on('data', (chunk) => sum.update(chunk));
    stream.on('end', () => resolve(sum.digest('hex')));
  });

/**
 * Turn one name of a shared file back into a file of its own.
 *
 * Copy the contents beside it, check the copy, then rename over the top. The
 * rename is the step that drops the link, and it is one call: the name never
 * points at nothing, not even for an instant, and a machine that loses power
 * half way through has either the link or the independent copy under that
 * name and never an empty space where a file was.
 *
 * ## What this does and does not restore
 *
 * It restores *separateness*. It does not restore the bytes the copy had
 * before it was linked -- those were freed the moment the link was made, and
 * nothing in this app or in NTFS kept them. If a program wrote to the shared
 * file while the names were linked, every name has that newer content and
 * undoing gives each of them an independent copy *of the new content*. The
 * confirmation says this; so does the Restore Center.
 *
 * Alternate data streams are copied across. They hang off the file rather than
 * off the name, so a split that ignored them would hand back a copy with no
 * `Zone.Identifier` -- silently removing a SmartScreen warning, which is the
 * same thing B2 refused to do.
 *
 * @param {string} target       the name to make independent
 * @param {object} [options]
 * @param {string} [options.sha256]   what the shared file hashed to when linked
 * @returns {Promise<{ok: boolean, code?: string, error?: string, bytes?: number,
 *   sha256?: string, changed?: boolean, streamsKnown?: boolean}>}
 */
async function splitOff(target, { sha256 = null, deps = {} } = {}) {
  const before = await identify(target);
  if (!before) return { ok: false, code: 'ENOENT', error: 'the file is no longer there' };
  if (!before.file) return { ok: false, code: 'ENOTFILE', error: 'that is not a file' };
  if (before.nlink <= 1) return { ok: false, code: 'ENOTLINKED', error: 'this name is already a file of its own' };

  const scratch = `${target}.cleandrive-split-${crypto.randomBytes(4).toString('hex')}`;
  const copy = deps.copyFile || ((from, to) => fsp.copyFile(longPath(from), longPath(to), fs.constants.COPYFILE_EXCL));
  const digest = deps.hashOf || hashOf;

  try {
    await copy(target, scratch);

    // Read both back rather than trusting the copy: the point of undoing is to
    // end up with the bytes that are there now, and a copy nobody checked is a
    // claim, not a file.
    const [here, made] = await Promise.all([digest(target), digest(scratch)]);
    if (here !== made) {
      await fsp.rm(longPath(scratch), { force: true }).catch(() => {});
      return { ok: false, code: 'EMISMATCH', error: 'the copy did not read back the same' };
    }

    // Streams hang off the file rather than off the name, so the copy starts
    // without them. Not knowing and finding none are different answers, and
    // the caller is told which of the two happened.
    let streamsKnown = true;
    const listed = await ads.list([target]).catch(() => ({ ok: false }));
    if (listed && listed.ok) {
      const streams = listed.streams.get(target) || [];
      if (streams.length > 0) {
        const done = await ads.copy(target, scratch, streams);
        if (done.failed.length > 0) streamsKnown = false;
      }
    } else {
      streamsKnown = false;
    }

    await copyMetadata(target, scratch);

    // One call, and the link is gone. `fs.rename` over an existing name is
    // what Office does by accident; here it is the whole point.
    await fsp.rename(longPath(scratch), longPath(target));

    const after = await identify(target);
    return {
      ok: true,
      bytes: before.size,
      sha256: made,
      // True when the shared file had been written to since it was linked, so
      // this copy is the newer content rather than what was there before.
      changed: Boolean(sha256) && sha256 !== made,
      streamsKnown,
      nlink: after ? after.nlink : 1,
    };
  } catch (err) {
    await fsp.rm(longPath(scratch), { force: true }).catch(() => {});
    return { ok: false, code: err.code || 'ESPLIT', error: err.message };
  }
}

module.exports = {
  identify,
  identifyAll,
  fileKey,
  sameFile,
  groupByFile,
  link,
  splitOff,
  hashOf,
  replacedOnSave,
  REPLACED_ON_SAVE,
};
