# Text-to-SVG Diagrams for Excel 仕様書

本書は現行実装（`src/taskpane/*.ts`, `src/taskpane/taskpane.html`, `src/taskpane/taskpane.css`, `manifest.xml`, `build.js`, `Installer/TextToSvgDiagramsForExcel.iss`）から起こした仕様書である。記述は実装の挙動を正とする。主要な挙動は `test/` の自動テストで検証している（§6.4）。

- 対象バージョン: 1.4.0（`package.json` / マニフェスト `1.4.0.0`）
- 作成日: 2026-10-21
- 更新日: 2026-10-23

---

## 1. 概要

Mermaid 記法のテキストからダイアグラムを生成し、Excel のアクティブシートへ画像（PNG / JPEG / SVG）または Excel の図形として挿入する Office タスクペインアドイン。

- レンダリングはタスクペイン内（ブラウザ）で完結し、入力内容を外部へ送信しない。
- 挿入した図形の代替テキストに Mermaid コードを保持し、後から読み出して再編集・差し替えできる。シート上で図形を選択するか、シート図形一覧から選ぶとコードを読み込む（§4.3）。
- 選択したセル範囲の表から Mermaid コード（フローチャート / ガントチャート / 円グラフ）を生成できる（§4.10）。
- 描画エラーの行を入力欄で強調し、その行へ移動できる（§4.11）。
- 出力の大きさを倍率または幅で指定でき、差し替え時は元の図の幅を保てる（§4.12）。
- 図の種類ごとのひな形を入力欄に挿入できる（§4.13）。

### 1.1 動作環境

| 項目 | 内容 |
|---|---|
| ホスト | Excel（`Workbook`）のみ |
| フォームファクタ | デスクトップ（`DesktopFormFactor`）のみ |
| 権限 | `ReadWriteDocument` |
| 要件セット（マニフェスト） | `ExcelApi 1.9` |
| 要件セット（実行時判定） | `ImageCoercion 1.2`（SVG / SVG (for shape conversion) の挿入時のみ。§4.4） |
| 主要ライブラリ | mermaid `^11.0.0`（バンドル同梱）、Office.js（Microsoft CDN から読み込み） |

ImageCoercion 1.2 をマニフェストに宣言しないのは、非対応環境でアドイン全体が読み込めなくなるのを避け、PNG / JPEG は使えるようにするため。

---

## 2. アドイン起動

| 項目 | 内容 |
|---|---|
| リボン | [ホーム] タブにグループ「Text-to-SVG Diagrams」（ボタン「Open Text-to-SVG」）を追加 |
| ボタン | 「Open Text-to-SVG」（`OpenPaneButton`）。押下でタスクペイン `MermaidPane` を表示 |
| タスクペイン URL | 開発: `https://localhost:3000/taskpane.html` / 本番: `https://msmsrep.github.io/TextToSvgDiagramsForExcel/dist/taskpane.html` |
| アドイン ID | `4f7e8c1b-2a3d-4e5f-9071-a2b3c4d5e6f7` |

---

## 3. 画面仕様（タスクペイン）

タスクペインの高さいっぱい（`100dvh`）に、上から順に以下の要素を縦に配置する。プレビューが残りの高さを占める。

| # | 要素 | ID | 内容 |
|---|---|---|---|
| 1 | タイトル | — | 「Text-to-SVG Diagrams for Excel」 |
| 2 | シート図形選択 | `sheet-diagram-select` | ラベル「Sheet diagram」。先頭は `(No diagram selected)`（値は空）。以降にアクティブシート上の Mermaid 図形を図形名で列挙 |
| 2a | 読み込み確認 | `load-confirm` | 未保存のコードを置き換える前に表示する確認バー（§4.3）。通常は非表示。メッセージ（`load-confirm-text`）と「Replace」（`load-confirm-replace`）「Keep」（`load-confirm-keep`）ボタン |
| 2b | テンプレート選択 | `template-select` | ラベル「New from template」。`Flowchart`（既定）/ `Sequence` / `Class` / `State` / `Entity relationship` / `Gantt` / `Pie` / `Mindmap` / `Timeline`。選択肢は `templates.ts` から作る |
| 2c | テンプレートボタン | `template-btn` | 「Use」。選んだテンプレートを入力欄に入れる（§4.13） |
| 3 | 生成する図の種類 | `table-kind-select` | ラベル「Code from selected cells」。`Auto`（既定）/ `Flowchart` / `Gantt` / `Pie`。各選択肢に列の並びを併記 |
| 4 | 生成ボタン | `generate-btn` | 「Generate」。選択セルから Mermaid コードを生成する（§4.10） |
| 5 | Mermaid 入力欄 | `mermaid-input` | 等幅フォントの textarea（初期高さ 100px、スペルチェック無効）。初期値はサンプルのフローチャート（§3.1）。背面の `input-backdrop` でエラー行を強調する（§4.11） |
| 6 | スプリッタ | `splitter` | 入力欄とプレビューの境界。ドラッグで入力欄の高さを変更（§4.7） |
| 6a | サイズ選択 | `size-select` | ラベル「Size」。`50%` / `75%` / `100%`（既定）/ `150%` / `200%` / `Width (pt)`（値 `width`）（§4.12） |
| 6b | 幅の入力 | `size-width` | 幅（pt）の数値欄。`Width (pt)` のときだけ表示 |
| 6c | サイズ維持 | `keep-size` | チェックボックス「Keep current size」（既定でオン）。図を差し替えるときだけ有効 |
| 7 | 形式選択 | `format-select` | `PNG`（既定）/ `JPEG` / `SVG` / `SVG (for shape conversion)`（値 `svg-office`）/ `Shapes (editable)`（値 `shapes`） |
| 8 | 挿入ボタン | `insert-btn` | 「Insert to Excel」。初期状態は無効 |
| 9 | ダウンロードボタン | `download-btn` | 「Download」。初期状態は無効。形式が `Shapes (editable)` の間も無効 |
| 10 | エラー表示 | `error` | エラーメッセージを赤字で表示。描画エラーの行が分かるときは「Go to line N」リンクを付ける（§4.11） |
| 11 | プレビュー | `preview` | レンダリング結果の SVG を表示（最小高さ 120px、はみ出しはスクロール）。入力が空のときは「Type Mermaid code」を表示 |

