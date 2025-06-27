/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Tests for secret keys.
 */

"use strict";

const { RNP, RnpPrivateKeyUnlockTracker } = ChromeUtils.importESModule(
  "chrome://openpgp/content/modules/RNP.sys.mjs"
);
const { OpenPGPMasterpass } = ChromeUtils.importESModule(
  "chrome://openpgp/content/modules/masterpass.sys.mjs"
);
const { EnigmailConstants } = ChromeUtils.importESModule(
  "chrome://openpgp/content/modules/constants.sys.mjs"
);
const { EnigmailKeyRing } = ChromeUtils.importESModule(
  "chrome://openpgp/content/modules/keyRing.sys.mjs"
);
const { FileUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/FileUtils.sys.mjs"
);
const { OpenPGPTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/mail/OpenPGPTestUtils.sys.mjs"
);

const keyDir = "../../../../../test/browser/openpgp/data/keys";

/**
 * Initialize OpenPGP add testing keys.
 */
add_setup(async function () {
  do_get_profile();

  await OpenPGPTestUtils.initOpenPGP();
});

add_task(async function testSecretKeys() {
  const pass = await OpenPGPMasterpass.retrieveOpenPGPPassword();
  const newKeyId = await RNP.genKey(
    "Erin <erin@example.com>",
    "ECC",
    0,
    30,
    pass
  );

  Assert.ok(
    newKeyId != null && typeof newKeyId == "string",
    "RNP.genKey() should return a non null string with a key ID"
  );

  let keyObj = EnigmailKeyRing.getKeyById(newKeyId);
  Assert.ok(
    keyObj && keyObj.secretAvailable,
    "EnigmailKeyRing.getKeyById should return an object with a secret key"
  );

  Assert.ok(
    keyObj.iSimpleOneSubkeySameExpiry(),
    "check iSimpleOneSubkeySameExpiry should succeed"
  );

  const later = new Date();
  later.setDate(later.getDate() + 100);
  const expiryChanged = await RNP.changeKeyExpiration(keyObj, null, later);
  Assert.ok(expiryChanged, "RNP.changeKeyExpiration should succeed");

  const fpr = keyObj.fpr;
  const backupPassword = "new-password-1234";
  const backupKeyBlock = await RNP.backupSecretKeys([fpr], backupPassword);

  const expectedString = "END PGP PRIVATE KEY BLOCK";

  Assert.ok(
    backupKeyBlock.includes(expectedString),
    "backup of secret key should contain the string: " + expectedString
  );

  await RNP.deleteKey(fpr, true);

  EnigmailKeyRing.clearCache();

  keyObj = EnigmailKeyRing.getKeyById(newKeyId);
  Assert.ok(
    !keyObj,
    "after deleting the key we should be unable to find it in the keyring"
  );

  let alreadyProvidedWrongPassword = false;

  const getWrongPassword = function (win, keyId, resultFlags) {
    if (alreadyProvidedWrongPassword) {
      resultFlags.canceled = true;
      return "";
    }

    alreadyProvidedWrongPassword = true;
    return "wrong-password";
  };

  let importResult = await RNP.importSecKeyBlockImpl(
    null,
    getWrongPassword,
    false,
    backupKeyBlock
  );

  Assert.notEqual(importResult.exitCode, 0, "import should have failed");

  const getGoodPassword = function () {
    return backupPassword;
  };

  importResult = await RNP.importSecKeyBlockImpl(
    null,
    getGoodPassword,
    false,
    backupKeyBlock
  );

  Assert.equal(importResult.exitCode, 0, "import result code should be 0");

  keyObj = EnigmailKeyRing.getKeyById(newKeyId);

  Assert.ok(
    keyObj && keyObj.secretAvailable,
    "after import, EnigmailKeyRing.getKeyById should return an object with a secret key"
  );
});

