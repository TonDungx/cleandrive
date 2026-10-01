'use strict';

/**
 * Everything the command line writes, in one place.
 *
 * Three rules, each from a measurement on this machine (2026-10-01):
 *
 * - **`--json` is ASCII.** The console here runs code page 437, and PowerShell
 *   decodes a program's output with it: UTF-8 `Ảnh của tôi` came back as
 *   `ß║ónh cß╗ºa t├┤i` through `ConvertFrom-Json`. Written as `Ả` it came
 *   back exactly, whatever the code page. So every character past 0x7E is
 *   escaped. JSON allows that for any character, and every parser reads it.
 * - **Words are English.** Decided for the same reason: Vietnamese on a 437
 *   console is unreadable, and the program cannot change the console's code
 *   page from inside -- measured, it had no effect. Paths are printed as they
 *   are, so a folder with Vietnamese in its name prints correctly in a console
 *   already set to UTF-8 (`chcp 65001`) and in any file it is redirected to.
 * - **Nothing is lost on the way out.** The process ends with `app.exit()`,
 *   which does not wait for anything, so `flush()` waits for every write to be
 *   handed over first. (Console and file writes here are synchronous anyway;
 *   a pipe's need not be.)
 *
 * stdout carries the answer -- one JSON document under `--json`, the readable
 * report otherwise. stderr carries everything said along the way: refusals,
 * warnings, progress. A script can read one without filtering the other.
 */

const NON_ASCII = /[\u007f-￿]/g;

/** JSON, with every character past 0x7E as a `\u` escape. */
function asciiJson(value) {
  return JSON.stringify(value, null, 2).replace(NON_ASCII, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

class Output {
  /**
   * @param {object} [options]
   * @param {NodeJS.WritableStream} [options.stdout]
   * @param {NodeJS.WritableStream} [options.stderr]
   * @param {boolean} [options.json]  the answer is one JSON document
   */
  constructor({ stdout = process.stdout, stderr = process.stderr, json = false } = {}) {
    this.stdout = stdout;
    this.stderr = stderr;
    this.json = json;
    this.pending = [];
    this.wroteJson = false;
  }

  _write(stream, text) {
    this.pending.push(
      new Promise((resolve) => {
        try {
          stream.write(text, () => resolve());
        } catch {
          // A closed pipe: the reader has gone, and there is nobody to tell.
          resolve();
        }
      })
    );
  }

  /** A line of the readable report. Not written under `--json`. */
  line(text = '') {
    if (!this.json) this._write(this.stdout, `${text}\n`);
  }

  /** Something said along the way, to stderr, in either mode. */
  note(text) {
    this._write(this.stderr, `${text}\n`);
  }

  /** The answer, under `--json`. Once per run. */
  document(value) {
    if (!this.json) return;
    if (this.wroteJson) throw new Error('cli: a second JSON document');
    this.wroteJson = true;
    this._write(this.stdout, `${asciiJson(value)}\n`);
  }

  async flush() {
    const waiting = this.pending;
    this.pending = [];
    await Promise.all(waiting);
  }
}

module.exports = { Output, asciiJson };
