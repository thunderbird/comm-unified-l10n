/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "MailNewsTypes.h"
#include "msgCore.h"
#include "nsIChannel.h"
#include "nsParseMailbox.h"
#include "nsIMsgHdr.h"
#include "nsIMsgDatabase.h"
#include "nsMsgMessageFlags.h"
#include "nsIInputStream.h"
#include "nsMsgLocalFolderHdrs.h"
#include "nsIMailboxUrl.h"
#include "nsNetUtil.h"
#include "nsMsgFolderFlags.h"
#include "nsIMsgFolder.h"
#include "nsIMsgFolderNotificationService.h"
#include "nsIMsgMailNewsUrl.h"
#include "nsIMsgFilter.h"
#include "nsIMsgFilterPlugin.h"
#include "nsIMsgFilterHitNotify.h"
#include "nsIMsgLocalMailFolder.h"
#include "nsMsgUtils.h"
#include "prprf.h"
#include "prmem.h"
#include "nsMsgSearchCore.h"
#include "nsMailHeaders.h"
#include "nsIMsgMailSession.h"
#include "nsIPrefBranch.h"
#include "nsIPrefService.h"
#include "nsIMsgComposeService.h"
#include "nsIMsgCopyService.h"
#include "nsICryptoHash.h"
#include "nsIMsgFilterCustomAction.h"
#include <ctype.h>
#include "nsIMsgPluggableStore.h"
#include "nsReadableUtils.h"
#include "nsURLHelper.h"  // For net_ParseContentType().
#include "mozilla/Span.h"
#include "HeaderReader.h"

using namespace mozilla;

extern LazyLogModule FILTERLOGMODULE;

// Attempt to extract a timestamp from a "Recieved:" header value, e.g:
// "from bar.com by foo.com ; Thu, 21 May 1998 05:33:29 -0700".
// Returns 0 if no timestamp could be extracted.
static PRTime TimestampFromReceived(nsACString const& received) {
  int32_t sep = received.RFindChar(';');
  if (sep == kNotFound) {
    return 0;
  }
  auto dateStr = Substring(received, sep + 1);
  PRTime time;
  if (PR_ParseTimeString(PromiseFlatCString(dateStr).get(), false, &time) !=
      PR_SUCCESS) {
    return 0;
  }
  return time;
}

static nsCString RemoveAngleBrackets(nsACString const& s) {
  size_t len = s.Length();
  if (len >= 2 && s[0] == '<' && s[len - 1] == '>') {
    return nsCString(Substring(s, 1, len - 2));
  }
  return nsCString(s);
}

// NOTE:
// Does not attempt to use fallback timestamps.
//  - RawHdr.date is from the "Date": header, else 0.
//  - RawHdr.dateReceived is from the first "Received:" header, else 0.
// Any fallback policy (e.g. to mbox timestamp or PR_Now()) is left up to
// the caller.
//
// Does not strip "Re:" off subject.
//
// Does not generate missing Message-Id (nsParseMailMessageState uses an
// md5sum of the header block).
//
// Does not strip surrounding '<' and '>' from Message-Id.
//
RawHdr ParseMsgHeaders(mozilla::Span<const char> raw) {
  // NOTE: old code aggregates multiple To: and Cc: header occurrences.
  // Turns them into comma-separated lists.
  // See nsParseMailMessageState::FinalizeHeaders().

  RawHdr out;
  HeaderReader rdr;

  // RFC5322 says 0 or 1 occurrences for each of "To:" and "Cc:", but we'll
  // aggregate multiple.
  AutoTArray<nsCString, 1> toValues;  // Collect "To:" values.
  AutoTArray<nsCString, 1> ccValues;  // Collect "Cc:" values.
  nsAutoCString newsgroups;           // "Newsgroups:" value.
  nsAutoCString mozstatus;
  nsAutoCString mozstatus2;
  nsAutoCString status;  // "Status:" value
  rdr.Parse(raw, [&](HeaderReader::Hdr const& hdr) -> bool {
    auto const& n = hdr.Name(raw);
    // Alphabetical, because why not?
    if (n.LowerCaseEqualsLiteral("bcc")) {
      out.bccList = hdr.Value(raw);
    } else if (n.LowerCaseEqualsLiteral("cc")) {
      // Collect multiple "Cc:" values.
      ccValues.AppendElement(hdr.Value(raw));
    } else if (n.LowerCaseEqualsLiteral("content-type")) {
      nsAutoCString contentType;
      nsAutoCString charset;
      bool hasCharset;
      net_ParseContentType(hdr.Value(raw), contentType, charset, &hasCharset);
      if (hasCharset) {
        out.charset = charset;
      }
      if (contentType.LowerCaseEqualsLiteral("multpart/mixed")) {
        out.flags |= nsMsgMessageFlags::Attachment;
      }
    } else if (n.LowerCaseEqualsLiteral("date")) {
      nsCString dateStr = hdr.Value(raw);
      PRTime time;
      if (PR_ParseTimeString(dateStr.get(), false, &time) == PR_SUCCESS) {
        out.date = time;
      }
    } else if (n.LowerCaseEqualsLiteral("disposition-notification-to")) {
      // TODO: should store value? (nsParseMailMessageState doesn't)
      // flags |= nsMsgMessageFlags::MDNReportNeeded;
    } else if (n.LowerCaseEqualsLiteral("delivery-date")) {
      // NOTE: nsParseMailMessageState collects this and uses it as a fallback
      // if it can't get a receipt timestamp from "Received":.
      // But it seems pretty obscure, so leaving it out.
      // (It seems to be a X.400 -> RFC 822 mapping).
    } else if (n.LowerCaseEqualsLiteral("from")) {
      // "From:" takes precedence over "Sender:".
      out.sender = hdr.Value(raw);
    } else if (n.LowerCaseEqualsLiteral("in-reply-to")) {
      // "In-Reply-To:" used as a fallback for missing "References:".
      if (out.references.IsEmpty()) {
        out.references = hdr.Value(raw);
      }
    } else if (n.LowerCaseEqualsLiteral("message-id")) {
      out.messageId = RemoveAngleBrackets(hdr.Value(raw));
    } else if (n.LowerCaseEqualsLiteral("newsgroups")) {
      // We _might_ need this for recipients (see below).
      newsgroups = hdr.Value(raw);
    } else if (n.LowerCaseEqualsLiteral("original-recipient")) {
      // NOTE: unused in nsParseMailMessageState.
    } else if (n.LowerCaseEqualsLiteral("priority")) {
      // Treat "Priority:" and "X-Priority:" the same way.
      NS_MsgGetPriorityFromString(hdr.Value(raw).get(), out.priority);
    } else if (n.LowerCaseEqualsLiteral("references")) {
      // "In-Reply-To:" used as a fallback for missing "References:".
      out.references = hdr.Value(raw);
    } else if (n.LowerCaseEqualsLiteral("return-path")) {
      // NOTE: unused in nsParseMailMessageState.
    } else if (n.LowerCaseEqualsLiteral("return-receipt-to")) {
      // NOTE: nsParseMailMessageState treats "Return-Receipt-To:" as
      // "Disposition-Notification-To:".
      // flags |= nsMsgMessageFlags::MDNReportNeeded;
    } else if (n.LowerCaseEqualsLiteral("received")) {
      // Record the timestamp from the first (closest) "Received:" header.
      // (See RFC 5321).
      if (out.dateReceived == 0) {
        out.dateReceived = TimestampFromReceived(hdr.Value(raw));
      }
    } else if (n.LowerCaseEqualsLiteral("reply-to")) {
      out.replyTo = hdr.Value(raw);
    } else if (n.LowerCaseEqualsLiteral("sender")) {
      // "From:" takes precedence over "Sender:".
      if (out.sender.IsEmpty()) {
        out.sender = hdr.Value(raw);
      }
    } else if (n.LowerCaseEqualsLiteral("status")) {
      status = hdr.Value(raw);
    } else if (n.LowerCaseEqualsLiteral("subject")) {
      out.subject = hdr.Value(raw);
    } else if (n.LowerCaseEqualsLiteral("to")) {
      toValues.AppendElement(hdr.Value(raw));
    } else if (n.LowerCaseEqualsLiteral("x-account-key")) {
      out.accountKey = hdr.Value(raw);
    } else if (n.LowerCaseEqualsLiteral("x-mozilla-keys")) {
      out.keywords = hdr.Value(raw);
    } else if (n.LowerCaseEqualsLiteral("x-mozilla-status")) {
      mozstatus = hdr.Value(raw);
    } else if (n.LowerCaseEqualsLiteral("x-mozilla-status2")) {
      mozstatus2 = hdr.Value(raw);
    } else if (n.LowerCaseEqualsLiteral("x-priority")) {
      // Treat "Priority:" and "X-Priority:" the same way.
      NS_MsgGetPriorityFromString(hdr.Value(raw).get(), out.priority);
    } else {
      // TODO: check custom keys.
    }
    return true;  // Keep going.
  });

  // Merge multiple "Cc:" values.
  out.ccList = StringJoin(","_ns, ccValues);

  // Fill in recipients, with fallbacks.
  if (!toValues.IsEmpty()) {
    out.recipients = StringJoin(","_ns, toValues);
  } else if (!out.ccList.IsEmpty()) {
    out.recipients = out.ccList;
  } else if (!newsgroups.IsEmpty()) {
    // In the case where the recipient is a newsgroup, truncate the string
    // at the first comma.  This is used only for presenting the thread
    // list, and newsgroup lines tend to be long and non-shared.
    auto splitter = newsgroups.Split(',');
    auto first = splitter.begin();
    if (first != splitter.end()) {
      out.recipients = *first;
    }
  }

  // Figure out flags from assorted headers.
  out.flags = 0;
  if (mozstatus.Length() == 4 && MsgIsHex(mozstatus.get(), 4)) {
    uint32_t xflags = MsgUnhex(mozstatus.get(), 4);
    // Mask out a few "phantom" flags, which shouldn't be persisted.
    xflags &= ~nsMsgMessageFlags::RuntimeOnly;
    out.flags |= xflags;
  } else if (!status.IsEmpty()) {
    // Parse a little bit of the Berkeley Mail "Status:" header.
    // NOTE: Can't find any proper documentation on "Status:".
    // Maybe it's time to ditch it?
    if (status.FindCharInSet("RrO"_ns) != kNotFound) {
      out.flags |= nsMsgMessageFlags::Read;
    }
    if (status.FindCharInSet("NnUu"_ns) != kNotFound) {
      out.flags &= ~nsMsgMessageFlags::Read;
    }
    // Ignore 'd'/'D' (deleted)
  }
  if (mozstatus.Length() == 8 && MsgIsHex(mozstatus.get(), 8)) {
    uint32_t xflags = MsgUnhex(mozstatus.get(), 8);
    // Mask out a few "phantom" flags, which shouldn't be persisted.
    xflags &= ~nsMsgMessageFlags::RuntimeOnly;
    // Only upper 16 bits used for "X-Mozilla-Status2:".
    xflags |= xflags & 0xFFFF0000;
    out.flags |= xflags;
  }

  // TODO: nsParseMailMessageState leaves replyTo unset if "Reply-To:" is
  // same as "Sender:" or "From:". Not sure we should implement that or not.

  // TODO: disposition-notification-to handling. Some flags cancel out.
  // nsParseMailMessageState doesn't seem to store
  // "Disposition-Notification-To" value, but we support sending receipt
  // notifications, right? So how is it implemented? Investigation needed.

  // TODO: custom header storage
  return out;
}

