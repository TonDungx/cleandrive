'use strict';

/**
 * Private mode for an exported report (G2).
 *
 * A report is made to be sent to somebody -- a relative, a repair shop -- and
 * the paths in it are a list of what is on the disk and what its owner is
 * called. So there is a switch that replaces them, and the spec turns it on by
 * default whenever the report carries file names.
 *
 * ## It has to reach the embedded data too
 *
 * The spec asks for two things in the same file: paths replaced by generic
 * names, *and* the underlying data embedded as JSON so it can be taken back
 * out. Read literally those cancel out -- a reader who opens the JSON has the
 * paths again, and private mode is a label rather than a fact. So the
 * redaction happens to the data *before* anything is rendered, and the JSON in
 * the page is the redacted data. There is no second copy.
 *
 * ## Pseudonyms are stable, so the report still says something
 *
 * Replacing every path with "hidden" would make the report unreadable: half of
 * what it says is that one folder is large *and* growing *and* holds the
 * duplicates. So a folder keeps one name throughout -- `Folder 3` is the same
 * folder in the chart, the table and the history -- and the drive letter is
 * kept, because "the drive is 90% full" is the whole point and a letter names
 * nobody. Where a path is inside another that already has a pseudonym, the
 * shape is kept too: `Folder 3\Subfolder 1`.
 *
 * The map from real path to pseudonym is never written into the report.
 */

const path = require('node:path');

/** Windows compares paths without case; so does this. */
const keyOf = (p) => String(p).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();

class Pseudonyms {
  constructor({ folderWord = 'Folder', fileWord = 'File', driveWord = 'Drive' } = {}) {
    this.words = { folderWord, fileWord, driveWord };
    this.byKey = new Map();
    this.counts = { folder: 0, file: 0 };
  }

  /**
   * A drive root is kept as it is.
   *
   * `C:\` names no person and is most of what makes a report legible -- which
   * drive is full, which drive the copies are on. A UNC share is a different
   * matter: `\\NAS\family-photos` is a name somebody chose, so it is replaced.
   */
  drive(root) {
    const text = String(root || '');
    if (/^[A-Za-z]:[\\/]?$/.test(text)) return `${text[0].toUpperCase()}:\\`;
    if (text === '') return '';
    const key = keyOf(text);
    if (!this.byKey.has(key)) {
      this.counts.folder += 1;
      this.byKey.set(key, `${this.words.driveWord} ${this.counts.folder}`);
    }
    return this.byKey.get(key);
  }

  /**
   * A folder, as a pseudonym that keeps its place in the tree.
   *
   * The parent is named first, so a folder under one that has already been
   * seen reads as a child of it rather than as an unrelated number.
   */
  folder(full) {
    const text = String(full || '');
    if (text === '') return '';
    const key = keyOf(text);
    const had = this.byKey.get(key);
    if (had) return had;

    const parsed = path.parse(text);
    // A drive root, or something with no parent left to climb to.
    if (!parsed.dir || parsed.dir === text || parsed.base === '') return this.drive(text);

    const parent = this.folder(parsed.dir);
    this.counts.folder += 1;
    const name = `${this.words.folderWord} ${this.counts.folder}`;
    const out = parent.endsWith('\\') ? `${parent}${name}` : `${parent}\\${name}`;
    this.byKey.set(key, out);
    return out;
  }

  /**
   * A file. Its folder keeps its pseudonym and its extension is kept.
   *
   * The extension stays because it carries the only thing about a file worth
   * reporting -- that 40 GB of this folder is `.mkv` -- and because it names
   * nobody. `tax-return-2024.pdf` becomes `Folder 3\File 7.pdf`.
   */
  file(full) {
    const text = String(full || '');
    if (text === '') return '';
    const key = keyOf(text);
    const had = this.byKey.get(key);
    if (had) return had;

    const parsed = path.parse(text);
    const folder = parsed.dir ? this.folder(parsed.dir) : '';
    this.counts.file += 1;
    const ext = parsed.ext ? parsed.ext.toLowerCase() : '';
    const name = `${this.words.fileWord} ${this.counts.file}${ext}`;
    const out = folder ? (folder.endsWith('\\') ? `${folder}${name}` : `${folder}\\${name}`) : name;
    this.byKey.set(key, out);
    return out;
  }
}

/**
 * The report's data, with every path replaced.
 *
 * Walks the collected data rather than the rendered page, so nothing can be
 * rendered from an un-redacted value: `html.js` never sees the real paths at
 * all when this has run.
 *
 * @param {object} data   from `report/collect.js`
 * @param {object} [words]  the pseudonym words, in the reader's language
 * @returns {object} a new object; the input is not modified
 */
function redact(data, words = {}) {
  const names = new Pseudonyms(words);
  const folder = (p) => names.folder(p);
  const file = (p) => names.file(p);

  const volumes = (data.volumes || []).map((v) => ({ ...v, root: names.drive(v.root), label: v.label ? names.drive(v.root) : v.label }));

  return {
    ...data,
    private: true,
    // The computer's name goes too. It is not a path, so the spec does not
    // name it, but "DUNG-PC" identifies somebody exactly as well as a folder
    // under their profile does -- and the whole point of this mode is a file
    // that can be sent on.
    machine: null,
    volumes,
    system: data.system
      ? {
          ...data.system,
          drive: names.drive(data.system.drive),
          rows: (data.system.rows || []).map((r) => ({ ...r, path: r.path ? folder(r.path) : r.path })),
        }
      : null,
    folders: (data.folders || []).map((f) => ({ ...f, root: folder(f.root) })),
    trends: data.trends
      ? {
          ...data.trends,
          volume: names.drive(data.trends.volume),
          volumes: (data.trends.volumes || []).map((v) => names.drive(v)),
          folders: (data.trends.folders || []).map((f) => ({ ...f, root: folder(f.root) })),
        }
      : null,
    diff: data.diff
      ? {
          ...data.diff,
          root: folder(data.diff.root),
          places: (data.diff.places || []).map((p) => ({ ...p, path: folder(p.path) })),
          files: (data.diff.files || []).map((f) => ({ ...f, path: file(f.path) })),
        }
      : null,
    actions: data.actions
      ? {
          ...data.actions,
          sessions: (data.actions.sessions || []).map((s) => ({
            ...s,
            items: (s.items || []).map((i) => ({ ...i, path: file(i.path), to: i.to ? file(i.to) : i.to })),
          })),
        }
      : null,
  };
}

module.exports = { redact, Pseudonyms, keyOf };
