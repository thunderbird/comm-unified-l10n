"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PerSessionKeyBackupDownloader = void 0;
var _httpApi = require("../http-api");
var _matrix = require("../matrix");
var _utils = require("../utils");
function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : String(i); }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); } /*
Copyright 2023 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
// The minimum time to wait between two retries in case of errors. To avoid hammering the server.
const KEY_BACKUP_BACKOFF = 5000; // ms

/**
 * Enumerates the different kind of errors that can occurs when downloading and importing a key from backup.
 */
var KeyDownloadErrorCode = /*#__PURE__*/function (KeyDownloadErrorCode) {
  KeyDownloadErrorCode["MISSING_DECRYPTION_KEY"] = "MISSING_DECRYPTION_KEY";
  KeyDownloadErrorCode["NETWORK_ERROR"] = "NETWORK_ERROR";
  KeyDownloadErrorCode["STOPPED"] = "STOPPED";
  return KeyDownloadErrorCode;
}(KeyDownloadErrorCode || {});
class KeyDownloadError extends Error {
  constructor(code) {
    super(`Failed to get key from backup: ${code}`);
    this.code = code;
    this.name = "KeyDownloadError";
  }
}
class KeyDownloadRateLimitError extends Error {
  constructor(retryMillis) {
    super(`Failed to get key from backup: rate limited`);
    this.retryMillis = retryMillis;
    this.name = "KeyDownloadRateLimitError";
  }
}

/** Details of a megolm session whose key we are trying to fetch. */

/** Holds the current backup decryptor and version that should be used. */

/**
 * Used when an 'unable to decrypt' error occurs. It attempts to download the key from the backup.
 *
 * The current backup API lacks pagination, which can lead to lengthy key retrieval times for large histories (several 10s of minutes).
 * To mitigate this, keys are downloaded on demand as decryption errors occurs.
 * While this approach may result in numerous requests, it improves user experience by reducing wait times for message decryption.
 *
 * The PerSessionKeyBackupDownloader is resistant to backup configuration changes: it will automatically resume querying when
 * the backup is configured correctly.
 */
class PerSessionKeyBackupDownloader {
  /**
   * Creates a new instance of PerSessionKeyBackupDownloader.
   *
   * @param backupManager - The backup manager to use.
   * @param olmMachine - The olm machine to use.
   * @param http - The http instance to use.
   * @param logger - The logger to use.
   */
  constructor(logger, olmMachine, http, backupManager) {
    this.olmMachine = olmMachine;
    this.http = http;
    this.backupManager = backupManager;
    _defineProperty(this, "stopped", false);
    /** The version and decryption key to use with current backup if all set up correctly */
    _defineProperty(this, "configuration", null);
    /** We remember when a session was requested and not found in backup to avoid query again too soon.
     * Map of session_id to timestamp */
    _defineProperty(this, "sessionLastCheckAttemptedTime", new Map());
    /** The logger to use */
    _defineProperty(this, "logger", void 0);
    /** Whether the download loop is running. */
    _defineProperty(this, "downloadLoopRunning", false);
    /** The list of requests that are queued. */
    _defineProperty(this, "queuedRequests", []);
    /** Remembers if we have a configuration problem. */
    _defineProperty(this, "hasConfigurationProblem", false);
    /** The current server backup version check promise. To avoid doing a server call if one is in flight. */
    _defineProperty(this, "currentBackupVersionCheck", null);
    /**
     * Called when the backup status changes (CryptoEvents)
     * This will trigger a check of the backup configuration.
     */
    _defineProperty(this, "onBackupStatusChanged", () => {
      // we want to force check configuration, so we clear the current one.
      this.hasConfigurationProblem = false;
      this.configuration = null;
      this.getOrCreateBackupConfiguration().then(configuration => {
        if (configuration) {
          // restart the download loop if it was stopped
          this.downloadKeysLoop();
        }
      });
    });
    this.logger = logger.getChild("[PerSessionKeyBackupDownloader]");
    backupManager.on(_matrix.CryptoEvent.KeyBackupStatus, this.onBackupStatusChanged);
    backupManager.on(_matrix.CryptoEvent.KeyBackupFailed, this.onBackupStatusChanged);
    backupManager.on(_matrix.CryptoEvent.KeyBackupDecryptionKeyCached, this.onBackupStatusChanged);
  }

