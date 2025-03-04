/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * This tests various commands on messages. This is primarily for commands
 * that can't be tested with xpcshell tests because they're handling in the
 * front end.
 */

"use strict";

var { promise_content_tab_load } = ChromeUtils.importESModule(
  "resource://testing-common/mail/ContentTabHelpers.sys.mjs"
);
var {
  add_message_sets_to_folders,
  assert_selected_and_displayed,
  be_in_folder,
  close_popup,
  collapse_all_threads,
  create_folder,
  create_thread,
  get_about_3pane,
  get_special_folder,
  make_display_threaded,
  make_message_sets_in_folders,
  press_delete,
  right_click_on_row,
  select_click_row,
  select_shift_click_row,
} = ChromeUtils.importESModule(
  "resource://testing-common/mail/FolderDisplayHelpers.sys.mjs"
);
var { click_menus_in_sequence } = ChromeUtils.importESModule(
  "resource://testing-common/mail/WindowHelpers.sys.mjs"
);

var { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);
var { MailUtils } = ChromeUtils.importESModule(
  "resource:///modules/MailUtils.sys.mjs"
);

var unreadFolder, shiftDeleteFolder, threadDeleteFolder;
var trashFolder, newsgroupFolder;
var tagArray;
var gAutoRead;

// Adjust timeout to take care of code coverage runs needing twice as long.
requestLongerTimeout(AppConstants.MOZ_CODE_COVERAGE ? 2 : 1);

add_setup(async function () {
  gAutoRead = Services.prefs.getBoolPref("mailnews.mark_message_read.auto");
  Services.prefs.setBoolPref("mailnews.mark_message_read.auto", false);

  unreadFolder = await create_folder("UnreadFolder");
  shiftDeleteFolder = await create_folder("ShiftDeleteFolder");
  threadDeleteFolder = await create_folder("ThreadDeleteFolder");
  trashFolder = await get_special_folder(
    Ci.nsMsgFolderFlags.Trash,
    true,
    null,
    false
  );
  newsgroupFolder = await create_folder("NewsgroupFolder", [
    Ci.nsMsgFolderFlags.Newsgroup,
  ]);

  await make_message_sets_in_folders([unreadFolder], [{ count: 2 }]);
  await make_message_sets_in_folders([shiftDeleteFolder], [{ count: 4 }]);
  await add_message_sets_to_folders(
    [threadDeleteFolder],
    [create_thread(3), create_thread(3), create_thread(3)]
  );
  await make_message_sets_in_folders([trashFolder], [{ count: 3 }]);
  await make_message_sets_in_folders([newsgroupFolder], [{ count: 3 }]);

  tagArray = MailServices.tags.getAllTags();

  registerCleanupFunction(function () {
    Services.prefs.setBoolPref("mailnews.mark_message_read.auto", gAutoRead);
    unreadFolder.deleteSelf(null);
    shiftDeleteFolder.deleteSelf(null);
    threadDeleteFolder.deleteSelf(null);
    newsgroupFolder.deleteSelf(null);
  });
});

/**
 * Ensures that all messages have a particular read status
 *
 * @param {nsIMsgDBHdr[]} messages - An array of nsIMsgDBHdrs to check.
 * @param {boolean} read - true if the messages should be marked read.
 */
function check_read_status(messages, read) {
  function read_str(isRead) {
    return isRead ? "read" : "unread";
  }

  for (let i = 0; i < messages.length; i++) {
    Assert.ok(
      messages[i].isRead == read,
      "Message marked as " +
        read_str(messages[i].isRead) +
        ", expected " +
        read_str(read)
    );
  }
}

/**
 * Ensures that the mark read/unread menu items are enabled/disabled properly
 *
 * @param {integer} index - The row in the thread pane of the message to query.
 * @param {boolean} canMarkRead - true if the mark read item should be enabled
 * @param {boolean} canMarkUnread - true if the mark unread item should be enabled
 */
