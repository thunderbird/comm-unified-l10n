/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const tabmail = document.getElementById("tabmail");
let browser, container;

add_setup(async function () {
  const tab = tabmail.openTab("contentTab", {
    url: "chrome://mochitests/content/browser/comm/mail/components/inappnotifications/test/browser/files/inAppNotificationContainer.xhtml",
  });

  await BrowserTestUtils.browserLoaded(tab.browser, undefined, url =>
    url.endsWith("inAppNotificationContainer.xhtml")
  );
  tab.browser.focus();
  browser = tab.browser;
  container = browser.contentWindow.document.querySelector(
    `in-app-notification-container`
  );

  registerCleanupFunction(() => {
    tabmail.closeOtherTabs(tabmail.tabInfo[0]);
  });
});

function subtestTextValue(property, optional) {
  const element = container.shadowRoot.querySelector(
    `.in-app-notification-${property}`
  );

  Assert.equal(element.textContent, "", `${property} has no value`);

  container.setAttribute(property, "test text");

  Assert.equal(
    element.textContent,
    "test text",
    `${property} has correct value`
  );

  container.setAttribute(property, "new text");

  Assert.equal(
    element.textContent,
    "new text",
    `${property} updates correctly`
  );

  container.removeAttribute(property);

  if (optional) {
    return;
  }

  Assert.equal(element.textContent, "", `${property} is correctly removed`);
}

add_task(function test_ctaValue() {
  subtestTextValue("cta", true);
});

add_task(function test_descriptionValue() {
  subtestTextValue("description");
});

add_task(function test_headingValue() {
  subtestTextValue("heading");
});

add_task(function test_dataIdValue() {
  const element = container.shadowRoot.querySelector("a");

  Assert.equal(element.href, "", "url is null");

  container.dataset.id = "notification-1";

  Assert.equal(element.dataset.id, "notification-1", "id is set");

  container.dataset.id = "notification-2";

  Assert.equal(element.dataset.id, "notification-2", "id is updated");

  delete container.dataset.id;

  Assert.equal(element.dataset.id, "null", "id is cleared");
});

add_task(async function test_urlValue() {
  const element = container.shadowRoot.querySelector("a");

  Assert.equal(element.href, "", "url is null");

  container.setAttribute("url", "https://example.com/");

  Assert.equal(element.href, "https://example.com/", "url is set");

  container.setAttribute("url", "https://example.com/index.html");

  Assert.equal(
    element.href,
    "https://example.com/index.html",
    "url is updated"
  );

  container.removeAttribute("url");

  Assert.equal(element.href, "", "url is cleared");
});

add_task(async function test_type() {
  const element = container.shadowRoot.querySelector(
    ".in-app-notification-container"
  );

  container.setAttribute("type", "blog");
  Assert.ok(
    element.classList.contains("in-app-notification-blog"),
    "has correct class for type"
  );

  container.setAttribute("type", "donation");
  Assert.ok(
    element.classList.contains("in-app-notification-donation"),
    "has correct class for type"
  );
});

add_task(async function test_cta_optional() {
  const element = container.shadowRoot.querySelector("a");

  container.setAttribute("cta", "undefined");
  Assert.ok(element.hasAttribute("hidden"), `cta is hidden with "undefined"`);

  container.setAttribute("cta", "test");
  Assert.ok(!element.hasAttribute("hidden"), "cta is shown");

  container.removeAttribute("cta");
  Assert.ok(element.hasAttribute("hidden"), "cta is hidden with no attribute");

  container.setAttribute("cta", "test");
  Assert.ok(!element.hasAttribute("hidden"), "cta is shown");

  container.setAttribute("cta", undefined);
  Assert.ok(element.hasAttribute("hidden"), "cta is hidden width undefined");

  container.setAttribute("cta", "test");
  Assert.ok(!element.hasAttribute("hidden"), "cta is shown");

  container.setAttribute("cta", null);
  Assert.ok(element.hasAttribute("hidden"), "cta is hidden with null");

  container.setAttribute("cta", "test");
  Assert.ok(!element.hasAttribute("hidden"), "cta is shown");

  container.setAttribute("cta", "null");
  Assert.ok(element.hasAttribute("hidden"), `cta is hidden with "null"`);

  container.setAttribute("cta", "test");
  Assert.ok(!element.hasAttribute("hidden"), "cta is shown");
});

add_task(async function test_cta_title() {
  const element = container.shadowRoot.querySelector("a");

  container.setAttribute("cta", "test");

  Assert.equal(element.title, "test", "title is set correctly");

  container.setAttribute("cta", "test 2");

  Assert.equal(element.title, "test 2", "title is updated");
});
