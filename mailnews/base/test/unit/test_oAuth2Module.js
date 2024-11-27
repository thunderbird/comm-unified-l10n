/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

const { OAuth2Module } = ChromeUtils.importESModule(
  "resource:///modules/OAuth2Module.sys.mjs"
);
const { OAuth2TestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/OAuth2TestUtils.sys.mjs"
);
const { setTimeout } = ChromeUtils.importESModule(
  "resource://gre/modules/Timer.sys.mjs"
);

/**
 * Tests that refresh tokens are correctly retrieved from the login manager.
 */
add_task(async function testGetRefreshToken() {
  await storeLogins([
    // Some logins we don't ever want to see in this test.
    ["https://test.test", "test_scope", "charlie@foo.invalid", "WRONG"],
    ["https://test.test", "test_scope", "mike@mochi.test", "WRONG"],
    ["oauth://test.test", "unknown_scope", "oscar@mochi.test", "WRONG"],
    // Good logins.
    ["oauth://test.test", "test_scope", "charlie@foo.invalid", "charlie"],
    [
      "oauth://test.test",
      "test_mail test_addressbook test_calendar",
      "juliet@bar.invalid",
      "juliet",
    ],
    [
      "oauth://test.test",
      "test_calendar test_addressbook test_mail",
      "mike@bar.invalid",
      "mike",
    ],
    ["oauth://test.test", "test_mail", "oscar@bar.invalid", "oscar-mail"],
    [
      "oauth://test.test",
      "test_addressbook",
      "oscar@bar.invalid",
      "oscar-addressbook",
    ],
    [
      "oauth://test.test",
      "test_calendar",
      "oscar@bar.invalid",
      "oscar-calendar",
    ],
  ]);

  // charlie@foo.invalid has a token for mochi.test.

  info("charlie@foo.invalid: mochi.test");
  let mod = new OAuth2Module();
  mod.initFromHostname("mochi.test", "charlie@foo.invalid", "imap");
  Assert.equal(mod._scope, "test_scope");
  Assert.deepEqual([...mod._requiredScopes], ["test_scope"]);
  Assert.equal(mod._loginOrigin, "oauth://test.test");
  Assert.equal(mod._username, "charlie@foo.invalid");
  Assert.equal(mod.getRefreshToken(), "charlie");

  OAuth2TestUtils.forgetObjects();

  // charlie@bar.invalid does not have a token for mochi.test.
  // (Username doesn't match.)

  info("charlie@bar.invalid: mochi.test");
  mod = new OAuth2Module();
  mod.initFromHostname("mochi.test", "charlie@bar.invalid", "imap");
  Assert.equal(mod._scope, "test_scope");
  Assert.deepEqual([...mod._requiredScopes], ["test_scope"]);
  Assert.equal(mod._loginOrigin, "oauth://test.test");
  Assert.equal(mod._username, "charlie@bar.invalid");
  Assert.equal(mod.getRefreshToken(), "");

  OAuth2TestUtils.forgetObjects();

  // charlie@foo.invalid does not have a token for test.test.
  // (Domain doesn't match.)

  info("charlie@foo.invalid: test.test");
  mod = new OAuth2Module();
  mod.initFromHostname("test.test", "charlie@foo.invalid", "imap");
  Assert.equal(mod._scope, "test_mail test_addressbook test_calendar");
  Assert.deepEqual([...mod._requiredScopes], ["test_mail"]);
  Assert.equal(mod._loginOrigin, "oauth://test.test");
  Assert.equal(mod._username, "charlie@foo.invalid");
  Assert.equal(mod.getRefreshToken(), "");

  OAuth2TestUtils.forgetObjects();

  // charlie@bar.invalid does not have a token for test.test.
  // (Username and domain don't match.)

  info("charlie@bar.invalid: test.test");
  mod = new OAuth2Module();
  mod.initFromHostname("test.test", "charlie@bar.invalid", "imap");
  Assert.equal(mod._scope, "test_mail test_addressbook test_calendar");
  Assert.deepEqual([...mod._requiredScopes], ["test_mail"]);
  Assert.equal(mod._loginOrigin, "oauth://test.test");
  Assert.equal(mod._username, "charlie@bar.invalid");
  Assert.equal(mod.getRefreshToken(), "");

  OAuth2TestUtils.forgetObjects();

  // juliet@bar.invalid has a token for all test.test scopes.

  info("juliet@bar.invalid: test.test, all scopes");
  mod = new OAuth2Module();
  mod.initFromHostname("test.test", "juliet@bar.invalid", "imap");
  Assert.equal(mod._scope, "test_mail test_addressbook test_calendar");
  Assert.deepEqual([...mod._requiredScopes], ["test_mail"]);
  Assert.equal(mod._loginOrigin, "oauth://test.test");
  Assert.equal(mod._username, "juliet@bar.invalid");
  Assert.equal(mod.getRefreshToken(), "juliet");

  OAuth2TestUtils.forgetObjects();

  // New 3-arg initFromHostname:
  info("juliet@bar.invalid: test.test, mail scope");
  mod = new OAuth2Module();
  mod.initFromHostname("test.test", "juliet@bar.invalid", "imap");
  Assert.equal(mod._scope, "test_mail test_addressbook test_calendar");
  Assert.deepEqual([...mod._requiredScopes], ["test_mail"]);
  Assert.equal(mod._loginOrigin, "oauth://test.test");
  Assert.equal(mod._username, "juliet@bar.invalid");
  Assert.equal(mod.getRefreshToken(), "juliet");

  OAuth2TestUtils.forgetObjects();

  info("juliet@bar.invalid: test.test, address book scope");
  mod = new OAuth2Module();
  mod.initFromHostname("test.test", "juliet@bar.invalid", "carddav");
  Assert.equal(mod._scope, "test_mail test_addressbook test_calendar");
  Assert.deepEqual([...mod._requiredScopes], ["test_addressbook"]);
  Assert.equal(mod._loginOrigin, "oauth://test.test");
  Assert.equal(mod._username, "juliet@bar.invalid");
  Assert.equal(mod.getRefreshToken(), "juliet");

  OAuth2TestUtils.forgetObjects();

  info("juliet@bar.invalid: test.test, calendar scope");
  mod = new OAuth2Module();
  mod.initFromHostname("test.test", "juliet@bar.invalid", "caldav");
  Assert.equal(mod._scope, "test_mail test_addressbook test_calendar");
  Assert.deepEqual([...mod._requiredScopes], ["test_calendar"]);
  Assert.equal(mod._loginOrigin, "oauth://test.test");
  Assert.equal(mod._username, "juliet@bar.invalid");
  Assert.equal(mod.getRefreshToken(), "juliet");

  OAuth2TestUtils.forgetObjects();

  // mike@bar.invalid has a token for all test.test scopes, in a different order.
  // The order should not matter.

  info("mike@bar.invalid: test.test, all scopes");
  mod = new OAuth2Module();
  mod.initFromHostname("test.test", "mike@bar.invalid", "imap");
  Assert.equal(mod._scope, "test_calendar test_addressbook test_mail");
  Assert.deepEqual([...mod._requiredScopes], ["test_mail"]);
  Assert.equal(mod._loginOrigin, "oauth://test.test");
  Assert.equal(mod._username, "mike@bar.invalid");
  Assert.equal(mod.getRefreshToken(), "mike");

  OAuth2TestUtils.forgetObjects();

  // New 3-arg initFromHostname:
  info("mike@bar.invalid: test.test, mail scope");
  mod = new OAuth2Module();
  mod.initFromHostname("test.test", "mike@bar.invalid", "imap");
  Assert.equal(mod._scope, "test_calendar test_addressbook test_mail");
  Assert.deepEqual([...mod._requiredScopes], ["test_mail"]);
  Assert.equal(mod._loginOrigin, "oauth://test.test");
  Assert.equal(mod._username, "mike@bar.invalid");
  Assert.equal(mod.getRefreshToken(), "mike");

  OAuth2TestUtils.forgetObjects();

  info("mike@bar.invalid: test.test, address book scope");
  mod = new OAuth2Module();
  mod.initFromHostname("test.test", "mike@bar.invalid", "carddav");
  Assert.equal(mod._scope, "test_calendar test_addressbook test_mail");
  Assert.deepEqual([...mod._requiredScopes], ["test_addressbook"]);
  Assert.equal(mod._loginOrigin, "oauth://test.test");
  Assert.equal(mod._username, "mike@bar.invalid");
  Assert.equal(mod.getRefreshToken(), "mike");

  OAuth2TestUtils.forgetObjects();

  info("mike@bar.invalid: test.test, calendar scope");
  mod = new OAuth2Module();
  mod.initFromHostname("test.test", "mike@bar.invalid", "caldav");
  Assert.equal(mod._scope, "test_calendar test_addressbook test_mail");
  Assert.deepEqual([...mod._requiredScopes], ["test_calendar"]);
  Assert.equal(mod._loginOrigin, "oauth://test.test");
  Assert.equal(mod._username, "mike@bar.invalid");
  Assert.equal(mod.getRefreshToken(), "mike");

  OAuth2TestUtils.forgetObjects();

  // oscar@bar.invalid has tokens for test.test scopes individually.

  info("oscar@bar.invalid: test.test, mail scope");
  mod = new OAuth2Module();
  mod.initFromHostname("test.test", "oscar@bar.invalid", "imap");
  Assert.equal(mod._scope, "test_mail");
  Assert.deepEqual([...mod._requiredScopes], ["test_mail"]);
  Assert.equal(mod._loginOrigin, "oauth://test.test");
  Assert.equal(mod._username, "oscar@bar.invalid");
  Assert.equal(mod.getRefreshToken(), "oscar-mail");

  OAuth2TestUtils.forgetObjects();

  info("oscar@bar.invalid: test.test, address book scope");
  mod = new OAuth2Module();
  mod.initFromHostname("test.test", "oscar@bar.invalid", "carddav");
  Assert.equal(mod._scope, "test_addressbook");
  Assert.deepEqual([...mod._requiredScopes], ["test_addressbook"]);
  Assert.equal(mod._loginOrigin, "oauth://test.test");
  Assert.equal(mod._username, "oscar@bar.invalid");
  Assert.equal(mod.getRefreshToken(), "oscar-addressbook");

  OAuth2TestUtils.forgetObjects();

  info("oscar@bar.invalid: test.test, calendar scope");
  mod = new OAuth2Module();
  mod.initFromHostname("test.test", "oscar@bar.invalid", "caldav");
  Assert.equal(mod._scope, "test_calendar");
  Assert.deepEqual([...mod._requiredScopes], ["test_calendar"]);
  Assert.equal(mod._loginOrigin, "oauth://test.test");
  Assert.equal(mod._username, "oscar@bar.invalid");
  Assert.equal(mod.getRefreshToken(), "oscar-calendar");

  OAuth2TestUtils.forgetObjects();
  Services.logins.removeAllLogins();
});

