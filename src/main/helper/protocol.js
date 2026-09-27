'use strict';

/**
 * The wire between the app and its elevated helper.
 *
 * One JSON object per line over a named pipe. The app is the server and the
 * helper the client, for a reason that is not obvious: a pipe created by an
 * elevated process carries a High integrity label, and a normal process cannot
 * write up to it. Created by the app, the pipe is at the app's level and the
 * elevated helper -- which may write down -- connects to it.
 *
 * ## Who is on the other end
 *
 * The app launches the helper with a pipe name and a one-time nonce, both
 * random. Before a single operation is served, each side proves it knows the
 * nonce without ever sending it:
 *
 *   helper -> { hello: 1, challenge, proof: HMAC(nonce, 'helper:' + challenge) }
 *   app    -> { proof: HMAC(nonce, 'app:' + challenge) }
 *
 * A process that connects to the pipe first cannot produce the helper's proof,
 * and is dropped. A process that squats the pipe name before the app creates
 * it cannot produce the app's proof, and the helper leaves without answering
 * anything. Nothing on the pipe is worth replaying: the challenge is fresh.
 *
 * ## Answers that do not fit in one line
 *
 * Every operation used to be one request and one reply, and that was right
 * while the biggest reply was a few thousand folder sums. Reading `$MFT` (A2)
 * is not that: the app needs every record, because the filters that throw
 * most of them away live in the walk, in this process, not in the elevated
 * one. Measured on this machine's C:, 1,198,835 files and 568,757 folders --
 * 134.6 MB of JSON in 298 pieces, against a line limit of one.
 *
 * So an operation may also send pieces as it goes:
 *
 *   helper -> { id, chunk: <anything> }   as often as it likes
 *   helper -> { id, ok: true, data }      exactly once, at the end
 *
 * The app hands each piece to the caller's `onChunk` and keeps waiting. The
 * timeout is reset by every piece, so a long read is bounded by *silence*
 * rather than by how much there is to send -- which is what a fixed timeout
 * on a whole-volume read would have had to guess at.
 */

const crypto = require('node:crypto');

/** A line longer than this is not a request from the app; the connection is closed. */
const MAX_LINE_BYTES = 1024 * 1024;

/**
 * How big a piece an operation should build before sending it.
 *
 * Half the line limit, so that a batch of records with unusually long names
 * still has room: the sender counts the bytes it knows about (the names) and
 * cannot know exactly what JSON will add. Measured against the real tables on
 * this machine, the widest piece came to 542 KB on C: and 518 KB on D:, and
 * 4,000 records of the longest name NTFS allows come to 438 KB -- all of them
 * well inside the limit.
 */
const MAX_CHUNK_BYTES = 512 * 1024;

function proof(nonce, role, challenge) {
  return crypto.createHmac('sha256', Buffer.from(nonce, 'hex')).update(`${role}:${challenge}`).digest('hex');
}

function matches(expected, got) {
  if (typeof got !== 'string' || got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(got, 'utf8'));
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Split a socket's bytes into JSON messages.
 *
 * @param {import('net').Socket} socket
 * @param {(message: object) => void} onMessage
 * @param {(reason: string) => void} onBad   a line too long or not JSON
 */
function readLines(socket, onMessage, onBad) {
  let buffered = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffered += chunk;
    if (Buffer.byteLength(buffered, 'utf8') > MAX_LINE_BYTES && !buffered.includes('\n')) {
      onBad('line too long');
      buffered = '';
      return;
    }
    let newline;
    while ((newline = buffered.indexOf('\n')) !== -1) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (line.trim() === '') continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        onBad('not JSON');
        continue;
      }
      onMessage(message);
    }
  });
}

function send(socket, message) {
  if (socket.destroyed) return true;
  return socket.write(`${JSON.stringify(message)}\n`);
}

/**
 * Send, and wait if the pipe is full.
 *
 * Without this a million records go into the socket's buffer as fast as they
 * can be built, and the elevated process holds the whole reply in memory on
 * top of the table it built the reply from. `write` says false when it has
 * taken more than it wants; `drain` says it is ready for more.
 */
function sendBackpressured(socket, message) {
  if (send(socket, message)) return Promise.resolve();
  return new Promise((resolve) => {
    // `close` and `error` as well as `drain`: a pipe the app has hung up on
    // will never drain, and waiting for it to would leave the operation --
    // and the process running it -- stuck until the idle timer fires.
    const done = () => {
      socket.off('drain', done);
      socket.off('close', done);
      socket.off('error', done);
      resolve();
    };
    socket.once('drain', done);
    socket.once('close', done);
    socket.once('error', done);
  });
}

/** `\\.\pipe\cleandrive-helper-<random>` */
function pipePath(name) {
  return process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : `/tmp/${name}.sock`;
}

module.exports = {
  MAX_LINE_BYTES,
  MAX_CHUNK_BYTES,
  proof,
  matches,
  randomHex,
  readLines,
  send,
  sendBackpressured,
  pipePath,
};
