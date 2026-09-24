'use strict';

/**
 * The app's side of the elevated helper.
 *
 * `start()` opens a pipe with a random name, launches the helper with that
 * name and a one-time nonce, and waits for a client that can prove it was
 * given both. Only then are requests sent. It is called in answer to a click
 * and never otherwise: a UAC prompt the user did not ask for is exactly the
 * kind of thing this app does not do.
 *
 * Launching goes through `ShellExecute`'s `runas` verb (via PowerShell's
 * `Start-Process -Verb RunAs`), which is what raises the prompt. Declining it
 * is an answer, not an error: `start()` rejects with code `EDECLINED` and the
 * caller says the measurement needs administrator permission.
 */

const net = require('node:net');
const path = require('node:path');
const { execFile } = require('node:child_process');

const protocol = require('./protocol');

/** Long enough for a person to read a UAC prompt and decide. */
const CONNECT_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * One argument, quoted the way `CommandLineToArgvW` reads it back: wrapped in
 * quotes when it needs them, with backslashes doubled only where they precede
 * a quote.
 */
function quoteArg(arg) {
  const text = String(arg);
  if (text !== '' && !/[\s"]/.test(text)) return text;
  let out = '"';
  let backslashes = 0;
  for (const ch of text) {
    if (ch === '\\') {
      backslashes += 1;
      continue;
    }
    if (ch === '"') {
      out += '\\'.repeat(backslashes * 2 + 1) + '"';
    } else {
      out += '\\'.repeat(backslashes) + ch;
    }
    backslashes = 0;
  }
  return `${out}${'\\'.repeat(backslashes * 2)}"`;
}

/** A PowerShell single-quoted literal. */
const psLiteral = (text) => `'${String(text).replace(/'/g, "''")}'`;

/**
 * The PowerShell command that raises the prompt.
 *
 * `-ArgumentList` is given one pre-quoted string rather than an array, because
 * Windows PowerShell 5.1 joins an array with spaces and does not quote the
 * elements -- a path with a space in it arrives as two arguments.
 */
function elevationCommand(exe, args) {
  return `Start-Process -FilePath ${psLiteral(exe)} -ArgumentList ${psLiteral(args.map(quoteArg).join(' '))} -Verb RunAs -WindowStyle Hidden`;
}

/**
 * Launch through UAC. Resolves once Windows has started it, or rejects.
 *
 * PowerShell by absolute path: it is the process that asks Windows for the
 * prompt, and one found through PATH could put somebody else's program behind
 * a prompt the user thinks is this app's.
 */
function launchElevated(exe, args) {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    execFile(
      powershell,
      ['-NoProfile', '-NonInteractive', '-Command', elevationCommand(exe, args)],
      { windowsHide: true, timeout: CONNECT_TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (!err) return resolve();
        const text = `${stderr || ''} ${err.message || ''}`;
        // Start-Process words this "The operation was canceled by the user",
        // in the user's language -- so it is identified by the Win32 error
        // number PowerShell includes, ERROR_CANCELLED (1223).
        const declined = /1223|cancel/i.test(text);
        reject(Object.assign(new Error(declined ? 'The administrator prompt was declined' : text.trim()), {
          code: declined ? 'EDECLINED' : 'ELAUNCH',
        }));
      }
    );
  });
}

class HelperClient {
  /**
   * @param {object} options
   * @param {(pipeName: string, nonce: string) => Promise<void>} options.launch
   *   Starts the helper. The app passes one that goes through UAC; the harness
   *   one that spawns it directly, unelevated.
   * @param {number} [options.connectTimeoutMs]
   */
  constructor({ launch, connectTimeoutMs = CONNECT_TIMEOUT_MS } = {}) {
    if (typeof launch !== 'function') throw new Error('HelperClient needs a launch function');
    this.launch = launch;
    this.connectTimeoutMs = connectTimeoutMs;
    this.server = null;
    this.socket = null;
    this.pending = new Map();
    this.nextId = 1;
    this.rejected = 0;
  }

  get connected() {
    return Boolean(this.socket && !this.socket.destroyed);
  }

  async start() {
    if (this.connected) return this;

    const name = `cleandrive-helper-${protocol.randomHex(12)}`;
    const nonce = protocol.randomHex(32);

    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._closeServer();
        reject(Object.assign(new Error('The helper did not connect'), { code: 'ETIMEDOUT' }));
      }, this.connectTimeoutMs);

      this.server = net.createServer((socket) => {
        let checked = false;
        protocol.readLines(
          socket,
          (message) => {
            if (checked) return this._onMessage(message);
            checked = true;
            const ok =
              message && message.hello === 1 && typeof message.challenge === 'string' &&
              protocol.matches(protocol.proof(nonce, 'helper', message.challenge), message.proof);
            if (!ok) {
              // Whoever this is, it was not given the nonce. Drop it and keep
              // waiting for the helper that was.
              this.rejected += 1;
              socket.destroy();
              return;
            }
            protocol.send(socket, { proof: protocol.proof(nonce, 'app', message.challenge) });
            clearTimeout(timer);
            this.socket = socket;
            socket.on('close', () => this._onClose());
            // One helper per start. The pipe stops accepting the moment it has one.
            this._closeServer();
            resolve(this);
          },
          () => socket.destroy()
        );
        socket.on('error', () => {});
      });
      this.server.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      this.server.listen(protocol.pipePath(name), () => {
        this.launch(name, nonce).catch((err) => {
          clearTimeout(timer);
          this._closeServer();
          reject(err);
        });
      });
    });

    return ready;
  }

  /**
   * Ask for one operation from the fixed list.
   *
   * @returns {Promise<object>} the operation's data
   */
  request(op, args = {}, { timeoutMs = 60000 } = {}) {
    if (!this.connected) {
      return Promise.reject(Object.assign(new Error('The helper is not running'), { code: 'ENOHELPER' }));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error(`The helper did not answer ${op}`), { code: 'ETIMEDOUT' }));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      protocol.send(this.socket, { id, op, args });
    });
  }

  /** Closing the pipe is what tells the helper to leave. */
  stop() {
    this._closeServer();
    if (this.socket) this.socket.destroy();
    this.socket = null;
  }

  _onMessage(message) {
    const waiting = message && this.pending.get(message.id);
    if (!waiting) return;
    this.pending.delete(message.id);
    clearTimeout(waiting.timer);
    if (message.ok) waiting.resolve(message.data);
    else waiting.reject(Object.assign(new Error(message.error || 'The helper refused'), { code: 'EHELPER' }));
  }

  _onClose() {
    for (const [, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      waiting.reject(Object.assign(new Error('The helper exited'), { code: 'ENOHELPER' }));
    }
    this.pending.clear();
    this.socket = null;
  }

  _closeServer() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

/**
 * The launch the app uses: this same executable, through UAC.
 *
 * From a checkout the executable is Electron itself and the app's folder has to
 * be named first; an installed build is its own executable.
 */
function appLauncher({ execPath, appPath, isPackaged }) {
  return (name, nonce) =>
    launchElevated(execPath, [...(isPackaged ? [] : [appPath]), '--helper', '--pipe', name, '--nonce', nonce]);
}

module.exports = { HelperClient, appLauncher, launchElevated, elevationCommand, quoteArg, CONNECT_TIMEOUT_MS };
