'use strict';

/**
 * The analyzer behind the Chat screen (D3): what Zalo and Telegram Desktop
 * have downloaded, and -- for Zalo -- which conversation each piece came from.
 *
 * ## Why this is a screen of its own
 *
 * Both apps keep their data under `AppData\Roaming`, and `lib/scanner.js`
 * marks everything there `hard`-blocked so that `lib/advisor.js` will never
 * call any of it disposable. That guard is correct: Roaming is where settings,
 * accounts and sessions live. It also means D3 cannot arrive through the
 * ordinary "What to delete" path, so it arrives the way Games and Apps do --
 * its own tab, its own scan, behind `pro.chat`.
 *
 * ## What is never read
 *
 * `%APPDATA%\ZaloData\Database` is 1,239.8 MB on this machine and is not
 * opened, listed, or offered. Neither is any `.db`, any `Local Storage`, or
 * the `.rescache` index Zalo writes beside its files. The roadmap's privacy
 * decision is that the app does not read messages even where that would make
 * the work easier, and this is where it would have been easier.
 *
 * The cost is visible and is stated on screen: a conversation is named by its
 * raw id, because the name is in the database.
 *
 * ## Rows come in two grains, and only one of them can be acted on
 *
 * Exactly the arrangement `duplicates.js` settled on for folders. A
 * conversation is a `folder` row carrying no action -- `actions/recycle.js`
 * and `actions/quarantine.js` both refuse a directory, and B2's `execute()`
 * now enforces that rather than leaving it a comment. What a button acts on is
 * each file inside, which is its own `file` row.
 *
 * ## Nothing here is ever `safe`, and nothing is ever automatic
 *
 * A photo somebody sent is not a cache. It may be the only copy: Zalo's own
 * confirmation makes no promise that the server still has it, and this app is
 * in no position to make one either. So every row is `review`, nothing is
 * ticked in advance, and `unattendedEligible` is false throughout.
 *
 * Zalo's *browser* caches are a different thing and are not here: they went to
 * D4 (`analyzers/app-caches/zalo.json`), where the machinery for "this folder
 * is a cache, the app rebuilds it, skip while it is open" already exists.
 */

const { message: m } = require('../../i18n');
const { formatBytes } = require('../lib/util');
const { candidateId, evidence } = require('./contract');

const ID = 'chat';

const n = (v) => Number(v || 0).toLocaleString('en-US');

/** What each app calls itself on screen. */
const APP_NAMES = Object.freeze({ zalo: 'Zalo', telegram: 'Telegram Desktop' });

/**
 * A plain-words name for each kind of thing Zalo downloads.
 *
 * Zalo's folder names are its own and several of them mislead: `Cache` holds
 * original photographs, `fileNoise` holds documents, `richThumb` holds link
 * previews. Left untranslated they would each be a wrong guess on screen.
 */
const KIND_LABELS = Object.freeze({
  picture: m('chat.kind.picture', 'Photos, re-encoded by Zalo'),
  Cache: m('chat.kind.cache', 'Photos as they arrived'),
  video: m('chat.kind.video', 'Videos'),
  voice: m('chat.kind.voice', 'Voice messages'),
  file: m('chat.kind.file', 'Files people sent'),
  fileNoise: m('chat.kind.fileNoise', 'Files, kept in a form only Zalo reads'),
  fileThumb: m('chat.kind.fileThumb', 'File thumbnails'),
  richThumb: m('chat.kind.richThumb', 'Link previews'),
  zinstant: m('chat.kind.zinstant', 'Interface pieces Zalo downloaded'),
  sticker: m('chat.kind.sticker', 'Stickers'),
  cache: m('chat.kind.tgCache', 'Anything Telegram cached'),
  media_cache: m('chat.kind.tgMediaCache', 'Pictures and video Telegram cached'),
  update: m('chat.kind.update', 'A downloaded update'),
});

const labelFor = (kind) => KIND_LABELS[kind] || m('chat.kind.other', 'Other downloads');

/**
 * The sentence the roadmap asks for on every confirmation.
 *
 * Written as two claims, because only the first is something this app knows.
 * Whether Zalo can fetch a given picture again depends on how old the message
 * is and on what the server still holds, and neither is knowable from here --
 * so it is phrased as the uncertainty it is rather than as a reassurance.
 */
