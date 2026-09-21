'use strict';

const path = require('node:path');

const { message: m } = require('../../../i18n');

/**
 * Axis one: where a picture came from.
 *
 * ## The rule this file is built around
 *
 * This app never shows a conclusion without the evidence for it. Everywhere
 * else that means a sentence -- "Not opened in 2.4 years", "Inside a cache
 * folder". Here one sentence is not enough, because the conclusion is reached
 * by *combining* weak signals: a screenshot is recognised from its name, and
 * the absence of camera metadata, and a size that matches a monitor. Any one of
 * those alone would be a guess.
 *
 * So every verdict carries a list. The user is told "Screenshot" and, beneath
 * it, the three facts that produced it, in the order they were weighed. If they
 * disagree, they can see exactly which fact is wrong.
 *
 * ## Strength, not a score
 *
 * Signals are ranked rather than summed. A camera name written into the file by
 * the camera is not "three points"; it is the answer, and nothing a filename
 * suggests can outvote it. Adding weights would let two weak signals overrule
 * one strong one, which is how a photograph called `Screenshot of the beach.jpg`
 * ends up filed as a screenshot.
 *
 * The ranks, strongest first:
 *
 *   1. metadata the device wrote itself  (EXIF Make/Model, `moov` udta)
 *   2. metadata an editor wrote          (EXIF Software)
 *   3. the folder it lives in            (Camera Roll, a messenger's own folder)
 *   4. the download record Windows kept  (`:Zone.Identifier`)
 *   5. the filename's shape              (IMG_1234, IMG-20240101-WA0001)
 *   6. the shape of the image itself     (matches a monitor exactly)
 *
 * A verdict reached at rank 5 or 6 says so, and the UI shows it as a guess.
 */

/** The categories, in the order the UI lists them. */
const ORIGINS = [
  'camera',
  'screenshot',
  'messaging',
  'download',
  'edited',
  'screenrecord',
  'gamecapture',
  'unknown',
];

/* -------------------------------------------------------------------------- */
/* filename shapes                                                             */
/* -------------------------------------------------------------------------- */

/**
 * What a camera calls its files.
 *
 * These are conventions rather than standards, so they are evidence and never
 * proof -- anyone can name a file `IMG_0001.jpg`. They only decide the answer
 * when nothing stronger is available.
 */
const CAMERA_NAME_PATTERNS = [
  { re: /^IMG[-_]?\d{4}\b/i, what: 'IMG_0000' },
  { re: /^_MG_\d{4}\b/i, what: '_MG_0000' },
  { re: /^DSC[NF]?[-_]?\d{4}\b/i, what: 'DSC_0000' },
  { re: /^P\d{7}\b/, what: 'P0000000' },
  { re: /^PXL_\d{8}_\d{6,}/i, what: 'PXL_00000000_000000' },
  { re: /^IMG_\d{8}_\d{6}/i, what: 'IMG_00000000_000000' },
  { re: /^VID_\d{8}_\d{6}/i, what: 'VID_00000000_000000' },
  { re: /^\d{8}_\d{6}\b/, what: '00000000_000000' },
  { re: /^GOPR\d{4}\b/i, what: 'GOPR0000' },
  { re: /^[A-Z]{3}_\d{4}\b/, what: 'ABC_0000' },
];

/**
 * What a screenshot is called.
 *
 * Windows names these in the *display language*, so the English pattern misses
 * every screenshot taken on the machine this was written on -- where they are
 * called `Ảnh chụp màn hình 2025-10-30 151324.png`. A list of English words
 * would have been a rule that quietly did nothing for the person who asked for
 * the feature.
 */
const SCREENSHOT_NAME_PATTERNS = [
  { re: /^screen ?shot\b/i, what: 'Screenshot' },
  { re: /^screenshot[-_]\d{4}/i, what: 'Screenshot_0000' },
  { re: /^ảnh chụp màn hình\b/i, what: 'Ảnh chụp màn hình' },
  { re: /^captura de pantalla\b/i, what: 'Captura de pantalla' },
  { re: /^capture d.écran\b/i, what: 'Capture d’écran' },
  { re: /^bildschirmfoto\b/i, what: 'Bildschirmfoto' },
  { re: /^снимок экрана\b/i, what: 'Снимок экрана' },
  { re: /^スクリーンショット/i, what: 'スクリーンショット' },
  { re: /^snipaste[-_]/i, what: 'Snipaste_' },
  { re: /^greenshot[-_]/i, what: 'Greenshot_' },
  { re: /^lightshot/i, what: 'Lightshot' },
  { re: /^sharex[-_]/i, what: 'ShareX_' },
];

