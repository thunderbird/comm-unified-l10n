// We can be executed from multiple depths
// Provide gDEPTH if not already defined
if (typeof gDEPTH == "undefined") {
  var gDEPTH = "../../../../";
}

var { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);
var { XPCOMUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/XPCOMUtils.sys.mjs"
);

var { IMAPPump, setupIMAPPump, teardownIMAPPump } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/IMAPpump.sys.mjs"
);
var { localAccountUtils } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/LocalAccountUtils.sys.mjs"
);
var { mailTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/MailTestUtils.sys.mjs"
);
var { MessageGenerator } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/MessageGenerator.sys.mjs"
);
var { PromiseTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/PromiseTestUtils.sys.mjs"
);

// WebApps.sys.mjs called by ProxyAutoConfig (PAC) requires a valid nsIXULAppInfo.
var { getAppInfo, newAppInfo, updateAppInfo } = ChromeUtils.importESModule(
  "resource://testing-common/AppInfo.sys.mjs"
);
updateAppInfo();

// Ensure the profile directory is set up
do_get_profile();

const gMessageGenerator = new MessageGenerator();

// Import fakeserver
var { nsMailServer } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/Maild.sys.mjs"
);

var {
  ImapDaemon,
  ImapMessage,
  configurations,
  IMAP_RFC3501_handler,
  mixinExtension,
  IMAP_RFC2197_extension,
  IMAP_RFC2342_extension,
  IMAP_RFC3348_extension,
  IMAP_RFC4315_extension,
  IMAP_RFC5258_extension,
  IMAP_RFC2195_extension,
} = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/Imapd.sys.mjs"
);
var { AuthPLAIN, AuthLOGIN, AuthCRAM } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/Auth.sys.mjs"
);
var { SmtpDaemon, SMTP_RFC2821_handler } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/Smtpd.sys.mjs"
);

function makeServer(daemon, infoString, otherProps) {
  if (infoString in configurations) {
    return makeServer(daemon, configurations[infoString].join(","), otherProps);
  }

  function createHandler(d) {
    var handler = new IMAP_RFC3501_handler(d);
    if (!infoString) {
      infoString = "RFC2195";
    }

    var parts = infoString.split(/ *, */);
    for (var part of parts) {
      if (part.startsWith("RFC")) {
        let ext;
        switch (part) {
          case "RFC2197":
            ext = IMAP_RFC2197_extension;
            break;
          case "RFC2342":
            ext = IMAP_RFC2342_extension;
            break;
          case "RFC3348":
            ext = IMAP_RFC3348_extension;
            break;
          case "RFC4315":
            ext = IMAP_RFC4315_extension;
            break;
          case "RFC5258":
            ext = IMAP_RFC5258_extension;
            break;
          case "RFC2195":
            ext = IMAP_RFC2195_extension;
            break;
          default:
            throw new Error("Unknown extension: " + part);
        }
        mixinExtension(handler, ext);
      }
    }
    if (otherProps) {
      for (var prop in otherProps) {
        handler[prop] = otherProps[prop];
      }
    }
    return handler;
  }
  var server = new nsMailServer(createHandler, daemon);
  server.start();
  return server;
}

function createLocalIMAPServer(port, hostname = "localhost") {
  const server = localAccountUtils.create_incoming_server(
    "imap",
    port,
    "user",
    "password",
    hostname
  );
  server.QueryInterface(Ci.nsIImapIncomingServer);
  return server;
}

// <copied from="head_maillocal.js">
/**
 * @param {object} fromServer - Object got from server.playTransaction()
 * @param {string[]} fromServer.us - Commands from us.
 * @param {string[]} fromServer.them - Commands from them.
 * @param {string[]} expected - Expected commands like ["command", "command", ...]
 * @param {boolean} withParams - if false,
 *   everything apart from the IMAP command will the stripped.
 *   E.g. 'lsub "" "*"' will be compared as 'lsub'.
 *   Exception is "authenticate", which also get its first parameter in upper case,
 *   e.g. "authenticate CRAM-MD5".
 */
function do_check_transaction(fromServer, expected, withParams) {
  // If we don't spin the event loop before starting the next test, the readers
  // aren't expired. In this case, the "real" real transaction is the last one.
  if (fromServer instanceof Array) {
    fromServer = fromServer[fromServer.length - 1];
  }

  const realTransaction = [];
  for (let i = 0; i < fromServer.them.length; i++) {
    var line = fromServer.them[i]; // e.g. '1 login "user" "password"'
    var components = line.split(" ");
    if (components.length < 2) {
      throw new Error("IMAP command in transaction log missing: " + line);
    }
    if (withParams) {
      realTransaction.push(line.substr(components[0].length + 1));
    } else if (components[1].toUpperCase() == "AUTHENTICATE") {
      realTransaction.push(components[1] + " " + components[2].toUpperCase());
    } else {
      realTransaction.push(components[1]);
    }
  }

  Assert.equal(
    realTransaction.join(", ").toUpperCase(),
    expected.join(", ").toUpperCase()
  );
}

/**
 * Add a simple message to the IMAP pump mailbox.
 */
function addImapMessage() {
  const message = gMessageGenerator.makeMessage();
  const dataUri = Services.io.newURI(
    "data:text/plain;base64," + btoa(message.toMessageString())
  );
  const imapMsg = new ImapMessage(dataUri.spec, IMAPPump.mailbox.uidnext++, []);
  IMAPPump.mailbox.addMessage(imapMsg);
  return message;
}

registerCleanupFunction(function () {
  load(gDEPTH + "mailnews/resources/mailShutdown.js");
});

// Setup the SMTP daemon and server
function setupSmtpServerDaemon(handler) {
  if (!handler) {
    handler = function (d) {
      return new SMTP_RFC2821_handler(d);
    };
  }
  var server = new nsMailServer(handler, new SmtpDaemon());
  return server;
}