/**
 * Tests that `OAuth2` objects are correctly cached and reused. An object can
 * be reused if:
 * - it's for the same endpoint, and
 * - it's for the same username, and
 * - the scopes it was granted, or the scopes it's requesting if it hasn't
 *   connected yet, are a superset of the scopes to be requested.
 */
add_task(async function testOAuth2ObjectsReuse() {
  // Check that two instances use the same object.
  const mod1 = new OAuth2Module();
  mod1.initFromHostname("mochi.test", "user1@foo.invalid", "imap");

  const mod2 = new OAuth2Module();
  mod2.initFromHostname("mochi.test", "user1@foo.invalid", "imap");
  Assert.equal(mod2._oauth, mod1._oauth, "the same object should be used");

  // Add another scope to the object and check that creating another new
  // instance with the same arguments still uses it.
  mod1._oauth.scope = "test_other_scope test_scope";
  const mod3 = new OAuth2Module();
  mod3.initFromHostname("mochi.test", "user1@foo.invalid", "imap");
  Assert.equal(mod3._oauth, mod1._oauth, "the same object should be used");

  // Check that a different set of scopes requires a different object.
  // This isn't really supported in practice as we only save one refresh token
  // per endpoint/username combination, but check anyway.
  const mod4 = new OAuth2Module();
  mod4.initFromHostname("test.test", "user1@foo.invalid", "imap");
  Assert.notEqual(mod4._oauth, mod1._oauth, "the same object must not be used");

  // Check that a different username requires a different object.
  const mod5 = new OAuth2Module();
  mod5.initFromHostname("mochi.test", "user2@foo.invalid", "imap");
  Assert.notEqual(mod5._oauth, mod1._oauth, "the same object must not be used");

  // Check that a different endpoint requires a different object.
  const mod6 = new OAuth2Module();
  mod6.initFromHostname("imap.gmail.com", "user1@foo.invalid", "imap");
  Assert.notEqual(mod6._oauth, mod1._oauth, "the same object must not be used");

  OAuth2TestUtils.forgetObjects();
});