/**
 * What a messaging app calls what it hands you.
 *
 * WhatsApp's is the most distinctive thing in this file: `IMG-20240817-WA0042`
 * is written by nothing else on earth.
 */
const MESSAGING_NAME_PATTERNS = [
  { re: /^IMG-\d{8}-WA\d+/i, app: 'WhatsApp', what: 'IMG-00000000-WA0000' },
  { re: /^VID-\d{8}-WA\d+/i, app: 'WhatsApp', what: 'VID-00000000-WA0000' },
  { re: /^AUD-\d{8}-WA\d+/i, app: 'WhatsApp', what: 'AUD-00000000-WA0000' },
  { re: /^photo_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/i, app: 'Telegram', what: 'photo_0000-00-00_00-00-00' },
  { re: /^video_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/i, app: 'Telegram', what: 'video_0000-00-00_00-00-00' },
  { re: /^FB_IMG_\d+/i, app: 'Facebook', what: 'FB_IMG_0000000000' },
  { re: /^received_\d+/i, app: 'Messenger', what: 'received_0000000000' },
  { re: /^viber_image_\d{4}-\d{2}-\d{2}/i, app: 'Viber', what: 'viber_image_0000-00-00' },
  { re: /^viber_video_\d{4}-\d{2}-\d{2}/i, app: 'Viber', what: 'viber_video_0000-00-00' },
  { re: /^Zalo[-_]/i, app: 'Zalo', what: 'Zalo_' },
];

/**
 * Folder names that say what everything inside them is.
 *
 * Matched as whole path segments, anywhere in the path, for the same reason
 * `util.js` matches `AppData\Roaming` that way: a machine can have more than
 * one profile tree, and anchoring to the home directory finds only the first.
 *
 * Windows localises these folder names on disk, not merely in Explorer, so the
 * Vietnamese ones are here as themselves rather than as translations of the
 * English. `Cuộn phim` is Camera Roll; `Ảnh chụp màn hình` is Screenshots. A
 * list of English names is a rule that does nothing at all on the machine this
 * feature was asked for -- where it would have missed 3,343 screenshots.
 */
const FOLDER_SIGNALS = [
  { re: /^camera roll$/i, origin: 'camera', what: 'Camera Roll' },
  { re: /^cuộn phim$/i, origin: 'camera', what: 'Cuộn phim' },
  { re: /^dcim$/i, origin: 'camera', what: 'DCIM' },
  { re: /^screenshots?$/i, origin: 'screenshot', what: 'Screenshots' },
  { re: /^ảnh chụp màn hình$/i, origin: 'screenshot', what: 'Ảnh chụp màn hình' },
  { re: /^ảnh đã lưu$/i, origin: 'screenshot', what: 'Ảnh đã lưu' },

  // `Videos\Captures` is the Windows game bar's folder, and it was mapped to
  // "game capture" until a real scan filed a recording of a browser tab under
  // it. The game bar records whatever window is in front, games included, so
  // the folder says "a screen was recorded" and nothing more. What is actually
  // in it is decided further down, by the window title the recorder wrote.
  { re: /^captures$/i, origin: 'screenrecord', what: 'Captures', videoOnly: true },

  // These do mean a game. Steam's own screenshot folder is left out on
  // purpose: it is called `screenshots` like everything else, the rule above
  // reaches it first, and "screenshot" is not a wrong answer for it.
  { re: /^shadowplay$/i, origin: 'gamecapture', what: 'ShadowPlay', videoOnly: true },
  { re: /^nvidia$/i, origin: 'gamecapture', what: 'NVIDIA', videoOnly: true },
  { re: /^zalo received files$/i, origin: 'messaging', app: 'Zalo', what: 'Zalo Received Files' },
  { re: /^zalopc received files$/i, origin: 'messaging', app: 'Zalo', what: 'ZaloPC Received Files' },
  { re: /^zalodata$/i, origin: 'messaging', app: 'Zalo', what: 'ZaloData' },
  { re: /^telegram desktop$/i, origin: 'messaging', app: 'Telegram', what: 'Telegram Desktop' },
  { re: /^whatsapp$/i, origin: 'messaging', app: 'WhatsApp', what: 'WhatsApp' },
  { re: /^viberdownloads$/i, origin: 'messaging', app: 'Viber', what: 'ViberDownloads' },
  { re: /^wechat files$/i, origin: 'messaging', app: 'WeChat', what: 'WeChat Files' },
  { re: /^crossdevice$/i, origin: 'camera', what: 'CrossDevice' },
];

