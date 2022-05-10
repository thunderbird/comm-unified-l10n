/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Common functions for the imip-bar tests.
 *
 * Note that these tests are heavily tied to the properties of single-event.eml
 * and repeat-event.eml.
 */

"use strict";

var { cal } = ChromeUtils.import("resource:///modules/calendar/calUtils.jsm");
var { CalItipDefaultEmailTransport } = ChromeUtils.import(
  "resource:///modules/CalItipEmailTransport.jsm"
);
var { FileUtils } = ChromeUtils.import("resource://gre/modules/FileUtils.jsm");
var { MailServices } = ChromeUtils.import("resource:///modules/MailServices.jsm");

var { FileTestUtils } = ChromeUtils.import("resource://testing-common/FileTestUtils.jsm");
var { CalendarTestUtils } = ChromeUtils.import(
  "resource://testing-common/calendar/CalendarTestUtils.jsm"
);

registerCleanupFunction(() => {
  // Some tests that open new windows don't return focus to the main window
  // in a way that satisfies mochitest, and the test times out.
  Services.focus.focusedWindow = window;
  // Focus an element in the main window, then blur it again to avoid it
  // hijacking keypresses.
  let searchInput = document.getElementById("searchInput");
  searchInput.focus();
  searchInput.blur();
});

class EmailTransport extends CalItipDefaultEmailTransport {
  sentItems = [];

  sentMsgs = [];

  getMsgSend() {
    let { sentMsgs } = this;
    return {
      sendMessageFile(
        userIdentity,
        accountKey,
        composeFields,
        messageFile,
        deleteSendFileOnCompletion,
        digest,
        deliverMode,
        msgToReplace,
        listener,
        statusFeedback,
        smtpPassword
      ) {
        sentMsgs.push({
          userIdentity,
          accountKey,
          composeFields,
          messageFile,
          deleteSendFileOnCompletion,
          digest,
          deliverMode,
          msgToReplace,
          listener,
          statusFeedback,
          smtpPassword,
        });
      },
    };
  }

  sendItems(recipients, itipItem, fromAttendee) {
    this.sentItems.push({ recipients, itipItem, fromAttendee });
    return super.sendItems(recipients, itipItem, fromAttendee);
  }

  reset() {
    this.sentItems = [];
    this.sentMsgs = [];
  }
}

async function openMessageFromFile(file) {
  let fileURL = Services.io
    .newFileURI(file)
    .mutate()
    .setQuery("type=application/x-message-display")
    .finalize();

  let winPromise = BrowserTestUtils.domWindowOpenedAndLoaded();
  window.openDialog(
    "chrome://messenger/content/messageWindow.xhtml",
    "_blank",
    "all,chrome,dialog=no,status,toolbar",
    fileURL
  );
  let win = await winPromise;

  let browser = win.document.getElementById("messagepane");
  if (browser.webProgress?.isLoadingDocument || browser.currentURI?.spec == "about:blank") {
    await BrowserTestUtils.browserLoaded(browser);
  }

  await TestUtils.waitForCondition(() => Services.focus.activeWindow == win);
  return win;
}

/**
 * Opens an iMIP message file and waits for the imip-bar to appear.
 *
 * @param {nsIFile} file
 * @return {Window}
 */
async function openImipMessage(file) {
  let win = await openMessageFromFile(file);
  let imipBar = win.document.getElementById("imip-bar");
  await TestUtils.waitForCondition(() => !imipBar.collapsed, "imip-bar shown");
  return win;
}

/**
 * Clicks on one of the imip-bar action buttons.
 *
 * @param {Window} win
 * @param {string} id
 */
async function clickAction(win, id) {
  let action = win.document.getElementById(id);
  Assert.ok(!action.hidden, `button "#${id}" shown"`);

  EventUtils.synthesizeMouseAtCenter(action, {}, win);
  await TestUtils.waitForCondition(() => action.hidden, `button "#${id}" hidden`);
}

/**
 * Clicks on one of the imip-bar actions from a dropdown menu.
 *
 * @param {Window} win The window the imip message is opened in.
 * @param {string} buttonId The id of the <toolbarbutton> containing the menu.
 * @param {string} actionId The id of the menu item to click.
 */
async function clickMenuAction(win, buttonId, actionId) {
  let actionButton = win.document.getElementById(buttonId);
  Assert.ok(!actionButton.hidden, `"${buttonId}" shown`);

  let actionMenu = actionButton.querySelector("menupopup");
  let menuShown = BrowserTestUtils.waitForEvent(actionMenu, "popupshown");
  EventUtils.synthesizeMouseAtCenter(actionButton.querySelector("dropmarker"), {}, win);
  await menuShown;
  EventUtils.synthesizeMouseAtCenter(win.document.getElementById(actionId), {}, win);
  await TestUtils.waitForCondition(() => actionButton.hidden, `action menu "#${buttonId}" hidden`);
}