NS_IMETHODIMP
nsParseMailMessageState::OnHdrPropertyChanged(
    nsIMsgDBHdr* aHdrToChange, const nsACString& property, bool aPreChange,
    uint32_t* aStatus, nsIDBChangeListener* aInstigator) {
  return NS_OK;
}

NS_IMETHODIMP
nsParseMailMessageState::OnHdrFlagsChanged(nsIMsgDBHdr* aHdrChanged,
                                           uint32_t aOldFlags,
                                           uint32_t aNewFlags,
                                           nsIDBChangeListener* aInstigator) {
  return NS_OK;
}

NS_IMETHODIMP
nsParseMailMessageState::OnHdrDeleted(nsIMsgDBHdr* aHdrChanged,
                                      nsMsgKey aParentKey, int32_t aFlags,
                                      nsIDBChangeListener* aInstigator) {
  return NS_OK;
}

NS_IMETHODIMP
nsParseMailMessageState::OnHdrAdded(nsIMsgDBHdr* aHdrAdded, nsMsgKey aParentKey,
                                    int32_t aFlags,
                                    nsIDBChangeListener* aInstigator) {
  return NS_OK;
}

/* void OnParentChanged (in nsMsgKey aKeyChanged, in nsMsgKey oldParent, in
 * nsMsgKey newParent, in nsIDBChangeListener aInstigator); */
NS_IMETHODIMP
nsParseMailMessageState::OnParentChanged(nsMsgKey aKeyChanged,
                                         nsMsgKey oldParent, nsMsgKey newParent,
                                         nsIDBChangeListener* aInstigator) {
  return NS_OK;
}

/* void OnAnnouncerGoingAway (in nsIDBChangeAnnouncer instigator); */
NS_IMETHODIMP
nsParseMailMessageState::OnAnnouncerGoingAway(
    nsIDBChangeAnnouncer* instigator) {
  if (m_backupMailDB && m_backupMailDB == instigator) {
    m_backupMailDB->RemoveListener(this);
    m_backupMailDB = nullptr;
  } else if (m_mailDB) {
    m_mailDB = nullptr;
    m_newMsgHdr = nullptr;
  }
  return NS_OK;
}

NS_IMETHODIMP nsParseMailMessageState::OnEvent(nsIMsgDatabase* aDB,
                                               const char* aEvent) {
  return NS_OK;
}

/* void OnReadChanged (in nsIDBChangeListener instigator); */
NS_IMETHODIMP
nsParseMailMessageState::OnReadChanged(nsIDBChangeListener* instigator) {
  return NS_OK;
}

/* void OnJunkScoreChanged (in nsIDBChangeListener instigator); */
NS_IMETHODIMP
nsParseMailMessageState::OnJunkScoreChanged(nsIDBChangeListener* instigator) {
  return NS_OK;
}

NS_IMPL_ISUPPORTS(nsParseMailMessageState, nsIMsgParseMailMsgState,
                  nsIDBChangeListener)

nsParseMailMessageState::nsParseMailMessageState() {
  m_EnvDate = 0;
  m_position = 0;
  m_new_key = nsMsgKey_None;
  m_state = nsIMsgParseMailMsgState::ParseHeadersState;

  // setup handling of custom db headers, headers that are added to .msf files
  // as properties of the nsMsgHdr objects, controlled by the
  // pref mailnews.customDBHeaders, a space-delimited list of headers.
  // E.g., if mailnews.customDBHeaders is "X-Spam-Score", and we're parsing
  // a mail message with the X-Spam-Score header, we'll set the
  // "x-spam-score" property of nsMsgHdr to the value of the header.
  nsCString customDBHeaders;  // not shown in search UI
  nsCOMPtr<nsIPrefBranch> pPrefBranch(do_GetService(NS_PREFSERVICE_CONTRACTID));
  if (!pPrefBranch) {
    return;
  }
  pPrefBranch->GetCharPref("mailnews.customDBHeaders", customDBHeaders);
  ToLowerCase(customDBHeaders);
  if (customDBHeaders.Find("content-base") == -1)
    customDBHeaders.InsertLiteral("content-base ", 0);
  ParseString(customDBHeaders, ' ', m_customDBHeaders);

  // now add customHeaders
  nsCString customHeadersString;  // shown in search UI
  nsTArray<nsCString> customHeadersArray;
  pPrefBranch->GetCharPref("mailnews.customHeaders", customHeadersString);
  ToLowerCase(customHeadersString);
  customHeadersString.StripWhitespace();
  ParseString(customHeadersString, ':', customHeadersArray);
  for (uint32_t i = 0; i < customHeadersArray.Length(); i++) {
    if (!m_customDBHeaders.Contains(customHeadersArray[i])) {
      m_customDBHeaders.AppendElement(customHeadersArray[i]);
    }
  }
  m_customDBHeaderData.SetLength(m_customDBHeaders.Length());

  Clear();
}

NS_IMETHODIMP nsParseMailMessageState::Clear() {
  m_EnvAddr.Truncate();
  m_EnvDate = 0;
  m_message_id.length = 0;
  m_references.length = 0;
  m_date.length = 0;
  m_delivery_date.length = 0;
  m_from.length = 0;
  m_sender.length = 0;
  m_newsgroups.length = 0;
  m_subject.length = 0;
  m_status.length = 0;
  m_mozstatus.length = 0;
  m_mozstatus2.length = 0;
  m_priority.length = 0;
  m_keywords.length = 0;
  m_mdn_dnt.length = 0;
  m_return_path.length = 0;
  m_account_key.length = 0;
  m_in_reply_to.length = 0;
  m_replyTo.length = 0;
  m_content_type.length = 0;
  m_mdn_original_recipient.length = 0;
  m_bccList.length = 0;
  m_body_lines = 0;
  m_newMsgHdr = nullptr;
  m_envelope_pos = 0;
  m_new_key = nsMsgKey_None;
  m_toList.Clear();
  m_ccList.Clear();
  m_headers.clear();
  m_receivedTime = 0;
  m_receivedValue.Truncate();
  for (auto& headerData : m_customDBHeaderData) {
    headerData.value = nullptr;
    headerData.length = 0;
  };
  return NS_OK;
}

NS_IMETHODIMP nsParseMailMessageState::SetState(nsMailboxParseState aState) {
  m_state = aState;
  return NS_OK;
}

NS_IMETHODIMP nsParseMailMessageState::GetState(nsMailboxParseState* aState) {
  if (!aState) return NS_ERROR_NULL_POINTER;

  *aState = m_state;
  return NS_OK;
}

NS_IMETHODIMP nsParseMailMessageState::GetNewMsgHdr(nsIMsgDBHdr** aMsgHeader) {
  NS_ENSURE_ARG_POINTER(aMsgHeader);
  NS_IF_ADDREF(*aMsgHeader = m_newMsgHdr);
  return m_newMsgHdr ? NS_OK : NS_ERROR_NULL_POINTER;
}

NS_IMETHODIMP nsParseMailMessageState::SetNewMsgHdr(nsIMsgDBHdr* aMsgHeader) {
  m_newMsgHdr = aMsgHeader;
  return NS_OK;
}

NS_IMETHODIMP nsParseMailMessageState::ParseAFolderLine(const char* line,
                                                        uint32_t lineLength) {
  ParseFolderLine(line, lineLength);
  return NS_OK;
}

nsresult nsParseMailMessageState::ParseFolderLine(const char* line,
                                                  uint32_t lineLength) {
  nsresult rv;

  if (m_state == nsIMsgParseMailMsgState::ParseHeadersState) {
    if (EMPTY_MESSAGE_LINE(line)) {
      /* End of headers.  Now parse them. */
      rv = ParseHeaders();
      NS_ASSERTION(NS_SUCCEEDED(rv), "error parsing headers parsing mailbox");
      NS_ENSURE_SUCCESS(rv, rv);

      rv = FinalizeHeaders();
      NS_ASSERTION(NS_SUCCEEDED(rv),
                   "error finalizing headers parsing mailbox");
      NS_ENSURE_SUCCESS(rv, rv);

      m_state = nsIMsgParseMailMsgState::ParseBodyState;
    } else {
      /* Otherwise, this line belongs to a header.  So append it to the
         header data, and stay in MBOX `MIME_PARSE_HEADERS' state.
      */
      NS_ENSURE_TRUE(m_headers.append(line, lineLength), NS_ERROR_FAILURE);
    }
  } else if (m_state == nsIMsgParseMailMsgState::ParseBodyState) {
    m_body_lines++;
  }

  m_position += lineLength;

  return NS_OK;
}

NS_IMETHODIMP nsParseMailMessageState::SetMailDB(nsIMsgDatabase* mailDB) {
  m_mailDB = mailDB;
  return NS_OK;
}

NS_IMETHODIMP nsParseMailMessageState::SetBackupMailDB(
    nsIMsgDatabase* aBackupMailDB) {
  m_backupMailDB = aBackupMailDB;
  if (m_backupMailDB) m_backupMailDB->AddListener(this);
  return NS_OK;
}

NS_IMETHODIMP nsParseMailMessageState::SetNewKey(nsMsgKey aKey) {
  m_new_key = aKey;
  return NS_OK;
}

NS_IMETHODIMP nsParseMailMessageState::FinishHeader() {
  if (m_newMsgHdr) {
    m_newMsgHdr->SetMessageSize(m_position - m_envelope_pos);
    m_newMsgHdr->SetLineCount(m_body_lines);
  }
  return NS_OK;
}

// This method is only used by IMAP, for filtering.
NS_IMETHODIMP nsParseMailMessageState::GetAllHeaders(char** pHeaders,
                                                     int32_t* pHeadersSize) {
  if (!pHeaders || !pHeadersSize) return NS_ERROR_NULL_POINTER;
  *pHeaders = m_headers.begin();
  *pHeadersSize = static_cast<int32_t>(m_headers.length());
  return NS_OK;
}

/* largely lifted from mimehtml.c, which does similar parsing, sigh...
 */
