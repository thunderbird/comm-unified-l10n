/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Utils for testing interactions with OAuth2 authentication servers.
 */

// eslint-disable-next-line no-shadow
import { Assert } from "resource://testing-common/Assert.sys.mjs";
import { BrowserTestUtils } from "resource://testing-common/BrowserTestUtils.sys.mjs";
import { CommonUtils } from "resource://services-common/utils.sys.mjs";
import { HttpsProxy } from "resource://testing-common/mailnews/HttpsProxy.sys.mjs";
import { HttpServer, HTTP_405 } from "resource://testing-common/httpd.sys.mjs";
import { TestUtils } from "resource://testing-common/TestUtils.sys.mjs";

import { OAuth2Module } from "resource:///modules/OAuth2Module.sys.mjs";

const validCodes = new Set();
const tokens = new Map();

export const OAuth2TestUtils = {
  /**
   * Start an OAuth2 server and add it to the proxy at oauth.test.test:443.
   */
  async startServer(serverOptions) {
    this._oAuth2Server = new OAuth2Server(serverOptions);
    this._proxy = await HttpsProxy.create(
      this._oAuth2Server.httpServer.identity.primaryPort,
      "oauth",
      "oauth.test.test"
    );
    TestUtils.promiseTestFinished?.then(() => {
      this.stopServer();
      this.forgetObjects();
    });
    return this._oAuth2Server;
  },

  stopServer() {
    this._proxy?.destroy();
    this._proxy = null;
    this._oAuth2Server?.close();
    this._oAuth2Server = null;
  },

  /**
   * Forget any `OAuth2` objects remembered by OAuth2Module.sys.mjs
   */
  forgetObjects() {
    OAuth2Module._forgetObjects();
  },

  /**
   * Waits for a login prompt window to appear and load.
   *
   * @returns {Window}
   */
  async promiseOAuthWindow() {
    const oAuthWindow = await BrowserTestUtils.domWindowOpenedAndLoaded(
      undefined,
      win =>
        win.document.documentURI ==
        "chrome://messenger/content/browserRequest.xhtml"
    );
    const oAuthBrowser = oAuthWindow.getBrowser();
    if (
      oAuthBrowser.webProgress?.isLoadingDocument ||
      oAuthBrowser.currentURI.spec == "about:blank"
    ) {
      await BrowserTestUtils.browserLoaded(oAuthBrowser);
    }
    return oAuthWindow;
  },

  /**
   * Callback function to run in a login prompt window. Note: This function is
   * serialized by SpecialPowers, so it can't use function shorthand.
   *
   * @param {object} options
   * @param {string} [options.expectedHint] - If given, the login_hint URL parameter
   * @param {string} [options.expectedScope] - If given, the scope URL parameter
   *   will be checked. A space-separated list.
   * @param {string} options.username - The username to use to log in.
   * @param {string} options.password - The password to use to log in.
   * @param {string} [options.grantedScope] - A subset of `expectedScope` to grant
   *   permission for. If not given, all scopes will be allowed. If an empty string,
   *   no scopes will be allowed.
   */
  submitOAuthLogin: async ({
    expectedHint,
    expectedScope = "test_mail test_addressbook test_calendar",
    username,
    password,
    grantedScope,
  }) => {
    /* globals content, EventUtils */
    const searchParams = new URL(content.location).searchParams;
    Assert.equal(
      searchParams.get("response_type"),
      "code",
      "request response_type"
    );
    Assert.equal(
      searchParams.get("client_id"),
      "test_client_id",
      "request client_id"
    );
    Assert.equal(
      searchParams.get("redirect_uri"),
      "https://localhost",
      "request redirect_uri"
    );
    Assert.equal(searchParams.get("scope"), expectedScope, "request scope");
    if (expectedHint) {
      Assert.equal(
        searchParams.get("login_hint"),
        expectedHint,
        "request login_hint"
      );
    }

    EventUtils.synthesizeMouseAtCenter(
      content.document.querySelector(`input[name="username"]`),
      {},
      content
    );
    EventUtils.sendString(username, content);
    EventUtils.synthesizeMouseAtCenter(
      content.document.querySelector(`input[name="password"]`),
      {},
      content
    );
    EventUtils.sendString(password, content);

    if (grantedScope === undefined) {
      grantedScope = expectedScope;
    }
    if (grantedScope) {
      for (const scope of grantedScope.split(" ")) {
        content.document.querySelector(
          `input[name="scope"][value="${scope}"]`
        ).checked = true;
      }
    }

    EventUtils.synthesizeMouseAtCenter(
      content.document.querySelector(`input[type="submit"]`),
      {},
      content
    );
  },

  /**
   * Check that the granted `token` is valid for the `scope`.
   *
   * @param {string} token
   * @param {string} scope
   * @returns {boolean}
   */
  validateToken(token, scope) {
    const grantedScope = tokens.get(token);
    if (!token) {
      return false;
    }

    return grantedScope.split(" ").includes(scope);
  },

  /**
   * Check the recorded telemetry values match what we expect. Don't forget to
   * reset the data `Services.fog.testResetFOG()` at the start of the test.
   *
   * @param {object[]} expectedEvents - What should have been recorded.
   */
  checkTelemetry(expectedEvents) {
    const events = Glean.mail.oauth2Authentication.testGetValue();
    if (expectedEvents.length) {
      if (events) {
        Assert.equal(
          events.length,
          expectedEvents.length,
          "OAuth telemetry should have been recorded"
        );
        for (let i = 0; i < expectedEvents.length; i++) {
          Assert.deepEqual(events[i].extra, expectedEvents[i]);
        }
      } else {
        Assert.notEqual(
          events,
          null,
          "OAuth telemetry should have been recorded"
        );
      }
    } else {
      Assert.equal(
        events,
        null,
        "no OAuth telemetry should have been recorded"
      );
    }
  },
};

