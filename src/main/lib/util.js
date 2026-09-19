'use strict';

const path = require('node:path');

const { message: m } = require('../../i18n');
const os = require('node:os');

/**
 * Cancellation token. Passed into long-running walks/hashes; they check
 * `.cancelled` between units of work and bail out cooperatively.
 */
class CancelToken {
  constructor() {
    this.cancelled = false;
  }
  cancel() {
    this.cancelled = true;
  }
  throwIfCancelled() {
    if (this.cancelled) {
      const err = new Error('Operation cancelled');
      err.code = 'ECANCELLED';
      throw err;
    }
  }
}

/**
 * Run `worker` over `items` with at most `limit` in flight.
 * Results are returned in input order. Rejections propagate.
 */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const size = Math.max(1, Math.min(limit, items.length));

  const runners = Array.from({ length: size }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });

  await Promise.all(runners);
  return results;
}

/** Throttle a callback to at most one call per `ms`, with a forced trailing call. */
function throttle(fn, ms) {
  let last = 0;
  const wrapped = (...args) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    }
  };
  wrapped.flush = (...args) => {
    last = Date.now();
    fn(...args);
  };
  return wrapped;
}

const IS_WIN = process.platform === 'win32';

/** Normalised comparison key for a path (case-insensitive on Windows). */
function pathKey(p) {
  const resolved = path.resolve(p);
  return IS_WIN ? resolved.toLowerCase() : resolved;
}

/** Directory names that belong to the OS -- never scanned, never deletable. */
const SYSTEM_DIR_NAMES = new Set([
  '$recycle.bin',
  'system volume information',
  '$windows.~bt',
  '$windows.~ws',
  '$sysreset',
  'recovery',
  'config.msi',
]);

/**
 * Directory names skipped to keep results meaningful. These are not protected
 * -- they are dependency and history folders whose contents would drown out
 * everything the user can actually act on.
 */
const NOISE_DIR_NAMES = new Set(['.git', 'node_modules', '.venv', '__pycache__']);

/** Both sets together, for callers that only need "is this skipped". */
const SKIP_DIR_NAMES = new Set([...SYSTEM_DIR_NAMES, ...NOISE_DIR_NAMES]);

/** Absolute roots never scanned and never deletable. */
function protectedRoots() {
  const roots = [];
  const add = (p) => {
    if (p) roots.push(pathKey(p));
  };

  if (IS_WIN) {
    const sysDrive = process.env.SystemDrive || 'C:';
    add(process.env.SystemRoot || path.join(sysDrive, 'Windows'));
    add(process.env.ProgramFiles || path.join(sysDrive, 'Program Files'));
    add(process.env['ProgramFiles(x86)'] || path.join(sysDrive, 'Program Files (x86)'));
    add(process.env.ProgramData || path.join(sysDrive, 'ProgramData'));
    add(path.join(sysDrive, '$Recycle.Bin'));
    add(path.join(sysDrive, 'System Volume Information'));
  } else {
    ['/bin', '/sbin', '/usr', '/etc', '/var', '/boot', '/dev', '/proc', '/sys', '/System', '/Library', '/Applications'].forEach(add);
  }

  return roots;
}

const PROTECTED_ROOTS = protectedRoots();

/**
 * Where per-user applications install themselves. These are program files in
 * every sense except that they sit under the user's profile, so the
 * Program Files guard misses them -- which is how this tool once offered
 * `Microsoft VS Code\resources\app\out\*.js` as "safe to delete".
 *
 * Unlike PROTECTED_ROOTS these are still scanned: knowing an installed app is
 * 3 GB is useful. They are only barred from deletion and from cleanup advice.
 */
function programInstallRoots() {
  const roots = [];
  const add = (p) => {
    if (p) roots.push(pathKey(p));
  };

  if (IS_WIN) {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    add(path.join(local, 'Programs'));
    add(path.join(local, 'Microsoft', 'WindowsApps'));
    add(path.join(local, 'Microsoft', 'WinGet'));
  } else {
    add(path.join(os.homedir(), '.local', 'bin'));
    add(path.join(os.homedir(), 'Applications'));
  }

  return roots;
}

const PROGRAM_INSTALL_ROOTS = programInstallRoots();

function isUnder(p, roots) {
  const key = pathKey(p);
  return roots.some((root) => key === root || key.startsWith(root + path.sep));
}

/** True if `p` is inside (or equal to) a protected system root. */
function isProtectedPath(p) {
  return isUnder(p, PROTECTED_ROOTS);
}

/** True if `p` sits inside a per-user application installation directory. */
function isProgramInstallPath(p) {
  if (isUnder(p, PROGRAM_INSTALL_ROOTS)) return true;
  // Same pattern rule as roaming data: catch profiles on other drives too.
  return IS_WIN && containsSegments(p, ['appdata', 'local', 'programs']);
}

/** Every location this tool refuses to delete from, for any reason. */
function isUndeletablePath(p) {
  return isProtectedPath(p) || isProgramInstallPath(p);
}

/**
 * Roaming application data: settings, accounts, sessions -- the state an app
 * expects to survive. Windows' own convention is that disposable data belongs
 * under Local, so anything an app puts in Roaming is treated as load-bearing
 * even when it is called "Cache".
 */
