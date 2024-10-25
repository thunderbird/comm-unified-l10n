/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const tabmail = document.getElementById("tabmail");
let browser, button;

add_setup(async function () {
  const tab = tabmail.openTab("contentTab", {
    url: "chrome://mochitests/content/browser/comm/mail/components/inappnotifications/test/browser/files/inAppNotificationCloseButton.xhtml",
  });

  await BrowserTestUtils.browserLoaded(tab.browser, undefined, url =>
    url.endsWith("inAppNotificationCloseButton.xhtml")
  );
  await SimpleTest.promiseFocus(tab.browser);
  // This test misbehaves if started immediately.
  // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
  await new Promise(resolve => setTimeout(resolve, 1000));
  browser = tab.browser;
  button = browser.contentWindow.document.querySelector(`button`);

  registerCleanupFunction(() => {
    tabmail.closeOtherTabs(tabmail.tabInfo[0]);
  });
});

add_task(async function test_closeButtonEvent() {
  const eventPromise = BrowserTestUtils.waitForEvent(
    button,
    "notificationclose"
  );

  EventUtils.synthesizeMouseAtCenter(button, {}, browser.contentWindow);

  const recievedEvent = await eventPromise;

  Assert.equal(
    recievedEvent.notificationId,
    "notification-1",
    "has correct notification id"
  );
  // We can't check the instance, because this event is from within the tab and
  // loading the module inside the tab to compare to the event is too complicated.
  Assert.equal(
    recievedEvent.constructor.name,
    "InAppNotificationEvent",
    "Should get an InAppNotificationEvent"
  );
});
