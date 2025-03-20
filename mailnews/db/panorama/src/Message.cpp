/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "Message.h"

#include "MessageDatabase.h"
#include "mozilla/Components.h"
#include "nsIDatabaseCore.h"
#include "nsIFolder.h"
#include "nsIFolderDatabase.h"
#include "nsIMsgAccountManager.h"
#include "nsMsgMessageFlags.h"
#include "nsString.h"
#include "prtime.h"

namespace mozilla::mailnews {

NS_IMPL_ISUPPORTS(Message, nsIMsgDBHdr)

Message::Message(MessageDatabase* aDatabase, mozIStorageStatement* aStmt)
    : Message(aDatabase) {
  uint32_t len;
  mId = aStmt->AsInt64(0);
  mFolderId = aStmt->AsInt64(1);
  mMessageId = aStmt->AsSharedUTF8String(2, &len);
  mDate = aStmt->AsDouble(3);
  mSender = aStmt->AsSharedUTF8String(4, &len);
  mSubject = aStmt->AsSharedUTF8String(5, &len);
  mFlags = aStmt->AsInt64(6);
  mTags = aStmt->AsSharedUTF8String(7, &len);
}

NS_IMETHODIMP Message::SetStringProperty(const char* propertyName,
                                         const nsACString& propertyValue) {
  return mDatabase->SetMessageProperty(mId, nsCString(propertyName),
                                       propertyValue);
}
NS_IMETHODIMP Message::GetStringProperty(const char* propertyName,
                                         nsACString& propertyValue) {
  return mDatabase->GetMessageProperty(mId, nsCString(propertyName),
                                       propertyValue);
}
NS_IMETHODIMP Message::GetUint32Property(const char* propertyName,
                                         uint32_t* propertyValue) {
  return mDatabase->GetMessageProperty(mId, nsCString(propertyName),
                                       propertyValue);
}
NS_IMETHODIMP Message::SetUint32Property(const char* propertyName,
                                         uint32_t propertyValue) {
  return mDatabase->SetMessageProperty(mId, nsCString(propertyName),
                                       propertyValue);
}
NS_IMETHODIMP Message::GetProperties(nsTArray<nsCString>& properties) {
  return mDatabase->GetMessageProperties(mId, properties);
}
NS_IMETHODIMP Message::GetIsRead(bool* aIsRead) {
  *aIsRead = mFlags & nsMsgMessageFlags::Read;
  return NS_OK;
}
NS_IMETHODIMP Message::GetIsFlagged(bool* aIsFlagged) {
  *aIsFlagged = mFlags & nsMsgMessageFlags::Marked;
  return NS_OK;
}
NS_IMETHODIMP Message::GetIsKilled(bool* aIsKilled) {
  *aIsKilled = mFlags & nsMsgMessageFlags::Ignored;
  return NS_OK;
}
NS_IMETHODIMP Message::MarkRead(bool aRead) {
  if (aRead) {
    mFlags |= nsMsgMessageFlags::Read;
  } else {
    mFlags &= ~nsMsgMessageFlags::Read;
  }
  return mDatabase->SetMessageFlag(mId, nsMsgMessageFlags::Read, aRead);
}
NS_IMETHODIMP Message::MarkFlagged(bool aFlagged) {
  if (aFlagged) {
    mFlags |= nsMsgMessageFlags::Marked;
  } else {
    mFlags &= ~nsMsgMessageFlags::Marked;
  }
  return mDatabase->SetMessageFlag(mId, nsMsgMessageFlags::Marked, aFlagged);
}
NS_IMETHODIMP Message::MarkHasAttachments(bool aHasAttachments) {
  if (aHasAttachments) {
    mFlags |= nsMsgMessageFlags::Attachment;
  } else {
    mFlags &= ~nsMsgMessageFlags::Attachment;
  }
  return mDatabase->SetMessageFlag(mId, nsMsgMessageFlags::Attachment,
                                   aHasAttachments);
}
NS_IMETHODIMP Message::GetPriority(nsMsgPriorityValue* aPriority) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::SetPriority(nsMsgPriorityValue aPriority) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::GetFlags(uint32_t* aFlags) {
  *aFlags = mFlags;
  return NS_OK;
}
NS_IMETHODIMP Message::SetFlags(uint32_t aFlags) {
  mFlags = aFlags;
  return mDatabase->SetMessageFlags(mId, aFlags);
}
NS_IMETHODIMP Message::OrFlags(uint32_t aFlags, uint32_t* aOutFlags) {
  // Just because you *can*, doesn't mean you *should*.
  // mFlags might be out of date.
  mFlags |= aFlags;
  *aOutFlags = mFlags;
  return mDatabase->SetMessageFlags(mId, mFlags);
}
NS_IMETHODIMP Message::AndFlags(uint32_t aFlags, uint32_t* aOutFlags) {
  // Just because you *can*, doesn't mean you *should*.
  // mFlags might be out of date.
  mFlags &= aFlags;
  *aOutFlags = mFlags;
  return mDatabase->SetMessageFlags(mId, mFlags);
}
NS_IMETHODIMP Message::GetThreadId(nsMsgKey* aThreadId) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::SetThreadId(nsMsgKey aThreadId) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::GetMessageKey(nsMsgKey* aMessageKey) {
  *aMessageKey = mId;
  return NS_OK;
}
NS_IMETHODIMP Message::SetMessageKey(nsMsgKey aMessageKey) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::GetThreadParent(nsMsgKey* aThreadParent) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::SetThreadParent(nsMsgKey aThreadParent) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::GetMessageSize(uint32_t* aMessageSize) {
  return GetUint32Property("messageSize", aMessageSize);
}
NS_IMETHODIMP Message::SetMessageSize(uint32_t aMessageSize) {
  return SetUint32Property("messageSize", aMessageSize);
}
NS_IMETHODIMP Message::GetLineCount(uint32_t* aLineCount) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::SetLineCount(uint32_t aLineCount) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::GetStoreToken(nsACString& aStoreToken) {
  return GetStringProperty("storeToken", aStoreToken);
}
NS_IMETHODIMP Message::SetStoreToken(const nsACString& aStoreToken) {
  return SetStringProperty("storeToken", aStoreToken);
}
NS_IMETHODIMP Message::GetOfflineMessageSize(uint32_t* aOfflineMessageSize) {
  return GetUint32Property("offlineMessageSize", aOfflineMessageSize);
}
NS_IMETHODIMP Message::SetOfflineMessageSize(uint32_t aOfflineMessageSize) {
  return SetUint32Property("offlineMessageSize", aOfflineMessageSize);
}
NS_IMETHODIMP Message::GetDate(PRTime* aDate) {
  *aDate = mDate;
  return NS_OK;
}
NS_IMETHODIMP Message::SetDate(PRTime aDate) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::GetDateInSeconds(uint32_t* aDateInSeconds) {
  *aDateInSeconds = mDate / PR_USEC_PER_SEC;
  return NS_OK;
}
NS_IMETHODIMP Message::GetMessageId(nsACString& aMessageId) {
  aMessageId.Assign(mMessageId);
  return NS_OK;
}
NS_IMETHODIMP Message::SetMessageId(const nsACString& aMessageId) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::GetCcList(nsACString& aCcList) {
  // TODO: Actually implement. This is only here to fix message display.
  aCcList.Truncate();
  return NS_OK;
}
NS_IMETHODIMP Message::SetCcList(const nsACString& aCcList) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::GetBccList(nsACString& aBccList) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::SetBccList(const nsACString& aBccList) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::GetAuthor(nsACString& aAuthor) {
  aAuthor.Assign(mSender);
  return NS_OK;
}
NS_IMETHODIMP Message::SetAuthor(const nsACString& aAuthor) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::GetSubject(nsACString& aSubject) {
  aSubject.Assign(mSubject);
  return NS_OK;
}
NS_IMETHODIMP Message::SetSubject(const nsACString& aSubject) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::GetRecipients(nsACString& aRecipients) {
  // TODO: Actually implement. This is only here to fix message display.
  aRecipients.Truncate();
  return NS_OK;
}
NS_IMETHODIMP Message::SetRecipients(const nsACString& aRecipients) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::SetReferences(const nsACString& references) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::GetNumReferences(uint16_t* aNumReferences) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::GetStringReference(int32_t refNum, nsACString& _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::GetMime2DecodedAuthor(nsAString& aMime2DecodedAuthor) {
  aMime2DecodedAuthor.Assign(NS_ConvertUTF8toUTF16(mSender));
  return NS_OK;
}
NS_IMETHODIMP Message::GetMime2DecodedSubject(nsAString& aMime2DecodedSubject) {
  aMime2DecodedSubject.Assign(NS_ConvertUTF8toUTF16(mSubject));
  return NS_OK;
}
NS_IMETHODIMP Message::GetMime2DecodedRecipients(
    nsAString& aMime2DecodedRecipients) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::GetAuthorCollationKey(nsTArray<uint8_t>& _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::GetSubjectCollationKey(nsTArray<uint8_t>& _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::GetRecipientsCollationKey(nsTArray<uint8_t>& _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::GetCharset(nsACString& aCharset) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::SetCharset(const nsACString& aCharset) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::GetEffectiveCharset(nsACString& aEffectiveCharset) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::GetAccountKey(nsACString& aAccountKey) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::SetAccountKey(const nsACString& aAccountKey) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::GetFolder(nsIMsgFolder** aFolder) {
  nsCOMPtr<nsIDatabaseCore> core =
      do_GetService("@mozilla.org/msgDatabase/msgDBService;1");
  nsCOMPtr<nsIFolderDatabase> folderDatabase;
  nsresult rv = core->GetFolders(getter_AddRefs(folderDatabase));
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<nsIFolder> folder;
  rv = folderDatabase->GetFolderById(mFolderId, getter_AddRefs(folder));
  NS_ENSURE_SUCCESS(rv, rv);

  return folderDatabase->GetMsgFolderForFolder(folder, aFolder);
}
NS_IMETHODIMP Message::GetUidOnServer(uint32_t* aUidOnServer) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_IMETHODIMP Message::SetUidOnServer(uint32_t aUidOnServer) {
  return NS_ERROR_NOT_IMPLEMENTED;
}

}  // namespace mozilla::mailnews
