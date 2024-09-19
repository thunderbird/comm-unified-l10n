/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

const { CardDAVDirectory } = ChromeUtils.importESModule(
  "resource:///modules/CardDAVDirectory.sys.mjs"
);
const { CardDAVServer } = ChromeUtils.importESModule(
  "resource://testing-common/CardDAVServer.sys.mjs"
);
const { DNS } = ChromeUtils.importESModule("resource:///modules/DNS.sys.mjs");
const { HttpsProxy } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/HttpsProxy.sys.mjs"
);
const { OAuth2TestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/OAuth2TestUtils.sys.mjs"
);

// A list of books returned by CardDAVServer unless changed.
const DEFAULT_BOOKS = [
  {
    label: "Not This One",
    url: "/addressbooks/me/default/",
  },
  {
    label: "CardDAV Test",
    url: "/addressbooks/me/test/",
  },
];

async function wrappedTest(testInitCallback, ...attemptArgs) {
  Services.logins.removeAllLogins();

  CardDAVServer.open("alice", "alice");
  if (testInitCallback) {
    await testInitCallback();
  }

  const abWindow = await openAddressBookWindow();

  const dialogPromise = promiseLoadSubDialog(
    "chrome://messenger/content/addressbook/abCardDAVDialog.xhtml"
  ).then(async function (dialogWindow) {
    for (const args of attemptArgs) {
      if (args.url?.startsWith("/")) {
        args.url = CardDAVServer.origin + args.url;
      }
      await attemptInit(dialogWindow, args);
    }
    dialogWindow.document.querySelector("dialog").getButton("cancel").click();
  });
  abWindow.createBook(Ci.nsIAbManager.CARDDAV_DIRECTORY_TYPE);
  await dialogPromise;
  CardDAVServer.resetHandlers();

  await closeAddressBookWindow();
  await CardDAVServer.close();

  const logins = await Services.logins.getAllLogins();
  Assert.equal(logins.length, 0, "no faulty logins were saved");
}

async function attemptInit(
  dialogWindow,
  {
    username,
    url,
    certError,
    password,
    savePassword,
    oAuth,
    expectedStatus = "carddav-connection-error",
    expectedBooks = [],
  }
) {
  const dialogDocument = dialogWindow.document;
  const acceptButton = dialogDocument
    .querySelector("dialog")
    .getButton("accept");

  const usernameInput = dialogDocument.getElementById("carddav-username");
  const urlInput = dialogDocument.getElementById("carddav-location");
  const statusMessage = dialogDocument.getElementById("carddav-statusMessage");
  const availableBooks = dialogDocument.getElementById(
    "carddav-availableBooks"
  );

  if (username) {
    usernameInput.select();
    EventUtils.sendString(username, dialogWindow);
  }
  if (url) {
    urlInput.select();
    EventUtils.sendString(url, dialogWindow);
  }

  const certPromise =
    certError === undefined ? Promise.resolve() : handleCertError();
  let promptPromise;
  if (oAuth !== undefined) {
    promptPromise = OAuth2TestUtils.promiseOAuthWindow().then(oAuthWindow =>
      SpecialPowers.spawn(
        oAuthWindow.getBrowser(),
        [{ expectedHint: username, username, password }],
        OAuth2TestUtils.submitOAuthLogin
      )
    );
  } else if (password !== undefined) {
    promptPromise = handlePasswordPrompt(username, password, savePassword);
  } else {
    promptPromise = Promise.resolve();
  }

  acceptButton.click();

  Assert.equal(
    statusMessage.getAttribute("data-l10n-id"),
    "carddav-loading",
    "Correct status message"
  );

  await certPromise;
  await promptPromise;
  await BrowserTestUtils.waitForEvent(dialogWindow, "status-changed");

  Assert.equal(
    statusMessage.getAttribute("data-l10n-id"),
    expectedStatus,
    "Correct status message"
  );

  Assert.equal(
    availableBooks.childElementCount,
    expectedBooks.length,
    "Expected number of address books found"
  );
  for (let i = 0; i < expectedBooks.length; i++) {
    Assert.equal(availableBooks.children[i].label, expectedBooks[i].label);
    if (expectedBooks[i].url.startsWith("/")) {
      Assert.equal(
        availableBooks.children[i].value,
        `${CardDAVServer.origin}${expectedBooks[i].url}`
      );
    } else {
      Assert.equal(availableBooks.children[i].value, expectedBooks[i].url);
    }
    Assert.ok(availableBooks.children[i].checked);
  }
}

