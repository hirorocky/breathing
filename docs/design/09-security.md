# セキュリティ

方針: 過剰な監視・検閲・本人確認は入れない。コスト爆発・データ漏洩・荒らしの最小限の抑止に絞る。

## 守るもの

| 資産 | 対策の重点 |
|---|---|
| 置いた言葉（D1） | 公開 GET なし。admin は Bearer |
| `ADMIN_TOKEN` | Worker secret のみ |
| API 利用枠 | 予算ガード + IP スロットル |
| 場の空気 | レート制限 |

## 実装済み対策（Worker）

| 対策 | 設定 |
|---|---|
| 予算ガード | `BUDGET_*` |
| IP スロットル | `IP_THROTTLE_*`（presence / words 共通） |
| 入力検証 | 1〜24 文字、URL 禁止、body 1KB |
| セッション Cookie | HttpOnly / SameSite=Lax / Secure(HTTPS) |
| Admin 認証 | `hono/bearer-auth` |
| Origin 検証 | `ALLOWED_ORIGINS` 設定時 |
| SQL | プリペアドステートメント |

## 主なリスクと残り

| 攻撃 | 対策 | 残リスク |
|---|---|---|
| 言葉スパム | レート + 予算 | 分散 IP |
| presence 連打 | IP スロットル + polling 間隔 | 極端なスケールは WAF |
| admin 漏洩 | secret 管理 | ローテーション必須 |

## 本番チェックリスト

1. `wrangler secret put ADMIN_TOKEN`
2. `ALLOWED_ORIGINS` に本番 URL のみ
3. Cloudflare アカウント 2FA

## 本番で追加推奨（コード外）

Pages `_headers` で CSP, `X-Frame-Options`, `Referrer-Policy`。

```
Content-Security-Policy: default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'
```

## インシデント対応

| 事象 | 対応 |
|---|---|
| API 乱用 | `STATIC_ONLY_MODE=1` |
| admin トークン漏洩 | `wrangler secret put ADMIN_TOKEN` でローテーション |

## 関連コード

`worker/src/security.ts`, `worker/src/budget.ts`, `worker/src/middleware/`, `worker/src/routes/`, `worker/src/index.ts`