class OAuth2Server {
  constructor({
    username = "user",
    password = "password",
    accessToken = "access_token",
    refreshToken = "refresh_token",
    rotateTokens = false,
    expiry = null,
  } = {}) {
    this.username = username;
    this.password = password;
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.rotateTokens = rotateTokens;
    this.expiry = expiry;

    this.httpServer = new HttpServer();
    this.httpServer.registerPathHandler("/form", this.formHandler.bind(this));
    this.httpServer.registerPathHandler(
      "/authorize",
      this.authorizeHandler.bind(this)
    );
    this.httpServer.registerPathHandler("/token", this.tokenHandler.bind(this));
    this.httpServer.start(-1);

    const port = this.httpServer.identity.primaryPort;
    dump(`OAuth2 server at localhost:${port} opened\n`);
  }

  close() {
    const port = this.httpServer.identity.primaryPort;
    this.httpServer.stop();
    dump(`OAuth2 server at localhost:${port} closed\n`);
    tokens.clear();
  }

  formHandler(request, response) {
    if (request.method != "GET") {
      throw HTTP_405;
    }
    const params = new URLSearchParams(request.queryString);
    this.requestedScope = params.get("scope");
    this._formHandler(response, params.get("redirect_uri"));
  }

  _formHandler(response, redirectUri) {
    response.setHeader("Content-Type", "text/html", false);
    const scopeCheckboxes = this.requestedScope
      .split(" ")
      .map(
        scope =>
          `<label><input type="checkbox" name="scope" value="${scope}"> ${scope}</label>`
      );
    response.write(`<!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Log in to test.test</title>
      </head>
      <body>
        <form action="/authorize" method="post">
          <input type="text" name="redirect_uri" readonly="readonly" value="${redirectUri}" />
          <input type="text" name="username" />
          <input type="password" name="password" />
          ${scopeCheckboxes.join("")}
          <input type="submit" />
        </form>
      </body>
      </html>
    `);
  }

  authorizeHandler(request, response) {
    if (request.method != "POST") {
      throw HTTP_405;
    }

    const input = CommonUtils.readBytesFromInputStream(request.bodyInputStream);
    const params = new URLSearchParams(input);

    if (
      params.get("username") != this.username ||
      params.get("password") != this.password
    ) {
      this._formHandler(response, params.get("redirect_uri"));
      return;
    }

    const url = new URL(params.get("redirect_uri"));
    if (params.getAll("scope").includes("bad_scope")) {
      url.searchParams.set("error", "invalid_scope");
    } else {
      this.grantedScope = params.getAll("scope").join(" ");

      // Create a unique code. It will become invalid after the first use.
      const bytes = new Uint8Array(12);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Math.floor(Math.random() * 255);
      }
      const code = ChromeUtils.base64URLEncode(bytes, { pad: false });
      validCodes.add(code);

      url.searchParams.set("code", code);
    }

    response.setStatusLine(request.httpVersion, 303, "Redirected");
    response.setHeader("Location", url.href);
  }

  tokenHandler(request, response) {
    if (request.method != "POST") {
      throw HTTP_405;
    }

    const stream = Cc["@mozilla.org/binaryinputstream;1"].createInstance(
      Ci.nsIBinaryInputStream
    );
    stream.setInputStream(request.bodyInputStream);
    const input = stream.readBytes(request.bodyInputStream.available());
    const params = new URLSearchParams(input);

    const goodRequest =
      params.get("client_id") == "test_client_id" &&
      params.get("client_secret") == "test_secret";
    const grantType = params.get("grant_type");
    const code = params.get("code");
    const data = {};

    if (
      goodRequest &&
      grantType == "authorization_code" &&
      code &&
      validCodes.has(code)
    ) {
      // Authorisation just happened.
      validCodes.delete(code);
      data.access_token = this.accessToken;
      data.refresh_token = this.refreshToken;
      tokens.set(this.accessToken, this.grantedScope);
    } else if (
      goodRequest &&
      grantType == "refresh_token" &&
      params.get("refresh_token") == this.refreshToken
    ) {
      // Client provided a valid refresh token.
      data.access_token = this.accessToken;
      if (this.rotateTokens) {
        if (/\d+$/.test(this.refreshToken)) {
          this.refreshToken = this.refreshToken.replace(
            /\d+$/,
            suffix => parseInt(suffix, 10) + 1
          );
        } else {
          this.refreshToken = this.refreshToken + "_1";
        }
        data.refresh_token = this.refreshToken;
      }
      tokens.set(this.accessToken, this.grantedScope);
    } else {
      response.setStatusLine("1.1", 400, "Bad Request");
      data.error = "invalid_grant";
    }

    if (typeof this.grantedScope == "string") {
      data.scope = this.grantedScope;
    }

    if (data.access_token && this.expiry !== null) {
      data.expires_in = this.expiry;
    }

    response.setHeader("Content-Type", "application/json", false);
    response.write(JSON.stringify(data));
  }
}
