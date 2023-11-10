/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var { ExtensionTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/ExtensionXPCShellUtils.sys.mjs"
);

add_task(
  {
    skip_if: () => IS_NNTP,
  },
  async function test_folders() {
    const files = {
      "background.js": async () => {
        const [accountId, IS_IMAP] = await window.waitForMessage();

        let account = await browser.accounts.get(accountId);
        // FIXME: Expose account root folder.
        const rootFolder = { id: `${accountId}://`, accountId, path: "/" };

        browser.test.assertEq(3, account.folders.length);

        // Test create.

        const onCreatedPromise = window.waitForEvent("folders.onCreated");
        const folder1 = await browser.folders.create(account, "folder1");
        const [createdFolder] = await onCreatedPromise;
        for (const folder of [folder1, createdFolder]) {
          browser.test.assertEq(accountId, folder.accountId);
          browser.test.assertEq("folder1", folder.name);
          browser.test.assertEq("/folder1", folder.path);
        }

        account = await browser.accounts.get(accountId);
        // Check order of the returned folders being correct (new folder not last).
        browser.test.assertEq(4, account.folders.length);
        if (IS_IMAP) {
          browser.test.assertEq("Inbox", account.folders[0].name);
          browser.test.assertEq("Trash", account.folders[1].name);
        } else {
          browser.test.assertEq("Trash", account.folders[0].name);
          browser.test.assertEq("Outbox", account.folders[1].name);
        }
        browser.test.assertEq("folder1", account.folders[2].name);
        browser.test.assertEq("unused", account.folders[3].name);

        const folder2 = await browser.folders.create(folder1.id, "folder+2");
        browser.test.assertEq(accountId, folder2.accountId);
        browser.test.assertEq("folder+2", folder2.name);
        browser.test.assertEq("/folder1/folder+2", folder2.path);

        account = await browser.accounts.get(accountId);
        browser.test.assertEq(4, account.folders.length);
        browser.test.assertEq(1, account.folders[2].subFolders.length);
        browser.test.assertEq(
          "/folder1/folder+2",
          account.folders[2].subFolders[0].path
        );

        // Test reject on creating already existing folder.
        await browser.test.assertRejects(
          browser.folders.create(folder1.id, "folder+2"),
          `folders.create() failed, because folder+2 already exists in /folder1`,
          "browser.folders.create threw exception"
        );

        // Test rename.

        {
          const onRenamedPromise = window.waitForEvent("folders.onRenamed");
          const folder3 = await browser.folders.rename(folder2.id, "folder3");
          const [originalFolder, renamedFolder] = await onRenamedPromise;
          // Test the original folder.
          browser.test.assertEq(accountId, originalFolder.accountId);
          browser.test.assertEq("folder+2", originalFolder.name);
          browser.test.assertEq("/folder1/folder+2", originalFolder.path);
          // Test the renamed folder.
          for (const folder of [folder3, renamedFolder]) {
            browser.test.assertEq(accountId, folder.accountId);
            browser.test.assertEq("folder3", folder.name);
            browser.test.assertEq("/folder1/folder3", folder.path);
          }

          account = await browser.accounts.get(accountId);
          browser.test.assertEq(4, account.folders.length);
          browser.test.assertEq(1, account.folders[2].subFolders.length);
          browser.test.assertEq(
            "/folder1/folder3",
            account.folders[2].subFolders[0].path
          );

          // Test reject on renaming absolute root.
          await browser.test.assertRejects(
            browser.folders.rename(rootFolder.id, "UhhOh"),
            `folders.rename() failed, because it cannot rename the root of the account`,
            "browser.folders.rename threw exception"
          );

          // Test reject on renaming to existing folder.
          await browser.test.assertRejects(
            browser.folders.rename(renamedFolder.id, "folder3"),
            `folders.rename() failed, because folder3 already exists in /folder1`,
            "browser.folders.rename threw exception"
          );
        }

        // Test delete (and onMoved).

        {
          // The delete request will trigger an onDelete event for IMAP and an
          // onMoved event for local folders.
          const deletePromise = window.waitForEvent(
            `folders.${IS_IMAP ? "onDeleted" : "onMoved"}`
          );
          const [folder3] = await browser.folders.query({
            folderId: folder1.id,
            name: "folder3",
          });
          await browser.folders.delete(folder3.id);
          // The onMoved event returns the original/deleted and the new folder.
          // The onDeleted event returns just the original/deleted folder.
          const [originalFolder, folderMovedToTrash] = await deletePromise;

          // Test the originalFolder folder.
          browser.test.assertEq(accountId, originalFolder.accountId);
          browser.test.assertEq("folder3", originalFolder.name);
          browser.test.assertEq("/folder1/folder3", originalFolder.path);

          // Check if it really is in trash folder.
          account = await browser.accounts.get(accountId);
          browser.test.assertEq(4, account.folders.length);
          const trashFolder = account.folders.find(f => f.name == "Trash");
          browser.test.assertTrue(trashFolder);
          browser.test.assertEq("/Trash", trashFolder.path);
          browser.test.assertEq(1, trashFolder.subFolders.length);
          browser.test.assertEq(
            "/Trash/folder3",
            trashFolder.subFolders[0].path
          );
          browser.test.assertEq("/folder1", account.folders[2].path);

          if (!IS_IMAP) {
            // For non IMAP folders, the delete request has triggered an onMoved
            // event, check if that has reported moving the folder to trash.
            browser.test.assertEq(accountId, folderMovedToTrash.accountId);
            browser.test.assertEq("folder3", folderMovedToTrash.name);
            browser.test.assertEq("/Trash/folder3", folderMovedToTrash.path);

            // Delete the folder from trash.
            const onDeletedPromise = window.waitForEvent("folders.onDeleted");
            await browser.folders.delete(folderMovedToTrash.id);
            const [deletedFolder] = await onDeletedPromise;
            browser.test.assertEq(accountId, deletedFolder.accountId);
            browser.test.assertEq("folder3", deletedFolder.name);
            browser.test.assertEq("/Trash/folder3", deletedFolder.path);
            // Check if the folder is gone.
            const trashSubfolders = await browser.folders.getSubFolders(
              trashFolder.id,
              false
            );
            browser.test.assertEq(
              0,
              trashSubfolders.length,
              "Folder has been deleted from trash."
            );
          } else {
            // The IMAP test server signals success for the delete request, but
            // keeps the folder. Testing for this broken behavior to get notified
            // via test fails, if this behaviour changes.
            const [folder3InTrash] = await browser.folders.query({
              folderId: trashFolder.id,
              name: "folder3",
            });
            await browser.folders.delete(folder3InTrash.id);
            const trashSubfolders = await browser.folders.getSubFolders(
              trashFolder.id,
              false
            );
            browser.test.assertEq(
              "/Trash/folder3",
              trashSubfolders[0].path,
              "IMAP test server cannot delete from trash, the folder is still there."
            );
          }

          // Test reject on deleting non-existing folder.
          await browser.test.assertRejects(
            browser.folders.delete(`${accountId}://missing`),
            `Folder not found: /missing`,
            "browser.folders.delete threw exception"
          );

          account = await browser.accounts.get(accountId);
          browser.test.assertEq(4, account.folders.length);
          browser.test.assertEq("/folder1", account.folders[2].path);
        }

        // Test move.

        {
          const folder4 = await browser.folders.create(folder1.id, "folder4");
          const onMovedPromise = window.waitForEvent("folders.onMoved");
          const folder4_moved = await browser.folders.move(folder4.id, account);
          const [originalFolder, movedFolder] = await onMovedPromise;
          // Test the original folder.
          browser.test.assertEq(accountId, originalFolder.accountId);
          browser.test.assertEq("folder4", originalFolder.name);
          browser.test.assertEq("/folder1/folder4", originalFolder.path);
          // Test the moved folder.
          for (const folder of [folder4_moved, movedFolder]) {
            browser.test.assertEq(accountId, folder.accountId);
            browser.test.assertEq("folder4", folder.name);
            browser.test.assertEq("/folder4", folder.path);
          }

          account = await browser.accounts.get(accountId);
          browser.test.assertEq(5, account.folders.length);
          browser.test.assertEq("/folder4", account.folders[3].path);

          // Test reject on moving to already existing folder.
          await browser.test.assertRejects(
            browser.folders.move(folder4_moved.id, account),
            `folders.move() failed, because folder4 already exists in /`,
            "browser.folders.move threw exception"
          );
        }

        // Test copy.

        {
          const onCopiedPromise = window.waitForEvent("folders.onCopied");
          // FIXME: Expose account root folder to properly query for folder4.
          const [folder4] = await browser.folders.query({ name: "folder4" });
          const folder4_copied = await browser.folders.copy(
            folder4.id,
            folder1.id
          );
          const [originalFolder, copiedFolder] = await onCopiedPromise;
          // Test the original folder.
          browser.test.assertEq(accountId, originalFolder.accountId);
          browser.test.assertEq("folder4", originalFolder.name);
          browser.test.assertEq("/folder4", originalFolder.path);
          // Test the copied folder.
          for (const folder of [folder4_copied, copiedFolder]) {
            browser.test.assertEq(accountId, folder.accountId);
            browser.test.assertEq("folder4", folder.name);
            browser.test.assertEq("/folder1/folder4", folder.path);
          }

          account = await browser.accounts.get(accountId);
          browser.test.assertEq(5, account.folders.length);
          browser.test.assertEq(1, account.folders[2].subFolders.length);
          browser.test.assertEq("/folder4", account.folders[3].path);
          browser.test.assertEq(
            "/folder1/folder4",
            account.folders[2].subFolders[0].path
          );

          // Test reject on copy to already existing folder.
          await browser.test.assertRejects(
            browser.folders.copy(folder4_copied.id, folder1.id),
            `folders.copy() failed, because folder4 already exists in /folder1`,
            "browser.folders.copy threw exception"
          );
        }

        browser.test.notifyPass("finished");
      },
      "utils.js": await getUtilsJS(),
    };
    const extension = ExtensionTestUtils.loadExtension({
      files,
      manifest: {
        manifest_version: 3,
        background: { scripts: ["utils.js", "background.js"] },
        permissions: ["accountsRead", "accountsFolders", "messagesDelete"],
      },
    });

    const account = createAccount();
    // Not all folders appear immediately on IMAP. Creating a new one causes them to appear.
    await createSubfolder(account.incomingServer.rootFolder, "unused");

    // We should now have three folders. For IMAP accounts they are Inbox, Trash,
    // and unused. Otherwise they are Trash, Unsent Messages and unused.

    await extension.startup();
    extension.sendMessage(account.key, IS_IMAP);
    await extension.awaitFinish("finished");
    await extension.unload();
  }
);

