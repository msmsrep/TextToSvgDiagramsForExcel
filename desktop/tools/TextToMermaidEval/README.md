# TextToMermaidEval

文章から Mermaid を作る処理を `cases.ja.json`（日本語 150 件）と `cases.en.json`（英語 90 件）で測るツール。ルールベース（`src/core/textToMermaid.ts`）と、ONNX Runtime GenAI で動かすローカルモデル（`src/TextToSvgDiagramsForExcel.Generation`）を比べる。

- コードの検証は `scripts/mermaid-validate.mjs`（Node で `mermaid.parse`）を標準入出力でつないで行う。サーバーは立てず、外へ通信もしない。
- 結果は `desktop/out/eval/<日時>.json`（生成したコードとモデルの回答全文）と `.md`（表）に保存する。

## 実行

```bash
# ルールベースだけ
dotnet run --project desktop/tools/TextToMermaidEval

# ローカルモデルも測る（作り直しは最大 2 回）
dotnet run --project desktop/tools/TextToMermaidEval -c Release -- --model desktop/models/mermaid-0.8b-jaen3 --repairs 2
```

英語のケースで測るときは `--cases` を付ける。正解は、同じフォルダの `references.en.txt` を使う（`cases.<言語>.json` に `references.<言語>.txt` が対応する）。

```bash
dotnet run --project desktop/tools/TextToMermaidEval -c Release -- --cases desktop/tools/TextToMermaidEval/cases.en.json --model desktop/models/mermaid-0.8b-jaen3 --repairs 0
```

使うモデルは、この用途に学習させた `mermaid-0.8b-jaen3`（作り方は `desktop/tools/MermaidTraining/README.md`）。フォルダに `text-to-mermaid.json` があれば、指示や例を付けずに文章だけを送る。

## 指標

| 列 | 意味 |
|---|---|
| valid | mermaid が読めたコードの数 |
| valid & right type | そのうち期待した図の種類（flowchart / sequence / gantt）のもの |
| structure | 種類が合ったうえで、文章にある分岐（フローチャート）、参加者（シーケンス図）、作業（ガント）が、ケースに書いた数以上あるものの数。分岐は、2 つ以上の行き先へ矢印が出ているノードを数える |
| content | 正解の図（`references.ja.txt`）と中身がどれだけ合うか。0〜1 の平均。読めない答えと種類の違う答えは 0（下の「中身の採点」） |
| conditions | フローチャートの分岐で、正解と同じ矢印についた条件（「はい」「いいえ」など）が正解と合った数 |
| valid on 1st try | 作り直しなしで読めた数 |
| keyword recall | 期待する語（`keywords`）がコードに含まれた割合。内容の目安で、分岐の正しさまでは見ない |
| avg s / max s | 1 件あたりの時間（作り直しを含む） |

`structure` は数が足りているかを見るだけで、分岐の向きや並びの正しさまでは見ない。そこは `content` と `conditions` で見る。

## 中身の採点（`content`）

`references.ja.txt` に、ケースごとの正解の図を置く（`=== ケースの id` の下に Mermaid のコード。書き方は学習データと同じ）。作られた図と正解の図をどちらも mermaid のパーサーで読み、ID ではなくラベルの言葉で対応づけて比べる（`scripts/mermaid-graph.mjs`）。

| 種類 | 比べるもの |
|---|---|
| フローチャート | （ノードの一致）×（矢印の一致）。矢印は、両方の図にあるノードどうしのつながりで比べる。片方にしかないノードは飛ばしてつなぐので、1 つの手順を 2 つに分けただけなら矢印では減点しない（ノードの一致で少し減る） |
| シーケンス図 | 順番を保ったまま対応するメッセージの割合。送り手と受け手が同じなら 0.5、文言が近いほど 1 に近づく。`alt` / `opt` / `loop` / `par` も 1 つとして数える |
| ガント | 作業ごとに、名前・開始日・終了日が合った割合（`after` は日付に直してから比べる）。日だけの作業は節目でも 1 日の作業でもよい。28 日以上の作業は終了日の 1 日の差を許す（「1か月」は 30 日でも 31 日でもよい） |

