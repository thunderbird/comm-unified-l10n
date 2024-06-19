/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { NotificationFilter } = ChromeUtils.importESModule(
  "resource:///modules/NotificationFilter.sys.mjs"
);
const { AppConstants } = ChromeUtils.importESModule(
  "resource://gre/modules/AppConstants.sys.mjs"
);

const SAFETY_MARGIN_MS = 100000;

function getProfileFromAppValues() {
  const platform =
    AppConstants.platform === "linux"
      ? AppConstants.unixstyle
      : AppConstants.platform;
  return {
    locales: [Services.locale.appLocaleAsBCP47, "foo-BAR"],
    versions: [AppConstants.MOZ_APP_VERSION, "0"],
    channels: [AppConstants.MOZ_UPDATE_CHANNEL, "fictional testing channel"],
    operating_systems: [platform, "LCARS"],
  };
}

add_task(function test_isActiveNotification_emptyTargeting() {
  const now = Date.now();
  const notification = {
    end_at: new Date(now + SAFETY_MARGIN_MS).toISOString(),
    start_at: new Date(now - SAFETY_MARGIN_MS).toISOString(),
    targeting: {},
  };
  Assert.ok(NotificationFilter.isActiveNotification(notification, 0));
});

add_task(function test_isActiveNotification_timeWindowExpiry() {
  const now = Date.now();
  const mockData = [
    {
      id: "future bar",
      title: "dolor sit amet",
      start_at: new Date(now + SAFETY_MARGIN_MS).toISOString(),
      end_at: new Date(now + 2 * SAFETY_MARGIN_MS).toISOString(),
      targeting: {},
    },
    {
      id: "past bar",
      title: "back home now",
      start_at: new Date(now - 2 * SAFETY_MARGIN_MS).toISOString(),
      end_at: new Date(now - SAFETY_MARGIN_MS).toISOString(),
      targeting: {},
    },
    {
      id: "invalid",
      title: "invalid date strings",
      start_at: "foo",
      end_at: "bar",
      targeting: {},
    },
    {
      id: "invalid start",
      title: "invalid start_at string",
      start_at: "foo",
      end_at: new Date(now + SAFETY_MARGIN_MS).toISOString(),
      targeting: {},
    },
    {
      id: "invalid end",
      title: "invalid end_at string",
      start_at: new Date(now - SAFETY_MARGIN_MS).toISOString(),
      end_at: "bar",
      targeting: {},
    },
  ];

  for (const notification of mockData) {
    Assert.ok(
      !NotificationFilter.isActiveNotification(notification, 100),
      `Notification ${notification.id} is inactive`
    );
  }
});

add_task(function test_isActiveNotification_percentChance() {
  const now = Date.now();
  const notification = {
    end_at: new Date(now + SAFETY_MARGIN_MS).toISOString(),
    start_at: new Date(now - SAFETY_MARGIN_MS).toISOString(),
    targeting: {
      percent_chance: null,
    },
  };

  function subtest_seed(transitionAt, reasonChance, middleSeed = 42) {
    Assert.equal(
      NotificationFilter.isActiveNotification(notification, 0),
      transitionAt >= 0,
      `Chance of ${reasonChance} with seed 0`
    );
    Assert.equal(
      NotificationFilter.isActiveNotification(notification, middleSeed),
      transitionAt >= middleSeed,
      `Chance of ${reasonChance} with seed ${middleSeed}`
    );
    Assert.equal(
      NotificationFilter.isActiveNotification(notification, 100),
      transitionAt === 100,
      `Chance of ${reasonChance} with seed 100`
    );
  }

  subtest_seed(0, "null");

  notification.targeting.percent_chance = 0;
  subtest_seed(0, "0", 1);

  notification.targeting.percent_chance = 42;
  subtest_seed(42, "42", 42);

  notification.targeting.percent_chance = 100;
  subtest_seed(100, "100");
});

