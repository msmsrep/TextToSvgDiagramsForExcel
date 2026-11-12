# MermaidTraining

文章から Mermaid を作る小さなモデルを、このアプリの用途向けに学習させるための道具（設計書 §14.5）。今あるのは学習データ作りまで。

学習データは 2 つの出どころを組み合わせる。

| 出どころ | 量 | 役割 |
|---|---|---|
| Claude（Claude Code のセッションで手書き） | 数百〜1,000 組 | 質の高い中心のデータ。分岐、ループ、並行、階層、`alt` などを正しく押さえる |
| ローカルの Qwen3.5-4B（`make_data.py`） | 数千組 | 量を補う。中身に粗さがあるため、Claude が採点して悪い組を落とす（未着手） |

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
