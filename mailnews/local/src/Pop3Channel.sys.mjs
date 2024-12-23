/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { MailServices } from "resource:///modules/MailServices.sys.mjs";

/**
 * A channel to interact with POP3 server.
 *
 * @implements {nsIChannel}
 * @implements {nsIRequest}
 */
export class Pop3Channel {
  QueryInterface = ChromeUtils.generateQI(["nsIChannel", "nsIRequest"]);

  _logger = console.createInstance({
    prefix: "mailnews.pop3",
    maxLogLevel: "Warn",
    maxLogLevelPref: "mailnews.pop3.loglevel",
  });

  /**
   * @param {nsIURI} uri - The uri to construct the channel from.
   * @param {nsILoadInfo} loadInfo - The loadInfo associated with the channel.
   */
  constructor(uri, loadInfo) {
    this._server = MailServices.accounts
      .findServerByURI(uri)
      .QueryInterface(Ci.nsIPop3IncomingServer);

    // nsIChannel attributes.
    this.originalURI = uri;
    this.URI = uri;
    this.loadInfo = loadInfo;
    this.contentLength = 0;
    this._status = Cr.NS_OK;
  }

  /**
   * @see nsIRequest
   */
  get status() {
    return this._status;
  }

  /**
   * @see nsIChannel
   */
  get contentType() {
    return this._contentType || "message/rfc822";
  }

  set contentType(value) {
    this._contentType = value;
  }

  get isDocument() {
    return true;
  }

  open() {
    throw Components.Exception(
      "Pop3Channel.open() not implemented",
      Cr.NS_ERROR_NOT_IMPLEMENTED
    );
  }

  asyncOpen(listener) {
    this._logger.debug(`asyncOpen ${this.URI.spec}`);

    if (Services.io.offline) {
      throw Components.Exception(
        "The requested action could not be completed in the offline state",
        Cr.NS_ERROR_OFFLINE
      );
    }

    const match = this.URI.spec.match(/pop3?:\/\/.+\/(?:\?|&)uidl=([^&]+)/);
    const uidl = decodeURIComponent(match?.[1] || "");
    if (!uidl) {
      throw Components.Exception(
        `Unrecognized url=${this.URI.spec}`,
        Cr.NS_ERROR_ILLEGAL_VALUE
      );
    }

    this._server.wrappedJSObject.withClient(client => {
      client.runningUri = this.URI;
      client.onOpen = () => {
        listener.onStartRequest(this);
        client.fetchBodyForUidl(
          this.URI.QueryInterface(Ci.nsIPop3URL).pop3Sink,
          uidl
        );
      };
      client.onDone = status => {
        this._status = status;
        listener.onStopRequest(this, status);
      };
    });
  }
}
