'use strict';

/**
 * `CleanDrive.exe --cli <command> ...` (H1).
 *
 * The same executable as the window, so that one signature covers both. It is
 * a Windows (GUI-subsystem) program, and that has consequences measured on
 * 2026-10-01 which shape everything here:
 *
 * - PowerShell and an interactive cmd do not wait for a GUI program, so typed
 *   bare its output lands after the prompt and its exit code is lost. The
 *   installed `bin\cleandrive.cmd` is a batch file, and cmd does wait for a
 *   program a batch file starts -- that is the way in for people.
 * - Its exit code survives only `app.exit(code)` (`process.exitCode` plus
 *   `app.quit()` exits 0), so `main()` returns the code and main.js exits with it.
 * - Ctrl+C kills it outright. Nothing here can catch that, so nothing here
 *   relies on catching it: every file the commands write is written whole or
 *   not at all, and the journal is appended a line at a time.
 *
 * There is no command that deletes a path it is given. The two that change
 * anything are `run --profile`, which goes through every gate of the
 * unattended run, and `restore`, which only puts back what the journal says
 * the app moved.
 */

const { parse, UsageError, COMMANDS } = require('./args');
const { Output } = require('./output');
const { EXIT, CliError } = require('./codes');

const HANDLERS = Object.freeze({
  scan: () => require('./commands/scan'),
  suggest: () => require('./commands/suggest'),
  snapshots: () => require('./commands/snapshots'),
  diff: () => require('./commands/diff'),
  system: () => require('./commands/system'),
  profiles: () => require('./commands/profiles'),
  run: () => require('./commands/run'),
  journal: () => require('./commands/journal'),
  restore: () => require('./commands/restore'),
  policy: () => require('./commands/policy'),
  version: () => require('./commands/about'),
  help: () => require('./commands/about'),
});

/** What a refusal is called in `--json`, by exit code. */
const ERROR_KIND = Object.freeze({
  [EXIT.ERROR]: 'failed',
  [EXIT.REFUSED]: 'refused',
  [EXIT.LICENCE]: 'licence',
  [EXIT.ADMIN]: 'admin',
  [EXIT.STOPPED]: 'stopped',
  [EXIT.USAGE]: 'usage',
});

const TIER_NAME = Object.freeze({ needsBusiness: 'CleanDrive Business', needsPro: 'CleanDrive Pro', needsAddon: 'the Developer Pack' });

/** The words for a feature this copy does not have. Never a partial run instead. */
function licenceSentence(ctx, feature, what) {
  const reason = ctx.reasonFor(feature);
  if (reason === 'expired') return `The CleanDrive licence has lapsed, so ${what} is not available. Nothing was done.`;
  return `${what} is part of ${TIER_NAME[reason] || 'a CleanDrive plan this copy does not have'}, which this copy does not include. Nothing was done.`;
}

/**
 * @param {string[]} tokens  what follows `--cli`
 * @param {object} [options]
 * @param {object} [options.context]  the services a command uses; built from Electron when absent
 * @param {NodeJS.WritableStream} [options.stdout]
 * @param {NodeJS.WritableStream} [options.stderr]
 * @returns {Promise<number>} the exit code
 */
async function main(tokens, { context = null, stdout, stderr } = {}) {
  // English, whatever the app is set to: see output.js for why.
  require('../../i18n').setLanguage('en');

  const out = new Output({ stdout, stderr, json: (tokens || []).includes('--json') });
  const fail = (code, message, extra = {}) => {
    out.note(`cleandrive: ${message}`);
    out.document({ schema: 'cleandrive.error/1', error: ERROR_KIND[code] || 'failed', exitCode: code, message, ...extra });
    return code;
  };

  let code;
  try {
    let args;
    try {
      args = parse(tokens);
    } catch (err) {
      if (!(err instanceof UsageError)) throw err;
      const spec = err.command ? COMMANDS[err.command] : null;
      if (spec) out.note(`usage: cleandrive ${spec.usage}`);
      else out.note('Run "cleandrive help" for the list of commands.');
      return finish(out, fail(EXIT.USAGE, err.message));
    }
    out.json = Boolean(args.flags.json);

    const ctx = context || require('./context').create();
    const what = `"cleandrive ${[args.command, args.sub].filter(Boolean).join(' ')}"`;
    if (args.spec.feature && !ctx.can(args.spec.feature)) {
      return finish(out, fail(EXIT.LICENCE, licenceSentence(ctx, args.spec.feature, what), { feature: args.spec.feature }));
    }

    const handler = HANDLERS[args.command]();
    code = await handler.run(args, { ...ctx, out, licenceSentence: (feature, thing) => licenceSentence(ctx, feature, thing) });
    if (!Number.isInteger(code)) code = EXIT.OK;
  } catch (err) {
    if (err instanceof CliError) {
      code = fail(err.exit, err.message, err.extra || {});
    } else if (err && err.code === 'ELOCKED') {
      code = fail(EXIT.LICENCE, `${err.message}. Nothing was done.`, err.feature ? { feature: err.feature } : {});
    } else if (err && err.quiet) {
      // The app's own refusals -- a folder that is not there -- already read as sentences.
      code = fail(EXIT.ERROR, err.message);
    } else {
      code = fail(EXIT.ERROR, err && err.message ? err.message : String(err));
      if (err && err.stack && process.env.CLEANDRIVE_CLI_TRACE) out.note(err.stack);
    }
  }
  return finish(out, code);
}

async function finish(out, code) {
  await out.flush();
  return code;
}

module.exports = { main, licenceSentence };
