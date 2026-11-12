# MermaidTraining

文章から Mermaid を作る小さなモデルを、このアプリの用途向けに学習させるための道具（設計書 §14.5）。学習データ作り → 学習（`train.py`）→ ONNX への変換（`export.py`）→ 評価（`TextToMermaidEval`）の順に使う。

学習データは 2 つの出どころを組み合わせる。

| 出どころ | 量 | 役割 |
|---|---|---|
| Claude（Claude Code のセッションで手書き） | 数百〜1,000 組 | 質の高い中心のデータ。分岐、ループ、並行、階層、`alt` などを正しく押さえる |
| ローカルの Qwen3.5-4B（`make_data.py`） | 数千組 | 量を補う。中身に粗さがあるため、`filter_pairs.py` でアプリの書き方にそろった組だけ残す |

- `data/claude/*.txt`: Claude が書いた組（Git で管理する）。`check_pairs.py` で確かめて `desktop/out/train-data/claude.jsonl` にする。
- `make_data.py`: 教師モデルに文章を書かせ、それを Mermaid にさせ、`mermaid.parse` で確かめた組だけを残す。
- `seeds.ja.json`: `make_data.py` が使う題材・構造・書き方の候補。
- どちらも、評価用の `desktop/tools/TextToMermaidEval/cases.ja.json` と同じ題材は避け、似た文章は落とす。

## Claude が書いた組

```bash
PYTHONIOENCODING=utf-8 desktop/out/venv-train/Scripts/python -I desktop/tools/MermaidTraining/check_pairs.py
```

`.txt` の書式（種類は flowchart / sequence / gantt）:

```
=== flowchart
文章（複数行でもよい）
---
flowchart TD
    A["…"] --> B["…"]
```

コードの書き方はアプリの指示（`MermaidPrompt.cs`）にそろえる: フローチャートは `flowchart TD`、短い ID、ラベルは `"…"` で囲む。シーケンス図は `participant X as 名前`、依頼は `->>`、返事は `-->>`。ガントは `dateFormat YYYY-MM-DD` と `section`、続く作業は `after`、節目は `milestone`。

2026-11-12 時点で 500 組（フローチャート 250、シーケンス 150、ガント 100）。すべて `check_pairs.py` を通る。

すべてこの PC の中で動く。外へは何も送らない。

## 準備（GPU 用の Python 環境）

モデルの変換用の `desktop/out/venv`（CPU 版の PyTorch）とは分けている。RTX 50 シリーズでは CUDA 12.8 以降のビルドが必要。

```bash
py -3.12 -m venv desktop/out/venv-train
desktop/out/venv-train/Scripts/pip install torch==2.14.1+cu130 --index-url https://download.pytorch.org/whl/cu130
desktop/out/venv-train/Scripts/pip install transformers==5.22.2 accelerate peft
desktop/out/venv-train/Scripts/pip install onnxruntime-genai==0.19.0 onnx onnx_ir
```

教師モデルの重みは、`TextToMermaidEval/README.md` の手順で `desktop/out/hf/Qwen3.5-4B` に取得済みのものを使う（bf16 で約 8GB の VRAM を使う）。

## データ作り

```bash
PYTHONIOENCODING=utf-8 desktop/out/venv-train/Scripts/python -I desktop/tools/MermaidTraining/make_data.py --teacher desktop/out/hf/Qwen3.5-4B --count 3000 --batch 8 --out desktop/out/train-data/qwen4b
```

- 12GB の VRAM では `--batch 16` だと、作り直しで会話が長くなったときにメモリがあふれ、極端に遅くなる。`--batch 8` にする。

- 結果は `desktop/out/train-data/data.jsonl`（残した組）と `rejects.jsonl`（落とした組と理由）。止めても、もう一度実行すれば続きから作る。
- `--seed` を変えると別の組み合わせで作る。同じ `--out` に足していける。

1 件の流れ:

1. 図の種類（フローチャート 5 割、シーケンス 3 割、ガント 2 割）、題材、構造、書き方を選び、教師に文章を書かせる（毎回違う文章になるよう、ランダムに選びながら生成する）。
2. アプリと同じ指示（`MermaidPrompt.cs` の写し）に種類を指定して Mermaid を作らせる。読めなければエラー文を添えて作り直させる（最大 2 回）。
3. `style` などの装飾行と空行を消して形をそろえる。
4. 次のものは落とす: 読めない、種類が違う、ラベルの言葉が文章にあまり出てこない（`grounding` が 0.6 未満。シーケンス図は 0.45 未満）、評価用の文章や既にある組と似すぎている。

`data.jsonl` の 1 行:

```json
{"id": "flowchart-00002", "type": "flowchart", "text": "…", "code": "flowchart TD\n    …", "topic": "…", "structure": "…", "style": "…", "attempts": 1, "grounding": 0.85, "teacher": "Qwen3.5-4B"}
```

## 試した結果（2026-11-12、RTX 5070、Qwen3.5-4B bf16、16 件ずつ）

- 64 件中 56 件が残った（フローチャート 26、シーケンス 15、ガント 15）。すべて作り直しなしで読めた。1 件 約 8 秒なので、3,000 件なら約 6〜7 時間かかる。
- 文法は通るが、中身にはまだ粗さがある。教師の文章がぎこちない、ガントの「並行」を順番にしてしまう、分岐の向きがおかしい、など。教師の質が、学習させるモデルの質の上限になる。