function handleCertError() {
  return BrowserTestUtils.promiseAlertDialog(
    "cancel",
    "chrome://pippki/content/exceptionDialog.xhtml"
  );
}

function handlePasswordPrompt(expectedUsername, password, savePassword = true) {
  return BrowserTestUtils.promiseAlertDialog(null, undefined, {
    async callback(prompt) {
      await TestUtils.waitForCondition(
        () => Services.focus.activeWindow == prompt,
        "waiting for prompt to become active"
      );

      if (!password) {
        prompt.document.querySelector("dialog").getButton("cancel").click();
        return;
      }

      if (expectedUsername) {
        Assert.equal(
          prompt.document.getElementById("loginTextbox").value,
          expectedUsername
        );
      } else {
        prompt.document.getElementById("loginTextbox").value = "alice";
      }
      prompt.document.getElementById("password1Textbox").value = password;

      const checkbox = prompt.document.getElementById("checkbox");
      Assert.greater(checkbox.getBoundingClientRect().width, 0);
      Assert.ok(checkbox.checked);

      if (!savePassword) {
        EventUtils.synthesizeMouseAtCenter(checkbox, {}, prompt);
        Assert.ok(!checkbox.checked);
      }

      prompt.document.querySelector("dialog").getButton("accept").click();
    },
  });
}

/** Test URLs that don't respond. */
add_task(function testBadURLs() {
  return wrappedTest(
    null,
    { url: "mochi.test:8888" },
    { url: "http://mochi.test:8888" },
    { url: "https://mochi.test:8888" }
  );
});

/** Test a server with a certificate problem. */
add_task(function testBadSSL() {
  return wrappedTest(null, {
    url: "https://expired.example.com/",
    certError: true,
  });
});

/** Test an ordinary HTTP server that doesn't support CardDAV. */
add_task(function testNotACardDAVServer() {
  return wrappedTest(
    () => {
      CardDAVServer.server.registerPathHandler("/", null);
      CardDAVServer.server.registerPathHandler("/.well-known/carddav", null);
    },
    {
      url: "/",
    }
  );
});

/** Test a CardDAV server without the /.well-known/carddav response. */
add_task(function testNoWellKnown() {
  return wrappedTest(
    () =>
      CardDAVServer.server.registerPathHandler("/.well-known/carddav", null),
    {
      url: "/",
      password: "alice",
      expectedStatus: null,
      expectedBooks: DEFAULT_BOOKS,
    }
  );
});

/**
 * Test a CardDAV server which returns a 207 response for /.well-known/carddav,
 * but includes no useful information but a 404 status for the requested current
 * user principal. Test that we continue to query the root, where the correct
 * information is returned.
 */
add_task(function testAppleCardDAVServer() {
  return wrappedTest(
    () => {
      CardDAVServer.server.registerPathHandler(
        "/.well-known/carddav",
        (request, response) => {
          response.setStatusLine("1.1", 207, "Multi-Status");
          response.setHeader("Content-Type", "text/xml");
          response.write(
            `<multistatus xmlns="DAV:">
            <response>
              <href>/.well-known/carddav/</href>
              <propstat>
                <prop>
                  <current-user-principal/>
                </prop>
                <status>HTTP/1.1 404 Not Found</status>
              </propstat>
            </response>
          </multistatus>`.replace(/>\s+</g, "><")
          );
        }
      );
    },
    {
      url: "/",
      password: "alice",
      expectedStatus: null,
      expectedBooks: DEFAULT_BOOKS,
    }
  );
});

