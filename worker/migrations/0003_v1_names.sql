-- v3: BLOB を TEXT に変換し、テーブル名を整理（words / active_sessions / api_usage）

ALTER TABLE word_entries RENAME TO words;
ALTER TABLE words RENAME COLUMN body TO text;

UPDATE words
SET id = lower(
  substr(hex(id), 1, 8) || '-' ||
  substr(hex(id), 9, 4) || '-' ||
  substr(hex(id), 13, 4) || '-' ||
  substr(hex(id), 17, 4) || '-' ||
  substr(hex(id), 21, 12)
)
WHERE typeof(id) = 'blob';

UPDATE words
SET session_id = lower(
  substr(hex(session_id), 1, 8) || '-' ||
  substr(hex(session_id), 9, 4) || '-' ||
  substr(hex(session_id), 13, 4) || '-' ||
  substr(hex(session_id), 17, 4) || '-' ||
  substr(hex(session_id), 21, 12)
)
WHERE session_id IS NOT NULL AND typeof(session_id) = 'blob';

DROP INDEX IF EXISTS idx_word_entries_expires;
DROP INDEX IF EXISTS idx_word_entries_created;
CREATE INDEX idx_words_expires ON words(expires_at);
CREATE INDEX idx_words_created ON words(created_at DESC);

UPDATE active_sessions
SET session_id = lower(
  substr(hex(session_id), 1, 8) || '-' ||
  substr(hex(session_id), 9, 4) || '-' ||
  substr(hex(session_id), 13, 4) || '-' ||
  substr(hex(session_id), 17, 4) || '-' ||
  substr(hex(session_id), 21, 12)
)
WHERE typeof(session_id) = 'blob';

DROP TABLE IF EXISTS word_post_cooldowns;

ALTER TABLE ip_request_windows RENAME TO ip_throttle_old;

CREATE TABLE ip_throttle (
  ip_hash       TEXT NOT NULL,
  route         TEXT NOT NULL CHECK (route IN ('presence', 'words')),
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (ip_hash, route)
);

INSERT INTO ip_throttle (ip_hash, route, window_start, count)
SELECT
  CASE typeof(ip_hash)
    WHEN 'blob' THEN lower(hex(ip_hash))
    ELSE ip_hash
  END,
  CASE route_id WHEN 1 THEN 'presence' WHEN 2 THEN 'words' END,
  window_start,
  request_count
FROM ip_throttle_old;

DROP TABLE ip_throttle_old;

ALTER TABLE api_usage_buckets RENAME TO api_usage_old;

CREATE TABLE api_usage (
  granularity   INTEGER NOT NULL CHECK (granularity IN (1, 2)),
  period_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (granularity, period_start)
) WITHOUT ROWID;

INSERT INTO api_usage (granularity, period_start, count)
SELECT granularity, period_start, request_count
FROM api_usage_old;

DROP TABLE api_usage_old;
