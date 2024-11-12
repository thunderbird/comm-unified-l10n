"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.algorithmsByName = exports.LibOlmBackupDecryptor = exports.DefaultAlgorithm = exports.Curve25519 = exports.BackupManager = exports.Aes256 = void 0;
exports.backupTrustInfoFromLegacyTrustInfo = backupTrustInfoFromLegacyTrustInfo;
var _client = require("../client.js");
var _logger = require("../logger.js");
var _olmlib = require("./olmlib.js");
var _key_passphrase = require("./key_passphrase.js");
var _utils = require("../utils.js");
var _indexeddbCryptoStore = require("./store/indexeddb-crypto-store.js");
var _NamespacedValue = require("../NamespacedValue.js");
var _index = require("./index.js");
var _index2 = require("../http-api/index.js");
var _index3 = require("../crypto-api/index.js");
var _decryptAESSecretStorageItem = _interopRequireDefault(require("../utils/decryptAESSecretStorageItem.js"));
var _encryptAESSecretStorageItem = _interopRequireDefault(require("../utils/encryptAESSecretStorageItem.js"));
var _secretStorage = require("../secret-storage.js");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); } /*
Copyright 2021 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/ /**
 * Classes for dealing with key backup.
 */
const KEY_BACKUP_KEYS_PER_REQUEST = 200;
const KEY_BACKUP_CHECK_RATE_LIMIT = 5000; // ms

/** @deprecated Prefer {@link BackupTrustInfo} */

/* eslint-disable camelcase */

/* eslint-enable camelcase */

/** A function used to get the secret key for a backup.
 */

/**
 * Manages the key backup.
 */
class BackupManager {
  constructor(baseApis, getKey) {
    this.baseApis = baseApis;
    this.getKey = getKey;
    _defineProperty(this, "algorithm", void 0);
    _defineProperty(this, "backupInfo", void 0);
    // The info dict from /room_keys/version
    _defineProperty(this, "checkedForBackup", void 0);
    // Have we checked the server for a backup we can use?
    _defineProperty(this, "sendingBackups", void 0);
    // Are we currently sending backups?
    _defineProperty(this, "sessionLastCheckAttemptedTime", {});
    // When did we last try to check the server for a given session id?
    // The backup manager will schedule backup of keys when active (`scheduleKeyBackupSend`), this allows cancel when client is stopped
    _defineProperty(this, "clientRunning", true);
    this.checkedForBackup = false;
    this.sendingBackups = false;
  }

  /**
   * Stop the backup manager from backing up keys and allow a clean shutdown.
   */
  stop() {
    this.clientRunning = false;
  }
  get version() {
    return this.backupInfo && this.backupInfo.version;
  }

  /**
   * Performs a quick check to ensure that the backup info looks sane.
   *
   * Throws an error if a problem is detected.
   *
   * @param info - the key backup info
   */
  static checkBackupVersion(info) {
    const Algorithm = algorithmsByName[info.algorithm];
    if (!Algorithm) {
      throw new Error("Unknown backup algorithm: " + info.algorithm);
    }
    if (typeof info.auth_data !== "object") {
      throw new Error("Invalid backup data returned");
    }
    return Algorithm.checkBackupVersion(info);
  }
  static makeAlgorithm(info, getKey) {
    const Algorithm = algorithmsByName[info.algorithm];
    if (!Algorithm) {
      throw new Error("Unknown backup algorithm");
    }
    return Algorithm.init(info.auth_data, getKey);
  }
  async enableKeyBackup(info) {
    this.backupInfo = info;
    if (this.algorithm) {
      this.algorithm.free();
    }
    this.algorithm = await BackupManager.makeAlgorithm(info, this.getKey);
    this.baseApis.emit(_index.CryptoEvent.KeyBackupStatus, true);

    // There may be keys left over from a partially completed backup, so
    // schedule a send to check.
    this.scheduleKeyBackupSend();
  }

