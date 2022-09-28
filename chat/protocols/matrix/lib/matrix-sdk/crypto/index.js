"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.IncomingRoomKeyRequest = exports.CryptoEvent = exports.Crypto = void 0;
exports.fixBackupKey = fixBackupKey;
exports.isCryptoAvailable = isCryptoAvailable;
exports.verificationMethods = void 0;

var _anotherJson = _interopRequireDefault(require("another-json"));

var _event = require("../@types/event");

var _ReEmitter = require("../ReEmitter");

var _logger = require("../logger");

var _OlmDevice = require("./OlmDevice");

var olmlib = _interopRequireWildcard(require("./olmlib"));

var _DeviceList = require("./DeviceList");

var _deviceinfo = require("./deviceinfo");

var algorithms = _interopRequireWildcard(require("./algorithms"));

var _CrossSigning = require("./CrossSigning");

var _EncryptionSetup = require("./EncryptionSetup");

var _SecretStorage = require("./SecretStorage");

var _OutgoingRoomKeyRequestManager = require("./OutgoingRoomKeyRequestManager");

var _indexeddbCryptoStore = require("./store/indexeddb-crypto-store");

var _QRCode = require("./verification/QRCode");

var _SAS = require("./verification/SAS");

var _key_passphrase = require("./key_passphrase");

var _recoverykey = require("./recoverykey");

var _VerificationRequest = require("./verification/request/VerificationRequest");

var _InRoomChannel = require("./verification/request/InRoomChannel");

var _ToDeviceChannel = require("./verification/request/ToDeviceChannel");

var _IllegalMethod = require("./verification/IllegalMethod");

var _errors = require("../errors");

var _aes = require("./aes");

var _dehydration = require("./dehydration");

var _backup = require("./backup");

var _room = require("../models/room");

var _roomMember = require("../models/room-member");

var _event2 = require("../models/event");

var _client = require("../client");

var _typedEventEmitter = require("../models/typed-event-emitter");

function _getRequireWildcardCache(nodeInterop) { if (typeof WeakMap !== "function") return null; var cacheBabelInterop = new WeakMap(); var cacheNodeInterop = new WeakMap(); return (_getRequireWildcardCache = function (nodeInterop) { return nodeInterop ? cacheNodeInterop : cacheBabelInterop; })(nodeInterop); }

function _interopRequireWildcard(obj, nodeInterop) { if (!nodeInterop && obj && obj.__esModule) { return obj; } if (obj === null || typeof obj !== "object" && typeof obj !== "function") { return { default: obj }; } var cache = _getRequireWildcardCache(nodeInterop); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj.default = obj; if (cache) { cache.set(obj, newObj); } return newObj; }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function ownKeys(object, enumerableOnly) { var keys = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); enumerableOnly && (symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym).enumerable; })), keys.push.apply(keys, symbols); } return keys; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = null != arguments[i] ? arguments[i] : {}; i % 2 ? ownKeys(Object(source), !0).forEach(function (key) { _defineProperty(target, key, source[key]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys(Object(source)).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)); }); } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

const DeviceVerification = _deviceinfo.DeviceInfo.DeviceVerification;
const defaultVerificationMethods = {
  [_QRCode.ReciprocateQRCode.NAME]: _QRCode.ReciprocateQRCode,
  [_SAS.SAS.NAME]: _SAS.SAS,
  // These two can't be used for actual verification, but we do
  // need to be able to define them here for the verification flows
  // to start.
  [_QRCode.SHOW_QR_CODE_METHOD]: _IllegalMethod.IllegalMethod,
  [_QRCode.SCAN_QR_CODE_METHOD]: _IllegalMethod.IllegalMethod
};
/**
 * verification method names
 */
// legacy export identifier

const verificationMethods = {
  RECIPROCATE_QR_CODE: _QRCode.ReciprocateQRCode.NAME,
  SAS: _SAS.SAS.NAME
};
exports.verificationMethods = verificationMethods;

function isCryptoAvailable() {
  return Boolean(global.Olm);
}

const MIN_FORCE_SESSION_INTERVAL_MS = 60 * 60 * 1000;

/* eslint-enable camelcase */
let CryptoEvent;
exports.CryptoEvent = CryptoEvent;

(function (CryptoEvent) {
  CryptoEvent["DeviceVerificationChanged"] = "deviceVerificationChanged";
  CryptoEvent["UserTrustStatusChanged"] = "userTrustStatusChanged";
  CryptoEvent["UserCrossSigningUpdated"] = "userCrossSigningUpdated";
  CryptoEvent["RoomKeyRequest"] = "crypto.roomKeyRequest";
  CryptoEvent["RoomKeyRequestCancellation"] = "crypto.roomKeyRequestCancellation";
  CryptoEvent["KeyBackupStatus"] = "crypto.keyBackupStatus";
  CryptoEvent["KeyBackupFailed"] = "crypto.keyBackupFailed";
  CryptoEvent["KeyBackupSessionsRemaining"] = "crypto.keyBackupSessionsRemaining";
  CryptoEvent["KeySignatureUploadFailure"] = "crypto.keySignatureUploadFailure";
  CryptoEvent["VerificationRequest"] = "crypto.verification.request";
  CryptoEvent["Warning"] = "crypto.warning";
  CryptoEvent["WillUpdateDevices"] = "crypto.willUpdateDevices";
  CryptoEvent["DevicesUpdated"] = "crypto.devicesUpdated";
  CryptoEvent["KeysChanged"] = "crossSigning.keysChanged";
})(CryptoEvent || (exports.CryptoEvent = CryptoEvent = {}));

class Crypto extends _typedEventEmitter.TypedEventEmitter {
  /**
   * @return {string} The version of Olm.
   */
  static getOlmVersion() {
    return _OlmDevice.OlmDevice.getOlmVersion();
  }

  /**
   * Cryptography bits
   *
   * This module is internal to the js-sdk; the public API is via MatrixClient.
   *
   * @constructor
   * @alias module:crypto
   *
   * @internal
   *
   * @param {MatrixClient} baseApis base matrix api interface
   *
   * @param {string} userId The user ID for the local user
   *
   * @param {string} deviceId The identifier for this device.
   *
   * @param {Object} clientStore the MatrixClient data store.
   *
   * @param {module:crypto/store/base~CryptoStore} cryptoStore
   *    storage for the crypto layer.
   *
   * @param {RoomList} roomList An initialised RoomList object
   *
   * @param {Array} verificationMethods Array of verification methods to use.
   *    Each element can either be a string from MatrixClient.verificationMethods
   *    or a class that implements a verification method.
   */
  constructor(baseApis, userId, deviceId, clientStore, cryptoStore, roomList, verificationMethods) {
    super();
    this.baseApis = baseApis;
    this.userId = userId;
    this.deviceId = deviceId;
    this.clientStore = clientStore;
    this.cryptoStore = cryptoStore;
    this.roomList = roomList;

    _defineProperty(this, "backupManager", void 0);

    _defineProperty(this, "crossSigningInfo", void 0);

    _defineProperty(this, "olmDevice", void 0);

    _defineProperty(this, "deviceList", void 0);

    _defineProperty(this, "dehydrationManager", void 0);

    _defineProperty(this, "secretStorage", void 0);

    _defineProperty(this, "reEmitter", void 0);

    _defineProperty(this, "verificationMethods", void 0);

    _defineProperty(this, "supportedAlgorithms", void 0);

    _defineProperty(this, "outgoingRoomKeyRequestManager", void 0);

    _defineProperty(this, "toDeviceVerificationRequests", void 0);

    _defineProperty(this, "inRoomVerificationRequests", void 0);

    _defineProperty(this, "trustCrossSignedDevices", true);

    _defineProperty(this, "lastOneTimeKeyCheck", null);

    _defineProperty(this, "oneTimeKeyCheckInProgress", false);

    _defineProperty(this, "roomEncryptors", new Map());

    _defineProperty(this, "roomDecryptors", new Map());

    _defineProperty(this, "deviceKeys", {});

    _defineProperty(this, "globalBlacklistUnverifiedDevices", false);

    _defineProperty(this, "globalErrorOnUnknownDevices", true);

    _defineProperty(this, "receivedRoomKeyRequests", []);

    _defineProperty(this, "receivedRoomKeyRequestCancellations", []);

    _defineProperty(this, "processingRoomKeyRequests", false);

    _defineProperty(this, "lazyLoadMembers", false);

    _defineProperty(this, "roomDeviceTrackingState", {});

    _defineProperty(this, "lastNewSessionForced", {});

    _defineProperty(this, "sendKeyRequestsImmediately", false);

    _defineProperty(this, "oneTimeKeyCount", void 0);

    _defineProperty(this, "needsNewFallback", void 0);

    _defineProperty(this, "fallbackCleanup", void 0);

    _defineProperty(this, "onDeviceListUserCrossSigningUpdated", async userId => {
      if (userId === this.userId) {
        // An update to our own cross-signing key.
        // Get the new key first:
        const newCrossSigning = this.deviceList.getStoredCrossSigningForUser(userId);
        const seenPubkey = newCrossSigning ? newCrossSigning.getId() : null;
        const currentPubkey = this.crossSigningInfo.getId();
        const changed = currentPubkey !== seenPubkey;

        if (currentPubkey && seenPubkey && !changed) {
          // If it's not changed, just make sure everything is up to date
          await this.checkOwnCrossSigningTrust();
        } else {
          // We'll now be in a state where cross-signing on the account is not trusted
          // because our locally stored cross-signing keys will not match the ones
          // on the server for our account. So we clear our own stored cross-signing keys,
          // effectively disabling cross-signing until the user gets verified by the device
          // that reset the keys
          this.storeTrustedSelfKeys(null); // emit cross-signing has been disabled

          this.emit(CryptoEvent.KeysChanged, {}); // as the trust for our own user has changed,
          // also emit an event for this

          this.emit(CryptoEvent.UserTrustStatusChanged, this.userId, this.checkUserTrust(userId));
        }
      } else {
        await this.checkDeviceVerifications(userId); // Update verified before latch using the current state and save the new
        // latch value in the device list store.

        const crossSigning = this.deviceList.getStoredCrossSigningForUser(userId);

        if (crossSigning) {
          crossSigning.updateCrossSigningVerifiedBefore(this.checkUserTrust(userId).isCrossSigningVerified());
          this.deviceList.setRawStoredCrossSigningForUser(userId, crossSigning.toStorage());
        }

        this.emit(CryptoEvent.UserTrustStatusChanged, userId, this.checkUserTrust(userId));
      }
    });

    _defineProperty(this, "onMembership", (event, member, oldMembership) => {
      try {
        this.onRoomMembership(event, member, oldMembership);
      } catch (e) {
        _logger.logger.error("Error handling membership change:", e);
      }
    });

    _defineProperty(this, "onToDeviceEvent", event => {
      try {
        _logger.logger.log(`received to_device ${event.getType()} from: ` + `${event.getSender()} id: ${event.getId()}`);

        if (event.getType() == "m.room_key" || event.getType() == "m.forwarded_room_key") {
          this.onRoomKeyEvent(event);
        } else if (event.getType() == "m.room_key_request") {
          this.onRoomKeyRequestEvent(event);
        } else if (event.getType() === "m.secret.request") {
          this.secretStorage.onRequestReceived(event);
        } else if (event.getType() === "m.secret.send") {
          this.secretStorage.onSecretReceived(event);
        } else if (event.getType() === "m.room_key.withheld") {
          this.onRoomKeyWithheldEvent(event);
        } else if (event.getContent().transaction_id) {
          this.onKeyVerificationMessage(event);
        } else if (event.getContent().msgtype === "m.bad.encrypted") {
          this.onToDeviceBadEncrypted(event);
        } else if (event.isBeingDecrypted() || event.shouldAttemptDecryption()) {
          if (!event.isBeingDecrypted()) {
            event.attemptDecryption(this);
          } // once the event has been decrypted, try again


          event.once(_event2.MatrixEventEvent.Decrypted, ev => {
            this.onToDeviceEvent(ev);
          });
        }
      } catch (e) {
        _logger.logger.error("Error handling toDeviceEvent:", e);
      }
    });

    _defineProperty(this, "onTimelineEvent", (event, room, atStart, removed, {
      liveEvent = true
    } = {}) => {
      if (!_InRoomChannel.InRoomChannel.validateEvent(event, this.baseApis)) {
        return;
      }

      const createRequest = event => {
        const channel = new _InRoomChannel.InRoomChannel(this.baseApis, event.getRoomId());
        return new _VerificationRequest.VerificationRequest(channel, this.verificationMethods, this.baseApis);
      };

      this.handleVerificationEvent(event, this.inRoomVerificationRequests, createRequest, liveEvent);
    });

    this.reEmitter = new _ReEmitter.TypedReEmitter(this);

    if (verificationMethods) {
      this.verificationMethods = new Map();

      for (const method of verificationMethods) {
        if (typeof method === "string") {
          if (defaultVerificationMethods[method]) {
            this.verificationMethods.set(method, defaultVerificationMethods[method]);
          }
        } else if (method["NAME"]) {
          this.verificationMethods.set(method["NAME"], method);
        } else {
          _logger.logger.warn(`Excluding unknown verification method ${method}`);
        }
      }
    } else {
      this.verificationMethods = new Map(Object.entries(defaultVerificationMethods));
    }

    this.backupManager = new _backup.BackupManager(baseApis, async () => {
      // try to get key from cache
      const cachedKey = await this.getSessionBackupPrivateKey();

      if (cachedKey) {
        return cachedKey;
      } // try to get key from secret storage


      const storedKey = await this.getSecret("m.megolm_backup.v1");

      if (storedKey) {
        // ensure that the key is in the right format.  If not, fix the key and
        // store the fixed version
        const fixedKey = fixBackupKey(storedKey);

        if (fixedKey) {
          const [keyId] = await this.getSecretStorageKey();
          await this.storeSecret("m.megolm_backup.v1", fixedKey, [keyId]);
        }

        return olmlib.decodeBase64(fixedKey || storedKey);
      } // try to get key from app


      if (this.baseApis.cryptoCallbacks && this.baseApis.cryptoCallbacks.getBackupKey) {
        return this.baseApis.cryptoCallbacks.getBackupKey();
      }

      throw new Error("Unable to get private key");
    });
    this.olmDevice = new _OlmDevice.OlmDevice(cryptoStore);
    this.deviceList = new _DeviceList.DeviceList(baseApis, cryptoStore, this.olmDevice); // XXX: This isn't removed at any point, but then none of the event listeners
    // this class sets seem to be removed at any point... :/

    this.deviceList.on(CryptoEvent.UserCrossSigningUpdated, this.onDeviceListUserCrossSigningUpdated);
    this.reEmitter.reEmit(this.deviceList, [CryptoEvent.DevicesUpdated, CryptoEvent.WillUpdateDevices]);
    this.supportedAlgorithms = Array.from(algorithms.DECRYPTION_CLASSES.keys());
    this.outgoingRoomKeyRequestManager = new _OutgoingRoomKeyRequestManager.OutgoingRoomKeyRequestManager(baseApis, this.deviceId, this.cryptoStore);
    this.toDeviceVerificationRequests = new _ToDeviceChannel.ToDeviceRequests();
    this.inRoomVerificationRequests = new _InRoomChannel.InRoomRequests();
    const cryptoCallbacks = this.baseApis.cryptoCallbacks || {};
    const cacheCallbacks = (0, _CrossSigning.createCryptoStoreCacheCallbacks)(cryptoStore, this.olmDevice);
    this.crossSigningInfo = new _CrossSigning.CrossSigningInfo(userId, cryptoCallbacks, cacheCallbacks); // Yes, we pass the client twice here: see SecretStorage

    this.secretStorage = new _SecretStorage.SecretStorage(baseApis, cryptoCallbacks, baseApis);
    this.dehydrationManager = new _dehydration.DehydrationManager(this); // Assuming no app-supplied callback, default to getting from SSSS.

    if (!cryptoCallbacks.getCrossSigningKey && cryptoCallbacks.getSecretStorageKey) {
      cryptoCallbacks.getCrossSigningKey = async type => {
        return _CrossSigning.CrossSigningInfo.getFromSecretStorage(type, this.secretStorage);
      };
    }
  }
  /**
   * Initialise the crypto module so that it is ready for use
   *
   * Returns a promise which resolves once the crypto module is ready for use.
   *
   * @param {Object} opts keyword arguments.
   * @param {string} opts.exportedOlmDevice (Optional) data from exported device
   *     that must be re-created.
   */


