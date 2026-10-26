# Text-to-SVG Diagrams for Excel デスクトップ版（WPF）設計書

Office アドイン（[specification.md](./specification.md)、以下「アドイン」）と同等の機能を、Windows のデスクトップアプリ（WPF）として提供するための設計。アドインで作った図をデスクトップ版で編集でき、その逆もできること（互換）を前提とする。

- 対象: アドイン 1.5.0 相当の機能
- 作成日: 2026-10-26
- 状態: 段階 1〜4 と段階 5 のデスクトップ版部分を実装済み（§13）。「要検証」と書いた箇所のうち確かめたものは §13.2 に結果を記す。結果によってはアドイン側も直す（§10）

---

## 1. 目的と範囲

### 1.1 目的

- アドインを導入できない環境（共有フォルダカタログを作れない、アドインの利用が制限されているなど）でも、Mermaid の図を Excel に挿入・差し替え・再編集できるようにする。
- Microsoft Store で配布し、インストールと更新を簡単にする。
- アドインとデスクトップ版のどちらで作った図も、もう一方で読み込んで差し替えられるようにする。

### 1.2 範囲

アドインの機能（仕様書 §2〜§4）をすべて対象にする。

| アドインの機能 | デスクトップ版 | 備考 |
|---|---|---|
| プレビュー描画（§4.2） | ○ | 同じ mermaid を WebView2 で動かす |
| シート図形一覧・読み込み（§4.3） | ○ | シート上での図形の選択はポーリングで検知する（§5.4） |
| 挿入・差し替え（§4.4）5 形式 | ○ | COM で挿入する（§5.5） |
| ダウンロード（§4.5） | ○ | 「名前を付けて保存」ダイアログにする |
| 画像変換・図形変換向け SVG・図形モデル（§4.6, §4.8, §4.9） | ○ | アドインの TS をそのまま使う |
| 選択セルからの生成（§4.10） | ○ | 1904 年日付システムに対応する（§5.6） |
| エラー行の強調（§4.11） | ○ | 行の特定は TS、強調はエディタ側 |
| 出力サイズ（§4.12） | ○ | 設定を保存できる（§7） |
| テンプレート（§4.13） | ○ | — |
| リボン（§2.1） | メニュー・ツールバーに置き換える | — |

追加: 英語と日本語の画面（§6.3）。

範囲外: Excel 以外のホスト（Word / PowerPoint）への COM 挿入、Mac、Excel Online、x86（32 ビット）、Microsoft Store を使えない環境への配布（§9.4）。

---

## 2. 方針

| 項目 | 決定 | 理由 |
|---|---|---|
| アプリ名 | `Text-to-SVG Diagrams for Excel`（アドインと同じ名前。ストアの予約名） | 同じ製品として、紹介ページでアドインと並べて案内する |
| UI | WPF（.NET 10、x64 と Arm64） | 要件どおり |
| 描画エンジン | WebView2 上の mermaid（アプリに同梱、オフライン） | mermaid は JavaScript でしか動かず、.NET のみの同等品はない。§4.8 / §4.9 の処理はブラウザの DOM（計算済みスタイル・`getBBox` など）を必要とする |
| 共通ロジック | アドインの TS を共通化してそのまま使う | 図の見た目・変換結果をアドインと一致させる。テストも共有できる |
| Excel 連携 | COM。アクティブな Excel に接続する（§5.1） | Office.js はアドイン内でしか使えない |
| 互換の仕組み | 図形の代替テキスト（タイトル `Mermaid Diagram`、説明に Mermaid コード）を両方で同じに扱う | アドインの唯一の永続データ（仕様書 §5）に合わせる |
| 配布 | Microsoft Store のみ。MSIX（x64 / Arm64 のバンドル）。自己署名証明書で署名し、ストアに提出するリリース用と、開発中のテストに使う開発用（Identity が別）の 2 種類を作る。作成・署名・提出には winapp CLI を使う（§9） | ストアが Microsoft の署名に置き換えるため、コード署名証明書は買わない |
| 画面の言語 | 英語と日本語（§6.3） | — |
| リポジトリ | アドインと同じリポジトリに置く | 共通 TS を 1 か所で管理し、バージョンをそろえる |

---

## 3. 全体構成

```
┌──────────────────────── WPF アプリ (C#) ─────────────────────────┐
│  MainWindow (MVVM)                                               │
│   ├ メニュー / ツールバー   … リボン相当（Template / From cells /   │
│   │                            Insert as / Save as）              │
│   ├ 図形選択・確認バー      … §3 #1, #1a                           │
│   ├ エディタ (AvalonEdit)   … 入力欄・エラー行の強調               │
│   ├ プレビュー (WebView2) ──┐                                      │
│   └ 出力設定・挿入ボタン     │ JSON メッセージ (§4)                 │
│                              ▼                                    │
│  EngineClient ◀────▶ engine.html / engine.js (共通 TS + mermaid)   │
│                                                                   │
│  ExcelLocator ──▶ アクティブな Excel のウィンドウ → Application      │
│  ExcelGateway (COM) ──▶ Excel.Application                         │
└───────────────────────────────────────────────────────────────────┘
```

| 部品 | 言語 | 役割 |
|---|---|---|
| `MainViewModel` | C# | 画面の状態（未保存判定、差し替え先、サイズ、形式など）。アドインの `taskpane.ts` の状態管理に相当 |
| `EngineClient` | C# | WebView2 との要求・応答。要求 ID で対応付け、タイムアウトを持つ |
| `engine.ts` | TS | WebView2 側のエントリ。共通 TS を呼び、結果を返す。プレビュー SVG の表示も行う |
| `ExcelLocator` | C# | 操作対象の Excel を決める（§5.1） |
| `IExcelGateway` / `ExcelGateway` | C# | Excel 操作。アドインの `excelShapes.ts` / `excelTable.ts` に相当 |
| `ConnectionSite` | C# | `flowchartModel.ts` の `connectionSite` の移植（§5.5.4） |
| `AppPaths` | C# | 一時ファイル・設定・WebView2 データの置き場所。MSIX で動くときとそうでないときで切り替える（§7、§9.3） |

プレビューの WebView2 がそのまま描画エンジンを兼ねる。§4.8 / §4.9 はプレビュー中の SVG の DOM を読むため、描画と変換を同じページで行う必要がある。

---

## 4. 描画エンジン（WebView2）

### 4.1 読み込み

- `engine.html` / `engine.js` などをアプリの `web/` に置き、`SetVirtualHostNameToFolderMapping("app.textsvg.example", web, CoreWebView2HostResourceAccessKind.Deny)` で `https://app.textsvg.example/engine.html` として開く。ホスト名は WebView2 の推奨に従い `.example` にする（`.local` は名前解決で遅れることがある）。
- 外部への通信はしない。`NavigationStarting` で上記ホスト以外への遷移を、`NewWindowRequested` で新しいウィンドウを止める。CSP は `default-src 'self'; connect-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'` を基本にする（`svgToRaster` が data URL の SVG を `Image` で読み、mermaid がインラインスタイルを使うため）。
- リリースビルドでは開発者ツール・既定のコンテキストメニュー・ズームを無効にする。
- mermaid の初期化設定はアドインと同じ（仕様書 §4.1）。`render.ts` の `initMermaid` をそのまま使う。
- WebView2 ランタイムがない場合（Windows 10 の一部）は、起動時に `CoreWebView2Environment.GetAvailableBrowserVersionString` で検出し、ランタイムの入手先を案内するダイアログを出して終了する。MSIX からはランタイムのインストーラを実行できないため。

