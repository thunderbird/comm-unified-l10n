/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Oracle Corporation code.
 *
 * The Initial Developer of the Original Code is Oracle Corporation
 * Portions created by the Initial Developer are Copyright (C) 2005
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Stuart Parmenter <stuart.parmenter@oracle.com>
 *   Philipp Kewisch <mozilla@kewis.ch>
 *   Daniel Boelzle <daniel.boelzle@sun.com>
 *   Roman Kaeppeler <rkaeppeler@web.de>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

Components.utils.import("resource://gre/modules/PluralForm.jsm");
Components.utils.import("resource://calendar/modules/calUtils.jsm");

/**
 * Helper function to get the alarm service and cache it.
 *
 * @return The alarm service component
 */
function getAlarmService() {
    if (!("mAlarmService" in window)) {
        window.mAlarmService = Components.classes["@mozilla.org/calendar/alarm-service;1"]
                                         .getService(Components.interfaces.calIAlarmService);
    }
    return window.mAlarmService;
}

/**
 * Event handler for the 'snooze' event. Snoozes the given alarm by the given
 * number of minutes using the alarm service.
 *
 * @param event     The snooze event
 */
function onSnoozeAlarm(event) {
    // reschedule alarm:
    let duration = cal.createDuration();
    duration.minutes = event.detail;
    duration.normalize();
    getAlarmService().snoozeAlarm(event.target.item, event.target.alarm, duration);
}

/**
 * Event handler for the 'dismiss' event. Dismisses the given alarm using the
 * alarm service.
 *
 * @param event     The snooze event
 */
function onDismissAlarm(event) {
    getAlarmService().dismissAlarm(event.target.item, event.target.alarm);
}

/**
 * Called to dismiss all alarms in the alarm window.
 */
function onDismissAllAlarms() {
    // removes widgets on the fly:
    let alarmRichlist = document.getElementById("alarm-richlist");

    // Make a copy of the child nodes as they get modified live
    for each (let node in Array.slice(alarmRichlist.childNodes)) {
        // Check if the node is a valid alarm and is still part of DOM
        if (node.parentNode && node.item && node.alarm) {
            getAlarmService().dismissAlarm(node.item, node.alarm);
        }
    }
}

/**
 * Event handler fired when the alarm widget's "Details..." label was clicked.
 * Open the event dialog in the most recent Sunbird or Thunderbird window
 *
 * @param event     The itemdetails event.
 */
function onItemDetails(event) {
    // We want this to happen in a calendar window.
    let wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                       .getService(Components.interfaces.nsIWindowMediator);
    let calWindow = wm.getMostRecentWindow("calendarMainWindow") ||
                    wm.getMostRecentWindow("mail:3pane");
    calWindow.modifyEventWithDialog(event.target.item, null, true);
}

/**
 * Sets up the alarm dialog, initializing the default snooze length and setting
 * up the relative date update timer.
 */
var gRelativeDateUpdateTimer;
function setupWindow() {
    // We want to update when we are at 0 seconds past the minute. To do so, use
    // setTimeout to wait until we are there, then setInterval to execute every
    // minute. Since setInterval is not totally exact, we may run into problems
    // here. I hope not!
    let current = new Date();

    let timeout = (60 - current.getSeconds()) * 1000;
    gRelativeDateUpdateTimer = setTimeout(function wait_until_next_minute() {
        updateRelativeDates();
        gRelativeDateUpdateTimer = setInterval(updateRelativeDates, 60 * 1000);
    }, timeout);

    // Give focus to the alarm richlist after onload completes. See bug 103197
    setTimeout(onFocusWindow, 0);
}

/**
 * Unload function for the alarm dialog. If applicable, snooze the remaining
 * alarms and clean up the relative date update timer.
 */
function finishWindow() {
    let alarmRichlist = document.getElementById("alarm-richlist");

    if (alarmRichlist.childNodes.length > 0) {
        // If there are still items, the window wasn't closed using dismiss
        // all/snooze all. This can happen when the closer is clicked or escape
        // is pressed. Snooze all remaining items using the default snooze
        // property.
        let snoozePref = getPrefSafe("calendar.alarms.defaultsnoozelength", 0);
        if (snoozePref <= 0) {
            snoozePref = 5;
        }
        snoozeAllItems(snoozePref);
    }

    // Stop updating the relative time
    clearTimeout(gRelativeDateUpdateTimer);
}

/**
 * Set up the focused element. If no element is focused, then switch to the
 * richlist.
 */
function onFocusWindow() {
    if (!document.commandDispatcher.focusedElement) {
        document.getElementById("alarm-richlist").focus();
    }
}

/**
 * Timer callback to update all relative date labels
 */
function updateRelativeDates() {
    let alarmRichlist = document.getElementById("alarm-richlist");
    for each (let node in Array.slice(alarmRichlist.childNodes)) {
        if (node.item && node.alarm) {
            node.updateRelativeDateLabel();
        }
    }
}

/**
 * Function to snooze all alarms the given number of minutes.
 *
 * @param aDurationMinutes    The duration in minutes
 */