  async init({
    exportedOlmDevice,
    pickleKey
  } = {}) {
    _logger.logger.log("Crypto: initialising Olm...");

    await global.Olm.init();

    _logger.logger.log(exportedOlmDevice ? "Crypto: initialising Olm device from exported device..." : "Crypto: initialising Olm device...");

    await this.olmDevice.init({
      fromExportedDevice: exportedOlmDevice,
      pickleKey
    });

    _logger.logger.log("Crypto: loading device list...");

    await this.deviceList.load(); // build our device keys: these will later be uploaded

    this.deviceKeys["ed25519:" + this.deviceId] = this.olmDevice.deviceEd25519Key;
    this.deviceKeys["curve25519:" + this.deviceId] = this.olmDevice.deviceCurve25519Key;

    _logger.logger.log("Crypto: fetching own devices...");

    let myDevices = this.deviceList.getRawStoredDevicesForUser(this.userId);

    if (!myDevices) {
      myDevices = {};
    }

    if (!myDevices[this.deviceId]) {
      // add our own deviceinfo to the cryptoStore
      _logger.logger.log("Crypto: adding this device to the store...");

      const deviceInfo = {
        keys: this.deviceKeys,
        algorithms: this.supportedAlgorithms,
        verified: DeviceVerification.VERIFIED,
        known: true
      };
      myDevices[this.deviceId] = deviceInfo;
      this.deviceList.storeDevicesForUser(this.userId, myDevices);
      this.deviceList.saveIfDirty();
    }

    await this.cryptoStore.doTxn('readonly', [_indexeddbCryptoStore.IndexedDBCryptoStore.STORE_ACCOUNT], txn => {
      this.cryptoStore.getCrossSigningKeys(txn, keys => {
        // can be an empty object after resetting cross-signing keys, see storeTrustedSelfKeys
        if (keys && Object.keys(keys).length !== 0) {
          _logger.logger.log("Loaded cross-signing public keys from crypto store");

          this.crossSigningInfo.setKeys(keys);
        }
      });
    }); // make sure we are keeping track of our own devices
    // (this is important for key backups & things)

    this.deviceList.startTrackingDeviceList(this.userId);

    _logger.logger.log("Crypto: checking for key backup...");

    this.backupManager.checkAndStart();
  }
  /**
   * Whether to trust a others users signatures of their devices.
   * If false, devices will only be considered 'verified' if we have
   * verified that device individually (effectively disabling cross-signing).
   *
   * Default: true
   *
   * @return {boolean} True if trusting cross-signed devices
   */


  getCryptoTrustCrossSignedDevices() {
    return this.trustCrossSignedDevices;
  }
  /**
   * See getCryptoTrustCrossSignedDevices
    * This may be set before initCrypto() is called to ensure no races occur.
   *
   * @param {boolean} val True to trust cross-signed devices
   */


  setCryptoTrustCrossSignedDevices(val) {
    this.trustCrossSignedDevices = val;

    for (const userId of this.deviceList.getKnownUserIds()) {
      const devices = this.deviceList.getRawStoredDevicesForUser(userId);

      for (const deviceId of Object.keys(devices)) {
        const deviceTrust = this.checkDeviceTrust(userId, deviceId); // If the device is locally verified then isVerified() is always true,
        // so this will only have caused the value to change if the device is
        // cross-signing verified but not locally verified

        if (!deviceTrust.isLocallyVerified() && deviceTrust.isCrossSigningVerified()) {
          const deviceObj = this.deviceList.getStoredDevice(userId, deviceId);
          this.emit(CryptoEvent.DeviceVerificationChanged, userId, deviceId, deviceObj);
        }
      }
    }
  }
  /**
   * Create a recovery key from a user-supplied passphrase.
   *
   * @param {string} password Passphrase string that can be entered by the user
   *     when restoring the backup as an alternative to entering the recovery key.
   *     Optional.
   * @returns {Promise<Object>} Object with public key metadata, encoded private
   *     recovery key which should be disposed of after displaying to the user,
   *     and raw private key to avoid round tripping if needed.
   */


  async createRecoveryKeyFromPassphrase(password) {
    const decryption = new global.Olm.PkDecryption();

    try {
      const keyInfo = {};

      if (password) {
        const derivation = await (0, _key_passphrase.keyFromPassphrase)(password);
        keyInfo.passphrase = {
          algorithm: "m.pbkdf2",
          iterations: derivation.iterations,
          salt: derivation.salt
        };
        keyInfo.pubkey = decryption.init_with_private_key(derivation.key);
      } else {
        keyInfo.pubkey = decryption.generate_key();
      }

      const privateKey = decryption.get_private_key();
      const encodedPrivateKey = (0, _recoverykey.encodeRecoveryKey)(privateKey);
      return {
        keyInfo: keyInfo,
        encodedPrivateKey,
        privateKey
      };
    } finally {
      if (decryption) decryption.free();
    }
  }
  /**
   * Checks whether cross signing:
   * - is enabled on this account and trusted by this device
   * - has private keys either cached locally or stored in secret storage
   *
   * If this function returns false, bootstrapCrossSigning() can be used
   * to fix things such that it returns true. That is to say, after
   * bootstrapCrossSigning() completes successfully, this function should
   * return true.
   *
   * The cross-signing API is currently UNSTABLE and may change without notice.
   *
   * @return {boolean} True if cross-signing is ready to be used on this device
   */


  async isCrossSigningReady() {
    const publicKeysOnDevice = this.crossSigningInfo.getId();
    const privateKeysExistSomewhere = (await this.crossSigningInfo.isStoredInKeyCache()) || (await this.crossSigningInfo.isStoredInSecretStorage(this.secretStorage));
    return !!(publicKeysOnDevice && privateKeysExistSomewhere);
  }
  /**
   * Checks whether secret storage:
   * - is enabled on this account
   * - is storing cross-signing private keys
   * - is storing session backup key (if enabled)
   *
   * If this function returns false, bootstrapSecretStorage() can be used
   * to fix things such that it returns true. That is to say, after
   * bootstrapSecretStorage() completes successfully, this function should
   * return true.
   *
   * The Secure Secret Storage API is currently UNSTABLE and may change without notice.
   *
   * @return {boolean} True if secret storage is ready to be used on this device
   */


  async isSecretStorageReady() {
    const secretStorageKeyInAccount = await this.secretStorage.hasKey();
    const privateKeysInStorage = await this.crossSigningInfo.isStoredInSecretStorage(this.secretStorage);
    const sessionBackupInStorage = !this.backupManager.getKeyBackupEnabled() || (await this.baseApis.isKeyBackupKeyStored());
    return !!(secretStorageKeyInAccount && privateKeysInStorage && sessionBackupInStorage);
  }
  /**
   * Bootstrap cross-signing by creating keys if needed. If everything is already
   * set up, then no changes are made, so this is safe to run to ensure
   * cross-signing is ready for use.
   *
   * This function:
   * - creates new cross-signing keys if they are not found locally cached nor in
   *   secret storage (if it has been setup)
   *
   * The cross-signing API is currently UNSTABLE and may change without notice.
   *
   * @param {function} opts.authUploadDeviceSigningKeys Function
   * called to await an interactive auth flow when uploading device signing keys.
   * @param {boolean} [opts.setupNewCrossSigning] Optional. Reset even if keys
   * already exist.
   * Args:
   *     {function} A function that makes the request requiring auth. Receives the
   *     auth data as an object. Can be called multiple times, first with an empty
   *     authDict, to obtain the flows.
   */


  async bootstrapCrossSigning({
    authUploadDeviceSigningKeys,
    setupNewCrossSigning
  } = {}) {
    _logger.logger.log("Bootstrapping cross-signing");

    const delegateCryptoCallbacks = this.baseApis.cryptoCallbacks;
    const builder = new _EncryptionSetup.EncryptionSetupBuilder(this.baseApis.store.accountData, delegateCryptoCallbacks);
    const crossSigningInfo = new _CrossSigning.CrossSigningInfo(this.userId, builder.crossSigningCallbacks, builder.crossSigningCallbacks); // Reset the cross-signing keys

    const resetCrossSigning = async () => {
      crossSigningInfo.resetKeys(); // Sign master key with device key

      await this.signObject(crossSigningInfo.keys.master); // Store auth flow helper function, as we need to call it when uploading
      // to ensure we handle auth errors properly.

      builder.addCrossSigningKeys(authUploadDeviceSigningKeys, crossSigningInfo.keys); // Cross-sign own device

      const device = this.deviceList.getStoredDevice(this.userId, this.deviceId);
      const deviceSignature = await crossSigningInfo.signDevice(this.userId, device);
      builder.addKeySignature(this.userId, this.deviceId, deviceSignature); // Sign message key backup with cross-signing master key

      if (this.backupManager.backupInfo) {
        await crossSigningInfo.signObject(this.backupManager.backupInfo.auth_data, "master");
        builder.addSessionBackup(this.backupManager.backupInfo);
      }
    };

    const publicKeysOnDevice = this.crossSigningInfo.getId();
    const privateKeysInCache = await this.crossSigningInfo.isStoredInKeyCache();
    const privateKeysInStorage = await this.crossSigningInfo.isStoredInSecretStorage(this.secretStorage);
    const privateKeysExistSomewhere = privateKeysInCache || privateKeysInStorage; // Log all relevant state for easier parsing of debug logs.

    _logger.logger.log({
      setupNewCrossSigning,
      publicKeysOnDevice,
      privateKeysInCache,
      privateKeysInStorage,
      privateKeysExistSomewhere
    });

    if (!privateKeysExistSomewhere || setupNewCrossSigning) {
      _logger.logger.log("Cross-signing private keys not found locally or in secret storage, " + "creating new keys"); // If a user has multiple devices, it important to only call bootstrap
      // as part of some UI flow (and not silently during startup), as they
      // may have setup cross-signing on a platform which has not saved keys
      // to secret storage, and this would reset them. In such a case, you
      // should prompt the user to verify any existing devices first (and
      // request private keys from those devices) before calling bootstrap.


      await resetCrossSigning();
    } else if (publicKeysOnDevice && privateKeysInCache) {
      _logger.logger.log("Cross-signing public keys trusted and private keys found locally");
    } else if (privateKeysInStorage) {
      _logger.logger.log("Cross-signing private keys not found locally, but they are available " + "in secret storage, reading storage and caching locally");

      await this.checkOwnCrossSigningTrust({
        allowPrivateKeyRequests: true
      });
    } // Assuming no app-supplied callback, default to storing new private keys in
    // secret storage if it exists. If it does not, it is assumed this will be
    // done as part of setting up secret storage later.


    const crossSigningPrivateKeys = builder.crossSigningCallbacks.privateKeys;

    if (crossSigningPrivateKeys.size && !this.baseApis.cryptoCallbacks.saveCrossSigningKeys) {
      const secretStorage = new _SecretStorage.SecretStorage(builder.accountDataClientAdapter, builder.ssssCryptoCallbacks);

      if (await secretStorage.hasKey()) {
        _logger.logger.log("Storing new cross-signing private keys in secret storage"); // This is writing to in-memory account data in
        // builder.accountDataClientAdapter so won't fail


        await _CrossSigning.CrossSigningInfo.storeInSecretStorage(crossSigningPrivateKeys, secretStorage);
      }
    }

    const operation = builder.buildOperation();
    await operation.apply(this); // This persists private keys and public keys as trusted,
    // only do this if apply succeeded for now as retry isn't in place yet

    await builder.persist(this);

    _logger.logger.log("Cross-signing ready");
  }
  /**
   * Bootstrap Secure Secret Storage if needed by creating a default key. If everything is
   * already set up, then no changes are made, so this is safe to run to ensure secret
   * storage is ready for use.
   *
   * This function
   * - creates a new Secure Secret Storage key if no default key exists
   *   - if a key backup exists, it is migrated to store the key in the Secret
   *     Storage
   * - creates a backup if none exists, and one is requested
   * - migrates Secure Secret Storage to use the latest algorithm, if an outdated
   *   algorithm is found
   *
   * The Secure Secret Storage API is currently UNSTABLE and may change without notice.
   *
   * @param {function} [opts.createSecretStorageKey] Optional. Function
   * called to await a secret storage key creation flow.
   * Returns:
   *     {Promise<Object>} Object with public key metadata, encoded private
   *     recovery key which should be disposed of after displaying to the user,
   *     and raw private key to avoid round tripping if needed.
   * @param {object} [opts.keyBackupInfo] The current key backup object. If passed,
   * the passphrase and recovery key from this backup will be used.
   * @param {boolean} [opts.setupNewKeyBackup] If true, a new key backup version will be
   * created and the private key stored in the new SSSS store. Ignored if keyBackupInfo
   * is supplied.
   * @param {boolean} [opts.setupNewSecretStorage] Optional. Reset even if keys already exist.
   * @param {func} [opts.getKeyBackupPassphrase] Optional. Function called to get the user's
   *     current key backup passphrase. Should return a promise that resolves with a Buffer
   *     containing the key, or rejects if the key cannot be obtained.
   * Returns:
   *     {Promise} A promise which resolves to key creation data for
   *     SecretStorage#addKey: an object with `passphrase` etc fields.
   */
  // TODO this does not resolve with what it says it does


