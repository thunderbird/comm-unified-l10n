/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef OEDebugLog_h___
#define OEDebugLog_h___

// Use PR_LOG for logging.
#include "prlog.h"
extern PRLogModuleInfo *OELOGMODULE;  // Logging module

#define IMPORT_LOG0(x)          PR_LOG(OELOGMODULE, PR_LOG_DEBUG, (x))
#define IMPORT_LOG1(x, y)       PR_LOG(OELOGMODULE, PR_LOG_DEBUG, (x, y))
#define IMPORT_LOG2(x, y, z)    PR_LOG(OELOGMODULE, PR_LOG_DEBUG, (x, y, z))
#define IMPORT_LOG3(a, b, c, d) PR_LOG(OELOGMODULE, PR_LOG_DEBUG, (a, b, c, d))



#endif /* OEDebugLog_h___ */