add_task(async function testImportSecretKeyIsProtected() {
  const carolFile = do_get_file(
    `${keyDir}/carol@example.com-0x3099ff1238852b9f-secret.asc`
  );
  const carolSec = await IOUtils.readUTF8(carolFile.path);

  // Carol's secret key is protected with password "x".
  const getCarolPassword = function () {
    return "x";
  };

  let importResult = await RNP.importSecKeyBlockImpl(
    null,
    getCarolPassword,
    false,
    carolSec
  );

  Assert.equal(
    importResult.exitCode,
    0,
    "Should be able to import Carol's secret key"
  );

  const aliceFile = do_get_file(
    `${keyDir}/alice@openpgp.example-0xf231550c4f47e38e-secret.asc`
  );
  const aliceSec = await IOUtils.readUTF8(aliceFile.path);

  // Alice's secret key is unprotected.
  importResult = await RNP.importSecKeyBlockImpl(null, null, false, aliceSec);

  Assert.equal(
    importResult.exitCode,
    0,
    "Should be able to import Alice's secret key"
  );

  const [prot, unprot] = OpenPGPTestUtils.getProtectedKeysCount();
  Assert.notEqual(prot, 0, "Should have protected secret keys");
  Assert.equal(unprot, 0, "Should not have any unprotected secret keys");
});

add_task(async function testImportOfflinePrimaryKey() {
  const importResult = await OpenPGPTestUtils.importPrivateKey(
    null,
    do_get_file(`${keyDir}/ofelia-secret-subkeys.asc`)
  );

  Assert.equal(
    importResult[0],
    "0x97DCDA5E56EBB822",
    "expected key id should have been reported"
  );

  const primaryKey = await RNP.findKeyByEmail(
    "<ofelia@openpgp.example>",
    false
  );

  const encSubKey = RNP.getSuitableSubkey(primaryKey, "encrypt");
  const keyId = RNP.getKeyIDFromHandle(encSubKey);
  Assert.equal(
    keyId,
    "31C31DF1DFB67601",
    "should obtain key ID of encryption subkey"
  );

  const sigSubKey = RNP.getSuitableSubkey(primaryKey, "sign");
  const keyIdSig = RNP.getKeyIDFromHandle(sigSubKey);
  Assert.equal(
    keyIdSig,
    "1BC8F5764D348FE1",
    "should obtain key ID of signing subkey"
  );

  // Test that we can sign with a signing subkey
  // (this ensures that our code can unlock the secret subkey).
  // Ofelia's key has no secret key for the primary key available,
  // which further ensures that signing used the subkey.

  const sourceText = "we-sign-this-text";
  const signResult = {};

  const signArgs = {
    aliasKeys: new Map(),
    armor: true,
    bcc: [],
    encrypt: false,
    encryptToSender: false,
    sender: "0x97DCDA5E56EBB822",
    senderKeyIsExternal: false,
    sigTypeClear: true,
    sigTypeDetached: false,
    sign: true,
    signatureHash: "SHA256",
    to: ["<alice@openpgp.example>"],
  };

  await RNP.encryptAndOrSign(sourceText, signArgs, signResult);

  Assert.ok(!signResult.exitCode, "signing with subkey should work");
});

add_task(async function testSecretForPreferredSignSubkeyIsMissing() {
  const secBlock = await IOUtils.readUTF8(
    do_get_file(
      `${keyDir}/secret-for-preferred-sign-subkey-is-missing--a-without-second-sub--sec.asc`
    ).path
  );

  const cancelPassword = function (win, keyId, resultFlags) {
    resultFlags.canceled = true;
    return "";
  };

  let importResult = await RNP.importSecKeyBlockImpl(
    null,
    cancelPassword,
    false,
    secBlock
  );

  Assert.equal(importResult.exitCode, 0);

  const pubBlock = await IOUtils.readUTF8(
    do_get_file(
      `${keyDir}/secret-for-preferred-sign-subkey-is-missing--b-with-second-sub--pub.asc`
    ).path
  );

  importResult = await RNP.importPubkeyBlockAutoAcceptImpl(
    null,
    pubBlock,
    null // acceptance
  );

  Assert.equal(importResult.exitCode, 0);

  const primaryKey = await RNP.findKeyByEmail(
    "<secret-for-preferred-sign-subkey-is-missing@example.com>",
    false
  );

  const signSubKey = RNP.getSuitableSubkey(primaryKey, "sign");
  const keyId = RNP.getKeyIDFromHandle(signSubKey);
  Assert.equal(
    keyId,
    "625D4819F02EE727",
    "should obtain key ID of older, non-preferred subkey that has the secret key available"
  );
});