nsresult nsParseMailMessageState::ParseHeaders() {
  char* buf = m_headers.begin();
  uint32_t buf_length = m_headers.length();
  if (buf_length == 0) {
    // No header of an expected type is present. Consider this a successful
    // parse so email still shows on summary and can be accessed and deleted.
    return NS_OK;
  }
  char* buf_end = buf + buf_length;
  if (!(buf_length > 1 &&
        (buf[buf_length - 1] == '\r' || buf[buf_length - 1] == '\n'))) {
    NS_WARNING("Header text should always end in a newline");
    return NS_ERROR_UNEXPECTED;
  }
  while (buf < buf_end) {
    char* colon = PL_strnchr(buf, ':', buf_end - buf);
    char* value = 0;
    HeaderData* header = nullptr;
    HeaderData receivedBy;

    if (!colon) break;

    nsDependentCSubstring headerStr(buf, colon);
    ToLowerCase(headerStr);

    // Obtain firstChar in headerStr. But if headerStr is empty, just set it to
    // the colon. This is needed because First() asserts on an empty string.
    char firstChar = !headerStr.IsEmpty() ? headerStr.First() : *colon;

    // See RFC 5322 section 3.6 for min-max number for given header.
    // If multiple headers exist we need to make sure to use the first one.

    switch (firstChar) {
      case 'b':
        if (headerStr.EqualsLiteral("bcc") && !m_bccList.length)
          header = &m_bccList;
        break;
      case 'c':
        if (headerStr.EqualsLiteral("cc")) {  // XXX: RFC 5322 says it's 0 or 1.
          header = m_ccList.AppendElement(HeaderData());
        } else if (headerStr.EqualsLiteral("content-type")) {
          header = &m_content_type;
        }
        break;
      case 'd':
        if (headerStr.EqualsLiteral("date") && !m_date.length)
          header = &m_date;
        else if (headerStr.EqualsLiteral("disposition-notification-to"))
          header = &m_mdn_dnt;
        else if (headerStr.EqualsLiteral("delivery-date"))
          header = &m_delivery_date;
        break;
      case 'f':
        if (headerStr.EqualsLiteral("from") && !m_from.length) {
          header = &m_from;
        }
        break;
      case 'i':
        if (headerStr.EqualsLiteral("in-reply-to") && !m_in_reply_to.length)
          header = &m_in_reply_to;
        break;
      case 'm':
        if (headerStr.EqualsLiteral("message-id") && !m_message_id.length)
          header = &m_message_id;
        break;
      case 'n':
        if (headerStr.EqualsLiteral("newsgroups")) header = &m_newsgroups;
        break;
      case 'o':
        if (headerStr.EqualsLiteral("original-recipient"))
          header = &m_mdn_original_recipient;
        break;
      case 'p':
        // we could very well care what the priority header was when we
        // remember its value. If so, need to remember it here. Also,
        // different priority headers can appear in the same message,
        // but we only remember the last one that we see. Applies also to
        // x-priority checked below.
        if (headerStr.EqualsLiteral("priority")) header = &m_priority;
        break;
      case 'r':
        if (headerStr.EqualsLiteral("references") && !m_references.length)
          header = &m_references;
        else if (headerStr.EqualsLiteral("return-path"))
          header = &m_return_path;
        // treat conventional Return-Receipt-To as MDN
        // Disposition-Notification-To
        else if (headerStr.EqualsLiteral("return-receipt-to"))
          header = &m_mdn_dnt;
        else if (headerStr.EqualsLiteral("reply-to") && !m_replyTo.length)
          header = &m_replyTo;
        else if (headerStr.EqualsLiteral("received")) {
          header = &receivedBy;
        }
        break;
      case 's':
        if (headerStr.EqualsLiteral("subject") && !m_subject.length)
          header = &m_subject;
        else if (headerStr.EqualsLiteral("sender") && !m_sender.length)
          header = &m_sender;
        else if (headerStr.EqualsLiteral("status"))
          header = &m_status;
        break;
      case 't':
        if (headerStr.EqualsLiteral("to")) {  // XXX: RFC 5322 says it's 0 or 1.
          header = m_toList.AppendElement(HeaderData());
        }
        break;
      case 'x':
        if (headerStr.EqualsIgnoreCase(X_MOZILLA_STATUS2) &&
            !m_mozstatus2.length)
          header = &m_mozstatus2;
        else if (headerStr.EqualsIgnoreCase(X_MOZILLA_STATUS) &&
                 !m_mozstatus.length)
          header = &m_mozstatus;
        else if (headerStr.EqualsIgnoreCase(HEADER_X_MOZILLA_ACCOUNT_KEY) &&
                 !m_account_key.length)
          header = &m_account_key;
        else if (headerStr.EqualsLiteral("x-priority"))  // See case 'p' above.
          header = &m_priority;
        else if (headerStr.EqualsIgnoreCase(HEADER_X_MOZILLA_KEYWORDS) &&
                 !m_keywords.length)
          header = &m_keywords;
        break;
    }

    if (!header && m_customDBHeaders.Length()) {
      MOZ_ASSERT(m_customDBHeaders.Length() == m_customDBHeaderData.Length(),
                 "m_customDBHeaderData should be in sync.");
      size_t customHeaderIndex = m_customDBHeaders.IndexOf(headerStr);
      if (customHeaderIndex != nsTArray<nsCString>::NoIndex) {
        header = &m_customDBHeaderData[customHeaderIndex];
      }
    }

    buf = colon + 1;
    // We will be shuffling downwards, so this is our insertion point.
    char* bufWrite = buf;

  SEARCH_NEWLINE:
    // move past any non terminating characters, rewriting them if folding white
    // space exists
    while (buf < buf_end && *buf != '\r' && *buf != '\n') {
      if (buf != bufWrite) *bufWrite = *buf;
      buf++;
      bufWrite++;
    }

    // Look for folding, so CRLF, CR or LF followed by space or tab.
    if ((buf + 2 < buf_end && (buf[0] == '\r' && buf[1] == '\n') &&
         (buf[2] == ' ' || buf[2] == '\t')) ||
        (buf + 1 < buf_end && (buf[0] == '\r' || buf[0] == '\n') &&
         (buf[1] == ' ' || buf[1] == '\t'))) {
      // Remove trailing spaces at the "write position" and add a single
      // folding space.
      while (*(bufWrite - 1) == ' ' || *(bufWrite - 1) == '\t') bufWrite--;
      *(bufWrite++) = ' ';

      // Skip CRLF, CR+space or LF+space ...
      buf += 2;

      // ... and skip leading spaces in that line.
      while (buf < buf_end && (*buf == ' ' || *buf == '\t')) buf++;

      // If we get here, the message headers ended in an empty line, like:
      // To: blah blah blah<CR><LF>  <CR><LF>[end of buffer]. The code below
      // requires buf to land on a newline to properly null-terminate the
      // string, so back up a tad so that it is pointing to one.
      if (buf == buf_end) {
        --buf;
        MOZ_ASSERT(*buf == '\n' || *buf == '\r',
                   "Header text should always end in a newline.");
      }
      goto SEARCH_NEWLINE;
    }

    // Null out the remainder after all the white space contained in
    // the header has been folded.
    if (bufWrite < buf) {
      memset(bufWrite, '\0', buf - bufWrite);
    }

    if (header) {
      value = colon + 1;
      // eliminate trailing blanks after the colon
      while (value < bufWrite && (*value == ' ' || *value == '\t')) value++;

      int32_t len = bufWrite - value;
      if (len < 0) {
        header->length = 0;
        header->value = nullptr;
      } else {
        header->length = len;
        header->value = value;
      }
    }
    if (*buf == '\r' || *buf == '\n') {
      char* last = bufWrite;
      char* saveBuf = buf;
      if (*buf == '\r' && buf + 1 < buf_end && buf[1] == '\n') buf++;
      buf++;
      // null terminate the left-over slop so we don't confuse msg filters.
      *saveBuf = 0;
      *last = 0; /* short-circuit const, and null-terminate header. */
    }

    if (header) {
      /* More const short-circuitry... */
      /* strip trailing whitespace */
      while (header->length > 0 && IS_SPACE(header->value[header->length - 1]))
        ((char*)header->value)[--header->length] = 0;
      if (header == &receivedBy) {
        if (m_receivedTime == 0) {
          // parse Received: header for date.
          // We trust the first header as that is closest to recipient,
          // and less likely to be spoofed.
          nsAutoCString receivedHdr(header->value, header->length);
          int32_t lastSemicolon = receivedHdr.RFindChar(';');
          if (lastSemicolon != -1) {
            nsAutoCString receivedDate;
            receivedDate = Substring(receivedHdr, lastSemicolon + 1);
            receivedDate.Trim(" \t\b\r\n");
            PRTime resultTime;
            if (PR_ParseTimeString(receivedDate.get(), false, &resultTime) ==
                PR_SUCCESS)
              m_receivedTime = resultTime;
            else
              NS_WARNING("PR_ParseTimeString failed in ParseHeaders().");
          }
        }
        // Someone might want the received header saved.
        if (m_customDBHeaders.Length()) {
          if (m_customDBHeaders.Contains("received"_ns)) {
            if (!m_receivedValue.IsEmpty()) m_receivedValue.Append(' ');
            m_receivedValue.Append(header->value, header->length);
          }
        }
      }

      MOZ_ASSERT(header->value[header->length] == 0,
                 "Non-null-terminated strings cause very, very bad problems");
    }
  }
  return NS_OK;
}

nsresult nsParseMailMessageState::InternSubject(HeaderData* header) {
  if (!header || header->length == 0) {
    m_newMsgHdr->SetSubject(""_ns);
    return NS_OK;
  }

  nsDependentCString key(header->value);

  uint32_t flags;
  (void)m_newMsgHdr->GetFlags(&flags);
  /* strip "Re: " */
  /**
        We trust the X-Mozilla-Status line to be the smartest in almost
        all things.  One exception, however, is the HAS_RE flag.  Since
         we just parsed the subject header anyway, we expect that parsing
         to be smartest.  (After all, what if someone just went in and
        edited the subject line by hand?)
     */
  nsCString modifiedSubject;
  bool strippedRE = NS_MsgStripRE(key, modifiedSubject);
  if (strippedRE)
    flags |= nsMsgMessageFlags::HasRe;
  else
    flags &= ~nsMsgMessageFlags::HasRe;
  m_newMsgHdr->SetFlags(flags);  // this *does not* update the mozilla-status
                                 // header in the local folder

  m_newMsgHdr->SetSubject(strippedRE ? modifiedSubject : key);

  return NS_OK;
}

