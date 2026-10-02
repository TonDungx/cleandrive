'use strict';

/**
 * The ADMX and ADML files an administrator loads into Group Policy or Intune
 * (H2), written from the same table the app reads (schema.js).
 *
 * Generated rather than written by hand, for the reason the uninstaller's
 * registry list is generated from the menu entries (lib/context-menu.js): two
 * hand-kept copies of one list drift, and here the drift is a switch in Group
 * Policy that sets a value nothing reads. `scripts/build.js` writes them into
 * `policy/` and the installer; `scripts/test-policy.js` fails if the files in
 * the repository differ by one byte from what this produces, and checks every
 * key and value name they write against the reader.
 *
 * The words come from the app's own dictionary -- `t()` here, Vietnamese in
 * src/i18n/vi.js -- so the Vietnamese ADML is translated once, in the place
 * every other Vietnamese sentence in the app is.
 *
 * What could not be checked on the machine this was written on (Windows 11
 * Home, which has no Group Policy editor): that the files load in GPMC or
 * gpedit.msc, and that Intune's ADMX ingestion accepts them. Their structure
 * follows the ADMX files Microsoft ships in C:\Windows\PolicyDefinitions.
 */

const i18n = require('../../i18n');
require('../../i18n/vi');

const { t } = i18n;
const { KEY, VALUES, CATEGORIES } = require('./schema');
const { DEFAULT_CATEGORIES, LIMITS } = require('../lib/settings');

/** The ADML languages: Windows' folder name for each, and the app's own code. */
const LANGUAGES = Object.freeze([
  { folder: 'en-US', code: 'en' },
  { folder: 'vi-VN', code: 'vi' },
]);

const REVISION = '1.0';
const SUPPORTED = 'SUPPORTED_CleanDrive_0_5';

/**
 * The ADMX and ADML namespace. Counted on this machine's
 * C:\Windows\PolicyDefinitions (2026-10-01): 27 of the 29 ADMX files that
 * declare one use this, and two (GameDVR, PowerShellExecutionPolicy) an older
 * `http://www.microsoft.com/GroupPolicy/PolicyDefinitions`; every ADML uses
 * this one too.
 */
const NAMESPACE = 'http://schemas.microsoft.com/GroupPolicy/2006/07/PolicyDefinitions';

const xml = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const keyOf = (spec) => (spec.key ? `${KEY}\\${spec.key}` : KEY);

/* ------------------------------------------------------------ words */

/** Each category's name, as the Automatic screen words it. */
const CATEGORY_TEXT = Object.freeze({
  temp: () => t('category.temp', 'Temporary files'),
  cache: () => t('category.cache', 'Caches'),
  crashdump: () => t('category.crashdump', 'Crash dumps'),
  log: () => t('category.log', 'Old log files'),
  gpucache: () => t('category.gpucache', 'GPU & compiled-code caches'),
  buildoutput: () => t('category.buildoutput', 'Build output'),
  'app.chrome': () => t('category.app.chrome', 'Google Chrome — cache'),
  'app.edge': () => t('category.app.edge', 'Microsoft Edge — cache'),
  'app.teams': () => t('category.app.teams', 'Microsoft Teams — cache'),
  'app.discord': () => t('category.app.discord', 'Discord — cache'),
  'app.zoom': () => t('category.app.zoom', 'Zoom — cache'),
  'app.figma': () => t('category.app.figma', 'Figma — cache'),
  'app.zalo': () => t('category.app.zalo', 'Zalo — cache'),
});

