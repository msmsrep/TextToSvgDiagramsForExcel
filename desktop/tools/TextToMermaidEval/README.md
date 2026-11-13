# TextToMermaidEval

文章から Mermaid を作る処理を `cases.ja.json`（日本語 150 件）で測るツール。ルールベース（`src/core/textToMermaid.ts`）と、ONNX Runtime GenAI で動かすローカルモデル（`src/TextToSvgDiagramsForExcel.Generation`）を比べる。

- コードの検証は `scripts/mermaid-validate.mjs`（Node で `mermaid.parse`）を標準入出力でつないで行う。サーバーは立てず、外へ通信もしない。
- 結果は `desktop/out/eval/<日時>.json`（生成したコードとモデルの回答全文）と `.md`（表）に保存する。

## 実行

```bash
# ルールベースだけ
dotnet run --project desktop/tools/TextToMermaidEval

# ローカルモデルも測る（作り直しは最大 2 回）
dotnet run --project desktop/tools/TextToMermaidEval -c Release -- --model desktop/models/mermaid-0.8b-jaen2-16 --repairs 2
```

使うモデルは、この用途に学習させた `mermaid-0.8b-jaen2-16`（作り方は `desktop/tools/MermaidTraining/README.md`）。フォルダに `text-to-mermaid.json` があれば、指示や例を付けずに文章だけを送る。

## 指標

| 列 | 意味 |
|---|---|
| valid | mermaid が読めたコードの数 |
| valid & right type | そのうち期待した図の種類（flowchart / sequence / gantt）のもの |
| structure | 種類が合ったうえで、文章にある分岐（フローチャート）、参加者（シーケンス図）、作業（ガント）が、ケースに書いた数以上あるものの数。分岐は、2 つ以上の行き先へ矢印が出ているノードを数える |
| valid on 1st try | 作り直しなしで読めた数 |
| keyword recall | 期待する語（`keywords`）がコードに含まれた割合。内容の目安で、分岐の正しさまでは見ない |
| avg s / max s | 1 件あたりの時間（作り直しを含む） |

`structure` は数が足りているかを見るだけで、分岐の向きや並びの正しさまでは見ない。そこは `.json` のコードを描画して目で確かめる。

- `--kind given` を付けると、ケースの図の種類を指定して作らせる（アプリで種類を選んだときと同じ）。付けなければ種類もモデルが選ぶ。
- 学習済みのモデルの作り直しは、同じ依頼を温度 0.7 でもう一度出す（毎回結果が変わる）。モデルそのものを比べるときは `--repairs 0` にする。アプリは最大 2 回作り直させる。
- ケースは 150 件（フローチャート 82、シーケンス 48、ガント 20）。2026-11-13 に足した 50 件は、小さいモデルが種類を取り違えやすい文章（システムや担当者が出てくる手順、機器の動き、状態の移り変わり、矢印や箇条書き、手順のように読めるやり取り）。

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
