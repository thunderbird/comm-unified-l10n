/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Test to ensure that, in case of GMail server, fetching of a message, which is
 * already present in offline store of some folder, from a folder doesn't make
 * us add it to the offline store twice(in this case, in general it can be any
 * number of times).
 *
 * Bug 721316
 *
 * See https://bugzilla.mozilla.org/show_bug.cgi?id=721316
 * for more info.
 *
 * Original Author: Atul Jangra<atuljangra66@gmail.com>
 */

var { PromiseTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/PromiseTestUtils.sys.mjs"
);

// Messages to load must have CRLF line endings, that is Windows style.

var gMessage1 = "bugmail10"; // message file used as the test message for Inbox and fooFolder.
var gXGmMsgid1 = "1278455344230334865";
var gXGmThrid1 = "1266894439832287888";
// We need to have different X-GM-LABELS for different folders. I am doing it here manually, but this issue will be tackled in Bug 781443.
var gXGmLabels11 = '( "\\\\Sent" foo bar)'; // for message in Inbox.
var gXGmLabels12 = '("\\\\Inbox" "\\\\Sent" bar)'; // for message in fooFolder.
var gMsgId1 = "200806061706.m56H6RWT004933@mrapp54.mozilla.org";

var gMessage2 = "bugmail11"; // message file used as the test message for fooFolder.
var gMsgId2 = "200804111417.m3BEHTk4030129@mrapp51.mozilla.org";
var gXGmMsgid2 = "1278455345230334555";
var gXGmThrid2 = "1266894639832287111";
var gXGmLabels2 = '("\\\\Sent")';

var fooBox;
var fooFolder;

var gImapInboxOfflineStoreSizeInitial;
var gImapInboxOfflineStoreSizeFinal;

var gFooOfflineStoreSizeInitial;
var gFooOfflineStoreSizeFinal;

add_setup(async function () {
  // We aren't interested in downloading messages automatically.
  Services.prefs.setBoolPref(
    "mail.server.server1.autosync_offline_stores",
    false
  );
  Services.prefs.setBoolPref("mail.server.server1.offline_download", true);
  Services.prefs.setBoolPref("mail.biff.alert.show_preview", false);

  setupIMAPPump("GMail");

  IMAPPump.mailbox.specialUseFlag = "\\Inbox";
  IMAPPump.mailbox.subscribed = true;

  // need all mail folder to identify this as gmail server.
  IMAPPump.daemon.createMailbox("[Gmail]", { flags: ["\\NoSelect"] });
  IMAPPump.daemon.createMailbox("[Gmail]/All Mail", {
    subscribed: true,
    specialUseFlag: "\\AllMail",
  });

  // Creating the mailbox "foo"
  IMAPPump.daemon.createMailbox("foo", { subscribed: true });
  fooBox = IMAPPump.daemon.getMailbox("foo");

  // Add message1 to inbox.
  const message = new ImapMessage(
    specForFileName(gMessage1),
    IMAPPump.mailbox.uidnext++,
    []
  );
  message.messageId = gMsgId1;
  message.xGmMsgid = gXGmMsgid1;
  message.xGmThrid = gXGmThrid1;
  message.xGmLabels = gXGmLabels11; // With labels excluding "//INBOX".
  IMAPPump.mailbox.addMessage(message);
  const listener = new PromiseTestUtils.PromiseUrlListener();
  IMAPPump.inbox.updateFolderWithListener(null, listener);
  await listener.promise;
});

add_task(async function streamMessageInbox() {
  // Stream message1 from inbox.
  const newMsgHdr = IMAPPump.inbox.msgDatabase.getMsgHdrForMessageID(gMsgId1);
  const msgURI = newMsgHdr.folder.getUriForMsg(newMsgHdr);
  const msgServ = MailServices.messageServiceFromURI(msgURI);
  const streamLister = new PromiseTestUtils.PromiseStreamListener();
  msgServ.streamMessage(msgURI, streamLister, null, null, false, "", false);
  await streamLister.promise;
  // Record initial Size of Inbox.
  gImapInboxOfflineStoreSizeInitial = IMAPPump.inbox.filePath.fileSize;
});

