'use strict';

/**
 * What the console remembers of each machine's journal seals (H3), kept in
 * the console's own folder and nowhere else.
 *
 * The one thing the console writes besides a CSV someone asked for. It is the
 * price of the decision taken on 2026-10-02: a copy of the seals off the
 * machine is the only way to notice the newest sessions removed, or a journal
 * rewritten and re-signed by the person whose account the task runs as -- and
 * the copy has to live somewhere the machine's user cannot write. The share is
 * not that place (every reporting machine can write it); the console's own
 * user folder is.
 *
 * A file that cannot be read is started again from nothing and said so in the
 * log: the cost is one round of reports with nothing to compare against, the
 * same as the first day.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');

const { renameRetrying } = require('../lib/atomic');
const { emptySeen } = require('./console-model');

class ConsoleMemory {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
  }

  async load() {
    try {
      const parsed = JSON.parse(await fsp.readFile(this.filePath, 'utf8'));
      if (parsed && parsed.version === 1 && parsed.shares && typeof parsed.shares === 'object') return parsed;
      console.warn('[console] the memory of seals was not in a form this version reads; starting again');
    } catch (err) {
      if (err && err.code !== 'ENOENT') console.warn('[console] the memory of seals could not be read; starting again:', err.message);
    }
    return emptySeen();
  }

  async save(seen) {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    await fsp.writeFile(temp, `${JSON.stringify(seen)}\n`, 'utf8');
    await renameRetrying(temp, this.filePath);
  }
}

module.exports = { ConsoleMemory };
