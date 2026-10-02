'use strict';

/**
 * From what the registry holds to what the app will do (H2).
 *
 * Pure: a tree from read.js in, a policy out, plus one entry per policy saying
 * whether it was applied, refused and why, or left unapplied because this copy
 * does not include CleanDrive Business. `cleandrive policy validate` prints the
 * entries; the window draws its locks from the rest.
 *
 * The rule throughout is the unattended run's: every ambiguity resolves towards
 * doing nothing. A value that is there but wrong is refused, never replaced by
 * a default -- an administrator who typed "2:00am" did not ask for 02:00, and a
 * profile with one bad value does not run at all rather than running half of
 * what was meant. Only a value that is *absent* takes its default.
 *
 * Whether the acting half applies is not decided here: this module never asks
 * the licence (services.js does, and passes `acting`).
 */

const path = require('node:path');

const { message: m } = require('../../i18n');
const settingsLib = require('../lib/settings');
const { VALUES, POLICIES, CATEGORIES, PROFILE_ID, SUBKEYS, MACHINE_KEY } = require('./schema');

/** What "no policy" looks like, so callers never test for null. */
function emptyPolicy(overrides = {}) {
  return {
    status: 'none',
    key: null,
    via: null,
    error: null,
    viewOnly: false,
    automatic: null,
    profile: null,
    categories: null,
    protectedFolders: [],
    updatesOff: false,
    quarantineFolder: null,
    report: null,
    entries: [],
    ...overrides,
  };
}

/* ------------------------------------------------------------ the tree */

function scalar(tree, spec) {
  const values = tree[spec.key.toLowerCase()];
  const hit = values && values[spec.valueName.toLowerCase()];
  return hit ? { present: true, value: hit.value } : { present: false };
}

/** A Group Policy list: every value of the subkey, in the order its names sort as numbers. */
function listOf(tree, spec) {
  const values = tree[spec.key.toLowerCase()];
  if (!values) return [];
  return Object.values(values)
    .sort((a, b) => {
      const x = Number(a.name);
      const y = Number(b.name);
      if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
      return a.name.localeCompare(b.name);
    })
    .map((v) => v.value);
}

/** A name is case-insensitive in the registry, and an environment block is too on Windows. */
function expandEnv(text, env) {
  const lower = new Map(Object.entries(env || {}).map(([k, v]) => [k.toLowerCase(), v]));
  let unknown = null;
  const out = String(text).replace(/%([^%\s]+)%/g, (whole, name) => {
    const value = lower.get(name.toLowerCase());
    if (value === undefined || value === '') {
      unknown = unknown || name;
      return whole;
    }
    return value;
  });
  return { text: out, unknown };
}

/**
 * A folder named in a policy, made into a full path on this computer, or the
 * reason it cannot be. `%USERPROFILE%` and friends are expanded for whoever is
 * running -- a policy is one value for every person on the machine. REG_SZ is
 * expanded as well as REG_EXPAND_SZ, which Windows itself would not do: a
 * folder that reads `%USERPROFILE%\Downloads` means one thing whichever type
 * the tool that wrote it picked.
 */
function folder(value, env, { network = false } = {}) {
  if (typeof value !== 'string') return { ok: false, problem: m('policy.problem.notText', 'An entry is not text.') };
  const raw = value.trim();
  if (raw === '') return { ok: false, problem: m('policy.problem.emptyEntry', 'An entry is empty.') };
  const { text, unknown } = expandEnv(raw, env);
  if (unknown) {
    return { ok: false, problem: m('policy.problem.variable', '{path}: %{name}% is not set for this account.', { path: raw, name: unknown }) };
  }
  if (/^\\\\/.test(text)) {
    if (!network) return { ok: false, problem: m('policy.problem.network', '{path} is on the network, and network drives are only ever read.', { path: raw }) };
    return { ok: true, path: path.win32.normalize(text).replace(/\\+$/, '') };
  }
  if (!/^[A-Za-z]:\\/.test(text)) {
    return { ok: false, problem: m('policy.problem.notFull', '{path} is not a full path such as D:\\Data.', { path: raw }) };
  }
  const resolved = path.win32.resolve(text);
  return { ok: true, path: /^[A-Za-z]:\\$/.test(resolved) ? resolved : resolved.replace(/\\+$/, '') };
}

