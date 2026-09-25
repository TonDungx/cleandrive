#!/usr/bin/env node
'use strict';

// The user's own colours (I2): what a theme file may be, and the rules it must
// pass before the app draws with it.
//
//   node scripts/test-theme.js
//
// The module under test is src/shared/theme-palette.js, which both the main
// process (on save and on import) and the colour editor run. Four things are
// held here:
//
//   1. the arithmetic -- WCAG contrast and CIEDE2000 -- against published
//      reference values, not against itself;
//   2. the built-in palettes against styles.css, so the eleven colours a
//      template starts from are the ones the app really draws, and against
//      the rules, so the app does not ask of a user's theme what it fails
//      itself;
//   3. the shape of a theme: only #rrggbb, only the eleven known colours,
//      nothing that could become CSS the app did not write;
//   4. that every rule refuses what it exists to refuse.

const fs = require('node:fs');
const path = require('node:path');

const T = require('../src/shared/theme-palette');
const i18n = require('../src/i18n');
require('../src/i18n/vi');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

/* -------------------------------------------------------------------------- */
console.log('\ntheme: the arithmetic, against published values\n');

// Sharma, Wu & Dalal (2005), "The CIEDE2000 color-difference formula:
// implementation notes, supplementary test data, and mathematical
// observations", Table 1. Pairs 9-13 sit on the hue discontinuities the paper
// was written to catch.
const SHARMA = [
  [1, [50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
  [2, [50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
  [3, [50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
  [7, [50, 0, 0], [50, -1, 2], 2.3669],
  [8, [50, -1, 2], [50, 0, 0], 2.3669],
  [9, [50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
  [10, [50, 2.49, -0.001], [50, -2.49, 0.001], 7.1792],
  [11, [50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195],
  [12, [50, 2.49, -0.001], [50, -2.49, 0.0012], 7.2195],
  [13, [50, -0.001, 2.49], [50, 0.0009, -2.49], 4.8045],
  [17, [50, 2.5, 0], [73, 25, -18], 27.1492],
  [18, [50, 2.5, 0], [61, -5, 29], 22.8977],
  [19, [50, 2.5, 0], [56, -27, -3], 31.903],
  [20, [50, 2.5, 0], [58, 24, 15], 19.4535],
  [25, [60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [26, [63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.263],
  [27, [61.2901, 3.7196, -5.3901], [61.4292, 2.248, -4.962], 1.8731],
];
const off = SHARMA.map(([n, a, b, want]) => [n, T.deltaE2000(a, b), want]).filter(([, got, want]) => Math.abs(got - want) > 1e-4);
check(`CIEDE2000 matches all ${SHARMA.length} reference pairs to four decimals`, off.length === 0,
  off.map(([n, got, want]) => `#${n}: ${got.toFixed(4)} vs ${want}`).join('; '));

check('WCAG contrast: black on white is 21:1', Math.abs(T.contrast('#000000', '#ffffff') - 21) < 1e-9);
check('WCAG contrast: a colour on itself is 1:1', T.contrast('#5b8cff', '#5b8cff') === 1);
// #767676 is the lightest grey commonly quoted as passing 4.5:1 on white.
check('WCAG contrast: #767676 on white passes 4.5:1, #777777 does not',
  T.contrast('#767676', '#ffffff') >= 4.5 && T.contrast('#777777', '#ffffff') < 4.5,
  `${T.contrast('#767676', '#ffffff').toFixed(3)} / ${T.contrast('#777777', '#ffffff').toFixed(3)}`);
check('mix is color-mix(in srgb): halfway between black and white is #808080', T.mix('#000000', '#ffffff', 0.5) === '#808080');

/* -------------------------------------------------------------------------- */
console.log('\ntheme: the built-in palettes are what the app draws\n');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('\n}', css.indexOf(':root {')));
const tokens = {};
for (const match of rootBlock.matchAll(/(--[\w-]+):\s*light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)/gi)) {
  tokens[match[1]] = { light: match[2].toLowerCase(), dark: match[3].toLowerCase() };
}
const SOURCE = {
  background: '--bg',
  surface: '--surface',
  border: '--control-border',
  text: '--text',
  textSecondary: '--text-2',
  textTertiary: '--text-3',
  accent: '--accent',
  onAccent: '--on-accent',
  good: '--good',
  warn: '--warn',
  danger: '--danger-text',
};
for (const base of ['light', 'dark']) {
  const wrong = T.KEYS.filter((key) => !tokens[SOURCE[key]] || tokens[SOURCE[key]][base] !== T.BASES[base][key]);
  check(`the ${base} template is the ${base} theme in styles.css, colour for colour`, wrong.length === 0,
    wrong.map((k) => `${k}: ${T.BASES[base][k]} vs ${tokens[SOURCE[k]] && tokens[SOURCE[k]][base]}`).join('; '));
  const verdict = T.check(T.template(base));
  check(`and the ${base} theme passes every rule a custom one must`, verdict.ok,
    verdict.failures.map((f) => `${f.key} on ${f.against} ${f.value}`).join('; '));
}

const declared = new Set([...rootBlock.matchAll(/(--[\w-]+):/g)].map((m) => m[1]));
const unknown = T.TOKENS.filter((token) => !declared.has(token));
check('every token a custom theme sets is one the stylesheet declares', unknown.length === 0, unknown.join(', '));
// Every colour token in :root that depends on the theme must be one a custom
// palette replaces -- otherwise a built-in colour leaks into a custom theme.
// The shadows and the sheen follow color-scheme, which the palette's base sets.
const FOLLOWS_SCHEME = new Set(['--shadow-edge', '--shadow-lift', '--sheen', '--sheen-strong']);
const themed = [...rootBlock.matchAll(/(--[\w-]+):\s*light-dark\(/g)].map((m) => m[1]);
const leaks = themed.filter((token) => !T.TOKENS.includes(token) && !FOLLOWS_SCHEME.has(token));
check('and no themed token is left for the built-in palette to fill in', leaks.length === 0, leaks.join(', '));

/* -------------------------------------------------------------------------- */
console.log('\ntheme: the shape of a theme\n');

const good = T.template('dark', 'Night');
check('a template is a valid theme', T.normalise(good).ok);

{
  const partial = { format: T.FORMAT, version: T.VERSION, base: 'light', colors: { accent: '#7c3aed' } };
  const r = T.normalise(partial);
  check('colours left out come from the base, and are named',
    r.ok && r.theme.colors.accent === '#7c3aed' && r.theme.colors.text === T.BASES.light.text && r.filled.length === 10,
    r.ok ? r.filled.join(', ') : JSON.stringify(r.errors));
}

const refuses = (label, input, pattern) => {
  const r = T.normalise(input);
  const said = r.ok ? '' : r.errors.map((e) => e.i18n).join(', ');
  check(label, !r.ok && pattern.test(said), r.ok ? 'accepted' : said);
};
const withColor = (key, value) => ({ ...good, colors: { ...good.colors, [key]: value } });
refuses('a colour name is refused', withColor('accent', 'rebeccapurple'), /theme\.err\.hex/);
refuses('so is alpha (#rrggbbaa)', withColor('accent', '#5b8cff80'), /theme\.err\.hex/);
refuses('and three-digit shorthand', withColor('accent', '#58f'), /theme\.err\.hex/);
refuses('and url(), which could reach the network', withColor('background', 'url(https://example.com/x.png)'), /theme\.err\.hex/);
refuses('and var(), which could name any token', withColor('text', 'var(--bg)'), /theme\.err\.hex/);
refuses('a colour the app does not know is refused, not ignored', withColor('--bg', '#000000'), /theme\.err\.unknownColor/);
refuses('as is a field it does not know', { ...good, css: 'body{display:none}' }, /theme\.err\.unknownField/);
refuses('a missing format is refused', { ...good, format: undefined }, /theme\.err\.format/);
refuses('a later version is refused', { ...good, version: 2 }, /theme\.err\.version/);
refuses('a base that is not light or dark is refused', { ...good, base: 'sepia' }, /theme\.err\.base/);
refuses('an array is not a theme', [good], /theme\.err\.notObject/);

{
  const r = T.normalise({ ...good, name: `  a\u0000b\u001bc ${'x'.repeat(200)}` });
  check('a name loses control characters and is cut to 60', r.ok && !/[\u0000-\u001f]/.test(r.theme.name) && r.theme.name.length === T.MAX_NAME, r.ok ? JSON.stringify(r.theme.name.slice(0, 12)) : '');
}

{
  const big = T.parse('x'.repeat(10), T.MAX_BYTES + 1);
  check('a file over 32 KB is refused by size, before it is parsed', !big.ok && big.errors[0].i18n === 'theme.err.size');
  check('a file that is not JSON is refused', T.parse('{ not json').errors[0].i18n === 'theme.err.json');
  const bom = T.parse(`﻿${T.serialise(good)}`);
  check('a byte-order mark at the start is allowed', bom.ok);
  const round = T.parse(T.serialise(good));
  check('what the app exports it reads back, colour for colour',
    round.ok && T.KEYS.every((k) => round.theme.colors[k] === good.colors[k]) && round.theme.name === 'Night');
}

/* -------------------------------------------------------------------------- */
console.log('\ntheme: each rule refuses what it is for\n');

const fails = (label, theme, want) => {
  const verdict = T.check(T.normalise(theme).theme);
  const hit = verdict.failures.find((f) => f.key === want.key && (!want.against || f.against === want.against) && f.rule === (want.rule || 'contrast'));
  check(label, !verdict.ok && Boolean(hit), verdict.failures.map((f) => `${f.rule}:${f.key}/${f.against}=${f.value}`).join('; ') || 'passed');
};
fails('text too close to its card', withColor('text', '#3a3f48'), { key: 'text' });
fails('quiet text too quiet', withColor('textTertiary', '#40454e'), { key: 'textTertiary' });
fails('an accent that cannot be read as a link', withColor('accent', '#1f2d4a'), { key: 'accent' });
fails('a button label lost on the accent', withColor('onAccent', '#6f95ff'), { key: 'onAccent' });
fails('field edges nobody can find', withColor('border', '#20252e'), { key: 'border', against: 'surface' });
fails('a verdict colour unreadable on its own badge', withColor('good', '#1e5a2b'), { key: 'good' });
fails('green and red made the same', withColor('danger', good.colors.good), { rule: 'distinct', key: 'good', against: 'danger' });
fails('an accent that looks like a verdict', withColor('accent', '#46c255'), { rule: 'distinct', key: 'good', against: 'accent' });
{
  // The use the rule allows: blue, yellow and orange for somebody who cannot
  // tell red from green (the Okabe-Ito colours), with a violet accent.
  const swapped = T.check(T.normalise({ ...good, colors: { ...good.colors, good: '#56b4e9', warn: '#f0e442', danger: '#e69f00', accent: '#cc79a7' } }).theme);
  check('verdicts may change colour, if they stay apart and readable', swapped.ok,
    swapped.failures.map((f) => `${f.rule}:${f.key}/${f.against}=${f.value}`).join('; '));
  // And the rule is not decoration: an orange that close to the amber is
  // refused, which is the first set this test tried.
  const close = T.check(T.normalise({ ...good, colors: { ...good.colors, good: '#4aa3ff', danger: '#ff9f43', accent: '#c792ea' } }).theme);
  check('an orange danger beside an amber review is refused as too alike',
    close.failures.some((f) => f.rule === 'distinct' && f.key === 'warn' && f.against === 'danger'));
}

{
  // 2.997:1, found by a screenshot: rounded, the sentence read "3:1, and 3:1
  // is the least" -- a failure that looked like a pass. Shown figures are
  // rounded down, so one is never better than what was measured.
  const edge = T.check(T.normalise({ ...T.template('dark'), colors: { ...T.BASES.dark, background: '#120f1a', surface: '#1b1726', accent: '#b48cff', border: '#6e6485' } }).theme);
  const hit = edge.failures.find((f) => f.key === 'border');
  check('a ratio just under the line is shown under it, not rounded up to it', hit && hit.value < hit.min, hit && `${hit.value} < ${hit.min}`);
}

/* -------------------------------------------------------------------------- */
console.log('\ntheme: every failure reads as a sentence, in both languages\n');

{
  const verdict = T.check(T.normalise(withColor('text', '#3a3f48')).theme);
  for (const code of ['en', 'vi']) {
    i18n.setLanguage(code);
    const words = verdict.failures.map((f) => i18n.render(T.describe(f)));
    check(`${code}: no [object Object], no placeholder left behind`,
      words.length > 0 && words.every((w) => !/\[object|\{\w+\}/.test(w)), words[0]);
  }
  i18n.setLanguage('en');
}

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
