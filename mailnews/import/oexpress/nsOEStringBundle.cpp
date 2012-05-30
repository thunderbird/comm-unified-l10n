/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
#include "prprf.h"
#include "prmem.h"
#include "nsCOMPtr.h"
#include "nsMsgUtils.h"
#include "nsIStringBundle.h"
#include "nsOEStringBundle.h"
#include "nsIServiceManager.h"
#include "nsIURI.h"
#include "mozilla/Services.h"

#define OE_MSGS_URL       "chrome://messenger/locale/oeImportMsgs.properties"

nsIStringBundle *  nsOEStringBundle::m_pBundle = nsnull;

nsIStringBundle *nsOEStringBundle::GetStringBundle(void)
{
  if (m_pBundle)
    return m_pBundle;

  char*        propertyURL = OE_MSGS_URL;
  nsIStringBundle*  sBundle = nsnull;

  nsCOMPtr<nsIStringBundleService> sBundleService =
    mozilla::services::GetStringBundleService();
  if (sBundleService) {
    sBundleService->CreateBundle(propertyURL, &sBundle);
  }

  m_pBundle = sBundle;

  return sBundle;
}


void nsOEStringBundle::GetStringByID(PRInt32 stringID, nsString& result)
{
  PRUnichar *ptrv = GetStringByID(stringID);
  result.Adopt(ptrv);
}

PRUnichar *nsOEStringBundle::GetStringByID(PRInt32 stringID)
{
  if (!m_pBundle)
    m_pBundle = GetStringBundle();

  if (m_pBundle) {
    PRUnichar *ptrv = nsnull;
    nsresult rv = m_pBundle->GetStringFromID(stringID, &ptrv);

    if (NS_SUCCEEDED(rv) && ptrv)
      return ptrv;
  }

  nsString resultString;
  resultString.AppendLiteral("[StringID ");
  resultString.AppendInt(stringID);
  resultString.AppendLiteral("?]");

  return ToNewUnicode(resultString);
}

void nsOEStringBundle::Cleanup(void)
{
  if (m_pBundle)
    m_pBundle->Release();
  m_pBundle = nsnull;
}
