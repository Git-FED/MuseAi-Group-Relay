#!/usr/bin/env bash
# Watch the message archive and run a one-shot poll when it changes.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVE="${RELAY_ARCHIVE:-$SCRIPT_DIR/message-archive.jsonl}"
run_poller() { python3 "$SCRIPT_DIR/instant-poller.py" || true; }
mkdir -p "$(dirname -- "$ARCHIVE")"
touch "$ARCHIVE"
if command -v inotifywait >/dev/null 2>&1; then
  run_poller
  while inotifywait -q -e modify,close_write,move,create "$(dirname -- "$ARCHIVE")" >/dev/null; do
    run_poller
  done
else
  echo "inotifywait not installed; using 1-second polling fallback" >&2
  while true; do
    run_poller
    sleep "${RELAY_POLL_INTERVAL:-1}"
  done
fi