  async bootstrapSecretStorage({
    createSecretStorageKey = async () => ({}),
    keyBackupInfo,
    setupNewKeyBackup,
    setupNewSecretStorage,
    getKeyBackupPassphrase
  } = {}) {
    _logger.logger.log("Bootstrapping Secure Secret Storage");

    const delegateCryptoCallbacks = this.baseApis.cryptoCallbacks;
    const builder = new _EncryptionSetup.EncryptionSetupBuilder(this.baseApis.store.accountData, delegateCryptoCallbacks);
    const secretStorage = new _SecretStorage.SecretStorage(builder.accountDataClientAdapter, builder.ssssCryptoCallbacks); // the ID of the new SSSS key, if we create one

    let newKeyId = null; // create a new SSSS key and set it as default

    const createSSSS = async (opts, privateKey) => {
      if (privateKey) {
        opts.key = privateKey;
      }

      const {
        keyId,
        keyInfo
      } = await secretStorage.addKey(_SecretStorage.SECRET_STORAGE_ALGORITHM_V1_AES, opts);

      if (privateKey) {
        // make the private key available to encrypt 4S secrets
        builder.ssssCryptoCallbacks.addPrivateKey(keyId, keyInfo, privateKey);
      }

      await secretStorage.setDefaultKeyId(keyId);
      return keyId;
    };

    const ensureCanCheckPassphrase = async (keyId, keyInfo) => {
      if (!keyInfo.mac) {
        const key = await this.baseApis.cryptoCallbacks.getSecretStorageKey({
          keys: {
            [keyId]: keyInfo
          }
        }, "");

        if (key) {
          const privateKey = key[1];
          builder.ssssCryptoCallbacks.addPrivateKey(keyId, keyInfo, privateKey);
          const {
            iv,
            mac
          } = await (0, _aes.calculateKeyCheck)(privateKey);
          keyInfo.iv = iv;
          keyInfo.mac = mac;
          await builder.setAccountData(`m.secret_storage.key.${keyId}`, keyInfo);
        }
      }
    };

    const signKeyBackupWithCrossSigning = async keyBackupAuthData => {
      if (this.crossSigningInfo.getId() && (await this.crossSigningInfo.isStoredInKeyCache("master"))) {
        try {
          _logger.logger.log("Adding cross-signing signature to key backup");

          await this.crossSigningInfo.signObject(keyBackupAuthData, "master");
        } catch (e) {
          // This step is not critical (just helpful), so we catch here
          // and continue if it fails.
          _logger.logger.error("Signing key backup with cross-signing keys failed", e);
        }
      } else {
        _logger.logger.warn("Cross-signing keys not available, skipping signature on key backup");
      }
    };

    const oldSSSSKey = await this.getSecretStorageKey();
    const [oldKeyId, oldKeyInfo] = oldSSSSKey || [null, null];
    const storageExists = !setupNewSecretStorage && oldKeyInfo && oldKeyInfo.algorithm === _SecretStorage.SECRET_STORAGE_ALGORITHM_V1_AES; // Log all relevant state for easier parsing of debug logs.

    _logger.logger.log({
      keyBackupInfo,
      setupNewKeyBackup,
      setupNewSecretStorage,
      storageExists,
      oldKeyInfo
    });

    if (!storageExists && !keyBackupInfo) {
      // either we don't have anything, or we've been asked to restart
      // from scratch
      _logger.logger.log("Secret storage does not exist, creating new storage key"); // if we already have a usable default SSSS key and aren't resetting
      // SSSS just use it. otherwise, create a new one
      // Note: we leave the old SSSS key in place: there could be other
      // secrets using it, in theory. We could move them to the new key but a)
      // that would mean we'd need to prompt for the old passphrase, and b)
      // it's not clear that would be the right thing to do anyway.


      const {
        keyInfo = {},
        privateKey
      } = await createSecretStorageKey();
      newKeyId = await createSSSS(keyInfo, privateKey);
    } else if (!storageExists && keyBackupInfo) {
      // we have an existing backup, but no SSSS
      _logger.logger.log("Secret storage does not exist, using key backup key"); // if we have the backup key already cached, use it; otherwise use the
      // callback to prompt for the key


      const backupKey = (await this.getSessionBackupPrivateKey()) || (await getKeyBackupPassphrase()); // create a new SSSS key and use the backup key as the new SSSS key

      const opts = {};

      if (keyBackupInfo.auth_data.private_key_salt && keyBackupInfo.auth_data.private_key_iterations) {
        // FIXME: ???
        opts.passphrase = {
          algorithm: "m.pbkdf2",
          iterations: keyBackupInfo.auth_data.private_key_iterations,
          salt: keyBackupInfo.auth_data.private_key_salt,
          bits: 256
        };
      }

      newKeyId = await createSSSS(opts, backupKey); // store the backup key in secret storage

      await secretStorage.store("m.megolm_backup.v1", olmlib.encodeBase64(backupKey), [newKeyId]); // The backup is trusted because the user provided the private key.
      // Sign the backup with the cross-signing key so the key backup can
      // be trusted via cross-signing.

      await signKeyBackupWithCrossSigning(keyBackupInfo.auth_data);
      builder.addSessionBackup(keyBackupInfo);
    } else {
      // 4S is already set up
      _logger.logger.log("Secret storage exists");

      if (oldKeyInfo && oldKeyInfo.algorithm === _SecretStorage.SECRET_STORAGE_ALGORITHM_V1_AES) {
        // make sure that the default key has the information needed to
        // check the passphrase
        await ensureCanCheckPassphrase(oldKeyId, oldKeyInfo);
      }
    } // If we have cross-signing private keys cached, store them in secret
    // storage if they are not there already.


    if (!this.baseApis.cryptoCallbacks.saveCrossSigningKeys && (await this.isCrossSigningReady()) && (newKeyId || !(await this.crossSigningInfo.isStoredInSecretStorage(secretStorage)))) {
      _logger.logger.log("Copying cross-signing private keys from cache to secret storage");

      const crossSigningPrivateKeys = await this.crossSigningInfo.getCrossSigningKeysFromCache(); // This is writing to in-memory account data in
      // builder.accountDataClientAdapter so won't fail

      await _CrossSigning.CrossSigningInfo.storeInSecretStorage(crossSigningPrivateKeys, secretStorage);
    }

    if (setupNewKeyBackup && !keyBackupInfo) {
      _logger.logger.log("Creating new message key backup version");

      const info = await this.baseApis.prepareKeyBackupVersion(null
      /* random key */
      , // don't write to secret storage, as it will write to this.secretStorage.
      // Here, we want to capture all the side-effects of bootstrapping,
      // and want to write to the local secretStorage object
      {
        secureSecretStorage: false
      }); // write the key ourselves to 4S

      const privateKey = (0, _recoverykey.decodeRecoveryKey)(info.recovery_key);
      await secretStorage.store("m.megolm_backup.v1", olmlib.encodeBase64(privateKey)); // create keyBackupInfo object to add to builder

      const data = {
        algorithm: info.algorithm,
        auth_data: info.auth_data
      }; // Sign with cross-signing master key

      await signKeyBackupWithCrossSigning(data.auth_data); // sign with the device fingerprint

      await this.signObject(data.auth_data);
      builder.addSessionBackup(data);
    } // Cache the session backup key


    const sessionBackupKey = await secretStorage.get('m.megolm_backup.v1');

    if (sessionBackupKey) {
      _logger.logger.info("Got session backup key from secret storage: caching"); // fix up the backup key if it's in the wrong format, and replace
      // in secret storage


      const fixedBackupKey = fixBackupKey(sessionBackupKey);

      if (fixedBackupKey) {
        await secretStorage.store("m.megolm_backup.v1", fixedBackupKey, [newKeyId || oldKeyId]);
      }

      const decodedBackupKey = new Uint8Array(olmlib.decodeBase64(fixedBackupKey || sessionBackupKey));
      builder.addSessionBackupPrivateKeyToCache(decodedBackupKey);
    } else if (this.backupManager.getKeyBackupEnabled()) {
      // key backup is enabled but we don't have a session backup key in SSSS: see if we have one in
      // the cache or the user can provide one, and if so, write it to SSSS
      const backupKey = (await this.getSessionBackupPrivateKey()) || (await getKeyBackupPassphrase());

      if (!backupKey) {
        // This will require user intervention to recover from since we don't have the key
        // backup key anywhere. The user should probably just set up a new key backup and
        // the key for the new backup will be stored. If we hit this scenario in the wild
        // with any frequency, we should do more than just log an error.
        _logger.logger.error("Key backup is enabled but couldn't get key backup key!");

        return;
      }

      _logger.logger.info("Got session backup key from cache/user that wasn't in SSSS: saving to SSSS");

      await secretStorage.store("m.megolm_backup.v1", olmlib.encodeBase64(backupKey));
    }

    const operation = builder.buildOperation();
    await operation.apply(this); // this persists private keys and public keys as trusted,
    // only do this if apply succeeded for now as retry isn't in place yet

    await builder.persist(this);

    _logger.logger.log("Secure Secret Storage ready");
  }

  addSecretStorageKey(algorithm, opts, keyID) {
    return this.secretStorage.addKey(algorithm, opts, keyID);
  }

  hasSecretStorageKey(keyID) {
    return this.secretStorage.hasKey(keyID);
  }

  getSecretStorageKey(keyID) {
    return this.secretStorage.getKey(keyID);
  }

  storeSecret(name, secret, keys) {
    return this.secretStorage.store(name, secret, keys);
  }

  getSecret(name) {
    return this.secretStorage.get(name);
  }

  isSecretStored(name) {
    return this.secretStorage.isStored(name);
  }

  requestSecret(name, devices) {
    if (!devices) {
      devices = Object.keys(this.deviceList.getRawStoredDevicesForUser(this.userId));
    }

    return this.secretStorage.request(name, devices);
  }

  getDefaultSecretStorageKeyId() {
    return this.secretStorage.getDefaultKeyId();
  }

  setDefaultSecretStorageKeyId(k) {
    return this.secretStorage.setDefaultKeyId(k);
  }

  checkSecretStorageKey(key, info) {
    return this.secretStorage.checkKey(key, info);
  }
  /**
   * Checks that a given secret storage private key matches a given public key.
   * This can be used by the getSecretStorageKey callback to verify that the
   * private key it is about to supply is the one that was requested.
   *
   * @param {Uint8Array} privateKey The private key
   * @param {string} expectedPublicKey The public key
   * @returns {boolean} true if the key matches, otherwise false
   */


  checkSecretStoragePrivateKey(privateKey, expectedPublicKey) {
    let decryption = null;

    try {
      decryption = new global.Olm.PkDecryption();
      const gotPubkey = decryption.init_with_private_key(privateKey); // make sure it agrees with the given pubkey

      return gotPubkey === expectedPublicKey;
    } finally {
      if (decryption) decryption.free();
    }
  }
  /**
   * Fetches the backup private key, if cached
   * @returns {Promise} the key, if any, or null
   */


  async getSessionBackupPrivateKey() {
    let key = await new Promise(resolve => {
      // TODO types
      this.cryptoStore.doTxn('readonly', [_indexeddbCryptoStore.IndexedDBCryptoStore.STORE_ACCOUNT], txn => {
        this.cryptoStore.getSecretStorePrivateKey(txn, resolve, "m.megolm_backup.v1");
      });
    }); // make sure we have a Uint8Array, rather than a string

    if (key && typeof key === "string") {
      key = new Uint8Array(olmlib.decodeBase64(fixBackupKey(key) || key));
      await this.storeSessionBackupPrivateKey(key);
    }

    if (key && key.ciphertext) {
      const pickleKey = Buffer.from(this.olmDevice.pickleKey);
      const decrypted = await (0, _aes.decryptAES)(key, pickleKey, "m.megolm_backup.v1");
      key = olmlib.decodeBase64(decrypted);
    }

    return key;
  }
  /**
   * Stores the session backup key to the cache
   * @param {Uint8Array} key the private key
   * @returns {Promise} so you can catch failures
   */


  async storeSessionBackupPrivateKey(key) {
    if (!(key instanceof Uint8Array)) {
      throw new Error(`storeSessionBackupPrivateKey expects Uint8Array, got ${key}`);
    }

    const pickleKey = Buffer.from(this.olmDevice.pickleKey);
    const encryptedKey = await (0, _aes.encryptAES)(olmlib.encodeBase64(key), pickleKey, "m.megolm_backup.v1");
    return this.cryptoStore.doTxn('readwrite', [_indexeddbCryptoStore.IndexedDBCryptoStore.STORE_ACCOUNT], txn => {
      this.cryptoStore.storeSecretStorePrivateKey(txn, "m.megolm_backup.v1", encryptedKey);
    });
  }
  /**
   * Checks that a given cross-signing private key matches a given public key.
   * This can be used by the getCrossSigningKey callback to verify that the
   * private key it is about to supply is the one that was requested.
   *
   * @param {Uint8Array} privateKey The private key
   * @param {string} expectedPublicKey The public key
   * @returns {boolean} true if the key matches, otherwise false
   */


  checkCrossSigningPrivateKey(privateKey, expectedPublicKey) {
    let signing = null;

    try {
      signing = new global.Olm.PkSigning();
      const gotPubkey = signing.init_with_seed(privateKey); // make sure it agrees with the given pubkey

      return gotPubkey === expectedPublicKey;
    } finally {
      if (signing) signing.free();
    }
  }
  /**
   * Run various follow-up actions after cross-signing keys have changed locally
   * (either by resetting the keys for the account or by getting them from secret
   * storage), such as signing the current device, upgrading device
   * verifications, etc.
   */


  async afterCrossSigningLocalKeyChange() {
    _logger.logger.info("Starting cross-signing key change post-processing"); // sign the current device with the new key, and upload to the server


    const device = this.deviceList.getStoredDevice(this.userId, this.deviceId);
    const signedDevice = await this.crossSigningInfo.signDevice(this.userId, device);

    _logger.logger.info(`Starting background key sig upload for ${this.deviceId}`);

    const upload = ({
      shouldEmit = false
    }) => {
      return this.baseApis.uploadKeySignatures({
        [this.userId]: {
          [this.deviceId]: signedDevice
        }
      }).then(response => {
        const {
          failures
        } = response || {};

        if (Object.keys(failures || []).length > 0) {
          if (shouldEmit) {
            this.baseApis.emit(CryptoEvent.KeySignatureUploadFailure, failures, "afterCrossSigningLocalKeyChange", upload // continuation
            );
          }

          throw new _errors.KeySignatureUploadError("Key upload failed", {
            failures
          });
        }

        _logger.logger.info(`Finished background key sig upload for ${this.deviceId}`);
      }).catch(e => {
        _logger.logger.error(`Error during background key sig upload for ${this.deviceId}`, e);
      });
    };

    upload({
      shouldEmit: true
    });
    const shouldUpgradeCb = this.baseApis.cryptoCallbacks.shouldUpgradeDeviceVerifications;

    if (shouldUpgradeCb) {
      _logger.logger.info("Starting device verification upgrade"); // Check all users for signatures if upgrade callback present
      // FIXME: do this in batches


      const users = {};

      for (const [userId, crossSigningInfo] of Object.entries(this.deviceList.crossSigningInfo)) {
        const upgradeInfo = await this.checkForDeviceVerificationUpgrade(userId, _CrossSigning.CrossSigningInfo.fromStorage(crossSigningInfo, userId));

        if (upgradeInfo) {
          users[userId] = upgradeInfo;
        }
      }

      if (Object.keys(users).length > 0) {
        _logger.logger.info(`Found ${Object.keys(users).length} verif users to upgrade`);

        try {
          const usersToUpgrade = await shouldUpgradeCb({
            users: users
          });

          if (usersToUpgrade) {
            for (const userId of usersToUpgrade) {
              if (userId in users) {
                await this.baseApis.setDeviceVerified(userId, users[userId].crossSigningInfo.getId());
              }
            }
          }
        } catch (e) {
          _logger.logger.log("shouldUpgradeDeviceVerifications threw an error: not upgrading", e);
        }
      }

      _logger.logger.info("Finished device verification upgrade");
    }

    _logger.logger.info("Finished cross-signing key change post-processing");
  }
  /**
   * Check if a user's cross-signing key is a candidate for upgrading from device
   * verification.
   *
   * @param {string} userId the user whose cross-signing information is to be checked
   * @param {object} crossSigningInfo the cross-signing information to check
   */


  async checkForDeviceVerificationUpgrade(userId, crossSigningInfo) {
    // only upgrade if this is the first cross-signing key that we've seen for
    // them, and if their cross-signing key isn't already verified
    const trustLevel = this.crossSigningInfo.checkUserTrust(crossSigningInfo);

    if (crossSigningInfo.firstUse && !trustLevel.isVerified()) {
      const devices = this.deviceList.getRawStoredDevicesForUser(userId);
      const deviceIds = await this.checkForValidDeviceSignature(userId, crossSigningInfo.keys.master, devices);

      if (deviceIds.length) {
        return {
          devices: deviceIds.map(deviceId => _deviceinfo.DeviceInfo.fromStorage(devices[deviceId], deviceId)),
          crossSigningInfo
        };
      }
    }
  }
  /**
   * Check if the cross-signing key is signed by a verified device.
   *
   * @param {string} userId the user ID whose key is being checked
   * @param {object} key the key that is being checked
   * @param {object} devices the user's devices.  Should be a map from device ID
   *     to device info
   */


  async checkForValidDeviceSignature(userId, key, devices) {
    const deviceIds = [];

    if (devices && key.signatures && key.signatures[userId]) {
      for (const signame of Object.keys(key.signatures[userId])) {
        const [, deviceId] = signame.split(':', 2);

        if (deviceId in devices && devices[deviceId].verified === DeviceVerification.VERIFIED) {
          try {
            await olmlib.verifySignature(this.olmDevice, key, userId, deviceId, devices[deviceId].keys[signame]);
            deviceIds.push(deviceId);
          } catch (e) {}
        }
      }
    }

    return deviceIds;
  }
  /**
   * Get the user's cross-signing key ID.
   *
   * @param {string} [type=master] The type of key to get the ID of.  One of
   *     "master", "self_signing", or "user_signing".  Defaults to "master".
   *
   * @returns {string} the key ID
   */


