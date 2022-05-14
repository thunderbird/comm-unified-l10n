/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

// profile-after-change is not triggered in xpcshell tests, so we manually run
// getService to load nntp-js and pop3-js.
Cc["@mozilla.org/messenger/nntp-module-loader;1"].getService();
Cc["@mozilla.org/messenger/pop3-module-loader;1"].getService();

registerCleanupFunction(() => {
  Services.logins.removeAllLogins();
});

/**
 * Test password is migrated when changing hostname/username.
 */
add_task(function testChangeUsernameHostname() {
  // Add two logins.
  let loginItems = [
    ["news://news.localhost", "user-nntp", "password-nntp"],
    ["mailbox://pop3.localhost", "user-pop", "password-pop"],
  ];
  for (let [uri, username, password] of loginItems) {
    let login = Cc["@mozilla.org/login-manager/loginInfo;1"].createInstance(
      Ci.nsILoginInfo
    );
    login.init(uri, null, uri, username, password, "", "");
    Services.logins.addLogin(login);
  }

  // Create a nntp server, check the password can be found correctly.
  let nntpIncomingServer = MailServices.accounts.createIncomingServer(
    "user-nntp",
    "news.localhost",
    "nntp"
  );
  nntpIncomingServer.getPasswordWithUI("", "", null);
  equal(nntpIncomingServer.password, "password-nntp");

  // Change the username, check password can be found using the new username.
  nntpIncomingServer.username = "nntp";
  let password;
  let serverUri = "news://news.localhost";
  for (let login of Services.logins.findLogins(serverUri, "", serverUri)) {
    if (login.username == "nntp") {
      password = login.password;
    }
  }
  equal(password, "password-nntp");

  // Create a pop3 server, check the password can be found correctly.
  let pop3IncomingServer = MailServices.accounts.createIncomingServer(
    "user-pop",
    "pop3.localhost",
    "pop3"
  );
  pop3IncomingServer.getPasswordWithUI("", "", null);
  equal(pop3IncomingServer.password, "password-pop");

  // Change the hostname, check password can be found using the new hostname.
  pop3IncomingServer.hostName = "localhost";
  serverUri = "mailbox://localhost";
  for (let login of Services.logins.findLogins(serverUri, "", serverUri)) {
    if (login.username == "user-pop") {
      password = login.password;
    }
  }
  equal(password, "password-pop");
});
