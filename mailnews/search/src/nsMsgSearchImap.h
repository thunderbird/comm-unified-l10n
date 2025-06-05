/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef COMM_MAILNEWS_SEARCH_SRC_NSMSGSEARCHIMAP_H_
#define COMM_MAILNEWS_SEARCH_SRC_NSMSGSEARCHIMAP_H_

#include "nsMsgSearchAdapter.h"
#include "nsMsgSearchScopeTerm.h"

//-----------------------------------------------------------------------------
//---------- Adapter class for searching online (IMAP) folders ----------------
//-----------------------------------------------------------------------------

class nsMsgSearchOnlineMail : public nsMsgSearchAdapter {
 public:
  nsMsgSearchOnlineMail(nsMsgSearchScopeTerm* scope,
                        nsTArray<RefPtr<nsIMsgSearchTerm>> const& termList);
  virtual ~nsMsgSearchOnlineMail();

  NS_IMETHOD ValidateTerms() override;
  NS_IMETHOD Search(bool* aDone) override;
  NS_IMETHOD GetEncoding(char** result) override;
  NS_IMETHOD AddResultElement(nsIMsgDBHdr*) override;

  static nsresult Encode(nsCString& ppEncoding,
                         nsTArray<RefPtr<nsIMsgSearchTerm>> const& searchTerms,
                         const char16_t* destCharset,
                         nsIMsgSearchScopeTerm* scope);

 protected:
  nsCString m_encoding;
};

#endif  // COMM_MAILNEWS_SEARCH_SRC_NSMSGSEARCHIMAP_H_
