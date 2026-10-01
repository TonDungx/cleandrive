'use strict';

// The real elevated helper -- src/main/helper/helper-process.js, its handshake,
// its fixed list of operations, its pieces and backpressure -- with exactly
// one thing replaced: `mft.openVolume` reads an image file instead of `\\.\X:`.
//
// For scripts/verify-mft-pipe.js, which starts this under Electron and under
// Node in turn. Never shipped: the build packs `src/` and nothing from here.
// Opening a real volume needs administrator; everything after it does not,
// and this is how that everything gets run for real.

const image = process.env.CLEANDRIVE_MFT_IMAGE;
const finish = (code) => {
  if (process.versions.electron) require('electron').app.exit(code);
  else process.exit(code);
};
if (!image) {
  console.error('CLEANDRIVE_MFT_IMAGE is required');
  finish(2);
} else {
  const mft = require('../../src/main/system/mft');
  const { fileReader } = require('./ntfs-fixture');
  mft.openVolume = async () => fileReader(image);
  require('../../src/main/helper/helper-process')
    .runHelper(process.argv)
    .then(finish, () => finish(1));
}
