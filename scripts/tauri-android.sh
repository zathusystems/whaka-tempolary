#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
PREFERRED_NDK="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-${NDK_HOME:-}}}"
ANDROID_TAURI_CONFIG="$ROOT_DIR/src-tauri/tauri.android.conf.json"
ANDROID_GEN_DIR="$ROOT_DIR/src-tauri/gen/android"
ANDROID_MANIFEST_FILE="$ANDROID_GEN_DIR/app/src/main/AndroidManifest.xml"
ANDROID_ICON_SYNC_SCRIPT="$ROOT_DIR/scripts/sync-tauri-android-icons.sh"
ANDROID_COMMAND_ALREADY_EXECUTED=0

copy_if_exists() {
  local source="$1"
  local destination="$2"
  if [[ -f "$source" ]]; then
    cp -f "$source" "$destination"
  fi
}

backup_android_signing_artifacts() {
  local backup_dir="$1"
  mkdir -p "$backup_dir"

  copy_if_exists "$ANDROID_GEN_DIR/key.properties" "$backup_dir/key.properties"
  copy_if_exists "$ANDROID_GEN_DIR/handypos-release.jks" "$backup_dir/handypos-release.jks"

  # Also back up any additional keystore files users may provide.
  if [[ -d "$ANDROID_GEN_DIR" ]]; then
    while IFS= read -r key_file; do
      cp -f "$key_file" "$backup_dir/$(basename "$key_file")"
    done < <(find "$ANDROID_GEN_DIR" -maxdepth 1 -type f \( -name "*.jks" -o -name "*.keystore" \))
  fi
}

restore_android_signing_artifacts() {
  local backup_dir="$1"
  if [[ ! -d "$backup_dir" ]]; then
    return 0
  fi

  mkdir -p "$ANDROID_GEN_DIR"
  while IFS= read -r artifact; do
    cp -f "$artifact" "$ANDROID_GEN_DIR/$(basename "$artifact")"
  done < <(find "$backup_dir" -maxdepth 1 -type f)
}

sync_android_icons() {
  if [[ -f "$ANDROID_ICON_SYNC_SCRIPT" ]]; then
    bash "$ANDROID_ICON_SYNC_SCRIPT"
  fi
}

recreate_android_project_if_broken() {
  local android_subcommand="$1"

  # This state blocks both `tauri android init` and build commands:
  # gen/android exists, but app sources are missing.
  if [[ -d "$ANDROID_GEN_DIR" && ! -f "$ANDROID_MANIFEST_FILE" ]]; then
    echo "Detected incomplete Android project at $ANDROID_GEN_DIR."
    echo "Backing up signing artifacts and recreating Android project..."

    local backup_dir
    backup_dir="$(mktemp -d)"
    backup_android_signing_artifacts "$backup_dir"
    rm -rf "$ANDROID_GEN_DIR"

    if [[ "$android_subcommand" == "init" ]]; then
      npx tauri android init --ci --skip-targets-install
      ANDROID_COMMAND_ALREADY_EXECUTED=1
    else
      npx tauri android init --ci --skip-targets-install
    fi

    restore_android_signing_artifacts "$backup_dir"
    rm -rf "$backup_dir"
  fi

  # Fresh environment: initialize project for commands that require it.
  if [[ ! -f "$ANDROID_MANIFEST_FILE" && "$android_subcommand" =~ ^(build|dev|run)$ ]]; then
    echo "Android project not initialized. Running tauri android init..."
    npx tauri android init --ci --skip-targets-install
  fi
}

has_tauri_config_arg() {
  local previous=""
  for arg in "$@"; do
    if [[ "$arg" == --config=* ]]; then
      return 0
    fi
    if [[ "$previous" == "--config" ]]; then
      return 0
    fi
    previous="$arg"
  done
  return 1
}

should_sign_release_apks() {
  local has_build=0
  local has_apk=0
  local has_debug=0

  for arg in "$@"; do
    case "$arg" in
      build)
        has_build=1
        ;;
      --apk)
        has_apk=1
        ;;
      --debug|-d)
        has_debug=1
        ;;
    esac
  done

  [[ $has_build -eq 1 && $has_apk -eq 1 && $has_debug -eq 0 ]]
}

find_latest_apksigner() {
  local latest=""
  while IFS= read -r candidate; do
    latest="$candidate"
  done < <(find -L "$ANDROID_HOME/build-tools" -mindepth 2 -maxdepth 2 -type f -name apksigner | sort -V)

  echo "$latest"
}