// we've reached the end of the envelope, and need to turn all our accumulated
// header data into a single nsIMsgDBHdr to store in a database.
nsresult nsParseMailMessageState::FinalizeHeaders() {
  nsresult rv;
  HeaderData* sender;
  HeaderData* recipient;
  HeaderData* subject;
  HeaderData* id;
  HeaderData* inReplyTo;
  HeaderData* replyTo;
  HeaderData* references;
  HeaderData* date;
  HeaderData* deliveryDate;
  HeaderData* statush;
  HeaderData* mozstatus;
  HeaderData* mozstatus2;
  HeaderData* priority;
  HeaderData* keywords;
  HeaderData* account_key;
  HeaderData* ccList;
  HeaderData* bccList;
  HeaderData* mdn_dnt;
  HeaderData* content_type;

  uint32_t flags = 0;
  nsMsgPriorityValue priorityFlags = nsMsgPriority::notSet;

  if (!m_mailDB)  // if we don't have a valid db, skip the header.
    return NS_OK;

  // Unlike RFC 5322, we support multiple "Cc:" or "To:" header lines. In this
  // case, this function combines these lines into one and stores it in the
  // given nsCString, returning a HeaderData object pointing to it.
  auto getAggregateHeaderData = [](nsTArray<HeaderData>& list,
                                   nsCString& buffer) -> HeaderData {
    size_t size = list.Length();
    if (size < 1) {
      return {};
    }
    if (size == 1) {
      return list[0];
    }
    for (size_t i = 0; i < size; i++) {
      const auto& header = list[i];
      buffer.Append(header.value, header.length);
      if (i + 1 < size) {
        buffer.Append(",");
      }
    }
    MOZ_ASSERT(strlen(buffer.get()) == buffer.Length(),
               "Aggregate header should have the correct length.");
    return {buffer.get(), buffer.Length()};
  };

  nsCString aggregateToHeaders;
  HeaderData to = getAggregateHeaderData(m_toList, aggregateToHeaders);
  nsCString aggregateCcHeaders;
  HeaderData cc = getAggregateHeaderData(m_ccList, aggregateCcHeaders);
  // we don't aggregate bcc, as we only generate it locally,
  // and we don't use multiple lines

  // clang-format off
  sender       = (m_from.length          ? &m_from          :
                  m_sender.length        ? &m_sender        : 0);
  recipient    = (to.length              ? &to              :
                  cc.length              ? &cc              :
                  m_newsgroups.length    ? &m_newsgroups    : 0);
  ccList       = (cc.length              ? &cc              : 0);
  bccList      = (m_bccList.length       ? &m_bccList       : 0);
  subject      = (m_subject.length       ? &m_subject       : 0);
  id           = (m_message_id.length    ? &m_message_id    : 0);
  references   = (m_references.length    ? &m_references    : 0);
  statush      = (m_status.length        ? &m_status        : 0);
  mozstatus    = (m_mozstatus.length     ? &m_mozstatus     : 0);
  mozstatus2   = (m_mozstatus2.length    ? &m_mozstatus2    : 0);
  date         = (m_date.length          ? &m_date          : 0);
  deliveryDate = (m_delivery_date.length ? &m_delivery_date : 0);
  priority     = (m_priority.length      ? &m_priority      : 0);
  keywords     = (m_keywords.length      ? &m_keywords      : 0);
  mdn_dnt      = (m_mdn_dnt.length       ? &m_mdn_dnt       : 0);
  inReplyTo    = (m_in_reply_to.length   ? &m_in_reply_to   : 0);
  replyTo      = (m_replyTo.length       ? &m_replyTo       : 0);
  content_type = (m_content_type.length  ? &m_content_type  : 0);
  account_key  = (m_account_key.length   ? &m_account_key   : 0);
  // clang-format on

  if (mozstatus) {
    if (mozstatus->length == 4) {
      NS_ASSERTION(MsgIsHex(mozstatus->value, 4),
                   "Expected 4 hex digits for X-Mozilla-Status.");
      flags = MsgUnhex(mozstatus->value, 4);
      // strip off and remember priority bits.
      flags &= ~nsMsgMessageFlags::RuntimeOnly;
      priorityFlags =
          (nsMsgPriorityValue)((flags & nsMsgMessageFlags::Priorities) >> 13);
      flags &= ~nsMsgMessageFlags::Priorities;
    }
  }

  if (mozstatus2) {
    if (mozstatus2->length == 8) {
      NS_ASSERTION(MsgIsHex(mozstatus2->value, 8),
                   "Expected 8 hex digits for X-Mozilla-Status2.");
      uint32_t flags2 = MsgUnhex(mozstatus2->value, 8);
      flags2 &= ~nsMsgMessageFlags::RuntimeOnly;
      flags |= flags2 & 0xFFFF0000;
    }
  }

  if (!(flags & nsMsgMessageFlags::Expunged))  // message was deleted, don't
                                               // bother creating a hdr.
  {
    // We'll need the message id first to recover data from the backup database
    nsAutoCString rawMsgId;
    if (id) {
      // Take off <> around message ID.
      if (MOZ_LIKELY(id->length > 0 && id->value[0] == '<')) {
        --id->length;
        ++id->value;
      }
      if (MOZ_LIKELY(id->length > 0 && id->value[id->length - 1] == '>')) {
        --id->length;
      }
      rawMsgId.Assign(id->value, id->length);
    }

    /*
     * Try to copy the data from the backup database, referencing the MessageID
     * If that fails, just create a new header
     */
    nsCOMPtr<nsIMsgDBHdr> oldHeader;
    nsresult ret = NS_OK;

    if (m_backupMailDB && !rawMsgId.IsEmpty())
      ret = m_backupMailDB->GetMsgHdrForMessageID(rawMsgId.get(),
                                                  getter_AddRefs(oldHeader));

    // m_new_key is set in nsImapMailFolder::ParseAdoptedHeaderLine to be
    // the UID of the message, so that the key can get created as UID. That of
    // course is extremely confusing, and we really need to clean that up. We
    // really should not conflate the meaning of envelope position, key, and
    // UID.
    if (NS_SUCCEEDED(ret) && oldHeader)
      ret = m_mailDB->CopyHdrFromExistingHdr(m_new_key, oldHeader, false,
                                             getter_AddRefs(m_newMsgHdr));
    else if (!m_newMsgHdr) {
      // Should assert that this is not a local message
      ret = m_mailDB->CreateNewHdr(m_new_key, getter_AddRefs(m_newMsgHdr));
    }

    if (NS_SUCCEEDED(ret) && m_newMsgHdr) {
      uint32_t origFlags;
      (void)m_newMsgHdr->GetFlags(&origFlags);
      if (origFlags & nsMsgMessageFlags::HasRe)
        flags |= nsMsgMessageFlags::HasRe;
      else
        flags &= ~nsMsgMessageFlags::HasRe;

      flags &=
          ~nsMsgMessageFlags::Offline;  // don't keep nsMsgMessageFlags::Offline
                                        // for local msgs
      if (mdn_dnt && !(origFlags & nsMsgMessageFlags::Read) &&
          !(origFlags & nsMsgMessageFlags::MDNReportSent) &&
          !(flags & nsMsgMessageFlags::MDNReportSent))
        flags |= nsMsgMessageFlags::MDNReportNeeded;

      m_newMsgHdr->SetFlags(flags);
      if (priorityFlags != nsMsgPriority::notSet)
        m_newMsgHdr->SetPriority(priorityFlags);

      // if we have a reply to header, and it's different from the from: header,
      // set the "replyTo" attribute on the msg hdr.
      if (replyTo && (!sender || replyTo->length != sender->length ||
                      strncmp(replyTo->value, sender->value, sender->length)))
        m_newMsgHdr->SetStringProperty("replyTo",
                                       nsDependentCString(replyTo->value));

      if (sender) {
        m_newMsgHdr->SetAuthor(nsDependentCString(sender->value));
      }

      if (recipient == &m_newsgroups) {
        /* In the case where the recipient is a newsgroup, truncate the string
           at the first comma.  This is used only for presenting the thread
           list, and newsgroup lines tend to be long and non-shared, and tend to
           bloat the string table.  So, by only showing the first newsgroup, we
           can reduce memory and file usage at the expense of only showing the
           one group in the summary list, and only being able to sort on the
           first group rather than the whole list.  It's worth it. */
        char* ch;
        ch = PL_strchr(recipient->value, ',');
        if (ch) {
          /* generate a new string that terminates before the , */
          nsAutoCString firstGroup;
          firstGroup.Assign(recipient->value, ch - recipient->value);
          m_newMsgHdr->SetRecipients(firstGroup);
        }

        m_newMsgHdr->SetRecipients(nsDependentCString(recipient->value));
      } else if (recipient) {
        m_newMsgHdr->SetRecipients(nsDependentCString(recipient->value));
      }
      if (ccList) {
        m_newMsgHdr->SetCcList(nsDependentCString(ccList->value));
      }

      if (bccList) {
        m_newMsgHdr->SetBccList(nsDependentCString(bccList->value));
      }

      rv = InternSubject(subject);
      if (NS_SUCCEEDED(rv)) {
        if (rawMsgId.IsEmpty()) {
          // Generate an MD5 hash of all the headers.
          const char* md5_b64 = "dummy.message.id";
          nsresult rv;
          nsCOMPtr<nsICryptoHash> hasher =
              do_CreateInstance("@mozilla.org/security/hash;1", &rv);
          nsAutoCString hash;
          if (NS_SUCCEEDED(rv)) {
            if (NS_SUCCEEDED(hasher->Init(nsICryptoHash::MD5)) &&
                NS_SUCCEEDED(hasher->Update((const uint8_t*)m_headers.begin(),
                                            m_headers.length())) &&
                NS_SUCCEEDED(hasher->Finish(true, hash))) {
              md5_b64 = hash.get();
            }
          }
          rawMsgId.Assign("md5:");
          rawMsgId.Append(md5_b64);
        }
        m_newMsgHdr->SetMessageId(rawMsgId);

        m_mailDB->UpdatePendingAttributes(m_newMsgHdr);

        if (!mozstatus && statush) {
          // Parse a little bit of the Berkeley Mail status header.
          for (const char* s = statush->value; *s; s++) {
            uint32_t msgFlags = 0;
            (void)m_newMsgHdr->GetFlags(&msgFlags);
            switch (*s) {
              case 'R':
              case 'O':
              case 'r':
                m_newMsgHdr->SetFlags(msgFlags | nsMsgMessageFlags::Read);
                break;
              case 'D':
              case 'd':
                // msg->flags |= nsMsgMessageFlags::Expunged; // Maybe?
                break;
              case 'N':
              case 'n':
              case 'U':
              case 'u':
                m_newMsgHdr->SetFlags(msgFlags & ~nsMsgMessageFlags::Read);
                break;
              default:
                NS_WARNING(nsPrintfCString("Unexpected status for %s: %s",
                                           rawMsgId.get(), statush->value)
                               .get());
                break;
            }
          }
        }

        if (account_key != nullptr)
          m_newMsgHdr->SetAccountKey(nsDependentCString(account_key->value));
        // use in-reply-to header as references, if there's no references header
        if (references != nullptr) {
          m_newMsgHdr->SetReferences(nsDependentCString(references->value));
        } else if (inReplyTo != nullptr) {
          m_newMsgHdr->SetReferences(nsDependentCString(inReplyTo->value));
        } else {
          m_newMsgHdr->SetReferences(""_ns);
        }

        // 'Received' should be as reliable an indicator of the receipt
        // date+time as possible, whilst always giving something *from
        // the message*.  It won't use PR_Now() under any circumstance.
        // Therefore, the fall-thru order for 'Received' is:
        // Received: -> Delivery-date: -> date
        // 'Date' uses:
        // date -> 'Received' -> EnvDate -> PR_Now()
        // (where EnvDate was passed in from outside via SetEnvDetails()).

        uint32_t rcvTimeSecs = 0;
        PRTime datePRTime = m_EnvDate;
        if (date) {
          // Date:
          if (PR_ParseTimeString(date->value, false, &datePRTime) ==
              PR_SUCCESS) {
            // Convert to seconds as default value for 'Received'.
            PRTime2Seconds(datePRTime, &rcvTimeSecs);
          } else {
            NS_WARNING(
                "PR_ParseTimeString of date failed in FinalizeHeader().");
          }
        }
        if (m_receivedTime) {
          // Upgrade 'Received' to Received: ?
          PRTime2Seconds(m_receivedTime, &rcvTimeSecs);
          if (datePRTime == 0) datePRTime = m_receivedTime;
        } else if (deliveryDate) {
          // Upgrade 'Received' to Delivery-date: ?
          PRTime resultTime;
          if (PR_ParseTimeString(deliveryDate->value, false, &resultTime) ==
              PR_SUCCESS) {
            PRTime2Seconds(resultTime, &rcvTimeSecs);
            if (datePRTime == 0) datePRTime = resultTime;
          } else {
            // TODO/FIXME: We need to figure out what to do in this case!
            NS_WARNING(
                "PR_ParseTimeString of delivery date failed in "
                "FinalizeHeader().");
          }
        }
        m_newMsgHdr->SetUint32Property("dateReceived", rcvTimeSecs);

        if (datePRTime == 0) {
          // If there was some problem parsing the Date header *AND* we
          // couldn't get a valid envelope date *AND* we couldn't get a valid
          // Received: header date, use now as the time.
          // This doesn't affect local (POP3) messages, because we use the
          // envelope date if there's no Date: header, but it will affect IMAP
          // msgs w/o a Date: header or Received: headers.
          datePRTime = PR_Now();
        }
        m_newMsgHdr->SetDate(datePRTime);

        if (priority) {
          nsMsgPriorityValue priorityVal = nsMsgPriority::Default;

          // We can ignore |NS_MsgGetPriorityFromString()| return value,
          // since we set a default value for |priorityVal|.
          NS_MsgGetPriorityFromString(priority->value, priorityVal);
          m_newMsgHdr->SetPriority(priorityVal);
        } else if (priorityFlags == nsMsgPriority::notSet)
          m_newMsgHdr->SetPriority(nsMsgPriority::none);
        if (keywords) {
          // When there are many keywords, some may not have been written
          // to the message file, so add extra keywords from the backup
          nsAutoCString oldKeywords;
          m_newMsgHdr->GetStringProperty("keywords", oldKeywords);
          nsTArray<nsCString> newKeywordArray, oldKeywordArray;
          ParseString(
              Substring(keywords->value, keywords->value + keywords->length),
              ' ', newKeywordArray);
          ParseString(oldKeywords, ' ', oldKeywordArray);
          for (uint32_t i = 0; i < oldKeywordArray.Length(); i++)
            if (!newKeywordArray.Contains(oldKeywordArray[i]))
              newKeywordArray.AppendElement(oldKeywordArray[i]);
          nsAutoCString newKeywords;
          for (uint32_t i = 0; i < newKeywordArray.Length(); i++) {
            if (i) newKeywords.Append(' ');
            newKeywords.Append(newKeywordArray[i]);
          }
          m_newMsgHdr->SetStringProperty("keywords", newKeywords);
        }
        MOZ_ASSERT(m_customDBHeaders.Length() == m_customDBHeaderData.Length(),
                   "m_customDBHeaderData should be in sync.");
        for (uint32_t i = 0; i < m_customDBHeaders.Length(); i++) {
          if (m_customDBHeaderData[i].length)
            m_newMsgHdr->SetStringProperty(
                m_customDBHeaders[i].get(),
                nsDependentCString(m_customDBHeaderData[i].value));
          // The received header is accumulated separately
          if (m_customDBHeaders[i].EqualsLiteral("received") &&
              !m_receivedValue.IsEmpty())
            m_newMsgHdr->SetStringProperty("received", m_receivedValue);
        }
        if (content_type) {
          char* substring = PL_strstr(content_type->value, "charset");
          if (substring) {
            char* charset = PL_strchr(substring, '=');
            if (charset) {
              charset++;
              /* strip leading whitespace and double-quote */
              while (*charset && (IS_SPACE(*charset) || '\"' == *charset))
                charset++;
              /* strip trailing whitespace and double-quote */
              char* end = charset;
              while (*end && !IS_SPACE(*end) && '\"' != *end && ';' != *end)
                end++;
              if (*charset) {
                if (*end != '\0') {
                  // if we're not at the very end of the line, we need
                  // to generate a new string without the trailing crud
                  nsAutoCString rawCharSet;
                  rawCharSet.Assign(charset, end - charset);
                  m_newMsgHdr->SetCharset(rawCharSet);
                } else {
                  m_newMsgHdr->SetCharset(nsDependentCString(charset));
                }
              }
            }
          }
          substring = PL_strcasestr(content_type->value, "multipart/mixed");
          if (substring) {
            uint32_t newFlags;
            m_newMsgHdr->OrFlags(nsMsgMessageFlags::Attachment, &newFlags);
          }
        }
      }
    } else {
      NS_ASSERTION(false, "error creating message header");
      rv = NS_ERROR_OUT_OF_MEMORY;
    }
  } else
    rv = NS_OK;

  return rv;
}

