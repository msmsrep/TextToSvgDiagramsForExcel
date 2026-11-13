# MermaidTraining

文章から Mermaid を作る小さなモデルを、このアプリの用途向けに学習させるための道具（設計書 §14.5）。学習データ作り → 語彙を絞る（`prune_vocab.py`）→ 学習（`train.py`）→ ONNX への変換（`export.py`）→ 評価（`TextToMermaidEval`）の順に使う。

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

2026-11-13 時点で 620 組（フローチャート 350、シーケンス 170、ガント 100）。すべて `check_pairs.py` を通る。

`022`〜`027` の 120 組は、評価で外した型を狙って足した。外した 16 件のうち 13 件は、手順をシーケンス図にしたものだった（文章にシステムや担当者の名前が出てくる、主語のない短い手順、機器の動き、矢印でつないだ語）。残りは料理の手順への空の答え 2 件と、入れ子の `alt` の崩れ 1 件。

| ファイル | 組 | 中身 |
|---|---|---|
| `022` `023` | 40 | システムや担当者が出てくる、分岐のある手順 → フローチャート |
| `024` | 20 | 機器の動き、状態の移り変わり、決まった時刻に動く処理 → フローチャート |
| `025` | 20 | 料理や身の回りの、主語のない短い手順 → フローチャート |
| `026` | 20 | 矢印でつないだ語、箇条書き、番号つきの手順 → フローチャート |
| `027` | 20 | 「A が B に〜する、B が〜を返す」が続くやり取り → シーケンス図（対比用。`alt` は入れ子にしない） |

すべてこの PC の中で動く。外へは何も送らない。

## 準備（GPU 用の Python 環境）

モデルの変換用の `desktop/out/venv`（CPU 版の PyTorch）とは分けている。RTX 50 シリーズでは CUDA 12.8 以降のビルドが必要。

```bash
py -3.12 -m venv desktop/out/venv-train
desktop/out/venv-train/Scripts/pip install torch==2.14.1+cu130 --index-url https://download.pytorch.org/whl/cu130
desktop/out/venv-train/Scripts/pip install transformers==5.22.2 accelerate peft
desktop/out/venv-train/Scripts/pip install onnxruntime-genai==0.19.0 onnx onnx_ir pyarrow
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

## 語彙を絞る（`prune_vocab.py`）

学習させる側のモデルは Qwen3.5-0.8B（Apache 2.0）。このモデルはあらゆる言語のために 248,320 語のトークンを持ち、その表が int4 のモデルの中でいちばん大きい（541MB 中 159MB）。日本語と英語でよく使う 40,000 語だけを残した写しを作り、それを学習の元にする。

```bash
desktop/out/venv-train/Scripts/hf download Qwen/Qwen3.5-0.8B --local-dir desktop/out/hf/Qwen3.5-0.8B
desktop/out/venv-train/Scripts/hf download wikimedia/wikipedia 20231101.ja/train-00002-of-00015.parquet 20231101.en/train-00002-of-00041.parquet --repo-type dataset --local-dir desktop/out/corpus/wikipedia
desktop/out/venv-train/Scripts/python -I desktop/tools/MermaidTraining/prune_vocab.py --base desktop/out/hf/Qwen3.5-0.8B --out desktop/out/hf/Qwen3.5-0.8B-jaen --corpus desktop/out/corpus/wikipedia/20231101.ja/train-00002-of-00015.parquet desktop/out/corpus/wikipedia/20231101.en/train-00002-of-00041.parquet --always desktop/out/train-data/claude.jsonl desktop/out/train-data/qwen4b/filtered.jsonl
```

- 残す語: 単独のバイト、日本語（cp932）と ASCII で書ける 1 文字（合わせて 5,417 語）、学習データと会話の枠（`<|im_start|>assistant` や ```` ```mermaid ```` など）に出てくる語（6,607 語）、あとは Wikipedia の日本語と英語（それぞれ 5,000 万字、重みは同じ）でよく出る順。特殊トークン（276 語ぶん）は並びを変えずに残す。
- 残さなかった語を作る結合ルールもトークナイザーから消す。その語を使っていた文章は、残した小さい語（最後は 1 バイト）に分かれるので、読めない・書けない文字は出ない。トークンの数が少し増えるだけ（Wikipedia の別の部分で日本語 1.011 倍、英語 1.049 倍。学習データは変わらず、評価の 100 件は 6,586 → 6,609）。
- 出力は元と同じ形のモデルのフォルダ（埋め込みの行、トークナイザー、設定の中のトークン番号を付け替える）。`train.py` と `export.py` の `--base` にそのまま渡す。内訳は `pruned-vocab.json` に残る。
- 元の語彙で学習したモデルには使えない（トークンの番号と分かれ方が変わる）。学習し直す。
- Wikipedia はどの語を残すか数えるためだけに使う。取得するだけで、外へは何も送らない。

