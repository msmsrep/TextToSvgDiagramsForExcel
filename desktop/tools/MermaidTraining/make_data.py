"""Makes training pairs (Japanese text -> Mermaid code) with a local teacher model.

    python make_data.py --teacher desktop/out/hf/Qwen3.5-4B --count 3000

1. Picks a topic, structure and writing style from seeds.ja.json and has the
   teacher write a description (sampled, so the texts vary).
2. Has the teacher turn the description into Mermaid with the diagram type given
   (greedy), using the same instructions as the app (MermaidPrompt.cs).
3. Checks the code with mermaid.parse (scripts/mermaid-validate.mjs); invalid code
   is sent back with the error, as MermaidGenerator does.
4. Keeps a pair only when the code is valid, of the asked type, its labels come
   from the text, and the text is not close to an evaluation case or another pair.

Kept pairs go to <out>/data.jsonl and dropped ones, with the reason, to
<out>/rejects.jsonl. Running again continues where it stopped.
Everything runs on this PC: nothing is sent anywhere.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
EVAL_CASES = REPO / "desktop" / "tools" / "TextToMermaidEval" / "cases.ja.json"
EVAL_CASE_FILES = sorted(EVAL_CASES.parent.glob("cases.*.json"))  # every language
VALIDATOR = REPO / "scripts" / "mermaid-validate.mjs"

KIND_HINT = {"flowchart": "flowchart", "sequence": "sequenceDiagram", "gantt": "gantt chart"}
KIND_WEIGHTS = {"flowchart": 0.5, "sequence": 0.3, "gantt": 0.2}
KIND_NAME_JA = {"flowchart": "業務や手順の流れ、または構造", "sequence": "人やシステムの間のやりとり", "gantt": "日程や作業の予定"}

# --- The app's instructions (keep in step with MermaidPrompt.cs) --------------

SYSTEM = """You turn a description into Mermaid diagram code.

Rules:
- Answer with one ```mermaid code block and nothing else.
- Pick the diagram type:
  - flowchart: steps, procedures, decisions, structures and hierarchies.
  - sequenceDiagram: messages or requests between people or systems.
  - gantt: schedules with dates or durations.
- Write labels in the language of the description. Keep them short; leave out "まず", "次に" and the like.
- flowchart: begin with `flowchart TD`. Give nodes short IDs and quoted labels: A["label"].
  Decisions use B{"question"} and labeled edges: B -->|"yes"| C.
- sequenceDiagram: declare each person or system: participant U as User.
  Requests: U->>S: text. Replies: S-->>U: text.
- gantt: use `dateFormat YYYY-MM-DD`, `section` lines and tasks like `Design :a1, 2026-01-05, 3d`.
  A task after another: `Build :a2, after a1, 5d`.
- Do not put ; or # in labels."""

EXAMPLES = [
    ("user", "申請者が申請書を作成して提出する。上長が内容を確認し、問題なければ承認、問題があれば差し戻す。承認されたら経理が支払う。"),
    ("assistant", """```mermaid
flowchart TD
    A["申請書を作成"] --> B["提出"]
    B --> C{"上長が確認<br>問題ない？"}
    C -->|"はい"| D["承認"]
    C -->|"いいえ"| E["差し戻し"]
    E --> A
    D --> F["経理が支払い"]
```"""),
    ("user", "利用者がアプリでログインすると、アプリは認証サーバーにトークンを要求する。認証サーバーはトークンを返し、アプリはホーム画面を表示する。"),
    ("assistant", """```mermaid
sequenceDiagram
    participant U as 利用者
    participant A as アプリ
    participant S as 認証サーバー
    U->>A: ログイン
    A->>S: トークンを要求
    S-->>A: トークン
    A-->>U: ホーム画面を表示
```"""),
]


def mermaid_messages(text: str, kind: str) -> list[dict]:
    messages = [{"role": "system", "content": SYSTEM}]
    messages += [{"role": r, "content": c} for r, c in EXAMPLES]
    messages.append({"role": "user", "content": f"{text}\n\n(Use a {KIND_HINT[kind]}.)"})
    return messages


def repair_message(error: str) -> dict:
    return {"role": "user", "content": f"Mermaid could not read that code:\n{error}\n\nFix the code. Answer with the corrected ```mermaid code block only."}