const ROAMING_ROOT = IS_WIN
  ? pathKey(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
  : null;

/**
 * Matched as a path *pattern*, not just against %APPDATA%. A machine can carry
 * more than one profile tree -- this one has both `C:\Users\x` and
 * `D:\Users\x` -- and only the pattern catches the second.
 */
function containsSegments(p, sequence) {
  const segments = pathKey(p).split(/[\\/]/);
  for (let i = 0; i + sequence.length <= segments.length; i++) {
    let match = true;
    for (let j = 0; j < sequence.length; j++) {
      if (segments[i + j] !== sequence[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

function isRoamingAppData(p) {
  if (!IS_WIN) return false;
  if (ROAMING_ROOT) {
    const key = pathKey(p);
    if (key === ROAMING_ROOT || key.startsWith(ROAMING_ROOT + path.sep)) return true;
  }
  return containsSegments(p, ['appdata', 'roaming']);
}

/** True if `p` is a filesystem root or the user's home directory itself. */
function isRootOrHome(p) {
  const key = pathKey(p);
  const parsed = path.parse(path.resolve(p));
  return key === pathKey(parsed.root) || key === pathKey(os.homedir());
}

/**
 * Why a directory is skipped during a walk, or null to descend into it.
 * System checks run first so a protected folder is always reported as such
 * rather than as generic noise.
 *
 * @returns {{kind: 'system'|'noise'|'hidden', reason: string} | null}
 */
function skipReason(name, fullPath, opts) {
  const lower = name.toLowerCase();

  if (SYSTEM_DIR_NAMES.has(lower)) {
    return { kind: 'system', reason: m('protected.windows', 'Windows owns this folder') };
  }
  if (opts.excludeSystem && isProtectedPath(fullPath)) {
    return {
      kind: 'system',
      reason: m('protected.programs', 'Operating system or installed programs live here'),
    };
  }
  if (NOISE_DIR_NAMES.has(lower)) {
    return { kind: 'noise', reason: m('protected.dependency', 'Dependency or version-control folder') };
  }
  if (opts.ignoreHidden && isHiddenName(name)) {
    return { kind: 'hidden', reason: m('protected.hidden', 'Hidden folder') };
  }
  return null;
}

/** True if this directory entry should be skipped during a walk. */
function shouldSkipDir(name, fullPath, opts) {
  return skipReason(name, fullPath, opts) !== null;
}

function isHiddenName(name) {
  return name.startsWith('.') || name.startsWith('$');
}

/** Lowercase extension without the dot; '' when there is none. */
function extOf(name) {
  const ext = path.extname(name);
  return ext ? ext.slice(1).toLowerCase() : '';
}

/** "about 2 minutes" / "about 1 hour 38 minutes" -- for durations a user waits out. */
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  const seconds = Math.round(ms / 1000);
  if (seconds < 5) return 'a moment';
  if (seconds < 60) return `${seconds} seconds`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} hour${hours === 1 ? '' : 's'}${rest ? ` ${rest} minute${rest === 1 ? '' : 's'}` : ''}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/**
 * Whether the filesystem actually maintains last-access times.
 *
 * On Windows this is a system setting that is frequently turned off, in which
 * case every file's atime equals its mtime and an "last opened" column would be
 * fiction. Probed once and cached.
 *
 * @returns {Promise<{tracked: boolean|null, detail: string}>}
 *          tracked === null means it could not be determined.
 */
let accessTimeProbe = null;
function accessTimesAreTracked() {
  if (accessTimeProbe) return accessTimeProbe;

  accessTimeProbe = (async () => {
    if (!IS_WIN) {
      return {
        tracked: true,
        detail: 'Most Linux and macOS volumes mount with relatime, so access times advance at most once a day.',
      };
    }

    try {
      const { execFile } = require('node:child_process');
      const stdout = await new Promise((resolve, reject) => {
        execFile('fsutil', ['behavior', 'query', 'DisableLastAccess'], { timeout: 5000 }, (err, out) =>
          err ? reject(err) : resolve(out)
        );
      });

      const match = /=\s*(\d+)/.exec(stdout);
      if (!match) {
        return { tracked: null, detail: m('atime.unknown', 'Could not read the NTFS last-access setting.') };
      }

      // 0 and 2 mean updates are enabled; 1 and 3 mean they are disabled.
      const disabled = Number(match[1]) % 2 === 1;
      return disabled
        ? {
            tracked: false,
            detail: m(
              'atime.off',
              'Windows is not recording last-access times on this system, so "last opened" falls back ' +
                'to the modified date.'
            ),
          }
        : {
            tracked: true,
            detail: m('atime.on', 'Windows is recording last-access times on this system.'),
          };
    } catch {
      return { tracked: null, detail: m('atime.unknown', 'Could not read the NTFS last-access setting.') };
    }
  })();

  return accessTimeProbe;
}

module.exports = {
  CancelToken,
  pool,
  throttle,
  pathKey,
  isProtectedPath,
  isProgramInstallPath,
  isUndeletablePath,
  isRoamingAppData,
  isRootOrHome,
  skipReason,
  shouldSkipDir,
  isHiddenName,
  extOf,
  formatBytes,
  formatDuration,
  accessTimesAreTracked,
  IS_WIN,
  SKIP_DIR_NAMES,
  SYSTEM_DIR_NAMES,
  NOISE_DIR_NAMES,
  PROTECTED_ROOTS,
  PROGRAM_INSTALL_ROOTS,
};
