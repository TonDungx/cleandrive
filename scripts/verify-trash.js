'use strict';

// Verifies a real Recycle Bin move using a throwaway probe file this script
// creates in the temp directory. Nothing else is touched.
//
//   npx electron scripts/verify-trash.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const { moveToTrash } = require('../src/main/lib/trash');

app.whenReady().then(async () => {
  const probe = path.join(os.tmpdir(), `cleandrive-trash-probe-${Date.now()}.txt`);
  fs.writeFileSync(probe, 'If you see this in the Recycle Bin, restore or delete it freely.');

  console.log(`\nProbe created: ${probe}`);
  console.log(`Exists before: ${fs.existsSync(probe)}`);

  const result = await moveToTrash([probe], { confirm: false });

  console.log(`Moved:         ${result.moved.length}`);
  console.log(`Failed:        ${result.failed.length}`, result.failed);
  console.log(`Exists after:  ${fs.existsSync(probe)}`);

  const ok = result.moved.length === 1 && result.failed.length === 0 && !fs.existsSync(probe);
  console.log(
    ok
      ? '\nPASS  file left the filesystem via the Recycle Bin (check the bin to confirm it is recoverable)\n'
      : '\nFAIL  file did not move as expected\n'
  );
  app.exit(ok ? 0 : 1);
});