## 学習

```bash
PYTHONIOENCODING=utf-8 desktop/out/venv-train/Scripts/python -I desktop/tools/MermaidTraining/train.py --base desktop/out/hf/Qwen3.5-0.8B-jaen --data desktop/out/train-data/claude.jsonl --out desktop/out/mermaid-0.8b
```

- LoRA（rank 16、すべての線形層）で学習し、最後に元のモデルへ結合して `<out>/merged` に保存する。損失は `<out>/log.json`。
- モデルに見せるのは文章だけ。3 割の組には、アプリで図の種類を選んだときと同じ「(Use a flowchart.)」などを付ける。答えは ```` ```mermaid ```` のコードブロック 1 つ。指示や例は見せないので、アプリは学習済みのモデルに文章だけを送る（`MermaidPrompt.TunedMessages`）。
- 4B の組も使うときは `--data` に並べる。Claude の組は 2 回並べて、数の多い 4B の組に埋もれないようにする（`--data desktop/out/train-data/claude.jsonl desktop/out/train-data/claude.jsonl desktop/out/train-data/qwen4b/filtered.jsonl`）。
- 元の語彙（25 万語）のままだと、12GB の VRAM では長い組が集まった回にメモリがあふれ、`--batch 2 --grad-accum 8` にする必要があった（1 ステップ 約 11 秒）。4 万語に絞ったモデルなら既定の `--batch 8 --grad-accum 2` で足りる（1 ステップ 約 2 秒）。
- 5% の組は学習に使わず、損失を測るのに使う（`--val`）。
- 動作の確認だけなら `--device cpu --batch 2 --grad-accum 1 --max-steps 3`。

## ONNX への変換と評価

```bash
PYTHONIOENCODING=utf-8 desktop/out/venv-train/Scripts/python -I desktop/tools/MermaidTraining/export.py --base desktop/out/hf/Qwen3.5-0.8B-jaen --merged desktop/out/mermaid-0.8b/merged --out desktop/models/mermaid-0.8b
dotnet run --project desktop/tools/TextToMermaidEval -c Release -- --model desktop/models/mermaid-0.8b
```

- ONNX Runtime GenAI の model builder は、Qwen3.5 を元の形（画像も扱うモデル）でしか読めない。`train.py` が保存するのは文章の部分だけなので、`export.py` は元のモデルの写しに学習した重みを差し込んでから（重みの名前は同じ）、文章の部分を int4 の CPU 用モデルにする。
- 位置の表（sin / cos）は 1 位置 1 行で、元の設定（262,144 位置）のままだと 67MB になる。アプリが送るのは数百トークンなので、`export.py` は 4,096 位置に縮めてから変換する（`--max-positions`）。結果は変わらない。
- 大きさは、元の語彙のままで 473MB（位置の表を縮める前は 536MB）、4 万語に絞ったモデルで 329MB（どちらも下の「素の int4」での値）。
- int4 への変換のしかたで精度が大きく変わる（下の「int4 への変換で落ちる精度」）。`export.py` の既定は `algo_config=k_quant block_size=16`。変えるときは `--options` に並べる。
- 変換前のモデルを同じケースで測るには `eval_merged.py` を使う（PyTorch、作り直しなし）。変換後と比べれば、外した原因が学習か変換かが分かる。

```bash
desktop/out/venv-train/Scripts/python -I desktop/tools/MermaidTraining/eval_merged.py desktop/out/mermaid-0.8b/merged
```
- 変換したフォルダには `text-to-mermaid.json` を置く。評価ツールとアプリは、このファイルがあれば学習済みのモデルとみなし、文章だけを送る。

動作の確認（2026-11-12、CPU で 3 ステップだけ学習）: 学習・結合・変換・評価まで通った。評価では 5 件中 3 件が読めた。3 ステップでは中身はまだ学習できていない。

## 結果（2026-11-13、評価 100 件、CPU int4）

| モデル | 大きさ | 読めた | 種類も合う | キーワード再現率 | 平均 秒 | 最大 秒 |
|---|---|---|---|---|---|---|
| Qwen3.5-4B（汎用） | 2.6GB | 99/100 | 91/100 | 97% | 14.8 | 56.6 |
| `mermaid-0.8b-claude`（Claude の 500 組、3 エポック、GPU で 3 分） | 536MB | 98/100 | 91/100 | 96% | 1.9 | 41.1 |
| `mermaid-0.8b-mix`（Claude ×2 ＋ 4B の 2,090 組、3 エポック、GPU で約 1 時間） | 536MB | 99/100 | 94/100 | 95% | 1.5 | 6.4 |
| 同じ重みで位置の表だけ縮めたもの | 473MB | 99/100 | 94/100 | 95% | 1.4 | 5.9 |
| `mermaid-0.8b-jaen`（4 万語に絞った元モデルで、`mix` と同じデータ・同じ設定。GPU で 33 分） | 329MB | 100/100 | 93/100 | 96% | 1.1 | 1.6 |

検証用の損失は、A が 0.98 → 0.20（2 エポック目が最小）、B が 0.79 → 0.21（同）。3 エポック目は少し上がるので、2 エポックでもよい。`jaen` は 0.76 → 0.21（同）で、語彙を絞っても損失は変わらない。

`jaen` は 1 件を作り直しで読めるようにした（1 回目で読めたのは 99/100。アプリは学習済みのモデルを作り直させないので、アプリでは 99/100 にあたる）。種類の 94 と 93 の差は 100 件では誤差の範囲。学習データは日本語だけだが、英語の文章 3 つ（分岐のある手順、やり取り、日程）を試すと、どれも正しい種類の読める図になった。英語の評価ケースはまだない。詳しくは設計書 §14.5。

## 結果（2026-11-13、評価 150 件、作り直しなし）

評価を 150 件に増やし、構造（分岐・参加者・作業の数）も見るようにした（`TextToMermaidEval/README.md`）。上の表（100 件）とは比べられない。

### int4 への変換で落ちる精度

`mermaid-0.8b-jaen`（追加データなし）を、変換のしかただけ変えて測った。種類はモデルが選ぶ。

| 変換 | 大きさ | 読めた | 種類も合う | 構造 |
|---|---|---|---|---|
| 変換前（PyTorch、bf16） | — | 150/150 | 145/150 | — |
| 素の int4（これまで） | 329MB | 147/150 | 134/150 | 133/150 |
| `algo_config=k_quant` | 338MB | 148/150 | 142/150 | 138/150 |
| `matmul_mixed_precision=last_matmul:int8` | 349MB | 148/150 | 136/150 | 135/150 |
| `algo_config=k_quant_mixed` | 380MB | 149/150 | 142/150 | 138/150 |
| `algo_config=k_quant_linear`（線形注意の層を int8） | 548MB | 150/150 | 145/150 | 144/150 |
| `-p int8` | 630MB | 150/150 | 146/150 | 145/150 |

- 外した 16 件のうち 11 件は、学習ではなく素の int4 への変換で起きていた。読めない答え（空の答え、```` ```merup ````、`A->|`、`theme` など）もすべて変換後だけに出る。
- `k_quant` に変えるだけで、大きさをほとんど変えずに大半が戻る。出力層だけを int8 にしても戻らない。効くのは本体（線形注意の層）の細かさ。

