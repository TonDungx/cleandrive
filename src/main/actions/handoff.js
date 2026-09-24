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
});

const has = (key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(TARGETS, key);

/** What a target opens, as the journal records it. */
function describeTarget(key) {
  const target = TARGETS[key];
  return target.uri || [target.exe(), ...target.args()].join(' ');
}

function launch(key, deps = {}) {
  const target = TARGETS[key];
  if (target.uri) {
    const open = deps.openExternal || require('electron').shell.openExternal;
    return Promise.resolve(open(target.uri));
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