  /**
   * Called when a MissingRoomKey or UnknownMessageIndex decryption error is encountered.
   *
   * This will try to download the key from the backup if there is a trusted active backup.
   * In case of success the key will be imported and the onRoomKeysUpdated callback will be called
   * internally by the rust-sdk and decryption will be retried.
   *
   * @param roomId - The room ID of the room where the error occurred.
   * @param megolmSessionId - The megolm session ID that is missing.
   */
  onDecryptionKeyMissingError(roomId, megolmSessionId) {
    // Several messages encrypted with the same session may be decrypted at the same time,
    // so we need to be resistant and not query several time the same session.
    if (this.isAlreadyInQueue(roomId, megolmSessionId)) {
      // There is already a request queued for this session, no need to queue another one.
      this.logger.trace(`Not checking key backup for session ${megolmSessionId} as it is already queued`);
      return;
    }
    if (this.wasRequestedRecently(megolmSessionId)) {
      // We already tried to download this session recently and it was not in backup, no need to try again.
      this.logger.trace(`Not checking key backup for session ${megolmSessionId} as it was already requested recently`);
      return;
    }

    // We always add the request to the queue, even if we have a configuration problem (can't access backup).
    // This is to make sure that if the configuration problem is resolved, we will try to download the key.
    // This will happen after an initial sync, at this point the backup will not yet be trusted and the decryption
    // key will not be available, but it will be just after the verification.
    // We don't need to persist it because currently on refresh the sdk will retry to decrypt the messages in error.
    this.queuedRequests.push({
      roomId,
      megolmSessionId
    });

    // Start the download loop if it's not already running.
    this.downloadKeysLoop();
  }
  stop() {
    this.stopped = true;
    this.backupManager.off(_matrix.CryptoEvent.KeyBackupStatus, this.onBackupStatusChanged);
    this.backupManager.off(_matrix.CryptoEvent.KeyBackupFailed, this.onBackupStatusChanged);
    this.backupManager.off(_matrix.CryptoEvent.KeyBackupDecryptionKeyCached, this.onBackupStatusChanged);
  }
  /** Returns true if the megolm session is already queued for download. */
  isAlreadyInQueue(roomId, megolmSessionId) {
    return this.queuedRequests.some(info => {
      return info.roomId == roomId && info.megolmSessionId == megolmSessionId;
    });
  }

  /**
   * Marks the session as not found in backup, to avoid retrying to soon for a key not in backup
   *
   * @param megolmSessionId - The megolm session ID that is missing.
   */
  markAsNotFoundInBackup(megolmSessionId) {
    const now = Date.now();
    this.sessionLastCheckAttemptedTime.set(megolmSessionId, now);
    // if too big make some cleaning to keep under control
    if (this.sessionLastCheckAttemptedTime.size > 100) {
      this.sessionLastCheckAttemptedTime = new Map(Array.from(this.sessionLastCheckAttemptedTime).filter((sid, ts) => {
        return Math.max(now - ts, 0) < KEY_BACKUP_BACKOFF;
      }));
    }
  }

  /** Returns true if the session was requested recently. */
  wasRequestedRecently(megolmSessionId) {
    const lastCheck = this.sessionLastCheckAttemptedTime.get(megolmSessionId);
    if (!lastCheck) return false;
    return Math.max(Date.now() - lastCheck, 0) < KEY_BACKUP_BACKOFF;
  }
  async getBackupDecryptionKey() {
    try {
      return await this.olmMachine.getBackupKeys();
    } catch (e) {
      return null;
    }
  }

