/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* import-globals-from preferences.js */

var gSyncPane = {
  init() {
    /* TODO: hook up Sync backend to front-end */
  },

  showSyncDialog() {
    gSubDialog.open("chrome://messenger/content/preferences/syncDialog.xhtml");
  },
};