### 4.2 メッセージ形式

C# → JS は `PostWebMessageAsJson`、JS → C# は `window.chrome.webview.postMessage` を使う。

```jsonc
// 要求
{ "id": 12, "method": "render", "params": { "code": "graph LR\n A-->B" } }
// 成功
{ "id": 12, "result": { "width": 180, "height": 60 } }
// 失敗
{ "id": 12, "error": { "code": "render", "message": "Parse error on line 2: ...", "line": 2 } }
```

| method | params | result | 使う共通 TS |
|---|---|---|---|
| `init` | `locale`（`en` / `ja`） | — | メッセージの言語を決める（§6.3）。最初に 1 回呼ぶ |
| `render` | `code`, `seq` | `seq`、実寸 `width` / `height`（px、viewBox がなければ null）。プレビューに表示する | `renderMermaid`, `svgSize`。失敗時は `errorSourceLine` で `line` を付ける |
| `clear` | — | — | プレビューをヒント表示に戻す |
| `raster` | `seq`, `format`（png / jpeg）, `scale` | `base64`, `width`, `height` | `svgToRaster` |
| `svg` | `seq`, `scale` | `svg` | `serializeSvg` |
| `officeSvg` | `seq` | `svg`, `width`, `height` | `toOfficeSvg` |
| `shapeModel` | `seq`, `scale` | `ShapeModel`（JSON） | `getFlowchartData`（表示中の図のコード）, `extractFlowchart`, `scaleModel` |
| `fromTable` | `table`（`TableData`）, `kind` | `code` | `tableToMermaid` |
| `templates` | — | `{ id, name, code }[]` | `TEMPLATES` |

- `raster` / `svg` / `officeSvg` / `shapeModel` はプレビューに表示中の図（SVG とそのコード）を対象にする。`seq` は C# 側が最後に成功を受け取った `render` の番号で、表示中の図の番号と違えば `Diagram changed. Try again.` のエラーを返す（入力中に挿入した場合などに、別の図を挿入しないため）。表示中の図がなければ `Please render first`。`shapeModel` はコードを引数に取らず、表示中の図のコードを使う（SVG とコードの食い違いを防ぐ）。
- テンプレートと表からの生成もエンジンに置き、C# 側で二重に実装しない。
- エラーは `code`（メッセージの種類）と、`init` で決めた言語の `message` を返す。mermaid 自身のエラー文は英語のまま（§6.3）。
- 大きな画像の base64 はメッセージで送れる大きさ（Canvas 上限 4096 × 4096 の PNG で数 MB）に収まる。

### 4.3 競合制御

アドインと同じく、`render` ごとに C# 側で番号（`seq`）を採番し、最新でない応答は捨てる（仕様書 §4.2）。入力のたびに挿入・保存ボタンを無効にし、250ms のデバウンス後に `render` を送る。

プレビューの DOM を書き換えるのは JS 側のため、C# 側で応答を捨てるだけでは足りない（mermaid の描画は非同期で、前後して終わると古い図が表示される）。`engine.ts` も受け取った最大の `seq` を覚え、描画が終わった時点でそれより古ければ DOM に反映せず、`stale` のエラーを返す。表示中の図の `seq` とコードは `engine.ts` が持つ。

---

## 5. Excel 連携（COM）

### 5.1 接続先（アクティブな Excel）

Excel が複数起動していても、利用者が最後に使っていた Excel を対象にする。`GetActiveObject` は最初に登録されたインスタンスしか返さないため使わず、ウィンドウから Excel を取得する。

1. `EnumWindows` でトップレベルウィンドウを Z オーダー順（手前から）に調べ、表示中で最小化されていないクラス `XLMAIN` のウィンドウのうち最初のものを選ぶ。デスクトップ版のウィンドウが手前にあっても、その次に手前の Excel のウィンドウになる。最小化されていないものがなければ、最小化された `XLMAIN` のうち最も手前のものを選ぶ。
2. その子の `XLDESK` → `EXCEL7` を探し、`AccessibleObjectFromWindow(hwnd, OBJID_NATIVEOM, IID_IDispatch)` で `Excel.Window` を得る。
3. `EXCEL7` がない（ブックを開いていない）ときは「ブックを開いてください」と表示し、挿入を無効にする。
4. `XLMAIN` がひとつもないときは「Excel が見つかりません」と表示し、挿入・セルからの生成・図形一覧を無効にする。プレビューと保存は使える。Excel の起動はしない。
5. `AccessibleObjectFromWindow` が失敗したときは「Excel に接続できません（Excel を管理者として実行している場合は、通常の権限で起動し直してください）」と表示し、4 と同じ扱いにする。管理者として動く Excel には UIPI のため接続できない。

操作の対象は、2 で得た `Excel.Window`（以下「対象ウィンドウ」）とそのブック（`Window.Parent`）にする。シート・アクティブセル・選択は `Application.ActiveSheet` などではなく、対象ウィンドウの `ActiveSheet` / `ActiveCell` / `Selection` から取る。同じ Excel で複数のブックを開いていると、Excel が手前にない間は `Application.ActiveWorkbook` が対象ウィンドウのブックと一致するとは限らないため。

| 対象を決め直す場面 | 動作 |
|---|---|
| デスクトップ版のウィンドウがアクティブになったとき | 1〜5 を行い、対象のブックが変わっていれば図形一覧を読み込み直し、差し替え先を `(No diagram selected)` に戻す |
| 挿入・セルからの生成・図形一覧の読み込みの直前 | 1〜5 を行う。アクティブになったときと対象が変わっていれば同様に扱い、操作は新しい対象で行う（差し替えは中止して `Selected diagram no longer exists.` と同等のエラーにする） |
| ポーリング中（§5.4） | `GetForegroundWindow` が `XLMAIN` ならそのウィンドウを対象にする |

- 状態表示に接続中のブック名（対象ウィンドウのブックの `Name`）を出す。
- 接続後に Excel が終了した場合（`RPC_E_DISCONNECTED` 0x80010108 / `RPC_S_SERVER_UNAVAILABLE` 0x800706BA）は未接続に戻す。
- 利用者が Excel を閉じたことの検知は §5.2 の「参照の持ち方」による。
- 要検証: MSIX のパッケージ内のアプリ（full trust）から `AccessibleObjectFromWindow` と COM の呼び出しが通常どおり使えること。

### 5.2 COM の呼び出し

