/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

add_task(async () => {
  const account = createAccount();
  addIdentity(account);
  const rootFolder = account.incomingServer.rootFolder;
  const folder = await createSubfolder(rootFolder, "test");
  await createMessages(folder, 1);
  const [message] = [...folder.messages];

  const tabmail = document.getElementById("tabmail");
  const about3Pane = tabmail.currentAbout3Pane;
  about3Pane.restoreState({
    folderPaneVisible: true,
    folderURI: folder.URI,
    messagePaneVisible: true,
  });
  about3Pane.threadTree.selectedIndex = 0;
  await awaitBrowserLoaded(
    about3Pane.messageBrowser.contentWindow.getMessagePaneBrowser()
  );

  await openMessageInTab(message);
  await openMessageInWindow(message);
  await new Promise(resolve => executeSoon(resolve));

  const files = {
    "background.js": async () => {
      const WHITE = [255, 255, 255, 255];
      const GREY = [127, 127, 127, 255];
      const GREEN = [0, 128, 0, 255];
      const BLUE = [0, 0, 255, 255];
      const RED = [217, 0, 0, 255];

      function compare(expected, actual, description) {
        if (Array.isArray(expected)) {
          window.assertDeepEqual(expected, actual, description);
        } else {
          browser.test.assertEq(expected, actual, description);
        }
      }

      async function checkProperty(property, expectedDefault, ...expected) {
        browser.test.log(
          `${property}: ${expectedDefault}, ${expected.join(", ")}`
        );

        compare(
          expectedDefault,
          await browser.messageDisplayAction[property]({}),
          `Default value for ${property} should be correct`
        );
        for (let i = 0; i < 3; i++) {
          compare(
            expected[i],
            await browser.messageDisplayAction[property]({ tabId: tabIDs[i] }),
            `Specific value for ${property} of tab #${i} should be correct`
          );
        }
      }

      async function checkRealState(property, ...expected) {
        await window.sendMessage("checkProperty", property, expected);
      }

      const tabs = await browser.tabs.query({});
      browser.test.assertEq(3, tabs.length);
      const tabIDs = tabs.map(t => t.id);

      // Test enable property.
      await checkProperty("isEnabled", true, true, true, true);
      await checkRealState("enabled", true, true, true);
      await browser.messageDisplayAction.disable();
      await checkProperty("isEnabled", false, false, false, false);
      await checkRealState("enabled", false, false, false);
      await browser.messageDisplayAction.enable(tabIDs[0]);
      await checkProperty("isEnabled", false, true, false, false);
      await checkRealState("enabled", true, false, false);
      await browser.messageDisplayAction.enable();
      await checkProperty("isEnabled", true, true, true, true);
      await checkRealState("enabled", true, true, true);
      await browser.messageDisplayAction.disable();
      await checkProperty("isEnabled", false, true, false, false);
      await checkRealState("enabled", true, false, false);
      await browser.messageDisplayAction.disable(tabIDs[0]);
      await checkProperty("isEnabled", false, false, false, false);
      await checkRealState("enabled", false, false, false);
      await browser.messageDisplayAction.enable();
      await checkProperty("isEnabled", true, false, true, true);
      await checkRealState("enabled", false, true, true);

      // Test badge text.
      await checkProperty("getBadgeText", "", "", "", "");
      await checkRealState("badgeText", null, null, null);
      await browser.messageDisplayAction.setBadgeText({ text: "default" });
      await checkProperty(
        "getBadgeText",
        "default",
        "default",
        "default",
        "default"
      );
      await checkRealState("badgeText", "default", "default", "default");
      await browser.messageDisplayAction.setBadgeText({
        text: "tab0",
        tabId: tabIDs[0],
      });
      await checkProperty(
        "getBadgeText",
        "default",
        "tab0",
        "default",
        "default"
      );
      await checkRealState("badgeText", "tab0", "default", "default");
      await browser.messageDisplayAction.setBadgeText({ text: null });
      await checkProperty("getBadgeText", "", "tab0", "", "");
      await checkRealState("badgeText", "tab0", null, null);
      await browser.messageDisplayAction.setBadgeText({
        text: "tab1",
        tabId: tabIDs[1],
      });
      await checkProperty("getBadgeText", "", "tab0", "tab1", "");
      await checkRealState("badgeText", "tab0", "tab1", null);
      await browser.messageDisplayAction.setBadgeText({ text: "new" });
      await checkProperty("getBadgeText", "new", "tab0", "tab1", "new");
      await checkRealState("badgeText", "tab0", "tab1", "new");
      await browser.messageDisplayAction.setBadgeText({
        text: null,
        tabId: tabIDs[0],
      });
      await checkProperty("getBadgeText", "new", "new", "tab1", "new");
      await checkRealState("badgeText", "new", "tab1", "new");
      await browser.messageDisplayAction.setBadgeText({
        text: null,
        tabId: tabIDs[1],
      });
      await checkProperty("getBadgeText", "new", "new", "new", "new");
      await checkRealState("badgeText", "new", "new", "new");

      // Test badge text color.
      await checkProperty("getBadgeTextColor", WHITE, WHITE, WHITE, WHITE);
      await checkRealState("badgeTextColor", null, null, null);
      await browser.messageDisplayAction.setBadgeTextColor({ color: GREY });
      await checkProperty("getBadgeTextColor", GREY, GREY, GREY, GREY);
      await checkRealState("badgeTextColor", GREY, GREY, GREY);
      await browser.messageDisplayAction.setBadgeTextColor({
        color: GREEN,
        tabId: tabIDs[0],
      });
      await checkProperty("getBadgeTextColor", GREY, GREEN, GREY, GREY);
      await checkRealState("badgeTextColor", GREEN, GREY, GREY);
      await browser.messageDisplayAction.setBadgeTextColor({ color: null });
      await checkProperty("getBadgeTextColor", WHITE, GREEN, WHITE, WHITE);
      await checkRealState("badgeTextColor", GREEN, null, null);
      await browser.messageDisplayAction.setBadgeTextColor({
        color: BLUE,
        tabId: tabIDs[1],
      });
      await checkProperty("getBadgeTextColor", WHITE, GREEN, BLUE, WHITE);
      await checkRealState("badgeTextColor", GREEN, BLUE, null);
      await browser.messageDisplayAction.setBadgeTextColor({ color: GREY });
      await checkProperty("getBadgeTextColor", GREY, GREEN, BLUE, GREY);
      await checkRealState("badgeTextColor", GREEN, BLUE, GREY);
      await browser.messageDisplayAction.setBadgeTextColor({
        color: null,
        tabId: tabIDs[0],
      });
      await checkProperty("getBadgeTextColor", GREY, GREY, BLUE, GREY);
      await checkRealState("badgeTextColor", GREY, BLUE, GREY);
      await browser.messageDisplayAction.setBadgeTextColor({
        color: null,
        tabId: tabIDs[1],
      });
      await checkProperty("getBadgeTextColor", GREY, GREY, GREY, GREY);
      await checkRealState("badgeTextColor", GREY, GREY, GREY);
      await browser.messageDisplayAction.setBadgeTextColor({ color: null });
      await checkProperty("getBadgeTextColor", WHITE, WHITE, WHITE, WHITE);
      await checkRealState("badgeTextColor", null, null, null);

      // Test badge background color.
      await checkProperty("getBadgeBackgroundColor", RED, RED, RED, RED);
      await checkRealState("badgeBackgroundColor", null, null, null);
      await browser.messageDisplayAction.setBadgeBackgroundColor({
        color: GREY,
      });
      await checkProperty("getBadgeBackgroundColor", GREY, GREY, GREY, GREY);
      await checkRealState("badgeBackgroundColor", GREY, GREY, GREY);
      await browser.messageDisplayAction.setBadgeBackgroundColor({
        color: GREEN,
        tabId: tabIDs[0],
      });
      await checkProperty("getBadgeBackgroundColor", GREY, GREEN, GREY, GREY);
      await checkRealState("badgeBackgroundColor", GREEN, GREY, GREY);
      await browser.messageDisplayAction.setBadgeBackgroundColor({
        color: null,
      });
      await checkProperty("getBadgeBackgroundColor", RED, GREEN, RED, RED);
      await checkRealState("badgeBackgroundColor", GREEN, null, null);
      await browser.messageDisplayAction.setBadgeBackgroundColor({
        color: BLUE,
        tabId: tabIDs[1],
      });
      await checkProperty("getBadgeBackgroundColor", RED, GREEN, BLUE, RED);
      await checkRealState("badgeBackgroundColor", GREEN, BLUE, null);
      await browser.messageDisplayAction.setBadgeBackgroundColor({
        color: GREY,
      });
      await checkProperty("getBadgeBackgroundColor", GREY, GREEN, BLUE, GREY);
      await checkRealState("badgeBackgroundColor", GREEN, BLUE, GREY);
      await browser.messageDisplayAction.setBadgeBackgroundColor({
        color: null,
        tabId: tabIDs[0],
      });
      await checkProperty("getBadgeBackgroundColor", GREY, GREY, BLUE, GREY);
      await checkRealState("badgeBackgroundColor", GREY, BLUE, GREY);
      await browser.messageDisplayAction.setBadgeBackgroundColor({
        color: null,
        tabId: tabIDs[1],
      });
      await checkProperty("getBadgeBackgroundColor", GREY, GREY, GREY, GREY);
      await checkRealState("badgeBackgroundColor", GREY, GREY, GREY);
      await browser.messageDisplayAction.setBadgeBackgroundColor({
        color: null,
      });
      await checkProperty("getBadgeBackgroundColor", RED, RED, RED, RED);
      await checkRealState("badgeBackgroundColor", null, null, null);

      // Test title property (since a label has not been set, this sets the
      // tooltip and the actual label of the button).
      await checkProperty(
        "getTitle",
        "default",
        "default",
        "default",
        "default"
      );
      await checkRealState("tooltip", "default", "default", "default");
      await checkRealState("label", "default", "default", "default");
      await browser.messageDisplayAction.setTitle({
        tabId: tabIDs[2],
        title: "tab2",
      });
      await checkProperty("getTitle", "default", "default", "default", "tab2");
      await checkRealState("tooltip", "default", "default", "tab2");
      await checkRealState("label", "default", "default", "tab2");
      await browser.messageDisplayAction.setTitle({ title: "new" });
      await checkProperty("getTitle", "new", "new", "new", "tab2");
      await checkRealState("tooltip", "new", "new", "tab2");
      await checkRealState("label", "new", "new", "tab2");
      await browser.messageDisplayAction.setTitle({
        tabId: tabIDs[1],
        title: "tab1",
      });
      await checkProperty("getTitle", "new", "new", "tab1", "tab2");
      await checkRealState("tooltip", "new", "tab1", "tab2");
      await checkRealState("label", "new", "tab1", "tab2");
      await browser.messageDisplayAction.setTitle({
        tabId: tabIDs[2],
        title: null,
      });
      await checkProperty("getTitle", "new", "new", "tab1", "new");
      await checkRealState("tooltip", "new", "tab1", "new");
      await checkRealState("label", "new", "tab1", "new");
      await browser.messageDisplayAction.setTitle({ title: null });
      await checkProperty("getTitle", "default", "default", "tab1", "default");
      await checkRealState("tooltip", "default", "tab1", "default");
      await checkRealState("label", "default", "tab1", "default");
      await browser.messageDisplayAction.setTitle({
        tabId: tabIDs[1],
        title: null,
      });
      await checkProperty(
        "getTitle",
        "default",
        "default",
        "default",
        "default"
      );
      await checkRealState("tooltip", "default", "default", "default");
      await checkRealState("label", "default", "default", "default");

      // Test label property (tooltip should not change).
      await checkProperty("getLabel", null, null, null, null);
      await checkRealState("tooltip", "default", "default", "default");
      await checkRealState("label", "default", "default", "default");
      await browser.messageDisplayAction.setLabel({
        tabId: tabIDs[2],
        label: "",
      });
      await checkProperty("getLabel", null, null, null, "");
      await checkRealState("tooltip", "default", "default", "default");
      await checkRealState("label", "default", "default", "");
      await browser.messageDisplayAction.setLabel({
        tabId: tabIDs[2],
        label: "tab2",
      });
      await checkProperty("getLabel", null, null, null, "tab2");
      await checkRealState("tooltip", "default", "default", "default");
      await checkRealState("label", "default", "default", "tab2");
      await browser.messageDisplayAction.setLabel({ label: "new" });
      await checkProperty("getLabel", "new", "new", "new", "tab2");
      await checkRealState("tooltip", "default", "default", "default");
      await checkRealState("label", "new", "new", "tab2");
      await browser.messageDisplayAction.setLabel({
        tabId: tabIDs[1],
        label: "tab1",
      });
      await checkProperty("getLabel", "new", "new", "tab1", "tab2");
      await checkRealState("tooltip", "default", "default", "default");
      await checkRealState("label", "new", "tab1", "tab2");
      await browser.messageDisplayAction.setLabel({
        tabId: tabIDs[2],
        label: null,
      });
      await checkProperty("getLabel", "new", "new", "tab1", "new");
      await checkRealState("tooltip", "default", "default", "default");
      await checkRealState("label", "new", "tab1", "new");
      await browser.messageDisplayAction.setLabel({ label: null });
      await checkProperty("getLabel", null, null, "tab1", null);
      await checkRealState("tooltip", "default", "default", "default");
      await checkRealState("label", "default", "tab1", "default");
      await browser.messageDisplayAction.setLabel({
        tabId: tabIDs[1],
        label: null,
      });
      await checkProperty("getLabel", null, null, null, null);
      await checkRealState("tooltip", "default", "default", "default");
      await checkRealState("label", "default", "default", "default");

      await browser.tabs.remove(tabIDs[0]);
      await browser.tabs.remove(tabIDs[1]);
      await browser.tabs.remove(tabIDs[2]);
      browser.test.notifyPass("finished");
    },
    "utils.js": await getUtilsJS(),
  };
  const extension = ExtensionTestUtils.loadExtension({
    files,
    manifest: {
      applications: {
        gecko: {
          id: "message_display_action_properties@mochi.test",
        },
      },
      background: { scripts: ["utils.js", "background.js"] },
      message_display_action: {
        default_title: "default",
      },
    },
  });

  await extension.startup();

  const mainWindowTabs = tabmail.tabInfo;
  is(mainWindowTabs.length, 2);

  const messageWindow = Services.wm.getMostRecentWindow("mail:messageWindow");
  const messageWindowButton =
    messageWindow.messageBrowser.contentDocument.getElementById(
      "message_display_action_properties_mochi_test-messageDisplayAction-toolbarbutton"
    );

  extension.onMessage("checkProperty", async (property, expected) => {
    function checkButton(button, expectedIndex) {
      const expectedValue = expected[expectedIndex];
      switch (property) {
        case "enabled":
          is(
            button.disabled,
            !expectedValue,
            `button ${expectedIndex} enabled state`
          );
          break;
        case "label":
          if (expectedValue == "") {
            is(
              button.getAttribute("hideWebExtensionLabel"),
              "true",
              `button ${expectedIndex} hideWebExtensionLabel`
            );
          } else {
            is(
              button.getAttribute("hideWebExtensionLabel"),
              "false",
              `button ${expectedIndex} hideWebExtensionLabel`
            );
            is(
              button.getAttribute("label"),
              expectedValue,
              `button ${expectedIndex} label`
            );
          }
          break;
        case "tooltip":
          is(
            button.getAttribute("tooltiptext"),
            expectedValue,
            `button ${expectedIndex} tooltiptext`
          );
          break;
        case "badgeText":
          is(
            button.getAttribute("badge"),
            expectedValue,
            `button ${expectedIndex} badge text`
          );
          break;
        case "badgeTextColor":
          {
            const style = button.getAttribute("badgeStyle");
            const styles = style ? style.split(";").map(e => e.trim()) : [];
            if (!expectedValue) {
              ok(
                !styles.some(e => e.startsWith("color: ")),
                `button ${expectedIndex} badge text color should not be set`
              );
            } else {
              ok(
                styles.includes(
                  `color: rgba(${expectedValue[0]}, ${expectedValue[1]}, ${
                    expectedValue[2]
                  }, ${expectedValue[3] / 255})`
                ),
                `button ${expectedIndex} badge text color should be set`
              );
            }
          }
          break;
        case "badgeBackgroundColor":
          {
            const style = button.getAttribute("badgeStyle");
            const styles = style ? style.split(";").map(e => e.trim()) : [];
            if (!expectedValue) {
              ok(
                !styles.some(e => e.startsWith("background-color: ")),
                `button ${expectedIndex} badge background color should not be set`
              );
            } else {
              ok(
                styles.includes(
                  `background-color: rgba(${expectedValue[0]}, ${
                    expectedValue[1]
                  }, ${expectedValue[2]}, ${expectedValue[3] / 255})`
                ),
                `button ${expectedIndex} badge background color should be set`
              );
            }
          }
          break;
      }
    }

    for (let i = 0; i < 2; i++) {
      tabmail.switchToTab(mainWindowTabs[i]);
      let aboutMessage = mainWindowTabs[i].chromeBrowser.contentWindow;
      if (aboutMessage.location.href == "about:3pane") {
        aboutMessage = aboutMessage.messageBrowser.contentWindow;
      }
      await new Promise(resolve => aboutMessage.requestAnimationFrame(resolve));
      checkButton(
        aboutMessage.document.getElementById(
          "message_display_action_properties_mochi_test-messageDisplayAction-toolbarbutton"
        ),
        i
      );
    }
    checkButton(messageWindowButton, 2);

    extension.sendMessage();
  });

  await extension.awaitFinish("finished");
  await extension.unload();

  messageWindow.close();
  tabmail.closeOtherTabs(0);
});
