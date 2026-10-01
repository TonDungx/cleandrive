'use strict';

/**
 * What `cleandrive` returns to whatever started it (H1).
 *
 * The spec named 0, 2, 3, 4 and 5. Two were added because a script needs to
 * tell them apart and none of the five says them: 6, a journal that checks out
 * as changed, and 64, a command line that names nothing this program can act
 * on (the conventional EX_USAGE). 1 is everything not foreseen.
 *
 * One code the program never returns although the spec listed it for
 * stopping: Ctrl+C. Measured on 2026-10-01 under Electron 33, on electron.exe
 * and on the packaged CleanDrive.exe alike, Ctrl+C ends the process at once
 * with Windows' own 0xC000013A, and no handler in it runs. So 5 means a run
 * that started acting and stopped short on its own -- a record that could
 * not be written -- and Ctrl+C is whatever Windows says it is.
 */
const EXIT = Object.freeze({
  OK: 0,
  ERROR: 1,
  /** Refused by a gate: a profile switched off, a disk below its threshold, a file in the way. */
  REFUSED: 2,
  /** The licence does not include it. Said in words; never done in part instead. */
  LICENCE: 3,
  /** Needs an elevated terminal. The command line never raises a UAC prompt itself. */
  ADMIN: 4,
  /** Started acting and stopped short. */
  STOPPED: 5,
  /** `journal verify` found a sealed session changed, removed or duplicated. */
  ALTERED: 6,
  /** The command line names nothing this program can act on. */
  USAGE: 64,
});

/**
 * Thrown by a command to stop with a particular code. The message is the
 * sentence the person reads on stderr; `extra` rides along in `--json`.
 */
class CliError extends Error {
  constructor(exit, message, extra = {}) {
    super(message);
    this.exit = exit;
    this.extra = extra;
  }
}

module.exports = { EXIT, CliError };
