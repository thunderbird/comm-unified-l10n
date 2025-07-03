/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef COMM_MAILNEWS_BASE_SRC_NSMSGQUICKSEARCHDBVIEW_H_
#define COMM_MAILNEWS_BASE_SRC_NSMSGQUICKSEARCHDBVIEW_H_

#include "nsMsgThreadedDBView.h"
#include "nsIMsgSearchNotify.h"
#include "nsIMsgSearchSession.h"
#include "nsCOMArray.h"
#include "nsIMsgHdr.h"
#include "nsIWeakReferenceUtils.h"

class nsMsgQuickSearchDBView : public nsMsgThreadedDBView,
                               public nsIMsgSearchNotify {
 public:
  nsMsgQuickSearchDBView();

  NS_DECL_ISUPPORTS_INHERITED
  NS_DECL_NSIMSGSEARCHNOTIFY

  NS_IMETHOD Open(nsIMsgFolder* folder, nsMsgViewSortTypeValue sortType,
                  nsMsgViewSortOrderValue sortOrder,
                  nsMsgViewFlagsTypeValue viewFlags) override;
  NS_IMETHOD OpenWithHdrs(nsIMsgEnumerator* aHeaders,
                          nsMsgViewSortTypeValue aSortType,
                          nsMsgViewSortOrderValue aSortOrder,
                          nsMsgViewFlagsTypeValue aViewFlags) override;
  NS_IMETHOD CloneDBView(nsIMessenger* aMessengerInstance,
                         nsIMsgWindow* aMsgWindow,
                         nsIMsgDBViewCommandUpdater* aCommandUpdater,
                         nsIMsgDBView** _retval) override;
  NS_IMETHOD CopyDBView(nsMsgDBView* aNewMsgDBView,
                        nsIMessenger* aMessengerInstance,
                        nsIMsgWindow* aMsgWindow,
                        nsIMsgDBViewCommandUpdater* aCmdUpdater) override;
  NS_IMETHOD DoCommand(nsMsgViewCommandTypeValue aCommand) override;
  NS_IMETHOD GetViewType(nsMsgViewTypeValue* aViewType) override;
  NS_IMETHOD SetViewFlags(nsMsgViewFlagsTypeValue aViewFlags) override;
  NS_IMETHOD SetSearchSession(nsIMsgSearchSession* aSearchSession) override;
  NS_IMETHOD GetSearchSession(nsIMsgSearchSession** aSearchSession) override;
  NS_IMETHOD OnHdrFlagsChanged(nsIMsgDBHdr* aHdrChanged, uint32_t aOldFlags,
                               uint32_t aNewFlags,
                               nsIDBChangeListener* aInstigator) override;
  NS_IMETHOD OnHdrPropertyChanged(nsIMsgDBHdr* aHdrToChange,
                                  const nsACString& property, bool aPreChange,
                                  uint32_t* aStatus,
                                  nsIDBChangeListener* aInstigator) override;
  NS_IMETHOD OnHdrDeleted(nsIMsgDBHdr* aHdrDeleted, nsMsgKey aParentKey,
                          int32_t aFlags,
                          nsIDBChangeListener* aInstigator) override;
  NS_IMETHOD GetNumMsgsInView(int32_t* aNumMsgs) override;

 protected:
  virtual ~nsMsgQuickSearchDBView();
  nsWeakPtr m_searchSession;
  nsTArray<nsMsgKey> m_origKeys;
  bool m_usingCachedHits;
  bool m_cacheEmpty;
  nsCOMArray<nsIMsgDBHdr> m_hdrHits;
  virtual nsresult AddHdr(nsIMsgDBHdr* msgHdr,
                          nsMsgViewIndex* resultIndex = nullptr) override;
  virtual nsresult OnNewHeader(nsIMsgDBHdr* newHdr, nsMsgKey aParentKey,
                               bool ensureListed) override;
  virtual nsresult DeleteMessages(nsIMsgWindow* window,
                                  nsTArray<nsMsgViewIndex> const& selection,
                                  bool deleteStorage) override;
  virtual nsresult SortThreads(nsMsgViewSortTypeValue sortType,
                               nsMsgViewSortOrderValue sortOrder) override;
  virtual nsresult GetFirstMessageHdrToDisplayInThread(
      nsIMsgThread* threadHdr, nsIMsgDBHdr** result) override;
  virtual nsresult ExpansionDelta(nsMsgViewIndex index,
                                  int32_t* expansionDelta) override;
  virtual nsresult ListCollapsedChildren(
      nsMsgViewIndex viewIndex,
      nsTArray<RefPtr<nsIMsgDBHdr>>& messageArray) override;
  virtual nsresult ListIdsInThread(nsIMsgThread* threadHdr,
                                   nsMsgViewIndex startOfThreadViewIndex,
                                   uint32_t* pNumListed) override;
  virtual nsresult ListIdsInThreadOrder(nsIMsgThread* threadHdr,
                                        nsMsgKey parentKey, uint32_t level,
                                        nsMsgViewIndex* viewIndex,
                                        uint32_t* pNumListed) override;
  virtual nsresult ListIdsInThreadOrder(nsIMsgThread* threadHdr,
                                        nsMsgKey parentKey, uint32_t level,
                                        uint32_t callLevel, nsMsgKey keyToSkip,
                                        nsMsgViewIndex* viewIndex,
                                        uint32_t* pNumListed);
  virtual nsresult GetMessageEnumerator(nsIMsgEnumerator** enumerator) override;
  void SavePreSearchInfo();
  void ClearPreSearchInfo();
};

#endif  // COMM_MAILNEWS_BASE_SRC_NSMSGQUICKSEARCHDBVIEW_H_
