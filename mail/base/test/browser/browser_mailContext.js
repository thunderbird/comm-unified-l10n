/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

requestLongerTimeout(
  AppConstants.MOZ_CODE_COVERAGE || AppConstants.DEBUG ? 4 : 3
);

/**
 * Tests that items on the mail context menu are correctly shown in context.
 */

var { ConversationOpener } = ChromeUtils.importESModule(
  "resource:///modules/ConversationOpener.sys.mjs"
);
var { Gloda } = ChromeUtils.importESModule(
  "resource:///modules/gloda/Gloda.sys.mjs"
);
var { GlodaIndexer } = ChromeUtils.importESModule(
  "resource:///modules/gloda/GlodaIndexer.sys.mjs"
);
var { GlodaSyntheticView } = ChromeUtils.importESModule(
  "resource:///modules/gloda/GlodaSyntheticView.sys.mjs"
);
var { MailConsts } = ChromeUtils.importESModule(
  "resource:///modules/MailConsts.sys.mjs"
);
var { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);
var { MailUtils } = ChromeUtils.importESModule(
  "resource:///modules/MailUtils.sys.mjs"
);
var { MessageGenerator } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/MessageGenerator.sys.mjs"
);
var { cal } = ChromeUtils.importESModule(
  "resource:///modules/calendar/calUtils.sys.mjs"
);

const tabmail = document.getElementById("tabmail");
let testFolder, testMessages;
let draftsFolder, draftsMessages;
let templatesFolder, templatesMessages;
let listFolder, listMessages;

const singleSelectionMessagePane = [
  "singleMessage",
  "draftsFolder",
  "templatesFolder",
  "listFolder",
  "syntheticFolderDraft",
  "syntheticFolder",
];
const singleSelectionThreadPane = [
  "singleMessageTree",
  "draftsFolderTree",
  "templatesFolderTree",
  "listFolderTree",
  "syntheticFolderDraftTree",
  "syntheticFolderTree",
];
const onePane = ["messageTab", "messageWindow"];
const external = ["externalMessageTab", "externalMessageWindow"];
const allSingleSelection = [
  ...singleSelectionMessagePane,
  ...singleSelectionThreadPane,
  ...onePane,
  ...external,
];
const allThreePane = [
  ...singleSelectionMessagePane,
  ...singleSelectionThreadPane,
  "multipleMessagesTree",
  "collapsedThreadTree",
  "multipleDraftsFolderTree",
  "multipleTemplatesFolderTree",
];
const noCollapsedThreads = [
  ...singleSelectionMessagePane,
  ...singleSelectionThreadPane,
  "multipleMessagesTree",
  "multipleDraftsFolderTree",
  "multipleTemplatesFolderTree",
  ...onePane,
  ...external,
];
const notExternal = [...allThreePane, ...onePane];
const singleNotExternal = [
  ...singleSelectionMessagePane,
  ...singleSelectionThreadPane,
  ...onePane,
];
const notSynthetic = [
  "singleMessage",
  "draftsFolder",
  "templatesFolder",
  "listFolder",
  "singleMessageTree",
  "draftsFolderTree",
  "templatesFolderTree",
  "listFolderTree",
  "multipleMessagesTree",
  "collapsedThreadTree",
  "multipleDraftsFolderTree",
  "multipleTemplatesFolderTree",
];

