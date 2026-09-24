'use strict';

/**
 * The shape every screen is drawn from.
 *
 * Each tab in this app is a different way of asking "should this go?", and
 * until now each one answered it with its own record: the advisor handed back
 * `{category, verdict, reason}`, the duplicate finder `{keeper, protected}`,
 * the photo scan `{origin, strength, why}`. Three shapes meant three places a
 * verdict could arrive with no evidence beside it, and nothing that would
 * notice.
 *
 * So there is one record, a `Candidate`, and one gate, `validateCandidate`.
 * A candidate that is missing its confidence or its evidence is refused here,
 * which is what makes "every verdict arrives with its evidence" a property of
 * the code rather than a habit of whoever wrote the last screen.
 *
 * @typedef {'certain'|'strong'|'likely'|'guess'} Confidence
 * @typedef {'safe'|'review'|'protected'|'keep'} Verdict
 * @typedef {'recycle'|'quarantine'|'relocate'|'compress'|'dehydrate'
 *          |'archive'|'hardlink'|'handoff'|'none'} ActionKind
 *
 * @typedef Evidence
 *   A translatable sentence -- the same `{ i18n, en, params }` the rest of the
 *   app renders with `render()` -- plus its rank. Rank 1 is the strongest fact;
 *   evidence is ranked, never summed.
 * @property {number} rank
 * @property {string} i18n
 * @property {string} en
 * @property {object} [params]
 *
 * @typedef Candidate
 * @property {string}     id                  stable across scans: hash(analyzerId + path)
 * @property {string}     path
 * @property {'file'|'folder'|'virtual'} kind 'virtual' = hiberfil, restore points...
 * @property {number}     bytes               logical size
 * @property {number}     [bytesOnDisk]       real allocation (compressed, sparse, placeholder)
 * @property {string}     category            declared in categories.js
 * @property {Verdict}    verdict
 * @property {Confidence} confidence
 * @property {Evidence[]} evidence
 * @property {ActionKind[]} actions           valid actions, most appropriate first
 * @property {boolean}    unattendedEligible  false unless safe AND on the automatic whitelist
 * @property {object}     [meta]              whatever else the analyzer's screen needs
 */

const crypto = require('node:crypto');
const path = require('node:path');

const { pathKey } = require('../lib/util');
const { isDeclared } = require('./categories');
const { isAllowedUnattended } = require('../automatic/allowed-categories');

const VERDICTS = Object.freeze(['safe', 'review', 'protected', 'keep']);

/** Strongest first. The order is used for sorting, never for arithmetic. */
const CONFIDENCE = Object.freeze(['certain', 'strong', 'likely', 'guess']);

const ACTION_KINDS = Object.freeze([
  'recycle',
  'quarantine',
  'relocate',
  'compress',
  'dehydrate',
  'archive',
  'hardlink',
  'handoff',
  'none',
]);

const KINDS = Object.freeze(['file', 'folder', 'virtual']);

/**
 * An id that is the same for the same file on the next scan.
 *
 * The path is normalised the way the rest of the app compares paths
 * (case-insensitive on Windows), so `C:\Users\A\x.iso` and `c:\users\a\x.iso`
 * are one candidate. The analyzer's id is part of the key because the same file
 * can be a candidate for two different reasons -- a cache file and a duplicate
 * -- and those are two different decisions.
 */
function candidateId(analyzerId, filePath) {
  return crypto
    .createHash('sha1')
    .update(`${analyzerId}\0${pathKey(filePath)}`)
    .digest('hex')
    .slice(0, 16);
}

/** A ranked sentence, built from an i18n message. */
function evidence(rank, message) {
  return { rank, ...message };
}

/**
 * Refuse a candidate that would put a verdict on screen without its reasons.
 *
 * Throws a TypeError naming the first problem. The registry decides what to do
 * with that -- drop and count in the app, throw in the test harnesses -- but
 * nothing that fails here is ever shown.
 */
function validateCandidate(c) {
  const fail = (what) => {
    const where = c && typeof c.path === 'string' ? ` (${c.path})` : '';
    throw new TypeError(`invalid candidate${where}: ${what}`);
  };

  if (!c || typeof c !== 'object') fail('not an object');
  if (typeof c.id !== 'string' || c.id === '') fail('no id');
  if (typeof c.path !== 'string' || c.path.trim() === '') fail('no path');
  if (c.kind !== 'virtual' && !path.isAbsolute(c.path)) fail('path is not absolute');
  if (!KINDS.includes(c.kind)) fail(`kind "${c.kind}" is not one of ${KINDS.join(', ')}`);
  if (!Number.isFinite(c.bytes) || c.bytes < 0) fail('bytes is not a size');
  if (c.bytesOnDisk !== undefined && (!Number.isFinite(c.bytesOnDisk) || c.bytesOnDisk < 0)) {
    fail('bytesOnDisk is not a size');
  }
  if (typeof c.category !== 'string' || !isDeclared(c.category)) {
    fail(`category "${c.category}" is not declared in categories.js`);
  }
  if (!VERDICTS.includes(c.verdict)) fail(`verdict "${c.verdict}" is not one of ${VERDICTS.join(', ')}`);
  if (!CONFIDENCE.includes(c.confidence)) {
    fail(`confidence "${c.confidence}" is not one of ${CONFIDENCE.join(', ')}`);
  }

  if (!Array.isArray(c.evidence) || c.evidence.length === 0) fail('a verdict with no evidence');
  for (const item of c.evidence) {
    if (!item || !Number.isInteger(item.rank) || item.rank < 1) fail('evidence without a rank');
    if (typeof item.i18n !== 'string' || item.i18n === '') fail('evidence without a message key');
    if (typeof item.en !== 'string' || item.en === '') fail(`evidence ${item.i18n} has no English`);
  }

  if (!Array.isArray(c.actions)) fail('actions is not a list');
  for (const action of c.actions) {
    if (!ACTION_KINDS.includes(action)) fail(`action "${action}" is not an ActionKind`);
  }

  if (typeof c.unattendedEligible !== 'boolean') fail('unattendedEligible is not a boolean');
  // The one rule that is checked twice: here, and again by the automatic run
  // itself, which does not take an analyzer's word for it.
  if (c.unattendedEligible && (c.verdict !== 'safe' || !isAllowedUnattended(c.category))) {
    fail(`unattendedEligible on a ${c.verdict} ${c.category}, which may never run unattended`);
  }

  return c;
}

/** Order for sorting a list by how sure the app is, strongest first. */
function confidenceOrder(confidence) {
  const i = CONFIDENCE.indexOf(confidence);
  return i === -1 ? CONFIDENCE.length : i;
}

module.exports = {
  VERDICTS,
  CONFIDENCE,
  ACTION_KINDS,
  KINDS,
  candidateId,
  evidence,
  validateCandidate,
  confidenceOrder,
};