  getCrossSigningId(type) {
    return this.crossSigningInfo.getId(type);
  }
  /**
   * Get the cross signing information for a given user.
   *
   * @param {string} userId the user ID to get the cross-signing info for.
   *
   * @returns {CrossSigningInfo} the cross signing information for the user.
   */


  getStoredCrossSigningForUser(userId) {
    return this.deviceList.getStoredCrossSigningForUser(userId);
  }
  /**
   * Check whether a given user is trusted.
   *
   * @param {string} userId The ID of the user to check.
   *
   * @returns {UserTrustLevel}
   */


  checkUserTrust(userId) {
    const userCrossSigning = this.deviceList.getStoredCrossSigningForUser(userId);

    if (!userCrossSigning) {
      return new _CrossSigning.UserTrustLevel(false, false, false);
    }

    return this.crossSigningInfo.checkUserTrust(userCrossSigning);
  }
  /**
   * Check whether a given device is trusted.
   *
   * @param {string} userId The ID of the user whose devices is to be checked.
   * @param {string} deviceId The ID of the device to check
   *
   * @returns {DeviceTrustLevel}
   */


  checkDeviceTrust(userId, deviceId) {
    const device = this.deviceList.getStoredDevice(userId, deviceId);
    return this.checkDeviceInfoTrust(userId, device);
  }
  /**
   * Check whether a given deviceinfo is trusted.
   *
   * @param {string} userId The ID of the user whose devices is to be checked.
   * @param {module:crypto/deviceinfo?} device The device info object to check
   *
   * @returns {DeviceTrustLevel}
   */


  checkDeviceInfoTrust(userId, device) {
    const trustedLocally = !!(device && device.isVerified());
    const userCrossSigning = this.deviceList.getStoredCrossSigningForUser(userId);

    if (device && userCrossSigning) {
      // The trustCrossSignedDevices only affects trust of other people's cross-signing
      // signatures
      const trustCrossSig = this.trustCrossSignedDevices || userId === this.userId;
      return this.crossSigningInfo.checkDeviceTrust(userCrossSigning, device, trustedLocally, trustCrossSig);
    } else {
      return new _CrossSigning.DeviceTrustLevel(false, false, trustedLocally, false);
    }
  }
  /**
   * Check whether one of our own devices is cross-signed by our
   * user's stored keys, regardless of whether we trust those keys yet.
   *
   * @param {string} deviceId The ID of the device to check
   *
   * @returns {boolean} true if the device is cross-signed
   */


  checkIfOwnDeviceCrossSigned(deviceId) {
    const device = this.deviceList.getStoredDevice(this.userId, deviceId);
    const userCrossSigning = this.deviceList.getStoredCrossSigningForUser(this.userId);
    return userCrossSigning.checkDeviceTrust(userCrossSigning, device, false, true).isCrossSigningVerified();
  }
  /*
   * Event handler for DeviceList's userNewDevices event
   */


  /**
   * Check the copy of our cross-signing key that we have in the device list and
   * see if we can get the private key. If so, mark it as trusted.
   */
  async checkOwnCrossSigningTrust({
    allowPrivateKeyRequests = false
  } = {}) {
    const userId = this.userId; // Before proceeding, ensure our cross-signing public keys have been
    // downloaded via the device list.

    await this.downloadKeys([this.userId]); // Also check which private keys are locally cached.

    const crossSigningPrivateKeys = await this.crossSigningInfo.getCrossSigningKeysFromCache(); // If we see an update to our own master key, check it against the master
    // key we have and, if it matches, mark it as verified
    // First, get the new cross-signing info

    const newCrossSigning = this.deviceList.getStoredCrossSigningForUser(userId);

    if (!newCrossSigning) {
      _logger.logger.error("Got cross-signing update event for user " + userId + " but no new cross-signing information found!");

      return;
    }

    const seenPubkey = newCrossSigning.getId();
    const masterChanged = this.crossSigningInfo.getId() !== seenPubkey;
    const masterExistsNotLocallyCached = newCrossSigning.getId() && !crossSigningPrivateKeys.has("master");

    if (masterChanged) {
      _logger.logger.info("Got new master public key", seenPubkey);
    }

    if (allowPrivateKeyRequests && (masterChanged || masterExistsNotLocallyCached)) {
      _logger.logger.info("Attempting to retrieve cross-signing master private key");

      let signing = null; // It's important for control flow that we leave any errors alone for
      // higher levels to handle so that e.g. cancelling access properly
      // aborts any larger operation as well.

      try {
        const ret = await this.crossSigningInfo.getCrossSigningKey('master', seenPubkey);
        signing = ret[1];

        _logger.logger.info("Got cross-signing master private key");
      } finally {
        if (signing) signing.free();
      }
    }

    const oldSelfSigningId = this.crossSigningInfo.getId("self_signing");
    const oldUserSigningId = this.crossSigningInfo.getId("user_signing"); // Update the version of our keys in our cross-signing object and the local store

    this.storeTrustedSelfKeys(newCrossSigning.keys);
    const selfSigningChanged = oldSelfSigningId !== newCrossSigning.getId("self_signing");
    const userSigningChanged = oldUserSigningId !== newCrossSigning.getId("user_signing");
    const selfSigningExistsNotLocallyCached = newCrossSigning.getId("self_signing") && !crossSigningPrivateKeys.has("self_signing");
    const userSigningExistsNotLocallyCached = newCrossSigning.getId("user_signing") && !crossSigningPrivateKeys.has("user_signing");
    const keySignatures = {};

    if (selfSigningChanged) {
      _logger.logger.info("Got new self-signing key", newCrossSigning.getId("self_signing"));
    }

    if (allowPrivateKeyRequests && (selfSigningChanged || selfSigningExistsNotLocallyCached)) {
      _logger.logger.info("Attempting to retrieve cross-signing self-signing private key");

      let signing = null;

      try {
        const ret = await this.crossSigningInfo.getCrossSigningKey("self_signing", newCrossSigning.getId("self_signing"));
        signing = ret[1];

        _logger.logger.info("Got cross-signing self-signing private key");
      } finally {
        if (signing) signing.free();
      }

      const device = this.deviceList.getStoredDevice(this.userId, this.deviceId);
      const signedDevice = await this.crossSigningInfo.signDevice(this.userId, device);
      keySignatures[this.deviceId] = signedDevice;
    }

    if (userSigningChanged) {
      _logger.logger.info("Got new user-signing key", newCrossSigning.getId("user_signing"));
    }

    if (allowPrivateKeyRequests && (userSigningChanged || userSigningExistsNotLocallyCached)) {
      _logger.logger.info("Attempting to retrieve cross-signing user-signing private key");

      let signing = null;

      try {
        const ret = await this.crossSigningInfo.getCrossSigningKey("user_signing", newCrossSigning.getId("user_signing"));
        signing = ret[1];

        _logger.logger.info("Got cross-signing user-signing private key");
      } finally {
        if (signing) signing.free();
      }
    }

    if (masterChanged) {
      const masterKey = this.crossSigningInfo.keys.master;
      await this.signObject(masterKey);
      const deviceSig = masterKey.signatures[this.userId]["ed25519:" + this.deviceId]; // Include only the _new_ device signature in the upload.
      // We may have existing signatures from deleted devices, which will cause
      // the entire upload to fail.

      keySignatures[this.crossSigningInfo.getId()] = Object.assign({}, masterKey, {
        signatures: {
          [this.userId]: {
            ["ed25519:" + this.deviceId]: deviceSig
          }
        }
      });
    }

    const keysToUpload = Object.keys(keySignatures);

    if (keysToUpload.length) {
      const upload = ({
        shouldEmit = false
      }) => {
        _logger.logger.info(`Starting background key sig upload for ${keysToUpload}`);

        return this.baseApis.uploadKeySignatures({
          [this.userId]: keySignatures
        }).then(response => {
          const {
            failures
          } = response || {};

          _logger.logger.info(`Finished background key sig upload for ${keysToUpload}`);

          if (Object.keys(failures || []).length > 0) {
            if (shouldEmit) {
              this.baseApis.emit(CryptoEvent.KeySignatureUploadFailure, failures, "checkOwnCrossSigningTrust", upload);
            }

            throw new _errors.KeySignatureUploadError("Key upload failed", {
              failures
            });
          }
        }).catch(e => {
          _logger.logger.error(`Error during background key sig upload for ${keysToUpload}`, e);
        });
      };

      upload({
        shouldEmit: true
      });
    }

    this.emit(CryptoEvent.UserTrustStatusChanged, userId, this.checkUserTrust(userId));

    if (masterChanged) {
      this.emit(CryptoEvent.KeysChanged, {});
      await this.afterCrossSigningLocalKeyChange();
    } // Now we may be able to trust our key backup


    await this.backupManager.checkKeyBackup(); // FIXME: if we previously trusted the backup, should we automatically sign
    // the backup with the new key (if not already signed)?
  }
  /**
   * Store a set of keys as our own, trusted, cross-signing keys.
   *
   * @param {object} keys The new trusted set of keys
   */


  async storeTrustedSelfKeys(keys) {
    if (keys) {
      this.crossSigningInfo.setKeys(keys);
    } else {
      this.crossSigningInfo.clearKeys();
    }

    await this.cryptoStore.doTxn('readwrite', [_indexeddbCryptoStore.IndexedDBCryptoStore.STORE_ACCOUNT], txn => {
      this.cryptoStore.storeCrossSigningKeys(txn, this.crossSigningInfo.keys);
    });
  }
  /**
   * Check if the master key is signed by a verified device, and if so, prompt
   * the application to mark it as verified.
   *
   * @param {string} userId the user ID whose key should be checked
   */


  async checkDeviceVerifications(userId) {
    const shouldUpgradeCb = this.baseApis.cryptoCallbacks.shouldUpgradeDeviceVerifications;

    if (!shouldUpgradeCb) {
      // Upgrading skipped when callback is not present.
      return;
    }

    _logger.logger.info(`Starting device verification upgrade for ${userId}`);

    if (this.crossSigningInfo.keys.user_signing) {
      const crossSigningInfo = this.deviceList.getStoredCrossSigningForUser(userId);

      if (crossSigningInfo) {
        const upgradeInfo = await this.checkForDeviceVerificationUpgrade(userId, crossSigningInfo);

        if (upgradeInfo) {
          const usersToUpgrade = await shouldUpgradeCb({
            users: {
              [userId]: upgradeInfo
            }
          });

          if (usersToUpgrade.includes(userId)) {
            await this.baseApis.setDeviceVerified(userId, crossSigningInfo.getId());
          }
        }
      }
    }

    _logger.logger.info(`Finished device verification upgrade for ${userId}`);
  }
  /**
   */


  enableLazyLoading() {
    this.lazyLoadMembers = true;
  }
  /**
   * Tell the crypto module to register for MatrixClient events which it needs to
   * listen for
   *
   * @param {external:EventEmitter} eventEmitter event source where we can register
   *    for event notifications
   */


  registerEventHandlers(eventEmitter) {
    eventEmitter.on(_roomMember.RoomMemberEvent.Membership, this.onMembership);
    eventEmitter.on(_client.ClientEvent.ToDeviceEvent, this.onToDeviceEvent);
    eventEmitter.on(_room.RoomEvent.Timeline, this.onTimelineEvent);
    eventEmitter.on(_event2.MatrixEventEvent.Decrypted, this.onTimelineEvent);
  }
  /** Start background processes related to crypto */


  start() {
    this.outgoingRoomKeyRequestManager.start();
  }
  /** Stop background processes related to crypto */


  stop() {
    this.outgoingRoomKeyRequestManager.stop();
    this.deviceList.stop();
    this.dehydrationManager.stop();
  }
  /**
   * Get the Ed25519 key for this device
   *
   * @return {string} base64-encoded ed25519 key.
   */


  getDeviceEd25519Key() {
    return this.olmDevice.deviceEd25519Key;
  }
  /**
   * Get the Curve25519 key for this device
   *
   * @return {string} base64-encoded curve25519 key.
   */


  getDeviceCurve25519Key() {
    return this.olmDevice.deviceCurve25519Key;
  }
  /**
   * Set the global override for whether the client should ever send encrypted
   * messages to unverified devices.  This provides the default for rooms which
   * do not specify a value.
   *
   * @param {boolean} value whether to blacklist all unverified devices by default
   */


  setGlobalBlacklistUnverifiedDevices(value) {
    this.globalBlacklistUnverifiedDevices = value;
  }
  /**
   * @return {boolean} whether to blacklist all unverified devices by default
   */


  getGlobalBlacklistUnverifiedDevices() {
    return this.globalBlacklistUnverifiedDevices;
  }
  /**
   * Set whether sendMessage in a room with unknown and unverified devices
   * should throw an error and not send them message. This has 'Global' for
   * symmetry with setGlobalBlacklistUnverifiedDevices but there is currently
   * no room-level equivalent for this setting.
   *
   * This API is currently UNSTABLE and may change or be removed without notice.
   *
   * @param {boolean} value whether error on unknown devices
   */


  setGlobalErrorOnUnknownDevices(value) {
    this.globalErrorOnUnknownDevices = value;
  }
  /**
   * @return {boolean} whether to error on unknown devices
   *
   * This API is currently UNSTABLE and may change or be removed without notice.
   */


  getGlobalErrorOnUnknownDevices() {
    return this.globalErrorOnUnknownDevices;
  }
  /**
   * Upload the device keys to the homeserver.
   * @return {object} A promise that will resolve when the keys are uploaded.
   */


  uploadDeviceKeys() {
    const deviceKeys = {
      algorithms: this.supportedAlgorithms,
      device_id: this.deviceId,
      keys: this.deviceKeys,
      user_id: this.userId
    };
    return this.signObject(deviceKeys).then(() => {
      return this.baseApis.uploadKeysRequest({
        device_keys: deviceKeys
      });
    });
  }
  /**
   * Stores the current one_time_key count which will be handled later (in a call of
   * onSyncCompleted). The count is e.g. coming from a /sync response.
   *
   * @param {Number} currentCount The current count of one_time_keys to be stored
   */


  updateOneTimeKeyCount(currentCount) {
    if (isFinite(currentCount)) {
      this.oneTimeKeyCount = currentCount;
    } else {
      throw new TypeError("Parameter for updateOneTimeKeyCount has to be a number");
    }
  }

  setNeedsNewFallback(needsNewFallback) {
    this.needsNewFallback = !!needsNewFallback;
  }

  getNeedsNewFallback() {
    return this.needsNewFallback;
  } // check if it's time to upload one-time keys, and do so if so.


