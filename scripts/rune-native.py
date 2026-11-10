#!/usr/bin/env python3
"""Build/check an isolated, unsigned Rune development bundle. Never launch/register it."""

import argparse
import copy
import filecmp
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / "build/rune-native/Antimatter.app"
BINARY = ROOT / "target/debug/antimatter"
BUNDLE_IDENTIFIER = "antimatter.ericschmar.dev"
CALLBACK_SCHEME = "mattermost-dev"
INFO = {
    "CFBundleIdentifier": BUNDLE_IDENTIFIER,
    "CFBundleName": "Antimatter",
    "CFBundleDisplayName": "Antimatter",
    "CFBundleExecutable": "antimatter",
    "CFBundlePackageType": "APPL",
    "CFBundleShortVersionString": "0.0.1",
    "CFBundleVersion": "1",
    "NSHighResolutionCapable": True,
    "CFBundleURLTypes": [{
        "CFBundleURLName": BUNDLE_IDENTIFIER,
        "CFBundleTypeRole": "Editor",
        "CFBundleURLSchemes": [CALLBACK_SCHEME],
    }],
}


def valid_metadata(info):
    if not isinstance(info, dict):
        return False
    types = info.get("CFBundleURLTypes")
    return (
        info.get("CFBundleIdentifier") == BUNDLE_IDENTIFIER
        and info.get("CFBundleExecutable") == "antimatter"
        and info.get("CFBundlePackageType") == "APPL"
        and isinstance(types, list)
        and any(
            isinstance(entry, dict)
            and isinstance(entry.get("CFBundleURLSchemes"), list)
            and CALLBACK_SCHEME in entry["CFBundleURLSchemes"]
            for entry in types
        )
    )


def check():
    with (BUNDLE / "Contents/Info.plist").open("rb") as stream:
        if not valid_metadata(plistlib.load(stream)):
            raise ValueError("invalid metadata")
    executable = BUNDLE / "Contents/MacOS/antimatter"
    with executable.open("rb") as stream:
        # Native Mach-O or universal Mach-O, not a script or placeholder.
        if stream.read(4) not in (
            b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf",
            b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca",
            b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca",
        ):
            raise ValueError("invalid executable")
    if not os.access(executable, os.X_OK) or not filecmp.cmp(BINARY, executable, shallow=False):
        raise ValueError("missing or stale executable")


def self_test():
    assert valid_metadata(plistlib.loads(plistlib.dumps(INFO)))
    assert not valid_metadata([])
    for key, value in (
        ("CFBundleIdentifier", "wrong.synthetic.bundle"),
        ("CFBundleExecutable", "wrong"),
        ("CFBundlePackageType", "BNDL"),
        ("CFBundleURLTypes", [{"CFBundleURLSchemes": "mattermost-dev"}]),
        ("CFBundleURLTypes", [{"CFBundleURLSchemes": ["wrong-synthetic"]}]),
        ("CFBundleURLTypes", [None]),
    ):
        invalid = copy.deepcopy(INFO)
        invalid[key] = value
        assert not valid_metadata(invalid)
    print("Synthetic native bundle metadata checks passed.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="check existing bundle only; no build or launch")
    mode.add_argument("--self-test", action="store_true", help="synthetic metadata checks only")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if sys.platform != "darwin":
        parser.error("native bundles require macOS")
    try:
        if not args.check:
            subprocess.run(["cargo", "build", "--locked", "--offline"], cwd=ROOT, check=True)
            contents = BUNDLE / "Contents"
            (contents / "MacOS").mkdir(parents=True, exist_ok=True)
            shutil.copy2(BINARY, contents / "MacOS/antimatter")
            with (contents / "Info.plist").open("wb") as stream:
                plistlib.dump(INFO, stream)
        check()
    except (OSError, ValueError, plistlib.InvalidFileException, subprocess.CalledProcessError):
        # Do not dump plist values, executable data, or callback URLs on failure.
        parser.exit(1, "Native bundle build/check failed; rebuild with this helper.\n")
    print("Native bundle metadata and binary checked: build/rune-native/Antimatter.app")
    print("Not launched, registered, or signed. Callback delivery still requires authorized native verification.")


if __name__ == "__main__":
    main()
