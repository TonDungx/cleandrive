'use strict';

/**
 * The analyzer behind the System screen (A1): every row of the breakdown as a
 * candidate, so each one carries a verdict, how sure the app is, and the
 * evidence -- what measured it.
 *
 * None of them is ever acted on by the app. The strongest thing a row offers
 * is a `handoff`: the Windows tool that owns that space, opened for the person
 * to decide in. `unattendedEligible` is false for all of them, and no system
 * category is on the automatic whitelist.
 *
 * The walk itself happens before this runs (`system/measure.js`), because the
 * elevated pass needs the walk's list of refused folders; this turns the
 * finished model into rows.
 */

const path = require('node:path');

const { message: m } = require('../../i18n');
const { formatBytes } = require('../lib/util');
const { candidateId, evidence } = require('./contract');

const ID = 'system';

/**
 * Every row the screen can show: what the candidate is, where it is, what the
 * app thinks of it, and which Windows tool owns it.
 *
 *   kind      'folder' where the row is one folder, 'virtual' otherwise
 *   at        the folder, below the drive root
 *   verdict   keep: nothing to do; review: a Windows tool can reclaim some of it
 *   handoff   a key in actions/handoff.js
 *   commands  shown to copy, never run
 */
const ROWS = Object.freeze({
  profile: { kind: 'folder', verdict: 'keep' },
  profileSkipped: { kind: 'virtual', verdict: 'keep' },
  otherFolders: { kind: 'virtual', verdict: 'keep' },
  otherAccounts: { kind: 'folder', at: ['Users'], verdict: 'keep', handoff: 'otherUsers' },
  recycleBin: { kind: 'folder', at: ['$Recycle.Bin'], verdict: 'review', handoff: 'recycleBin' },
  programs: { kind: 'virtual', verdict: 'keep', handoff: 'apps' },
  programData: { kind: 'folder', at: ['ProgramData'], verdict: 'keep' },
  windows: { kind: 'folder', at: ['Windows'], verdict: 'keep' },
  winsxs: { kind: 'folder', at: ['Windows', 'WinSxS'], verdict: 'keep', commands: ['DISM /Online /Cleanup-Image /StartComponentCleanup'] },
  driverStore: { kind: 'folder', at: ['Windows', 'System32', 'DriverStore'], verdict: 'keep' },
  installer: { kind: 'folder', at: ['Windows', 'Installer'], verdict: 'keep' },
  updateCache: { kind: 'folder', at: ['Windows', 'SoftwareDistribution', 'Download'], verdict: 'review', handoff: 'diskCleanup' },
  deliveryOptimization: {
    kind: 'folder',
    at: ['Windows', 'ServiceProfiles', 'NetworkService', 'AppData', 'Local', 'Microsoft', 'Windows', 'DeliveryOptimization'],
    verdict: 'review',
    handoff: 'deliveryOptimization',
  },
  windowsOld: { kind: 'folder', at: ['Windows.old'], verdict: 'review', handoff: 'storage' },
  upgrade: { kind: 'virtual', verdict: 'review', handoff: 'storage' },
  recovery: { kind: 'folder', at: ['Recovery'], verdict: 'keep' },
  systemHidden: { kind: 'folder', at: ['System Volume Information'], verdict: 'keep' },
  hiberfil: {
    kind: 'virtual',
    verdict: 'review',
    handoff: 'powerOptions',
    commands: ['powercfg /hibernate /type reduced', 'powercfg /hibernate off'],
  },
  pagefile: { kind: 'virtual', verdict: 'keep', handoff: 'virtualMemory' },
  swapfile: { kind: 'virtual', verdict: 'keep' },
  restorePoints: { kind: 'virtual', verdict: 'review', handoff: 'systemProtection' },
  reservedStorage: { kind: 'virtual', verdict: 'keep' },
  ntfsMetadata: { kind: 'virtual', verdict: 'keep' },
});

const n = (v) => Number(v || 0).toLocaleString('en-US');

