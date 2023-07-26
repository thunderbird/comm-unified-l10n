/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals messenger */

const { MessageGenerator } = ChromeUtils.import(
  "resource://testing-common/mailnews/MessageGenerator.jsm"
);

const tabmail = document.getElementById("tabmail");
const about3Pane = tabmail.currentAbout3Pane;
const { threadTree } = about3Pane;

add_setup(async function () {
  // Create an account for the test.
  MailServices.accounts.createLocalMailAccount();
  const account = MailServices.accounts.accounts[0];
  account.addIdentity(MailServices.accounts.createIdentity());

  // Remove test account on cleanup.
  registerCleanupFunction(() => {
    MailServices.accounts.removeAccount(account, false);
    // Clear the undo and redo stacks to avoid side-effects on
    // tests expecting them to start in a cleared state.
    messenger.transactionManager.clear();
  });

  // Create a folder for the account to store test messages.
  const rootFolder = account.incomingServer.rootFolder;
  rootFolder.createSubfolder("test-archive", null);
  const testFolder = rootFolder
    .getChildNamed("test-archive")
    .QueryInterface(Ci.nsIMsgLocalMailFolder);

  // Generate test messages.
  const generator = new MessageGenerator();
  testFolder.addMessageBatch(
    generator
      .makeMessages({ count: 2, msgsPerThread: 2 })
      .map(message => message.toMboxString())
  );

  // Use the test folder.
  about3Pane.displayFolder(testFolder.URI);
});

/**
 * Tests undoing after archiving a thread.
 */
add_task(async function testArchiveUndo() {
  let row = threadTree.getRowAtIndex(0);

  // Simulate a click on the row's subject line to select the row.
  const selectPromise = BrowserTestUtils.waitForEvent(threadTree, "select");
  EventUtils.synthesizeMouseAtCenter(
    row.querySelector(".thread-container .subject-line"),
    { clickCount: 1 },
    about3Pane
  );
  await selectPromise;

  // Make sure the thread is selected
  Assert.ok(
    row.classList.contains("selected"),
    "The thread row should be selected"
  );

  // Archive the message.
  EventUtils.synthesizeKey("a");

  // Make sure the thread was removed from the thread tree.
  await TestUtils.waitForCondition(
    () => threadTree.getRowAtIndex(0) === null,
    "The thread tree should not have any row"
  );

  // Undo the operation.
  EventUtils.synthesizeKey("z", { accelKey: true });

  // Make sure the thread makes it back to the thread tree.
  await TestUtils.waitForCondition(
    () => threadTree.getRowAtIndex(0) !== null,
    "The thread should have returned back from the archive"
  );
});