/** Every string the two files use, by its ADML id, in the language currently set. */
function strings() {
  const out = {
    CleanDrive: 'CleanDrive',
    [SUPPORTED]: t('policy.admx.supported', 'CleanDrive 0.5 and later'),

    ViewOnly: t('policy.admx.viewOnly', 'View only: change no files'),
    ViewOnly_Explain: t(
      'policy.admx.viewOnly.explain',
      'Enabled: CleanDrive shows what is on the disk and what could be cleaned, but moves, deletes, compresses and changes no file on this computer — not from its window, not on a schedule, not from the command line. It does not empty its own items from the Recycle Bin either.\n\nPutting things back still works: anything CleanDrive moved before can be restored from its Restore Center, except that a file now in the way is never replaced, because replacing would move it to the Recycle Bin.\n\nOpening a Windows tool from CleanDrive (Storage settings, a program’s uninstaller) is still allowed: the tool asks its own questions. So are making a smaller copy of a video and saving a report, which write a new file and change none that is there.\n\nDisabled or not configured: the person at the computer decides.\n\nApplies to every copy of CleanDrive, with or without CleanDrive Business.'
    ),

    AutomaticCleanup: t('policy.admx.automatic', 'Automatic cleanup'),
    AutomaticCleanup_Explain: t(
      'policy.admx.automatic.explain',
      'Disabled: automatic cleanup is off for every profile on this computer. Profiles the person set up are kept as they were and come back when this policy is removed. Applies to every copy of CleanDrive.\n\nEnabled: CleanDrive runs one profile of the organisation’s own, as a Windows scheduled task for each person who signs in. It goes through every rule a person’s own profile does: only the categories automatic cleanup may ever use, only files untouched for the given number of days, never Windows’ own folders, never files marked worth reviewing. Files go to the Recycle Bin, or to the quarantine folder on another drive, and can be put back from the Restore Center.\n\nIt starts in report only — it lists what it would move and moves nothing — unless “Report only” is cleared below. Each run that moves anything shows a notification saying it was the organisation’s profile.\n\nFolders may use %USERPROFILE%, %LOCALAPPDATA% and other variables; they are expanded for each person. Folders on the network are refused.\n\nEnabled needs CleanDrive Business; a copy without it reports this policy as not applied and runs nothing.\n\nThe task is registered the next time CleanDrive opens, or at once by “cleandrive policy apply” run as that person (a logon script, or an Intune script in the user’s context).'
    ),
    AutomaticFolders: t('policy.admx.automatic.folders', 'Folders it may clean:'),
    Schedule: t('policy.admx.automatic.schedule', 'How often'),
    Schedule_daily: t('auto.kind.daily', 'Every day'),
    Schedule_weekly: t('auto.kind.weekly', 'Every week'),
    Schedule_monthly: t('auto.kind.monthly', 'Every month'),
    Time: t('policy.admx.automatic.time', 'At (HH:MM, 24-hour clock)'),
    Weekday: t('policy.admx.automatic.weekday', 'On (for every week)'),
    Weekday_0: t('day.sunday', 'Sunday'),
    Weekday_1: t('day.monday', 'Monday'),
    Weekday_2: t('day.tuesday', 'Tuesday'),
    Weekday_3: t('day.wednesday', 'Wednesday'),
    Weekday_4: t('day.thursday', 'Thursday'),
    Weekday_5: t('day.friday', 'Friday'),
    Weekday_6: t('day.saturday', 'Saturday'),
    Day: t('policy.admx.automatic.day', 'On day (for every month, 1–28)'),
    ReportOnly: t('policy.admx.automatic.reportOnly', 'Report only: list what would go, move nothing'),
    Action: t('policy.admx.automatic.action', 'What it does'),
    Action_recycle: t('auto.action.recycle', 'Move to the Recycle Bin'),
    Action_quarantine: t('auto.action.quarantine', 'Move to another drive'),
    MinAgeDays: t('policy.admx.automatic.age', 'Untouched for at least (days)'),
    MinDiskUsedPercent: t('policy.admx.automatic.threshold', 'Only when the disk is over (% full, 0 = always)'),

    AllowedCategories: t('policy.admx.categories', 'Categories automatic cleanup may use'),
    AllowedCategories_Explain: t(
      'policy.admx.categories.explain',
      'Enabled: automatic cleanup uses only the categories ticked below — in the organisation’s profile and in every profile the person sets up. A person can still untick more; they cannot tick one that is not allowed here. Their own choices are kept and come back when this policy is removed.\n\nOnly categories CleanDrive already allows to run unattended are listed. Nothing here can let automatic cleanup touch anything else.\n\nDisabled or not configured: every category is available.\n\nApplies to every copy of CleanDrive.'
    ),

    ProtectedFolders: t('policy.admx.protected', 'Folders automatic cleanup never touches'),
    ProtectedFolders_Explain: t(
      'policy.admx.protected.explain',
      'Enabled: automatic cleanup never moves anything inside these folders, in any profile. A person can add more of their own; they cannot remove these.\n\nFolders may use %USERPROFILE% and other variables; they are expanded for each person.\n\nDisabled or not configured: only the folders the person lists, and the Windows folders CleanDrive always refuses.\n\nApplies to every copy of CleanDrive.'
    ),
    ProtectedFoldersList: t('policy.admx.protected.folders', 'Folders:'),

    DisableUpdateCheck: t('policy.admx.updates', 'Do not check for updates'),
    DisableUpdateCheck_Explain: t(
      'policy.admx.updates.explain',
      'Enabled: CleanDrive never contacts its release host to look for a new version — not on its own, and not when “Check now” is pressed. Updates are then the organisation’s to deploy.\n\nDisabled or not configured: the person decides, and checking is on by default.\n\nApplies to every copy of CleanDrive.'
    ),

    QuarantineFolder: t('policy.admx.quarantine', 'Where files moved to another drive go'),
    QuarantineFolder_Explain: t(
      'policy.admx.quarantine.explain',
      'Enabled: files CleanDrive moves to another drive go to a “CleanDrive Quarantine” folder inside the folder given here, and the person cannot choose another. The folder must be on a local drive; network folders, Windows’ own folders and folders inside OneDrive are refused, as they are when a person picks one.\n\nMay use %USERPROFILE% and other variables.\n\nNeeds CleanDrive Business; a copy without it reports this policy as not applied.'
    ),
    QuarantineFolderPath: t('policy.admx.quarantine.folder', 'Folder:'),

    MachineReport: t('policy.admx.report', 'Daily report for the CleanDrive console'),
    MachineReport_Explain: t(
      'policy.admx.report.explain',
      'Enabled: once a day, each computer writes one file, <computer name>.cleandrive.json, to the folder given here — normally a share on the organisation’s own network. There is no CleanDrive server and nothing goes to the internet. Open the files with “CleanDrive.exe --console <folder>”.\n\nThe file holds: how full each drive is, how fast it is growing and when it would fill (or why that cannot be said yet), the state of the scheduled cleanup tasks with the last run and its exit code, which policies took effect, the number of the newest seal on CleanDrive’s journal, and, from the last scan someone ran by hand, how much each cleanup category held. It names no file and no folder, and no cleanup profile by the name a person gave it.\n\n“Include the largest folders” adds the names and sizes of the largest folders from that last scan. Folder names can be people’s names, so it is off unless ticked.\n\nThe file is written with the rights of the person signed in, so they need permission to create and change files in the folder. The daily disk measurement that writes it is kept on while this policy is set.\n\nNeeds CleanDrive Business; a copy without it reports this policy as not applied and writes nothing.'
    ),
    ReportFolder: t('policy.admx.report.folder', 'Folder (for example \\\\server\\cleandrive):'),
    ReportTopFolders: t('policy.admx.report.top', 'Include the largest folders from the last scan'),
  };
  for (const name of CATEGORIES) out[`Category_${idOf(name)}`] = CATEGORY_TEXT[name] ? CATEGORY_TEXT[name]() : name;
  return out;
}