### 学習データの追加と、採用した変換

`mermaid-0.8b-jaen2` は、Claude の 620 組 ×2 ＋ 4B の 2,090 組で、ほかは `jaen` と同じ設定（3 エポック、GPU で 18 分）。検証用の損失は 0.25 → 0.23 → 0.25（2 エポック目が最小）。

| モデルと変換 | 大きさ | 種類 | 読めた | 種類も合う | 構造 |
|---|---|---|---|---|---|
| `jaen`、素の int4（追加前） | 329MB | 自動 | 147/150 | 134/150 | 133/150 |
| 〃 | 〃 | 指定 | 150/150 | 150/150 | 148/150 |
| `jaen2`、変換前 | — | 自動 | 150/150 | 148/150 | — |
| 〃 | — | 指定 | 150/150 | 150/150 | — |
| `jaen2`、素の int4 | 329MB | 自動 | 145/150 | 139/150 | 138/150 |
| `jaen2`、`k_quant` | 338MB | 自動 | 147/150 | 144/150 | 140/150 |
| 〃 | 〃 | 指定 | 149/150 | 149/150 | 145/150 |
| **`jaen2`、`k_quant` ＋ `block_size=16`（採用）** | 410MB | 自動 | 150/150 | 148/150 | 142/150 |
| 〃 | 〃 | 指定 | 150/150 | 150/150 | 144/150 |
| `jaen2`、`k_quant_linear` | 548MB | 自動 | 150/150 | 148/150 | 148/150 |

- 追加した 120 組で、変換前の「種類も合う」は 145 → 148 になった。残る 2 件は `seq-cache`（フローチャートにした）と `flow-support-bot`（シーケンス図にした）。
- 採用した変換は、変換前と同じ 150/150、148/150。大きさは 410MB で、この日のはじめ（536MB）より 24% 小さい。338MB の `k_quant` だけの版は、150 件中 3 件が読めない答えになる。
- 「構造」は 142〜148 で、変換が粗いほど下がる（分岐が 1 つ足りない、参加者が 1 人足りない）。数件の差は誤差の範囲でもある。
- 作り直し（同じ依頼を温度 0.7 でもう一度、最大 2 回）は、素の int4 の読めない 5 件のうち 2 件を直した。`k_quant` の 3 件は 1 つも直らなかった（最初の語から外れてしまう型で、引き直しても同じところで外れる）。
