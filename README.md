# 深呼吸している場所

ブラウザ上で呼吸する空間に滞在する Web アプリ。Next.js（静的エクスポート）と Cloudflare Worker（API）で構成されています。

## ローカル開発環境

### 必要なもの

| もの | 用途 |
|---|---|
| Node.js **26** | フロントのビルド・開発、`wrangler` |
| npm | 依存関係のインストール・スクリプト実行 |

リポジトリに `mise.toml` がある場合は、ルートで `mise install` すると Node 26 が入ります。

### 初回セットアップ

リポジトリのルートで次を実行します。

```bash
cp .env.local.example .env.local
npm install
cd worker && npm install && npm run db:migrate:local && cd ..
```

`.env.local` の `NEXT_PUBLIC_ONLINE=1` が有効なとき、人数の気配や言葉のサーバー保存などオンライン機能が動きます。未設定のときはオフライン同等です。

### 起動

オンライン機能込みで開発するときは、フロントと Worker を同時に起動します。

```bash
npm run dev:all
```

| サービス | URL |
|---|---|
| フロント（Next.js） | http://localhost:3000 |
| API（Worker） | http://localhost:8787 |

開発中、Next.js は `/api/*` を `WORKER_DEV_ORIGIN`（既定 `http://localhost:8787`）へプロキシします。`npm run dev` だけでは API に届きません。

Worker だけ起動する場合:

```bash
npm run dev:worker
```

### オフライン同等で試す

`.env.local` から `NEXT_PUBLIC_ONLINE` を外すか、Worker を起動せず `npm run dev` のみで十分です。

### ビルド確認

```bash
npm run lint
npm run typecheck:worker
NEXT_PUBLIC_ONLINE=1 npm run build
```

エラーなく `out/` が生成されれば OK です。

### Cloudflare（wrangler）の認証情報

`wrangler login` の代わりに API トークンを使う場合:

```bash
cp .env.cloudflare.example .env.cloudflare
# CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID を記入
```

`mise.toml` が `.env.cloudflare` を自動読み込みします（`mise activate` がシェルに入っていること）。

### 関連ドキュメント

- ローカル開発の詳細: [docs/design/07-local-development.md](docs/design/07-local-development.md)
- 環境変数一覧: [docs/design/06-configuration.md](docs/design/06-configuration.md)
- 本番デプロイ: [docs/tasks/deploy.md](docs/tasks/deploy.md)
