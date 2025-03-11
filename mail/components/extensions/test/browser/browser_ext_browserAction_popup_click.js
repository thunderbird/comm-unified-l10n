/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

let gAccount, gMessages;

add_setup(async () => {
  gAccount = createAccount();
  const rootFolder = gAccount.incomingServer.rootFolder;
  const subFolders = rootFolder.subFolders;
  await createMessages(subFolders[0], 10);
  gMessages = subFolders[0].messages;
});

// This test clicks on the action button to open the popup.
add_task(async function test_popup_open_with_click() {
  info("3-pane tab");
  {
    const testConfig = {
      actionType: "browser_action",
      testType: "open-with-mouse-click",
      window,
    };

    await run_popup_test({
      ...testConfig,
    });
    await run_popup_test({
      ...testConfig,
      disable_button: true,
    });
    await run_popup_test({
      ...testConfig,
      use_default_popup: true,
    });
  }

  info("Message window");
  {
    const messageWindow = await openMessageInWindow(gMessages.getNext());
    const testConfig = {
      actionType: "browser_action",
      testType: "open-with-mouse-click",
      default_windows: ["messageDisplay"],
      window: messageWindow,
    };

    await run_popup_test({
      ...testConfig,
    });
    await run_popup_test({
      ...testConfig,
      disable_button: true,
    });
    await run_popup_test({
      ...testConfig,
      use_default_popup: true,
    });

    messageWindow.close();
  }
});

// This test uses openPopup() to open the popup in a normal window.
add_task(async function test_popup_open_with_openPopup_in_normal_window() {
  const files = {
    "background.js": async () => {
      const windows = await browser.windows.getAll();
      const mailWindow = windows.find(window => window.type == "normal");
      const messageWindow = windows.find(
        window => window.type == "messageDisplay"
      );
      browser.test.assertTrue(!!mailWindow, "should have found a mailWindow");
      browser.test.assertTrue(
        !!messageWindow,
        "should have found a messageWindow"
      );

      // The test starts with an opened messageWindow, the browser_action is not
      // allowed there and should not be visible, openPopup() should fail.
      browser.test.assertTrue(
        (await browser.windows.get(messageWindow.id)).focused,
        "messageWindow should be focused"
      );
      browser.test.assertFalse(
        await browser.browserAction.openPopup(),
        "openPopup() should have failed while the messageWindow is active"
      );

      // Specifically open the browser_action of the mailWindow, should become
      // focused and openPopup() should succeed.
      const popupClosePromise1 = window.waitForMessage("popup closed");
      browser.test.assertTrue(
        await browser.browserAction.openPopup({ windowId: mailWindow.id }),
        "openPopup() should have succeeded when explicitly requesting the mailWindow"
      );
      await popupClosePromise1;
      browser.test.assertTrue(
        (await browser.windows.get(mailWindow.id)).focused,
        "mailWindow should be focused"
      );

      // mailWindow is the topmost window now, openPopup() should succeed.
      const popupClosePromise2 = window.waitForMessage("popup closed");
      browser.test.assertTrue(
        await browser.browserAction.openPopup(),
        "openPopup() should have succeeded after the mailWindow has become active"
      );
      await popupClosePromise2;

      // Create content tab, the browser_action is not allowed in that space and
      // should not be visible, openPopup() should fail.
      const contentTab = await browser.tabs.create({
        url: "https://www.example.com",
      });
      browser.test.assertFalse(
        await browser.browserAction.openPopup(),
        "openPopup() should have failed while the content tab is active"
      );

      // Close the content tab and return to the mail space, the browser_action
      // should be visible again, openPopup() should succeed.
      await browser.tabs.remove(contentTab.id);
      const popupClosePromise3 = window.waitForMessage("popup closed");
      browser.test.assertTrue(
        await browser.browserAction.openPopup(),
        "openPopup() should have succeeded after the content tab was closed"
      );
      await popupClosePromise3;

      // Disable the browser_action, openPopup() should fail.
      await browser.browserAction.disable();
      browser.test.assertFalse(
        await browser.browserAction.openPopup(),
        "openPopup() should have failed after the action_button was disabled"
      );

      // Enable the browser_action, openPopup() should succeed.
      await browser.browserAction.enable();
      const popupClosePromise4 = window.waitForMessage("popup closed");
      browser.test.assertTrue(
        await browser.browserAction.openPopup(),
        "openPopup() should have succeeded after the action_button was enabled again"
      );
      await popupClosePromise4;

      // Create a popup window, which does not have a browser_action, openPopup()
      // should fail.
      const popupWindow = await browser.windows.create({
        type: "popup",
        url: "https://www.example.com",
      });
      browser.test.assertTrue(
        (await browser.windows.get(popupWindow.id)).focused,
        "popupWindow should be focused"
      );
      browser.test.assertFalse(
        await browser.browserAction.openPopup(),
        "openPopup() should have failed while the popup window is active"
      );

      // Specifically open the browser_action of the mailWindow, should become
      // focused and openPopup() should succeed.
      const popupClosePromise5 = window.waitForMessage("popup closed");
      browser.test.assertTrue(
        await browser.browserAction.openPopup({ windowId: mailWindow.id }),
        "openPopup() should have succeeded when explicitly requesting the mailWindow"
      );
      await popupClosePromise5;
      browser.test.assertTrue(
        (await browser.windows.get(mailWindow.id)).focused,
        "mailWindow should be focused"
      );

      // Close the popup window
      await browser.windows.remove(popupWindow.id);

      browser.test.notifyPass("finished");
    },
    "utils.js": await getUtilsJS(),
    "popup.html": `<!DOCTYPE html>
      <html>
        <head>
          <title>Popup</title>
          <meta charset="utf-8">
          <script defer="defer" src="popup.js"></script>
        </head>
        <body>
          <p>Hello</p>
        </body>
      </html>`,
    "popup.js": async function () {
      const [currentTab] = await browser.tabs.query({
        currentWindow: true,
        active: true,
      });
      browser.test.log(
        `windowType: ${currentTab.windowType}, windowId: ${currentTab.windowId}`
      );
      browser.test.sendMessage("popup opened", currentTab.windowId);
    },
  };
  const extension = ExtensionTestUtils.loadExtension({
    files,
    useAddonManager: "temporary",
    manifest: {
      applications: {
        gecko: {
          id: "browser_action_openPopup@mochi.test",
        },
      },
      background: { scripts: ["utils.js", "background.js"] },
      browser_action: {
        default_title: "default",
        default_popup: "popup.html",
      },
    },
  });

  extension.onMessage("popup opened", async windowId => {
    const window = Services.wm.getOuterWindowWithId(windowId);
    console.log(
      `windowtype of container window: ${window.document.documentElement.getAttribute(
        "windowtype"
      )}`
    );
    await closeBrowserAction(extension, window);
    extension.sendMessage("popup closed");
  });

  const messageWindow = await openMessageInWindow(gMessages.getNext());

  await extension.startup();
  await extension.awaitFinish("finished");
  await extension.unload();

  messageWindow.close();
});

