/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * This file contains helper methods for dealing with nsIMsgFolders.
 */

const OUTGOING_FOLDER_FLAGS =
  Ci.nsMsgFolderFlags.SentMail |
  Ci.nsMsgFolderFlags.Drafts |
  Ci.nsMsgFolderFlags.Queue |
  Ci.nsMsgFolderFlags.Templates;

const ONE_MONTH_IN_MILLISECONDS = 31 * 24 * 60 * 60 * 1000;

export var FolderUtils = {
  allAccountsSorted,
  folderNameCompare,
  getFolderIcon,
  getFolderProperties,
  getMostRecentFolders,
  getSpecialFolderString,
  canRenameDeleteJunkMail,
  isSmartTagsFolder,
  isSmartVirtualFolder,
  ONE_MONTH_IN_MILLISECONDS,
  OUTGOING_FOLDER_FLAGS,
};

import { MailServices } from "resource:///modules/MailServices.sys.mjs";

/**
 * Returns a string representation of a folder's "special" type.
 *
 * @param {nsIMsgFolder} aFolder - The folder whose special type to return.
 * @returns {string} the special type of the folder.
 */
function getSpecialFolderString(aFolder) {
  const flags = aFolder.flags;
  if (flags & Ci.nsMsgFolderFlags.Inbox) {
    return "Inbox";
  }
  if (flags & Ci.nsMsgFolderFlags.Trash) {
    return "Trash";
  }
  if (flags & Ci.nsMsgFolderFlags.Queue) {
    return "Outbox";
  }
  if (flags & Ci.nsMsgFolderFlags.SentMail) {
    return "Sent";
  }
  if (flags & Ci.nsMsgFolderFlags.Drafts) {
    return "Drafts";
  }
  if (flags & Ci.nsMsgFolderFlags.Templates) {
    return "Templates";
  }
  if (flags & Ci.nsMsgFolderFlags.Junk) {
    return "Junk";
  }
  if (flags & Ci.nsMsgFolderFlags.Archive) {
    return "Archive";
  }
  if (flags & Ci.nsMsgFolderFlags.Virtual) {
    return "Virtual";
  }
  return "none";
}

/**
 * This function is meant to be used with trees. It returns the property list
 * for all of the common properties that css styling is based off of.
 *
 * @param {nsIMsgFolder} aFolder - The folder whose properties should be
 *   returned as a string.
 * @param {boolean} aOpen - Whether the folder is open (not expanded).
 *
 * @returns {string} A string of the property names, delimited by space.
 */
function getFolderProperties(aFolder, aOpen) {
  const properties = [];

  properties.push("folderNameCol");

  properties.push("serverType-" + aFolder.server.type);

  // set the SpecialFolder attribute
  properties.push("specialFolder-" + getSpecialFolderString(aFolder));

  // Now set the biffState
  switch (aFolder.biffState) {
    case Ci.nsIMsgFolder.nsMsgBiffState_NewMail:
      properties.push("biffState-NewMail");
      break;
    case Ci.nsIMsgFolder.nsMsgBiffState_NoMail:
      properties.push("biffState-NoMail");
      break;
    default:
      properties.push("biffState-UnknownMail");
  }

  properties.push("isSecure-" + aFolder.server.isSecure);

  // A folder has new messages, or a closed folder or any subfolder has new messages.
  if (
    aFolder.hasNewMessages ||
    (!aOpen && aFolder.hasSubFolders && aFolder.hasFolderOrSubfolderNewMessages)
  ) {
    properties.push("newMessages-true");
  }

  if (aFolder.isServer) {
    properties.push("isServer-true");
  } else {
    // We only set this if we're not a server
    let shallowUnread = aFolder.getNumUnread(false);
    if (shallowUnread > 0) {
      properties.push("hasUnreadMessages-true");
    } else {
      // Make sure that shallowUnread isn't negative
      shallowUnread = 0;
    }
    const deepUnread = aFolder.getNumUnread(true);
    if (deepUnread - shallowUnread > 0) {
      properties.push("subfoldersHaveUnreadMessages-true");
    }
  }

  properties.push("noSelect-" + aFolder.noSelect);
  properties.push("imapShared-" + aFolder.imapShared);

  return properties.join(" ");
}

/**
 * Returns a list of accounts sorted by server type.
 *
 * @param {boolean} aExcludeIMAccounts - Remove IM accounts from the list?
 */
function allAccountsSorted(aExcludeIMAccounts) {
  // This is a HACK to work around bug 41133. If we have one of the
  // dummy "news" accounts there, that account won't have an
  // incomingServer attached to it, and everything will blow up.
  let accountList = MailServices.accounts.accounts.filter(
    a => a.incomingServer
  );

  // Remove IM servers.
  if (aExcludeIMAccounts) {
    accountList = accountList.filter(a => a.incomingServer.type != "im");
  }

  return accountList;
}

/**
 * Returns the most recently used/modified folders from the passed in list,
 * sorted by recentness.
 *
 * @param {nsIMsgFolder[]} aFolderList - The array of folders to search
 *   for recent folders.
 * @param {integer} aMaxHits - How many folders to return.
 * @param {"MRMTime"|"MRUTime"} aTimeProperty - Which folder time property to
 *   use. Use "MRMTime" for most recently modified time.
 *   Use "MRUTime" for most recently used time.
 */
