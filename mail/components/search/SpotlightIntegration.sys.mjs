/* -*- Mode: JavaScript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { MailUtils } from "resource:///modules/MailUtils.sys.mjs";
import {
  SearchSupport,
  StreamListenerBase,
} from "resource:///modules/SearchSupport.sys.mjs";

const gFileHeader =
  '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.\ncom/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>';

class SpotlightStreamListener extends StreamListenerBase {
  /**
   * Buffer to store the message
   */
  #message = null;

  /**
   * Encodes reserved XML characters
   */
  #xmlEscapeString(str) {
    return str.replace(/[<>&]/g, function (s) {
      switch (s) {
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case "&":
          return "&amp;";
        default:
          throw new Error(`Unexpected match: ${s}`);
      }
    });
  }

  onStartRequest() {
    try {
      const outputFileStream = Cc[
        "@mozilla.org/network/file-output-stream;1"
      ].createInstance(Ci.nsIFileOutputStream);
      outputFileStream.init(this._outputFile, -1, -1, 0);
      this._outputStream = Cc[
        "@mozilla.org/intl/converter-output-stream;1"
      ].createInstance(Ci.nsIConverterOutputStream);
      this._outputStream.init(outputFileStream, "UTF-8");

      this._outputStream.writeString(gFileHeader);
      this._outputStream.writeString("<key>kMDItemLastUsedDate</key><string>");
      // need to write the date as a string
      const curTimeStr = new Date().toLocaleString();
      this._outputStream.writeString(curTimeStr);

      // need to write the subject in utf8 as the title
      this._outputStream.writeString(
        "</string>\n<key>kMDItemTitle</key>\n<string>"
      );

      const escapedSubject = this.#xmlEscapeString(
        this._msgHdr.mime2DecodedSubject
      );
      this._outputStream.writeString(escapedSubject);

      this._outputStream.writeString(
        "</string>\n<key>kMDItemDisplayName</key>\n<string>"
      );
      this._outputStream.writeString(escapedSubject);

      this._outputStream.writeString(
        "</string>\n<key>kMDItemTextContent</key>\n<string>"
      );
      this._outputStream.writeString(
        this.#xmlEscapeString(this._msgHdr.mime2DecodedAuthor)
      );
      this._outputStream.writeString(
        this.#xmlEscapeString(this._msgHdr.mime2DecodedRecipients)
      );

      this._outputStream.writeString(escapedSubject);
      this._outputStream.writeString(" ");
    } catch (ex) {
      this._onDoneStreaming(false);
    }
  }

  onStopRequest() {
    try {
      // we want to write out the from, to, cc, and subject headers into the
      // Text Content value, so they'll be indexed.
      const stringStream = Cc[
        "@mozilla.org/io/string-input-stream;1"
      ].createInstance(Ci.nsIStringInputStream);
      stringStream.setByteStringData(this.#message);
      const folder = this._msgHdr.folder;
      let text = folder.getMsgTextFromStream(
        stringStream,
        this._msgHdr.charset,
        20000,
        20000,
        false,
        true,
        {}
      );
      text = this.#xmlEscapeString(text);
      this._searchIntegration._log.debug(
        "escaped text = *****************\n" + text
      );
      this._outputStream.writeString(text);
      // close out the content, dict, and plist
      this._outputStream.writeString("</string>\n</dict>\n</plist>\n");

      this._msgHdr.setUint32Property(
        this._searchIntegration._hdrIndexedProperty,
        this._reindexTime
      );
      folder.msgDatabase.commit(Ci.nsMsgDBCommitType.kLargeCommit);

      this._message = "";
    } catch (ex) {
      this._searchIntegration._log.error(ex);
      this._onDoneStreaming(false);
      return;
    }
    this._onDoneStreaming(true);
  }

  onDataAvailable(request, inputStream, offset, count) {
    try {
      const inStream = Cc[
        "@mozilla.org/scriptableinputstream;1"
      ].createInstance(Ci.nsIScriptableInputStream);
      inStream.init(inputStream);

      // It is necessary to read in data from the input stream
      const inData = inStream.read(count);

      // ignore stuff after the first 20K or so
      if (this.#message && this.#message.length > 20000) {
        return;
      }

      this.#message += inData;
    } catch (ex) {
      this._searchIntegration._log.error(ex);
      this._onDoneStreaming(false);
    }
  }
}

export class SearchIntegration extends SearchSupport {
  #profileDir = null; // The user's profile dir.
  #metadataDir = null;

  constructor() {
    super();
    this.#profileDir = Services.dirsvc.get("ProfD", Ci.nsIFile);

    this.#metadataDir = Services.dirsvc.get("Home", Ci.nsIFile);
    this.#metadataDir.append("Library");
    this.#metadataDir.append("Caches");
    this.#metadataDir.append("Metadata");
    this.#metadataDir.append("Thunderbird");

    this._initLogging();

    const enabled = this._prefBranch.getBoolPref("enable", false);
    if (enabled) {
      this._log.info("Initializing Spotlight integration");
    }
    this._initSupport(enabled);
  }

  // The property of the header and (sometimes) folders that's used to check
  // if a message is indexed
  _hdrIndexedProperty = "spotlight_reindex_time";

  // The file extension that is used for support files of this component
  _fileExt = ".mozeml";

  // The Spotlight pref base
  _prefBase = "mail.spotlight.";

  // Spotlight won't index files in the profile dir, but will use ~/Library/Caches/Metadata
  _getSearchPathForFolder(aFolder) {
    // Swap the metadata dir for the profile dir prefix in the folder's path
    const folderPath = aFolder.filePath.path;
    const fixedPath = folderPath.replace(
      this.#profileDir.path,
      this.#metadataDir.path
    );
    const searchPath = Cc["@mozilla.org/file/local;1"].createInstance(
      Ci.nsIFile
    );
    searchPath.initWithPath(fixedPath);
    return searchPath;
  }

  // Replace ~/Library/Caches/Metadata with the profile directory, then convert
  _getFolderForSearchPath(aPath) {
    const folderPath = aPath.path.replace(
      this.#metadataDir.path,
      this.#profileDir.path
    );
    const folderFile = Cc["@mozilla.org/file/local;1"].createInstance(
      Ci.nsIFile
    );
    folderFile.initWithPath(folderPath);
    return MailUtils.getFolderForFileInProfile(folderFile);
  }

  _pathNeedsReindexing(aPath) {
    // We used to set permissions incorrectly (see bug 670566).
    const PERM_DIRECTORY = parseInt("0755", 8);
    if (aPath.permissions != PERM_DIRECTORY) {
      aPath.permissions = PERM_DIRECTORY;
      return true;
    }
    return false;
  }

  /**
   * These two functions won't do anything, as Spotlight integration is handled
   * using Info.plist files
   */
  register() {
    return true;
  }

  deregister() {
    return true;
  }

  // The stream listener to read messages
  _streamListener = new SpotlightStreamListener(this);
}
