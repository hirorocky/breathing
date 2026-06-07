# 本番デプロイ手順

**あるもの:** Cloudflare アカウント、ローカルのこのプロジェクト  
**ないもの:** GitHub リポジトリ（これから作る）

最後に、静的サイト（Pages）と API（Worker）が同一ドメインで動く状態にする。

---

## 全体の順序

次の **4 フェーズをこの順** で進める。後ろに行くほど前の成果物に依存する。

```
フェーズ 1  GitHub     コードを置く・CI が動く土台
    ↓
フェーズ 2  Worker     D1 + API を Cloudflare に載せる（手動・初回）
    ↓
フェーズ 3  接続       GitHub Secrets → Pages を Git に接続
    ↓
フェーズ 4  仕上げ     ドメイン・ALLOWED_ORIGINS・動作確認
```

| フェーズ | 何ができるようになるか |
|---|---|
| **1** | GitHub にコードがある。`main` push で CI（lint / build）が走る |
| **2** | Worker API が `*.workers.dev` で単体応答する |
| **3** | Pages が Git から自動ビルド。Actions が Worker を自動デプロイできる |
| **4** | 本番 URL でブラウザからサイト + API が使える |

### マスターチェックリスト

**フェーズ 1 — GitHub**

- [ ] §1 ローカルでビルド確認
- [ ] §2 GitHub リポジトリ作成・初回 push

**フェーズ 2 — Cloudflare Worker（GitHub 不要）**

- [ ] §3 Account ID・API トークン
- [ ] §4 D1 作成・`wrangler.toml` 更新・migrate
- [ ] §5 Worker 初回デプロイ・`ADMIN_TOKEN`

**フェーズ 3 — GitHub と Cloudflare を接続**

- [ ] §6 `database_id` の変更を commit / push
- [ ] §7 GitHub Secrets 登録
- [ ] §8 Cloudflare Pages を Git に接続・初回ビルド

**フェーズ 4 — 公開の仕上げ**

- [ ] §9 ドメイン設定（カスタム or `pages.dev`）
- [ ] §10 `ALLOWED_ORIGINS` 設定・Worker 再デプロイ
- [ ] §11 動作確認

---

## 0. 事前に知っておくこと

### 必要なアカウント・ツール

