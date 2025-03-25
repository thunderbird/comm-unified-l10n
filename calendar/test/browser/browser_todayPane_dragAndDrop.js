/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Tests for drag and drop on the today pane.
 */
const { cal } = ChromeUtils.importESModule("resource:///modules/calendar/calUtils.sys.mjs");
const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
const { MessageGenerator } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/MessageGenerator.sys.mjs"
);

const calendar = CalendarTestUtils.createCalendar("Mochitest", "memory");
registerCleanupFunction(() => CalendarTestUtils.removeCalendar(calendar));

/**
 * Ensures the today pane is visible for each test.
 */
async function ensureTodayPane() {
  const todayPane = document.querySelector("#today-pane-panel");
  if (!todayPane.isVisible()) {
    todayPane.setVisible(true, true, true);
  }

  await TestUtils.waitForCondition(() => todayPane.isVisible(), "today pane not visible in time");
}

/**
 * Tests dropping a message from the message pane on to the today pane brings
 * up the new event dialog.
 */
add_task(async function testDropMozMessage() {
  const account = MailServices.accounts.createLocalMailAccount();
  const folder = account.incomingServer.rootFolder
    .QueryInterface(Ci.nsIMsgLocalMailFolder)
    .createLocalSubfolder("Mochitest");
  const subject = "The Grand Event";
  const body = "Parking is available.";

  const about3PaneTab = document.getElementById("tabmail").currentTabInfo;
  const about3Pane = about3PaneTab.chromeBrowser.contentWindow;
  about3Pane.displayFolder(folder);
  folder
    .QueryInterface(Ci.nsIMsgLocalMailFolder)
    .addMessage(new MessageGenerator().makeMessage({ subject, body: { body } }).toMessageString());
  about3Pane.threadTree.selectedIndex = 0;

  const msg = about3PaneTab.message;
  const msgStr = about3PaneTab.folder.getUriForMsg(msg);
  const msgUrl = MailServices.messageServiceFromURI(msgStr).getUrlForUri(msgStr);

  // Se tup a DataTransfer.
  const dataTransfer = new DataTransfer();
  dataTransfer.mozSetDataAt("text/x-moz-message", msgStr, 0);
  dataTransfer.mozSetDataAt("text/x-moz-url", msgUrl.spec, 0);
  dataTransfer.mozSetDataAt(
    "application/x-moz-file-promise-url",
    msgUrl.spec + "?fileName=" + encodeURIComponent("message.eml"),
    0
  );
  dataTransfer.mozSetDataAt(
    "application/x-moz-file-promise",
    new window.messageFlavorDataProvider(),
    0
  );

  const promise = CalendarTestUtils.waitForEventDialog("edit");
  await ensureTodayPane();
  document.querySelector("#agenda").dispatchEvent(new DragEvent("drop", { dataTransfer }));

  const eventWindow = await promise;
  const iframe = eventWindow.document.querySelector("#calendar-item-panel-iframe");
  const iframeDoc = iframe.contentDocument;

  Assert.equal(
    iframeDoc.querySelector("#item-title").value,
    subject,
    "the message subject was used as the event title"
  );
  Assert.equal(
    iframeDoc.querySelector("#item-description").contentDocument.body.innerText,
    body,
    "the message body was used as the event description"
  );

  registerCleanupFunction(async function () {
    await BrowserTestUtils.closeWindow(eventWindow);
    MailServices.accounts.removeAccount(account, false);
  });
});

/**
 * Tests dropping an entry from the address book adds the address as an attendee
 * to a new event when dropped on the today pane.
 */
add_task(async function testMozAddressDrop() {
  const vcard = CalendarTestUtils.dedent`
  BEGIN:VCARD
  VERSION:4.0
  EMAIL;PREF=1:person@example.com
  FN:Some Person
  N:Some;Person;;;
  UID:d5f9113d-5ede-4a5c-ba8e-0f2345369993
  END:VCARD
  `;

  const address = "Some Person <person@example.com>";

  // Setup a DataTransfer to mimic what the address book sends.
  const dataTransfer = new DataTransfer();
  dataTransfer.setData("moz/abcard", "0");
  dataTransfer.setData("text/x-moz-address", address);
  dataTransfer.setData("text/plain", address);
  dataTransfer.setData("text/vcard", decodeURIComponent(vcard));
  dataTransfer.setData("application/x-moz-file-promise-dest-filename", "person.vcf");
  dataTransfer.setData("application/x-moz-file-promise-url", "data:text/vcard," + vcard);
  dataTransfer.setData("application/x-moz-file-promise", window.abFlavorDataProvider);

  const promise = CalendarTestUtils.waitForEventDialog("edit");
  await ensureTodayPane();
  document.querySelector("#agenda").dispatchEvent(new DragEvent("drop", { dataTransfer }));

  const eventWindow = await promise;
  const iframe = eventWindow.document.querySelector("#calendar-item-panel-iframe");
  const iframeWin = iframe.cotnentWindow;
  const iframeDoc = iframe.contentDocument;

  // Verify the address was added as an attendee.
  EventUtils.synthesizeMouseAtCenter(
    iframeDoc.querySelector("#event-grid-tab-attendees"),
    {},
    iframeWin
  );

  const box = iframeDoc.querySelector('[attendeeid="mailto:person@example.com"]');
  Assert.ok(box, "address included as an attendee to the new event");
  await BrowserTestUtils.closeWindow(eventWindow);
});

