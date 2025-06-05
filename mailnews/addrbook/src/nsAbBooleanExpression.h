/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef COMM_MAILNEWS_ADDRBOOK_SRC_NSABBOOLEANEXPRESSION_H_
#define COMM_MAILNEWS_ADDRBOOK_SRC_NSABBOOLEANEXPRESSION_H_

#include "nsIAbBooleanExpression.h"
#include "nsString.h"
#include "nsTArray.h"

class nsAbBooleanConditionString : public nsIAbBooleanConditionString {
 public:
  NS_DECL_THREADSAFE_ISUPPORTS
  NS_DECL_NSIABBOOLEANCONDITIONSTRING

  nsAbBooleanConditionString();

 protected:
  virtual ~nsAbBooleanConditionString();
  nsAbBooleanConditionType mCondition;
  nsCString mName;
  nsString mValue;
};

class nsAbBooleanExpression : public nsIAbBooleanExpression {
 public:
  NS_DECL_THREADSAFE_ISUPPORTS
  NS_DECL_NSIABBOOLEANEXPRESSION

  nsAbBooleanExpression();

 protected:
  virtual ~nsAbBooleanExpression();
  nsAbBooleanOperationType mOperation;
  nsTArray<RefPtr<nsISupports>> mExpressions;
};

#endif  // COMM_MAILNEWS_ADDRBOOK_SRC_NSABBOOLEANEXPRESSION_H_