| もの | 用途 |
|---|---|
| [GitHub](https://github.com/) アカウント | リポジトリ・Actions・Pages の Git 連携 |
| Cloudflare アカウント | Worker / D1 / Pages |
| Node.js **26** | ローカルビルド・`wrangler`（`mise install` でも可） |

### 料金プラン

Durable Objects / WebSocket は使わない。**Workers Free** から始められる。トラフィックが増えたら Paid（月 $5 程度）を検討。

### ドメイン

| 方式 | おすすめ |
|---|---|
| **カスタムドメイン**（§9A） | `/api` を同一オリジンで繋ぎやすい。**推奨** |
| **`*.pages.dev` のみ**（§9B） | ドメイン不要。Worker 関連付けの確認が必要 |

### リポジトリに載せてよいもの / ダメなもの

| 載せてよい | 載せない |
|---|---|
| `worker/wrangler.toml` の `database_id`（UUID） | `ADMIN_TOKEN` |
| `.github/workflows/*` | `.env.local` |
| `package-lock.json` | API トークン |

---

# フェーズ 1 — GitHub

Pages は Git リポジトリがないと作れない。**最初に GitHub を整える。**

---

## 1. ローカルでビルド確認

リポジトリのルートで:

```bash
npm install
cd worker && npm install && cd ..

npm run lint
npm run typecheck:worker
NEXT_PUBLIC_ONLINE=1 npm run build
```

エラーなく `out/` ができれば OK。ここで失敗したら先に直す。

---

## 2. GitHub リポジトリを作って push

### 2.1 リポジトリを GitHub 上に作る

**方法 A — ブラウザ（手軽）**

1. [github.com/new](https://github.com/new) を開く
2. **Repository name:** `breathing`（任意）
3. **Private** または **Public**（どちらでも Pages 連携可）
4. **Add a README** / **Add .gitignore** は **付けない**（ローカルに既にあるため）
5. **Create repository**

作成後、空リポジトリの URL が表示される。例:

```
https://github.com/<あなたのユーザー名>/breathing.git
```

**方法 B — GitHub CLI（`gh` が入っている場合）**

```bash
# リポジトリのルートで
gh auth login
gh repo create breathing --private --source=. --remote=origin
```

`--public` にしてもよい。

### 2.2 ローカルから初回 push

まだ git を使っていない場合:

```bash
git init
git branch -M main
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/<ユーザー名>/breathing.git
git push -u origin main
```

既に git 管理されている場合（remote だけない）:

```bash
git branch -M main    # ブランチ名が main でなければ
git remote add origin https://github.com/<ユーザー名>/breathing.git
git push -u origin main
```

SSH を使う場合は `git@github.com:<ユーザー名>/breathing.git`。

### 2.3 CI が走るか確認

1. GitHub でリポジトリを開く
2. **Actions** タブ → **CI** workflow が `main` の push で実行されているか
3. 緑（成功）ならフェーズ 1 完了

失敗したらログを開き、ローカルと同じコマンドで再現する。

---

# フェーズ 2 — Cloudflare Worker

GitHub と独立して進められる。**Pages より先に API の土台を作る。**

---

## 3. Account ID と API トークン

### 3.1 Account ID

1. Dashboard → **Workers & Pages**
2. 右側の **Account ID** をコピー

フェーズ 3 の GitHub Secret `CLOUDFLARE_ACCOUNT_ID` に使う。

### 3.2 API トークン

1. 右上プロフィール → **My Profile** → **API Tokens**
2. **Create Token** → **Create Custom Token**

| 項目 | 設定 |
|---|---|
| Token name | `breathing-deploy` |
| Permissions | Account / **Workers Scripts** — Edit |
| | Account / **D1** — Edit |
| Account Resources | Include → 自分のアカウント |
| Zone Resources | カスタムドメインを使う場合のみ、対象ゾーンに **Workers Routes** — Edit |

3. **Create Token** → 表示された文字列を **一度だけ** コピーして保存

ローカルで `wrangler` を使うとき:

```bash
export CLOUDFLARE_API_TOKEN="貼り付け"
export CLOUDFLARE_ACCOUNT_ID="§4.1 の ID"
```

---

## 4. D1 データベース

```bash
cd worker
npm install
npx wrangler login     # ブラウザで Cloudflare ログイン（初回のみ）
npx wrangler d1 create breathing
```

出力の `database_id` をコピーする。

`worker/wrangler.toml` を編集:

```toml
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

（`REPLACE_WITH_D1_DATABASE_ID` を置換）

マイグレーション:

```bash
npm run db:migrate:remote
```

---

## 5. Worker 初回デプロイ

### ADMIN_TOKEN

```bash
openssl rand -hex 32    # 表示された文字列を控える
npx wrangler secret put ADMIN_TOKEN
```

**GitHub に載せない。** パスワード管理ツールにだけ保存。

### deploy

```bash
npx wrangler deploy
```

成功すると `Published breathing-api` と `*.workers.dev` の URL が表示される。

単体確認:

```bash
curl -s "https://breathing-api.<アカウント名>.workers.dev/api/presence"
```

`{"online":true,"mode":"online","count":0}` などが返ればフェーズ 2 完了。

---

# フェーズ 3 — GitHub と Cloudflare を接続

---

## 6. `database_id` を GitHub に反映

§4 で `wrangler.toml` を書き換えたら、リポジトリに commit する（CI / Actions が同じ ID を使うため）。

```bash
cd ..   # リポジトリルートへ
git add worker/wrangler.toml
git commit -m "Set production D1 database_id"
git push origin main
```

`ADMIN_TOKEN` や API トークンは **commit しない**。

---

## 7. GitHub Secrets

GitHub リポジトリ → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | §3.2 のトークン |
| `CLOUDFLARE_ACCOUNT_ID` | §3.1 の Account ID |

### Actions の確認（任意）

**Actions** → **Deploy Worker** → **Run workflow** → **Run workflow**

成功すれば、以降 `worker/**` の変更を `main` に push するたびに自動デプロイされる。§5 で手動デプロイ済みなので、ここは「自動化の確認」。

---

## 8. Cloudflare Pages（Git 連携）

### 8.1 GitHub を Cloudflare に認証

1. Dashboard → **Workers & Pages** → **Create**
2. **Pages** → **Connect to Git**
3. **Connect GitHub** → リポジトリへのアクセスを許可
4. リポジトリ `breathing`（§2 で作ったもの）を選択 → **Begin setup**

### 8.2 ビルド設定

| 項目 | 値 |
|---|---|
| Project name | `breathing`（`xxxx.pages.dev` の名前） |
| Production branch | `main` |
| Framework preset | **None** |
| Build command | `npm run build` |
| Build output directory | `out` |

### 8.3 環境変数（Production）

**Settings** → **Environment variables** → **Production**:

| Variable | Value |
|---|---|
| `NODE_VERSION` | `26` |
| `NEXT_PUBLIC_ONLINE` | `1` |
| `NEXT_PUBLIC_PRESENCE_POLL_MS` | `60000` |

任意: `NEXT_PUBLIC_PRIVACY_CONTACT`

`NEXT_PUBLIC_API_BASE` は **設定しない**（同一オリジン前提）。

### 8.4 初回デプロイ

**Save and Deploy**。成功すると:

```
https://<project-name>.pages.dev
```

この URL をメモする。フェーズ 3 完了。

---

# フェーズ 4 — 公開の仕上げ

---

## 9. ドメインと `/api` の接続

ブラウザは Pages の URL から **同じホスト名** の `/api/*` にアクセスする。ここを繋ぐ。

### 9A. カスタムドメインがある場合（推奨）

#### ドメインを Cloudflare に追加

1. Dashboard → **Websites** → **Add a site**
2. ドメインを入力 → Free プラン
3. レジストラのネームサーバーを Cloudflare のものに変更

#### Pages にドメインを付ける

**Workers & Pages** → Pages プロジェクト → **Custom domains** → 例: `breathing.example.com`

#### Worker にルートを足す

`worker/wrangler.toml` の末尾:

```toml
[[routes]]
pattern = "breathing.example.com/api/*"
zone_name = "example.com"
```

```bash
cd worker
npx wrangler deploy
# または git push で Actions に任せる
```

本番 URL は `https://breathing.example.com`。

### 9B. `*.pages.dev` のみの場合

§8 で得た URL（例: `https://breathing.pages.dev`）を本番 URL とする。

Dashboard → Pages プロジェクト → **Settings** → **Functions** または **Bindings** で、Worker `breathing-api` を関連付ける設定を探す（UI 名は **Worker** / **Companion worker** など）。

見つからない・`/api` が 404 のときは §9A のカスタムドメインを検討。

**非推奨の回避策:** `NEXT_PUBLIC_API_BASE` に `workers.dev` の URL を入れる方法もあるが、Cookie / CORS で不安定になりやすい。

---

## 10. ALLOWED_ORIGINS

`worker/wrangler.toml` の `[vars]`:

```toml
# カスタムドメイン
ALLOWED_ORIGINS = "https://breathing.example.com"

# pages.dev のみ
# ALLOWED_ORIGINS = "https://breathing.pages.dev"
```

複数: `https://a.example.com,https://b.pages.dev`（カンマ、スペースなし）

```bash
cd worker
npx wrangler deploy
git add worker/wrangler.toml
git commit -m "Set ALLOWED_ORIGINS for production"
git push origin main
```

---

## 11. 動作確認

### ブラウザ（本番 URL）

- [ ] トップが表示される
- [ ] 人数が表示される（0 でも可。常に 3〜5 なら API 未接続の fallback）
- [ ] キー入力で言葉を置ける
- [ ] 言葉が自分の画面に漂う
- [ ] 「この場について」→ `/privacy`

### curl

```bash
curl -s "https://<本番URL>/api/presence"
curl -s -X POST "https://<本番URL>/api/words" \
  -H "Content-Type: application/json" \
  -d '{"text":"てすと"}'
```

### GitHub

- [ ] **CI** が green
- [ ] `main` 更新で Pages が再ビルドされる
- [ ] **Deploy Worker** が成功する

---

## 12. 以降の運用

| 変更 | 自動で起きること |
|---|---|
| フロントのみ push | Pages 再ビルド |
| `worker/**` を push | Actions が migrate + deploy |
| Worker だけ再デプロイしたい | Actions → Deploy Worker → Run workflow |

API 緊急停止: `STATIC_ONLY_MODE = "true"` → commit / deploy。

---

## 13. よくあるつまずき

| 症状 | 確認 |
|---|---|
| `git push` で認証エラー | GitHub の PAT または SSH 鍵 |
| Actions が動かない | デフォルト branch が `main` か。workflow がリポジトリに含まれているか |
| Pages がリポジトリを選べない | Cloudflare の GitHub 連携でリポジトリへのアクセスを許可したか |
| Pages ビルド失敗 | `NODE_VERSION=26`、ローカル `npm run build` |
| `/api` が 404 | §9 のルート or Worker 関連付け |
| `/api` が 403 | `ALLOWED_ORIGINS` とブラウザの URL が一致しているか |
| 人数が常に fallback | Pages の `NEXT_PUBLIC_ONLINE=1` と再デプロイ |

---

## 14. 関連ドキュメント

- [../design/06-configuration.md](../design/06-configuration.md) — 環境変数
- [../design/08-deployment.md](../design/08-deployment.md) — CI/CD 概要
- [../design/09-security.md](../design/09-security.md) — セキュリティ
