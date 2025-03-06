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

// The base for a GetFolder operation request. Before sending, the server will
// populate `m:ResponseMessages`, with one message per requested folder.
const GET_FOLDER_RESPONSE_BASE = `${EWS_SOAP_HEAD}
    <m:GetFolderResponse xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"
                          xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                          xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
      <m:ResponseMessages>
      </m:ResponseMessages>
    </m:GetFolderResponse>
  ${EWS_SOAP_FOOT}`;

// The base for a SyncFolderHierarchy operation request. Before sending, the
// server will populate `m:Changes`, as well as add and populate a `m:SyncState`
// element.
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
 * A mock EWS server; an HTTP server capable of responding to EWS requests in a
 * limited capacity.
 */
export class EwsServer {
  #httpServer;
  /**
   * The folders registered on this EWS server.
   *
   * @type {RemoteFolder[]}
   */
  folders = [];

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

  constructor() {
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
  }

  /**
   * Stop listening for requests.
   */
  stop() {
    this.#httpServer.stop();
  }

  /**
   * The port this server is listening for new requests on.
   *
   * @type {number}
   */
  get port() {
    return this.#httpServer.identity.primaryPort;
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
      this.folders.push(folder);
      this.#idToFolder.set(folder.id, folder);
      if (folder.distinguishedId) {
        this.#distinguishedIdToFolder.set(folder.distinguishedId, folder);
      }
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
    // Read the request content and parse it as XML.
    const reqBytes = CommonUtils.readBytesFromInputStream(
      request.bodyInputStream
    );
    const reqDoc = this.#parser.parseFromString(reqBytes, "text/xml");

    // Generate a response based on the operation found in the request.
    let resBytes = "";
    if (reqDoc.getElementsByTagName("SyncFolderHierarchy").length) {
      resBytes = this.#generateSyncFolderHierarchyResponse(reqDoc);
    } else if (reqDoc.getElementsByTagName("GetFolder").length) {
      resBytes = this.#generateGetFolderResponse(reqDoc);
    } else {
      throw new Error("Unexpected EWS operation");
    }
    // Send the response.
    response.bodyOutputStream.write(resBytes, resBytes.length);
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
}