function snoozeAllItems(aDurationMinutes) {
    let duration = cal.createDuration();
    duration.minutes = aDurationMinutes;
    duration.normalize();

    let alarmRichlist = document.getElementById("alarm-richlist");

    // Make a copy of the child nodes as they get modified live
    for each (let node in Array.slice(alarmRichlist.childNodes)) {
        // Check if the node is a valid alarm and is still part of DOM
        if (node.parentNode && node.item && node.alarm) {
            getAlarmService().snoozeAlarm(node.item, node.alarm, duration);
        }
    }
}

/**
 * Sets up the window title, counting the number of alarms in the window.
 */
function setupTitle() {
    let alarmRichlist = document.getElementById("alarm-richlist");
    let reminders = alarmRichlist.childNodes.length;

    let title = PluralForm.get(reminders, calGetString("calendar", "alarmWindowTitle.label"));
    document.title = title.replace("#1", reminders);
}

/**
 * Comparison function for the start date of a calendar item and
 * the start date of a calendar-alarm-widget.
 *
 * @param aItem                 A calendar item for the comparison of the start date property
 * @param calAlarmWidget        A calendar-alarm-widget for the start date comparison with the given calendar item
 * @return                      1 - if the calendar item starts before the calendar-alarm-widget
 *                             -1 - if the calendar-alarm-widget starts before the calendar item
 *                              0 - otherwise
 */
function widgetAlarmComptor(aItem, calAlarmWidget) {

    if (aItem == null || calAlarmWidget == null || calAlarmWidget.item == null) return -1;

    // Get the dates to compare
    let aDate = aItem[calGetStartDateProp(aItem)];
    let bDate = calAlarmWidget.item[calGetStartDateProp(calAlarmWidget.item)];

    return aDate.compare(bDate);
}

/**
 * Add an alarm widget for the passed alarm and item.
 *
 * @param aItem       The calendar item to add a widget for.
 * @param aAlarm      The alarm to add a widget for.
 */
function addWidgetFor(aItem, aAlarm) {
    let widget = document.createElement("calendar-alarm-widget");
    let alarmRichlist = document.getElementById("alarm-richlist");

    // Add widgets sorted by start date ascending
    binaryInsertNode(alarmRichlist, widget, aItem, widgetAlarmComptor, false);

    widget.item = aItem;
    widget.alarm = aAlarm;
    widget.addEventListener("snooze", onSnoozeAlarm, false);
    widget.addEventListener("dismiss", onDismissAlarm, false);
    widget.addEventListener("itemdetails", onItemDetails, false);

    setupTitle();

    if (!alarmRichlist.userSelectedWidget) {
        // Always select first widget of the list.
        // Since the onselect event causes scrolling,
        // we don't want to process the event when adding widgets.
        alarmRichlist.suppressOnSelect = true;
        alarmRichlist.selectedIndex = 0;
        alarmRichlist.suppressOnSelect = false;
    }

    window.focus();
    window.getAttention();
}

/**
 * Remove the alarm widget for the passed alarm and item.
 *
 * @param aItem       The calendar item to remove the alarm widget for.
 * @param aAlarm      The alarm to remove the widget for.
 */
function removeWidgetFor(aItem, aAlarm) {
    let hashId = aItem.hashId;
    let alarmRichlist = document.getElementById("alarm-richlist");
    let nodes = alarmRichlist.childNodes;
    let notfound = true;
    for (let i = nodes.length - 1; notfound && i >= 0; --i) {
        let widget = nodes[i];
        if (widget.item && widget.item.hashId == hashId &&
            widget.alarm && widget.alarm.icalString == aAlarm.icalString) {

            if (widget.selected) {
                // Advance selection if needed
                widget.control.selectedItem = widget.previousSibling ||
                                              widget.nextSibling;
            }

            widget.removeEventListener("snooze", onSnoozeAlarm, false);
            widget.removeEventListener("dismiss", onDismissAlarm, false);
            widget.removeEventListener("itemdetails", onItemDetails, false);

            alarmRichlist.removeChild(widget);
            closeIfEmpty();
            notfound = false;
        }
    }

    // Update the title
    setupTitle();
}

/**
 * Close the alarm dialog if there are no further alarm widgets
 */
function closeIfEmpty() {
    let alarmRichlist = document.getElementById("alarm-richlist");
    if (!alarmRichlist.hasChildNodes()) {
        // check again next round since this removeWidgetFor call may be
        // followed by an addWidgetFor call (e.g. when refreshing), and
        // we don't want to close and open the window in that case.
        function closer() {
            if (!alarmRichlist.hasChildNodes()) {
                window.close();
            }
        }
        setTimeout(closer, 0);
    }
}

/**
 * Handler function called when an alarm entry in the richlistbox is selected
 *
 * @param event         The DOM event from the click action
 */
function onSelectAlarm(event) {
    let richList = document.getElementById("alarm-richlist")
    if (richList == event.target) {
        richList.ensureElementIsVisible(richList.getSelectedItem(0));
        richList.userSelectedWidget = true;
    }
}