  maybeUploadOneTimeKeys() {
    // frequency with which to check & upload one-time keys
    const uploadPeriod = 1000 * 60; // one minute
    // max number of keys to upload at once
    // Creating keys can be an expensive operation so we limit the
    // number we generate in one go to avoid blocking the application
    // for too long.

    const maxKeysPerCycle = 5;

    if (this.oneTimeKeyCheckInProgress) {
      return;
    }

    const now = Date.now();

    if (this.lastOneTimeKeyCheck !== null && now - this.lastOneTimeKeyCheck < uploadPeriod) {
      // we've done a key upload recently.
      return;
    }

    this.lastOneTimeKeyCheck = now; // We need to keep a pool of one time public keys on the server so that
    // other devices can start conversations with us. But we can only store
    // a finite number of private keys in the olm Account object.
    // To complicate things further then can be a delay between a device
    // claiming a public one time key from the server and it sending us a
    // message. We need to keep the corresponding private key locally until
    // we receive the message.
    // But that message might never arrive leaving us stuck with duff
    // private keys clogging up our local storage.
    // So we need some kind of engineering compromise to balance all of
    // these factors.
    // Check how many keys we can store in the Account object.

    const maxOneTimeKeys = this.olmDevice.maxNumberOfOneTimeKeys(); // Try to keep at most half that number on the server. This leaves the
    // rest of the slots free to hold keys that have been claimed from the
    // server but we haven't received a message for.
    // If we run out of slots when generating new keys then olm will
    // discard the oldest private keys first. This will eventually clean
    // out stale private keys that won't receive a message.

    const keyLimit = Math.floor(maxOneTimeKeys / 2);

    const uploadLoop = async keyCount => {
      while (keyLimit > keyCount || this.getNeedsNewFallback()) {
        // Ask olm to generate new one time keys, then upload them to synapse.
        if (keyLimit > keyCount) {
          _logger.logger.info("generating oneTimeKeys");

          const keysThisLoop = Math.min(keyLimit - keyCount, maxKeysPerCycle);
          await this.olmDevice.generateOneTimeKeys(keysThisLoop);
        }

        if (this.getNeedsNewFallback()) {
          const fallbackKeys = await this.olmDevice.getFallbackKey(); // if fallbackKeys is non-empty, we've already generated a
          // fallback key, but it hasn't been published yet, so we
          // can use that instead of generating a new one

          if (!fallbackKeys.curve25519 || Object.keys(fallbackKeys.curve25519).length == 0) {
            _logger.logger.info("generating fallback key");

            if (this.fallbackCleanup) {
              // cancel any pending fallback cleanup because generating
              // a new fallback key will already drop the old fallback
              // that would have been dropped, and we don't want to kill
              // the current key
              clearTimeout(this.fallbackCleanup);
              delete this.fallbackCleanup;
            }

            await this.olmDevice.generateFallbackKey();
          }
        }

        _logger.logger.info("calling uploadOneTimeKeys");

        const res = await this.uploadOneTimeKeys();

        if (res.one_time_key_counts && res.one_time_key_counts.signed_curve25519) {
          // if the response contains a more up to date value use this
          // for the next loop
          keyCount = res.one_time_key_counts.signed_curve25519;
        } else {
          throw new Error("response for uploading keys does not contain " + "one_time_key_counts.signed_curve25519");
        }
      }
    };

    this.oneTimeKeyCheckInProgress = true;
    Promise.resolve().then(() => {
      if (this.oneTimeKeyCount !== undefined) {
        // We already have the current one_time_key count from a /sync response.
        // Use this value instead of asking the server for the current key count.
        return Promise.resolve(this.oneTimeKeyCount);
      } // ask the server how many keys we have


      return this.baseApis.uploadKeysRequest({}).then(res => {
        return res.one_time_key_counts.signed_curve25519 || 0;
      });
    }).then(keyCount => {
      // Start the uploadLoop with the current keyCount. The function checks if
      // we need to upload new keys or not.
      // If there are too many keys on the server then we don't need to
      // create any more keys.
      return uploadLoop(keyCount);
    }).catch(e => {
      _logger.logger.error("Error uploading one-time keys", e.stack || e);
    }).finally(() => {
      // reset oneTimeKeyCount to prevent start uploading based on old data.
      // it will be set again on the next /sync-response
      this.oneTimeKeyCount = undefined;
      this.oneTimeKeyCheckInProgress = false;
    });
  } // returns a promise which resolves to the response


  async uploadOneTimeKeys() {
    const promises = [];
    let fallbackJson;

    if (this.getNeedsNewFallback()) {
      fallbackJson = {};
      const fallbackKeys = await this.olmDevice.getFallbackKey();

      for (const [keyId, key] of Object.entries(fallbackKeys.curve25519)) {
        const k = {
          key,
          fallback: true
        };
        fallbackJson["signed_curve25519:" + keyId] = k;
        promises.push(this.signObject(k));
      }

      this.setNeedsNewFallback(false);
    }

    const oneTimeKeys = await this.olmDevice.getOneTimeKeys();
    const oneTimeJson = {};

    for (const keyId in oneTimeKeys.curve25519) {
      if (oneTimeKeys.curve25519.hasOwnProperty(keyId)) {
        const k = {
          key: oneTimeKeys.curve25519[keyId]
        };
        oneTimeJson["signed_curve25519:" + keyId] = k;
        promises.push(this.signObject(k));
      }
    }

    await Promise.all(promises);
    const requestBody = {
      "one_time_keys": oneTimeJson
    };

    if (fallbackJson) {
      requestBody["org.matrix.msc2732.fallback_keys"] = fallbackJson;
      requestBody["fallback_keys"] = fallbackJson;
    }

    const res = await this.baseApis.uploadKeysRequest(requestBody);

    if (fallbackJson) {
      this.fallbackCleanup = setTimeout(() => {
        delete this.fallbackCleanup;
        this.olmDevice.forgetOldFallbackKey();
      }, 60 * 60 * 1000);
    }

    await this.olmDevice.markKeysAsPublished();
    return res;
  }
  /**
   * Download the keys for a list of users and stores the keys in the session
   * store.
   * @param {Array} userIds The users to fetch.
   * @param {boolean} forceDownload Always download the keys even if cached.
   *
   * @return {Promise} A promise which resolves to a map userId->deviceId->{@link
      * module:crypto/deviceinfo|DeviceInfo}.
   */


  downloadKeys(userIds, forceDownload) {
    return this.deviceList.downloadKeys(userIds, forceDownload);
  }
  /**
   * Get the stored device keys for a user id
   *
   * @param {string} userId the user to list keys for.
   *
   * @return {module:crypto/deviceinfo[]|null} list of devices, or null if we haven't
   * managed to get a list of devices for this user yet.
   */


  getStoredDevicesForUser(userId) {
    return this.deviceList.getStoredDevicesForUser(userId);
  }
  /**
   * Get the stored keys for a single device
   *
   * @param {string} userId
   * @param {string} deviceId
   *
   * @return {module:crypto/deviceinfo?} device, or undefined
   * if we don't know about this device
   */


  getStoredDevice(userId, deviceId) {
    return this.deviceList.getStoredDevice(userId, deviceId);
  }
  /**
   * Save the device list, if necessary
   *
   * @param {number} delay Time in ms before which the save actually happens.
   *     By default, the save is delayed for a short period in order to batch
   *     multiple writes, but this behaviour can be disabled by passing 0.
   *
   * @return {Promise<boolean>} true if the data was saved, false if
   *     it was not (eg. because no changes were pending). The promise
   *     will only resolve once the data is saved, so may take some time
   *     to resolve.
   */


  saveDeviceList(delay) {
    return this.deviceList.saveIfDirty(delay);
  }
  /**
   * Update the blocked/verified state of the given device
   *
   * @param {string} userId owner of the device
   * @param {string} deviceId unique identifier for the device or user's
   * cross-signing public key ID.
   *
   * @param {?boolean} verified whether to mark the device as verified. Null to
   *     leave unchanged.
   *
   * @param {?boolean} blocked whether to mark the device as blocked. Null to
   *      leave unchanged.
   *
   * @param {?boolean} known whether to mark that the user has been made aware of
   *      the existence of this device. Null to leave unchanged
   *
   * @param {?Record<string, any>} keys The list of keys that was present
   * during the device verification. This will be double checked with the list
   * of keys the given device has currently.
   *
   * @return {Promise<module:crypto/deviceinfo>} updated DeviceInfo
   */


  async setDeviceVerification(userId, deviceId, verified, blocked, known, keys) {
    // get rid of any `undefined`s here so we can just check
    // for null rather than null or undefined
    if (verified === undefined) verified = null;
    if (blocked === undefined) blocked = null;
    if (known === undefined) known = null; // Check if the 'device' is actually a cross signing key
    // The js-sdk's verification treats cross-signing keys as devices
    // and so uses this method to mark them verified.

    const xsk = this.deviceList.getStoredCrossSigningForUser(userId);

    if (xsk && xsk.getId() === deviceId) {
      if (blocked !== null || known !== null) {
        throw new Error("Cannot set blocked or known for a cross-signing key");
      }

      if (!verified) {
        throw new Error("Cannot set a cross-signing key as unverified");
      }

      const gotKeyId = keys ? Object.values(keys)[0] : null;

      if (keys && (Object.values(keys).length !== 1 || gotKeyId !== xsk.getId())) {
        throw new Error(`Key did not match expected value: expected ${xsk.getId()}, got ${gotKeyId}`);
      }

      if (!this.crossSigningInfo.getId() && userId === this.crossSigningInfo.userId) {
        this.storeTrustedSelfKeys(xsk.keys); // This will cause our own user trust to change, so emit the event

        this.emit(CryptoEvent.UserTrustStatusChanged, this.userId, this.checkUserTrust(userId));
      } // Now sign the master key with our user signing key (unless it's ourself)


      if (userId !== this.userId) {
        _logger.logger.info("Master key " + xsk.getId() + " for " + userId + " marked verified. Signing...");

        const device = await this.crossSigningInfo.signUser(xsk);

        if (device) {
          const upload = async ({
            shouldEmit = false
          }) => {
            _logger.logger.info("Uploading signature for " + userId + "...");

            const response = await this.baseApis.uploadKeySignatures({
              [userId]: {
                [deviceId]: device
              }
            });
            const {
              failures
            } = response || {};

            if (Object.keys(failures || []).length > 0) {
              if (shouldEmit) {
                this.baseApis.emit(CryptoEvent.KeySignatureUploadFailure, failures, "setDeviceVerification", upload);
              }
              /* Throwing here causes the process to be cancelled and the other
              * user to be notified */


              throw new _errors.KeySignatureUploadError("Key upload failed", {
                failures
              });
            }
          };

          await upload({
            shouldEmit: true
          }); // This will emit events when it comes back down the sync
          // (we could do local echo to speed things up)
        }

        return device; // TODO types
      } else {
        return xsk;
      }
    }

    const devices = this.deviceList.getRawStoredDevicesForUser(userId);

    if (!devices || !devices[deviceId]) {
      throw new Error("Unknown device " + userId + ":" + deviceId);
    }

    const dev = devices[deviceId];
    let verificationStatus = dev.verified;

    if (verified) {
      if (keys) {
        for (const [keyId, key] of Object.entries(keys)) {
          if (dev.keys[keyId] !== key) {
            throw new Error(`Key did not match expected value: expected ${key}, got ${dev.keys[keyId]}`);
          }
        }
      }

      verificationStatus = DeviceVerification.VERIFIED;
    } else if (verified !== null && verificationStatus == DeviceVerification.VERIFIED) {
      verificationStatus = DeviceVerification.UNVERIFIED;
    }

    if (blocked) {
      verificationStatus = DeviceVerification.BLOCKED;
    } else if (blocked !== null && verificationStatus == DeviceVerification.BLOCKED) {
      verificationStatus = DeviceVerification.UNVERIFIED;
    }

    let knownStatus = dev.known;

    if (known !== null) {
      knownStatus = known;
    }

    if (dev.verified !== verificationStatus || dev.known !== knownStatus) {
      dev.verified = verificationStatus;
      dev.known = knownStatus;
      this.deviceList.storeDevicesForUser(userId, devices);
      this.deviceList.saveIfDirty();
    } // do cross-signing


    if (verified && userId === this.userId) {
      _logger.logger.info("Own device " + deviceId + " marked verified: signing"); // Signing only needed if other device not already signed


      let device;
      const deviceTrust = this.checkDeviceTrust(userId, deviceId);

      if (deviceTrust.isCrossSigningVerified()) {
        _logger.logger.log(`Own device ${deviceId} already cross-signing verified`);
      } else {
        device = await this.crossSigningInfo.signDevice(userId, _deviceinfo.DeviceInfo.fromStorage(dev, deviceId));
      }

      if (device) {
        const upload = async ({
          shouldEmit = false
        }) => {
          _logger.logger.info("Uploading signature for " + deviceId);

          const response = await this.baseApis.uploadKeySignatures({
            [userId]: {
              [deviceId]: device
            }
          });
          const {
            failures
          } = response || {};

          if (Object.keys(failures || []).length > 0) {
            if (shouldEmit) {
              this.baseApis.emit(CryptoEvent.KeySignatureUploadFailure, failures, "setDeviceVerification", upload // continuation
              );
            }

            throw new _errors.KeySignatureUploadError("Key upload failed", {
              failures
            });
          }
        };

        await upload({
          shouldEmit: true
        }); // XXX: we'll need to wait for the device list to be updated
      }
    }

    const deviceObj = _deviceinfo.DeviceInfo.fromStorage(dev, deviceId);

    this.emit(CryptoEvent.DeviceVerificationChanged, userId, deviceId, deviceObj);
    return deviceObj;
  }

  findVerificationRequestDMInProgress(roomId) {
    return this.inRoomVerificationRequests.findRequestInProgress(roomId);
  }

  getVerificationRequestsToDeviceInProgress(userId) {
    return this.toDeviceVerificationRequests.getRequestsInProgress(userId);
  }

  requestVerificationDM(userId, roomId) {
    const existingRequest = this.inRoomVerificationRequests.findRequestInProgress(roomId);

    if (existingRequest) {
      return Promise.resolve(existingRequest);
    }

    const channel = new _InRoomChannel.InRoomChannel(this.baseApis, roomId, userId);
    return this.requestVerificationWithChannel(userId, channel, this.inRoomVerificationRequests);
  }

  requestVerification(userId, devices) {
    if (!devices) {
      devices = Object.keys(this.deviceList.getRawStoredDevicesForUser(userId));
    }

    const existingRequest = this.toDeviceVerificationRequests.findRequestInProgress(userId, devices);

    if (existingRequest) {
      return Promise.resolve(existingRequest);
    }

    const channel = new _ToDeviceChannel.ToDeviceChannel(this.baseApis, userId, devices, _ToDeviceChannel.ToDeviceChannel.makeTransactionId());
    return this.requestVerificationWithChannel(userId, channel, this.toDeviceVerificationRequests);
  }

  async requestVerificationWithChannel(userId, channel, requestsMap) {
    let request = new _VerificationRequest.VerificationRequest(channel, this.verificationMethods, this.baseApis); // if transaction id is already known, add request

    if (channel.transactionId) {
      requestsMap.setRequestByChannel(channel, request);
    }

    await request.sendRequest(); // don't replace the request created by a racing remote echo

    const racingRequest = requestsMap.getRequestByChannel(channel);

    if (racingRequest) {
      request = racingRequest;
    } else {
      _logger.logger.log(`Crypto: adding new request to ` + `requestsByTxnId with id ${channel.transactionId} ${channel.roomId}`);

      requestsMap.setRequestByChannel(channel, request);
    }

    return request;
  }

  beginKeyVerification(method, userId, deviceId, transactionId = null) {
    let request;

    if (transactionId) {
      request = this.toDeviceVerificationRequests.getRequestBySenderAndTxnId(userId, transactionId);

      if (!request) {
        throw new Error(`No request found for user ${userId} with ` + `transactionId ${transactionId}`);
      }
    } else {
      transactionId = _ToDeviceChannel.ToDeviceChannel.makeTransactionId();
      const channel = new _ToDeviceChannel.ToDeviceChannel(this.baseApis, userId, [deviceId], transactionId, deviceId);
      request = new _VerificationRequest.VerificationRequest(channel, this.verificationMethods, this.baseApis);
      this.toDeviceVerificationRequests.setRequestBySenderAndTxnId(userId, transactionId, request);
    }

    return request.beginKeyVerification(method, {
      userId,
      deviceId
    });
  }

  async legacyDeviceVerification(userId, deviceId, method) {
    const transactionId = _ToDeviceChannel.ToDeviceChannel.makeTransactionId();

    const channel = new _ToDeviceChannel.ToDeviceChannel(this.baseApis, userId, [deviceId], transactionId, deviceId);
    const request = new _VerificationRequest.VerificationRequest(channel, this.verificationMethods, this.baseApis);
    this.toDeviceVerificationRequests.setRequestBySenderAndTxnId(userId, transactionId, request);
    const verifier = request.beginKeyVerification(method, {
      userId,
      deviceId
    }); // either reject by an error from verify() while sending .start
    // or resolve when the request receives the
    // local (fake remote) echo for sending the .start event

    await Promise.race([verifier.verify(), request.waitFor(r => r.started)]);
    return request;
  }
  /**
   * Get information on the active olm sessions with a user
   * <p>
   * Returns a map from device id to an object with keys 'deviceIdKey' (the
   * device's curve25519 identity key) and 'sessions' (an array of objects in the
   * same format as that returned by
   * {@link module:crypto/OlmDevice#getSessionInfoForDevice}).
   * <p>
   * This method is provided for debugging purposes.
   *
   * @param {string} userId id of user to inspect
   *
   * @return {Promise<Object.<string, {deviceIdKey: string, sessions: object[]}>>}
   */


