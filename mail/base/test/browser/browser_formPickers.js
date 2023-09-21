/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/* eslint-env webextensions */

var { MailServices } = ChromeUtils.import(
  "resource:///modules/MailServices.jsm"
);

const TEST_DOCUMENT_URL =
  "http://mochi.test:8888/browser/comm/mail/base/test/browser/files/formContent.html";
const TEST_MESSAGE_URL =
  "http://mochi.test:8888/browser/comm/mail/base/test/browser/files/formContent.eml";

const tabmail = document.getElementById("tabmail");
let testFolder;

async function checkABrowser(browser) {
  if (
    browser.webProgress?.isLoadingDocument ||
    browser.currentURI?.spec == "about:blank"
  ) {
    await BrowserTestUtils.browserLoaded(
      browser,
      undefined,
      url => url != "about:blank"
    );
  }

  let win = browser.ownerGlobal;
  let doc = browser.ownerDocument;

  // Date picker

  // Open the popup.
  const pickerPromise = BrowserTestUtils.waitForDateTimePickerPanelShown(
    win.top
  );
  await SpecialPowers.spawn(browser, [], function () {
    const input = content.document.querySelector(`input[type="date"]`);
    if (content.location.protocol == "mailbox:") {
      // Clicking doesn't open the pop-up in messages. Bug 1854293.
      content.document.notifyUserGestureActivation();
      input.showPicker();
    } else {
      EventUtils.synthesizeMouseAtCenter(
        input.openOrClosedShadowRoot.getElementById("calendar-button"),
        {},
        content
      );
    }
  });
  const picker = await pickerPromise;

  // Click in the middle of the picker. This should always land on a date and
  // close the picker.
  let frame = picker.querySelector("#dateTimePopupFrame");
  EventUtils.synthesizeMouseAtCenter(
    frame.contentDocument.querySelector(".days-view td"),
    {},
    frame.contentWindow
  );
  await BrowserTestUtils.waitForPopupEvent(picker, "hidden");

  // Check the date was assigned to the input.
  await SpecialPowers.spawn(browser, [], () => {
    Assert.ok(
      content.document.querySelector(`input[type="date"]`).value,
      "date input should have a date value"
    );
  });

  // Select drop-down

  let menulist = win.top.document.getElementById("ContentSelectDropdown");

  // Click on the select control to open the popup.
  const selectPromise = BrowserTestUtils.waitForSelectPopupShown(win.top);
  await BrowserTestUtils.synthesizeMouseAtCenter("select", {}, browser);
  const menupopup = await selectPromise;

  Assert.equal(menulist.value, "0");
  Assert.equal(menupopup.childElementCount, 3);
  // Item values do not match the content document, but are 0-indexed.
  Assert.equal(menupopup.children[0].label, "");
  Assert.equal(menupopup.children[0].value, "0");
  Assert.equal(menupopup.children[1].label, "π");
  Assert.equal(menupopup.children[1].value, "1");
  Assert.equal(menupopup.children[2].label, "τ");
  Assert.equal(menupopup.children[2].value, "2");

  // Click the second option. This sets the value and closes the menulist.
  menupopup.activateItem(menupopup.children[1]);
  await BrowserTestUtils.waitForPopupEvent(menulist, "hidden");

  // Sometimes the next change doesn't happen soon enough.
  // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
  await new Promise(r => setTimeout(r, 1000));

  // Check the value was assigned to the control.
  await SpecialPowers.spawn(browser, [], () => {
    Assert.equal(content.document.querySelector("select").value, "3.141592654");
  });

  // Input auto-complete

  browser.focus();

  let popup = doc.getElementById(browser.getAttribute("autocompletepopup"));
  Assert.ok(popup, "auto-complete popup exists");

  // Click on the input box and type some letters to open the popup.
  const shownPromise = BrowserTestUtils.waitForPopupEvent(popup, "shown");
  await BrowserTestUtils.synthesizeMouseAtCenter(
    `input[list="letters"]`,
    {},
    browser
  );
  await BrowserTestUtils.synthesizeKey("e", {}, browser);
  await BrowserTestUtils.synthesizeKey("t", {}, browser);
  await BrowserTestUtils.synthesizeKey("a", {}, browser);
  await shownPromise;

  // Allow the popup time to initialise.
  await new Promise(r => win.setTimeout(r, 500));

  let list = popup.querySelector("richlistbox");
  Assert.ok(list, "list added to popup");
  Assert.equal(list.itemCount, 4);
  Assert.equal(list.itemChildren[0].getAttribute("title"), "beta");
  Assert.equal(list.itemChildren[1].getAttribute("title"), "zeta");
  Assert.equal(list.itemChildren[2].getAttribute("title"), "eta");
  Assert.equal(list.itemChildren[3].getAttribute("title"), "theta");

  // Click the second option. This sets the value and closes the popup.
  EventUtils.synthesizeMouseAtCenter(list.itemChildren[1], {}, win);
  await BrowserTestUtils.waitForPopupEvent(popup, "hidden");

  await SpecialPowers.spawn(browser, [], () => {
    // Check the value was assigned to the input.
    const input = content.document.querySelector(`input[list="letters"]`);
    Assert.equal(input.value, "zeta");

    // Type some more characters.
    // Check the space character isn't consumed by cmd_space.
    EventUtils.sendString(" function", content);
    Assert.equal(input.value, "zeta function");
  });

  // Check that a <details> element can be opened and closed by clicking or
  // pressing enter/space on its <summary>.
  await SpecialPowers.spawn(browser, [], () => {
    const details = content.document.querySelector("details");
    const summary = details.querySelector("summary");

    Assert.ok(!details.open, "details element should be closed initially");
    EventUtils.synthesizeMouseAtCenter(summary, {}, content);
    Assert.ok(details.open, "details element should open on click");
    EventUtils.synthesizeKey("VK_SPACE", {}, content);
    Assert.ok(!details.open, "details element should close on space key press");
    EventUtils.synthesizeKey("VK_RETURN", {}, content);
    Assert.ok(details.open, "details element should open on return key press");
  });
}

