#!/usr/bin/env node
'use strict';

// The release guard on real electron-builder output (ROADMAP §7.9).
//   npm run verify:release-guard
//
// Three real builds, each into its own folder under %TEMP%:
//
//   1. stable, with a file planted in src/main that names the entitlement
//      override, full targets (installer and folder): the build must fail,
//      say which file, and leave no installer behind -- the guard runs after
//      packing and before the installer is made;
//   2. stable, clean, folder only: the guard passes, the asar holds no
//      developer-only file, and the packed exe runs the command line with the
//      override set and ignores it;
//   3. dev, folder only: the developer-only file is in, and the exe honours
//      the override.
//
// The planted file is removed whatever happens, and so is build-info.json --
// a leftover one would quietly turn this checkout into a stable build. Takes
// a few minutes; it is not part of `npm test`.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const guard = require('./release-guard');
const { removeAfterExit } = require('./lib/sandbox');

const ROOT = path.join(__dirname, '..');
const PLANT = path.join(ROOT, 'src', 'main', 'zz-release-guard-plant.js');
const BUILD_INFO = path.join(ROOT, 'src', 'main', 'build-info.json');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const clean = { ...process.env };
delete clean.ELECTRON_RUN_AS_NODE;
delete clean.CLEANDRIVE_ENTITLEMENTS;

function build(out, channel, dirOnly) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, 'build.js'), ...(dirOnly ? ['dir'] : [])], {
    cwd: ROOT,
    env: { ...clean, CLEANDRIVE_OUT: out, CLEANDRIVE_CHANNEL: channel },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status, text: `${r.stdout || ''}\n${r.stderr || ''}`, seconds: ((Date.now() - started) / 1000).toFixed(0) };
}

/** `cleandrive version --json` from a packed exe, in a throwaway data folder. */
function version(unpacked, entitlements) {
  const data = removeAfterExit(fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-relguard-data-')));
  const r = spawnSync(path.join(unpacked, 'CleanDrive.exe'), ['--cli', `--user-data-dir=${data}`, 'version', '--json'], {
    env: { ...clean, CLEANDRIVE_ENTITLEMENTS: entitlements, CLEANDRIVE_TASK_SUFFIX: '_relguard' },
    encoding: 'utf8',
    timeout: 60000,
  });
  try {
    return { ...JSON.parse(r.stdout), asked: data };
  } catch {
    return { error: `exit ${r.status}: ${(r.stdout || '').slice(0, 200)} ${(r.stderr || '').slice(0, 200)}` };
  }
}

function setPlant(on) {
  if (on) fs.writeFileSync(PLANT, `'use strict';\n// planted by verify-release-guard.js\nmodule.exports = process.env.${guard.OVERRIDE_VARIABLE};\n`);
  else fs.rmSync(PLANT, { force: true });
}

(async () => {
  if (fs.existsSync(BUILD_INFO)) {
    console.error(`refusing to start: ${BUILD_INFO} exists, so this checkout already looks like a release build. Remove it first.`);
    process.exit(1);
  }
  const base = removeAfterExit(fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-relguard-')));
  const pkg = require('../package.json');

  try {
    console.log('\nrelease guard: a stable build with a planted leak\n');
    setPlant(true);
    const out1 = path.join(base, 'planted');
    const planted = build(out1, 'stable', false);
    setPlant(false);
    check('the build fails', planted.code !== 0, `exit ${planted.code}, ${planted.seconds}s`);
    check('and names the planted file', /zz-release-guard-plant\.js: names the entitlement override/.test(planted.text),
      (planted.text.match(/release guard:.*$/m) || ['(no guard line)'])[0]);
    const setups = fs.existsSync(out1) ? fs.readdirSync(out1).filter((f) => /\.exe$/i.test(f)) : [];
    check('and leaves no installer behind', setups.length === 0, setups.join(', ') || 'none');
    check('build-info.json was removed after the failure', !fs.existsSync(BUILD_INFO));

    console.log('\nrelease guard: a clean stable build\n');
    const out2 = path.join(base, 'stable');
    const stable = build(out2, 'stable', true);
    check('the build passes', stable.code === 0 && /guard\s+clean for stable/.test(stable.text), `exit ${stable.code}, ${stable.seconds}s`);
    const unpacked2 = path.join(out2, 'win-unpacked');
    if (stable.code === 0) {
      const { entries } = guard.readAsar(guard.asarOf(unpacked2));
      check('no developer-only file is packed', guard.DEV_ONLY.every((rel) => !entries.has(rel)));
      check('the guard, run again by hand, agrees', guard.checkPackage(unpacked2, {
        channel: 'stable', devDependencies: Object.keys(pkg.devDependencies || {}),
      }).length === 0);
      const v = version(unpacked2, 'business');
      check('the packed exe starts without the developer-only file', !v.error && v.channel === 'stable', v.error || v.channel);
      check('and ignores the override (Business asked for, the CLI stays closed)', v.commands && v.commands.scan === false,
        v.commands ? `scan: ${v.commands.scan}` : '');
      check('in the data folder it was given', v.dataDir && path.resolve(v.dataDir) === path.resolve(v.asked), v.dataDir);
    }

    console.log('\nrelease guard: a dev build\n');
    const out3 = path.join(base, 'dev');
    const dev = build(out3, 'dev', true);
    check('the build passes', dev.code === 0 && /guard\s+clean for dev/.test(dev.text), `exit ${dev.code}, ${dev.seconds}s`);
    if (dev.code === 0) {
      const unpacked3 = path.join(out3, 'win-unpacked');
      const { entries } = guard.readAsar(guard.asarOf(unpacked3));
      check('the developer-only file is packed', guard.DEV_ONLY.every((rel) => entries.has(rel)));
      const narrowed = version(unpacked3, 'free');
      const widened = version(unpacked3, 'business');
      check('and the override is honoured', narrowed.commands && widened.commands &&
        narrowed.commands.scan === false && widened.commands.scan === true,
        narrowed.commands ? `free: ${narrowed.commands.scan}, business: ${widened.commands && widened.commands.scan}` : narrowed.error);
    }
  } finally {
    setPlant(false);
    if (fs.existsSync(BUILD_INFO)) {
      fs.rmSync(BUILD_INFO, { force: true });
      console.log('  (removed a leftover build-info.json)');
    }
  }

  check('nothing planted is left in the checkout', !fs.existsSync(PLANT) && !fs.existsSync(BUILD_INFO));
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  setPlant(false);
  console.error('FAILED:', err);
  process.exit(1);
});