/** Test cancelling the password prompt when it appears. */
add_task(function testPasswordCancelled() {
  return wrappedTest(null, {
    url: "/",
    password: null,
  });
});

/** Test entering the wrong password, then retrying with the right one. */
add_task(function testBadPassword() {
  return wrappedTest(
    null,
    {
      url: "/",
      password: "bob",
    },
    {
      url: "/",
      password: "alice",
      expectedStatus: null,
      expectedBooks: DEFAULT_BOOKS,
    }
  );
});

/** Test that entering the full URL of a book links to (only) that book. */
add_task(function testDirectLink() {
  return wrappedTest(null, {
    url: "/addressbooks/me/test/",
    password: "alice",
    expectedStatus: null,
    expectedBooks: [DEFAULT_BOOKS[1]],
  });
});

/** Test that entering only a username finds the right URL. */
add_task(function testEmailGoodPreset() {
  return wrappedTest(
    async () => {
      // The server is open but we need it on a specific port.
      await CardDAVServer.close();
      CardDAVServer.open("alice@test.invalid", "alice", 9999);
    },
    {
      username: "alice@test.invalid",
      password: "alice",
      expectedStatus: null,
      expectedBooks: DEFAULT_BOOKS,
    }
  );
});

/** Test that entering only a bad username fails appropriately. */
add_task(function testEmailBadPreset() {
  return wrappedTest(null, {
    username: "alice@bad.invalid",
    expectedStatus: "carddav-known-incompatible",
  });
});

/** Test that we correctly use DNS discovery. */
add_task(async function testDNSWithoutTXT() {
  // Set up the CardDAV server at carddav.test:443.
  // TLS is required for this test.
  CardDAVServer.open("carol@dnstest.invalid", "carol");
  const proxy = await HttpsProxy.create(
    CardDAVServer.port,
    "dav",
    "carddav.test"
  );

  const _srv = DNS.srv;
  DNS.srv = function (name) {
    Assert.equal(name, "_carddavs._tcp.dnstest.invalid");
    return [{ prio: 0, weight: 0, host: "carddav.test", port: 443 }];
  };

  const abWindow = await openAddressBookWindow();
  const dialogPromise = promiseLoadSubDialog(
    "chrome://messenger/content/addressbook/abCardDAVDialog.xhtml"
  ).then(async function (dialogWindow) {
    await attemptInit(dialogWindow, {
      username: "carol@dnstest.invalid",
      password: "carol",
      expectedStatus: null,
      expectedBooks: [
        {
          label: "Not This One",
          url: "https://carddav.test/addressbooks/me/default/",
        },
        {
          label: "CardDAV Test",
          url: "https://carddav.test/addressbooks/me/test/",
        },
      ],
    });
    dialogWindow.document.querySelector("dialog").getButton("cancel").click();
  });
  abWindow.createBook(Ci.nsIAbManager.CARDDAV_DIRECTORY_TYPE);
  await dialogPromise;
  await closeAddressBookWindow();

  DNS.srv = _srv;
  proxy.destroy();
  CardDAVServer.close();
});

/**
 * Test that we correctly use DNS discovery. This uses the mochitest server
 * (files in the data directory) instead of CardDAVServer, which has an unusual
 * path, so we can be sure the TXT entry worked.
 */
