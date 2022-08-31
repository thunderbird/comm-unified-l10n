"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MatrixScheduler = void 0;

var utils = _interopRequireWildcard(require("./utils"));

var _logger = require("./logger");

var _event = require("./@types/event");

function _getRequireWildcardCache(nodeInterop) { if (typeof WeakMap !== "function") return null; var cacheBabelInterop = new WeakMap(); var cacheNodeInterop = new WeakMap(); return (_getRequireWildcardCache = function (nodeInterop) { return nodeInterop ? cacheNodeInterop : cacheBabelInterop; })(nodeInterop); }

function _interopRequireWildcard(obj, nodeInterop) { if (!nodeInterop && obj && obj.__esModule) { return obj; } if (obj === null || typeof obj !== "object" && typeof obj !== "function") { return { default: obj }; } var cache = _getRequireWildcardCache(nodeInterop); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj.default = obj; if (cache) { cache.set(obj, newObj); } return newObj; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

const DEBUG = false; // set true to enable console logging.

/**
 * Construct a scheduler for Matrix. Requires
 * {@link module:scheduler~MatrixScheduler#setProcessFunction} to be provided
 * with a way of processing events.
 * @constructor
 * @param {module:scheduler~retryAlgorithm} retryAlgorithm Optional. The retry
 * algorithm to apply when determining when to try to send an event again.
 * Defaults to {@link module:scheduler~MatrixScheduler.RETRY_BACKOFF_RATELIMIT}.
 * @param {module:scheduler~queueAlgorithm} queueAlgorithm Optional. The queuing
 * algorithm to apply when determining which events should be sent before the
 * given event. Defaults to {@link module:scheduler~MatrixScheduler.QUEUE_MESSAGES}.
 */
// eslint-disable-next-line camelcase
class MatrixScheduler {
  /**
   * Retries events up to 4 times using exponential backoff. This produces wait
   * times of 2, 4, 8, and 16 seconds (30s total) after which we give up. If the
   * failure was due to a rate limited request, the time specified in the error is
   * waited before being retried.
   * @param {MatrixEvent} event
   * @param {Number} attempts Number of attempts that have been made, including the one that just failed (ie. starting at 1)
   * @param {MatrixError} err
   * @return {Number}
   * @see module:scheduler~retryAlgorithm
   */
  // eslint-disable-next-line @typescript-eslint/naming-convention
  static RETRY_BACKOFF_RATELIMIT(event, attempts, err) {
    if (err.httpStatus === 400 || err.httpStatus === 403 || err.httpStatus === 401) {
      // client error; no amount of retrying with save you now.
      return -1;
    } // we ship with browser-request which returns { cors: rejected } when trying
    // with no connection, so if we match that, give up since they have no conn.


    if (err["cors"] === "rejected") {
      return -1;
    } // if event that we are trying to send is too large in any way then retrying won't help


    if (err.name === "M_TOO_LARGE") {
      return -1;
    }

    if (err.name === "M_LIMIT_EXCEEDED") {
      const waitTime = err.data.retry_after_ms;

      if (waitTime > 0) {
        return waitTime;
      }
    }

    if (attempts > 4) {
      return -1; // give up
    }

    return 1000 * Math.pow(2, attempts);
  }
  /**
   * Queues <code>m.room.message</code> events and lets other events continue
   * concurrently.
   * @param {MatrixEvent} event
   * @return {string}
   * @see module:scheduler~queueAlgorithm
   */
  // eslint-disable-next-line @typescript-eslint/naming-convention


  static QUEUE_MESSAGES(event) {
    // enqueue messages or events that associate with another event (redactions and relations)
    if (event.getType() === _event.EventType.RoomMessage || event.hasAssocation()) {
      // put these events in the 'message' queue.
      return "message";
    } // allow all other events continue concurrently.


    return null;
  } // queueName: [{
  //  event: MatrixEvent,  // event to send
  //  defer: Deferred,  // defer to resolve/reject at the END of the retries
  //  attempts: Number  // number of times we've called processFn
  // }, ...]


  constructor(retryAlgorithm = MatrixScheduler.RETRY_BACKOFF_RATELIMIT, queueAlgorithm = MatrixScheduler.QUEUE_MESSAGES) {
    this.retryAlgorithm = retryAlgorithm;
    this.queueAlgorithm = queueAlgorithm;

    _defineProperty(this, "queues", {});

    _defineProperty(this, "activeQueues", []);

    _defineProperty(this, "procFn", null);

    _defineProperty(this, "processQueue", queueName => {
      // get head of queue
      const obj = this.peekNextEvent(queueName);

      if (!obj) {
        // queue is empty. Mark as inactive and stop recursing.
        const index = this.activeQueues.indexOf(queueName);

        if (index >= 0) {
          this.activeQueues.splice(index, 1);
        }

        debuglog("Stopping queue '%s' as it is now empty", queueName);
        return;
      }

      debuglog("Queue '%s' has %s pending events", queueName, this.queues[queueName].length); // fire the process function and if it resolves, resolve the deferred. Else
      // invoke the retry algorithm.
      // First wait for a resolved promise, so the resolve handlers for
      // the deferred of the previously sent event can run.
      // This way enqueued relations/redactions to enqueued events can receive
      // the remove id of their target before being sent.

      Promise.resolve().then(() => {
        return this.procFn(obj.event);
      }).then(res => {
        // remove this from the queue
        this.removeNextEvent(queueName);
        debuglog("Queue '%s' sent event %s", queueName, obj.event.getId());
        obj.defer.resolve(res); // keep processing

        this.processQueue(queueName);
      }, err => {
        obj.attempts += 1; // ask the retry algorithm when/if we should try again

        const waitTimeMs = this.retryAlgorithm(obj.event, obj.attempts, err);
        debuglog("retry(%s) err=%s event_id=%s waitTime=%s", obj.attempts, err, obj.event.getId(), waitTimeMs);

        if (waitTimeMs === -1) {
          // give up (you quitter!)
          debuglog("Queue '%s' giving up on event %s", queueName, obj.event.getId()); // remove this from the queue

          this.removeNextEvent(queueName);
          obj.defer.reject(err); // process next event

          this.processQueue(queueName);
        } else {
          setTimeout(this.processQueue, waitTimeMs, queueName);
        }
      });
    });
  }
  /**
   * Retrieve a queue based on an event. The event provided does not need to be in
   * the queue.
   * @param {MatrixEvent} event An event to get the queue for.
   * @return {?Array<MatrixEvent>} A shallow copy of events in the queue or null.
   * Modifying this array will not modify the list itself. Modifying events in
   * this array <i>will</i> modify the underlying event in the queue.
   * @see MatrixScheduler.removeEventFromQueue To remove an event from the queue.
   */


  getQueueForEvent(event) {
    const name = this.queueAlgorithm(event);

    if (!name || !this.queues[name]) {
      return null;
    }

    return this.queues[name].map(function (obj) {
      return obj.event;
    });
  }
  /**
   * Remove this event from the queue. The event is equal to another event if they
   * have the same ID returned from event.getId().
   * @param {MatrixEvent} event The event to remove.
   * @return {boolean} True if this event was removed.
   */


  removeEventFromQueue(event) {
    const name = this.queueAlgorithm(event);

    if (!name || !this.queues[name]) {
      return false;
    }

    let removed = false;
    utils.removeElement(this.queues[name], element => {
      if (element.event.getId() === event.getId()) {
        // XXX we should probably reject the promise?
        // https://github.com/matrix-org/matrix-js-sdk/issues/496
        removed = true;
        return true;
      }
    });
    return removed;
  }
  /**
   * Set the process function. Required for events in the queue to be processed.
   * If set after events have been added to the queue, this will immediately start
   * processing them.
   * @param {module:scheduler~processFn} fn The function that can process events
   * in the queue.
   */


  setProcessFunction(fn) {
    this.procFn = fn;
    this.startProcessingQueues();
  }
  /**
   * Queue an event if it is required and start processing queues.
   * @param {MatrixEvent} event The event that may be queued.
   * @return {?Promise} A promise if the event was queued, which will be
   * resolved or rejected in due time, else null.
   */


  queueEvent(event) {
    const queueName = this.queueAlgorithm(event);

    if (!queueName) {
      return null;
    } // add the event to the queue and make a deferred for it.


    if (!this.queues[queueName]) {
      this.queues[queueName] = [];
    }

    const defer = utils.defer();
    this.queues[queueName].push({
      event: event,
      defer: defer,
      attempts: 0
    });
    debuglog("Queue algorithm dumped event %s into queue '%s'", event.getId(), queueName);
    this.startProcessingQueues();
    return defer.promise;
  }

  startProcessingQueues() {
    if (!this.procFn) return; // for each inactive queue with events in them

    Object.keys(this.queues).filter(queueName => {
      return this.activeQueues.indexOf(queueName) === -1 && this.queues[queueName].length > 0;
    }).forEach(queueName => {
      // mark the queue as active
      this.activeQueues.push(queueName); // begin processing the head of the queue

      debuglog("Spinning up queue: '%s'", queueName);
      this.processQueue(queueName);
    });
  }

  peekNextEvent(queueName) {
    const queue = this.queues[queueName];

    if (!Array.isArray(queue)) {
      return null;
    }

    return queue[0];
  }

  removeNextEvent(queueName) {
    const queue = this.queues[queueName];

    if (!Array.isArray(queue)) {
      return null;
    }

    return queue.shift();
  }

}

exports.MatrixScheduler = MatrixScheduler;

function debuglog(...args) {
  if (DEBUG) {
    _logger.logger.log(...args);
  }
}
/**
 * The retry algorithm to apply when retrying events. To stop retrying, return
 * <code>-1</code>. If this event was part of a queue, it will be removed from
 * the queue.
 * @callback retryAlgorithm
 * @param {MatrixEvent} event The event being retried.
 * @param {Number} attempts The number of failed attempts. This will always be
 * >= 1.
 * @param {MatrixError} err The most recent error message received when trying
 * to send this event.
 * @return {Number} The number of milliseconds to wait before trying again. If
 * this is 0, the request will be immediately retried. If this is
 * <code>-1</code>, the event will be marked as
 * {@link module:models/event.EventStatus.NOT_SENT} and will not be retried.
 */

/**
 * The queuing algorithm to apply to events. This function must be idempotent as
 * it may be called multiple times with the same event. All queues created are
 * serviced in a FIFO manner. To send the event ASAP, return <code>null</code>
 * which will not put this event in a queue. Events that fail to send that form
 * part of a queue will be removed from the queue and the next event in the
 * queue will be sent.
 * @callback queueAlgorithm
 * @param {MatrixEvent} event The event to be sent.
 * @return {string} The name of the queue to put the event into. If a queue with
 * this name does not exist, it will be created. If this is <code>null</code>,
 * the event is not put into a queue and will be sent concurrently.
 */

/**
 * The function to invoke to process (send) events in the queue.
 * @callback processFn
 * @param {MatrixEvent} event The event to send.
 * @return {Promise} Resolved/rejected depending on the outcome of the request.
 */