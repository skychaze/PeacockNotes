#!/usr/bin/env bash
# Stop the app instance this run started. Never touches evidence dirs.
# Usage: SERIAL=emulator-5554 ./scripts/teardown.sh
# Then close your own agent-device session: agent-device close (with your flags).
set -euo pipefail

SERIAL="${SERIAL:-emulator-5554}"
PKG="com.roy.peacocknotes"

adb -s "$SERIAL" shell am force-stop "$PKG"
"$(dirname "$0")/metro.sh" stop
echo "TEARDOWN OK: $PKG stopped, Metro stopped on $SERIAL (evidence dirs untouched)"
