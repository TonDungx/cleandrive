'use strict';

/**
 * `cleandrive report [--json]` -- what this computer would send to the
 * organisation's console (H3), printed here and written nowhere.
 *
 * Not in the spec. It is there because the spec's promise -- the file names
 * no personal file -- is one a person at the machine, or the IT department
 * deciding whether to switch it on, should be able to check for themselves
 * rather than take on trust. `--json` prints exactly the document the daily
 * measurement writes, byte for byte the same serializer.
 *
 * It runs whether or not a policy asks for a report: "what would you send" has
 * an answer before anybody has switched it on.
 */

const { EXIT } = require('../codes');
const f = require('../format');

async function run(args, ctx) {
  const svc = ctx.services();
  const settings = await svc.settings.load();
  const report = await ctx.buildReport(settings);

  if (ctx.out.json) {
    // The document itself, not wrapped: what goes on the share is what prints.
    // `document()` escapes exactly as `serialize()` does (test-fleet checks
    // the two agree byte for byte).
    ctx.out.document(report);
    return EXIT.OK;
  }

  const asked = settings.managed && settings.managed.report;
  ctx.out.line(
    asked
      ? `This computer writes this report to ${asked.folder} once a day${asked.topFolders ? ', with the largest folders of the last scan' : ''}.`
      : 'No policy asks this computer for a report; this is what one would hold.'
  );
  ctx.out.line(`host ${report.host}, CleanDrive ${report.app.version} (${report.app.channel})`);
  ctx.out.line('');
  if (report.volumes.length === 0) ctx.out.line('drives: none measured in the last week');
  for (const v of report.volumes) {
    const full = v.fullIn && v.fullIn.ok ? `full in about ${Math.round(v.fullIn.days)} day(s)` : `no forecast: ${f.text(v.fullIn && v.fullIn.reason) || 'not enough data'}`;
    ctx.out.line(`drive ${v.root}  ${v.usedPercent.toFixed(1)}% used of ${f.bytes(v.totalBytes)}, ${f.bytes(v.freeBytes)} free; ${full}`);
  }
  const profiles = report.tasks ? report.tasks.profiles : [];
  if (profiles.length === 0) ctx.out.line('cleanup profiles: none');
  for (const p of profiles) {
    const last = p.lastRun ? `last run ${p.lastRun.at} (${p.lastRun.outcome})` : 'never run';
    const code = p.os && p.os.lastResult !== null ? `, Task Scheduler code 0x${p.os.lastResult.toString(16)}` : '';
    ctx.out.line(`profile ${p.id}: ${p.enabled ? 'on' : 'off'}${p.reportOnly ? ', report only' : ''}; task ${p.installed ? (p.verified ? 'registered' : 'registered but wrong') : 'not registered'}; ${last}${code}`);
  }
  if (report.lastScan) {
    ctx.out.line(`last scan: ${report.lastScan.at}, ${report.lastScan.rootKind === 'drive' ? `the whole of ${report.lastScan.drive}` : `a folder on ${report.lastScan.drive || 'the network'}`}, ${Object.keys(report.lastScan.categories).length} categor(ies)${report.lastScan.topFolders ? `, ${report.lastScan.topFolders.length} folder name(s)` : ''}`);
  } else {
    ctx.out.line('last scan: none');
  }
  const seal = report.journal && report.journal.seal;
  ctx.out.line(seal ? `journal: newest seal no. ${seal.n}, ${seal.at}` : 'journal: no seal');
  ctx.out.line('');
  ctx.out.line('No file or folder is named, and no profile by the name a person gave it. "cleandrive report --json" prints the file itself.');
  return EXIT.OK;
}

module.exports = { run };
