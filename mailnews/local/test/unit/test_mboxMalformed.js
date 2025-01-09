/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Tests to check our mbox reading is forgiving enough to be tolerant of
 * malformed mboxes in unambiguous cases.
 */

const { PromiseTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/PromiseTestUtils.sys.mjs"
);
const { MessageGenerator } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/MessageGenerator.sys.mjs"
);

// Force mbox mailstore.
Services.prefs.setCharPref(
  "mail.serverDefaultStoreContractID",
  "@mozilla.org/msgstore/berkeleystore;1"
);

/**
 * Test that an mbox with unescaped (but unambiguous) messages can be parsed.
 */
add_task(async function test_unescapedMbox() {
  const messages = [
    // 0
    "To: bob@invalid\r\n" +
      "From: alice@invalid\r\n" +
      "Subject: Hello\r\n" +
      "\r\n" +
      "Hello, Bob! Haven't heard\r\n" +
      "\r\n" +
      "From you in a while...\r\n", // Ambiguous without escaping!

    // 1
    "To: alice@invalid\r\n" +
      "From: bob@invalid\r\n" +
      "Subject: Re: Hello\r\n" +
      "\r\n" +
      "Hi there Alice! All good here.\r\n",
  ];

  // TODO: Would be much better to just instantiate raw msgStore for this test,
  // but currently it's too tightly coupled to folder.
  localAccountUtils.loadLocalMailAccount();
  const inbox = localAccountUtils.inboxFolder;

  // Install mbox with non-escaped messages.
  const mbox = messages.map(m => `From \r\n${m}\r\n`).join("");
  await IOUtils.writeUTF8(inbox.filePath.path, mbox);

  // Perform an async scan on the store, and make sure we get back all
  // the messages unchanged.
  const listener = new PromiseTestUtils.PromiseStoreScanListener();
  inbox.msgStore.asyncScan(inbox, listener);
  await listener.promise;

  // NOTE: asyncScan doesn't guarantee ordering.
  Assert.deepEqual(listener.messages.toSorted(), messages.toSorted());

  // Clear up.
  localAccountUtils.clearAll();
});

/**
 * Test that reading from bad offset fails.
 */
add_task(async function test_badStoreTokens() {
  Services.fog.testResetFOG();

  localAccountUtils.loadLocalMailAccount();
  const inbox = localAccountUtils.inboxFolder;

  // Add some messages to inbox.
  const generator = new MessageGenerator();
  inbox.addMessageBatch(
    generator.makeMessages({ count: 10 }).map(m => m.toMessageString())
  );

  // Corrupt the storeTokens in a couple of different ways.
  let even = true;
  for (const msg of inbox.messages) {
    if (even) {
      const offset = Number(msg.storeToken) + 3;
      msg.storeToken = offset.toString();
    } else {
      msg.storeToken = "12345678"; // Past end of mbox file.
    }
    even = !even;
  }

  // Check that message reads fail.
  const NS_MSG_ERROR_MBOX_MALFORMED = 0x80550024;
  for (const msg of inbox.messages) {
    const streamListener = new PromiseTestUtils.PromiseStreamListener();
    const uri = inbox.getUriForMsg(msg);
    const service = MailServices.messageServiceFromURI(uri);

    try {
      service.streamMessage(uri, streamListener, null, null, false, "", true);
      await streamListener.promise;
    } catch (e) {
      Assert.equal(
        e,
        NS_MSG_ERROR_MBOX_MALFORMED,
        "Bad read causes NS_MSG_ERROR_MBOX_MALFORMED"
      );
    }
  }

  // Make sure telemetry counted them

  Assert.equal(
    Glean.mail.mboxReadErrors.missing_from.testGetValue(),
    inbox.getTotalMessages(false),
    "Mbox missing-from-line failures should be counted in Glean"
  );

  // Clear up.
  localAccountUtils.clearAll();
});

/**
 * Test that mbox reading that goes too far beyond the database .messageSize
 * causes unexpected-size errors in the mbox code.
 */
