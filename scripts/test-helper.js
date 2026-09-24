#!/usr/bin/env node
'use strict';

// The elevated helper, without the elevation.
//   node scripts/test-helper.js
//
// Everything is real -- the named pipe, the handshake, the process, the idle
// exit -- except the UAC prompt, which needs a person. The helper is spawned
// directly under this Node, unelevated, through the same client the app uses.
// `electron scripts/verify-helper.js` is the version with the prompt.

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { HelperClient, elevationCommand, quoteArg } = require('../src/main/helper/client');
const { EXIT } = require('../src/main/helper/helper-process');
const protocol = require('../src/main/helper/protocol');
const { OPS } = require('../src/main/helper/ops');

const HELPER = path.join(__dirname, '..', 'src', 'main', 'helper', 'helper-process.js');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

/** A launcher that spawns the helper unelevated and remembers how it ended. */
function directLauncher(extra = [], { nonceOverride } = {}) {
  const launched = { child: null, exit: null };
  launched.exited = new Promise((resolve) => {
    launched.launch = async (name, nonce) => {
      launched.child = spawn(process.execPath, [HELPER, '--pipe', name, '--nonce', nonceOverride || nonce, ...extra], {
        stdio: 'ignore',
      });
      launched.child.on('exit', (code) => {
        launched.exit = code;
        resolve(code);
      });
    };
  });
  return launched;
}

