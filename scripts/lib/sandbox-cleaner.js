'use strict';

// The waiter sandbox.js starts: node sandbox-cleaner.js <pid> <dir...>
// Waits while <pid> is alive (up to six hours), then removes each folder,
// retrying for half a minute while the last of Chromium's processes let go.

process.noAsar = true;
const fs = require('node:fs');

const [pidText, ...dirs] = process.argv.slice(2);
const pid = Number(pidText);
const alive = () => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const started = Date.now();
const SIX_HOURS = 6 * 60 * 60 * 1000;

function sweep(tries) {
  const left = dirs.filter((dir) => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return fs.existsSync(dir);
    } catch {
      return true;
    }
  });
  if (left.length > 0 && tries < 60) {
    dirs.length = 0;
    dirs.push(...left);
    setTimeout(() => sweep(tries + 1), 500);
  }
}

(function wait() {
  if (alive() && Date.now() - started < SIX_HOURS) {
    setTimeout(wait, 1000);
    return;
  }
  sweep(0);
})();