/** Hosts whose downloads are really messages. */
const MESSAGING_HOSTS = [
  { re: /(^|\.)zalo\.me$/i, app: 'Zalo' },
  { re: /(^|\.)zaloapp\.com$/i, app: 'Zalo' },
  { re: /(^|\.)messenger\.com$/i, app: 'Messenger' },
  { re: /(^|\.)facebook\.com$/i, app: 'Facebook' },
  { re: /(^|\.)fbcdn\.net$/i, app: 'Facebook' },
  { re: /(^|\.)whatsapp\.(com|net)$/i, app: 'WhatsApp' },
  { re: /(^|\.)telegram\.(org|me)$/i, app: 'Telegram' },
  { re: /(^|\.)discordapp\.(com|net)$/i, app: 'Discord' },
  { re: /(^|\.)discord\.com$/i, app: 'Discord' },
  { re: /(^|\.)slack(-edge)?\.com$/i, app: 'Slack' },
];

/**
 * Software names that mean the file was produced rather than captured.
 *
 * A phone's own processing pipeline also writes this tag -- `Photos 9.0`,
 * `HDR+ 1.0` -- so it is only consulted when no camera named itself, and never
 * to overturn a camera that did.
 */
const EDITOR_SOFTWARE = [
  /photoshop/i, /lightroom/i, /gimp/i, /affinity/i, /capture one/i,
  /paint\.?net/i, /pixelmator/i, /snapseed/i, /picsart/i, /canva/i,
  /figma/i, /illustrator/i, /darktable/i, /rawtherapee/i, /imagemagick/i,
  /ffmpeg/i, /adobe/i, /midjourney/i, /dall.?e/i, /stable diffusion/i,
];

/** Software names that mean a screen was recorded. */
const SCREEN_RECORDER_SOFTWARE = [
  /obs[- ]studio/i, /bandicam/i, /camtasia/i, /screenrec/i, /sharex/i,
  /snagit/i, /loom/i, /screenpal/i, /nvidia/i, /radeon/i,
];

/* -------------------------------------------------------------------------- */
/* the verdict                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Where this file came from, and the facts that say so.
 *
 * @param {object} record       a probe record
 * @param {object} [context]    { displays: [{width, height}] }
 * @returns {{origin: string, app: string|null, strength: string, evidence: object[]}}
 */
