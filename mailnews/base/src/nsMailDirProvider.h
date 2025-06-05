/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef COMM_MAILNEWS_BASE_SRC_NSMAILDIRPROVIDER_H_
#define COMM_MAILNEWS_BASE_SRC_NSMAILDIRPROVIDER_H_

#include "nsIDirectoryService.h"
#include "nsSimpleEnumerator.h"
#include "nsCOMPtr.h"
#include "nsIFile.h"

class nsMailDirProvider final : public nsIDirectoryServiceProvider2 {
 public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSIDIRECTORYSERVICEPROVIDER
  NS_DECL_NSIDIRECTORYSERVICEPROVIDER2

 private:
  ~nsMailDirProvider() {}

  nsresult EnsureDirectory(nsIFile* aDirectory);

  class AppendingEnumerator final : public nsSimpleEnumerator {
   public:
    const nsID& DefaultInterface() override { return NS_GET_IID(nsIFile); }

    NS_DECL_NSISIMPLEENUMERATOR

    explicit AppendingEnumerator(nsISimpleEnumerator* aBase);

   private:
    ~AppendingEnumerator() override = default;
    nsCOMPtr<nsISimpleEnumerator> mBase;
    nsCOMPtr<nsIFile> mNext;
    nsCOMPtr<nsIFile> mNextWithLocale;
  };
};

#endif  // COMM_MAILNEWS_BASE_SRC_NSMAILDIRPROVIDER_H_