  /**
   * Disable backing up of keys.
   */
  disableKeyBackup() {
    if (this.algorithm) {
      this.algorithm.free();
    }
    this.algorithm = undefined;
    this.backupInfo = undefined;
    this.baseApis.emit(_index.CryptoEvent.KeyBackupStatus, false);
  }
  getKeyBackupEnabled() {
    if (!this.checkedForBackup) {
      return null;
    }
    return Boolean(this.algorithm);
  }
  async prepareKeyBackupVersion(key, algorithm) {
    const Algorithm = algorithm ? algorithmsByName[algorithm] : DefaultAlgorithm;
    if (!Algorithm) {
      throw new Error("Unknown backup algorithm");
    }
    const [privateKey, authData] = await Algorithm.prepare(key);
    const recoveryKey = (0, _index3.encodeRecoveryKey)(privateKey);
    return {
      algorithm: Algorithm.algorithmName,
      auth_data: authData,
      recovery_key: recoveryKey,
      privateKey
    };
  }
  async createKeyBackupVersion(info) {
    this.algorithm = await BackupManager.makeAlgorithm(info, this.getKey);
  }

  /**
   * Deletes all key backups.
   *
   * Will call the API to delete active backup until there is no more present.
   */
  async deleteAllKeyBackupVersions() {
    // there could be several backup versions, delete all to be safe.
    let current = (await this.baseApis.getKeyBackupVersion())?.version ?? null;
    while (current != null) {
      await this.deleteKeyBackupVersion(current);
      this.disableKeyBackup();
      current = (await this.baseApis.getKeyBackupVersion())?.version ?? null;
    }
  }

  /**
   * Deletes the given key backup.
   *
   * @param version - The backup version to delete.
   */
  async deleteKeyBackupVersion(version) {
    const path = (0, _utils.encodeUri)("/room_keys/version/$version", {
      $version: version
    });
    await this.baseApis.http.authedRequest(_index2.Method.Delete, path, undefined, undefined, {
      prefix: _index2.ClientPrefix.V3
    });
  }

  /**
   * Check the server for an active key backup and
   * if one is present and has a valid signature from
   * one of the user's verified devices, start backing up
   * to it.
   */
  async checkAndStart() {
    _logger.logger.log("Checking key backup status...");
    if (this.baseApis.isGuest()) {
      _logger.logger.log("Skipping key backup check since user is guest");
      this.checkedForBackup = true;
      return null;
    }
    let backupInfo;
    try {
      backupInfo = (await this.baseApis.getKeyBackupVersion()) ?? undefined;
    } catch (e) {
      _logger.logger.log("Error checking for active key backup", e);
      if (e.httpStatus === 404) {
        // 404 is returned when the key backup does not exist, so that
        // counts as successfully checking.
        this.checkedForBackup = true;
      }
      return null;
    }
    this.checkedForBackup = true;
    const trustInfo = await this.isKeyBackupTrusted(backupInfo);
    if (trustInfo.usable && !this.backupInfo) {
      _logger.logger.log(`Found usable key backup v${backupInfo.version}: enabling key backups`);
      await this.enableKeyBackup(backupInfo);
    } else if (!trustInfo.usable && this.backupInfo) {
      _logger.logger.log("No usable key backup: disabling key backup");
      this.disableKeyBackup();
    } else if (!trustInfo.usable && !this.backupInfo) {
      _logger.logger.log("No usable key backup: not enabling key backup");
    } else if (trustInfo.usable && this.backupInfo) {
      // may not be the same version: if not, we should switch
      if (backupInfo.version !== this.backupInfo.version) {
        _logger.logger.log(`On backup version ${this.backupInfo.version} but ` + `found version ${backupInfo.version}: switching.`);
        this.disableKeyBackup();
        await this.enableKeyBackup(backupInfo);
        // We're now using a new backup, so schedule all the keys we have to be
        // uploaded to the new backup. This is a bit of a workaround to upload
        // keys to a new backup in *most* cases, but it won't cover all cases
        // because we don't remember what backup version we uploaded keys to:
        // see https://github.com/vector-im/element-web/issues/14833
        await this.scheduleAllGroupSessionsForBackup();
      } else {
        _logger.logger.log(`Backup version ${backupInfo.version} still current`);
      }
    }
    return {
      backupInfo,
      trustInfo
    };
  }

