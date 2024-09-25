# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import hashlib
import json
import logging
import os.path
import shutil
import subprocess
import sys

import tomlkit
from tomlkit.toml_file import TOMLFile

from mozbuild.vendor.vendor_rust import (
    PACKAGES_WE_ALWAYS_WANT_AN_OVERRIDE_OF as _upstream_overrides,
)
from mozbuild.vendor.vendor_rust import (
    PACKAGES_WE_DONT_WANT as _upstream_unwanted,
)
from mozbuild.vendor.vendor_rust import (
    VendorRust,
)
from mozpack import path as mozpath

PACKAGES_WE_DONT_WANT = {**_upstream_unwanted, **{}}
PACKAGES_WE_ALWAYS_WANT_AN_OVERRIDE_OF = _upstream_overrides + []


config_footer = """
# Take advantage of the fact that cargo will treat lines starting with #
# as comments to add preprocessing directives. This file can thus by copied
# as-is to $topsrcdir/.cargo/config.toml with no preprocessing to be used there
# (for e.g. independent tasks building rust code), or be preprocessed by
# the build system to produce a .cargo/config.toml with the right content.
#define REPLACE_NAME vendored-sources
#define VENDORED_DIRECTORY comm/third_party/rust
# We explicitly exclude the following section when preprocessing because
# it would overlap with the preprocessed [source."@REPLACE_NAME@"], and
# cargo would fail.
#ifndef REPLACE_NAME
[source.vendored-sources]
directory = "../third_party/rust"
#endif

# Thankfully, @REPLACE_NAME@ is unlikely to be a legitimate source, so
# cargo will ignore it when it's here verbatim.
#filter substitution
[source."@REPLACE_NAME@"]
directory = "@top_srcdir@/@VENDORED_DIRECTORY@"
"""

gkrust_template = """
[package]
name = "gkrust"
version = "0.1.0"

[lib]
path = "src/lib.rs"
crate-type = ["staticlib"]
test = false
doctest = false
bench = false
doc = false
plugin = false
harness = false

{dependencies}

[package.metadata.cargo-udeps.ignore]
normal = ["mozilla-central-workspace-hack"]
"""

workspace_template = """
[package]
name = "mozilla-central-workspace-hack"
version = "0.1.0"
license = "MPL-2.0"
description = "Thunderbird extensions to mozilla-central-workspace-hack"

[features]
{features}

[workspace]
members = {members}

[workspace.dependencies]
{dependencies}

{target_dependencies}

{patches}
"""

CARGO_FILES = {
    "mc_workspace_toml": "Cargo.toml",
    "mc_gkrust_toml": "toolkit/library/rust/shared/Cargo.toml",
    "mc_hack_toml": "build/workspace-hack/Cargo.toml",
    "mc_cargo_lock": "Cargo.lock",
}

# Features on dependencies local to mozilla-central that aren't present in m-c's
# `gkrust/Cargo.toml`, but that we need to preserve to enable
# Thunderbird-specific behaviour.
FEATURES_TO_PRESERVE = [
    "mailnews",
]


def get_cargo(command_context):
    """
    Ensures all the necessary cargo bits are installed.

    Returns the path to cargo if successful, None otherwise.
    :rtype: str: path to cargo
    """
    vendor_rust = VendorRust(
        command_context.topsrcdir, command_context.settings, command_context.log_manager
    )
    cargo = vendor_rust.get_cargo_path()
    if not vendor_rust.check_cargo_version(cargo):
        raise Exception("Cargo not found or version mismatch.")
    return cargo


