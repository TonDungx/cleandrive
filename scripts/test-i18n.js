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
  'monitor.level.',
  'trends.measurement.',
  'trends.scan.',
  'update.badge.',
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

const CALL = /\bt\(\s*(['"])((?:[^'"\\]|\\.)+?)\1\s*(?:,\s*((?:(['"])(?:[^\\]|\\.)*?\4\s*\+?\s*)+))?/gs;
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

  i18n.setLanguage('en');
}

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