def writer_messages(spec: dict) -> list[dict]:
    lines = [
        f"次の条件で、{KIND_NAME_JA[spec['kind']]}を説明する日本語の文章を1つ書いてください。",
        f"- 題材: {spec['topic']}",
        f"- 内容: {spec['structure']}",
        f"- 書き方: {spec['style']}",
    ]
    if spec["kind"] == "gantt":
        lines.append(f"- 最初の作業は{spec['start']}に始める。日付や日数をはっきり書く")
    if spec["kind"] == "sequence":
        lines.append("- 誰が誰に何をするかが分かるように書く")
    lines += [
        "- 社内のメモや案内、説明書にそのまま書いてありそうな文章にする。具体的な担当者・物・数値を入れる",
        "- 「分岐」「ループ」「階層」「合流」「非同期」「プロセス」といった図の説明の言葉は使わない",
        "- 「このように」で始まるまとめや、流れの特徴の解説は書かない",
        "- 図の作り方やMermaidには触れない。題名や前置きは付けず、文章だけを答える",
        "- 長さは40〜250文字",
    ]
    return [{"role": "user", "content": "\n".join(lines)}]


# --- Reading the answers (a port of MermaidPrompt.ExtractCode) ----------------

CODE_BLOCK = re.compile(r"```[a-zA-Z]*[^\S\n]*\n(.*?)```", re.S)
HEADER = re.compile(r"^(?:flowchart|graph|sequenceDiagram|gantt|classDiagram|stateDiagram|erDiagram|pie|mindmap|timeline)\b", re.M)


def strip_thinking(answer: str) -> str:
    i = answer.rfind("</think>")
    return (answer[i + len("</think>"):] if i >= 0 else answer).strip()


def extract_code(answer: str) -> str:
    m = CODE_BLOCK.search(answer)
    if m:
        return m.group(1).strip()
    i = answer.find("```")
    if i >= 0:
        nl = answer.find("\n", i)
        return "" if nl < 0 else answer[nl + 1:].strip()
    m = HEADER.search(answer)
    return answer[m.start():].strip() if m else answer.strip()


STYLING = re.compile(r"^\s*(?:style|classDef|class|linkStyle)\s.*$\n?", re.M)


def tidy_code(code: str) -> str:
    """The code without styling lines and blank lines, so every pair looks the same."""
    code = STYLING.sub("", code)
    code = "\n".join(line.rstrip() for line in code.splitlines() if line.strip())
    return drop_self_messages(code) or code


SELF_MESSAGE = re.compile(r"^\s*(\w+)\s*(?:-->>|->>|--\)|-\)|--x|-x|-->|->)\s*\1\s*:.*$\n?", re.M)
ANY_MESSAGE = re.compile(r"^\s*(\w+)\s*(?:-->>|->>|--\)|-\)|--x|-x|-->|->)\s*(\w+)\s*:", re.M)
EMPTY_BLOCK = re.compile(r"^\s*(?:opt|loop)\b.*\n\s*end\s*$\n?", re.M)
EMPTY_BRANCH = re.compile(r"^\s*(?:alt|else|par|and)\b.*\n\s*(?:else|and|end)\b", re.M)
DECLARED = re.compile(r"^\s*(?:participant|actor)\s+(\w+).*$\n?", re.M)


def has_self_message(code: str) -> bool:
    return code.lstrip().startswith("sequenceDiagram") and bool(SELF_MESSAGE.search(code))


def drop_self_messages(code: str) -> str | None:
    """
    A sequence diagram without messages from a participant to itself ("P->>P: 保存する"):
    the diagrams show what passes between participants, not what each does inside.
    Blocks and participants left empty go too. None when too little is left to keep
    (fewer than two messages, or an alt / par with an empty branch); other code is returned as is.
    """
    if not has_self_message(code):
        return code
    code = SELF_MESSAGE.sub("", code)
    while EMPTY_BLOCK.search(code):
        code = EMPTY_BLOCK.sub("", code)
    used = {name for m in ANY_MESSAGE.finditer(code) for name in m.groups()}
    code = DECLARED.sub(lambda m: m.group(0) if m.group(1) in used else "", code).rstrip("\n")
    if len(ANY_MESSAGE.findall(code)) < 2 or EMPTY_BRANCH.search(code):
        return None
    return code


def matches_kind(kind: str, diagram_type: str | None) -> bool:
    return {
        "flowchart": diagram_type in ("flowchart", "flowchart-v2", "flowchart-elk"),
        "sequence": diagram_type == "sequence",
        "gantt": diagram_type == "gantt",
    }[kind]


def clean_text(answer: str) -> str | None:
    text = strip_thinking(answer).strip().strip("「」\"'").strip()
    text = re.sub(r"\n{3,}", "\n\n", text)
    if "```" in text or re.search(r"mermaid|フローチャート|シーケンス図|ガント", text, re.I):
        return None
    if not 20 <= len(text) <= 500:
        return None
    return text


# --- Checks on a pair ----------------------------------------------------------

