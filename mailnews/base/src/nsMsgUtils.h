/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef _NSMSGUTILS_H
#define _NSMSGUTILS_H

#include "nsString.h"
#include "msgCore.h"
#include "MailNewsTypes2.h"
#include "nsTArray.h"
#include "nsINetUtil.h"
#include "nsILoadInfo.h"
#include "nsIFile.h"

class nsIChannel;
class nsIFile;
class nsIPrefBranch;
class nsIMsgFolder;
class nsIMsgMessageService;
class nsIUrlListener;
class nsIOutputStream;
class nsIInputStream;
class nsIMsgDatabase;
class nsIProxyInfo;
class nsIMsgWindow;
class nsIStreamListener;
class nsICancelable;
class nsIProtocolProxyCallback;
class nsIMsgSearchTerm;

#define FILE_IO_BUFFER_SIZE (16 * 1024)
#define MSGS_URL "chrome://messenger/locale/messenger.properties"

enum nsDateFormatSelectorComm : long {
  kDateFormatNone = 0,
  kDateFormatLong = 1,
  kDateFormatShort = 2,
  kDateFormatUnused = 3,
  kDateFormatWeekday = 4
};

// These are utility functions that can used throughout the mailnews code

nsresult GetMessageServiceContractIDForURI(const char* uri,
                                           nsCString& contractID);

nsresult GetMessageServiceFromURI(const nsACString& uri,
                                  nsIMsgMessageService** aMessageService);

nsresult GetMsgDBHdrFromURI(const nsACString& uri, nsIMsgDBHdr** msgHdr);

nsresult NS_MsgGetPriorityFromString(const char* const priority,
                                     nsMsgPriorityValue& outPriority);

nsresult NS_MsgGetPriorityValueString(const nsMsgPriorityValue p,
                                      nsACString& outValueString);

nsresult NS_MsgGetUntranslatedPriorityName(const nsMsgPriorityValue p,
                                           nsACString& outName);

[[nodiscard]] nsString NS_MsgHashIfNecessary(const nsACString& unsafeName);
[[nodiscard]] nsString NS_MsgHashIfNecessary(const nsAString& unsafeName);

nsresult FormatFileSize(int64_t size, bool useKB, nsAString& formattedSize);

/**
 * given a folder uri, return the path to folder in the user profile directory.
 *
 * @param aFolderURI uri of folder we want the path to, without the scheme
 * @param[out] aPathString result path string
 * @param aScheme scheme of the uri
 * @param[optional] aIsNewsFolder is this a news folder?
 */
nsresult NS_MsgCreatePathStringFromFolderURI(const char* aFolderURI,
                                             nsString& aPathString,
                                             bool aIsNewsFolder = false);

/**
 * Given a string and a length, removes any "Re:" strings from the front.
 * It also deals with that dumbass "Re[2]:" thing that some losing mailers do.
 *
 * If mailnews.localizedRe is set, it will also remove localized "Re:" strings.
 *
 * @return true if it made a change (in which case the caller should look to
 *         modifiedSubject for the result) and false otherwise (in which
 *         case the caller should look at subject for the result)
 */
bool NS_MsgStripRE(const nsCString& subject, nsCString& modifiedSubject);

char* NS_MsgSACopy(char** destination, const char* source);

char* NS_MsgSACat(char** destination, const char* source);

nsresult NS_MsgEscapeEncodeURLPath(const nsACString& aStr, nsCString& aResult);

nsresult NS_MsgDecodeUnescapeURLPath(const nsACString& aPath,
                                     nsAString& aResult);

bool WeAreOffline();

// Get a folder by Uri, returning null if it doesn't exist (or if some
// error occurs). A missing folder is not considered an error.
nsresult FindFolder(const nsACString& aFolderURI, nsIMsgFolder** aFolder);

// Get a folder by Uri.
// A missing folder is considered to be an error.
// Returns a non-null folder if and only if result is NS_OK.
nsresult GetExistingFolder(const nsACString& aFolderURI,
                           nsIMsgFolder** aFolder);

// Get a folder by Uri, creating it if it doesn't already exist.
// An error is returned if a folder cannot be found or created.
// Created folders will be 'dangling' folders (ie not connected to a
// parent).
nsresult GetOrCreateFolder(const nsACString& aFolderURI,
                           nsIMsgFolder** aFolder);

// Escape lines starting with "From ", ">From ", etc. in a buffer.
nsresult EscapeFromSpaceLine(nsIOutputStream* ouputStream, char* start,
                             const char* end);