const withTimeout = (promise, ms, label) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out: ${label}`)), ms))]);

(async () => {
  console.log('\nhelper: the handshake and one request\n');

  {
    const launched = directLauncher();
    const client = new HelperClient({ launch: launched.launch, connectTimeoutMs: 10000 });
    await client.start();
    check('the helper connects and proves it was launched by the app', client.connected);

    const ping = await client.request('ping');
    check('it answers from the fixed list', ping && ping.pid === launched.child.pid, JSON.stringify(ping));
    check('and says honestly whether it is elevated', typeof ping.elevated === 'boolean' && ping.integrity !== 'unknown',
      `${ping.integrity}${ping.elevated ? ' (this shell is elevated)' : ''}`);

    let refused = null;
    try {
      await client.request('shell.exec', { command: 'del /s C:\\' });
    } catch (err) {
      refused = err;
    }
    check('anything not on the list is refused by name', refused && /unknown op shell\.exec/.test(refused.message),
      refused && refused.message);
    check('and the helper is still there afterwards', (await client.request('ping')).pid === launched.child.pid);

    client.stop();
    const code = await withTimeout(launched.exited, 5000, 'exit after stop');
    check('closing the pipe ends the helper', code === EXIT.ok, `exit ${code}`);
  }

  console.log('\nhelper: leaving when nobody asks\n');

  {
    const launched = directLauncher(['--idle-ms', '400']);
    const client = new HelperClient({ launch: launched.launch, connectTimeoutMs: 10000 });
    await client.start();
    const started = Date.now();
    const code = await withTimeout(launched.exited, 5000, 'idle exit');
    check('an idle helper exits by itself', code === EXIT.ok && Date.now() - started >= 350, `exit ${code} after ${Date.now() - started} ms`);
    let gone = null;
    try {
      await client.request('ping');
    } catch (err) {
      gone = err;
    }
    check('and the app sees it has gone', gone && gone.code === 'ENOHELPER');
  }

  console.log('\nhelper: somebody else on the pipe\n');

  {
    // A helper launched with the wrong nonce -- or anything else that found the
    // pipe -- cannot prove itself.
    const launched = directLauncher([], { nonceOverride: 'ab'.repeat(32) });
    const client = new HelperClient({ launch: launched.launch, connectTimeoutMs: 1500 });
    let failed = null;
    try {
      await client.start();
    } catch (err) {
      failed = err;
    }
    check('a client without the nonce is never accepted', failed && failed.code === 'ETIMEDOUT' && client.rejected >= 1,
      `${failed && failed.code}, ${client.rejected} rejected`);
    const code = await withTimeout(launched.exited, 12000, 'impostor exit');
    check('and it is not served', code === EXIT.connect || code === EXIT.auth || code === EXIT.ok, `exit ${code}`);
  }

  {
    // An impostor connects before the real helper does.
    let pipeName = null;
    const launched = directLauncher();
    const client = new HelperClient({
      connectTimeoutMs: 10000,
      launch: async (name, nonce) => {
        pipeName = name;
        await new Promise((resolve) => {
          const impostor = net.connect(protocol.pipePath(name), () => {
            protocol.send(impostor, { hello: 1, challenge: 'x', proof: 'not a proof' });
            setTimeout(resolve, 100);
          });
          impostor.on('error', () => resolve());
        });
        await launched.launch(name, nonce);
      },
    });
    await client.start();
    check('an impostor that gets there first is dropped, and the helper still gets through',
      client.connected && client.rejected === 1, `${client.rejected} rejected`);
    let late = null;
    await new Promise((resolve) => {
      const second = net.connect(protocol.pipePath(pipeName));
      second.on('connect', () => { late = 'connected'; second.destroy(); resolve(); });
      second.on('error', (err) => { late = err.code; resolve(); });
    });
    check('once the helper is in, the pipe accepts nobody else', late !== 'connected', String(late));
    client.stop();
    await withTimeout(launched.exited, 5000, 'exit');
  }

  {
    // The other direction: something squats a pipe name and waits for a helper.
    const name = `cleandrive-helper-${protocol.randomHex(12)}`;
    const nonce = protocol.randomHex(32);
    const answered = [];
    const squatter = net.createServer((socket) => {
      protocol.readLines(socket, (message) => {
        answered.push(message);
        protocol.send(socket, { proof: 'I am the app, honestly' });
        setTimeout(() => protocol.send(socket, { id: 1, op: 'ping' }), 50);
      }, () => {});
      socket.on('error', () => {});
    });
    await new Promise((resolve) => squatter.listen(protocol.pipePath(name), resolve));
    const child = spawn(process.execPath, [HELPER, '--pipe', name, '--nonce', nonce], { stdio: 'ignore' });
    const code = await withTimeout(new Promise((resolve) => child.on('exit', resolve)), 12000, 'squatter');
    squatter.close();
    check('a helper facing a server that cannot prove itself leaves without answering', code === EXIT.auth, `exit ${code}`);
    check('and never sent the nonce', answered.length === 1 && !JSON.stringify(answered).includes(nonce));
  }

  {
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [HELPER, '--pipe', 'x', '--nonce', 'nope'], { stdio: 'ignore' });
      child.on('exit', resolve);
    });
    check('a helper started with nonsense arguments refuses to start', code === EXIT.usage, `exit ${code}`);
  }

  console.log('\nhelper: what it is allowed to do\n');

  {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'helper', 'ops.js'), 'utf8');
    const writes = source.match(/\b(writeFile|appendFile|rm|rmdir|unlink|rename|copyFile|mkdir|truncate|spawn|exec)\s*\(/g) || [];
    check('ops.js calls nothing that writes, deletes or runs a command it was given', writes.length === 0, writes.join(', '));
    check('its one child process is whoami, from System32 by absolute path, with fixed arguments',
      /execFile\(system32\('whoami\.exe'\), \['\/groups', '\/fo', 'csv', '\/nh'\]/.test(source) &&
        !/execFile\('/.test(source));
    check('the list is what this phase ships', JSON.stringify(Object.keys(OPS)) === '["ping"]', Object.keys(OPS).join(', '));
  }

  console.log('\nhelper: the UAC launch, as a command\n');

  {
    check('an argument with a space is quoted', quoteArg('C:\\Program Files\\CleanDrive\\CleanDrive.exe') === '"C:\\Program Files\\CleanDrive\\CleanDrive.exe"');
    check('a plain one is not', quoteArg('--helper') === '--helper');
    check('a trailing backslash inside quotes is doubled', quoteArg('C:\\My Apps\\') === '"C:\\My Apps\\\\"');
    check('an embedded quote is escaped', quoteArg('a"b c') === '"a\\"b c"');
    const cmd = elevationCommand("C:\\Users\\O'Neil\\electron.exe", ['D:\\my app', '--helper']);
    check('the PowerShell literal survives an apostrophe, and asks for RunAs',
      cmd.includes("'C:\\Users\\O''Neil\\electron.exe'") && cmd.includes(`'"D:\\my app" --helper'`) && /-Verb RunAs/.test(cmd), cmd);
  }

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