/** An element id from a category name: `app.chrome` -> `app_chrome`. */
const idOf = (name) => name.replace(/[^A-Za-z0-9]/g, '_');

/* ------------------------------------------------------------ ADMX */

const onOff = ['      <enabledValue>', '        <decimal value="1" />', '      </enabledValue>', '      <disabledValue>', '        <decimal value="0" />', '      </disabledValue>'];

function policyOpen(name, { presentation = false, valueName = true } = {}) {
  const spec = valueName ? Object.values(VALUES).find((v) => v.policy === name && v.key === '' && v.valueName) : null;
  return [
    `    <policy name="${name}" class="Machine" displayName="$(string.${name})" explainText="$(string.${name}_Explain)"` +
      `${presentation ? ` presentation="$(presentation.${name})"` : ''} key="${xml(KEY)}"${spec ? ` valueName="${spec.valueName}"` : ''}>`,
    '      <parentCategory ref="CleanDrive" />',
    `      <supportedOn ref="${SUPPORTED}" />`,
  ];
}

function enumOf(id, spec, items) {
  return [
    `        <enum id="${id}" key="${xml(keyOf(spec))}" valueName="${spec.valueName}" required="true">`,
    ...items.flatMap(([label, value]) => [
      `          <item displayName="$(string.${label})">`,
      '            <value>',
      typeof value === 'number' ? `              <decimal value="${value}" />` : `              <string>${xml(value)}</string>`,
      '            </value>',
      '          </item>',
    ]),
    '        </enum>',
  ];
}

