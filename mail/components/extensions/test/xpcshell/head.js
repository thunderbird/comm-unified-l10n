/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var { ExtensionTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/ExtensionXPCShellUtils.sys.mjs"
);
var { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);
var { mailTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/MailTestUtils.sys.mjs"
);
var { MessageGenerator } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/MessageGenerator.sys.mjs"
);
var { nsMailServer } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/Maild.sys.mjs"
);
var { PromiseTestUtils: MailPromiseTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/PromiseTestUtils.sys.mjs"
);

// Persistent Listener test functionality
var { assertPersistentListeners } = ExtensionTestUtils.testAssertions;

ExtensionTestUtils.init(this);

var IS_IMAP = false;
var IS_NNTP = false;

function formatVCard(strings, ...values) {
  const arr = [];
  for (const str of strings) {
    arr.push(str);
    arr.push(values.shift());
  }
  const lines = arr.join("").split("\n");
  const indent = lines[1].length - lines[1].trimLeft().length;
  const outLines = [];
  for (const line of lines) {
    if (line.length > 0) {
      outLines.push(line.substring(indent) + "\r\n");
    }
  }
  return outLines.join("");
}

function createAccount(type = "none", options = {}) {
  let account;

  if (type == "local") {
    account = MailServices.accounts.createLocalMailAccount();
  } else {
    account = MailServices.accounts.createAccount();
    account.incomingServer = MailServices.accounts.createIncomingServer(
      `${account.key}user`,
      "localhost",
      type
    );
  }

  if (type == "imap") {
    const server = new IMAPServer(options);
    server.open();
    account.incomingServer.port = server.port;
    account.incomingServer.username = "user";
    account.incomingServer.password = "password";
    const inbox = account.incomingServer.rootFolder.getChildNamed("INBOX");
    inbox.QueryInterface(Ci.nsIMsgImapMailFolder).hierarchyDelimiter = "/";
    gIMAPServers.set(account.incomingServer.key, server);
  }

  if (type == "nntp") {
    NNTPServer.open();
    account.incomingServer.port = NNTPServer.port;
  }
  info(`Created account ${account.toString()}`);
  return account;
}

function cleanUpAccount(account) {
  const serverKey = account.incomingServer.key;
  const serverType = account.incomingServer.type;
  info(
    `Cleaning up ${serverType} account ${account.key} and server ${serverKey}`
  );
  MailServices.accounts.removeAccount(account, true);

  try {
    const server = MailServices.accounts.getIncomingServer(serverKey);
    if (server) {
      info(`Cleaning up leftover ${serverType} server ${serverKey}`);
      MailServices.accounts.removeIncomingServer(server, false);
    }
  } catch (e) {}
}

registerCleanupFunction(() => {
  MailServices.accounts.accounts.forEach(cleanUpAccount);
  Services.prefs.setStringPref("extensions.webextensions.uuids", "{}");
});

function addIdentity(account, email = "xpcshell@localhost") {
  const identity = MailServices.accounts.createIdentity();
  identity.email = email;
  account.addIdentity(identity);
  if (!account.defaultIdentity) {
    account.defaultIdentity = identity;
  }
  info(`Created identity ${identity.toString()}`);
  return identity;
}

async function createSubfolder(parent, name) {
  if (parent.server.type == "nntp") {
    createNewsgroup(name);
    const account = MailServices.accounts.findAccountForServer(parent.server);
    subscribeNewsgroup(account, name);
    return parent.getChildNamed(name);
  }

  const promiseAdded = MailPromiseTestUtils.promiseFolderAdded(name);
  parent.createSubfolder(name, null);
  await promiseAdded;
  return parent.getChildNamed(name);
}

async function createMessages(folder, makeMessagesArg) {
  if (typeof makeMessagesArg == "number") {
    makeMessagesArg = { count: makeMessagesArg };
  }
  if (!createMessages.messageGenerator) {
    createMessages.messageGenerator = new MessageGenerator();
  }

  const messages =
    createMessages.messageGenerator.makeMessages(makeMessagesArg);
  await addGeneratedMessages(folder, messages);
}

class FakeGeneratedMessage {
  constructor(msg) {
    this.msg = msg;
  }
  toMessageString() {
    return this.msg;
  }
}

async function createMessageFromFile(folder, path) {
  const message = await IOUtils.readUTF8(path);
  await addGeneratedMessages(folder, [new FakeGeneratedMessage(message)]);
}

