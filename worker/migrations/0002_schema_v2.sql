-- v2: BLOB ID、構造化カウンタ、expires_at、テーブル名整理

CREATE TABLE word_entries (
  id           BLOB NOT NULL PRIMARY KEY,
  body         TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 24),
  session_id   BLOB,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  CHECK (expires_at > created_at)
) WITHOUT ROWID;

CREATE INDEX idx_word_entries_expires ON word_entries(expires_at);
CREATE INDEX idx_word_entries_created ON word_entries(created_at DESC);

CREATE TABLE active_sessions (
  session_id     BLOB NOT NULL PRIMARY KEY,
  last_seen_at   INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX idx_active_sessions_last_seen ON active_sessions(last_seen_at);

CREATE TABLE api_usage_buckets (
  granularity    INTEGER NOT NULL CHECK (granularity IN (1, 2)),
  period_start   INTEGER NOT NULL,
  request_count  INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (granularity, period_start)
) WITHOUT ROWID;

CREATE TABLE word_post_cooldowns (
  ip_hash          BLOB NOT NULL PRIMARY KEY,
  last_posted_at   INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE ip_request_windows (
  ip_hash        BLOB NOT NULL,
  route_id       INTEGER NOT NULL CHECK (route_id IN (1, 2)),
  window_start   INTEGER NOT NULL,
  request_count  INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (ip_hash, route_id)
) WITHOUT ROWID;

-- 既存データ移行（テーブルがある場合のみ）
INSERT INTO word_entries (id, body, session_id, created_at, expires_at)
SELECT
  unhex(replace(id, '-', '')),
  text,
  CASE
    WHEN session_id IS NOT NULL AND length(replace(session_id, '-', '')) = 32
      THEN unhex(replace(session_id, '-', ''))
    ELSE NULL
  END,
  created_at,
  created_at + 31536000
FROM words
WHERE length(replace(id, '-', '')) = 32;

INSERT INTO active_sessions (session_id, last_seen_at)
SELECT unhex(replace(session_id, '-', '')), last_seen
FROM heartbeats
WHERE length(replace(session_id, '-', '')) = 32;

INSERT INTO word_post_cooldowns (ip_hash, last_posted_at)
SELECT unhex(ip_hash), last_post
FROM rate_limits
WHERE length(ip_hash) = 32;

INSERT INTO ip_request_windows (ip_hash, route_id, window_start, request_count)
SELECT
  unhex(ip_hash),
  CASE route WHEN 'presence' THEN 1 WHEN 'words' THEN 2 END,
  window_start,
  count
FROM ip_throttle
WHERE length(ip_hash) = 32 AND route IN ('presence', 'words');

INSERT INTO api_usage_buckets (granularity, period_start, request_count)
SELECT
  CASE WHEN period_key LIKE 'day:%' THEN 1 ELSE 2 END,
  CASE
    WHEN period_key LIKE 'day:%' THEN unixepoch(substr(period_key, 5) || ' 00:00:00')
    WHEN period_key LIKE 'month:%' THEN unixepoch(substr(period_key, 7) || '-01 00:00:00')
  END,
  count
FROM api_usage
WHERE period_key LIKE 'day:%' OR period_key LIKE 'month:%';

DROP TABLE IF EXISTS words;
DROP TABLE IF EXISTS heartbeats;
DROP TABLE IF EXISTS api_usage;
DROP TABLE IF EXISTS rate_limits;
DROP TABLE IF EXISTS ip_throttle;

DROP INDEX IF EXISTS idx_words_created;
DROP INDEX IF EXISTS idx_heartbeats_last_seen;
