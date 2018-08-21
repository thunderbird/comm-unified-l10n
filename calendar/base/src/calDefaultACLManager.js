/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");
var { cal } = ChromeUtils.import("resource://calendar/modules/calUtils.jsm", null);

/* calDefaultACLManager */
function calDefaultACLManager() {
    this.mCalendarEntries = {};
}

calDefaultACLManager.prototype = {
    QueryInterface: ChromeUtils.generateQI([Ci.calICalendarACLManager]),
    classID: Components.ID("{7463258c-6ef3-40a2-89a9-bb349596e927}"),

    mCalendarEntries: null,

    /* calICalendarACLManager */
    _getCalendarEntryCached: function(aCalendar) {
        let calUri = aCalendar.uri.spec;
        if (!(calUri in this.mCalendarEntries)) {
            this.mCalendarEntries[calUri] = new calDefaultCalendarACLEntry(this, aCalendar);
        }

        return this.mCalendarEntries[calUri];
    },
    getCalendarEntry: function(aCalendar, aListener) {
        let entry = this._getCalendarEntryCached(aCalendar);
        aListener.onOperationComplete(aCalendar, Components.results.NS_OK,
                                      Components.interfaces.calIOperationListener.GET,
                                      null,
                                      entry);
    },
    getItemEntry: function(aItem) {
        let calEntry = this._getCalendarEntryCached(aItem.calendar);
        return new calDefaultItemACLEntry(calEntry);
    },

};

function calDefaultCalendarACLEntry(aMgr, aCalendar) {
    this.mACLManager = aMgr;
    this.mCalendar = aCalendar;
}

calDefaultCalendarACLEntry.prototype = {
    QueryInterface: ChromeUtils.generateQI([Ci.calICalendarACLEntry]),

    mACLManager: null,

    /* calICalendarACLCalendarEntry */
    get aclManager() {
        return this.mACLManager;
    },

    hasAccessControl: false,
    userIsOwner: true,
    userCanAddItems: true,
    userCanDeleteItems: true,

    _getIdentities: function(aCount) {
        let identities = [];
        cal.email.iterateIdentities(id => identities.push(id));
        aCount.value = identities.length;
        return identities;
    },

    getUserAddresses: function(aCount) {
        let identities = this.getUserIdentities(aCount);
        let addresses = identities.map(id => id.email);
        return addresses;
    },

    getUserIdentities: function(aCount) {
        let identity = cal.provider.getEmailIdentityOfCalendar(this.mCalendar);
        if (identity) {
            aCount.value = 1;
            return [identity];
        } else {
            return this._getIdentities(aCount);
        }
    },
    getOwnerIdentities: function(aCount) {
        return this._getIdentities(aCount);
    },

    refresh: function() {
    }
};

function calDefaultItemACLEntry(aCalendarEntry) {
    this.calendarEntry = aCalendarEntry;
}

calDefaultItemACLEntry.prototype = {
    QueryInterface: ChromeUtils.generateQI([Ci.calIItemACLEntry]),

    /* calIItemACLEntry */
    calendarEntry: null,
    userCanModify: true,
    userCanRespond: true,
    userCanViewAll: true,
    userCanViewDateAndTime: true,
};

/** Module Registration */
this.NSGetFactory = XPCOMUtils.generateNSGetFactory([calDefaultACLManager]);