class CargoFile:
    """
    Simple abstraction of a Cargo.toml file
    """

    # Direct dependencies
    dependencies = None

    name = None

    # Identity -> Patch
    patches = None

    # Full filename of this cargo file
    filename = None
    features = None

    workspace_members = None
    workspace_deps = None
    our_directory = None

    def __init__(self, filename):
        self.our_directory = mozpath.dirname(filename)
        self.dependencies = dict()
        self.patches = dict()
        self.filename = filename
        self.workspace_members = list()
        self.workspace_deps = dict()
        self.features = dict()
        self.target_deps = dict()

        data = TOMLFile(filename).read()

        for section in data:
            if section == "package":
                if "name" in data[section]:
                    self.name = data[section]["name"]
            if section == "patch":
                for block in data[section]:
                    self._handle_patches(block, data[section][block])
            elif section == "dependencies":
                self.dependencies.update(self._handle_dependencies(data[section]))
                pass
            elif section == "workspace":
                self._handle_workspace(data[section])
            elif section == "features":
                self.features = data["features"]
            elif section == "target":
                self.target_deps.update(self._handle_target_dependencies(data[section]))

    def _handle_target_dependencies(self, data):
        """Store configuration-specific (e.g. platform-specific dependencies)"""
        target_deps = dict()
        for target in data:
            deps = data[target].get("dependencies")

            if deps:
                target_deps[target] = deps

        return target_deps

    def _handle_dependencies(self, data):
        """Store each dependency"""
        deps = dict()

        for _id in data:
            dep = data[_id]
            # Direct version field
            if isinstance(dep, str):
                dep = {"version": dep}
            if "path" in dep:
                path = mozpath.abspath(mozpath.join(self.our_directory, dep["path"]))
                dep["path"] = path
            deps[_id] = dep

        return deps

    def _handle_patches(self, identity, data):
        """identity = crates-io, etc."""
        patches = dict()

        for id in data:
            patch = data[id]
            if "path" in patch:
                path = mozpath.abspath(mozpath.join(self.our_directory, patch["path"]))
                patch["path"] = path
            patches[id] = patch

        if identity in self.patches:
            self.patches[identity].update(patches)
        else:
            self.patches[identity] = patches

    def _handle_workspace(self, data):
        if "dependencies" in data:
            self.workspace_deps.update(self._handle_dependencies(data["dependencies"]))

        if "members" in data:
            self.workspace_members = data["members"]


def check_vendored_dependencies(topsrcdir):
    """
    Checks current checksums of Cargo.toml files against
    the saved values. Returns a list of mismatched paths.

    :rtype: List[str]: List of paths to Cargo.toml files
    """
    checksums_file = mozpath.join(topsrcdir, "comm", "rust", "checksums.json")
    try:
        checksum_data = json.load(open(checksums_file))
    except FileNotFoundError:
        print(f"Checksum file {checksums_file} not found.\n")
        return list(CARGO_FILES.values())

    current_checksums = get_current_checksums(topsrcdir)

    return [
        CARGO_FILES[k]
        for k in current_checksums
        if current_checksums[k] != checksum_data.get(k, None)
    ]


def get_current_checksums(topsrcdir):
    current_checksums = {}
    for key, path in CARGO_FILES.items():
        filename = mozpath.join(topsrcdir, path)
        if os.path.isfile(filename):
            with open(filename) as f:
                content = f.read().encode("utf-8")
                current_checksums[key] = hashlib.sha512(content).hexdigest()
    return current_checksums


def save_vendored_checksums(topsrcdir):
    current_checksums = get_current_checksums(topsrcdir)
    checksums_file = mozpath.join(topsrcdir, "comm", "rust", "checksums.json")
    with open(checksums_file, "w", newline="\n") as fp:
        json.dump(current_checksums, fp)


def run_tb_cargo_sync(command_context):
    cargo = get_cargo(command_context)

    mc_lock = mozpath.join(command_context.topsrcdir, "Cargo.lock")
    workspace = mozpath.join(command_context.topsrcdir, "comm", "rust")
    our_lock = mozpath.join(workspace, "Cargo.lock")

    regen_toml_files(command_context, workspace)
    command_context.log(logging.INFO, "tb-rust", {}, f"[INFO] Syncing {mc_lock} with {our_lock}")
    shutil.copyfile(mc_lock, our_lock)
    command_context.log(logging.INFO, "tb-rust", {}, "[INFO] Updating gkrust in our workspace")
    run_cargo_update(cargo, workspace)


def run_tb_rust_vendor(command_context):
    cargo = get_cargo(command_context)

    run_tb_cargo_sync(command_context)
    workspace = mozpath.join(command_context.topsrcdir, "comm", "rust")
    config = mozpath.join(workspace, ".cargo", "config.toml.in")
    third_party = mozpath.join(command_context.topsrcdir, "comm", "third_party", "rust")

    if os.path.exists(third_party):
        command_context.log(logging.INFO, "tb-rust", {}, "[INFO] Removing comm/third_party/rust")
        shutil.rmtree(third_party)
    else:
        command_context.log(
            logging.WARNING,
            "tb-rust",
            {},
            "[WARNING] Cannot find comm/third_party/rust",
        )

    cmd = [
        cargo,
        "vendor",
        "-s",
        "comm/rust/Cargo.toml",
        "comm/third_party/rust",
    ]

    command_context.log(logging.INFO, "tb-rust", {}, "[INFO] Running cargo vendor")
    proc = subprocess.run(
        cmd, cwd=command_context.topsrcdir, check=True, stdout=subprocess.PIPE, encoding="utf-8"
    )
    with open(config, "w", newline="\n") as config_file:
        config_file.writelines([f"{x}\n" for x in proc.stdout.splitlines()[0:-2]])
        config_file.write(config_footer)

    check_unwanted_crates(command_context, workspace)