- COM は WPF の UI スレッド（STA）から呼ぶ。セル編集中などに Excel が呼び出しを拒否する（`RPC_E_CALL_REJECTED` 0x80010001）ため、`IMessageFilter` を登録して数秒まで再試行し、それでも失敗したら「Excel が操作を受け付けません（セルの編集中など）」を表示する。
- 再試行するのは利用者の操作（挿入・セルからの生成・図形一覧の読み込みなど）だけにする。ポーリング（§5.4）とイベントの処理中はフィルタが再試行せずにすぐ諦めるよう、呼び出し側でフラグを立てる。ポーリングのたびに UI スレッドが数秒止まることを防ぐため。

**参照の持ち方**: 外部から COM の参照が残っていると、利用者が Excel のウィンドウを閉じても Excel は非表示のまま終了しない。そこで参照を 2 種類に分ける。

| 種類 | 対象 | 解放 |
|---|---|---|
| 常時持つ参照 | `Application`、対象ウィンドウ、イベントの購読（§5.4） | 下の「解放する場面」で、イベントの購読を外してからまとめて解放する |
| 操作ごとの参照 | 1 つの操作の中で取ったシート・図形・範囲など | 操作の終わりにまとめて `Marshal.FinalReleaseComObject` する（ヘルパーを用意する） |

解放する場面:

- 接続先が別の Excel に変わったとき（§5.1）。
- 接続中の Excel の `XLMAIN` が消えたか非表示になったとき。デスクトップ版は 1 秒ごとに `IsWindow` / `IsWindowVisible` で調べる（Excel は外部から参照されたまま閉じられると、ウィンドウを非表示にして動き続けるため、非表示も閉じたものとみなす）。
- `RPC_E_DISCONNECTED` などで Excel の終了が分かったとき。
- デスクトップ版の終了時。

解放後は未接続として扱い、次に対象を決め直すとき（§5.1）に接続し直す。
- 相互運用は `Microsoft.Office.Interop.Excel`（PIA、`EmbedInteropTypes=true`）を使う。Office のバージョンに依存しないよう、使うのは Excel 2016 以降にあるメンバーだけにする。

### 5.3 識別情報（互換の要）

| アドイン（Office.js） | COM | 値 |
|---|---|---|
| `Shape.altTextTitle` | `Shape.Title` | `Mermaid Diagram` |
| `Shape.altTextDescription` | `Shape.AlternativeText` | Mermaid コード（前後の空白をトリム） |
| `Shape.name` | `Shape.Name` | 差し替え時に引き継ぐ |
| `Shape.id` | `Shape.ID` | 一覧の値。デスクトップ版の内部でのみ使う（アドインと ID を受け渡さない） |

一覧の対象とする図形の種類:

| Office.js の `type` | COM の `Shape.Type` |
|---|---|
| `Image` | `msoPicture`、`msoGraphic`（SVG） |
| `Group` | `msoGroup` |
| `GeometricShape` | `msoAutoShape` |

要検証: アドインが挿入した SVG とデスクトップ版が `AddPicture` で入れた SVG が、それぞれもう一方でどの種類になるか。同じ図が両方の一覧に出ない場合は、アドインの `DIAGRAM_SHAPE_TYPES` に必要な種類を加える（§10）。

**改行**: 代替テキストに書き込むコードの改行は `\n` にする（AvalonEdit の改行は `\r\n` のことがあるため、書き込む前にそろえる。アドインと同じ）。代替テキストから読んだコードは、`\r\n` と `\r` を `\n` にそろえてから入力欄に入れる。Excel が代替テキストの改行を `\r` などに変えても、未保存の判定（仕様書 §4.3）やエラー行の特定がずれないようにするため。アドインにも読み込み時の処理を加える（§10）。

### 5.4 シート図形一覧とシート上での選択（仕様書 §4.3）

- 対象・表示・選択状態の保持・読み込み失敗時の扱いはアドインと同じ。
- 再読み込みのきっかけ: 起動時、ドロップダウンを開いたとき、挿入後、`Application.SheetActivate` と `Application.WorkbookActivate`（ブックの切り替え）、デスクトップ版のウィンドウがアクティブになったとき。
- イベントの購読は「常時持つ参照」として扱う（§5.2）。STA で購読した COM イベントは UI スレッドに届くので、スレッドの切り替えは要らない。ただしイベントの中で COM を呼んで Excel を待たせないよう、処理は `Dispatcher.BeginInvoke` で後回しにする。
- イベントは Excel 全体から届くため、対象ウィンドウのブックのイベントだけを扱う。

COM の `SheetSelectionChange` は図形の選択では発生せず、Office.js の `Shape.onActivated` に当たるものもない。そこで、デスクトップ版のウィンドウが非アクティブの間だけ、500ms ごとに対象ウィンドウの `Selection` を調べる。

1. `Selection` が `Range` なら何もしない。
2. 図形（`ShapeRange` を持つもの）なら、`ShapeRange(1)` の ID が一覧にあるかを調べる。グループ内の図形が選ばれているときは `ParentGroup` をたどる（アドインの制約 §8-6 より良くなる）。
3. 前回の検知から変わったときだけ、アドインの「シート上で一覧の図形を選択した」と同じ処理（確認バー・読み込み）を行う。

- ポーリングは Excel が操作を拒否したら再試行せず（§5.2）、何もせず次の回にする（エラーを表示しない）。
- 設定でオフにできるようにする（§7）。オフでも、ツールバーの「選択中の図を読み込む」で同じ処理を手動で行える。

### 5.5 挿入・差し替え（仕様書 §4.4）

配置の規則・付与情報・エラーメッセージはアドインと同じ。全形式で、処理中は `Application.ScreenUpdating = false` にし、終わったら必ず元に戻す。

**配置の取得**: 新規はアクティブセル（対象ウィンドウの `ActiveCell` の `Left` / `Top`）。差し替えは対象図形の `Left` / `Top` / `Name`。対象がなければ `Selected diagram no longer exists.`。

**一時ファイル**: PNG / JPEG / SVG はファイルにしてから `AddPicture` で挿入する。MSIX で動くときは `AppData` への書き込みがパッケージ専用の場所に振り替えられ、Excel から見えないことがある。そのため一時ファイルは実際のパスが分かる `ApplicationData.Current.TemporaryFolder`（`%LOCALAPPDATA%\Packages\msmsrep.Text-to-SVGDiagramsforExcel_77t1an0ygyrva\TempState`。開発用は `…Dev_77t1an0ygyrva` になる）に置く。MSIX 外で動かす開発時は `Path.GetTempPath()` 配下を使う。挿入後に削除する。要検証: Excel がこのパスのファイルを読めること。

#### 5.5.1 PNG / JPEG

1. エンジンの `raster` で base64 を得て、一時ファイルに書く。
2. `Shapes.AddPicture(path, msoFalse, msoTrue, left, top, width, height)` で埋め込む（リンクしない）。大きさは実寸 × 0.75 × k（pt）。
3. 名前・代替テキストを付け、差し替えなら元の図形を削除する。

#### 5.5.2 SVG / SVG (for shape conversion)

