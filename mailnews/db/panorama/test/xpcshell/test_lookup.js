/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Tests looking up folders by path.
 */

add_setup(async function () {
  await installDB("lookup.sqlite");
});

add_task(function testLookup() {
  const server1 = folders.getFolderById(5);
  const server2 = folders.getFolderById(4);

  drawTree(server1);
  drawTree(server2);

  Assert.equal(folders.getFolderByPath("server1"), server1);
  Assert.equal(folders.getFolderByPath("server1/INBOX"), server1.children[0]);
  Assert.equal(folders.getFolderByPath("server1/Junk"), server1.children[1]);
  Assert.equal(folders.getFolderByPath("server1/Sent"), server1.children[2]);
  Assert.equal(folders.getFolderByPath("server1/Trash"), server1.children[3]);

  Assert.equal(folders.getFolderByPath("server2"), server2);
  Assert.equal(folders.getFolderByPath("server2/folder"), server2.children[0]);
  // Lookup using composed unicode character.
  Assert.equal(
    folders.getFolderByPath("server2/folder/s\u00FCb1"),
    server2.children[0].children[0]
  );
  // Lookup using decomposed unicode character.
  Assert.equal(
    folders.getFolderByPath("server2/folder/su\u0308b1"),
    server2.children[0].children[0]
  );
  Assert.equal(
    folders.getFolderByPath("server2/folder/su\u0308b1/sub2"),
    server2.children[0].children[0].children[0]
  );
});

/**
 * Tests looking up folders after moving them. Looking up the folder at the
 * new path should find it, and at the old path should find nothing.
 */
add_task(function testLookupAfterMove() {
  const folder = folders.getFolderById(6);
  const sub1 = folders.getFolderById(2);
  const sub2 = folders.getFolderById(8);

  Assert.equal(sub2.path, "server2/folder/s\u00FCb1/sub2");
  Assert.equal(folders.getFolderByPath("server2/folder/sub2"), null);
  Assert.equal(folders.getFolderByPath("server2/folder/s\u00FCb1/sub2"), sub2);

  folders.moveFolderTo(folder, sub2);
  Assert.equal(sub2.path, "server2/folder/sub2");
  Assert.equal(folders.getFolderByPath("server2/folder/sub2"), sub2);
  Assert.equal(folders.getFolderByPath("server2/folder/s\u00FCb1/sub2"), null);
  Assert.equal(sub2.id, 8);
  Assert.equal(folders.getFolderById(8), sub2);

  folders.moveFolderTo(sub1, sub2);
  Assert.equal(sub2.path, "server2/folder/s\u00FCb1/sub2");
  Assert.equal(folders.getFolderByPath("server2/folder/sub2"), null);
  Assert.equal(folders.getFolderByPath("server2/folder/s\u00FCb1/sub2"), sub2);
  Assert.equal(sub2.id, 8);
  Assert.equal(folders.getFolderById(8), sub2);
});