  /**
   * Requests a key from the server side backup.
   *
   * @param version - The backup version to use.
   * @param roomId - The room ID of the room where the error occurred.
   * @param sessionId - The megolm session ID that is missing.
   */
  async requestRoomKeyFromBackup(version, roomId, sessionId) {
    const path = (0, _utils.encodeUri)("/room_keys/keys/$roomId/$sessionId", {
      $roomId: roomId,
      $sessionId: sessionId
    });
    return await this.http.authedRequest(_httpApi.Method.Get, path, {
      version
    }, undefined, {
      prefix: _httpApi.ClientPrefix.V3
    });
  }
  async downloadKeysLoop() {
    if (this.downloadLoopRunning) return;

    // If we have a configuration problem, we don't want to try to download.
    // If any configuration change is detected, we will retry and restart the loop.
    if (this.hasConfigurationProblem) return;
    this.downloadLoopRunning = true;
    try {
      while (this.queuedRequests.length > 0) {
        // we just peek the first one without removing it, so if a new request for same key comes in while we're
        // processing this one, it won't queue another request.
        const request = this.queuedRequests[0];
        try {
          // The backup could have changed between the time we queued the request and now, so we need to check
          const configuration = await this.getOrCreateBackupConfiguration();
          if (!configuration) {
            // Backup is not configured correctly, so stop the loop.
            this.downloadLoopRunning = false;
            return;
          }
          const result = await this.queryKeyBackup(request.roomId, request.megolmSessionId, configuration);
          if (this.stopped) {
            return;
          }
          // We got the encrypted key from backup, let's try to decrypt and import it.
          try {
            await this.decryptAndImport(request, result, configuration);
          } catch (e) {
            this.logger.error(`Error while decrypting and importing key backup for session ${request.megolmSessionId}`, e);
          }
          // now remove the request from the queue as we've processed it.
          this.queuedRequests.shift();
        } catch (err) {
          if (err instanceof KeyDownloadError) {
            switch (err.code) {
              case KeyDownloadErrorCode.MISSING_DECRYPTION_KEY:
                this.markAsNotFoundInBackup(request.megolmSessionId);
                // continue for next one
                this.queuedRequests.shift();
                break;
              case KeyDownloadErrorCode.NETWORK_ERROR:
                // We don't want to hammer if there is a problem, so wait a bit.
                await (0, _utils.sleep)(KEY_BACKUP_BACKOFF);
                break;
              case KeyDownloadErrorCode.STOPPED:
                // If the downloader was stopped, we don't want to retry.
                this.downloadLoopRunning = false;
                return;
            }
          } else if (err instanceof KeyDownloadRateLimitError) {
            // we want to retry after the backoff time
            await (0, _utils.sleep)(err.retryMillis);
          }
        }
      }
    } finally {
      // all pending request have been processed, we can stop the loop.
      this.downloadLoopRunning = false;
    }
  }

  /**
   * Query the backup for a key.
   *
   * @param targetRoomId - ID of the room that the session is used in.
   * @param targetSessionId - ID of the session for which to check backup.
   * @param configuration - The backup configuration to use.
   */
  async queryKeyBackup(targetRoomId, targetSessionId, configuration) {
    this.logger.debug(`Checking key backup for session ${targetSessionId}`);
    if (this.stopped) throw new KeyDownloadError(KeyDownloadErrorCode.STOPPED);
    try {
      const res = await this.requestRoomKeyFromBackup(configuration.backupVersion, targetRoomId, targetSessionId);
      this.logger.debug(`Got key from backup for sessionId:${targetSessionId}`);
      return res;
    } catch (e) {
      if (this.stopped) throw new KeyDownloadError(KeyDownloadErrorCode.STOPPED);
      this.logger.info(`No luck requesting key backup for session ${targetSessionId}: ${e}`);
      if (e instanceof _httpApi.MatrixError) {
        const errCode = e.data.errcode;
        if (errCode == "M_NOT_FOUND") {
          // Unfortunately the spec doesn't give us a way to differentiate between a missing key and a wrong version.
          // Synapse will return:
          //     - "error": "Unknown backup version" if the version is wrong.
          //     - "error": "No room_keys found" if the key is missing.
          // It's useful to know if the key is missing or if the version is wrong.
          // As it's not spec'ed, we fall back on considering the key is not in backup.
          // Notice that this request will be lost if instead the backup got out of sync (updated from other session).
          throw new KeyDownloadError(KeyDownloadErrorCode.MISSING_DECRYPTION_KEY);
        }
        if (errCode == "M_LIMIT_EXCEEDED") {
          const waitTime = e.data.retry_after_ms;
          if (waitTime > 0) {
            this.logger.info(`Rate limited by server, waiting ${waitTime}ms`);
            throw new KeyDownloadRateLimitError(waitTime);
          } else {
            // apply the default backoff time
            throw new KeyDownloadRateLimitError(KEY_BACKUP_BACKOFF);
          }
        }
      }
      throw new KeyDownloadError(KeyDownloadErrorCode.NETWORK_ERROR);
    }
  }
  async decryptAndImport(sessionInfo, data, configuration) {
    const sessionsToImport = {
      [sessionInfo.megolmSessionId]: data
    };
    const keys = await configuration.decryptor.decryptSessions(sessionsToImport);
    for (const k of keys) {
      k.room_id = sessionInfo.roomId;
    }
    await this.backupManager.importBackedUpRoomKeys(keys);
  }

