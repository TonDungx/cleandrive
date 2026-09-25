'use strict';

const { nativeTheme } = require('electron');

/**
 * What the window is drawn in, as the main process holds it.
 *
 * `nativeTheme.themeSource` used to be the whole answer: light, dark or
 * system, read back by main.js when it builds a window. The user's own
 * colours (I2) add a fourth answer that `themeSource` cannot hold -- it only
 * knows light and dark -- so this keeps the palette alongside it, and both
 * main.js and the IPC layer go through here.
 *
 * With a custom palette on, `themeSource` is set to the palette's base, so
 * Electron's own dialogs (the delete confirmation, the folder picker) come
 * out light or dark to match it.
 */

/** The stored palette, on or off: { name, base, colors }, or null. */
let stored = null;
let enabled = false;

/**
 * @param {{theme: string, custom: object|null}} appearance  the settings section
 * @returns {object|null} the palette now drawn, if any
 */
function apply(appearance) {
  const custom = appearance && appearance.custom;
  stored = custom ? { name: custom.name, base: custom.base, colors: { ...custom.colors } } : null;
  enabled = Boolean(stored && custom.enabled);
  nativeTheme.themeSource = enabled ? stored.base : (appearance && appearance.theme) || 'system';
  return enabled ? stored : null;
}

/**
 * What the window needs before its first paint, in its URL: the mode, and
 * the stored palette whether or not it is on -- the window draws with it
 * when it is, and offers it (the Custom button, the editor) when it is not.
 * It cannot wait for an IPC reply: a promise resolves after the first frame,
 * and that frame would be the wrong colours.
 */
function query() {
  const out = { theme: enabled ? 'custom' : nativeTheme.themeSource };
  if (stored) out.palette = JSON.stringify(stored);
  return out;
}

/** The colour the window is painted before the page has drawn anything. */
function background(defaults) {
  if (enabled) return stored.colors.background;
  return nativeTheme.shouldUseDarkColors ? defaults.dark : defaults.light;
}

const current = () => (enabled ? stored : null);

module.exports = { apply, query, background, current };
