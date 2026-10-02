#!/usr/bin/env node
'use strict';

/**
 * What must never be inside a build that is not the `dev` channel.
 *
 *   npm run guard:release -- <app.asar | win-unpacked folder> [--channel stable]
 *
 * `scripts/build.js` runs the same check as electron-builder's `afterPack`
 * hook -- after the app folder is packed, before the installer is made -- so
 * a build that fails it never produces an installer. It reads what was
 * actually packed, not the source tree: a file the `files` globs let through
 * by accident is caught here, whatever the globs meant to say.
 *
 * ## The rules, for every channel but `dev`
 *
 * - no **developer override** of the entitlements: neither the module that
 *   reads it (`DEV_ONLY`) nor its variable's name anywhere in a text file;
 * - no **harness**: nothing under `scripts/`, some of which delete real files;
 * - no **devDependency** under `node_modules/` (axe-core, Electron itself);
 * - a `build-info.json` that names the channel being built.
 *
 * The mock payment provider and its signing key are *not* refused yet. Until
 * real payment exists, "Pay" succeeds on every channel (decided 2026-10-02,
 * Phase 6), so they ship. Refusing them in a stable build is Phase 7's switch
 * (ROADMAP §8.3, step 3): `MockPaymentProvider`, the mock's private key, and
 * a trusted `mock-*` key id, all in a `stable` build.
 *
 * ## Reading an asar without a dependency
 *
 * The format is two pickles and the files: 8 bytes whose second uint32 is the
 * header's size, then the header -- a uint32 payload size, a uint32 string
 * length, the JSON -- then every file's bytes, each at `offset` from the end
 * of the header. A file marked `unpacked` lives beside it in
 * `app.asar.unpacked/`. Checked against a real electron-builder asar by
 * `verify-release-guard.js`.
 */

const fs = require('node:fs');
const path = require('node:path');

/** Files that exist only in a checkout or a `dev` build. Posix, from the app root. */
const DEV_ONLY = Object.freeze(['src/main/license/dev-overrides.js']);

/** The variable `dev-overrides.js` reads; its name in a release is a leak in itself. */
const OVERRIDE_VARIABLE = ['CLEANDRIVE', 'ENTITLEMENTS'].join('_');

const TEXT = /\.(js|cjs|mjs|json|html|css|txt|md|yml|yaml)$/i;

/** The `!glob` entries electron-builder's `files` needs for a channel. */
function excludedFor(channel) {
  return channel === 'dev' ? [] : DEV_ONLY.map((rel) => `!${rel}`);
}

/**
 * @param {string} file  path to an .asar
 * @returns {{ entries: Map<string, {size:number, offset:number, unpacked:boolean}>, read: (rel: string) => Buffer }}
 */
function readAsar(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const sizes = Buffer.alloc(8);
    fs.readSync(fd, sizes, 0, 8, 0);
    const headerSize = sizes.readUInt32LE(4);
    const headerBuf = Buffer.alloc(headerSize);
    fs.readSync(fd, headerBuf, 0, headerSize, 8);
    const length = headerBuf.readUInt32LE(4);
    const header = JSON.parse(headerBuf.toString('utf8', 8, 8 + length));
    const base = 8 + headerSize;

    const entries = new Map();
    const walk = (node, prefix) => {
      for (const [name, child] of Object.entries(node.files || {})) {
        const rel = prefix ? `${prefix}/${name}` : name;
        if (child.files) walk(child, rel);
        else if (!child.link) entries.set(rel, { size: Number(child.size) || 0, offset: Number(child.offset) || 0, unpacked: child.unpacked === true });
      }
    };
    walk(header, '');

    const read = (rel) => {
      const entry = entries.get(rel);
      if (!entry) throw new Error(`${rel} is not in ${file}`);
      if (entry.unpacked) return fs.readFileSync(path.join(`${file}.unpacked`, ...rel.split('/')));
      const out = Buffer.alloc(entry.size);
      const again = fs.openSync(file, 'r');
      try {
        fs.readSync(again, out, 0, entry.size, base + entry.offset);
      } finally {
        fs.closeSync(again);
      }
      return out;
    };
    return { entries, read };
  } finally {
    fs.closeSync(fd);
  }
}

/** `app.asar` for an asar path, a `resources` folder or a `win-unpacked` folder. */
function asarOf(target) {
  if (/\.asar$/i.test(target)) return target;
  for (const candidate of [path.join(target, 'resources', 'app.asar'), path.join(target, 'app.asar')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`no app.asar under ${target}`);
}

/**
 * Everything wrong with a packed app, as sentences. Empty means it may ship.
 *
 * @param {string} target  app.asar, or the folder holding it
 * @param {object} options
 * @param {string} options.channel          the channel being built
 * @param {string[]} [options.devDependencies]
 */
function checkPackage(target, { channel, devDependencies = [] }) {
  const file = asarOf(target);
  const { entries, read } = readAsar(file);
  const errors = [];

  let info = null;
  try {
    info = JSON.parse(read('src/main/build-info.json').toString('utf8'));
  } catch {
    info = null;
  }
  if (!info) errors.push('src/main/build-info.json is missing: the build would run as the dev channel');
  else if (info.channel !== channel) errors.push(`build-info.json says "${info.channel}" for a ${channel} build`);

  if (channel === 'dev') return errors;

  for (const rel of DEV_ONLY) {
    if (entries.has(rel)) errors.push(`${rel}: developer-only, in a ${channel} build`);
  }
  for (const rel of entries.keys()) {
    if (rel.startsWith('scripts/')) {
      errors.push(`${rel}: a harness, in a ${channel} build`);
      break;
    }
  }
  for (const dep of devDependencies) {
    if ([...entries.keys()].some((rel) => rel.startsWith(`node_modules/${dep}/`))) {
      errors.push(`node_modules/${dep}: a devDependency, in a ${channel} build`);
    }
  }
  for (const [rel, entry] of entries) {
    if (!TEXT.test(rel) || entry.size > 8 * 1024 * 1024) continue;
    if (read(rel).includes(OVERRIDE_VARIABLE)) errors.push(`${rel}: names the entitlement override, in a ${channel} build`);
  }
  return errors;
}

module.exports = { DEV_ONLY, OVERRIDE_VARIABLE, excludedFor, readAsar, asarOf, checkPackage };

/** The folder or asar named on the command line, skipping the value of --channel. */
function targetOf(args) {
  const at = args.indexOf('--channel');
  return args.find((a, i) => !a.startsWith('--') && (at < 0 || i !== at + 1)) || null;
}

module.exports.targetOf = targetOf;

if (require.main === module) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--channel');
  const target = targetOf(args);
  if (!target) {
    console.error('usage: release-guard <app.asar | win-unpacked folder> [--channel stable]');
    process.exit(64);
  }
  let channel = at >= 0 ? args[at + 1] : null;
  if (!channel) {
    try {
      channel = JSON.parse(readAsar(asarOf(target)).read('src/main/build-info.json').toString('utf8')).channel;
    } catch {
      channel = 'stable';
    }
  }
  const pkg = require('../package.json');
  const errors = checkPackage(target, { channel, devDependencies: Object.keys(pkg.devDependencies || {}) });
  if (errors.length > 0) {
    console.error(`release guard: ${errors.length} problem(s) in a ${channel} build\n  ${errors.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`release guard: ${asarOf(target)} is clean for ${channel}`);
}