/**
 * Tests that saved tokens get updated when a new token is issued.
 */
add_task(async function testSetRefreshToken() {
  // Create a server that makes a new token every time we use the current token.
  await OAuth2TestUtils.startServer({
    refreshToken: "romeo",
    rotateTokens: true,
  });

  // Store a token to be overwritten.
  await storeLogins([
    ["oauth://test.test", "test_scope", "romeo@foo.invalid", "romeo"],
  ]);
  let logins = await Services.logins.getAllLogins();
  const timeBefore = logins[0].timePasswordChanged;
  await new Promise(resolve => setTimeout(resolve, 50));

  // Connect.
  const mod = new OAuth2Module();
  mod.initFromHostname("mochi.test", "romeo@foo.invalid", "imap");

  const deferred = Promise.withResolvers();
  mod.connect(false, {
    onSuccess: deferred.resolve,
    onFailure: deferred.reject,
  });
  await deferred.promise;

  Assert.equal(
    mod._oauth.refreshToken,
    "romeo_1",
    "refresh token in memory should have been updated"
  );
  Assert.equal(mod._oauth.scope, "test_scope");

  // Check that the saved token was updated.
  logins = await Services.logins.getAllLogins();
  Assert.equal(logins.length, 1, "another login should not have been added");

  Assert.equal(logins[0].hostname, "oauth://test.test");
  Assert.equal(logins[0].httpRealm, "test_scope");
  Assert.equal(logins[0].username, "romeo@foo.invalid");
  Assert.equal(logins[0].password, "romeo_1", "token should have been updated");
  Assert.greater(
    logins[0].timePasswordChanged,
    timeBefore,
    "token last-update time should have been updated"
  );

  Services.logins.removeAllLogins();
  OAuth2TestUtils.forgetObjects();
  OAuth2TestUtils.stopServer();
});

