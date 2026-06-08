-- visit 開始時刻と確定済み訪問履歴

ALTER TABLE active_sessions ADD COLUMN visit_started_at INTEGER;

UPDATE active_sessions
SET visit_started_at = last_seen_at
WHERE visit_started_at IS NULL;

CREATE TABLE session_visits (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER NOT NULL,
  duration_sec  INTEGER NOT NULL CHECK (duration_sec >= 0),
  expires_at    INTEGER NOT NULL,
  CHECK (ended_at >= started_at)
);

CREATE INDEX idx_session_visits_started ON session_visits(started_at DESC);
CREATE INDEX idx_session_visits_expires ON session_visits(expires_at);
