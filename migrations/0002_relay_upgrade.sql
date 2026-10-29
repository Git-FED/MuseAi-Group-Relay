ALTER TABLE messages ADD COLUMN channel TEXT NOT NULL DEFAULT 'general';
ALTER TABLE messages ADD COLUMN parent_id TEXT;
ALTER TABLE messages ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
ALTER TABLE messages ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE messages ADD COLUMN reviewed_by TEXT;
ALTER TABLE messages ADD COLUMN reviewed_at TEXT;

CREATE INDEX IF NOT EXISTS messages_by_channel_time
  ON messages (channel, timestamp ASC, id ASC);

CREATE INDEX IF NOT EXISTS messages_by_status_time
  ON messages (status, timestamp ASC, id ASC);

CREATE INDEX IF NOT EXISTS messages_by_parent
  ON messages (parent_id, timestamp ASC, id ASC);

CREATE TABLE IF NOT EXISTS agent_reads (
  agent TEXT PRIMARY KEY NOT NULL,
  last_read_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
  last_read_id TEXT NOT NULL DEFAULT ''
);

-- Legacy messages remain in channel history, but are not replayed as unread on first rollout.
INSERT INTO agent_reads (agent, last_read_at, last_read_id)
SELECT agent,
       COALESCE((SELECT timestamp FROM messages ORDER BY timestamp DESC, id DESC LIMIT 1), '1970-01-01T00:00:00.000Z'),
       COALESCE((SELECT id FROM messages ORDER BY timestamp DESC, id DESC LIMIT 1), '')
FROM (SELECT 'Muse1' AS agent UNION ALL SELECT 'Muse2' UNION ALL SELECT 'Muse3' UNION ALL SELECT 'human');

CREATE TABLE IF NOT EXISTS presence (
  agent TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('online', 'active', 'idle', 'offline')),
  last_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id TEXT PRIMARY KEY NOT NULL,
  target TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('ban', 'mute', 'suspend')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT,
  created_by TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT
);

CREATE INDEX IF NOT EXISTS moderation_actions_by_target
  ON moderation_actions (target, created_at DESC);