add_task(async function createAndUpdate() {
  const rootFolder = IMAPPump.incomingServer.rootFolder;
  fooFolder = rootFolder
    .getChildNamed("foo")
    .QueryInterface(Ci.nsIMsgImapMailFolder); // We have created the mailbox earlier.
  const listener = new PromiseTestUtils.PromiseUrlListener();
  fooFolder.updateFolderWithListener(null, listener);
  await listener.promise;
});

add_task(function addToFoo() {
  // Adding our test message.
  const message = new ImapMessage(
    specForFileName(gMessage1),
    fooBox.uidnext++,
    []
  );
  message.messageId = gMsgId1;
  message.xGmMsgid = gXGmMsgid1;
  message.xGmThrid = gXGmThrid1;
  message.xGmLabels = gXGmLabels12; // With labels excluding "foo".
  fooBox.addMessage(message);
  // Adding another message so that fooFolder behaves as LocalFolder while calculating it's size.
  const message1 = new ImapMessage(
    specForFileName(gMessage2),
    fooBox.uidnext++,
    []
  );
  message1.messageId = gMsgId2;
  message1.xGmMsgid = gXGmMsgid2;
  message1.xGmThrid = gXGmThrid2;
  message1.xGmLabels = gXGmLabels2;
  fooBox.addMessage(message1);
});

add_task(async function updateFoo() {
  const listener = new PromiseTestUtils.PromiseUrlListener();
  fooFolder.updateFolderWithListener(null, listener);
  await listener.promise;
});

add_task(async function streamMessageFoo() {
  // Stream message2 from fooFolder.
  const newMsgHdr = fooFolder.msgDatabase.getMsgHdrForMessageID(gMsgId2);
  const msgURI = newMsgHdr.folder.getUriForMsg(newMsgHdr);
  const msgServ = MailServices.messageServiceFromURI(msgURI);
  const streamListener = new PromiseTestUtils.PromiseStreamListener();
  msgServ.streamMessage(msgURI, streamListener, null, null, false, "", false);
  await streamListener.promise;
  gFooOfflineStoreSizeInitial = fooFolder.filePath.fileSize;
});

add_task(async function crossStreaming() {
  /**
   * Streaming message1 from fooFolder. message1 is present in
   * offline store of inbox. We now test that streaming the message1
   * from fooFolder does not make us add message1 to offline store of
   * fooFolder. We check this by comparing the sizes of inbox and fooFolder
   * before and after streaming.
   */
  const msg2 = fooFolder.msgDatabase.getMsgHdrForMessageID(gMsgId1);
  Assert.notStrictEqual(msg2, null);
  const msgURI = fooFolder.getUriForMsg(msg2);
  const msgServ = MailServices.messageServiceFromURI(msgURI);
  // pass true for aLocalOnly since message should be in offline store of Inbox.
  const streamListener = new PromiseTestUtils.PromiseStreamListener();
  msgServ.streamMessage(msgURI, streamListener, null, null, false, "", true);
  await streamListener.promise;
  gFooOfflineStoreSizeFinal = fooFolder.filePath.fileSize;
  gImapInboxOfflineStoreSizeFinal = IMAPPump.inbox.filePath.fileSize;
  Assert.equal(gFooOfflineStoreSizeFinal, gFooOfflineStoreSizeInitial);
  Assert.equal(
    gImapInboxOfflineStoreSizeFinal,
    gImapInboxOfflineStoreSizeInitial
  );
});

add_task(function endTest() {
  teardownIMAPPump();
});

/*
 * helper functions
 */

/**
 * Given a test file, return the file uri spec.
 */
function specForFileName(aFileName) {
  const file = do_get_file("../../../data/" + aFileName);
  const msgfileuri = Services.io.newFileURI(file).QueryInterface(Ci.nsIFileURL);
  return msgfileuri.spec;
}