nsParseNewMailState::nsParseNewMailState()
    : m_numNotNewMessages(0),
      m_msgMovedByFilter(false),
      m_msgCopiedByFilter(false),
      m_disableFilters(false) {}

NS_IMPL_ISUPPORTS_INHERITED(nsParseNewMailState, nsParseMailMessageState,
                            nsIMsgFilterHitNotify)

nsresult nsParseNewMailState::Init(nsIMsgFolder* serverFolder,
                                   nsIMsgFolder* downloadFolder,
                                   nsIMsgWindow* aMsgWindow, nsIMsgDBHdr* aHdr,
                                   nsIOutputStream* aOutputStream) {
  NS_ENSURE_ARG_POINTER(serverFolder);
  nsresult rv;
  Clear();
  m_rootFolder = serverFolder;
  m_msgWindow = aMsgWindow;
  m_downloadFolder = downloadFolder;

  m_newMsgHdr = aHdr;
  m_outputStream = aOutputStream;
  // the new mail parser isn't going to get the stream input, it seems, so we
  // can't use the OnStartRequest mechanism the mailbox parser uses. So, let's
  // open the db right now.
  nsCOMPtr<nsIMsgDBService> msgDBService =
      do_GetService("@mozilla.org/msgDatabase/msgDBService;1", &rv);
  if (msgDBService && !m_mailDB)
    rv = msgDBService->OpenFolderDB(downloadFolder, false,
                                    getter_AddRefs(m_mailDB));
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<nsIMsgIncomingServer> server;
  rv = serverFolder->GetServer(getter_AddRefs(server));
  if (NS_SUCCEEDED(rv)) {
    nsAutoCString serverName;
    server->GetPrettyName(serverName);
    MOZ_LOG(FILTERLOGMODULE, LogLevel::Info,
            ("(Local) Detected new local messages on account '%s'",
             serverName.get()));
    rv = server->GetFilterList(aMsgWindow, getter_AddRefs(m_filterList));

    if (m_filterList) rv = server->ConfigureTemporaryFilters(m_filterList);
    // check if this server defers to another server, in which case
    // we'll use that server's filters as well.
    nsCOMPtr<nsIMsgFolder> deferredToRootFolder;
    server->GetRootMsgFolder(getter_AddRefs(deferredToRootFolder));
    if (serverFolder != deferredToRootFolder) {
      nsCOMPtr<nsIMsgIncomingServer> deferredToServer;
      deferredToRootFolder->GetServer(getter_AddRefs(deferredToServer));
      if (deferredToServer)
        deferredToServer->GetFilterList(
            aMsgWindow, getter_AddRefs(m_deferredToServerFilterList));
    }
  }
  m_disableFilters = false;
  return NS_OK;
}

nsParseNewMailState::~nsParseNewMailState() {
  if (m_mailDB) m_mailDB->Close(true);
  if (m_backupMailDB) m_backupMailDB->ForceClosed();
}

// not an IMETHOD so we don't need to do error checking or return an error.
// We only have one caller.
void nsParseNewMailState::GetMsgWindow(nsIMsgWindow** aMsgWindow) {
  NS_IF_ADDREF(*aMsgWindow = m_msgWindow);
}

void nsParseNewMailState::DoneParsing() {
  PublishMsgHeader(nullptr);
  if (m_mailDB) {  // finished parsing, so flush db folder info
    UpdateDBFolderInfo();
  }
}

void nsParseNewMailState::PublishMsgHeader(nsIMsgWindow* msgWindow) {
  bool moved = false;
  FinishHeader();

  if (m_newMsgHdr) {
    uint32_t newFlags, oldFlags;
    m_newMsgHdr->GetFlags(&oldFlags);
    if (!(oldFlags &
          nsMsgMessageFlags::Read))  // don't mark read messages as new.
      m_newMsgHdr->OrFlags(nsMsgMessageFlags::New, &newFlags);

    if (!m_disableFilters) {
      nsCOMPtr<nsIMsgIncomingServer> server;
      nsresult rv = m_rootFolder->GetServer(getter_AddRefs(server));
      NS_ENSURE_SUCCESS_VOID(rv);
      int32_t duplicateAction;
      server->GetIncomingDuplicateAction(&duplicateAction);
      if (duplicateAction != nsIMsgIncomingServer::keepDups) {
        bool isDup;
        server->IsNewHdrDuplicate(m_newMsgHdr, &isDup);
        if (isDup) {
          // we want to do something similar to applying filter hits.
          // if a dup is marked read, it shouldn't trigger biff.
          // Same for deleting it or moving it to trash.
          switch (duplicateAction) {
            case nsIMsgIncomingServer::deleteDups: {
              nsCOMPtr<nsIMsgPluggableStore> msgStore;
              nsresult rv =
                  m_downloadFolder->GetMsgStore(getter_AddRefs(msgStore));
              if (NS_SUCCEEDED(rv)) {
                rv = msgStore->DiscardNewMessage(m_outputStream, m_newMsgHdr);
                if (NS_FAILED(rv))
                  m_rootFolder->ThrowAlertMsg("dupDeleteFolderTruncateFailed",
                                              msgWindow);
              }
              m_mailDB->RemoveHeaderMdbRow(m_newMsgHdr);
            } break;

            case nsIMsgIncomingServer::moveDupsToTrash: {
              nsCOMPtr<nsIMsgFolder> trash;
              GetTrashFolder(getter_AddRefs(trash));
              if (trash) {
                uint32_t newFlags;
                bool msgMoved;
                m_newMsgHdr->AndFlags(~nsMsgMessageFlags::New, &newFlags);
                nsCOMPtr<nsIMsgPluggableStore> msgStore;
                rv = m_downloadFolder->GetMsgStore(getter_AddRefs(msgStore));
                if (NS_SUCCEEDED(rv))
                  rv = msgStore->MoveNewlyDownloadedMessage(m_newMsgHdr, trash,
                                                            &msgMoved);
                if (NS_SUCCEEDED(rv) && !msgMoved) {
                  rv = MoveIncorporatedMessage(m_newMsgHdr, m_mailDB, trash,
                                               nullptr, msgWindow);
                  if (NS_SUCCEEDED(rv))
                    rv = m_mailDB->RemoveHeaderMdbRow(m_newMsgHdr);
                }
                if (NS_FAILED(rv))
                  NS_WARNING("moveDupsToTrash failed for some reason.");
              }
            } break;
            case nsIMsgIncomingServer::markDupsRead:
              MarkFilteredMessageRead(m_newMsgHdr);
              break;
          }
          int32_t numNewMessages;
          m_downloadFolder->GetNumNewMessages(false, &numNewMessages);
          m_downloadFolder->SetNumNewMessages(numNewMessages - 1);

          m_newMsgHdr = nullptr;
          return;
        }
      }

      ApplyFilters(&moved, msgWindow);
    }
    if (!moved) {
      if (m_mailDB) {
        m_mailDB->AddNewHdrToDB(m_newMsgHdr, true);
        nsCOMPtr<nsIMsgFolderNotificationService> notifier(
            do_GetService("@mozilla.org/messenger/msgnotificationservice;1"));
        if (notifier) notifier->NotifyMsgAdded(m_newMsgHdr);
        // mark the header as not yet reported classified
        nsMsgKey msgKey;
        m_newMsgHdr->GetMessageKey(&msgKey);
        m_downloadFolder->OrProcessingFlags(
            msgKey, nsMsgProcessingFlags::NotReportedClassified);
      }
    }  // if it was moved by imap filter, m_parseMsgState->m_newMsgHdr ==
       // nullptr
    m_newMsgHdr = nullptr;
  }
}