/**
 * Tests that saved scopes and tokens get updated when a new token is issued
 * and the server responds with a different set of scopes.
 */
add_task(async function testSetRefreshTokenWithNewScope() {
  // Create a server that makes a new token every time we use the current token.
  const oAuth2Server = await OAuth2TestUtils.startServer({
    refreshToken: "victor",
    rotateTokens: true,
  });

  // Tell the server to grant us a new scope. We won't be asking for it, but
  // servers are weird.
  oAuth2Server.grantedScope = "test_other_scope test_scope";

  // Store a token to be overwritten.
  await storeLogins([
    ["oauth://test.test", "test_scope", "victor@foo.invalid", "victor"],
  ]);
  let logins = await Services.logins.getAllLogins();
  let timeBefore = logins[0].timePasswordChanged;
  await new Promise(resolve => setTimeout(resolve, 50));

  // Connect.
  const mod = new OAuth2Module();
  mod.initFromHostname("mochi.test", "victor@foo.invalid", "imap");

  let deferred = Promise.withResolvers();
  mod.connect(false, {
    onSuccess: deferred.resolve,
    onFailure: deferred.reject,
  });
  await deferred.promise;

  Assert.equal(
    mod._oauth.refreshToken,
    "victor_1",
    "refresh token in memory should have been updated"
  );
  Assert.equal(
    mod._oauth.scope,
    "test_other_scope test_scope",
    "scope in memory should have been updated"
  );

  // Check that the saved token was updated.
  logins = await Services.logins.getAllLogins();
  Assert.equal(logins.length, 1, "another login should not have been added");

  Assert.equal(logins[0].hostname, "oauth://test.test");
  Assert.equal(
    logins[0].httpRealm,
    "test_other_scope test_scope",
    "scope should have been updated"
  );
  Assert.equal(logins[0].username, "victor@foo.invalid");
  Assert.equal(
    logins[0].password,
    "victor_1",
    "token should have been updated"
  );
  Assert.greater(
    logins[0].timePasswordChanged,
    timeBefore,
    "token last-update time should have been updated"
  );
  timeBefore = logins[0].timePasswordChanged;
  await new Promise(resolve => setTimeout(resolve, 50));

  // Pretend the access token has expired, and connect again.
  mod._oauth.tokenExpires = 0;
  deferred = Promise.withResolvers();
  mod.connect(false, {
    onSuccess: deferred.resolve,
    onFailure: deferred.reject,
  });
  await deferred.promise;

  Assert.ok(!mod._oauth.tokenExpired);
  Assert.equal(
    mod._oauth.refreshToken,
    "victor_2",
    "refresh token in memory should have been updated"
  );
  Assert.equal(mod._oauth.scope, "test_other_scope test_scope");

  // Check that the saved token was updated.
  logins = await Services.logins.getAllLogins();
  Assert.equal(logins.length, 1, "another login should not have been added");

  Assert.equal(logins[0].hostname, "oauth://test.test");
  Assert.equal(logins[0].httpRealm, "test_other_scope test_scope");
  Assert.equal(logins[0].username, "victor@foo.invalid");
  Assert.equal(
    logins[0].password,
    "victor_2",
    "token should have been updated"
  );
  Assert.greater(
    logins[0].timePasswordChanged,
    timeBefore,
    "token last-update time should have been updated"
  );

  Services.logins.removeAllLogins();
  OAuth2TestUtils.forgetObjects();
  OAuth2TestUtils.stopServer();
  delete oAuth2Server.grantedScope;
});