1. エンジンの `svg`（または `officeSvg`）の文字列を一時ファイル（`.svg`）に書く。
2. PNG と同じく `AddPicture` で挿入し、`LockAspectRatio = msoFalse` にしてから実寸 × 0.75 × k に合わせる（アドインと同じ理由）。
3. SVG を挿入できない Excel（2016 の非サブスクリプション版など）では `AddPicture` が失敗する。`AddPicture` の失敗をすべて SVG 非対応とみなすと、保護されたシートなど別の原因でも誤ったメッセージになるため、挿入の前に `Application.Build`（と `Version`）で SVG に対応する版かを判定し、対応しない版なら `SVG insertion is not supported in this version of Excel. Use PNG or JPEG.` を表示する（アドインの `isSvgInsertSupported` に相当）。判定に使うビルド番号は要検証。対応する版での `AddPicture` の失敗は、ほかの形式と同じく `Insert error: ...` にする。

`setSelectedDataAsync` と違い、新しい図形は戻り値で分かるため、図形 ID の差分で探す処理（アドインの `Could not identify the inserted shape.`）は不要。

#### 5.5.3 Shapes (editable)

エンジンの `shapeModel` で図形モデルを得て、アドインの `insertNativeShapes` と同じ順序で組み立てる。

| アドイン（Office.js） | COM |
|---|---|
| `addGeometricShape(type)` | `Shapes.AddShape(MsoAutoShapeType, left, top, width, height)`。型名から列挙値への対応表を C# に持つ（例: `Rectangle` → `msoShapeRectangle`、`FlowChartTerminator` → `msoShapeFlowchartTerminator`、`Can` → `msoShapeCan`） |
| `addLine(..., connectorType)` | `Shapes.AddConnector(msoConnectorStraight / msoConnectorElbow, x1, y1, x2, y2)` |
| `line.connectBeginShape(shape, site)` | `ConnectorFormat.BeginConnect(shape, site)` |
| `connectionSiteCount` | `Shape.ConnectionSiteCount` |
| `line.beginArrowheadStyle` | `Line.BeginArrowheadStyle`（`msoArrowheadTriangle` / `Oval` / `Diamond`） |
| `line.dashStyle` | `Line.DashStyle`（`msoLineSolid` / `msoLineDash`） |
| `fill.setSolidColor` + `transparency` | `Fill.ForeColor.RGB`（BGR 順に注意）+ `Fill.Transparency` |
| `addTextBox(text)` | `Shapes.AddTextbox(msoTextOrientationHorizontal, ...)` |
| テキスト（余白 0、自動調整なし、揃え） | `TextFrame2`（`MarginLeft` ほか、`AutoSize = msoAutoSizeNone`、`VerticalAnchor`、`TextRange.ParagraphFormat.Alignment`、`Font.Size` / `Font.Fill.ForeColor.RGB`） |
| `addGroup(shapes)` | `Shapes.Range(object[] 名前).Group()`。名前の重複を避けるため、作成直後に一時的な一意の名前を付けてから `Range` に渡す |

- 接続ポイント番号: COM の `BeginConnect` / `EndConnect` の番号は 1〜`ConnectionSiteCount` と決まっている。`connectionSite` は 0 始まりの番号を返し、アドインはそれを Office.js にそのまま渡している。`ConnectionSite`（C#）も 0 始まりのまま移植し（共有フィクスチャも 0 始まり）、COM に渡すときに +1 する。要検証: Office.js の番号が 0 始まりで、同じ番号が COM の +1 した番号と同じ位置を指すこと。§4.9 の接続ポイントの方向の表（Can / Hexagon / Parallelogram）が COM でも同じかも確かめ、違いがアドイン側の誤りによるものならアドインを直す（§10）。
- 線の太さは整数 pt に丸め、最小 1pt（アドインと同じ）。
- 図形が 0 個なら `The diagram has no shapes.`。
- 途中で失敗した場合は、それまでに作った図形を削除してから例外を伝える（アドインは `Excel.run` の途中失敗で何も確定しないため、同じ結果にする）。

#### 5.5.4 接続ポイントの選択

`connectionSite`（仕様書 §4.9 の「接続位置」）は、Excel から得た接続ポイント数を使うため C# に移植する。TS と C# の結果が一致するよう、入力と期待値を JSON のフィクスチャ（`test/fixtures/connectionSite.json`）にまとめ、vitest と xUnit の両方で同じフィクスチャを検証する。

### 5.6 選択セルからの生成（仕様書 §4.10）

| アドイン | COM |
|---|---|
| `getSelectedRange().getUsedRangeOrNullObject(true)` | 下の「範囲の決め方」 |
| `values` | `Range.Value2`（日付はシリアル値の double。Office.js と同じ）。下の「値の変換」で Office.js と同じ形にする |
| `text` | セルごとの `Range.Text` |
| `numberFormat` | セルごとの `Range.NumberFormat` |
| — | `Workbook.Date1904` |

**範囲の決め方**（Office.js の `getUsedRangeOrNullObject(true)` は値のあるセルだけで切り詰めるが、COM の `UsedRange` は書式だけのセルも含むため、同じ結果になるよう自分で求める）:

1. 対象ウィンドウの `Selection` が `Range` でなければ `Select a cell range on the sheet.`。複数の範囲を選んでいる（`Areas.Count > 1`）ときも同じエラーにする（Office.js の `getSelectedRange` も複数範囲では失敗する。要検証）。
2. 選択範囲の中で値のある最初と最後のセルを `Range.Find("*", LookIn: xlFormulas, SearchOrder: xlByRows / xlByColumns, SearchDirection: xlNext / xlPrevious)` で求め、その行・列で囲んだ範囲にする。見つからなければ `The selection is empty.`。列全体の選択（`A:C` など）でも `Value2` を 100 万行分読まずに済む。
3. 行数が 500 を超えれば `The selection has more than 500 rows.`（アドインと同じ。値を読む前に調べる）。

**値の変換**:

- `Value2` は、範囲が 1 セルならスカラー、複数セルなら 1 始まりの `object[,]` を返す。どちらも 0 始まりの 2 次元配列にそろえる。
- 空のセル（`null`）は `""` にする。
- エラー値は COM では `int`（CVErr。`#N/A` は -2146826246 など）になるが、Office.js では `"#N/A"` などの文字列になる。エラー番号から文字列に変換して Office.js と同じにする。
- `Text` と `NumberFormat` は、範囲内の値が混在すると配列ではなく `null` を返すため、セルごとに読む（最大 500 行 × 列数回の COM 呼び出し。速度は要検証）。

読んだ値は `TableData`（`values` / `text` / `numberFormat` / `firstRow`）にしてエンジンの `fromTable` に渡す。`TableData` に省略可能な `date1904` を加え、`tableToMermaid` の `serialToIso` で使う。これでアドインの既知の制約 §8-5 の日付のずれがデスクトップ版では起きない。アドインは Office.js でブックの日付システムを取得できないため、従来どおり 1900 年日付システムとして扱う。

### 5.7 Excel 操作の制約

- COM で図形を操作すると、Excel の「元に戻す」の履歴が消える。アドインと同じく、挿入は元に戻せない操作として扱う。
- 保護されたシートでは挿入できない。COM の例外メッセージをそのまま `Insert error: ...` に出す。

---

