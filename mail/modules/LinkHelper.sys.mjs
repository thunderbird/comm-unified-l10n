/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { PlacesUtils } from "resource://gre/modules/PlacesUtils.sys.mjs";

/**
 * Clone principal and add permission to use the application associated with
 * the specified external protocol/scheme.
 *
 * @param { nsIPrincipal } principal - the principal to clone and attach the
 *    permission to
 * @param {nsIURI} uri - the uri which is to be opened
 * @param {OriginAttributesDictionary} [originAttributes]
 *
 * @returns {nsIPrincipal}
 */
export function getClonedPrincipalWithProtocolPermission(
  principal,
  uri,
  originAttributes
) {
  const clone = Services.scriptSecurityManager.principalWithOA(
    principal,
    originAttributes ?? principal.originAttributes
  );
  Services.perms.addFromPrincipal(
    clone,
    `open-protocol-handler^${uri.scheme}`,
    Services.perms.ALLOW_ACTION
  );
  return clone;
}

/**
 * Create a general content principal and add permission to use the application
 * associated with the specified external protocol/scheme.
 *
 * @param { nsIURI } uri - the uri which is to be opened
 * @returns {nsIPrincipal}
 */
export function getContentPrincipalWithProtocolPermission(uri) {
  const principal = Services.scriptSecurityManager.createContentPrincipal(
    Services.io.newURI("chrome://messenger/content/messenger.xhtml"),
    {}
  );
  Services.perms.addFromPrincipal(
    principal,
    `open-protocol-handler^${uri.scheme}`,
    Services.perms.ALLOW_ACTION
  );
  return principal;
}

/**
 * Forces a url to open in an external application according to the protocol
 * service settings.
 *
 * @param {string|nsIURI} url - A url string or an nsIURI containing the url to
 *   open.
 * @param {object} [options]
 * @param {boolean} [options.addToHistory=true] - Whether to add the opened url
 *   to the history.
 * @param {nsIPrincipal} [options.principal] - A triggering principal.
 */
export function openLinkExternally(url, options) {
  const addToHistory = options?.addToHistory ?? true;

  let uri = url;
  if (!(uri instanceof Ci.nsIURI)) {
    uri = Services.io.newURI(url);
  }

  if (addToHistory) {
    // This can fail if there is a problem with the places database.
    PlacesUtils.history
      .insert({
        url, // accepts both string and nsIURI
        visits: [
          {
            date: new Date(),
          },
        ],
      })
      .catch(console.error);
  }
  const isHttp = ["http", "https"].includes(uri.scheme);
  const promptForPermission =
    !isHttp &&
    Services.prefs.getBoolPref("mail.external_protocol_requires_permission");

  let principal = options?.principal;
  if (!promptForPermission) {
    principal = principal
      ? getClonedPrincipalWithProtocolPermission(principal, uri)
      : getContentPrincipalWithProtocolPermission(uri);
  }

  Cc["@mozilla.org/uriloader/external-protocol-service;1"]
    .getService(Ci.nsIExternalProtocolService)
    .loadURI(uri, principal);
}

/**
 * Opens the given url in a new tab in the most recent mail window. All provided
 * parameters are passed into openTab(), if any.
 *
 * @param {string} url
 * @param {object} [params]
 */
export function openLinkInNewTab(url, params = {}) {
  const mailWindow = Services.wm.getMostRecentWindow("mail:3pane");
  if (mailWindow) {
    mailWindow.focus();
    mailWindow.document
      .getElementById("tabmail")
      .openTab("contentTab", { url, ...params });
  }
}

/**
 *
 * @param {string} query - The string to search for.
 */
export function openWebSearch(query) {
  return Services.search.init().then(async () => {
    const engine = await Services.search.getDefault();
    openLinkExternally(engine.getSubmission(query).uri.spec);

    Glean.mail.websearchUsage[engine.name.toLowerCase()].add(1);
  });
}

/**
 * Open a URL from a click listener in the UI only when the primary mouse button
 * is pressed.
 *
 * @param {string|nsIURI} url
 * @param {MouseEvent} event
 */
export function openUILink(url, event) {
  if (!event.button) {
    openLinkExternally(url);
  }
}