const unpromotedProps = ["location", "description", "sequence", "x-moz-received-dtstamp"];

/**
 * An object where the keys are paths and the values the values they lead to
 * in an object we want to test for correctness.
 * @typedef {Object} Comparable
 */

/**
 * Compares the paths specified in the expected object against the provided
 * actual object.
 *
 * @param {object} actual This is expected to be a calIEvent or calIAttendee but
 *   can also be an array of both etc.
 * @param {Comparable} expected
 */
function compareProperties(actual, expected, prefix = "") {
  Assert.equal(typeof actual, "object", `${prefix || "provided value"} is an object`);
  for (let [key, value] of Object.entries(expected)) {
    if (key.includes(".")) {
      let keys = key.split(".");
      let head = keys[0];
      let tail = keys.slice(1).join(".");
      compareProperties(actual[head], { [tail]: value }, [prefix, head].filter(k => k).join("."));
      continue;
    }

    let path = [prefix, key].filter(k => k).join(".");
    let actualValue = unpromotedProps.includes(key) ? actual.getProperty(key) : actual[key];
    Assert.equal(actualValue, value, `property "${path}" is "${value}"`);
  }
}

/**
 * Tests that an attempt to reply to the organizer of the event with the correct
 * details occurred.
 *
 * @param {EmailTransport} transport
 * @param {nsIdentity} identity
 * @param {string} partStat
 */
async function doReplyTest(transport, identity, partStat) {
  info("Verifying the attempt to send a response uses the correct data");
  Assert.equal(transport.sentItems.length, 1, "itip subsystem attempted to send a response");
  compareProperties(transport.sentItems[0], {
    "recipients.0.id": "mailto:sender@example.com",
    "itipItem.responseMethod": "REPLY",
    "fromAttendee.id": "mailto:receiver@example.com",
    "fromAttendee.participationStatus": partStat,
  });

  // The itipItem is used to generate the iTIP data in the message body.
  info("Verifying the reply calItipItem attendee list");
  let replyItem = transport.sentItems[0].itipItem.getItemList()[0];
  let replyAttendees = replyItem.getAttendees();
  Assert.equal(replyAttendees.length, 1, "reply has one attendee");
  compareProperties(replyAttendees[0], {
    id: "mailto:receiver@example.com",
    participationStatus: partStat,
  });

  info("Verifying the call to the message subsystem");
  Assert.equal(transport.sentMsgs.length, 1, "transport sent 1 message");
  compareProperties(transport.sentMsgs[0], {
    userIdentity: identity,
    "composeFields.from": "receiver@example.com",
    "composeFields.to": "Sender <sender@example.com>",
  });
  Assert.ok(transport.sentMsgs[0].messageFile.exists(), "message file was created");
}

/**
 * @typedef {Object} ImipBarActionTestConf
 *
 * @property {calICalendar} calendar The calendar used for the test.
 * @property {calIItipTranport} transport The transport used for the test.
 * @property {nsIIdentity} identity The identity expected to be used to
 *   send the reply.
 * @property {boolean} isRecurring Indicates whether to treat the event as a
 *   recurring event or not.
 * @property {string} partStat The participationStatus of the receiving user to
 *   expect.
 * @property {boolean} noReply If true, do not expect an attempt to send a reply.
 */

/**
 * Test the properties of an event created from the imip-bar and optionally, the
 * attempt to send a reply.
 *
 * @param {ImipBarActionTestConf} conf
 * @param {calIEvent|calIEvent[]} item
 */
