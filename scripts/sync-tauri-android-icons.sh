#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ICON_SOURCE="$ROOT_DIR/src-tauri/icons/icon.png"
TAURI_CLI="$ROOT_DIR/node_modules/.bin/tauri"
SOURCE_ANDROID_ICONS_DIR="$ROOT_DIR/src-tauri/icons/android"
GENERATED_ANDROID_RES_DIR="$ROOT_DIR/src-tauri/gen/android/app/src/main/res"

copy_generated_android_icons() {
  local generated_android_dir="$1"
  local destination_dir="$2"

  mkdir -p "$destination_dir"

  for dir_name in \
    mipmap-anydpi-v26 \
    mipmap-hdpi \
    mipmap-mdpi \
    mipmap-xhdpi \
    mipmap-xxhdpi \
    mipmap-xxxhdpi \
    values; do
    if [[ -d "$generated_android_dir/$dir_name" ]]; then
      mkdir -p "$destination_dir/$dir_name"
      cp -fR "$generated_android_dir/$dir_name/." "$destination_dir/$dir_name/"
    fi
  done
}

ensure_android_adaptive_icon_wrapper() {
  local destination_dir="$1"
  local drawable_dir="$destination_dir/drawable"
  local adaptive_icon_xml="$destination_dir/mipmap-anydpi-v26/ic_launcher.xml"
  local inset_wrapper_xml="$drawable_dir/ic_launcher_foreground_inset.xml"
  local monochrome_xml="$drawable_dir/ic_launcher_monochrome.xml"

  mkdir -p "$drawable_dir"

  cat >"$inset_wrapper_xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<inset xmlns:android="http://schemas.android.com/apk/res/android"
    android:insetLeft="16dp"
    android:insetTop="16dp"
    android:insetRight="16dp"
    android:insetBottom="16dp">
    <bitmap
        android:gravity="center"
        android:src="@mipmap/ic_launcher_foreground" />
</inset>
EOF

  cat >"$monochrome_xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#FFFFFFFF"
        android:fillType="evenOdd"
        android:pathData="M18,16h72v76h-72z M22,20h64v68h-64z" />
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="M27,28h54v36h-54z" />
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="M27,72h54v12h-54z" />
</vector>
EOF

  cat >"$adaptive_icon_xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <foreground android:drawable="@drawable/ic_launcher_foreground_inset"/>
  <background android:drawable="@color/ic_launcher_background"/>
  <monochrome android:drawable="@drawable/ic_launcher_monochrome"/>
</adaptive-icon>
EOF
}

if [[ ! -f "$ICON_SOURCE" ]]; then
  echo "Skipping Android icon sync: missing source icon at $ICON_SOURCE"
  exit 0
fi

if [[ ! -x "$TAURI_CLI" ]]; then
  echo "Skipping Android icon sync: missing local Tauri CLI at $TAURI_CLI"
  exit 0
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

"$TAURI_CLI" icon "$ICON_SOURCE" --output "$TMP_DIR" >/dev/null

if [[ ! -d "$TMP_DIR/android" ]]; then
  echo "Failed to generate Android icons from $ICON_SOURCE" >&2
  exit 1
fi

copy_generated_android_icons "$TMP_DIR/android" "$SOURCE_ANDROID_ICONS_DIR"
ensure_android_adaptive_icon_wrapper "$SOURCE_ANDROID_ICONS_DIR"

if [[ -d "$GENERATED_ANDROID_RES_DIR" ]]; then
  copy_generated_android_icons "$TMP_DIR/android" "$GENERATED_ANDROID_RES_DIR"
  ensure_android_adaptive_icon_wrapper "$GENERATED_ANDROID_RES_DIR"
fi

echo "Synced Android launcher icons from $ICON_SOURCE"