nsresult nsParseNewMailState::GetTrashFolder(nsIMsgFolder** pTrashFolder) {
  nsresult rv = NS_ERROR_UNEXPECTED;
  if (!pTrashFolder) return NS_ERROR_NULL_POINTER;

  if (m_downloadFolder) {
    nsCOMPtr<nsIMsgIncomingServer> incomingServer;
    m_downloadFolder->GetServer(getter_AddRefs(incomingServer));
    nsCOMPtr<nsIMsgFolder> rootMsgFolder;
    incomingServer->GetRootMsgFolder(getter_AddRefs(rootMsgFolder));
    if (rootMsgFolder) {
      rv = rootMsgFolder->GetFolderWithFlags(nsMsgFolderFlags::Trash,
                                             pTrashFolder);
      if (!*pTrashFolder) rv = NS_ERROR_FAILURE;
    }
  }
  return rv;
}

void nsParseNewMailState::ApplyFilters(bool* pMoved, nsIMsgWindow* msgWindow) {
  m_msgMovedByFilter = m_msgCopiedByFilter = false;

  if (!m_disableFilters) {
    nsCOMPtr<nsIMsgDBHdr> msgHdr = m_newMsgHdr;
    nsCOMPtr<nsIMsgFolder> downloadFolder = m_downloadFolder;
    if (m_rootFolder) {
      if (!downloadFolder)
        m_rootFolder->GetFolderWithFlags(nsMsgFolderFlags::Inbox,
                                         getter_AddRefs(downloadFolder));
      if (downloadFolder) downloadFolder->GetURI(m_inboxUri);
      char* headers = m_headers.begin();
      uint32_t headersSize = m_headers.length();
      nsAutoCString tok;
      msgHdr->GetStoreToken(tok);
      if (m_filterList) {
        MOZ_LOG(FILTERLOGMODULE, LogLevel::Info,
                ("(Local) Running filters on 1 message (%s)", tok.get()));
        MOZ_LOG(FILTERLOGMODULE, LogLevel::Info,
                ("(Local) Using filters from the original account"));
        (void)m_filterList->ApplyFiltersToHdr(
            nsMsgFilterType::InboxRule, msgHdr, downloadFolder, m_mailDB,
            nsDependentCSubstring(headers, headersSize), this, msgWindow);
      }
      if (!m_msgMovedByFilter && m_deferredToServerFilterList) {
        MOZ_LOG(FILTERLOGMODULE, LogLevel::Info,
                ("(Local) Running filters on 1 message (%s)", tok.get()));
        MOZ_LOG(FILTERLOGMODULE, LogLevel::Info,
                ("(Local) Using filters from the deferred to account"));
        (void)m_deferredToServerFilterList->ApplyFiltersToHdr(
            nsMsgFilterType::InboxRule, msgHdr, downloadFolder, m_mailDB,
            nsDependentCSubstring(headers, headersSize), this, msgWindow);
      }
    }
  }
  if (pMoved) *pMoved = m_msgMovedByFilter;
}

