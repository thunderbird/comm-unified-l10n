/**
 * Authentication tests for SMTP.
 */

/* import-globals-from ../../../test/resources/alertTestUtils.js */
/* import-globals-from ../../../test/resources/passwordStorage.js */
load("../../../resources/alertTestUtils.js");
load("../../../resources/passwordStorage.js");

var { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);
const { PromiseTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/PromiseTestUtils.sys.mjs"
);

var gNewPassword = null;

// for alertTestUtils.js
function confirmExPS() {
  // Just return 2 which will is pressing button 2 - enter a new password.
  return 2;
}

function promptPasswordPS(aParent, aDialogTitle, aText, aPassword) {
  aPassword.value = gNewPassword;
  return true;
}

var server;

var kIdentityMail = "identity@foo.invalid";
var kSender = "from@foo.invalid";
var kTo = "to@foo.invalid";
var kUsername = "test.smtp@fakeserver";
// kPasswordSaved is the one defined in signons-smtp.json, the other one
// is intentionally wrong.
var kPasswordWrong = "wrong";
var kPasswordSaved = "smtptest";

add_task(async function () {
  registerAlertTestUtils();

  function createHandler(d) {
    var handler = new SMTP_RFC2821_handler(d);
    // Username needs to match the login information stored in the signons json
    // file.
    handler.kUsername = kUsername;
    handler.kPassword = kPasswordWrong;
    handler.kAuthRequired = true;
    handler.kAuthSchemes = ["PLAIN", "LOGIN"]; // make match expected transaction below
    return handler;
  }

  server = setupServerDaemon(createHandler);
  server.setDebugLevel(nsMailServer.debugAll);

  // Prepare files for passwords (generated by a script in bug 1018624).
  await setupForPassword("signons-smtp.json");

  // Test file
  var testFile = do_get_file("data/message1.eml");

  // Ensure we have at least one mail account
  localAccountUtils.loadLocalMailAccount();

  // Handle the server in a try/catch/finally loop so that we always will stop
  // the server if something fails.
  try {
    // Start the fake SMTP server. The server's socket type defaults to
    // Ci.nsMsgSocketType.plain, so no need to set it.
    server.start();
    var smtpServer = getBasicSmtpServer(server.port);
    var identity = getSmtpIdentity(kIdentityMail, smtpServer);

    // This time with auth
    test = "Auth sendMailMessage";

    smtpServer.authMethod = Ci.nsMsgAuthMethod.passwordCleartext;
    smtpServer.username = kUsername;

    const messageId = Cc["@mozilla.org/messengercompose/computils;1"]
      .createInstance(Ci.nsIMsgCompUtils)
      .msgGenerateMessageId(identity, null);

    const requestObserver = new PromiseTestUtils.PromiseRequestObserver();
    smtpServer.sendMailMessage(
      testFile,
      MailServices.headerParser.parseEncodedHeaderW(kTo),
      [],
      identity,
      kSender,
      null,
      null,
      false,
      messageId,
      requestObserver
    );

    // Set the new password for when we get a prompt
    gNewPassword = kPasswordWrong;

    await requestObserver.promise;

    var transaction = server.playTransaction();
    do_check_transaction(transaction, [
      "EHLO test",
      "AUTH PLAIN " + AuthPLAIN.encodeLine(kUsername, kPasswordSaved),
      "AUTH LOGIN",
      "AUTH PLAIN " + AuthPLAIN.encodeLine(kUsername, kPasswordWrong),
      "MAIL FROM:<" + kSender + "> BODY=8BITMIME SIZE=159",
      "RCPT TO:<" + kTo + ">",
      "DATA",
    ]);
  } catch (e) {
    do_throw(e);
  } finally {
    server.stop();

    var thread = Services.tm.currentThread;
    while (thread.hasPendingEvents()) {
      thread.processNextEvent(true);
    }
  }
});