/** A number within its spec, or the problem with it. */
function number(spec, got) {
  if (typeof got.value !== 'number' || !Number.isInteger(got.value)) {
    return { ok: false, problem: m('policy.problem.type', '{name} is not a number in the registry.', { name: spec.valueName }) };
  }
  if ((spec.min !== undefined && got.value < spec.min) || (spec.max !== undefined && got.value > spec.max)) {
    return {
      ok: false,
      problem: m('policy.problem.range', '{name} is {value}, outside {min}–{max}.', { name: spec.valueName, value: got.value, min: spec.min, max: spec.max }),
    };
  }
  return { ok: true, value: got.value };
}

function word(spec, got) {
  if (typeof got.value !== 'string') {
    return { ok: false, problem: m('policy.problem.typeText', '{name} is not text in the registry.', { name: spec.valueName }) };
  }
  const value = got.value.trim().toLowerCase();
  if (spec.oneOf && !spec.oneOf.includes(value)) {
    return {
      ok: false,
      problem: m('policy.problem.oneOf', '{name} is "{value}", which is not one of {allowed}.', { name: spec.valueName, value: got.value, allowed: spec.oneOf.join(', ') }),
    };
  }
  return { ok: true, value };
}

/* ------------------------------------------------------------ the policies */

/**
 * @param {{status: string, key?: string, via?: string, tree?: object, error?: string}} read
 * @param {object} [options]
 * @param {boolean} [options.acting]  whether this copy may apply the acting half (biz.policy)
 * @param {object} [options.env]      the environment `%VAR%` expands from
 * @param {number} [options.minMinutes]
 */