LABEL_PATTERNS = [
    re.compile(r'\["(.*?)"\]|\{"(.*?)"\}|\("(.*?)"\)|\|"(.*?)"\|'),  # flowchart nodes and edge labels
    re.compile(r"participant\s+\S+\s+as\s+(.+)"),                  # sequence participants
    re.compile(r"(?:->>|-->>|->|-->|-x|--x)[^:\n]*:\s*(.+)"),          # sequence messages
    re.compile(r"^\s*(?!dateFormat|title|section|axisFormat)([^:\n]+?)\s*:", re.M),  # gantt tasks
]
YES_NO = {"はい", "いいえ", "yes", "no", "ok", "ng", "成功", "失敗", "あり", "なし"}


def labels(code: str) -> list[str]:
    found = []
    for pattern in LABEL_PATTERNS:
        for m in pattern.finditer(code):
            for g in m.groups():
                if g:
                    label = re.sub(r"<br\s*/?>", "", g).strip()
                    if label and label.lower() not in YES_NO:
                        found.append(label)
    return found


def bigrams(s: str) -> set[str]:
    s = re.sub(r"\s", "", s)
    return {s[i:i + 2] for i in range(len(s) - 1)} or {s}


def grounding(text: str, code: str) -> float:
    """How much of the labels' wording comes from the text (1 = all of it)."""
    text = text.lower()  # "Approve the refund" comes from "the refund is approved"
    text_grams = bigrams(text)
    # A one-character label (私, A) has no bigrams: count it when the text has it.
    scores = [float(l in text) if len(re.sub(r"\s", "", l)) < 2 else len(bigrams(l) & text_grams) / len(bigrams(l))
              for l in (label.lower() for label in labels(code))]
    return sum(scores) / len(scores) if scores else 0.0


def trigrams(s: str) -> set[str]:
    s = re.sub(r"\s", "", s)
    return {s[i:i + 3] for i in range(len(s) - 2)}


def jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def eval_trigrams() -> list[set[str]]:
    """The texts of the evaluation cases (all languages): pairs close to one are not used for training."""
    return [trigrams(c["text"]) for path in EVAL_CASE_FILES for c in json.loads(path.read_text(encoding="utf-8"))]


# --- mermaid.parse through Node -----------------------------------------------