  /**
   * Gets the current backup configuration or create one if it doesn't exist.
   *
   * When a valid configuration is found it is cached and returned for subsequent calls.
   * Otherwise, if a check is forced or a check has not yet been done, a new check is done.
   *
   * @returns The backup configuration to use or null if there is a configuration problem.
   */
  async getOrCreateBackupConfiguration() {
    if (this.configuration) {
      return this.configuration;
    }

    // We already tried to check the configuration and it failed.
    // We don't want to try again immediately, we will retry if a configuration change is detected.
    if (this.hasConfigurationProblem) {
      return null;
    }

    // This method can be called rapidly by several emitted CryptoEvent, so we need to make sure that we don't
    // query the server several times.
    if (this.currentBackupVersionCheck != null) {
      this.logger.debug(`Already checking server version, use current promise`);
      return await this.currentBackupVersionCheck;
    }
    this.currentBackupVersionCheck = this.internalCheckFromServer();
    try {
      return await this.currentBackupVersionCheck;
    } finally {
      this.currentBackupVersionCheck = null;
    }
  }
  async internalCheckFromServer() {
    let currentServerVersion = null;
    try {
      currentServerVersion = await this.backupManager.requestKeyBackupVersion();
    } catch (e) {
      this.logger.debug(`Backup: error while checking server version: ${e}`);
      this.hasConfigurationProblem = true;
      return null;
    }
    this.logger.debug(`Got current backup version from server: ${currentServerVersion?.version}`);
    if (currentServerVersion?.algorithm != "m.megolm_backup.v1.curve25519-aes-sha2") {
      this.logger.info(`Unsupported algorithm ${currentServerVersion?.algorithm}`);
      this.hasConfigurationProblem = true;
      return null;
    }
    if (!currentServerVersion?.version) {
      this.logger.info(`No current key backup`);
      this.hasConfigurationProblem = true;
      return null;
    }
    const activeVersion = await this.backupManager.getActiveBackupVersion();
    if (activeVersion == null || currentServerVersion.version != activeVersion) {
      // Either the current backup version on server side is not trusted, or it is out of sync with the active version on the client side.
      this.logger.info(`The current backup version on the server (${currentServerVersion.version}) is not trusted. Version we are currently backing up to: ${activeVersion}`);
      this.hasConfigurationProblem = true;
      return null;
    }
    const authData = currentServerVersion.auth_data;
    const backupKeys = await this.getBackupDecryptionKey();
    if (!backupKeys?.decryptionKey) {
      this.logger.debug(`Not checking key backup for session (no decryption key)`);
      this.hasConfigurationProblem = true;
      return null;
    }
    if (activeVersion != backupKeys.backupVersion) {
      this.logger.debug(`Version for which we have a decryption key (${backupKeys.backupVersion}) doesn't match the version we are backing up to (${activeVersion})`);
      this.hasConfigurationProblem = true;
      return null;
    }
    if (authData.public_key != backupKeys.decryptionKey.megolmV1PublicKey.publicKeyBase64) {
      this.logger.debug(`getBackupDecryptor key mismatch error`);
      this.hasConfigurationProblem = true;
      return null;
    }
    const backupDecryptor = this.backupManager.createBackupDecryptor(backupKeys.decryptionKey);
    this.hasConfigurationProblem = false;
    this.configuration = {
      decryptor: backupDecryptor,
      backupVersion: activeVersion
    };
    return this.configuration;
  }
}
exports.PerSessionKeyBackupDownloader = PerSessionKeyBackupDownloader;