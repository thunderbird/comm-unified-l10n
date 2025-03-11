/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

let gMessages, gDefaultAbout3Pane;

add_setup(async () => {
  const account = createAccount();
  const rootFolder = account.incomingServer.rootFolder;
  const subFolders = rootFolder.subFolders;
  await createMessages(subFolders[0], 10);

  // Modify the messages so the filters can be checked against them.

  gMessages = [...subFolders[0].messages];
  gMessages.at(-1).markRead(true);
  gMessages.at(-3).markRead(true);
  gMessages.at(-5).markRead(true);
  gMessages.at(-7).markRead(true);
  gMessages.at(-9).markRead(true);
  gMessages.at(-2).markFlagged(true);
  gMessages.at(-7).markFlagged(true);
  gMessages.at(-1).setStringProperty("keywords", "$label1");
  gMessages.at(-2).setStringProperty("keywords", "$label2");
  gMessages.at(-4).setStringProperty("keywords", "$label1 $label2");
  gMessages.at(-6).setStringProperty("keywords", "$label2");
  gMessages.at(-7).setStringProperty("keywords", "$label1");
  gMessages.at(-8).setStringProperty("keywords", "$label2 $label3");
  gMessages.at(-9).setStringProperty("keywords", "$label3");
  gMessages.at(0).setStringProperty("keywords", "$label1 $label2 $label3");
  gMessages.at(0).markHasAttachments(true);

  // Add an author to the address book.

  const author = gMessages.at(-8).author.replace(/["<>]/g, "").split(" ");
  const card = Cc["@mozilla.org/addressbook/cardproperty;1"].createInstance(
    Ci.nsIAbCard
  );
  card.setProperty("FirstName", author[0]);
  card.setProperty("LastName", author[1]);
  card.setProperty("DisplayName", `${author[0]} ${author[1]}`);
  card.setProperty("PrimaryEmail", author[2]);
  const ab = MailServices.ab.getDirectory("jsaddrbook://abook.sqlite");
  const addedCard = ab.addCard(card);

  gDefaultAbout3Pane = document.getElementById("tabmail").currentAbout3Pane;
  gDefaultAbout3Pane.displayFolder(subFolders[0]);

  registerCleanupFunction(() => {
    ab.deleteCards([addedCard]);
  });
});

add_task(async () => {
  async function background() {
    browser.mailTabs.setQuickFilter({ unread: true });
    await window.sendMessage("checkVisible", 8, 6, 4, 2, 0);

    browser.mailTabs.setQuickFilter({ flagged: true });
    await window.sendMessage("checkVisible", 8, 3);

    browser.mailTabs.setQuickFilter({ flagged: true, unread: true });
    await window.sendMessage("checkVisible", 8);

    browser.mailTabs.setQuickFilter({ tags: true });
    await window.sendMessage("checkVisible", 9, 8, 6, 4, 3, 2, 1, 0);

    browser.mailTabs.setQuickFilter({
      tags: { mode: "any", tags: { $label1: true } },
    });
    await window.sendMessage("checkVisible", 9, 6, 3, 0);

    browser.mailTabs.setQuickFilter({
      tags: { mode: "any", tags: { $label2: true } },
    });
    await window.sendMessage("checkVisible", 8, 6, 4, 2, 0);

    browser.mailTabs.setQuickFilter({
      tags: { mode: "any", tags: { $label1: true, $label2: true } },
    });
    await window.sendMessage("checkVisible", 9, 8, 6, 4, 3, 2, 0);

    browser.mailTabs.setQuickFilter({
      tags: { mode: "all", tags: { $label1: true, $label2: true } },
    });
    await window.sendMessage("checkVisible", 6, 0);

    browser.mailTabs.setQuickFilter({
      tags: { mode: "all", tags: { $label1: true, $label2: false } },
    });
    await window.sendMessage("checkVisible", 9, 3);

    browser.mailTabs.setQuickFilter({ attachment: true });
    await window.sendMessage("checkVisible", 0);

    browser.mailTabs.setQuickFilter({ attachment: false });
    await window.sendMessage("checkVisible", 9, 8, 7, 6, 5, 4, 3, 2, 1);

    browser.mailTabs.setQuickFilter({ contact: true });
    await window.sendMessage("checkVisible", 2);

    browser.mailTabs.setQuickFilter({ contact: false });
    await window.sendMessage("checkVisible", 9, 8, 7, 6, 5, 4, 3, 1, 0);

    browser.test.notifyPass("quickFilter");
  }

  const extension = ExtensionTestUtils.loadExtension({
    files: {
      "background.js": background,
      "utils.js": await getUtilsJS(),
    },
    manifest: {
      background: { scripts: ["utils.js", "background.js"] },
    },
  });

  extension.onMessage("checkVisible", async (...expected) => {
    await TestUtils.waitForCondition(
      () => gDefaultAbout3Pane.dbViewWrapperListener.allMessagesLoaded,
      "waiting for message list to finish loading"
    );
    const actual = [];
    const dbView = gDefaultAbout3Pane.gDBView;
    for (let i = 0; i < dbView.rowCount; i++) {
      actual.push(gMessages.indexOf(dbView.getMsgHdrAt(i)));
    }

    Assert.deepEqual(actual, expected);
    extension.sendMessage();
  });

  await extension.startup();
  await extension.awaitFinish("quickFilter");
  await extension.unload();

  gDefaultAbout3Pane.quickFilterBar._resetFilterState();
});

add_task(async function test_setQuickFilter_UI() {
  async function background() {
    browser.mailTabs.setQuickFilter({
      show: true,
      text: {
        subject: true,
        text: "test",
      },
    });
    await window.sendMessage("checkState", {
      show: true,
      flagged: undefined,
      text: {
        subject: true,
        text: "test",
      },
    });
    browser.mailTabs.setQuickFilter({
      text: {
        text: "",
      },
    });
    await window.sendMessage("checkState", {
      show: true,
      flagged: undefined,
      text: {
        subject: false,
        text: "",
      },
    });
    browser.mailTabs.setQuickFilter({
      flagged: true,
    });
    await window.sendMessage("checkState", {
      show: true,
      flagged: true,
      text: {
        subject: false,
        text: null,
      },
    });
    browser.mailTabs.setQuickFilter({
      show: false,
    });
    await window.sendMessage("checkState", {
      show: false,
      flagged: undefined,
      text: {
        subject: false,
        text: null,
      },
    });
    browser.test.notifyPass("quickFilter");
  }
  const extension = ExtensionTestUtils.loadExtension({
    files: {
      "background.js": background,
      "utils.js": await getUtilsJS(),
    },
    manifest: {
      background: { scripts: ["utils.js", "background.js"] },
    },
  });

  const qfb = gDefaultAbout3Pane.quickFilterBar;
  extension.onMessage("checkState", async state => {
    Assert.equal(
      qfb.filterer.visible,
      Boolean(state.show),
      "show should be propagated to the filterer"
    );
    if (state.show) {
      Assert.ok(
        BrowserTestUtils.isVisible(qfb.domNode),
        "Quick filter bar should be visible when the filter requests it be shown"
      );
    } else {
      Assert.ok(
        BrowserTestUtils.isHidden(qfb.domNode),
        "Quick filter bar should be hidden"
      );
    }
    if (state.show) {
      Assert.equal(
        qfb.filterer.getFilterValue("text", true).text,
        state.text.text,
        "Should set text filter"
      );
      Assert.equal(
        gDefaultAbout3Pane.document
          .getElementById("qfb-qs-textbox")
          .shadowRoot.querySelector("input").value,
        state.text.text || "",
        "Should update the search bar input"
      );
      Assert.equal(
        qfb.filterer.getFilterValue("text", true).states.subject,
        state.text.subject,
        "Should set the subject filter"
      );
      Assert.equal(
        gDefaultAbout3Pane.document.getElementById("qfb-qs-subject").pressed,
        state.text.subject,
        "Should reflect toggle state in UI"
      );
      Assert.equal(
        qfb.filterer.getFilterValue("starred", true),
        state.flagged,
        "Should update flagged state"
      );
      Assert.equal(
        gDefaultAbout3Pane.document.getElementById("qfb-starred").pressed,
        Boolean(state.flagged),
        "Should reflect flagged state"
      );
    }
    extension.sendMessage();
  });

  await extension.startup();
  await extension.awaitFinish("quickFilter");
  await extension.unload();

  gDefaultAbout3Pane.quickFilterBar._resetFilterState();
});
