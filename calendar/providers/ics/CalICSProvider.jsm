/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["CalICSProvider"];

var { OS } = ChromeUtils.import("resource://gre/modules/osfile.jsm");
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { setTimeout } = ChromeUtils.import("resource://gre/modules/Timer.jsm");

var { cal } = ChromeUtils.import("resource:///modules/calendar/calUtils.jsm");
var { Autodetect } = ChromeUtils.import("resource:///modules/calendar/calAutodetect.jsm");

var { CalDavGenericRequest, CalDavPropfindRequest } = ChromeUtils.import(
  "resource:///modules/caldav/CalDavRequest.jsm"
);

// NOTE: This module should not be loaded directly, it is available when
// including calUtils.jsm under the cal.provider.ics namespace.

/**
 * @implements {calICalendarProvider}
 */
var CalICSProvider = {
  get type() {
    return "ics";
  },

  get displayName() {
    return cal.l10n.getCalString("icsName");
  },

  createCalendar(aName, aUri, aListener) {
    throw Components.Exception("", Cr.NS_ERROR_NOT_IMPLEMENTED);
  },

  deleteCalendar(aCalendar, aListener) {
    throw Components.Exception("", Cr.NS_ERROR_NOT_IMPLEMENTED);
  },

  getCalendar(aUri) {
    return cal.getCalendarManager().createCalendar("ics", aUri);
  },

  async autodetect(
    username,
    password,
    location = null,
    savePassword = false,
    extraProperties = {}
  ) {
    let uri = Autodetect.locationToUri(location);
    if (!uri) {
      throw new Error("Could not infer location from username");
    }

    let detector = new ICSAutodetector(username, password, savePassword);

    for (let method of [
      "attemptDAVLocation",
      "attemptLocation",
      "attemptPut",
      "attemptLocalFile",
    ]) {
      try {
        cal.LOG(`[calICSProvider] Trying to detect calendar using ${method} method`);
        let calendars = await detector[method](uri);
        if (calendars) {
          return calendars;
        }
      } catch (e) {
        cal.WARN(
          "[calICSProvider] Could not detect calendar using method " +
            `${method} - ${e.filename || e.fileName}:${e.lineNumber}: ${e}`
        );

        // We want to pass on any autodetect errors that will become results.
        if (e instanceof Autodetect.Error) {
          throw e;
        }
      }
    }
    return [];
  },
};

/**
 * Used by the CalICSProvider to detect ICS calendars for a given username,
 * password, location, etc.
 *
 * @implements {nsIAuthPrompt2}
 * @implements {nsIAuthPromptProvider}
 * @implements {nsIInterfaceRequestor}
 */
class ICSAutodetectSession {
  QueryInterface = ChromeUtils.generateQI([
    Ci.nsIAuthPrompt2,
    Ci.nsIAuthPromptProvider,
    Ci.nsIInterfaceRequestor,
  ]);

  /**
   * Create a new ICS autodetect session.
   *
   * @param {string} aSessionId       The session id, used in the password manager.
   * @param {string} aName            The user-readable description of this session.
   * @param {string} aPassword        The password for the session.
   * @param {boolean} aSavePassword   Whether to save the password.
   */
  constructor(aSessionId, aUserName, aPassword, aSavePassword) {
    this.id = aSessionId;
    this.name = aUserName;
    this.password = aPassword;
    this.savePassword = aSavePassword;
  }

  /**
   * Implement nsIInterfaceRequestor.
   *
   * @param {nsIIDRef} aIID                 The IID of the interface being requested.
   * @return {ICSAutodetectSession | null}  Either this object QI'd to the IID, or null.
   *                                          Components.returnCode is set accordingly.
   * @see {nsIInterfaceRequestor}
   */
  getInterface(aIID) {
    try {
      // Try to query the this object for the requested interface but don't
      // throw if it fails since that borks the network code.
      return this.QueryInterface(aIID);
    } catch (e) {
      Components.returnCode = e;
    }
    return null;
  }

