/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const EXPORTED_SYMBOLS = [
  "gMockCloudfileManager",
  "MockCloudfileAccount",
  "getFile",
  "collectFiles",
];

var fdh = ChromeUtils.import(
  "resource://testing-common/mozmill/FolderDisplayHelpers.jsm"
);

var { Assert } = ChromeUtils.import("resource://testing-common/Assert.jsm");
var { cloudFileAccounts } = ChromeUtils.import(
  "resource:///modules/cloudFileAccounts.jsm"
);
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

var kDefaults = {
  type: "default",
  displayName: "default",
  iconURL: "chrome://messenger/content/extension.svg",
  accountKey: null,
  managementURL: "",
  authErr: cloudFileAccounts.constants.authErr,
  offlineErr: cloudFileAccounts.constants.offlineErr,
  uploadErr: cloudFileAccounts.constants.uploadErr,
  uploadWouldExceedQuota: cloudFileAccounts.constants.uploadWouldExceedQuota,
  uploadExceedsFileLimit: cloudFileAccounts.constants.uploadExceedsFileLimit,
  uploadCancelled: cloudFileAccounts.constants.uploadCancelled,
};

function getFile(aFilename, aRoot) {
  var file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  file.initWithPath(aRoot);
  file.append(aFilename);
  Assert.ok(file.exists, "File " + aFilename + " does not exist.");
  return file;
}

/**
 * Helper function for getting the nsIFile's for some files located
 * in a subdirectory of the test directory.
 *
 * @param aFiles an array of filename strings for files underneath the test
 *               file directory.
 * @param aFileRoot the file who's parent directory we should start looking
 *                  for aFiles in.
 *
 * Example:
 * let files = collectFiles(['./data/testFile1', './data/testFile2'],
 *                          __file__);
 */
function collectFiles(aFiles, aFileRoot) {
  return aFiles.map(filename => getFile(filename, aFileRoot));
}

function MockCloudfileAccount() {
  for (let someDefault in kDefaults) {
    this[someDefault] = kDefaults[someDefault];
  }
}

MockCloudfileAccount.prototype = {
  nextId: 1,
  _uploads: new Map(),

  init(aAccountKey, aOverrides = {}) {
    for (let override in aOverrides) {
      this[override] = aOverrides[override];
    }
    this.accountKey = aAccountKey;

    Services.prefs.setCharPref(
      "mail.cloud_files.accounts." + aAccountKey + ".displayName",
      aAccountKey
    );
    Services.prefs.setCharPref(
      "mail.cloud_files.accounts." + aAccountKey + ".type",
      aAccountKey
    );
  },

  renameFile(window, uploadId, newName) {
    if (this.renameError) {
      throw this.renameError;
    }

    let upload = this._uploads.get(uploadId);
    upload.url = `http://www.example.com/${this.accountKey}/${newName}`;
    upload.name = newName;
    return upload;
  },

  uploadFile(window, aFile) {
    if (this.uploadError) {
      return Promise.reject(this.uploadError);
    }

    return new Promise((resolve, reject) => {
      let upload = {
        // Values used in the WebExtension CloudFile type.
        id: this.nextId++,
        url: this.urlForFile(aFile),
        name: aFile.leafName,
        // Properties of the local file.
        leafName: aFile.leafName,
        path: aFile.path,
        // Use aOverrides to set these.
        serviceIcon: this.serviceIcon || this.iconURL,
        serviceName: this.serviceName || this.displayName,
        serviceURL: this.serviceURL || "",
      };
      this._uploads.set(upload.id, upload);
      gMockCloudfileManager.inProgressUploads.add({
        resolve,
        reject,
        resolveData: upload,
      });
    });
  },

  urlForFile(aFile) {
    return `http://www.example.com/${this.accountKey}/${aFile.leafName}`;
  },

  cancelFileUpload(window, aUploadId) {
    throw Components.Exception("", Cr.NS_ERROR_NOT_IMPLEMENTED);
  },

  deleteFile(window, aUploadId) {
    return new Promise(resolve => fdh.mc.window.setTimeout(resolve));
  },
};

var gMockCloudfileManager = {
  _mock_map: {},

  register(aID, aOverrides) {
    if (!aID) {
      aID = "default";
    }

    if (!aOverrides) {
      aOverrides = {};
    }

    cloudFileAccounts.registerProvider(aID, {
      type: aID,
      displayName: aID,
      iconURL: "chrome://messenger/content/extension.svg",
      initAccount(accountKey, aAccountOverrides = {}) {
        let account = new MockCloudfileAccount();
        for (let override in aOverrides) {
          if (!aAccountOverrides.hasOwnProperty(override)) {
            aAccountOverrides[override] = aOverrides[override];
          }
        }
        account.init(accountKey, aAccountOverrides);
        return account;
      },
    });
  },

  unregister(aID) {
    if (!aID) {
      aID = "default";
    }

    cloudFileAccounts.unregisterProvider(aID);
  },

  inProgressUploads: new Set(),
  resolveUploads() {
    let uploads = [];
    for (let upload of this.inProgressUploads.values()) {
      uploads.push(upload.resolveData);
      upload.resolve(upload.resolveData);
    }
    this.inProgressUploads.clear();
    return uploads;
  },
  rejectUploads() {
    for (let upload of this.inProgressUploads.values()) {
      upload.reject(
        Components.Exception(
          "Upload error.",
          cloudFileAccounts.constants.uploadErr
        )
      );
    }
    this.inProgressUploads.clear();
  },
};
