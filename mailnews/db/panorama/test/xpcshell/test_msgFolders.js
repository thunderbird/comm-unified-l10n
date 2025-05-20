/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Tests that getFolderForMsgFolder and getMsgFolderForFolder work.
 */

add_task(async function testMsgFolders() {
  do_get_profile();
  await loadExistingDB();

  const account = MailServices.accounts.createLocalMailAccount();
  Assert.equal(account.incomingServer.key, "server1");

  const rootMsgFolder = account.incomingServer.rootFolder;
  rootMsgFolder.QueryInterface(Ci.nsIMsgLocalMailFolder);
  const alphaMsgFolder = rootMsgFolder.createLocalSubfolder("alpha");
  const bravoMsgFolder = rootMsgFolder.createLocalSubfolder("bravo");
  // These folders are created automagically at start-up.
  const outboxMsgFolder = rootMsgFolder.getFolderWithFlags(
    Ci.nsMsgFolderFlags.Queue
  );
  Assert.equal(outboxMsgFolder.name, "Unsent Messages");
  const trashMsgFolder = rootMsgFolder.getFolderWithFlags(
    Ci.nsMsgFolderFlags.Trash
  );
  Assert.equal(trashMsgFolder.name, "Trash");
  Assert.deepEqual(
    rootMsgFolder.subFolders.toSorted((a, b) => (a.name < b.name ? -1 : 1)),
    [trashMsgFolder, outboxMsgFolder, alphaMsgFolder, bravoMsgFolder]
  );

  const rootDBFolder = folders.getFolderByPath("server1");
  const alphaDBFolder = folders.getFolderByPath("server1/alpha");
  const bravoDBFolder = folders.getFolderByPath("server1/bravo");
  const outboxDBFolder = folders.getFolderByPath("server1/Unsent Messages");
  const trashDBFolder = folders.getFolderByPath("server1/Trash");
  Assert.deepEqual(rootDBFolder.children, [
    trashDBFolder,
    outboxDBFolder,
    alphaDBFolder,
    bravoDBFolder,
  ]);

  Assert.equal(folders.getFolderForMsgFolder(rootMsgFolder), rootDBFolder);
  Assert.equal(folders.getFolderForMsgFolder(alphaMsgFolder), alphaDBFolder);
  Assert.equal(folders.getFolderForMsgFolder(bravoMsgFolder), bravoDBFolder);
  Assert.equal(folders.getFolderForMsgFolder(outboxMsgFolder), outboxDBFolder);
  Assert.equal(folders.getFolderForMsgFolder(trashMsgFolder), trashDBFolder);

  Assert.equal(folders.getMsgFolderForFolder(rootDBFolder), rootMsgFolder);
  Assert.equal(folders.getMsgFolderForFolder(alphaDBFolder), alphaMsgFolder);
  Assert.equal(folders.getMsgFolderForFolder(bravoDBFolder), bravoMsgFolder);
  Assert.equal(folders.getMsgFolderForFolder(outboxDBFolder), outboxMsgFolder);
  Assert.equal(folders.getMsgFolderForFolder(trashDBFolder), trashMsgFolder);
});
