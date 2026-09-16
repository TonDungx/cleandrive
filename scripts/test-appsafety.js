#!/usr/bin/env node
'use strict';

// Regression tests for two real breakages this tool caused:
//
//   1. VS Code: `resources\app\package.json` made `looksLikeProject` true, so
//      the sibling `out\` matched the build-output rule and every compiled .js
//      file in the editor was offered as "safe to delete" -> ERR_MODULE_NOT_FOUND.
//
//   2. Zalo: `AppData\Roaming\ZaloData` holds Cache/, Code Cache/, GPUCache/
//      and logs/. Those names matched the cache and log rules, so an app's
//      live state was offered as "safe to delete".
//
//   node scripts/test-appsafety.js

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { scan } = require('../src/main/lib/scanner');
const { formatBytes } = require('../src/main/lib/util');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

async function write(file, content = 'x'.repeat(4096)) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content);
}

async function buildFixture(root) {
  await fsp.rm(root, { recursive: true, force: true });

  /* -- an installed Electron app, laid out exactly like VS Code ---------- */
  const vscode = path.join(root, 'AppData', 'Local', 'Programs', 'Microsoft VS Code');
  await write(path.join(vscode, 'Code.exe'));
  await write(path.join(vscode, 'unins000.exe'));
  await write(path.join(vscode, 'resources', 'app', 'package.json'), '{"name":"code"}');
  await write(path.join(vscode, 'resources', 'app', 'out', 'main.js'));
  await write(path.join(vscode, 'resources', 'app', 'out', 'vs', 'loader.js'));
  await write(path.join(vscode, 'resources', 'app', 'out', 'bootstrap-fork.js'));
  await write(path.join(vscode, 'bin', 'code.cmd'));

  /* -- an Electron app's roaming profile, laid out like ZaloData --------- */
  const zalo = path.join(root, 'AppData', 'Roaming', 'ZaloData');
  await write(path.join(zalo, 'Cache', 'data_1'));
  await write(path.join(zalo, 'Code Cache', 'js', 'index'));
  await write(path.join(zalo, 'GPUCache', 'data_0'));
  await write(path.join(zalo, 'logs', 'old.log'));
  await write(path.join(zalo, 'Local Storage', 'leveldb', '000003.log'));
  await write(path.join(zalo, 'Database', 'messages.db'));

  /* -- controls that MUST still be cleanable ----------------------------- */
  const project = path.join(root, 'work', 'my-app');
  await write(path.join(project, 'package.json'), '{"name":"mine"}');
  await write(path.join(project, 'src', 'index.js'));
  await write(path.join(project, 'dist', 'bundle.js'));

  const localTemp = path.join(root, 'AppData', 'Local', 'Temp');
  await write(path.join(localTemp, 'installer-leftover.dat'));

  const browser = path.join(root, 'AppData', 'Local', 'SomeBrowser', 'User Data', 'Default', 'Cache');
  await write(path.join(browser, 'f_00001'));

  /* -- an app nobody has heard of, under Local, storing Chromium state ---- */
  // This is the general case: not Roaming, not an install dir, not a name any
  // list could know. Only the shape of the folder gives it away.
  const unknown = path.join(root, 'AppData', 'Local', 'BrandNewChatApp');
  await write(path.join(unknown, 'Local Storage', 'leveldb', '000003.log'), 'user data'.repeat(400));
  await write(path.join(unknown, 'Local Storage', 'leveldb', 'CURRENT'));
  await write(path.join(unknown, 'IndexedDB', 'https_x_0.indexeddb.leveldb', '000004.log'));
  await write(path.join(unknown, 'Cookies'));
  await write(path.join(unknown, 'Cache', 'data_1'));
  await write(path.join(unknown, 'GPUCache', 'data_0'));
  await write(path.join(unknown, 'logs', 'app.log'));

  // Age everything in it past every threshold.
  const old = new Date(Date.now() - 300 * 86400000);
  const walk = async (dir) => {
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else await fsp.utimes(full, old, old);
    }
  };
  await walk(unknown);
}

