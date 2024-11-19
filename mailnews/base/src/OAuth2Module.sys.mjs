/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { OAuth2 } from "resource:///modules/OAuth2.sys.mjs";

import { OAuth2Providers } from "resource:///modules/OAuth2Providers.sys.mjs";

const log = console.createInstance({
  prefix: "mailnews.oauth",
  maxLogLevel: "Warn",
  maxLogLevelPref: "mailnews.oauth.loglevel",
});

/**
 * A collection of `OAuth2` objects that have previously been created.
 * Only weak references are stored here, so if all the owners of an `OAuth2`
 * is cleaned up, so is the object itself.
 */
const oAuth2Objects = new Set();

/**
 * OAuth2Module is the glue layer that gives XPCOM access to an OAuth2
 * bearer token it can use to authenticate in SASL steps.
 * It also takes care of persising the refreshToken for later usage.
 *
 * @implements {msgIOAuth2Module}
 */
export function OAuth2Module() {}

OAuth2Module.prototype = {
  QueryInterface: ChromeUtils.generateQI(["msgIOAuth2Module"]),

  initFromOutgoing(aServer) {
    return this.initFromHostname(aServer.serverURI.host, aServer.username);
  },

  initFromMail(aServer) {
    return this.initFromHostname(aServer.hostName, aServer.username);
  },

  initFromABDirectory(aDirectory, aHostname) {
    this.initFromHostname(
      aHostname,
      aDirectory.getStringValue("carddav.username", "") || aDirectory.UID
    );
  },

  initFromHostname(aHostname, aUsername) {
    const details = OAuth2Providers.getHostnameDetails(aHostname);
    if (!details) {
      return false;
    }

    return this._init(details[0], details[1], aHostname, aUsername);
  },

  _init(issuer, scope, aHostname, aUsername) {
    // Find the app key we need for the OAuth2 string. Eventually, this should
    // be using dynamic client registration, but there are no current
    // implementations that we can test this with.
    const issuerDetails = OAuth2Providers.getIssuerDetails(issuer);
    if (!issuerDetails.clientId) {
      return false;
    }

    // Username is needed to generate the XOAUTH2 string.
    this._username = aUsername;
    // loginOrigin is needed to save the refresh token in the password manager.
    this._loginOrigin = "oauth://" + issuer;
    // We use the scope to indicate realm when storing in the password manager.
    this._scope = scope;

    // Look for an existing `OAuth2` object with the same endpoint, username
    // and scope.
    const wantedScopes = scopeSet(this._scope);
    for (const weakRef of oAuth2Objects) {
      const oauth = weakRef.deref();
      if (!oauth) {
        oAuth2Objects.delete(weakRef);
        continue;
      }
      if (
        oauth.authorizationEndpoint == issuerDetails.authorizationEndpoint &&
        oauth.username == aUsername &&
        scopeSet(oauth.scope).isSupersetOf(wantedScopes)
      ) {
        log.debug(`Found existing OAuth2 object for ${issuer}`);
        this._oauth = oauth;
        break;
      }
    }
    if (!this._oauth) {
      log.debug(`Creating a new OAuth2 object for ${issuer}`);
      // Define the OAuth property and store it.
      this._oauth = new OAuth2(scope, issuerDetails);
      this._oauth.username = aUsername;
      oAuth2Objects.add(new WeakRef(this._oauth));

      // Try hinting the username...
      this._oauth.extraAuthParams = [["login_hint", aUsername]];

      // Set the window title to something more useful than "Unnamed"
      this._oauth.requestWindowTitle = Services.strings
        .createBundle("chrome://messenger/locale/messenger.properties")
        .formatStringFromName("oauth2WindowTitle", [aUsername, aHostname]);

      // This gets the refresh token from the login manager.
      this._oauth.refreshToken = this.getRefreshToken();
    }

    return true;
  },

  getRefreshToken() {
    const wantedScopes = scopeSet(this._scope);

    for (const login of Services.logins.findLogins(
      this._loginOrigin,
      null,
      ""
    )) {
      if (login.username != this._username) {
        continue;
      }

      if (scopeSet(login.httpRealm).isSupersetOf(wantedScopes)) {
        return login.password;
      }
    }
    return "";
  },
  async setRefreshToken(token) {
    const scope = this._oauth.scope ?? this._scope;
    const grantedScopes = scopeSet(scope);

    // Update any existing logins matching this origin, username, and scope.
    const logins = Services.logins.findLogins(this._loginOrigin, null, "");
    let didChangePassword = false;
    for (const login of logins) {
      if (login.username != this._username) {
        continue;
      }

      const loginScopes = scopeSet(login.httpRealm);
      if (grantedScopes.isSupersetOf(loginScopes)) {
        if (grantedScopes.size == loginScopes.size) {
          // The scope matches, just update the token.
          log.debug(
            `Updating existing token for ${this._loginOrigin} with scope "${scope}"`
          );
          const propBag = Cc["@mozilla.org/hash-property-bag;1"].createInstance(
            Ci.nsIWritablePropertyBag
          );
          propBag.setProperty("password", token);
          Services.logins.modifyLogin(login, propBag);
          didChangePassword = true;
        } else {
          // We've got a new token for this scope, remove the existing one.
          log.debug(
            `Removing superceded token for ${this._loginOrigin} with scope "${login.httpRealm}"`
          );
          Services.logins.removeLogin(login);
        }
      }
    }

    // Unless the token is null, we need to create and fill in a new login.
    if (!didChangePassword && token) {
      log.debug(
        `Creating new login for ${this._loginOrigin} with httpRealm "${scope}"`
      );
      const login = Cc["@mozilla.org/login-manager/loginInfo;1"].createInstance(
        Ci.nsILoginInfo
      );
      login.init(this._loginOrigin, null, scope, this._username, token, "", "");
      await Services.logins.addLoginAsync(login);
    }
  },

  connect(aWithUI, aListener) {
    this._fetchAccessToken(aListener, aWithUI, true);
  },

  getAccessToken(aListener) {
    this._fetchAccessToken(aListener, true, false);
  },

  /**
   * Gets a current access token for the provider.
   *
   * @param {msgIOAuth2ModuleListener} listener - The listener for the results
   *   of authentication.
   * @param {bool} shouldPrompt - If true and user input is needed to complete
   *   authentication (such as logging in to the provider), prompt the user.
   *   Otherwise, return an error.
   * @param {bool} shouldMakeSaslToken - If true, return an access token
   *   formatted for use with SASL XOAUTH2. Otherwise, return the access token
   *   unmodified.
   */
  _fetchAccessToken(listener, shouldPrompt, shouldMakeSaslToken) {
    // NOTE: `onPromptStartAsync` and `onPromptAuthAvailable` have _different_
    // values for `this` due to differences in how arrow functions bind `this`
    // (i.e., to the surrounding lexical scope rather than the object of which)
    // they are a member).
    const promptListener = {
      onPromptStartAsync(callback) {
        this.onPromptAuthAvailable(callback);
      },

      onPromptAuthAvailable: callback => {
        const oldRefreshToken = this._oauth.refreshToken;

        this._oauth.connect(shouldPrompt, false).then(
          async () => {
            if (
              this._oauth.refreshToken != oldRefreshToken ||
              this._oauth.scope != this._scope
            ) {
              // Refresh token and/or scope changed; save it.
              await this.setRefreshToken(this._oauth.refreshToken);
            }

            let retval = this._oauth.accessToken;
            if (shouldMakeSaslToken) {
              // Pre-format the return value for an SASL XOAUTH2 client response
              // if that's what the consumer is expecting.
              retval = btoa(
                `user=${this._username}\x01auth=Bearer ${retval}\x01\x01`
              );
            }

            listener.onSuccess(retval);
            callback?.onAuthResult(true);
          },
          () => {
            listener.onFailure(Cr.NS_ERROR_ABORT);
            callback?.onAuthResult(false);
          }
        );
      },
      onPromptCanceled() {
        listener.onFailure(Cr.NS_ERROR_ABORT);
      },
      onPromptStart() {},
    };

    const asyncPrompter = Cc[
      "@mozilla.org/messenger/msgAsyncPrompter;1"
    ].getService(Ci.nsIMsgAsyncPrompter);

    const promptKey = `${this._loginOrigin}/${this._username}`;
    asyncPrompter.queueAsyncAuthPrompt(promptKey, false, promptListener);
  },
};

/**
 * Forget any `OAuth2` objects we've stored, which is necessary in some
 * testing scenarios.
 */
OAuth2Module._forgetObjects = function () {
  log.debug("Clearing OAuth2 objects from cache");
  oAuth2Objects.clear();
};

/**
 * Turns a space-delimited string of scopes into a Set containing the scopes.
 *
 * @param {string} scopeString
 * @returns {Set}
 */
function scopeSet(scopeString) {
  if (!scopeString) {
    return new Set();
  }
  return new Set(scopeString.split(" "));
}