async function doImipBarActionTest(conf, event) {
  let { calendar, transport, identity, partStat, isRecurring, noReply } = conf;
  let title = isRecurring ? "Repeat Event" : "Single Event";
  let events = [event];
  let startDates = ["20220316T110000Z"];
  let endDates = ["20220316T113000Z"];

  if (isRecurring) {
    startDates = [...startDates, "20220317T110000Z", "20220318T110000Z"];
    endDates = [...endDates, "20220317T113000Z", "20220318T113000Z"];
    events = event.parentItem.recurrenceInfo.getOccurrences(
      cal.createDateTime("19700101"),
      cal.createDateTime("30000101"),
      Infinity
    );
    Assert.equal(events.length, 3, "reccurring event has 3 occurrences");
  }

  info("Verifying relevant properties of each event occurrence");
  for (let [index, occurrence] of events.entries()) {
    compareProperties(occurrence, {
      title,
      "calendar.name": calendar.name,
      "startDate.icalString": startDates[index],
      "endDate.icalString": endDates[index],
      description: "An event invitation.",
      location: "Somewhere",
      sequence: "0",
      "x-moz-received-dtstamp": "20220316T191602Z",
      "organizer.id": "mailto:sender@example.com",
      status: "CONFIRMED",
    });

    // Alarms should be ignored.
    Assert.equal(
      occurrence.getAlarms().length,
      0,
      `${isRecurring ? "occurrence" : "event"} has no reminders`
    );

    info("Verifying attendee list and participation status");
    let attendees = occurrence.getAttendees();
    compareProperties(attendees, {
      "0.id": "mailto:sender@example.com",
      "0.participationStatus": "ACCEPTED",
      "1.participationStatus": partStat,
      "1.id": "mailto:receiver@example.com",
      "2.id": "mailto:other@example.com",
      "2.participationStatus": "NEEDS-ACTION",
    });
  }

  if (noReply) {
    Assert.equal(
      transport.sentItems.length,
      0,
      "itip subsystem did not attempt to send a response"
    );
    Assert.equal(transport.sentMsgs.length, 0, "no call was made into the mail subsystem");
  } else {
    await doReplyTest(transport, identity, partStat);
  }
}

/**
 * @typedef {ImipBarActionTestConf} UpdateActionTestConf
 *
 * @property {nsIFile} invite The invite file to base the update on.
 */

/**
 * Tests the recognition and application of a minor update to an existing event.
 * An update is considered minor if the SEQUENCE property has not changed but
 * the DTSTAMP has.
 *
 * @param {UpdateActionTestConf} conf
 */
async function doMinorUpdateTest(conf) {
  let { transport, calendar, partStat, isRecurring, invite } = conf;
  let event = (await CalendarTestUtils.monthView.waitForItemAt(window, 3, 4, 1)).item.parentItem;
  let prevEventIcs = event.icalString;

  let title = "Updated Event";
  let description = "Updated description.";
  let location = "Updated location";
  let dtstamp = "20220318T191602Z";
  let srcText = await IOUtils.readUTF8(invite.path);
  srcText = srcText.replaceAll(/SUMMARY:(\w| )+/g, `SUMMARY:${title}`);
  srcText = srcText.replaceAll(/DESCRIPTION:(\w| |.)+/g, `DESCRIPTION:${description}`);
  srcText = srcText.replaceAll(/LOCATION:\w+/g, `LOCATION:${location}`);
  srcText = srcText.replaceAll(/DTSTAMP:20220316T191602Z/g, `DTSTAMP:${dtstamp}`);

  let tmpFile = FileTestUtils.getTempFile("update-minor.eml");
  await IOUtils.writeUTF8(tmpFile.path, srcText);
  transport.reset();

  let win = await openImipMessage(tmpFile);
  let updateButton = win.document.getElementById("imipUpdateButton");
  Assert.ok(!updateButton.hidden, `#${updateButton.id} button shown`);
  EventUtils.synthesizeMouseAtCenter(updateButton, {}, win);

  await TestUtils.waitForCondition(async () => {
    event = (await CalendarTestUtils.monthView.waitForItemAt(window, 3, 4, 1)).item.parentItem;
    return event.icalString != prevEventIcs;
  }, "event updated");

  await BrowserTestUtils.closeWindow(win);

  let events = [event];
  let startDates = ["20220316T110000Z"];
  let endDates = ["20220316T113000Z"];
  if (isRecurring) {
    startDates = [...startDates, "20220317T110000Z", "20220318T110000Z"];
    endDates = [...endDates, "20220317T113000Z", "20220318T113000Z"];
    events = event.recurrenceInfo.getOccurrences(
      cal.createDateTime("19700101"),
      cal.createDateTime("30000101"),
      Infinity
    );
    Assert.equal(events.length, 3, "reccurring event has 3 occurrences");
  }

  info("Verifying relevant properties of each event occurrence");
  for (let [index, occurrence] of events.entries()) {
    compareProperties(occurrence, {
      title,
      "calendar.name": calendar.name,
      "startDate.icalString": startDates[index],
      "endDate.icalString": endDates[index],
      description,
      location,
      sequence: "0",
      "x-moz-received-dtstamp": dtstamp,
      "organizer.id": "mailto:sender@example.com",
      status: "CONFIRMED",
    });

    // Note: It seems we do not keep the order of the attendees list for updates.
    let attendees = occurrence.getAttendees();
    compareProperties(attendees, {
      "0.id": "mailto:sender@example.com",
      "0.participationStatus": "ACCEPTED",
      "1.id": "mailto:other@example.com",
      "1.participationStatus": "NEEDS-ACTION",
      "2.participationStatus": partStat,
      "2.id": "mailto:receiver@example.com",
    });
  }

  Assert.equal(transport.sentItems.length, 0, "itip subsystem did not attempt to send a response");
  Assert.equal(transport.sentMsgs.length, 0, "no call was made into the mail subsystem");
  await calendar.deleteItem(event);
}

