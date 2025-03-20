/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef PerFolderDatabase_h__
#define PerFolderDatabase_h__

#include "FolderDatabase.h"
#include "MessageDatabase.h"
#include "mozilla/RefPtr.h"
#include "mozilla/WeakPtr.h"
#include "mozIStorageStatement.h"
#include "nsCOMPtr.h"
#include "nsIDBChangeListener.h"
#include "nsIDBFolderInfo.h"
#include "nsIFolder.h"
#include "nsIMsgDatabase.h"
#include "nsIMsgFolder.h"
#include "nsIMsgThread.h"
#include "nsMsgEnumerator.h"

namespace mozilla::mailnews {

class MessageDatabase;

class PerFolderDatabase : public nsIMsgDatabase,
                          public SupportsWeakPtr,
                          public MessageListener {
 public:
  explicit PerFolderDatabase(FolderDatabase* folderDatabase,
                             MessageDatabase* messageDatabase,
                             uint64_t folderId, bool isNewsFolder)
      : mFolderDatabase(folderDatabase),
        mMessageDatabase(messageDatabase),
        mFolderId(folderId),
        mIsNewsFolder(isNewsFolder) {
    mMessageDatabase->AddMessageListener(this);
  }

  NS_DECL_ISUPPORTS
  NS_DECL_NSIDBCHANGEANNOUNCER
  NS_DECL_NSIMSGDATABASE

  // MessageListener functions.
  void OnMessageAdded(Message* message) override;
  void OnMessageRemoved(Message* message) override;

 private:
  virtual ~PerFolderDatabase() {};

  FolderDatabase* mFolderDatabase;
  MessageDatabase* mMessageDatabase;
  uint64_t mFolderId;
  bool mIsNewsFolder;
  nsTArray<nsMsgKey> mNewList;
  nsTObserverArray<RefPtr<nsIDBChangeListener>> mListeners;
};

class MessageEnumerator : public nsBaseMsgEnumerator {
 public:
  MessageEnumerator(MessageDatabase* messageDatabase,
                    mozIStorageStatement* aStmt);

  // nsIMsgEnumerator support.
  NS_IMETHOD GetNext(nsIMsgDBHdr** aItem) override;
  NS_IMETHOD HasMoreElements(bool* aResult) override;

 private:
  ~MessageEnumerator() {
    if (mStmt) mStmt->Finalize();
  }

  MessageDatabase* mMessageDatabase;
  nsCOMPtr<mozIStorageStatement> mStmt;
  bool mHasNext = false;
};

class ThreadEnumerator : public nsBaseMsgThreadEnumerator {
 public:
  ThreadEnumerator(MessageDatabase* messageDatabase,
                   mozIStorageStatement* aStmt);

  // nsIMsgEnumerator support.
  NS_IMETHOD GetNext(nsIMsgThread** item) override;
  NS_IMETHOD HasMoreElements(bool* hasNext) override;

 private:
  ~ThreadEnumerator() {
    if (mStmt) mStmt->Finalize();
  }

  MessageDatabase* mMessageDatabase;
  nsCOMPtr<mozIStorageStatement> mStmt;
  bool mHasNext = false;
};

class FolderInfo : public nsIDBFolderInfo {
 public:
  explicit FolderInfo(FolderDatabase* folderDatabase,
                      PerFolderDatabase* perFolderDatabase, uint64_t folderId);

  NS_DECL_ISUPPORTS
  NS_DECL_NSIDBFOLDERINFO

 private:
  virtual ~FolderInfo() {};

  FolderDatabase* mFolderDatabase;
  PerFolderDatabase* mPerFolderDatabase;
  nsCOMPtr<nsIFolder> mFolder;
};

}  // namespace mozilla::mailnews

#endif  // PerFolderDatabase_h__