const booleanOf = (id, key, valueName) => [
  `        <boolean id="${id}" key="${xml(key)}" valueName="${xml(valueName)}">`,
  '          <trueValue>',
  '            <decimal value="1" />',
  '          </trueValue>',
  '          <falseValue>',
  '            <decimal value="0" />',
  '          </falseValue>',
  '        </boolean>',
];

const decimalOf = (id, spec) =>
  `        <decimal id="${id}" key="${xml(keyOf(spec))}" valueName="${spec.valueName}" minValue="${spec.min}" maxValue="${spec.max}" />`;

function admx() {
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<!-- CleanDrive's Group Policy definitions. Written by scripts/build.js from src/main/policy/admx.js; do not edit. -->`,
    `<policyDefinitions xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" revision="${REVISION}" schemaVersion="1.0" xmlns="${NAMESPACE}">`,
    '  <policyNamespaces>',
    '    <target prefix="cleandrive" namespace="CleanDrive.Policies.CleanDrive" />',
    '  </policyNamespaces>',
    `  <resources minRequiredRevision="${REVISION}" />`,
    '  <supportedOn>',
    '    <definitions>',
    `      <definition name="${SUPPORTED}" displayName="$(string.${SUPPORTED})" />`,
    '    </definitions>',
    '  </supportedOn>',
    '  <categories>',
    '    <category name="CleanDrive" displayName="$(string.CleanDrive)" />',
    '  </categories>',
    '  <policies>',

    ...policyOpen('ViewOnly'),
    ...onOff,
    '    </policy>',

    ...policyOpen('AutomaticCleanup', { presentation: true }),
    ...onOff,
    '      <elements>',
    `        <list id="AutomaticFolders" key="${xml(keyOf(VALUES.autoFolders))}" expandable="true" />`,
    ...enumOf('Schedule', VALUES.autoSchedule, VALUES.autoSchedule.oneOf.map((k) => [`Schedule_${k}`, k])),
    `        <text id="Time" key="${xml(keyOf(VALUES.autoTime))}" valueName="${VALUES.autoTime.valueName}" required="true" maxLength="5" />`,
    ...enumOf('Weekday', VALUES.autoWeekday, [0, 1, 2, 3, 4, 5, 6].map((d) => [`Weekday_${d}`, d])),
    decimalOf('Day', VALUES.autoDay),
    ...booleanOf('ReportOnly', keyOf(VALUES.autoReportOnly), VALUES.autoReportOnly.valueName),
    ...enumOf('Action', VALUES.autoAction, VALUES.autoAction.oneOf.map((k) => [`Action_${k}`, k])),
    decimalOf('MinAgeDays', VALUES.autoMinAgeDays),
    decimalOf('MinDiskUsedPercent', VALUES.autoMinDiskUsed),
    '      </elements>',
    '    </policy>',

    ...policyOpen('AllowedCategories', { presentation: true }),
    ...onOff,
    '      <elements>',
    ...CATEGORIES.flatMap((name) => booleanOf(`Category_${idOf(name)}`, keyOf(VALUES.categoryList), name)),
    '      </elements>',
    '    </policy>',

    ...policyOpen('ProtectedFolders', { presentation: true }),
    ...onOff,
    '      <elements>',
    `        <list id="ProtectedFoldersList" key="${xml(keyOf(VALUES.protectedList))}" expandable="true" />`,
    '      </elements>',
    '    </policy>',

    ...policyOpen('DisableUpdateCheck'),
    ...onOff,
    '    </policy>',

    ...policyOpen('QuarantineFolder', { presentation: true, valueName: false }),
    '      <elements>',
    `        <text id="QuarantineFolderPath" key="${xml(keyOf(VALUES.quarantineFolder))}" valueName="${VALUES.quarantineFolder.valueName}" required="true" expandable="true" />`,
    '      </elements>',
    '    </policy>',

    ...policyOpen('MachineReport', { presentation: true, valueName: false }),
    '      <elements>',
    `        <text id="ReportFolder" key="${xml(keyOf(VALUES.reportFolder))}" valueName="${VALUES.reportFolder.valueName}" required="true" expandable="true" />`,
    ...booleanOf('ReportTopFolders', keyOf(VALUES.reportTopFolders), VALUES.reportTopFolders.valueName),
    '      </elements>',
    '    </policy>',

    '  </policies>',
    '</policyDefinitions>',
    '',
  ];
  return `\uFEFF${lines.join('\r\n')}`;
}