  async getOlmSessionsForUser(userId) {
    const devices = this.getStoredDevicesForUser(userId) || [];
    const result = {};

    for (let j = 0; j < devices.length; ++j) {
      const device = devices[j];
      const deviceKey = device.getIdentityKey();
      const sessions = await this.olmDevice.getSessionInfoForDevice(deviceKey);
      result[device.deviceId] = {
        deviceIdKey: deviceKey,
        sessions: sessions
      };
    }

    return result;
  }
  /**
   * Get the device which sent an event
   *
   * @param {module:models/event.MatrixEvent} event event to be checked
   *
   * @return {module:crypto/deviceinfo?}
   */


  getEventSenderDeviceInfo(event) {
    const senderKey = event.getSenderKey();
    const algorithm = event.getWireContent().algorithm;

    if (!senderKey || !algorithm) {
      return null;
    }

    if (event.isKeySourceUntrusted()) {
      // we got the key for this event from a source that we consider untrusted
      return null;
    } // senderKey is the Curve25519 identity key of the device which the event
    // was sent from. In the case of Megolm, it's actually the Curve25519
    // identity key of the device which set up the Megolm session.


    const device = this.deviceList.getDeviceByIdentityKey(algorithm, senderKey);

    if (device === null) {
      // we haven't downloaded the details of this device yet.
      return null;
    } // so far so good, but now we need to check that the sender of this event
    // hadn't advertised someone else's Curve25519 key as their own. We do that
    // by checking the Ed25519 claimed by the event (or, in the case of megolm,
    // the event which set up the megolm session), to check that it matches the
    // fingerprint of the purported sending device.
    //
    // (see https://github.com/vector-im/vector-web/issues/2215)


    const claimedKey = event.getClaimedEd25519Key();

    if (!claimedKey) {
      _logger.logger.warn("Event " + event.getId() + " claims no ed25519 key: " + "cannot verify sending device");

      return null;
    }

    if (claimedKey !== device.getFingerprint()) {
      _logger.logger.warn("Event " + event.getId() + " claims ed25519 key " + claimedKey + " but sender device has key " + device.getFingerprint());

      return null;
    }

    return device;
  }
  /**
   * Get information about the encryption of an event
   *
   * @param {module:models/event.MatrixEvent} event event to be checked
   *
   * @return {object} An object with the fields:
   *    - encrypted: whether the event is encrypted (if not encrypted, some of the
   *      other properties may not be set)
   *    - senderKey: the sender's key
   *    - algorithm: the algorithm used to encrypt the event
   *    - authenticated: whether we can be sure that the owner of the senderKey
   *      sent the event
   *    - sender: the sender's device information, if available
   *    - mismatchedSender: if the event's ed25519 and curve25519 keys don't match
   *      (only meaningful if `sender` is set)
   */


  getEventEncryptionInfo(event) {
    const ret = {};
    ret.senderKey = event.getSenderKey();
    ret.algorithm = event.getWireContent().algorithm;

    if (!ret.senderKey || !ret.algorithm) {
      ret.encrypted = false;
      return ret;
    }

    ret.encrypted = true;

    if (event.isKeySourceUntrusted()) {
      // we got the key this event from somewhere else
      // TODO: check if we can trust the forwarders.
      ret.authenticated = false;
    } else {
      ret.authenticated = true;
    } // senderKey is the Curve25519 identity key of the device which the event
    // was sent from. In the case of Megolm, it's actually the Curve25519
    // identity key of the device which set up the Megolm session.


    ret.sender = this.deviceList.getDeviceByIdentityKey(ret.algorithm, ret.senderKey); // so far so good, but now we need to check that the sender of this event
    // hadn't advertised someone else's Curve25519 key as their own. We do that
    // by checking the Ed25519 claimed by the event (or, in the case of megolm,
    // the event which set up the megolm session), to check that it matches the
    // fingerprint of the purported sending device.
    //
    // (see https://github.com/vector-im/vector-web/issues/2215)

    const claimedKey = event.getClaimedEd25519Key();

    if (!claimedKey) {
      _logger.logger.warn("Event " + event.getId() + " claims no ed25519 key: " + "cannot verify sending device");

      ret.mismatchedSender = true;
    }

    if (ret.sender && claimedKey !== ret.sender.getFingerprint()) {
      _logger.logger.warn("Event " + event.getId() + " claims ed25519 key " + claimedKey + "but sender device has key " + ret.sender.getFingerprint());

      ret.mismatchedSender = true;
    }

    return ret;
  }
  /**
   * Forces the current outbound group session to be discarded such
   * that another one will be created next time an event is sent.
   *
   * @param {string} roomId The ID of the room to discard the session for
   *
   * This should not normally be necessary.
   */


  forceDiscardSession(roomId) {
    const alg = this.roomEncryptors.get(roomId);
    if (alg === undefined) throw new Error("Room not encrypted");

    if (alg.forceDiscardSession === undefined) {
      throw new Error("Room encryption algorithm doesn't support session discarding");
    }

    alg.forceDiscardSession();
  }
  /**
   * Configure a room to use encryption (ie, save a flag in the cryptoStore).
   *
   * @param {string} roomId The room ID to enable encryption in.
   *
   * @param {object} config The encryption config for the room.
   *
   * @param {boolean=} inhibitDeviceQuery true to suppress device list query for
   *   users in the room (for now). In case lazy loading is enabled,
   *   the device query is always inhibited as the members are not tracked.
   */


  async setRoomEncryption(roomId, config, inhibitDeviceQuery) {
    // ignore crypto events with no algorithm defined
    // This will happen if a crypto event is redacted before we fetch the room state
    // It would otherwise just throw later as an unknown algorithm would, but we may
    // as well catch this here
    if (!config.algorithm) {
      _logger.logger.log("Ignoring setRoomEncryption with no algorithm");

      return;
    } // if state is being replayed from storage, we might already have a configuration
    // for this room as they are persisted as well.
    // We just need to make sure the algorithm is initialized in this case.
    // However, if the new config is different,
    // we should bail out as room encryption can't be changed once set.


    const existingConfig = this.roomList.getRoomEncryption(roomId);

    if (existingConfig) {
      if (JSON.stringify(existingConfig) != JSON.stringify(config)) {
        _logger.logger.error("Ignoring m.room.encryption event which requests " + "a change of config in " + roomId);

        return;
      }
    } // if we already have encryption in this room, we should ignore this event,
    // as it would reset the encryption algorithm.
    // This is at least expected to be called twice, as sync calls onCryptoEvent
    // for both the timeline and state sections in the /sync response,
    // the encryption event would appear in both.
    // If it's called more than twice though,
    // it signals a bug on client or server.


    const existingAlg = this.roomEncryptors.get(roomId);

    if (existingAlg) {
      return;
    } // _roomList.getRoomEncryption will not race with _roomList.setRoomEncryption
    // because it first stores in memory. We should await the promise only
    // after all the in-memory state (roomEncryptors and _roomList) has been updated
    // to avoid races when calling this method multiple times. Hence keep a hold of the promise.


    let storeConfigPromise = null;

    if (!existingConfig) {
      storeConfigPromise = this.roomList.setRoomEncryption(roomId, config);
    }

    const AlgClass = algorithms.ENCRYPTION_CLASSES.get(config.algorithm);

    if (!AlgClass) {
      throw new Error("Unable to encrypt with " + config.algorithm);
    }

    const alg = new AlgClass({
      userId: this.userId,
      deviceId: this.deviceId,
      crypto: this,
      olmDevice: this.olmDevice,
      baseApis: this.baseApis,
      roomId,
      config
    });
    this.roomEncryptors.set(roomId, alg);

    if (storeConfigPromise) {
      await storeConfigPromise;
    }

    if (!this.lazyLoadMembers) {
      _logger.logger.log("Enabling encryption in " + roomId + "; " + "starting to track device lists for all users therein");

      await this.trackRoomDevices(roomId); // TODO: this flag is only not used from MatrixClient::setRoomEncryption
      // which is never used (inside Element at least)
      // but didn't want to remove it as it technically would
      // be a breaking change.

      if (!inhibitDeviceQuery) {
        this.deviceList.refreshOutdatedDeviceLists();
      }
    } else {
      _logger.logger.log("Enabling encryption in " + roomId);
    }
  }
  /**
   * Make sure we are tracking the device lists for all users in this room.
   *
   * @param {string} roomId The room ID to start tracking devices in.
   * @returns {Promise} when all devices for the room have been fetched and marked to track
   */


  trackRoomDevices(roomId) {
    const trackMembers = async () => {
      // not an encrypted room
      if (!this.roomEncryptors.has(roomId)) {
        return;
      }

      const room = this.clientStore.getRoom(roomId);

      if (!room) {
        throw new Error(`Unable to start tracking devices in unknown room ${roomId}`);
      }

      _logger.logger.log(`Starting to track devices for room ${roomId} ...`);

      const members = await room.getEncryptionTargetMembers();
      members.forEach(m => {
        this.deviceList.startTrackingDeviceList(m.userId);
      });
    };

    let promise = this.roomDeviceTrackingState[roomId];

    if (!promise) {
      promise = trackMembers();
      this.roomDeviceTrackingState[roomId] = promise.catch(err => {
        this.roomDeviceTrackingState[roomId] = null;
        throw err;
      });
    }

    return promise;
  }
  /**
   * Try to make sure we have established olm sessions for all known devices for
   * the given users.
   *
   * @param {string[]} users list of user ids
   * @param {boolean} force If true, force a new Olm session to be created. Default false.
   *
   * @return {Promise} resolves once the sessions are complete, to
   *    an Object mapping from userId to deviceId to
   *    {@link module:crypto~OlmSessionResult}
   */


  ensureOlmSessionsForUsers(users, force) {
    const devicesByUser = {};

    for (let i = 0; i < users.length; ++i) {
      const userId = users[i];
      devicesByUser[userId] = [];
      const devices = this.getStoredDevicesForUser(userId) || [];

      for (let j = 0; j < devices.length; ++j) {
        const deviceInfo = devices[j];
        const key = deviceInfo.getIdentityKey();

        if (key == this.olmDevice.deviceCurve25519Key) {
          // don't bother setting up session to ourself
          continue;
        }

        if (deviceInfo.verified == DeviceVerification.BLOCKED) {
          // don't bother setting up sessions with blocked users
          continue;
        }

        devicesByUser[userId].push(deviceInfo);
      }
    }

    return olmlib.ensureOlmSessionsForDevices(this.olmDevice, this.baseApis, devicesByUser, force);
  }
  /**
   * Get a list containing all of the room keys
   *
   * @return {module:crypto/OlmDevice.MegolmSessionData[]} a list of session export objects
   */


  async exportRoomKeys() {
    const exportedSessions = [];
    await this.cryptoStore.doTxn('readonly', [_indexeddbCryptoStore.IndexedDBCryptoStore.STORE_INBOUND_GROUP_SESSIONS], txn => {
      this.cryptoStore.getAllEndToEndInboundGroupSessions(txn, s => {
        if (s === null) return;
        const sess = this.olmDevice.exportInboundGroupSession(s.senderKey, s.sessionId, s.sessionData);
        delete sess.first_known_index;
        sess.algorithm = olmlib.MEGOLM_ALGORITHM;
        exportedSessions.push(sess);
      });
    });
    return exportedSessions;
  }
  /**
   * Import a list of room keys previously exported by exportRoomKeys
   *
   * @param {Object[]} keys a list of session export objects
   * @param {Object} opts
   * @param {Function} opts.progressCallback called with an object which has a stage param
   * @return {Promise} a promise which resolves once the keys have been imported
   */


  importRoomKeys(keys, opts = {}) {
    let successes = 0;
    let failures = 0;
    const total = keys.length;

    function updateProgress() {
      opts.progressCallback({
        stage: "load_keys",
        successes,
        failures,
        total
      });
    }

    return Promise.all(keys.map(key => {
      if (!key.room_id || !key.algorithm) {
        _logger.logger.warn("ignoring room key entry with missing fields", key);

        failures++;

        if (opts.progressCallback) {
          updateProgress();
        }

        return null;
      }

      const alg = this.getRoomDecryptor(key.room_id, key.algorithm);
      return alg.importRoomKey(key, opts).finally(() => {
        successes++;

        if (opts.progressCallback) {
          updateProgress();
        }
      });
    })).then();
  }
  /**
   * Counts the number of end to end session keys that are waiting to be backed up
   * @returns {Promise<number>} Resolves to the number of sessions requiring backup
   */


  countSessionsNeedingBackup() {
    return this.backupManager.countSessionsNeedingBackup();
  }
  /**
   * Perform any background tasks that can be done before a message is ready to
   * send, in order to speed up sending of the message.
   *
   * @param {module:models/room} room the room the event is in
   */


  prepareToEncrypt(room) {
    const alg = this.roomEncryptors.get(room.roomId);

    if (alg) {
      alg.prepareToEncrypt(room);
    }
  }
  /**
   * Encrypt an event according to the configuration of the room.
   *
   * @param {module:models/event.MatrixEvent} event  event to be sent
   *
   * @param {module:models/room} room destination room.
   *
   * @return {Promise?} Promise which resolves when the event has been
   *     encrypted, or null if nothing was needed
   */


  async encryptEvent(event, room) {
    if (!room) {
      throw new Error("Cannot send encrypted messages in unknown rooms");
    }

    const roomId = event.getRoomId();
    const alg = this.roomEncryptors.get(roomId);

    if (!alg) {
      // MatrixClient has already checked that this room should be encrypted,
      // so this is an unexpected situation.
      throw new Error("Room was previously configured to use encryption, but is " + "no longer. Perhaps the homeserver is hiding the " + "configuration event.");
    }

    if (!this.roomDeviceTrackingState[roomId]) {
      this.trackRoomDevices(roomId);
    } // wait for all the room devices to be loaded


    await this.roomDeviceTrackingState[roomId];
    let content = event.getContent(); // If event has an m.relates_to then we need
    // to put this on the wrapping event instead

    const mRelatesTo = content['m.relates_to'];

    if (mRelatesTo) {
      // Clone content here so we don't remove `m.relates_to` from the local-echo
      content = Object.assign({}, content);
      delete content['m.relates_to'];
    } // Treat element's performance metrics the same as `m.relates_to` (when present)


    const elementPerfMetrics = content['io.element.performance_metrics'];

    if (elementPerfMetrics) {
      content = Object.assign({}, content);
      delete content['io.element.performance_metrics'];
    }

    const encryptedContent = await alg.encryptMessage(room, event.getType(), content);

    if (mRelatesTo) {
      encryptedContent['m.relates_to'] = mRelatesTo;
    }

    if (elementPerfMetrics) {
      encryptedContent['io.element.performance_metrics'] = elementPerfMetrics;
    }

    event.makeEncrypted("m.room.encrypted", encryptedContent, this.olmDevice.deviceCurve25519Key, this.olmDevice.deviceEd25519Key);
  }
  /**
   * Decrypt a received event
   *
   * @param {MatrixEvent} event
   *
   * @return {Promise<module:crypto~EventDecryptionResult>} resolves once we have
   *  finished decrypting. Rejects with an `algorithms.DecryptionError` if there
   *  is a problem decrypting the event.
   */


