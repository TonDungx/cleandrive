#!/usr/bin/env node
'use strict';

// Build for distribution.
//
//   npm run build          installer + unpacked folder
//   npm run build -- dir   unpacked folder only (fast, for local testing)
//
// Produces a Windows installer users download and run. The installer asks where
// to put the app rather than deciding for them, because this is shipped to
// people whose drive layout nobody here knows about — a machine with a small C:
// and a large D: is the normal case for the users this is aimed at.
//
// Installing to an arbitrary location is safe because of a property the app
// already has: the scheduled task it registers stores an absolute path to the
// executable, and the app reads that path back on every launch and re-registers
// if it no longer matches. So the app can be installed anywhere, moved
// afterwards, or reinstalled elsewhere, and the weekly cleanup keeps working.

const fs = require('node:fs');
const path = require('node:path');

const { buildAppIco } = require('../src/main/lib/trayicon');
const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
// Overridable because a previous build's output can end up locked by the
// system -- an antivirus scan holds `app.asar` open and Windows then refuses to
// unlink it, with no process of ours to blame. Building elsewhere unblocks a
// release without waiting for whatever is holding it to let go.
const OUT = process.env.CLEANDRIVE_OUT
  ? path.resolve(process.env.CLEANDRIVE_OUT)
  : path.join(ROOT, 'dist');

const PRODUCT = 'CleanDrive';
const APP_ID = 'com.cleandrive.app'; // must match app.setAppUserModelId in main.js

/**
 * Where a built app checks for updates.
 *
 * Derived from package.json's `repository` field. Without one the build still
 * succeeds, and the updater reports "unsupported" rather than silently checking
 * a URL nobody chose — an app that polls someone else's releases because a
 * placeholder was left in would be worse than one that never updates.
 */
const RELEASE_FEED = (() => {
  const url = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository || {}).url;
  const match = url && /github\.com[/:]([^/]+)\/([^/.]+)/.exec(url);
  if (!match) return null;
  return [{ provider: 'github', owner: match[1], repo: match[2] }];
})();

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

(async () => {
  const dirOnly = process.argv.includes('dir');

  /* ---- icon -------------------------------------------------------------- */
  // Generated from the same module that draws the tray gauge, so the repo holds
  // no binary assets and the installer, the taskbar and the window's own header
  // cannot drift apart.
  fs.mkdirSync(BUILD, { recursive: true });
  const icoPath = path.join(BUILD, 'icon.ico');
  fs.writeFileSync(icoPath, buildAppIco());
  console.log(`icon        ${path.relative(ROOT, icoPath)}  (${fs.statSync(icoPath).size} bytes)\n`);

  /* ---- which build this is ----------------------------------------------- */
  // Written for the packager and removed straight after, so it only ever
  // exists inside an installer. A checkout without it is the `dev` channel,
  // which is the only place the entitlement override is honoured -- leaving
  // this file behind would quietly turn the checkout into a release build.
  const channel = process.env.CLEANDRIVE_CHANNEL || 'stable';
  const buildInfoPath = path.join(ROOT, 'src', 'main', 'build-info.json');
  fs.writeFileSync(
    buildInfoPath,
    `${JSON.stringify({ channel, version: pkg.version, releaseDate: new Date().toISOString() }, null, 2)}\n`
  );
  console.log(`channel     ${channel}\n`);

  /* ---- package ----------------------------------------------------------- */
  const builder = require('electron-builder');

  let results;
  try {
    results = await builder.build({
    targets: builder.Platform.WINDOWS.createTarget(
      dirOnly ? ['dir'] : ['nsis', 'dir'],
      builder.Arch.x64
    ),
    config: {
      appId: APP_ID,
      productName: PRODUCT,
      copyright: `${PRODUCT}`,
      directories: { output: OUT, buildResources: BUILD },

      // Only what the running app opens, plus production dependencies, which
      // electron-builder adds by itself. The test harnesses in particular would
      // ship a verify-autoclean.js that deletes real files, to a machine whose
      // owner never asked for it.
      files: ['src/**/*', 'package.json'],

      win: {
        icon: icoPath,
        target: dirOnly ? ['dir'] : ['nsis', 'dir'],
        // No signing configured. electron-builder would otherwise look for a
        // certificate in the environment and fail the build when it finds none.
        signAndEditExecutable: true,
      },

      nsis: {
        // A wizard, not a one-click install: the whole point is letting people
        // choose a drive.
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        // Per-user by default, so no administrator prompt. The wizard still
        // offers "for all users", which does prompt.
        perMachine: false,
        allowElevation: true,
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        shortcutName: PRODUCT,
        // Leave settings, history and the trash ledger behind on uninstall.
        // They are small, and silently deleting a user's cleanup history
        // because they reinstalled is not this app's style.
        deleteAppDataOnUninstall: false,
        artifactName: '${productName}-Setup-${version}.${ext}',
      },

      // Where the updater looks. This is baked into the build as
      // `app-update.yml`; nothing is uploaded by `npm run build`.
      //
      // Read from package.json rather than hard-coded, so a fork or a rename
      // does not ship an app that checks somebody else's releases for updates.
      publish: RELEASE_FEED,

      // Signing is not configured here on purpose. electron-builder already
      // reads CSC_LINK / CSC_KEY_PASSWORD from the environment, so a build
      // machine that has a certificate signs without this file changing, and a
      // machine that does not produces an unsigned build instead of failing.
      // See "Code signing" in the README.
    },
    publish: 'never',
    });
  } finally {
    fs.rmSync(buildInfoPath, { force: true });
  }

  console.log('');
  for (const artifact of results) {
    if (!fs.existsSync(artifact) || fs.statSync(artifact).isDirectory()) continue;
    console.log(`built       ${path.relative(ROOT, artifact)}  (${mb(fs.statSync(artifact).size)})`);
  }

  const unpacked = path.join(OUT, 'win-unpacked', `${PRODUCT}.exe`);
  if (fs.existsSync(unpacked)) console.log(`unpacked    ${path.relative(ROOT, unpacked)}`);

  console.log('\nThe installer is unsigned: Windows SmartScreen will warn on first run.');
  console.log('See "Code signing" in the README for what fixes that.\n');
})().catch((err) => {
  console.error('BUILD FAILED:', err);
  process.exit(1);
});
