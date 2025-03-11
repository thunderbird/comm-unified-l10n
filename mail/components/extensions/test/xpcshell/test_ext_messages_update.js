/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var { ExtensionTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/ExtensionXPCShellUtils.sys.mjs"
);
var { TestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/TestUtils.sys.mjs"
);
var { ExtensionsUI } = ChromeUtils.importESModule(
  "resource:///modules/ExtensionsUI.sys.mjs"
);
var { AddonTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/AddonTestUtils.sys.mjs"
);

// Function to start an event page extension (MV3), which can be called whenever
// the main test is about to trigger an event. The extension terminates its
// background and listens for that single event, verifying it is waking up correctly.
async function event_page_extension(eventName, actionCallback) {
  const ext = ExtensionTestUtils.loadExtension({
    files: {
      "background.js": async () => {
        // Whenever the extension starts or wakes up, hasFired is set to false. In
        // case of a wake-up, the first fired event is the one that woke up the background.
        let hasFired = false;
        const _eventName = browser.runtime.getManifest().description;

        browser.messages[_eventName].addListener(async (...args) => {
          // Only send the first event after background wake-up, this should
          // be the only one expected.
          if (!hasFired) {
            hasFired = true;
            browser.test.sendMessage(`${_eventName} received`, args);
          }
        });
        browser.test.sendMessage("background started");
      },
    },
    manifest: {
      manifest_version: 3,
      description: eventName,
      background: { scripts: ["background.js"] },
      browser_specific_settings: {
        gecko: { id: "event_page_extension@mochi.test" },
      },
      permissions: ["accountsRead", "messagesRead", "messagesMove"],
    },
  });
  await ext.startup();
  await ext.awaitMessage("background started");
  // The listener should be persistent, but not primed.
  assertPersistentListeners(ext, "messages", eventName, { primed: false });

  await ext.terminateBackground({ disableResetIdleForTest: true });
  // Verify the primed persistent listener.
  assertPersistentListeners(ext, "messages", eventName, { primed: true });

  await actionCallback();
  const rv = await ext.awaitMessage(`${eventName} received`);
  await ext.awaitMessage("background started");
  // The listener should be persistent, but not primed.
  assertPersistentListeners(ext, "messages", eventName, { primed: false });

  await ext.unload();
  return rv;
}

add_setup(async () => {
  ExtensionTestUtils.mockAppInfo();
  AddonTestUtils.maybeInit(this);

  registerCleanupFunction(async () => {
    // Remove the temporary MozillaMailnews folder, which is not deleted in time when
    // the cleanupFunction registered by AddonTestUtils.maybeInit() checks for left over
    // files in the temp folder.
    // Note: PathUtils.tempDir points to the system temp folder, which is different.
    const path = PathUtils.join(
      Services.dirsvc.get("TmpD", Ci.nsIFile).path,
      "MozillaMailnews"
    );
    await IOUtils.remove(path, { recursive: true });
  });
});

