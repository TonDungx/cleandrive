'use strict';

/**
 * `cleandrive policy validate [<file.reg>]` and `cleandrive policy apply` (H2).
 *
 * `validate` says what the app makes of a policy, value by value: applied,
 * refused and why, or not applied because this copy does not include
 * CleanDrive Business. With a file -- `reg export` of a reference machine, or
 * the `.reg` a script is about to import -- it checks that before it is rolled
 * out; without one it checks what this computer's registry holds now. It reads
 * and writes nothing else.
 *
 * `apply` brings this account's scheduled cleanups into line with the policy
 * now, rather than the next time somebody opens the window: it is what a logon
 * script runs after Group Policy or Intune has written the registry. It takes
 * no file, unlike the spec's `apply <file>`, on purpose: a file `apply` read
 * would be a second source of policy beside the registry, and one any user
 * could write. The registry is what the organisation's tools manage and what a
 * person without administrator rights cannot change (measured 2026-10-01), and
 * the app itself never writes it.
 *
 * Neither command asks the licence. Checking a policy is reading, and which
 * half of it applies is decided where the policy is read (services.js), the
 * way the journal's seal is.
 */

const fsp = require('node:fs/promises');
const os = require('node:os');

const { readRegFile, MACHINE_KEY } = require('../../policy/read');
const { interpret } = require('../../policy/interpret');
const { EXIT, CliError } = require('../codes');
const f = require('../format');

const STATE = Object.freeze({
  applied: 'applied',
  refused: 'refused',
  needsBusiness: 'not applied: needs CleanDrive Business',
  unknown: 'not read by this version',
  unreadable: 'could not be read',
});

function entriesOf(policy) {
  return policy.entries.map((e) => ({
    policy: e.policy,
    state: e.state,
    message: f.text(e.message),
    problems: (e.problems || []).map((p) => f.text(p)),
    ...(e.profile ? { profile: e.profile } : {}),
    ...(e.categories ? { categories: e.categories } : {}),
    ...(e.folders ? { folders: e.folders } : {}),
    ...(e.folder ? { folder: e.folder } : {}),
  }));
}

/** What the window would show as locked, in one object. */
function effectiveOf(policy) {
  return {
    viewOnly: policy.viewOnly,
    automatic: policy.automatic,
    categories: policy.categories,
    protectedFolders: policy.protectedFolders,
    updatesOff: policy.updatesOff,
    quarantineFolder: policy.quarantineFolder,
    profileId: policy.profile ? policy.profile.id : null,
    report: policy.report,
  };
}

function codeFor(policy) {
  if (policy.status === 'unreadable') return EXIT.ERROR;
  if (policy.entries.some((e) => e.state === 'refused' || e.state === 'unknown')) return EXIT.REFUSED;
  if (policy.entries.some((e) => e.state === 'needsBusiness')) return EXIT.LICENCE;
  return EXIT.OK;
}

function printEntries(ctx, policy) {
  for (const e of entriesOf(policy)) {
    ctx.out.line(`${e.policy || '(other)'}: ${STATE[e.state] || e.state}`);
    ctx.out.line(`  ${e.message}`);
    for (const p of e.problems) ctx.out.line(`  - ${p}`);
  }
}

async function validate(args, ctx) {
  const svc = ctx.services();
  const file = args.positional[0] || null;
  let policy;
  if (file) {
    let bytes;
    try {
      bytes = await fsp.readFile(ctx.resolve(file));
    } catch (err) {
      throw new CliError(EXIT.USAGE, `${file} could not be read (${err.code || err.message}).`);
    }
    const { tree, keys } = readRegFile(bytes, MACHINE_KEY);
    if (!tree) {
      throw new CliError(
        EXIT.USAGE,
        `${file} holds nothing under ${MACHINE_KEY}${keys.length > 0 ? `; it has ${f.count(keys.length)} other key(s)` : ''}.`
      );
    }
    policy = interpret({ status: 'present', key: MACHINE_KEY, via: 'file', tree }, { acting: svc.policy.acting, env: process.env, minMinutes: svc.policy.minMinutes });
  } else {
    policy = await svc.policy.refresh();
  }

  const code = codeFor(policy);
  ctx.out.document({
    schema: 'cleandrive.policy-validate/1',
    generatedAt: f.iso(ctx.now()),
    exitCode: code,
    source: file ? { kind: 'file', file: ctx.resolve(file), key: MACHINE_KEY } : { kind: 'registry', key: policy.key, via: policy.via },
    status: policy.status,
    error: policy.error,
    businessIncluded: svc.policy.acting === true,
    policies: entriesOf(policy),
    effective: effectiveOf(policy),
  });

  const where = file ? ctx.resolve(file) : policy.key || '(no policy key for this copy)';
  if (policy.status === 'none') {
    ctx.out.line(`No CleanDrive policy is set${file ? ` in ${where}` : ` on this computer (${where} does not exist)`}.`);
    return code;
  }
  if (policy.status === 'unreadable') {
    ctx.out.line(`The policy could not be read, so none of it applies: ${policy.error}`);
    return code;
  }
  ctx.out.line(`policy from ${where}${policy.via && policy.via !== 'file' ? ` (read with ${policy.via})` : ''}:`);
  if (policy.entries.length === 0) ctx.out.line('  the key is there but sets nothing.');
  printEntries(ctx, policy);
  return code;
}

