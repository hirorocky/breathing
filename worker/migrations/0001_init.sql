CREATE TABLE words (
  id          TEXT PRIMARY KEY,
  text        TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 24),
  session_id  TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_words_created ON words(created_at DESC);

CREATE TABLE heartbeats (
  session_id TEXT PRIMARY KEY,
  last_seen  INTEGER NOT NULL
);

CREATE INDEX idx_heartbeats_last_seen ON heartbeats(last_seen);

CREATE TABLE api_usage (
  period_key TEXT PRIMARY KEY,
  count      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE rate_limits (
  ip_hash   TEXT PRIMARY KEY,
  last_post INTEGER NOT NULL
);

CREATE TABLE ip_throttle (
  ip_hash       TEXT NOT NULL,
  route         TEXT NOT NULL,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, route)
);
