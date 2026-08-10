# Birthday Concert Card

GitHub Pagesで公開できる、スマートフォン縦型のコンサート風バースデーカードです。

## 使い方

1. `customize/index.html` を開きます。
2. To / Message / From を入力します。
3. Generate URLで共有URLを生成するか、Open previewでカードを確認します。

入力内容は `#d=Base64URL(JSON)` としてURL内に保存され、サーバーには送信されません。パラメータなしの `index.html` ではサンプル文が表示されます。

## 構成

- `index.html` — カード本体
- `style.css` — レイアウト、フェード、モバイル表示
- `script.js` — シーン、動画・音声、Replay、Sound、URLデータ、文字縮小
- `customize/index.html` — 入力、プレビュー、URL生成・コピー
- `assets/` — 実際にカードが使用する画像・動画・音声・SVG

## 公開

このフォルダの内容をGitHubリポジトリへ配置し、GitHub Pagesを有効にしてください。
