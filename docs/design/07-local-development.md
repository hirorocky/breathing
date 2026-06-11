# ローカル開発

## 初回セットアップ

```bash
cp .env.local.example .env.local
npm install
cd worker && npm install && npm run db:migrate:local && cd ..
```

## 起動

```bash
npm run dev   # Next :3000
```

Worker（admin API や D1 の確認）:

```bash
npm run dev:worker   # :8787
npm run dev:all      # 両方
```

## ビルド確認

```bash
npm run lint
npm run typecheck:worker
npm run build   # 出力: out/
```
