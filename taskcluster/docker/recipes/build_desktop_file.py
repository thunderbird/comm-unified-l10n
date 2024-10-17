#!/usr/bin/python3 -u
#  This Source Code Form is subject to the terms of the Mozilla Public
#  License, v. 2.0. If a copy of the MPL was not distributed with this
#  file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""
Build the Flatpak .desktop file. Needs to run in the Python virtualenv
due to dependencies.

python3 /scripts/build_desktop_file.py -o "$WORKSPACE/org.mozilla.Thunderbird.desktop" \
  -t "/scripts/org.mozilla.Thunderbird.desktop.jinja2" \
  -l "$WORKSPACE/l10n-central" \
  -L "$WORKSPACE/shipped-locales" \
  -f "mail/branding/thunderbird/brand.ftl" \
  -f "mail/messenger/flatpak.ftl"
"""

import argparse
import json
from pathlib import Path
from typing import List, Union

import jinja2
from fluent.runtime.fallback import FluentLocalization, FluentResourceLoader

COMM_L10N_ZIP = "https://hg.mozilla.org/projects/comm-l10n/archive/{rev}.zip"
COMM_L10N_ZIP_PREFIX = "comm-l10n-{rev}"


class FluentTranslator:
    """
    FluentTranslator is an enhanced FluentLocalization
    """

    def __init__(self, l10n_base: Path, locales: List[str], resource_ids: List[str]):
        self._locales = locales
        self._localizations = self._populate(l10n_base, resource_ids)

    @property
    def locales(self):
        return sorted([l for l in self._locales if l != "en-US"])

    def _populate(self, l10n_path, resource_ids):
        loader = FluentResourceLoader(str(l10n_path / "{locale}"))

        rv = {}
        for locale in self._locales:
            rv[locale] = FluentLocalization([locale], resource_ids, loader)

        return rv

    def get_message(self, locale, message_id) -> Union[str, None]:
        rv = self._localizations[locale].format_value(message_id)
        if rv == message_id:
            return None
        return rv


def get_multi_translate(l10n_strings: FluentTranslator):
    def translate_multi(key: str, fluent_id: str):
        for locale in l10n_strings.locales:
            translated = l10n_strings.get_message(locale, fluent_id)
            if translated is not None:
                yield f"{key}[{locale}]={translated}"

    return translate_multi


def build_template(
    output: Path,
    template: Path,
    l10n_base: Path,
    locales: List[str],
    fluent_resources: List[str],
    is_beta: bool,
    is_esr: bool,
):
    wmclass = "thunderbird"
    if is_beta:
        wmclass = wmclass + "-beta"
    elif is_esr:
        wmclass = wmclass + "-esr"
    locales_plus = locales + ["en-US"]
    l10n_strings = FluentTranslator(l10n_base.resolve(), locales_plus, fluent_resources)

    with open(template) as fp:
        jinja_template = jinja2.Template(fp.read())

    translate_multi = get_multi_translate(l10n_strings)
    result = jinja_template.render(
        strings=l10n_strings, translate=translate_multi, wmclass=wmclass
    )

    with open(output, "w") as fp:
        fp.write(result)


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument("-o", dest="output", type=Path, required=True, help="Output file")
    parser.add_argument(
        "-t", dest="template", type=Path, required=True, help="Jinja2 template file"
    )
    parser.add_argument(
        "-l", dest="l10n_base", type=Path, required=True, help="l10n-central root path"
    )
    parser.add_argument(
        "-L",
        dest="locales",
        type=str,
        required=True,
        help="JSON encoded list of supported locales",
    )
    parser.add_argument(
        "-f", dest="fluent_files", type=str, required=True, action="extend", nargs="+"
    )
    parser.add_argument(
        "--beta",
        dest="is_beta",
        action="store_true",
        default=False,
        help="Mark this build a beta version",
    )
    parser.add_argument(
        "--esr",
        dest="is_esr",
        action="store_true",
        default=False,
        help="Mark this build an ESR version",
    )

    args = parser.parse_args()

    locales = json.loads(args.locales)

    build_template(
        args.output,
        args.template,
        args.l10n_base,
        locales,
        args.fluent_files,
        args.is_beta,
        args.is_esr,
    )


if __name__ == "__main__":
    main()