  /**
   * Forces a re-check of the key backup and enables/disables it
   * as appropriate.
   *
   * @returns Object with backup info (as returned by
   *     getKeyBackupVersion) in backupInfo and
   *     trust information (as returned by isKeyBackupTrusted)
   *     in trustInfo.
   */
  async checkKeyBackup() {
    this.checkedForBackup = false;
    return this.checkAndStart();
  }

  /**
   * Attempts to retrieve a session from a key backup, if enough time
   * has elapsed since the last check for this session id.
   */
  async queryKeyBackupRateLimited(targetRoomId, targetSessionId) {
    if (!this.backupInfo) {
      return;
    }
    const now = new Date().getTime();
    if (!this.sessionLastCheckAttemptedTime[targetSessionId] || now - this.sessionLastCheckAttemptedTime[targetSessionId] > KEY_BACKUP_CHECK_RATE_LIMIT) {
      this.sessionLastCheckAttemptedTime[targetSessionId] = now;
      await this.baseApis.restoreKeyBackupWithCache(targetRoomId, targetSessionId, this.backupInfo, {});
    }
  }

  /**
   * Check if the given backup info is trusted.
   *
   * @param backupInfo - key backup info dict from /room_keys/version
   */
  async isKeyBackupTrusted(backupInfo) {
    const ret = {
      usable: false,
      trusted_locally: false,
      sigs: []
    };
    if (!backupInfo || !backupInfo.algorithm || !backupInfo.auth_data || !backupInfo.auth_data.signatures) {
      _logger.logger.info(`Key backup is absent or missing required data: ${JSON.stringify(backupInfo)}`);
      return ret;
    }
    const userId = this.baseApis.getUserId();
    const privKey = await this.baseApis.crypto.getSessionBackupPrivateKey();
    if (privKey) {
      let algorithm = null;
      try {
        algorithm = await BackupManager.makeAlgorithm(backupInfo, async () => privKey);
        if (await algorithm.keyMatches(privKey)) {
          _logger.logger.info("Backup is trusted locally");
          ret.trusted_locally = true;
        }
      } catch {
        // do nothing -- if we have an error, then we don't mark it as
        // locally trusted
      } finally {
        algorithm?.free();
      }
    }
    const mySigs = backupInfo.auth_data.signatures[userId] || {};
    for (const keyId of Object.keys(mySigs)) {
      const keyIdParts = keyId.split(":");
      if (keyIdParts[0] !== "ed25519") {
        _logger.logger.log("Ignoring unknown signature type: " + keyIdParts[0]);
        continue;
      }
      // Could be a cross-signing master key, but just say this is the device
      // ID for backwards compat
      const sigInfo = {
        deviceId: keyIdParts[1]
      };

      // first check to see if it's from our cross-signing key
      const crossSigningId = this.baseApis.crypto.crossSigningInfo.getId();
      if (crossSigningId === sigInfo.deviceId) {
        sigInfo.crossSigningId = true;
        try {
          await (0, _olmlib.verifySignature)(this.baseApis.crypto.olmDevice, backupInfo.auth_data, userId, sigInfo.deviceId, crossSigningId);
          sigInfo.valid = true;
        } catch (e) {
          _logger.logger.warn("Bad signature from cross signing key " + crossSigningId, e);
          sigInfo.valid = false;
        }
        ret.sigs.push(sigInfo);
        continue;
      }

      // Now look for a sig from a device
      // At some point this can probably go away and we'll just support
      // it being signed by the cross-signing master key
      const device = this.baseApis.crypto.deviceList.getStoredDevice(userId, sigInfo.deviceId);
      if (device) {
        sigInfo.device = device;
        sigInfo.deviceTrust = this.baseApis.checkDeviceTrust(userId, sigInfo.deviceId);
        try {
          await (0, _olmlib.verifySignature)(this.baseApis.crypto.olmDevice, backupInfo.auth_data, userId, device.deviceId, device.getFingerprint());
          sigInfo.valid = true;
        } catch (e) {
          _logger.logger.info("Bad signature from key ID " + keyId + " userID " + this.baseApis.getUserId() + " device ID " + device.deviceId + " fingerprint: " + device.getFingerprint(), backupInfo.auth_data, e);
          sigInfo.valid = false;
        }
      } else {
        sigInfo.valid = null; // Can't determine validity because we don't have the signing device
        _logger.logger.info("Ignoring signature from unknown key " + keyId);
      }
      ret.sigs.push(sigInfo);
    }
    ret.usable = ret.sigs.some(s => {
      return s.valid && (s.device && s.deviceTrust?.isVerified() || s.crossSigningId);
    });
    return ret;
  }