形式選択とサイズ選択は挿入とダウンロードの両方に適用される。形式を変更したときもボタンとサイズ指定の有効・無効を更新する。

`SVG (for shape conversion)` と `Shapes (editable)` は、アドインを持たない人が編集できる図形にするための方式で、比較のために両方を提供している（§4.8、§4.9）。

### 3.1 入力欄の初期値

```
graph LR
    A[Start] --> B{Condition}
    B -->|Yes| C[Process A]
    B -->|No| D[Process B]
    C --> E[End]
    D --> E
```

---

## 4. 機能仕様

### 4.1 初期化

`Office.onReady` 後に以下を行う。

1. mermaid を初期化する。

   | 設定 | 値 | 目的 |
   |---|---|---|
   | `startOnLoad` | `false` | 自動描画しない |
   | `theme` | `default` | — |
   | `htmlLabels` / `flowchart.htmlLabels` | `false` | ラベルを `<foreignObject>` ではなく SVG `<text>` で出力する（Excel 挿入時・画像化時に文字が消えるのを防ぐ） |
   | `flowchart.useMaxWidth` | `false` | 図を実寸で出力する |

2. 入力欄の初期値でプレビューを描画する（§4.2）。
3. シート図形一覧を読み込む（§4.3）。
4. ワークシートの `onActivated` イベントを登録する（§4.3）。一覧の図形の `onActivated` は 3 の読み込みに合わせて登録する。

### 4.2 プレビュー描画

- **トリガー**: 入力欄の `input` イベント。最後の入力から **250ms** のデバウンス後に描画する。シート図形を読み込んだときは即時描画する（保留中のデバウンスは取り消す）。
- **処理**:
  1. エラー表示をクリアし、挿入・ダウンロードボタンを無効化する。
  2. 入力をトリムし、空ならエラー行の強調を消し、ヒント表示に戻して終了する。
  3. 既存の `#mermaid-graph` 要素を削除してから `mermaid.render("mermaid-graph", code)` を実行する。
  4. 成功時はエラー行の強調を消し、プレビューに SVG を表示し、両ボタンを有効化する（形式が `Shapes (editable)` のときダウンロードボタンは無効のまま）。
  5. 失敗時はプレビューを空にし、`Render error: <メッセージ>` を表示する。メッセージから行が分かれば、その行を強調してリンクを付ける（§4.11）。
- **入力中**: `input` イベントの時点で挿入・ダウンロードボタンを無効化し、実行中の描画があれば破棄する（リクエスト ID を進める）。プレビューが入力内容と一致しない間に、古い図と新しいコードの組み合わせで挿入されるのを防ぐため。
- **競合制御**: 描画ごとにリクエスト ID を採番し、完了時に最新 ID でなければ結果を破棄する（古い描画結果で上書きしない）。

### 4.3 シート図形一覧

- **対象**: アクティブシートの図形のうち、`type` が `Image` / `Group` / `GeometricShape` のいずれかで、`altTextTitle === "Mermaid Diagram"` のもの。`Group` と `GeometricShape` は `Shapes (editable)` で挿入した図（§4.9）。
- **表示**: 図形名（`shape.name`）。値は図形 ID。
- **読み込みタイミング**:
  - タスクペイン起動時
  - ドロップダウンにフォーカスしたとき
  - 挿入処理の完了後（挿入した図形を選択状態にする）
  - シート切替時（ワークシートの `onActivated`。選択は `(No diagram selected)` に戻す）
- **選択状態の保持**: 再読み込み時、直前の選択 ID が一覧に存在すれば選択を維持し、なければ `(No diagram selected)` に戻す。
- **読み込み失敗時**: エラーは表示せず、一覧を空にする。
- **シート上での選択の監視**: 一覧を読み込むたびに、一覧の各図形に `Shape.onActivated`（ExcelApi 1.9）を登録し直す（前回の登録は外す。重ならないよう順に処理する）。登録に失敗してもエラーは表示しない（ドロップダウンからの読み込みは使える）。
- **図の読み込み**: ドロップダウンで図を選んだとき、またはシート上で一覧の図形を選択したときに行う。
  1. 入力欄に未保存のコードがあれば、確認バー（§3 #2a）に `Load "<図形名>"? The code in the editor has unsaved changes and will be replaced.` を表示し、ドロップダウンは元の選択のままにする。「Replace」で読み込み、「Keep」でバーを閉じる（入力欄・選択は変えない）。確認中に別の図を選ぶと、確認の対象をその図に切り替える。
  2. 読み込みでは、ドロップダウンをその図にし、代替テキスト（説明）を入力欄に設定して即座にプレビューを描画する。以降の挿入はその図の差し替えになる（§4.4）。
