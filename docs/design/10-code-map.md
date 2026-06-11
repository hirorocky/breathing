# 主要ファイル

## フロント

| ファイル | 役割 |
|---|---|
| `components/Space.tsx` | オーケストレーション、呼吸・気配・イベントの配置 |
| `components/Orbs.tsx` | 画面周辺の気配の点 |
| `lib/constants.ts` | 呼吸・orb などの基本設定 |
| `lib/time.ts` | `Temporal.Now` ベースの時刻ヘルパー |
| `next.config.ts` | static export 設定 |
| `public/_routes.json` | `/api/*` を Worker へ |

## Worker

| ファイル | 役割 |
|---|---|
| `worker/src/index.ts` | Hono アプリ（cors / logger / onError） |
| `worker/src/routes/public.ts` | presence / legacy words |
| `worker/src/routes/admin.ts` | admin stats / words（bearer-auth） |
| `worker/src/middleware/` | origin / IP スロットル / 予算ガード |
| `worker/src/time.ts` | Temporal 時刻ヘルパー（polyfill 経由） |
| `worker/src/budget.ts` | 予算カウント（D1） |
| `worker/src/security.ts` | Origin 検証 / IP ハッシュ / スロットル |
| `worker/wrangler.toml` | D1 バインディング・環境変数 |
| `worker/migrations/` | D1 スキーマ |

## CI

| ファイル | 役割 |
|---|---|
| `.github/workflows/ci.yml` | lint / typecheck / build |
| `.github/workflows/deploy-worker.yml` | migrate + deploy |