  /**
   * Schedules sending all keys waiting to be sent to the backup, if not already
   * scheduled. Retries if necessary.
   *
   * @param maxDelay - Maximum delay to wait in ms. 0 means no delay.
   */
  async scheduleKeyBackupSend(maxDelay = 10000) {
    _logger.logger.debug(`Key backup: scheduleKeyBackupSend currentSending:${this.sendingBackups} delay:${maxDelay}`);
    if (this.sendingBackups) return;
    this.sendingBackups = true;
    try {
      // wait between 0 and `maxDelay` seconds, to avoid backup
      // requests from different clients hitting the server all at
      // the same time when a new key is sent
      const delay = Math.random() * maxDelay;
      await (0, _utils.sleep)(delay);
      if (!this.clientRunning) {
        this.sendingBackups = false;
        return;
      }
      let numFailures = 0; // number of consecutive failures
      for (;;) {
        if (!this.algorithm) {
          return;
        }
        try {
          const numBackedUp = await this.backupPendingKeys(KEY_BACKUP_KEYS_PER_REQUEST);
          if (numBackedUp === 0) {
            // no sessions left needing backup: we're done
            this.sendingBackups = false;
            return;
          }
          numFailures = 0;
        } catch (err) {
          numFailures++;
          _logger.logger.log("Key backup request failed", err);
          if (err instanceof _index2.MatrixError) {
            const errCode = err.data.errcode;
            if (errCode == "M_NOT_FOUND" || errCode == "M_WRONG_ROOM_KEYS_VERSION") {
              // Set to false now as `checkKeyBackup` might schedule a backupsend before this one ends.
              this.sendingBackups = false;
              // Backup version has changed or this backup version
              // has been deleted
              this.baseApis.crypto.emit(_index.CryptoEvent.KeyBackupFailed, errCode);
              // Re-check key backup status on error, so we can be
              // sure to present the current situation when asked.
              // This call might restart the backup loop if new backup version is trusted
              await this.checkKeyBackup();
              return;
            }
          }
        }
        if (numFailures) {
          // exponential backoff if we have failures
          await (0, _utils.sleep)(1000 * Math.pow(2, Math.min(numFailures - 1, 4)));
        }
        if (!this.clientRunning) {
          _logger.logger.debug("Key backup send loop aborted, client stopped");
          this.sendingBackups = false;
          return;
        }
      }
    } catch (err) {
      // No one actually checks errors on this promise, it's spawned internally.
      // Just log, apps/client should use events to check status
      _logger.logger.log(`Backup loop failed ${err}`);
      this.sendingBackups = false;
    }
  }

