'use strict';

/**
 * The settings the app acts on, made from the user's file and the
 * organisation's policy -- and the way back (H2).
 *
 * The policy wins, and it never reaches the file. That second half is the one
 * that is easy to get wrong: the screens save whole sections back, so if what
 * they were shown had the policy baked in, the first save would write it into
 * settings.json, and the day the organisation lifted it the person's own
 * choices would be gone -- a profile they had switched on, saved while
 * automatic cleanup was forced off, would come back off. So `effective()` is
 * only ever a view, every locked field has a rule in `toFile()` that puts the
 * file's own value back, and the organisation's profile is never written at
 * all.
 *
 * The result carries a `managed` section that no settings file can produce
 * (coerceSettings does not read one) and that `toFile()` always drops: the
 * one place every reader -- the window, the 02:00 run, the command line -- can
 * learn what is locked, without a second object to pass around and forget.
 */

const path = require('node:path');

const { pathKey } = require('../lib/util');
const { profilesOf } = require('../lib/settings');
const { PROFILE_ID } = require('./schema');
const { anyApplied } = require('./interpret');

const samePath = (a, b) => pathKey(a) === pathKey(b);
const has = (list, p) => list.some((x) => samePath(x, p));

/**
 * Where the zone is for a folder a policy named: the folder itself if it is
 * one already, as `quarantine-zone.prepare` decides it. Loaded only when a
 * policy names one -- every process reads settings through this file, the
 * sub-second daily sampler included.
 */
function zoneFor(folder) {
  const { ZONE_NAME } = require('../lib/quarantine-zone');
  return path.basename(folder).toLowerCase() === ZONE_NAME.toLowerCase() ? folder : path.join(folder, ZONE_NAME);
}

/** What the window may know about the policy: what is locked and what was not applied. Never the registry itself. */
function managedOf(policy) {
  const applied = policy.entries.filter((e) => e.state === 'applied').map((e) => e.policy);
  return {
    active: anyApplied(policy),
    status: policy.status,
    error: policy.error,
    viewOnly: policy.viewOnly,
    automatic: policy.automatic,
    profileId: policy.profile ? policy.profile.id : null,
    categories: policy.categories,
    protectedFolders: policy.protectedFolders,
    updatesOff: policy.updatesOff,
    quarantineZone: policy.quarantineFolder ? zoneFor(policy.quarantineFolder) : null,
    // Where this machine's daily report goes (H3). Shown in the window's line
    // as well as used, so the person at the computer knows it is being sent.
    report: policy.report ? { folder: policy.report.folder, topFolders: policy.report.topFolders } : null,
    applied,
    // Set by the organisation but not applied, so the window can say so
    // rather than let an administrator believe it holds.
    notApplied: policy.entries.filter((e) => e.state === 'needsBusiness').map((e) => e.policy),
    refused: policy.entries.filter((e) => e.state === 'refused').map((e) => e.policy),
  };
}

/**
 * @param {object} file    settings as the file holds them (already coerced)
 * @param {object} policy  from interpret()
 */
function effective(file, policy) {
  const managed = managedOf(policy);
  if (!managed.active) return { ...file, managed };

  const profiles = profilesOf(file)
    // The organisation's id is its own. A file profile could only carry it by
    // being edited by hand, and then it is the one that gives way -- on
    // screen only; the file keeps it, see toFile().
    .filter((p) => !(policy.profile && p.id === PROFILE_ID))
    .map((p) => {
      const out = { ...p };
      if (policy.automatic === 'off') out.enabled = false;
      if (policy.categories) out.categories = p.categories.filter((c) => policy.categories.includes(c));
      if (policy.protectedFolders.length > 0) {
        out.whitelist = [...p.whitelist, ...policy.protectedFolders.filter((f) => !has(p.whitelist, f))];
      }
      return out;
    });
  if (policy.profile) profiles.push(policy.profile);

  return {
    ...file,
    autoClean: { ...file.autoClean, profiles },
    updates: policy.updatesOff ? { ...file.updates, enabled: false } : file.updates,
    quarantine: managed.quarantineZone ? { ...file.quarantine, zone: managed.quarantineZone } : file.quarantine,
    // The report rides on the daily measurement (H3, decided 2026-10-02), so
    // the organisation that asked for one keeps that task on. Measuring
    // deletes nothing; the person's own choice comes back with the policy gone.
    trends: managed.report ? { ...file.trends, dailySample: true } : file.trends,
    managed,
  };
}

/**
 * What to write, given what a screen wants saved (`next`, shaped like
 * `effective()`'s output), what the file holds now, and the policy.
 */
function toFile(next, file, policy) {
  const { managed, ...rest } = next || {};
  const out = { ...rest };
  if (!policy || !anyApplied(policy)) return out;

  if (out.autoClean && Array.isArray(out.autoClean.profiles)) {
    const before = profilesOf(file);
    const byId = new Map(before.map((p) => [p.id, p]));
    const kept = out.autoClean.profiles
      .filter((p) => !(p && (p.managed === true || (policy.profile && p.id === PROFILE_ID))))
      .map((p) => {
        const was = byId.get(p.id);
        const back = { ...p };
        if (policy.automatic === 'off' && was) back.enabled = was.enabled;
        if (policy.categories && Array.isArray(p.categories)) {
          const hidden = was ? was.categories.filter((c) => !policy.categories.includes(c)) : [];
          back.categories = [...p.categories.filter((c) => policy.categories.includes(c)), ...hidden.filter((c) => !p.categories.includes(c))];
        }
        if (policy.protectedFolders.length > 0 && Array.isArray(p.whitelist)) {
          const own = was ? was.whitelist : [];
          back.whitelist = p.whitelist.filter((f) => !has(policy.protectedFolders, f) || has(own, f));
        }
        return back;
      });
    // A profile the file had under the organisation's id stays in the file.
    const shadowed = policy.profile ? before.find((p) => p.id === PROFILE_ID) : null;
    out.autoClean = { ...out.autoClean, profiles: shadowed ? [...kept, shadowed] : kept };
  }

  if (policy.updatesOff && out.updates) out.updates = { ...out.updates, enabled: file.updates.enabled };
  if (policy.quarantineFolder && out.quarantine) out.quarantine = { ...out.quarantine, zone: file.quarantine.zone };
  if (policy.report && out.trends) out.trends = { ...out.trends, dailySample: file.trends.dailySample };
  return out;
}

module.exports = { effective, toFile, managedOf, zoneFor };
