/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Tests the removal of folders from the database.
 */

add_setup(async function () {
  await installDB("move.sqlite");
});

add_task(function testDelete() {
  const grandparent = database.getFolderById(1);
  const parent = database.getFolderById(3);
  const a = database.getFolderById(4);
  const a1 = database.getFolderById(5);
  const a2 = database.getFolderById(6);
  const b = database.getFolderById(7);
  const b1 = database.getFolderById(8);
  const c = database.getFolderById(9);
  const d = database.getFolderById(10);

  drawTree(parent);

  // Delete a leaf folder.
  database.deleteFolder(b1);
  checkNoRow(b1.id);
  drawTree(parent);
  Assert.ok(!b1.rootFolder);
  Assert.ok(!b1.parent);
  Assert.deepEqual(b.children, []);

  // Delete a leaf folder with siblings.
  database.deleteFolder(a1);
  checkNoRow(a1.id);
  drawTree(parent);
  Assert.ok(!a1.rootFolder);
  Assert.ok(!a1.parent);
  Assert.deepEqual(a.children, [a2]);

  // Delete a folder with children.
  database.deleteFolder(d);
  checkNoRow(d.id);
  drawTree(parent);
  Assert.ok(!d.rootFolder);
  Assert.ok(!d.parent);
  Assert.deepEqual(parent.children, [a, b, c]);

  Assert.throws(
    () => database.deleteFolder(grandparent),
    /NS_ERROR_UNEXPECTED/,
    "deleteFolder should not allow the deletion of a root folder"
  );

  const stmt = database.connection.createStatement(
    "SELECT id FROM folders ORDER BY id"
  );
  const remaining = [];
  while (stmt.executeStep()) {
    remaining.push(stmt.row.id);
  }
  stmt.reset();
  stmt.finalize();
  Assert.deepEqual(remaining, [1, 2, 3, 4, 6, 7, 9, 14, 15, 16]);
});