add_setup(async function () {
  MailServices.accounts.createLocalMailAccount();
  let account = MailServices.accounts.accounts[0];
  account.addIdentity(MailServices.accounts.createIdentity());
  let rootFolder = account.incomingServer.rootFolder;
  rootFolder.createSubfolder("formPickerFolder", null);
  testFolder = rootFolder
    .getChildNamed("formPickerFolder")
    .QueryInterface(Ci.nsIMsgLocalMailFolder);
  const message = await fetch(TEST_MESSAGE_URL).then(r => r.text());
  testFolder.addMessageBatch([message]);

  registerCleanupFunction(async () => {
    MailServices.accounts.removeAccount(account, false);
  });
});

add_task(async function testMessagePaneMessageBrowser() {
  const about3Pane = tabmail.currentAbout3Pane;
  about3Pane.restoreState({
    folderURI: testFolder.URI,
    messagePaneVisible: true,
  });
  const { gDBView, messageBrowser, threadTree } = about3Pane;
  const messagePaneBrowser =
    messageBrowser.contentWindow.getMessagePaneBrowser();

  const loadedPromise = BrowserTestUtils.browserLoaded(
    messagePaneBrowser,
    undefined,
    url => url.endsWith(gDBView.getKeyAt(0))
  );
  threadTree.selectedIndex = 0;
  threadTree.scrollToIndex(0, true);
  await loadedPromise;

  await checkABrowser(messagePaneBrowser);
});

add_task(async function testMessagePaneWebBrowser() {
  let about3Pane = tabmail.currentAbout3Pane;
  about3Pane.restoreState({
    folderURI: testFolder.URI,
    messagePaneVisible: true,
  });

  about3Pane.messagePane.displayWebPage(TEST_DOCUMENT_URL);
  await checkABrowser(about3Pane.webBrowser);
});

add_task(async function testContentTab() {
  let tab = window.openContentTab(TEST_DOCUMENT_URL);
  await checkABrowser(tab.browser);

  tabmail.closeTab(tab);
});

add_task(async function testMessageTab() {
  const tabPromise = BrowserTestUtils.waitForEvent(window, "MsgLoaded");
  window.OpenMessageInNewTab([...testFolder.messages][0], {
    background: false,
  });
  await tabPromise;
  await new Promise(resolve => setTimeout(resolve));

  const aboutMessage = tabmail.currentAboutMessage;
  await checkABrowser(aboutMessage.getMessagePaneBrowser());

  tabmail.closeOtherTabs(0);
});

add_task(async function testMessageWindow() {
  const winPromise = BrowserTestUtils.domWindowOpenedAndLoaded();
  window.MsgOpenNewWindowForMessage([...testFolder.messages][0]);
  const win = await winPromise;
  await BrowserTestUtils.waitForEvent(win, "MsgLoaded");
  await TestUtils.waitForCondition(() => Services.focus.activeWindow == win);

  const aboutMessage = win.messageBrowser.contentWindow;
  await checkABrowser(aboutMessage.getMessagePaneBrowser());

  await BrowserTestUtils.closeWindow(win);
});