const mailContextData = {
  "mailContext-openInBrowser": [],
  "mailContext-openLinkInBrowser": [],
  "mailContext-copylink": [],
  "mailContext-savelink": [],
  "mailContext-reportPhishingURL": [],
  "mailContext-addemail": [],
  "mailContext-composeemailto": [],
  "mailContext-copyemail": [],
  "mailContext-copyimage": [],
  "mailContext-saveimage": [],
  "mailContext-copy": [],
  "mailContext-selectall": [
    ...singleSelectionMessagePane,
    ...onePane,
    ...external,
  ],
  "mailContext-searchTheWeb": [],
  "mailContext-editDraftMsg": [
    "draftsFolder",
    "draftsFolderTree",
    "multipleDraftsFolderTree",
    "syntheticFolderDraft",
    "syntheticFolderDraftTree",
  ],
  "mailContext-newMsgFromTemplate": [
    "templatesFolder",
    "templatesFolderTree",
    "multipleTemplatesFolderTree",
  ],
  "mailContext-editTemplateMsg": [
    "templatesFolder",
    "templatesFolderTree",
    "multipleTemplatesFolderTree",
  ],
  "mailContext-open": [...singleNotExternal, "collapsedThreadTree"],
  "mailContext-openNewTab": singleSelectionThreadPane,
  "mailContext-openNewWindow": singleSelectionThreadPane,
  "mailContext-openConversation": [
    ...singleSelectionMessagePane,
    ...singleSelectionThreadPane,
    ...onePane,
    "collapsedThreadTree",
  ],
  "mailContext-openContainingFolder": [
    "syntheticFolderDraft",
    "syntheticFolderDraftTree",
    "syntheticFolder",
    "syntheticFolderTree",
    ...onePane,
  ],
  "mailContext-reply": noCollapsedThreads,
  "mailContext-replyNewsgroup": [],
  "mailContext-replySender": noCollapsedThreads,
  "mailContext-replyAll": noCollapsedThreads,
  "mailContext-replyList": ["listFolder", "listFolderTree"],
  "mailContext-forwardRedirect": noCollapsedThreads,
  "mailContext-forward": allSingleSelection,
  "mailContext-forwardAsInline": allSingleSelection,
  "mailContext-forwardAsAttachment": noCollapsedThreads,
  "mailContext-redirect": noCollapsedThreads,
  "mailContext-cancel": [],
  "mailContext-editAsNew": noCollapsedThreads,
  "mailContext-moveToFolderAgain": [],
  "mailContext-moveMenu": notExternal,
  "mailContext-copyMenu": true,
  "mailContext-tags": notExternal,
  "mailContext-addNewTag": notExternal,
  "mailContext-manageTags": notExternal,
  "mailContext-tagRemoveAll": notExternal,
  "mailContext-mark": notExternal,
  "mailContext-markRead": notExternal,
  "mailContext-markUnread": notExternal,
  "mailContext-markThreadAsRead": notExternal,
  "mailContext-markReadByDate": notExternal,
  "mailContext-markAllRead": notExternal,
  "mailContext-markFlagged": notExternal,
  "mailContext-markAsJunk": notExternal,
  "mailContext-markAsNotJunk": notExternal,
  "mailContext-recalculateJunkScore": notExternal,
  "mailContext-organize": notExternal,
  "mailContext-copyMessageUrl": [],
  "mailContext-archive": notExternal,
  "mailContext-decryptToFolder": [
    "multipleMessagesTree",
    "collapsedThreadTree",
    "multipleDraftsFolderTree",
    "multipleTemplatesFolderTree",
  ],
  "mailContext-calendar-convert-menu": singleNotExternal,
  "mailContext-threads": [...notSynthetic, ...onePane],
  "mailContext-ignoreThread": notSynthetic,
  "mailContext-ignoreSubthread": notSynthetic,
  "mailContext-watchThread": [...notSynthetic, ...onePane],
  "mailContext-saveAs": true,
  "mailContext-print": true,
  "mailContext-downloadSelected": [
    "multipleMessagesTree",
    "collapsedThreadTree",
    "multipleDraftsFolderTree",
    "multipleTemplatesFolderTree",
  ],
};

async function checkMenuitems(menu, mode) {
  if (!mode) {
    // Menu should not be shown.
    Assert.equal(menu.state, "closed");
    return;
  }

  info(`Checking menus for ${mode} ...`);

  await BrowserTestUtils.waitForPopupEvent(menu, "shown");

  const expectedItems = [];
  for (const [id, modes] of Object.entries(mailContextData)) {
    if (modes === true || modes.includes(mode)) {
      expectedItems.push(id);
    }
  }

  const actualItems = [];
  for (const item of menu.children) {
    if (["menu", "menuitem"].includes(item.localName) && !item.hidden) {
      actualItems.push(item.id);

      if (item.localName == "menu" && !item.disabled) {
        item.openMenu(true);
        await BrowserTestUtils.waitForPopupEvent(item.menupopup, "shown");
        for (const subItem of item.menupopup.children) {
          if (
            ["menu", "menuitem"].includes(subItem.localName) &&
            subItem.id &&
            !subItem.hidden
          ) {
            actualItems.push(subItem.id);
          }
        }
        item.menupopup.hidePopup();
        await BrowserTestUtils.waitForPopupEvent(item.menupopup, "hidden");
      }
    }
  }

  const notFoundItems = expectedItems.filter(i => !actualItems.includes(i));
  if (notFoundItems.length) {
    Assert.report(
      true,
      undefined,
      undefined,
      "items expected but not found: " + notFoundItems.join(", ")
    );
  }

  const unexpectedItems = actualItems.filter(i => !expectedItems.includes(i));
  if (unexpectedItems.length) {
    Assert.report(
      true,
      undefined,
      undefined,
      "items found but not expected: " + unexpectedItems.join(", ")
    );
  }

  Assert.deepEqual(actualItems, expectedItems, `Mode: ${mode}`);

  menu.hidePopup();
  await BrowserTestUtils.waitForPopupEvent(menu, "hidden");
}