- **未保存のコード**: 入力欄（トリム後）が、最後に読み込んだ図のコード・最後に挿入したコード・起動時の初期値のどれとも違う状態。ただし空のとき、または読み込む図のコードと同じときは確認しない。選択セルから生成したコード（§4.10）は未保存として扱う。
- **編集中の図の選択**: ドロップダウンで選択中の図をシート上で選んだときは何もしない（編集内容を保つ。表示中の確認バーは閉じる）。
- **確認バーを閉じる場面**: 読み込み、「Keep」、`(No diagram selected)` の選択、選択セルからの生成、シート切替。
- `(No diagram selected)` を選んだ場合は入力欄を変更せず、以降の挿入は新しい図になる。

### 4.4 Excel への挿入

挿入ボタン押下時、プレビューの SVG を形式に応じて挿入する。プレビューに SVG がない場合は `Please render first` を表示する。

**配置**:

| シート図形選択 | 位置 | 図形名 | 元図形 |
|---|---|---|---|
| なし | アクティブセルの左上 | Excel の既定 | — |
| あり | 選択図形と同じ位置 | 選択図形の名前を引き継ぐ | 新しい図形の挿入後に削除 |

差し替え時はアクティブセルを読まない（図形を選択している間は Excel がアクティブセルの取得を拒否するため）。

**形式別の処理**:

各形式の大きさには §4.12 の倍率 k を掛ける。

- **PNG / JPEG**: §4.6 で画像化し、`shapes.addImage` で追加する。表示サイズは SVG の実寸（px × 0.75pt）× k に設定する。追加・プロパティ設定・元図形の削除は 1 回の `sync` で行う。
- **SVG**:
  1. `ImageCoercion 1.2` 非対応の場合は `SVG insertion is not supported in this version of Excel. Use PNG or JPEG.` エラーとする。
  2. 挿入前にシート上の図形 ID 一覧と配置先を取得する。
  3. `setSelectedDataAsync`（`CoercionType.XmlSvg`）で挿入する。
  4. 挿入前後の図形 ID の差分から新しい図形を特定する。ちょうど 1 個でなければ `Could not identify the inserted shape.` エラーとする。
  5. 新しい図形に位置・名前・代替テキストを設定する。プレビュー SVG の viewBox があれば、縦横比の固定を外して表示サイズを SVG の実寸（px × 0.75pt）× k にする（Excel は SVG を独自の大きさで挿入するが、「図形に変換」は図形を画像の大きさに合わせて拡大縮小する一方で文字の大きさは変えないため、実寸でないと文字がはみ出す）。
  6. 差し替えの場合、元図形がまだ存在すれば削除する。

  挿入が失敗した場合、元図形は削除されずに残る。
- **SVG (for shape conversion)**: §4.8 で変換した SVG を、SVG と同じ手順で挿入する。
- **Shapes (editable)**:
  1. Mermaid コードを `mermaid.mermaidAPI.getDiagramFromText` で解析し、フローチャート（`flowchart` / `flowchart-v2` / `flowchart-elk`）でなければ `Shapes format supports flowcharts only.` エラーとする。
  2. §4.9 でプレビューの SVG から図形モデルを作り、k 倍して（§4.12）Excel の図形として挿入する。

**共通の付与情報**:

| 図形プロパティ | 値 |
|---|---|
| `altTextTitle` | `Mermaid Diagram` |
| `altTextDescription` | 入力欄の Mermaid コード（前後空白をトリム） |

**エラー**: `Insert error: <メッセージ>` を表示する。差し替え対象の図形が既に存在しない場合のメッセージは `Selected diagram no longer exists.`。

### 4.5 ダウンロード

ダウンロードボタン押下時、選択形式でファイルを生成し、`<a download>` のクリックで保存させる。プレビューに SVG がない場合は `Please render first` を表示する。

| 形式 | ファイル名 | 生成方法 |
|---|---|---|
| PNG | `diagram.png` | §4.6（倍率 k） |
| JPEG | `diagram.jpg` | §4.6（倍率 k） |
| SVG | `diagram.svg` | プレビュー SVG を `XMLSerializer` で文字列化。k が 1 以外なら、複製に `width` / `height`（viewBox の大きさ × k）を設定し、mermaid が付けた `max-width` を外す |
| SVG (for shape conversion) | `diagram.svg` | §4.8 |
| Shapes (editable) | — | ダウンロード不可（ボタン無効） |

失敗時は `Download error: <メッセージ>` を表示する。

### 4.6 画像変換（SVG → ラスタ）

1. SVG を `XMLSerializer` で文字列化し、`data:image/svg+xml` URL として `Image` に読み込む。
2. 基準サイズ（CSS px）を決定する。
   - 幅: `viewBox.width`（> 0 の場合）→ 画像の `naturalWidth` → `800`
   - 高さ: `viewBox.height`（> 0 の場合）→ `naturalHeight` → `600`
3. 画素の倍率を決定する。既定は **2 × k**（k は §4.12 の倍率）。ただし Canvas の面積が 4096 × 4096 px を超える場合は、超えない倍率まで下げる。
4. Canvas（基準サイズ × 画素の倍率）に描画し、Base64 を得る。表示サイズは基準サイズ × k とする。

| 形式 | 背景 | 品質 |
|---|---|---|
| PNG | 透過 | — |
| JPEG | 白 (`#ffffff`) で塗りつぶし | 0.92 |

