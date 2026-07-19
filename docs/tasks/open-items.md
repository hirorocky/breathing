# 未完の作業

[concept](../concept/) の「稀で弱い」「非指示」「受動」「評価しない」を守りながら、生きている気配を実機で調整し、同席観察へ進む。

現行ファームウェアの構成、API、書き込み、制約は [breath ファームウェアガイド](../../overlay/docs/my-cores3/06-breath-firmware.md) を正とする。表現の判断には [ELEGNT 表現設計](elegnt-expression-design.md) と [感情空間の評価シナリオ](emotion-space-scenarios.md) を使う。

## 実装

- [ ] **サーボ静音**
  - 目の動きに対して首を遅く、小さく追従させる
  - READ に頼らず命令角を保持し、反応や姿勢変化で yaw を不意に中央へ戻さない
  - 定期的な READ タイムアウトログを抑える
- [ ] **LED の物理配置補正**
  - `POST /led/sweep` で 0〜11 の点灯順と2本のバーの向きを確認する
  - 結果を `led.ts` の layout に反映する
- [ ] **voice への一瞥**
  - clap より長い間、短い保持、低い確率にする
  - 連続音は方向推定せず、正面または直近の破裂音方向を使う
- [ ] **場に応じた表現量**
  - silence 継続時に liveliness の表現量を下げる
  - voice がある間は控えめに上げる
- [ ] **深呼吸の予備動作**
  - 深呼吸の直前に小さな沈みを入れる
- [ ] **うたた寝**
  - 静けさと快が続くと目を閉じ、まれに薄く開く
- [ ] **物理タッチの配線**
  - 顔領域のタップを emotion の touch 入力へ接続する
  - 上下端のバー操作と干渉させず、全画面オーバーレイを使わない

## 実機評価

- [ ] サーボ静音後も駆動音が場を壊すか。壊す場合は姿勢系を既定で無効にする
- [ ] 一瞥の間、保持、戻り、startle 音の頻度を評価する
- [ ] LED の色相、点灯数による暗さ、呼吸エンベロープを物理配置補正後に評価する
- [ ] 物理タッチ接続後、音・LED・感情変化が評価的な返答に見えないか確認する
- [ ] 再起動後に明るさと音量が保持されることを確認する
- [ ] [感情空間のシナリオ](emotion-space-scenarios.md)を取捨選択し、採用するものだけを調整する

## デプロイ高速化

- [x] **Phase A: フル OTA の計測と書き込みバッファリング**
  - 約 4.11 MB の転送は 154〜292 秒。16 KB バッファ時は全 249 秒のうち Flash 書き込みが 33.6 秒で、受信待ちが支配的だった
  - 16 KB バッファは書き込み回数を 890 回から 251 回へ減らしたが、総時間を改善せず常駐 RAM も使うため採用しない
  - build、ホスト転送、実機の受信・Flash 書き込みを `ota-deploy.sh` とレスポンスヘッダーで継続計測できるようにした
  - 正常更新と通信切断後の旧ファーム継続を実機確認した。認証、サイズ不一致、書き込み失敗時は既存の cancel 経路を維持する
- [x] **Phase B: breath 専用の軽量 manifest**
  - `manifest_breath_lean.json` と `main-breath.ts` に breath が使うモジュール、ドライバー、リソースだけを分離した
  - 約 2.81 MB（Phase A の約 4.11 MB から約 32% 削減）。実測はビルド8秒、転送29秒、再起動確認6秒
  - `/status` の `bootError: null`、マイクの48 kHz動作、LED・姿勢API、設定バー接続、OTA buildId照合を確認した
  - 顔、上下スワイプ、音、LED、サーボの実機表示・動作を確認した
- [x] **Phase C: TypeScript policy の部分更新（MOD OTA）**
  - 頻繁に変更するハードウェア非依存の TypeScript policy をホストファームウェアから分離し、XSA にコンパイルして更新する
  - MOD パーティションへの転送、互換 API・build ID の確認、起動失敗時の内蔵実装へのフォールバックを実装する
  - 旧 MOD の保持または自動無効化を含む復旧手段を用意し、ホスト変更時はフル OTA を使う
  - [x] **C0:** ハードウェア非依存のpolicy MODを作り、release XSA 1,012 bytes、API v1の互換import、`active`/`rejected`/`builtin`フォールバックを実機確認した
  - [x] **C1:** 認証付き `PUT/DELETE /policy`、API・schema・host API範囲検証、非破壊disableを実装した。更新はdisabled再起動後にbodyを書き、chunk readback後にXSA headerを最後にcommitする。release XSA 1,331 bytesで正常更新・無効化・再有効化を確認し、401認証拒否、409互換性拒否、400不正XSA拒否、転送中断後のbuiltin再起動も実機確認した
  - [x] **C2:** candidate領域と端末側healthy判定を実装する。backup領域・自動rollbackは持たず、復旧はユーザーがUSBまたはホストOTAで行う。更新失敗時は`failed`状態・candidateのbuildId・失敗理由を永続化し、StackChan画面に「policy更新失敗」を明示する。XSAの読み込み前に判定できるnative層で、候補選択・失敗検出・builtin/error画面への切替を行う
    - [x] Moddable ESPホスト層に起動前native hookを追加する
    - [x] candidateをactiveへ適用せず検証する書込み経路を追加する
    - [x] failed状態を永続化し、builtin/error画面へ切り替える
    - [x] healthy確定後にcandidateを確定状態へ更新する
- [x] **Phase D: 圧縮 OTA・差分 OTA の採否判断**
  - Phase A〜C の計測後に、転送と Flash 書き込みのどちらが支配的かを再評価する
  - 圧縮率、展開時の RAM・CPU、差分生成と検証、失敗時の復旧コストを比較し、実装する価値がある方式だけを採用する
  - 現行 release XS バイナリ（2,667,008 bytes）は gzip で 1,223,251 bytes（54.1%減）になるが、圧縮転送には native 側のストリーム展開・検証と追加の失敗経路が必要になる。Phase A で Flash 書き込み（約22〜34秒）より受信待ちが支配的だったため、現時点では採用しない
  - 差分 OTA は旧イメージの読み出し・差分生成・native適用・整合性検証が必要で、candidate XSA の更新失敗表示と復旧経路を複雑化する。フル OTA の cancel と buildId 照合で目的を満たすため、現時点では採用しない
  - 採用方式は Phase B の軽量ホストを使う通常のフル OTA とする。圧縮・差分は転送時間が再び支配的になり、復旧コストを許容できる計測が得られた時点で再評価する
- [x] **nativeデプロイコマンドの短縮**
  - `overlay/scripts/native-deploy.sh` に vendor版Moddable SDK、`mcconfig`、USBポート指定、check、生成キャッシュ削除、build→生成物検証→deployを集約した
  - 通常のWi-Fi OTA（`overlay/scripts/ota-deploy.sh`）と、native変更時のUSBフルデプロイをスクリプト単位で分離した

## 同席観察

- [ ] 全要素の頻度を「沈黙が正しい」に照らして最終調整する
- [ ] スピーカーを有効にする価値が存在負荷を上回るか判断する
- [ ] 同室 2〜10 人で観察する
- [ ] ユーザーの口述と合意に基づき journal を書く

## 優先度の低い候補

- [ ] IMU の shake だけを使う反応を、既定無効で試す
- [ ] サーボ READ がタイムアウトする原因を調べる
- [ ] liveliness のパラメータ永続化を `param-store.ts` に統合する
- [ ] OTA ロールバック、ログのリングバッファ、OTA 中の呼吸停止を検討する
- [ ] upstream に適用可能な修正を個別に整理する
