/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);

let database, folders, messages;

async function installDB(dbName) {
  const profileDir = do_get_profile();
  const dbFile = do_get_file(`db/${dbName}`);
  dbFile.copyTo(profileDir, "panorama.sqlite");

  await loadExistingDB();
}

async function loadExistingDB() {
  // Register DatabaseCore as the message DB service with XPCOM.
  MailServices.accounts;

  database = Cc["@mozilla.org/mailnews/database-core;1"].getService(
    Ci.nsIDatabaseCore
  );
  folders = database.folders;
  messages = database.messages;
}

registerCleanupFunction(function () {
  folders = null;
  messages = null;
  database = null;

  // Make sure destructors run, to finalize statements even if the test fails.
  Cu.forceGC();
});

function drawTree(root, level = 0) {
  console.log("  ".repeat(level) + root.name);
  for (const child of root.children) {
    drawTree(child, level + 1);
  }
}

function checkRow(id, expected) {
  const stmt = database.connection.createStatement(
    "SELECT id, parent, ordinal, name, flags FROM folders WHERE id = :id"
  );
  stmt.params.id = id;
  stmt.executeStep();
  Assert.equal(stmt.row.id, expected.id, "row id");
  Assert.equal(stmt.row.parent, expected.parent, "row parent");
  Assert.equal(stmt.row.ordinal, expected.ordinal, "row ordinal");
  Assert.equal(stmt.row.name, expected.name, "row name");
  Assert.equal(stmt.row.flags, expected.flags, "row flags");
  stmt.reset();
  stmt.finalize();
}

function checkNoRow(id) {
  const stmt = database.connection.createStatement(
    "SELECT id, parent, ordinal, name, flags FROM folders WHERE id = :id"
  );
  stmt.params.id = id;
  Assert.ok(!stmt.executeStep(), `row ${id} should not exist`);
  stmt.reset();
  stmt.finalize();
}

function checkOrdinals(expected) {
  const stmt = database.connection.createStatement(
    "SELECT parent, ordinal FROM folders WHERE id=:id"
  );
  for (const [folder, parent, ordinal] of expected) {
    stmt.params.id = folder.id;
    stmt.executeStep();
    Assert.deepEqual(
      [stmt.row.parent, stmt.row.ordinal],
      [parent, ordinal],
      `parent and ordinal of ${folder.name}`
    );
    stmt.reset();
  }
  stmt.finalize();
}

/**
 * Add a new message to the database. See the other messages in db/messages.sql
 * for appropriate values.
 *
 * @param {object} message - Details of the new message to add.
 * @param {integer} [message.folderId=1]
 * @param {string} [message.messageId="messageId"]
 * @param {string} [message.date="2025-01-22"] - Any string which can be
 *   parsed by the Date constructor.
 * @param {string} [message.sender="sender"]
 * @param {string} [message.subject="subject"]
 * @param {integer} [message.flags=0]
 * @param {string} [message.tags=""]
 * @returns {integer} - The database ID of the new message.
 */
function addMessage({
  folderId = 1,
  messageId = "messageId",
  date = "2025-01-22",
  sender = "sender",
  subject = "subject",
  flags = 0,
  tags = "",
}) {
  return messages.addMessage(
    folderId,
    messageId,
    new Date(date).valueOf() * 1000,
    sender,
    subject,
    flags,
    tags
  );
}