class Validator:
    def __init__(self) -> None:
        self.proc = subprocess.Popen(["node", str(VALIDATOR)], cwd=REPO, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     text=True, encoding="utf-8")

    def check(self, code: str) -> dict:
        self.proc.stdin.write(json.dumps(code, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()
        return json.loads(self.proc.stdout.readline())

    def close(self) -> None:
        self.proc.stdin.close()
        self.proc.wait(timeout=10)


# --- The teacher ---------------------------------------------------------------

class Teacher:
    def __init__(self, folder: str) -> None:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self.torch = torch
        self.tokenizer = AutoTokenizer.from_pretrained(folder)
        self.tokenizer.padding_side = "left"
        self.model = AutoModelForCausalLM.from_pretrained(folder, dtype=torch.bfloat16, device_map="cuda")
        self.model.eval()

    def complete(self, conversations: list[list[dict]], max_new_tokens: int, sample: bool) -> list[str]:
        prompts = [self.tokenizer.apply_chat_template(c, tokenize=False, add_generation_prompt=True, enable_thinking=False)
                   for c in conversations]
        batch = self.tokenizer(prompts, return_tensors="pt", padding=True).to("cuda")
        options = dict(max_new_tokens=max_new_tokens, pad_token_id=self.tokenizer.pad_token_id)
        options |= dict(do_sample=True, temperature=0.8, top_p=0.95) if sample else dict(do_sample=False)
        with self.torch.inference_mode():
            out = self.model.generate(**batch, **options)
        return [self.tokenizer.decode(o[batch["input_ids"].shape[1]:], skip_special_tokens=True) for o in out]


# --- The run -------------------------------------------------------------------

def plan(seeds: dict, count: int, seed: int) -> list[dict]:
    rng = random.Random(seed)
    kinds = list(KIND_WEIGHTS)
    specs = []
    for i in range(count):
        kind = rng.choices(kinds, weights=[KIND_WEIGHTS[k] for k in kinds])[0]
        spec = {
            "id": f"{kind}-{i:05d}",
            "kind": kind,
            "topic": rng.choice(seeds[kind]["topics"]),
            "structure": rng.choice(seeds[kind]["structures"]),
            "style": rng.choice(seeds["styles"]),
        }
        if kind == "gantt":
            spec["start"] = f"{rng.randint(2026, 2028)}年{rng.randint(1, 12)}月{rng.randint(1, 28)}日"
        specs.append(spec)
    return specs


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--teacher", required=True, help="Hugging Face model folder (e.g. desktop/out/hf/Qwen3.5-4B)")
    parser.add_argument("--count", type=int, default=100, help="how many descriptions to try")
    parser.add_argument("--out", default=str(REPO / "desktop" / "out" / "train-data"))
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--repairs", type=int, default=2)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--min-grounding", type=float, default=0.6,
                        help="the least share of label wording found in the text (sequence diagrams, whose messages are paraphrased, get 0.15 less)")
    args = parser.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    data_path, rejects_path = out / "data.jsonl", out / "rejects.jsonl"
    kept, rejected = read_jsonl(data_path), read_jsonl(rejects_path)
    done = {r["id"] for r in kept + rejected}

    seeds = json.loads((HERE / "seeds.ja.json").read_text(encoding="utf-8"))
    specs = [s for s in plan(seeds, args.count, args.seed) if s["id"] not in done]
    eval_grams = eval_trigrams()
    kept_grams = [trigrams(r["text"]) for r in kept]
    print(f"{len(specs)} to make ({len(kept)} kept, {len(rejected)} rejected so far)", file=sys.stderr)

    teacher = Teacher(args.teacher)
    validator = Validator()
    started = time.time()
    try:
        with data_path.open("a", encoding="utf-8") as data_file, rejects_path.open("a", encoding="utf-8") as rejects_file:
            def reject(spec: dict, reason: str, **extra) -> None:
                rejects_file.write(json.dumps({"id": spec["id"], "reason": reason, **extra}, ensure_ascii=False) + "\n")

            for start in range(0, len(specs), args.batch):
                batch = specs[start:start + args.batch]

                # 1. Descriptions.
                texts = teacher.complete([writer_messages(s) for s in batch], 400, sample=True)
                items = []
                for spec, answer in zip(batch, texts):
                    text = clean_text(answer)
                    if text is None:
                        reject(spec, "text", answer=answer)
                        continue
                    grams = trigrams(text)
                    if max((jaccard(grams, g) for g in eval_grams), default=0) >= 0.4:
                        reject(spec, "close to an evaluation case", text=text)
                        continue
                    if max((jaccard(grams, g) for g in kept_grams), default=0) >= 0.7:
                        reject(spec, "duplicate", text=text)
                        continue
                    items.append({"spec": spec, "text": text, "messages": mermaid_messages(text, spec["kind"]), "attempts": 0})

                # 2-3. Code, checked and sent back to be fixed.
                pending = items
                while pending:
                    answers = teacher.complete([i["messages"] for i in pending], 768, sample=False)
                    retry = []
                    for item, answer in zip(pending, answers):
                        item["attempts"] += 1
                        code = tidy_code(extract_code(strip_thinking(answer)))
                        result = validator.check(code) if code else {"valid": False, "message": "The answer has no Mermaid code."}
                        kind = item["spec"]["kind"]
                        if result["valid"] and not matches_kind(kind, result.get("type")):
                            result = {"valid": False, "message": f"The diagram is a {result.get('type')}, not a {kind}."}
                        item["code"], item["check"] = code, result
                        if not result["valid"] and item["attempts"] <= args.repairs:
                            item["messages"] += [{"role": "assistant", "content": f"```mermaid\n{code}\n```"}, repair_message(result["message"])]
                            retry.append(item)
                    pending = retry

                # 4. Keep or drop.
                for item in items:
                    spec, text, code = item["spec"], item["text"], item["code"]
                    if not item["check"]["valid"]:
                        reject(spec, "invalid", text=text, code=code, error=item["check"]["message"])
                        continue
                    ground = grounding(text, code)
                    if ground < args.min_grounding - (0.15 if spec["kind"] == "sequence" else 0):
                        reject(spec, "labels not from the text", text=text, code=code, grounding=round(ground, 2))
                        continue
                    record = {"id": spec["id"], "type": spec["kind"], "text": text, "code": code,
                              "topic": spec["topic"], "structure": spec["structure"], "style": spec["style"],
                              "attempts": item["attempts"], "grounding": round(ground, 2),
                              "teacher": Path(args.teacher).name}
                    data_file.write(json.dumps(record, ensure_ascii=False) + "\n")
                    kept_grams.append(trigrams(text))
                    kept.append(record)
                data_file.flush()
                rejects_file.flush()
                n = start + len(batch)
                elapsed = time.time() - started
                print(f"{n}/{len(specs)} done, {len(kept)} kept, {elapsed / n:.1f}s each", file=sys.stderr)
    finally:
        validator.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
