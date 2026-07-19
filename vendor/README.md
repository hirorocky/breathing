# Vendored Moddable SDK

`moddable/` はModdable SDKのsubmoduleです。C2の起動前native hookを同じSDKソースから再現可能にビルドするために固定しています。

- upstream: https://github.com/Moddable-OpenSource/moddable
- pinned commit: `fa3e9cd4be4c443fec62966ec26ecbcb46693b55`
- 主なライセンス: Moddable RuntimeはLGPL-3.0-or-later。ファイルごとの著作権表示とライセンス条件を優先する
- Apache-2.0由来コードのNOTICEは`moddable/licenses/NOTICE`に含まれる

SDK本体の改変ファイルには、原著作権表示を残したうえでbreathingの変更内容を明示する。

現在の改変:

- `xs/platforms/esp/xsHost.c`: policy candidateの起動前適用と失敗状態
- `build/devices/esp32/targets/m5stack_cores3/setup-target.js`: `breathHostMod`時に標準`bflatmajor.maud` startup soundを再生しない
