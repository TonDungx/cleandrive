#!/usr/bin/env node
'use strict';

// Translation, checked against the source rather than by reading it.
//
//   node scripts/test-i18n.js
//
// Three questions, in order of how much a wrong answer costs:
//
//   1. Does every key the app asks for have a translation? A missing one falls
//      back to English, which is survivable but shows as a half-translated app.
//   2. Does every translation keep the placeholders its English has? This is
//      the expensive one. A `{n}` dropped from a Vietnamese string does not
//      fail, it silently prints a sentence with the number missing -- "Đã
//      chuyển tệp vào Thùng rác" with no count, which is exactly the kind of
//      quietly-wrong text this project is written against.
//   3. Is anything in the dictionary no longer asked for? Dead entries are
//      harmless but they rot, and they hide the keys that do matter.

const fs = require('node:fs');
const path = require('node:path');

const i18n = require('../src/i18n');
require('../src/i18n/vi');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const SRC = path.join(__dirname, '..', 'src');

/**
 * Keys built at runtime rather than written out at the call site.
 *
 * `word(n, 'app.file', …)` asks for `app.file.one` or `app.file.other`; the
 * category, phase and badge tables hold their keys as data. None of them can be
 * found by looking for `t('…')`, so they are declared here instead of being
 * reported as dead weight.
 */
const DYNAMIC_PREFIXES = [
  'app.file.',
  'app.item.',
  'app.location.',
  'app.path.',
  'category.',
  'dupes.phase.',
  // "n other copies" of one file (I3) goes through `word()`.
  'dupes.copyWord.',
  'monitor.level.',
  'trends.measurement.',
  'trends.scan.',
  'update.badge.',
  // An age picks its own key so each language can put the unit where it belongs:
  // `reason.stale.months`, `reason.log.years`, and so on.
  'reason.stale.',
  'reason.archiveStale.',
  'reason.installer.',
  'reason.log.',
  // The photo screen's filter chips are a table in `media.js` rather than a
  // call per label, because the same names are wanted in three places -- the
  // chip, the detail panel's verdict, and the trait list under it.
  'media.origin.',
  'media.trait.label.',
  // The Restore Center's state words are a table in `restore.js`, and its
  // session count goes through `word()`.
  'restore.state.',
  'restore.session.',
  // The map of the folder counts folders through `word()`.
  'map.folder.',
  // The snapshot comparison says how far apart two scans are the same way.
  'changes.day.',
  'changes.hour.',
  'changes.minute.',
  // The quarantine card names a drive's type from a table in `quarantine.js`.
  'quarantine.type.',
  // The colour editor names each colour from the table in theme-palette.js.
  'theme.key.',
];

/* -------------------------------------------------------------------------- */
/* what the app asks for                                                       */
/* -------------------------------------------------------------------------- */

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'i18n') sourceFiles(full, out);
    } else if (/\.(js|html)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// `t(` renders now; `m(` builds a message to be rendered later. Both declare a
// key and carry the English, and a scan that saw only one of them would call a
// dictionary complete while half the app fell back to English.
const CALL = /\b[tm]\(\s*(['"])((?:[^'"\\]|\\.)+?)\1\s*(?:,\s*((?:(['"])(?:[^\\]|\\.)*?\4\s*\+?\s*)+))?/gs;
const ATTR = /data-i18n(?:-title|-aria|-placeholder)?="([^"]+)"/g;

const asked = new Map(); // key -> english (null when it lives in the markup)