async function check_read_menuitems(index, canMarkRead, canMarkUnread) {
  await right_click_on_row(index);
  const hiddenPromise = BrowserTestUtils.waitForEvent(
    getMailContext(),
    "popuphidden"
  );
  await click_menus_in_sequence(getMailContext(), [{ id: "mailContext-mark" }]);

  const readEnabled = !getMailContext().querySelector("#mailContext-markRead")
    .disabled;
  const unreadEnabled = !getMailContext().querySelector(
    "#mailContext-markUnread"
  ).disabled;

  Assert.ok(
    readEnabled == canMarkRead,
    "Mark read menu item " +
      (canMarkRead ? "dis" : "en") +
      "abled when it shouldn't be!"
  );

  Assert.ok(
    unreadEnabled == canMarkUnread,
    "Mark unread menu item " +
      (canMarkUnread ? "dis" : "en") +
      "abled when it shouldn't be!"
  );

  await hiddenPromise;
  await new Promise(resolve => requestAnimationFrame(resolve));
}

/**
 * Mark a message read or unread via the context menu.
 *
 * @param {integer} index - The row in the thread pane of the message to mark
 *   read/unread.
 * @param {boolean} read - true the message should be marked read, false otherwise.
 */
async function mark_read_via_menu(index, read) {
  const menuItem = read ? "mailContext-markRead" : "mailContext-markUnread";
  await right_click_on_row(index);
  await BrowserTestUtils.waitForPopupEvent(getMailContext(), "shown");
  await click_menus_in_sequence(getMailContext(), [
    { id: "mailContext-mark" },
    { id: menuItem },
  ]);
  await BrowserTestUtils.waitForPopupEvent(getMailContext(), "hidden");
  await new Promise(resolve => window.requestIdleCallback(resolve));
}

add_task(async function test_mark_one_read() {
  await be_in_folder(unreadFolder);
  const curMessage = await select_click_row(0);

  curMessage.markRead(false);
  await mark_read_via_menu(0, true);
  check_read_status([curMessage], true);
});

add_task(async function test_mark_one_unread() {
  await be_in_folder(unreadFolder);
  const curMessage = await select_click_row(0);

  curMessage.markRead(true);
  await mark_read_via_menu(0, false);
  check_read_status([curMessage], false);
});

add_task(async function test_mark_n_read() {
  await be_in_folder(unreadFolder);
  await select_click_row(0);
  const curMessages = await select_shift_click_row(1);

  for (let i = 0; i < curMessages.length; i++) {
    curMessages[i].markRead(false);
  }
  await mark_read_via_menu(0, true);
  check_read_status(curMessages, true);
});

add_task(async function test_mark_n_unread() {
  await be_in_folder(unreadFolder);
  await select_click_row(0);
  const curMessages = await select_shift_click_row(1);

  for (let i = 0; i < curMessages.length; i++) {
    curMessages[i].markRead(true);
  }
  await mark_read_via_menu(0, false);
  check_read_status(curMessages, false);
});

add_task(async function test_mark_n_read_mixed() {
  await be_in_folder(unreadFolder);
  await select_click_row(0);
  const curMessages = await select_shift_click_row(1);

  curMessages[0].markRead(true);
  curMessages[1].markRead(false);
  await mark_read_via_menu(0, true);
  check_read_status(curMessages, true);

  curMessages[0].markRead(false);
  curMessages[1].markRead(true);
  await mark_read_via_menu(0, true);
  check_read_status(curMessages, true);
});

add_task(async function test_mark_n_unread_mixed() {
  await be_in_folder(unreadFolder);
  await select_click_row(0);
  const curMessages = await select_shift_click_row(1);

  curMessages[0].markRead(false);
  curMessages[1].markRead(true);
  await mark_read_via_menu(0, false);
  check_read_status(curMessages, false);

  curMessages[0].markRead(true);
  curMessages[1].markRead(false);
  await mark_read_via_menu(0, false);
  check_read_status(curMessages, false);
});

add_task(async function test_toggle_read() {
  await be_in_folder(unreadFolder);
  const curMessage = await select_click_row(0);

  curMessage.markRead(false);
  EventUtils.synthesizeKey("m", {});
  await TestUtils.waitForTick();
  check_read_status([curMessage], true);
});

add_task(async function test_toggle_unread() {
  await be_in_folder(unreadFolder);
  const curMessage = await select_click_row(0);

  curMessage.markRead(true);
  EventUtils.synthesizeKey("m", {});
  await TestUtils.waitForTick();
  check_read_status([curMessage], false);
});

