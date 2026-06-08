# API 仕様

ベースパス: `/api`（本番は Pages と同一オリジン）

## 利用者向け

### `GET /api/presence`

heartbeat と人数取得を兼ねる。クライアントはこれを定期的に polling する。

- Cookie `breathing_sid` で匿名セッション（なければ発行）
- 成功: `{ online: true, mode: "online", count: number }`
- 予算超過: HTTP 503 + `{ online: false, mode: "static_only", reason }`

### `POST /api/words`

観察用保存。画面はローカル反映のみ。

**リクエスト:** `{ text: string }`

- 1〜24 文字（trim 後）
- URL（`https?://`）禁止
- IP レート制限（既定 30s）

**レスポンス**

- 成功: `{ ok: true, online: true }`
- エラー: `{ error: "invalid_text" | "rate_limited" | ... }`
- 予算超過: 503 + `static_only`

`GET /api/words` は存在しない。

## 実装者向け（認証必須）

`Authorization: Bearer <ADMIN_TOKEN>`

### `GET /api/admin/stats`

```json
{
  "staticOnlyMode": false,
  "apiUsage": {
    "daily": { "periodStart": 1717200000, "count": 120 },
    "monthly": { "periodStart": 1717200000, "count": 5400 }
  },
  "wordsStored": 42,
  "dailyLimit": "90000",
  "monthlyLimit": "9000000"
}
```

### `GET /api/admin/words`

```json
{
  "words": [
    {
      "id": "...",
      "text": "...",
      "session_id": "...",
      "created_at": 1710000000,
      "expires_at": 1741536000
    }
  ]
}
```

直近 500 件。

## エラーコード（公開 API）

| HTTP | error | 意味 |
|---|---|---|
| 400 | `invalid_json` / `invalid_text` / `url_not_allowed` | 入力不正 |
| 403 | `forbidden_origin` | Origin 不一致 |
| 413 | `payload_too_large` | body 超過 |
| 429 | `rate_limited` | IP 制限 |
| 503 | `static_only` | 予算超過または手動停止 |

503 時は `X-Breathing-Mode: static-only` ヘッダあり。