function interpret(read, { acting = false, env = process.env, minMinutes = 1 } = {}) {
  const policy = emptyPolicy({ status: read.status, key: read.key || null, via: read.via || null, error: read.error || null });
  if (read.status === 'unreadable') {
    policy.entries.push({
      policy: null,
      state: 'unreadable',
      message: m('policy.unreadable', 'The organisation’s policy could not be read, so none of it is applied: {error}', { error: read.error || '?' }),
      problems: [],
    });
    return policy;
  }
  const tree = read.tree || {};
  const entry = (name, state, message, extra = {}) => {
    const e = { policy: name, state, message, problems: [], ...extra };
    policy.entries.push(e);
    return e;
  };
  const kindOf = (name, half) => {
    const kind = POLICIES.find((p) => p.name === name).kind;
    return typeof kind === 'string' ? kind : kind[half];
  };
  const gate = (name, half) => kindOf(name, half) === 'tighten' || acting;
  const flag = (spec) => {
    const got = scalar(tree, spec);
    if (!got.present) return { present: false };
    const n = number(spec, got);
    return n.ok ? { present: true, ok: true, on: n.value === 1, value: n.value } : { present: true, ok: false, problem: n.problem };
  };

  /* -- ViewOnly ---------------------------------------------------------- */
  {
    const f = flag(VALUES.viewOnly);
    if (f.present && !f.ok) entry('ViewOnly', 'refused', m('policy.refused', 'Not applied.'), { problems: [f.problem] });
    else if (f.on) {
      policy.viewOnly = true;
      entry(
        'ViewOnly',
        'applied',
        m('policy.viewOnly.applied', 'View only: CleanDrive may not move, delete or change any file on this computer. Putting things back still works.')
      );
    }
  }

  /* -- AllowedCategories (before the profile, which uses it) -------------- */
  {
    const f = flag(VALUES.categories);
    if (f.present && !f.ok) entry('AllowedCategories', 'refused', m('policy.refused', 'Not applied.'), { problems: [f.problem] });
    else if (f.on) {
      const values = tree[VALUES.categoryList.key.toLowerCase()] || {};
      const allowed = [];
      const problems = [];
      for (const { name, value } of Object.values(values)) {
        const key = name.trim().toLowerCase();
        if (!CATEGORIES.includes(key)) {
          problems.push(m('policy.problem.category', '"{name}" is not a category automatic cleanup can use.', { name }));
          continue;
        }
        const n = number({ ...VALUES.categoryList, valueName: name }, { value });
        if (!n.ok) problems.push(n.problem);
        else if (n.value === 1 && !allowed.includes(key)) allowed.push(key);
      }
      // In the advisor's own order, so the screen and the list agree.
      policy.categories = CATEGORIES.filter((c) => allowed.includes(c));
      entry(
        'AllowedCategories',
        'applied',
        policy.categories.length === 0
          ? m('policy.categories.none', 'No category is allowed, so automatic cleanup finds nothing to do.')
          : m('policy.categories.applied', 'Automatic cleanup may use {n} of the {total} categories: {list}.', {
              n: policy.categories.length,
              total: CATEGORIES.length,
              list: policy.categories.join(', '),
            }),
        { problems, categories: policy.categories }
      );
    }
  }

  /* -- ProtectedFolders --------------------------------------------------- */
  {
    const f = flag(VALUES.protected);
    if (f.present && !f.ok) entry('ProtectedFolders', 'refused', m('policy.refused', 'Not applied.'), { problems: [f.problem] });
    else if (f.on) {
      const problems = [];
      const folders = [];
      for (const value of listOf(tree, VALUES.protectedList)) {
        // A protected folder only ever takes something away, so one on the
        // network is accepted: it protects a path nothing here cleans anyway.
        const one = folder(value, env, { network: true });
        if (!one.ok) problems.push(one.problem);
        else if (!folders.some((p) => p.toLowerCase() === one.path.toLowerCase())) folders.push(one.path);
      }
      policy.protectedFolders = folders;
      if (folders.length === 0) {
        entry('ProtectedFolders', 'refused', m('policy.protected.empty', 'The policy is on but names no folder this computer can use.'), { problems });
      } else {
        entry('ProtectedFolders', 'applied', m('policy.protected.applied', '{n} folder(s) are never touched by automatic cleanup.', { n: folders.length }), {
          problems,
          folders,
        });
      }
    }
  }

  /* -- DisableUpdateCheck ------------------------------------------------- */
  {
    const f = flag(VALUES.updatesOff);
    if (f.present && !f.ok) entry('DisableUpdateCheck', 'refused', m('policy.refused', 'Not applied.'), { problems: [f.problem] });
    else if (f.on) {
      policy.updatesOff = true;
      entry('DisableUpdateCheck', 'applied', m('policy.updates.applied', 'CleanDrive does not check for updates on this computer, not even when asked to.'));
    }
  }

  /* -- QuarantineFolder --------------------------------------------------- */
  {
    const got = scalar(tree, VALUES.quarantineFolder);
    if (got.present) {
      const one = folder(got.value, env);
      if (!one.ok) entry('QuarantineFolder', 'refused', m('policy.refused', 'Not applied.'), { problems: [one.problem] });
      else if (!gate('QuarantineFolder')) {
        entry('QuarantineFolder', 'needsBusiness', NEEDS_BUSINESS(), { folder: one.path });
      } else {
        policy.quarantineFolder = one.path;
        entry('QuarantineFolder', 'applied', m('policy.quarantine.applied', 'Files moved to another drive go to a folder inside {path}.', { path: one.path }), {
          folder: one.path,
        });
      }
    }
  }

  /* -- MachineReport (H3) ------------------------------------------------- */
  {
    const got = scalar(tree, VALUES.reportFolder);
    const top = flag(VALUES.reportTopFolders);
    if (got.present) {
      // A share is the point of this one, so a network folder is accepted --
      // it is only ever written to, one small file named after the machine.
      const one = folder(got.value, env, { network: true });
      const problems = top.present && !top.ok ? [top.problem] : [];
      if (!one.ok) entry('MachineReport', 'refused', m('policy.refused', 'Not applied.'), { problems: [one.problem, ...problems] });
      else if (!gate('MachineReport')) {
        entry('MachineReport', 'needsBusiness', NEEDS_BUSINESS(), { folder: one.path });
      } else {
        policy.report = { folder: one.path, topFolders: top.ok === true && top.on === true };
        entry(
          'MachineReport',
          'applied',
          policy.report.topFolders
            ? m(
                'policy.report.appliedTop',
                'Once a day, a summary of this computer’s drives and cleanup tasks is written to {path}, with the names of the largest folders from the last scan. It names no file.',
                { path: one.path }
              )
            : m(
                'policy.report.applied',
                'Once a day, a summary of this computer’s drives and cleanup tasks is written to {path}. It names no file and no folder.',
                { path: one.path }
              ),
          { folder: one.path, problems }
        );
      }
    } else if (top.present) {
      entry('MachineReport', 'refused', m('policy.report.noFolder', 'ReportTopFolders is set, but no folder is named for the report, so nothing is written.'));
    }
  }

  /* -- AutomaticCleanup --------------------------------------------------- */
  {
    const f = flag(VALUES.automatic);
    if (f.present && !f.ok) entry('AutomaticCleanup', 'refused', m('policy.refused', 'Not applied.'), { problems: [f.problem] });
    else if (f.present && f.value === 0) {
      policy.automatic = 'off';
      entry('AutomaticCleanup', 'applied', m('policy.automatic.off', 'Automatic cleanup is off for every profile on this computer.'));
    } else if (f.on) {
      const built = buildProfile(tree, policy, env, minMinutes);
      if (!built.ok) {
        entry(
          'AutomaticCleanup',
          gate('AutomaticCleanup', 'on') ? 'refused' : 'needsBusiness',
          gate('AutomaticCleanup', 'on')
            ? m('policy.automatic.refused', 'The organisation’s profile was not set up, so it does not run.')
            : NEEDS_BUSINESS(),
          { problems: built.problems }
        );
      } else if (!gate('AutomaticCleanup', 'on')) {
        entry('AutomaticCleanup', 'needsBusiness', NEEDS_BUSINESS(), { profile: summary(built.profile) });
      } else {
        policy.automatic = 'on';
        policy.profile = built.profile;
        const notes = policy.viewOnly
          ? [m('policy.automatic.viewOnly', 'View only is also set, so this profile only ever reports what it would do.')]
          : [];
        entry(
          'AutomaticCleanup',
          'applied',
          built.profile.dryRun
            ? m('policy.automatic.onReport', 'The organisation’s profile reports on {n} folder(s) and moves nothing.', { n: built.profile.roots.length })
            : m('policy.automatic.onLive', 'The organisation’s profile cleans {n} folder(s) on a schedule.', { n: built.profile.roots.length }),
          { problems: notes, profile: summary(built.profile) }
        );
      }
    }
  }

  /* -- anything this version does not read ------------------------------- */
  const known = new Map();
  for (const spec of Object.values(VALUES)) {
    const k = spec.key.toLowerCase();
    if (!known.has(k)) known.set(k, new Set());
    if (spec.valueName) known.get(k).add(spec.valueName.toLowerCase());
    if (spec.list || spec.perCategory) known.set(k, null);
  }
  for (const [rel, values] of Object.entries(tree)) {
    if (!SUBKEYS.some((s) => s.toLowerCase() === rel)) {
      entry(null, 'unknown', m('policy.unknown.key', 'CleanDrive does not read the subkey {name}; it was left alone.', { name: rel }));
      continue;
    }
    const names = known.get(rel);
    if (!names) continue;
    for (const { name } of Object.values(values)) {
      if (!names.has(name.toLowerCase())) {
        entry(
          null,
          'unknown',
          rel
            ? m('policy.unknown.valueIn', 'CleanDrive does not read a value called {name} in {key}; it was left alone.', { name, key: rel })
            : m('policy.unknown.value', 'CleanDrive does not read a value called {name}; it was left alone.', { name })
        );
      }
    }
  }

  return policy;
}

