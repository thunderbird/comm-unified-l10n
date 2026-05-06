/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  ExtensionData: "resource://gre/modules/Extension.sys.mjs",
});

/**
 * The default time between events of the same kind, which should be collapsed
 * into a single WebExtension event.
 */
export const NOTIFICATION_COLLAPSE_TIME = 200;

/**
 * Returns the native messageManager group associated with the given WebExtension
 * linkHandler.
 *
 * @param {string} linkHandler
 * @returns {string}
 */
export function getMessageManagerGroup(linkHandler) {
  switch (linkHandler) {
    case "relaxed":
      return "browsers";
    case "strict":
      return "single-page";
    case "balanced":
    default:
      return "single-site";
  }
}

/**
 * Updates the status preferences used by the IAN system to track extensions being
 * installed or not.
 */
export async function checkInstalledExtensions() {
  // These add-ons are installed by tests and need to be excluded when checking
  // for installed add-ons.
  const TEST_ADDONS = ["special-powers@mozilla.org", "mochikit@mozilla.org"];

  const addons = await lazy.AddonManager.getAllAddons();
  // Use allSettled to single out add-on whose resources are unavailable, because
  // they are already torn down.
  const results = await Promise.allSettled(
    addons
      .filter(a => a.type === "extension" && !TEST_ADDONS.includes(a.id))
      .map(parseManifest)
  );
  const extensionInfo = results
    .filter(r => r.status === "fulfilled")
    .map(r => r.value);

  Services.prefs.setBoolPref(
    "extensions.hasExtensionsInstalled",
    extensionInfo.filter(e => e.isActive && !e.isSpecial).length > 0
  );
  // If false, we can propose to move to Release.
  Services.prefs.setBoolPref(
    "extensions.hasExperimentsInstalled",
    extensionInfo.filter(e => e.isActive && !e.isSpecial && e.isExperiment)
      .length > 0
  );
}
/**
 * Parses the manifest of an add-on and determines its type flags.
 *
 * @param {AddonWrapper} addon - The add-on to parse.
 * @returns {object} result
 * @returns {AddonWrapper} result.addon - The original add-on.
 * @returns {boolean} result.isActive - Whether the add-on is active.
 * @returns {boolean} result.isLegacy - Whether the add-on uses the legacy
 *   manifest key.
 * @returns {boolean} result.isSpecial - Whether the add-on is a system, builtin
 *   or privileged add-on.
 * @returns {boolean} result.isExperiment - Whether the add-on declares
 *   experiment APIs.
 */
export async function parseManifest(addon) {
  const data = new lazy.ExtensionData(addon.getResourceURI());
  await data.loadManifest();

  const isLegacy = !!data.manifest.legacy;
  const isExperiment = !!data.manifest.experiment_apis;
  const isActive = addon.isActive;
  const isSpecial = addon.isSystem || addon.isBuiltin || addon.isPrivileged;

  return {
    addon,
    isActive,
    isLegacy,
    isSpecial,
    isExperiment,
  };
}