  /**
   * @see {nsIAuthPromptProvider}
   */
  getAuthPrompt(aReason, aIID) {
    try {
      return this.QueryInterface(aIID);
    } catch (e) {
      throw Components.Exception("", Cr.NS_ERROR_NOT_AVAILABLE);
    }
  }

  /**
   * @see {nsIAuthPrompt2}
   */
  asyncPromptAuth(aChannel, aCallback, aContext, aLevel, aAuthInfo) {
    setTimeout(() => {
      if (this.promptAuth(aChannel, aLevel, aAuthInfo)) {
        aCallback.onAuthAvailable(aContext, aAuthInfo);
      } else {
        aCallback.onAuthCancelled(aContext, true);
      }
    }, 0);
  }

  /**
   * @see {nsIAuthPrompt2}
   */
  promptAuth(aChannel, aLevel, aAuthInfo) {
    if ((aAuthInfo.flags & aAuthInfo.PREVIOUS_FAILED) == 0) {
      aAuthInfo.username = this.name;
      aAuthInfo.password = this.password;

      if (this.savePassword) {
        cal.auth.passwordManagerSave(
          this.name,
          this.password,
          aChannel.URI.prePath,
          aAuthInfo.realm
        );
      }
      return true;
    }

    aAuthInfo.username = null;
    aAuthInfo.password = null;
    if (this.savePassword) {
      cal.auth.passwordManagerRemove(this.name, aChannel.URI.prePath, aAuthInfo.realm);
    }
    return false;
  }

  /** @see {CalDavSession} */
  async prepareRequest(aChannel) {}
  async prepareRedirect(aOldChannel, aNewChannel) {}
  async completeRequest(aResponse) {}
}

/**
 * Used by the CalICSProvider to detect ICS calendars for a given location,
 * username, password, etc. The protocol for detecting ICS calendars is DAV
 * (pure DAV, not CalDAV), but we use some of the CalDAV code here because the
 * code is not currently organized to handle pure DAV and CalDAV separately
 * (e.g. CalDavGenericRequest, CalDavPropfindRequest).
 */
class ICSAutodetector {
  /**
   * Create a new caldav autodetector.
   *
   * @param {string} username         A username.
   * @param {string} password         A password.
   * @param {boolean} savePassword    Whether to save the password or not.
   */
  constructor(username, password, savePassword) {
    this.session = new ICSAutodetectSession(cal.getUUID(), username, password, savePassword);
  }

  /**
   * Attempt to detect calendars at the given location using CalDAV PROPFIND.
   *
   * @param {nsIURI} location                   The location to attempt.
   * @return {Promise<calICalendar[] | null>}   An array of calendars or null.
   */
  async attemptDAVLocation(location) {
    let props = ["D:getcontenttype", "D:resourcetype", "D:displayname", "A:calendar-color"];
    let request = new CalDavPropfindRequest(this.session, null, location, props);
    let response = await request.commit();
    let target = response.uri;

    if (response.authError) {
      throw new Autodetect.AuthFailedError();
    } else if (!response.ok) {
      cal.LOG(`[calICSProvider] ${target.spec} did not respond properly to PROPFIND`);
      return null;
    }

    let resprops = response.firstProps;
    let resourceType = resprops["D:resourcetype"] || new Set();

    if (resourceType.has("C:calendar") || resprops["D:getcontenttype"] == "text/calendar") {
      cal.LOG(`[calICSProvider] ${target.spec} is a calendar`);
      return [this.handleCalendar(target, resprops["D:displayname"], resprops["A:calendar-color"])];
    } else if (resourceType.has("D:collection")) {
      return this.handleDirectory(target);
    }

    return null;
  }

  /**
   * Attempt to detect calendars at the given location using a CalDAV generic
   * request and "HEAD".
   *
   * @param {nsIURI} location                   The location to attempt.
   * @return {Promise<calICalendar[] | null>}   An array of calendars or null.
   */
  async attemptLocation(location) {
    let request = new CalDavGenericRequest(this.session, null, "HEAD", location);
    let response = await request.commit();
    let target = response.uri;

    if (response.ok && response.getHeader("Content-Type") == "text/calendar") {
      cal.LOG(`[calICSProvider] ${target.spec} has content type text/calendar`);
      return [this.handleCalendar(target)];
    }
    return null;
  }

