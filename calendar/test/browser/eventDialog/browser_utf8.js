/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var {
  CANVAS_BOX,
  EVENT_BOX,
  closeAllEventDialogs,
  controller,
  createCalendar,
  deleteCalendars,
  helpersForController,
  invokeNewEventDialog,
  invokeEditingEventDialog,
  switchToView,
} = ChromeUtils.import("resource://testing-common/mozmill/CalendarUtils.jsm");
var { setData } = ChromeUtils.import("resource://testing-common/mozmill/ItemEditingHelpers.jsm");

var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

var { lookupEventBox } = helpersForController(controller);

var UTF8STRING = " 💣 💥  ☣  ";

add_task(async function testUTF8() {
  Services.prefs.setStringPref("calendar.categories.names", UTF8STRING);
  createCalendar(controller, UTF8STRING);
  switchToView(controller, "day");

  // Create new event.
  let eventBox = lookupEventBox("day", CANVAS_BOX, null, 1, 8);
  await invokeNewEventDialog(controller, eventBox, async (event, iframe) => {
    let { eid: eventid } = helpersForController(event);

    // Fill in name, location, description.
    await setData(event, iframe, {
      title: UTF8STRING,
      location: UTF8STRING,
      description: UTF8STRING,
      categories: [UTF8STRING],
    });

    // save
    event.click(eventid("button-saveandclose"));
  });

  // open
  let eventPath = `/{"tooltip":"itemTooltip","calendar":"${UTF8STRING.toLowerCase()}"}`;
  eventBox = lookupEventBox("day", EVENT_BOX, null, 1, null, eventPath);
  await invokeEditingEventDialog(controller, eventBox, (event, iframe) => {
    let { eid: iframeId } = helpersForController(iframe);

    // Check values.
    Assert.equal(iframeId("item-title").getNode().value, UTF8STRING);
    Assert.equal(iframeId("item-location").getNode().value, UTF8STRING);
    Assert.equal(iframeId("item-description").getNode().value, UTF8STRING);
    Assert.ok(
      iframeId("item-categories").getNode().querySelector(`
            menuitem[label="${UTF8STRING}"][checked]
        `)
    );

    // Escape the event window.
    EventUtils.synthesizeKey("VK_ESCAPE", {}, event.window);
  });

  Assert.ok(true, "Test ran to completion");
});

registerCleanupFunction(function teardownModule(module) {
  deleteCalendars(controller, UTF8STRING);
  Services.prefs.clearUserPref("calendar.categories.names");
  closeAllEventDialogs();
});
