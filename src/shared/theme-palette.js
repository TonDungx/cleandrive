'use strict';

/**
 * The user's own colours: what a theme file may contain, and what it must
 * pass before the app will draw with it.
 *
 * Loaded in two places, which is why it is here and not under main/ or
 * renderer/: the main process is the authority (it checks every file it
 * reads and every palette it is asked to save), and the window uses the same
 * functions to check a palette live while somebody is editing it and to turn
 * one into the app's colour tokens. One implementation means the editor
 * cannot say "passes" about a palette the main process would refuse.
 *
 * ## What a theme is
 *
 *   { "format": "cleandrive-theme", "version": 1, "name": "…",
 *     "base": "light" | "dark", "colors": { "<key>": "#rrggbb", … } }
 *
 * Eleven colours, no more. Everything else the interface uses -- hover and
 * pressed shades, the soft fill behind a verdict, the focus ring -- is worked
 * out from these, so a theme cannot set a ring nobody can see or a hover that
 * matches the page. A key left out is taken from the built-in palette of the
 * same base.
 *
 * Values are `#rrggbb` and nothing else. No names, no alpha, no `var()`, no
 * `url()`: a theme is data, and nothing in it is ever handed to CSS as text
 * the app did not write itself.
 *
 * ## The rules
 *
 * A theme is used only if it passes every one of them (WCAG 2 contrast):
 *   - text, secondary and tertiary text: 4.5:1 on every surface
 *   - the accent, which is also a text colour (links, the selected tab): 4.5:1
 *   - what is written on the accent: 4.5:1 on the accent and on its hover
 *   - the edge of a text field or a checkbox: 3:1 (WCAG 1.4.11)
 *   - the three verdict colours: 4.5:1 on the card and on their own soft fill
 *   - the verdict colours and the accent must each look different from the
 *     others: CIEDE2000 distance of at least 20 between every pair. [The
 *     threshold is this app's choice, not a standard's.] They may be changed
 *     -- somebody who cannot tell red from green may want blue and orange --
 *     but they only ever mean verdicts, and two that look alike say nothing.
 *
 * The two built-in palettes pass the same rules; scripts/test-theme.js holds
 * them to it, so the rules cannot drift into something the app itself fails.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CleanDriveTheme = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const FORMAT = 'cleandrive-theme';
  const VERSION = 1;
  /** Bytes. A theme is eleven colours; anything this size is not one. */
  const MAX_BYTES = 32 * 1024;
  const MAX_NAME = 60;

  const KEYS = Object.freeze([
    'background',
    'surface',
    'border',
    'text',
    'textSecondary',
    'textTertiary',
    'accent',
    'onAccent',
    'good',
    'warn',
    'danger',
  ]);

  /**
   * The built-in palettes, as eleven colours each. They must match the
   * tokens in styles.css; test-theme.js reads the stylesheet to check.
   */
  const BASES = Object.freeze({
    light: Object.freeze({
      background: '#f4f5f8',
      surface: '#ffffff',
      border: '#7b8ba6',
      text: '#11151c',
      textSecondary: '#525b6b',
      textTertiary: '#616873',
      accent: '#2563eb',
      onAccent: '#ffffff',
      good: '#147739',
      warn: '#945a06',
      danger: '#b91c1c',
    }),
    dark: Object.freeze({
      background: '#0c0e12',
      surface: '#161a22',
      border: '#5f6e85',
      text: '#e9ecf3',
      textSecondary: '#a3acbd',
      textTertiary: '#8a92a3',
      accent: '#5b8cff',
      onAccent: '#0b1220',
      good: '#3fb950',
      warn: '#d8a020',
      danger: '#ff8a8e',
    }),
  });

  const MIN_TEXT = 4.5;
  const MIN_EDGE = 3;
  const MIN_DELTA_E = 20;

  /* ------------------------------------------------------------ colour */

  const HEX = /^#[0-9a-f]{6}$/i;

  function rgb(hex) {
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }

  function hex([r, g, b]) {
    return `#${[r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')}`;
  }

  /**
   * `color-mix(in srgb, a (1-w), b w)`: straight interpolation of the
   * gamma-encoded channels, which is what CSS's `srgb` space means.
   */
  function mix(a, b, weight) {
    const x = rgb(a);
    const y = rgb(b);
    return hex(x.map((c, i) => c + (y[i] - c) * weight));
  }

  /** A colour laid over another at some opacity, as the eye gets it. */
  const over = (top, alpha, under) => mix(under, top, alpha);

  const rgba = (color, alpha) => `rgba(${rgb(color).join(', ')}, ${alpha})`;

  function luminance(color) {
    const [r, g, b] = rgb(color).map((c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /** WCAG 2 contrast ratio, 1 to 21. */
  function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  /** sRGB (D65) to CIE L*a*b*. */
  function lab(color) {
    const [r, g, b] = rgb(color).map((c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
    const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
    const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 24389) / 27 / 116 + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  }

  /**
   * CIEDE2000 colour difference between two L*a*b* colours (Sharma, Wu and
   * Dalal, 2005). test-theme.js checks it against the paper's worked pairs.
   */
  function deltaE2000([L1, a1, b1], [L2, a2, b2]) {
    const rad = Math.PI / 180;
    const C1 = Math.hypot(a1, b1);
    const C2 = Math.hypot(a2, b2);
    const Cm = (C1 + C2) / 2;
    const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
    const ap1 = (1 + G) * a1;
    const ap2 = (1 + G) * a2;
    const Cp1 = Math.hypot(ap1, b1);
    const Cp2 = Math.hypot(ap2, b2);
    const hue = (b, a) => {
      if (a === 0 && b === 0) return 0;
      const h = Math.atan2(b, a) / rad;
      return h < 0 ? h + 360 : h;
    };
    const hp1 = hue(b1, ap1);
    const hp2 = hue(b2, ap2);

    const dL = L2 - L1;
    const dC = Cp2 - Cp1;
    let dh = 0;
    if (Cp1 * Cp2 !== 0) {
      dh = hp2 - hp1;
      if (dh > 180) dh -= 360;
      else if (dh < -180) dh += 360;
    }
    const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh / 2) * rad);

    const Lm = (L1 + L2) / 2;
    const Cpm = (Cp1 + Cp2) / 2;
    let hm = hp1 + hp2;
    if (Cp1 * Cp2 !== 0) {
      if (Math.abs(hp1 - hp2) <= 180) hm = (hp1 + hp2) / 2;
      else hm = hp1 + hp2 < 360 ? (hp1 + hp2 + 360) / 2 : (hp1 + hp2 - 360) / 2;
    }
    const T =
      1 -
      0.17 * Math.cos((hm - 30) * rad) +
      0.24 * Math.cos(2 * hm * rad) +
      0.32 * Math.cos((3 * hm + 6) * rad) -
      0.2 * Math.cos((4 * hm - 63) * rad);
    const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
    const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
    const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
    const Sc = 1 + 0.045 * Cpm;
    const Sh = 1 + 0.015 * Cpm * T;
    const Rt = -Math.sin(2 * dTheta * rad) * Rc;
    return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
  }

  const distance = (a, b) => deltaE2000(lab(a), lab(b));

  /* ------------------------------------------------------------ tokens */

  /**
   * How far each worked-out shade sits from its source, per base.
   *
   * Read off the built-in palettes, so a theme that changes nothing draws
   * almost exactly what the built-in one does: a raised fill is about 5% of
   * the way from the card to the text on a light page and 3% on a dark one,
   * and the soft fill behind a verdict is 9% or 13% of the verdict colour.
   */
  const STEPS = Object.freeze({
    light: { surface2: 0.05, surface3: 0.09, soft: 0.09, dangerSoft: 0.08 },
    dark: { surface2: 0.03, surface3: 0.075, soft: 0.13, dangerSoft: 0.13 },
  });

  /** Surfaces the text colours are checked against, worked out as the CSS has them. */
  function surfaces(c, base) {
    const step = STEPS[base] || STEPS.light;
    return {
      background: c.background,
      surface: c.surface,
      surface2: mix(c.surface, c.text, step.surface2),
      surface3: mix(c.surface, c.text, step.surface3),
    };
  }

  const accentHover = (c) => mix(c.accent, c.text, 0.12);
  const accentLift = (c) => mix(c.accent, '#ffffff', 0.18);

  /**
   * Every colour token the stylesheet reads, from the eleven.
   *
   * The names are the stylesheet's own. theme.js writes them onto the
   * document element, where they win over the built-in values.
   */
  function derive(colors, base) {
    const c = colors;
    const s = surfaces(c, base);
    const step = STEPS[base] || STEPS.light;
    return {
      '--bg': c.background,
      '--bg-elevated': c.surface,
      '--surface': c.surface,
      '--surface-2': s.surface2,
      '--surface-3': s.surface3,
      '--border': mix(c.border, c.surface, 0.55),
      '--border-soft': mix(c.border, c.surface, 0.72),
      '--border-strong': c.border,
      '--control-border': c.border,
      '--text': c.text,
      '--text-2': c.textSecondary,
      '--text-3': c.textTertiary,
      '--accent': c.accent,
      '--accent-hover': accentHover(c),
      '--accent-lift': accentLift(c),
      '--accent-deep': mix(c.accent, '#000000', 0.25),
      '--accent-soft': rgba(c.accent, 0.12),
      '--accent-ring': rgba(c.accent, 0.32),
      '--accent-glow': rgba(c.accent, 0.26),
      '--on-accent': c.onAccent,
      '--good': c.good,
      '--good-soft': rgba(c.good, step.soft),
      '--good-line': rgba(c.good, 0.3),
      '--warn': c.warn,
      '--warn-soft': rgba(c.warn, step.soft),
      '--warn-line': rgba(c.warn, 0.3),
      '--danger': c.danger,
      '--danger-text': c.danger,
      '--danger-text-hover': mix(c.danger, c.text, 0.15),
      '--danger-soft': rgba(c.danger, step.dangerSoft),
      '--danger-soft-hover': rgba(c.danger, step.dangerSoft + 0.07),
      '--danger-line': rgba(c.danger, 0.35),
    };
  }

  const TOKENS = Object.freeze(Object.keys(derive(BASES.light, 'light')));

  /* ------------------------------------------------------------ structure */

  /** A sentence the window words in its own language: `{ i18n, en, params }`. */
  const m = (i18n, en, params) => ({ i18n, en, params: params || {} });

  /**
   * Check a theme's shape, and fill in what it left out.
   *
   * @param {unknown} input  a parsed object
   * @returns {{ok: true, theme: object} | {ok: false, errors: object[]}}
   */
  function normalise(input) {
    const errors = [];
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, errors: [m('theme.err.notObject', 'This is not a theme: it has to be one JSON object.')] };
    }
    const allowed = ['format', 'version', 'name', 'base', 'colors'];
    for (const key of Object.keys(input)) {
      if (!allowed.includes(key)) errors.push(m('theme.err.unknownField', 'Unknown field “{key}”.', { key: String(key).slice(0, 40) }));
    }
    if (input.format !== FORMAT) {
      errors.push(m('theme.err.format', 'It does not say it is a CleanDrive theme ("format": "{format}").', { format: FORMAT }));
    }
    if (input.version !== VERSION) {
      errors.push(m('theme.err.version', 'Theme version {got} is not one this version reads (it reads {want}).', {
        got: JSON.stringify(input.version === undefined ? null : input.version).slice(0, 20),
        want: VERSION,
      }));
    }
    if (input.base !== 'light' && input.base !== 'dark') {
      errors.push(m('theme.err.base', '"base" has to be "light" or "dark".'));
    }
    let name = '';
    if (input.name !== undefined) {
      if (typeof input.name !== 'string') errors.push(m('theme.err.name', '"name" has to be text.'));
      // eslint-disable-next-line no-control-regex
      else name = input.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME);
    }
    const colors = {};
    const raw = input.colors;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(m('theme.err.colors', '"colors" has to be an object of colours.'));
    } else {
      for (const [key, value] of Object.entries(raw)) {
        if (!KEYS.includes(key)) {
          errors.push(m('theme.err.unknownColor', 'Unknown colour “{key}”. The colours a theme can set are: {keys}.', {
            key: String(key).slice(0, 40),
            keys: KEYS.join(', '),
          }));
        } else if (typeof value !== 'string' || !HEX.test(value)) {
          errors.push(m('theme.err.hex', '“{key}” has to be a colour written #rrggbb.', { key }));
        } else {
          colors[key] = value.toLowerCase();
        }
      }
    }
    if (errors.length) return { ok: false, errors };

    const base = BASES[input.base];
    const filled = KEYS.filter((key) => !(key in colors));
    for (const key of filled) colors[key] = base[key];
    return { ok: true, theme: { format: FORMAT, version: VERSION, name, base: input.base, colors }, filled };
  }

  /**
   * Read a theme file's text.
   *
   * @param {string} text
   * @param {number} [bytes]  the file's size on disk, when known
   */
  function parse(text, bytes) {
    const size = Number.isFinite(bytes) ? bytes : typeof text === 'string' ? text.length : 0;
    if (size > MAX_BYTES) {
      return { ok: false, errors: [m('theme.err.size', 'The file is {size} KB; a theme is at most {max} KB.', { size: Math.ceil(size / 1024), max: MAX_BYTES / 1024 })] };
    }
    let value;
    try {
      value = JSON.parse(String(text).replace(/^﻿/, ''));
    } catch {
      return { ok: false, errors: [m('theme.err.json', 'The file is not valid JSON.')] };
    }
    return normalise(value);
  }

  /* ------------------------------------------------------------ rules */

  const LABELS = {
    background: ['theme.key.background', 'Page'],
    surface: ['theme.key.surface', 'Cards'],
    border: ['theme.key.border', 'Edges of fields and boxes'],
    text: ['theme.key.text', 'Text'],
    textSecondary: ['theme.key.textSecondary', 'Secondary text'],
    textTertiary: ['theme.key.textTertiary', 'Quiet text'],
    accent: ['theme.key.accent', 'Accent'],
    onAccent: ['theme.key.onAccent', 'Text on the accent'],
    good: ['theme.key.good', 'Safe (green by default)'],
    warn: ['theme.key.warn', 'Review (amber by default)'],
    danger: ['theme.key.danger', 'Danger (red by default)'],
    surface2: ['theme.key.surface2', 'Raised fill'],
    surface3: ['theme.key.surface3', 'Hover fill'],
    accentHover: ['theme.key.accentHover', 'Accent, pressed'],
    goodSoft: ['theme.key.goodSoft', 'Safe badge fill'],
    warnSoft: ['theme.key.warnSoft', 'Review badge fill'],
    dangerSoft: ['theme.key.dangerSoft', 'Danger badge fill'],
  };

  /**
   * Every rule, measured.
   *
   * @param {object} theme  a normalised theme
   * @returns {{ok: boolean, checks: object[], failures: object[]}}
   */
  function check(theme) {
    const c = theme.colors;
    const s = surfaces(c, theme.base);
    const step = STEPS[theme.base] || STEPS.light;
    const checks = [];

    const ratio = (fg, fgKey, bg, bgKey, min) => {
      const value = contrast(fg, bg);
      checks.push({ rule: 'contrast', key: fgKey, against: bgKey, value: Math.floor(value * 100) / 100, min, ok: value >= min });
    };

    for (const key of ['text', 'textSecondary', 'textTertiary']) {
      for (const [bgKey, bg] of Object.entries(s)) ratio(c[key], key, bg, bgKey, MIN_TEXT);
    }
    for (const bgKey of ['background', 'surface', 'surface2']) ratio(c.accent, 'accent', s[bgKey], bgKey, MIN_TEXT);
    ratio(c.onAccent, 'onAccent', c.accent, 'accent', MIN_TEXT);
    ratio(c.onAccent, 'onAccent', accentHover(c), 'accentHover', MIN_TEXT);
    // A primary button under the pointer runs from the lifted accent to the
    // hover shade; its label sits in the middle of that.
    ratio(c.onAccent, 'onAccent', mix(accentLift(c), accentHover(c), 0.5), 'accentHover', MIN_TEXT);
    for (const bgKey of ['surface', 'surface2']) ratio(c.border, 'border', s[bgKey], bgKey, MIN_EDGE);
    for (const key of ['good', 'warn', 'danger']) {
      ratio(c[key], key, c.surface, 'surface', MIN_TEXT);
      ratio(c[key], key, s.surface2, 'surface2', MIN_TEXT);
      ratio(c[key], key, over(c[key], key === 'danger' ? step.dangerSoft : step.soft, c.surface), `${key}Soft`, MIN_TEXT);
    }

    const marks = ['good', 'warn', 'danger', 'accent'];
    for (let i = 0; i < marks.length; i++) {
      for (let j = i + 1; j < marks.length; j++) {
        const value = distance(c[marks[i]], c[marks[j]]);
        checks.push({ rule: 'distinct', key: marks[i], against: marks[j], value: Math.floor(value * 10) / 10, min: MIN_DELTA_E, ok: value >= MIN_DELTA_E });
      }
    }

    const failures = checks.filter((x) => !x.ok);
    return { ok: failures.length === 0, checks, failures };
  }

  /** One check as a sentence. */
  function describe(item) {
    const name = (key) => {
      const label = LABELS[key] || [key, key];
      return m(label[0], label[1]);
    };
    if (item.rule === 'distinct') {
      return m('theme.rule.distinct', '{a} and {b} look too alike: {value} apart, and {min} is the least.', {
        a: name(item.key),
        b: name(item.against),
        value: item.value,
        min: item.min,
      });
    }
    return m('theme.rule.contrast', '{fg} on {bg}: {value}:1, and {min}:1 is the least.', {
      fg: name(item.key),
      bg: name(item.against),
      value: item.value,
      min: item.min,
    });
  }

  /** A theme to start from: a built-in palette, named. */
  function template(base, name) {
    return { format: FORMAT, version: VERSION, name: name || '', base, colors: { ...BASES[base] } };
  }

  /** The file a theme is saved as. */
  function serialise(theme) {
    const { format, version, name, base, colors } = theme;
    const ordered = {};
    for (const key of KEYS) ordered[key] = colors[key];
    return `${JSON.stringify({ format, version, name, base, colors: ordered }, null, 2)}\n`;
  }

  return {
    FORMAT,
    VERSION,
    MAX_BYTES,
    MAX_NAME,
    KEYS,
    BASES,
    TOKENS,
    LABELS,
    MIN_TEXT,
    MIN_EDGE,
    MIN_DELTA_E,
    contrast,
    mix,
    lab,
    deltaE2000,
    distance,
    derive,
    normalise,
    parse,
    check,
    describe,
    template,
    serialise,
  };
});
