'use strict';

/**
 * `cleandrive system` -- what the system drive holds besides your files (A1).
 *
 * The measurement is system/measure.js, the sequence the System screen and
 * `verify-system.js` both run: walk the drive, then the folders the walk was
 * refused and the Windows tools that need an administrator, put together by
 * `breakdown.build()`.
 *
 * Only from an elevated terminal (4 otherwise, with nothing measured). The
 * window can ask Windows for a UAC prompt because somebody is in front of it;
 * a command line may be a script nobody is watching, so it never asks. Run
 * elevated, the helper is started as a child of this process -- elevated by
 * inheritance, no prompt -- and still answers only its fixed read-only list.
 */

const systemMeasure = require('../../system/measure');
const breakdown = require('../../system/breakdown');
const { EXIT, CliError } = require('../codes');
const f = require('../format');

/**
 * The System screen's rows, in the English the screen itself uses
 * (`system.row.*` in renderer/system.js). The JSON carries the key; these are
 * only for the readable report. `scripts/test-cli.js` holds the two together.
 */
const LABELS = Object.freeze({
  profile: 'Your profile',
  profileSkipped: 'In your profile, left out of the other scans',
  otherFolders: 'Other folders at the top of the drive',
  otherAccounts: 'Other accounts and shared folders',
  recycleBin: 'Recycle Bin',
  programs: 'Installed programs',
  programData: 'Data programs share',
  windows: 'Windows',
  winsxs: 'Component store (WinSxS)',
  driverStore: 'Driver store',
  installer: 'Windows Installer cache',
  updateCache: 'Windows Update downloads',
  deliveryOptimization: 'Delivery Optimization cache',
  windowsOld: 'Previous Windows installation',
  upgrade: 'Upgrade and setup leftovers',
  recovery: 'Recovery environment',
  systemHidden: 'System Volume Information',
  hiberfil: 'Hibernation file',
  pagefile: 'Paging file',
  swapfile: 'Swap file for Store apps',
  restorePoints: 'Restore points',
  reservedStorage: 'Reserved storage',
  ntfsMetadata: 'File system index (MFT)',
});

async function run(args, ctx) {
  if (!(await ctx.elevated())) {
    throw new CliError(
      EXIT.ADMIN,
      'Measuring the system drive needs administrator rights: Windows refuses the folders that matter to anybody else. Run this from an elevated terminal. Nothing was measured.'
    );
  }
  const drive = breakdown.driveOf();
  const home = require('node:os').homedir();
  ctx.out.note(`walking ${drive}\\ ...`);
  const walk = await systemMeasure.walk({ drive, home, token: ctx.token, onProgress: () => {} });
  ctx.out.note(`asking Windows' own tools (DISM can take a few minutes) ...`);
  const elevated = await systemMeasure.elevate(walk, { client: ctx.helperClient() });
  if (elevated.declined) throw new CliError(EXIT.ADMIN, 'The helper was refused administrator rights. Nothing was measured.');
  const model = await systemMeasure.model({ walk, elevated, ledger: ctx.services().ledger });

  const rows = [...model.rows].sort((a, b) => b.bytes - a.bytes).map((r) => ({ ...r, label: LABELS[r.key] || r.key }));
  ctx.out.document({ schema: 'cleandrive.system/1', generatedAt: f.iso(ctx.now()), ...model, rows });

  const v = model.volume;
  ctx.out.line(`${model.drive}\\  ${f.bytes(v.usedBytes)} in use of ${f.bytes(v.totalBytes)}, ${f.bytes(v.freeBytes)} free`);
  ctx.out.line('');
  for (const r of rows) {
    const note = r.needsAdmin && r.bytes === 0 ? '  (could not be measured)' : r.refused > 0 ? `  (${f.count(r.refused)} folder(s) still refused)` : '';
    ctx.out.line(`  ${f.pad(f.bytes(r.bytes), 9)}  ${r.label}${note}`);
  }
  ctx.out.line('');
  ctx.out.line(`Explained: ${f.bytes(model.explainedBytes)}. Not explained: ${f.bytes(model.unexplainedBytes)}.`);
  return model.walk.cancelled ? EXIT.STOPPED : EXIT.OK;
}

module.exports = { run, LABELS };