add_task(
  {
    skip_if: () => IS_NNTP,
  },
  async function test_update() {
    await AddonTestUtils.promiseStartupManager();

    const account = createAccount();
    const rootFolder = account.incomingServer.rootFolder;
    const testFolder0 = await createSubfolder(rootFolder, "test0");
    await createMessages(testFolder0, 1);
    testFolder0.addKeywordsToMessages(
      [[...testFolder0.messages][0]],
      "testkeyword"
    );

    const files = {
      "background.js": async () => {
        async function capturePrimedEvent(eventName, callback) {
          const eventPageExtensionReadyPromise = window.waitForMessage();
          browser.test.sendMessage("capturePrimedEvent", eventName);
          await eventPageExtensionReadyPromise;
          const eventPageExtensionFinishedPromise = window.waitForMessage();
          callback();
          return eventPageExtensionFinishedPromise;
        }

        function newUpdatePromise(options = {}) {
          const numberOfEventsToCollapse =
            options.numberOfEventsToCollapse ?? 1;
          const reportIndividualEvents = options.reportIndividualEvents;

          return new Promise(resolve => {
            const seenEvents = {};
            const listener = (msg, newProps, oldProps) => {
              if (!seenEvents.hasOwnProperty(msg.id)) {
                seenEvents[msg.id] = {
                  events: [],
                  counts: 0,
                };
              }

              if (
                reportIndividualEvents ||
                seenEvents[msg.id].events.length == 0
              ) {
                seenEvents[msg.id].events.push({
                  newProps: {},
                  oldProps: {},
                });
              }
              seenEvents[msg.id].counts++;
              const idx = seenEvents[msg.id].events.length - 1;

              for (const prop of Object.keys(newProps)) {
                seenEvents[msg.id].events[idx].newProps[prop] = newProps[prop];
                seenEvents[msg.id].events[idx].oldProps[prop] = oldProps[prop];
              }

              if (seenEvents[msg.id].counts == numberOfEventsToCollapse) {
                browser.messages.onUpdated.removeListener(listener);
                resolve({
                  msg,
                  newProps: reportIndividualEvents
                    ? seenEvents[msg.id].events.map(e => e.newProps)
                    : seenEvents[msg.id].events[idx].newProps,
                  oldProps: reportIndividualEvents
                    ? seenEvents[msg.id].events.map(e => e.oldProps)
                    : seenEvents[msg.id].events[idx].oldProps,
                });
              }
            };
            browser.messages.onUpdated.addListener(listener);
          });
        }

        const tags = await browser.messages.tags.list();
        const [data] = await window.sendMessage("getFolder");
        const [folder] = await browser.folders.query({ name: data.folderName });
        const messageList = await browser.messages.list(folder.id);
        browser.test.assertEq(1, messageList.messages.length);
        let message = messageList.messages[0];
        browser.test.assertFalse(message.flagged);
        browser.test.assertFalse(message.read);
        browser.test.assertFalse(message.junk);
        browser.test.assertEq(0, message.junkScore);
        browser.test.assertEq(0, message.tags.length);
        browser.test.assertEq(data.messageSize, message.size);
        browser.test.assertEq("0@made.up.invalid", message.headerMessageId);

        // Test that setting flagged works.
        let updatePromise = newUpdatePromise();
        let primedUpdatedInfo = await capturePrimedEvent("onUpdated", () =>
          browser.messages.update(message.id, { flagged: true })
        );
        let updateInfo = await updatePromise;

        window.assertDeepEqual(
          [updateInfo.msg, updateInfo.newProps],
          [primedUpdatedInfo[0], primedUpdatedInfo[1]],
          "The primed and non-primed onUpdated events should return the same values",
          { strict: true }
        );
        browser.test.assertEq(message.id, updateInfo.msg.id);
        window.assertDeepEqual({ flagged: true }, updateInfo.newProps);
        window.assertDeepEqual({ flagged: false }, updateInfo.oldProps);
        await window.sendMessage("flagged");

        // Test that setting read works.
        updatePromise = newUpdatePromise();
        primedUpdatedInfo = await capturePrimedEvent("onUpdated", () =>
          browser.messages.update(message.id, { read: true })
        );
        updateInfo = await updatePromise;

        window.assertDeepEqual(
          [updateInfo.msg, updateInfo.newProps],
          [primedUpdatedInfo[0], primedUpdatedInfo[1]],
          "The primed and non-primed onUpdated events should return the same values",
          { strict: true }
        );
        browser.test.assertEq(message.id, updateInfo.msg.id);
        window.assertDeepEqual({ read: true }, updateInfo.newProps);
        window.assertDeepEqual({ read: false }, updateInfo.oldProps);
        await window.sendMessage("read");

        // Test that setting junk works.
        updatePromise = newUpdatePromise();
        primedUpdatedInfo = await capturePrimedEvent("onUpdated", () =>
          browser.messages.update(message.id, { junk: true })
        );
        updateInfo = await updatePromise;

        window.assertDeepEqual(
          [updateInfo.msg, updateInfo.newProps],
          [primedUpdatedInfo[0], primedUpdatedInfo[1]],
          "The primed and non-primed onUpdated events should return the same values",
          { strict: true }
        );
        browser.test.assertEq(message.id, updateInfo.msg.id);
        window.assertDeepEqual({ junk: true }, updateInfo.newProps);
        window.assertDeepEqual({ junk: false }, updateInfo.oldProps);
        await window.sendMessage("junk");

        // Test that setting one tag works.
        updatePromise = newUpdatePromise();
        primedUpdatedInfo = await capturePrimedEvent("onUpdated", () =>
          browser.messages.update(message.id, { tags: [tags[0].key] })
        );
        updateInfo = await updatePromise;

        window.assertDeepEqual(
          [updateInfo.msg, updateInfo.newProps],
          [primedUpdatedInfo[0], primedUpdatedInfo[1]],
          "The primed and non-primed onUpdated events should return the same values",
          { strict: true }
        );
        browser.test.assertEq(message.id, updateInfo.msg.id);
        window.assertDeepEqual({ tags: [tags[0].key] }, updateInfo.newProps);
        window.assertDeepEqual({ tags: [] }, updateInfo.oldProps);

        await window.sendMessage("tags1");

        // Test that setting two tags works. We get 3 events: one removing tags0,
        // one adding tags1 and one adding tags2. updatePromise is waiting for
        // the third one before resolving.
        updatePromise = newUpdatePromise({
          numberOfEventsToCollapse: 2,
          reportIndividualEvents: true,
        });
        await browser.messages.update(message.id, {
          tags: [tags[1].key, tags[2].key],
        });
        updateInfo = await updatePromise;
        browser.test.assertEq(message.id, updateInfo.msg.id);
        window.assertDeepEqual(
          [{ tags: [] }, { tags: [tags[1].key, tags[2].key] }],
          updateInfo.newProps,
          "Received new properties should be correct"
        );
        window.assertDeepEqual(
          [{ tags: [tags[0].key] }, { tags: [] }],
          updateInfo.oldProps,
          "Received old properties should be correct"
        );
        await window.sendMessage("tags2");

        // Test that unspecified properties aren't changed.
        let listenerCalls = 0;
        const listenerFunc = () => {
          listenerCalls++;
        };
        browser.messages.onUpdated.addListener(listenerFunc);
        await browser.messages.update(message.id, {});
        await window.sendMessage("empty");
        // Check if the no-op update call triggered a listener.
        await new Promise(resolve => setTimeout(resolve));
        browser.messages.onUpdated.removeListener(listenerFunc);
        browser.test.assertEq(
          0,
          listenerCalls,
          "Not expecting listener callbacks on no-op updates."
        );

        message = await browser.messages.get(message.id);
        browser.test.assertTrue(message.flagged);
        browser.test.assertTrue(message.read);
        browser.test.assertTrue(message.junk);
        browser.test.assertEq(100, message.junkScore);
        browser.test.assertEq(2, message.tags.length);
        browser.test.assertEq(tags[1].key, message.tags[0]);
        browser.test.assertEq(tags[2].key, message.tags[1]);
        browser.test.assertEq("0@made.up.invalid", message.headerMessageId);

        // Test that clearing properties works.
        updatePromise = newUpdatePromise({ numberOfEventsToCollapse: 4 });
        await browser.messages.update(message.id, {
          flagged: false,
          read: false,
          junk: false,
          tags: [],
        });
        updateInfo = await updatePromise;
        window.assertDeepEqual(
          {
            flagged: false,
            read: false,
            junk: false,
            tags: [],
          },
          updateInfo.newProps
        );
        await window.sendMessage("clear");

        message = await browser.messages.get(message.id);
        browser.test.assertFalse(message.flagged);
        browser.test.assertFalse(message.read);
        browser.test.assertFalse(message.external);
        browser.test.assertFalse(message.junk);
        browser.test.assertEq(0, message.junkScore);
        browser.test.assertEq(0, message.tags.length);
        browser.test.assertEq("0@made.up.invalid", message.headerMessageId);

        browser.test.notifyPass("finished");
      },
      "utils.js": await getUtilsJS(),
    };
    const extension = ExtensionTestUtils.loadExtension({
      files,
      manifest: {
        background: { scripts: ["utils.js", "background.js"] },
        permissions: [
          "accountsRead",
          "messagesRead",
          "messagesTagsList",
          "messagesUpdate",
        ],
        browser_specific_settings: {
          gecko: { id: "messages.update@mochi.test" },
        },
      },
    });

    const message = [...testFolder0.messages][0];
    ok(!message.isFlagged);
    ok(!message.isRead);
    equal(message.getStringProperty("keywords"), "testkeyword");

    extension.onMessage("capturePrimedEvent", async eventName => {
      const primedEventData = await event_page_extension(eventName, () => {
        // Resume execution in the main test, after the event page extension is
        // ready to capture the event with deactivated background.
        extension.sendMessage();
      });
      extension.sendMessage(...primedEventData);
    });

    extension.onMessage("flagged", async () => {
      await TestUtils.waitForCondition(() => message.isFlagged);
      extension.sendMessage();
    });

    extension.onMessage("read", async () => {
      await TestUtils.waitForCondition(() => message.isRead);
      extension.sendMessage();
    });

    extension.onMessage("junk", async () => {
      await TestUtils.waitForCondition(
        () => message.getStringProperty("junkscore") == 100
      );
      extension.sendMessage();
    });

    extension.onMessage("tags1", async () => {
      if (IS_IMAP) {
        // Only IMAP sets the junk/nonjunk keyword.
        await TestUtils.waitForCondition(
          () =>
            message.getStringProperty("keywords") == "testkeyword junk $label1"
        );
      } else {
        await TestUtils.waitForCondition(
          () => message.getStringProperty("keywords") == "testkeyword $label1"
        );
      }
      extension.sendMessage();
    });

    extension.onMessage("tags2", async () => {
      if (IS_IMAP) {
        await TestUtils.waitForCondition(
          () =>
            message.getStringProperty("keywords") ==
            "testkeyword junk $label2 $label3"
        );
      } else {
        await TestUtils.waitForCondition(
          () =>
            message.getStringProperty("keywords") ==
            "testkeyword $label2 $label3"
        );
      }
      extension.sendMessage();
    });

    extension.onMessage("empty", async () => {
      await TestUtils.waitForCondition(() => message.isFlagged);
      await TestUtils.waitForCondition(() => message.isRead);
      if (IS_IMAP) {
        await TestUtils.waitForCondition(
          () =>
            message.getStringProperty("keywords") ==
            "testkeyword junk $label2 $label3"
        );
      } else {
        await TestUtils.waitForCondition(
          () =>
            message.getStringProperty("keywords") ==
            "testkeyword $label2 $label3"
        );
      }
      extension.sendMessage();
    });

    extension.onMessage("clear", async () => {
      await TestUtils.waitForCondition(() => !message.isFlagged);
      await TestUtils.waitForCondition(() => !message.isRead);
      await TestUtils.waitForCondition(
        () => message.getStringProperty("junkscore") == 0
      );
      if (IS_IMAP) {
        await TestUtils.waitForCondition(
          () => message.getStringProperty("keywords") == "testkeyword nonjunk"
        );
      } else {
        await TestUtils.waitForCondition(
          () => message.getStringProperty("keywords") == "testkeyword"
        );
      }
      extension.sendMessage();
    });

    extension.onMessage("getFolder", async () => {
      extension.sendMessage({
        folderName: "test0",
        messageSize: message.messageSize,
      });
    });

    await extension.startup();
    await extension.awaitFinish("finished");
    await extension.unload();

    cleanUpAccount(account);
    await AddonTestUtils.promiseShutdownManager();
  }
);
