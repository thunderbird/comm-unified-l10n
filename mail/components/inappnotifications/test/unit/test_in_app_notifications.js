/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { InAppNotifications } = ChromeUtils.importESModule(
  "resource:///modules/InAppNotifications.sys.mjs"
);
const { NotificationManager } = ChromeUtils.importESModule(
  "resource:///modules/NotificationManager.sys.mjs"
);
const { BrowserTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/BrowserTestUtils.sys.mjs"
);
const { TestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/TestUtils.sys.mjs"
);
const { sinon } = ChromeUtils.importESModule(
  "resource://testing-common/Sinon.sys.mjs"
);
const { clearInterval, clearTimeout } = ChromeUtils.importESModule(
  "resource://gre/modules/Timer.sys.mjs"
);
const { NotificationUpdater } = ChromeUtils.importESModule(
  "resource:///modules/NotificationUpdater.sys.mjs"
);

const SAFETY_MARGIN_MS = 100000;

function getMockNotifications() {
  const now = Date.now();
  const startDate = new Date(now - SAFETY_MARGIN_MS).toISOString();
  const endDate = new Date(now + SAFETY_MARGIN_MS).toISOString();
  return [
    {
      id: "foo",
      title: "lorem ipsum",
      start_at: startDate,
      end_at: endDate,
      severity: 1,
      targeting: {},
      type: "donation",
    },
    {
      id: "bar",
      title: "dolor sit amet",
      start_at: startDate,
      end_at: endDate,
      severity: 5,
      targeting: {},
      type: "donation",
    },
  ];
}

add_setup(async () => {
  do_get_profile();
  await InAppNotifications.init();

  NotificationManager._PER_TIME_UNIT = 1;

  registerCleanupFunction(() => {
    clearInterval(NotificationUpdater._interval);
    clearTimeout(InAppNotifications._showNotificationTimer);
  });
});

add_task(function test_initializedData() {
  Assert.ok(InAppNotifications._jsonFile.dataReady, "JSON file is ready");
  Assert.ok(
    InAppNotifications.notificationManager instanceof NotificationManager,
    "Should expose a NotificationManager instance"
  );
  Assert.equal(
    typeof NotificationUpdater.onUpdate,
    "function",
    "Should register update callback"
  );
  Assert.ok(NotificationUpdater._timeout, "Should initialize updater");

  Assert.deepEqual(
    InAppNotifications._jsonFile.data.interactedWith,
    [],
    "Should initialize interacted with notifications"
  );
});

add_task(function test_initializedDataWithoutBuiltinNotifications() {
  Assert.deepEqual(
    InAppNotifications.getNotifications(),
    [],
    "Should initialize notifications with an empty array"
  );
  Assert.deepEqual(
    InAppNotifications._jsonFile.data.seeds,
    {},
    "Should initialize seeds"
  );
});

add_task(async function test_noReinitialization() {
  const currentNotificationManager = InAppNotifications.notificationManager;
  await InAppNotifications.init();
  Assert.strictEqual(
    InAppNotifications.notificationManager,
    currentNotificationManager,
    "Should not initialize a new notification manager"
  );
});

add_task(async function test_markAsInteractedWith() {
  const mockData = getMockNotifications();
  await InAppNotifications.updateNotifications(mockData);
  Assert.deepEqual(
    InAppNotifications.getNotifications(),
    mockData,
    "Should have all notifications"
  );
  Assert.deepEqual(
    InAppNotifications._jsonFile.data.interactedWith,
    [],
    "Should start without any notifications having been interacted with"
  );

  InAppNotifications.markAsInteractedWith("foo");

  await InAppNotifications.updateNotifications(mockData);
  Assert.deepEqual(
    InAppNotifications.getNotifications(),
    [mockData[1]],
    "Should only have uninteracted notifications"
  );

  InAppNotifications.markAsInteractedWith("foo");
  Assert.deepEqual(
    InAppNotifications._jsonFile.data.interactedWith,
    ["foo"],
    "Should only store the ID once"
  );

  await InAppNotifications.updateNotifications([]);
  Assert.deepEqual(
    InAppNotifications._jsonFile.data.interactedWith,
    [],
    "Should clear interaction store when there are no notifications"
  );
});

add_task(async function test_getNotifications_expiry() {
  const now = Date.now();
  const mockData = [
    {
      id: "foo",
      title: "lorem ipsum",
      start_at: new Date(now - SAFETY_MARGIN_MS).toISOString(),
      end_at: new Date(now + SAFETY_MARGIN_MS).toISOString(),
      targeting: {},
      type: "donation",
    },
    {
      id: "future bar",
      title: "dolor sit amet",
      start_at: new Date(now + SAFETY_MARGIN_MS).toISOString(),
      end_at: new Date(now + 2 * SAFETY_MARGIN_MS).toISOString(),
      targeting: {},
      type: "donation",
    },
    {
      id: "past bar",
      title: "back home now",
      start_at: new Date(now - 2 * SAFETY_MARGIN_MS).toISOString(),
      end_at: new Date(now - SAFETY_MARGIN_MS).toISOString(),
      targeting: {},
      type: "donation",
    },
    {
      id: "invalid",
      title: "invalid date strings",
      start_at: "foo",
      end_at: "bar",
      targeting: {},
      type: "donation",
    },
  ];
  await InAppNotifications.updateNotifications(mockData);
  Assert.deepEqual(
    InAppNotifications.getNotifications(),
    [mockData[0]],
    "Should have only current notifications"
  );

  await InAppNotifications.updateNotifications([]);
});