## 6. 画面

1 つのウィンドウに、アドインのタスクペイン（仕様書 §3）とリボン（§2.1）の内容を並べる。

```
┌ Text-to-SVG Diagrams for Excel ────────────────────── □ × ┐
│ File  New(Template ▸ / From cells ▸)  Output(Insert as ▸ / Save as ▸)  View │
├──────────────────────────────────────────────────────────┤
│ Diagram [(No diagram selected)      ▾] [⟳]  ● Excel: Book1.xlsx │
│ ┌ 確認バー（必要なときだけ）──────────────────────────┐ │
├────────────────────────┬─────────────────────────────────┤
│ エディタ (AvalonEdit)   │ プレビュー (WebView2)            │
│  1 graph LR            │                                 │
│  2   A --> B           │       [A] ──▶ [B]               │
│                        │                                 │
├────────────────────────┴─────────────────────────────────┤
│ Render error: ...  Go to line 2                          │
│ Size [100% ▾] [   ] ☑Keep current size  Format [PNG ▾] [Insert to Excel] [💾] │
└──────────────────────────────────────────────────────────┘
```

- エディタとプレビューは左右に並べ、`GridSplitter` で幅を変える（ウィンドウが縦長のときは上下）。アドインのスプリッタ（§4.7）に当たる。
- **エディタ**: AvalonEdit。等幅フォント、行番号表示。エラー行は `IBackgroundRenderer` で背景色を付ける（アドインの §4.11 の backdrop の代わり）。強調中に編集しても次の描画まで同じ行を強調する点はアドインと同じ。「Go to line N」で該当行を選択し、上から 1/3 の位置にスクロールする。
- Mermaid のシンタックスハイライトは AvalonEdit の定義ファイル（xshd）で後から足す（ロードマップの小改善）。
- **常に手前に表示**: 「View」メニューで切り替える（Excel と並べて使うため）。
- **多重起動**: 1 つに限る。2 つ目を起動したときは、名前付き Mutex で検知し、既存のウィンドウを手前に出して終了する（Excel との接続・ポーリング・設定の保存が重ならないようにするため）。

### 6.1 状態の規則

未保存のコードの判定、確認バーの表示と閉じる場面、差し替え先の扱い、生成・テンプレート後に新しい図として扱うこと、「Keep current size」の有効条件などは、仕様書 §4.3 / §4.10 / §4.12 / §4.13 と同じ規則を `MainViewModel` に実装する。

### 6.2 保存（ダウンロード相当）

`SaveFileDialog` で保存先を選ぶ。既定のファイル名・形式・内容は仕様書 §4.5 と同じ（Shapes は保存不可）。追加で以下を用意する。

| 操作 | 内容 |
|---|---|
| コピー | PNG（`CF_BITMAP` と `PNG` 形式）と SVG（`image/svg+xml`）をクリップボードに置く |
| `.mmd` を開く / 保存 | Mermaid コードをテキストファイルとして扱う（ロードマップの小改善） |

### 6.3 言語（英語・日本語）

| 項目 | 内容 |
|---|---|
| 既定 | Windows の表示言語（`CultureInfo.CurrentUICulture`）が日本語なら日本語、それ以外は英語 |
| 切り替え | 「View」→「Language」で `System` / `English` / `日本語`。保存し、再起動後に反映する |
| C# の文言 | `Strings.resx` / `Strings.ja.resx`。XAML からはマークアップ拡張で参照する |
| TS の文言 | 共通 TS のエラーなど（`Please render first`、`Shapes format supports flowcharts only.`、`tableToMermaid` の行エラーなど）は、`src/core/messages.ts` にメッセージ ID ごとの英語・日本語を持ち、`init` の `locale` で選ぶ |
| 英語のまま | mermaid が出すエラー文（`Parse error on line N` など。行の特定は英語の文に依存する）、図の種類名（Flowchart、Gantt など Mermaid の用語）、`Mermaid Diagram`（代替テキストのタイトル。互換のため） |
| テスト | 英語と日本語でメッセージ ID の過不足がないことを vitest と xUnit で確かめる |
| ストアの掲載情報 | 英語と日本語の両方を用意する |

英語の文言はアドインと同じにする。アドインも共通の `messages.ts` を使って日本語に対応する（§10）。

---

## 7. 設定

アドインは設定を保存しない（プライバシーポリシーでローカルストレージ不使用と明記）。デスクトップ版は以下を保存する。

| 項目 | 内容 |
|---|---|
| 保存先 | `ApplicationData.Current.LocalFolder\settings.json`（MSIX 外の開発時は `%LOCALAPPDATA%\TextToSvgDiagramsForExcel\settings.json`）。アンインストールで消える |
| 内容 | ウィンドウの位置と大きさ、エディタとプレビューの比率、サイズ選択と幅、形式、常に手前に表示、選択の自動検知（§5.4）のオン・オフ、言語 |
| WebView2 のデータ | `LocalFolder\WebView2`（開発時は `%LOCALAPPDATA%\TextToSvgDiagramsForExcel\WebView2`） |

Mermaid コードは保存しない（図形の代替テキストか `.mmd` にのみ残る）。データを外部に送信しない。紹介ページのプライバシーにデスクトップ版の項を加え、ストアに登録するプライバシーポリシーの URL にする。

---

## 8. リポジトリ構成とビルド

```
src/
  core/            共通 TS（Office.js とタスクペインの画面要素に依存しない。描画・変換はブラウザの DOM API を使う）
    render.ts image.ts officeSvg.ts flowchartModel.ts svgUtil.ts
    errorLine.ts tableToMermaid.ts templates.ts messages.ts
    util.ts(PX_TO_PT, errorMessage)
  taskpane/        アドイン固有
    taskpane.ts excelShapes.ts excelTable.ts ribbon.ts splitter.ts
    lineHighlight.ts dom.ts(byId) taskpane.html taskpane.css
  engine/          WebView2 側
    engine.ts engine.html engine.css
desktop/
  TextToSvgDiagramsForExcel.Desktop.sln
  src/TextToSvgDiagramsForExcel.Desktop/        WPF アプリ
  tests/TextToSvgDiagramsForExcel.Desktop.Tests/  xUnit
  package/
    Package.appxmanifest   MSIX のマニフェスト（ひな形）
    Images/                ストア・タイル用の画像
    pack.ps1               winapp CLI による MSIX の作成・署名・提出（§9.2, §9.3）
test/                既存の vitest（core と taskpane）＋ engine のテスト
test/fixtures/       TS と C# で共有するフィクスチャ
```

