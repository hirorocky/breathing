# 主要ファイル

## フロント

| ファイル | 役割 |
|---|---|
| `components/Space.tsx` | オーケストレーション、言葉のローカル追加 + 裏 POST |
| `components/DriftField.tsx` | 漂う言葉の表示（ローカルのみ） |
| `hooks/useOnlineSpace.ts` | presence polling、orbCount、再送キュー |
| `hooks/useOrbCount.ts` | orb 数の緩やかな追従 |
| `lib/api.ts` | `fetchPresence` / `submitWord` |
| `lib/constants.ts` | `ONLINE` 設定 |
| `lib/orbPresence.ts` | presence → orb 目標値 |
| `next.config.ts` | static export、dev rewrite |
| `public/_routes.json` | `/api/*` を Worker へ |

## Worker

| ファイル | 役割 |
|---|---|
| `worker/src/index.ts` | Hono アプリ（cors / logger / onError） |
| `worker/src/routes/public.ts` | presence / words |
| `worker/src/routes/admin.ts` | admin stats / words（bearer-auth） |
| `worker/src/middleware/` | origin / IP スロットル / 予算ガード |
| `worker/src/budget.ts` | 予算カウント（D1） |
| `worker/src/security.ts` | Origin 検証 / IP ハッシュ / スロットル |
| `worker/wrangler.toml` | D1 バインディング・環境変数 |
| `worker/migrations/` | D1 スキーマ |

## CI

| ファイル | 役割 |
|---|---|
| `.github/workflows/ci.yml` | lint / typecheck / build |
| `.github/workflows/deploy-worker.yml` | migrate + deploy |

`sessionSeed` 由来の演出は API 実数とは別。`apiMode === "online"` のときだけ人数が実数になる。
