# Glyph-onの設定ファイル形式

UTF-8のJSONです。エクスポートの外側は `{ "format": "glyph-on", "version": 1, "settings": { … } }` です。内側の `settings` は保存ファイル `settings.json` と同じ構造で、`schemaVersion` は `2` です。インポートはこの外側の形式、内側だけの設定ファイル、旧版の `schemaVersion: 1` を受け付けます。ファイルの上限は24 MBです。

## schemaVersion 2

- `layout` は整数の `rows` / `columns`（各1〜8）と `size`（`small` / `medium` / `large`）です。
- `tablets` は表示順に並ぶ1件以上の配列です。各Tabletは文字列の `id` / `name` と、行優先順に並ぶ `slots` を持ちます。`slots` の長さは `rows × columns` で、空きは `null` です。
- `overflow` の各項目は `glyph`、出所の `tabletId` / `tabletName`、0始まりの `slot`（不明なら `-1`）、`layout`（`grid` / `triangle`）を持ちます。旧三角形には `edge`（3〜7）が付きます。
- Glyphは `id`、`type`（`app` / `file` / `folder` / `url` / `command`）、`name`、`target`、`description`、`args`（文字列配列）、`cwd`、`envNames`（環境変数名の配列）、`shell`（`system` / `powershell` / `process`）、`confirm`、`disabled`、`icon` を持ちます。 `icon.kind` は `auto`、`preset`、`image` のいずれかです。内蔵アイコンの `value` は `app`、`file`、`folder`、`url`、`command`、`star`、`spark`、`code`、`music` です。画像を含める場合はPNGのdata URLを格納します。
- `settings` には外観の `language`、`theme`、`background`、`accent`、`opacity`、`radius`、`gap`、`iconSize`、`labels`、`reducedMotion` と、表示の `anchor`、`marginTop`、`marginRight`、`monitor`、`monitorId`、`floatingPosition` が入ります。動作は `dismissOutside`、`closeAfterRun`、`floating`、`wheel`、`startup`、`advanced`、`onboarded` の真偽値です。`shortcuts` は `toggle`、`previous`、`next` を持ち、空文字はOS既定の割り当てを表します。未指定の設定には現在の既定値を適用します。

インポートしたアプリとコマンドは、参照先をレビューして編集画面で有効化するまで実行できません。「既存設定に追加」では既存の設定を保持し、追加ページの名前が重複する場合は末尾に番号を付けます。「設定を全置換」では事前の設定をバックアップし、自動起動の選択を保持します。画像を同梱しないエクスポートでは画像指定を自動アイコンに置き換えます。

旧版の環境変数の値は移行対象から外れます。Glyph名、パス、コマンド本文や引数はデータに含まれます。