add_task(async function testRejectImportUnsupportedKeys() {
  // No password was set on the secret key files.
  const secBlockV5 = await IOUtils.readUTF8(
    do_get_file(`${keyDir}/alice-v5-sec.asc`).path
  );

  const cancelPassword = function (win, keyId, resultFlags) {
    resultFlags.canceled = true;
    return "";
  };

  let importResult = await RNP.importSecKeyBlockImpl(
    null,
    cancelPassword,
    false,
    secBlockV5
  );

  Assert.equal(importResult.exitCode, -1, "should reject sec v5 key");

  const pubBlockV5 = await IOUtils.readUTF8(
    do_get_file(`${keyDir}/alice-v5-pub.asc`).path
  );

  importResult = await RNP.importPubkeyBlockAutoAcceptImpl(
    null,
    pubBlockV5,
    null // acceptance
  );

  Assert.equal(importResult.exitCode, -1, "should reject pub v5 key");

  const alice448 = await RNP.findKeyByEmail("<alice-448@example.com>", false);
  Assert.ok(!alice448);

  const secBlockV6 = await IOUtils.readUTF8(
    do_get_file(`${keyDir}/pgp-v6-sec.asc`).path
  );

  importResult = await RNP.importSecKeyBlockImpl(
    null,
    cancelPassword,
    false,
    secBlockV6
  );

  Assert.equal(importResult.exitCode, -1, "should reject sec v6 key");

  const pubBlockV6 = await IOUtils.readUTF8(
    do_get_file(`${keyDir}/pgp-v6-pub.asc`).path
  );

  importResult = await RNP.importPubkeyBlockAutoAcceptImpl(
    null,
    pubBlockV6,
    null // acceptance
  );

  Assert.equal(importResult.exitCode, -1, "should reject pub v6 key");
});

// If we an existing public key, with multiple subkeys, and then we
// import the secret key, but one of the existing public subkeys is
// missing, test that we don't fail to import (bug 1795698).
add_task(async function testNoSecretForExistingPublicSubkey() {
  const pubBlock = await IOUtils.readUTF8(
    do_get_file(`${keyDir}/two-enc-subkeys-still-both.pub.asc`).path
  );

  let importResult = await RNP.importPubkeyBlockAutoAcceptImpl(
    null,
    pubBlock,
    null // acceptance
  );

  Assert.equal(importResult.exitCode, 0);

  const secBlock = await IOUtils.readUTF8(
    do_get_file(`${keyDir}/two-enc-subkeys-one-deleted.sec.asc`).path
  );

  const cancelPassword = function (win, keyId, resultFlags) {
    resultFlags.canceled = true;
    return "";
  };

  importResult = await RNP.importSecKeyBlockImpl(
    null,
    cancelPassword,
    false,
    secBlock
  );

  Assert.equal(importResult.exitCode, 0);
});

// Test that old ECC secret keys, which were created using older RNP
// versions (as used in Thunderbird versions older then 91.8),
// can be correctly backed up. This test ensures that we successfully
// removed the key protection prior to the call to perform the
// binary key tweaking.
add_task(async function testImportAndBackupUntweakedECCKey() {
  const untweakedFile = do_get_file(`${keyDir}/untweaked-secret.asc`);
  const untweakedSecKey = await IOUtils.readUTF8(untweakedFile.path);

  const getGoodPasswordForTweaked = function () {
    return "pass112233";
  };

  const importResult = await RNP.importSecKeyBlockImpl(
    null,
    getGoodPasswordForTweaked,
    false,
    untweakedSecKey
  );

  Assert.equal(importResult.exitCode, 0);
  const fpr = "492965A6F56DAD2423B3506E849F29B0020707F7";

  const backupPassword = "new-password-1234";
  const backupKeyBlock = await RNP.backupSecretKeys([fpr], backupPassword);
  const expectedString = "END PGP PRIVATE KEY BLOCK";

  Assert.ok(
    backupKeyBlock.includes(expectedString),
    "backup of secret key should contain the string: " + expectedString
  );

  await RNP.deleteKey(fpr, true);

  EnigmailKeyRing.clearCache();
});

// Sanity check for bug 1790610 and bug 1792450, test that our passphrase
// reading code, which can run through repair code for corrupted profiles,
// will not replace our existing and good data.
// Ideally this test should restart the application, but is is difficult.
// We simulate a restart by erasing the cache and forcing it to read
// data again from disk (which will run the consistency checks and
// could potentially execute the repair code).
add_task(async function testRereadingPassphrase() {
  const pass1 = await OpenPGPMasterpass.retrieveOpenPGPPassword();
  OpenPGPMasterpass.cachedPassword = null;
  const pass2 = await OpenPGPMasterpass.retrieveOpenPGPPassword();
  Assert.equal(
    pass1,
    pass2,
    "openpgp passphrase should remain the same after cache invalidation"
  );
});
