/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef nsParseMailbox_H
#define nsParseMailbox_H

#include "nsIMsgParseMailMsgState.h"
#include "nsIStreamListener.h"
#include "nsMsgLineBuffer.h"
#include "nsIMsgDatabase.h"
#include "nsIMsgHdr.h"
#include "nsIMsgStatusFeedback.h"
#include "nsCOMPtr.h"
#include "nsCOMArray.h"
#include "nsIDBChangeListener.h"
#include "nsIWeakReferenceUtils.h"
#include "nsIMsgWindow.h"
#include "nsImapMoveCoalescer.h"
#include "nsString.h"
#include "nsIMsgFilterList.h"
#include "nsIMsgFilter.h"
#include "nsIMsgFilterHitNotify.h"
#include "nsTArray.h"
#include "nsTHashMap.h"
#include "mozilla/UniquePtr.h"
#include "mozilla/Vector.h"

class nsOutputFileStream;
class nsIMsgFolder;

// Used for the various things that parse RFC822 headers...
struct HeaderData {
  const char* value = nullptr;  // The contents of a header (after ": ")
  size_t length = 0;  // The length of the data (it is not NULL-terminated.)
};

// This object maintains the parse state for a single mail message.
class nsParseMailMessageState : public nsIMsgParseMailMsgState,
                                public nsIDBChangeListener {
 public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSIMSGPARSEMAILMSGSTATE
  NS_DECL_NSIDBCHANGELISTENER

  nsParseMailMessageState();

  nsresult ParseFolderLine(const char* line, uint32_t lineLength);
  nsresult ParseHeaders();
  nsresult FinalizeHeaders();
  nsresult InternSubject(HeaderData* header);

  // A way to pass in 'out-of-band' envelope sender/timestamp data.
  // Totally optional, but envDate is used to fill in on malformed messages
  // without a "Date:" header.
  void SetEnvDetails(nsACString const& envAddr, PRTime envDate) {
    m_EnvAddr = envAddr;
    m_EnvDate = envDate;
  }

  nsCOMPtr<nsIMsgDBHdr> m_newMsgHdr; /* current message header we're building */
  nsCOMPtr<nsIMsgDatabase> m_mailDB;
  nsCOMPtr<nsIMsgDatabase> m_backupMailDB;

  // These two aren't part of the message, but may be provided 'out-of-band',
  // via SetEnvDetails();
  // Traditionally they are parsed from the "From " lines in
  // mbox files.
  nsAutoCString m_EnvAddr;  // "" if missing.
  PRTime m_EnvDate;         // 0 if missing.

  nsMailboxParseState m_state;
  int64_t m_position;
  // The start of the "From " line (the line before the start of the message).
  uint64_t m_envelope_pos;
  // The start of the message headers (immediately follows "From " line).
  uint64_t m_headerstartpos;
  nsMsgKey m_new_key;  // DB key for the new header.

  // The raw header data.
  mozilla::Vector<char> m_headers;

  // These all point into the m_headers buffer.
  HeaderData m_message_id;
  HeaderData m_references;
  HeaderData m_date;
  HeaderData m_delivery_date;
  HeaderData m_from;
  HeaderData m_sender;
  HeaderData m_newsgroups;
  HeaderData m_subject;
  HeaderData m_status;
  HeaderData m_mozstatus;
  HeaderData m_mozstatus2;
  HeaderData m_in_reply_to;
  HeaderData m_replyTo;
  HeaderData m_content_type;
  HeaderData m_bccList;

  // Support for having multiple To or Cc header lines in a message
  AutoTArray<HeaderData, 1> m_toList;
  AutoTArray<HeaderData, 1> m_ccList;

  HeaderData m_priority;
  HeaderData m_account_key;
  HeaderData m_keywords;

  // Mdn support
  HeaderData m_mdn_original_recipient;
  HeaderData m_return_path;
  HeaderData m_mdn_dnt; /* MDN Disposition-Notification-To: header */

  PRTime m_receivedTime;
  uint16_t m_body_lines;

  // this enables extensions to add the values of particular headers to
  // the .msf file as properties of nsIMsgHdr. It is initialized from a
  // pref, mailnews.customDBHeaders
  nsTArray<nsCString> m_customDBHeaders;
  nsTArray<HeaderData> m_customDBHeaderData;
  nsCString m_receivedValue;  // accumulated received header
 protected:
  virtual ~nsParseMailMessageState() {};
};

