'use strict';

/**
 * `cleandrive version` and `cleandrive help`.
 *
 * `version` also says where this copy keeps its data, so a script -- and the
 * harness -- can see which files the other commands are about to read.
 */

const { COMMANDS } = require('../args');
const { EXIT } = require('../codes');

const SUMMARY = Object.freeze({
  scan: 'What is in the folders: sizes, largest folders, what could be cleaned. Writes nothing unless --snapshot.',
  suggest: 'The files What to delete would offer, with the reasons. Selects nothing.',
  snapshots: 'The scans kept with --snapshot (or by the window), by the id diff takes.',
  diff: 'What changed in a folder between two of its snapshots.',
  system: 'What the system drive holds besides your files. Needs an elevated terminal.',
  profiles: 'The automatic cleanup profiles, by the id run takes.',
  run: 'One automatic cleanup now, through every gate the scheduled one passes. The only command that moves files.',
  report: 'What this computer sends to the organisation\'s console once a day when a policy asks for it (--json: the file itself). Writes nothing.',
  journal: 'What the app did (list, show) and whether that record is as it was written (verify).',
  restore: 'Put back what one session moved. Never overwrites: a file in the way is skipped.',
  policy: 'What the organisation\'s policy sets here, value by value (validate, or validate a .reg file before rolling it out), and this account\'s scheduled cleanups brought into line with it now (apply) -- with the daily measurement and one machine report at once, when the policy asks for a report.',
  version: 'This copy, and where it keeps its data.',
  help: 'This list, or one command\'s usage.',
});

const CODES = [
  '0   done',
  '1   failed (the message says why)',
  '2   refused by a gate: a profile switched off, a disk below its threshold, a file in the way, a policy value refused',
  '3   not in this licence; nothing was done (policy validate: set, but only CleanDrive Business applies it)',
  '4   needs an elevated terminal; nothing was done',
  '5   started and stopped short',
  '6   journal verify found a sealed session changed, removed or duplicated',
  '64  the command line names nothing this program can act on',
];

async function help(args, ctx) {
  const which = args.positional[0];
  if (which && COMMANDS[which]) {
    ctx.out.line(`usage: cleandrive ${COMMANDS[which].usage}`);
    ctx.out.line('');
    ctx.out.line(SUMMARY[which]);
    return EXIT.OK;
  }
  ctx.out.line('usage: cleandrive <command> [options]');
  ctx.out.line('');
  for (const [name, spec] of Object.entries(COMMANDS)) {
    ctx.out.line(`  ${spec.usage}`);
    ctx.out.line(`      ${SUMMARY[name]}`);
  }
  ctx.out.line('');
  ctx.out.line('--json prints one JSON document on stdout, every character past 0x7E escaped as \\uXXXX,');
  ctx.out.line('with "schema" naming its shape and version. Messages always go to stderr.');
  ctx.out.line('');
  ctx.out.line('Exit codes');
  for (const line of CODES) ctx.out.line(`  ${line}`);
  ctx.out.line('');
  ctx.out.line('Ctrl+C ends the program at once (Windows reports 0xC000013A). Files already moved stay in the journal.');
  return EXIT.OK;
}

async function version(args, ctx) {
  const a = ctx.app;
  const commands = Object.fromEntries(
    Object.entries(COMMANDS).map(([name, spec]) => [name, spec.feature ? ctx.can(spec.feature) : true])
  );
  ctx.out.document({
    schema: 'cleandrive.version/1',
    version: a.version,
    channel: a.channel,
    electron: a.electron,
    node: a.node,
    executable: a.exe,
    dataDir: a.dataDir,
    commands,
  });
  ctx.out.line(`CleanDrive ${a.version} (${a.channel})`);
  ctx.out.line(`data: ${a.dataDir}`);
  const closed = Object.entries(commands).filter(([, ok]) => !ok).map(([name]) => name);
  if (closed.length > 0) ctx.out.line(`not in this licence: ${closed.join(', ')} (they exit 3)`);
  return EXIT.OK;
}

async function run(args, ctx) {
  return args.command === 'version' ? version(args, ctx) : help(args, ctx);
}

module.exports = { run, SUMMARY };
