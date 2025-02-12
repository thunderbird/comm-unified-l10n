/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var { click_account_tree_row, get_account_tree_row, open_advanced_settings } =
  ChromeUtils.importESModule(
    "resource://testing-common/mail/AccountManagerHelpers.sys.mjs"
  );
var { promise_modal_dialog } = ChromeUtils.importESModule(
  "resource://testing-common/mail/WindowHelpers.sys.mjs"
);

var defaultIdentity;

add_setup(function () {
  defaultIdentity = MailServices.accounts.defaultAccount.defaultIdentity;
});

/**
 * Check that the archive options button is enabled or disabled appropriately.
 *
 * @param {object} tab - The account manager tab.
 * @param {number} accountKey - Key of the account the check.
 * @param {boolean} isEnabled - True if the button should be enabled, false otherwise.
 */
async function subtest_check_archive_options_enabled(
  tab,
  accountKey,
  isEnabled
) {
  const accountRow = get_account_tree_row(accountKey, "am-copies.xhtml", tab);
  await click_account_tree_row(tab, accountRow);

  const iframe =
    tab.browser.contentWindow.document.getElementById("contentFrame");
  const button = iframe.contentDocument.getElementById(
    "archiveHierarchyButton"
  );

  Assert.equal(button.disabled, !isEnabled);
}

add_task(async function test_archive_options_enabled() {
  const defaultAccount = MailServices.accounts.defaultAccount;
  // First, create an IMAP server
  const imapServer = MailServices.accounts
    .createIncomingServer("nobody", "example.com", "imap")
    .QueryInterface(Ci.nsIImapIncomingServer);

  const identity = MailServices.accounts.createIdentity();
  identity.email = "tinderbox@example.com";

  const account = MailServices.accounts.createAccount();
  account.incomingServer = imapServer;
  account.addIdentity(identity);

  // Then test that the archive options button is enabled/disabled appropriately

  // Let the default identity archive to our IMAP folder, to ensure that the
  // archive folder's server is used to determine the enabled/disabled state
  // of the "archive options" button, *not* the incoming server for that
  // identity.
  defaultIdentity.archiveFolder = imapServer.rootFolder.URI;

  imapServer.isGMailServer = false;
  await open_advanced_settings(async function (tab) {
    await subtest_check_archive_options_enabled(tab, account.key, true);
  });
  await open_advanced_settings(async function (tab) {
    await subtest_check_archive_options_enabled(tab, defaultAccount.key, true);
  });

  imapServer.isGMailServer = true;
  await open_advanced_settings(async function (tab) {
    await subtest_check_archive_options_enabled(tab, account.key, false);
  });
  await open_advanced_settings(async function (tab) {
    await subtest_check_archive_options_enabled(tab, defaultAccount.key, false);
  });

  MailServices.accounts.removeAccount(account);
});

async function subtest_initial_state(tab, identity) {
  const iframe =
    tab.browser.contentWindow.document.getElementById("contentFrame");
  const button = iframe.contentDocument.getElementById(
    "archiveHierarchyButton"
  );

  const dialogPromise = BrowserTestUtils.promiseAlertDialogOpen(
    undefined,
    "chrome://messenger/content/am-archiveoptions.xhtml",
    {
      isSubDialog: true,
      async callback(ac) {
        if (ac.document.readyState != "complete") {
          await BrowserTestUtils.waitForEvent(ac, "load");
        }

        Assert.equal(
          ac.document.getElementById("archiveGranularity").selectedIndex,
          identity.archiveGranularity
        );
        Assert.equal(
          ac.document.getElementById("archiveKeepFolderStructure").checked,
          identity.archiveKeepFolderStructure
        );
        Assert.equal(
          ac.document.getElementById("archiveRecreateInbox").checked,
          identity.archiveRecreateInbox
        );
        ac.close();
      },
    }
  );
  EventUtils.synthesizeMouseAtCenter(button, {}, button.ownerGlobal);
  await dialogPromise;
}

