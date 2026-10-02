#!/usr/bin/env node
'use strict';

// The release guard: what must never be inside a build that is not `dev`.
//   node scripts/test-release-guard.js
//
// Each rule is shown to fail on an archive that breaks it and pass on one
// that does not. The archives are written here in the asar format by hand;
// `verify-release-guard.js` runs the same guard over real electron-builder
// output, so the reader is checked against the real thing there.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const guard = require('./release-guard');
const { removeAfterExit } = require('./lib/sandbox');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

/** An asar holding `files` ({ 'a/b.js': 'text' }); `unpacked` names go beside it. */
function writeAsar(file, files, unpacked = []) {
  const header = { files: {} };
  const chunks = [];
  let offset = 0;
  for (const [rel, text] of Object.entries(files)) {
    const parts = rel.split('/');
    let node = header;
    for (const dir of parts.slice(0, -1)) {
      node.files[dir] = node.files[dir] || { files: {} };
      node = node.files[dir];
    }
    const data = Buffer.from(text, 'utf8');
    if (unpacked.includes(rel)) {
      node.files[parts.at(-1)] = { size: data.length, unpacked: true };
      const out = path.join(`${file}.unpacked`, ...parts);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, data);
    } else {
      node.files[parts.at(-1)] = { size: data.length, offset: String(offset) };
      chunks.push(data);
      offset += data.length;
    }
  }
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const padded = Math.ceil(json.length / 4) * 4;
  const headerPickle = Buffer.alloc(8 + padded);
  headerPickle.writeUInt32LE(4 + padded, 0);
  headerPickle.writeUInt32LE(json.length, 4);
  json.copy(headerPickle, 8);
  const sizePickle = Buffer.alloc(8);
  sizePickle.writeUInt32LE(4, 0);
  sizePickle.writeUInt32LE(headerPickle.length, 4);
  fs.writeFileSync(file, Buffer.concat([sizePickle, headerPickle, ...chunks]));
}

const info = (channel) => JSON.stringify({ channel, version: '0.6.0', releaseDate: '2026-10-02T00:00:00.000Z' });
const CLEAN = {
  'package.json': '{"name":"cleandrive"}',
  'src/main/main.js': "'use strict';\n",
  'src/main/build-info.json': info('stable'),
  'src/main/license/state.js': "const overrides = require('./dev-overrides');\n",
  'node_modules/mammoth/index.js': 'module.exports = 1;\n',
};
const DEV_DEPS = ['axe-core', 'electron', 'electron-builder'];

