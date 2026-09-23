'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const mammoth = require('mammoth');

const zip = require('./zip');
const { readXlsx } = require('./xlsx');
const { readPptx } = require('./pptx');
const { MAX_IMAGE_BYTES, MAX_IMAGE_TOTAL } = require('./ooxml');

/**
 * The door into the three Office readers, and into plain archives.
 *
 * ## Why Word is the one that uses a library
 *
 * This app has a standing rule against runtime dependencies, and Word is its
 * one deliberate exception. Both readers were built and measured against real
 * documents -- `scripts/compare-office.js` still runs that comparison for the
 * other two formats -- and on text the two were within two words of each other
 * out of two thousand. What settled it was not the count but the shape:
 * `mammoth` emits real nested `<ol>` lists that the browser numbers itself,
 * where a reader that computes its own markers has to get every restart rule
 * right and has only the cases it has met so far.
 *
 * Excel and PowerPoint stayed here, and that is not inconsistency. For those
 * two the comparison went the other way: the spreadsheet libraries hand back a
 * grid with no row numbers or column letters, so a reference in a conversation
 * -- "look at column F" -- stops meaning anything; and no widely used library
 * *renders* PowerPoint at all. The one tried dropped three slides of a
 * sixty-six slide deck and returned no picture bytes whatsoever.
 *
 * ## Read whole, not streamed
 *
 * A ZIP's index is at the end and its members are scattered through the file,
 * so reading one part means at least two seeks and reading several means many.
 * For documents -- which are almost always under a few megabytes, and which
 * somebody is waiting in front of -- pulling the whole file into memory once
 * is both simpler and faster than a dozen positioned reads. The ceiling below
 * is what keeps that from being a promise the machine cannot keep.
 */

/**
 * Above this, the file is described rather than read.
 *
 * Chosen from what is actually on this machine: the largest `.xlsx` found in a
 * full scan was 4.1 MB and the largest `.pptx` 38 MB. Sixty-four leaves room
 * without inviting a half-gigabyte export to be loaded three times over.
 */
const MAX_OFFICE_BYTES = 64 * 1024 * 1024;

/** How many members of an archive are listed. Enough to see what it is. */
const MAX_LISTED = 500;

/**
 * Read an Office document.
 *
 * @param {string} filePath
 * @param {'word'|'sheet'|'slides'} format
 * @returns {Promise<object>} `{ ok: true, ... }` or `{ ok: false, why }`, never
 *          a throw: a document this cannot read is a sentence in the window,
 *          not a failure of the preview.
 */
async function readOffice(filePath, format, size) {
  if (size > MAX_OFFICE_BYTES) return { ok: false, why: 'tooLarge' };

  let buffer;
  try {
    buffer = await fsp.readFile(filePath);
  } catch (err) {
    return { ok: false, why: whyFrom(err) };
  }

  if (format === 'word') return readWord(buffer);

  let archive;
  try {
    archive = zip.open(buffer);
  } catch (err) {
    return { ok: false, why: whyFrom(err) };
  }

  try {
    switch (format) {
      case 'sheet': return { ok: true, ...readXlsx(archive) };
      case 'slides': return { ok: true, ...readPptx(archive) };
      default: return { ok: false, why: 'unsupported' };
    }
  } catch (err) {
    return { ok: false, why: whyFrom(err) };
  }
}

/**
 * A Word document, via `mammoth`.
 *
 * What comes back is HTML, and it does not go anywhere near `innerHTML`: the
 * window parses it and rebuilds it from an allowlist of tags, because these are
 * documents the user did not write and roughly half of them are markup already.
 * See `document.js` in the renderer.
 */
