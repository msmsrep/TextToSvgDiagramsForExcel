# Text-to-SVG Diagrams for Excel

[English](./readme.md) | [日本語](./readme.ja.md)


Mermaid記法でダイアグラムを作成し、Excelのシートに画像として挿入するOfficeアドインです。

テキストベースの記法でフローチャート・シーケンス図・ER図などを素早く描き、PNG/JPEG/SVG画像として現在のシートに貼り付けられます。
ローカル完結処理のため、入力内容が外部に送信されることはありません。

紹介ページと導入方法: https://msmsrep.github.io/TextToSvgDiagramsForExcel/

Mermaid プロジェクトとは関係のない非公式のツールです。旧名は「Mermaid for Excel」です。旧名の版からの移行は [docs/migration.md](./docs/migration.md) を参照してください。

## 主な機能

- **リアルタイムプレビュー** — Mermaid記法を入力すると、タスクペイン内で自動的にダイアグラムが描画されます。構文エラーのときは入力欄の該当行を強調し、[Go to line N] でその行へ移動できます
- **Excelへの挿入** — プレビューした画像をワンクリックでアクティブセルの位置に挿入します
- **再編集** — 挿入した図の Mermaid コードは代替テキストに保存され、シート上で図を選択する（または [Diagram] から選ぶ）とコードが読み込まれ、編集・差し替えできます。入力欄に未保存のコードがあるときは、置き換える前に確認します
- **Diagrams タブ** — 新しい図の作成・挿入・ダウンロードはリボンの「Diagrams」タブから行えます。タスクペインは入力欄・プレビュー・出力設定だけのすっきりした構成です
- **テンプレート** — 「Diagrams」→「Template」で図の種類を選ぶと、短いひな形（フローチャート・シーケンス図・クラス図・状態遷移図・ER 図・ガントチャート・円グラフ・マインドマップ・タイムライン）から書き始められます
- **選択セルからコード生成** — 表を選択して「Diagrams」→「From cells」で種類を選ぶと、フローチャート（`親 | 子 | ラベル`）・ガントチャート（`タスク | 開始日 | 終了日または日数 | セクション`）・円グラフ（`項目 | 値`）のコードを作ります
- **PNG/JPEG/SVG出力対応** — 保存形式を選択してダウンロードすることもできます
- **出力サイズの指定** — 大きさを倍率（50〜200%）または幅（pt）で指定できます。図を差し替えるときは [Keep current size]（既定でオン）でシート上の幅を保ちます
- **編集できる図形（試験的）** — フローチャートを Excel の図形とコネクタで挿入する `Shapes (editable)` と、Excel の「図形に変換」向けに整えた SVG を挿入する `SVG (for shape conversion)` を選べます。アドインを持たない人も図を編集できます
- **多様なダイアグラム種別** — フローチャート、シーケンス図、クラス図、ER図、ガントチャートなど[Mermaid](https://github.com/mermaid-js/mermaid)がサポートするすべての記法が利用可能です
- **プライバシー保護** — すべての処理はタスクペイン内で完結し、外部サーバーへのデータ送信はありません

## 構成

```
TextToSvgDiagramsForExcel/
  build.js                 ← esbuild ビルドスクリプト（build / dev / watch / serve / engine）
  manifest.xml             ← Office アドインマニフェスト
  package.json
  tsconfig.json
  assets/                  ← アイコン置き場
  scripts/sync-version.js  ← package.json のバージョンをマニフェスト・インストーラ・デスクトップ版に反映
  site/index.html          ← GitHub Pages のトップに置く紹介ページ（導入方法を含む）
  src/core/                ← アドインとデスクトップ版で共通のコード
    render.ts              ← Mermaid のレンダリング
    image.ts               ← SVG → PNG/JPEG 変換
    officeSvg.ts           ← Excel の「図形に変換」向けの SVG 変換
    flowchartModel.ts      ← フローチャートの SVG → Excel 図形モデル
    svgUtil.ts             ← 行列・色の共通処理
    tableToMermaid.ts      ← 表 → Mermaid コードの生成
    templates.ts           ← 図の種類ごとのひな形
    errorLine.ts           ← 描画エラーを入力欄の行に対応させる
    messages.ts            ← 共通のメッセージ（英語・日本語）
  src/taskpane/            ← アドイン固有
    taskpane.html / .css
    taskpane.ts            ← UI の結線（エントリポイント）
    excelShapes.ts         ← Excel 図形の挿入・差し替え・一覧取得
    excelTable.ts          ← 選択セルの読み込み
    ribbon.ts              ← Diagrams タブのコマンド（共有ランタイム）
    splitter.ts            ← 入力欄とプレビューのスプリッタ
    lineHighlight.ts       ← 入力欄の行の強調表示
  src/engine/              ← デスクトップ版の描画エンジン（WebView2 で動くページ）
  desktop/                 ← デスクトップ版（WPF）。docs/desktop-design.md を参照
    src/                   ← アプリ本体
    tests/                 ← xUnit のテスト
    package/               ← MSIX のマニフェスト・画像・作成スクリプト（pack.ps1）
  samples/                 ← 動作確認用のサンプルブック
  test/                    ← Vitest のテスト（Office.js・mermaid・Canvas はモック）
  dist/                    ← ビルド成果物（コミットしない。GitHub Actions でデプロイ）
```

## セットアップ

```bash
cd TextToSvgDiagramsForExcel
npm install

# 開発用 HTTPS 証明書のインストール（初回のみ・管理者権限が必要）
npx office-addin-dev-certs install
```

## 開発サーバの起動

```bash
npm run dev-server
# → https://localhost:3000/taskpane.html
```

サイドロードしてデバッグする場合は、開発サーバを起動したまま `npm start` を実行します。

## Excel へのアドイン登録

1. Excel を起動
2. **[挿入]** → **[アドイン]** → **[個人用アドイン]** → **[アドインをアップロード]**
3. `dist/manifest.xml` を選択（開発サーバを使う場合は `npm run build:dev` 後のもの）

ホームタブに **[Open Text-to-SVG]** ボタンが追加されます。

## スクリプト

| コマンド | 説明 |
|---|---|
| `npm run dev-server` | ビルド + HTTPS サーバ起動（ポート 3000） |
| `npm start` | Excel にサイドロードしてデバッグ起動 |
| `npm stop` | デバッグ終了 |
| `npm run build` | `dist/` への一回限りのビルド（本番 URL のマニフェスト） |
| `npm run build:dev` | `dist/` への一回限りのビルド（`https://localhost:3000` のマニフェスト） |
| `npm run build:engine` | デスクトップ版の描画エンジンを `desktop/src/TextToSvgDiagramsForExcel.Desktop/web/` にビルド |
| `npm run watch` | ファイル変更を監視して自動リビルド |
| `npm run typecheck` | `tsc` でソースとテストを型チェック |
| `npm test` | Vitest でテストを実行 |
| `npm run test:watch` | テストを監視モードで実行 |
| `npm version <patch\|minor\|major>` | バージョンを上げて `manifest.xml`・インストーラ・デスクトップ版（csproj と `Package.appxmanifest`）に反映 |

## デスクトップ版（WPF）

必要なもの: .NET 10 SDK、Node.js（ビルド時に描画エンジンを作るため）、[winapp CLI](https://learn.microsoft.com/windows/apps/dev-tools/winapp-cli)（`winget install Microsoft.winappcli`。MSIX を作るときだけ）。

### ビルド・実行・テスト

```bash
dotnet build desktop/TextToSvgDiagramsForExcel.Desktop.sln
dotnet test desktop/TextToSvgDiagramsForExcel.Desktop.sln
```

ビルドの中で `npm run build:engine` が実行されます。実行ファイルは `desktop/src/TextToSvgDiagramsForExcel.Desktop/bin/Debug/net10.0-windows10.0.19041.0/win-x64/TextToSvgDiagramsForExcel.exe` です（MSIX 外で動かすときは、設定などを `%LOCALAPPDATA%\TextToSvgDiagramsForExcel` に置きます）。

### MSIX の作成

MSIX は必ず自己署名証明書で署名します。証明書のサブジェクトはストアの Publisher と同じで、リリース用と開発用の両方に使います（詳しくは `docs/desktop-design.md` §9）。

**1. 証明書を作る**（最初に 1 回。有効期限が切れたら作り直す）

```bash
winapp cert generate --manifest desktop/package/Package.appxmanifest --output desktop/package/cert/TextToSvgDiagramsForExcel.pfx --password <パスワード> --export-cer --valid-days 365
```

- 既定のパスワード（`password`）は公開されている値なので使わないでください。
- `desktop/package/cert/` と `.pfx` / `.cer` はコミットしません（`.gitignore` 済み）。

**2. パスワードを環境変数に保存する**（任意。毎回の入力を省くため）

```powershell
[Environment]::SetEnvironmentVariable('MSIX_CERT_PASSWORD', '<パスワード>', 'User')
```

保存したあとは、新しいターミナルを開いてから使ってください。

**3. MSIX を作る**（PowerShell）

```powershell
# 開発用（Identity が ...Dev。Debug ビルドで、WebView2 の開発者ツールを使える）
./desktop/package/pack.ps1 -Variant Dev

# リリース用（ストアに提出するもの）
./desktop/package/pack.ps1 -Variant Release
```

- 環境変数を使わないときは `-CertPassword <パスワード>` を付けます。
- 証明書が別の場所にあるときは `-CertPath <.pfx のパス>` を付けます。
- 1 つのアーキテクチャだけ作るときは `-Arch x64`（または `arm64`）を付けます。バンドルではなく `.msix` になります。
- 出力先は `desktop/out/<Dev|Release>/` で、ファイル名は `TextToSvgDiagramsForExcel[.Dev]_<版>.msixbundle`（x64 と Arm64 をまとめたもの）です。
- 開発用は Identity が別なので、ストア版と同じ端末に同時に入れられます。

### テスト端末へのインストール

**1. 証明書を信頼する**（端末ごとに 1 回。管理者として実行）

```bash
winapp cert install desktop/package/cert/TextToSvgDiagramsForExcel.cer
```

winapp がない端末では、`.cer` を「ローカル コンピューター」の「信頼されたユーザー」にインポートします。開発用の PC では、証明書を作るときに `cert generate` に `--install` を付けてもかまいません。

**2. インストールする**

```powershell
Add-AppxPackage desktop/out/Dev/TextToSvgDiagramsForExcel.Dev_1.5.0.0.msixbundle
```

- `.msixbundle` をダブルクリックしてもインストールできます。
- アンインストールは「設定」→「アプリ」から行います。
- `.msixbundle` は利用者に配布しません。配布は Microsoft Store だけで行います。

### ストアへの提出

リリース用を作って提出するには、`-Publish` を付けます。

```powershell
./desktop/package/pack.ps1 -Variant Release -Publish
```

最初の提出と掲載情報の登録は Partner Center で行います。

### CI

`.github/workflows/desktop.yml` がビルドとテストを行います。リポジトリのシークレットに `MSIX_CERT_BASE64`（`.pfx` を Base64 にしたもの）と `MSIX_CERT_PASSWORD` を置くと、開発用の `.msixbundle` も作って成果物として残します。`.pfx` の Base64 は次のコマンドで作れます。

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('desktop/package/cert/TextToSvgDiagramsForExcel.pfx')) | Set-Clipboard
```

## アイコンの差し替え

`assets/icon-{16,32,64,80}.png` を任意の PNG 画像に置き換えてください。 


## ライセンス

このプロジェクトは [MIT License](LICENSE.txt)のもとで公開しています。

### サードパーティライセンス

このソフトウェアは [mermaid](https://github.com/mermaid-js/mermaid)（MIT License）を使用しています。

## プライバシーポリシー

最終更新日：2026年10月22日

### データの収集について

Text-to-SVG Diagrams for Excelは、ユーザーの個人情報およびデータを**一切収集しません**。

### 処理の仕組み

- ユーザーが入力したMermaid記法のテキストは、エクセルの**タスクペイン内のみで処理**されます
- ダイアグラムのレンダリングはローカルで完結し、外部サーバーへのデータ送信は行いません
- Excelシートへの画像挿入も、Microsoft Office JavaScript API を通じてローカルで行われます
- 表からコードを生成するときに読み込む選択セルの値は、タスクペイン内でコードの生成にだけ使い、保存や外部への送信は行いません

### 外部サービスへのアクセス

本アドインは、アドイン本体（HTML/JavaScript）をホスティングサーバーから読み込みます。  
この通信にはユーザーのデータは含まれません。

### Cookieおよびトラッキング

本アドインはCookie、ローカルストレージ、トラッキング技術を使用しません。

## お問い合わせ

プライバシー・その他ご質問は、[GitHub Issues](https://github.com/msmsrep/TextToSvgDiagramsForExcel/issues) までお寄せください。