const REMOVAL_NOTE = m(
  'chat.removalNote',
  'Deleting these removes them from this computer, not from the conversation. Whether the app can fetch one again depends on whether it is still on the server — assume it cannot.'
);

/* -------------------------------------------------------------------------- */
/* rows                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The verdict and actions a row gets, given whether its app is open.
 *
 * Same three-state rule the known-app caches use: open means hold everything
 * back, and "could not tell" means hold everything back too. Not being able to
 * read the process list is not permission to guess.
 */
function gateFor(running, app, actions) {
  if (running === null) {
    return {
      verdict: 'keep',
      actions: ['none'],
      note: m('evidence.chat.processUnknown', 'Whether {app} is running could not be checked, so nothing here is offered for removal', {
        app: APP_NAMES[app] || app,
      }),
    };
  }
  if (running[app]) {
    return {
      verdict: 'keep',
      actions: ['none'],
      note: m('evidence.chat.appOpen', '{app} is open — close it and scan again', { app: APP_NAMES[app] || app }),
    };
  }
  return { verdict: 'review', actions, note: null };
}

const dateOf = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(0, 10) : null);

function conversationEvidence(conversation, gate) {
  const list = [];
  const add = (message) => list.push(evidence(list.length + 1, message));

  if (gate.note) add(gate.note);

  add(conversation.group
    ? m('evidence.chat.group', 'A group chat. Its id begins with “g”, which is the only thing that distinguishes one here')
    : m('evidence.chat.direct', 'A one-to-one conversation'));

  add(m('evidence.chat.noName', 'Shown by id because the name is in Zalo’s message database, and this app does not open it'));

  const first = dateOf(conversation.earliest);
  const last = dateOf(conversation.latest);
  if (first && last) {
    add(first === last
      ? m('evidence.chat.oneDay', 'Everything here arrived on {day}', { day: first })
      : m('evidence.chat.span', 'From {first} to {last}', { first, last }));
  }

  // What kinds are in it is deliberately *not* an evidence sentence. Building
  // one means pasting a label into a parameter, and a parameter is not
  // translated -- an early draft read "1.0 MB photos, re-encoded by zalo" in
  // English and would have read the same in Vietnamese. The breakdown is on
  // the row itself, from `meta.byKind`, where each label is its own message.
  add(m('evidence.chat.spread', 'Spread over {n} kinds of download, each with its own size', {
    n: n(conversation.byKind.length),
  }));

  // The finding this screen exists to surface. Stated as a measurement of this
  // conversation, not as advice: the smaller copy is the one nothing on this
  // machine can open, so "delete the duplicate" would point at the wrong file.
  if (conversation.pairedCount > 0) {
    add(m('evidence.chat.paired', '{n} of these photos are kept twice — once as Zalo received them and once re-encoded. The copies as received come to {size}, and they are the ones this computer can actually open', {
      n: n(conversation.pairedCount),
      size: formatBytes(conversation.pairedCacheBytes),
    }));
  }

  add(REMOVAL_NOTE);
  return list;
}

function conversationCandidate(conversation, running) {
  const gate = gateFor(running, 'zalo', []);
  return {
    id: candidateId(ID, conversation.path),
    path: conversation.path,
    kind: 'folder',
    bytes: Math.max(0, Math.round(conversation.bytes)),
    category: 'chat.conversation',
    verdict: gate.verdict === 'keep' ? 'keep' : 'review',
    confidence: 'certain',
    evidence: conversationEvidence(conversation, gate),
    // No action on a folder, the same as `dupes.folder`: what a button acts on
    // is each file inside.
    actions: [],
    unattendedEligible: false,
    meta: {
      app: 'zalo',
      folderRow: true,
      conversationId: conversation.id,
      group: conversation.group,
      account: conversation.account,
      files: conversation.files,
      earliest: conversation.earliest,
      latest: conversation.latest,
      pairedCount: conversation.pairedCount,
      pairedCacheBytes: conversation.pairedCacheBytes,
      byKind: conversation.byKind.map((k) => ({ kind: k.kind, bytes: k.bytes, files: k.files.length, label: labelFor(k.kind) })),
    },
  };
}