async function readWord(buffer) {
  /*
   * A budget for pictures, enforced here rather than left to the library.
   *
   * Images travel to the window as `data:` URIs -- base64, so a third larger
   * than the file, copied through an IPC message. Left unbounded, a report with
   * sixty photographs in it is a frozen window rather than a slow one. The
   * ceiling is shared with the other two readers so all three degrade alike.
   */
  let spent = 0;
  let carried = 0;
  let dropped = 0;

  const convertImage = mammoth.images.imgElement(async (image) => {
    const bytes = await image.read();
    if (!bytes || bytes.length > MAX_IMAGE_BYTES || spent + bytes.length > MAX_IMAGE_TOTAL) {
      dropped += 1;
      // A picture that will not fit is said rather than left as a gap: a
      // document that reads oddly because a diagram is missing should say the
      // diagram is missing.
      return { src: '', 'data-dropped': '1', alt: image.altText || '' };
    }
    spent += bytes.length;
    carried += 1;
    return {
      src: `data:${image.contentType};base64,${bytes.toString('base64')}`,
      alt: image.altText || '',
    };
  });

  try {
    const result = await mammoth.convertToHtml({ buffer }, { convertImage });
    return {
      ok: true,
      html: result.value,
      images: carried,
      droppedImages: dropped,
      /*
       * Kept, and not shown.
       *
       * `mammoth` reports every style it did not recognise. On a real document
       * that is routinely forty lines about fonts and spacing, none of which
       * changes whether the file can be deleted. They are counted so a future
       * problem has somewhere to start, and left out of the window.
       */
      notes: result.messages.length,
    };
  } catch (err) {
    /*
     * The library says "are you sure this is a docx file?" for anything from a
     * rights-managed wrapper to a renamed PDF. That is one sentence for several
     * different situations, so the bytes are asked directly before reporting.
     */
    const isZip = buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;
    if (!isZip) return { ok: false, why: 'notAZip' };
    // It is an archive, and it is not a Word document. Which is a different
    // thing from a Word document that is damaged, and reads differently to
    // whoever is deciding what to do with it.
    return { ok: false, why: 'notADocument' };
  }
}

/**
 * List what is inside an archive.
 *
 * Folders are dropped and the members are left in the order the archive stores
 * them, which is the order they were added. Sorting by name would be tidier
 * and would lose the one piece of information the order carries.
 */
async function listArchive(filePath, size) {
  if (size > MAX_OFFICE_BYTES) return { ok: false, why: 'tooLarge' };

  let archive;
  try {
    archive = zip.open(await fsp.readFile(filePath));
  } catch (err) {
    return { ok: false, why: whyFrom(err) };
  }

  const files = archive.entries.filter((entry) => !entry.directory);
  const total = files.reduce((sum, entry) => sum + entry.size, 0);
  const packed = files.reduce((sum, entry) => sum + entry.compressedSize, 0);

  return {
    ok: true,
    count: files.length,
    total,
    packed,
    encrypted: files.some((entry) => entry.encrypted),
    entries: files.slice(0, MAX_LISTED).map((entry) => ({
      name: entry.name,
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      ext: path.posix.extname(entry.name).slice(1).toLowerCase(),
    })),
    truncated: files.length > MAX_LISTED,
  };
}

/*
 * Every failure here becomes one of a handful of reasons, because the window
 * says them in Vietnamese and a reason that cannot be translated is a reason
 * that will be shown in English. A stack trace is not an answer to "can I
 * delete this".
 */
function whyFrom(err) {
  switch (err && err.code) {
    case 'NOT_A_ZIP': return 'notAZip';
    case 'ZIP_ENCRYPTED': return 'encrypted';
    case 'ZIP_TRUNCATED': return 'damaged';
    case 'ZIP_TOO_BIG': return 'tooLarge';
    case 'ZIP_METHOD': return 'unsupported';
    case 'NOT_A_DOCX':
    case 'NOT_AN_XLSX':
    case 'NOT_A_PPTX': return 'notADocument';
    case 'ENOENT': return 'missing';
    case 'EBUSY': return 'busy';
    case 'EACCES':
    case 'EPERM': return 'unreadable';
    default: return 'damaged';
  }
}

module.exports = { readOffice, listArchive, MAX_OFFICE_BYTES, MAX_LISTED };
