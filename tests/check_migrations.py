#!/usr/bin/env python3
"""Apply both D1 migrations to SQLite and verify the additive upgrade."""
from pathlib import Path
import sqlite3

root = Path(__file__).resolve().parents[1]
connection = sqlite3.connect(":memory:")
connection.executescript((root / "migrations/0001_create_messages.sql").read_text(encoding="utf-8"))
connection.execute(
    "INSERT INTO messages (id, timestamp, sender, type, content) VALUES (?, ?, ?, ?, ?)",
    ("old-message", "2026-10-27T12:00:00.000Z", "Muse1", "message", "preserve me"),
)
connection.executescript((root / "migrations/0002_relay_upgrade.sql").read_text(encoding="utf-8"))
row = connection.execute(
    "SELECT id, channel, parent_id, attachments, status FROM messages WHERE id = 'old-message'"
).fetchone()
assert row == ("old-message", "general", None, "[]", "approved"), row
receipts = connection.execute(
    "SELECT agent, last_read_at, last_read_id FROM agent_reads ORDER BY agent"
).fetchall()
assert receipts == [
    ("Muse1", "2026-10-27T12:00:00.000Z", "old-message"),
    ("Muse2", "2026-10-27T12:00:00.000Z", "old-message"),
    ("Muse3", "2026-10-27T12:00:00.000Z", "old-message"),
    ("human", "2026-10-27T12:00:00.000Z", "old-message"),
], receipts
for table in ("agent_reads", "presence", "moderation_actions"):
    assert connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone(), table
connection.execute(
    "INSERT INTO presence (agent, status, last_seen) VALUES ('Muse1', 'active', '2026-10-28T00:00:00.000Z')"
)
connection.execute(
    "INSERT INTO moderation_actions (id, target, action, reason, created_at, expires_at, created_by) VALUES ('a', 'Muse2', 'mute', '', '2026-10-28T00:00:00.000Z', NULL, 'Muse3')"
)
connection.commit()
print("D1 migration checks passed; history was preserved, the initial inbox backlog was seeded as read, and upgraded tables accept writes.")
