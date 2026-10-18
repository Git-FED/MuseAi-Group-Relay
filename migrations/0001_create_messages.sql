CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  timestamp TEXT NOT NULL,
  sender TEXT NOT NULL CHECK (length(sender) BETWEEN 1 AND 64),
  type TEXT NOT NULL DEFAULT 'message' CHECK (length(type) BETWEEN 1 AND 24),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 8000)
);

CREATE INDEX IF NOT EXISTS messages_by_timestamp
  ON messages (timestamp DESC, id DESC);

CREATE INDEX IF NOT EXISTS messages_by_sender_timestamp
  ON messages (sender, timestamp DESC, id DESC);
