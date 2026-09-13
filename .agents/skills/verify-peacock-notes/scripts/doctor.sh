#!/usr/bin/env bash
# Read-only check: is this emulator instance worth driving?
# Usage: SERIAL=emulator-5554 ./scripts/doctor.sh
set -euo pipefail

SERIAL="${SERIAL:-emulator-5554}"
PKG="com.roy.peacocknotes"

boot="$(adb -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
if [ "$boot" != "1" ]; then
  echo "DOCTOR FAIL: device $SERIAL not booted (sys.boot_completed=$boot)"
  exit 1
fi

# Buffer before grep: grep -q on a pipe plus pipefail misreports when the
# writer dies of SIGPIPE after an early match.
pkg_list="$(adb -s "$SERIAL" shell cmd package list packages 2>/dev/null | tr -d '\r')"
if ! grep -qxF "package:$PKG" <<<"$pkg_list"; then
  echo "DOCTOR FAIL: $PKG not installed on $SERIAL"
  exit 1
fi

installed="$(adb -s "$SERIAL" shell dumpsys package "$PKG" 2>/dev/null | grep -m1 versionName | sed 's/.*versionName=//' | tr -d '\r')"
expected="$(python3 -c "import json; print(json.load(open('app.json'))['expo']['version'])")"
echo "device=$SERIAL booted=1 installed=$installed expected=$expected"
if [ "$installed" != "$expected" ]; then
  echo "DOCTOR WARN: installed version ($installed) differs from app.json ($expected); reinstall via scripts/launch.sh"
fi
if curl -sf http://localhost:8081/status 2>/dev/null | grep -q "packager-status:running"; then
  echo "metro=up (:8081 serving)"
else
  echo "DOCTOR FAIL: Metro not serving on :8081 (run ./scripts/metro.sh start)"
  exit 1
fi
echo "DOCTOR OK"