function classifyOrigin(record, context = {}) {
  const evidence = [];
  const name = nfc(record.name || path.basename(record.path || ''));
  const segments = (record.path || '').split(/[\\/]/).filter(Boolean).slice(0, -1).map(nfc);

  /* -- rank 1: the device wrote its own name into the file ---------------- */

  if (record.camera) {
    evidence.push(m('media.why.camera', 'The file says it was taken by {camera}', { camera: record.camera }));
    if (record.takenAt) {
      evidence.push(m('media.why.takenAt', 'It carries a capture date of its own'));
    }
    if (record.lens) evidence.push(m('media.why.lens', 'and records the lens used'));

    // A camera photo that an editor then saved is still a camera photo, but the
    // editing is worth saying: it is why the file is larger, or smaller, than
    // its siblings.
    if (record.software && isEditor(record.software)) {
      evidence.push(m('media.why.alsoEdited', 'and it was later saved by {software}', { software: record.software }));
    }
    return verdict('camera', null, 'certain', evidence);
  }

  /* -- rank 2: an editor wrote its name into the file --------------------- */

  if (record.software) {
    if (isScreenRecorder(record.software)) {
      evidence.push(m('media.why.recorderSoftware', 'Made by {software}, which records screens', { software: record.software }));
      return verdict(record.kind === 'video' ? 'screenrecord' : 'screenshot', null, 'certain', evidence);
    }
    if (isEditor(record.software)) {
      evidence.push(m('media.why.editorSoftware', 'Saved by {software}', { software: record.software }));
      return verdict('edited', null, 'strong', evidence);
    }
  }

  /* -- rank 3: the folder it lives in -------------------------------------- */

  for (const segment of segments) {
    for (const signal of FOLDER_SIGNALS) {
      if (!signal.re.test(segment)) continue;
      // A folder that only means something for moving pictures. A screenshot
      // dropped into `Captures` is still a screenshot.
      if (signal.videoOnly && record.kind !== 'video') continue;

      evidence.push(m('media.why.folder', 'It is inside a folder called “{folder}”', { folder: segment }));
      if (signal.app) {
        evidence.push(m('media.why.appFolder', 'which is where {app} puts what it receives', { app: signal.app }));
      }
      if (signal.origin === 'screenrecord' && record.title) {
        evidence.push(m('media.why.windowTitle', 'It records a window title, “{title}” — cameras do not have windows', {
          title: truncate(record.title, 60),
        }));
      }
      addShapeEvidence(record, context, evidence);
      return verdict(signal.origin, signal.app || null, 'strong', evidence);
    }
  }

  /* -- rank 4: Windows recorded where it was downloaded from --------------- */

  if (record.zone && (record.zone.host || record.zone.referrerHost)) {
    const host = record.zone.host || record.zone.referrerHost;
    const messenger = MESSAGING_HOSTS.find((entry) => entry.re.test(host));

    evidence.push(m('media.why.downloadedFrom', 'Windows recorded that it was downloaded from {host}', { host }));
    if (messenger) {
      evidence.push(m('media.why.messagingHost', 'which is {app}', { app: messenger.app }));
      return verdict('messaging', messenger.app, 'strong', evidence);
    }
    // A download record does not rule out the file *being* a screenshot
    // somebody sent, so the name is still consulted before settling.
    const named = nameSignal(name);
    if (named && named.origin === 'messaging') {
      evidence.push(named.evidence);
      return verdict('messaging', named.app, 'strong', evidence);
    }
    return verdict('download', null, 'strong', evidence);
  }

  /* -- rank 5: the filename's shape ---------------------------------------- */

  const named = nameSignal(name);
  if (named) {
    evidence.push(named.evidence);

    // The combination the brief asked for out loud: a name that looks like a
    // screenshot, no camera metadata, and a size that matches a monitor. Each
    // is weak; together they are the answer.
    if (named.origin === 'screenshot') {
      if (!record.hasExif) {
        evidence.push(m('media.why.noExif', 'and it carries no camera information at all'));
      }
      const matched = addShapeEvidence(record, context, evidence);
      return verdict('screenshot', null, matched ? 'strong' : 'likely', evidence);
    }

    if (named.origin === 'camera' && !record.hasExif) {
      // Every messaging app strips EXIF on the way through, so a camera-shaped
      // name with no metadata is usually a photograph that has been forwarded.
      evidence.push(m('media.why.cameraNameNoExif',
        'but the camera information has been stripped, which is what happens when a photo is sent through a chat app'));
      return verdict('camera', null, 'likely', evidence);
    }

    return verdict(named.origin, named.app || null, 'likely', evidence);
  }

  /* -- rank 6: the shape of the image itself -------------------------------- */

  if (record.kind === 'video' && record.title && !record.camera) {
    // A screen recorder writes the window's title; a camera has no window.
    evidence.push(m('media.why.windowTitle', 'It records a window title, “{title}” — cameras do not have windows', {
      title: truncate(record.title, 60),
    }));
    return verdict('screenrecord', null, 'strong', evidence);
  }

  if (record.kind === 'image' && !record.hasExif) {
    const matched = addShapeEvidence(record, context, evidence);
    if (matched) {
      evidence.push(m('media.why.noExif', 'and it carries no camera information at all'));
      return verdict('screenshot', null, 'likely', evidence);
    }
  }

  if (record.cloudService) {
    evidence.push(m('media.why.cloudOnly', 'Nothing in the file says where it came from; it arrived through {service}', {
      service: record.cloudService,
    }));
    return verdict('unknown', null, 'guess', evidence);
  }

  evidence.push(m('media.why.nothing', 'Nothing in the file or its name says where it came from'));
  return verdict('unknown', null, 'guess', evidence);
}

/* -------------------------------------------------------------------------- */

function verdict(origin, app, strength, evidence) {
  return { origin, app: app || null, strength, evidence };
}

