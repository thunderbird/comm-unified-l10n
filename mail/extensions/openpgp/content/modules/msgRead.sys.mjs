/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* eslint-enable valid-jsdoc */

/**
 * OpenPGP message reading related functions.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  EnigmailFuncs: "chrome://openpgp/content/modules/funcs.sys.mjs",
});

export var EnigmailMsgRead = {
  /**
   * Ensure that Thunderbird prepares certain headers during message reading
   */
  ensureExtraAddonHeaders() {
    const prefName = "mailnews.headers.extraAddonHeaders";
    let hdr = Services.prefs.getCharPref(prefName);

    if (hdr !== "*") {
      let modified = false;
      // do nothing if extraAddonHeaders is "*" (all headers)
      for (const h of ["autocrypt", "openpgp"]) {
        if (hdr.search(h) < 0) {
          if (hdr.length > 0) {
            hdr += " ";
          }
          hdr += h;
          modified = true;
        }
      }
      if (modified) {
        Services.prefs.setCharPref(prefName, hdr);
      }
    }
  },

  /**
   * Get a mail URL from a uriSpec
   *
   * @param {string} uriSpec - URI of the desired message.
   *
   * @returns {nsIURI|nsIMsgMailNewsUrl|null}
   */
  getUrlFromUriSpec(uriSpec) {
    return lazy.EnigmailFuncs.getUrlFromUriSpec(uriSpec);
  },

  /**
   * Determine if an we seem to have a signature included along side the
   * actual attachment.
   * That is, for an attachment:
   *  - foo.txt we should have a file foo.txt.sig or foo.txt.asc
   *  - foo.pgp we should have a file
   *     A) foo.sig or foo.asc or
   *     B) foo.pgp.sig or foo.pgp.asc
   *  - contentType is application/pgp-signature and the name is the same
   *
   * @param {AttachmentInfo} attachment - Attachment to check.
   * @param {AttachmentInfo[]} currentAttachments - The list of attachments in
   *   the mail.
   * @returns {?AttachmentInfo} The detached signature attachment, if any.
   */
  checkSignedAttachment(attachment, currentAttachments) {
    const baseName = attachment.name.replace(/\.pgp$/, "");
    const signatureRegex = new RegExp(
      `^${RegExp.escape(baseName)}(\\.pgp)?\\.(sig|asc)$`,
      "i"
    );
    return currentAttachments.find(
      a =>
        a !== attachment &&
        (signatureRegex.test(a.name) ||
          (a.contentType == "application/pgp-signature" &&
            a.name == attachment.name))
    );
  },

  searchQuotedPgp(node) {
    if (
      node.nodeName.toLowerCase() === "blockquote" &&
      node.textContent.includes("-----BEGIN PGP ")
    ) {
      return true;
    }

    if (node.firstChild && this.searchQuotedPgp(node.firstChild)) {
      return true;
    }

    if (node.nextSibling && this.searchQuotedPgp(node.nextSibling)) {
      return true;
    }

    return false;
  },
};