Excel 挿入時は §4.4 のとおり表示サイズ（基準サイズ × k）で表示するため、k を変えても表示サイズあたりの解像度は 2 倍のまま変わらない（上限にかかる大きな図を除く）。

### 4.7 スプリッタ

- ドラッグ（Pointer Events）で入力欄の高さを変更する。上下矢印キーでも 10px 単位で変更できる（`role="separator"`、フォーカス可能）。
- 入力欄の高さは最小 40px。プレビューが 120px を下回らない範囲までしか広げない。
- 変更した高さは保存しない（タスクペインを開き直すと初期値に戻る）。

### 4.8 図形変換向け SVG（`officeSvg.ts`）

Excel の「図形に変換」で文字・矢印・色がずれないよう、プレビュー中の SVG（計算済みスタイルと座標を読むため DOM 上にある必要がある）を平坦な SVG に書き直す。

| 項目 | 処理 |
|---|---|
| ルート | `viewBox` の原点を 0,0 に移し、`width` / `height` を viewBox の寸法にする。viewBox がなければ `getBBox` を使う |
| 構造 | 描画要素（rect / circle / ellipse / polygon / polyline / path / line / text）を、属性のない 1 つの `<g>` の直下に描画順で並べる。「図形に変換」すると 1 つのグループになる（`<g>` がないとばらばらの図形になる） |
| 座標 | 各要素にルートからの変換行列を 1 つだけ付ける（平行移動なら `translate`、それ以外は `matrix`） |
| スタイル | 計算済みスタイルから `fill` / `stroke` / `stroke-width` / `stroke-dasharray` / 不透明度を属性に書き出す。色は `#RRGGBB`、色のアルファと祖先の `opacity` は `fill-opacity` / `stroke-opacity` に畳み込む。`<style>`・`class`・`style` 属性は出力しない |
| テキスト | 行（`tspan.text-outer-tspan`）ごとに、先頭文字のベースライン位置（`getStartPositionOfChar`）を絶対座標とする `<text>` を出す。em 単位の `dy` と `text-anchor` は使わない。`dominant-baseline` / `alignment-baseline` が alphabetic 以外（シーケンス図の `central` など）のときは、文字セルの上端（`getExtentOfChar`）と同じフォントのアルファベットベースラインの文字の上端との差からアルファベットベースラインの位置を求める。文字色は最初の文字のある `<tspan>` の計算済みスタイルから取る（シーケンス図は `<text>` に枠の色、`<tspan>` に文字色を付けるため）。太字・斜体・行と色の異なる部分は位置指定なしの `<tspan>` で残す |
| 矢印 | path / line / polyline の `marker-start` / `marker-end` の中身を、端点の位置と向き（`getTotalLength` / `getPointAtLength`）、マーカーの `viewBox` / `refX` / `refY` / `markerWidth` / `markerHeight` / `orient` から計算した変換で普通の図形として描く |
| 除外 | `defs` / `marker` / `style` などの非描画要素、`display:none` / `visibility:hidden`、幅か高さのない rect、塗りも線もない要素。線の間隔がすべて 0 の `stroke-dasharray`（mermaid の実線 `1, 0` や `0`。奇数個の値は SVG と同様に繰り返して対にしてから判定する） |

### 4.9 Excel 図形での挿入（`flowchartModel.ts` / `excelShapes.ts`）

フローチャートを Excel の図形・コネクタ・テキストボックスで組み立て、1 つのグループにする。

**図形モデルの作成**: 種類（形・矢印・線種）は mermaid の `db.getData()`、位置・大きさ・色はプレビュー SVG の DOM から取る。座標は全図形の外接矩形の左上を 0,0 とした pt（px × 0.75）。

| 要素 | DOM | Excel |
|---|---|---|
| サブグラフ | `g.cluster`（id は `<svg id>-<サブグラフ id>`）の rect | 四角形。タイトルは上揃え。面積の大きい順に作り、ノードより背面に置く |
| ノード | `g.node`（id は `<svg id>-<domId>`）の `.label-container` | 下表の図形。ラベルは図形内に上下左右中央揃え |
| エッジ | `path[data-id=<edge id>]` の `data-points`（base64 の JSON 点列）の始点・終点。自己ループ（始点と終点が同じノード）は mermaid が補助ノード経由の 3 本のパス（`<ノード id>-cyclic-special-1` / `-mid` / `-2`）で描くため、`-1` の始点と `-2` の終点を使う | 両端をノードに接続したコネクタ。自己ループはノードごとに 1 本（mermaid も 1 本しか描かない） |
| エッジラベル | `.edgeLabel .label` の背景 rect | 枠線なしのテキストボックス。空のラベルは作らない |

| mermaid の形 | Excel の図形 |
|---|---|
| squareRect / rect | Rectangle |
| roundedRect / rounded | RoundRectangle |
| stadium | FlowChartTerminator |
| subroutine / fr-rect | FlowChartPredefinedProcess |
| cylinder / cyl | Can |
| circle / doublecircle / dbl-circ / ellipse | Ellipse |
| diamond / diam | Diamond |
| hexagon / hex | Hexagon |
| lean_right / lean_left / lean-r / lean-l | Parallelogram |
| trapezoid / trap-b | Trapezoid |
| inv_trapezoid / trap-t | FlowChartManualOperation |
| doc | FlowChartDocument |
| その他 | Rectangle |

