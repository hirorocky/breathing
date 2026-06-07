# データベース（D1）

マイグレーション: `worker/migrations/`

## テーブル

### `words`

観察用コーパス。利用者向け GET なし。

```sql
CREATE TABLE words (
  id          TEXT PRIMARY KEY,
  text        TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 24),
  session_id  TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
```

古い行は `WORDS_MAX_STORED`（既定 10,000）を超えた分から削除。

**意図的に持たない:** `author_name`, `likes`, `views`, `is_public`

### `heartbeats`

polling presence 用。

```sql
CREATE TABLE heartbeats (
  session_id TEXT PRIMARY KEY,
  last_seen  INTEGER NOT NULL
);
```

`PRESENCE_WINDOW_SEC` より古い行はリクエスト時に削除。

### `api_usage`

予算ガード用。キーは `day:YYYY-MM-DD` と `month:YYYY-MM`。

### `rate_limits`

言葉 POST の IP 別クールダウン。

### `ip_throttle`

公開 API 全体の IP 別スロットル。

## マイグレーション適用

```bash
# ローカル
cd worker && npm run db:migrate:local

# 本番（CI でも deploy 前に実行）
cd worker && npm run db:migrate:remote
```
