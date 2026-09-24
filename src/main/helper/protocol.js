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
 */

const crypto = require('node:crypto');

/** A line longer than this is not a request from the app; the connection is closed. */
const MAX_LINE_BYTES = 1024 * 1024;

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
  if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
}

/** `\\.\pipe\cleandrive-helper-<random>` */
function pipePath(name) {
  return process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : `/tmp/${name}.sock`;
}

module.exports = { MAX_LINE_BYTES, proof, matches, randomHex, readLines, send, pipePath };
