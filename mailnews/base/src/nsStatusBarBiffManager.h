/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef COMM_MAILNEWS_BASE_SRC_NSSTATUSBARBIFFMANAGER_H_
#define COMM_MAILNEWS_BASE_SRC_NSSTATUSBARBIFFMANAGER_H_

#include "nsIStatusBarBiffManager.h"

#include "nsCOMPtr.h"
#include "nsISound.h"
#include "nsIObserver.h"

class nsStatusBarBiffManager : public nsIStatusBarBiffManager,
                               public nsIObserver {
 public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSIFOLDERLISTENER
  NS_DECL_NSISTATUSBARBIFFMANAGER
  NS_DECL_NSIOBSERVER

  nsStatusBarBiffManager();
  nsresult Init();

 private:
  virtual ~nsStatusBarBiffManager();

  bool mInitialized;
  int32_t mCurrentBiffState;
  nsCOMPtr<nsISound> mSound;
  nsresult PlayBiffSound(const char* aPref);
};

#endif  // COMM_MAILNEWS_BASE_SRC_NSSTATUSBARBIFFMANAGER_H_
