# 環境変数

## フロント（`.env.local` / Pages ビルド時）

| 変数 | 例 | 意味 |
|---|---|---|
| `NEXT_PUBLIC_PRIVACY_CONTACT` | `your@example.com` | `/privacy` の問い合わせ先 |

テンプレート: `.env.local.example`

## Worker（`worker/wrangler.toml` + secrets）

| 変数 | 既定 | 意味 |
|---|---|---|
| `ADMIN_TOKEN` | secret | admin API 認証 |
| `BUDGET_ENABLED` | `true` | 利用カウント有効 |
| `BUDGET_DAILY_REQUESTS` | `90000` | 日次上限 |
| `BUDGET_MONTHLY_REQUESTS` | `9000000` | 月次上限 |
| `STATIC_ONLY_MODE` | `false` | `true` で即 API 停止 |
| `PRESENCE_WINDOW_SEC` | `300` | 気配カウント窓（秒） |
| `WORDS_MAX_STORED` | `10000` | 言葉の保持上限 |
| `SESSION_VISITS_RETENTION_SEC` | `31536000` | visit 記録の保持期間（秒） |
| `ALLOWED_ORIGINS` | — | 本番 URL（カンマ区切り） |
| `IP_THROTTLE_WINDOW_SEC` | `60` | IP スロットル窓 |
| `IP_THROTTLE_MAX` | `120` | 窓あたり最大リクエスト |
| `MAX_BODY_BYTES` | `1024` | POST body 上限 |

`ADMIN_TOKEN` は GitHub に入れない。`wrangler secret put ADMIN_TOKEN` で Worker のみに設定。