add_task(async function testDNSWithTXT() {
  const _srv = DNS.srv;
  const _txt = DNS.txt;

  DNS.srv = function (name) {
    Assert.equal(name, "_carddavs._tcp.dnstest.invalid");
    return [{ prio: 0, weight: 0, host: "example.org", port: 443 }];
  };
  DNS.txt = function (name) {
    Assert.equal(name, "_carddavs._tcp.dnstest.invalid");
    return [
      {
        strings: [
          "path=/browser/comm/mail/components/addrbook/test/browser/data/dns.sjs",
        ],
      },
    ];
  };

  const abWindow = await openAddressBookWindow();
  const dialogPromise = promiseLoadSubDialog(
    "chrome://messenger/content/addressbook/abCardDAVDialog.xhtml"
  ).then(async function (dialogWindow) {
    await attemptInit(dialogWindow, {
      username: "carol@dnstest.invalid",
      password: "carol",
      expectedStatus: null,
      expectedBooks: [
        {
          label: "You found me!",
          url: "https://example.org/browser/comm/mail/components/addrbook/test/browser/data/addressbook.sjs",
        },
      ],
    });
    dialogWindow.document.querySelector("dialog").getButton("cancel").click();
  });
  abWindow.createBook(Ci.nsIAbManager.CARDDAV_DIRECTORY_TYPE);
  await dialogPromise;
  await closeAddressBookWindow();

  DNS.srv = _srv;
  DNS.txt = _txt;
});

/** Test an address book that uses OAuth2 authentication. */
add_task(async function testOAuth() {
  // Set up the OAuth2 server.
  await OAuth2TestUtils.startServer({
    username: "dave@test.test",
    password: "dave",
  });

  // Set up the CardDAV server at test.test:443. Using test.test causes us to
  // use OAuth2 authentication, because it's registered in OAuth2Providers.
  CardDAVServer.open("dave@test.test", "access_token");
  const proxy = await HttpsProxy.create(
    CardDAVServer.port,
    "valid",
    "test.test"
  );

  const abWindow = await openAddressBookWindow();
  const dialogPromise = promiseLoadSubDialog(
    "chrome://messenger/content/addressbook/abCardDAVDialog.xhtml"
  ).then(async function (dialogWindow) {
    await attemptInit(dialogWindow, {
      url: "https://test.test/",
      username: "dave@test.test",
      password: "dave",
      oAuth: true,
      expectedStatus: null,
      expectedBooks: [
        {
          label: "Not This One",
          url: "https://test.test/addressbooks/me/default/",
        },
        {
          label: "CardDAV Test",
          url: "https://test.test/addressbooks/me/test/",
        },
      ],
    });
    const availableBooks = dialogWindow.document.getElementById(
      "carddav-availableBooks"
    );
    availableBooks.children[0].checked = false;
    dialogWindow.document.querySelector("dialog").getButton("accept").click();
  });
  const syncPromise = TestUtils.topicObserved("addrbook-directory-synced");
  abWindow.createBook(Ci.nsIAbManager.CARDDAV_DIRECTORY_TYPE);
  await dialogPromise;
  await closeAddressBookWindow();

  const [directory] = await syncPromise;
  const davDirectory = CardDAVDirectory.forFile(directory.fileName);

  Assert.equal(
    Services.prefs.getStringPref(`${directory.dirPrefId}.carddav.url`, ""),
    "https://test.test/addressbooks/me/test/"
  );
  Assert.equal(
    Services.prefs.getStringPref(`${directory.dirPrefId}.carddav.token`, ""),
    "http://mochi.test/sync/0"
  );
  Assert.equal(
    Services.prefs.getStringPref(`${directory.dirPrefId}.carddav.username`, ""),
    "dave@test.test"
  );
  Assert.notEqual(davDirectory._syncTimer, null, "sync scheduled");

  const logins = Services.logins.findLogins("oauth://test.test", null, "");
  Assert.equal(logins.length, 1, "login was saved");
  Assert.equal(logins[0].httpRealm, "test_scope");
  Assert.equal(logins[0].username, "dave@test.test");
  Assert.equal(logins[0].password, "refresh_token");

  proxy.destroy();
  CardDAVServer.close();
  OAuth2TestUtils.stopServer();

  await promiseDirectoryRemoved(directory.URI);
  Services.logins.removeAllLogins();
});

/**
 * Test doing everything correctly, including creating the directory and
 * doing the initial sync.
 */
