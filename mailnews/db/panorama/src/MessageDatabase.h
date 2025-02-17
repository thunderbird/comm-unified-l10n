/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef MessageDatabase_h__
#define MessageDatabase_h__

#include "MailNewsTypes2.h"
#include "nsIMessageDatabase.h"
#include "nsTObserverArray.h"
#include "nsTString.h"

namespace mozilla {
namespace mailnews {

/**
 * These are just stub classes so that we can get on with developing other
 * parts of the code. Nothing here is final!
 */

class Folder;

struct Message {
  nsMsgKey id;
  uint64_t folderId;
  nsCString messageId;
  PRTime date;
  nsCString sender;
  nsCString subject;
  uint64_t flags;
  nsCString tags;
};

class MessageListener {
 public:
  virtual void OnMessageAdded(Folder* folder, Message* message) = 0;
  virtual void OnMessageRemoved(Folder* folder, Message* message) = 0;
  virtual ~MessageListener() {};
};

class MessageDatabase : public nsIMessageDatabase {
 public:
  NS_DECL_THREADSAFE_ISUPPORTS
  NS_DECL_NSIMESSAGEDATABASE

 protected:
  virtual ~MessageDatabase() {};

 private:
  friend class DatabaseCore;

  MessageDatabase() {};
  void Startup();
  void Shutdown();

 private:
  friend class PerFolderDatabase;

  nsresult ListAllKeys(uint64_t aFolderId, nsTArray<nsMsgKey>& aKeys);
  nsresult GetMessage(nsMsgKey aKey, Message* aMessage);
  nsresult GetMessageFlag(nsMsgKey aKey, uint64_t aFlag, bool* aHasFlag);
  nsresult SetMessageFlag(nsMsgKey aKey, uint64_t aFlag, bool aSetFlag);
  nsresult MarkAllRead(uint64_t aFolderId, nsTArray<nsMsgKey>& aMarkedKeys);

 private:
  nsTObserverArray<MessageListener*> mMessageListeners;
};

}  // namespace mailnews
}  // namespace mozilla

#endif  // MessageDatabase_h__