  /**
   * Take some e2e keys waiting to be backed up and send them
   * to the backup.
   *
   * @param limit - Maximum number of keys to back up
   * @returns Number of sessions backed up
   */
  async backupPendingKeys(limit) {
    const sessions = await this.baseApis.crypto.cryptoStore.getSessionsNeedingBackup(limit);
    if (!sessions.length) {
      return 0;
    }
    let remaining = await this.baseApis.crypto.cryptoStore.countSessionsNeedingBackup();
    this.baseApis.crypto.emit(_index.CryptoEvent.KeyBackupSessionsRemaining, remaining);
    const rooms = {};
    for (const session of sessions) {
      const roomId = session.sessionData.room_id;
      (0, _utils.safeSet)(rooms, roomId, rooms[roomId] || {
        sessions: {}
      });
      const sessionData = this.baseApis.crypto.olmDevice.exportInboundGroupSession(session.senderKey, session.sessionId, session.sessionData);
      sessionData.algorithm = _olmlib.MEGOLM_ALGORITHM;
      const forwardedCount = (sessionData.forwarding_curve25519_key_chain || []).length;
      const userId = this.baseApis.crypto.deviceList.getUserByIdentityKey(_olmlib.MEGOLM_ALGORITHM, session.senderKey);
      const device = this.baseApis.crypto.deviceList.getDeviceByIdentityKey(_olmlib.MEGOLM_ALGORITHM, session.senderKey) ?? undefined;
      const verified = this.baseApis.crypto.checkDeviceInfoTrust(userId, device).isVerified();
      (0, _utils.safeSet)(rooms[roomId]["sessions"], session.sessionId, {
        first_message_index: sessionData.first_known_index,
        forwarded_count: forwardedCount,
        is_verified: verified,
        session_data: await this.algorithm.encryptSession(sessionData)
      });
    }
    await this.baseApis.sendKeyBackup(undefined, undefined, this.backupInfo.version, {
      rooms
    });
    await this.baseApis.crypto.cryptoStore.unmarkSessionsNeedingBackup(sessions);
    remaining = await this.baseApis.crypto.cryptoStore.countSessionsNeedingBackup();
    this.baseApis.crypto.emit(_index.CryptoEvent.KeyBackupSessionsRemaining, remaining);
    return sessions.length;
  }
  async backupGroupSession(senderKey, sessionId) {
    await this.baseApis.crypto.cryptoStore.markSessionsNeedingBackup([{
      senderKey: senderKey,
      sessionId: sessionId
    }]);
    if (this.backupInfo) {
      // don't wait for this to complete: it will delay so
      // happens in the background
      this.scheduleKeyBackupSend();
    }
    // if this.backupInfo is not set, then the keys will be backed up when
    // this.enableKeyBackup is called
  }

  /**
   * Marks all group sessions as needing to be backed up and schedules them to
   * upload in the background as soon as possible.
   */
  async scheduleAllGroupSessionsForBackup() {
    await this.flagAllGroupSessionsForBackup();

    // Schedule keys to upload in the background as soon as possible.
    this.scheduleKeyBackupSend(0 /* maxDelay */);
  }

  /**
   * Marks all group sessions as needing to be backed up without scheduling
   * them to upload in the background.
   * @returns Promise which resolves to the number of sessions now requiring a backup
   *     (which will be equal to the number of sessions in the store).
   */
  async flagAllGroupSessionsForBackup() {
    await this.baseApis.crypto.cryptoStore.doTxn("readwrite", [_indexeddbCryptoStore.IndexedDBCryptoStore.STORE_INBOUND_GROUP_SESSIONS, _indexeddbCryptoStore.IndexedDBCryptoStore.STORE_BACKUP], txn => {
      this.baseApis.crypto.cryptoStore.getAllEndToEndInboundGroupSessions(txn, session => {
        if (session !== null) {
          this.baseApis.crypto.cryptoStore.markSessionsNeedingBackup([session], txn);
        }
      });
    });
    const remaining = await this.baseApis.crypto.cryptoStore.countSessionsNeedingBackup();
    this.baseApis.emit(_index.CryptoEvent.KeyBackupSessionsRemaining, remaining);
    return remaining;
  }