add_task(async function testEveryThingOK() {
  CardDAVServer.open("alice", "alice");

  const abWindow = await openAddressBookWindow();

  Assert.equal(abWindow.booksList.rowCount, 3);

  const dialogPromise = promiseLoadSubDialog(
    "chrome://messenger/content/addressbook/abCardDAVDialog.xhtml"
  ).then(async function (dialogWindow) {
    await attemptInit(dialogWindow, {
      url: CardDAVServer.origin,
      password: "alice",
      expectedStatus: null,
      expectedBooks: DEFAULT_BOOKS,
    });

    const availableBooks = dialogWindow.document.getElementById(
      "carddav-availableBooks"
    );
    availableBooks.children[0].checked = false;

    dialogWindow.document.querySelector("dialog").getButton("accept").click();
  });
  const syncPromise = new Promise(resolve => {
    const observer = {
      observe(directory) {
        Services.obs.removeObserver(this, "addrbook-directory-synced");
        resolve(directory);
      },
    };
    Services.obs.addObserver(observer, "addrbook-directory-synced");
  });

  abWindow.createBook(Ci.nsIAbManager.CARDDAV_DIRECTORY_TYPE);

  await dialogPromise;
  const directory = await syncPromise;
  const davDirectory = CardDAVDirectory.forFile(directory.fileName);

  Assert.equal(
    Services.prefs.getStringPref(`${directory.dirPrefId}.carddav.url`, ""),
    CardDAVServer.url
  );
  Assert.equal(
    Services.prefs.getStringPref(`${directory.dirPrefId}.carddav.token`, ""),
    "http://mochi.test/sync/0"
  );
  Assert.equal(
    Services.prefs.getStringPref(`${directory.dirPrefId}.carddav.username`, ""),
    "alice"
  );
  Assert.notEqual(davDirectory._syncTimer, null, "sync scheduled");

  const logins = Services.logins.findLogins(CardDAVServer.origin, null, "");
  Assert.equal(logins.length, 1, "login was saved");
  Assert.equal(logins[0].username, "alice");
  Assert.equal(logins[0].password, "alice");

  Assert.equal(abWindow.booksList.rowCount, 4);
  Assert.equal(
    abWindow.booksList.getRowAtIndex(2).querySelector(".bookRow-name")
      .textContent,
    "CardDAV Test"
  );
  Assert.equal(abWindow.booksList.selectedIndex, 2, "new book got selected");

  await closeAddressBookWindow();

  // Don't close the server or delete the directory, they're needed below.
});

/**
 * Tests adding a second directory on the same server. The auth prompt should
 * show again, even though we've saved the credentials in the previous test.
 */
add_task(async function testEveryThingOKAgain() {
  // Ensure at least a second has passed since the previous test, since we use
  // context identifiers based on the current time in seconds.
  // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
  await new Promise(r => setTimeout(r, 1000));

  const abWindow = await openAddressBookWindow();

  Assert.equal(abWindow.booksList.rowCount, 4);

  const dialogPromise = promiseLoadSubDialog(
    "chrome://messenger/content/addressbook/abCardDAVDialog.xhtml"
  ).then(async function (dialogWindow) {
    await attemptInit(dialogWindow, {
      url: CardDAVServer.origin,
      password: "alice",
      expectedStatus: null,
      expectedBooks: [DEFAULT_BOOKS[0]],
    });

    dialogWindow.document.querySelector("dialog").getButton("accept").click();
  });
  const syncPromise = TestUtils.topicObserved("addrbook-directory-synced");

  abWindow.createBook(Ci.nsIAbManager.CARDDAV_DIRECTORY_TYPE);

  await dialogPromise;
  const [directory] = await syncPromise;
  const davDirectory = CardDAVDirectory.forFile(directory.fileName);

  Assert.equal(
    Services.prefs.getStringPref(`${directory.dirPrefId}.carddav.url`, ""),
    CardDAVServer.altURL
  );
  Assert.equal(
    Services.prefs.getStringPref(`${directory.dirPrefId}.carddav.token`, ""),
    "http://mochi.test/sync/0"
  );
  Assert.equal(
    Services.prefs.getStringPref(`${directory.dirPrefId}.carddav.username`, ""),
    "alice"
  );
  Assert.notEqual(davDirectory._syncTimer, null, "sync scheduled");

  const logins = Services.logins.findLogins(CardDAVServer.origin, null, "");
  Assert.equal(logins.length, 1, "login was saved");
  Assert.equal(logins[0].username, "alice");
  Assert.equal(logins[0].password, "alice");

  Assert.equal(abWindow.booksList.rowCount, 5);
  Assert.equal(
    abWindow.booksList.getRowAtIndex(2).querySelector(".bookRow-name")
      .textContent,
    "CardDAV Test"
  );
  Assert.equal(
    abWindow.booksList.getRowAtIndex(3).querySelector(".bookRow-name")
      .textContent,
    "Not This One"
  );
  Assert.equal(abWindow.booksList.selectedIndex, 3, "new book got selected");

  await closeAddressBookWindow();
  await CardDAVServer.close();

  const otherDirectory = MailServices.ab.getDirectoryFromId(
    "ldap_2.servers.CardDAVTest"
  );
  await promiseDirectoryRemoved(directory.URI);
  await promiseDirectoryRemoved(otherDirectory.URI);

  Services.logins.removeAllLogins();
});