add_task(async function testExtensionPopupWindow() {
  let extension = ExtensionTestUtils.loadExtension({
    background: async () => {
      await browser.windows.create({
        url: "formContent.html",
        type: "popup",
        width: 800,
        height: 500,
      });
      browser.test.notifyPass("ready");
    },
    files: {
      "formContent.html": await fetch(TEST_DOCUMENT_URL).then(response =>
        response.text()
      ),
    },
  });

  await extension.startup();
  await extension.awaitFinish("ready");

  let extensionPopup = Services.wm.getMostRecentWindow("mail:extensionPopup");
  // extensionPopup.xhtml needs time to initialise properly.
  await new Promise(resolve => extensionPopup.setTimeout(resolve, 500));
  await checkABrowser(extensionPopup.document.getElementById("requestFrame"));
  await BrowserTestUtils.closeWindow(extensionPopup);

  await extension.unload();
});

add_task(async function testExtensionBrowserAction() {
  let extension = ExtensionTestUtils.loadExtension({
    files: {
      "formContent.html": await fetch(TEST_DOCUMENT_URL).then(response =>
        response.text()
      ),
    },
    manifest: {
      applications: {
        gecko: {
          id: "formpickers@mochi.test",
        },
      },
      browser_action: {
        default_popup: "formContent.html",
      },
    },
  });

  await extension.startup();

  let { panel, browser } = await openExtensionPopup(
    window,
    "ext-formpickers\\@mochi.test"
  );
  await checkABrowser(browser);
  panel.hidePopup();

  await extension.unload();
});

add_task(async function testExtensionComposeAction() {
  let extension = ExtensionTestUtils.loadExtension({
    files: {
      "formContent.html": await fetch(TEST_DOCUMENT_URL).then(response =>
        response.text()
      ),
    },
    manifest: {
      applications: {
        gecko: {
          id: "formpickers@mochi.test",
        },
      },
      compose_action: {
        default_popup: "formContent.html",
      },
    },
  });

  await extension.startup();

  let params = Cc[
    "@mozilla.org/messengercompose/composeparams;1"
  ].createInstance(Ci.nsIMsgComposeParams);
  params.composeFields = Cc[
    "@mozilla.org/messengercompose/composefields;1"
  ].createInstance(Ci.nsIMsgCompFields);

  let composeWindowPromise = BrowserTestUtils.domWindowOpened();
  MailServices.compose.OpenComposeWindowWithParams(null, params);
  let composeWindow = await composeWindowPromise;
  await BrowserTestUtils.waitForEvent(composeWindow, "load");

  let { panel, browser } = await openExtensionPopup(
    composeWindow,
    "formpickers_mochi_test-composeAction-toolbarbutton"
  );
  await checkABrowser(browser);
  panel.hidePopup();

  await extension.unload();
  await BrowserTestUtils.closeWindow(composeWindow);
});

add_task(async function testExtensionMessageDisplayAction() {
  let extension = ExtensionTestUtils.loadExtension({
    files: {
      "formContent.html": await fetch(TEST_DOCUMENT_URL).then(response =>
        response.text()
      ),
    },
    manifest: {
      applications: {
        gecko: {
          id: "formpickers@mochi.test",
        },
      },
      message_display_action: {
        default_popup: "formContent.html",
      },
    },
  });

  await extension.startup();

  let messageWindowPromise = BrowserTestUtils.domWindowOpened();
  window.MsgOpenNewWindowForMessage([...testFolder.messages][0]);
  let messageWindow = await messageWindowPromise;
  let { target: aboutMessage } = await BrowserTestUtils.waitForEvent(
    messageWindow,
    "aboutMessageLoaded"
  );

  let { panel, browser } = await openExtensionPopup(
    aboutMessage,
    "formpickers_mochi_test-messageDisplayAction-toolbarbutton"
  );
  await checkABrowser(browser);
  panel.hidePopup();

  await extension.unload();
  await BrowserTestUtils.closeWindow(messageWindow);
});

add_task(async function testBrowserRequestWindow() {
  let requestWindow = await new Promise(resolve => {
    Services.ww.openWindow(
      null,
      "chrome://messenger/content/browserRequest.xhtml",
      null,
      "chrome,private,centerscreen,width=980,height=750",
      {
        url: TEST_DOCUMENT_URL,
        cancelled() {},
        loaded(window, webProgress) {
          resolve(window);
        },
      }
    );
  });

  await checkABrowser(requestWindow.document.getElementById("requestFrame"));
  await BrowserTestUtils.closeWindow(requestWindow);
});
