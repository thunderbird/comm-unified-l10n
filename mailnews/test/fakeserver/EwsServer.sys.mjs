/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { HttpServer } from "resource://testing-common/httpd.sys.mjs";

import { CommonUtils } from "resource://services-common/utils.sys.mjs";

/**
 * This file provides a mock/fake EWS (Exchange Web Services) server to run our
 * unit tests against.
 */

/**
 * Templates to use as bases to build EWS responses. These are stripped down
 * versions of actual responses received from the Exchange server handling
 * Exchange Online (e.g. O365) accounts.
 */

// The header for all EWS SOAP requests.
const EWS_SOAP_HEAD = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope
  xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Header>
    <h:ServerVersionInfo MajorVersion="15" MinorVersion="20" MajorBuildNumber="7452" MinorBuildNumber="50"
      xmlns:h="http://schemas.microsoft.com/exchange/services/2006/types"
      xmlns:xsd="http://www.w3.org/2001/XMLSchema"
      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>
    </s:Header>
    <s:Body>`;

// The footer for all EWS SOAP requests.
const EWS_SOAP_FOOT = `</s:Body>
</s:Envelope>`;

// The base for a response to a GetFolder operation request. Before sending, the
// server will populate `m:ResponseMessages`, with one message per requested
// folder.
const GET_FOLDER_RESPONSE_BASE = `${EWS_SOAP_HEAD}
    <m:GetFolderResponse xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"
                          xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                          xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
      <m:ResponseMessages>
      </m:ResponseMessages>
    </m:GetFolderResponse>
  ${EWS_SOAP_FOOT}`;

// The base for a response to a SyncFolderHierarchy operation request. Before
// sending, the server will populate `m:Changes`, as well as add and populate a
// `m:SyncState` element.
const SYNC_FOLDER_HIERARCHY_RESPONSE_BASE = `${EWS_SOAP_HEAD}
    <m:SyncFolderHierarchyResponse xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"
                                    xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                                    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                                    xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
      <m:ResponseMessages>
        <m:SyncFolderHierarchyResponseMessage ResponseClass="Success">
          <m:ResponseCode>NoError</m:ResponseCode>
          <m:IncludesLastFolderInRange>true</m:IncludesLastFolderInRange>
          <m:Changes>
          </m:Changes>
        </m:SyncFolderHierarchyResponseMessage>
      </m:ResponseMessages>
    </m:SyncFolderHierarchyResponse>
  ${EWS_SOAP_FOOT}`;

// The base for a response to a SyncFolderItems operation request. Before
// sending, the server will populate `m:Changes`, as well as add and populate a
// `m:SyncState` element.
const SYNC_FOLDER_ITEMS_RESPONSE_BASE = `${EWS_SOAP_HEAD}
    <m:SyncFolderItemsResponse xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"
                                xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                                xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                                xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
      <m:ResponseMessages>
        <m:SyncFolderItemsResponseMessage ResponseClass="Success">
          <m:ResponseCode>NoError</m:ResponseCode>
          <m:IncludesLastItemInRange>true</m:IncludesLastItemInRange>
            <m:Changes>
            </m:Changes>
        </m:SyncFolderItemsResponseMessage>
      </m:ResponseMessages>
    </m:SyncFolderItemsResponse>
${EWS_SOAP_FOOT}`;

// The base for a response to a CreateItem operation request.
const CREATE_ITEM_RESPONSE_BASE = `${EWS_SOAP_HEAD}
    <m:CreateItemResponse xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"
                          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                          xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                          xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
      <m:ResponseMessages>
        <m:CreateItemResponseMessage ResponseClass="Success">
          <m:ResponseCode>NoError</m:ResponseCode>
          <m:Items />
        </m:CreateItemResponseMessage>
      </m:ResponseMessages>
    </m:CreateItemResponse>
${EWS_SOAP_FOOT}`;

// The base for a response to a CreateFolder operation request. Before sending,
// the server will populate `m:Folders` with the server-side IDs of the newly
// created folders.
const CREATE_FOLDER_RESPONSE_BASE = `${EWS_SOAP_HEAD}
    <m:CreateFolderResponse xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"
                            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                            xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                            xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
      <m:ResponseMessages>
        <m:CreateFolderResponseMessage ResponseClass="Success">
          <m:ResponseCode>NoError</m:ResponseCode>
          <m:Folders>
          </m:Folders>
        </m:CreateFolderResponseMessage>
      </m:ResponseMessages>
    </m:CreateFolderResponse>
${EWS_SOAP_FOOT}`;

const MOVE_ITEM_RESPONSE_BASE = `${EWS_SOAP_HEAD}
    <m:MoveItemResponse xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"
                        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                        xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                        xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
      <m:ResponseMessages>
      </m:ResponseMessages>
    </m:MoveItemResponse>
${EWS_SOAP_FOOT}`;

const COPY_ITEM_RESPONSE_BASE = `${EWS_SOAP_HEAD}
    <m:CopyItemResponse xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"
                        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                        xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                        xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
      <m:ResponseMessages>
      </m:ResponseMessages>
    </m:CopyItemResponse>