add_task(async function test_badMessageSizes() {
  Services.fog.testResetFOG();

  localAccountUtils.loadLocalMailAccount();
  const inbox = localAccountUtils.inboxFolder;

  // Add some messages to inbox.
  // The size sanity check is approximate. There's a threshold of 10% beyond
  // expected size, and a minimum of 512 bytes.
  // So make sure our test messages are way larger than 512 bytes.
  const msgText = "I will not waste chars.\r\n".repeat(500);
  const generator = new MessageGenerator();
  inbox.addMessageBatch(
    generator
      .makeMessages({
        count: 10,
        body: { body: msgText },
      })
      .map(m => m.toMessageString())
  );

  // Sabotage .messageSize to simulate corrupted message.
  for (const msg of inbox.messages) {
    msg.messageSize = msg.messageSize / 2;
  }

  // Check that the size check triggers and the read fails.
  const NS_MSG_ERROR_UNEXPECTED_SIZE = 0x80550023;
  for (const msg of inbox.messages) {
    const streamListener = new PromiseTestUtils.PromiseStreamListener();
    const uri = inbox.getUriForMsg(msg);
    const service = MailServices.messageServiceFromURI(uri);

    try {
      service.streamMessage(uri, streamListener, null, null, false, "", true);
      await streamListener.promise;
    } catch (e) {
      Assert.equal(
        e,
        NS_MSG_ERROR_UNEXPECTED_SIZE,
        "Messages that don't end at expected place should cause NS_MSG_ERROR_UNEXPECTED_SIZE"
      );
    }
  }

  // Make sure telemetry counted them.
  Assert.equal(
    Glean.mail.mboxReadErrors.unexpected_size.testGetValue(),
    inbox.getTotalMessages(false),
    "Mbox size-overrun failures should be counted in Glean"
  );

  // Clear up.
  localAccountUtils.clearAll();
});

/**
 * Test handling of mbox file with missing final EOL.
 */
add_task(async function test_writeWithmissingEOL() {
  Services.fog.testResetFOG();
  localAccountUtils.loadLocalMailAccount();
  const inbox = localAccountUtils.inboxFolder;
  const generator = new MessageGenerator();

  // Add a batch of messages to inbox.
  const batch1 = generator.makeMessages({ count: 10 });
  inbox.addMessageBatch(batch1.map(synMsg => synMsg.toMessageString()));

  // Simulate a truncated mbox with no trailing EOL.
  // Need to write directly to the mbox file, which means this one won't
  // appear in the DB. But that's OK. We'll we'll be throwing away the DB
  // and rebuilding it from the mbox anyway.
  const badMsg =
    `Message-Id: WIBBLE\r\n` +
    `From: alice@example.com\r\n` +
    `To: bob@example.com\r\n` +
    `Subject: Hi Bob\r\n` +
    `\r\n` +
    `This line is incomple`; // NOTE: No EOL!
  await IOUtils.writeUTF8(inbox.filePath.path, "From \r\n" + badMsg, {
    mode: "append",
  });

  // Add another batch of messages to inbox.
  // The code should spot the missing EOL, and add one before writing
  // the first of this batch.
  const batch2 = generator.makeMessages({ count: 10 });
  inbox.addMessageBatch(batch2.map(synMsg => synMsg.toMessageString()));

  // Make sure telemetry picked up that the EOL was missing.
  Assert.equal(
    Glean.mail.mboxWriteErrors.missing_eol.testGetValue(),
    1,
    "Mbox no-final-EOL errors should be reported via telemetry"
  );

  // Kill the database (.msf file) and rebuild it from the mbox.
  // With no-final-EOL mitigation, we'll have all the messages we wrote.
  // Without the mitigation, two of the messages will have been merged
  // into one.
  // See nsMsgBrkMBoxStore::InternalGetNewMsgOutputStream() - the EOL check
  // and mitigation was added in bug 1924402.
  inbox.msgDatabase.forceClosed();
  inbox.msgDatabase = null;
  await IOUtils.remove(inbox.summaryFile.path);
  const urlListener = new PromiseTestUtils.PromiseUrlListener();
  inbox.parseFolder(null, urlListener);
  await urlListener.promise;

  // Make sure we've got all the messages (look them up by MessageId).

  const expected = [
    ...batch1.map(synMsg => synMsg.messageId),
    "WIBBLE",
    ...batch2.map(synMsg => synMsg.messageId),
  ].toSorted();

  const got = [...inbox.msgDatabase.enumerateMessages()]
    .map(msg => msg.messageId)
    .toSorted();
  Assert.deepEqual(got, expected, "All messages should be in DB");

  Assert.equal(
    inbox.getTotalMessages(false),
    expected.length,
    "Shouldn't have any unexpected extra messages"
  );

  // Clear up.
  localAccountUtils.clearAll();
});