add_setup(async function () {
  Services.prefs.clearUserPref("mail.last_msg_movecopy_target_uri");
  const generator = new MessageGenerator();

  const account = MailServices.accounts.createLocalMailAccount();
  account.addIdentity(MailServices.accounts.createIdentity());
  const rootFolder = account.incomingServer.rootFolder.QueryInterface(
    Ci.nsIMsgLocalMailFolder
  );
  testFolder = rootFolder
    .createLocalSubfolder("mailContextFolder")
    .QueryInterface(Ci.nsIMsgLocalMailFolder);
  const messages = [
    ...generator.makeMessages({ count: 5 }),
    ...generator.makeMessages({ count: 5, msgsPerThread: 5 }),
    ...generator.makeMessages({ count: 60 }),
  ];
  const messageStrings = messages.map(message => message.toMessageString());
  testFolder.addMessageBatch(messageStrings);
  testMessages = [...testFolder.messages];
  draftsFolder = rootFolder
    .createLocalSubfolder("mailContextDrafts")
    .QueryInterface(Ci.nsIMsgLocalMailFolder);
  draftsFolder.setFlag(Ci.nsMsgFolderFlags.Drafts);
  draftsFolder.addMessageBatch(
    generator
      .makeMessages({ count: 5 })
      .map(message => message.toMessageString())
  );
  draftsMessages = [...draftsFolder.messages];
  templatesFolder = rootFolder
    .createLocalSubfolder("mailContextTemplates")
    .QueryInterface(Ci.nsIMsgLocalMailFolder);
  templatesFolder.setFlag(Ci.nsMsgFolderFlags.Templates);
  templatesFolder.addMessageBatch(
    generator
      .makeMessages({ count: 5 })
      .map(message => message.toMessageString())
  );
  templatesMessages = [...templatesFolder.messages];
  listFolder = rootFolder
    .createLocalSubfolder("mailContextMailingList")
    .QueryInterface(Ci.nsIMsgLocalMailFolder);
  listFolder.addMessage(
    generator
      .makeMessage({
        clobberHeaders: {
          "List-Help": "<https://list.example.com>",
          "List-Post": "<mailto:list@example.com>",
          "List-Software": "Mailing List Software",
          "List-Subscribe": "<https://subscribe.example.com>",
          "List-Unsubscribe": "<https://unsubscribe.example.com>",
        },
      })
      .toMessageString()
  );
  listMessages = [...listFolder.messages];

  tabmail.currentAbout3Pane.restoreState({
    folderURI: testFolder.URI,
    messagePaneVisible: true,
  });

  // Enable home calendar.
  cal.manager.getCalendars()[0].setProperty("disabled", false);

  registerCleanupFunction(() => {
    for (const folder of MailServices.accounts.allFolders) {
      Gloda.setFolderIndexingPriority(folder, -1);
    }
    MailServices.accounts.removeAccount(account, false);
    Services.prefs.clearUserPref("mail.openMessageBehavior");
    cal.manager.getCalendars()[0].setProperty("disabled", true);
  });
});

/**
 * Tests the mailContext menu on the thread tree and message pane when no
 * messages are selected.
 */
add_task(async function testNoMessages() {
  const about3Pane = tabmail.currentAbout3Pane;
  const mailContext = about3Pane.document.getElementById("mailContext");
  const { messageBrowser, messagePane, threadTree } = about3Pane;
  messagePane.clearAll();

  // The message pane browser isn't visible.

  Assert.ok(
    BrowserTestUtils.isHidden(messageBrowser),
    "message browser should be hidden"
  );
  Assert.equal(messageBrowser.currentURI.spec, "about:message");
  Assert.equal(
    messageBrowser.contentWindow.getMessagePaneBrowser().currentURI.spec,
    "about:blank"
  );
  EventUtils.synthesizeMouseAtCenter(
    about3Pane.document.getElementById("messagePane"),
    { type: "contextmenu" }
  );
  await checkMenuitems(mailContext);

  // Open the menu from an empty part of the thread pane.

  const treeRect = threadTree.getBoundingClientRect();
  EventUtils.synthesizeMouse(
    threadTree,
    treeRect.x + treeRect.width / 2,
    treeRect.bottom - 10,
    { type: "contextmenu" },
    about3Pane
  );
  await checkMenuitems(mailContext);
});