add_task(async function test_notificationInteractionEvent() {
  const mockData = getMockNotifications();
  await InAppNotifications.updateNotifications(mockData);

  InAppNotifications.notificationManager.dispatchEvent(
    new CustomEvent(NotificationManager.NOTIFICATION_INTERACTION_EVENT, {
      detail: mockData[0].id,
    })
  );

  Assert.deepEqual(
    InAppNotifications.getNotifications(),
    [mockData[1]],
    "Should no longer include the first notification"
  );

  await InAppNotifications.updateNotifications([]);
});

add_task(async function test_requestNotifictionsEvent() {
  const mockData = getMockNotifications();
  await InAppNotifications.updateNotifications(mockData);
  InAppNotifications.notificationManager.updatedNotifications([]);

  const newNotificationEvent = BrowserTestUtils.waitForEvent(
    InAppNotifications.notificationManager,
    NotificationManager.NEW_NOTIFICATION_EVENT
  );
  InAppNotifications.notificationManager.dispatchEvent(
    new CustomEvent(NotificationManager.REQUEST_NOTIFICATIONS_EVENT)
  );
  const { detail: notification } = await newNotificationEvent;
  Assert.deepEqual(notification, mockData[0], "Should pick first notification");
});

add_task(async function test_getSeed() {
  const seedId = "foo";
  const seed = InAppNotifications._getSeed(seedId);
  Assert.strictEqual(
    InAppNotifications._getSeed(seedId),
    seed,
    "Seed is constant for a given ID"
  );

  Assert.notEqual(
    InAppNotifications._getSeed("bar"),
    seed,
    "Different ID gives a different seed"
  );

  Assert.strictEqual(
    InAppNotifications._getSeed(seedId),
    seed,
    "Seed is still constant for the same ID"
  );

  Assert.strictEqual(
    InAppNotifications._jsonFile.data.seeds[seedId],
    seed,
    "Seed is stored in JSON storage"
  );

  Assert.ok(Number.isInteger(seed), "Seed is an integer");
  Assert.greaterOrEqual(seed, 0, "Seed is at least 0");
  Assert.lessOrEqual(seed, 100, "Seed is at most 100");

  // Test multiple seeds to sample more random values and find issues faster.
  for (let i = 0; i < 10; ++i) {
    const testSeed = InAppNotifications._getSeed(`test${i}`);

    Assert.ok(Number.isInteger(testSeed), `Seed ${i} is an integer`);
    Assert.greaterOrEqual(testSeed, 0, `Seed ${i} is at least 0`);
    Assert.lessOrEqual(testSeed, 100, `Seed ${i} is at most 100`);
  }

  await InAppNotifications.updateNotifications([]);
});

add_task(async function test_getNotification_seed() {
  const mockData = getMockNotifications();
  mockData[0].targeting.percent_chance = 42;
  mockData[1].targeting.percent_chance = 42;
  await InAppNotifications.updateNotifications(mockData);

  InAppNotifications._jsonFile.data.seeds[mockData[0].id] = 2;
  InAppNotifications._jsonFile.data.seeds[mockData[1].id] = 100;

  const seededResult = InAppNotifications.getNotifications();
  Assert.deepEqual(
    seededResult,
    [mockData[0]],
    "Should only see first notification based on percent chance seeds"
  );
  Assert.deepEqual(
    InAppNotifications.getNotifications(),
    seededResult,
    "Resulting notifications are stable"
  );

  await InAppNotifications.updateNotifications([]);
});

add_task(async function test_updateNotificationManager() {
  const updatedNotificationsSpy = sinon.spy(
    InAppNotifications.notificationManager,
    "updatedNotifications"
  );
  const now = Date.now();
  const mockData = [
    {
      id: "future bar",
      title: "dolor sit amet",
      start_at: new Date(now + SAFETY_MARGIN_MS).toISOString(),
      end_at: new Date(now + 2 * SAFETY_MARGIN_MS).toISOString(),
      targeting: {},
      type: "donation",
      severity: 1,
    },
    {
      id: "foo",
      title: "lorem ipsum",
      start_at: new Date(now - SAFETY_MARGIN_MS).toISOString(),
      end_at: new Date(now + SAFETY_MARGIN_MS).toISOString(),
      targeting: {},
      type: "donation",
      severity: 5,
    },
  ];

  const newNotificationEvent = BrowserTestUtils.waitForEvent(
    InAppNotifications.notificationManager,
    NotificationManager.NEW_NOTIFICATION_EVENT
  );
  await InAppNotifications.updateNotifications(mockData);
  const { detail: notification } = await newNotificationEvent;

  Assert.deepEqual(
    notification,
    mockData[1],
    "Should have filtered current notification"
  );
  Assert.ok(
    updatedNotificationsSpy.calledWith(
      sinon.match(InAppNotifications.getNotifications())
    ),
    "Should have passed the filtered list to updatedNotifiations"
  );

  await InAppNotifications.updateNotifications([]);
  InAppNotifications.notificationManager.updatedNotifications.restore();
});

