'use strict';

/**
 * What an organisation can set for CleanDrive through Group Policy or Intune
 * (H2), and where in the registry each one lives.
 *
 * One table, read by three things that must never disagree: the reader that
 * turns the registry into a policy (interpret.js), the ADMX/ADML files an
 * administrator loads into Group Policy (admx.js), and the harness that checks
 * the second writes exactly what the first reads. A value only one of them
 * knew about would be a switch in Group Policy that does nothing, which is
 * worse than no switch: the administrator believes it is set.
 *
 * Everything is under HKEY_LOCAL_MACHINE, the machine half of Group Policy.
 * The app never writes there -- Group Policy, Intune or `reg import` does --
 * and a person without administrator rights cannot either (measured
 * 2026-10-01: a user is refused even under HKCU\Software\Policies).
 *
 * ## Two kinds of policy
 *
 * Decided with the user before this was written (2026-10-01):
 *
 *   - **tighten**: the policy only takes something away -- nothing that
 *     changes a file, no automatic cleanup, fewer categories, more protected
 *     folders, no update check. These apply whatever the licence says. An
 *     administrator's "view only" silently ignored on a machine without
 *     Business would be a safety rail that is not there, and rule 4 of the
 *     roadmap is that a paid tier never lowers safety.
 *   - **acting**: the policy makes the app do something on the organisation's
 *     say -- run a cleanup profile the person at the machine never set up,
 *     copy files to a folder the organisation chose. These are CleanDrive
 *     Business (`biz.policy`), and on a copy without it they are reported as
 *     not applied rather than dropped without a word.
 */

const { ALLOWED_ADVISOR_NAMES } = require('../automatic/allowed-categories');

/** The key, as Group Policy writes it (relative to HKEY_LOCAL_MACHINE). */
const KEY = 'Software\\Policies\\CleanDrive';

/** The same key as reg.exe names it. */
const MACHINE_KEY = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\CleanDrive';

/**
 * Every value the app reads, by the name the code uses for it.
 *
 * `key` is relative to KEY. `list` is a Group Policy list: a subkey whose
 * values are the entries, whatever they are named. `perCategory` is a subkey
 * with one DWORD per category, named after it.
 */
const VALUES = Object.freeze({
  viewOnly: { policy: 'ViewOnly', key: '', valueName: 'ViewOnly', type: 'dword', min: 0, max: 1 },

  automatic: { policy: 'AutomaticCleanup', key: '', valueName: 'AutomaticCleanup', type: 'dword', min: 0, max: 1 },
  autoFolders: { policy: 'AutomaticCleanup', key: 'Automatic\\Folders', list: true, type: 'path' },
  autoSchedule: { policy: 'AutomaticCleanup', key: 'Automatic', valueName: 'Schedule', type: 'string', oneOf: ['daily', 'weekly', 'monthly'] },
  autoTime: { policy: 'AutomaticCleanup', key: 'Automatic', valueName: 'Time', type: 'string' },
  autoWeekday: { policy: 'AutomaticCleanup', key: 'Automatic', valueName: 'Weekday', type: 'dword', min: 0, max: 6 },
  autoDay: { policy: 'AutomaticCleanup', key: 'Automatic', valueName: 'Day', type: 'dword', min: 1, max: 28 },
  autoReportOnly: { policy: 'AutomaticCleanup', key: 'Automatic', valueName: 'ReportOnly', type: 'dword', min: 0, max: 1 },
  autoAction: { policy: 'AutomaticCleanup', key: 'Automatic', valueName: 'Action', type: 'string', oneOf: ['recycle', 'quarantine'] },
  autoMinAgeDays: { policy: 'AutomaticCleanup', key: 'Automatic', valueName: 'MinAgeDays', type: 'dword', min: 7, max: 3650 },
  autoMinDiskUsed: { policy: 'AutomaticCleanup', key: 'Automatic', valueName: 'MinDiskUsedPercent', type: 'dword', min: 0, max: 100 },

  categories: { policy: 'AllowedCategories', key: '', valueName: 'AllowedCategories', type: 'dword', min: 0, max: 1 },
  categoryList: { policy: 'AllowedCategories', key: 'AllowedCategories', perCategory: true, type: 'dword', min: 0, max: 1 },

  protected: { policy: 'ProtectedFolders', key: '', valueName: 'ProtectedFolders', type: 'dword', min: 0, max: 1 },
  protectedList: { policy: 'ProtectedFolders', key: 'ProtectedFolders', list: true, type: 'path' },

  updatesOff: { policy: 'DisableUpdateCheck', key: '', valueName: 'DisableUpdateCheck', type: 'dword', min: 0, max: 1 },

  quarantineFolder: { policy: 'QuarantineFolder', key: '', valueName: 'QuarantineFolder', type: 'path' },
});

/**
 * The policies, in the order Group Policy lists them, and which kind each is.
 * `AutomaticCleanup` is both: switched off it only takes away, switched on it
 * runs the organisation's profile.
 */
const POLICIES = Object.freeze([
  { name: 'ViewOnly', kind: 'tighten' },
  { name: 'AutomaticCleanup', kind: { off: 'tighten', on: 'acting' } },
  { name: 'AllowedCategories', kind: 'tighten' },
  { name: 'ProtectedFolders', kind: 'tighten' },
  { name: 'DisableUpdateCheck', kind: 'tighten' },
  { name: 'QuarantineFolder', kind: 'acting' },
]);

/** The categories a policy may name: the hard list an unattended run may ever touch. */
const CATEGORIES = ALLOWED_ADVISOR_NAMES;

/**
 * The id of the organisation's profile.
 *
 * It has to survive everything an id the app generates survives -- the
 * profile lookup, the Windows task name, and the sweep that removes the tasks
 * of profiles that are gone -- so it has the generated shape (`p` and
 * lower-case letters, settings.js PROFILE_ID_PATTERN). The app never generates
 * it: a generated id is seven characters, and this is six.
 */
const PROFILE_ID = 'policy';

/** Subkeys the reader expects. Anything else under KEY is reported, not read. */
const SUBKEYS = Object.freeze(['', 'Automatic', 'Automatic\\Folders', 'AllowedCategories', 'ProtectedFolders']);

module.exports = { KEY, MACHINE_KEY, VALUES, POLICIES, CATEGORIES, PROFILE_ID, SUBKEYS };