- **ラベル**: 行 tspan の文字列を改行で連結する（mermaid の折り返し位置を維持）。フォントサイズ（px × 0.75）と文字色は計算済みスタイルから取る。フォント名は指定しない（Excel の既定フォント）。
- **ラベルが図形に収まらない場合**: Excel は図形ごとに文字の配置領域が決まっており（ひし形は幅の半分、楕円は約 7 割など）、それより広い文字は単語の途中でも折り返す。余白を負にしても広がらない。そこで、ラベルの幅 × 1.15（フォント差の余裕）が図形の文字領域より広いときは、図形の文字を空にし、ラベルを図形に重ねたテキストボックス（図形の幅以上、枠線・塗りなし、図形の中心に配置）にする。
- **塗り・線**: 計算済みスタイルの色と不透明度（透過率 = 1 − アルファ × fill-opacity × opacity）。線の太さは px × 0.75 を整数に丸めた値（最小 1pt。Excel が小数の太さを `InvalidArgument` で拒否するため）、`stroke-dasharray` に 0 より大きい間隔があれば破線（Dash。判定は §4.8 と同じ）。
- **エッジ**: 矢印は `arrow_point` → Triangle、`arrow_circle` → Oval、`arrow_cross` → Diamond。`invisible`（`~~~`）は作らない。始点と終点の x または y の差が 1px 未満なら直線（Straight）、それ以外と自己ループはカギ線（Elbow）。
- **接続位置**: 端点がノードの中心からどの向きにあるかを、ノードの縦横比で正規化した角度で求め、最も近い方向の接続ポイントに接続する。自己ループの終点は、始点と同じ接続ポイントを除いた中で最も近いものにする（同じ点では長さ 0 になるため）。接続ポイントの方向は、多くの図形では「上から反時計回りに等間隔」で、Excel で実測して異なっていた図形は次の表による（上から反時計回りの角度、接続ポイント番号順）。

  | 図形 | 接続ポイントの方向 |
  |---|---|
  | Can | 0°, 0°, 90°, 180°, 270° |
  | Hexagon | 270°, 215°, 145°, 90°, 35°, 325°（上下の辺の中央にはない） |
  | Parallelogram | 0°, 351°, 270°, 171°, 180°, 90° |

**Excel への書き込み**（1 回の `Excel.run`）:

1. 配置先を取得する（§4.4 の配置規則）。
2. サブグラフとノードを `addGeometricShape` で作り、位置・塗り・線・テキスト（余白 0、自動調整なし）を設定する。`connectionSiteCount` を読み込んで `sync` する。
3. エッジを `addLine` で作り、`connectBeginShape` / `connectEndShape` で接続し、矢印と線を設定する。接続先のノードがない端は接続しない。
4. エッジラベルを `addTextBox` で作る。
5. 図形が 2 個以上なら `addGroup` でまとめる（1 個ならそのまま）。まとめた図形に位置・名前・代替テキストを設定し、差し替え時は元図形を削除して `sync` する。図形が 0 個なら `The diagram has no shapes.` エラーとする。

### 4.10 選択セルからのコード生成（`excelTable.ts` / `tableToMermaid.ts`）

[Generate] で、選択したセル範囲の表から Mermaid コードを作り、入力欄を置き換えてすぐに描画する（デバウンス待ちの描画は取り消す）。生成したコードは新しい図として扱い、シート図形選択を `(No diagram selected)` に戻す（挿入しても既存の図を差し替えない）。失敗時は `Generate error: <メッセージ>` を表示し、入力欄は変えない。

**読み込み**（`readSelection`）:

1. `getSelectedRange().getUsedRangeOrNullObject(true)` で、選択範囲のうち値のあるセルだけを対象にする（A:C のような列全体の選択に対応）。`rowCount` と `rowIndex` を読んで `sync` する。
2. この `sync` が失敗した場合（図形が選択されているなど）は `Select a cell range on the sheet.`、値のあるセルがなければ `The selection is empty.`、500 行を超えれば `The selection has more than 500 rows.` エラーとする。
3. `values` / `text`（表示文字列）/ `numberFormat` を読み込む。

**セルの解釈**:

| 値 | 解釈 |
|---|---|
| 数値で、表示形式に `y` / `m` / `d` を含む（引用符内・`\` でエスケープした文字・`[...]` は除く） | 日付。1900 年日付システムのシリアル値として `YYYY-MM-DD` に変換し、時刻は切り捨てる |
| その他の数値 | 数値。ラベルには表示文字列を使う（列幅不足で `####` のときは値） |
| `YYYY-MM-DD` / `YYYY/M/D` / `YYYY.M.D` の文字列（実在する日付のみ） | 日付 |
| その他の文字列・真偽値 | 文字列（前後の空白を除く） |

すべてのセルが空の行は無視する。列が 2 列未満なら `Select at least two columns.` エラーとする。

**種類の判定**（`Auto`）: 1 行目を除いた（1 行しかなければその行の）2 列目の空でないセルが、すべて日付ならガントチャート、すべて数値なら円グラフ、それ以外はフローチャート。

**見出し行**: ガントチャートと円グラフでは、1 行目の 2 列目が期待する型（日付 / 数値）でなければ見出しとして除く。データ行が残らなければ `The selection has no data rows.` エラーとする。フローチャートでは見出しを判定せず、すべての行をデータとして扱う。