add_task(async function test_open_archive_options() {
  const defaultAccount = MailServices.accounts.defaultAccount;
  await open_advanced_settings(async function (tab) {
    const accountRow = get_account_tree_row(
      defaultAccount.key,
      "am-copies.xhtml",
      tab
    );
    await click_account_tree_row(tab, accountRow);

    for (let granularity = 0; granularity < 3; granularity++) {
      defaultIdentity.archiveGranularity = granularity;
      for (let kfs = 0; kfs < 2; kfs++) {
        defaultIdentity.archiveKeepFolderStructure = kfs;
        for (let ri = 0; ri < 2; ri++) {
          defaultIdentity.archiveRecreateInbox = ri;
          await subtest_initial_state(tab, defaultIdentity);
        }
      }
    }
  });
});

async function subtest_save_state(tab, identity, granularity, kfs, ri) {
  const iframe =
    tab.browser.contentWindow.document.getElementById("contentFrame");
  const button = iframe.contentDocument.getElementById(
    "archiveHierarchyButton"
  );

  const dialogPromise = BrowserTestUtils.promiseAlertDialogOpen(
    undefined,
    "chrome://messenger/content/am-archiveoptions.xhtml",
    {
      isSubDialog: true,
      async callback(ac) {
        if (ac.document.readyState != "complete") {
          await BrowserTestUtils.waitForEvent(ac, "load");
        }

        ac.document.getElementById("archiveGranularity").selectedIndex =
          granularity;
        ac.document.getElementById("archiveKeepFolderStructure").checked = kfs;
        ac.document.getElementById("archiveRecreateInbox").checked = ri;
        EventUtils.synthesizeKey("VK_RETURN", {}, ac);
        ac.document.querySelector("dialog").acceptDialog();
      },
    }
  );
  EventUtils.synthesizeMouseAtCenter(button, {}, button.ownerGlobal);
  await dialogPromise;
}

add_task(async function test_save_archive_options() {
  defaultIdentity.archiveGranularity = 0;
  defaultIdentity.archiveKeepFolderStructure = false;
  defaultIdentity.archiveRecreateInbox = false;

  const defaultAccount = MailServices.accounts.defaultAccount;
  await open_advanced_settings(async function (tab) {
    const accountRow = get_account_tree_row(
      defaultAccount.key,
      "am-copies.xhtml",
      tab
    );
    await click_account_tree_row(tab, accountRow);

    await subtest_save_state(tab, defaultIdentity, 1, true, true);
  });

  Assert.equal(defaultIdentity.archiveGranularity, 1);
  Assert.equal(defaultIdentity.archiveKeepFolderStructure, true);
  Assert.equal(defaultIdentity.archiveRecreateInbox, true);
});

async function subtest_check_archive_enabled(tab, archiveEnabled) {
  defaultIdentity.archiveEnabled = archiveEnabled;

  await click_account_tree_row(tab, 2);

  const iframe =
    tab.browser.contentWindow.document.getElementById("contentFrame");
  const checkbox = iframe.contentDocument.getElementById(
    "identity.archiveEnabled"
  );

  Assert.equal(checkbox.checked, archiveEnabled);
}

add_task(async function test_archive_enabled() {
  await open_advanced_settings(async function (amc) {
    await subtest_check_archive_enabled(amc, true);
  });

  await open_advanced_settings(async function (amc) {
    await subtest_check_archive_enabled(amc, false);
  });
});

async function subtest_disable_archive(tab) {
  defaultIdentity.archiveEnabled = true;
  await click_account_tree_row(tab, 2);

  const iframe =
    tab.browser.contentWindow.document.getElementById("contentFrame");
  const checkbox = iframe.contentDocument.getElementById(
    "identity.archiveEnabled"
  );

  Assert.ok(checkbox.checked);
  Assert.ok(!checkbox.disabled);
  EventUtils.synthesizeMouseAtCenter(
    checkbox,
    { clickCount: 1 },
    checkbox.ownerGlobal
  );
  await TestUtils.waitForCondition(
    () => !checkbox.checked,
    "waiting for archive checkbox to be unchecked"
  );

  Assert.ok(!defaultIdentity.archiveEnabled);
}

add_task(async function test_disable_archive() {
  await open_advanced_settings(subtest_disable_archive);
});
