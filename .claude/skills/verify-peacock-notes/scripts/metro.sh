#!/usr/bin/env bash
# Metro bundler lifecycle for verification. The emulator build is an Expo dev
# build: it shows a white screen until Metro serves the JS bundle, so Metro
# must be up before (re)launching the app. Run from the repo root.
# Usage: ./scripts/metro.sh start|stop|status
set -euo pipefail

PIDFILE=/tmp/verify-metro.pid
LOG=/tmp/verify-metro.log

case "${1:-status}" in
  start)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "METRO: already running as pid $(cat "$PIDFILE")"
      exit 0
    fi
    rm -f "$LOG" "$PIDFILE"
    # setsid gives Metro its own process group so stop kills the whole tree
    # (npx spawns child node processes a plain kill would orphan).
    (setsid nohup npx expo start --port 8081 >"$LOG" 2>&1 < /dev/null & echo $! > "$PIDFILE")
    for _ in $(seq 1 60); do
      grep -q "Waiting on http://localhost:8081" "$LOG" 2>/dev/null && break
      sleep 2
    done
    if grep -q "Waiting on http://localhost:8081" "$LOG" 2>/dev/null; then
      echo "METRO OK pid $(cat "$PIDFILE")"
    else
      echo "METRO FAIL: bundler did not come up, see $LOG"
      tail -n 20 "$LOG" 2>/dev/null || true
      exit 1
    fi
    ;;
  stop)
    if [ -f "$PIDFILE" ]; then
      pid="$(cat "$PIDFILE")"
      if kill -0 "$pid" 2>/dev/null; then
        kill -- "-$pid" 2>/dev/null || kill "$pid"
        for _ in $(seq 1 10); do
          kill -0 "$pid" 2>/dev/null || break
          sleep 1
        done
        echo "METRO: stopped process group $pid"
      else
        echo "METRO: pid $pid already gone"
      fi
      rm -f "$PIDFILE"
    else
      echo "METRO: not running (no pidfile)"
    fi
    if curl -sf http://localhost:8081/status >/dev/null 2>&1; then
      echo "METRO WARN: something still serves :8081 after stop"
      exit 1
    fi
    ;;
  status)
    if curl -sf http://localhost:8081/status 2>/dev/null | grep -q "packager-status:running"; then
      echo "METRO OK: packager running on :8081"
    else
      echo "METRO FAIL: nothing serving on :8081 (run ./scripts/metro.sh start)"
      exit 1
    fi
    ;;
  *)
    echo "Usage: $0 start|stop|status"
    exit 1
    ;;
esac
