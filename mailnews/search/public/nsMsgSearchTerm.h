/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef COMM_MAILNEWS_SEARCH_PUBLIC_NSMSGSEARCHTERM_H_
#define COMM_MAILNEWS_SEARCH_PUBLIC_NSMSGSEARCHTERM_H_

//---------------------------------------------------------------------------
// nsMsgSearchTerm specifies one criterion, e.g. name contains phil
//---------------------------------------------------------------------------

#include "nsCOMPtr.h"
#include "nsIMsgSearchSession.h"
#include "nsIMsgSearchTerm.h"

// needed to search for addresses in address books
#include "nsIAbDirectory.h"
#include "prtime.h"

#define EMPTY_MESSAGE_LINE(buf) \
  (buf[0] == '\r' || buf[0] == '\n' || buf[0] == '\0')

class nsMsgSearchTerm : public nsIMsgSearchTerm {
 public:
  nsMsgSearchTerm();
  nsMsgSearchTerm(nsMsgSearchAttribValue, nsMsgSearchOpValue,
                  nsIMsgSearchValue*, nsMsgSearchBooleanOperator,
                  const char* arbitraryHeader);

  NS_DECL_ISUPPORTS
  NS_DECL_NSIMSGSEARCHTERM

  nsresult DeStream(char*, int16_t length);
  nsresult DeStreamNew(char*, int16_t length);

  nsresult GetLocalTimes(PRTime, PRTime, PRExplodedTime&, PRExplodedTime&);

  bool IsBooleanOpAND() {
    return m_booleanOp == nsMsgSearchBooleanOp::BooleanAND ? true : false;
  }
  nsMsgSearchBooleanOperator GetBooleanOp() { return m_booleanOp; }
  // maybe should return nsString &   ??
  const char* GetArbitraryHeader() { return m_arbitraryHeader.get(); }

  static char* EscapeQuotesInStr(const char* str);

  nsMsgSearchAttribValue m_attribute;
  nsMsgSearchOpValue m_operator;
  nsMsgSearchValue m_value;

  // boolean operator to be applied to this search term and the search term
  // which precedes it.
  nsMsgSearchBooleanOperator m_booleanOp;

  // user specified string for the name of the arbitrary header to be used in
  // the search only has a value when m_attribute = OtherHeader!!!!
  nsCString m_arbitraryHeader;

  // db hdr property name to use - used when m_attribute = HdrProperty.
  nsCString m_hdrProperty;
  bool m_matchAll;       // does this term match all headers?
  nsCString m_customId;  // id of custom search term

 protected:
  virtual ~nsMsgSearchTerm();

  nsresult MatchString(const nsACString& stringToMatch, const char* charset,
                       bool* pResult);
  nsresult MatchString(const nsAString& stringToMatch, bool* pResult);
  nsresult OutputValue(nsCString& outputStr);
  nsresult ParseAttribute(char* inStream, nsMsgSearchAttribValue* attrib);
  nsresult ParseOperator(char* inStream, nsMsgSearchOpValue* value);
  nsresult ParseValue(char* inStream);
  /**
   * Switch a string to lower case, except for special database rows
   * that are not headers, but could be headers
   *
   * @param aValue  the string to switch
   */
  void ToLowerCaseExceptSpecials(nsACString& aValue);
  nsresult InitializeAddressBook();
  nsresult MatchInAddressBook(const nsAString& aAddress, bool* pResult);
  // fields used by search in address book
  nsCOMPtr<nsIAbDirectory> mDirectory;

  bool mBeginsGrouping;
  bool mEndsGrouping;
};

#endif  // COMM_MAILNEWS_SEARCH_PUBLIC_NSMSGSEARCHTERM_H_