// This test adds the action button to the message window and not to the mail
// window (the default_windows manifest property is set to ["messageDisplay"].
// the test then uses openPopup() to open the popup in a message window.
add_task(async function test_popup_open_with_openPopup_in_message_window() {
  const files = {
    "background.js": async () => {
      const windows = await browser.windows.getAll();
      const mailWindow = windows.find(window => window.type == "normal");
      const messageWindow = windows.find(
        window => window.type == "messageDisplay"
      );
      browser.test.assertTrue(!!mailWindow, "should have found a mailWindow");
      browser.test.assertTrue(
        !!messageWindow,
        "should have found a messageWindow"
      );

      // The test starts with an opened messageWindow, the browser_action is allowed
      // there and should be visible, openPopup() should succeed.
      browser.test.assertTrue(
        (await browser.windows.get(messageWindow.id)).focused,
        "messageWindow should be focused"
      );
      const popupClosePromise1 = window.waitForMessage("popup closed");
      browser.test.assertTrue(
        await browser.browserAction.openPopup(),
        "openPopup() should have succeeded while the messageWindow is active"
      );
      await popupClosePromise1;

      // Collapse the toolbar, openPopup() should fail.
      await window.sendMessage("collapseToolbar", true);
      browser.test.assertFalse(
        await browser.browserAction.openPopup(),
        "openPopup() should have failed while the toolbar is collapsed"
      );

      // Restore the toolbar, openPopup() should succeed.
      await window.sendMessage("collapseToolbar", false);
      const popupClosePromise2 = window.waitForMessage("popup closed");
      browser.test.assertTrue(
        await browser.browserAction.openPopup(),
        "openPopup() should have succeeded after the toolbar is restored"
      );
      await popupClosePromise2;

      // Specifically open the browser_action of the mailWindow, it should not be
      // allowed there and openPopup() should fail.
      browser.test.assertFalse(
        await browser.browserAction.openPopup({ windowId: mailWindow.id }),
        "openPopup() should have failed when explicitly requesting the mailWindow"
      );

      // The messageWindow should still have focus, openPopup() should succeed.
      browser.test.assertTrue(
        (await browser.windows.get(messageWindow.id)).focused,
        "messageWindow should be focused"
      );
      const popupClosePromise3 = window.waitForMessage("popup closed");
      browser.test.assertTrue(
        await browser.browserAction.openPopup(),
        "openPopup() should still have succeeded while the messageWindow is active"
      );
      await popupClosePromise3;

      // Disable the browser_action, openPopup() should fail.
      await browser.browserAction.disable();
      browser.test.assertFalse(
        await browser.browserAction.openPopup(),
        "openPopup() should have failed after the action_button was disabled"
      );

      // Enable the browser_action, openPopup() should succeed.
      await browser.browserAction.enable();
      const popupClosePromise4 = window.waitForMessage("popup closed");
      browser.test.assertTrue(
        await browser.browserAction.openPopup(),
        "openPopup() should have succeeded after the action_button was enabled again"
      );
      await popupClosePromise4;

      // Create a popup window, which does not have a browser_action, openPopup()
      // should fail.
      const popupWindow = await browser.windows.create({
        type: "popup",
        url: "https://www.example.com",
      });
      browser.test.assertTrue(
        await browser.windows.get(popupWindow.id),
        "popupWindow should be focused"
      );
      browser.test.assertFalse(
        await browser.browserAction.openPopup(),
        "openPopup() should have failed while the popup window is active"
      );

      // Specifically open the browser_action of the messageWindow, should become
      // focused and openPopup() should succeed.
      const popupClosePromise5 = window.waitForMessage("popup closed");
      browser.test.assertTrue(
        await browser.browserAction.openPopup({ windowId: messageWindow.id }),
        "openPopup() should have succeeded when explicitly requesting the messageWindow"
      );
      await popupClosePromise5;
      browser.test.assertTrue(
        (await browser.windows.get(messageWindow.id)).focused,
        "messageWindow should be focused"
      );

      // The messageWindow is focused now, openPopup() should succeed.
      const popupClosePromise6 = window.waitForMessage("popup closed");
      browser.test.assertTrue(
        await browser.browserAction.openPopup(),
        "openPopup() should have succeeded while the messageWindow is active"
      );
      await popupClosePromise6;

      // Close the popup window and finish
      await browser.windows.remove(popupWindow.id);
      browser.test.notifyPass("finished");
    },
    "utils.js": await getUtilsJS(),
    "popup.html": `<!DOCTYPE html>
      <html>
        <head>
          <title>Popup</title>
          <meta charset="utf-8">
          <script defer="defer" src="popup.js"></script>
        </head>
        <body>
          <p>Hello</p>
        </body>
      </html>`,
    "popup.js": async function () {
      const [currentTab] = await browser.tabs.query({
        currentWindow: true,
        active: true,
      });
      browser.test.log(
        `windowType: ${currentTab.windowType}, windowId: ${currentTab.windowId}`
      );
      browser.test.sendMessage("popup opened", currentTab.windowId);
    },
  };
  const extension = ExtensionTestUtils.loadExtension({
    files,
    useAddonManager: "temporary",
    manifest: {
      applications: {
        gecko: {
          id: "browser_action_openPopup@mochi.test",
        },
      },
      background: { scripts: ["utils.js", "background.js"] },
      browser_action: {
        default_title: "default",
        default_popup: "popup.html",
        default_windows: ["messageDisplay"],
      },
    },
  });

  extension.onMessage("popup opened", async windowId => {
    const window = Services.wm.getOuterWindowWithId(windowId);
    console.log(
      `windowtype of container window: ${window.document.documentElement.getAttribute(
        "windowtype"
      )}`
    );
    await closeBrowserAction(extension, window);
    extension.sendMessage("popup closed");
  });

  extension.onMessage("collapseToolbar", state => {
    const window = Services.wm.getMostRecentWindow("mail:messageWindow");
    const toolbar = window.document.getElementById("mail-bar3");
    if (state) {
      toolbar.setAttribute("collapsed", "true");
    } else {
      toolbar.removeAttribute("collapsed");
    }
    extension.sendMessage();
  });

  const messageWindow = await openMessageInWindow(gMessages.getNext());

  await extension.startup();
  await extension.awaitFinish("finished");
  await extension.unload();

  messageWindow.close();
});
