/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef _nsMsgGroupView_H_
#define _nsMsgGroupView_H_

#include "nsMsgDBView.h"
#include "nsInterfaceHashtable.h"

class nsIMsgThread;
class nsMsgGroupThread;

// Please note that if you override a method of nsMsgDBView,
// you will most likely want to check the m_viewFlags to see if
// we're grouping, and if not, call the base class implementation.
class nsMsgGroupView : public nsMsgDBView
{
public:
  nsMsgGroupView();
  virtual ~nsMsgGroupView();

  NS_IMETHOD Open(nsIMsgFolder *folder, nsMsgViewSortTypeValue sortType, nsMsgViewSortOrderValue sortOrder, nsMsgViewFlagsTypeValue viewFlags, PRInt32 *pCount);
  NS_IMETHOD OpenWithHdrs(nsISimpleEnumerator *aHeaders, nsMsgViewSortTypeValue aSortType, 
                                        nsMsgViewSortOrderValue aSortOrder, nsMsgViewFlagsTypeValue aViewFlags, 
                                        PRInt32 *aCount);
  NS_IMETHOD GetViewType(nsMsgViewTypeValue *aViewType);
  NS_IMETHOD CopyDBView(nsMsgDBView *aNewMsgDBView, nsIMessenger *aMessengerInstance,
                        nsIMsgWindow *aMsgWindow, nsIMsgDBViewCommandUpdater *aCmdUpdater);
  NS_IMETHOD Close();
  NS_IMETHOD OnHdrDeleted(nsIMsgDBHdr *aHdrDeleted, nsMsgKey aParentKey, PRInt32 aFlags, 
                            nsIDBChangeListener *aInstigator);
  NS_IMETHOD OnHdrFlagsChanged(nsIMsgDBHdr *aHdrChanged, PRUint32 aOldFlags, 
                                      PRUint32 aNewFlags, nsIDBChangeListener *aInstigator);

  NS_IMETHOD LoadMessageByViewIndex(nsMsgViewIndex aViewIndex);
  NS_IMETHOD GetCellProperties(PRInt32 aRow, nsITreeColumn *aCol, nsISupportsArray *aProperties);
  NS_IMETHOD GetRowProperties(PRInt32 aRow, nsISupportsArray *aProperties);
  NS_IMETHOD CellTextForColumn(PRInt32 aRow, const PRUnichar *aColumnName,
                               nsAString &aValue);
  NS_IMETHOD GetThreadContainingMsgHdr(nsIMsgDBHdr *msgHdr, nsIMsgThread **pThread);

protected:
  virtual void InternalClose();
  nsMsgGroupThread *AddHdrToThread(nsIMsgDBHdr *msgHdr, bool *pNewThread);
  virtual nsresult HashHdr(nsIMsgDBHdr *msgHdr, nsString& aHashKey);
  nsresult GetAgeBucketValue(nsIMsgDBHdr *aMsgHdr, PRUint32 * aAgeBucket, bool rcvDate = false); // helper function to get the age bucket for a hdr, useful when grouped by date
  nsresult OnNewHeader(nsIMsgDBHdr *newHdr, nsMsgKey aParentKey, bool /*ensureListed*/);
  virtual PRInt32 FindLevelInThread(nsIMsgDBHdr *msgHdr, nsMsgViewIndex startOfThread, nsMsgViewIndex viewIndex);
  nsMsgViewIndex ThreadIndexOfMsg(nsMsgKey msgKey, 
                                            nsMsgViewIndex msgIndex = nsMsgViewIndex_None,
                                            PRInt32 *pThreadCount = NULL,
                                            PRUint32 *pFlags = NULL);

  bool GroupViewUsesDummyRow(); // returns true if we are grouped by a sort attribute that uses a dummy row
  virtual nsresult RebuildView(nsMsgViewFlagsTypeValue newFlags);
  virtual nsMsgGroupThread *CreateGroupThread(nsIMsgDatabase *db);
  PR_STATIC_CALLBACK(PLDHashOperator) GroupTableCloner(const nsAString &aKey,
                                                       nsIMsgThread* aGroupThread,
                                                       void* aArg);

  nsInterfaceHashtable <nsStringHashKey, nsIMsgThread> m_groupsTable;
  PRExplodedTime m_lastCurExplodedTime;
  bool m_dayChanged;

private:
  nsString m_kTodayString;
  nsString m_kYesterdayString;
  nsString m_kLastWeekString;
  nsString m_kTwoWeeksAgoString;
  nsString m_kOldMailString;
};

#endif