sign_release_apks() {
  local build_marker_file="$1"
  local signing_file="$ROOT_DIR/src-tauri/gen/android/key.properties"
  if [[ ! -f "$signing_file" ]]; then
    echo "No key.properties found at src-tauri/gen/android/key.properties. Skipping APK signing."
    return 0
  fi

  local store_file=""
  local store_password=""
  local key_alias=""
  local key_password=""

  while IFS='=' read -r key value; do
    case "$key" in
      storeFile) store_file="$value" ;;
      storePassword) store_password="$value" ;;
      keyAlias) key_alias="$value" ;;
      keyPassword) key_password="$value" ;;
    esac
  done < "$signing_file"

  if [[ -z "$store_file" || -z "$store_password" || -z "$key_alias" || -z "$key_password" ]]; then
    echo "Incomplete Android signing configuration in $signing_file"
    return 1
  fi

  local keystore_path="$store_file"
  if [[ "$keystore_path" != /* ]]; then
    keystore_path="$ROOT_DIR/src-tauri/gen/android/$keystore_path"
  fi

  if [[ ! -f "$keystore_path" ]]; then
    echo "Keystore file not found: $keystore_path"
    return 1
  fi

  mapfile -t unsigned_apks < <(find "$ROOT_DIR/src-tauri/gen/android/app/build/outputs/apk" -type f -name "*-unsigned.apk" -newer "$build_marker_file" | sort)

  if [[ ${#unsigned_apks[@]} -eq 0 ]]; then
    echo "No unsigned release APKs generated in this build."
    return 0
  fi

  local apksigner
  apksigner="$(find_latest_apksigner)"
  if [[ -z "$apksigner" || ! -x "$apksigner" ]]; then
    echo "apksigner not found under $ANDROID_HOME/build-tools"
    return 1
  fi

  local ks_pass_file
  local key_pass_file
  ks_pass_file="$(mktemp)"
  key_pass_file="$(mktemp)"
  trap 'rm -f "$ks_pass_file" "$key_pass_file"' RETURN

  printf '%s' "$store_password" > "$ks_pass_file"
  printf '%s' "$key_password" > "$key_pass_file"

  echo "Signing release APKs..."

  for unsigned_apk in "${unsigned_apks[@]}"; do
    local signed_apk="${unsigned_apk%-unsigned.apk}.apk"

    "$apksigner" sign \
      --ks "$keystore_path" \
      --ks-key-alias "$key_alias" \
      --ks-pass "file:$ks_pass_file" \
      --key-pass "file:$key_pass_file" \
      --out "$signed_apk" \
      "$unsigned_apk"

    "$apksigner" verify "$signed_apk" >/dev/null
    echo "Signed: $signed_apk"
  done
}

if [[ ! -d "$SOURCE_ANDROID_HOME" ]]; then
  echo "ANDROID_HOME not found: $SOURCE_ANDROID_HOME"
  echo "Set ANDROID_HOME to your Android SDK path."
  exit 1
fi

if [[ ! -d "$SOURCE_ANDROID_HOME/ndk" ]]; then
  echo "No NDK directory found at: $SOURCE_ANDROID_HOME/ndk"
  echo "Install Android NDK from Android Studio SDK Manager."
  exit 1
fi

if [[ -n "$PREFERRED_NDK" ]]; then
  if [[ -f "$PREFERRED_NDK/source.properties" ]]; then
    VALID_NDKS=("$PREFERRED_NDK")
  else
    echo "Preferred NDK path is invalid or missing source.properties: $PREFERRED_NDK"
    exit 1
  fi
else
  mapfile -t VALID_NDKS < <(
    find "$SOURCE_ANDROID_HOME/ndk" -mindepth 1 -maxdepth 1 -type d \
      -exec test -f "{}/source.properties" ';' -print | sort -V
  )
fi

if [[ ${#VALID_NDKS[@]} -eq 0 ]]; then
  echo "No valid NDK installations found under: $SOURCE_ANDROID_HOME/ndk"
  echo "Expected source.properties inside an NDK version directory."
  exit 1
fi

LAST_INDEX=$((${#VALID_NDKS[@]} - 1))
SELECTED_NDK="${VALID_NDKS[$LAST_INDEX]}"
MIRROR_ANDROID_HOME="/tmp/handypos-android-sdk"

rm -rf "$MIRROR_ANDROID_HOME"
mkdir -p "$MIRROR_ANDROID_HOME"

# Mirror only required SDK folders and a single valid NDK to avoid broken partial installs.
for dir_name in build-tools cmdline-tools emulator licenses platform-tools platforms; do
  if [[ -e "$SOURCE_ANDROID_HOME/$dir_name" ]]; then
    ln -s "$SOURCE_ANDROID_HOME/$dir_name" "$MIRROR_ANDROID_HOME/$dir_name"
  fi
done

mkdir -p "$MIRROR_ANDROID_HOME/ndk"
ln -s "$SELECTED_NDK" "$MIRROR_ANDROID_HOME/ndk/$(basename "$SELECTED_NDK")"

export ANDROID_HOME="$MIRROR_ANDROID_HOME"
export ANDROID_NDK_HOME="$SELECTED_NDK"
export ANDROID_NDK_ROOT="$SELECTED_NDK"
export NDK_HOME="$SELECTED_NDK"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

cd "$ROOT_DIR"

echo "Using ANDROID_HOME=$ANDROID_HOME"
echo "Using NDK=$SELECTED_NDK"

BUILD_MARKER_FILE="$(mktemp)"
trap 'rm -f "$BUILD_MARKER_FILE"' EXIT

TAURI_ARGS=("$@")
ANDROID_SUBCOMMAND="${1:-}"
recreate_android_project_if_broken "$ANDROID_SUBCOMMAND"
sync_android_icons

if [[ "$ANDROID_SUBCOMMAND" =~ ^(build|dev|run)$ ]] && [[ -f "$ANDROID_TAURI_CONFIG" ]] && ! has_tauri_config_arg "${TAURI_ARGS[@]}"; then
  TAURI_ARGS+=(--config "$ANDROID_TAURI_CONFIG")
  echo "Using Android Tauri config: $ANDROID_TAURI_CONFIG"
fi

if [[ "$ANDROID_COMMAND_ALREADY_EXECUTED" == "1" ]]; then
  echo "Android init completed during repair."
else
  npx tauri android "${TAURI_ARGS[@]}"

  if [[ "$ANDROID_SUBCOMMAND" == "init" ]]; then
    sync_android_icons
  fi
fi

if should_sign_release_apks "${TAURI_ARGS[@]}"; then
  sign_release_apks "$BUILD_MARKER_FILE"
fi