add_task(async function test_toggle_mixed() {
  await be_in_folder(unreadFolder);
  await select_click_row(0);
  const curMessages = await select_shift_click_row(1);

  curMessages[0].markRead(false);
  curMessages[1].markRead(true);
  EventUtils.synthesizeKey("m", {});
  await TestUtils.waitForTick();
  check_read_status(curMessages, true);

  curMessages[0].markRead(true);
  curMessages[1].markRead(false);
  EventUtils.synthesizeKey("m", {});
  await TestUtils.waitForTick();
  check_read_status(curMessages, false);
});

add_task(async function test_mark_menu_read() {
  await be_in_folder(unreadFolder);
  const curMessage = await select_click_row(0);

  curMessage.markRead(false);
  await check_read_menuitems(0, true, false);
});

add_task(async function test_mark_menu_unread() {
  await be_in_folder(unreadFolder);
  const curMessage = await select_click_row(0);

  curMessage.markRead(true);
  await check_read_menuitems(0, false, true);
});

add_task(async function test_mark_menu_mixed() {
  await be_in_folder(unreadFolder);
  await select_click_row(0);
  const curMessages = await select_shift_click_row(1);

  curMessages[0].markRead(false);
  curMessages[1].markRead(true);

  await check_read_menuitems(0, true, true);
});

add_task(async function test_mark_all_read() {
  await be_in_folder(unreadFolder);
  const curMessage = await select_click_row(0);
  curMessage.markRead(false);

  // Make sure we can mark all read with >0 messages unread.
  await right_click_on_row(0);
  await BrowserTestUtils.waitForPopupEvent(getMailContext(), "shown");
  await click_menus_in_sequence(getMailContext(), [
    { id: "mailContext-mark" },
    { id: "mailContext-markAllRead" },
  ]);
  await BrowserTestUtils.waitForPopupEvent(getMailContext(), "hidden");
  await new Promise(resolve => requestAnimationFrame(resolve));

  Assert.ok(curMessage.isRead, "Message should have been marked read!");

  // Make sure we can't mark all read, now that all messages are already read.
  await right_click_on_row(0);
  await BrowserTestUtils.waitForPopupEvent(getMailContext(), "shown");

  await click_menus_in_sequence(getMailContext(), [{ id: "mailContext-mark" }]);
  await BrowserTestUtils.waitForPopupEvent(getMailContext(), "hidden");
  await new Promise(resolve => requestAnimationFrame(resolve));

  const allReadDisabled = getMailContext().querySelector(
    "#mailContext-markAllRead"
  ).disabled;
  Assert.ok(allReadDisabled, "Mark All Read menu item should be disabled!");
});