// This is a simplified version of a similar MV2 test in test_ext_folders.js
add_task(async function test_FolderInfo_FolderCapabilities_and_favorite() {
  const files = {
    "background.js": async () => {
      const [accountId, startTime] = await window.waitForMessage();

      async function queryCheck(queryInfo, expected) {
        const found = await browser.folders.query(queryInfo);
        window.assertDeepEqual(
          expected,
          found.map(f => f.name),
          `browser.folders.query(${JSON.stringify(
            queryInfo
          )}) should return the correct folders`
        );
      }

      const account = await browser.accounts.get(accountId);
      // FIXME: Expose account root folder.
      const rootFolder = { id: `${accountId}://`, accountId, path: "/" };

      const folders = await browser.folders.getSubFolders(account, false);
      const InfoTestFolder = folders.find(f => f.name == "InfoTest");

      // Verify initial state of the InfoTestFolder.
      {
        window.assertDeepEqual(
          {
            id: `${InfoTestFolder.accountId}:/${InfoTestFolder.path}`,
            specialUse: [],
            favorite: false,
          },
          InfoTestFolder,
          "Returned MailFolder should be correct."
        );

        const info = await browser.folders.getFolderInfo(InfoTestFolder.id);
        window.assertDeepEqual(
          {
            totalMessageCount: 12,
            unreadMessageCount: 12,
            newMessageCount: 12,
          },
          info,
          "Returned MailFolderInfo should be correct."
        );

        const capabilities = await browser.folders.getFolderCapabilities(
          InfoTestFolder.id
        );
        window.assertDeepEqual(
          {
            canAddMessages: account.type != "nntp",
            canAddSubfolders: account.type != "nntp",
            canBeDeleted: account.type != "nntp",
            canBeRenamed: account.type != "nntp",
            canDeleteMessages: true,
          },
          capabilities
        );

        // Verify lastUsed.
        const lastUsedSeconds = Math.floor(info.lastUsed.getTime() / 1000);
        const startTimeSeconds = Math.floor(startTime.getTime() / 1000);
        browser.test.assertTrue(
          lastUsedSeconds >= startTimeSeconds,
          `Should be correct: MailFolder.lastUsed (${lastUsedSeconds}) >= startTime (${startTimeSeconds})`
        );
      }

      // Clear new messages and check FolderInfo and onFolderInfoChanged event.
      {
        const onFolderInfoChangedPromise = window.waitForEvent(
          "folders.onFolderInfoChanged"
        );
        await window.sendMessage("clearNewMessages");
        const [mailFolder, mailFolderInfo] = await onFolderInfoChangedPromise;
        window.assertDeepEqual(
          {
            newMessageCount: 0,
          },
          mailFolderInfo
        );
        browser.test.assertEq(InfoTestFolder.path, mailFolder.path);

        const info = await browser.folders.getFolderInfo(InfoTestFolder.id);
        window.assertDeepEqual(
          {
            totalMessageCount: 12,
            unreadMessageCount: 12,
            newMessageCount: 0,
          },
          info
        );
      }

      // Favorite before the flip.
      await queryCheck({ folderId: rootFolder.id, favorite: true }, []);
      // Unread messages before marking folder as read.
      await queryCheck({ folderId: rootFolder.id, hasUnreadMessages: true }, [
        "InfoTest",
        "OtherTest",
      ]);

      // Flip favorite to true and mark all messages as read. Check FolderInfo
      // and onFolderInfoChanged event.
      {
        const onFolderInfoChangedPromise = window.waitForEvent(
          "folders.onFolderInfoChanged"
        );
        const onUpdatedPromise = window.waitForEvent("folders.onUpdated");
        await browser.folders.update(InfoTestFolder.id, {
          favorite: true,
        });
        await browser.folders.markAsRead(InfoTestFolder.id);

        const [originalFolder, updatedFolder] = await onUpdatedPromise;
        browser.test.assertEq(false, originalFolder.favorite);
        browser.test.assertEq(true, updatedFolder.favorite);
        browser.test.assertEq(InfoTestFolder.path, originalFolder.path);

        const [mailFolder, mailFolderInfo] = await onFolderInfoChangedPromise;
        window.assertDeepEqual(
          {
            unreadMessageCount: 0,
          },
          mailFolderInfo
        );
        browser.test.assertEq(InfoTestFolder.path, mailFolder.path);

        const info = await browser.folders.getFolderInfo(InfoTestFolder.id);
        window.assertDeepEqual(
          {
            totalMessageCount: 12,
            unreadMessageCount: 0,
            newMessageCount: 0,
          },
          info
        );
      }

      // Favorite after the flip.
      await queryCheck({ folderId: rootFolder.id, favorite: true }, [
        "InfoTest",
      ]);
      // Unread messages before marking folder as read.
      await queryCheck({ folderId: rootFolder.id, hasUnreadMessages: true }, [
        "OtherTest",
      ]);

      // Test flipping favorite back to false.
      {
        const onUpdatedPromise = window.waitForEvent("folders.onUpdated");
        await browser.folders.update(InfoTestFolder.id, { favorite: false });
        const [originalFolder, updatedFolder] = await onUpdatedPromise;
        browser.test.assertEq(true, originalFolder.favorite);
        browser.test.assertEq(false, updatedFolder.favorite);
        browser.test.assertEq(InfoTestFolder.path, originalFolder.path);
      }

      // Favorite after the second flip.
      await queryCheck({ folderId: rootFolder.id, favorite: true }, []);

      // Test setting some messages back to unread.
      {
        const onFolderInfoChangedPromise = window.waitForEvent(
          "folders.onFolderInfoChanged"
        );
        await window.sendMessage("markSomeAsUnread", 5);
        const [mailFolder, mailFolderInfo] = await onFolderInfoChangedPromise;
        window.assertDeepEqual({ unreadMessageCount: 5 }, mailFolderInfo);
        browser.test.assertEq(InfoTestFolder.path, mailFolder.path);
      }

      browser.test.notifyPass("finished");
    },
    "utils.js": await getUtilsJS(),
  };
  const extension = ExtensionTestUtils.loadExtension({
    files,
    manifest: {
      manifest_version: 3,
      background: { scripts: ["utils.js", "background.js"] },
      permissions: ["accountsRead", "accountsFolders", "messagesDelete"],
    },
  });

  const startTime = new Date();
  const account = createAccount();
  // Not all folders appear immediately on IMAP. Creating a new one causes them
  // to appear.
  const InfoTestFolder = await createSubfolder(
    account.incomingServer.rootFolder,
    "InfoTest"
  );
  await createMessages(InfoTestFolder, 12);

  const OtherTestFolder = await createSubfolder(
    account.incomingServer.rootFolder,
    "OtherTest"
  );
  await createMessages(OtherTestFolder, 1);

  extension.onMessage("markSomeAsUnread", count => {
    const messages = InfoTestFolder.messages;
    while (messages.hasMoreElements() && count > 0) {
      const msg = messages.getNext();
      msg.markRead(false);
      count--;
    }
    extension.sendMessage();
  });

  extension.onMessage("clearNewMessages", count => {
    InfoTestFolder.clearNewMessages();
    extension.sendMessage();
  });

  extension.onMessage("setAsDraft", () => {
    const trash = account.incomingServer.rootFolder.subFolders.find(
      f => f.prettyName == "Trash"
    );
    trash.setFlag(Ci.nsMsgFolderFlags.Drafts);
    extension.sendMessage();
  });

  // Set max_recent to 1 to be able to test the difference between mostRecent
  // and recent.
  Services.prefs.setIntPref("mail.folder_widget.max_recent", 1);

  await extension.startup();
  extension.sendMessage(account.key, startTime);
  await extension.awaitFinish("finished");
  await extension.unload();

  Services.prefs.clearUserPref("mail.folder_widget.max_recent");
});