bool IsAFromSpaceLine(char* start, const char* end);

nsresult NS_GetPersistentFile(const char* relPrefName, const char* absPrefName,
                              const char* dirServiceProp,  // Can be NULL
                              bool& gotRelPref, nsIFile** aFile,
                              nsIPrefBranch* prefBranch = nullptr);

nsresult NS_SetPersistentFile(const char* relPrefName, const char* absPrefName,
                              nsIFile* aFile,
                              nsIPrefBranch* prefBranch = nullptr);

nsresult IsRFC822HeaderFieldName(const char* aHdr, bool* aResult);

nsresult NS_GetLocalizedUnicharPreferenceWithDefault(
    nsIPrefBranch* prefBranch,  // can be null, if so uses the root branch
    const char* prefName, const nsAString& defValue, nsAString& prefValue);

nsresult NS_GetLocalizedUnicharPreference(
    nsIPrefBranch* prefBranch,  // can be null, if so uses the root branch
    const char* prefName, nsAString& prefValue);

mozilla::Maybe<nsLiteralCString> StatusCodeToL10nId(nsresult aStatus);
nsresult FormatStatusMessage(nsresult aStatus, const nsAString& aHost,
                             nsAString& aRetVal);

/**
 * this needs a listener, because we might have to create the folder
 * on the server, and that is asynchronous
 */
nsresult GetOrCreateJunkFolder(const nsACString& aURI,
                               nsIUrlListener* aListener);

// Returns true if the nsIURI is a message under an RSS account
nsresult IsRSSArticle(nsIURI* aMsgURI, bool* aIsRSSArticle);

// digest needs to be a pointer to a 16 byte buffer
#define DIGEST_LENGTH 16

nsresult MSGCramMD5(const char* text, int32_t text_len, const char* key,
                    int32_t key_len, unsigned char* digest);

// helper functions to convert a 64bits PRTime into a 32bits value (compatible
// time_t) and vice versa.
void PRTime2Seconds(PRTime prTime, uint32_t* seconds);
void PRTime2Seconds(PRTime prTime, int32_t* seconds);
void Seconds2PRTime(uint32_t seconds, PRTime* prTime);

// Appends the correct summary file extension onto the supplied fileLocation
// and returns it in summaryLocation.
// e.g. "foo/bar/folder" => "foo/bar/folder.msf"
nsresult GetSummaryFileLocation(nsIFile* fileLocation,
                                nsIFile** summaryLocation);

// Gets a special directory and appends the supplied file name onto it.
nsresult GetSpecialDirectoryWithFileName(const char* specialDirName,
                                         const char* fileName,
                                         nsIFile** result);

// cleanup temp files with the given filename and extension, including
// the consecutive -NNNN ones that we can find. If there are holes, e.g.,
// <filename>-1-10,12.<extension> exist, but <filename>-11.<extension> does not
// we'll clean up 1-10. If the leaks are common, I think the gaps will tend to
// be filled.
nsresult MsgCleanupTempFiles(const char* fileName, const char* extension);

nsresult MsgGetFileStream(nsIFile* file, nsIOutputStream** fileStream);

// Automatically creates an output stream with a suitable buffer
nsresult MsgNewBufferedFileOutputStream(nsIOutputStream** aResult,
                                        nsIFile* aFile, int32_t aIOFlags = -1,
                                        int32_t aPerm = -1);

// Automatically creates an output stream with a suitable buffer, but write to a
// temporary file first, then rename to aFile
nsresult MsgNewSafeBufferedFileOutputStream(nsIOutputStream** aResult,
                                            nsIFile* aFile,
                                            int32_t aIOFlags = -1,
                                            int32_t aPerm = -1);

// fills in the position of the passed in keyword in the passed in keyword list
// and returns false if the keyword isn't present
bool MsgFindKeyword(const nsCString& keyword, nsCString& keywords,
                    int32_t* aStartOfKeyword, int32_t* aLength);

bool MsgHostDomainIsTrusted(nsCString& host, nsCString& trustedMailDomains);

void MsgStripQuotedPrintable(nsCString& aSrc);

/*
 * Utility functions that call functions from nsINetUtil
 */

nsresult MsgEscapeString(const nsACString& aStr, uint32_t aType,
                         nsACString& aResult);

nsresult MsgUnescapeString(const nsACString& aStr, uint32_t aFlags,
                           nsACString& aResult);