add_task(async function test_updateNotifications_filtered() {
  const now = Date.now();
  const mockData = [
    {
      id: "future bar",
      title: "dolor sit amet",
      start_at: new Date(now + SAFETY_MARGIN_MS).toISOString(),
      end_at: new Date(now + 2 * SAFETY_MARGIN_MS).toISOString(),
      targeting: {},
      type: "donation",
      severity: 1,
    },
    {
      id: "foo",
      title: "lorem ipsum",
      start_at: new Date(now - SAFETY_MARGIN_MS).toISOString(),
      end_at: new Date(now + SAFETY_MARGIN_MS).toISOString(),
      targeting: {},
      type: "donation",
      severity: 5,
    },
  ];

  const newNotificationEvent = BrowserTestUtils.waitForEvent(
    InAppNotifications.notificationManager,
    NotificationManager.NEW_NOTIFICATION_EVENT
  );
  await InAppNotifications.updateNotifications(mockData);
  const { detail: notification } = await newNotificationEvent;
  Assert.deepEqual(
    notification,
    mockData[1],
    "Should have filtered current notification"
  );

  await InAppNotifications.updateNotifications([]);
});

add_task(async function test_updateNotificationManager_localeChange() {
  const currentLocales = Services.locale.requestedLocales;
  const availableLocales = Services.locale.availableLocales;
  if (!availableLocales.includes("en-EU")) {
    Services.locale.availableLocales = ["en-EU", ...availableLocales];
  }
  if (currentLocales.includes("en-EU")) {
    Services.locale.requestedLocales = ["en-US"];
  }
  const now = Date.now();
  const mockData = [
    {
      id: "normal bar",
      title: "dolor sit amet",
      start_at: new Date(now - SAFETY_MARGIN_MS).toISOString(),
      end_at: new Date(now + SAFETY_MARGIN_MS).toISOString(),
      targeting: {
        exclude: [
          {
            locales: ["en-EU"],
          },
        ],
      },
      type: "donation",
      severity: 5,
    },
    {
      id: "foo weird",
      title: "lorem ipsum",
      start_at: new Date(now - SAFETY_MARGIN_MS).toISOString(),
      end_at: new Date(now + SAFETY_MARGIN_MS).toISOString(),
      targeting: {
        include: [
          {
            locales: ["en-EU"],
          },
        ],
      },
      type: "donation",
      severity: 5,
    },
  ];
  await InAppNotifications.updateNotifications(mockData);

  const { detail: notification } = await BrowserTestUtils.waitForEvent(
    InAppNotifications.notificationManager,
    NotificationManager.NEW_NOTIFICATION_EVENT
  );

  Assert.equal(
    notification.id,
    "normal bar",
    "Should see non-en-EU notification"
  );

  const localeChanged = TestUtils.topicObserved("intl:app-locales-changed");

  Services.locale.requestedLocales = ["en-EU"];
  await localeChanged;

  const { detail: newNotification } = await BrowserTestUtils.waitForEvent(
    InAppNotifications.notificationManager,
    NotificationManager.NEW_NOTIFICATION_EVENT
  );

  Assert.notEqual(
    newNotification.id,
    notification.id,
    "Should get a different notification with the different locale"
  );
  Assert.equal(
    newNotification.id,
    "foo weird",
    "Should see en-EU notification"
  );

  Services.locale.availableLocales = availableLocales;
  Services.locale.requestedLocales = currentLocales;
  await InAppNotifications.updateNotifications([]);
});

add_task(async function test_scheduledNotification() {
  const now = Date.now();
  const delay = 500;
  const mockData = [
    {
      id: "future bar",
      title: "dolor sit amet",
      start_at: new Date(now + delay).toISOString(),
      end_at: new Date(now + delay + 2 * SAFETY_MARGIN_MS).toISOString(),
      targeting: {},
      type: "donation",
      severity: 1,
    },
  ];

  const newNotificationEvent = BrowserTestUtils.waitForEvent(
    InAppNotifications.notificationManager,
    NotificationManager.NEW_NOTIFICATION_EVENT
  );
  await InAppNotifications.updateNotifications(mockData);
  Assert.ok(
    InAppNotifications._showNotificationTimer,
    "Should have scheduled a timer for when the notification starts"
  );
  const { detail: notification } = await newNotificationEvent;
  Assert.deepEqual(
    notification,
    mockData[0],
    "Should have sent future notification"
  );
  Assert.greaterOrEqual(
    Date.now() - now,
    delay,
    "Should have waited until the notification became valid to send the event"
  );
  Assert.ok(
    !InAppNotifications._showNotificationTimer,
    "Should have no timer for any future notifications"
  );

  await InAppNotifications.updateNotifications([]);
});