add_task(async function testSetRefreshTokenPreservesOthers() {
  // Create a server that makes a new token every time we use the current token.
  const oAuth2Server = await OAuth2TestUtils.startServer();

  // Tell the server to grant us a new scope. We won't be asking for it, but
  // servers are weird.
  oAuth2Server.grantedScope = "test_mail test_calendar";

  await storeLogins([
    ["https://test.test", "unknown_scope", "oscar@bar.invalid", "WRONG"],
    [
      "oauth://test.test",
      "test_addressbook",
      "oscar@bar.invalid",
      "oscar-addressbook",
    ],
    [
      "oauth://test.test",
      "test_calendar",
      "oscar@bar.invalid",
      "oscar-calendar",
    ],
  ]);

  // Connect. We're asking for a scope we don't have.
  const mod = new OAuth2Module();
  mod.initFromHostname("test.test", "oscar@bar.invalid", "imap");
  Assert.equal(
    mod._oauth.refreshToken,
    "",
    "there should be no refresh token in memory"
  );
  mod._oauth.refreshToken = "refresh_token";

  const deferred = Promise.withResolvers();
  mod.connect(false, {
    onSuccess: deferred.resolve,
    onFailure: deferred.reject,
  });
  await deferred.promise;

  Assert.equal(
    mod._oauth.refreshToken,
    "refresh_token",
    "refresh token in memory should have been updated"
  );
  Assert.equal(
    mod._oauth.scope,
    "test_mail test_calendar",
    "scope in memory should have been updated"
  );

  // Check that the new token was added and tokens it replaces are removed.
  // This assumes that `getAllLogins` returns the logins in the order they
  // were added. If this changes the test will need updating.
  const logins = await Services.logins.getAllLogins();
  Assert.equal(logins.length, 3, "there should be 3 remaining logins");

  // Login with different origin is unchanged.
  Assert.equal(logins[0].hostname, "https://test.test");
  Assert.equal(logins[0].httpRealm, "unknown_scope");
  Assert.equal(logins[0].username, "oscar@bar.invalid");
  Assert.equal(logins[0].password, "WRONG");

  // Token with a scope not granted in this test is unchanged.
  Assert.equal(logins[1].hostname, "oauth://test.test");
  Assert.equal(logins[1].httpRealm, "test_addressbook");
  Assert.equal(logins[1].username, "oscar@bar.invalid");
  Assert.equal(logins[1].password, "oscar-addressbook");

  // Token with the new scopes replaces the individual tokens for those scopes.
  Assert.equal(logins[2].hostname, "oauth://test.test");
  Assert.equal(logins[2].httpRealm, "test_mail test_calendar");
  Assert.equal(logins[2].username, "oscar@bar.invalid");
  Assert.equal(logins[2].password, "refresh_token");

  Services.logins.removeAllLogins();
  OAuth2TestUtils.forgetObjects();
  OAuth2TestUtils.stopServer();
  delete oAuth2Server.grantedScope;
});

async function storeLogins(logins) {
  for (const [origin, scope, username, token] of logins) {
    const loginInfo = Cc[
      "@mozilla.org/login-manager/loginInfo;1"
    ].createInstance(Ci.nsILoginInfo);
    loginInfo.init(origin, null, scope, username, token, "", "");
    await Services.logins.addLoginAsync(loginInfo);
  }
}