def check_unwanted_crates(command_context, workspace):
    """
    Check Cargo.lock for undesirable vendored crates.
    """
    command_context.log(logging.INFO, "tb-rust", {}, "[INFO] Checking unwanted crates")
    with open(os.path.join(workspace, "Cargo.lock")) as fh:
        cargo_lock = tomlkit.load(fh)
        failed = False
        for package in cargo_lock["package"]:
            if package["name"] in PACKAGES_WE_ALWAYS_WANT_AN_OVERRIDE_OF:
                # When the in-tree version is used, there is `source` for
                # it in Cargo.lock, which is what we expect.
                if package.get("source"):
                    command_context.log(
                        logging.ERROR,
                        "non_overridden",
                        {
                            "crate": package["name"],
                            "version": package["version"],
                            "source": package["source"],
                        },
                        "Crate {crate} v{version} must be overridden but isn't "
                        "and comes from {source}.",
                    )
                    failed = True
            elif package["name"] in PACKAGES_WE_DONT_WANT:
                command_context.log(
                    logging.ERROR,
                    "undesirable",
                    {
                        "crate": package["name"],
                        "version": package["version"],
                        "reason": PACKAGES_WE_DONT_WANT[package["name"]],
                    },
                    "Crate {crate} is not desirable: {reason}",
                )
                failed = True

        if failed:
            print("Errors occurred; new rust crates were not vendored.")
            sys.exit(1)


def regen_toml_files(command_context, workspace):
    """
    Regenerate the TOML files within the gkrust workspace
    """
    mc_workspace_toml = mozpath.join(command_context.topsrcdir, CARGO_FILES["mc_workspace_toml"])
    mc_gkrust_toml = mozpath.join(command_context.topsrcdir, CARGO_FILES["mc_gkrust_toml"])
    mc_hack_toml = mozpath.join(command_context.topsrcdir, CARGO_FILES["mc_hack_toml"])

    mc_workspace = CargoFile(mc_workspace_toml)
    mc_gkrust = CargoFile(mc_gkrust_toml)
    mc_hack = CargoFile(mc_hack_toml)

    comm_gkrust_toml = mozpath.join(workspace, "gkrust", "Cargo.toml")
    comm_gkrust_dir = mozpath.dirname(comm_gkrust_toml)
    comm_workspace_toml = mozpath.join(workspace, "Cargo.toml")

    # Grab existing features/members
    comm_workspace = CargoFile(comm_workspace_toml)
    features = comm_workspace.features
    members = comm_workspace.workspace_members

    # Preserve original deps to gkrust (path = relative). Also see whether these
    # deps include features that we need to preserve despite not being present
    # in m-c.
    comm_gkrust = CargoFile(comm_gkrust_toml)
    local_deps = dict()
    preserved_features = dict()
    for dep_id in comm_gkrust.dependencies:
        dep = comm_gkrust.dependencies[dep_id]
        if "path" not in dep:
            continue

        if "features" in dep:
            to_preserve = []

            for feature in dep["features"]:
                if feature in FEATURES_TO_PRESERVE:
                    to_preserve.append(feature)

            if len(to_preserve) != 0:
                preserved_features[dep_id] = to_preserve

        path = mozpath.abspath(mozpath.join(workspace, dep["path"]))
        if mozpath.dirname(path) == workspace:
            local_deps[dep_id] = dep

    # Deps copied from gkrust-shared
    global_deps = mc_gkrust.dependencies
    keys = [
        x
        for x in global_deps.keys()
        if x != "mozilla-central-workspace-hack" and x != "gkrust-shared"
    ]
    keys.sort()
    global_deps.update(local_deps)

    patches = mc_workspace.patches
    del patches["crates-io"]["mozilla-central-workspace-hack"]

    global_deps["mozilla-central-workspace-hack"] = {
        "version": "0.1",
        "features": ["gkrust"],
        "optional": True,
    }
    global_deps["gkrust-shared"] = {
        "version": "0.1.0",
        "path": mozpath.join(command_context.topsrcdir, "toolkit", "library", "rust", "shared"),
    }

    # Sort the local dependencies. We do this in the reverse alphabetical order,
    # because we insert them in the global list in the reverse order (so they
    # end up on top in the final file).
    for i in sorted(local_deps.keys(), reverse=True):
        keys.insert(0, i)

    keys.insert(0, "gkrust-shared")
    keys.insert(0, "mozilla-central-workspace-hack")

    dependencies = "[dependencies]\n"
    for key in keys:
        data = global_deps[key]
        # Rewrite paths relative to us.
        if "path" in data:
            data["path"] = mozpath.relpath(data["path"], comm_gkrust_dir)
        if "default_features" in data:
            del data["default_features"]
        elif "default-features" in data:
            del data["default-features"]

        # Add any feature we need to preserve.
        if key in preserved_features:
            dep_features = data.get("features", tomlkit.array())
            for feature in preserved_features[key]:
                dep_features.insert(0, feature)

            data["features"] = dep_features

        dependencies += inline_encoded_toml(key, data) + "\n"

    with open(comm_gkrust_toml, "w", newline="\n") as cargo:
        cargo.write(gkrust_template.format(dependencies=dependencies.strip()))

    workspace_members = members
    workspace_patches = ""
    workspace_dependencies = []

    for dep in mc_workspace.workspace_deps:
        workspace_dependencies.append(inline_encoded_toml(dep, mc_workspace.workspace_deps[dep]))

    # Target-specific dependencies for the workspace
    target_deps = ""
    for target, deps in mc_hack.target_deps.items():
        target_name = target.replace('"', '\\"')

        for dep_name, dep in deps.items():
            target_deps += f'[target."{target_name}".dependencies.{dep_name}]\n'

            for key, value in dep.items():
                target_deps += inline_encoded_toml(key, value) + "\n"

            target_deps += "\n"

    # Patch emission
    for section in patches:
        data = patches[section]
        if ":/" in section:
            section = f'"{section}"'
        workspace_patches += f"[patch.{section}]\n"
        if section == "crates-io":
            workspace_patches += (
                inline_encoded_toml("mozilla-central-workspace-hack", {"path": "."}) + "\n"
            )
        for _id in data:
            patch = data[_id]
            if "path" in patch:
                patch["path"] = mozpath.relpath(patch["path"], workspace)
            workspace_patches += inline_encoded_toml(_id, patch) + "\n"
        workspace_patches += "\n"

    with open(comm_workspace_toml, "w", newline="\n") as cargo:
        cargo_toml = (
            workspace_template.format(
                dependencies="\n".join(workspace_dependencies),
                target_dependencies=target_deps.strip(),
                members=workspace_members,
                features=tomlkit.dumps(features),
                patches=workspace_patches,
            ).strip()
            + "\n"
        )
        cargo.write(cargo_toml)

    save_vendored_checksums(command_context.topsrcdir)