/* ------------------------------------------------------------ ADML */

function adml(code) {
  const before = i18n.getLanguage();
  i18n.setLanguage(code);
  try {
    const words = strings();
    const defaultWeekly = VALUES.autoSchedule.oneOf.indexOf('weekly');
    const lines = [
      '<?xml version="1.0" encoding="utf-8"?>',
      `<!-- Written by scripts/build.js from src/main/policy/admx.js; do not edit. -->`,
      `<policyDefinitionResources xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" revision="${REVISION}" schemaVersion="1.0" xmlns="${NAMESPACE}">`,
      '  <displayName>CleanDrive</displayName>',
      `  <description>${xml(t('policy.admx.description', 'Group Policy settings for CleanDrive'))}</description>`,
      '  <resources>',
      '    <stringTable>',
      ...Object.entries(words).map(([id, text]) => `      <string id="${id}">${xml(text).replace(/\n/g, '\r\n')}</string>`),
      '    </stringTable>',
      '    <presentationTable>',
      '      <presentation id="AutomaticCleanup">',
      '        <listBox refId="AutomaticFolders">$(string.AutomaticFolders)</listBox>',
      `        <dropdownList refId="Schedule" noSort="true" defaultItem="${defaultWeekly}">$(string.Schedule)</dropdownList>`,
      '        <textBox refId="Time">',
      '          <label>$(string.Time)</label>',
      '          <defaultValue>02:00</defaultValue>',
      '        </textBox>',
      '        <dropdownList refId="Weekday" noSort="true" defaultItem="0">$(string.Weekday)</dropdownList>',
      '        <decimalTextBox refId="Day" defaultValue="1">$(string.Day)</decimalTextBox>',
      '        <checkBox refId="ReportOnly" defaultChecked="true">$(string.ReportOnly)</checkBox>',
      '        <dropdownList refId="Action" noSort="true" defaultItem="0">$(string.Action)</dropdownList>',
      `        <decimalTextBox refId="MinAgeDays" defaultValue="${LIMITS.minAgeDays.fallback}">$(string.MinAgeDays)</decimalTextBox>`,
      '        <decimalTextBox refId="MinDiskUsedPercent" defaultValue="0">$(string.MinDiskUsedPercent)</decimalTextBox>',
      '      </presentation>',
      '      <presentation id="AllowedCategories">',
      ...CATEGORIES.map(
        (name) =>
          `        <checkBox refId="Category_${idOf(name)}" defaultChecked="${DEFAULT_CATEGORIES.includes(name)}">$(string.Category_${idOf(name)})</checkBox>`
      ),
      '      </presentation>',
      '      <presentation id="ProtectedFolders">',
      '        <listBox refId="ProtectedFoldersList">$(string.ProtectedFoldersList)</listBox>',
      '      </presentation>',
      '      <presentation id="QuarantineFolder">',
      '        <textBox refId="QuarantineFolderPath">',
      '          <label>$(string.QuarantineFolderPath)</label>',
      '        </textBox>',
      '      </presentation>',
      '      <presentation id="MachineReport">',
      '        <textBox refId="ReportFolder">',
      '          <label>$(string.ReportFolder)</label>',
      '        </textBox>',
      '        <checkBox refId="ReportTopFolders" defaultChecked="false">$(string.ReportTopFolders)</checkBox>',
      '      </presentation>',
      '    </presentationTable>',
      '  </resources>',
      '</policyDefinitionResources>',
      '',
    ];
    return `\uFEFF${lines.join('\r\n')}`;
  } finally {
    i18n.setLanguage(before);
  }
}

/** Every file, by the path it has under `policy/` and in the installed app. */
function files() {
  return {
    'CleanDrive.admx': admx(),
    ...Object.fromEntries(LANGUAGES.map(({ folder, code }) => [`${folder}/CleanDrive.adml`, adml(code)])),
  };
}

module.exports = { admx, adml, files, strings, LANGUAGES, CATEGORY_TEXT, idOf };
