/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

const { MockRegistrar } = ChromeUtils.importESModule(
  "resource://testing-common/MockRegistrar.sys.mjs"
);

const tabmail = document.getElementById("tabmail");
let browser,
  button,
  loadedUri = false;

add_setup(async function () {
  const tab = tabmail.openTab("contentTab", {
    url: "chrome://mochitests/content/browser/comm/mail/components/inappnotifications/test/browser/files/inAppNotificationButton.xhtml",
  });

  await BrowserTestUtils.browserLoaded(tab.browser, undefined, url =>
    url.endsWith("inAppNotificationButton.xhtml")
  );
  await SimpleTest.promiseFocus(tab.browser);
  // This test misbehaves if started immediately.
  // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
  await new Promise(resolve => setTimeout(resolve, 1000));
  browser = tab.browser;
  button = browser.contentWindow.document.querySelector(
    `[is="in-app-notification-button"]`
  );

  /** @implements {nsIExternalProtocolService} */
  const mockExternalProtocolService = {
    QueryInterface: ChromeUtils.generateQI(["nsIExternalProtocolService"]),
    externalProtocolHandlerExists() {},
    isExposedProtocol() {},
    loadURI() {
      loadedUri = true;
    },
  };

  const mockExternalProtocolServiceCID = MockRegistrar.register(
    "@mozilla.org/uriloader/external-protocol-service;1",
    mockExternalProtocolService
  );

  registerCleanupFunction(() => {
    tabmail.closeOtherTabs(tabmail.tabInfo[0]);
    MockRegistrar.unregister(mockExternalProtocolServiceCID);
  });
});

add_task(async function test_linkClickDoesntOpen() {
  loadedUri = false;
  const eventPromise = BrowserTestUtils.waitForEvent(button, "ctaclick");

  EventUtils.synthesizeMouseAtCenter(button, {}, browser.contentWindow);
  const event = await eventPromise;
  Assert.strictEqual(event.button, 0, "Should get left click event");
  Assert.ok(event.composed, "Should get a composed event");
  // We can't check the instance, because this event is from within the tab and
  // loading the module inside the tab to compare to the event is too complicated.
  Assert.equal(
    event.constructor.name,
    "InAppNotificationEvent",
    "Should get an InAppNotificationEvent"
  );

  Assert.ok(!loadedUri, "Should prevent default of click event");
});