本番（2026-11-13、`--count 3000 --batch 8`）: 3,000 件中 2,641 組が残った（1 件 約 4.4 秒、約 3.5 時間）。

## ふるい（`filter_pairs.py`）

```bash
PYTHONIOENCODING=utf-8 desktop/out/venv-train/Scripts/python -I desktop/tools/MermaidTraining/filter_pairs.py desktop/out/train-data/qwen4b/data.jsonl desktop/out/train-data/qwen4b/filtered.jsonl
```

小さいモデルは見たものをそのまま真似るため、アプリの書き方にそろった組だけ残す。フローチャートはラベルをすべて `"…"` で囲み、`subgraph` なし、ノード 14 個まで。シーケンス図は参加者を `as` で宣言し、6 人・12 通まで。ガントは `dateFormat YYYY-MM-DD`、作業 10 個まで。文章は 300 字まで。ラベルの言葉が文章に出てくる割合（`grounding`）は 0.65 以上（シーケンス図は 0.5 以上）。2,641 組中 2,090 組が残った（落ちた理由で多いのは、シーケンス図の grounding 178、ラベルの囲みなし 148、subgraph 70）。

## 学習

学習させる側のモデルは Qwen3.5-0.8B（Apache 2.0）。

```bash
desktop/out/venv-train/Scripts/hf download Qwen/Qwen3.5-0.8B --local-dir desktop/out/hf/Qwen3.5-0.8B
PYTHONIOENCODING=utf-8 desktop/out/venv-train/Scripts/python -I desktop/tools/MermaidTraining/train.py --base desktop/out/hf/Qwen3.5-0.8B --data desktop/out/train-data/claude.jsonl --out desktop/out/mermaid-0.8b
```

- LoRA（rank 16、すべての線形層）で学習し、最後に元のモデルへ結合して `<out>/merged` に保存する。損失は `<out>/log.json`。
- モデルに見せるのは文章だけ。3 割の組には、アプリで図の種類を選んだときと同じ「(Use a flowchart.)」などを付ける。答えは ```` ```mermaid ```` のコードブロック 1 つ。指示や例は見せないので、アプリは学習済みのモデルに文章だけを送る（`MermaidPrompt.TunedMessages`）。
- 4B の組も使うときは `--data` に並べる。Claude の組は 2 回並べて、数の多い 4B の組に埋もれないようにする（`--data desktop/out/train-data/claude.jsonl desktop/out/train-data/claude.jsonl desktop/out/train-data/qwen4b/filtered.jsonl`）。
- 12GB の VRAM では、組が多いと長い組が集まった回にメモリがあふれる（出力の語彙が 25 万語あるため）。そのときは `--batch 2 --grad-accum 8` にする（合計の量は同じ）。ただし 1 ステップ 約 11 秒と遅くなる（`--batch 8` なら 1.6 秒）。
- 5% の組は学習に使わず、損失を測るのに使う（`--val`）。
- 動作の確認だけなら `--device cpu --batch 2 --grad-accum 1 --max-steps 3`。

## ONNX への変換と評価

```bash
PYTHONIOENCODING=utf-8 desktop/out/venv-train/Scripts/python -I desktop/tools/MermaidTraining/export.py --base desktop/out/hf/Qwen3.5-0.8B --merged desktop/out/mermaid-0.8b/merged --out desktop/models/mermaid-0.8b
dotnet run --project desktop/tools/TextToMermaidEval -c Release -- --model desktop/models/mermaid-0.8b
```

- ONNX Runtime GenAI の model builder は、Qwen3.5 を元の形（画像も扱うモデル）でしか読めない。`train.py` が保存するのは文章の部分だけなので、`export.py` は元のモデルの写しに学習した重みを差し込んでから（重みの名前は同じ）、文章の部分を int4 の CPU 用モデルにする。0.8B で約 540MB。
- 変換したフォルダには `text-to-mermaid.json` を置く。評価ツールとアプリは、このファイルがあれば学習済みのモデルとみなし、文章だけを送る。

動作の確認（2026-11-12、CPU で 3 ステップだけ学習）: 学習・結合・変換・評価まで通った。評価では 5 件中 3 件が読めた。3 ステップでは中身はまだ学習できていない。

## 結果（2026-11-13、評価 100 件、CPU int4）

| モデル | 大きさ | 読めた | 種類も合う | キーワード再現率 | 平均 秒 | 最大 秒 |
|---|---|---|---|---|---|---|
| Qwen3.5-4B（汎用） | 2.6GB | 99/100 | 91/100 | 97% | 14.8 | 56.6 |
| `mermaid-0.8b-claude`（Claude の 500 組、3 エポック、GPU で 3 分） | 536MB | 98/100 | 91/100 | 96% | 1.9 | 41.1 |
| `mermaid-0.8b-mix`（Claude ×2 ＋ 4B の 2,090 組、3 エポック、GPU で約 1 時間） | 536MB | 99/100 | 94/100 | 95% | 1.5 | 6.4 |

検証用の損失は、A が 0.98 → 0.20（2 エポック目が最小）、B が 0.79 → 0.21（同）。3 エポック目は少し上がるので、2 エポックでもよい。詳しくは設計書 §14.5。