  async decryptEvent(event) {
    if (event.isRedacted()) {
      const redactionEvent = new _event2.MatrixEvent(_objectSpread({
        room_id: event.getRoomId()
      }, event.getUnsigned().redacted_because));
      const decryptedEvent = await this.decryptEvent(redactionEvent);
      return {
        clearEvent: {
          room_id: event.getRoomId(),
          type: "m.room.message",
          content: {},
          unsigned: {
            redacted_because: decryptedEvent.clearEvent
          }
        }
      };
    } else {
      const content = event.getWireContent();
      const alg = this.getRoomDecryptor(event.getRoomId(), content.algorithm);
      return alg.decryptEvent(event);
    }
  }
  /**
   * Handle the notification from /sync or /keys/changes that device lists have
   * been changed.
   *
   * @param {Object} syncData Object containing sync tokens associated with this sync
   * @param {Object} syncDeviceLists device_lists field from /sync, or response from
   * /keys/changes
   */


  async handleDeviceListChanges(syncData, syncDeviceLists) {
    // Initial syncs don't have device change lists. We'll either get the complete list
    // of changes for the interval or will have invalidated everything in willProcessSync
    if (!syncData.oldSyncToken) return; // Here, we're relying on the fact that we only ever save the sync data after
    // sucessfully saving the device list data, so we're guaranteed that the device
    // list store is at least as fresh as the sync token from the sync store, ie.
    // any device changes received in sync tokens prior to the 'next' token here
    // have been processed and are reflected in the current device list.
    // If we didn't make this assumption, we'd have to use the /keys/changes API
    // to get key changes between the sync token in the device list and the 'old'
    // sync token used here to make sure we didn't miss any.

    await this.evalDeviceListChanges(syncDeviceLists);
  }
  /**
   * Send a request for some room keys, if we have not already done so
   *
   * @param {module:crypto~RoomKeyRequestBody} requestBody
   * @param {Array<{userId: string, deviceId: string}>} recipients
   * @param {boolean} resend whether to resend the key request if there is
   *    already one
   *
   * @return {Promise} a promise that resolves when the key request is queued
   */


  requestRoomKey(requestBody, recipients, resend = false) {
    return this.outgoingRoomKeyRequestManager.queueRoomKeyRequest(requestBody, recipients, resend).then(() => {
      if (this.sendKeyRequestsImmediately) {
        this.outgoingRoomKeyRequestManager.sendQueuedRequests();
      }
    }).catch(e => {
      // this normally means we couldn't talk to the store
      _logger.logger.error('Error requesting key for event', e);
    });
  }
  /**
   * Cancel any earlier room key request
   *
   * @param {module:crypto~RoomKeyRequestBody} requestBody
   *    parameters to match for cancellation
   */


  cancelRoomKeyRequest(requestBody) {
    this.outgoingRoomKeyRequestManager.cancelRoomKeyRequest(requestBody).catch(e => {
      _logger.logger.warn("Error clearing pending room key requests", e);
    });
  }
  /**
   * Re-send any outgoing key requests, eg after verification
   * @returns {Promise}
   */


  async cancelAndResendAllOutgoingKeyRequests() {
    await this.outgoingRoomKeyRequestManager.cancelAndResendAllOutgoingRequests();
  }
  /**
   * handle an m.room.encryption event
   *
   * @param {module:models/event.MatrixEvent} event encryption event
   */


  async onCryptoEvent(event) {
    const roomId = event.getRoomId();
    const content = event.getContent();

    try {
      // inhibit the device list refresh for now - it will happen once we've
      // finished processing the sync, in onSyncCompleted.
      await this.setRoomEncryption(roomId, content, true);
    } catch (e) {
      _logger.logger.error("Error configuring encryption in room " + roomId + ":", e);
    }
  }
  /**
   * Called before the result of a sync is processed
   *
   * @param {Object} syncData  the data from the 'MatrixClient.sync' event
   */


  async onSyncWillProcess(syncData) {
    if (!syncData.oldSyncToken) {
      // If there is no old sync token, we start all our tracking from
      // scratch, so mark everything as untracked. onCryptoEvent will
      // be called for all e2e rooms during the processing of the sync,
      // at which point we'll start tracking all the users of that room.
      _logger.logger.log("Initial sync performed - resetting device tracking state");

      this.deviceList.stopTrackingAllDeviceLists(); // we always track our own device list (for key backups etc)

      this.deviceList.startTrackingDeviceList(this.userId);
      this.roomDeviceTrackingState = {};
    }

    this.sendKeyRequestsImmediately = false;
  }
  /**
   * handle the completion of a /sync
   *
   * This is called after the processing of each successful /sync response.
   * It is an opportunity to do a batch process on the information received.
   *
   * @param {Object} syncData  the data from the 'MatrixClient.sync' event
   */


  async onSyncCompleted(syncData) {
    this.deviceList.setSyncToken(syncData.nextSyncToken);
    this.deviceList.saveIfDirty(); // we always track our own device list (for key backups etc)

    this.deviceList.startTrackingDeviceList(this.userId);
    this.deviceList.refreshOutdatedDeviceLists(); // we don't start uploading one-time keys until we've caught up with
    // to-device messages, to help us avoid throwing away one-time-keys that we
    // are about to receive messages for
    // (https://github.com/vector-im/element-web/issues/2782).

    if (!syncData.catchingUp) {
      this.maybeUploadOneTimeKeys();
      this.processReceivedRoomKeyRequests(); // likewise don't start requesting keys until we've caught up
      // on to_device messages, otherwise we'll request keys that we're
      // just about to get.

      this.outgoingRoomKeyRequestManager.sendQueuedRequests(); // Sync has finished so send key requests straight away.

      this.sendKeyRequestsImmediately = true;
    }
  }
  /**
   * Trigger the appropriate invalidations and removes for a given
   * device list
   *
   * @param {Object} deviceLists device_lists field from /sync, or response from
   * /keys/changes
   */


  async evalDeviceListChanges(deviceLists) {
    if (deviceLists.changed && Array.isArray(deviceLists.changed)) {
      deviceLists.changed.forEach(u => {
        this.deviceList.invalidateUserDeviceList(u);
      });
    }

    if (deviceLists.left && Array.isArray(deviceLists.left) && deviceLists.left.length) {
      // Check we really don't share any rooms with these users
      // any more: the server isn't required to give us the
      // exact correct set.
      const e2eUserIds = new Set(await this.getTrackedE2eUsers());
      deviceLists.left.forEach(u => {
        if (!e2eUserIds.has(u)) {
          this.deviceList.stopTrackingDeviceList(u);
        }
      });
    }
  }
  /**
   * Get a list of all the IDs of users we share an e2e room with
   * for which we are tracking devices already
   *
   * @returns {string[]} List of user IDs
   */


  async getTrackedE2eUsers() {
    const e2eUserIds = [];

    for (const room of this.getTrackedE2eRooms()) {
      const members = await room.getEncryptionTargetMembers();

      for (const member of members) {
        e2eUserIds.push(member.userId);
      }
    }

    return e2eUserIds;
  }
  /**
   * Get a list of the e2e-enabled rooms we are members of,
   * and for which we are already tracking the devices
   *
   * @returns {module:models.Room[]}
   */


  getTrackedE2eRooms() {
    return this.clientStore.getRooms().filter(room => {
      // check for rooms with encryption enabled
      const alg = this.roomEncryptors.get(room.roomId);

      if (!alg) {
        return false;
      }

      if (!this.roomDeviceTrackingState[room.roomId]) {
        return false;
      } // ignore any rooms which we have left


      const myMembership = room.getMyMembership();
      return myMembership === "join" || myMembership === "invite";
    });
  }
  /**
   * Encrypts and sends a given object via Olm to-device messages to a given
   * set of devices.
   * @param {object[]} userDeviceInfoArr the devices to send to
   * @param {object} payload fields to include in the encrypted payload
   * @return {Promise<{contentMap, deviceInfoByDeviceId}>} Promise which
   *     resolves once the message has been encrypted and sent to the given
   *     userDeviceMap, and returns the { contentMap, deviceInfoByDeviceId }
   *     of the successfully sent messages.
   */


  async encryptAndSendToDevices(userDeviceInfoArr, payload) {
    const toDeviceBatch = {
      eventType: _event.EventType.RoomMessageEncrypted,
      batch: []
    };

    try {
      await Promise.all(userDeviceInfoArr.map(async ({
        userId,
        deviceInfo
      }) => {
        const deviceId = deviceInfo.deviceId;
        const encryptedContent = {
          algorithm: olmlib.OLM_ALGORITHM,
          sender_key: this.olmDevice.deviceCurve25519Key,
          ciphertext: {}
        };
        toDeviceBatch.batch.push({
          userId,
          deviceId,
          payload: encryptedContent
        });
        await olmlib.ensureOlmSessionsForDevices(this.olmDevice, this.baseApis, {
          [userId]: [deviceInfo]
        });
        await olmlib.encryptMessageForDevice(encryptedContent.ciphertext, this.userId, this.deviceId, this.olmDevice, userId, deviceInfo, payload);
      })); // prune out any devices that encryptMessageForDevice could not encrypt for,
      // in which case it will have just not added anything to the ciphertext object.
      // There's no point sending messages to devices if we couldn't encrypt to them,
      // since that's effectively a blank message.

      toDeviceBatch.batch = toDeviceBatch.batch.filter(msg => {
        if (Object.keys(msg.payload.ciphertext).length > 0) {
          return true;
        } else {
          _logger.logger.log(`No ciphertext for device ${msg.userId}:${msg.deviceId}: pruning`);

          return false;
        }
      });

      try {
        await this.baseApis.queueToDevice(toDeviceBatch);
      } catch (e) {
        _logger.logger.error("sendToDevice failed", e);

        throw e;
      }
    } catch (e) {
      _logger.logger.error("encryptAndSendToDevices promises failed", e);

      throw e;
    }
  }

  /**
   * Handle a key event
   *
   * @private
   * @param {module:models/event.MatrixEvent} event key event
   */
  onRoomKeyEvent(event) {
    const content = event.getContent();

    if (!content.room_id || !content.algorithm) {
      _logger.logger.error("key event is missing fields");

      return;
    }

    if (!this.backupManager.checkedForBackup) {
      // don't bother awaiting on this - the important thing is that we retry if we
      // haven't managed to check before
      this.backupManager.checkAndStart();
    }

    const alg = this.getRoomDecryptor(content.room_id, content.algorithm);
    alg.onRoomKeyEvent(event);
  }
  /**
   * Handle a key withheld event
   *
   * @private
   * @param {module:models/event.MatrixEvent} event key withheld event
   */


  onRoomKeyWithheldEvent(event) {
    const content = event.getContent();

    if (content.code !== "m.no_olm" && (!content.room_id || !content.session_id) || !content.algorithm || !content.sender_key) {
      _logger.logger.error("key withheld event is missing fields");

      return;
    }

    _logger.logger.info(`Got room key withheld event from ${event.getSender()} (${content.sender_key}) ` + `for ${content.algorithm}/${content.room_id}/${content.session_id} ` + `with reason ${content.code} (${content.reason})`);

    const alg = this.getRoomDecryptor(content.room_id, content.algorithm);

    if (alg.onRoomKeyWithheldEvent) {
      alg.onRoomKeyWithheldEvent(event);
    }

    if (!content.room_id) {
      // retry decryption for all events sent by the sender_key.  This will
      // update the events to show a message indicating that the olm session was
      // wedged.
      const roomDecryptors = this.getRoomDecryptors(content.algorithm);

      for (const decryptor of roomDecryptors) {
        decryptor.retryDecryptionFromSender(content.sender_key);
      }
    }
  }
  /**
   * Handle a general key verification event.
   *
   * @private
   * @param {module:models/event.MatrixEvent} event verification start event
   */


  onKeyVerificationMessage(event) {
    if (!_ToDeviceChannel.ToDeviceChannel.validateEvent(event, this.baseApis)) {
      return;
    }

    const createRequest = event => {
      if (!_ToDeviceChannel.ToDeviceChannel.canCreateRequest(_ToDeviceChannel.ToDeviceChannel.getEventType(event))) {
        return;
      }

      const content = event.getContent();
      const deviceId = content && content.from_device;

      if (!deviceId) {
        return;
      }

      const userId = event.getSender();
      const channel = new _ToDeviceChannel.ToDeviceChannel(this.baseApis, userId, [deviceId]);
      return new _VerificationRequest.VerificationRequest(channel, this.verificationMethods, this.baseApis);
    };

    this.handleVerificationEvent(event, this.toDeviceVerificationRequests, createRequest);
  }
  /**
   * Handle key verification requests sent as timeline events
   *
   * @private
   * @param {module:models/event.MatrixEvent} event the timeline event
   * @param {module:models/Room} room not used
   * @param {boolean} atStart not used
   * @param {boolean} removed not used
   * @param {boolean} { liveEvent } whether this is a live event
   */


  async handleVerificationEvent(event, requestsMap, createRequest, isLiveEvent = true) {
    // Wait for event to get its final ID with pendingEventOrdering: "chronological", since DM channels depend on it.
    if (event.isSending() && event.status != _event2.EventStatus.SENT) {
      let eventIdListener;
      let statusListener;

      try {
        await new Promise((resolve, reject) => {
          eventIdListener = resolve;

          statusListener = () => {
            if (event.status == _event2.EventStatus.CANCELLED) {
              reject(new Error("Event status set to CANCELLED."));
            }
          };

          event.once(_event2.MatrixEventEvent.LocalEventIdReplaced, eventIdListener);
          event.on(_event2.MatrixEventEvent.Status, statusListener);
        });
      } catch (err) {
        _logger.logger.error("error while waiting for the verification event to be sent: ", err);

        return;
      } finally {
        event.removeListener(_event2.MatrixEventEvent.LocalEventIdReplaced, eventIdListener);
        event.removeListener(_event2.MatrixEventEvent.Status, statusListener);
      }
    }

    let request = requestsMap.getRequest(event);
    let isNewRequest = false;

    if (!request) {
      request = createRequest(event); // a request could not be made from this event, so ignore event

      if (!request) {
        _logger.logger.log(`Crypto: could not find VerificationRequest for ` + `${event.getType()}, and could not create one, so ignoring.`);

        return;
      }

      isNewRequest = true;
      requestsMap.setRequest(event, request);
    }

    event.setVerificationRequest(request);

    try {
      await request.channel.handleEvent(event, request, isLiveEvent);
    } catch (err) {
      _logger.logger.error("error while handling verification event", err);
    }

    const shouldEmit = isNewRequest && !request.initiatedByMe && !request.invalid && // check it has enough events to pass the UNSENT stage
    !request.observeOnly;

    if (shouldEmit) {
      this.baseApis.emit(CryptoEvent.VerificationRequest, request);
    }
  }
  /**
   * Handle a toDevice event that couldn't be decrypted
   *
   * @private
   * @param {module:models/event.MatrixEvent} event undecryptable event
   */


