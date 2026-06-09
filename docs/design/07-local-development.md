# ローカル開発

## 初回セットアップ

```bash
cp .env.local.example .env.local   # NEXT_PUBLIC_ONLINE=1 を確認
npm install
cd worker && npm install && npm run db:migrate:local && cd ..
```

## 起動

```bash
npm run dev:all   # Next :3000 + Worker :8787
```

- `npm run dev` 単体では Worker API に届かない
- Worker だけ: `npm run dev:worker`

開発時は `NEXT_PUBLIC_API_BASE` 未設定でも、フロントが既定で `http://localhost:8787` の Worker API を呼ぶ。

## ビルド確認

```bash
npm run lint
npm run typecheck:worker
NEXT_PUBLIC_ONLINE=1 npm run build   # 出力: out/
```

## オフライン同等で試す

`.env.local` から `NEXT_PUBLIC_ONLINE` を外すか、Worker を起動しない。