  /**
   * Counts the number of end to end session keys that are waiting to be backed up
   * @returns Promise which resolves to the number of sessions requiring backup
   */
  countSessionsNeedingBackup() {
    return this.baseApis.crypto.cryptoStore.countSessionsNeedingBackup();
  }
}
exports.BackupManager = BackupManager;
class Curve25519 {
  constructor(authData, publicKey,
  // FIXME: PkEncryption
  getKey) {
    this.authData = authData;
    this.publicKey = publicKey;
    this.getKey = getKey;
  }
  static async init(authData, getKey) {
    if (!authData || !("public_key" in authData)) {
      throw new Error("auth_data missing required information");
    }
    const publicKey = new global.Olm.PkEncryption();
    publicKey.set_recipient_key(authData.public_key);
    return new Curve25519(authData, publicKey, getKey);
  }
  static async prepare(key) {
    const decryption = new global.Olm.PkDecryption();
    try {
      const authData = {};
      if (!key) {
        authData.public_key = decryption.generate_key();
      } else if (key instanceof Uint8Array) {
        authData.public_key = decryption.init_with_private_key(key);
      } else {
        const derivation = await (0, _key_passphrase.keyFromPassphrase)(key);
        authData.private_key_salt = derivation.salt;
        authData.private_key_iterations = derivation.iterations;
        authData.public_key = decryption.init_with_private_key(derivation.key);
      }
      const publicKey = new global.Olm.PkEncryption();
      publicKey.set_recipient_key(authData.public_key);
      return [decryption.get_private_key(), authData];
    } finally {
      decryption.free();
    }
  }
  static checkBackupVersion(info) {
    if (!("public_key" in info.auth_data)) {
      throw new Error("Invalid backup data returned");
    }
  }
  get untrusted() {
    return true;
  }
  async encryptSession(data) {
    const plainText = Object.assign({}, data);
    delete plainText.session_id;
    delete plainText.room_id;
    delete plainText.first_known_index;
    return this.publicKey.encrypt(JSON.stringify(plainText));
  }
  async decryptSessions(sessions) {
    const privKey = await this.getKey();
    const decryption = new global.Olm.PkDecryption();
    try {
      const backupPubKey = decryption.init_with_private_key(privKey);
      if (backupPubKey !== this.authData.public_key) {
        throw new _index2.MatrixError({
          errcode: _client.MatrixClient.RESTORE_BACKUP_ERROR_BAD_KEY
        });
      }
      const keys = [];
      for (const [sessionId, sessionData] of Object.entries(sessions)) {
        try {
          const decrypted = JSON.parse(decryption.decrypt(sessionData.session_data.ephemeral, sessionData.session_data.mac, sessionData.session_data.ciphertext));
          decrypted.session_id = sessionId;
          keys.push(decrypted);
        } catch (e) {
          _logger.logger.log("Failed to decrypt megolm session from backup", e, sessionData);
        }
      }
      return keys;
    } finally {
      decryption.free();
    }
  }
  async keyMatches(key) {
    const decryption = new global.Olm.PkDecryption();
    let pubKey;
    try {
      pubKey = decryption.init_with_private_key(key);
    } finally {
      decryption.free();
    }
    return pubKey === this.authData.public_key;
  }
  free() {
    this.publicKey.free();
  }
}
exports.Curve25519 = Curve25519;
_defineProperty(Curve25519, "algorithmName", "m.megolm_backup.v1.curve25519-aes-sha2");
function randomBytes(size) {
  const buf = new Uint8Array(size);
  globalThis.crypto.getRandomValues(buf);
  return buf;
}
const UNSTABLE_MSC3270_NAME = new _NamespacedValue.UnstableValue("m.megolm_backup.v1.aes-hmac-sha2", "org.matrix.msc3270.v1.aes-hmac-sha2");
class Aes256 {
  constructor(authData, key) {
    this.authData = authData;
    this.key = key;
  }
  static async init(authData, getKey) {
    if (!authData) {
      throw new Error("auth_data missing");
    }
    const key = await getKey();
    if (authData.mac) {
      const {
        mac
      } = await (0, _secretStorage.calculateKeyCheck)(key, authData.iv);
      if (authData.mac.replace(/=+$/g, "") !== mac.replace(/=+/g, "")) {
        throw new Error("Key does not match");
      }
    }
    return new Aes256(authData, key);
  }
  static async prepare(key) {
    let outKey;
    const authData = {};
    if (!key) {
      outKey = randomBytes(32);
    } else if (key instanceof Uint8Array) {
      outKey = new Uint8Array(key);
    } else {
      const derivation = await (0, _key_passphrase.keyFromPassphrase)(key);
      authData.private_key_salt = derivation.salt;
      authData.private_key_iterations = derivation.iterations;
      outKey = derivation.key;
    }
    const {
      iv,
      mac
    } = await (0, _secretStorage.calculateKeyCheck)(outKey);
    authData.iv = iv;
    authData.mac = mac;
    return [outKey, authData];
  }
  static checkBackupVersion(info) {
    if (!("iv" in info.auth_data && "mac" in info.auth_data)) {
      throw new Error("Invalid backup data returned");
    }
  }
  get untrusted() {
    return false;
  }
  encryptSession(data) {
    const plainText = Object.assign({}, data);
    delete plainText.session_id;
    delete plainText.room_id;
    delete plainText.first_known_index;
    return (0, _encryptAESSecretStorageItem.default)(JSON.stringify(plainText), this.key, data.session_id);
  }
  async decryptSessions(sessions) {
    const keys = [];
    for (const [sessionId, sessionData] of Object.entries(sessions)) {
      try {
        const decrypted = JSON.parse(await (0, _decryptAESSecretStorageItem.default)(sessionData.session_data, this.key, sessionId));
        decrypted.session_id = sessionId;
        keys.push(decrypted);
      } catch (e) {
        _logger.logger.log("Failed to decrypt megolm session from backup", e, sessionData);
      }
    }
    return keys;
  }
  async keyMatches(key) {
    if (this.authData.mac) {
      const {
        mac
      } = await (0, _secretStorage.calculateKeyCheck)(key, this.authData.iv);
      return this.authData.mac.replace(/=+$/g, "") === mac.replace(/=+/g, "");
    } else {
      // if we have no information, we have to assume the key is right
      return true;
    }
  }
  free() {
    this.key.fill(0);
  }
}
exports.Aes256 = Aes256;
_defineProperty(Aes256, "algorithmName", UNSTABLE_MSC3270_NAME.name);
const algorithmsByName = exports.algorithmsByName = {
  [Curve25519.algorithmName]: Curve25519,
  [Aes256.algorithmName]: Aes256
};