| 種類 | 列 | 出力 |
|---|---|---|
| Flowchart | 親 \| 子 \| (エッジラベル) | `graph TD`。ノード ID は出現順に `n1`, `n2`, …。同じ表示文字列は同じノードとし、初出時だけ `n1["ラベル"]` と書く。親と子があれば `-->`（ラベルがあれば `-->\|"ラベル"\|`）、片方だけならそのノードだけを置く。`"` は `#quot;`、改行は `<br>` に置き換える |
| Gantt | タスク \| 開始日 \| 終了日または日数 \| (セクション) | `gantt` / `dateFormat YYYY-MM-DD` / `inclusiveEndDates`（終了日を含む）。4 列目の値が変わるたびに `section` 行を入れる。タスク名の `:` は全角の `：`、改行は空白に置き換える。タスク名が空、開始日が日付でない、終了日が日付でも正の数値でもない行は `Row <行番号>: ...` エラーとする（行番号はシートの行番号） |
| Pie | ラベル \| 値 | `pie` と `"ラベル" : 値`。値には表示文字列ではなく数値そのものを使う。ラベルの `"` は `'` に、改行は空白に置き換える。値が数値でない行は `Row <行番号>: the value must be a number.` エラーとする |

### 4.11 エラー行の強調（`errorLine.ts` / `lineHighlight.ts`）

**行の特定**（`errorSourceLine`）: 描画エラーのメッセージから行番号（1 始まり）を取り出し、入力欄の行に対応させる。

| 形式 | 例 | 対象 |
|---|---|---|
| jison | `Parse error on line N:` / `Lexical error on line N.` | フローチャート、シーケンス図など多くの図 |
| Langium | `Parse error on line N, column M:` / `Lexer error on line N, column M:` | pie など |

mermaid が報告する行は、mermaid が前処理した後のコードの行なので、入力欄の行とずれる。そこで、入力欄の各文字の行を記録したまま、描画前と同じ順に以下を取り除き、報告された行の先頭の文字が元々あった行を求める。

1. 前後の空白（描画前のトリム）
2. front matter（`---` で囲んだ先頭のブロック）
3. ディレクティブ（`%%{ ... }%%`。複数行も含む）
4. `%%` で始まるコメント行。続けて先頭の空白を取り除く

除去の正規表現は mermaid 11 の `preprocessDiagram` と同じものを使う。行番号がコードの末尾を越える場合（入力の終わりで起きるエラー）は最後の行とする。メッセージに行番号がなければ強調しない。

**強調表示**（`initLineHighlight`）: textarea は行ごとに装飾できないため、textarea を透明にし、背面の `input-backdrop` に同じ文字を 1 行 1 ブロックで透明色で置き、該当行のブロックに背景色を付ける。

- 折り返しが一致するよう、フォント・余白・行の高さ・`white-space: pre-wrap` / `overflow-wrap: break-word` をそろえ、幅は textarea の `clientWidth`（スクロールバーを除く）に合わせる。
- textarea のスクロール（`scroll`）とウィンドウの大きさの変更（`resize`）に追従する。
- 強調中に入力欄を編集しても、次の描画まで同じ行番号を強調し続ける（入力のたびに消えてちらつくのを防ぐ）。

**「Go to line N」リンク**: クリックすると入力欄にフォーカスし、その行を選択し、行が入力欄の高さの上から 1/3 に来るようにスクロールする。入力中に選択位置を勝手に動かさないよう、自動では移動しない。

### 4.12 出力サイズ

挿入・ダウンロードのときに、図の実寸（プレビュー SVG の viewBox の大きさ。px × 0.75 で pt）に掛ける倍率 k を決める。設定は保存せず、タスクペインを開くたびに既定値に戻る。

| 条件 | k |
|---|---|
| 形式が `SVG (for shape conversion)` | 1（サイズ選択・幅・サイズ維持は無効）。「図形に変換」は文字の大きさを変えないため、拡大縮小すると文字が図形に合わなくなる |
| 挿入で、図を差し替え、「Keep current size」がオン | 差し替える図形の現在の幅（pt）÷ 実寸の幅。高さは縦横比で決まる。サイズ選択は使わない |
| サイズ選択が倍率 | その倍率 |
| サイズ選択が `Width (pt)` | 入力した幅 ÷ 実寸の幅。0 以下や数値でなければ `Enter a width greater than 0.` エラー |

- ダウンロードには「Keep current size」を使わず、常にサイズ選択の倍率を使う。
- 実寸の幅が必要な場合（幅の指定・サイズ維持）に viewBox がなければ `The diagram's size is unknown.` エラーとする。
- `Width (pt)` に切り替えたとき、幅が空ならプレビューの実寸の幅（pt、整数に丸める）を入れる。
- 「Keep current size」は、シート図形選択で図を選んでいる（差し替えになる）ときだけ有効にする。差し替える図形の幅は挿入の直前に読み込む。既に存在しなければ `Selected diagram no longer exists.` エラー。
- **Shapes (editable)**: 図形モデル（§4.9）の位置・大きさ・接続点・フォントサイズ・線の太さを k 倍する（小数第 2 位に丸める）。線の太さは挿入時に §4.9 のとおり整数に丸める。

### 4.13 テンプレート挿入（`templates.ts`）

[Use] で、テンプレート選択で選んだ種類のひな形を入力欄に入れ、すぐに描画する。扱いは §4.10 の生成コードと同じで、待ち中の描画を取り消し、読み込み確認を閉じ、シート図形選択を `(No diagram selected)` に戻す（挿入しても既存の図を差し替えない）。入力欄に未保存のコードがあっても確認せずに置き換える。テンプレートのコードは未保存のコードとして扱うため、その後シート上の図を読み込むときは確認する（§4.3）。

テンプレートは数行の最小構成で、Flowchart は入力欄の初期値（§3.1）と同じ内容を `graph TD` で書いたもの。