NS_IMETHODIMP nsParseNewMailState::ApplyFilterHit(nsIMsgFilter* filter,
                                                  nsIMsgWindow* msgWindow,
                                                  bool* applyMore) {
  NS_ENSURE_ARG_POINTER(filter);
  NS_ENSURE_ARG_POINTER(applyMore);

  uint32_t newFlags;
  nsresult rv = NS_OK;

  *applyMore = true;

  nsCOMPtr<nsIMsgDBHdr> msgHdr = m_newMsgHdr;

  nsTArray<RefPtr<nsIMsgRuleAction>> filterActionList;
  rv = filter->GetSortedActionList(filterActionList);
  NS_ENSURE_SUCCESS(rv, rv);

  uint32_t numActions = filterActionList.Length();

  nsCString msgId;
  msgHdr->GetMessageId(msgId);
  nsMsgKey msgKey;
  msgHdr->GetMessageKey(&msgKey);
  MOZ_LOG(FILTERLOGMODULE, LogLevel::Info,
          ("(Local) Applying %" PRIu32
           " filter actions on message with key %" PRIu32,
           numActions, msgKeyToInt(msgKey)));
  MOZ_LOG(FILTERLOGMODULE, LogLevel::Debug,
          ("(Local) Message ID: %s", msgId.get()));

  bool loggingEnabled = false;
  if (m_filterList && numActions)
    m_filterList->GetLoggingEnabled(&loggingEnabled);

  bool msgIsNew = true;
  nsresult finalResult = NS_OK;  // result of all actions
  for (uint32_t actionIndex = 0; actionIndex < numActions && *applyMore;
       actionIndex++) {
    nsCOMPtr<nsIMsgRuleAction> filterAction(filterActionList[actionIndex]);
    if (!filterAction) {
      MOZ_LOG(FILTERLOGMODULE, LogLevel::Warning,
              ("(Local) Filter action at index %" PRIu32 " invalid, skipping",
               actionIndex));
      continue;
    }

    nsMsgRuleActionType actionType;
    if (NS_SUCCEEDED(filterAction->GetType(&actionType))) {
      MOZ_LOG(FILTERLOGMODULE, LogLevel::Info,
              ("(Local) Running filter action at index %" PRIu32
               ", action type = %i",
               actionIndex, actionType));
      if (loggingEnabled) (void)filter->LogRuleHit(filterAction, msgHdr);

      nsCString actionTargetFolderUri;
      if (actionType == nsMsgFilterAction::MoveToFolder ||
          actionType == nsMsgFilterAction::CopyToFolder) {
        rv = filterAction->GetTargetFolderUri(actionTargetFolderUri);
        if (NS_FAILED(rv) || actionTargetFolderUri.IsEmpty()) {
          // clang-format off
          MOZ_LOG(FILTERLOGMODULE, LogLevel::Warning,
                  ("(Local) Target URI for Copy/Move action is empty, skipping"));
          // clang-format on
          NS_ASSERTION(false, "actionTargetFolderUri is empty");
          continue;
        }
      }

      rv = NS_OK;  // result of the current action
      switch (actionType) {
        case nsMsgFilterAction::Delete: {
          nsCOMPtr<nsIMsgFolder> trash;
          // set value to trash folder
          rv = GetTrashFolder(getter_AddRefs(trash));
          if (NS_SUCCEEDED(rv) && trash) {
            rv = trash->GetURI(actionTargetFolderUri);
            if (NS_FAILED(rv)) break;
          }

          rv = msgHdr->OrFlags(nsMsgMessageFlags::Read,
                               &newFlags);  // mark read in trash.
          msgIsNew = false;
        }
          // FALLTHROUGH
          [[fallthrough]];
        case nsMsgFilterAction::MoveToFolder: {
          // If moving to a different folder, do it.
          if (!actionTargetFolderUri.IsEmpty() &&
              !m_inboxUri.Equals(actionTargetFolderUri,
                                 nsCaseInsensitiveCStringComparator)) {
            nsCOMPtr<nsIMsgFolder> destIFolder;
            // XXX TODO: why do we create the folder here, while we do not in
            // the Copy action?
            rv = GetOrCreateFolder(actionTargetFolderUri,
                                   getter_AddRefs(destIFolder));
            if (NS_FAILED(rv)) {
              MOZ_LOG(FILTERLOGMODULE, LogLevel::Error,
                      ("(Local) Target Folder for Move action does not exist"));
              break;
            }
            bool msgMoved = false;
            // If we're moving to an imap folder, or this message has already
            // has a pending copy action, use the imap coalescer so that
            // we won't truncate the inbox before the copy fires.

            // For pop3 and when mail moved to target folder by filter, if
            // condition is false and else block is executed. So we don't have
            // imap move coalescer, have to keep track of moved messages and
            // target folders using m_filterTargetFoldersMsgMovedCount Map.
            if (m_msgCopiedByFilter ||
                StringBeginsWith(actionTargetFolderUri, "imap:"_ns)) {
              if (!m_moveCoalescer)
                m_moveCoalescer =
                    new nsImapMoveCoalescer(m_downloadFolder, m_msgWindow);
              NS_ENSURE_TRUE(m_moveCoalescer, NS_ERROR_OUT_OF_MEMORY);
              rv = m_moveCoalescer->AddMove(destIFolder, msgKey);
              msgIsNew = false;
              if (NS_FAILED(rv)) break;
            } else {
              uint32_t old_flags;
              msgHdr->GetFlags(&old_flags);

              nsCOMPtr<nsIMsgPluggableStore> msgStore;
              rv = m_downloadFolder->GetMsgStore(getter_AddRefs(msgStore));
              if (NS_SUCCEEDED(rv))
                rv = msgStore->MoveNewlyDownloadedMessage(msgHdr, destIFolder,
                                                          &msgMoved);
              if (NS_SUCCEEDED(rv) && !msgMoved)
                rv = MoveIncorporatedMessage(msgHdr, m_mailDB, destIFolder,
                                             filter, msgWindow);
              m_msgMovedByFilter = NS_SUCCEEDED(rv);

              if (m_msgMovedByFilter &&
                  !(old_flags & nsMsgMessageFlags::Read)) {
                // Setting msgIsNew to false will execute the block at the end
                // that decreases inbox's NumNewMessages.
                msgIsNew = false;

                if (!m_filterTargetFoldersMsgMovedCount) {
                  m_filterTargetFoldersMsgMovedCount = mozilla::MakeUnique<
                      nsTHashMap<nsCStringHashKey, int32_t>>();
                }
                int32_t targetFolderMsgMovedCount =
                    m_filterTargetFoldersMsgMovedCount->Get(
                        actionTargetFolderUri);
                targetFolderMsgMovedCount++;
                m_filterTargetFoldersMsgMovedCount->InsertOrUpdate(
                    actionTargetFolderUri, targetFolderMsgMovedCount);
              }

              if (!m_msgMovedByFilter /* == NS_FAILED(err) */) {
                // XXX: Invoke MSG_LOG_TO_CONSOLE once bug 1135265 lands.
                if (loggingEnabled) {
                  (void)filter->LogRuleHitFail(filterAction, msgHdr, rv,
                                               "filterFailureMoveFailed"_ns);
                }
              }
            }
          } else {
            MOZ_LOG(FILTERLOGMODULE, LogLevel::Info,
                    ("(Local) Target folder is the same as source folder, "
                     "skipping"));
            rv = NS_OK;
          }
          *applyMore = false;
        } break;
        case nsMsgFilterAction::CopyToFolder: {
          nsCString uri;
          rv = m_rootFolder->GetURI(uri);

          if (!actionTargetFolderUri.IsEmpty() &&
              !actionTargetFolderUri.Equals(uri)) {
            nsCOMPtr<nsIMsgFolder> dstFolder;
            nsCOMPtr<nsIMsgCopyService> copyService;
            rv = GetExistingFolder(actionTargetFolderUri,
                                   getter_AddRefs(dstFolder));
            if (NS_FAILED(rv)) {
              // Let's show a more specific warning.
              MOZ_LOG(FILTERLOGMODULE, LogLevel::Error,
                      ("(Local) Target Folder for Copy action does not exist"));
              NS_WARNING("Target Folder does not exist.");
              break;
            }

            copyService = do_GetService(
                "@mozilla.org/messenger/messagecopyservice;1", &rv);
            if (NS_SUCCEEDED(rv))
              rv = copyService->CopyMessages(m_downloadFolder, {&*msgHdr},
                                             dstFolder, false, nullptr,
                                             msgWindow, false);

            if (NS_FAILED(rv)) {
              // XXX: Invoke MSG_LOG_TO_CONSOLE once bug 1135265 lands.
              if (loggingEnabled) {
                (void)filter->LogRuleHitFail(filterAction, msgHdr, rv,
                                             "filterFailureCopyFailed"_ns);
              }
            } else
              m_msgCopiedByFilter = true;
          } else {
            MOZ_LOG(FILTERLOGMODULE, LogLevel::Info,
                    ("(Local) Target folder is the same as source folder, "
                     "skipping"));
            break;
          }
        } break;
        case nsMsgFilterAction::MarkRead:
          msgIsNew = false;
          MarkFilteredMessageRead(msgHdr);
          rv = NS_OK;
          break;
        case nsMsgFilterAction::MarkUnread:
          msgIsNew = true;
          MarkFilteredMessageUnread(msgHdr);
          rv = NS_OK;
          break;
        case nsMsgFilterAction::KillThread:
          rv = msgHdr->SetUint32Property("ProtoThreadFlags",
                                         nsMsgMessageFlags::Ignored);
          break;
        case nsMsgFilterAction::KillSubthread:
          rv = msgHdr->OrFlags(nsMsgMessageFlags::Ignored, &newFlags);
          break;
        case nsMsgFilterAction::WatchThread:
          rv = msgHdr->OrFlags(nsMsgMessageFlags::Watched, &newFlags);
          break;
        case nsMsgFilterAction::MarkFlagged: {
          rv = m_downloadFolder->MarkMessagesFlagged({&*msgHdr}, true);
        } break;
        case nsMsgFilterAction::ChangePriority: {
          nsMsgPriorityValue filterPriority;
          filterAction->GetPriority(&filterPriority);
          rv = msgHdr->SetPriority(filterPriority);
        } break;
        case nsMsgFilterAction::AddTag: {
          nsCString keyword;
          filterAction->GetStrValue(keyword);
          rv = m_downloadFolder->AddKeywordsToMessages({&*msgHdr}, keyword);
          break;
        }
        case nsMsgFilterAction::JunkScore: {
          nsAutoCString junkScoreStr;
          int32_t junkScore;
          filterAction->GetJunkScore(&junkScore);
          junkScoreStr.AppendInt(junkScore);
          if (junkScore == nsIJunkMailPlugin::IS_SPAM_SCORE) msgIsNew = false;
          rv = msgHdr->SetStringProperty("junkscore", junkScoreStr);
          msgHdr->SetStringProperty("junkscoreorigin", "filter"_ns);
        } break;
        case nsMsgFilterAction::Forward: {
          nsCString forwardTo;
          filterAction->GetStrValue(forwardTo);
          m_forwardTo.AppendElement(forwardTo);
          m_msgToForwardOrReply = msgHdr;
          rv = NS_OK;
        } break;
        case nsMsgFilterAction::Reply: {
          nsCString replyTemplateUri;
          filterAction->GetStrValue(replyTemplateUri);
          m_replyTemplateUri.AppendElement(replyTemplateUri);
          m_msgToForwardOrReply = msgHdr;
          m_ruleAction = filterAction;
          m_filter = filter;
          rv = NS_OK;
        } break;
        case nsMsgFilterAction::DeleteFromPop3Server: {
          nsCOMPtr<nsIMsgFolder> downloadFolder;
          msgHdr->GetFolder(getter_AddRefs(downloadFolder));
          nsCOMPtr<nsIMsgLocalMailFolder> localFolder =
              do_QueryInterface(downloadFolder, &rv);
          if (NS_FAILED(rv) || !localFolder) {
            MOZ_LOG(FILTERLOGMODULE, LogLevel::Error,
                    ("(Local) Couldn't find local mail folder"));
            break;
          }
          // This action ignores the deleteMailLeftOnServer preference
          rv = localFolder->MarkMsgsOnPop3Server({&*msgHdr}, POP3_FORCE_DEL);

          // If this is just a header, throw it away. It's useless now
          // that the server copy is being deleted.
          uint32_t flags = 0;
          msgHdr->GetFlags(&flags);
          if (flags & nsMsgMessageFlags::Partial) {
            m_msgMovedByFilter = true;
            msgIsNew = false;
          }
        } break;
        case nsMsgFilterAction::FetchBodyFromPop3Server: {
          nsCOMPtr<nsIMsgFolder> downloadFolder;
          msgHdr->GetFolder(getter_AddRefs(downloadFolder));
          nsCOMPtr<nsIMsgLocalMailFolder> localFolder =
              do_QueryInterface(downloadFolder, &rv);
          if (NS_FAILED(rv) || !localFolder) {
            MOZ_LOG(FILTERLOGMODULE, LogLevel::Error,
                    ("(Local) Couldn't find local mail folder"));
            break;
          }
          uint32_t flags = 0;
          msgHdr->GetFlags(&flags);
          if (flags & nsMsgMessageFlags::Partial) {
            rv = localFolder->MarkMsgsOnPop3Server({&*msgHdr}, POP3_FETCH_BODY);
            // Don't add this header to the DB, we're going to replace it
            // with the full message.
            m_msgMovedByFilter = true;
            msgIsNew = false;
            // Don't do anything else in this filter, wait until we
            // have the full message.
            *applyMore = false;
          }
        } break;

        case nsMsgFilterAction::StopExecution: {
          // don't apply any more filters
          *applyMore = false;
          rv = NS_OK;
        } break;

        case nsMsgFilterAction::Custom: {
          nsCOMPtr<nsIMsgFilterCustomAction> customAction;
          rv = filterAction->GetCustomAction(getter_AddRefs(customAction));
          if (NS_FAILED(rv)) break;

          nsAutoCString value;
          rv = filterAction->GetStrValue(value);
          if (NS_FAILED(rv)) break;

          rv = customAction->ApplyAction({&*msgHdr}, value, nullptr,
                                         nsMsgFilterType::InboxRule, msgWindow);
        } break;

        default:
          // XXX should not be reached. Check in debug build.
          NS_ERROR("unexpected filter action");
          rv = NS_ERROR_UNEXPECTED;
          break;
      }
    }
    if (NS_FAILED(rv)) {
      finalResult = rv;
      MOZ_LOG(FILTERLOGMODULE, LogLevel::Error,
              ("(Local) Action execution failed with error: %" PRIx32,
               static_cast<uint32_t>(rv)));
      if (loggingEnabled) {
        (void)filter->LogRuleHitFail(filterAction, msgHdr, rv,
                                     "filterFailureAction"_ns);
      }
    } else {
      MOZ_LOG(FILTERLOGMODULE, LogLevel::Info,
              ("(Local) Action execution succeeded"));
    }
  }
  if (!msgIsNew) {
    int32_t numNewMessages;
    m_downloadFolder->GetNumNewMessages(false, &numNewMessages);
    if (numNewMessages > 0)
      m_downloadFolder->SetNumNewMessages(numNewMessages - 1);
    m_numNotNewMessages++;
    MOZ_LOG(FILTERLOGMODULE, LogLevel::Info,
            ("(Local) Message will not be marked new"));
  }
  MOZ_LOG(FILTERLOGMODULE, LogLevel::Info,
          ("(Local) Finished executing actions"));
  return finalResult;
}

// this gets run in a second pass, after apply filters to a header.
nsresult nsParseNewMailState::ApplyForwardAndReplyFilter(
    nsIMsgWindow* msgWindow) {
  nsresult rv = NS_OK;
  nsCOMPtr<nsIMsgIncomingServer> server;

  uint32_t i;
  uint32_t count = m_forwardTo.Length();
  nsMsgKey msgKey;
  if (count > 0 && m_msgToForwardOrReply) {
    m_msgToForwardOrReply->GetMessageKey(&msgKey);
    MOZ_LOG(FILTERLOGMODULE, LogLevel::Info,
            ("(Local) Forwarding message with key %" PRIu32 " to %" PRIu32
             " addresses",
             msgKeyToInt(msgKey), count));
  }

  for (i = 0; i < count; i++) {
    if (!m_forwardTo[i].IsEmpty()) {
      nsAutoString forwardStr;
      CopyASCIItoUTF16(m_forwardTo[i], forwardStr);
      rv = m_rootFolder->GetServer(getter_AddRefs(server));
      NS_ENSURE_SUCCESS(rv, rv);
      {
        nsCOMPtr<nsIMsgComposeService> compService =
            do_GetService("@mozilla.org/messengercompose;1", &rv);
        NS_ENSURE_SUCCESS(rv, rv);
        rv = compService->ForwardMessage(
            forwardStr, m_msgToForwardOrReply, msgWindow, server,
            nsIMsgComposeService::kForwardAsDefault);
        if (NS_FAILED(rv))
          MOZ_LOG(FILTERLOGMODULE, LogLevel::Error,
                  ("(Local) Forwarding failed"));
      }
    }
  }
  m_forwardTo.Clear();

  count = m_replyTemplateUri.Length();
  if (count > 0 && m_msgToForwardOrReply) {
    MOZ_LOG(FILTERLOGMODULE, LogLevel::Info,
            ("(Local) Replying message with key %" PRIu32 " to %" PRIu32
             " addresses",
             msgKeyToInt(msgKey), count));
  }

  for (i = 0; i < count; i++) {
    if (!m_replyTemplateUri[i].IsEmpty()) {
      // copy this and truncate the original, so we don't accidentally re-use it
      // on the next hdr.
      rv = m_rootFolder->GetServer(getter_AddRefs(server));
      if (server) {
        nsCOMPtr<nsIMsgComposeService> compService =
            do_GetService("@mozilla.org/messengercompose;1");
        if (compService) {
          rv = compService->ReplyWithTemplate(
              m_msgToForwardOrReply, m_replyTemplateUri[i], msgWindow, server);
          if (NS_FAILED(rv)) {
            NS_WARNING("ReplyWithTemplate failed");
            MOZ_LOG(FILTERLOGMODULE, LogLevel::Error,
                    ("(Local) Replying failed"));
            if (rv == NS_ERROR_ABORT) {
              (void)m_filter->LogRuleHitFail(
                  m_ruleAction, m_msgToForwardOrReply, rv,
                  "filterFailureSendingReplyAborted"_ns);
            } else {
              (void)m_filter->LogRuleHitFail(
                  m_ruleAction, m_msgToForwardOrReply, rv,
                  "filterFailureSendingReplyError"_ns);
            }
          }
        }
      }
    }
  }
  m_replyTemplateUri.Clear();
  m_msgToForwardOrReply = nullptr;
  return rv;
}

