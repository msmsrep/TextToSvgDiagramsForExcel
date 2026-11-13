"""Checks hand-written pairs (data/claude/*.txt) and writes the good ones as JSONL.

    python check_pairs.py [--out desktop/out/train-data/claude.jsonl]

Each .txt file holds pairs in this form (the type is flowchart, sequence or gantt):

    === flowchart
    文章（複数行でもよい）
    ---
    flowchart TD
        A["…"] --> B["…"]

A pair is kept with the same checks as make_data.py: mermaid.parse reads it, it is
of the stated type, its labels come from the text, it has no message from a participant
to itself, and the text is not close to an evaluation case or another pair. Problems are printed with the file and number.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # also when run with python -I

from make_data import REPO, STYLING, Validator, eval_trigrams, grounding, has_self_message, jaccard, matches_kind, tidy_code, trigrams  # noqa: E402
PAIR = re.compile(r"^=== *(flowchart|sequence|gantt) *\n(.*?)\n---\n(.*?)(?=^=== |\Z)", re.S | re.M)


def read_pairs(path: Path) -> list[dict]:
    source = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    pairs = []
    for n, m in enumerate(PAIR.finditer(source), 1):
        # Hand-written pairs must not have messages to oneself; tidy_code would take them out silently.
        pairs.append({"id": f"claude-{path.stem}-{n:02d}", "type": m.group(1), "text": m.group(2).strip(),
                      "code": tidy_code(m.group(3).strip()), "self_message": has_self_message(STYLING.sub("", m.group(3)))})
    if source.count("=== ") != len(pairs):
        print(f"{path.name}: {source.count('=== ')} headers but {len(pairs)} pairs read", file=sys.stderr)
    return pairs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--src", default=str(HERE / "data" / "claude"))
    parser.add_argument("--out", default=str(REPO / "desktop" / "out" / "train-data" / "claude.jsonl"))
    parser.add_argument("--min-grounding", type=float, default=0.6)
    args = parser.parse_args()

    eval_grams = eval_trigrams()
    kept, kept_grams, problems = [], [], 0
    validator = Validator()
    try:
        for path in sorted(Path(args.src).glob("*.txt")):
            for pair in read_pairs(path):
                self_message = pair.pop("self_message")
                result = validator.check(pair["code"])
                grams = trigrams(pair["text"])
                ground = grounding(pair["text"], pair["code"])
                minimum = args.min_grounding - (0.15 if pair["type"] == "sequence" else 0)
                problem = (
                    f"invalid: {result.get('message', '')[:200]}" if not result["valid"]
                    else f"type is {result['type']}" if not matches_kind(pair["type"], result["type"])
                    else "message to oneself (A->>A)" if self_message
                    else f"grounding {ground:.2f}" if ground < minimum
                    else "close to an evaluation case" if max(jaccard(grams, g) for g in eval_grams) >= 0.4
                    else "duplicate" if max((jaccard(grams, g) for g in kept_grams), default=0) >= 0.7
                    else None
                )
                if problem:
                    problems += 1
                    print(f"{pair['id']}: {problem}", file=sys.stderr)
                    continue
                kept.append(pair | {"grounding": round(ground, 2), "teacher": "claude"})
                kept_grams.append(grams)
    finally:
        validator.close()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("".join(json.dumps(p, ensure_ascii=False) + "\n" for p in kept), encoding="utf-8")
    counts = {t: sum(p["type"] == t for p in kept) for t in ("flowchart", "sequence", "gantt")}
    print(f"{len(kept)} kept {counts}, {problems} with problems -> {out}", file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
