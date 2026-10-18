#!/usr/bin/env bash
# Continuously emit new archive messages as JSONL on stdout.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INTERVAL="${RELAY_POLL_INTERVAL:-1}"
while true; do
  python3 "$SCRIPT_DIR/instant-poller.py" || exit $?
  sleep "$INTERVAL"
done