/**
 * Tests the mailContext menu on the thread tree and message pane when one
 * message is selected.
 */
add_task(async function testSingleMessage() {
  await TestUtils.waitForCondition(
    () =>
      ConversationOpener.isMessageIndexed(testMessages[0]) &&
      !GlodaIndexer.indexing,
    "waiting for Gloda to finish indexing",
    1000
  );

  const about3Pane = tabmail.currentAbout3Pane;
  const mailContext = about3Pane.document.getElementById("mailContext");
  const { gDBView, messageBrowser, threadTree } = about3Pane;
  const aboutMessage = messageBrowser.contentWindow;
  const messagePaneBrowser = aboutMessage.getMessagePaneBrowser();

  const loadedPromise = BrowserTestUtils.browserLoaded(
    messagePaneBrowser,
    undefined,
    url => url.endsWith(gDBView.getKeyAt(0))
  );
  threadTree.selectedIndex = 0;
  threadTree.scrollToIndex(0, true);
  await loadedPromise;

  // Open the menu from the message pane.

  Assert.ok(
    BrowserTestUtils.isVisible(messageBrowser),
    "message browser should be visible"
  );

  await BrowserTestUtils.synthesizeMouseAtCenter(
    ":root",
    { type: "contextmenu" },
    messagePaneBrowser
  );
  await checkMenuitems(mailContext, "singleMessage");

  // Open the menu from the thread pane.

  const row0 = await TestUtils.waitForCondition(
    () => threadTree.getRowAtIndex(0),
    "waiting for rows to be added"
  );
  EventUtils.synthesizeMouseAtCenter(row0, { type: "contextmenu" }, about3Pane);
  await checkMenuitems(mailContext, "singleMessageTree");

  // Open the menu from an unselected row of the thread pane.

  const row2 = await TestUtils.waitForCondition(
    () => threadTree.getRowAtIndex(2),
    "waiting for rows to be added"
  );
  EventUtils.synthesizeMouseAtCenter(row2, { type: "contextmenu" }, about3Pane);
  await checkMenuitems(mailContext, "singleMessageTree");

  // Check that the selection was restored.

  Assert.equal(
    threadTree.selectedIndex,
    0,
    "selection should be restored after the menu closes"
  );

  // Open the menu through the keyboard.

  row0.focus();
  EventUtils.synthesizeMouseAtCenter(
    row0,
    { type: "contextmenu", button: 0 },
    about3Pane
  );
  await BrowserTestUtils.waitForPopupEvent(mailContext, "shown");
  Assert.ok(
    BrowserTestUtils.isVisible(mailContext),
    "Context menu is shown through keyboard action"
  );
  mailContext.hidePopup();

  // Open the menu through the keyboard on a message that is scrolled slightly
  // out of view.

  threadTree.selectedIndex = 5;
  threadTree.scrollToIndex(threadTree.getLastVisibleIndex() + 7, true);
  await new Promise(resolve => window.requestAnimationFrame(resolve));
  Assert.equal(threadTree.currentIndex, 5, "Row 5 is the current row");
  Assert.ok(row0.parentNode, "Row element should still be attached");
  Assert.greater(
    threadTree.getFirstVisibleIndex(),
    5,
    "Selected row should no longer be visible"
  );
  EventUtils.synthesizeMouseAtCenter(
    threadTree,
    { type: "contextmenu", button: 0 },
    about3Pane
  );
  await new Promise(resolve => window.requestAnimationFrame(resolve));
  await BrowserTestUtils.waitForPopupEvent(mailContext, "shown");
  Assert.greaterOrEqual(
    5,
    threadTree.getFirstVisibleIndex(),
    "Current row is greater than or equal to first visible index"
  );
  Assert.lessOrEqual(
    5,
    threadTree.getLastVisibleIndex(),
    "Current row is less than or equal to last visible index"
  );
  mailContext.hidePopup();

  // Open the menu on a message that is scrolled out of view.

  threadTree.scrollToIndex(60, true);
  await new Promise(resolve => window.requestAnimationFrame(resolve));
  await TestUtils.waitForCondition(
    () => !row0.parentNode,
    "waiting for row element to no longer be attached"
  );
  Assert.equal(threadTree.currentIndex, 5, "Row 5 is the current row");
  Assert.ok(
    !threadTree.getRowAtIndex(threadTree.currentIndex),
    "Current row is scrolled out of view"
  );
  EventUtils.synthesizeMouseAtCenter(
    threadTree,
    { type: "contextmenu", button: 0 },
    about3Pane
  );
  await BrowserTestUtils.waitForPopupEvent(mailContext, "shown");
  Assert.ok(
    threadTree.getRowAtIndex(threadTree.currentIndex),
    "Current row is scrolled into view when showing context menu"
  );
  Assert.greaterOrEqual(
    5,
    threadTree.getFirstVisibleIndex(),
    "Current row is greater than or equal to first visible index"
  );
  Assert.lessOrEqual(
    5,
    threadTree.getLastVisibleIndex(),
    "Current row is less than or equal to last visible index"
  );
  mailContext.hidePopup();

  Assert.ok(BrowserTestUtils.isHidden(mailContext), "Context menu is hidden");
});