async function createMessageFromString(folder, message) {
  await addGeneratedMessages(folder, [new FakeGeneratedMessage(message)]);
}

async function addGeneratedMessages(folder, messages) {
  if (folder.server.type == "imap" && gIMAPServers.has(folder.server.key)) {
    return gIMAPServers.get(folder.server.key).addMessages(folder, messages);
  }
  if (folder.server.type == "nntp") {
    return NNTPServer.addMessages(folder, messages);
  }

  const messageStrings = messages.map(message => message.toMessageString());
  folder.QueryInterface(Ci.nsIMsgLocalMailFolder);
  folder.addMessageBatch(messageStrings);
  folder.callFilterPlugins(null);

  return new Promise(resolve =>
    mailTestUtils.updateFolderAndNotify(folder, resolve)
  );
}

async function getUtilsJS() {
  return IOUtils.readUTF8(do_get_file("data/utils.js").path);
}

var gIMAPServers = new Map();
class IMAPServer {
  constructor(options = {}) {
    this.extensions = options?.extensions ?? [];
  }

  open() {
    const ImapD = ChromeUtils.importESModule(
      "resource://testing-common/mailnews/Imapd.sys.mjs"
    );
    const { IMAP_RFC3501_handler, ImapDaemon, ImapMessage, mixinExtension } =
      ImapD;

    this.ImapMessage = ImapMessage;
    this.daemon = new ImapDaemon();
    this.server = new nsMailServer(daemon => {
      const handler = new IMAP_RFC3501_handler(daemon);
      for (const ext of this.extensions) {
        mixinExtension(handler, ImapD[`IMAP_${ext}_extension`]);
      }
      return handler;
    }, this.daemon);

    this.server.start();

    registerCleanupFunction(() => this.close());
  }
  close() {
    this.server.stop();
  }
  get port() {
    return this.server.port;
  }

  addMessages(folder, messages) {
    folder.QueryInterface(Ci.nsIMsgImapMailFolder);
    const fakeFolder = this.daemon.getMailbox(folder.name);
    messages.forEach(message => {
      if (typeof message != "string") {
        message = message.toMessageString();
      }
      const msgURI = Services.io.newURI(
        "data:text/plain;base64," + btoa(message)
      );
      const imapMsg = new this.ImapMessage(
        msgURI.spec,
        fakeFolder.uidnext++,
        []
      );
      fakeFolder.addMessage(imapMsg);
    });

    const listener = new MailPromiseTestUtils.PromiseUrlListener();
    folder.updateFolderWithListener(null, listener);
    return listener.promise;
  }
}

function subscribeNewsgroup(account, group) {
  account.incomingServer.QueryInterface(Ci.nsINntpIncomingServer);
  account.incomingServer.subscribeToNewsgroup(group);
  account.incomingServer.maximumConnectionsNumber = 1;
}

function createNewsgroup(group) {
  if (!NNTPServer.hasGroup(group)) {
    NNTPServer.addGroup(group);
  }
}

var NNTPServer = {
  open() {
    const { NNTP_RFC977_handler, NntpDaemon } = ChromeUtils.importESModule(
      "resource://testing-common/mailnews/Nntpd.sys.mjs"
    );

    this.daemon = new NntpDaemon();
    this.server = new nsMailServer(
      daemon => new NNTP_RFC977_handler(daemon),
      this.daemon
    );
    this.server.start();

    registerCleanupFunction(() => this.close());
  },

  close() {
    this.server.stop();
  },
  get port() {
    return this.server.port;
  },

  addGroup(group) {
    return this.daemon.addGroup(group);
  },

  hasGroup(group) {
    return this.daemon.getGroup(group) != null;
  },

  addMessages(folder, messages) {
    const { NewsArticle } = ChromeUtils.importESModule(
      "resource://testing-common/mailnews/Nntpd.sys.mjs"
    );

    const group = folder.name;
    messages.forEach(message => {
      if (typeof message != "string") {
        message = message.toMessageString();
      }
      // The NNTP daemon needs a trailing empty line.
      if (!message.endsWith("\r\n")) {
        message = message + "\r\n";
      }
      const article = new NewsArticle(message);
      article.groups = [group];
      this.daemon.addArticle(article);
    });

    return new Promise(resolve => {
      mailTestUtils.updateFolderAndNotify(folder, resolve);
    });
  },
};