/**
 * Tests dropping plain text that is actually ics data format is picked up by
 * the today pane.
 */
add_task(async function testPlainTextICSDrop() {
  const event = CalendarTestUtils.dedent`
  BEGIN:VCALENDAR
  BEGIN:VEVENT
  SUMMARY:An Event
  DESCRIPTION:Parking is not available.
  DTSTART:20210325T110000Z
  DTEND:20210325T120000Z
  UID:916bd967-35ac-40f6-8cd5-487739c9d245
  END:VEVENT
  END:VCALENDAR
  `;

  // Setup a DataTransfer to mimic what the address book sends.
  const dataTransfer = new DataTransfer();
  dataTransfer.setData("text/plain", event);

  const promise = CalendarTestUtils.waitForEventDialog("edit");
  await ensureTodayPane();
  document.querySelector("#agenda").dispatchEvent(new DragEvent("drop", { dataTransfer }));

  const eventWindow = await promise;
  const iframe = eventWindow.document.querySelector("#calendar-item-panel-iframe");
  const iframeDoc = iframe.contentDocument;
  Assert.equal(iframeDoc.querySelector("#item-title").value, "An Event");

  const startTime = iframeDoc.querySelector("#event-starttime");
  Assert.equal(
    startTime._datepicker._inputBoxValue,
    cal.dtz.formatter.formatDateShort(cal.createDateTime("20210325T110000Z"))
  );

  const endTime = iframeDoc.querySelector("#event-endtime");
  Assert.equal(
    endTime._datepicker._inputBoxValue,
    cal.dtz.formatter.formatDateShort(cal.createDateTime("20210325T120000Z"))
  );

  Assert.equal(
    iframeDoc.querySelector("#item-description").contentDocument.body.innerText,
    "Parking is not available."
  );
  await BrowserTestUtils.closeWindow(eventWindow);
});

/**
 * Tests dropping a file with an ics extension on the today pane is parsed as an
 * ics file.
 */
add_task(async function testICSFileDrop() {
  const file = await File.createFromFileName(getTestFilePath("data/event.ics"));
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);

  const promise = CalendarTestUtils.waitForEventDialog("edit");
  await ensureTodayPane();

  // For some reason, dataTransfer.items.add() results in a mozItemCount of 2
  // instead of one. Call onExternalDrop directly to get around that.
  window.calendarCalendarButtonDNDObserver.onExternalDrop(dataTransfer);

  const eventWindow = await promise;
  const iframe = eventWindow.document.querySelector("#calendar-item-panel-iframe");
  const iframeDoc = iframe.contentDocument;

  Assert.equal(iframeDoc.querySelector("#item-title").value, "An Event");

  const startTime = iframeDoc.querySelector("#event-starttime");
  Assert.equal(
    startTime._datepicker._inputBoxValue,
    cal.dtz.formatter.formatDateShort(cal.createDateTime("20210325T110000Z"))
  );

  const endTime = iframeDoc.querySelector("#event-endtime");
  Assert.equal(
    endTime._datepicker._inputBoxValue,
    cal.dtz.formatter.formatDateShort(cal.createDateTime("20210325T120000Z"))
  );

  Assert.equal(
    iframeDoc.querySelector("#item-description").contentDocument.body.innerText,
    "Parking is not available."
  );
  await BrowserTestUtils.closeWindow(eventWindow);
});

/**
 * Tests dropping any other file on the today pane ends up as an attachment
 * to a new event.
 */
add_task(async function testOtherFileDrop() {
  const file = await File.createFromNsIFile(
    new FileUtils.File(getTestFilePath("data/attachment.png"))
  );
  const dataTransfer = new DataTransfer();
  dataTransfer.setData("image/png", file);
  dataTransfer.items.add(file);

  const promise = CalendarTestUtils.waitForEventDialog("edit");
  await ensureTodayPane();
  document.querySelector("#agenda").dispatchEvent(new DragEvent("drop", { dataTransfer }));

  const eventWindow = await promise;
  const iframe = eventWindow.document.querySelector("#calendar-item-panel-iframe");
  const iframeWin = iframe.contentWindow;
  const iframeDoc = iframe.contentDocument;

  EventUtils.synthesizeMouseAtCenter(
    iframeDoc.querySelector("#event-grid-tab-attachments"),
    {},
    iframeWin
  );

  const listBox = iframeDoc.querySelector("#attachment-link");
  const listItem = listBox.itemChildren[0];
  Assert.equal(listItem.querySelector("label").value, "attachment.png");
  await BrowserTestUtils.closeWindow(eventWindow);
});