add_task(async function test_mark_thread_as_read() {
  const unreadThreadFolder = await create_folder("UnreadThreadFolder");
  await add_message_sets_to_folders([unreadThreadFolder], [create_thread(3)]);
  await be_in_folder(unreadThreadFolder);
  await make_display_threaded();

  const serviceState = Services.prefs.getBoolPref(
    "mailnews.mark_message_read.auto"
  );
  if (serviceState) {
    // If mailnews.mark_message_read.auto is true, then we set it to false.
    Services.prefs.setBoolPref("mailnews.mark_message_read.auto", false);
  }

  // Make sure Mark Thread as Read is enabled with >0 messages in thread unread.
  await right_click_on_row(0);
  await BrowserTestUtils.waitForPopupEvent(getMailContext(), "shown");
  await click_menus_in_sequence(getMailContext(), [{ id: "mailContext-mark" }]);

  let markThreadAsReadDisabled = document.getElementById(
    "mailContext-markThreadAsRead"
  ).disabled;
  Assert.ok(
    !markThreadAsReadDisabled,
    "Mark Thread as read menu item should not be disabled!"
  );

  // Make sure messages are read when Mark Thread as Read is clicked.
  await right_click_on_row(0);
  await BrowserTestUtils.waitForPopupEvent(getMailContext(), "shown");
  await click_menus_in_sequence(getMailContext(), [
    { id: "mailContext-mark" },
    { id: "mailContext-markThreadAsRead" },
  ]);
  await close_popup(window, getMailContext());

  const curMessage = await select_click_row(0);
  Assert.ok(curMessage.isRead, "Message should have been marked read!");

  // Make sure Mark Thread as Read is now disabled with all messages read.
  await right_click_on_row(0);
  await BrowserTestUtils.waitForPopupEvent(getMailContext(), "shown");
  await click_menus_in_sequence(getMailContext(), [{ id: "mailContext-mark" }]);

  markThreadAsReadDisabled = document.getElementById(
    "mailContext-markThreadAsRead"
  ).disabled;
  Assert.ok(
    markThreadAsReadDisabled,
    "Mark Thread as read menu item should  be disabled!"
  );

  // Make sure that adding an unread message enables Mark Thread as Read once more.
  curMessage.markRead(false);
  await right_click_on_row(0);
  await BrowserTestUtils.waitForPopupEvent(getMailContext(), "shown");
  await click_menus_in_sequence(getMailContext(), [{ id: "mailContext-mark" }]);

  markThreadAsReadDisabled = document.getElementById(
    "mailContext-markThreadAsRead"
  ).disabled;
  Assert.ok(
    !markThreadAsReadDisabled,
    "Mark Thread as read menu item should not be disabled!"
  );

  Services.prefs.setBoolPref("mailnews.mark_message_read.auto", true);
}).skip(); // See bug 654362.

add_task(async function roving_multi_message_buttons() {
  await be_in_folder(unreadFolder);
  await select_click_row(0);
  const curMessages = await select_shift_click_row(1);
  await assert_selected_and_displayed(curMessages);

  const multiMsgView = get_about_3pane().multiMessageBrowser;
  const BUTTONS_SELECTOR = `toolbarbutton:not([hidden="true"]`;
  const headerToolbar = multiMsgView.contentDocument.getElementById(
    "header-view-toolbar"
  );
  const headerButtons = headerToolbar.querySelectorAll(BUTTONS_SELECTOR);

  // Press tab while on the message selected to access the multi message view
  // header buttons.
  if (
    !Services.prefs.getBoolPref("dom.disable_tab_focus_to_root_element", true)
  ) {
    EventUtils.synthesizeKey("KEY_Tab", {});
  }
  EventUtils.synthesizeKey("KEY_Tab", {});
  Assert.equal(
    headerButtons[0].id,
    multiMsgView.contentDocument.activeElement.id,
    "focused on first msgHdr toolbar button"
  );

  // Simulate the Arrow Right keypress to make sure the correct button gets the
  // focus.
  for (let i = 1; i < headerButtons.length; i++) {
    const previousElement = document.activeElement;
    EventUtils.synthesizeKey("KEY_ArrowRight", {});
    Assert.equal(
      multiMsgView.contentDocument.activeElement.id,
      headerButtons[i].id,
      "The next button is focused"
    );
    Assert.ok(
      multiMsgView.contentDocument.activeElement.tabIndex == 0 &&
        previousElement.tabIndex == -1,
      "The roving tab index was updated"
    );
  }

  // Simulate the Arrow Left keypress to make sure the correct button gets the
  // focus.
  for (let i = headerButtons.length - 2; i > -1; i--) {
    const previousElement = document.activeElement;
    EventUtils.synthesizeKey("KEY_ArrowLeft", {});
    Assert.equal(
      multiMsgView.contentDocument.activeElement.id,
      headerButtons[i].id,
      "The previous button is focused"
    );
    Assert.ok(
      multiMsgView.contentDocument.activeElement.tabIndex == 0 &&
        previousElement.tabIndex == -1,
      "The roving tab index was updated"
    );
  }

  // Check that once the Escape key is pressed twice, focus will move back to
  // the selected messages.
  EventUtils.synthesizeKey("KEY_Escape", {});
  EventUtils.synthesizeKey("KEY_Escape", {});
  await assert_selected_and_displayed(curMessages);
}).skip(AppConstants.platform == "macosx");