/**
 * Tests the mailContext menu on the thread tree when more than one message is
 * selected.
 */
add_task(async function testMultipleMessages() {
  await TestUtils.waitForCondition(
    () =>
      ConversationOpener.isMessageIndexed(testMessages[5]) &&
      !GlodaIndexer.indexing,
    "waiting for Gloda to finish indexing"
  );

  const about3Pane = tabmail.currentAbout3Pane;
  const mailContext = about3Pane.document.getElementById("mailContext");
  const { messageBrowser, multiMessageBrowser, threadTree } = about3Pane;
  threadTree.scrollToIndex(1, true);
  threadTree.selectedIndices = [1, 2, 3];

  // The message pane browser isn't visible.

  Assert.ok(
    BrowserTestUtils.isHidden(messageBrowser),
    "message browser should be hidden"
  );
  Assert.ok(
    BrowserTestUtils.isVisible(multiMessageBrowser),
    "multimessage browser should be visible"
  );

  // Open the menu from the thread pane.

  const row2 = await TestUtils.waitForCondition(
    () => threadTree.getRowAtIndex(2),
    "waiting for rows to be added"
  );

  EventUtils.synthesizeMouseAtCenter(row2, { type: "contextmenu" }, about3Pane);
  await checkMenuitems(mailContext, "multipleMessagesTree");

  // Open the menu from an unselected row of the thread pane.

  const row4 = await TestUtils.waitForCondition(
    () => threadTree.getRowAtIndex(4),
    "waiting for rows to be added"
  );
  EventUtils.synthesizeMouseAtCenter(row4, { type: "contextmenu" }, about3Pane);
  await checkMenuitems(mailContext, "singleMessageTree");

  // Check that the selection was restored.

  Assert.deepEqual(
    threadTree.selectedIndices,
    [1, 2, 3],
    "selection should be restored after the menu closes"
  );

  // Select a collapsed thread and open the menu.

  threadTree.scrollToIndex(5, true);
  threadTree.selectedIndices = [5];

  const row5 = await TestUtils.waitForCondition(
    () => threadTree.getRowAtIndex(5),
    "waiting for rows to be added"
  );
  EventUtils.synthesizeMouseAtCenter(row5, { type: "contextmenu" }, about3Pane);
  await checkMenuitems(mailContext, "collapsedThreadTree");

  // Open the menu in the thread pane on a message scrolled out of view.

  threadTree.selectAll();
  threadTree.currentIndex = 60;
  await TestUtils.waitForTick();
  await new Promise(resolve => window.requestAnimationFrame(resolve));
  threadTree.scrollToIndex(0, true);
  await new Promise(resolve => window.requestAnimationFrame(resolve));
  Assert.ok(
    !threadTree.getRowAtIndex(threadTree.currentIndex),
    "Current row is scrolled out of view"
  );

  EventUtils.synthesizeMouseAtCenter(
    threadTree,
    { type: "contextmenu", button: 0 },
    about3Pane
  );
  await BrowserTestUtils.waitForPopupEvent(mailContext, "shown");
  Assert.ok(
    threadTree.getRowAtIndex(threadTree.currentIndex),
    "Current row is scrolled into view when popup is shown"
  );
  mailContext.hidePopup();
});

/**
 * Tests the mailContext menu on the thread tree and message pane of a Drafts
 * folder.
 */
