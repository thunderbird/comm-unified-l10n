/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef DatabaseUtils_h__
#define DatabaseUtils_h__

#include "mozilla/Preferences.h"
#include "mozIStorageFunction.h"
#include "nsCOMPtr.h"
#include "nsIAbManager.h"
#include "nsIObserver.h"
#include "nsTString.h"

using mozilla::Preferences;

namespace mozilla::mailnews {

class DatabaseUtils {
 public:
  /**
   * Normalizes a string to Unicode canonical composition form. Strings should
   * be normalized before being inserted into the database. This will prevent
   * mistakes when comparing strings containing non-ASCII characters.
   */
  static nsCString Normalize(const nsACString& inString);
};

class TagsMatchFunction final : public mozIStorageFunction {
 public:
  explicit TagsMatchFunction(bool aWanted) : mWanted(aWanted) {};

  NS_DECL_ISUPPORTS
  NS_DECL_MOZISTORAGEFUNCTION

 private:
  ~TagsMatchFunction() = default;
  bool mWanted;
};

class AddressFormatFunction final : public mozIStorageFunction,
                                    public nsIObserver {
 public:
  AddressFormatFunction() {
    // All of this will be unnecessary once we have static preferences.
    mShowCondensedAddresses =
        Preferences::GetBool("mail.showCondensedAddresses", true);
    mAddressDisplayFormat = Preferences::GetInt("mail.addressDisplayFormat", 0);

    Preferences::AddStrongObserver(this, "mail.showCondensedAddresses");
    Preferences::AddStrongObserver(this, "mail.addressDisplayFormat");
  }

  NS_DECL_ISUPPORTS
  NS_DECL_MOZISTORAGEFUNCTION
  NS_DECL_NSIOBSERVER

 private:
  ~AddressFormatFunction() = default;

  nsCOMPtr<nsIAbManager> mAbManager;

  bool mShowCondensedAddresses;
  int32_t mAddressDisplayFormat;

  nsCString ExpandAddress(const nsCString& aName,
                          const nsACString& aEmailAddress);
  nsCString NoSpoofingSender(const nsCString& aName,
                             const nsACString& aEmailAddress);
  nsresult GetDisplayNameInAddressBook(const nsACString& aEmailAddress,
                                       nsACString& aDisplayName);
};

}  // namespace mozilla::mailnews

#endif  // DatabaseUtils_h__