function promise_and_check_alert_dialog(buttonName, warningText) {
  return BrowserTestUtils.promiseAlertDialog(undefined, undefined, {
    callback(win) {
      const message = win.document.getElementById("infoBody");
      Assert.equal(message.textContent, warningText);
      win.document.querySelector("dialog").getButton(buttonName).click();
    },
  });
}

add_task(async function test_shift_delete_prompt() {
  await be_in_folder(shiftDeleteFolder);
  let curMessage = await select_click_row(0);
  goUpdateCommand("cmd_shiftDelete");

  // First, try shift-deleting and then cancelling at the prompt.
  Services.prefs.setBoolPref("mail.warn_on_shift_delete", true);
  const warning =
    "This will delete messages immediately, without saving a copy to Trash. Are you sure you want to continue?";
  let dialogPromise = promise_and_check_alert_dialog("cancel", warning);
  // We don't use press_delete here because we're not actually deleting this
  // time!
  EventUtils.synthesizeKey("KEY_Delete", { shiftKey: true });
  await dialogPromise;
  // Make sure we didn't actually delete the message.
  Assert.equal(curMessage, await select_click_row(0));

  // Second, try shift-deleting and then accepting the deletion.
  dialogPromise = promise_and_check_alert_dialog("accept", warning);
  await press_delete(window, { shiftKey: true });
  await dialogPromise;
  // Make sure we really did delete the message.
  Assert.notEqual(curMessage, await select_click_row(0));

  // Third, focus the message pane, then try shift-deleting and accepting
  // the deletion.
  EventUtils.synthesizeKey("KEY_F6", {});
  dialogPromise = promise_and_check_alert_dialog("accept", warning);
  await press_delete(window, { shiftKey: true });
  await dialogPromise;
  // Make sure we really did delete the message.
  Assert.notEqual(curMessage, await select_click_row(0));

  // Finally, try shift-deleting when we turned off the prompt.
  Services.prefs.setBoolPref("mail.warn_on_shift_delete", false);
  curMessage = await select_click_row(0);
  await press_delete(window, { shiftKey: true });

  // Make sure we really did delete the message.
  Assert.notEqual(curMessage, await select_click_row(0));

  Services.prefs.clearUserPref("mail.warn_on_shift_delete");
});

add_task(async function test_thread_delete_prompt() {
  await be_in_folder(threadDeleteFolder);
  await make_display_threaded();
  await collapse_all_threads();

  let curMessage = await select_click_row(0);
  goUpdateCommand("cmd_delete");
  // First, try deleting and then cancelling at the prompt.
  Services.prefs.setBoolPref("mail.warn_on_collapsed_thread_operation", true);
  const warning =
    "This will delete messages in collapsed threads. Are you sure you want to continue?";
  let dialogPromise = promise_and_check_alert_dialog("cancel", warning);
  // We don't use press_delete here because we're not actually deleting this
  // time!
  EventUtils.synthesizeKey("KEY_Delete");
  await dialogPromise;
  // Make sure we didn't actually delete the message.
  Assert.equal(curMessage, await select_click_row(0));

  // Second, try deleting and then accepting the deletion.
  dialogPromise = promise_and_check_alert_dialog("accept", warning);
  await press_delete(window);
  await dialogPromise;
  // Make sure we really did delete the message.
  Assert.notEqual(curMessage, await select_click_row(0));

  // Finally, try deleting when we turned off the prompt.
  Services.prefs.setBoolPref("mail.warn_on_collapsed_thread_operation", false);
  curMessage = await select_click_row(0);
  await press_delete(window);

  // Make sure we really did delete the message.
  Assert.notEqual(curMessage, await select_click_row(0));

  Services.prefs.clearUserPref("mail.warn_on_collapsed_thread_operation");
});