${EWS_SOAP_FOOT}`;

const MOVE_FOLDER_RESPONSE_BASE = `${EWS_SOAP_HEAD}
    <m:MoveFolderResponse xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"
                        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                        xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                        xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
      <m:ResponseMessages>
      </m:ResponseMessages>
    </m:MoveFolderResponse>
${EWS_SOAP_FOOT}`;

const GET_ITEM_RESPONSE_BASE = `${EWS_SOAP_HEAD}
  <m:GetItemResponse xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"
                     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                     xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                     xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
    <m:ResponseMessages>
      <m:GetItemResponseMessage ResponseClass="Success">
        <m:ResponseCode>NoError</m:ResponseCode>
        <m:Items>
        </m:Items>
      </m:GetItemResponseMessage>
    </m:ResponseMessages>
  </m:GetItemResponse>
  ${EWS_SOAP_FOOT}`;
/**
 * A remote folder to sync from the EWS server. While initiating a test, an
 * array of folders is given to the EWS server, which will use it to populate
 * the contents of responses to EWS operations.
 */
export class RemoteFolder {
  /**
   * The unique EWS identifier for this folder.
   *
   * @type {string}
   */
  id;

  /**
   * An optional distinguished ID if this is a special folder (e.g. Inbox, root
   * folder, etc.).
   *
   * @type {?string}
   */
  distinguishedId;

  /**
   * The display name for the folder. Defaults to its ID.
   *
   * @type {string}
   */
  displayName;

  /**
   * The EWS identifier for the parent of this folder. Only the root folder
   * should be allowed to not have a parent.
   *
   * @type {?string}
   */
  parentId;

  constructor(
    folderId,
    parentId = null,
    displayName = null,
    distinguishedFolderId = null
  ) {
    this.id = folderId;
    this.parentId = parentId;
    this.displayName = displayName || folderId;
    this.distinguishedId = distinguishedFolderId;
  }
}

/**
 * Information about an item (Message, Meeting, etc.)
 */
export class ItemInfo {
  /**
   * @type {string}
   */
  parentId;

  /**
   * @type {boolean}
   */
  itemSynced;

  /**
   * @type {SyntheticMessage}
   */
  syntheticMessage;

  /**
   * Construct a new item within the given parent.
   *
   * @param {string} parentId
   * @param {SyntheticMessage} [syntheticMessage] - Message data from
   *   MessageGenerator, if this item is a message.
   */
  constructor(parentId, syntheticMessage) {
    this.parentId = parentId;
    this.itemSynced = false;
    this.syntheticMessage = syntheticMessage;
  }
}

/**
 * A mock EWS server; an HTTP server capable of responding to EWS requests in a
 * limited capacity.
 */
export class EwsServer {
  /**
   * The folders registered on this EWS server.
   *
   * @type {RemoteFolder[]}
   */
  folders = [];

  /**
   * The folders flagged to be deleted on this EWS server.
   *
   * @type {RemoteFolder[]}
   */
  deletedFolders = [];

  /**
   * The ids of folders that have had updates applied.
   *
   * @type {string[]}
   */
  updatedFolderIds = [];

  /**
   * The version identifier to use in responses.
   *
   * `null` means no `Version` attribute in the `ServerVersionInfo` header.
   *
   * @type {?string}
   */
  version = null;

  /**
   * The mock HTTP server to use for handling EWS traffic.
   *
   * @type {HttpServer}
   */
  #httpServer;

  /**
   * A mapping from EWS identifier to folder specification.
   *
   * @type {Map<string, RemoteFolder>}
   */
  #idToFolder = new Map();

  /**
   * A mapping from EWS distinguished identifier to folder specification. This
   * only includes folders for which a distinguished identifier is specified.
   *
   * @type {Map<string, RemoteFolder>}
   */
  #distinguishedIdToFolder = new Map();

  /**
   * A mapping from EWS item id to its containing folder id.
   *
   * @type {Map<string, ItemInfo>}
   */
  #itemIdToItemInfo = new Map();

  /**
   * The parser to use for parsing XML documents.
   *
   * @type {DOMParser}
   */
  #parser;

  /**
   * The serializer to use for generating XML documents.
   *
   * @type {XMLSerializer}
   */
  #serializer;

  /**
   * The value of the `Authorization` value as read from the latest request.
   *
   * If no such header was found in the latest request, this is an empty string.
   *
   * @type {string}
   * @name EwsServer.lastAuthorizationValue
   * @private
   */
  #lastAuthorizationValue;

  /**
   * The value of the `RequestServerVersion` SOAP header from the latest
   * request.
   *
   * If no such header was found in the latest request, this is `null`
   *
   * @type {?string}
   * @name EwsServer.lastRequestedVersion
   * @private
   */
  #lastRequestedVersion;

  /**
   * The content of the last outgoing message sent to this server.
   *
   * @type {?string}
   * @name EwsServer.lastSentMessage
   * @private
   */
  #lastSentMessage;

  /**
   * The username that must be supplied on requests to this server if HTTP
   * basic authentication is used.
   *
   * @type {string}
   * @name EwsServer.username
   * @private
   */
  #username;

  /**
   * The password that must be supplied on requests to this server if HTTP
   * basic authentication is used.
   *
   * @type {string}
   * @name EwsServer.password
   * @private
   */
  #password;

  /**
   * A network proxy to turn this HTTP server into an HTTPS server.
   *
   * @type {HttpsProxy}
   * @name EwsServer.httpsProxy
   * @private
   */
  #httpsProxy;

  /**
   * Certificate to use for HTTPS requests. See ServerTestUtils.getCertificate.
   *
   * @type {nsIX509Cert}
   * @name EwsServer.tlsCert
   * @private
   */
  #tlsCert;

  /**
   * @param {object} options
   * @param {string} [options.hostname]
   * @param {integer} [options.port]
   * @param {nsIX509Cert} [options.tlsCert]
   * @param {string} [options.version]
   * @param {string} [options.username="user"]
   * @param {string} [options.password="password"]
   */
  constructor({
    hostname,
    port,
    tlsCert,
    version,
    username = "user",
    password = "password",
  } = {}) {
    this.version = version;
    this.#httpServer = new HttpServer();
    this.#httpServer.registerPathHandler(
      "/EWS/Exchange.asmx",
      (request, response) => {
        try {
          this.#requestHandler(request, response);
        } catch (e) {
          // The error handling of the HTTP server is a bit lacking, in that all
          // it does when any error is thrown is respond with a generic 500. To
          // makes writing tests with this server a bit easier, we want to log
          // the error before responding.
          console.error("Error when processing request:", e);
          throw e;
        }
      }
    );
    if (hostname && port) {
      // Used by ServerTestUtils to make this server appear at hostname:port.
      // This doesn't mean the HTTP server is listening on that host and port.
      this.#httpServer.identity.add(
        port == 443 ? "http" : "https",
        hostname,
        port
      );
    }
    this.#tlsCert = tlsCert;
    this.#username = username;
    this.#password = password;

    this.#parser = new DOMParser();
    this.#serializer = new XMLSerializer();
    // Set up the well know folders by default.
    this.setRemoteFolders(this.getWellKnownFolders());
  }

  /**
   * Start listening for requests.
   */
  start() {
    this.#httpServer.start(-1);
    if (this.#tlsCert) {
      const { HttpsProxy } = ChromeUtils.importESModule(
        "resource://testing-common/mailnews/HttpsProxy.sys.mjs"
      );
      this.#httpsProxy = new HttpsProxy(
        this.#httpServer.identity.primaryPort,
        this.#tlsCert
      );
    }
  }

  /**
   * Stop listening for requests.
   */
  stop() {
    this.#httpServer.stop();
    this.#httpsProxy?.destroy();
  }

  /**
   * The port this server is listening for new requests on.
   *
   * @type {number}
   */
  get port() {
    return this.#httpsProxy?.port ?? this.#httpServer.identity.primaryPort;
  }

  /**
   * The value of the `Authorization` value as read from the latest request.
   *
   * If no such header was found in the latest request, this is an empty string.
   *
   * @type {string}
   */
  get lastAuthorizationValue() {
    return this.#lastAuthorizationValue;
  }

  /**
   * The value of the `RequestServerVersion` SOAP header from the latest
   * request.
   *
   * If no such header was found in the latest request, this is `null`.
   *
   * @type {?string}
   */
  get lastRequestedVersion() {
    return this.#lastRequestedVersion;
  }

  /**
   * The content of the last outgoing message sent to this server.
   *
   * @type {?string}
   */
  get lastSentMessage() {
    return this.#lastSentMessage;
  }

  /**
   * Set the exclusive list of folders this server should use to generate
   * responses. If this method is called more than once, the previous list of
   * folders is replaced by the new one.
   *
   * @param {RemoteFolder[]} folders
   */
  setRemoteFolders(folders) {
    this.folders = [];
    this.#idToFolder.clear();
    this.#distinguishedIdToFolder.clear();

    folders.forEach(folder => {
      this.appendRemoteFolder(folder);
    });
  }

  /**
   * Create a list of `RemoteFolder`s, representing well-known folders typically
   * synchronised first from an EWS server.
   *
   * @returns {RemoteFolder[]} A list of well-known folders.
   */
  getWellKnownFolders() {
    return [
      new RemoteFolder("root", null, "Root", "msgfolderroot"),
      new RemoteFolder("inbox", "root", "Inbox", "inbox"),
      new RemoteFolder("deleteditems", "root", "Deleted Items", "deleteditems"),
      new RemoteFolder("drafts", "root", "Drafts", "drafts"),
      new RemoteFolder("outbox", "root", "Outbox", "outbox"),
      new RemoteFolder("sentitems", "root", "Sent", "sentitems"),
      new RemoteFolder("junkemail", "root", "Junk", "junkemail"),
    ];
  }

  /**
   * Parse an XML request and write the appropriate response. Throws if no
   * supported EWS operation could be found.
   *
   * @param {nsIHttpRequest} request
   * @param {nsIHttpResponse} response
   * @throws Throws if no supported EWS operation could be found.
   */
  #requestHandler(request, response) {
    // Try to read the value of the `Authorization` header.
    if (request.hasHeader("Authorization")) {
      this.#lastAuthorizationValue = request.getHeader("Authorization");

      if (this.#lastAuthorizationValue.startsWith("Basic ")) {
        const [username, password] = atob(
          this.#lastAuthorizationValue.substring(6)
        ).split(":");
        if (username != this.#username || password != this.#password) {
          response.setStatusLine("1.1", 401, "Unauthorized");
          response.setHeader("WWW-Authenticate", `Basic realm="test"`);
          return;
        }
      } else if (this.#lastAuthorizationValue.startsWith("Bearer ")) {
        const token = this.#lastAuthorizationValue.substring(7);
        const { OAuth2TestUtils } = ChromeUtils.importESModule(
          "resource://testing-common/mailnews/OAuth2TestUtils.sys.mjs"
        );
        if (!OAuth2TestUtils.validateToken(token, "test_mail")) {
          response.setStatusLine("1.1", 401, "Unauthorized");
          response.setHeader("WWW-Authenticate", `Basic realm="test"`);
          return;
        }
      }
    } else {
      response.setStatusLine("1.1", 401, "Unauthorized");
      response.setHeader("WWW-Authenticate", `Basic realm="test"`);
      return;
    }

    // Read the request content and parse it as XML.
    const reqBytes = CommonUtils.readBytesFromInputStream(
      request.bodyInputStream
    );
    const reqDoc = this.#parser.parseFromString(reqBytes, "text/xml");

    // Try to extract the `RequestServerVersion` SOAP header.
    const requestVersionHeaders = reqDoc.getElementsByTagName(
      "t:RequestServerVersion"
    );
    if (requestVersionHeaders.length > 0) {
      const versionHeader = requestVersionHeaders[0];
      this.#lastRequestedVersion = versionHeader.getAttribute("Version");
    }

    // Generate a response based on the operation found in the request.
    let resBytes = "";
    if (reqDoc.getElementsByTagName("SyncFolderHierarchy").length) {
      resBytes = this.#generateSyncFolderHierarchyResponse(reqDoc);
    } else if (reqDoc.getElementsByTagName("GetFolder").length) {
      resBytes = this.#generateGetFolderResponse(reqDoc);
    } else if (reqDoc.getElementsByTagName("SyncFolderItems").length) {
      resBytes = this.#generateSyncFolderItemsResponse(reqDoc);
    } else if (reqDoc.getElementsByTagName("CreateItem").length) {
      resBytes = this.#generateCreateItemResponse(reqDoc);
    } else if (reqDoc.getElementsByTagName("CreateFolder").length) {
      resBytes = this.#generateCreateFolderResponse(reqDoc);
    } else if (reqDoc.getElementsByTagName("MoveItem").length) {
      resBytes = this.#generateMoveItemResponse(reqDoc);
    } else if (reqDoc.getElementsByTagName("CopyItem").length) {
      resBytes = this.#generateCopyItemResponse(reqDoc);
    } else if (reqDoc.getElementsByTagName("MoveFolder").length) {
      resBytes = this.#generateMoveFolderResponse(reqDoc);
    } else if (reqDoc.getElementsByTagName("GetItem")) {
      resBytes = this.#generateGetItemResponse(reqDoc);
    } else {
      throw new Error("Unexpected EWS operation");
    }
    // Send the response.
    response.bodyOutputStream.write(resBytes, resBytes.length);
  }

  /**
   * Generate a response to a CreateFolder operation.
   *
   * @see {@link https://learn.microsoft.com/en-us/exchange/client-developer/web-service-reference/createfolder-operation#createfolder-error-response}
   * @param {XMLDocument} reqDoc - The parsed document for the request to respond to.
   * @returns {string} A serialized XML document.
   */
  #generateCreateFolderResponse(reqDoc) {
    // Retrieve the parent's folder ID. At some point we might want to match it
    // with an existing folder in `this.folders`, but this is not a requirement
    // right now.
    // TODO: Support referring to the parent with its distinguised folder ID
    // (when relevant). It's not necessary currently because the EWS client will
    // always use `FolderId`.
    const parentFolderId = reqDoc
      .getElementsByTagName("ParentFolderId")[0]
      .getElementsByTagName("t:FolderId")[0]
      .getAttribute("Id");

    // TODO: Support batch creation of multiple folders. This is not much of an
    // issue currently because the EWS client never creates more than one folder
    // at a time.
    const folderEl = reqDoc
      .getElementsByTagName("Folders")[0]
      .getElementsByTagName("t:Folder")[0];

    // Retrieve the desired display name for this folder.
    const folderName =
      folderEl.getElementsByTagName("t:DisplayName")[0].innerText;

    // Generate a random ID for the folder.
    const folderId = (Math.random() + 1).toString(36).substring(2);

    // Add the folder to the list of folders the server knows about.
    this.appendRemoteFolder(
      new RemoteFolder(folderId, parentFolderId, folderName, null)
    );

    const resDoc = this.#parser.parseFromString(
      CREATE_FOLDER_RESPONSE_BASE,
      "text/xml"
    );

    // Add the server-side ID of the new folder to the response.
    const foldersEl = resDoc.getElementsByTagName("m:Folders")[0];
    const newFolderEl = resDoc.createElement("t:Folder");
    const folderIdEl = resDoc.createElement("t:FolderId");
    folderIdEl.setAttribute("Id", folderId);
    newFolderEl.appendChild(folderIdEl);
    foldersEl.appendChild(newFolderEl);

    return this.#serializer.serializeToString(resDoc);
  }

  /**
   * Set the SOAP header to indicate the Exchange version used by this server.
   *
   * @param {XMLDocument} resDoc
   */
  #setVersion(resDoc) {
    if (!this.version) {
      return;
    }

    const serverVersionHeader = resDoc.getElementsByTagName(
      "h:ServerVersionInfo"
    )[0];
    serverVersionHeader.setAttribute("Version", this.version);
  }

  /**
   * Generate a response to a SyncFolderItems operation.
   *
   * Currently, generated responses will not include any item.
   *
   * @see
   * {@link https://learn.microsoft.com/en-us/exchange/client-developer/web-service-reference/syncfolderitems-operation#successful-syncfolderitems-response}
   * @param {XMLDocument} reqDoc - The parsed document for the request to
   * respond to.
   * @returns {string} A serialized XML document.
   */
  #generateSyncFolderItemsResponse(reqDoc) {
    const resDoc = this.#parser.parseFromString(
      SYNC_FOLDER_ITEMS_RESPONSE_BASE,
      "text/xml"
    );

    this.#setVersion(resDoc);

    const syncFolderId = reqDoc
      .getElementsByTagName("SyncFolderId")[0]
      .getElementsByTagName("t:FolderId")[0]
      .getAttribute("Id");

    const responseMessageEl = resDoc.getElementsByTagName(
      "m:SyncFolderItemsResponseMessage"
    )[0];

    // Append a dummy sync state.
    // TODO: Make this dynamic.
    const syncStateEl = resDoc.createElement("m:SyncState");
    syncStateEl.appendChild(resDoc.createTextNode("H4sIAAA=="));
    responseMessageEl.appendChild(syncStateEl);

    const changesEl = resDoc.getElementsByTagName("m:Changes")[0];
    this.#itemIdToItemInfo.forEach((info, itemId) => {
      if (info.parentId === syncFolderId && !info.itemSynced) {
        const createEl = resDoc.createElement("t:Create");
        const messageEl = resDoc.createElement("t:Message");
        const itemIdEl = resDoc.createElement("t:ItemId");
        itemIdEl.setAttribute("Id", itemId);
        const parentFolderIdEl = resDoc.createElement("t:ParentFolderId");
        parentFolderIdEl.setAttribute("Id", info.parentId);

        messageEl.appendChild(itemIdEl);
        messageEl.appendChild(parentFolderIdEl);
        createEl.appendChild(messageEl);
        changesEl.appendChild(createEl);

        info.itemSynced = true;
      }
    });

    return this.#serializer.serializeToString(resDoc);
  }

  /**
   * Generate a response to a SyncFolderHierarchy operation.
   *
   * @see {@link https://learn.microsoft.com/en-us/exchange/client-developer/web-service-reference/syncfolderhierarchy-operation#successful-syncfolderhierarchy-response}
   * @param {XMLDocument} _reqDoc - The parsed document for the request to respond to.
   * @returns {string} A serialized XML document.
   */
  #generateSyncFolderHierarchyResponse(_reqDoc) {
    const resDoc = this.#parser.parseFromString(
      SYNC_FOLDER_HIERARCHY_RESPONSE_BASE,
      "text/xml"
    );

    this.#setVersion(resDoc);

    const responseMessageEl = resDoc.getElementsByTagName(
      "m:SyncFolderHierarchyResponseMessage"
    )[0];

    // Append a dummy sync state.
    // TODO: Make this dynamic.
    const syncStateEl = resDoc.createElement("m:SyncState");
    syncStateEl.appendChild(resDoc.createTextNode("H4sIAAA=="));
    responseMessageEl.appendChild(syncStateEl);

    const changesEl = resDoc.getElementsByTagName("m:Changes")[0];
    this.folders.forEach(folder => {
      if (folder.distinguishedId == "msgfolderroot") {
        // The root folder doesn't appear in SyncFolderHierarchy responses.
        return;
      }

      // TODO: Support more than folder creation (possibly by allowing tests to
      // define handlers or data structures to use when generating responses).
      const createEl = resDoc.createElement("t:Create");
      const folderEl = resDoc.createElement("t:Folder");
      const folderIdEl = resDoc.createElement("t:FolderId");
      folderIdEl.setAttribute("Id", folder.id);

      folderEl.appendChild(folderIdEl);
      createEl.appendChild(folderEl);
      changesEl.appendChild(createEl);
    });

    this.deletedFolders.forEach(folder => {
      const deleteEl = resDoc.createElement("t:Delete");
      const folderIdEl = resDoc.createElement("t:FolderId");
      folderIdEl.setAttribute("Id", folder.id);
      deleteEl.appendChild(folderIdEl);
      changesEl.appendChild(deleteEl);
    });

    this.updatedFolderIds.forEach(folderId => {
      const updateEl = resDoc.createElement("t:Update");
      const folderEl = resDoc.createElement("t:Folder");
      const folderIdEl = resDoc.createElement("t:FolderId");
      folderIdEl.setAttribute("Id", folderId);

      folderEl.appendChild(folderIdEl);
      updateEl.appendChild(folderEl);
      changesEl.appendChild(updateEl);
    });

    return this.#serializer.serializeToString(resDoc);
  }

  /**
   * Generate a response to a GetFolder operation.
   *
   * @see {@link https://learn.microsoft.com/en-us/exchange/client-developer/web-service-reference/getfolder-operation#getfolder-response-example}
   * @param {XMLDocument} reqDoc - The parsed document for the request to respond to.
   * @returns {string} A serialized XML document.
   */
  #generateGetFolderResponse(reqDoc) {
    // Figure out which folder IDs (or distinguished IDs have been requested).
    const requestedFolderIds = [
      ...reqDoc.getElementsByTagName("FolderIds")[0].children,
    ].map(c => c.getAttribute("Id"));

    // Map the requested IDs to actual folders if we have them.
    const responseFolders = requestedFolderIds.map(id => {
      // Try to match against a known distinguished ID.
      if (this.#distinguishedIdToFolder.has(id)) {
        return this.#distinguishedIdToFolder.get(id);
      }

      // If that failed, try to match against a known folder ID.=
      if (this.#idToFolder.has(id)) {
        return this.#idToFolder.get(id);
      }

      // TODO: At some point we will likely want to return a
      // m:GetFolderResponseMessage with an error rather than throwing here.
      throw new Error(`Client requested unknown folder ${id}`);
    });

    // Generate a base document for the response.
    const resDoc = this.#parser.parseFromString(
      GET_FOLDER_RESPONSE_BASE,
      "text/xml"
    );

    this.#setVersion(resDoc);

    const resMsgsEl = resDoc.getElementsByTagName("m:ResponseMessages")[0];

    // Add each folder to the response document.
    responseFolders.forEach(folder => {
      const folderEl = resDoc.createElement("t:Folder");
      // Add folder class.
      const folderClassEl = resDoc.createElement("t:FolderClass");
      // TODO: Allow the value to be configured, to test we correctly filter out
      // unsupported classes.
      folderClassEl.appendChild(resDoc.createTextNode("IPF.Note"));
      folderEl.appendChild(folderClassEl);

      // Add parent if available.
      if (folder.parentId) {
        const parentIdEl = resDoc.createElement("t:ParentFolderId");
        parentIdEl.setAttribute("Id", folder.parentId);
        folderEl.appendChild(parentIdEl);
      }

      // Add folder ID.
      const folderIdEl = resDoc.createElement("t:FolderId");
      folderIdEl.setAttribute("Id", folder.id);
      folderEl.appendChild(folderIdEl);

      // Add display name (defaults to the folder ID in folder constructor).
      const folderNameEl = resDoc.createElement("t:DisplayName");
      folderNameEl.appendChild(resDoc.createTextNode(folder.displayName));
      folderEl.appendChild(folderNameEl);

      // Add the folder element to t:Folders. Note that, in GetFolders
      // responses, each t:Folders element only contains one folder.
      const foldersEl = resDoc.createElement("t:Folders");
      foldersEl.appendChild(folderEl);

      // Indicate that no error happened when retrieving this message.
      const resCodeEl = resDoc.createElement("m:ResponseCode");
      resCodeEl.appendChild(resDoc.createTextNode("NoError"));

      // Build the m:GetFolderResponseMessage element, which is parent to both
      // t:Folders and m:ResponseCode.
      const messageEl = resDoc.createElement("m:GetFolderResponseMessage");
      messageEl.setAttribute("ResponseClass", "Success");
      messageEl.appendChild(resCodeEl);
      messageEl.appendChild(foldersEl);

      // Add the message to the document.
      resMsgsEl.appendChild(messageEl);
    });

    // Serialize the response to a string that the consumer can return in a response.
    return this.#serializer.serializeToString(resDoc);
  }

  /**
   * Generate a response to a SyncFolderItems operation.
   *
   * Currently, generated responses will always serve a static success report.
   *
   * @see
   * {@link https://learn.microsoft.com/en-us/exchange/client-developer/web-service-reference/createitem-operation-email-message#successful-createitem-response}
   * @param {XMLDocument} reqDoc - The parsed document for the request to
   * respond to.
   * @returns {string} A serialized XML document.
   */
  #generateCreateItemResponse(reqDoc) {
    const resDoc = this.#parser.parseFromString(
      CREATE_ITEM_RESPONSE_BASE,
      "text/xml"
    );

    const message =
      reqDoc.getElementsByTagName("t:MimeContent")[0].firstChild.nodeValue;
    this.#lastSentMessage = atob(message);

    this.#setVersion(resDoc);

    return this.#serializer.serializeToString(resDoc);
  }

  /**
   * Generate a response to a MoveItem operation.
   *
   * @param {XMLDocument} reqDoc
   */
  #generateMoveItemResponse(reqDoc) {
    const [destinationFolderId, itemIds] = extractMoveObjects(
      reqDoc,
      "ItemIds",
      "t:ItemId"
    );

    itemIds.forEach(id => {
      this.addNewItemOrMoveItemToFolder(id, destinationFolderId);
    });

    const resDoc = this.#buildGenericMoveResponse(
      MOVE_ITEM_RESPONSE_BASE,
      "m:MoveItemResponseMessage",
      "m:Items",
      "t:Message",
      "t:ItemId",
      itemIds
    );

    return this.#serializer.serializeToString(resDoc);
  }

  /**
   * Generate a response to a CopyItem operation.
   *
   * @param {XMLDocument} reqDoc
   */
  #generateCopyItemResponse(reqDoc) {
    const [destinationFolderId, itemIds] = extractMoveObjects(
      reqDoc,
      "ItemIds",
      "t:ItemId"
    );

    itemIds.forEach(id => {
      this.addNewItemOrMoveItemToFolder(`${id}_copy`, destinationFolderId);
    });

    const resDoc = this.#buildGenericMoveResponse(
      COPY_ITEM_RESPONSE_BASE,
      "m:CopyItemResponseMessage",
      "m:Items",
      "t:Message",
      "t:ItemId",
      itemIds
    );

    return this.#serializer.serializeToString(resDoc);
  }

  /**
   * Return a response to a `MoveFolder` request.
   *
   * @param {XMLDocument} reqDoc
   */
  #generateMoveFolderResponse(reqDoc) {
    const [destinationFolderId, folderIds] = extractMoveObjects(
      reqDoc,
      "FolderIds",
      "t:FolderId"
    );

    folderIds.forEach(id => this.reparentFolderById(id, destinationFolderId));

    const resDoc = this.#buildGenericMoveResponse(
      MOVE_FOLDER_RESPONSE_BASE,
      "m:MoveFolderResponseMessage",
      "m:Folders",
      "t:Folder",
      "t:FolderId",
      folderIds
    );

    return this.#serializer.serializeToString(resDoc);
  }

  /**
   * Return a response to a `GetItem` request.
   *
   * @param {XMLDocument} reqDoc
   */
  #generateGetItemResponse(reqDoc) {
    const resDoc = this.#parser.parseFromString(
      GET_ITEM_RESPONSE_BASE,
      "text/xml"
    );

    this.#setVersion(resDoc);

    // Assume we are asking for only one item.
    const reqItemIds = [...reqDoc.getElementsByTagName("t:ItemId")].map(id =>
      id.getAttribute("Id")
    );
    const includeContent =
      reqDoc.getElementsByTagName("t:IncludeMimeContent")[0]?.textContent ==
      "true";

    const itemsEl = resDoc.getElementsByTagName("m:Items")[0];
    reqItemIds.forEach(reqItemId => {
      const item = this.#itemIdToItemInfo.get(reqItemId);
      const messageEl = resDoc.createElement("t:Message");
      const itemIdEl = resDoc.createElement("t:ItemId");
      itemIdEl.setAttribute("Id", reqItemId);
      const parentFolderIdEl = resDoc.createElement("t:ParentFolderId");
      parentFolderIdEl.setAttribute("Id", item.parentId);
      messageEl.appendChild(itemIdEl);
      messageEl.appendChild(parentFolderIdEl);

      if (item.syntheticMessage) {
        const dateEl = resDoc.createElement("t:DateTimeSent");
        dateEl.textContent = item.syntheticMessage.date.toISOString();
        messageEl.appendChild(dateEl);

        const senderEl = resDoc.createElement("t:Sender");
        const mailboxEl = resDoc.createElement("t:Mailbox");
        const nameEl = resDoc.createElement("t:Name");
        nameEl.textContent = item.syntheticMessage.fromName;
        mailboxEl.appendChild(nameEl);
        const emailAddressEl = resDoc.createElement("t:EmailAddress");
        emailAddressEl.textContent = item.syntheticMessage.fromAddress;
        mailboxEl.appendChild(emailAddressEl);
        senderEl.appendChild(mailboxEl);
        messageEl.appendChild(senderEl);

        const toEl = resDoc.createElement("t:DisplayTo");
        toEl.textContent = item.syntheticMessage.toName;
        messageEl.appendChild(toEl);

        const subjectEl = resDoc.createElement("t:Subject");
        subjectEl.textContent = item.syntheticMessage.subject;
        messageEl.appendChild(subjectEl);

        const isReadEl = resDoc.createElement("t:IsRead");
        isReadEl.textContent = "false";
        messageEl.appendChild(isReadEl);

        if (includeContent) {
          const contentEl = resDoc.createElement("t:MimeContent");
          contentEl.textContent = btoa(item.syntheticMessage.toMessageString());
          messageEl.appendChild(contentEl);
        }
      }

      itemsEl.appendChild(messageEl);
    });

    return this.#serializer.serializeToString(resDoc);
  }

  /**
   * Add a new remote folder to the server to include in future responses.
   *
   * @param {RemoteFolder} folder
   */
  appendRemoteFolder(folder) {
    this.folders.push(folder);
    this.#idToFolder.set(folder.id, folder);
    if (folder.distinguishedId) {
      this.#distinguishedIdToFolder.set(folder.distinguishedId, folder);
    }
  }

  /**
   * Delete a remote folder given its id.
   *
   * @param {string} id
   */
  deleteRemoteFolderById(id) {
    const folderToDelete = this.folders.find(value => value.id == id);
    if (folderToDelete) {
      const indexOfDeletedFolder = this.folders.indexOf(folderToDelete);
      this.folders.splice(indexOfDeletedFolder, 1);
      this.#idToFolder.delete(folderToDelete.id);
      if (folderToDelete.distinguishedId) {
        this.#distinguishedIdToFolder.delete(folderToDelete.distinguishedId);
      }
      this.deletedFolders.push(folderToDelete);
    }
  }

  /**
   * Rename a folder given its id and a new name.
   *
   * @param {string} id
   * @param {string} newName
   */
  renameFolderById(id, newName) {
    const folder = this.#idToFolder.get(id);
    if (folder) {
      folder.displayName = newName;
      this.updatedFolderIds.push(id);
    }
  }

  /**
   * Change the parent folder of a folder.
   *
   * @param {string} id - The id of the folder to change the parent of.
   * @param {string} newParentId - The id of the new parent folder.
   */
  reparentFolderById(id, newParentId) {
    const childFolder = this.#idToFolder.get(id);
    if (!!childFolder && this.#idToFolder.has(newParentId)) {
      childFolder.parentId = newParentId;
      this.updatedFolderIds.push(id);
    }
  }

  /**
   * Add a new item to a folder or move an existing item to a new folder.
   *
   * If the given  `itemId` is already on the server, then it is moved
   * from its current location to the newly specified `folderId`. If the
   * given `itemId` does not yet exist on the server, it is added to the
   * specified `folderId`.
   *
   * @param {string} itemId
   * @param {string} folderId
   * @param {SyntheticMessage} [syntheticMessage] - Message data from
   *   MessageGenerator, if this item is a message.
   */
  addNewItemOrMoveItemToFolder(itemId, folderId, syntheticMessage) {
    let itemInfo = this.#itemIdToItemInfo.get(itemId);
    if (itemInfo) {
      itemInfo.parentId = folderId;
    } else {
      itemInfo = new ItemInfo(folderId, syntheticMessage);
    }
    this.#itemIdToItemInfo.set(itemId, itemInfo);
  }

  /**
   * Get the id of the folder containing the item with the given id.
   *
   * @param {string} itemId
   */
  getContainingFolderId(itemId) {
    return this.#itemIdToItemInfo.get(itemId).parentId;
  }

  /**
   * Construct a response for the EWS Move[Item,Folder] operations.
   *
   * @param {string} responseBase The response document base XML.
   * @param {string} responseMessageElementName The name of the top level response message element.
   * @param {string} collectionElementName The name of the element containing the collection of response objects.
   * @param {string} objectElementName The name of the element containing individual response objects.
   * @param {string} idElementName The name of the element containing response object ids.
   * @param {[string]} ids The EWS IDs to place in the document.
   * @returns {XMLDocument} The response document for the request.
   */
  #buildGenericMoveResponse(
    responseBase,
    responseMessageElementName,
    collectionElementName,
    objectElementName,
    idElementName,
    ids
  ) {
    const resDoc = this.#parser.parseFromString(responseBase, "text/xml");

    this.#setVersion(resDoc);

    const responseMessagesEl =
      resDoc.getElementsByTagName("m:ResponseMessages")[0];

    // Response Message XML Structure:
    //    <[responseMessageElementName] ResponseClass="Success">
    //      <m:ResponseCode>NoError</m:ResponseCode>
    //      <[collectionElementName]>
    //        <[objectElementName]>
    //          <[idElementName] Id="asdf"/>
    //        </[objectElementName]>
    //      </[collectionElementName]>
    //    </[responseMessageElementName]>

    ids.forEach(id => {
      const responseMessageEl = resDoc.createElement(
        responseMessageElementName
      );
      responseMessageEl.setAttribute("ResponseClass", "Success");

      const responseCodeEl = resDoc.createElement("m:ResponseCode");
      responseCodeEl.textContent = "NoError";
      responseMessageEl.appendChild(responseCodeEl);

      const itemsEl = resDoc.createElement(collectionElementName);
      const messageEl = resDoc.createElement(objectElementName);
      const itemIdEl = resDoc.createElement(idElementName);
      itemIdEl.setAttribute("Id", id);
      messageEl.appendChild(itemIdEl);
      itemsEl.appendChild(messageEl);
      responseMessageEl.appendChild(itemsEl);

      responseMessagesEl.appendChild(responseMessageEl);
    });

    return resDoc;
  }
}

/**
 * Extract the ids for objects (items or folders) to move from a request.
 *
 * @param {XMLDocument} reqDoc The XML request document.
 * @param {string} collectionElementName The name of the XML element that contains the id collection.
 * @param {string} objectElementName The name of the XML element that contains each individual object.
 *
 * @returns {[string, [string]]} a pair containing the destination folder id in
 *                               the first element and the list of object IDs to
 *                               move in the second element.
 */
function extractMoveObjects(reqDoc, collectionElementName, objectElementName) {
  const destinationFolderId = reqDoc
    .getElementsByTagName("ToFolderId")[0]
    .getElementsByTagName("t:FolderId")[0]
    .getAttribute("Id");

  const objectIds = [
    ...reqDoc
      .getElementsByTagName(collectionElementName)[0]
      .getElementsByTagName(objectElementName),
  ].map(e => e.getAttribute("Id"));

  return [destinationFolderId, objectIds];
}
