/* -*- Mode: C; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef COMM_MAILNEWS_MIME_EMITTERS_NSMIMEPLAINEMITTER_H_
#define COMM_MAILNEWS_MIME_EMITTERS_NSMIMEPLAINEMITTER_H_

#include "prio.h"
#include "nsMimeBaseEmitter.h"

class nsMimePlainEmitter : public nsMimeBaseEmitter {
 public:
  nsMimePlainEmitter();
  virtual ~nsMimePlainEmitter(void);

  // Header handling routines.
  NS_IMETHOD StartHeader(bool rootMailHeader, bool headerOnly,
                         const char* msgID, const char* outCharset) override;
  NS_IMETHOD AddHeaderField(const char* field, const char* value) override;
  NS_IMETHOD EndHeader(const nsACString& buf) override;

  NS_IMETHOD WriteBody(const nsACString& buf, uint32_t* amountWritten) override;
};

#endif  // COMM_MAILNEWS_MIME_EMITTERS_NSMIMEPLAINEMITTER_H_
