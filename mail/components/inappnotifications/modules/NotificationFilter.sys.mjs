/* -*- Mode: JavaScript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";

export const NotificationFilter = {
  /**
   * Check if a notification's conditions make it currently suitable for display.
   *
   * @param {object} notification - Notification to check.
   * @param {number} seed - The random seed for this notification.
   * @returns {boolean} If this notification should be shown.
   */
  isActiveNotification(notification, seed) {
    const now = Date.now();
    const parsedEnd = Date.parse(notification.end_at);
    const parsedStart = Date.parse(notification.start_at);
    if (
      Number.isNaN(parsedEnd) ||
      Number.isNaN(parsedStart) ||
      parsedEnd < now ||
      parsedStart > now
    ) {
      return false;
    }
    if (
      Object.hasOwn(notification.targeting, "percent_chance") &&
      notification.targeting.percent_chance !== 100 &&
      notification.targeting.percent_chance < seed
    ) {
      return false;
    }
    if (
      Array.isArray(notification.targeting.exclude) &&
      notification.targeting.exclude.some(profile => this.checkProfile(profile))
    ) {
      return false;
    }
    if (
      Array.isArray(notification.targeting.include) &&
      !notification.targeting.include.some(profile =>
        this.checkProfile(profile)
      )
    ) {
      return false;
    }
    return true;
  },
  /**
   * Check a targeting profile against this application.
   *
   * @param {object} profile - The target profile to check.
   * @returns {boolean} If the given profile matches this application.
   */
  checkProfile(profile) {
    if (
      Array.isArray(profile.locales) &&
      !profile.locales.includes(Services.locale.appLocaleAsBCP47)
    ) {
      return false;
    }
    if (
      Array.isArray(profile.versions) &&
      !profile.versions.includes(AppConstants.MOZ_APP_VERSION)
    ) {
      return false;
    }
    if (
      Array.isArray(profile.channels) &&
      !profile.channels.includes(AppConstants.MOZ_UPDATE_CHANNEL)
    ) {
      return false;
    }
    if (
      Array.isArray(profile.operating_systems) &&
      !profile.operating_systems.includes(
        AppConstants.platform === "linux"
          ? AppConstants.unixstyle
          : AppConstants.platform
      )
    ) {
      return false;
    }
    return true;
  },
};