---

## 5. データ仕様

本アドインは独自の保存領域を持たず、**図形の代替テキストを唯一の永続データ**とする。

| 保存先 | 内容 | 用途 |
|---|---|---|
| 図形の `altTextTitle` | 固定文字列 `Mermaid Diagram` | Mermaid 図形の識別（§4.3 の一覧の抽出条件） |
| 図形の `altTextDescription` | Mermaid ソースコード | シート図形選択時に入力欄へ復元 |

利用者が代替テキストのタイトルを変更すると、その図形は一覧に表示されなくなる。

§4.10 で読み込むセルの値はコード生成にだけ使い、保存・変更しない。

Cookie、localStorage、外部送信は使用しない。

---

## 6. ビルド・開発環境

### 6.1 npm スクリプト

| コマンド | 実体 | 内容 |
|---|---|---|
| `npm run build` | `node build.js` | 本番ビルド。マニフェストの URL を本番 URL に置換して `dist/` に出力 |
| `npm run build:dev` | `node build.js dev` | 開発ビルド。マニフェストの URL は `https://localhost:3000` |
| `npm run watch` | `node build.js watch` | ファイル監視ビルド（インラインソースマップ、開発 URL） |
| `npm run dev-server` | `node build.js serve` | esbuild の HTTPS サーバ（ポート 3000）で `dist/` を配信 |
| `npm run typecheck` | `tsc && tsc -p test` | ソースとテストの型チェック |
| `npm test` | `vitest run` | テスト実行（§6.4） |
| `npm run test:watch` | `vitest` | テストの監視実行 |
| `npm version <patch\|minor\|major>` | — | `package.json` を更新し、`scripts/sync-version.js` でマニフェストと `.iss` のバージョン（4 桁）に反映 |
| `npm start` | `office-addin-debugging start manifest.xml` | Office へのサイドロード＋デバッグ起動 |
| `npm stop` | `office-addin-debugging stop manifest.xml` | デバッグ停止 |

### 6.2 build.js の処理

1. `taskpane.html`、`taskpane.css` と `assets/` 配下を `dist/` にコピーする。
2. `manifest.xml` 内の `https://localhost:3000` をモードに応じた URL に置換して `dist/manifest.xml` に出力する。

   | モード | ベース URL |
   |---|---|
   | `build` | `https://msmsrep.github.io/TextToSvgDiagramsForExcel/dist` |
   | `dev` / `watch` / `serve` | `https://localhost:3000` |

3. esbuild で `src/taskpane/taskpane.ts` を `dist/taskpane.js` にバンドルする（IIFE、ターゲット ES2017、ソースマップあり）。
4. `serve` では `office-addin-dev-certs` の証明書で esbuild の HTTPS サーバを起動する。証明書が無い場合はエラーメッセージを出して終了する。
5. 未知のモードを指定した場合はエラー終了する。

### 6.3 配布

- 本番資産は GitHub Pages（`https://msmsrep.github.io/TextToSvgDiagramsForExcel/dist/`）でホストする。
- `main` への push 時に GitHub Actions（`.github/workflows/pages.yml`）が型チェック・テスト・本番ビルドを行い、`dist/` を `/dist/` 配下としてデプロイする。`dist/` はリポジトリにコミットしない。
- サイトのルート（`https://msmsrep.github.io/TextToSvgDiagramsForExcel/`）には `site/` の内容（紹介ページ `index.html`。機能・導入方法・使い方・プライバシーを日英併記）を配置する。

### 6.4 テスト

Vitest（jsdom 環境）で `test/*.test.ts` を実行する。設定は `vitest.config.mts`、型チェックは `test/tsconfig.json`。

| テスト | 対象 | 方法 |
|---|---|---|
| `util.test.ts` | `util.ts` | そのまま実行 |
| `excelShapes.test.ts` | §4.3（選択の監視を含む）/ §4.4 / §4.9 の Excel 操作 | `Excel` / `Office` グローバルをフェイク（`test/fakes/office.ts`）に差し替え |
| `excelTable.test.ts` | §4.10 の選択範囲の読み込み | 同上 |
| `tableToMermaid.test.ts` | §4.10 のコード生成 | そのまま実行 |
| `templates.test.ts` | §4.13 のテンプレート定義 | そのまま実行 |
| `officeSvg.test.ts` | §4.8 | SVG の座標・計測 API をスタブ（`test/fakes/svgGeometry.ts`） |
| `flowchartModel.test.ts` | §4.9 の図形モデル作成、§4.12 の拡大縮小 | 同上 |
| `svgUtil.test.ts` | 行列・色の変換 | そのまま実行 |
| `image.test.ts` | §4.6 | `Image` と Canvas をモック |
| `render.test.ts` | §4.1 / §4.2 / §4.4 の mermaid 呼び出し | `mermaid` をモック |
| `splitter.test.ts` | §4.7 | 要素の `offsetHeight` をスタブ |
| `errorLine.test.ts` | §4.11 の行の特定 | そのまま実行 |
| `lineHighlight.test.ts` | §4.11 の強調表示 | 要素の `clientWidth` / `clientHeight` / `offsetTop` をスタブ |
| `taskpane.test.ts` | §3〜§4.5 / §4.10〜§4.13 の UI 動作 | `taskpane.html` を読み込み、Excel 操作・描画・画像化をモック |
| `scripts.test.ts` | §6.1 のバージョン反映、§6.2 | 一時ディレクトリにコピーしたプロジェクトで実行（Node 環境） |

