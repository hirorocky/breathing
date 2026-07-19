# overlay — breathing 固有の StackChan カスタマイズ

`stack-chan/` サブモジュールは **fork [hirorocky/stack-chan](https://github.com/hirorocky/stack-chan) の `breath` ブランチ**を指す。ファームウェア本体の変更は submodule 内で直接編集・コミットする。本ディレクトリ **`overlay/`** には、MOD・スクリプト・ドキュメントを置く（submodule 本体とは別）。

## 構成

| パス | 内容 |
|---|---|
| `../stack-chan/` | fork（submodule、`breath` ブランチ） |
| `docs/my-cores3/` | CoreS3 / K151-R 向けカスタマイズガイド |
| `mods/breath/` | breathing 固有の表現・反応・観測機能（探求の本体） |
| `mods/breath-policy/` | ホストを焼き直さず更新するハードウェア非依存 policy MOD |
| `mods/breath-clear/` | MOD パーティションを空にする補助 MOD |
| `scripts/` | OTA・ログ・IP 発見・マイク監視などの実機運用スクリプト |
| `tools/` | アセット生成などの開発用ツール |

### breath MOD

| パス | 内容 |
|---|---|
| `mods/breath/mod.ts` | `onRobotCreated` を起点とする段階起動と呼吸ループ |
| `mods/breath/face/` | 目・表情・呼吸を描画する顔とレンダラー |
| `mods/breath/emotion.ts` | valence × arousal の感情状態 |
| `mods/breath/reactions.ts` | マイクイベントなどに対する微反応 |
| `mods/breath/posture.ts` | サーボによる感情姿勢と呼吸ボブ |
| `mods/breath/led.ts` | ヘッド LED による環境光表現 |
| `mods/breath/power.ts` | 電源ボタンの orderly shutdown、LED消灯、充電起動後の再OFF |
| `mods/breath/cry.ts` | 鳴き声の再生制御 |
| `mods/breath/liveliness.ts` | 視線・深呼吸・murmur などの生存感エンジン |
| `mods/breath/mic.ts` | 音声内容を保存しないマイク観測とイベント検出 |
| `mods/breath/param-store.ts` | パラメータの検証と Preference 永続化 |
| `mods/breath/status-bar.ts` | 画面上端からの下スワイプで開く時刻・バッテリー表示 |
| `mods/breath/settings-bar.ts` | 画面下端からの上スワイプで開く全画面2層設定（音量・画面・LED・2次元感情） |
| `mods/breath/dev/` | UDP ログ、状態取得、OTA、IP 発見などの Wi-Fi 開発機能 |
| `mods/breath/touch-debug.ts` | 未接続のタッチデバッグ用モジュール |

### スクリプトとツール

| パス | 内容 |
|---|---|
| `scripts/ota-deploy.sh` | Wi-Fi OTA のビルド・転送・反映確認 |
| `scripts/policy-deploy.sh` | policy MOD のrelease build・Wi-Fi更新・無効化・反映確認 |
| `scripts/logs.sh` | UDP ログ受信（port 8686）。第2引数でJSONL保存先を指定できる |
| `scripts/stackchan-ip.sh` | UDP ビーコンからデバイス IP を発見（port 8687） |
| `scripts/mic-monitor.sh` | マイクレベルの UDP モニター（port 8688） |
| `tools/cry/synth.py` | 鳴き声アセット生成ツール |

breath 用 deploy マニフェストは `stack-chan/firmware/stackchan/manifest_breath_deploy.json`、MOD 書き込みラッパーは `stack-chan/firmware/scripts/mod-cores3.sh` に置く。

## 実機への反映

通常はリポジトリルートで OTA を実行する。

```bash
overlay/scripts/ota-deploy.sh
```

初回または OTA が使えない場合だけ、`stack-chan/firmware/` で `npm run build:breath:m5stackchan-cores3` の後に `npm run deploy:breath:m5stackchan-cores3` を実行する。通常 StackChan 用の `deploy:m5stackchan-cores3` と MOD パーティション単体の書き込みは breath の更新に使わない。

詳細は [breath ファームウェア開発・実機運用ガイド](./docs/my-cores3/06-breath-firmware.md) を参照する。

## upstream 更新後

```bash
git -C stack-chan fetch upstream
git -C stack-chan merge upstream/develop   # breath ブランチ上で
# ビルド確認（stack-chan/firmware で npm run build:breath:m5stackchan-cores3）
git -C stack-chan push origin breath
```

push 後は breathing 側で `stack-chan` の gitlink 更新をコミットする。commit と push はユーザーが明示した場合だけ行う。詳細は [AGENTS.md](../AGENTS.md) の「fork ブランチ運用」を参照する。