- 最初の作業として `src/taskpane` から `src/core` へ移動する（アドインの動作は変えない）。`util.ts` の `byId` は DOM 用なので `taskpane` に残す。
- `build.js` に `engine` モードを足し、`src/engine` を `desktop/src/TextToSvgDiagramsForExcel.Desktop/web/` にバンドルする（IIFE、mermaid を含む）。csproj の `BeforeBuild` で `npm run build:engine` を呼び、`web/**` を出力にコピーする。
- csproj の TFM は `net10.0-windows10.0.19041.0`（`ApplicationData` などの WinRT API を使うため）、`UseWPF=true`、`RuntimeIdentifiers=win-x64;win-arm64`、`SelfContained=true`。
- バージョンは `package.json` を正とし、`scripts/sync-version.js` で csproj の `Version` と `Package.appxmanifest` の `Identity/@Version`（`a.b.c.0`。ストアは 4 桁目を 0 にする必要がある）にも反映する。
- GitHub Actions に Windows ランナーのジョブを足し、`dotnet build`・`dotnet test`・開発用 `.msixbundle` の作成（§9.2, §9.3）を行う。リリース用の作成とストアへの提出は手動で `pack.ps1 -Variant Release` を実行する（自動化は公開後に検討）。アドインの既存ジョブ（GitHub Pages）とインストーラはそのまま残す。

### 8.1 テスト

| 対象 | 方法 |
|---|---|
| 共通 TS | 既存の vitest をそのまま使う |
| `engine.ts` | vitest。`chrome.webview` をフェイクにして、要求に対する応答とエラーの形を確かめる |
| `messages.ts` / `Strings*.resx` | 英語と日本語でメッセージ ID の過不足がないこと |
| `MainViewModel` | xUnit。`IEngineClient` と `IExcelGateway` をフェイクにして、アドインの `taskpane.test.ts` と同じ観点（未保存判定、確認バー、差し替え、サイズ）を確かめる |
| `ExcelLocator` | xUnit。ウィンドウ列挙をフェイクにして、対象の選び方（§5.1。最小化だけのとき、接続できないときを含む）を確かめる |
| 選択セルの値の変換（§5.6） | xUnit。スカラー・`object[,]`・空のセル・エラー値を Office.js と同じ形にすることを確かめる |
| `ExcelGateway` | 実際の Excel が必要なため自動テストしない。手動の確認項目表（§10.2 の互換確認を含む）を用意し、開発用の MSIX で確認する |
| `ConnectionSite` | 共有フィクスチャ（§5.5.4） |
| `scripts.test.ts` | バージョンの反映先に csproj と `Package.appxmanifest` を加える |

---

## 9. 配布（MSIX）

### 9.1 パッケージ

| 項目 | 内容 |
|---|---|
| 形式 | x64 と Arm64 の MSIX をまとめた `.msixbundle`。.NET 10 ランタイムを含めた自己完結にする（ストアには .NET 5 以降のデスクトップ用フレームワークパッケージがないため） |
| 大きさ | WPF はトリミングできないため、アーキテクチャごとに 100MB を超える見込み（ストアは利用者の端末に合うアーキテクチャだけを配る）。実際の大きさは段階 2 で確かめる |
| 種類 | full trust のデスクトップアプリ（`EntryPoint="Windows.FullTrustApplication"`、制限付き機能 `runFullTrust`）。COM で Excel を操作するため |
| 対象 OS | Windows 10 バージョン 2004（19041）以降、Windows 11（`TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0"`） |
| 対応 Excel | Excel 2016 以降のデスクトップ版（SVG 系の形式は SVG を挿入できる版のみ）。Arm 版 Windows では Arm64 版・x64 版（エミュレーション）の Excel のどちらにも接続する（COM はプロセス外の呼び出しなので、アプリと Excel のアーキテクチャが違ってもよい。要検証） |
| 表示名 | `Text-to-SVG Diagrams for Excel`（英語・日本語とも） |
| 言語リソース | `Resources` に `en-us` と `ja-jp` を宣言する |

**ストア版の Identity**（Partner Center の値）:

| 項目 | 値 |
|---|---|
| `Identity/@Name` | `msmsrep.Text-to-SVGDiagramsforExcel` |
| `Identity/@Publisher` | `CN=5E0CB4C9-E2E2-4B35-A7BB-09FE6EB44D12` |
| `Properties/PublisherDisplayName` | `msmsrep` |
| パッケージ ファミリ名 | `msmsrep.Text-to-SVGDiagramsforExcel_77t1an0ygyrva` |
| Store ID | `9N78SZM66WM9` |

ストアのページの URL は `https://apps.microsoft.com/detail/9N78SZM66WM9`、アプリ内から開くリンクは `ms-windows-store://pdp/?ProductId=9N78SZM66WM9` になる（どちらも公開後に有効）。

### 9.2 作成手順（winapp CLI）

MSIX の作成・証明書・署名・ストア提出には winapp CLI（Windows App Development CLI。`winget install Microsoft.winappcli`）を使う。手順は `desktop/package/pack.ps1` にまとめ、開発者の PC と CI で同じものを実行する。CI では GitHub Actions の `setup-WinAppCli` で winapp を入れる。winapp はパブリック プレビューのため、使うバージョンを固定する。

1. `npm run build:engine` を実行する。
2. `dotnet publish -c Release -r win-x64 --self-contained -o out/x64` と、同じく `-r win-arm64 -o out/arm64` で、アーキテクチャごとの出力フォルダを作る。
3. `winapp pack out/x64 out/arm64 --manifest <マニフェスト> --cert <pfx> --cert-password <パスワード> --output <出力>.msixbundle` で 1 つのバンドルにし、自己署名証明書（§9.3）で署名する。各フォルダのアーキテクチャは実行ファイルから判定される。リソース（英語・日本語）の PRI も `pack` が作る。
4. リリース用だけ、`winapp store publish <出力>.msixbundle --appId 9N78SZM66WM9` でストアに提出する（Microsoft Store Developer CLI を呼ぶ）。ストアが Microsoft の署名に置き換えて配布する。最初の提出と掲載情報の登録は Partner Center の画面で行う。

**作る MSIX は 2 種類**。どちらも同じ自己署名証明書で署名し、署名しない版は作らない。`pack.ps1 -Variant Release|Dev` で切り替える。

| 項目 | リリース用（`Release`） | 開発用（`Dev`） |
|---|---|---|
| 用途 | ストアへの提出。提出前の最終確認としてサイドロードもできる | 開発中のテスト（Excel との連携、§10.2 の互換確認、Arm64 端末での確認など） |
| Identity Name | `msmsrep.Text-to-SVGDiagramsforExcel` | `msmsrep.Text-to-SVGDiagramsforExcel.Dev` |
| Publisher | `CN=5E0CB4C9-E2E2-4B35-A7BB-09FE6EB44D12` | 同じ |
| 表示名 | `Text-to-SVG Diagrams for Excel` | `Text-to-SVG Diagrams for Excel (Dev)` |
| ビルド構成 | `Release` | `Debug`（WebView2 の開発者ツールを使える。§4.1） |
| マニフェスト | `desktop/package/Package.appxmanifest` | 同じものから `pack.ps1` が Name と表示名を書き換えて作る |
| ファイル名 | `TextToSvgDiagramsForExcel_<版>.msixbundle` | `TextToSvgDiagramsForExcel.Dev_<版>.msixbundle` |

開発用は Identity が違うため、ストア版・リリース用と同じ端末に同時に入れられ、設定（§7）・一時ファイル（§5.5）の置き場所も別になる。

