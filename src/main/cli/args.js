'use strict';

/**
 * Reading `cleandrive <command> ...` into something a command can trust.
 *
 * Strict on purpose. A flag this program does not know is refused rather than
 * ignored, because the commands that act on files are exactly the ones where
 * a mistyped `--report-ony` must not quietly become a live run. `--` ends the
 * flags, for a folder whose name starts with a dash.
 *
 * One token is skipped without being a flag of ours: `--user-data-dir=`, which
 * Chromium reads before this code runs (it moves `app.getPath('userData')`).
 * The harnesses use it to keep the command line off the real app's files, and
 * refusing it here would refuse a switch that has already taken effect.
 */

/**
 * Every command, what it takes, and which licence feature it needs.
 *
 * `feature: null` is never asked about at all: the journal and putting things
 * back are readable and undoable at every tier (ROADMAP rule 4), and help and
 * version describe the program rather than use it. `policy` (H2) is not asked
 * either: checking a policy is reading, and the tightening half of one applies
 * to every copy (decided 2026-10-01) -- which half applies is decided where
 * the policy is read, in services.js.
 */
const COMMANDS = Object.freeze({
  scan: { feature: 'biz.cli', positional: [1, Infinity], flags: ['json', 'mft', 'snapshot'], usage: 'scan <folder...> [--mft] [--snapshot] [--json]' },
  suggest: { feature: 'biz.cli', positional: [1, Infinity], flags: ['json'], values: ['category', 'verdict'], usage: 'suggest <folder...> [--category <c>] [--verdict safe|review] [--json]' },
  snapshots: { feature: 'biz.cli', positional: [0, 1], flags: ['json'], usage: 'snapshots [<folder>] [--json]' },
  diff: { feature: 'biz.cli', positional: [2, 2], flags: ['json'], usage: 'diff <snapshot> <snapshot> [--json]' },
  system: { feature: 'biz.cli', positional: [0, 0], flags: ['json'], usage: 'system [--json]' },
  profiles: { feature: 'biz.cli', positional: [0, 0], flags: ['json'], usage: 'profiles [--json]' },
  run: { feature: 'biz.cli', positional: [0, 0], flags: ['json', 'report-only'], values: ['profile'], required: ['profile'], usage: 'run --profile <id> [--report-only] [--json]' },
  report: { feature: 'biz.cli', positional: [0, 0], flags: ['json'], usage: 'report [--json]' },
  journal: {
    feature: null,
    sub: { list: [0, 0], show: [1, 1], verify: [0, 0] },
    flags: ['json'],
    usage: 'journal list|show <session>|verify [--json]',
  },
  restore: { feature: null, positional: [1, 1], flags: ['json', 'dry-run'], usage: 'restore <session> [--dry-run] [--json]' },
  policy: {
    feature: null,
    sub: { validate: [0, 1], apply: [0, 0] },
    flags: ['json'],
    usage: 'policy validate [<file.reg>] | apply [--json]',
  },
  version: { feature: null, positional: [0, 0], flags: ['json'], usage: 'version [--json]' },
  help: { feature: null, positional: [0, 1], flags: [], usage: 'help [<command>]' },
});

const CHROMIUM_OWN = /^--user-data-dir=/;

class UsageError extends Error {
  constructor(message, command = null) {
    super(message);
    this.code = 'EUSAGE';
    this.command = command;
  }
}

/**
 * @param {string[]} tokens  what follows `--cli` on the command line
 * @returns {{command: string, sub: string|null, positional: string[], flags: object, values: object, spec: object}}
 */
function parse(tokens) {
  const list = (tokens || []).filter((t) => typeof t === 'string' && !CHROMIUM_OWN.test(t));
  const helpAsked = list.includes('--help') || list.includes('-h');
  const words = list.filter((t) => t !== '--help' && t !== '-h');

  if (words.length === 0) return { command: 'help', sub: null, positional: [], flags: {}, values: {}, spec: COMMANDS.help };
  const command = words[0];
  if (command.startsWith('-')) throw new UsageError(`Expected a command before ${command}.`);
  const spec = Object.prototype.hasOwnProperty.call(COMMANDS, command) ? COMMANDS[command] : null;
  if (!spec) throw new UsageError(`There is no command called "${command}".`);
  if (helpAsked) return { command: 'help', sub: null, positional: [command], flags: {}, values: {}, spec: COMMANDS.help };

  const flags = {};
  const values = {};
  const positional = [];
  let rest = false;
  for (let i = 1; i < words.length; i++) {
    const token = words[i];
    if (rest || !token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    if (token === '--') {
      rest = true;
      continue;
    }
    const eq = token.indexOf('=');
    const name = token.slice(2, eq === -1 ? undefined : eq);
    if ((spec.values || []).includes(name)) {
      let value = eq === -1 ? words[++i] : token.slice(eq + 1);
      if (value === undefined || value === '' || (eq === -1 && value.startsWith('--'))) {
        throw new UsageError(`--${name} needs a value.`, command);
      }
      if (Object.prototype.hasOwnProperty.call(values, name)) throw new UsageError(`--${name} was given twice.`, command);
      values[name] = value;
      continue;
    }
    if ((spec.flags || []).includes(name)) {
      if (eq !== -1) throw new UsageError(`--${name} takes no value.`, command);
      flags[name] = true;
      continue;
    }
    throw new UsageError(`"${command}" has no option ${token.slice(0, eq === -1 ? undefined : eq)}.`, command);
  }

  let sub = null;
  let range = spec.positional;
  if (spec.sub) {
    sub = positional.shift();
    if (!sub || !Object.prototype.hasOwnProperty.call(spec.sub, sub)) {
      throw new UsageError(`"${command}" needs one of: ${Object.keys(spec.sub).join(', ')}.`, command);
    }
    range = spec.sub[sub];
  }
  const [min, max] = range;
  if (positional.length < min) throw new UsageError(`"${[command, sub].filter(Boolean).join(' ')}" needs ${min === 1 ? 'an argument' : `${min} arguments`}.`, command);
  if (positional.length > max) throw new UsageError(`"${[command, sub].filter(Boolean).join(' ')}" takes ${max === 0 ? 'no arguments' : `at most ${max}`}; got ${positional.length}.`, command);
  for (const name of spec.required || []) {
    if (!Object.prototype.hasOwnProperty.call(values, name)) throw new UsageError(`"${command}" needs --${name}.`, command);
  }
  if (values.verdict !== undefined && !['safe', 'review'].includes(values.verdict)) {
    throw new UsageError('--verdict is safe or review.', command);
  }
  return { command, sub, positional, flags, values, spec };
}

/**
 * Whether this process was started as the command line: `--cli` as the first
 * argument of its own. Anywhere else it is a folder or a value, and must not
 * switch the program into another mode -- nor may any other mode's flag
 * further along, which is why main.js asks this first.
 *
 * @param {string[]} argv      process.argv
 * @param {boolean} packaged   app.isPackaged: a checkout's argv[1] is the app folder
 */
function wanted(argv, packaged) {
  const first = argv[packaged ? 1 : 2];
  return first === '--cli';
}

/** What follows `--cli`. */
function tokensOf(argv, packaged) {
  return argv.slice(packaged ? 2 : 3);
}

module.exports = { parse, wanted, tokensOf, COMMANDS, UsageError };