add_task(async function testDraftsFolder() {
  const about3Pane = tabmail.currentAbout3Pane;
  about3Pane.restoreState({ folderURI: draftsFolder.URI });

  await TestUtils.waitForCondition(
    () =>
      ConversationOpener.isMessageIndexed(draftsMessages[1]) &&
      !GlodaIndexer.indexing,
    "waiting for Gloda to finish indexing"
  );

  const mailContext = about3Pane.document.getElementById("mailContext");
  const { gDBView, messageBrowser, threadTree } = about3Pane;
  const messagePaneBrowser =
    messageBrowser.contentWindow.getMessagePaneBrowser();

  const loadedPromise = BrowserTestUtils.browserLoaded(
    messagePaneBrowser,
    undefined,
    url => url.endsWith(gDBView.getKeyAt(0))
  );
  threadTree.selectedIndex = 0;
  await loadedPromise;

  // Open the menu from the message pane.

  Assert.ok(
    BrowserTestUtils.isVisible(messageBrowser),
    "message browser should be visible"
  );
  await BrowserTestUtils.synthesizeMouseAtCenter(
    ":root",
    { type: "contextmenu" },
    messagePaneBrowser
  );
  await checkMenuitems(mailContext, "draftsFolder");

  // Open the menu from the thread pane.

  const row0 = await TestUtils.waitForCondition(
    () => threadTree.getRowAtIndex(0),
    "waiting for rows to be added"
  );
  EventUtils.synthesizeMouseAtCenter(row0, { type: "contextmenu" }, about3Pane);
  await checkMenuitems(mailContext, "draftsFolderTree");

  threadTree.scrollToIndex(1, true);
  threadTree.selectedIndices = [1, 2, 3];

  const row2 = await TestUtils.waitForCondition(
    () => threadTree.getRowAtIndex(2),
    "waiting for rows to be added"
  );
  EventUtils.synthesizeMouseAtCenter(row2, { type: "contextmenu" }, about3Pane);
  await checkMenuitems(mailContext, "multipleDraftsFolderTree");
});

/**
 * Tests the mailContext menu on the thread tree and message pane of a Templates
 * folder.
 */
add_task(async function testTemplatesFolder() {
  const about3Pane = tabmail.currentAbout3Pane;
  about3Pane.restoreState({ folderURI: templatesFolder.URI });

  await TestUtils.waitForCondition(
    () =>
      ConversationOpener.isMessageIndexed(templatesMessages[1]) &&
      !GlodaIndexer.indexing,
    "waiting for Gloda to finish indexing"
  );

  const mailContext = about3Pane.document.getElementById("mailContext");
  const { gDBView, messageBrowser, threadTree } = about3Pane;
  const messagePaneBrowser =
    messageBrowser.contentWindow.getMessagePaneBrowser();

  const loadedPromise = BrowserTestUtils.browserLoaded(
    messagePaneBrowser,
    undefined,
    url => url.endsWith(gDBView.getKeyAt(0))
  );
  threadTree.selectedIndex = 0;
  await loadedPromise;

  // Open the menu from the message pane.

  Assert.ok(
    BrowserTestUtils.isVisible(messageBrowser),
    "message browser should be visible"
  );
  await BrowserTestUtils.synthesizeMouseAtCenter(
    ":root",
    { type: "contextmenu" },
    messagePaneBrowser
  );
  await checkMenuitems(mailContext, "templatesFolder");

  // Open the menu from the thread pane.

  const row0 = await TestUtils.waitForCondition(
    () => threadTree.getRowAtIndex(0),
    "waiting for rows to be added"
  );
  EventUtils.synthesizeMouseAtCenter(row0, { type: "contextmenu" }, about3Pane);
  await checkMenuitems(mailContext, "templatesFolderTree");

  threadTree.scrollToIndex(1, true);
  threadTree.selectedIndices = [1, 2, 3];

  const row2 = await TestUtils.waitForCondition(
    () => threadTree.getRowAtIndex(2),
    "waiting for rows to be added"
  );
  EventUtils.synthesizeMouseAtCenter(row2, { type: "contextmenu" }, about3Pane);
  await checkMenuitems(mailContext, "multipleTemplatesFolderTree");
});

/**
 * Tests the mailContext menu on the thread tree and message pane of a
 * mailing list message.
 */
