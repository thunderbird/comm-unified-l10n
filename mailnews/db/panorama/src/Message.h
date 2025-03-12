/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef Message_h__
#define Message_h__

#include "mozIStorageStatement.h"
#include "nsIMsgHdr.h"
#include "nsTString.h"

namespace mozilla::mailnews {

class MessageDatabase;

#define MESSAGE_SQL_FIELDS \
  "id, folderId, messageId, date, sender, subject, flags, tags"_ns

class Message : public nsIMsgDBHdr {
 public:
  Message() = delete;
  explicit Message(MessageDatabase* aDatabase) : mDatabase(aDatabase) {}
  explicit Message(MessageDatabase* aDatabase, mozIStorageStatement* aStmt);

  NS_DECL_ISUPPORTS
  NS_DECL_NSIMSGDBHDR

  nsMsgKey mId;
  uint64_t mFolderId;
  nsAutoCString mMessageId;
  PRTime mDate;
  nsAutoCString mSender;
  nsAutoCString mSubject;
  uint64_t mFlags;
  nsAutoCString mTags;

 protected:
  virtual ~Message() {};

 private:
  MessageDatabase* mDatabase;
};

}  // namespace mozilla::mailnews

#endif  // Message_h__