function sharedCandidate(group, app, running) {
  const gate = gateFor(running, app, []);
  const list = [];
  const add = (message) => list.push(evidence(list.length + 1, message));

  if (gate.note) add(gate.note);
  // Same reason as the conversation row: the kind's label is its own message
  // and belongs on the row, not pasted into a parameter that never gets
  // translated. The row draws it from `meta.label`.
  add(m('evidence.chat.shared', '{size} in {n} files, and nothing here says which conversation any of it belongs to', {
    size: formatBytes(group.bytes),
    n: n(group.files.length),
  }));
  add(app === 'zalo'
    ? m('evidence.chat.sharedZalo', 'Zalo keeps these in one folder for the whole account, so there is no way to tell which chat any of them belongs to without reading the message database')
    : m('evidence.chat.sharedTelegram', 'Telegram names nothing here after a conversation. Its caches are addressed by content, and the only place a chat is identified is the message store, which this app does not open'));
  add(REMOVAL_NOTE);

  return {
    id: candidateId(ID, group.path),
    path: group.path,
    kind: 'folder',
    bytes: Math.max(0, Math.round(group.bytes)),
    category: 'chat.shared',
    verdict: gate.verdict === 'keep' ? 'keep' : 'review',
    confidence: 'certain',
    evidence: list,
    actions: [],
    unattendedEligible: false,
    meta: {
      app,
      folderRow: true,
      kind: group.kind,
      label: labelFor(group.kind),
      files: group.files.length,
      account: group.account || null,
    },
  };
}

/**
 * The staged Telegram update.
 *
 * The one row on this screen that is not media, and it earns its place by
 * being five times the size of everything else Telegram keeps. It is also the
 * row most likely to be got wrong: it looks like an installer nobody needs,
 * and it is a downloaded update waiting to be applied. Both version numbers
 * go in the evidence so that the row argues for itself either way.
 */
function updateCandidate(update, running) {
  const gate = gateFor(running, 'telegram', []);
  const list = [];
  const add = (message) => list.push(evidence(list.length + 1, message));

  if (gate.note) add(gate.note);

  if (update.stagedVersion && update.installedVersion) {
    add(update.newer !== null && update.newer > 0
      ? m('evidence.chat.updatePending', 'Telegram {staged} has been downloaded and unpacked, waiting to replace the {installed} you are running', {
        staged: update.stagedVersion, installed: update.installedVersion,
      })
      : m('evidence.chat.updateApplied', 'Telegram {staged} is unpacked here and {installed} is what runs, so this is a copy of an update that has already been dealt with', {
        staged: update.stagedVersion, installed: update.installedVersion,
      }));
  } else {
    add(m('evidence.chat.updateUnknown', 'An unpacked Telegram update. The two version numbers could not be read, so whether it is still waiting to be applied is not known here'));
  }

  const staged = dateOf(update.stagedAt);
  if (staged) add(m('evidence.chat.updateWhen', 'Downloaded {day}', { day: staged }));

  add(m('evidence.chat.updateCost', 'Deleting it is not reclaiming rubbish: Telegram downloads the {size} again the next time it updates', {
    size: formatBytes(update.bytes),
  }));

  return {
    id: candidateId(ID, update.path),
    path: update.path,
    kind: 'folder',
    bytes: Math.max(0, Math.round(update.bytes)),
    category: 'chat.update',
    verdict: gate.verdict === 'keep' ? 'keep' : 'review',
    // The size is exact; whether it is still wanted is not, and that is what
    // the evidence is for rather than the confidence.
    confidence: 'certain',
    evidence: list,
    actions: [],
    unattendedEligible: false,
    meta: {
      app: 'telegram',
      folderRow: true,
      kind: 'update',
      label: labelFor('update'),
      stagedVersion: update.stagedVersion,
      installedVersion: update.installedVersion,
      newer: update.newer,
      stagedAt: update.stagedAt,
      files: update.files.length,
    },
  };
}

