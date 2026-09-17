#!/usr/bin/env bash
# Install (if needed) and cold-launch Peacock Notes on the emulator.
# Usage: SERIAL=emulator-5554 ./scripts/launch.sh [path-to-apk]
# Default APK: highest versionCode under releases/v*/peacocknotes-*.apk,
# fallback android/.../app-release.apk. Release APKs bundle their JS, so a
# newer build already installed is kept rather than downgraded; build and
# install a fresh APK to test JS changes (see the verify skill).
set -euo pipefail

SERIAL="${SERIAL:-emulator-5554}"
PKG="com.roy.peacocknotes"
APK="${1:-}"

if [ -z "$APK" ]; then
  # Checkout mtimes are identical, so rank by the trailing versionCode.
  APK="$(ls releases/v*/peacocknotes-*.apk 2>/dev/null | sort -t- -k3 -V | tail -n 1 || true)"
  if [ -z "$APK" ]; then
    APK="android/app/build/outputs/apk/release/app-release.apk"
  fi
fi
if [ ! -f "$APK" ]; then
  echo "LAUNCH FAIL: no APK at $APK (build one via the compile-apk skill)"
  exit 1
fi

adb -s "$SERIAL" wait-for-device
# Buffer install output to a file before grepping: grep -q on the live pipe
# plus pipefail misreports success when the writer dies of SIGPIPE.
adb -s "$SERIAL" install -r "$APK" >/tmp/verify-launch-install.log 2>&1 || true
if grep -q "^Success" /tmp/verify-launch-install.log; then
  echo "LAUNCH: installed $APK"
elif grep -q "INSTALL_FAILED_UPDATE_INCOMPATIBLE" /tmp/verify-launch-install.log; then
  echo "LAUNCH WARN: emulator has $PKG with a different signing key; keeping installed build (no data wipe). doctor.sh reports its version."
elif grep -q "INSTALL_FAILED_VERSION_DOWNGRADE" /tmp/verify-launch-install.log; then
  echo "LAUNCH WARN: emulator has a newer $PKG build; keeping installed build (no data wipe). doctor.sh reports its version."
else
  echo "LAUNCH FAIL: install failed, see /tmp/verify-launch-install.log"
  cat /tmp/verify-launch-install.log
  exit 1
fi
adb -s "$SERIAL" shell am force-stop "$PKG"
adb -s "$SERIAL" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
echo "LAUNCH OK: $PKG on $SERIAL"
