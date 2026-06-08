# データベース（D1）

マイグレーション: `worker/migrations/`

SQLite（D1）のため、時刻は **INTEGER unix 秒**、UUID・IP ハッシュは **TEXT**（GUI で読みやすい形式）を使う。

## テーブル

### `words`

観察用コーパス。利用者向け GET なし。

| 列 | 型 | 説明 |
|---|---|---|
| `id` | TEXT PK | 言葉 ID（UUID 文字列） |
| `text` | TEXT | 1〜24 文字 |
| `session_id` | TEXT | 投稿セッション（任意、UUID 文字列） |
| `created_at` | INTEGER | 作成 unix 秒 |
| `expires_at` | INTEGER | 削除予定 unix 秒（挿入時に `created_at + WORDS_RETENTION_SEC`） |

期限切れ行は `DELETE FROM words WHERE expires_at < ?` で削除。

**意図的に持たない:** `author_name`, `likes`, `views`, `is_public`

### `active_sessions`

polling presence 用。

| 列 | 型 | 説明 |
|---|---|---|
| `session_id` | TEXT PK | 匿名セッション UUID |
| `visit_started_at` | INTEGER | いまの visit の開始 unix 秒 |
| `last_seen_at` | INTEGER | 最終 `/api/presence` unix 秒 |

`PRESENCE_WINDOW_SEC` より古い行はリクエスト時に間引き削除。人数は `last_seen_at >= cutoff` の `COUNT(*)`。終了した visit は `session_visits` に確定する。

### `session_visits`

確定済み visit の履歴（admin 集計用）。

| 列 | 型 | 説明 |
|---|---|---|
| `id` | TEXT PK | visit ID（UUID） |
| `session_id` | TEXT | Cookie の匿名 UUID |
| `started_at` | INTEGER | 訪問開始 unix 秒 |
| `ended_at` | INTEGER | 訪問終了 unix 秒（最後の presence） |
| `duration_sec` | INTEGER | `ended_at - started_at` |
| `expires_at` | INTEGER | 削除予定 unix 秒（`ended_at + SESSION_VISITS_RETENTION_SEC`） |

詳細は [11-session-visits.md](./11-session-visits.md)。

### `api_usage`

予算ガード用。

| 列 | 型 | 説明 |
|---|---|---|
| `granularity` | INTEGER | `1` = 日、`2` = 月 |
| `period_start` | INTEGER | その期間の UTC 開始 unix 秒 |
| `count` | INTEGER | リクエスト数 |

### `ip_throttle`

公開 API の IP 別スロットル（`IP_THROTTLE_*`、既定 60 秒あたり 120 リクエスト）。`presence` と `words` で別カウント。

| 列 | 型 | 説明 |
|---|---|---|
| `ip_hash` | TEXT | SHA-256 先頭 16 bytes の小文字 hex（32 文字） |
| `route` | TEXT | `presence` または `words` |
| `window_start` | INTEGER | ウィンドウ開始 unix 秒 |
| `count` | INTEGER | ウィンドウ内リクエスト数 |

## マイグレーション適用

```bash
# ローカル
cd worker && npm run db:migrate:local

# 本番（CI でも deploy 前に実行）
cd worker && npm run db:migrate:remote
```

- `0002_schema_v2.sql` — `expires_at` 追加、`api_usage` 構造化（適用済みのため変更しない）
- `0003_v1_names.sql` — 長いテーブル名・BLOB を v1 名・TEXT に統一
- `0004_session_visits.sql` — `visit_started_at` と `session_visits`