/** One file: this is what a button acts on. */
function fileCandidate(file, group, app, owner, running) {
  const gate = gateFor(running, app, ['recycle', 'quarantine']);
  return {
    id: candidateId(ID, file.path),
    path: file.path,
    kind: 'file',
    bytes: Math.max(0, file.size),
    category: 'chat.file',
    verdict: gate.verdict === 'keep' ? 'keep' : 'review',
    confidence: 'certain',
    evidence: [evidence(1, gate.note || m('evidence.chat.file', 'Downloaded by {app}', {
      app: APP_NAMES[app] || app,
    }))],
    actions: gate.actions,
    unattendedEligible: false,
    meta: {
      app,
      kind: group.kind,
      // Which folder row this file belongs to, so the screen can fold it in
      // without matching on paths.
      owner,
      sentAt: Number.isFinite(file.sentAt) ? file.sentAt : null,
      mtimeMs: file.mtimeMs,
      variant: file.variant || null,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* the analyzer                                                                */
/* -------------------------------------------------------------------------- */

const analyzer = {
  id: ID,
  feature: 'pro.chat',
  requiresElevation: false,
  categories: ['chat.conversation', 'chat.shared', 'chat.update', 'chat.file'],

  /** @param {object} ctx  { model } from chat/measure.js */
  async *run(ctx, token) {
    const model = ctx.model;
    const running = model.running;

    const conversations = [];
    const shared = [];
    const updates = [];
    let fileRows = 0;

    /* -- Zalo, by conversation (Level 3) ---------------------------------- */

    for (const conversation of model.zalo.conversations) {
      if (token && token.cancelled) break;
      const row = conversationCandidate(conversation, running);
      conversations.push(row.id);
      yield { type: 'candidate', candidate: row };

      for (const group of conversation.byKind) {
        for (const file of group.files) {
          if (token && token.cancelled) break;
          fileRows += 1;
          yield { type: 'candidate', candidate: fileCandidate(file, group, 'zalo', row.id, running) };
        }
      }
    }

    /* -- what belongs to no conversation ---------------------------------- */

    for (const group of model.zalo.shared) {
      if (token && token.cancelled) break;
      const row = sharedCandidate(group, 'zalo', running);
      shared.push(row.id);
      yield { type: 'candidate', candidate: row };
      for (const file of group.files) {
        fileRows += 1;
        yield { type: 'candidate', candidate: fileCandidate(file, group, 'zalo', row.id, running) };
      }
    }

    for (const account of model.telegram.accounts) {
      for (const group of account.caches) {
        if (token && token.cancelled) break;
        const row = sharedCandidate({ ...group, account: account.id }, 'telegram', running);
        shared.push(row.id);
        yield { type: 'candidate', candidate: row };
        for (const file of group.files) {
          fileRows += 1;
          yield { type: 'candidate', candidate: fileCandidate(file, group, 'telegram', row.id, running) };
        }
      }
    }

    /* -- the staged update ------------------------------------------------- */

    if (model.telegram.update) {
      const row = updateCandidate(model.telegram.update, running);
      updates.push(row.id);
      yield { type: 'candidate', candidate: row };
      const group = { kind: 'update', files: model.telegram.update.files };
      for (const file of model.telegram.update.files) {
        fileRows += 1;
        yield { type: 'candidate', candidate: fileCandidate(file, group, 'telegram', row.id, running) };
      }
    }

    /* -- the summary ------------------------------------------------------- */

    const strip = (app) => {
      const { conversations: _c, shared: _s, accounts, update, ...rest } = app;
      return {
        ...rest,
        accounts: (accounts || []).map((a) => ({ id: a.id, bytes: a.bytes || 0, files: a.files || 0 })),
        hasUpdate: Boolean(update),
      };
    };

    yield {
      type: 'summary',
      summary: {
        durationMs: model.durationMs,
        cancelled: Boolean(model.cancelled || (token && token.cancelled)),
        running,
        rows: { conversations, shared, updates },
        fileRows,
        zalo: strip(model.zalo),
        telegram: strip(model.telegram),
        // Said out loud in the summary rather than left to be noticed: this is
        // the whole reason Telegram has no conversation rows.
        conversationsFrom: ['zalo'],
      },
    };
  },
};

module.exports = {
  analyzer,
  ID,
  conversationCandidate,
  sharedCandidate,
  updateCandidate,
  fileCandidate,
  gateFor,
  labelFor,
  KIND_LABELS,
  APP_NAMES,
  REMOVAL_NOTE,
};