(async () => {
  const root = path.join(os.tmpdir(), 'cleandrive-appsafety');
  await buildFixture(root);

  const result = await scan(root);
  const safe = new Set();
  const review = new Set();
  for (const group of result.cleanup.groups) {
    for (const f of group.files) {
      (group.verdict === 'safe' ? safe : review).add(f.path.slice(root.length + 1).replace(/\\/g, '/'));
    }
  }

  console.log(`Fixture: ${root}`);
  console.log(`Safe: ${formatBytes(result.cleanup.safeBytes)} · Review: ${formatBytes(result.cleanup.reviewBytes)}\n`);
  console.log('Marked safe to delete:');
  for (const p of [...safe].sort()) console.log(`    ${p}`);
  console.log('');

  console.log('Installed application must never be offered:');
  check('VS Code out/main.js not safe',
    !safe.has('AppData/Local/Programs/Microsoft VS Code/resources/app/out/main.js'));
  check('VS Code out/vs/loader.js not safe',
    !safe.has('AppData/Local/Programs/Microsoft VS Code/resources/app/out/vs/loader.js'));
  check('VS Code out/bootstrap-fork.js not safe',
    !safe.has('AppData/Local/Programs/Microsoft VS Code/resources/app/out/bootstrap-fork.js'));
  check('nothing at all from the VS Code install is safe',
    ![...safe].some((p) => p.includes('Microsoft VS Code')),
    [...safe].filter((p) => p.includes('Microsoft VS Code')).join(', '));

  console.log('\nRoaming application data must never be offered:');
  check('ZaloData/Cache not safe', !safe.has('AppData/Roaming/ZaloData/Cache/data_1'));
  check('ZaloData/Code Cache not safe', !safe.has('AppData/Roaming/ZaloData/Code Cache/js/index'));
  check('ZaloData/GPUCache not safe', !safe.has('AppData/Roaming/ZaloData/GPUCache/data_0'));
  check('ZaloData/logs not safe', !safe.has('AppData/Roaming/ZaloData/logs/old.log'));
  check('nothing at all from Roaming is safe',
    ![...safe].some((p) => p.startsWith('AppData/Roaming/')),
    [...safe].filter((p) => p.startsWith('AppData/Roaming/')).join(', '));

  console.log('\nAn application never heard of, recognised only by its shape:');
  const unknownSafe = [...safe].filter((p) => p.startsWith('AppData/Local/BrandNewChatApp/'));
  check('LevelDB write-ahead log is not "an old log file"',
    !safe.has('AppData/Local/BrandNewChatApp/Local Storage/leveldb/000003.log'));
  check('IndexedDB write-ahead log is not "an old log file"',
    !safe.has('AppData/Local/BrandNewChatApp/IndexedDB/https_x_0.indexeddb.leveldb/000004.log'));
  check('its logs/ folder is not auto-selected',
    !safe.has('AppData/Local/BrandNewChatApp/logs/app.log'));
  check('its Cache/ is downgraded, not deleted',
    !safe.has('AppData/Local/BrandNewChatApp/Cache/data_1'),
    `safe under it: ${unknownSafe.join(', ') || 'none'}`);
  check('its GPUCache stays safe (machine-generated)',
    safe.has('AppData/Local/BrandNewChatApp/GPUCache/data_0'));
  check('nothing else at all from it is safe',
    unknownSafe.length === 1, unknownSafe.join(', '));

  console.log('\nReal junk must still be found:');
  check('a genuine project dist/ is still safe', safe.has('work/my-app/dist/bundle.js'));
  check('project source is never touched', !safe.has('work/my-app/src/index.js'));
  check('AppData\\Local\\Temp is still safe', safe.has('AppData/Local/Temp/installer-leftover.dat'));
  check('a browser cache under Local is still safe',
    safe.has('AppData/Local/SomeBrowser/User Data/Default/Cache/f_00001'));

  await fsp.rm(root, { recursive: true, force: true });
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