- どれも適合率と再現率から F1 を出す。余計なものを足しても、必要なものを落としても下がる。
- ラベルは、ひらがなを除いた文字（漢字・カタカナ・英数字）が順にどれだけ共通するかで対応づける。「在庫を確認する」と「在庫確認」は同じとみなす。片方がもう片方を含むとき（「アプリ」と「フードデリバリーのアプリ」）も同じとみなす。
- 英語のラベル（日本語の文字がなく、どちらかが 2 語以上）は、文字ではなく語で比べる。a / the / to などの小さい語を除き、語尾（-s、-ed、-ing）を落として、順番によらず共通する語の割合を見る。"Check stock" と "Stock check"、"Approve the refund" と "Refund approval" は同じとみなす。日本語のラベルの採点は変わらない（採用中のモデルの結果を採点し直して、0.807 と 116/130 のままであることを確かめた）。
- `conditions` は、「はい」と「いいえ」が逆になっていないかを見る。英語では not / no / out of / fail / reject などを否定として扱う。問いの否定が逆のとき（「不備がある？」と「不備がない？」）は答えも逆で合っているとみなす。「はい」と「在庫あり」のように比べられない組は数えない。
- 正解は 1 つの読み方にすぎない。文章があいまいなケースでは、正しい図でも満点にならないことがある。値そのものより、モデルどうしの差を見る。
- ツールは始めに正解を確かめる（読めること、種類、`structure` の数、自分自身と比べて満点になること）。合わないものがあれば止まる。

保存済みの結果を、モデルを動かさずに採点し直せる（正解や採点を変えたあとに使う）。

```bash
dotnet run --project desktop/tools/TextToMermaidEval -c Release -- --rescore desktop/out/eval/<日時>.json
```

- `--kind given` を付けると、ケースの図の種類を指定して作らせる（アプリで種類を選んだときと同じ）。付けなければ種類もモデルが選ぶ。
- 学習済みのモデルの作り直しは、種類をモデルが選んだときは、まずその種類を付けてもう一度出す（温度 0）。それでも読めないときと、種類を指定したときは、同じ依頼を温度 0.7 でもう一度出す（毎回結果が変わる）。モデルそのものを比べるときは `--repairs 0` にする。アプリは最大 2 回作り直させる。
- 英語のケースは 90 件（フローチャート 50、シーケンス 28、ガント 12）。日本語のケースの翻訳ではなく、同じ型（分岐のある業務、システムや担当者が出てくる手順、機器の動きや状態の移り変わり、主語のない短い手順、矢印・箇条書き・番号つき、階層、やり取り、日程）を英語で書き起こした。正解の書き方は日本語と同じで、分岐は "Yes" / "No"。
- 日本語のケースは 150 件（フローチャート 82、シーケンス 48、ガント 20）。2026-11-13 に足した 50 件は、小さいモデルが種類を取り違えやすい文章（システムや担当者が出てくる手順、機器の動き、状態の移り変わり、矢印や箇条書き、手順のように読めるやり取り）。

## モデルの用意（`desktop/models/`、Git の管理外）

ONNX Runtime GenAI の形式（`genai_config.json` のあるフォルダ）が要る。

### Qwen3.5-2B / 4B（Apache 2.0、比べる用）

genai 形式の配布がないため、model builder で int4 に変換する。
- builder に `-m` でモデル名を渡すと Hugging Face のトークンを求められる。そのため、重みは先に `hf download` で取得し、`-i` でフォルダを渡す。
- Qwen3.5 は画像も扱うモデルなので、`text_only=true` を付けて文章の部分だけを変換する。
- `exclude_mtp=true` も付けて、投機的デコード用の MTP ヘッドを外す。付けないと、読み込むときに "GetMemoryInfo for CPU should not be used." で失敗する（0.19.0、CPU で確認）。

```bash
py -3.12 -m venv desktop/out/venv
desktop/out/venv/Scripts/pip install torch --index-url https://download.pytorch.org/whl/cpu
desktop/out/venv/Scripts/pip install onnxruntime-genai==0.19.0 transformers huggingface_hub onnx onnx_ir
desktop/out/venv/Scripts/hf download Qwen/Qwen3.5-2B --local-dir desktop/out/hf/Qwen3.5-2B
desktop/out/venv/Scripts/python -m onnxruntime_genai.models.builder -i desktop/out/hf/Qwen3.5-2B -o desktop/models/qwen3.5-2b -p int4 -e cpu -c desktop/out/hf/cache --extra_options int4_accuracy_level=4 text_only=true exclude_mtp=true
```

4B は、上の 2 か所の `2B` を `4B` に、`2b` を `4b` に変えて実行する。

### Phi-4-mini-instruct（MIT）

Microsoft が genai 形式で配布している。

```bash
desktop/out/venv/Scripts/pip install huggingface_hub
desktop/out/venv/Scripts/hf download microsoft/Phi-4-mini-instruct-onnx --include "cpu_and_mobile/cpu-int4-rtn-block-32-acc-level-4/*" --local-dir desktop/out/phi4
```

`desktop/out/phi4/cpu_and_mobile/cpu-int4-rtn-block-32-acc-level-4` を `--model` に渡す。