nsresult MsgEscapeURL(const nsACString& aStr, uint32_t aFlags,
                      nsACString& aResult);

// Given a message db and a set of keys, fetch the corresponding message
// headers.
nsresult MsgGetHeadersFromKeys(nsIMsgDatabase* aDB,
                               const nsTArray<nsMsgKey>& aKeys,
                               nsTArray<RefPtr<nsIMsgDBHdr>>& aHeaders);

nsresult MsgExamineForProxyAsync(nsIChannel* channel,
                                 nsIProtocolProxyCallback* listener,
                                 nsICancelable** result);

int32_t MsgFindCharInSet(const nsCString& aString, const char* aChars,
                         uint32_t aOffset = 0);
int32_t MsgFindCharInSet(const nsString& aString, const char16_t* aChars,
                         uint32_t aOffset = 0);

/**
 * Alerts the user that the login to the server failed. Asks whether the
 * connection should: retry, cancel, or request a new password.
 *
 * @param aMsgWindow The message window associated with this action (cannot
 *                   be null).
 * @param aHostname  The hostname of the server for which the login failed.
 * @param aResult    The button pressed. 0 for retry, 1 for cancel,
 *                   2 for enter a new password.
 * @return           NS_OK for success, NS_ERROR_* if there was a failure in
 *                   creating the dialog.
 */
nsresult MsgPromptLoginFailed(nsIMsgWindow* aMsgWindow,
                              const nsACString& aHostname,
                              const nsACString& aUsername,
                              const nsACString& aAccountname, int32_t* aResult);

/**
 * Calculate a PRTime value used to determine if a date is XX
 * days ago. This is used by various retention setting algorithms.
 */
PRTime MsgConvertAgeInDaysToCutoffDate(int32_t ageInDays);

/**
 * Converts the passed in term list to its string representation.
 *
 * @param      aTermList    Array of nsIMsgSearchTerms
 * @param[out] aOutString   result representation of search terms.
 *
 */
nsresult MsgTermListToString(
    nsTArray<RefPtr<nsIMsgSearchTerm>> const& aTermList, nsCString& aOutString);

nsresult MsgStreamMsgHeaders(nsIInputStream* aInputStream,
                             nsIStreamListener* aConsumer);

/**
 * convert string to uint64_t
 *
 * @param str converted string
 * @returns   uint64_t value for success, 0 for parse failure
 */
uint64_t ParseUint64Str(const char* str);

/**
 * Detect charset of file
 *
 * @param      aFile    The target of nsIFile
 * @param[out] aCharset The charset string
 */
nsresult MsgDetectCharsetFromFile(nsIFile* aFile, nsACString& aCharset);

/*
 * Converts a buffer to plain text. Some conversions may
 * or may not work with certain end charsets which is why we
 * need that as an argument to the function. If charset is
 * unknown or deemed of no importance NULL could be passed.
 * @param[in/out] aConBuf        Variable with the text to convert
 * @param         formatFlowed   Use format flowed?
 * @param         formatOutput   Reformat the output?
 & @param         disallowBreaks Disallow breaks when formatting
 */
nsresult ConvertBufToPlainText(nsString& aConBuf, bool formatFlowed,
                               bool formatOutput, bool disallowBreaks);

#include "nsEscape.h"

/**
 * Converts a hex string into an integer.
 * Processes up to aNumChars characters or the first non-hex char.
 * It is not an error if less than aNumChars valid hex digits are found.
 */
uint64_t MsgUnhex(const char* aHexString, size_t aNumChars);

/**
 * Checks if a string is a valid hex literal containing at least aNumChars
 * digits.
 */
bool MsgIsHex(const char* aHexString, size_t aNumChars);

/**
 * Convert an uint32_t to a nsMsgKey.
 * Currently they are mostly the same but we need to preserve the notion that
 * nsMsgKey is an opaque value that can't be treated as a generic integer
 * (except when storing it into the database). It enables type safety checks and
 * may prevent coding errors.
 */
nsMsgKey msgKeyFromInt(uint32_t aValue);

nsMsgKey msgKeyFromInt(uint64_t aValue);

uint32_t msgKeyToInt(nsMsgKey aMsgKey);

/**
 * Helper function to extract query part from URL spec.
 */
nsCString MsgExtractQueryPart(const nsACString& spec,
                              const char* queryToExtract);
/**
 * Helper function to remove query part from URL spec or path.
 */
void MsgRemoveQueryPart(nsCString& aSpec);

/**
 * Helper macro for defining getter/setters. Ported from nsISupportsObsolete.h
 */