/** The account a logon script runs as, and the one a startup script does not. */
function isSystemAccount({ username = safeUser(), home = os.homedir(), envUser = process.env.USERNAME } = {}) {
  return /^system$/i.test(username) || /\\config\\systemprofile/i.test(home) || /\$$/.test(envUser || '');
}

function safeUser() {
  try {
    return os.userInfo().username;
  } catch {
    return '';
  }
}

async function apply(args, ctx) {
  if ((ctx.isSystemAccount || isSystemAccount)()) {
    throw new CliError(
      EXIT.REFUSED,
      'This is running as the SYSTEM account. Scheduled cleanups belong to the person who signs in, so "cleandrive policy apply" ' +
        'has to run as them -- from a logon script or a user-context Intune script -- not from a startup script. Nothing was done.'
    );
  }
  const svc = ctx.services();
  const policy = await svc.policy.refresh();
  if (policy.status === 'unreadable') {
    // Unreadable counts as no policy everywhere else (decided 2026-10-01), but
    // here that would mean taking the organisation's task away because a read
    // failed. Nothing is changed instead.
    throw new CliError(EXIT.ERROR, `The policy could not be read, so no task was changed: ${policy.error}`);
  }

  const store = svc.settings;
  const settings = await store.get();
  let zone = null;
  if (settings.managed.quarantineZone) zone = await ctx.prepareZone(settings.managed.quarantineZone);
  // The cleanup tasks, and the daily measurement only when the policy asks for
  // a report (H3): the report rides on that task, and the policy is what keeps
  // it on. Without one, the measurement is no business of a policy -- a logon
  // script must not register a task nobody asked for.
  const reporting = Boolean(settings.managed.report);
  const reconciled = await ctx.reconcileTasks(settings, { settingsExisted: store.exists, sweep: true, sampler: reporting });
  const problems = [...(reconciled.problems || [])];
  if (zone && !zone.ok) {
    const { zoneReason } = require('../../actions/quarantine');
    problems.push(`The organisation's quarantine folder (${settings.managed.quarantineZone}) could not be made ready: ${f.text(zoneReason(zone.reason))}.`);
  }
  // And one report at once, so the machine is in the console the morning the
  // logon script runs rather than at the next daily measurement.
  const written = reporting ? await ctx.writeReport(settings) : null;
  if (written && !written.ok) problems.push(`The report could not be written to ${written.file} (${written.code}): ${written.error}`);
  const code = problems.length > 0 ? EXIT.REFUSED : EXIT.OK;

  const profiles = (reconciled.profiles || []).map((p) => ({
    profileId: p.profileId,
    taskPath: p.taskPath,
    wanted: p.wanted,
    installed: p.installed,
    ok: p.ok,
  }));
  ctx.out.document({
    schema: 'cleandrive.policy-apply/1',
    generatedAt: f.iso(ctx.now()),
    exitCode: code,
    source: { kind: 'registry', key: policy.key, via: policy.via },
    status: policy.status,
    businessIncluded: svc.policy.acting === true,
    policies: entriesOf(policy),
    effective: effectiveOf(policy),
    settingsFound: store.exists,
    tasks: profiles,
    changes: (reconciled.changes || []).map((c) => f.text(c)),
    problems: problems.map((p) => f.text(p)),
    quarantineZone: zone ? { ok: zone.ok, zone: zone.zone || null, reason: zone.reason || null } : null,
    sampler: reporting && reconciled.sampler ? { taskPath: reconciled.sampler.taskPath, installed: reconciled.sampler.installed, ok: reconciled.sampler.ok } : null,
    report: written ? { ok: written.ok, file: written.file, ms: written.ms, error: written.ok ? null : written.error } : null,
  });

  if (policy.status === 'none') ctx.out.line('No CleanDrive policy is set on this computer; the tasks were checked against the settings alone.');
  else printEntries(ctx, policy);
  ctx.out.line('');
  if ((reconciled.changes || []).length === 0 && problems.length === 0) ctx.out.line('The scheduled tasks already match. Nothing was changed.');
  for (const c of reconciled.changes || []) ctx.out.line(`changed: ${f.text(c)}`);
  for (const p of problems) ctx.out.line(`problem: ${f.text(p)}`);
  if (written && written.ok) ctx.out.line(`report: written to ${written.file}`);
  return code;
}

async function run(args, ctx) {
  return args.sub === 'apply' ? apply(args, ctx) : validate(args, ctx);
}

module.exports = { run, isSystemAccount, codeFor };
