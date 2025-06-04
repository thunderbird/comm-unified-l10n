/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  EnigmailWindows: "chrome://openpgp/content/modules/windows.sys.mjs",
});

export var EnigmailDialog = {
  /**
   * Displays a dialog with success/failure information after importing keys.
   *
   * @param {window} win - Parent window to display modal dialog; can be null
   * @param {string[]} keyList - Imported keyIDs.
   * @returns {integer} the button number pressed. 0-2.
   *  -1: ESC or close window button pressed.
   */
  keyImportDlg(win, keyList) {
    var result = {
      value: -1,
      checked: false,
    };

    if (!win) {
      win = lazy.EnigmailWindows.getBestParentWin();
    }

    win.openDialog(
      "chrome://openpgp/content/ui/enigmailKeyImportInfo.xhtml",
      "",
      "chrome,dialog,modal,centerscreen,resizable",
      {
        keyList,
      },
      result
    );

    return result.value;
  },

  /**
   * Asks user to confirm the import of the given public keys.
   * User is allowed to automatically accept new/undecided keys.
   *
   * @param {nsIDOMWindow} parentWindow - Parent window.
   * @param {EnigmailKeyObj[]} keyPreview - Key details. See EnigmailKey.getKeyListFromKeyBlock().
   * @returns {?string} chosen acceptance. If cancelled: null.
   */
  confirmPubkeyImport(parentWindow, keyPreview) {
    const args = {
      keys: keyPreview,
      confirmed: false,
      acceptance: "",
    };

    parentWindow.browsingContext.topChromeWindow.openDialog(
      "chrome://openpgp/content/ui/confirmPubkeyImport.xhtml",
      "",
      "dialog,modal,centerscreen,resizable",
      args
    );

    if (!args.confirmed) {
      return null;
    }
    return args.acceptance;
  },
};