def run_cargo_update(cargo, workspace):
    """
    Run cargo to regenerate the lockfile
    """
    subprocess.run(
        [
            cargo,
            "update",
            "-p",
            "gkrust",
        ],
        cwd=workspace,
        check=True,
    )


def inline_encoded_toml(id, data):
    """
    Write nice looking TOML keys automatically for easier to review changes
    """
    if isinstance(data, str):
        return f'{id} = "{data}"'
    if isinstance(data, bool):
        return f"{id} = {str(data).lower()}"

    # Keep track of whether the data structure we're dealing with is a list or a
    # dict, because lists need some extra formatting tweaks compared to dicts.
    is_list = isinstance(data, list)

    if is_list:
        ret = f"{id} = [\n"
    else:
        ret = f"{id} = {{"

    for idx, key in enumerate(data):
        if is_list:
            value = data[idx]
        else:
            value = data[key]

        if isinstance(value, bool):
            value = (str(value)).lower()
        elif isinstance(value, list):
            value = str(value)
        else:
            value = '"' + value + '"'
        if idx > 0:
            ret += ","
            if is_list:
                ret += "\n"
            ret += " "
        else:
            ret += " "

        if is_list:
            ret += f"{value}"
        else:
            ret += f"{key} = {value}"

    if is_list:
        return ret + "\n]"
    else:
        return ret + " }"


def verify_vendored_dependencies(topsrcdir):
    result = check_vendored_dependencies(topsrcdir)
    if result:
        print("Rust dependencies are out of sync. Run `mach tb-rust vendor`.\n")
        print("\n".join(result))
        sys.exit(88)

    print("Rust dependencies are okay.")


if __name__ == "__main__":
    import buildconfig

    if len(sys.argv) >= 2:
        args = sys.argv[1:]
        if args[0] == "verify_vendored_dependencies":
            verify_vendored_dependencies(buildconfig.topsrcdir)
