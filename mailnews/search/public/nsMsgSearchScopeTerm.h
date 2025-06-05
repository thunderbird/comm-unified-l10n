/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef COMM_MAILNEWS_SEARCH_PUBLIC_NSMSGSEARCHSCOPETERM_H_
#define COMM_MAILNEWS_SEARCH_PUBLIC_NSMSGSEARCHSCOPETERM_H_

#include "nsMsgSearchCore.h"
#include "nsIMsgSearchAdapter.h"
#include "nsIMsgFolder.h"
#include "nsIMsgSearchAdapter.h"
#include "nsIMsgSearchSession.h"
#include "nsCOMPtr.h"
#include "nsIWeakReferenceUtils.h"

class nsMsgSearchScopeTerm : public nsIMsgSearchScopeTerm {
 public:
  nsMsgSearchScopeTerm(nsIMsgSearchSession*, nsMsgSearchScopeValue,
                       nsIMsgFolder*);
  nsMsgSearchScopeTerm();

  NS_DECL_ISUPPORTS
  NS_DECL_NSIMSGSEARCHSCOPETERM

  nsresult TimeSlice(bool* aDone);
  nsresult InitializeAdapter(
      nsTArray<RefPtr<nsIMsgSearchTerm>> const& termList);

  char* GetStatusBarName();

  nsMsgSearchScopeValue m_attribute;
  nsCOMPtr<nsIMsgFolder> m_folder;
  nsCOMPtr<nsIMsgSearchAdapter> m_adapter;
  nsCOMPtr<nsIInputStream> m_inputStream;  // for message bodies
  nsWeakPtr m_searchSession;
  bool m_searchServer;

 private:
  virtual ~nsMsgSearchScopeTerm();
};

#endif  // COMM_MAILNEWS_SEARCH_PUBLIC_NSMSGSEARCHSCOPETERM_H_