add_task(function test_isActiveNotification_exclude() {
  const now = Date.now();
  const notification = {
    end_at: new Date(now + SAFETY_MARGIN_MS).toISOString(),
    start_at: new Date(now - SAFETY_MARGIN_MS).toISOString(),
    targeting: {
      exclude: null,
    },
  };

  Assert.ok(
    NotificationFilter.isActiveNotification(notification, 100),
    "null exclude keeps the notification active"
  );

  notification.targeting.exclude = [];
  Assert.ok(
    NotificationFilter.isActiveNotification(notification, 100),
    "Empty exclude filter keeps the notification active"
  );

  notification.targeting.exclude.push({ locales: [] });
  notification.targeting.exclude.push({ versions: [] });
  Assert.ok(
    NotificationFilter.isActiveNotification(notification, 100),
    "Excluded pofile that doesn't match keeps the notification active"
  );

  notification.targeting.exclude.push(getProfileFromAppValues());
  Assert.ok(
    !NotificationFilter.isActiveNotification(notification, 100),
    "Excluded profile matching application makes notification inactive"
  );

  notification.targeting.exclude.push({});
  Assert.ok(
    !NotificationFilter.isActiveNotification(notification, 100),
    "Matching multiple excluded profiles keeps notification inactive"
  );
});

add_task(function test_isActiveNotification_include() {
  const now = Date.now();
  const notification = {
    end_at: new Date(now + SAFETY_MARGIN_MS).toISOString(),
    start_at: new Date(now - SAFETY_MARGIN_MS).toISOString(),
    targeting: {
      include: null,
    },
  };

  Assert.ok(
    NotificationFilter.isActiveNotification(notification, 100),
    "null include keeps the notification active"
  );

  notification.targeting.include = [];
  Assert.ok(
    !NotificationFilter.isActiveNotification(notification, 100),
    "Empty include filter makes the notification inactive"
  );

  notification.targeting.include.push({ locales: [] });
  notification.targeting.include.push({ versions: [] });
  Assert.ok(
    !NotificationFilter.isActiveNotification(notification, 100),
    "Included pofile that doesn't match keeps the notification inactive"
  );

  notification.targeting.include.push(getProfileFromAppValues());
  Assert.ok(
    NotificationFilter.isActiveNotification(notification, 100),
    "Included profile matching application makes notification active"
  );

  notification.targeting.include.push({});
  Assert.ok(
    NotificationFilter.isActiveNotification(notification, 100),
    "Matching multiple included profiles keeps notification active"
  );
});

add_task(function test_isActiveNotification_includedAndExcluded() {
  const now = Date.now();
  const profile = getProfileFromAppValues();
  const notification = {
    end_at: new Date(now + SAFETY_MARGIN_MS).toISOString(),
    start_at: new Date(now - SAFETY_MARGIN_MS).toISOString(),
    targeting: {
      exclude: [profile],
      include: [profile],
    },
  };

  Assert.ok(
    !NotificationFilter.isActiveNotification(notification, 100),
    "Exclude wins over include condition"
  );
});

add_task(function test_checkProfile_emptyMatch() {
  Assert.ok(NotificationFilter.checkProfile({}), "Empty object always matches");

  function subtest_value(value, matches) {
    const properties = ["locales", "versions", "channels", "operating_systems"];
    for (const property of properties) {
      Assert.equal(
        NotificationFilter.checkProfile({ [property]: value }),
        matches,
        `Profile with ${value} ${property} has expected match`
      );
    }
  }

  subtest_value(null, true);
  subtest_value([], false);
});

add_task(function test_checkProfile_match() {
  const profile = getProfileFromAppValues();
  Assert.ok(
    NotificationFilter.checkProfile(profile),
    "Profile built from current application values matches"
  );

  for (const [key, value] of Object.entries(profile)) {
    Assert.ok(
      NotificationFilter.checkProfile({ [key]: value }),
      "Profile built with just a single current application value should match"
    );
  }
});

add_task(function test_checkProfile_singlePropertyMismatch() {
  const profile = getProfileFromAppValues();

  const mismatchingLocaleProfile = {
    ...profile,
    locales: ["foo-BAR"],
  };
  Assert.ok(
    !NotificationFilter.checkProfile(mismatchingLocaleProfile),
    "Profile doesn't match with mismatched language"
  );

  const mismatchingVersionProfile = {
    ...profile,
    versions: ["0"],
  };
  Assert.ok(
    !NotificationFilter.checkProfile(mismatchingVersionProfile),
    "Profile doesn't match with mismatched version"
  );

  const mismatchingChannelProfile = {
    ...profile,
    channels: ["fictional testing channel"],
  };
  Assert.ok(
    !NotificationFilter.checkProfile(mismatchingChannelProfile),
    "Profile doesn't match with mismatched channel"
  );

  const mismatchingOperatingSystemProfile = {
    ...profile,
    operating_systems: ["LCARS"],
  };
  Assert.ok(
    !NotificationFilter.checkProfile(mismatchingOperatingSystemProfile),
    "Profile doesn't match with mismatched operating system"
  );
});
