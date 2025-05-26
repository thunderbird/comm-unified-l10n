/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Files to exclude from ESLint.
 *
 * Please DO NOT add more third party files to this file.
 * They should be added to tools/rewriting/ThirdPartyPaths.txt instead.
 *
 * Please also DO NOT add  generated files that are for some reason checked
 * into source - add them to tools/rewriting/Generated.txt instead.
 *
 * This file should only be used for exclusions where we have:
 * - preprocessed files
 * - intentionally invalid files
 * - build directories and other items that we need to ignore
 *
 * @type {string[]}
 */
export default [
  // Ignore xhtml for now, see bug 1605845
  "**/*.xhtml",

  // Ignore VSCode files
  ".vscode/",
  // Always ignore node_modules.
  "**/node_modules/**/*.*",

  // Exclude expected objdirs.
  "obj*/**",

  // Exclude mozilla directory, this one is checked separately
  "mozilla/**",

  // These directories don't contain any js and are not meant to
  "config/**",
  "other-licenses/**",
  "testing/**",

  // We ignore all these directories by default, until we get them enabled.
  // If you are enabling a directory, please add directory specific exclusions
  // below.
  "build/**",
  "suite/**",

  // calendar/ exclusions
  "calendar/base/calendar.js",

  // chat exclusions
  "chat/chat-prefs.js",
  // preprocessed files
  "chat/content/imtooltip.xml",

  // mailnews exclusions
  "mailnews/mailnews.js",
  "mailnews/extensions/mdn/mdn.js",

  // mail exclusions
  "mail/app/profile/all-thunderbird.js",
  "mail/app/profile/channel-prefs.js",
  "mail/branding/include/release-prefs.js",
  "mail/branding/nightly/pref/thunderbird-branding.js",
  "mail/branding/tb_beta/pref/thunderbird-branding.js",
  "mail/branding/thunderbird/pref/thunderbird-branding.js",
  // This file is split into two in order to keep it as a valid json file
  // for documentation purposes (policies.json) but to be accessed by the
  // code as a JS module (schema.sys.mjs)
  "mail/components/enterprisepolicies/schemas/schema.sys.mjs",
  "mail/components/im/all-im.js",
  "mail/extensions/am-e2e/prefs/e2e-prefs.js",
  "mail/locales/en-US/all-l10n.js",
  "mail/components/compose/composer.js",

  // Ignore the jsdoc config file
  "docs/jsdoc.conf.js",

  // Intentionally incorrect
  "mailnews/test/data/alias-9.json",
];
