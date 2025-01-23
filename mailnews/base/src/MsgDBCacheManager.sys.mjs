/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Message DB Cache manager
 */

var log = console.createInstance({
  prefix: "mailnews.database.dbcache",
  maxLogLevel: "Warn",
  maxLogLevelPref: "mailnews.database.dbcache.loglevel",
});

var DBCACHE_INTERVAL_DEFAULT_MS = 60000; // 1 minute

export var msgDBCacheManager = {
  _initialized: false,

  _msgDBCacheTimer: null,

  _msgDBCacheTimerIntervalMS: DBCACHE_INTERVAL_DEFAULT_MS,

  _dbService: null,

  /**
   * This is called on startup
   */
  init() {
    if (this._initialized) {
      return;
    }

    this._dbService = Cc["@mozilla.org/msgDatabase/msgDBService;1"].getService(
      Ci.nsIMsgDBService
    );

    // we listen for "quit-application-granted" instead of
    // "quit-application-requested" because other observers of the
    // latter can cancel the shutdown.
    Services.obs.addObserver(this, "quit-application-granted");

    this.startPeriodicCheck();

    this._initialized = true;
  },

  /* ........ Timer Callback ................*/

  _dbCacheCheckTimerCallback() {
    msgDBCacheManager.checkCachedDBs();
  },

  /* ........ Observer Notification Handler ................*/

  observe(aSubject, aTopic) {
    switch (aTopic) {
      // This is observed before any windows start unloading if something other
      // than the last 3pane window closing requested the application be
      // shutdown. For example, when the user quits via the file menu.
      case "quit-application-granted":
        Services.obs.removeObserver(this, "quit-application-granted");
        this.stopPeriodicCheck();
        break;
    }
  },

  /* ........ Public API ................*/

  /**
   * Stops db cache check
   */
  stopPeriodicCheck() {
    if (this._dbCacheCheckTimer) {
      this._dbCacheCheckTimer.cancel();

      delete this._dbCacheCheckTimer;
      this._dbCacheCheckTimer = null;
    }
  },

  /**
   * Starts periodic db cache check
   */
  startPeriodicCheck() {
    if (!this._dbCacheCheckTimer) {
      this._dbCacheCheckTimer = Cc["@mozilla.org/timer;1"].createInstance(
        Ci.nsITimer
      );

      this._dbCacheCheckTimer.initWithCallback(
        this._dbCacheCheckTimerCallback,
        this._msgDBCacheTimerIntervalMS,
        Ci.nsITimer.TYPE_REPEATING_SLACK
      );
    }
  },

  /**
   * Checks if any DBs need to be closed due to inactivity or too many of them open.
   */
  checkCachedDBs() {
    const keepOpenSize = Services.prefs.getIntPref("mail.db.keep_open_size");
    const idleLimit = Services.prefs.getIntPref("mail.db.idle_limit");
    const maxOpenDBs = Services.prefs.getIntPref("mail.db.max_open");

    // db.lastUseTime below is in microseconds while Date.now and idleLimit pref
    // is in milliseconds.
    const closeThreshold = (Date.now() - idleLimit) * 1000;
    const cachedDBs = this._dbService.openDBs;
    log.info(
      "Periodic check of cached folder databases (DBs), count=" +
        cachedDBs.length
    );
    // Count databases that are already closed or get closed now due to inactivity.
    let numClosing = 0;
    const dbs = [];
    for (const db of cachedDBs) {
      if (!db.folder?.databaseOpen) {
        // The DB isn't really open anymore.
        log.debug("Skipping, DB not open for folder: " + db.folder?.name);
        numClosing++;
        continue;
      }

      if (db.lastUseTime < closeThreshold && db.databaseSize < keepOpenSize) {
        // DB open too long without activity.
        log.debug("Closing expired DB for folder: " + db.folder.name);
        db.folder.msgDatabase = null;
        numClosing++;
        continue;
      }

      // Database eligible for closing.
      dbs.push(db);
    }
    log.info(`DBs open: ${dbs.length}, DBs already closing: ${numClosing}`);
    let dbsToClose = Math.max(dbs.length - Math.max(maxOpenDBs, 0), 0);
    if (dbsToClose > 0) {
      // Close some DBs so that we do not have more than maxOpenDBs.
      // However, we skipped DBs for folders that are open in a window
      // so if there are so many windows open, it may be possible for
      // more than maxOpenDBs folders to stay open after this loop.
      log.info("Need to close " + dbsToClose + " more DBs");
      // Order databases by size (smallest) and lowest lastUseTime (oldest)
      // at the end. In practice this is dominated by the size, but not
      // completely.
      dbs.sort(
        (a, b) =>
          Math.log10(b.databaseSize) * b.lastUseTime -
          Math.log10(a.databaseSize) * a.lastUseTime
      );
      while (dbsToClose > 0) {
        const db = dbs.pop();
        log.debug("Closing DB for folder: " + db.folder.name);
        db.folder.msgDatabase = null;
        dbsToClose--;
      }
    }
  },
};