/**
 * Test setting up a directory but not saving the password. The username
 * should be saved and no further password prompt should appear. We can't test
 * restarting Thunderbird but if we could the password prompt would appear
 * next time the directory makes a request.
 */
add_task(async function testNoSavePassword() {
  CardDAVServer.open("alice", "alice");

  const abWindow = await openAddressBookWindow();

  Assert.equal(abWindow.booksList.rowCount, 3);

  const dialogPromise = promiseLoadSubDialog(
    "chrome://messenger/content/addressbook/abCardDAVDialog.xhtml"
  ).then(async function (dialogWindow) {
    await attemptInit(dialogWindow, {
      url: CardDAVServer.origin,
      password: "alice",
      savePassword: false,
      expectedStatus: null,
      expectedBooks: DEFAULT_BOOKS,
    });

    const availableBooks = dialogWindow.document.getElementById(
      "carddav-availableBooks"
    );
    availableBooks.children[0].checked = false;

    dialogWindow.document.querySelector("dialog").getButton("accept").click();
  });
  const syncPromise = TestUtils.topicObserved("addrbook-directory-synced");

  abWindow.createBook(Ci.nsIAbManager.CARDDAV_DIRECTORY_TYPE);
  await dialogPromise;
  const [directory] = await syncPromise;
  const davDirectory = CardDAVDirectory.forFile(directory.fileName);

  Assert.equal(
    Services.prefs.getStringPref(`${directory.dirPrefId}.carddav.url`, ""),
    CardDAVServer.url
  );
  Assert.equal(
    Services.prefs.getStringPref(`${directory.dirPrefId}.carddav.token`, ""),
    "http://mochi.test/sync/0"
  );
  Assert.equal(
    Services.prefs.getStringPref(`${directory.dirPrefId}.carddav.username`, ""),
    "alice"
  );
  Assert.notEqual(davDirectory._syncTimer, null, "sync scheduled");

  const logins = Services.logins.findLogins(CardDAVServer.origin, null, "");
  Assert.equal(logins.length, 0, "login was NOT saved");

  Assert.equal(abWindow.booksList.rowCount, 4);
  Assert.equal(
    abWindow.booksList.getRowAtIndex(2).querySelector(".bookRow-name")
      .textContent,
    "CardDAV Test"
  );
  Assert.equal(abWindow.booksList.selectedIndex, 2, "new book got selected");

  await closeAddressBookWindow();

  // Disable sync as we're going to start the address book manager again.
  directory.setIntValue("carddav.syncinterval", 0);

  // Don't close the server or delete the directory, they're needed below.
});

/**
 * Tests saving a previously unsaved password. This uses the directory from
 * the previous test and simulates a restart of the address book manager.
 */
