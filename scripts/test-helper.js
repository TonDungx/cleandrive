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
const os = require('node:os');
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
    // Everything that runs elevated: ops.js, the walk it measures folders
    // with, and -- since A2 -- the `$MFT` reader. That last one is a byte
    // parser inside the administrator process, which is the opposite of what
    // `prefetch.list` refused to do, so the header of ops.js says why it is
    // there and these checks hold it to the same rules as the rest.
    const elevatedFiles = [
      'src/main/helper/ops.js',
      'src/main/system/walk.js',
      'src/main/lib/real-fs.js',
      'src/main/system/mft.js',
      'src/main/system/ntfs.js',
    ];
    const sources = Object.fromEntries(elevatedFiles.map((rel) => [rel, fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')]));
    // Comments stripped first: they talk about links and renames, and a check
    // that reads prose as calls cries wolf until somebody stops listening.
    const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const writes = Object.entries(sources).flatMap(([rel, src]) => [
      ...(code(src).match(/\.(writeFile|appendFile|rm|rmdir|unlink|rename|copyFile|mkdir|truncate|symlink|link|chmod|utimes|createWriteStream)\s*\(/g) || []),
      ...(code(src).match(/\b(spawn|exec|execSync|execFileSync)\s*\(/g) || []),
    ].map((w) => `${rel}: ${w}`));
    check('nothing that runs elevated writes, deletes or runs a command it was given', writes.length === 0,
      writes.join(', '));

    // `open` used to be on that list outright, and could not stay there: the
    // `$MFT` reader opens the raw volume, which is the one thing it does.
    // Banning the call would have meant banning the feature, so what is
    // checked now is the flag -- every open in elevated code asks for 'r',
    // and an open without a flag argument at all defaults to 'r+'.
    const opens = Object.entries(sources).flatMap(([rel, src]) =>
      [...code(src).matchAll(/\.open\(([^)]*)\)/g)].map((m) => `${rel}: open(${m[1].trim()})`)
    );
    check('and every file it opens, it opens read-only',
      opens.every((o) => /,\s*'r'\s*\)$/.test(o)),
      opens.length ? opens.join(' | ') : 'it opens no file at all');

    const source = sources['src/main/helper/ops.js'];
    const requires = [...source.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
    const allowed = new Set(['../system/walk', '../system/mft', '../system/mft-wire', './protocol']);
    check('and it loads nothing else of the app\'s', requires.every((r) => r.startsWith('node:') || allowed.has(r)),
      requires.join(', '));

    const calls = source.match(/execFile\(/g) || [];
    check('its child processes are started in exactly two places, each by System32 path',
      calls.length === 2 && /execFile\(system32\('whoami\.exe'\), \['\/groups', '\/fo', 'csv', '\/nh'\]/.test(source) &&
        /execFile\(\s*system32\(tool\.exe\),\s*tool\.args\(\)/.test(source) && !/execFile\('/.test(source));

    const { TOOLS, systemDrive } = require('../src/main/helper/ops');
    const drive = systemDrive();
    const expected = {
      shadowstorage: ['vssadmin.exe', ['list', 'shadowstorage']],
      dism: ['Dism.exe', ['/Online', '/Cleanup-Image', '/AnalyzeComponentStore', '/English']],
      ntfsinfo: ['fsutil.exe', ['fsinfo', 'ntfsinfo', drive]],
      storagereserve: ['fsutil.exe', ['storagereserve', 'query', drive]],
    };
    const table = Object.fromEntries(Object.entries(TOOLS).map(([k, t]) => [k, [t.exe, t.args()]]));
    check('the tools and every argument they get are the fixed table, and only read',
      JSON.stringify(table) === JSON.stringify(expected), JSON.stringify(table));
    check('the drive letter comes from the environment and is a drive letter', /^[A-Z]:$/.test(drive), drive);

    check('the list is what this phase ships',
      JSON.stringify(Object.keys(OPS)) === JSON.stringify(['ping', 'system.breakdown', 'prefetch.list', 'shadowstorage.query', 'dism.analyze', 'ntfs.info', 'storagereserve.query', 'mft.scan']),
      Object.keys(OPS).join(', '));

    // `mft.scan` (A2) takes one drive letter and builds the device path from
    // it here. There is no path in the request, so there is nothing in one to
    // point at another volume or at a file.
    const mftOp = source.slice(source.indexOf("'mft.scan'"));
    check('the catalogue read takes a drive letter and checks it is one',
      /\/\^\[A-Za-z\]\$\/\.test\(letter\)/.test(mftOp), mftOp.split('\n').slice(0, 6).join(' ').slice(0, 120));
    let refused = null;
    try {
      await OPS['mft.scan']({ drive: '..\\\\..\\\\Windows' }, () => {});
    } catch (err) {
      refused = err.message;
    }
    check('and refuses anything that is not one', refused === 'not a drive letter', String(refused));
    for (const bad of ['', 'CD', '1', '\\\\?\\C:', null]) {
      let why = null;
      try {
        await OPS['mft.scan']({ drive: bad }, () => {});
      } catch (err) {
        why = err.message;
      }
      check(`  ${JSON.stringify(bad)} is refused`, why === 'not a drive letter', String(why));
    }

    // `prefetch.list` (D1) lists one fixed folder. It takes no arguments at
    // all, which is what keeps it from being pointed anywhere else, and it
    // opens none of the files it lists.
    const listing = source.slice(source.indexOf("'prefetch.list'"), source.indexOf("'shadowstorage.query'"));
    check('the prefetch listing takes no arguments, so nothing in a request can move it',
      /^'prefetch\.list'\(\)/.test(listing), listing.split('\n')[0]);
    check('it names its folder from the environment, never from a request',
      /process\.env\.SystemRoot/.test(listing) && /'Prefetch'/.test(listing));
    check('and it reads no file it lists', !/readFile|createReadStream|\.open\(/.test(listing));

    const reply = await OPS['prefetch.list']();
    // Unelevated this is refused, which is the whole reason the op exists.
    check('unelevated it says it could not read the folder rather than guessing',
      reply.available === false ? reply.reason === 'EPERM' || reply.reason === 'EACCES' || reply.reason === 'ENOENT'
        : Array.isArray(reply.files),
      reply.available ? `${reply.files.length} files` : String(reply.reason));
    if (reply.available) {
      check('and what it hands back is names and times, never contents',
        reply.files.every((f) => Object.keys(f).join(',') === 'name,mtimeMs,size'),
        JSON.stringify(reply.files[0] || {}));
    }
  }

  console.log('\nhelper: an answer too big for one line\n');

  {
    // `$MFT` is 112 MB of records on this machine's C:, against a line limit
    // of one, so an operation may send pieces as it goes (protocol.js). What
    // is checked here is the app's side of that, against a peer that speaks
    // the real protocol over a real pipe: the elevated half needs a volume
    // handle and so belongs to `npm run verify:mft`.
    const peer = {
      chunks: 40,
      gapMs: 0,
      seen: [],
      launch: null,
    };
    peer.launch = async (name, nonce) => {
      const socket = net.connect(protocol.pipePath(name));
      const challenge = protocol.randomHex(16);
      socket.on('connect', () => {
        protocol.send(socket, { hello: 1, challenge, proof: protocol.proof(nonce, 'helper', challenge) });
      });
      socket.on('error', () => {});
      let trusted = false;
      protocol.readLines(socket, async (message) => {
        if (!trusted) {
          trusted = true;
          return;
        }
        for (let i = 0; i < peer.chunks; i++) {
          await protocol.sendBackpressured(socket, { id: message.id, chunk: { kind: 'files', from: i, count: 1 } });
          if (peer.gapMs) await new Promise((r) => setTimeout(r, peer.gapMs));
        }
        protocol.send(socket, { id: message.id, ok: true, data: { sent: peer.chunks } });
      }, () => socket.destroy());
      peer.socket = socket;
    };

    const client = new HelperClient({ launch: peer.launch, connectTimeoutMs: 8000 });
    await withTimeout(client.start(), 8000, 'chunked peer');

    const got = [];
    const data = await withTimeout(
      client.request('anything', {}, { timeoutMs: 8000, onChunk: (c) => got.push(c) }),
      12000,
      'chunked request'
    );
    check('every piece arrives, in order, before the reply', got.length === peer.chunks && got.every((c, i) => c.from === i),
      `${got.length} of ${peer.chunks}`);
    check('and the reply is what resolves the request', data && data.sent === peer.chunks, JSON.stringify(data));

    // The point of resetting per piece: a read that takes longer than the
    // timeout is fine as long as it keeps saying something. 12 pieces 120 ms
    // apart is 1.4 s of work under a 400 ms limit.
    peer.chunks = 12;
    peer.gapMs = 120;
    const slow = [];
    let slowError = null;
    try {
      await withTimeout(client.request('anything', {}, { timeoutMs: 400, onChunk: (c) => slow.push(c) }), 12000, 'slow');
    } catch (err) {
      slowError = err.code || err.message;
    }
    check('a long answer does not time out while pieces keep coming',
      slowError === null && slow.length === 12,
      slowError ? String(slowError) : `${slow.length} pieces over ~1.4 s under a 400 ms limit`);

    // And silence still does.
    peer.chunks = 0;
    peer.gapMs = 0;
    const quiet = new HelperClient({
      launch: async (name, nonce) => {
        const socket = net.connect(protocol.pipePath(name));
        const challenge = protocol.randomHex(16);
        socket.on('connect', () => protocol.send(socket, { hello: 1, challenge, proof: protocol.proof(nonce, 'helper', challenge) }));
        socket.on('error', () => {});
        // Answers the handshake and then says nothing at all.
        protocol.readLines(socket, () => {}, () => socket.destroy());
        quiet.socket2 = socket;
      },
      connectTimeoutMs: 8000,
    });
    await withTimeout(quiet.start(), 8000, 'quiet peer');
    let quietError = null;
    try {
      await withTimeout(quiet.request('anything', {}, { timeoutMs: 300 }), 5000, 'quiet');
    } catch (err) {
      quietError = err.code;
    }
    check('silence still times out', quietError === 'ETIMEDOUT', String(quietError));
    quiet.stop();
    if (quiet.socket2) quiet.socket2.destroy();

    // A handler that cannot use what it was given stops the request rather
    // than letting the rest of a million records arrive into it.
    peer.chunks = 200;
    let thrown = null;
    try {
      await withTimeout(client.request('anything', {}, {
        timeoutMs: 8000,
        onChunk: (c) => {
          if (c.from === 3) throw new Error('out of memory, say');
        },
      }), 12000, 'throwing handler');
    } catch (err) {
      thrown = err.message;
    }
    check('a handler that throws ends the request instead of being called again',
      thrown === 'out of memory, say', String(thrown));

    client.stop();
    if (peer.socket) peer.socket.destroy();
  }

  {
    // The helper's side of the same thing, as far as it can be seen without a
    // volume handle: the op is handed something to send pieces with, and that
    // something waits for the pipe rather than filling memory with an answer
    // the app has not read yet.
    const source = fs.readFileSync(HELPER, 'utf8');
    check('the helper hands every operation a way to send pieces',
      /ops\.OPS\[message\.op\]\(message\.args \|\| \{\}, emit\)/.test(source));
    check('and each piece resets the app’s timeout and waits for the pipe',
      /const emit = \(chunk\) => \{[\s\S]*resetIdle\(\);[\s\S]*sendBackpressured\(socket, \{ id: message\.id, chunk \}\)/.test(source));

    // A piece is cut by bytes rather than by record count, so that a volume
    // full of long names cannot build a line the reader will refuse. Checked
    // by building one: 4,000 files whose names are the longest NTFS allows.
    const wire = require('../src/main/system/mft-wire');
    const long = 'w'.repeat(255);
    const fat = new wire.Columns(8192);
    for (let i = 0; i < 4000; i++) {
      fat.append({ count: 1, name: [long], parent: [5], size: [1], allocated: [4096], modified: [0], accessed: [0], created: [0], attributes: [32], reparse: [0] });
    }
    const pieces = [...wire.chunksOf(new Map(), fat, { maxBytes: protocol.MAX_CHUNK_BYTES, maxRecords: 8192 })];
    const widest = Math.max(...pieces.map((c) => Buffer.byteLength(JSON.stringify({ id: 1, chunk: c }), 'utf8')));
    check('a piece is cut by bytes, so the longest names Windows allows still fit in a line',
      pieces.length > 1 && widest < protocol.MAX_LINE_BYTES,
      `${pieces.length} pieces, widest ${(widest / 1024).toFixed(0)} KB, line limit ${(protocol.MAX_LINE_BYTES / 1024).toFixed(0)} KB`);
    check('and the budget itself leaves room under that limit',
      protocol.MAX_CHUNK_BYTES < protocol.MAX_LINE_BYTES,
      `${(protocol.MAX_CHUNK_BYTES / 1024).toFixed(0)} KB of ${(protocol.MAX_LINE_BYTES / 1024).toFixed(0)} KB`);
  }

  console.log('\nhelper: which folders it will measure\n');

  {
    const { acceptableDir, MAX_DIRS, systemDrive } = require('../src/main/helper/ops');
    const d = systemDrive();
    check('a normal folder on the system drive', acceptableDir(`${d}\\Windows\\System32`));
    check('not one that climbs out with ..', !acceptableDir(`${d}\\Windows\\..\\Users`));
    check('not another drive', !acceptableDir(`${d === 'Z:' ? 'Y:' : 'Z:'}\\Data`));
    check('not a relative path, nor a pattern', !acceptableDir('Windows') && !acceptableDir(`${d}\\Win*`));
    let refused = null;
    try {
      await OPS['system.breakdown']({ dirs: [`${d === 'Z:' ? 'Y:' : 'Z:'}\\Data`] });
    } catch (err) {
      refused = err.message;
    }
    check('asked for one anyway, it refuses the whole request', refused !== null, refused);
    let tooMany = null;
    try {
      await OPS['system.breakdown']({ dirs: new Array(MAX_DIRS + 1).fill(`${d}\\Windows`) });
    } catch (err) {
      tooMany = err.message;
    }
    check(`and more than ${MAX_DIRS} folders in one request`, tooMany !== null);
    // A folder of its own on the system drive, with two files of known size.
    const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-helper-measure-'))
      .replace(/^[a-z]:/, (m) => m.toUpperCase());
    fs.writeFileSync(path.join(probe, 'secret-name-a.bin'), Buffer.alloc(8192, 1));
    fs.mkdirSync(path.join(probe, 'inner'));
    fs.writeFileSync(path.join(probe, 'inner', 'secret-name-b.bin'), Buffer.alloc(8192, 2));
    const one = await OPS['system.breakdown']({ dirs: [probe] }).catch((err) => ({ error: err.message }));
    const onSystemDrive = probe.slice(0, 2) === d;
    check('what it hands back is a sum per folder, and never a name inside one',
      !onSystemDrive || (one.sums && one.sums.length === 1 && one.sums[0].files === 2 && one.sums[0].logical === 16384 &&
        Object.keys(one.sums[0]).join(',') === 'dir,allocated,logical,files,denied' && !JSON.stringify(one).includes('secret-name')),
      onSystemDrive ? JSON.stringify(one).slice(0, 160) : 'the temporary folder is not on the system drive; skipped');
    fs.rmSync(probe, { recursive: true, force: true });
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