void nsParseNewMailState::MarkFilteredMessageRead(nsIMsgDBHdr* msgHdr) {
  m_downloadFolder->MarkMessagesRead({msgHdr}, true);
}

void nsParseNewMailState::MarkFilteredMessageUnread(nsIMsgDBHdr* msgHdr) {
  uint32_t newFlags;
  if (m_mailDB) {
    nsMsgKey msgKey;
    msgHdr->GetMessageKey(&msgKey);
    m_mailDB->AddToNewList(msgKey);
  } else {
    msgHdr->OrFlags(nsMsgMessageFlags::New, &newFlags);
  }
  m_downloadFolder->MarkMessagesRead({msgHdr}, false);
}

nsresult nsParseNewMailState::EndMsgDownload() {
  if (m_moveCoalescer) m_moveCoalescer->PlaybackMoves();

  // need to do this for all folders that had messages filtered into them
  for (auto folder : m_filterTargetFolders) {
    uint32_t folderFlags;
    folder->GetFlags(&folderFlags);
    if (!(folderFlags & (nsMsgFolderFlags::Trash | nsMsgFolderFlags::Inbox))) {
      bool filtersRun;
      folder->CallFilterPlugins(nullptr, &filtersRun);
      if (!filtersRun) folder->SetMsgDatabase(nullptr);
    }
  }
  // means there are filter moved mail that moveCoalescer didn't handle, we need
  // to do it from m_filterTargetFoldersMsgMovedCount.
  if (m_filterTargetFoldersMsgMovedCount) {
    for (const auto& entry : *m_filterTargetFoldersMsgMovedCount) {
      nsCOMPtr<nsIMsgFolder> targetIFolder;
      nsresult rv =
          GetExistingFolder(entry.GetKey(), getter_AddRefs(targetIFolder));
      if (NS_FAILED(rv)) {
        continue;
      }
      uint32_t destFlags;
      targetIFolder->GetFlags(&destFlags);
      if (!(destFlags &
            nsMsgFolderFlags::Junk))  // don't set has new on junk folder
      {
        int32_t filterFolderNumNewMessages;
        int32_t filterFolderNumNewMovedMessages = entry.GetData();

        targetIFolder->GetNumNewMessages(false, &filterFolderNumNewMessages);
        filterFolderNumNewMessages += filterFolderNumNewMovedMessages;
        targetIFolder->SetNumNewMessages(filterFolderNumNewMessages);

        if (filterFolderNumNewMessages > 0) {
          targetIFolder->SetHasNewMessages(true);
          targetIFolder->SetBiffState(nsIMsgFolder::nsMsgBiffState_NewMail);
        }
      }
    }

    m_filterTargetFoldersMsgMovedCount->Clear();
    m_filterTargetFoldersMsgMovedCount = nullptr;
  }
  m_filterTargetFolders.Clear();
  return NS_OK;
}

nsresult nsParseNewMailState::AppendMsgFromStream(nsIInputStream* fileStream,
                                                  nsIMsgDBHdr* aHdr,
                                                  nsIMsgFolder* destFolder) {
  nsCOMPtr<nsIMsgPluggableStore> store;
  nsCOMPtr<nsIOutputStream> destOutputStream;
  nsresult rv = destFolder->GetMsgStore(getter_AddRefs(store));
  NS_ENSURE_SUCCESS(rv, rv);
  rv = store->GetNewMsgOutputStream(destFolder, &aHdr,
                                    getter_AddRefs(destOutputStream));
  NS_ENSURE_SUCCESS(rv, rv);

  uint64_t bytesCopied;
  rv = SyncCopyStream(fileStream, destOutputStream, bytesCopied);
  NS_ENSURE_SUCCESS(rv, rv);

  rv = store->FinishNewMessage(destOutputStream, aHdr);
  NS_ENSURE_SUCCESS(rv, rv);
  return NS_OK;
}

/*
 * Moves message pointed to by mailHdr into folder destIFolder.
 * After successful move mailHdr is no longer usable by the caller.
 */
nsresult nsParseNewMailState::MoveIncorporatedMessage(nsIMsgDBHdr* mailHdr,
                                                      nsIMsgDatabase* sourceDB,
                                                      nsIMsgFolder* destIFolder,
                                                      nsIMsgFilter* filter,
                                                      nsIMsgWindow* msgWindow) {
  NS_ENSURE_ARG_POINTER(destIFolder);
  nsresult rv = NS_OK;

  // check if the destination is a real folder (by checking for null parent)
  // and if it can file messages (e.g., servers or news folders can't file
  // messages). Or read only imap folders...
  bool canFileMessages = true;
  nsCOMPtr<nsIMsgFolder> parentFolder;
  destIFolder->GetParent(getter_AddRefs(parentFolder));
  if (parentFolder) destIFolder->GetCanFileMessages(&canFileMessages);
  if (!parentFolder || !canFileMessages) {
    if (filter) {
      filter->SetEnabled(false);
      // we need to explicitly save the filter file.
      if (m_filterList) m_filterList->SaveToDefaultFile();
      destIFolder->ThrowAlertMsg("filterDisabled", msgWindow);
    }
    return NS_MSG_NOT_A_MAIL_FOLDER;
  }

  uint32_t messageLength;
  mailHdr->GetMessageSize(&messageLength);

  nsCOMPtr<nsIMsgLocalMailFolder> localFolder = do_QueryInterface(destIFolder);
  if (localFolder) {
    bool destFolderTooBig = true;
    rv = localFolder->WarnIfLocalFileTooBig(msgWindow, messageLength,
                                            &destFolderTooBig);
    if (NS_FAILED(rv) || destFolderTooBig)
      return NS_MSG_ERROR_WRITING_MAIL_FOLDER;
  }

  nsCOMPtr<nsISupports> myISupports =
      do_QueryInterface(static_cast<nsIMsgParseMailMsgState*>(this));

  // Make sure no one else is writing into this folder
  if (NS_FAILED(rv = destIFolder->AcquireSemaphore(myISupports))) {
    destIFolder->ThrowAlertMsg("filterFolderDeniedLocked", msgWindow);
    return rv;
  }
  nsCOMPtr<nsIInputStream> inputStream;
  rv =
      m_downloadFolder->GetLocalMsgStream(mailHdr, getter_AddRefs(inputStream));
  if (NS_FAILED(rv)) {
    NS_ERROR("couldn't get source msg input stream in move filter");
    destIFolder->ReleaseSemaphore(myISupports);
    return NS_MSG_FOLDER_UNREADABLE;  // ### dmb
  }

  nsCOMPtr<nsIMsgDatabase> destMailDB;

  if (!localFolder) {
    destIFolder->ReleaseSemaphore(myISupports);
    return NS_MSG_POP_FILTER_TARGET_ERROR;
  }

  // don't force upgrade in place - open the db here before we start writing to
  // the destination file because XP_Stat can return file size including bytes
  // written...
  rv = localFolder->GetDatabaseWOReparse(getter_AddRefs(destMailDB));
  NS_WARNING_ASSERTION(destMailDB && NS_SUCCEEDED(rv),
                       "failed to open mail db parsing folder");
  nsCOMPtr<nsIMsgDBHdr> newHdr;

  if (destMailDB)
    rv = destMailDB->CopyHdrFromExistingHdr(m_new_key, mailHdr, true,
                                            getter_AddRefs(newHdr));
  if (NS_SUCCEEDED(rv) && !newHdr) rv = NS_ERROR_UNEXPECTED;

  if (NS_FAILED(rv)) {
    destIFolder->ThrowAlertMsg("filterFolderHdrAddFailed", msgWindow);
  } else {
    rv = AppendMsgFromStream(inputStream, newHdr, destIFolder);
    if (NS_FAILED(rv))
      destIFolder->ThrowAlertMsg("filterFolderWriteFailed", msgWindow);
  }

  if (NS_FAILED(rv)) {
    if (destMailDB) destMailDB->Close(true);

    destIFolder->ReleaseSemaphore(myISupports);

    return NS_MSG_ERROR_WRITING_MAIL_FOLDER;
  }

  bool movedMsgIsNew = false;
  // if we have made it this far then the message has successfully been written
  // to the new folder now add the header to the destMailDB.

  uint32_t newFlags;
  newHdr->GetFlags(&newFlags);
  nsMsgKey msgKey;
  newHdr->GetMessageKey(&msgKey);
  if (!(newFlags & nsMsgMessageFlags::Read)) {
    nsCString junkScoreStr;
    (void)newHdr->GetStringProperty("junkscore", junkScoreStr);
    if (atoi(junkScoreStr.get()) == nsIJunkMailPlugin::IS_HAM_SCORE) {
      newHdr->OrFlags(nsMsgMessageFlags::New, &newFlags);
      destMailDB->AddToNewList(msgKey);
      movedMsgIsNew = true;
    }
  }
  nsCOMPtr<nsIMsgFolderNotificationService> notifier(
      do_GetService("@mozilla.org/messenger/msgnotificationservice;1"));
  if (notifier) notifier->NotifyMsgAdded(newHdr);
  // mark the header as not yet reported classified
  destIFolder->OrProcessingFlags(msgKey,
                                 nsMsgProcessingFlags::NotReportedClassified);
  m_msgToForwardOrReply = newHdr;

  if (movedMsgIsNew) destIFolder->SetHasNewMessages(true);
  if (!m_filterTargetFolders.Contains(destIFolder))
    m_filterTargetFolders.AppendObject(destIFolder);

  destIFolder->ReleaseSemaphore(myISupports);

  (void)localFolder->RefreshSizeOnDisk();

  // Notify the message was moved.
  if (notifier) {
    nsCOMPtr<nsIMsgFolder> folder;
    nsresult rv = mailHdr->GetFolder(getter_AddRefs(folder));
    if (NS_SUCCEEDED(rv)) {
      notifier->NotifyMsgUnincorporatedMoved(folder, newHdr);
    } else {
      NS_WARNING("Can't get folder for message that was moved.");
    }
  }

  nsCOMPtr<nsIMsgPluggableStore> store;
  rv = m_downloadFolder->GetMsgStore(getter_AddRefs(store));
  if (store) store->DiscardNewMessage(m_outputStream, mailHdr);
  if (sourceDB) sourceDB->RemoveHeaderMdbRow(mailHdr);

  // update the folder size so we won't reparse.
  UpdateDBFolderInfo(destMailDB);
  destIFolder->UpdateSummaryTotals(true);

  destMailDB->Commit(nsMsgDBCommitType::kLargeCommit);
  return rv;
}

nsresult nsParseNewMailState::HandleLine(const char* line,
                                         uint32_t lineLength) {
  NS_ENSURE_STATE(m_mailDB);  // if no DB, do we need to parse at all?
  return ParseFolderLine(line, lineLength);
}

void nsParseNewMailState::UpdateDBFolderInfo() { UpdateDBFolderInfo(m_mailDB); }

// update folder info in db so we know not to reparse.
void nsParseNewMailState::UpdateDBFolderInfo(nsIMsgDatabase* mailDB) {
  mailDB->SetSummaryValid(true);
}