#define NS_IMPL_GETSET(clazz, attr, type, member) \
  NS_IMETHODIMP clazz::Get##attr(type* result) {  \
    NS_ENSURE_ARG_POINTER(result);                \
    *result = member;                             \
    return NS_OK;                                 \
  }                                               \
  NS_IMETHODIMP clazz::Set##attr(type aValue) {   \
    member = aValue;                              \
    return NS_OK;                                 \
  }

/**
 * Macro and helper function for reporting an error, warning or
 * informational message to the Error Console
 *
 * This will require the inclusion of the following files in the source file
 * #include "nsIScriptError.h"
 * #include "nsIConsoleService.h"
 *
 */

void MsgLogToConsole4(const nsAString& aErrorText, const nsCString& aFilename,
                      uint32_t aLine, uint32_t flags);

// Macro with filename and line number
#define MSG_LOG_TO_CONSOLE(_text, _flag)                                       \
  MsgLogToConsole4(NS_LITERAL_STRING_FROM_CSTRING(_text), nsCString(__FILE__), \
                   __LINE__, _flag)
#define MSG_LOG_ERR_TO_CONSOLE(_text) \
  MSG_LOG_TO_CONSOLE(_text, nsIScriptError::errorFlag)
#define MSG_LOG_WARN_TO_CONSOLE(_text) \
  MSG_LOG_TO_CONSOLE(_text, nsIScriptError::warningFlag)
#define MSG_LOG_INFO_TO_CONSOLE(_text) \
  MSG_LOG_TO_CONSOLE(_text, nsIScriptError::infoFlag)

// Helper macros to cope with shoddy I/O error reporting (or lack thereof)
#define MSG_NS_ERROR(_txt)        \
  do {                            \
    NS_ERROR(_txt);               \
    MSG_LOG_ERR_TO_CONSOLE(_txt); \
  } while (0)
#define MSG_NS_WARNING(_txt)       \
  do {                             \
    NS_WARNING(_txt);              \
    MSG_LOG_WARN_TO_CONSOLE(_txt); \
  } while (0)
#define MSG_NS_WARN_IF_FALSE(_val, _txt) \
  do {                                   \
    if (!(_val)) {                       \
      NS_WARNING(_txt);                  \
      MSG_LOG_WARN_TO_CONSOLE(_txt);     \
    }                                    \
  } while (0)
#define MSG_NS_INFO(_txt)                                             \
  do {                                                                \
    MSG_LOCAL_INFO_TO_CONSOLE(_txt);                                  \
    fprintf(stderr, "(info) %s (%s:%d)\n", _txt, __FILE__, __LINE__); \
  } while (0)

/**
 * Perform C-style string escaping. E.g. "foo\r\n" => "foo\\r\\n"
 * This is primarily intended to ease debugging large strings.
 * CEscapeString("foo\r\n") => "foo\\r\\n"
 * CEscapeString("foo\r\n", 5) => "fo..."
 */
nsCString CEscapeString(nsACString const& s, size_t maxLen = SIZE_MAX);

/**
 * Synchronously copy the contents of src to dest, until EOF is encountered
 * or an error occurs.
 * The total number of bytes copied is returned in bytesCopied.
 */
nsresult SyncCopyStream(nsIInputStream* src, nsIOutputStream* dest,
                        uint64_t& bytesCopied,
                        size_t bufSize = FILE_IO_BUFFER_SIZE);

/**
 * Synchronously write data to the destination stream, returning only when
 * all the data is written or if an error occurs.
 * This is a helper function to handle the fact that nsIOutputStream.write()
 * isn't guaranteed to write out all the data passed in, and that multiple
 * calls might be required.
 */
nsresult SyncWriteAll(nsIOutputStream* dest, const char* data, uint32_t count);

// Used for "@mozilla.org/network/sync-stream-listener;1".
already_AddRefed<nsIStreamListener> SyncStreamListenerCreate();

nsresult IsOnSameServer(nsIMsgFolder* folder1, nsIMsgFolder* folder2,
                        bool* sameServer);

/**
 * Creates a temporary directory to use for folder compaction.
 * The directory will be created as a sibling of srcFile, with the intention
 * that they are both on the same filesystem, which is required for atomic file
 * renames (or at least as atomic as we can be guaranteed).
 * If the directory already exists, it'll be returned.
 */
nsresult GetOrCreateCompactionDir(nsIFile* srcFile, nsIFile** tempDir);

#endif