// the linter doesn't like this but knip does
// eslint-disable-next-line tsdoc/syntax
/** @alias */
const DefaultAlgorithm = exports.DefaultAlgorithm = Curve25519;

/**
 * Map a legacy {@link TrustInfo} into a new-style {@link BackupTrustInfo}.
 *
 * @param trustInfo - trustInfo to convert
 */
function backupTrustInfoFromLegacyTrustInfo(trustInfo) {
  return {
    trusted: trustInfo.usable,
    matchesDecryptionKey: trustInfo.trusted_locally ?? false
  };
}

/**
 * Implementation of {@link BackupDecryptor} for the libolm crypto backend.
 */
class LibOlmBackupDecryptor {
  constructor(algorithm) {
    _defineProperty(this, "algorithm", void 0);
    _defineProperty(this, "sourceTrusted", void 0);
    this.algorithm = algorithm;
    this.sourceTrusted = !algorithm.untrusted;
  }

  /**
   * Implements {@link BackupDecryptor#free}
   */
  free() {
    this.algorithm.free();
  }

  /**
   * Implements {@link BackupDecryptor#decryptSessions}
   */
  async decryptSessions(sessions) {
    return await this.algorithm.decryptSessions(sessions);
  }
}
exports.LibOlmBackupDecryptor = LibOlmBackupDecryptor;