const dir = removeAfterExit(fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-guard-')));
let n = 0;
function verdict(files, channel = 'stable', unpacked = []) {
  n += 1;
  const file = path.join(dir, `case${n}`, 'resources', 'app.asar');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAsar(file, files, unpacked);
  return guard.checkPackage(path.join(dir, `case${n}`), { channel, devDependencies: DEV_DEPS });
}

console.log('\nrelease guard: reading an asar\n');

{
  const file = path.join(dir, 'read.asar');
  writeAsar(file, { 'a.txt': 'alpha', 'deep/er/b.js': 'beta ✓', 'c.bin': 'gamma' }, ['c.bin']);
  const { entries, read } = guard.readAsar(file);
  check('every file is listed with its posix path', [...entries.keys()].sort().join(',') === 'a.txt,c.bin,deep/er/b.js',
    [...entries.keys()].join(','));
  check('a packed file reads back byte for byte', read('deep/er/b.js').toString('utf8') === 'beta ✓');
  check('an unpacked file is read from beside the archive', read('c.bin').toString('utf8') === 'gamma');
  let refused = false;
  try {
    guard.asarOf(path.join(dir, 'no-such-build'));
  } catch {
    refused = true;
  }
  check('a folder with no app.asar is an error, not a clean verdict', refused);
}

console.log('\nrelease guard: a stable build\n');

{
  const ok = verdict(CLEAN);
  check('a clean stable build passes', ok.length === 0, ok.join(' | '));
  check('asarOf finds app.asar inside a win-unpacked folder',
    guard.asarOf(path.join(dir, `case${n}`)) === path.join(dir, `case${n}`, 'resources', 'app.asar'));

  const planted = verdict({ ...CLEAN, 'src/main/planted.js': `process.env.${guard.OVERRIDE_VARIABLE}\n` });
  check('a file naming the override fails, and is named', planted.length === 1 && planted[0].startsWith('src/main/planted.js:'),
    planted.join(' | '));

  const inJson = verdict({ ...CLEAN, 'src/i18n/x.json': `{"k":"${guard.OVERRIDE_VARIABLE}"}` });
  check('so does a JSON file', inJson.some((e) => e.startsWith('src/i18n/x.json:')), inJson.join(' | '));

  const unpackedLeak = verdict({ ...CLEAN, 'src/main/u.js': guard.OVERRIDE_VARIABLE }, 'stable', ['src/main/u.js']);
  check('and an unpacked one', unpackedLeak.some((e) => e.startsWith('src/main/u.js:')), unpackedLeak.join(' | '));

  for (const rel of guard.DEV_ONLY) {
    const leaked = verdict({ ...CLEAN, [rel]: "'use strict';\n" });
    check(`${rel} in a stable build fails`, leaked.some((e) => e.startsWith(`${rel}: developer-only`)), leaked.join(' | '));
  }

  const harness = verdict({ ...CLEAN, 'scripts/verify-autoclean.js': '// deletes real files\n' });
  check('a harness in a stable build fails', harness.some((e) => /^scripts\/.*a harness/.test(e)), harness.join(' | '));

  const axe = verdict({ ...CLEAN, 'node_modules/axe-core/axe.js': '//\n' });
  check('a devDependency in a stable build fails', axe.some((e) => e.startsWith('node_modules/axe-core:')), axe.join(' | '));

  const noInfo = { ...CLEAN };
  delete noInfo['src/main/build-info.json'];
  const missing = verdict(noInfo);
  check('a build without build-info.json fails (it would run as dev)', missing.some((e) => /build-info\.json is missing/.test(e)),
    missing.join(' | '));

  const mislabelled = verdict({ ...CLEAN, 'src/main/build-info.json': info('dev') });
  check('build-info.json naming another channel fails', mislabelled.some((e) => /says "dev" for a stable build/.test(e)),
    mislabelled.join(' | '));

  const beta = verdict({ ...CLEAN, 'src/main/build-info.json': info('beta'), [guard.DEV_ONLY[0]]: guard.OVERRIDE_VARIABLE }, 'beta');
  check('the beta channel is held to the same rules', beta.length >= 2, beta.join(' | '));
}

console.log('\nrelease guard: a dev build\n');

{
  const dev = verdict({ ...CLEAN, 'src/main/build-info.json': info('dev'), [guard.DEV_ONLY[0]]: guard.OVERRIDE_VARIABLE }, 'dev');
  check('a dev build may carry the override', dev.length === 0, dev.join(' | '));
  check('and electron-builder is told to leave nothing out of it', guard.excludedFor('dev').length === 0);
  check('while every other channel leaves out each developer-only file',
    ['stable', 'beta'].every((c) => guard.DEV_ONLY.every((rel) => guard.excludedFor(c).includes(`!${rel}`))));
}

console.log('\nrelease guard: the source tree it guards\n');

{
  // A stable build of this checkout must pass: only the developer-only files
  // may name the override, and build.js must hand both the exclusions and
  // the check to electron-builder.
  const ROOT = path.join(__dirname, '..');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const naming = walk(path.join(ROOT, 'src'))
    .filter((f) => fs.readFileSync(f).includes(guard.OVERRIDE_VARIABLE))
    .map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
  const stray = naming.filter((rel) => !guard.DEV_ONLY.includes(rel));
  check('under src/, only developer-only files name the override', stray.length === 0, stray.join(', ') || naming.join(', '));
  const build = fs.readFileSync(path.join(__dirname, 'build.js'), 'utf8');
  check('build.js leaves the developer-only files out', /files:\s*\[[^\]]*guard\.excludedFor\(channel\)/.test(build));
  check('and runs the guard after packing', /afterPack:[\s\S]{0,200}guard\.checkPackage\(/.test(build));
  check('every developer-only file exists, so the list cannot rot', guard.DEV_ONLY.every((rel) => fs.existsSync(path.join(ROOT, rel))));
}

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