add_task(async function testListMessage() {
  const about3Pane = tabmail.currentAbout3Pane;
  about3Pane.restoreState({ folderURI: listFolder.URI });

  await TestUtils.waitForCondition(
    () =>
      ConversationOpener.isMessageIndexed(listMessages[0]) &&
      !GlodaIndexer.indexing,
    "waiting for Gloda to finish indexing"
  );

  const mailContext = about3Pane.document.getElementById("mailContext");
  const { gDBView, messageBrowser, threadTree } = about3Pane;
  const messagePaneBrowser =
    messageBrowser.contentWindow.getMessagePaneBrowser();

  const loadedPromise = BrowserTestUtils.browserLoaded(
    messagePaneBrowser,
    undefined,
    url => url.endsWith(gDBView.getKeyAt(0))
  );
  threadTree.selectedIndex = 0;
  await loadedPromise;

  // Open the menu from the message pane.

  Assert.ok(
    BrowserTestUtils.isVisible(messageBrowser),
    "message browser should be visible"
  );
  await BrowserTestUtils.synthesizeMouseAtCenter(
    ":root",
    { type: "contextmenu" },
    messagePaneBrowser
  );
  await checkMenuitems(mailContext, "listFolder");

  // Open the menu from the thread pane.

  const row0 = await TestUtils.waitForCondition(
    () => threadTree.getRowAtIndex(0),
    "waiting for rows to be added"
  );
  EventUtils.synthesizeMouseAtCenter(row0, { type: "contextmenu" }, about3Pane);
  await checkMenuitems(mailContext, "listFolderTree");
});

/**
 * Tests the mailContext menu on the thread tree and message pane of a Gloda
 * synthetic view (in this case a conversation, but a list of search results
 * should be the same).
 */
add_task(async function testSyntheticFolder() {
  await TestUtils.waitForCondition(
    () =>
      ConversationOpener.isMessageIndexed(testMessages[5]) &&
      !GlodaIndexer.indexing,
    "waiting for Gloda to finish indexing"
  );

  const tabPromise = BrowserTestUtils.waitForEvent(
    window,
    "aboutMessageLoaded"
  );
  const tab = tabmail.openTab("mail3PaneTab", {
    syntheticView: new GlodaSyntheticView({
      collection: Gloda.getMessageCollectionForHeaders([
        ...draftsMessages,
        ...testMessages.slice(0, 6),
      ]),
    }),
    title: "Test gloda results",
  });
  await tabPromise;

  const about3Pane = tab.chromeBrowser.contentWindow;
  const mailContext = about3Pane.document.getElementById("mailContext");
  const { messageBrowser, threadTree } = about3Pane;
  const messagePaneBrowser =
    messageBrowser.contentWindow.getMessagePaneBrowser();

  const gDBView = await TestUtils.waitForCondition(
    () => about3Pane.gDBView,
    "waiting for view to load in new tab"
  );
  let loadedPromise = BrowserTestUtils.browserLoaded(
    messagePaneBrowser,
    undefined,
    url => url.endsWith(gDBView.getKeyAt(9))
  );

  // Select a draft. Open the menu from the message pane.

  threadTree.selectedIndex = 9;
  await loadedPromise;

  Assert.ok(
    BrowserTestUtils.isVisible(messageBrowser),
    "message browser should be visible"
  );
  await BrowserTestUtils.synthesizeMouseAtCenter(
    ":root",
    { type: "contextmenu" },
    messagePaneBrowser
  );
  await checkMenuitems(mailContext, "syntheticFolderDraft");

  // Open the menu from the thread pane.

  const row9 = await TestUtils.waitForCondition(
    () => threadTree.getRowAtIndex(9),
    "waiting for rows to be added"
  );
  EventUtils.synthesizeMouseAtCenter(row9, { type: "contextmenu" }, about3Pane);
  await checkMenuitems(mailContext, "syntheticFolderDraftTree");

  // Select an ordinary message. Open the menu from the message pane.

  loadedPromise = BrowserTestUtils.browserLoaded(
    messagePaneBrowser,
    undefined,
    url => url.endsWith(gDBView.getKeyAt(4))
  );
  threadTree.selectedIndex = 4;
  await loadedPromise;

  Assert.ok(
    BrowserTestUtils.isVisible(messageBrowser),
    "message browser should be visible"
  );
  await BrowserTestUtils.synthesizeMouseAtCenter(
    ":root",
    { type: "contextmenu" },
    messagePaneBrowser
  );
  await checkMenuitems(mailContext, "syntheticFolder");

  // Open the menu from the thread pane.

  const row4 = await TestUtils.waitForCondition(
    () => threadTree.getRowAtIndex(4),
    "waiting for rows to be added"
  );
  EventUtils.synthesizeMouseAtCenter(row4, { type: "contextmenu" }, about3Pane);
  await checkMenuitems(mailContext, "syntheticFolderTree");

  // Open the menu from an unselected row of the thread pane.

  const row3 = await TestUtils.waitForCondition(
    () => threadTree.getRowAtIndex(3),
    "waiting for rows to be added"
  );
  EventUtils.synthesizeMouseAtCenter(row3, { type: "contextmenu" }, about3Pane);
  await checkMenuitems(mailContext, "syntheticFolderTree");

  // Check that the selection was restored.

  Assert.equal(
    threadTree.selectedIndex,
    4,
    "selection should be restored after the menu closes"
  );

  tabmail.closeOtherTabs(0);
});

