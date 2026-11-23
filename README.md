# Glyph-on

Glyph-onはWindowsとmacOS向けの常駐ランチャーです。ホットキーでAltarを開き、登録したアプリ、ファイル、フォルダ、URL、上級コマンドをGlyphとして起動します。Glyphは矩形グリッドに配置し、Tabletで切り替えます。

Glyph-on is a desktop launcher for Windows and macOS. Open Altar with a global shortcut and launch apps, files, folders, URLs, and advanced commands from a configurable grid.

## 開発版を試す / Run from source

Node.js 22.12以上が必要です。初回はnpmとElectronの実行ファイルを取得します。起動後の登録・編集・ローカル起動はオフラインで動作します。

```console
npm ci
npm start
npm test
```

- Windowsの既定の呼び出しは **Ctrl + Alt + Space**、macOSは **Option + Space**。競合する場合は、トレイまたはメニューバーから設定を開きます。
- 「＋」から登録するか、空スロットへ項目をドロップします。ExplorerやFinder側でドラッグを始める前に、Altarを編集モードにすると表示を維持できます。右クリックまたは **Shift + F10** で編集メニューを開きます。
- 旧版の `glyphon.config.json` は **設定 → データ → 旧版設定を移行** で確認・移行できます。三角形の配置情報は未配置一覧に保持します。
- 上級コマンドは **設定 → 動作** で有効にできます。環境変数名を保存し、実行時にGlyph-onのプロセス環境から該当する値を取得します。

## 配布 / Distribution

開発用の展開済みビルドは `npm run pack` で作成できます。正式版は `npm run dist:release` で生成します。Windowsは一般ユーザー向けNSIS、macOSはDeveloper ID署名・公証付きDMGと更新用ZIPを使う構成です。正式配布には発行者の証明書と実機検収が必要です。

- Windowsはインストーラーを実行し、設定アプリの「インストールされているアプリ」から削除します。アンインストーラーで個人設定を残すか選択できます。
- macOSはDMGを開き、Glyph-onをApplicationsへコピーします。設定の「ヘルプと情報 → アンインストールの準備」で設定を残すか選び、表示されたアプリをFinderでゴミ箱へ移動します。
- 更新確認は設定の「ヘルプと情報」から手動で開始します。対応する署名済み配布版で更新内容を確認してから適用できます。

データ形式については [設定ファイル形式](docs/settings-format.md)、ビルドと検収については [リリース手順](docs/release.md) を参照してください。

[プライバシー](PRIVACY.md) · [ライセンス](LICENSE) · [第三者ライセンス](THIRD-PARTY.md) · [セキュリティ報告](SECURITY.md) · [変更履歴](CHANGELOG.md)
