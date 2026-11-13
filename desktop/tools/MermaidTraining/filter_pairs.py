"""Keeps the tidier of the teacher model's pairs (make_data.py's data.jsonl).

    python filter_pairs.py desktop/out/train-data/qwen4b/data.jsonl desktop/out/train-data/qwen4b/filtered.jsonl

The local teacher's code is valid but often untidy, and the small model copies what
it sees. A pair is kept only when it is written the way the app's instructions and
the hand-written pairs are:

- flowchart: every node label quoted (A["…"], B{"…"}), no subgraph, at most 14 nodes
- sequence: participants declared with `as`, at most 6 of them and 12 messages; messages
  from a participant to itself are taken out (the pair is dropped when too little is left)
- gantt: `dateFormat YYYY-MM-DD`, at most 10 tasks
- labels mostly from the text: grounding 0.65 or more (0.5 for sequence diagrams)
- text at most 300 characters (600 for text written with spaces between words)
"""

from __future__ import annotations

import collections
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # also when run with python -I

from make_data import drop_self_messages  # noqa: E402

UNQUOTED_NODE = re.compile(r"\b\w+(\[(?!\")|\{(?!\")|\((?!\"))")
NODE = re.compile(r"\b(\w+)\s*(?:\[\"|\{\"|\(\")")
MESSAGE = re.compile(r"(?:->>|-->>|->|-->|-x|--x)")
PARTICIPANT = re.compile(r"^\s*(participant|actor)\s+(\S+)(\s+as\s+.+)?$", re.M)
TASK = re.compile(r"^\s*(?!dateFormat|title|section|axisFormat|excludes)[^:\n]+:", re.M)


def problem(r: dict) -> str | None:
    code, kind = r["code"], r["type"]
    # English takes about twice the characters of Japanese to say the same.
    english = sum(c.isascii() and c.isalpha() for c in r["text"]) > len(r["text"]) / 2
    if len(r["text"]) > (600 if english else 300):
        return "long text"
    if kind == "flowchart":
        body = "\n".join(code.splitlines()[1:])
        if "subgraph" in body:
            return "subgraph"
        if UNQUOTED_NODE.search(re.sub(r"\|\"[^\"]*\"\|", "", body)):
            return "unquoted label"
        if len(set(NODE.findall(body))) > 14:
            return "too many nodes"
        return None if r["grounding"] >= 0.65 else "grounding"
    if kind == "sequence":
        if drop_self_messages(code) is None:
            return "little left without messages to oneself"
        participants = PARTICIPANT.findall(drop_self_messages(code))
        if not participants or any(not p[2] for p in participants):
            return "participant without as"
        if len(participants) > 6:
            return "too many participants"
        if len(MESSAGE.findall(code)) > 12:
            return "too many messages"
        return None if r["grounding"] >= 0.5 else "grounding"
    if kind == "gantt":
        if "dateFormat YYYY-MM-DD" not in re.sub(r"\s+", " ", code) or "HH" in code:
            return "date format"
        if len(TASK.findall(code)) > 10:
            return "too many tasks"
        return None if r["grounding"] >= 0.65 else "grounding"
    return "type"


def main() -> int:
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    records = [json.loads(l) for l in src.read_text(encoding="utf-8").splitlines() if l.strip()]
    reasons = collections.Counter()
    kept = []
    for r in records:
        p = problem(r)
        if p:
            reasons[(r["type"], p)] += 1
        elif r["type"] == "sequence":
            kept.append(r | {"code": drop_self_messages(r["code"])})
        else:
            kept.append(r)
    dst.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in kept), encoding="utf-8")
    counts = collections.Counter(r["type"] for r in kept)
    print(f"{len(kept)} of {len(records)} kept {dict(counts)}", file=sys.stderr)
    for (kind, p), n in reasons.most_common():
        print(f"  dropped {kind}: {p} {n}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
