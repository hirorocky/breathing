# データベース（D1）

マイグレーション: `worker/migrations/`

SQLite（D1）のため、時刻は **INTEGER unix 秒**、UUID・IP ハッシュは **BLOB(16)** を使う。

## テーブル（v2）

### `word_entries`

観察用コーパス。利用者向け GET なし。

| 列 | 型 | 説明 |
|---|---|---|
| `id` | BLOB PK | 言葉 ID（UUID 16 bytes） |
| `body` | TEXT | 1〜24 文字 |
| `session_id` | BLOB | 投稿セッション（任意） |
| `created_at` | INTEGER | 作成 unix 秒 |
| `expires_at` | INTEGER | 削除予定 unix 秒（挿入時に `created_at + WORDS_RETENTION_SEC`） |

期限切れ行は `DELETE FROM word_entries WHERE expires_at < ?` で削除。

**意図的に持たない:** `author_name`, `likes`, `views`, `is_public`

### `active_sessions`

polling presence 用（旧 `heartbeats`）。

| 列 | 型 | 説明 |
|---|---|---|
| `session_id` | BLOB PK | 匿名セッション UUID |
| `last_seen_at` | INTEGER | 最終 `/api/presence` unix 秒 |

`PRESENCE_WINDOW_SEC` より古い行はリクエスト時に間引き削除。人数は `last_seen_at >= cutoff` の `COUNT(*)`。

### `api_usage_buckets`

予算ガード用（旧 `api_usage` の文字列キーを廃止）。

| 列 | 型 | 説明 |
|---|---|---|
| `granularity` | INTEGER | `1` = 日、`2` = 月 |
| `period_start` | INTEGER | その期間の UTC 開始 unix 秒 |
| `request_count` | INTEGER | リクエスト数 |

### `word_post_cooldowns`

言葉 POST の IP 別クールダウン（旧 `rate_limits`）。

| 列 | 型 | 説明 |
|---|---|---|
| `ip_hash` | BLOB PK | SHA-256 先頭 16 bytes |
| `last_posted_at` | INTEGER | 最終 POST unix 秒 |

### `ip_request_windows`

公開 API の IP 別スロットル（旧 `ip_throttle`）。

| 列 | 型 | 説明 |
|---|---|---|
| `ip_hash` | BLOB | SHA-256 先頭 16 bytes |
| `route_id` | INTEGER | `1` = presence、`2` = words |
| `window_start` | INTEGER | ウィンドウ開始 unix 秒 |
| `request_count` | INTEGER | ウィンドウ内リクエスト数 |

## マイグレーション適用

```bash
# ローカル
cd worker && npm run db:migrate:local

# 本番（CI でも deploy 前に実行）
cd worker && npm run db:migrate:remote
```

`0002_schema_v2.sql` が旧テーブルからデータを移行し、旧テーブルを DROP する。