for (const file of sourceFiles(SRC)) {
  const src = fs.readFileSync(file, 'utf8');

  for (const match of src.matchAll(CALL)) {
    const key = match[2];
    let english = null;
    if (match[3]) {
      english = [...match[3].matchAll(/(['"])((?:[^\\]|\\.)*?)\1/gs)]
        .map((part) => part[2])
        .join('')
        .replace(/\\'/g, "'");
    }
    if (!asked.has(key) || (english && !asked.get(key))) asked.set(key, english);
  }

  if (file.endsWith('.html')) {
    for (const match of src.matchAll(ATTR)) {
      if (!asked.has(match[1])) asked.set(match[1], null);
    }
  }
}

const keys = [...asked.keys()].sort();

console.log('\ni18n: the app and the dictionary agree\n');

check('the source asks for a meaningful number of keys', keys.length > 400, String(keys.length));

for (const code of i18n.CODES.filter((c) => c !== i18n.FALLBACK)) {
  const missing = i18n.missingKeys(code, keys);
  check(`every key has a ${code} translation`, missing.length === 0,
    missing.length ? `${missing.length} missing: ${missing.slice(0, 6).join(', ')}` : String(keys.length));

  const dead = i18n
    .keysFor(code)
    .filter((key) => !asked.has(key) && !DYNAMIC_PREFIXES.some((prefix) => key.startsWith(prefix)));
  check(`no ${code} entry is dead weight`, dead.length === 0, dead.slice(0, 8).join(', '));

  // Every key a dynamic prefix promises must exist, or the table that builds it
  // falls back to English for one case and not the others -- which reads as a
  // typo rather than a missing translation.
  const dynamic = i18n.keysFor(code).filter((key) => DYNAMIC_PREFIXES.some((p) => key.startsWith(p)));
  check(`the ${code} dictionary carries the runtime-built keys too`, dynamic.length >= 30, String(dynamic.length));
}

/* -------------------------------------------------------------------------- */
/* placeholders                                                                */
/* -------------------------------------------------------------------------- */

console.log('\ni18n: placeholders survive translation\n');

const placeholdersOf = (text) => new Set([...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

for (const code of i18n.CODES.filter((c) => c !== i18n.FALLBACK)) {
  const problems = [];

  for (const key of keys) {
    const english = asked.get(key);
    if (!english) continue; // lives in the markup, and markup has no placeholders

    i18n.setLanguage(code);
    const translated = i18n.t(key, english);
    if (translated === english) continue;

    const wanted = placeholdersOf(english);
    const got = placeholdersOf(translated);

    for (const name of wanted) {
      if (!got.has(name)) problems.push(`${key}: {${name}} dropped`);
    }
    for (const name of got) {
      if (!wanted.has(name)) problems.push(`${key}: {${name}} invented`);
    }
  }

  check(`${code} keeps every placeholder, and invents none`, problems.length === 0,
    problems.slice(0, 6).join(' · '));
}

i18n.setLanguage(i18n.FALLBACK);

/* -------------------------------------------------------------------------- */
/* the core                                                                    */
/* -------------------------------------------------------------------------- */

console.log('\ni18n: falling back, and choosing a language\n');

{
  i18n.setLanguage('en');
  check('English comes from the source, not from a table',
    i18n.t('app.tab.usage', 'Disk usage') === 'Disk usage');
  check('an unknown key falls back to the English beside it',
    i18n.t('nothing.like.this', 'Some English') === 'Some English');
  check('a key with no English at all is not silently blank',
    i18n.t('nothing.like.this') === 'nothing.like.this');

  i18n.setLanguage('vi');
  check('Vietnamese comes from the dictionary',
    i18n.t('app.tab.usage', 'Disk usage') === 'Dung lượng đĩa', i18n.t('app.tab.usage', 'Disk usage'));
  check('an untranslated key still shows English rather than the key',
    i18n.t('nothing.like.this', 'Some English') === 'Some English');

  check('placeholders are filled',
    i18n.t('app.ago.days', '{n} days ago', { n: 4 }) === '4 ngày trước',
    i18n.t('app.ago.days', '{n} days ago', { n: 4 }));
  // "undefined" printed in a sentence reads as a value. The name left as
  // written reads as a bug, which is what it is.
  check('a missing parameter is left as written rather than printed as undefined',
    i18n.t('app.ago.days', '{n} days ago', {}) === '{n} ngày trước');

  i18n.setLanguage('en');
}

{
  check('an explicit choice wins over the system', i18n.resolve('vi', ['en-US', 'en']) === 'vi');
  check('the system list is consulted for "system"', i18n.resolve('system', ['vi-VN']) === 'vi');
  // The display-language list, not the regional format: this machine reports
  // en-US first while formatting dates the Vietnamese way.
  check('the first supported language in the list wins',
    i18n.resolve('system', ['en-US', 'vi']) === 'en');
  check('a language the app does not have falls through to the next',
    i18n.resolve('system', ['fr-FR', 'vi-VN']) === 'vi');
  check('nothing recognisable falls back to English',
    i18n.resolve('system', ['fr-FR', 'de-DE']) === 'en');
  check('an empty list falls back to English', i18n.resolve('system', []) === 'en');
  check('rubbish in the list does not throw', i18n.resolve('system', [null, 42, 'vi']) === 'vi');
}

{
  check('every language has a name in its own script',
    i18n.LANGUAGES.every((l) => typeof l.nativeLabel === 'string' && l.nativeLabel.length > 0),
    i18n.LANGUAGES.map((l) => l.nativeLabel).join(', '));
  check('Vietnamese is offered as "Tiếng Việt"',
    i18n.LANGUAGES.some((l) => l.code === 'vi' && l.nativeLabel === 'Tiếng Việt'));
}

/* -------------------------------------------------------------------------- */
/* English that never reaches a dictionary                                     */
/* -------------------------------------------------------------------------- */

console.log('\ni18n: no English slips past t() on its way to the screen\n');

/*
 * The check that would have caught what the other checks could not.
 *
 * Everything above compares the dictionary against the keys the app *asks for*.
 * A sentence that was never wrapped in `t()` asks for nothing, so it is
 * invisible to all of it -- the dictionary reads as complete while the screen
 * still says "Automatic cleanup is off." in a Vietnamese window. That is
 * exactly how a first pass at this shipped.
 *
 * So this looks at the other end: the positions where text becomes visible, and
 * any string literal sitting in one of them that did not come from `t()` or
 * `m()`.
 */
const SINKS = [
  /\.textContent\s*=\s*([^;]+);/g,
  /\.title\s*=\s*([^;]+);/g,
  /\.placeholder\s*=\s*([^;]+);/g,
  /\btoast\(([\s\S]{0,400}?)\)\s*;/g,
  /\bshowNotice\(\s*'[^']+'\s*,([\s\S]{0,400}?)\)\s*;/g,
  /\breturn\s+('(?:[^'\\]|\\.){4,}'|`(?:[^`\\$]|\\.){4,}`)\s*;/g,
  /\b(?:title|message|detail|body|label|buttons)\s*:\s*([^,\n]{4,200})/g,
  // Producers of text that is displayed elsewhere. `finish('skipped', …)` writes
  // its argument to the run log and the Automatic tab shows it; leaving that
  // one out is how a plain-English reason survived the first pass.
  /\bfinish\(\s*'[^']+'\s*,([\s\S]{0,300}?)\)\s*;/g,
  /\badvice\(\s*'[^']+'\s*,([\s\S]{0,300}?)(?:,\s*'[a-z]+'\s*)?\)/g,
  /\bnotes\.push\(([\s\S]{0,300}?)\)\s*;/g,
];

/**
 * English that is *meant* to stay in the source.
 *
 * `advisor.js` holds the category labels and hints as the fallback the renderer
 * translates from (`t('category.' + group.category, group.label)`), so the
 * English there is the second argument to a `t()` call in another file. It is
 * reached by a computed key, which is why it cannot be spotted automatically.
 */
const ALLOWED_FILES = new Set(['lib/advisor.js']);

function looksLikeProse(text) {
  if (!/[a-z]{3}/.test(text)) return false;
  if (!/\s/.test(text) && text.length < 12) return false;
  if (/^[a-z-]+(\s[a-z-]+)*$/.test(text) && text.length < 24) return false; // class lists
  if (/[#.[\]]/.test(text) && /input|button|div|span|\[data-/.test(text)) return false;
  if (/^[A-Za-z]:[\\/]/.test(text)) return false;
  if (text.includes('/') && !text.includes(' ')) return false;
  if (/^\$\{/.test(text)) return false;
  // `auto.schedule.title` is a key, not a sentence. A sink expression cut at a
  // comma can leave one exposed, and reporting it as untranslated English would
  // be the check crying wolf at the very thing it is asking for.
  if (/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/.test(text)) return false;
  return true;
}

{
  const leaks = [];

  for (const file of sourceFiles(SRC).filter((f) => f.endsWith('.js'))) {
    const rel = path.relative(SRC, file).replace(/\\/g, '/').replace(/^(main|renderer)\//, '');
    if (ALLOWED_FILES.has(rel)) continue;

    const src = fs
      .readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/^(\s*)\/\/.*$/gm, '$1');

    for (const re of SINKS) {
      for (const m of src.matchAll(re)) {
        // Blank out every t(…) and m(…) call, then see what English is left.
        // Blank whole calls first, then any call the sink's own regex cut short
        // -- `title: t('a.key', 'English'),` is captured up to the comma, so
        // the closing paren the first pattern needs is not there.
        const rest = (m[1] || '')
          .replace(/\b[tm]\(\s*(['"])(?:[^'"\\]|\\.)+?\1[\s\S]*?\)/g, 'T')
          .replace(/\b[tm]\(\s*(['"])(?:[^'"\\]|\\.)+?\1/g, 'T');
        for (const lit of rest.matchAll(/'((?:[^'\\]|\\.){3,})'|`((?:[^`\\]|\\.){3,})`/g)) {
          const text = (lit[1] || lit[2] || '').replace(/\\n/g, ' ');

          /*
           * Judge the literal with its interpolations removed.
           *
           * A template literal is usually a computed key (`category.${c}`) or a
           * joining fragment (` · ${parts}`), and both are meant to be there.
           * What is left after stripping `${…}` tells them apart: a real leak
           * still reads as a sentence, so the rule is two or more words of
           * plain English. Single words are left to the key-coverage checks
           * above -- this one is looking for sentences.
           */
          const bare = text.replace(/\$\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim();
          if (!/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(bare)) continue;
          if (looksLikeProse(bare)) leaks.push(`${rel}: "${bare.slice(0, 60)}"`);
        }
      }
    }
  }

  const unique = [...new Set(leaks)];
  check('no user-facing English bypasses the dictionary', unique.length === 0,
    unique.slice(0, 8).join(' · '));
}

/* -------------------------------------------------------------------------- */
/* the house rule                                                              */
/* -------------------------------------------------------------------------- */

console.log('\ni18n: moved is not freed, in either language\n');

{
  i18n.setLanguage('vi');

  // The one distinction this app exists to make. If a translation collapses
  // "moved to the Recycle Bin" and "freed" into the same word, the Vietnamese
  // build is lying where the English one is careful.
  const moved = i18n.t('auto.result.moved', 'Moved to Recycle Bin');
  const freed = i18n.t('auto.result.purged', 'Permanently removed');
  check('"moved to the Recycle Bin" says Thùng rác', /Thùng rác/.test(moved), moved);
  check('"permanently removed" does not', !/Thùng rác/.test(freed), freed);

  const notFreed = i18n.t('notify.done.notFreed', '');
  check('the notification still says the bin is on the same disk',
    /cùng ổ đĩa/.test(notFreed), notFreed);

  const binNote = i18n.t('auto.binNote', '');
  check('the loud notice still says moving frees nothing',
    /không giải phóng/.test(binNote), binNote.slice(0, 60) + '…');

  // The receipt after every delete, and the badge beside every button. Both
  // used to say "freed"; neither may, in either language.
  const receipt = i18n.t('delete.movedToBin', '');
  check('the receipt after a delete says it is not freed yet', /chưa giải phóng/.test(receipt), receipt);
  check('and does not claim anything was freed', !/giải phóng \{/.test(receipt));
  const badge = i18n.t('frees.bin', '');
  check('the badge beside the button says the same', /Chưa giải phóng/.test(badge), badge);
  const dialog = i18n.t('dialog.confirmDelete.detailBin', '');
  check('and the confirmation no longer opens with "this frees"', !/giải phóng/.test(dialog), dialog);

  i18n.setLanguage('en');
}

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
