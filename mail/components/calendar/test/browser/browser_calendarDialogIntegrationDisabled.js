/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

add_task(async function test_calendarDialogPreference() {
  Assert.equal(
    document.querySelectorAll("#calendarDialog").length,
    0,
    "no dialog exists"
  );
});
