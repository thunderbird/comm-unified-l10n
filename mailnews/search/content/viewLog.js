/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var { MailE10SUtils } = ChromeUtils.importESModule(
  "resource:///modules/MailE10SUtils.sys.mjs"
);
var { UIFontSize } = ChromeUtils.importESModule(
  "resource:///modules/UIFontSize.sys.mjs"
);

var gFilterList;
var gLogFilters;
var gLogView;

window.addEventListener("DOMContentLoaded", onLoad);

function onLoad() {
  gFilterList = window.arguments[0].filterList;

  gLogFilters = document.getElementById("logFilters");
  gLogFilters.checked = gFilterList.loggingEnabled;

  gLogView = document.getElementById("logView");

  // for security, disable JS
  gLogView.browsingContext.allowJavascript = false;

  MailE10SUtils.loadURI(gLogView, gFilterList.logURL);

  UIFontSize.registerWindow(window);
}

function toggleLogFilters() {
  gFilterList.loggingEnabled = gLogFilters.checked;
}

function clearLog() {
  gFilterList.clearLog();

  // reload the newly truncated file
  gLogView.reload();
}