const NEEDS_BUSINESS = () =>
  m(
    'policy.needsBusiness',
    'Not applied: this policy makes CleanDrive act on the organisation’s behalf, which is part of CleanDrive Business, and this copy does not include it.'
  );

/** The organisation's profile, or every reason it cannot be one. */
function buildProfile(tree, policy, env, minMinutes) {
  const problems = [];
  const value = (name, check) => {
    const spec = VALUES[name];
    const got = scalar(tree, spec);
    if (!got.present) return undefined;
    const r = check(spec, got);
    if (!r.ok) {
      problems.push(r.problem);
      return undefined;
    }
    return r.value;
  };

  const roots = [];
  const listed = listOf(tree, VALUES.autoFolders);
  for (const entryValue of listed) {
    const one = folder(entryValue, env);
    if (!one.ok) problems.push(one.problem);
    else if (!roots.some((p) => p.toLowerCase() === one.path.toLowerCase())) roots.push(one.path);
  }
  if (listed.length === 0) problems.push(m('policy.problem.noFolders', 'No folders are listed for it to clean.'));

  const kind = value('autoSchedule', word) || 'weekly';
  const timeRaw = scalar(tree, VALUES.autoTime);
  let time = '02:00';
  if (timeRaw.present) {
    if (typeof timeRaw.value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeRaw.value.trim())) {
      problems.push(m('policy.problem.time', 'Time is "{value}", which is not a time of day such as 02:00.', { value: String(timeRaw.value) }));
    } else {
      time = timeRaw.value.trim();
    }
  }
  const weekday = value('autoWeekday', number);
  const day = value('autoDay', number);
  const reportOnly = value('autoReportOnly', number);
  const action = value('autoAction', word) || 'recycle';
  const minAgeDays = value('autoMinAgeDays', number);
  const minDisk = value('autoMinDiskUsed', number);

  const categories = policy.categories || settingsLib.DEFAULT_CATEGORIES;
  if (categories.length === 0) problems.push(m('policy.problem.noCategories', 'No category is allowed, so it would have nothing to clean.'));
  if (problems.length > 0) return { ok: false, problems };

  const raw = {
    id: PROFILE_ID,
    name: null,
    enabled: true,
    // Report-only unless the organisation said otherwise, in so many words:
    // the same first step every profile on this app takes.
    dryRun: reportOnly === undefined ? true : reportOnly === 1,
    action,
    deleteOriginal: false,
    schedule: { kind, time, weekday: weekday === undefined ? 0 : weekday, day: day === undefined ? 1 : day, catchUpAtLogon: false },
    roots,
    whitelist: policy.protectedFolders,
    categories,
    minAgeDays: minAgeDays === undefined ? settingsLib.LIMITS.minAgeDays.fallback : minAgeDays,
    minDiskUsedPercent: minDisk === undefined ? 0 : minDisk,
    // The person at the machine never set this up, so every run that moves
    // anything says so (decided 2026-10-01).
    notify: true,
  };
  // Through the same coercion a profile from the settings file takes, so the
  // organisation's profile is held to exactly the user's limits.
  const { settings, warnings } = settingsLib.coerceSettings(
    { version: settingsLib.SCHEMA_VERSION, autoClean: { profiles: [raw] } },
    { minMinutes }
  );
  const own = warnings.filter((w) => w.startsWith(`autoClean.profiles.${PROFILE_ID}`) || w.startsWith('autoClean.schedule'));
  if (own.length > 0) return { ok: false, problems: own };
  const profile = { ...settingsLib.profilesOf(settings)[0], managed: true };
  return { ok: true, profile };
}

/** What a report says about a profile: no paths of anybody's files, only the policy's own. */
function summary(profile) {
  return {
    id: profile.id,
    roots: profile.roots,
    schedule: profile.schedule,
    reportOnly: profile.dryRun,
    action: profile.action,
    categories: profile.categories,
    minAgeDays: profile.minAgeDays,
    minDiskUsedPercent: profile.minDiskUsedPercent,
  };
}

/** Whether anything at all is applied: the window shows its lock line only then. */
function anyApplied(policy) {
  return policy.entries.some((e) => e.state === 'applied');
}

module.exports = { interpret, emptyPolicy, expandEnv, folder, anyApplied, MACHINE_KEY };
