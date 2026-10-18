#!/usr/bin/env python3
"""Append a compact, deterministic hourly digest to shared-log.md."""
from __future__ import annotations

import fcntl
import json
import os
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ARCHIVE = Path(os.environ.get("RELAY_ARCHIVE", ROOT / "message-archive.jsonl"))
SHARED_LOG = ROOT / "shared-log.md"
STATE_DIR = ROOT / "state"
DIGEST_STATE = STATE_DIR / "digest-state.json"
SUMMARY_STATE = STATE_DIR / "summary-state.json"
LOCK = STATE_DIR / "digest.lock"


def read_state(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def save_state(path: Path, data: dict) -> None:
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, path)


def main() -> int:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with LOCK.open("w") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        old = read_state(DIGEST_STATE)
        offset = max(0, int(old.get("offset", 0)))
        messages = []
        end_offset = offset
        if ARCHIVE.exists():
            size = ARCHIVE.stat().st_size
            if offset > size:
                offset = 0
                end_offset = 0
            with ARCHIVE.open("rb") as archive:
                archive.seek(offset)
                while True:
                    start = archive.tell()
                    line = archive.readline()
                    if not line or not line.endswith(b"\n"):
                        archive.seek(start)
                        break
                    end_offset = archive.tell()
                    if line.strip():
                        try:
                            messages.append(json.loads(line.decode("utf-8")))
                        except (UnicodeDecodeError, json.JSONDecodeError):
                            pass
        now = datetime.now(timezone.utc).astimezone().isoformat(timespec="minutes")
        lines = [f"\n## Relay digest — {now}", f"Messages since previous digest: {len(messages)}"]
        if messages:
            counts = Counter(str(m.get("sender", "unknown")) for m in messages)
            lines.append("Participants: " + ", ".join(f"{name} ({count})" for name, count in sorted(counts.items())))
            lines.append("Recent messages:")
            for message in messages[-10:]:
                sender = str(message.get("sender", "unknown")).replace("\n", " ")
                content = str(message.get("content", "")).replace("\n", " ")
                lines.append(f"- **{sender}:** {content[:300]}")
        else:
            lines.append("No new messages since the previous digest.")
        SHARED_LOG.parent.mkdir(parents=True, exist_ok=True)
        with SHARED_LOG.open("a", encoding="utf-8") as output:
            fcntl.flock(output.fileno(), fcntl.LOCK_EX)
            output.write("\n".join(lines) + "\n")
            output.flush()
            os.fsync(output.fileno())
        save_state(DIGEST_STATE, {"offset": end_offset, "last_run": now, "messages_in_digest": len(messages)})
        last = messages[-1] if messages else {}
        save_state(SUMMARY_STATE, {"last_summary_at": now, "last_message_id": last.get("id"), "messages_summarized": len(messages)})
        print(f"Wrote digest: {len(messages)} new message(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
