# デプロイと CI/CD

## 構成

- **フロント:** Cloudflare Pages の Git 連携（`main` push → `npm run build` → `out/`）
- **API:** GitHub Actions + `cloudflare/wrangler-action`（D1 migrate → `wrangler deploy`）

同一ドメインで `/` は Pages、`/api/*` は Worker（`public/_routes.json`）。

Durable Objects は使わない。Workers Free 枠から始められる。

## GitHub Actions

| ファイル | トリガー | 内容 |
|---|---|---|
| `.github/workflows/ci.yml` | PR、`main` push | lint / typecheck / build |
| `.github/workflows/deploy-worker.yml` | `main`（`worker/**`）、手動 | migrate → deploy |

## 初回セットアップ（概要）

1. GitHub にリポジトリを作り `main` に push
2. `wrangler d1 create breathing` → `database_id` を更新
3. `wrangler secret put ADMIN_TOKEN` → `wrangler deploy`
4. GitHub Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
5. Pages を Git に接続（`npm run build` / `out` / Node 26）
6. 本番 URL で `ALLOWED_ORIGINS` を設定

詳細は [../tasks/deploy.md](../tasks/deploy.md)。

## Cloudflare API トークン権限

- Account / Workers Scripts — Edit
- Account / D1 — Edit
- Zone / Workers Routes — Edit（カスタムドメインを使う場合）

Durable Objects の権限は不要。

## 環境

| 環境 | フロント | API |
|---|---|---|
| ローカル | `:3000` | `:8787` |
| 本番 | Pages CDN | 同一ドメイン `/api/*` |

## ロールバック

| 事象 | 対応 |
|---|---|
| フロント障害 | Pages の過去デプロイに戻す |
| Worker 障害 | Actions 再実行 or revert → 再デプロイ |
| 緊急 API 停止 | `STATIC_ONLY_MODE=1` → Worker 再デプロイ |
