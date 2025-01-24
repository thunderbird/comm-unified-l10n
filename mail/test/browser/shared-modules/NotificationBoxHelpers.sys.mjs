/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { TestUtils } from "resource://testing-common/TestUtils.sys.mjs";

/**
 * A helper function for determining whether or not a notification with
 * a particular value is being displayed.
 *
 * @param {Window} aWindow - The window to check.
 * @param {string} aBoxId - The id of the notification box.
 * @param {string}aValue - The value of the notification to look for.
 * @param {object} [aNotification] - An optional out parameter;
 *   object that will pass the notification element out of this function in its
 *   'notification' property.
 *
 * @returns {boolean} true/false depending on the state of the notification.
 */
export function check_notification_displayed(
  aWindow,
  aBoxId,
  aValue,
  aNotification
) {
  const nb = aWindow.document.getElementById(aBoxId);
  if (!nb) {
    throw new Error("Couldn't find a notification box for id=" + aBoxId);
  }

  if (nb.querySelector(".notificationbox-stack")) {
    const box = nb.querySelector(".notificationbox-stack")._notificationBox;
    const notification = box.getNotificationWithValue(aValue);
    if (aNotification) {
      aNotification.notification = notification;
    }
    return notification != null;
  }

  return false;
}

/**
 * A helper function ensuring whether or not a notification with
 * a particular value is being displayed. Throws if the state is
 * not the expected one.
 *
 * @param {Window} aWindow - The window to check.
 * @param {string} aBoxId - The id of the notification box.
 * @param {string} aValue - The value of the notification to look for.
 * @param {boolean} aDisplayed - true if the notification should be displayed.
 * @returns {Element} the notification if we're asserting that the notification is
 *   displayed, and it actually shows up. Throws otherwise.
 */
export function assert_notification_displayed(
  aWindow,
  aBoxId,
  aValue,
  aDisplayed
) {
  const notification = {};
  const hasNotification = check_notification_displayed(
    aWindow,
    aBoxId,
    aValue,
    notification
  );
  if (hasNotification != aDisplayed) {
    throw new Error(
      "Expected the notification with value " +
        aValue +
        " to " +
        (aDisplayed ? "be shown" : "not be shown")
    );
  }

  return notification.notification;
}

/**
 * A helper function for closing a notification if one is currently displayed
 * in the window.
 *
 * @param {Window} aWindow - The window with the notification.
 * @param {string} aBoxId - The id of the notification box.
 * @param {string} aValue - The value of the notification to close.
 */
export function close_notification(aWindow, aBoxId, aValue) {
  const nb = aWindow.document.getElementById(aBoxId);
  if (!nb) {
    throw new Error("Couldn't find a notification box for id=" + aBoxId);
  }

  const box = nb.querySelector(".notificationbox-stack")._notificationBox;
  const notification = box.getNotificationWithValue(aValue);
  if (notification) {
    notification.close();
  }
}

/**
 * A helper function that waits for a notification with value aValue
 * to stop displaying in the window.
 *
 * @param {Window} aWindow - the window with the notification.
 * @param {string} aBoxId - the id of the notification box.
 * @param {string} aValue - The value of the notification to wait to stop.
 */
export async function wait_for_notification_to_stop(aWindow, aBoxId, aValue) {
  const nb = aWindow.document.getElementById(aBoxId);
  if (!nb) {
    throw new Error("Couldn't find a notification box for id=" + aBoxId);
  }

  const box = nb.querySelector(".notificationbox-stack")?._notificationBox;
  await TestUtils.waitForCondition(
    () => !box?.getNotificationWithValue(aValue),
    "Timed out waiting for notification with value " + aValue + " to stop."
  );
}

/**
 * A helper function that waits for a notification with value aValue
 * to show in the window.
 *
 * @param {Window} aWindow - The window that we want the notification to appear in.
 * @param {string} aBoxId - The id of the notification box.
 * @param {string} aValue - The value of the notification to wait for.
 */
export async function wait_for_notification_to_show(aWindow, aBoxId, aValue) {
  const nb = aWindow.document.getElementById(aBoxId);
  if (!nb) {
    throw new Error("Couldn't find a notification box for id=" + aBoxId);
  }

  await TestUtils.waitForCondition(
    function () {
      if (nb.querySelector(".notificationbox-stack")) {
        const box = nb.querySelector(".notificationbox-stack")._notificationBox;
        return box.getNotificationWithValue(aValue) != null && !box._animating;
      }
      return false;
    },
    "Timed out waiting for notification with value " + aValue + " to show."
  );
}

/**
 * Return the notification element based on the container ID and the Value type.
 *
 * @param {Window} win - The window that we want the notification to appear in.
 * @param {string} id - The id of the notification box.
 * @param {string} val - The value of the notification to fetch.
 * @returns {?Element} - The notification element if found.
 */
export function get_notification(win, id, val) {
  const nb = win.document.getElementById(id);
  if (!nb) {
    throw new Error("Couldn't find a notification box for id=" + id);
  }

  if (nb.querySelector(".notificationbox-stack")) {
    const box = nb.querySelector(".notificationbox-stack")._notificationBox;
    return box.getNotificationWithValue(val);
  }

  return null;
}

/**
 * Gets a button in a notification, as those do not have IDs.
 *
 * @param {Window} aWindow - The window that has the notification.
 * @param {string} aBoxId - The id of the notification box.
 * @param {string} aValue - The value of the notification to find.
 * @param {object} aMatch - Attributes of the button to find.
 *   An object with key:value pairs, similar to click_menus_in_sequence().
 */
export function get_notification_button(aWindow, aBoxId, aValue, aMatch) {
  const notification = get_notification(aWindow, aBoxId, aValue);
  const buttons = notification.buttonContainer.querySelectorAll(
    "button, toolbarbutton"
  );
  for (const button of buttons) {
    let matchedAll = true;
    for (const name in aMatch) {
      const value = aMatch[name];
      let matched = false;
      if (name == "popup") {
        if (button.getAttribute("type") == "menu") {
          // The button contains a menupopup as the first child.
          matched = button.querySelector("menupopup#" + value);
        } else {
          // The "popup" attribute is not on the button itself but in its
          // buttonInfo member.
          matched = "buttonInfo" in button && button.buttonInfo.popup == value;
        }
      } else if (
        button.hasAttribute(name) &&
        button.getAttribute(name) == value
      ) {
        matched = true;
      }
      if (!matched) {
        matchedAll = false;
        break;
      }
    }
    if (matchedAll) {
      return button;
    }
  }

  throw new Error("Couldn't find the requested button on a notification");
}