const actionIds = {
  single: {
    button: {
      ACCEPTED: "imipAcceptButton",
      TENTATIVE: "imipTentativeButton",
      DECLINED: "imipDeclineButton",
    },
    noReply: {
      ACCEPTED: "imipAcceptButton_AcceptDontSend",
      TENTATIVE: "imipTentativeButton_TentativeDontSend",
      DECLINED: "imipDeclineButton_DeclineDontSend",
    },
  },
  recurring: {
    button: {
      ACCEPTED: "imipAcceptRecurrencesButton",
      TENTATIVE: "imipTentativeRecurrencesButton",
      DECLINED: "imipDeclineRecurrencesButton",
    },
    noReply: {
      ACCEPTED: "imipAcceptRecurrencesButton_AcceptDontSend",
      TENTATIVE: "imipTentativeRecurrencesButton_TentativeDontSend",
      DECLINED: "imipDeclineRecurrencesButton_DeclineDontSend",
    },
  },
};

/**
 * Tests the recognition and application of a major update to an existing event.
 * An update is considered major if the SEQUENCE property has changed. For major
 * updates, the imip-bar prompts the user to re-confirm their attendance.
 *
 * @param {UpdateActionTestConf} conf
 */
async function doMajorUpdateTest(conf) {
  let { transport, identity, calendar, partStat, invite, isRecurring, noReply } = conf;
  let event = (await CalendarTestUtils.monthView.waitForItemAt(window, 3, 4, 1)).item.parentItem;
  let prevEventIcs = event.icalString;

  let dtstart = "20220316T050000Z";
  let dtend = "20220316T053000Z";
  let srcText = await IOUtils.readUTF8(invite.path);
  srcText = srcText.replaceAll(/SEQUENCE:\w+/g, "SEQUENCE:2");
  srcText = srcText.replaceAll(/DTSTART:\w+/g, `DTSTART:${dtstart}`);
  srcText = srcText.replaceAll(/DTEND:\w+/g, `DTEND:${dtend}`);

  let tmpFile = FileTestUtils.getTempFile("update-major.eml");
  await IOUtils.writeUTF8(tmpFile.path, srcText);

  transport.reset();
  let win = await openImipMessage(tmpFile);
  let actions = isRecurring ? actionIds.recurring : actionIds.single;
  if (noReply) {
    let { button, noReply } = actions;
    await clickMenuAction(win, button[partStat], noReply[partStat]);
  } else {
    await clickAction(win, actions.button[partStat]);
  }

  await TestUtils.waitForCondition(async () => {
    event = (await CalendarTestUtils.monthView.waitForItemAt(window, 3, 4, 1)).item.parentItem;
    return event.icalString != prevEventIcs;
  }, "event updated");

  await BrowserTestUtils.closeWindow(win);

  if (noReply) {
    Assert.equal(
      transport.sentItems.length,
      0,
      "itip subsystem did not attempt to send a response"
    );
    Assert.equal(transport.sentMsgs.length, 0, "no call was made into the mail subsystem");
  } else {
    await doReplyTest(transport, identity, partStat);
  }

  let events = [event];
  let startDates = [dtstart];
  let endDates = [dtend];
  if (isRecurring) {
    startDates = [...startDates, "20220317T050000Z", "20220318T050000Z"];
    endDates = [...endDates, "20220317T053000Z", "20220318T053000Z"];
    events = event.recurrenceInfo.getOccurrences(
      cal.createDateTime("19700101"),
      cal.createDateTime("30000101"),
      Infinity
    );
    Assert.equal(events.length, 3, "reccurring event has 3 occurrences");
  }

  for (let [index, occurrence] of events.entries()) {
    compareProperties(occurrence, {
      title: isRecurring ? "Repeat Event" : "Single Event",
      "calendar.name": calendar.name,
      "startDate.icalString": startDates[index],
      "endDate.icalString": endDates[index],
      description: "An event invitation.",
      location: "Somewhere",
      sequence: "2",
      "x-moz-received-dtstamp": "20220316T191602Z",
      "organizer.id": "mailto:sender@example.com",
      status: "CONFIRMED",
    });

    let attendees = occurrence.getAttendees();
    compareProperties(attendees, {
      "0.id": "mailto:sender@example.com",
      "0.participationStatus": "ACCEPTED",
      "1.id": "mailto:other@example.com",
      "1.participationStatus": "NEEDS-ACTION",
      "2.participationStatus": partStat,
      "2.id": "mailto:receiver@example.com",
    });
  }
  await calendar.deleteItem(event);
}
