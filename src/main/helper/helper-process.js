'use strict';

/**
 * The elevated helper: the same executable as the app, started with
 * `--helper --pipe <name> --nonce <hex>` through a UAC prompt the user
 * answered.
 *
 * It connects to the app's pipe, proves it was launched by the app, checks the
 * app can prove the same, and then answers requests from the fixed list in
 * `ops.js` until one of three things happens: the app closes the pipe, five
 * minutes pass with no request, or something arrives that is not a request
 * from the app. Each of those ends the process. It opens no window, keeps no
 * state and writes nothing.
 *
 * Deliberately free of Electron: the harness runs this file under plain Node,
 * without elevation, to test everything except the UAC prompt itself.
 */

const net = require('node:net');

const protocol = require('./protocol');
const ops = require('./ops');

const IDLE_MS = 5 * 60 * 1000;

/** Exit codes, so the app and the harness can tell the endings apart. */
const EXIT = Object.freeze({ ok: 0, usage: 2, connect: 3, auth: 4, protocol: 5 });

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : null;
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>} the exit code
 */
function runHelper(argv) {
  const name = argValue(argv, '--pipe');
  const nonce = argValue(argv, '--nonce');
  // For the harness: a short idle limit, so "it leaves when nobody asks" can be
  // watched in half a second instead of five minutes.
  const idleMs = Number(argValue(argv, '--idle-ms')) || IDLE_MS;

  if (!/^[a-z0-9-]{8,80}$/i.test(name || '') || !/^[0-9a-f]{64}$/i.test(nonce || '')) {
    return Promise.resolve(EXIT.usage);
  }

  return new Promise((resolve) => {
    let settled = false;
    let idle = null;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      socket.destroy();
      resolve(code);
    };
    const resetIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(() => finish(EXIT.ok), idleMs);
    };

    const challenge = protocol.randomHex(16);
    let trusted = false;

    const socket = net.connect(protocol.pipePath(name));
    socket.on('error', () => finish(trusted ? EXIT.ok : EXIT.connect));
    socket.on('close', () => finish(EXIT.ok));

    socket.on('connect', () => {
      protocol.send(socket, { hello: 1, challenge, proof: protocol.proof(nonce, 'helper', challenge) });
      // The app has to answer the handshake promptly; a pipe that accepts and
      // then says nothing is not the app.
      idle = setTimeout(() => finish(EXIT.auth), 10000);
    });

    protocol.readLines(
      socket,
      async (message) => {
        if (!trusted) {
          if (!protocol.matches(protocol.proof(nonce, 'app', challenge), message && message.proof)) {
            finish(EXIT.auth);
            return;
          }
          trusted = true;
          resetIdle();
          return;
        }

        if (!message || typeof message.id !== 'number') {
          finish(EXIT.protocol);
          return;
        }
        resetIdle();

        if (!ops.has(message.op)) {
          protocol.send(socket, { id: message.id, ok: false, error: `unknown op ${String(message.op).slice(0, 60)}` });
          return;
        }
        try {
          const data = await ops.OPS[message.op](message.args || {});
          protocol.send(socket, { id: message.id, ok: true, data });
        } catch (err) {
          protocol.send(socket, { id: message.id, ok: false, error: err && err.message ? err.message : String(err) });
        }
      },
      // Anything malformed means the other end is not the app this was built
      // to talk to. Leaving is the safe answer.
      () => finish(EXIT.protocol)
    );
  });
}

// Run directly by the harness: `node helper-process.js --pipe … --nonce …`.
if (require.main === module) {
  runHelper(process.argv).then((code) => process.exit(code));
}

module.exports = { runHelper, EXIT, IDLE_MS };