add_task(
  {
    // NNTP does not have special folders.
    skip_if: () => IS_NNTP,
  },
  async function test_folder_get_update_onUpdated() {
    const files = {
      "background.js": async () => {
        const [accountId] = await window.waitForMessage();

        const account = await browser.accounts.get(accountId);
        browser.test.assertEq(
          3,
          account.folders.length,
          "Should find the correct number of folders"
        );
        const trash = account.folders.find(f => f.specialUse.includes("trash"));
        browser.test.assertTrue(
          trash,
          "Should find a folder which is used as trash"
        );
        delete trash.subFolders;

        const trashViaGetter = await browser.folders.get(trash.id);
        window.assertDeepEqual(
          trash,
          trashViaGetter,
          "Should find the correct trash folder"
        );

        const folderUpdatedPromise = new Promise(resolve => {
          const listener = (oldFolder, newFolder) => {
            browser.folders.onUpdated.removeListener(listener);
            resolve({ oldFolder, newFolder });
          };
          browser.folders.onUpdated.addListener(listener);
        });

        await window.sendMessage("setAsDraft");
        const folderUpdatedEvent = await folderUpdatedPromise;

        // Prepare expected event folder value.
        trash.specialUse = ["drafts", "trash"];

        window.assertDeepEqual(
          {
            oldFolder: { specialUse: ["trash"] },
            newFolder: trash,
          },
          {
            oldFolder: { specialUse: folderUpdatedEvent.oldFolder.specialUse },
            newFolder: folderUpdatedEvent.newFolder,
          },
          "The values returned by the folders.onUpdated event should be correct."
        );

        browser.test.notifyPass("finished");
      },
      "utils.js": await getUtilsJS(),
    };
    const extension = ExtensionTestUtils.loadExtension({
      files,
      manifest: {
        manifest_version: 3,
        background: { scripts: ["utils.js", "background.js"] },
        permissions: ["accountsRead", "accountsFolders", "messagesDelete"],
      },
    });

    const account = createAccount();
    // Not all folders appear immediately on IMAP. Creating a new one causes them to appear.
    await createSubfolder(account.incomingServer.rootFolder, "unused");

    extension.onMessage("setAsDraft", () => {
      const trash = account.incomingServer.rootFolder.subFolders.find(
        f => f.prettyName == "Trash"
      );
      trash.setFlag(Ci.nsMsgFolderFlags.Drafts);
      extension.sendMessage();
    });

    // We should now have three folders. For IMAP accounts they are Inbox, Trash,
    // and unused. Otherwise they are Trash, Unsent Messages and unused.

    await extension.startup();
    extension.sendMessage(account.key, IS_IMAP);
    await extension.awaitFinish("finished");
    await extension.unload();
  }
);