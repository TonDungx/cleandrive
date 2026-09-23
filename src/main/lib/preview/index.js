'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const { message: m } = require('../../../i18n');
const kinds = require('./kinds');
const { readText } = require('./text');
const { readOffice, listArchive } = require('./office');
const serve = require('./serve');

/**
 * Looking at a file without leaving the app.
 *
 * ## Why a disk cleaner has a viewer in it
 *
 * Every screen in this app asks the same question -- should this go? -- and
 * for anything that is not a cache or a log, that question cannot be answered
 * without seeing what is inside. Until now the answer was the **Open** button,
 * which hands the file to Word or Acrobat and puts the decision two
 * applications away from the list it was made in. Somebody weighing forty
 * documents was opening and closing Word forty times.
 *
 * So: one panel, in place, for the formats people actually accumulate. The
 * rule it works to is the same one the rest of the app follows -- say what you
 * know, say plainly what you do not. A format that cannot be rendered honestly
 * says so and offers the program that owns it, rather than showing a wall of
 * bytes and calling it a preview.
 */

/** How much of the front of a file is enough to tell what it is. */
const SNIFF_BYTES = 8192;

/**
 * Work out what a file is and prepare whatever the window needs to show it.
 *
 * Nothing here is cached: a preview is one file at a time, opened because
 * somebody asked, and the second look at the same file is as cheap as the
 * first because the operating system still has it.
 *
 * @param {string} filePath
 * @returns {Promise<object>} never throws; a file that cannot be read is
 *                            described rather than reported as a failure
 */
async function preview(filePath) {
  const target = path.resolve(filePath);

  let stats;
  try {
    stats = await fsp.lstat(target);
  } catch (err) {
    return unreadable(target, err.code === 'ENOENT' ? 'missing' : 'unreadable');
  }
  if (!stats.isFile()) return unreadable(target, 'notAFile');

  let head;
  try {
    head = await readHead(target, Math.min(SNIFF_BYTES, stats.size));
  } catch (err) {
    return unreadable(target, err.code === 'EBUSY' ? 'busy' : 'unreadable');
  }

  const decided = kinds.classify(target, head, stats.size);
  const base = {
    path: target,
    name: path.basename(target),
    ext: kinds.extensionOf(target),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    kind: decided.kind,
    format: decided.format || null,
  };

  switch (decided.kind) {
    case 'empty':
      return { ...base, note: m('preview.note.empty', 'This file has nothing in it.') };

    case 'text': {
      const text = await readText(target, stats.size);
      return {
        ...base,
        text: text.text,
        encoding: text.encoding,
        truncated: text.truncated,
        bytesRead: text.bytesRead,
        lines: text.lines,
        // A .docx that turned out to be XML, and so on. Worth saying: it is the
        // reason the file would not open in Word either.
        note:
          decided.note === 'mislabelled'
            ? m('preview.note.mislabelled', 'Named .{ext}, but the contents are plain text — which is why Word will not open it either', { ext: base.ext })
            : null,
      };
    }

    /*
     * Everything below is streamed to the window over the app's own protocol
     * rather than copied into a message. A `data:` URI is fine for a nine
     * kilobyte thumbnail and absurd for a forty megabyte PDF.
     */
    case 'image':
    case 'video':
    case 'audio':
    case 'pdf':
      if (stats.size > serve.MAX_SERVED_BYTES) {
        return {
          ...base,
          kind: 'too-large',
          note: m('preview.note.tooLarge', 'Too large to show here — open it in the program that owns it.'),
        };
      }
      return { ...base, token: serve.grant(target) };

    case 'legacy-office':
      return {
        ...base,
        note: m(
          'preview.note.legacyOffice',
          'This is the older Office format, which stores its contents in a way this app cannot read without adding a dependency it does not have. Open it in the program that owns it.'
        ),
      };

    case 'archive': {
      const listed = await listArchive(target, stats.size);
      if (!listed.ok) return { ...base, kind: 'binary', note: whyNote(listed.why, base.ext) };
      return { ...base, archive: listed };
    }

    case 'office': {
      const read = await readOffice(target, decided.format, stats.size);
      if (!read.ok) {
        /*
         * A file that is named like a document but cannot be read as one.
         *
         * It is reported as what went wrong rather than as an empty document,
         * because "this file is damaged" and "this document has nothing in it"
         * lead to opposite decisions, and a preview that confuses them is
         * worse than no preview.
         */
        return { ...base, kind: 'binary', note: whyNote(read.why, base.ext) };
      }
      return { ...base, document: read };
    }

    default:
      return {
        ...base,
        kind: 'binary',
        // Not a hex dump. Nobody has ever answered "can I delete this" by
        // reading one, and showing bytes as though they were content is the
        // kind of false confidence this app is written against.
        note: m('preview.note.binary', 'Not a format this app can show. Its size and date are above.'),
      };
  }
}

async function readHead(filePath, length) {
  if (length <= 0) return Buffer.alloc(0);
  const handle = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buf, 0, length, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Why a file that looked like a document could not be read as one.
 *
 * Each of these leads somewhere different: a damaged file might be worth
 * recovering, an encrypted one needs a password rather than a fix, and one that
 * is simply too large is fine and just does not belong in a preview pane. So
 * they are separate sentences rather than one apology.
 */
function whyNote(why, ext) {
  switch (why) {
    case 'notAZip':
    case 'notADocument':
      return m('preview.why.notADocument', 'Named .{ext}, but the contents are not a document. Whatever wrote it did not write a real one.', { ext });
    case 'encrypted':
      return m('preview.why.encrypted', 'This file is password-protected. Open it in the program that owns it.');
    case 'damaged':
      return m('preview.why.damaged', 'This file is damaged and cannot be read to the end.');
    case 'tooLarge':
      return m('preview.why.tooLarge', 'Too large to open here — open it in the program that owns it.');
    case 'busy':
      return m('preview.note.busy', 'Another program has this open.');
    case 'missing':
      return m('preview.note.missing', 'This file is no longer there.');
    default:
      return m('preview.why.unsupported', 'This file uses something inside it that this app cannot read.');
  }
}

function unreadable(target, why) {
  const notes = {
    missing: m('preview.note.missing', 'This file is no longer there.'),
    notAFile: m('preview.note.notAFile', 'This is a folder, not a file.'),
    busy: m('preview.note.busy', 'Another program has this open.'),
    unreadable: m('preview.note.unreadable', 'This file could not be opened.'),
  };
  return {
    path: target,
    name: path.basename(target),
    ext: kinds.extensionOf(target),
    size: 0,
    kind: 'unreadable',
    note: notes[why] || notes.unreadable,
  };
}

module.exports = { preview, SNIFF_BYTES };