  /**
   * Attempt to detect calendars at the given location using a CalDAV generic
   * request and "PUT".
   *
   * @param {nsIURI} location                   The location to attempt.
   * @return {Promise<calICalendar[] | null>}   An array of calendars or null.
   */
  async attemptPut(location) {
    let request = new CalDavGenericRequest(
      this.session,
      null,
      "PUT",
      location,
      { "If-Match": "nothing" },
      "",
      "text/plain"
    );
    let response = await request.commit();
    let target = response.uri;

    if (response.conflict) {
      // The etag didn't match, which means we can generally write here but our crafted etag
      // is stopping us. This means we can assume there is a calendar at the location.
      cal.LOG(
        `[calICSProvider] ${target.spec} responded to a dummy ETag request, we can` +
          " assume it is a valid calendar location"
      );
      return [this.handleCalendar(target)];
    }

    return null;
  }

  /**
   * Attempt to detect a calendar for a file URI (`file:///path/to/file.ics`).
   * If a directory in the path does not exist return null. Whether the file
   * exists or not, return a calendar for the location (the file will be
   * created if it does not exist).
   *
   * @param {nsIURI} location           The location to attempt.
   * @return {calICalendar[] | null}    An array containing a calendar or null.
   */
  async attemptLocalFile(location) {
    if (location.schemeIs("file")) {
      let fullPath = OS.Path.fromFileURI(location.spec);
      let pathToDir = OS.Path.dirname(fullPath);
      let dirExists = await OS.File.exists(pathToDir);

      if (dirExists || pathToDir == "") {
        let calendar = this.handleCalendar(location);
        if (calendar) {
          return [calendar];
        }
      } else {
        cal.LOG(`[calICSProvider] ${location.spec} includes a directory that does not exist`);
      }
    } else {
      cal.LOG(`[calICSProvider] ${location.spec} is not a "file" URI`);
    }
    return null;
  }

  /**
   * Utility function to make a new attempt to detect calendars after the
   * previous PROPFIND results contained "D:resourcetype" with "D:collection".
   *
   * @param {nsIURI} location                   The location to attempt.
   * @return {Promise<calICalendar[] | null>}   An array of calendars or null.
   */
  async handleDirectory(location) {
    let props = ["D:getcontenttype", "D:displayname", "A:calendar-color"];
    let request = new CalDavPropfindRequest(this.session, null, location, props, 1);
    let response = await request.commit();
    let target = response.uri;

    let calendars = [];
    for (let [href, resprops] of Object.entries(response.data)) {
      if (resprops["D:getcontenttype"] != "text/calendar") {
        continue;
      }

      let uri = Services.io.newURI(href, null, target);
      calendars.push(
        this.handleCalendar(uri, resprops["D:displayname"], resprops["A:calendar-color"])
      );
    }

    cal.LOG(`[calICSProvider] ${target.spec} is a directory, found ${calendars.length} calendars`);

    return calendars.length ? calendars : null;
  }

  /**
   * Set up and return a new ICS calendar object.
   *
   * @param {nsIURI} uri              The location of the calendar.
   * @param {string} [displayName]    The display name of the calendar.
   * @param {string} [color]          The color for the calendar.
   * @return {calICalendar}           A new calendar.
   */
  handleCalendar(uri, displayName, color) {
    if (!displayName) {
      let lastPath =
        uri.filePath
          .split("/")
          .filter(Boolean)
          .pop() || "";
      let fileName = lastPath
        .split(".")
        .slice(0, -1)
        .join(".");
      displayName = fileName || lastPath || uri.spec;
    }

    let calMgr = cal.getCalendarManager();
    let calendar = calMgr.createCalendar("ics", uri);
    calendar.setProperty("color", color || cal.view.hashColor(uri.spec));
    calendar.name = displayName;
    calendar.id = cal.getUUID();
    return calendar;
  }
}