// NOTE:
// nsMsgMailboxParser is a vestigial class, no longer used directly.
// It's been left in because it's a base class for nsParseNewMailState, but
// ultimately it should be removed completely.
// Originally, a single parser instance was used to handle multiple
// messages. But that made lots of inherent mbox-specific assumptions, and
// the carried-between-messages state made it very hard to follow.
class nsMsgMailboxParser : public nsIStreamListener,
                           public nsParseMailMessageState,
                           public nsMsgLineBuffer {
 public:
  explicit nsMsgMailboxParser(nsIMsgFolder*);
  nsMsgMailboxParser();
  nsresult Init();

  NS_DECL_ISUPPORTS_INHERITED

  ////////////////////////////////////////////////////////////////////////////////////////
  // we support the nsIStreamListener interface
  ////////////////////////////////////////////////////////////////////////////////////////
  NS_DECL_NSIREQUESTOBSERVER
  NS_DECL_NSISTREAMLISTENER

  void SetDB(nsIMsgDatabase* mailDB) { m_mailDB = mailDB; }

  // message socket libnet callbacks, which come through folder pane
  nsresult ProcessMailboxInputStream(nsIInputStream* aIStream,
                                     uint32_t aLength);

  virtual void DoneParsingFolder(nsresult status);
  virtual void AbortNewHeader();

  // for nsMsgLineBuffer
  virtual nsresult HandleLine(const char* line, uint32_t line_length) override;

  void UpdateDBFolderInfo();
  void UpdateDBFolderInfo(nsIMsgDatabase* mailDB);
  void UpdateStatusText(const char* stringName);

  // Update the progress bar based on what we know.
  virtual void UpdateProgressPercent();
  virtual void OnNewMessage(nsIMsgWindow* msgWindow);

 protected:
  virtual ~nsMsgMailboxParser();
  nsCOMPtr<nsIMsgStatusFeedback> m_statusFeedback;

  virtual void PublishMsgHeader(nsIMsgWindow* msgWindow);

  // data
  nsString m_folderName;
  nsCString m_inboxUri;
  ::nsByteArray m_inputStream;
  uint64_t m_graph_progress_total;
  uint64_t m_graph_progress_received;

 private:
  nsWeakPtr m_folder;
  void ReleaseFolderLock();
  nsresult AcquireFolderLock();
};

class nsParseNewMailState : public nsMsgMailboxParser,
                            public nsIMsgFilterHitNotify {
 public:
  nsParseNewMailState();
  NS_DECL_ISUPPORTS_INHERITED

  nsresult Init(nsIMsgFolder* rootFolder, nsIMsgFolder* downloadFolder,
                nsIMsgWindow* aMsgWindow, nsIMsgDBHdr* aHdr,
                nsIOutputStream* aOutputStream);

  virtual void DoneParsingFolder(nsresult status) override;

  void DisableFilters() { m_disableFilters = true; }

  NS_DECL_NSIMSGFILTERHITNOTIFY

  nsOutputFileStream* GetLogFile();
  virtual void PublishMsgHeader(nsIMsgWindow* msgWindow) override;
  void GetMsgWindow(nsIMsgWindow** aMsgWindow);
  nsresult EndMsgDownload();

  nsresult AppendMsgFromStream(nsIInputStream* fileStream, nsIMsgDBHdr* aHdr,
                               nsIMsgFolder* destFolder);

  void ApplyFilters(bool* pMoved, nsIMsgWindow* msgWindow);
  nsresult ApplyForwardAndReplyFilter(nsIMsgWindow* msgWindow);
  virtual void OnNewMessage(nsIMsgWindow* msgWindow) override;

  // These three vars are public because they need to be carried between
  // messages.

  // this keeps track of how many messages we downloaded that
  // aren't new - e.g., marked read, or moved to an other server.
  int32_t m_numNotNewMessages;
  // Filter-initiated moves are collected to run all at once.
  RefPtr<nsImapMoveCoalescer> m_moveCoalescer;
  mozilla::UniquePtr<nsTHashMap<nsCStringHashKey, int32_t>>
      m_filterTargetFoldersMsgMovedCount;

 protected:
  virtual ~nsParseNewMailState();
  virtual nsresult GetTrashFolder(nsIMsgFolder** pTrashFolder);
  virtual nsresult MoveIncorporatedMessage(nsIMsgDBHdr* mailHdr,
                                           nsIMsgDatabase* sourceDB,
                                           nsIMsgFolder* destIFolder,
                                           nsIMsgFilter* filter,
                                           nsIMsgWindow* msgWindow);
  virtual void MarkFilteredMessageRead(nsIMsgDBHdr* msgHdr);
  virtual void MarkFilteredMessageUnread(nsIMsgDBHdr* msgHdr);

  nsCOMPtr<nsIMsgFilterList> m_filterList;
  nsCOMPtr<nsIMsgFilterList> m_deferredToServerFilterList;
  nsCOMPtr<nsIMsgFolder> m_rootFolder;
  nsCOMPtr<nsIMsgWindow> m_msgWindow;
  nsCOMPtr<nsIMsgFolder> m_downloadFolder;
  nsCOMPtr<nsIOutputStream> m_outputStream;
  nsCOMArray<nsIMsgFolder> m_filterTargetFolders;

  bool m_msgMovedByFilter;
  bool m_msgCopiedByFilter;
  bool m_disableFilters;

  // we have to apply the reply/forward filters in a second pass, after
  // msg quarantining and moving to other local folders, so we remember the
  // info we'll need to apply them with these vars.
  // these need to be arrays in case we have multiple reply/forward filters.
  nsTArray<nsCString> m_forwardTo;
  nsTArray<nsCString> m_replyTemplateUri;
  nsCOMPtr<nsIMsgDBHdr> m_msgToForwardOrReply;
  nsCOMPtr<nsIMsgFilter> m_filter;
  nsCOMPtr<nsIMsgRuleAction> m_ruleAction;
};

#endif
