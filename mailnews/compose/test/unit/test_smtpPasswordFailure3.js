/**
 * This test checks to see if the smtp password failure is handled correctly
 * when the server drops the connection on an authentication error.
 * The steps are:
 *   - Have an invalid password in the password database.
 *   - Re-initiate connection, this time select enter new password, check that
 *     we get a new password prompt and can enter the password.
 *
 */

var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { MailServices } = ChromeUtils.import(
  "resource:///modules/MailServices.jsm"
);

/* import-globals-from ../../../test/resources/alertTestUtils.js */
/* import-globals-from ../../../test/resources/passwordStorage.js */
load("../../../resources/alertTestUtils.js");
load("../../../resources/passwordStorage.js");

var server;
var attempt = 0;

var kIdentityMail = "identity@foo.invalid";
var kSender = "from@foo.invalid";
var kTo = "to@foo.invalid";
var kUsername = "testsmtp";
// Password needs to match the login information stored in the signons json
// file.
var kValidPassword = "smtptest1"; // for alertTestUtils.js

/* exported alert, confirmEx, promptPasswordPS */ function alert(
  aDialogText,
  aText
) {
  // The first few attempts may prompt about the password problem, the last
  // attempt shouldn't.
  Assert.ok(attempt < 4);

  // Log the fact we've got an alert, but we don't need to test anything here.
  dump("Alert Title: " + aDialogText + "\nAlert Text: " + aText + "\n");
}

function confirmEx(
  aDialogTitle,
  aText,
  aButtonFlags,
  aButton0Title,
  aButton1Title,
  aButton2Title,
  aCheckMsg,
  aCheckState
) {
  switch (++attempt) {
    // First attempt, retry.
    case 1:
      dump("\nAttempting Retry\n");
      return 0;
    // Second attempt, enter a new password.
    case 2:
      dump("\nEnter new password\n");
      return 2;
    default:
      do_throw("unexpected attempt number " + attempt);
      return 1;
  }
}

function promptPasswordPS(
  aParent,
  aDialogTitle,
  aText,
  aPassword,
  aCheckMsg,
  aCheckState
) {
  if (attempt == 2) {
    aPassword.value = kValidPassword;
    aCheckState.value = true;
    return true;
  }
  return false;
}

add_task(async function() {
  function createHandler(d) {
    var handler = new SMTP_RFC2821_handler(d);
    handler.dropOnAuthFailure = true;
    // Username needs to match the login information stored in the signons json
    // file.
    handler.kUsername = kUsername;
    handler.kPassword = kValidPassword;
    handler.kAuthRequired = true;
    handler.kAuthSchemes = ["PLAIN", "LOGIN"]; // make match expected transaction below
    return handler;
  }
  server = setupServerDaemon(createHandler);

  // Prepare files for passwords (generated by a script in bug 1018624).
  await setupForPassword("signons-mailnews1.8.json");

  registerAlertTestUtils();

  // Test file
  var testFile = do_get_file("data/message1.eml");

  // Ensure we have at least one mail account
  localAccountUtils.loadLocalMailAccount();

  // Start the fake SMTP server
  server.start();
  var smtpServer = getBasicSmtpServer(server.port);
  var identity = getSmtpIdentity(kIdentityMail, smtpServer);

  // This time with auth
  test = "Auth sendMailMessage";

  smtpServer.authMethod = Ci.nsMsgAuthMethod.passwordCleartext;
  smtpServer.socketType = Ci.nsMsgSocketType.plain;
  smtpServer.username = kUsername;

  do_test_pending();

  MailServices.smtp.sendMailMessage(
    testFile,
    kTo,
    identity,
    kSender,
    null,
    URLListener,
    null,
    null,
    false,
    {},
    {}
  );

  server.performTest();
});

var URLListener = {
  OnStartRunningUrl(url) {},
  OnStopRunningUrl(url, rc) {
    // Check for ok status.
    Assert.equal(rc, 0);
    // Now check the new password has been saved.
    let logins = Services.logins.findLogins(
      "smtp://localhost",
      null,
      "smtp://localhost"
    );

    Assert.equal(logins.length, 1);
    Assert.equal(logins[0].username, kUsername);
    Assert.equal(logins[0].password, kValidPassword);

    server.stop();

    var thread = gThreadManager.currentThread;
    while (thread.hasPendingEvents()) {
      thread.processNextEvent(true);
    }

    do_test_finished();
  },
};
