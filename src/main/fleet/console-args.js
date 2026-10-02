'use strict';

/**
 * `CleanDrive.exe --console [<folder>]` (H3): only when `--console` is the
 * first argument, the rule `--cli` follows and for the same reason. The other
 * modes are found anywhere on the command line, so a share named
 * `\\srv\--helper` would otherwise start the elevated helper's branch -- the
 * hole H1 found and closed for the command line.
 *
 * From a checkout the first argument is the app's folder (`electron .`), so
 * the mode's flag is the one after it.
 */

function wanted(argv, packaged) {
  return argv[packaged ? 1 : 2] === '--console';
}

/** The folder after the flag, or null. Anything after it is ignored. */
function shareOf(argv, packaged) {
  const value = argv[packaged ? 2 : 3];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/^"(.*)"$/, '$1');
  // Another switch (Chromium adds some of its own) is not a folder.
  if (trimmed === '' || trimmed.startsWith('--')) return null;
  return trimmed;
}

module.exports = { wanted, shareOf };