/** What measured a row, strongest first. */
function evidenceFor(row) {
  const list = [];
  const add = (message) => list.push(evidence(list.length + 1, message));

  if (row.needsAdmin && row.bytes === 0) {
    add(row.toolState === 'unreadable'
      ? m('evidence.system.unreadable', 'Windows answered, but not in a form the app could read, so no figure is shown')
      : m('evidence.system.needsAdmin', 'Needs administrator rights to measure'));
    return list;
  }

  switch (row.source) {
    case 'listing':
      add(m('evidence.system.listing', 'Its size from the folder listing: Windows keeps this file open, so it cannot be measured any other way'));
      break;
    case 'tool':
      if (row.key === 'restorePoints') {
        add(m('evidence.system.vss', 'As Windows’ vssadmin reports it: {used} in use, {allocated} set aside, up to {maximum}', {
          used: formatBytes(row.used), allocated: formatBytes(row.bytes), maximum: formatBytes(row.maximum),
        }));
      } else if (row.key === 'ntfsMetadata') {
        add(m('evidence.system.mft', 'The file system’s own index of every file and folder, as fsutil reports it'));
      } else if (row.key === 'reservedStorage') {
        add(m('evidence.system.reserve', 'Space Windows holds back for updates that no file is using yet, as fsutil reports it'));
      } else if (row.key === 'winsxs' && row.dism) {
        add(m('evidence.system.dism', 'As DISM measures it: {actual}, of which {shared} is shared with Windows and {backups} is backups and disabled features', {
          actual: formatBytes(row.dism.actualSize), shared: formatBytes(row.dism.sharedWithWindows), backups: formatBytes(row.dism.backups),
        }));
        if (row.dism.cleanupRecommended) add(m('evidence.system.dismRecommends', 'DISM says a cleanup is recommended'));
      }
      break;
    default:
      add(m('evidence.system.walked', 'Measured by reading every folder in it: {files} files, each counted once however many names it has', {
        files: n(row.files),
      }));
      if (row.source === 'elevated') {
        add(m('evidence.system.elevated', 'Includes folders only an administrator can read, measured with your permission'));
      }
  }

  if (row.refused > 0) {
    add(m('evidence.system.partial', '{n} folders in it could not be read, so it holds at least this much', { n: n(row.refused) }));
  }
  if (row.key === 'winsxs' && !row.dism) {
    add(m('evidence.system.winsxsWalk', 'Files here that are also part of Windows are counted once, wherever they were met first; DISM gives the exact figure with administrator rights'));
  }
  if (row.key === 'profileSkipped') {
    add(m('evidence.system.skipped', 'Folders the other screens leave out: names starting with a dot or $, and node_modules, .git, .venv, __pycache__'));
  }
  if (row.key === 'recycleBin' && row.appBytes > 0) {
    add(m('evidence.system.appBin', '{size} of it was put there by this app, and can be put back from Restore', { size: formatBytes(row.appBytes) }));
  }
  return list;
}

function confidenceFor(row) {
  if (row.needsAdmin && row.bytes === 0) return 'guess';
  if (row.refused > 0) return 'likely';
  if (row.key === 'winsxs' && !row.dism) return 'likely';
  return 'strong';
}

function verdictFor(row, spec) {
  if (row.key === 'winsxs' && row.dism && row.dism.cleanupRecommended) return 'review';
  if (row.key === 'recycleBin' && row.bytes === 0) return 'keep';
  return spec.verdict;
}

function pathFor(row, spec, model) {
  if (row.path) return row.path;
  if (row.key === 'profile') return model.profile || path.join(model.drive, 'Users');
  if (spec.kind === 'folder') return path.join(model.drive, ...spec.at);
  return `${model.drive}${row.key}`;
}

function toCandidate(row, model) {
  const spec = ROWS[row.key];
  if (!spec) return null;
  const verdict = verdictFor(row, spec);
  const actions = spec.handoff ? ['handoff'] : ['none'];
  return {
    id: candidateId(ID, `${model.drive}${row.key}`),
    path: pathFor(row, spec, model),
    kind: spec.kind,
    bytes: Math.max(0, Math.round(row.bytes)),
    category: `system.${row.key}`,
    verdict,
    confidence: confidenceFor(row),
    evidence: evidenceFor(row),
    actions,
    unattendedEligible: false,
    meta: {
      key: row.key,
      group: row.group,
      source: row.source,
      files: row.files || 0,
      refused: row.refused || 0,
      needsAdmin: Boolean(row.needsAdmin && row.bytes === 0),
      parts: (row.parts || []).slice(0, 6),
      moreParts: Math.max(0, (row.parts || []).length - 6),
      handoff: spec.handoff || null,
      commands: spec.commands || [],
      appBytes: row.appBytes || 0,
      dism: row.dism ? { cleanupRecommended: row.dism.cleanupRecommended, reclaimablePackages: row.dism.reclaimablePackages, lastCleanup: row.dism.lastCleanup } : null,
    },
  };
}

const ORDER = Object.keys(ROWS);

const analyzer = {
  id: ID,
  feature: 'free',
  requiresElevation: false,
  categories: ORDER.map((key) => `system.${key}`),

  /** @param {object} ctx  { model } from system/measure.js */
  async *run(ctx) {
    const model = ctx.model;
    const rows = [...model.rows].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
    const ids = [];
    for (const row of rows) {
      const candidate = toCandidate(row, model);
      if (!candidate) continue;
      ids.push(candidate.id);
      yield { type: 'candidate', candidate };
    }
    const { rows: _rows, ...summary } = model;
    yield { type: 'summary', summary: { ...summary, rows: ids } };
  },
};

module.exports = { analyzer, ROWS, ID, toCandidate };