/**
 * Tests the mailContext menu on the message pane of a message in a tab.
 */
add_task(async function testMessageTab() {
  const tabPromise = BrowserTestUtils.waitForEvent(
    tabmail.tabContainer,
    "TabOpen"
  );
  window.OpenMessageInNewTab(testMessages[0], { background: false });
  const {
    detail: { tabInfo },
  } = await tabPromise;
  await messageLoadedIn(tabInfo.chromeBrowser);

  const aboutMessage = tabInfo.chromeBrowser.contentWindow;
  const mailContext = aboutMessage.document.getElementById("mailContext");

  await BrowserTestUtils.synthesizeMouseAtCenter(
    ":root",
    { type: "contextmenu" },
    aboutMessage.getMessagePaneBrowser()
  );
  await checkMenuitems(mailContext, "messageTab");

  tabmail.closeOtherTabs(0);
});

/**
 * Tests the mailContext menu on the message pane of a file message in a tab.
 */
add_task(async function testExternalMessageTab() {
  const tabPromise = BrowserTestUtils.waitForEvent(
    tabmail.tabContainer,
    "TabOpen"
  );
  const messageFile = new FileUtils.File(
    getTestFilePath("files/sampleContent.eml")
  );
  Services.prefs.setIntPref(
    "mail.openMessageBehavior",
    MailConsts.OpenMessageBehavior.NEW_TAB
  );
  MailUtils.openEMLFile(
    window,
    messageFile,
    Services.io.newFileURI(messageFile)
  );
  const {
    detail: { tabInfo },
  } = await tabPromise;
  await messageLoadedIn(tabInfo.chromeBrowser);

  const aboutMessage = tabInfo.chromeBrowser.contentWindow;
  const mailContext = aboutMessage.document.getElementById("mailContext");

  await BrowserTestUtils.synthesizeMouseAtCenter(
    ":root",
    { type: "contextmenu" },
    aboutMessage.getMessagePaneBrowser()
  );
  await checkMenuitems(mailContext, "externalMessageTab");

  tabmail.closeOtherTabs(0);
});

/**
 * Tests the mailContext menu on the message pane of a message in a window.
 */
add_task(async function testMessageWindow() {
  const winPromise = BrowserTestUtils.domWindowOpenedAndLoaded();
  window.MsgOpenNewWindowForMessage(testMessages[0]);
  const win = await winPromise;
  await messageLoadedIn(win.messageBrowser);
  await SimpleTest.promiseFocus(win);

  const aboutMessage = win.messageBrowser.contentWindow;
  const mailContext = aboutMessage.document.getElementById("mailContext");

  await BrowserTestUtils.synthesizeMouseAtCenter(
    ":root",
    { type: "contextmenu" },
    aboutMessage.getMessagePaneBrowser()
  );
  await checkMenuitems(mailContext, "messageWindow");

  await BrowserTestUtils.closeWindow(win);
});

/**
 * Tests the mailContext menu on the message pane of a file message in a window.
 */
add_task(async function testExternalMessageWindow() {
  const winPromise = BrowserTestUtils.domWindowOpenedAndLoaded();
  const messageFile = new FileUtils.File(
    getTestFilePath("files/sampleContent.eml")
  );
  Services.prefs.setIntPref(
    "mail.openMessageBehavior",
    MailConsts.OpenMessageBehavior.NEW_WINDOW
  );
  MailUtils.openEMLFile(
    window,
    messageFile,
    Services.io.newFileURI(messageFile)
  );
  const win = await winPromise;
  await messageLoadedIn(win.messageBrowser);
  await SimpleTest.promiseFocus(win);

  const aboutMessage = win.messageBrowser.contentWindow;
  const mailContext = aboutMessage.document.getElementById("mailContext");

  await BrowserTestUtils.synthesizeMouseAtCenter(
    ":root",
    { type: "contextmenu" },
    aboutMessage.getMessagePaneBrowser()
  );
  await checkMenuitems(mailContext, "externalMessageWindow");

  await BrowserTestUtils.closeWindow(win);
});