/**
 * Put a name into one Unicode normal form before matching it.
 *
 * NTFS stores whatever bytes it was handed and normalises nothing, so an accent
 * can be one code point or two and the filesystem is happy either way. The
 * development machine carries **both forms in the same folder**: `Hình ảnh` is
 * decomposed (ten code points for eight letters) while its sibling `Máy tính`
 * is composed (eight). A regular expression is written in one form and matches
 * only that one, so `/^ảnh chụp màn hình$/` silently matched nothing --
 * `path.join` with the composed spelling did not even find the directory,
 * returning ENOENT for a folder that is plainly there.
 *
 * Every pattern in this file is written composed, and everything is normalised
 * to composed before it is tested. This costs a string copy per segment and it
 * is the difference between the Vietnamese rules working and being decoration.
 */
function nfc(text) {
  // `normalize` throws on nothing and is a no-op on text already in the form,
  // so there is no cheaper test worth doing first.
  return typeof text === 'string' ? text.normalize('NFC') : '';
}

/** The filename's own suggestion, or null. */
function nameSignal(name) {
  for (const pattern of MESSAGING_NAME_PATTERNS) {
    if (pattern.re.test(name)) {
      return {
        origin: 'messaging',
        app: pattern.app,
        evidence: m('media.why.messagingName', 'Its name follows {app}’s pattern, {what}', {
          app: pattern.app,
          what: pattern.what,
        }),
      };
    }
  }
  for (const pattern of SCREENSHOT_NAME_PATTERNS) {
    if (pattern.re.test(name)) {
      return {
        origin: 'screenshot',
        evidence: m('media.why.screenshotName', 'Its name begins “{what}”, the way a screenshot tool names files', {
          what: pattern.what,
        }),
      };
    }
  }
  for (const pattern of CAMERA_NAME_PATTERNS) {
    if (pattern.re.test(name)) {
      return {
        origin: 'camera',
        evidence: m('media.why.cameraName', 'Its name follows the camera convention {what}', { what: pattern.what }),
      };
    }
  }
  return null;
}

/**
 * Does this image's size match a monitor attached to this machine?
 *
 * A screenshot is exactly the size of what it captured, so an exact match
 * against a real display is strong evidence -- and, importantly, evidence that
 * a photograph almost never produces by accident: no camera sensor is
 * 1920x1020, which is what a browser window on this machine measures once its
 * toolbar is subtracted.
 *
 * Window captures are the reason the height is allowed to be short of the
 * display: a maximised window is the display's width and something less than
 * its height. The width has to match exactly.
 *
 * @returns {boolean} whether anything was added
 */
function addShapeEvidence(record, context, evidence) {
  const displays = context.displays;
  if (!displays || displays.length === 0) return false;
  if (!record.width || !record.height) return false;

  // These read as continuations of the fact before them -- "and it is exactly
  // 1920×1080" -- which is right when something else has already been said and
  // wrong when this is the first thing. A scan of real files produced
  // "and it is exactly 1920×1080 · and it carries no camera information",
  // a sentence with no beginning, in both languages. So each has a standalone
  // wording for when it leads.
  const leads = evidence.length === 0;

  for (const display of displays) {
    if (record.width === display.width && record.height === display.height) {
      evidence.push(
        leads
          ? m('media.why.exactScreenLead', 'It is exactly {w}×{h}, the size of this screen', { w: display.width, h: display.height })
          : m('media.why.exactScreen', 'and it is exactly {w}×{h}, the size of this screen', { w: display.width, h: display.height })
      );
      return true;
    }
    if (record.width === display.width && record.height < display.height && record.height > display.height * 0.6) {
      evidence.push(
        leads
          ? m('media.why.windowWidthLead', 'It is exactly as wide as this screen ({w}px) but shorter, the shape of a captured window', { w: display.width })
          : m('media.why.windowWidth', 'and it is exactly as wide as this screen ({w}px) but shorter, the shape of a captured window', { w: display.width })
      );
      return true;
    }
  }
  return false;
}

function isEditor(software) {
  return EDITOR_SOFTWARE.some((re) => re.test(software));
}

function isScreenRecorder(software) {
  return SCREEN_RECORDER_SOFTWARE.some((re) => re.test(software));
}

function truncate(text, max) {
  const value = String(text);
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

module.exports = {
  classifyOrigin,
  ORIGINS,
  CAMERA_NAME_PATTERNS,
  SCREENSHOT_NAME_PATTERNS,
  MESSAGING_NAME_PATTERNS,
  FOLDER_SIGNALS,
  MESSAGING_HOSTS,
  isEditor,
  isScreenRecorder,
};
