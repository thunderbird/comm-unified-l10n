/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * This file tests that a message saved as draft in an IMAP folder is correctly
 * marked as unread.
 */

var { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);
var { PromiseTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/PromiseTestUtils.sys.mjs"
);
var { setTimeout } = ChromeUtils.importESModule(
  "resource://gre/modules/Timer.sys.mjs"
);

var gDraftsFolder;

add_setup(function () {
  setupIMAPPump();
  Services.prefs.setBoolPref(
    "mail.server.default.autosync_offline_stores",
    false
  );
});

add_task(async function createDraftsFolder() {
  IMAPPump.incomingServer.rootFolder.createSubfolder("Drafts", null);
  await PromiseTestUtils.promiseFolderAdded("Drafts");
  gDraftsFolder = IMAPPump.incomingServer.rootFolder.getChildNamed("Drafts");
  Assert.ok(gDraftsFolder instanceof Ci.nsIMsgImapMailFolder);
  const listener = new PromiseTestUtils.PromiseUrlListener();
  gDraftsFolder.updateFolderWithListener(null, listener);
  await listener.promise;
});

add_task(async function saveDraft() {
  const msgCompose = Cc[
    "@mozilla.org/messengercompose/compose;1"
  ].createInstance(Ci.nsIMsgCompose);
  const fields = Cc[
    "@mozilla.org/messengercompose/composefields;1"
  ].createInstance(Ci.nsIMsgCompFields);
  fields.from = "Nobody <nobody@tinderbox.test>";

  const params = Cc[
    "@mozilla.org/messengercompose/composeparams;1"
  ].createInstance(Ci.nsIMsgComposeParams);
  params.composeFields = fields;
  msgCompose.initialize(params);

  // Set up the identity
  const identity = MailServices.accounts.createIdentity();
  identity.draftFolder = gDraftsFolder.URI;

  const progress = Cc["@mozilla.org/messenger/progress;1"].createInstance(
    Ci.nsIMsgProgress
  );
  const progressListener = new ProgressListener();
  progress.registerListener(progressListener);
  msgCompose.sendMsg(
    Ci.nsIMsgSend.nsMsgSaveAsDraft,
    identity,
    "",
    null,
    progress
  );
  await progressListener.promise;
  await new Promise(resolve => setTimeout(resolve, 1000));
});

add_task(async function updateDrafts() {
  const listener = new PromiseTestUtils.PromiseUrlListener();
  gDraftsFolder.updateFolderWithListener(null, listener);
  await listener.promise;
});

add_task(function checkResult() {
  Assert.equal(gDraftsFolder.getTotalMessages(false), 1);
  Assert.equal(gDraftsFolder.getNumUnread(false), 1);
});

add_task(function endTest() {
  teardownIMAPPump();
});

function ProgressListener() {
  this._promise = new Promise(resolve => {
    this._resolve = resolve;
  });
}

ProgressListener.prototype = {
  onStateChange(aWebProgress, aRequest, aStateFlags) {
    if (aStateFlags & Ci.nsIWebProgressListener.STATE_STOP) {
      this._resolve();
    }
  },

  onProgressChange() {},
  onLocationChange() {},
  onStatusChange() {},
  onSecurityChange() {},
  onContentBlockingEvent() {},

  QueryInterface: ChromeUtils.generateQI([
    "nsIWebProgressListener",
    "nsISupportsWeakReference",
  ]),
  get promise() {
    return this._promise;
  },
};
