'use strict';

const { Notification } = require('electron');

/**
 * A Windows toast, unless nobody asked for one.
 *
 * ## Why this is not just `new Notification(...)`
 *
 * A notification is the one thing this app can put on someone's screen while
 * they are doing something else, so it is worth one place deciding whether it
 * may. Two checks live here.
 *
 * The first is `Notification.isSupported()`, which every caller was already
 * doing, or was about to forget to.
 *
 * The second is the test harnesses. They run against a throwaway user-data
 * directory and suffixed task names, so they cannot reach the real
 * configuration or the real schedule -- but the disk they measure is the real
 * disk, and a toast is a real toast. `npm run test:e2e` switches monitoring on
 * with a threshold of 85% to prove the monitor works, and on a machine sitting
 * at 85% it told its own developer their disk was filling up, in English,
 * seconds after the installed copy had said the same thing in Vietnamese. That
 * is a test with a side effect it never advertised.
 *
 * CLEANDRIVE_TASK_SUFFIX is how every harness already says "this run is not
 * the real one". Nothing that ships sets it, so the shipped behaviour is
 * exactly what it was.
 */
function isHarness() {
  return Boolean(process.env.CLEANDRIVE_TASK_SUFFIX);
}

/**
 * @param {object} options            as `new Notification(options)` takes them
 * @param {() => void} [onClick]      what a click on it should do
 * @returns {import('electron').Notification | null}
 */
function show(options, onClick) {
  if (isHarness()) return null;
  if (!Notification.isSupported()) return null;

  const toast = new Notification(options);
  if (onClick) toast.on('click', onClick);
  toast.show();
  return toast;
}

module.exports = { show, isHarness };