add_task(async function testSavePasswordLater() {
  const reloadPromise = TestUtils.topicObserved("addrbook-reloaded");
  Services.obs.notifyObservers(null, "addrbook-reload");
  await reloadPromise;

  Assert.equal(MailServices.ab.directories.length, 3);
  const directory = MailServices.ab.getDirectoryFromId(
    "ldap_2.servers.CardDAVTest"
  );
  const davDirectory = CardDAVDirectory.forFile(directory.fileName);

  const promptPromise = handlePasswordPrompt("alice", "alice");
  const syncPromise = TestUtils.topicObserved("addrbook-directory-synced");
  davDirectory.fetchAllFromServer();
  await promptPromise;
  await syncPromise;

  Assert.equal(
    Services.prefs.getStringPref(`${directory.dirPrefId}.carddav.username`, ""),
    "alice",
    "username was saved"
  );

  const logins = Services.logins.findLogins(CardDAVServer.origin, null, "");
  Assert.equal(logins.length, 1, "login was saved");
  Assert.equal(logins[0].username, "alice");
  Assert.equal(logins[0].password, "alice");

  await CardDAVServer.close();

  await promiseDirectoryRemoved(directory.URI);

  Services.logins.removeAllLogins();
});

/**
 * Tests that an address book can still be created if the server returns no
 * name. The hostname of the server is used instead.
 */
add_task(async function testNoName() {
  CardDAVServer._books = CardDAVServer.books;
  CardDAVServer.books = { "/addressbooks/me/noname/": undefined };
  CardDAVServer.open("alice", "alice");

  const abWindow = await openAddressBookWindow();

  Assert.equal(abWindow.booksList.rowCount, 3);

  const dialogPromise = promiseLoadSubDialog(
    "chrome://messenger/content/addressbook/abCardDAVDialog.xhtml"
  ).then(async function (dialogWindow) {
    await attemptInit(dialogWindow, {
      url: CardDAVServer.origin,
      password: "alice",
      expectedStatus: null,
      expectedBooks: [{ label: "noname", url: "/addressbooks/me/noname/" }],
    });

    dialogWindow.document.querySelector("dialog").getButton("accept").click();
  });
  const syncPromise = new Promise(resolve => {
    const observer = {
      observe(directory) {
        Services.obs.removeObserver(this, "addrbook-directory-synced");
        resolve(directory);
      },
    };
    Services.obs.addObserver(observer, "addrbook-directory-synced");
  });

  abWindow.createBook(Ci.nsIAbManager.CARDDAV_DIRECTORY_TYPE);

  await dialogPromise;
  const directory = await syncPromise;
  const davDirectory = CardDAVDirectory.forFile(directory.fileName);

  Assert.equal(
    Services.prefs.getStringPref(`${directory.dirPrefId}.carddav.url`, ""),
    `${CardDAVServer.origin}/addressbooks/me/noname/`
  );
  Assert.equal(
    Services.prefs.getStringPref(`${directory.dirPrefId}.carddav.token`, ""),
    "http://mochi.test/sync/0"
  );
  Assert.equal(
    Services.prefs.getStringPref(`${directory.dirPrefId}.carddav.username`, ""),
    "alice"
  );
  Assert.notEqual(davDirectory._syncTimer, null, "sync scheduled");

  const logins = Services.logins.findLogins(CardDAVServer.origin, null, "");
  Assert.equal(logins.length, 1, "login was saved");
  Assert.equal(logins[0].username, "alice");
  Assert.equal(logins[0].password, "alice");

  Assert.equal(abWindow.booksList.rowCount, 4);
  Assert.equal(
    abWindow.booksList.getRowAtIndex(2).querySelector(".bookRow-name")
      .textContent,
    "noname"
  );

  await closeAddressBookWindow();
  await CardDAVServer.close();
  CardDAVServer.books = CardDAVServer._books;

  await promiseDirectoryRemoved(directory.URI);

  Services.logins.removeAllLogins();
});