  async onToDeviceBadEncrypted(event) {
    const content = event.getWireContent();
    const sender = event.getSender();
    const algorithm = content.algorithm;
    const deviceKey = content.sender_key; // retry decryption for all events sent by the sender_key.  This will
    // update the events to show a message indicating that the olm session was
    // wedged.

    const retryDecryption = () => {
      const roomDecryptors = this.getRoomDecryptors(olmlib.MEGOLM_ALGORITHM);

      for (const decryptor of roomDecryptors) {
        decryptor.retryDecryptionFromSender(deviceKey);
      }
    };

    if (sender === undefined || deviceKey === undefined || deviceKey === undefined) {
      return;
    } // check when we last forced a new session with this device: if we've already done so
    // recently, don't do it again.


    this.lastNewSessionForced[sender] = this.lastNewSessionForced[sender] || {};
    const lastNewSessionForced = this.lastNewSessionForced[sender][deviceKey] || 0;

    if (lastNewSessionForced + MIN_FORCE_SESSION_INTERVAL_MS > Date.now()) {
      _logger.logger.debug("New session already forced with device " + sender + ":" + deviceKey + " at " + lastNewSessionForced + ": not forcing another");

      await this.olmDevice.recordSessionProblem(deviceKey, "wedged", true);
      retryDecryption();
      return;
    } // establish a new olm session with this device since we're failing to decrypt messages
    // on a current session.
    // Note that an undecryptable message from another device could easily be spoofed -
    // is there anything we can do to mitigate this?


    let device = this.deviceList.getDeviceByIdentityKey(algorithm, deviceKey);

    if (!device) {
      // if we don't know about the device, fetch the user's devices again
      // and retry before giving up
      await this.downloadKeys([sender], false);
      device = this.deviceList.getDeviceByIdentityKey(algorithm, deviceKey);

      if (!device) {
        _logger.logger.info("Couldn't find device for identity key " + deviceKey + ": not re-establishing session");

        await this.olmDevice.recordSessionProblem(deviceKey, "wedged", false);
        retryDecryption();
        return;
      }
    }

    const devicesByUser = {};
    devicesByUser[sender] = [device];
    await olmlib.ensureOlmSessionsForDevices(this.olmDevice, this.baseApis, devicesByUser, true);
    this.lastNewSessionForced[sender][deviceKey] = Date.now(); // Now send a blank message on that session so the other side knows about it.
    // (The keyshare request is sent in the clear so that won't do)
    // We send this first such that, as long as the toDevice messages arrive in the
    // same order we sent them, the other end will get this first, set up the new session,
    // then get the keyshare request and send the key over this new session (because it
    // is the session it has most recently received a message on).

    const encryptedContent = {
      algorithm: olmlib.OLM_ALGORITHM,
      sender_key: this.olmDevice.deviceCurve25519Key,
      ciphertext: {}
    };
    await olmlib.encryptMessageForDevice(encryptedContent.ciphertext, this.userId, this.deviceId, this.olmDevice, sender, device, {
      type: "m.dummy"
    });
    await this.olmDevice.recordSessionProblem(deviceKey, "wedged", true);
    retryDecryption();
    await this.baseApis.sendToDevice("m.room.encrypted", {
      [sender]: {
        [device.deviceId]: encryptedContent
      }
    }); // Most of the time this probably won't be necessary since we'll have queued up a key request when
    // we failed to decrypt the message and will be waiting a bit for the key to arrive before sending
    // it. This won't always be the case though so we need to re-send any that have already been sent
    // to avoid races.

    const requestsToResend = await this.outgoingRoomKeyRequestManager.getOutgoingSentRoomKeyRequest(sender, device.deviceId);

    for (const keyReq of requestsToResend) {
      this.requestRoomKey(keyReq.requestBody, keyReq.recipients, true);
    }
  }
  /**
   * Handle a change in the membership state of a member of a room
   *
   * @private
   * @param {module:models/event.MatrixEvent} event  event causing the change
   * @param {module:models/room-member} member  user whose membership changed
   * @param {string=} oldMembership  previous membership
   */


  onRoomMembership(event, member, oldMembership) {
    // this event handler is registered on the *client* (as opposed to the room
    // member itself), which means it is only called on changes to the *live*
    // membership state (ie, it is not called when we back-paginate, nor when
    // we load the state in the initialsync).
    //
    // Further, it is automatically registered and called when new members
    // arrive in the room.
    const roomId = member.roomId;
    const alg = this.roomEncryptors.get(roomId);

    if (!alg) {
      // not encrypting in this room
      return;
    } // only mark users in this room as tracked if we already started tracking in this room
    // this way we don't start device queries after sync on behalf of this room which we won't use
    // the result of anyway, as we'll need to do a query again once all the members are fetched
    // by calling _trackRoomDevices


    if (this.roomDeviceTrackingState[roomId]) {
      if (member.membership == 'join') {
        _logger.logger.log('Join event for ' + member.userId + ' in ' + roomId); // make sure we are tracking the deviceList for this user


        this.deviceList.startTrackingDeviceList(member.userId);
      } else if (member.membership == 'invite' && this.clientStore.getRoom(roomId).shouldEncryptForInvitedMembers()) {
        _logger.logger.log('Invite event for ' + member.userId + ' in ' + roomId);

        this.deviceList.startTrackingDeviceList(member.userId);
      }
    }

    alg.onRoomMembership(event, member, oldMembership);
  }
  /**
   * Called when we get an m.room_key_request event.
   *
   * @private
   * @param {module:models/event.MatrixEvent} event key request event
   */


  onRoomKeyRequestEvent(event) {
    const content = event.getContent();

    if (content.action === "request") {
      // Queue it up for now, because they tend to arrive before the room state
      // events at initial sync, and we want to see if we know anything about the
      // room before passing them on to the app.
      const req = new IncomingRoomKeyRequest(event);
      this.receivedRoomKeyRequests.push(req);
    } else if (content.action === "request_cancellation") {
      const req = new IncomingRoomKeyRequestCancellation(event);
      this.receivedRoomKeyRequestCancellations.push(req);
    }
  }
  /**
   * Process any m.room_key_request events which were queued up during the
   * current sync.
   *
   * @private
   */


  async processReceivedRoomKeyRequests() {
    if (this.processingRoomKeyRequests) {
      // we're still processing last time's requests; keep queuing new ones
      // up for now.
      return;
    }

    this.processingRoomKeyRequests = true;

    try {
      // we need to grab and clear the queues in the synchronous bit of this method,
      // so that we don't end up racing with the next /sync.
      const requests = this.receivedRoomKeyRequests;
      this.receivedRoomKeyRequests = [];
      const cancellations = this.receivedRoomKeyRequestCancellations;
      this.receivedRoomKeyRequestCancellations = []; // Process all of the requests, *then* all of the cancellations.
      //
      // This makes sure that if we get a request and its cancellation in the
      // same /sync result, then we process the request before the
      // cancellation (and end up with a cancelled request), rather than the
      // cancellation before the request (and end up with an outstanding
      // request which should have been cancelled.)

      await Promise.all(requests.map(req => this.processReceivedRoomKeyRequest(req)));
      await Promise.all(cancellations.map(cancellation => this.processReceivedRoomKeyRequestCancellation(cancellation)));
    } catch (e) {
      _logger.logger.error(`Error processing room key requsts: ${e}`);
    } finally {
      this.processingRoomKeyRequests = false;
    }
  }
  /**
   * Helper for processReceivedRoomKeyRequests
   *
   * @param {IncomingRoomKeyRequest} req
   */


  async processReceivedRoomKeyRequest(req) {
    const userId = req.userId;
    const deviceId = req.deviceId;
    const body = req.requestBody;
    const roomId = body.room_id;
    const alg = body.algorithm;

    _logger.logger.log(`m.room_key_request from ${userId}:${deviceId}` + ` for ${roomId} / ${body.session_id} (id ${req.requestId})`);

    if (userId !== this.userId) {
      if (!this.roomEncryptors.get(roomId)) {
        _logger.logger.debug(`room key request for unencrypted room ${roomId}`);

        return;
      }

      const encryptor = this.roomEncryptors.get(roomId);
      const device = this.deviceList.getStoredDevice(userId, deviceId);

      if (!device) {
        _logger.logger.debug(`Ignoring keyshare for unknown device ${userId}:${deviceId}`);

        return;
      }

      try {
        await encryptor.reshareKeyWithDevice(body.sender_key, body.session_id, userId, device);
      } catch (e) {
        _logger.logger.warn("Failed to re-share keys for session " + body.session_id + " with device " + userId + ":" + device.deviceId, e);
      }

      return;
    }

    if (deviceId === this.deviceId) {
      // We'll always get these because we send room key requests to
      // '*' (ie. 'all devices') which includes the sending device,
      // so ignore requests from ourself because apart from it being
      // very silly, it won't work because an Olm session cannot send
      // messages to itself.
      // The log here is probably superfluous since we know this will
      // always happen, but let's log anyway for now just in case it
      // causes issues.
      _logger.logger.log("Ignoring room key request from ourselves");

      return;
    } // todo: should we queue up requests we don't yet have keys for,
    // in case they turn up later?
    // if we don't have a decryptor for this room/alg, we don't have
    // the keys for the requested events, and can drop the requests.


    if (!this.roomDecryptors.has(roomId)) {
      _logger.logger.log(`room key request for unencrypted room ${roomId}`);

      return;
    }

    const decryptor = this.roomDecryptors.get(roomId).get(alg);

    if (!decryptor) {
      _logger.logger.log(`room key request for unknown alg ${alg} in room ${roomId}`);

      return;
    }

    if (!(await decryptor.hasKeysForKeyRequest(req))) {
      _logger.logger.log(`room key request for unknown session ${roomId} / ` + body.session_id);

      return;
    }

    req.share = () => {
      decryptor.shareKeysWithDevice(req);
    }; // if the device is verified already, share the keys


    if (this.checkDeviceTrust(userId, deviceId).isVerified()) {
      _logger.logger.log('device is already verified: sharing keys');

      req.share();
      return;
    }

    this.emit(CryptoEvent.RoomKeyRequest, req);
  }
  /**
   * Helper for processReceivedRoomKeyRequests
   *
   * @param {IncomingRoomKeyRequestCancellation} cancellation
   */


  async processReceivedRoomKeyRequestCancellation(cancellation) {
    _logger.logger.log(`m.room_key_request cancellation for ${cancellation.userId}:` + `${cancellation.deviceId} (id ${cancellation.requestId})`); // we should probably only notify the app of cancellations we told it
    // about, but we don't currently have a record of that, so we just pass
    // everything through.


    this.emit(CryptoEvent.RoomKeyRequestCancellation, cancellation);
  }
  /**
   * Get a decryptor for a given room and algorithm.
   *
   * If we already have a decryptor for the given room and algorithm, return
   * it. Otherwise try to instantiate it.
   *
   * @private
   *
   * @param {string?} roomId   room id for decryptor. If undefined, a temporary
   * decryptor is instantiated.
   *
   * @param {string} algorithm  crypto algorithm
   *
   * @return {module:crypto.algorithms.base.DecryptionAlgorithm}
   *
   * @raises {module:crypto.algorithms.DecryptionError} if the algorithm is
   * unknown
   */


  getRoomDecryptor(roomId, algorithm) {
    let decryptors;
    let alg;
    roomId = roomId || null;

    if (roomId) {
      decryptors = this.roomDecryptors.get(roomId);

      if (!decryptors) {
        decryptors = new Map();
        this.roomDecryptors.set(roomId, decryptors);
      }

      alg = decryptors.get(algorithm);

      if (alg) {
        return alg;
      }
    }

    const AlgClass = algorithms.DECRYPTION_CLASSES.get(algorithm);

    if (!AlgClass) {
      throw new algorithms.DecryptionError('UNKNOWN_ENCRYPTION_ALGORITHM', 'Unknown encryption algorithm "' + algorithm + '".');
    }

    alg = new AlgClass({
      userId: this.userId,
      crypto: this,
      olmDevice: this.olmDevice,
      baseApis: this.baseApis,
      roomId: roomId
    });

    if (decryptors) {
      decryptors.set(algorithm, alg);
    }

    return alg;
  }
  /**
   * Get all the room decryptors for a given encryption algorithm.
   *
   * @param {string} algorithm The encryption algorithm
   *
   * @return {array} An array of room decryptors
   */


  getRoomDecryptors(algorithm) {
    const decryptors = [];

    for (const d of this.roomDecryptors.values()) {
      if (d.has(algorithm)) {
        decryptors.push(d.get(algorithm));
      }
    }

    return decryptors;
  }
  /**
   * sign the given object with our ed25519 key
   *
   * @param {Object} obj  Object to which we will add a 'signatures' property
   */


  async signObject(obj) {
    const sigs = obj.signatures || {};
    const unsigned = obj.unsigned;
    delete obj.signatures;
    delete obj.unsigned;
    sigs[this.userId] = sigs[this.userId] || {};
    sigs[this.userId]["ed25519:" + this.deviceId] = await this.olmDevice.sign(_anotherJson.default.stringify(obj));
    obj.signatures = sigs;
    if (unsigned !== undefined) obj.unsigned = unsigned;
  }

}
/**
 * Fix up the backup key, that may be in the wrong format due to a bug in a
 * migration step.  Some backup keys were stored as a comma-separated list of
 * integers, rather than a base64-encoded byte array.  If this function is
 * passed a string that looks like a list of integers rather than a base64
 * string, it will attempt to convert it to the right format.
 *
 * @param {string} key the key to check
 * @returns {null | string} If the key is in the wrong format, then the fixed
 * key will be returned. Otherwise null will be returned.
 *
 */


exports.Crypto = Crypto;

function fixBackupKey(key) {
  if (typeof key !== "string" || key.indexOf(",") < 0) {
    return null;
  }

  const fixedKey = Uint8Array.from(key.split(","), x => parseInt(x));
  return olmlib.encodeBase64(fixedKey);
}
/**
 * The parameters of a room key request. The details of the request may
 * vary with the crypto algorithm, but the management and storage layers for
 * outgoing requests expect it to have 'room_id' and 'session_id' properties.
 *
 * @typedef {Object} RoomKeyRequestBody
 */

/**
 * Represents a received m.room_key_request event
 *
 * @property {string} userId    user requesting the key
 * @property {string} deviceId  device requesting the key
 * @property {string} requestId unique id for the request
 * @property {module:crypto~RoomKeyRequestBody} requestBody
 * @property {function()} share  callback which, when called, will ask
 *    the relevant crypto algorithm implementation to share the keys for
 *    this request.
 */


class IncomingRoomKeyRequest {
  constructor(event) {
    _defineProperty(this, "userId", void 0);

    _defineProperty(this, "deviceId", void 0);

    _defineProperty(this, "requestId", void 0);

    _defineProperty(this, "requestBody", void 0);

    _defineProperty(this, "share", void 0);

    const content = event.getContent();
    this.userId = event.getSender();
    this.deviceId = content.requesting_device_id;
    this.requestId = content.request_id;
    this.requestBody = content.body || {};

    this.share = () => {
      throw new Error("don't know how to share keys for this request yet");
    };
  }

}
/**
 * Represents a received m.room_key_request cancellation
 *
 * @property {string} userId    user requesting the cancellation
 * @property {string} deviceId  device requesting the cancellation
 * @property {string} requestId unique id for the request to be cancelled
 */


exports.IncomingRoomKeyRequest = IncomingRoomKeyRequest;

class IncomingRoomKeyRequestCancellation {
  constructor(event) {
    _defineProperty(this, "userId", void 0);

    _defineProperty(this, "deviceId", void 0);

    _defineProperty(this, "requestId", void 0);

    const content = event.getContent();
    this.userId = event.getSender();
    this.deviceId = content.requesting_device_id;
    this.requestId = content.request_id;
  }

}
/**
 * The result of a (successful) call to decryptEvent.
 *
 * @typedef {Object} EventDecryptionResult
 *
 * @property {Object} clearEvent The plaintext payload for the event
 *     (typically containing <tt>type</tt> and <tt>content</tt> fields).
 *
 * @property {?string} senderCurve25519Key Key owned by the sender of this
 *    event.  See {@link module:models/event.MatrixEvent#getSenderKey}.
 *
 * @property {?string} claimedEd25519Key ed25519 key claimed by the sender of
 *    this event. See
 *    {@link module:models/event.MatrixEvent#getClaimedEd25519Key}.
 *
 * @property {?Array<string>} forwardingCurve25519KeyChain list of curve25519
 *     keys involved in telling us about the senderCurve25519Key and
 *     claimedEd25519Key. See
 *     {@link module:models/event.MatrixEvent#getForwardingCurve25519KeyChain}.
 */

/**
 * Fires when we receive a room key request
 *
 * @event module:client~MatrixClient#"crypto.roomKeyRequest"
 * @param {module:crypto~IncomingRoomKeyRequest} req  request details
 */

/**
 * Fires when we receive a room key request cancellation
 *
 * @event module:client~MatrixClient#"crypto.roomKeyRequestCancellation"
 * @param {module:crypto~IncomingRoomKeyRequestCancellation} req
 */

/**
 * Fires when the app may wish to warn the user about something related
 * the end-to-end crypto.
 *
 * @event module:client~MatrixClient#"crypto.warning"
 * @param {string} type One of the strings listed above
 */