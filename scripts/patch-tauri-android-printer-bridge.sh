#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_APP_DIR="$ROOT_DIR/src-tauri/gen/android/app"
MANIFEST="$ANDROID_APP_DIR/src/main/AndroidManifest.xml"

if [[ ! -d "$ANDROID_APP_DIR" ]]; then
  echo "Skipping Android printer permission patch: generated Android app not found."
  exit 0
fi

if [[ -f "$MANIFEST" ]]; then
  python3 - "$MANIFEST" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

permissions = [
    '    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />',
    '    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />',
    '    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30" />',
    '    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />',
    '    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />',
]

if '<manifest' in text:
    for permission in permissions:
        name_start = permission.find('android:name="') + len('android:name="')
        name_end = permission.find('"', name_start)
        permission_name = permission[name_start:name_end]
        if permission_name not in text:
            text = text.replace(
                '    <uses-permission android:name="android.permission.INTERNET" />',
                '    <uses-permission android:name="android.permission.INTERNET" />\n' + permission,
                1,
            )

    if 'android.hardware.bluetooth' not in text:
        text = text.replace(
            '    <uses-feature android:name="android.software.leanback" android:required="false" />',
            '    <uses-feature android:name="android.software.leanback" android:required="false" />\n'
            '    <uses-feature android:name="android.hardware.bluetooth" android:required="false" />',
            1,
        )

path.write_text(text)
PY
fi

echo "Patched Tauri Android Bluetooth printer permissions."