開発中にパッケージとして動かして確かめるときは `winapp run`（プロジェクトを指定するとビルドして、パッケージとして登録・起動する）を使う。MSIX 外での実行（Visual Studio の F5 など）もできるようにしておく（§9.5）。

`winapp pack` に複数フォルダを渡してバンドルを作れること、PRI の作成、`--arch` を使うプロジェクト モードとの使い分けは、実装時に `winapp pack --help` で確かめる。

### 9.3 自己署名証明書とサイドロード

サイドロードは開発者のテスト端末でだけ行い、`.msixbundle` を利用者には配布しない（配布はストアのみ。§9.4）。

MSIX はマニフェストの Publisher と署名した証明書のサブジェクトが一致しないとインストールできない。そこで、ストアの Publisher（`CN=5E0CB4C9-E2E2-4B35-A7BB-09FE6EB44D12`）をサブジェクトにした自己署名証明書を 1 つ作り、リリース用と開発用の両方に使う。これでどちらもテスト端末にサイドロードでき、リリース用はそのままストアに提出できる。

**証明書の作成**（開発者が 1 回だけ行う）:

1. `winapp cert generate --manifest desktop/package/Package.appxmanifest --output <パス>.pfx --password <パスワード> --export-cer --valid-days 365` で作る。サブジェクトはマニフェストの Publisher から取られる。既定のパスワード（`password`）は使わない。
2. `.pfx` と `.cer` はリポジトリにコミットしない（`.gitignore` に加える）。
3. CI では `.pfx` を Base64 にして GitHub Actions のシークレットに置き、署名のときだけ一時ファイルに戻す。パスワードもシークレットに置く。
4. 有効期限が切れたら作り直し、テスト端末に入れ直す。

**テスト端末へのインストール**:

1. `winapp cert install <パス>.cer`（winapp がない端末では `.cer` を「ローカル コンピューター」の「信頼されたユーザー」にインポート）。管理者権限が必要。端末ごとに 1 回。開発者の PC では `cert generate` に `--install` を付けてもよい。
2. `.msixbundle` をダブルクリックするか `Add-AppxPackage <ファイル>.msixbundle` でインストールする。
3. 更新は新しいバージョンを同じ手順で入れる。アンインストールは「設定」→「アプリ」から行う。

開発中のテストは開発用で行う。開発用も MSIX のファイル振り替え・パッケージ ID の有無などはストア版と同じ条件で動くため、§5.1 / §5.5 の要検証項目は開発用で確かめられる。Arm64 版は Arm 版 Windows の端末で確かめる。

リリース用はストアで配布されるものと Identity・中身が同じで、違うのは署名だけである。提出前の最終確認にだけサイドロードする。パッケージ ファミリ名がストア版と同じため、同じ端末に同時には入らず、署名が違うため上書きで切り替わらないことがある（要検証）。その場合は、ストア版を入れる前にサイドロードしたリリース用をアンインストールする。

### 9.4 ストア公開

- Partner Center で予約済みの `Text-to-SVG Diagrams for Excel`（Store ID `9N78SZM66WM9`）に提出する。
- `runFullTrust` は制限付き機能のため、提出時に用途（Excel を COM で操作する）を説明する。
- 掲載情報（説明・スクリーンショット）は英語と日本語で用意する。プライバシーポリシーは紹介ページのプライバシーの節にする（§7）。掲載素材（説明文、スクリーンショット、プロモーション画像、認定の注意事項）は `desktop/store/` に置く。
- 配布はストアだけにする。Microsoft Store を止めている組織に向けた配布（Intune などの案内、サイドロード用バンドルの公開）は行わない（§12 #11）。
- 紹介ページ（`site/index.html`）の導入方法に、アドインの入手方法（manifest.xml、Inno Setup のインストーラ）と並べてストアへのリンク（Microsoft Store のバッジ、`https://apps.microsoft.com/detail/9N78SZM66WM9`）を置く。

### 9.5 MSIX で動くときの注意

| 項目 | 対応 |
|---|---|
| `AppData` への書き込みの振り替え | 一時ファイル（§5.5）・設定（§7）は `ApplicationData` の実際のパスを使う |
| 実行フォルダは読み取り専用 | `web/` はパッケージ内から読むだけにする |
| WebView2 ランタイム | パッケージからインストールできない。起動時に検出して案内する（§4.1） |
| パッケージ外での実行（開発時） | `AppPaths` がパッケージ ID の有無（`Package.Current` の例外）で切り替える |

### 9.6 アドインのインストーラとの関係

アドインの Inno Setup のインストーラ（仕様書 §7）は今後も配布を続ける。デスクトップ版とは別のもので、互いに影響しない（`AppId`・配置先・レジストリが別。デスクトップ版は MSIX のためレジストリやファイルを外に残さない）。利用者はどちらか、または両方を入れられる。

---

## 10. アドイン側の変更

デスクトップ版のために、アドインに以下の変更を加える。動作が変わるものは仕様書（specification.md）も更新する。

| # | 変更 | 動作の変化 | 時期 |
|---|---|---|---|
| 1 | 共通 TS を `src/core` に分離 | なし | 段階 1 |
| 2 | `TableData` に省略可能な `date1904` を追加 | なし（アドインは渡さない） | 段階 4 |
| 3 | 代替テキストから読んだコードの改行を `\n` にそろえる（§5.3） | 改行コードが混ざった図でも未保存の判定がずれない | 段階 3 |
| 4 | §10.2 の検証結果による修正（一覧の対象の種類、接続ポイントの番号・方向など） | 検証結果による | 段階 3〜4 |
| 5 | `connectionSite` のテストを共有フィクスチャに移す | なし | 段階 4 |
| 6 | 文言を `messages.ts` に集め、日本語に対応する（`Office.context.displayLanguage` で選ぶ）。リボンの文言は `manifest.xml` の `<Override Locale="ja-JP">` で日本語にする | 日本語の Office では日本語で表示する | 段階 5 |
| 7 | 紹介ページにストアのリンク、プライバシーにデスクトップ版の項を追加 | — | 段階 6 |

### 10.1 文言の日本語化の注意（アドイン）

- `ribbon.test.ts` はマニフェストのメニュー項目名と `templates.ts` の名前を照合している。図の種類名は英語のまま（§6.3）なので照合は変えず、`Override` の日本語の文言は別のテストで ID の過不足を確かめる。
- `taskpane.html` の固定の文言は、起動時に `messages.ts` から設定する。

### 10.2 互換性の確認項目

アドインで挿入した図とデスクトップ版で挿入した図について、5 形式すべてで次を確かめる。問題があれば、原因のある側を直す（アドイン側なら §10 #4）。

| # | 確認 |
|---|---|
| 1 | もう一方の一覧に表示される（§5.3 の種類の対応） |
| 2 | 読み込むと同じコードが入力欄に入る（改行コード） |
| 3 | もう一方で差し替えると、位置・名前が引き継がれ、元の図形が消える |
| 4 | 「Keep current size」で幅が保たれる |
| 5 | Shapes (editable) の見た目（図形の種類・接続・矢印・色・文字）が同じ |