mermaid の実際の描画（jsdom は SVG のレイアウトを持たない）、`watch` / `serve` モード、Excel 上での動作は自動テストの対象外。jsdom は `<svg>` 内の `<style>` を適用しないため、§4.8 / §4.9 のテストではスタイルを `<svg>` の外に置く。

---

## 7. インストーラ（Inno Setup）

`Installer/TextToSvgDiagramsForExcel.iss` により、共有フォルダカタログ方式でマニフェストを登録する。

| 項目 | 内容 |
|---|---|
| アプリ名 | `Text-to-SVG Diagrams for Excel` |
| 出力 | `TextToSvgDiagramsForExcelSetup.exe` |
| 実行権限 | ログオン中のユーザー（`PrivilegesRequired=lowest`）。SMB 共有の作成・削除のみ UAC で昇格 |
| 対応アーキテクチャ | x64 互換 |
| 言語 | 日本語 |
| 発行元 / URL | `msmsrep` / `https://github.com/msmsrep/TextToSvgDiagramsForExcel` |
| 配置ファイル | `dist/manifest.xml` のみ（コンパイル前に `npm run build` が必要） |
| 配置先 | `%USERPROFILE%\Documents\OfficeAddIns\Excel\TextToSvgDiagramsForExcel`（`{userdocs}` は OneDrive にリダイレクトされるため使わない。前回の配置先は引き継がない: `UsePreviousAppDir=no`） |

**インストール時**:

1. マニフェストを配置先にコピーする。
2. 共有名 `TextToSvgDiagramsForExcel` が未作成なら `net share TextToSvgDiagramsForExcel="<配置先>"` を、旧名の共有 `MermaidForExcel` があれば `net share MermaidForExcel /delete /y` を、1 回の UAC 昇格（`cmd /c`）でまとめて実行する。実行後に共有が存在しなければエラーダイアログを表示する。共有の有無は UNC パス `\\<コンピュータ名>\<共有名>` を参照できるかで判定する（`net share <名前>` は非管理者ではアクセス拒否になるため使わない）。
3. `HKCU\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs\{0e1e7db9-24b4-4064-8d0c-995f6f80a03f}` に以下を登録する。

   | 値 | 型 | データ |
   |---|---|---|
   | `Id` | 文字列 | `{0e1e7db9-24b4-4064-8d0c-995f6f80a03f}` |
   | `Url` | 文字列 | `\\<コンピュータ名>\TextToSvgDiagramsForExcel` |
   | `Flags` | DWORD | `1`（メニューに表示） |

4. 旧名の配置先 `%USERPROFILE%\Documents\OfficeAddIns\Excel\MermaidForExcel` から、旧版が置いたファイル（`manifest.xml`、`unins000.exe`、`unins000.dat`）を削除し、空になったフォルダを削除する。

**旧名（Mermaid for Excel）からの上書き**: `AppId` とカタログの GUID は旧版と同じ。上書きインストールで、アンインストール情報とカタログの `Url` が新しいものに置き換わる。

**アンインストール時**: 共有 `TextToSvgDiagramsForExcel` が存在すれば UAC 昇格して削除し、上記レジストリキーを削除する。

インストール後、利用者は Excel の [アドイン] → [共有フォルダー] からアドインを追加する。

---

## 8. 既知の制約・課題

1. **SVG 挿入の一時的な位置**: SVG は Excel の選択範囲に挿入された後で目的の位置へ移動する。
2. **同名の既存共有**: 共有 `TextToSvgDiagramsForExcel` が別のフォルダを指して既に存在する場合、インストーラは作り直さない。
3. **SVG (for shape conversion)**: 「図形に変換」は利用者が Excel で行う。挿入後に画像の大きさを変えてから変換すると、文字の大きさが図形と合わなくなる。日本語など Trebuchet MS にない文字は、Excel では ＭＳ ゴシックになり、プレビューとフォントが変わる。変換後のエッジはフリーフォームの線で、ノードとは接続されない（ノードを動かしても線は付いてこない）。ラベルもノードとは別のテキストボックスになる。
4. **Shapes (editable) の近似**:
   - フローチャートのみ対応。
   - エッジの曲線は直線かカギ線のコネクタになり、経路は Excel が決める。
   - × の矢印は Diamond で代用する。
   - 左向き平行四辺形（lean_left）と旗形（odd）など、対応する図形がない形は近い図形か四角形になる。
   - フォントが mermaid と異なるため、ラベルの折り返しや幅が変わることがある。
   - 図形に収まらないラベル（§4.9）は別のテキストボックスになるため、ノードだけを動かすとラベルが残る。
   - 六角形には上下の辺の中央に接続ポイントがないため、上下から来るエッジは角に接続される。
   - §4.9 の表にない図形の接続ポイントは「上から反時計回りに等間隔」と仮定している。
5. **選択セルからのコード生成**（§4.10）:
   - 1904 年日付システムのブックでは、日付が 4 年と 1 日ずれる（Office.js でブックの日付システムを取得できないため）。
   - 図はアクティブセルに挿入されるため、表を選択したまま挿入すると図が表に重なる。
   - フローチャートでは見出し行を判定しないため、見出しを含めて選択するとそれもノードになる。
6. **シート上での図の選択**（§4.3）: `Shapes (editable)` の図（グループ）は、グループ自体が選ばれたときに読み込まれる。グループ内の図形だけを選んだときにイベントが発生するかは Excel の挙動による。一覧の読み込み後に挿入された図形は、次の再読み込みまで監視されない。
