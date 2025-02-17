/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef COMM_PROTOCOLS_COMMON_SRC_OFFLINESTORAGE_H_
#define COMM_PROTOCOLS_COMMON_SRC_OFFLINESTORAGE_H_

#include "nsIChannel.h"
#include "nsIMsgFolder.h"
#include "nsIStreamListener.h"

/**
 * A stream listener that forwards method calls to another stream listener,
 * while substituting the request argument with the provided channel.
 *
 * Consumers are expected to call `OnStartRequest` themselves, so that their own
 * consumers are informed of the entire operation (which might involve e.g.
 * downloading the message from a remote server). Any call to `OnStartRequest`
 * after the first one is silently ignored.
 *
 * `ReadMessageFromStore` can be called from a channel ran within an
 * `nsIDocShell` to render the message. The stream listener that `nsIDocShell`
 * calls `AsyncOpen` with expects the request used in method calls to be
 * channel-like (i.e. it can be QI'd as an `nsIChannel`). Additionally, we want
 * to use `nsIInputStreamPump` to pump the data from the message content's input
 * stream (which we get from the message store) into the provided stream
 * listener. However, the default `nsIInputStreamPump` implementation calls the
 * stream listener methods with itself as the request argument, but only
 * implements `nsIRequest` (and not `nsIChannel`), causing the operation to
 * fail.
 *
 * Therefore we need this "proxy" listener to forward the method calls to the
 * listener `AsyncOpen` is originally provided with, while subsituting the
 * request arguments with an actual channel.
 *
 * Additionally, it's a good place to check for read errors when streaming a
 * message to the destination, and clearing malformed messages from the offline
 * storage (so they can be downloaded again).
 */
class OfflineMessageReadListener : public nsIStreamListener {
 public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSIREQUESTOBSERVER
  NS_DECL_NSISTREAMLISTENER

  OfflineMessageReadListener(nsIStreamListener* destination,
                             nsIChannel* channel, nsMsgKey msgKey,
                             nsIMsgFolder* folder)
      : mShouldStart(true),
        mDestination(destination),
        mChannel(channel),
        mMsgKey(msgKey),
        mFolder(folder) {};

  // Disable the default and copy constructors.
  OfflineMessageReadListener() = delete;
  OfflineMessageReadListener(const OfflineMessageReadListener&) = delete;

 protected:
  virtual ~OfflineMessageReadListener();

 private:
  // Whether `OnStartRequest` should be called.
  //
  // This boolean is set to `false` after the first `OnStartRequest` call to
  // avoid calling it more than once.
  bool mShouldStart;

  // The listener to which to forward any method call.
  nsCOMPtr<nsIStreamListener> mDestination;

  // The channel to use (instead of the original `nsIRequest`) when forwarding
  // method calls.
  nsCOMPtr<nsIChannel> mChannel;

  // The database key for the message we're currently reading, used to discard
  // the message in case of a read failure.
  nsMsgKey mMsgKey;

  // The folder in which the message we're currently reading resides, used to
  // discard the message in case of a read failure.
  nsCOMPtr<nsIMsgFolder> mFolder;
};

/**
 * A protocol-agnostic helper for reading a message from an offline store.
 *
 * This function is intended to be called from within a channel (and for this
 * channel to be passed as `srcChannel`). It looks up the content of the message
 * it's given, and streams its content to the given listener.
 *
 * If `convertData` is `true`, the message will be passed through our
 * `message/rfc822` converter, which output will be streamed to the listener
 * (instead of the raw RFC822 message). Depending on the query parameters in the
 * channel's URI, the converter will either output HTML for display, plain text
 * for showing the message's source, or, if the URI is for a specific part of
 * the message (specified via the `part=` parameter), serve the raw data for
 * that section.
 *
 * If an error arises from the process of reading the message, it is discarded
 * from the offline store (and the failure is propagated to any consumer) so it
 * can be downloaded again later.
 *
 * It returns an `nsIRequest` representing the read operation, that can be
 * cancelled or suspended as the consumer requests it.
 */
nsresult AsyncReadMessageFromStore(nsIMsgDBHdr* message,
                                   nsIStreamListener* streamListener,
                                   bool convertData, nsIChannel* srcChannel,
                                   nsIRequest** readRequest);

#endif