両方とも同じ共通 TS と同じ mermaid のバージョンを使うため、SVG は一致する。ただし文字の計測はそれぞれの WebView2 のフォントに依存するため、環境によって図の大きさが 1px 程度ずれることがある。

---

## 11. 実装の段階

| 段階 | 内容 | 完了条件 |
|---|---|---|
| 1 | 共通 TS を `src/core` に分離（§10 #1） | アドインの全テストが通り、動作が変わらない |
| 2 | WPF の骨組み、エンジン（`render` / `raster` / `svg` / `officeSvg`）、エディタ、保存。winapp CLI で開発用・リリース用の `.msixbundle`（x64 / Arm64）を作成（§9.2, §9.3） | 開発用で、Excel なしでプレビュー・エラー行・保存ができる（x64 と Arm64 の両方） |
| 3 | Excel の接続先の決定（§5.1）、一覧、読み込み、PNG / JPEG / SVG の挿入・差し替え。§10 #3 | §10.2 の 1〜4 を画像形式で満たす |
| 4 | Shapes (editable)、選択セルからの生成、テンプレート、出力サイズ。§10 #2, #4, #5 | §10.2 をすべて満たす |
| 5 | 英語・日本語（デスクトップ版とアドイン。§6.3、§10 #6）、選択の自動検知、設定の保存、クリップボード、`.mmd` | 両方の言語で全画面・全エラーが表示される |
| 6 | CI、ストア提出、紹介ページ・README の更新（§10 #7） | ストアで公開される |

---

## 12. 決定事項

| # | 項目 | 決定 |
|---|---|---|
| 1 | アプリ名と紹介ページ | `Text-to-SVG Diagrams for Excel`。紹介ページにアドインと並べてストアのリンクを置く（§9.4） |
| 2 | コード署名 | MSIX はすべて自己署名証明書で署名する。リリース用をストアに提出し、ストアで Microsoft の署名になる。開発中のテストには Identity を分けた開発用を使う（§9.2, §9.3） |
| 3 | Excel が複数起動しているとき | アクティブな Excel（最後に使っていたウィンドウ）を対象にする（§5.1） |
| 4 | 要検証の結果 | 互換が崩れる場合は、原因のある側（アドインを含む）を直す（§10） |
| 5 | 画面の言語 | 英語と日本語に対応する。アドインも日本語に対応する（§6.3、§10 #6） |
| 6 | .NET | .NET 10 |
| 7 | 配布形式 | Microsoft Store のみ。MSIX（x64 と Arm64 のバンドル。§9.1） |
| 8 | パッケージの作成・署名・提出 | winapp CLI（§9.2） |
| 9 | ストアの Identity | Partner Center の値（§9.1） |
| 10 | アドインの Inno Setup のインストーラ | 今後も配布を続ける（§9.6） |
| 11 | ストアを止めている組織向けの配布 | 対応しない。配布はストアだけにする（§9.4） |

---

## 13. 実装状況

### 13.1 設計からの変更

| 項目 | 設計 | 実装 | 理由 |
|---|---|---|---|
| Excel の相互運用（§5.2） | PIA（`Microsoft.Office.Interop.Excel`、`EmbedInteropTypes`） | `dynamic` による遅延バインディング。定数は `Excel/Office.cs` に持つ | ビルド環境（CI）に Office や PIA を必要としない。Office のバージョンにも依存しない |
| イベントの購読（§5.4） | — | `IConnectionPointContainer` で `AppEvents`（`SheetActivate` / `WorkbookActivate`）を購読する | 遅延バインディングでは `+=` で購読できないため |
| ポーリング（§5.4） | — | 選択中の図形が一覧にないときは一覧を読み込み直してから調べる | イベントが届かなかった場合（シートの切り替え直後など）にも読み込めるようにするため |
| エンジンの要求の処理（§4.3） | 並行して処理し、古い描画を捨てる | 要求を受け取った順に 1 つずつ処理し、応答も順に返す（古い描画を捨てる処理も残す） | mermaid の描画はもともと 1 つずつ行われるため。応答の順序が要求の順になる |
| 数値の書式（§5.6） | `Range.NumberFormat` をそのまま使う | 「標準」の書式は `General` に置き換える | COM の `NumberFormat` は英語だが、「標準」だけは表示言語の名前（`G/標準`、ドイツ語の `Standard` など）で返る。`Standard` は日付の書式と誤判定されるため、`Normal` スタイルの書式と一致するものを `General` にする（Office.js と同じ値） |
| 追加の画面要素 | — | 図形一覧の横に「選択中の図を読み込む」ボタン、出力欄に「コピー」ボタン | §5.4 / §6.2 の操作をメニュー以外からも使えるようにするため |

### 13.2 確認した結果

Excel 16.0（ビルド 20527、Microsoft 365）と WebView2 で、テスト用の Excel を別に起動して確かめた（`ExcelGateway` と `EngineClient` を直接呼ぶ確認用プログラム）。

| 要検証の項目 | 結果 |
|---|---|
| §5.3 デスクトップ版で挿入した図形の種類 | PNG / JPEG は `msoPicture`（13）、SVG は `msoGraphic`（28）、Shapes は `msoGroup`（6）。すべて一覧に出る |
| §5.5.3 接続ポイント（+1 した番号） | `BeginConnect` / `EndConnect` は 1〜`ConnectionSiteCount` を受け付け、3 本の接続線がすべて両端で図形につながる。Office.js との位置の一致はアドインとの互換確認（§10.2 #5）で確かめる |
| §5.5.2 SVG の判定 | ビルド 20527 で対応と判定し、挿入・大きさの指定ができる。判定のしきい値（ビルド 8067）が正しいかは、SVG に対応しない Excel で確かめる |
| §5.6 範囲の決め方 | 書式だけのセルを除いて値のあるセルだけに切り詰める。列全体の選択、空の範囲、複数範囲、図形の選択も設計どおり |
| §5.6 値の変換 | 日付はシリアル値、`#N/A` は文字列、1904 年日付システムを読み取れる |
| §5.4 イベントとポーリング | `SheetActivate` が届く。グループ内の図形を選ぶとグループの ID になる |
| §4 エンジン | WebView2 で全テンプレートの描画、PNG / JPEG / SVG / 図形変換向け SVG / 図形モデル、表からの生成、エラーと行番号、日本語のメッセージを確かめた |
| §9.2 `winapp package` | 2 つのフォルダから x64 / Arm64 の `.msixbundle` を作成・署名できる（開発用で約 144MB） |

### 13.3 未実施

- MSIX をインストールして動かす確認（§5.1 / §5.5 のパッケージ内での `AccessibleObjectFromWindow`・一時ファイル、Arm64 端末）。証明書をテスト端末に入れる必要がある（§9.3）。
- アドインとの互換確認（§10.2）。
- アドインの日本語対応（§10 #6）。`messages.ts` は共通のエラー文だけを持ち、アドインは英語のまま。
- ストア提出、紹介ページへのストアのリンクの追加（段階 6）。掲載素材（`desktop/store/`）とプライバシーの項は用意済み。
- SVG に対応しない Excel、管理者として動く Excel での確認。