add_task(async function test_delete_from_trash_prompt() {
  await be_in_folder(trashFolder);
  let curMessage = await select_click_row(0);
  goUpdateCommand("cmd_Delete");

  // First, try deleting and then cancelling at the prompt.
  Services.prefs.setBoolPref("mail.warn_on_delete_from_trash", true);
  const warning =
    "This will permanently delete messages from Trash. Are you sure you want to continue?";
  let dialogPromise = promise_and_check_alert_dialog("cancel", warning);
  // We don't use press_delete here because we're not actually deleting this
  // time!
  EventUtils.synthesizeKey("KEY_Delete");
  await dialogPromise;
  // Make sure we didn't actually delete the message.
  Assert.equal(curMessage, await select_click_row(0));

  // Second, try deleting and then accepting the deletion.
  dialogPromise = promise_and_check_alert_dialog("accept", warning);
  await press_delete(window);
  await dialogPromise;
  // Make sure we really did delete the message.
  Assert.notEqual(curMessage, await select_click_row(0));

  // Finally, try deleting when we turned off the prompt.
  Services.prefs.setBoolPref("mail.warn_on_delete_from_trash", false);
  curMessage = await select_click_row(0);
  await press_delete(window);

  // Make sure we really did delete the message.
  Assert.notEqual(curMessage, await select_click_row(0));

  Services.prefs.clearUserPref("mail.warn_on_delete_from_trash");
});

add_task(async function test_delete_from_newsgroup_prompt() {
  await be_in_folder(newsgroupFolder);
  let curMessage = await select_click_row(0);
  goUpdateCommand("cmd_Delete");

  // First, try deleting and then cancelling at the prompt.
  Services.prefs.setBoolPref("news.warn_on_delete", true);
  const warning =
    "This will delete messages immediately, without saving a copy to Trash. Are you sure you want to continue?";
  let dialogPromise = promise_and_check_alert_dialog("cancel", warning);
  // We don't use press_delete here because we're not actually deleting this
  // time!
  EventUtils.synthesizeKey("KEY_Delete");
  await dialogPromise;
  // Make sure we didn't actually delete the message.
  Assert.equal(curMessage, await select_click_row(0));

  // Second, try deleting and then accepting the deletion.
  dialogPromise = promise_and_check_alert_dialog("accept", warning);
  await press_delete(window);
  await dialogPromise;
  // Make sure we really did delete the message.
  Assert.notEqual(curMessage, await select_click_row(0));

  // Finally, try deleting when we turned off the prompt.
  Services.prefs.setBoolPref("news.warn_on_delete", false);
  curMessage = await select_click_row(0);
  await press_delete(window);

  // Make sure we really did delete the message.
  Assert.notEqual(curMessage, await select_click_row(0));

  Services.prefs.clearUserPref("news.warn_on_delete");
});

/**
 * @param {nsIMsgDBHdr} message
 * @param {nsIMsgTag} tag - Tag to check.
 * @param {boolean} isSet - Whether the tag is expected to be set.
 */
function check_tag_in_message(message, tag, isSet) {
  const tagSet = message
    .getStringProperty("keywords")
    .split(" ")
    .includes(tag.key);
  if (isSet) {
    Assert.ok(tagSet, "Tag '" + tag.tag + "' expected on message!");
  } else {
    Assert.ok(!tagSet, "Tag '" + tag.tag + "' not expected on message!");
  }
}

add_task(async function test_tag_keys() {
  await be_in_folder(unreadFolder);
  const curMessage = await select_click_row(0);

  EventUtils.synthesizeKey("1", {});
  check_tag_in_message(curMessage, tagArray[0], true);

  EventUtils.synthesizeKey("2", {});
  check_tag_in_message(curMessage, tagArray[0], true);
  check_tag_in_message(curMessage, tagArray[1], true);

  EventUtils.synthesizeKey("0", {});
  check_tag_in_message(curMessage, tagArray[0], false);
  check_tag_in_message(curMessage, tagArray[1], false);
});

add_task(async function test_tag_keys_disabled_in_content_tab() {
  await be_in_folder(unreadFolder);
  const curMessage = await select_click_row(0);

  window.openAddonsMgr("addons://list/theme");
  await new Promise(resolve => setTimeout(resolve));

  const tab = document.getElementById("tabmail").currentTabInfo;
  await promise_content_tab_load(tab, "about:addons", 15000);

  // Make sure pressing the "1" key in a content tab doesn't tag a message
  check_tag_in_message(curMessage, tagArray[0], false);
  EventUtils.synthesizeKey("1", {});
  check_tag_in_message(curMessage, tagArray[0], false);

  document.getElementById("tabmail").closeTab(tab);
});
