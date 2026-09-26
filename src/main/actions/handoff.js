'use strict';

/**
 * Handing over to the Windows tool that owns something.
 *
 * Roadmap rule 6: where the app does not act itself, it explains and opens
 * the right tool. The hibernation file, restore points, the component store,
 * a previous Windows installation -- each is removed by Windows, with Windows'
 * own warnings, and the app's part ends at opening the page.
 *
 * The window names a target by key, and only a key from this table opens
 * anything: never a URI or a path the page supplied. Programs are named by
 * absolute path; `ms-settings:` pages were checked against Microsoft's list of
 * them (learn.microsoft.com, "Launch Windows Settings", updated 2026-07) and
 * the programs against this machine's `System32`.
 *
 * **One target takes an argument** (D2, the games list): uninstalling a Steam
 * game is `steam://uninstall/<appid>`, and there is no fixed URI that means
 * "this game". So a key may be written `steamUninstall:1274570`, and the part
 * after the colon has to match the `arg` pattern the target declares -- for
 * that one, up to ten digits and nothing else. The URI is still built here,
 * from a template in this file; what the window supplies is a number, not a
 * URI, and a number that is not a number opens nothing. That this is the
 * command Steam means is not a guess: Steam registers exactly it as the
 * `UninstallString` of every game, under the same Uninstall key the installed
 * apps screen reads.
 *
 * A handoff changes nothing, so it asks for no confirmation. It still goes
 * through the pipeline and into the journal, like every action, as a record
 * of what was opened and when; the Restore Center leaves these out, since
 * there is nothing to put back.
 */

const path = require('node:path');
const { spawn } = require('node:child_process');

const windowsDir = () => process.env.SystemRoot || 'C:\\Windows';
const system32 = (exe) => path.join(windowsDir(), 'System32', exe);
const drive = () => (/^[A-Za-z]:$/.test(process.env.SystemDrive || '') ? process.env.SystemDrive.toUpperCase() : 'C:');

const TARGETS = Object.freeze({
  powerOptions: { exe: () => system32('control.exe'), args: () => ['/name', 'Microsoft.PowerOptions'] },
  virtualMemory: { exe: () => system32('SystemPropertiesPerformance.exe'), args: () => [] },
  systemProtection: { exe: () => system32('SystemPropertiesProtection.exe'), args: () => [] },
  diskCleanup: { exe: () => system32('cleanmgr.exe'), args: () => ['/d', drive().slice(0, 1)] },
  recycleBin: { exe: () => path.join(windowsDir(), 'explorer.exe'), args: () => ['shell:RecycleBinFolder'] },
  storage: { uri: 'ms-settings:storagesense' },
  deliveryOptimization: { uri: 'ms-settings:delivery-optimization' },
  apps: { uri: 'ms-settings:appsfeatures' },
  otherUsers: { uri: 'ms-settings:otherusers' },
  // The games list (D2). `arg` is what makes this one different: see above.
  steamUninstall: { uri: (appid) => `steam://uninstall/${appid}`, arg: /^[0-9]{1,10}$/ },
  steamLibrary: { uri: 'steam://open/games' },
});

/**
 * A key, split from its argument.
 *
 * `null` unless the key names a target and -- if that target takes an
 * argument -- the argument matches the pattern the target declared. A target
 * that takes no argument refuses one, so `apps:something` opens nothing.
 */
function resolve(key) {
  if (typeof key !== 'string' || key.length > 128) return null;
  const at = key.indexOf(':');
  const name = at === -1 ? key : key.slice(0, at);
  const arg = at === -1 ? null : key.slice(at + 1);
  if (!Object.prototype.hasOwnProperty.call(TARGETS, name)) return null;
  const target = TARGETS[name];
  if (target.arg) {
    if (arg === null || !target.arg.test(arg)) return null;
    return { name, target, arg };
  }
  if (arg !== null) return null;
  return { name, target, arg: null };
}

const has = (key) => resolve(key) !== null;

/** What a target opens, as the journal records it. */
function describeTarget(key) {
  const found = resolve(key);
  if (!found) return String(key).slice(0, 80);
  const { target, arg } = found;
  if (target.uri) return typeof target.uri === 'function' ? target.uri(arg) : target.uri;
  return [target.exe(), ...target.args()].join(' ');
}

function launch(key, deps = {}) {
  const found = resolve(key);
  if (!found) return Promise.reject(Object.assign(new Error('Not a Windows tool this app opens'), { code: 'EUNKNOWN' }));
  const { target, arg } = found;
  if (target.uri) {
    const open = deps.openExternal || require('electron').shell.openExternal;
    return Promise.resolve(open(typeof target.uri === 'function' ? target.uri(arg) : target.uri));
  }
  if (deps.spawn) return Promise.resolve(deps.spawn(target.exe(), target.args()));
  return new Promise((resolve, reject) => {
    const child = spawn(target.exe(), target.args(), { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

module.exports = {
  kind: 'handoff',
  feature: 'free',
  allowsFolders: false,
  reversible: 'none',
  TARGETS,
  has,
  resolve,
  describeTarget,

  /** Opening a Windows page frees nothing by itself; what the page does is the person's. */
  freesOnVolume() {
    return false;
  },

  plan(keys) {
    const plan = [];
    const failed = [];
    for (const key of keys) {
      if (has(key)) plan.push({ path: describeTarget(key), key, size: 0 });
      else failed.push({ path: String(key).slice(0, 80), error: 'Not a Windows tool this app opens', code: 'EUNKNOWN' });
    }
    return { plan, failed, totalBytes: 0 };
  },

  describe(planned) {
    return { kind: 'handoff', count: planned.plan.length, bytes: 0, freesOnVolume: false, reversible: 'none', refused: planned.failed.length };
  },

  async apply(planned, options, ctx) {
    const started = Date.now();
    const moved = [];
    const failed = [];
    let recordError = null;
    for (const item of planned.plan) {
      try {
        await launch(item.key, ctx.deps || {});
      } catch (err) {
        failed.push({ path: item.path, error: err.message || 'Could not open it', code: 'ELAUNCH' });
        continue;
      }
      moved.push(item);
      if (ctx.onItem) {
        try {
          await ctx.onItem({ path: item.path, size: 0 });
        } catch (err) {
          recordError = err.message || String(err);
          break;
        }
      }
    }
    return {
      moved,
      failed,
      freedBytes: 0,
      cancelled: false,
      remaining: 0,
      durationMs: Date.now() - started,
      ...(recordError ? { recordError } : {}),
    };
  },
};
