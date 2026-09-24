#!/usr/bin/env node
'use strict';

// The elevated helper through the real executable.
//
//   npx electron scripts/verify-helper.js              unelevated, no prompt
//   npx electron scripts/verify-helper.js --elevated   raises a real UAC prompt
//
// The first form starts `electron . --helper …` directly: it proves main.js
// routes the flag to the helper and that the helper runs inside Electron. The
// second goes through `Start-Process -Verb RunAs`, which needs somebody to
// click Yes -- or No, which is also a result worth seeing.

const path = require('node:path');
const { spawn } = require('node:child_process');
const { app } = require('electron');

const { HelperClient, appLauncher } = require('../src/main/helper/client');

const ROOT = path.join(__dirname, '..');
const elevated = process.argv.includes('--elevated');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

app.whenReady().then(async () => {
  console.log(`\nverify: the helper through ${elevated ? 'a UAC prompt' : 'the real executable, unelevated'}\n`);

  let exitCode = null;
  const launch = elevated
    ? appLauncher({ execPath: process.execPath, appPath: ROOT, isPackaged: false })
    : async (name, nonce) => {
        // ELECTRON_RUN_AS_NODE would turn the child into plain Node and skip
        // main.js entirely, which is not what is being verified.
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(process.execPath, [ROOT, '--helper', '--pipe', name, '--nonce', nonce], { env, stdio: 'ignore' });
        child.on('exit', (code) => {
          exitCode = code;
        });
      };

  const client = new HelperClient({ launch });
  try {
    await client.start();
  } catch (err) {
    check('the helper started', false, `${err.code}: ${err.message}`);
    app.exit(1);
    return;
  }

  const ping = await client.request('ping');
  check('main.js routed --helper to the helper, inside Electron', ping && Number.isInteger(ping.pid), JSON.stringify(ping));
  if (elevated) {
    check('it is running elevated', ping.elevated === true, ping.integrity);
  } else {
    check('it reports that it is not elevated', ping.elevated === false, ping.integrity);
  }

  client.stop();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  if (!elevated) check('closing the pipe ended it', exitCode === 0, `exit ${exitCode}`);

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  app.exit(failures === 0 ? 0 : 1);
});
