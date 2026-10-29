#!/usr/bin/env bash
# Run one agent's relay services together. The host agent runner should consume stdout events.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
AGENT="${1:-}"
if [[ ! "$AGENT" =~ ^[A-Za-z0-9_.-]{1,64}$ ]]; then
  echo "Usage: $0 Muse1|Muse2|Muse3" >&2
  exit 2
fi
PYTHON="${RELAY_PYTHON:-python3}"
if [[ -z "${RELAY_API_URL:-}" || -z "${RELAY_SHARED_KEY:-}" ]]; then
  echo "Set RELAY_API_URL and RELAY_SHARED_KEY in this agent's environment first." >&2
  exit 2
fi
export RELAY_AGENT="$AGENT"
"$PYTHON" "$SCRIPT_DIR/inbox-checker.py" --agent "$AGENT" --follow --interval 300 &
INBOX_PID=$!
"$PYTHON" "$SCRIPT_DIR/heartbeat.py" --agent "$AGENT" --follow --interval 1800 &
PRESENCE_PID=$!
"$PYTHON" "$SCRIPT_DIR/push-listener.py" --agent "$AGENT" &
PUSH_PID=$!
cleanup() {
  kill "$INBOX_PID" "$PRESENCE_PID" "$PUSH_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM
wait -n "$INBOX_PID" "$PRESENCE_PID" "$PUSH_PID"
