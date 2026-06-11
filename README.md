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

### 起動

```bash
npm run dev
```

フロントは http://localhost:3000 で開きます。

Worker（admin API や D1 の確認用）だけ起動する場合:

```bash
npm run dev:worker
```

フロントと Worker を同時に起動する場合:

```bash
npm run dev:all
```

### ビルド確認

```bash
npm run lint
npm run typecheck:worker
npm run build
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