function getMostRecentFolders(aFolderList, aMaxHits, aTimeProperty) {
  const recentFolders = [];
  const monthOld = Math.floor((Date.now() - ONE_MONTH_IN_MILLISECONDS) / 1000);

  /**
   * This sub-function will add a folder to the recentFolders array if it
   * is among the aMaxHits most recent. If we exceed aMaxHits folders,
   * it will pop the oldest folder, ensuring that we end up with the
   * right number.
   *
   * @param {nsIMsgFolders} aFolder - The folder to check for recency.
   */
  function addIfRecent(aFolder) {
    let time = 0;
    try {
      time = Number(aFolder.getStringProperty(aTimeProperty)) || 0;
    } catch (e) {}
    if (time < monthOld) {
      return;
    }
    recentFolders.push({ folder: aFolder, time });
  }

  for (const folder of aFolderList) {
    addIfRecent(folder);
  }

  recentFolders.sort((a, b) => b.time - a.time);
  return recentFolders.slice(0, aMaxHits).map(f => f.folder);
}

/**
 * A locale dependent comparison function to produce a case-insensitive sort order
 * used to sort folder names.
 *
 * @param {string} aString1 - First string to compare.
 * @param {string} aString2 - Second string to compare.
 * @returns {interger} A positive number if aString1 > aString2,
 *    negative number if aString1 > aString2, otherwise 0.
 */
function folderNameCompare(aString1, aString2) {
  // TODO: improve this as described in bug 992651.
  return aString1
    .toLocaleLowerCase()
    .localeCompare(aString2.toLocaleLowerCase());
}

/**
 * Get the icon to use for this folder.
 *
 * @param {?nsIMsgFolder} folder - The folder to get icon for, if provided.
 * @returns {string} URL of suitable icon.
 */
function getFolderIcon(folder) {
  if (!folder) {
    return "chrome://messenger/skin/icons/new/compact/folder.svg";
  }

  let iconName;
  if (folder.isServer) {
    switch (folder.server.type) {
      case "nntp":
        iconName = folder.server.isSecure ? "globe-secure.svg" : "globe.svg";
        break;
      case "imap":
      case "pop":
        iconName = folder.server.isSecure ? "mail-secure.svg" : "mail.svg";
        break;
      case "none":
        iconName = "folder.svg";
        break;
      case "rss":
        iconName = "rss.svg";
        break;
      default:
        iconName = "mail.svg";
        break;
    }
  } else if (folder.server?.type == "nntp") {
    iconName = "newsletter.svg";
  } else {
    switch (getSpecialFolderString(folder)) {
      case "Virtual":
        if (isSmartTagsFolder(folder)) {
          iconName = "tag.svg";
        } else {
          iconName = "folder-filter.svg";
        }
        break;
      case "Junk":
        iconName = "spam.svg";
        break;
      case "Templates":
        iconName = "template.svg";
        break;
      case "Archive":
        iconName = "archive.svg";
        break;
      case "Trash":
        iconName = "trash.svg";
        break;
      case "Drafts":
        iconName = "draft.svg";
        break;
      case "Outbox":
        iconName = "outbox.svg";
        break;
      case "Sent":
        iconName = "sent.svg";
        break;
      case "Inbox":
        iconName = "inbox.svg";
        break;
      default:
        iconName = "folder.svg";
        break;
    }
  }

  return `chrome://messenger/skin/icons/new/compact/${iconName}`;
}

/**
 * Checks if `folder` is a virtual folder for the Unified Folders pane mode.
 *
 * @param {nsIMsgFolder} folder
 * @returns {boolean}
 */
function isSmartVirtualFolder(folder) {
  return (
    folder.isSpecialFolder(Ci.nsMsgFolderFlags.Virtual) &&
    folder.server.hostName == "smart mailboxes" &&
    folder.parent?.isServer
  );
}

/**
 * Checks if `folder` is a virtual folder for the Tags folder pane mode.
 *
 * @param {nsIMsgFolder} folder
 * @returns {boolean}
 */
function isSmartTagsFolder(folder) {
  return (
    folder.isSpecialFolder(Ci.nsMsgFolderFlags.Virtual) &&
    folder.server.hostName == "smart mailboxes" &&
    folder.parent?.name == "tags"
  );
}

/**
 * Checks if the configured junk mail can be renamed or deleted.
 *
 * @param {string} aFolderUri
 */
function canRenameDeleteJunkMail(aFolderUri) {
  // Go through junk mail settings for all servers and see if the folder is set/used by anyone.
  for (const server of MailServices.accounts.allServers) {
    const settings = server.spamSettings;
    // If junk mail control or move junk mail to folder option is disabled then
    // allow the folder to be removed/renamed since the folder is not used in this case.
    if (!settings.level || !settings.moveOnSpam) {
      continue;
    }
    if (settings.spamFolderURI == aFolderUri) {
      return false;
    }
  }

  return true;
}
