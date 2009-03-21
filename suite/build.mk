# ***** BEGIN LICENSE BLOCK *****
# Version: MPL 1.1/GPL 2.0/LGPL 2.1
#
# The contents of this file are subject to the Mozilla Public License Version
# 1.1 (the "License"); you may not use this file except in compliance with
# the License. You may obtain a copy of the License at
# http://www.mozilla.org/MPL/
#
# Software distributed under the License is distributed on an "AS IS" basis,
# WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
# for the specific language governing rights and limitations under the
# License.
#
# The Original Code is the Mozilla build system.
#
# The Initial Developer of the Original Code is
# the Mozilla Foundation <http://www.mozilla.org/>.
# Portions created by the Initial Developer are Copyright (C) 2006
# the Initial Developer. All Rights Reserved.
#
# Contributor(s):
#   Benjamin Smedberg <benjamin@smedbergs.us> (Initial Code)
#
# Alternatively, the contents of this file may be used under the terms of
# either the GNU General Public License Version 2 or later (the "GPL"), or
# the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
# in which case the provisions of the GPL or the LGPL are applicable instead
# of those above. If you wish to allow use of your version of this file only
# under the terms of either the GPL or the LGPL, and not to allow others to
# use your version of this file under the terms of the MPL, indicate your
# decision by deleting the provisions above and replace them with the notice
# and other provisions required by the GPL or the LGPL. If you do not delete
# the provisions above, a recipient may use your version of this file under
# the terms of any one of the MPL, the GPL or the LGPL.
#
# ***** END LICENSE BLOCK *****

ifndef COMM_BUILD # Mozilla Makefile

ifndef LIBXUL_SDK
include $(topsrcdir)/toolkit/toolkit-tiers.mk
endif

TIERS += app

ifdef MOZ_EXTENSIONS
tier_app_dirs += extensions
endif

else # toplevel Makefile

TIERS += app

ifdef MOZ_LDAP_XPCOM
tier_app_staticdirs += directory/c-sdk
tier_app_dirs += directory/xpcom
endif

ifdef MOZ_COMPOSER
tier_app_dirs += editor/ui
endif

ifdef MOZ_BRANDING_DIRECTORY
tier_app_dirs += $(MOZ_BRANDING_DIRECTORY)
endif

ifdef MOZ_MAIL_NEWS
tier_app_dirs += mailnews/base mailnews
endif

ifdef MOZ_CALENDAR
tier_app_dirs += calendar/lightning
endif

tier_app_dirs += \
	suite \
	$(NULL)

endif # COMM_BUILD

installer:
	@$(MAKE) -C suite/installer installer

package:
	@$(MAKE) -C suite/installer

package-compare:
	@$(MAKE) -C suite/installer package-compare

install::
	@$(MAKE) -C suite/installer install

source-package::
	@$(MAKE) -C suite/installer source-package

ifndef COMM_BUILD
# mochitests need to be run from the Mozilla build system
ifdef ENABLE_TESTS
# Implemented in testing/testsuite-targets.mk

ifdef TEST_PATH
BROWSER_TEST_PATH = --test-path=$(TEST_PATH)
else
BROWSER_TEST_PATH =
endif

mochitest-browser-chrome:
	$(RUN_MOCHITEST) --browser-chrome $(BROWSER_TEST_PATH)
	$(CHECK_TEST_ERROR)

mochitest:: mochitest-browser-chrome

.PHONY: mochitest-browser-chrome
endif
endif
